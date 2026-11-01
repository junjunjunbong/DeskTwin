import {
  calibratePhotoCamera,
  estimatePhotoCamera,
  projectPhotoItem,
  type PhotoCamera,
  type PhotoPoint,
  type PhotoReference,
} from './photoProjection';
import {
  photoPlacementHeightReferences,
  photoPlacementSupports,
  type PhotoPlacementCandidate,
} from './photoPlacement';
import {
  fitSceneProposalForReview,
  evaluateSceneSupport,
  getItemBounds,
  getSceneCollisionPairs,
  getScenePlacementIssues,
} from './spatial';
import { WorkspaceSchema, type Device, type SceneObject, type Workspace } from './workspace';

type Item = Device | SceneObject;
export type PhotoFitCandidate = PhotoPlacementCandidate & {
  source?: string;
  imageRegion: { x: number; y: number; width: number; height: number } | null;
  imageRegionVisibility?: 'complete' | 'partial' | 'unknown';
  imageAnchor?: PhotoPoint | null;
};
export type PhotoFitPolicy = {
  maxEvaluations: number;
  maxSweeps: number;
  maxPositionFraction: number;
  maxScaleFraction: number;
  maxRotationDegrees: number;
};
const defaults: PhotoFitPolicy = {
  maxEvaluations: 256,
  maxSweeps: 4,
  maxPositionFraction: 0.15,
  maxScaleFraction: 0.2,
  maxRotationDegrees: 10,
};
const items = (workspace: Workspace): Item[] => [...workspace.objects, ...workspace.devices];
const itemIn = (workspace: Workspace, id: string) =>
  items(workspace).find((item) => item.id === id);
const pairKey = (ids: readonly string[]) => [...ids].sort().join('\0');
const issueKey = (issue: {
  itemId: string;
  code: string;
  rootCause?: string;
  relatedItemId?: string;
}) => `${issue.itemId}:${issue.code}:${issue.rootCause}:${issue.relatedItemId}`;
const angle = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;

/** Image loss measures evidence alignment, not recognition or photographic fidelity.
 * Partial/unknown regions are containment constraints, never full silhouettes.
 * No RGB/style comparison or invented contact point is used. */
function evidenceLoss(item: Item, candidate: PhotoFitCandidate, camera: PhotoCamera): number {
  const projected = projectPhotoItem(item, camera);
  if (!projected) return 4;
  const observed = candidate.imageRegion;
  let loss = 0;
  if (candidate.imageAnchor)
    loss += projected.contact
      ? 2 *
        ((projected.contact.x - candidate.imageAnchor.x) ** 2 +
          (projected.contact.y - candidate.imageAnchor.y) ** 2)
      : 4;
  if (observed) {
    const actual = projected.unclippedRegion;
    const errors =
      candidate.imageRegionVisibility === 'complete'
        ? [
            actual.x - observed.x,
            actual.y - observed.y,
            actual.x + actual.width - observed.x - observed.width,
            actual.y + actual.height - observed.y - observed.height,
          ]
        : [
            Math.max(0, actual.x - observed.x),
            Math.max(0, actual.y - observed.y),
            Math.max(0, observed.x + observed.width - actual.x - actual.width),
            Math.max(0, observed.y + observed.height - actual.y - actual.height),
          ];
    loss += errors.reduce((sum, value) => sum + value * value, 0) / 4;
  }
  return loss;
}

export function photoAlignmentError(
  workspace: Workspace,
  candidates: PhotoFitCandidate[],
  camera: PhotoCamera,
): number {
  const evidence = candidates.filter(
    (candidate) =>
      candidate.included &&
      (candidate.imageRegion || candidate.imageAnchor) &&
      itemIn(workspace, candidate.sceneId),
  );
  if (!evidence.length) return 0;
  return Math.sqrt(
    evidence.reduce(
      (sum, candidate) =>
        sum + evidenceLoss(itemIn(workspace, candidate.sceneId)!, candidate, camera),
      0,
    ) / evidence.length,
  );
}

/** Fit only an in-memory preview. The calibrated desk, retained objects and user
 * locks are anchors. Every accepted update reduces image loss without adding or
 * worsening geometric violations; independent apply validation remains required. */
export function fitPhotoLayout(
  base: Workspace,
  input: Workspace,
  candidates: PhotoFitCandidate[],
  reference: PhotoReference,
  policy: Partial<PhotoFitPolicy> = {},
) {
  const {
    camera,
    error: calibrationError,
    warnings: calibrationWarnings,
  } = calibratePhotoCamera(input, reference);
  if (
    reference.fov === undefined &&
    (camera.fov < 12.5 || camera.fov > 109.5 || calibrationError > 0.005)
  )
    throw new Error(
      'This reference does not reliably determine the photo perspective. Check its proportions, choose another visible rectangle, or enter an approximate photo field of view. Your preview has not changed.',
    );
  return fitAgainstPhotoView(
    base,
    input,
    candidates,
    camera,
    reference.objectId,
    calibrationWarnings,
    policy,
    reference,
  );
}

/** Inferred source view from object observations; no user coordinate input. */
export function fitPhotoLayoutFromRegions(
  base: Workspace,
  input: Workspace,
  candidates: PhotoFitCandidate[],
  aspect: number,
  policy: Partial<PhotoFitPolicy> = {},
) {
  const observations = candidates
    .filter(
      (candidate) =>
        candidate.included &&
        candidate.imageRegion &&
        itemIn(input, candidate.sceneId)?.kind !== 'desk',
    )
    .map((candidate) => ({ sceneId: candidate.sceneId, region: candidate.imageRegion! }));
  const estimate = estimatePhotoCamera(input, observations, aspect);
  const anchor = input.objects.find((item) => item.kind === 'desk')?.id;
  return fitAgainstPhotoView(
    base,
    input,
    candidates,
    estimate.camera,
    anchor,
    estimate.warnings,
    policy,
  );
}

function fitAgainstPhotoView(
  base: Workspace,
  input: Workspace,
  candidates: PhotoFitCandidate[],
  camera: PhotoCamera,
  anchorId: string | undefined,
  viewWarnings: string[],
  policy: Partial<PhotoFitPolicy>,
  reference?: PhotoReference,
) {
  const settings = { ...defaults, ...policy };
  for (const [key, value] of Object.entries(settings))
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      ((key === 'maxEvaluations' || key === 'maxSweeps') && !Number.isInteger(value))
    )
      throw new Error('Photo fitting limits must be finite, nonnegative values.');
  if (
    settings.maxEvaluations > 2048 ||
    settings.maxSweeps > 16 ||
    settings.maxPositionFraction > 0.3 ||
    settings.maxScaleFraction > 0.3 ||
    settings.maxRotationDegrees > 20
  )
    throw new Error('Photo fitting exceeds the supported preview search limits.');
  const included = candidates.filter(
    (candidate) => candidate.included && itemIn(input, candidate.sceneId),
  );
  const byId = new Map(included.map((candidate) => [candidate.sceneId, candidate]));
  const relations = photoPlacementSupports(included);
  const changed = included.map((candidate) => candidate.sceneId);
  const observed = included.filter(
    (candidate) =>
      candidate.sceneId !== anchorId && (candidate.imageRegion || candidate.imageAnchor),
  );
  const warnings = [...viewWarnings];
  if (!observed.length)
    warnings.push(
      'No object image regions or visible contact points were supplied. Only the photo perspective was estimated.',
    );
  if (
    observed.some(
      (candidate) => candidate.imageRegion && candidate.imageRegionVisibility !== 'complete',
    )
  )
    warnings.push(
      'Occluded or uncertain regions constrain visible coverage only; they do not establish full object size.',
    );
  let draft = WorkspaceSchema.parse(structuredClone(input));
  const beforeError = photoAlignmentError(draft, observed, camera);
  let currentError = beforeError;
  let evaluations = 0;
  const scaleAnchor =
    draft.objects.find((item) => item.kind === 'desk') ?? itemIn(draft, anchorId ?? '');
  const deskBounds = scaleAnchor
    ? getItemBounds(scaleAnchor)
    : { min: { x: -4, y: 0, z: -2 }, max: { x: 4, y: 5, z: 3 } };
  const width = deskBounds.max.x - deskBounds.min.x;
  const depth = deskBounds.max.z - deskBounds.min.z;
  const baselinePairs = () =>
    new Map(
      getSceneCollisionPairs(draft, base).map((pair) => [pairKey(pair.itemIds), pair.penetration]),
    );
  let pairs = baselinePairs();
  let issueKeys = new Set(getScenePlacementIssues(base, draft, changed, relations).map(issueKey));
  const supportMargins = (workspace: Workspace) =>
    new Map(
      relations.map((relation) => [
        relation.itemId,
        evaluateSceneSupport(workspace, relation.itemId, relation.surfaceId),
      ]),
    );
  let margins = supportMargins(draft);
  const seeds = new Map(
    included.map((candidate) => [
      candidate.sceneId,
      candidate.seed ?? {
        placement: { ...itemIn(input, candidate.sceneId)!.placement },
        scale: { ...itemIn(input, candidate.sceneId)!.visual.scale },
      },
    ]),
  );
  function descendants(root: string): string[] {
    const ids = new Set([root]);
    for (let pass = 0; pass < included.length; pass++)
      for (const relation of relations) if (ids.has(relation.surfaceId)) ids.add(relation.itemId);
    return [...ids];
  }
  function withinBounds(next: Workspace): boolean {
    if (
      anchorId &&
      JSON.stringify(itemIn(next, anchorId)) !== JSON.stringify(itemIn(input, anchorId))
    )
      return false;
    for (const candidate of included) {
      const item = itemIn(next, candidate.sceneId)!;
      const old = itemIn(input, candidate.sceneId)!;
      const seed = seeds.get(candidate.sceneId)!;
      if (
        candidate.locks?.position &&
        (['x', 'y', 'z'] as const).some((axis) => item.placement[axis] !== old.placement[axis])
      )
        return false;
      if (candidate.locks?.rotation && item.placement.rotation !== old.placement.rotation)
        return false;
      if (
        candidate.locks?.scale &&
        JSON.stringify(item.visual.scale) !== JSON.stringify(old.visual.scale)
      )
        return false;
      if (
        (item.placement.x !== old.placement.x &&
          Math.abs(item.placement.x - seed.placement.x) >
            width * settings.maxPositionFraction + 1e-8) ||
        (item.placement.z !== old.placement.z &&
          Math.abs(item.placement.z - seed.placement.z) >
            depth * settings.maxPositionFraction + 1e-8) ||
        (item.placement.rotation !== old.placement.rotation &&
          Math.abs(angle(item.placement.rotation - seed.placement.rotation)) >
            settings.maxRotationDegrees + 1e-8)
      )
        return false;
      for (const axis of ['x', 'y', 'z'] as const)
        if (
          item.visual.scale[axis] !== old.visual.scale[axis] &&
          Math.abs(item.visual.scale[axis] / seed.scale[axis] - 1) >
            settings.maxScaleFraction + 1e-8
        )
          return false;
    }
    // Existing records not included in this proposal never become fitting variables.
    for (const item of items(input))
      if (!byId.has(item.id) && JSON.stringify(itemIn(next, item.id)) !== JSON.stringify(item))
        return false;
    return true;
  }
  function trial(
    candidate: PhotoFitCandidate,
    edit: (next: Workspace) => void,
  ): Workspace | undefined {
    if (evaluations >= settings.maxEvaluations) return;
    evaluations++;
    const next = structuredClone(draft);
    edit(next);
    if (!WorkspaceSchema.safeParse(next).success) return;
    const affected = descendants(candidate.sceneId);
    const fitted = fitSceneProposalForReview(base, next, affected, relations, {
      lockedIds: included.filter((entry) => entry.locks?.position).map((entry) => entry.sceneId),
      heightReferences: photoPlacementHeightReferences(included),
    }).draft;
    if (!withinBounds(fitted)) return;
    // Compare actual component contacts against this iteration as well: a new
    // small contact must not hide under a larger unchanged contact in one pair.
    if (getSceneCollisionPairs(fitted, draft).length) return;
    if (
      getSceneCollisionPairs(fitted, base).some(
        (pair) =>
          !pairs.has(pairKey(pair.itemIds)) ||
          pair.penetration > pairs.get(pairKey(pair.itemIds))! + 1e-7,
      )
    )
      return;
    if (
      getScenePlacementIssues(base, fitted, changed, relations).some(
        (issue) => !issueKeys.has(issueKey(issue)),
      )
    )
      return;
    for (const [id, next] of supportMargins(fitted)) {
      const old = margins.get(id)!;
      if (
        next.footprintError > old.footprintError + 1e-7 ||
        (old.available && !next.available) ||
        Math.abs(next.heightDelta) > Math.max(0.005, Math.abs(old.heightDelta)) + 1e-7
      )
        return;
    }
    if (photoAlignmentError(fitted, observed, camera) >= currentError - 1e-8) return;
    return fitted;
  }
  const order = [...included]
    .filter((candidate) => candidate.sceneId !== anchorId)
    .sort(
      (a, b) =>
        descendants(b.sceneId).length - descendants(a.sceneId).length ||
        a.sceneId.localeCompare(b.sceneId),
    );
  for (
    let sweep = 0;
    sweep < settings.maxSweeps && evaluations < settings.maxEvaluations;
    sweep++
  ) {
    let improved = false;
    for (const candidate of order) {
      if (evaluations >= settings.maxEvaluations) break;
      const id = candidate.sceneId;
      const current = itemIn(draft, id)!;
      const group = descendants(id);
      if (!group.some((groupId) => observed.some((entry) => entry.sceneId === groupId))) continue;
      let best: Workspace | undefined;
      let bestError = currentError;
      const consider = (edit: (next: Workspace) => void) => {
        const next = trial(candidate, edit);
        if (!next) return;
        const error = photoAlignmentError(next, observed, camera);
        if (error < bestError - 1e-8) {
          best = next;
          bestError = error;
        }
      };
      if (
        !group.some(
          (groupId) =>
            groupId === anchorId || !byId.has(groupId) || byId.get(groupId)?.locks?.position,
        )
      ) {
        const factor = [0.03, 0.015, 0.006, 0.002][sweep] ?? 0.002;
        const offsets: [number, number][] = [
          [width * factor, 0],
          [-width * factor, 0],
          [0, depth * factor],
          [0, -depth * factor],
        ];
        // A local image-space Jacobian proposes a direct X/Z correction. It is
        // only a candidate: contact, SAT and seed-relative bounds still decide.
        const target =
          candidate.imageAnchor ??
          (candidate.imageRegionVisibility === 'complete' && candidate.imageRegion
            ? {
                x: candidate.imageRegion.x + candidate.imageRegion.width / 2,
                y: candidate.imageRegion.y + candidate.imageRegion.height / 2,
              }
            : null);
        const point = (item: Item) => {
          const projection = projectPhotoItem(item, camera);
          return candidate.imageAnchor
            ? projection?.contact
            : projection && {
                x: projection.unclippedRegion.x + projection.unclippedRegion.width / 2,
                y: projection.unclippedRegion.y + projection.unclippedRegion.height / 2,
              };
        };
        const center = point(current);
        if (target && center) {
          const delta = 0.01;
          const xItem = structuredClone(current);
          xItem.placement.x += delta;
          const zItem = structuredClone(current);
          zItem.placement.z += delta;
          const xPoint = point(xItem),
            zPoint = point(zItem);
          if (xPoint && zPoint) {
            const a = (xPoint.x - center.x) / delta,
              b = (zPoint.x - center.x) / delta;
            const c = (xPoint.y - center.y) / delta,
              d = (zPoint.y - center.y) / delta;
            const determinant = a * d - b * c;
            if (Math.abs(determinant) > 1e-8) {
              const ex = target.x - center.x,
                ey = target.y - center.y;
              offsets.unshift([(d * ex - b * ey) / determinant, (a * ey - c * ex) / determinant]);
            }
          }
        }
        for (const [x, z] of offsets)
          consider((next) => {
            for (const groupId of group) {
              const item = itemIn(next, groupId)!;
              item.placement.x += x;
              item.placement.z += z;
            }
          });
      }
      // Complete outlines alone justify size/orientation refinement. A visible
      // fragment cannot shrink the hidden portion of an object.
      if (candidate.imageRegionVisibility === 'complete' && candidate.imageRegion) {
        if (!candidate.locks?.scale && current.shapeMode !== 'custom')
          for (const factor of [1 + 0.05 / (sweep + 1), 1 - 0.05 / (sweep + 1)])
            consider((next) => {
              const item = itemIn(next, id)!;
              for (const axis of ['x', 'y', 'z'] as const) item.visual.scale[axis] *= factor;
            });
        if (!candidate.locks?.rotation)
          for (const delta of [5 / (sweep + 1), -5 / (sweep + 1)])
            consider((next) => {
              itemIn(next, id)!.placement.rotation = angle(current.placement.rotation + delta);
            });
      }
      if (best) {
        draft = best;
        currentError = bestError;
        improved = true;
        pairs = baselinePairs();
        issueKeys = new Set(getScenePlacementIssues(base, draft, changed, relations).map(issueKey));
        margins = supportMargins(draft);
      }
    }
    if (!improved) break;
  }
  if (evaluations >= settings.maxEvaluations)
    warnings.push('Photo fitting reached its search limit. Remaining differences need review.');
  const changedIds = included
    .filter((candidate) => {
      const before = itemIn(input, candidate.sceneId)!,
        after = itemIn(draft, candidate.sceneId)!;
      return (
        (['x', 'y', 'z', 'rotation'] as const).some(
          (axis) => Math.abs(before.placement[axis] - after.placement[axis]) > 1e-7,
        ) ||
        (['x', 'y', 'z'] as const).some(
          (axis) => Math.abs(before.visual.scale[axis] - after.visual.scale[axis]) > 1e-7,
        )
      );
    })
    .map((candidate) => candidate.sceneId);
  return {
    draft,
    reference: reference ? structuredClone(reference) : undefined,
    camera,
    beforeError,
    afterError: currentError,
    evaluations,
    changedIds,
    warnings,
    beforeDraft: structuredClone(input),
    afterDraft: structuredClone(draft),
  };
}

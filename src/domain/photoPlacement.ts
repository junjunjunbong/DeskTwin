import {
  fitSceneProposalForReview,
  DEFAULT_SCENE_HEIGHT_ADJUSTMENT,
  getItemBounds,
  getSceneCollisionPairs,
  getScenePlacementIssues,
  type ScenePlacementIssue,
  type SceneSupportRelation,
} from './spatial';
import { WorkspaceSchema, type Device, type SceneObject, type Workspace } from './workspace';

type Item = Device | SceneObject;
export type PhotoSupportSource = 'model' | 'geometry' | 'user';
export type PhotoPlacementLocks = {
  position: boolean;
  rotation: boolean;
  scale: boolean;
  support: boolean;
};
export type PhotoPlacementSeed = {
  readonly sceneId?: string;
  readonly placement: Readonly<Item['placement']>;
  readonly scale: Readonly<Item['visual']['scale']>;
  readonly supportId: string | null;
};
export type PhotoHeightReference = {
  /** Root Y, independent from the immutable original photo seed. */
  y: number;
  source: 'model' | 'user';
};
export type PhotoPlacementCandidate = {
  proposalId: string;
  sceneId: string;
  included: boolean;
  supportId: string | null;
  supportSource?: PhotoSupportSource;
  locks?: Partial<PhotoPlacementLocks>;
  seed?: PhotoPlacementSeed;
  heightReference?: PhotoHeightReference;
};
export type PhotoPlacementAdjustment = {
  itemId: string;
  field: 'position' | 'support';
  before: Item['placement'] | string | null;
  after: Item['placement'] | string | null;
  source: 'geometry';
  reason: string;
};
export type PhotoRepairSummary = {
  status: 'ready' | 'needs-review';
  evaluations: number;
  sweeps: number;
  stopped: 'clear' | 'no-improvement' | 'budget';
  unresolved: ScenePlacementIssue[];
};
export type PhotoRepairPolicy = {
  /** Bounds always refer to the immutable photo seed, never the previous repair. */
  maxDeskWidthFraction: number;
  maxDeskDepthFraction: number;
  maxSweeps: number;
  maxEvaluations: number;
};
export const defaultPhotoRepairPolicy: Readonly<PhotoRepairPolicy> = Object.freeze({
  maxDeskWidthFraction: 0.03,
  maxDeskDepthFraction: 0.05,
  maxSweeps: 8,
  maxEvaluations: 128,
});
const allItems = (draft: Workspace): Item[] => [...draft.objects, ...draft.devices];
const itemIn = (draft: Workspace, id: string) => allItems(draft).find((item) => item.id === id);
const close = (a: number, b: number) => Math.abs(a - b) < 1e-8;
const pairKey = (ids: readonly string[]) => [...ids].sort().join('\u0000');
const supportKinds = new Set(['desk', 'chair', 'mat', 'shelf', 'monitor-riser', 'laptop-stand']);

/** The proposal namespace remains separate from saved scene IDs after record rebinding. */
export function photoPlacementSupports(
  candidates: PhotoPlacementCandidate[],
): SceneSupportRelation[] {
  return candidates.flatMap((candidate) => {
    if (!candidate.included || !candidate.supportId) return [];
    const support =
      candidate.supportId === 'floor'
        ? undefined
        : candidates.find((entry) => entry.proposalId === candidate.supportId);
    return [
      {
        itemId: candidate.sceneId,
        surfaceId: support
          ? support.included
            ? support.sceneId
            : `excluded-${support.sceneId}`
          : candidate.supportId,
        source: candidate.supportSource ?? 'model',
      },
    ];
  });
}

export function photoPlacementSeed(item: Item, supportId: string | null): PhotoPlacementSeed {
  return {
    sceneId: item.id,
    placement: Object.freeze({ ...item.placement }),
    scale: Object.freeze({ ...item.visual.scale }),
    supportId,
  };
}

/** Automatic fits share one cumulative vertical budget across fitting stages and retries. */
export function photoPlacementHeightReferences(candidates: PhotoPlacementCandidate[]) {
  return candidates.flatMap((candidate) => {
    const y = candidate.heightReference?.y ?? candidate.seed?.placement.y;
    return candidate.included && y !== undefined
      ? [{ itemId: candidate.sceneId, y, maxDisplacement: DEFAULT_SCENE_HEIGHT_ADJUSTMENT }]
      : [];
  });
}

function supportDimensions(draft: Workspace, id: string, relations: SceneSupportRelation[]) {
  const supports = new Map(relations.map((relation) => [relation.itemId, relation.surfaceId]));
  const seen = new Set<string>();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const item = itemIn(draft, current);
    if (item?.kind === 'desk') {
      const bounds = getItemBounds(item);
      return { width: bounds.max.x - bounds.min.x, depth: bounds.max.z - bounds.min.z };
    }
    const next = supports.get(current);
    if (!next) break;
    current = next;
  }
  const desk = draft.objects
    .filter((item) => item.kind === 'desk')
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (desk) {
    const bounds = getItemBounds(desk);
    return { width: bounds.max.x - bounds.min.x, depth: bounds.max.z - bounds.min.z };
  }
  // No photographed desk: a conservative fixed fraction of the existing scene limits.
  return { width: 8.6, depth: 5.6 };
}

function score(
  base: Workspace,
  draft: Workspace,
  changed: string[],
  relations: SceneSupportRelation[],
  seeds: Map<string, PhotoPlacementSeed>,
): number[] {
  const issues = getScenePlacementIssues(base, draft, changed, relations);
  const pairs = getSceneCollisionPairs(draft, base).filter((pair) =>
    pair.itemIds.some((id) => changed.includes(id)),
  );
  const displacement = allItems(draft).reduce((sum, item) => {
    const seed = seeds.get(item.id);
    return seed
      ? sum +
          (item.placement.x - seed.placement.x) ** 2 +
          (item.placement.z - seed.placement.z) ** 2
      : sum;
  }, 0);
  return [
    issues.filter((issue) => issue.code !== 'collision').length,
    pairs.length,
    pairs.reduce((sum, pair) => sum + pair.penetration, 0),
    displacement,
  ];
}

function less(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (close(a[i], b[i])) continue;
    return a[i] < b[i];
  }
  return false;
}

/** A deterministic, bounded local repair. It never rescales, rotates, or changes supports.
 * Impossible cases remain editable; only the final independent validator authorizes apply. */
export function repairPhotoLayout(
  base: Workspace,
  input: Workspace,
  candidates: PhotoPlacementCandidate[],
  policy: Partial<PhotoRepairPolicy> = {},
): { draft: Workspace; adjustments: PhotoPlacementAdjustment[]; summary: PhotoRepairSummary } {
  const settings = { ...defaultPhotoRepairPolicy, ...policy };
  if (
    !Number.isFinite(settings.maxDeskWidthFraction) ||
    settings.maxDeskWidthFraction < 0 ||
    !Number.isFinite(settings.maxDeskDepthFraction) ||
    settings.maxDeskDepthFraction < 0 ||
    !Number.isInteger(settings.maxSweeps) ||
    settings.maxSweeps < 0 ||
    !Number.isInteger(settings.maxEvaluations) ||
    settings.maxEvaluations < 0
  )
    throw new Error('Photo repair limits must be finite and nonnegative.');
  const included = candidates.filter(
    (candidate) => candidate.included && itemIn(input, candidate.sceneId),
  );
  const changed = included.map((candidate) => candidate.sceneId).sort();
  const relations = photoPlacementSupports(candidates);
  const anchors = new Set(relations.map((relation) => relation.surfaceId));
  const movable = new Set(
    included
      .filter((candidate) => {
        const item = itemIn(input, candidate.sceneId)!;
        return !candidate.locks?.position && !anchors.has(item.id) && !supportKinds.has(item.kind);
      })
      .map((candidate) => candidate.sceneId),
  );
  const seeds = new Map(
    included.map((candidate) => [
      candidate.sceneId,
      candidate.seed ?? photoPlacementSeed(itemIn(input, candidate.sceneId)!, candidate.supportId),
    ]),
  );
  const lockedIds = included
    .filter((candidate) => candidate.locks?.position)
    .map((candidate) => candidate.sceneId);
  const heightReferences = photoPlacementHeightReferences(candidates);
  const movementLimits = new Map(
    included.map((candidate) => [
      candidate.sceneId,
      supportDimensions(input, candidate.sceneId, relations),
    ]),
  );
  function withinMovementLimits(id: string, x: number, z: number): boolean {
    const seed = seeds.get(id);
    const limits = movementLimits.get(id);
    return (
      !seed ||
      !limits ||
      (Math.abs(x - seed.placement.x) <= limits.width * settings.maxDeskWidthFraction + 1e-8 &&
        Math.abs(z - seed.placement.z) <= limits.depth * settings.maxDeskDepthFraction + 1e-8)
    );
  }
  // Every bounded pass starts from the same photo X/Z. Otherwise a budget-limited
  // second run could continue the previous search and silently accumulate repairs.
  // Preserve current Y: it includes a user's support choice and its propagated height.
  const canonical = structuredClone(input);
  for (const candidate of included) {
    if (!movable.has(candidate.sceneId)) continue;
    const current = itemIn(canonical, candidate.sceneId)!;
    const seed = seeds.get(candidate.sceneId)!;
    current.placement.x = seed.placement.x;
    current.placement.z = seed.placement.z;
  }
  let draft = fitSceneProposalForReview(base, canonical, changed, relations, {
    carryFrom: canonical,
    lockedIds,
    heightReferences,
  }).draft;
  const originalPairs = getSceneCollisionPairs(draft, base).filter((pair) =>
    pair.itemIds.some((id) => changed.includes(id)),
  );
  const allowedPairKeys = new Set(originalPairs.map((pair) => pairKey(pair.itemIds)));
  let currentPairDepths = new Map(
    originalPairs.map((pair) => [pairKey(pair.itemIds), pair.penetration]),
  );
  const initialIssues = getScenePlacementIssues(base, draft, changed, relations);
  const allowedIssueKeys = new Set(
    initialIssues
      .filter((issue) => issue.code !== 'collision')
      .map((issue) => `${issue.itemId}:${issue.message}`),
  );
  let currentScore = score(base, draft, changed, relations, seeds);
  let evaluations = 0;
  let sweeps = 0;
  let stopped: PhotoRepairSummary['stopped'] = 'no-improvement';

  function acceptable(next: Workspace): boolean {
    if (!WorkspaceSchema.safeParse(next).success) return false;
    for (const item of allItems(next)) {
      const seed = seeds.get(item.id);
      if (!seed) continue;
      if (
        movable.has(item.id) &&
        !withinMovementLimits(item.id, item.placement.x, item.placement.z)
      )
        return false;
    }
    // Preserve the initial ordering of interacting objects, without making unrelated decor an anchor.
    for (const pair of originalPairs) {
      const [a, b] = pair.itemIds.map((id) => itemIn(next, id)!);
      const oldA = seeds.get(a.id)?.placement ?? itemIn(input, a.id)!.placement;
      const oldB = seeds.get(b.id)?.placement ?? itemIn(input, b.id)!.placement;
      for (const axis of ['x', 'z'] as const) {
        const original = oldA[axis] - oldB[axis];
        if (
          Math.abs(original) > 0.02 &&
          (a.placement[axis] - b.placement[axis]) * Math.sign(original) < -1e-8
        )
          return false;
      }
    }
    if (
      getSceneCollisionPairs(next, base).some(
        (pair) =>
          pair.itemIds.some((id) => changed.includes(id)) &&
          (!allowedPairKeys.has(pairKey(pair.itemIds)) ||
            pair.penetration > (currentPairDepths.get(pairKey(pair.itemIds)) ?? 0) + 1e-8),
      )
    )
      return false;
    return !getScenePlacementIssues(base, next, changed, relations).some(
      (issue) =>
        issue.code !== 'collision' && !allowedIssueKeys.has(`${issue.itemId}:${issue.message}`),
    );
  }

  for (; sweeps < settings.maxSweeps && evaluations < settings.maxEvaluations;) {
    sweeps++;
    const pairs = getSceneCollisionPairs(draft, base)
      .filter((pair) => pair.itemIds.some((id) => movable.has(id)))
      .sort((a, b) => pairKey(a.itemIds).localeCompare(pairKey(b.itemIds)));
    if (!pairs.length) {
      stopped = 'clear';
      break;
    }
    let best: Workspace | undefined;
    let bestScore = currentScore;
    for (const pair of pairs) {
      const [a, b] = pair.itemIds.map((id) => itemIn(draft, id)!);
      const boundsA = getItemBounds(a);
      const boundsB = getItemBounds(b);
      // Exact SAT accepts or rejects these conservative AABB-generated candidate offsets.
      const offsets: [number, number][] = [
        [boundsB.max.x - boundsA.min.x + 0.001, 0],
        [boundsB.min.x - boundsA.max.x - 0.001, 0],
        [0, boundsB.max.z - boundsA.min.z + 0.001],
        [0, boundsB.min.z - boundsA.max.z - 0.001],
      ];
      for (const [dx, dz] of offsets) {
        const moves: [number, number][] = [];
        if (movable.has(a.id)) moves.push([1, 0]);
        if (movable.has(b.id)) moves.push([0, -1]);
        if (movable.has(a.id) && movable.has(b.id)) moves.push([0.5, -0.5]);
        for (const [weightA, weightB] of moves) {
          if (evaluations >= settings.maxEvaluations) break;
          evaluations++;
          // Most coarse AABB directions are outside the small trust region. Reject
          // them before cloning, schema parsing, support fitting, or collision queries.
          if (
            (weightA !== 0 &&
              !withinMovementLimits(
                a.id,
                a.placement.x + dx * weightA,
                a.placement.z + dz * weightA,
              )) ||
            (weightB !== 0 &&
              !withinMovementLimits(
                b.id,
                b.placement.x + dx * weightB,
                b.placement.z + dz * weightB,
              ))
          )
            continue;
          const trial = structuredClone(draft);
          for (const [item, weight] of [
            [a, weightA],
            [b, weightB],
          ] as const) {
            const target = itemIn(trial, item.id)!;
            target.placement.x += dx * weight;
            target.placement.z += dz * weight;
          }
          if (!WorkspaceSchema.safeParse(trial).success) continue;
          const fitted = fitSceneProposalForReview(base, trial, changed, relations, {
            carryFrom: draft,
            lockedIds,
            heightReferences,
          }).draft;
          if (!acceptable(fitted)) continue;
          const candidateScore = score(base, fitted, changed, relations, seeds);
          if (less(candidateScore, bestScore)) {
            best = fitted;
            bestScore = candidateScore;
          }
        }
        if (evaluations >= settings.maxEvaluations) break;
      }
      if (evaluations >= settings.maxEvaluations) break;
    }
    if (!best) {
      stopped = 'no-improvement';
      break;
    }
    draft = best;
    currentScore = bestScore;
    currentPairDepths = new Map(
      getSceneCollisionPairs(draft, base).map((pair) => [pairKey(pair.itemIds), pair.penetration]),
    );
  }
  if (evaluations >= settings.maxEvaluations || sweeps >= settings.maxSweeps) stopped = 'budget';
  const issues = getScenePlacementIssues(base, draft, changed, relations);
  if (!issues.length) stopped = 'clear';
  else if (stopped === 'clear') stopped = 'no-improvement';
  const adjustments = included.flatMap((candidate): PhotoPlacementAdjustment[] => {
    if (candidate.locks?.position) return [];
    const item = itemIn(draft, candidate.sceneId)!;
    const seed = seeds.get(item.id)!;
    if (
      ['x', 'y', 'z'].every((axis) =>
        close(item.placement[axis as 'x' | 'y' | 'z'], seed.placement[axis as 'x' | 'y' | 'z']),
      )
    )
      return [];
    return [
      {
        itemId: item.id,
        field: 'position',
        before: { ...seed.placement },
        after: { ...item.placement },
        source: 'geometry',
        reason:
          close(item.placement.x, seed.placement.x) && close(item.placement.z, seed.placement.z)
            ? 'Aligned height with the selected support.'
            : 'Separated overlapping objects within the photo movement limits.',
      },
    ];
  });
  return {
    draft,
    adjustments,
    summary: {
      status: issues.length ? 'needs-review' : 'ready',
      evaluations: Math.min(evaluations, settings.maxEvaluations),
      sweeps,
      stopped,
      unresolved: issues,
    },
  };
}

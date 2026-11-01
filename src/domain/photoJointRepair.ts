import {
  photoPlacementSupports,
  photoPlacementSeed,
  scorePhotoLayout,
  lessPhotoLayoutScore,
  type PhotoPlacementCandidate,
  type PhotoPlacementAdjustment,
  type PhotoRepairSummary,
} from './photoPlacement';
import {
  DEFAULT_SCENE_HEIGHT_ADJUSTMENT,
  evaluateSceneSupport,
  getItemBounds,
  getSceneCollisionPairs,
  getScenePlacementIssues,
  getSceneCoveringAlternatives,
  getSceneSupportOffsets,
  getScenePairSeparationOffsets,
  type SceneSupportRelation,
  type ScenePlanarOffset,
} from './spatial';
import { WorkspaceSchema, type Workspace, type Device, type SceneObject } from './workspace';

type Item = Device | SceneObject;
export type PhotoJointRepairOptions = {
  anchorId?: string;
  /** Evaluate all proposals with the caller's one fixed source camera. */
  imageError?: (draft: Workspace) => number;
  maxPositionFraction?: number;
  maxEvaluations?: number;
  maxSweeps?: number;
};
const items = (workspace: Workspace): Item[] => [...workspace.objects, ...workspace.devices];
const itemIn = (workspace: Workspace, id: string) =>
  items(workspace).find((item) => item.id === id)!;
const EPS = 1e-8;
const BEAM_WIDTH = 3;

/** Search bounded joint endpoints, rather than committing the intermediate states
 * used to construct them. Every returned repair passes the original component
 * collision guard, support margins and immutable-seed limits. Sizes, yaw and
 * saved records outside the proposal are never search variables. */
export function repairPhotoJointLayout<C extends PhotoPlacementCandidate>(
  base: Workspace,
  input: Workspace,
  inputCandidates: C[],
  options: PhotoJointRepairOptions = {},
): {
  draft: Workspace;
  candidates: C[];
  adjustments: PhotoPlacementAdjustment[];
  summary: PhotoRepairSummary;
} {
  const maxEvaluations = options.maxEvaluations ?? 2048;
  const maxSweeps = options.maxSweeps ?? 20;
  const fraction = options.maxPositionFraction ?? 0.15;
  if (
    !Number.isInteger(maxEvaluations) ||
    maxEvaluations < 0 ||
    maxEvaluations > 8192 ||
    !Number.isInteger(maxSweeps) ||
    maxSweeps < 0 ||
    maxSweeps > 48 ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 0.15
  )
    throw new Error('Joint photo repair exceeds the supported bounded search limits.');
  const included = inputCandidates.filter(
    (candidate) => candidate.included && itemIn(input, candidate.sceneId),
  );
  const byId = new Map(included.map((candidate) => [candidate.sceneId, candidate]));
  const ids = included.map((candidate) => candidate.sceneId).sort();
  const seeds = new Map(
    included.map((candidate) => [
      candidate.sceneId,
      candidate.seed ?? photoPlacementSeed(itemIn(input, candidate.sceneId), candidate.supportId),
    ]),
  );
  const anchorId = options.anchorId ?? input.objects.find((item) => item.kind === 'desk')?.id;
  // Share the later photo fitter's desk-based budget even when the fixed
  // perspective reference is a monitor screen instead of the desk.
  const desk =
    input.objects.find((item) => item.kind === 'desk') ??
    (anchorId ? itemIn(input, anchorId) : undefined);
  const bounds = desk
    ? getItemBounds(desk)
    : { min: { x: -4, y: 0, z: -2 }, max: { x: 4, y: 5, z: 3 } };
  const limits = {
    x: (bounds.max.x - bounds.min.x) * fraction,
    y: DEFAULT_SCENE_HEIGHT_ADJUSTMENT,
    z: (bounds.max.z - bounds.min.z) * fraction,
  };
  const originalRelations = photoPlacementSupports(inputCandidates);
  const initialIssues = getScenePlacementIssues(base, input, ids, originalRelations);
  let evaluations = 0;
  let sweeps = 0;
  const movable = (id: string) => byId.has(id) && id !== anchorId && !byId.get(id)!.locks?.position;
  function descendants(id: string, relations: SceneSupportRelation[]): string[] {
    const group = new Set([id]);
    for (let i = 0; i < ids.length; i++)
      for (const relation of relations)
        if (group.has(relation.surfaceId)) group.add(relation.itemId);
    return [...group].filter((entry) => !!itemIn(input, entry));
  }
  function withinBounds(workspace: Workspace): boolean {
    for (const item of items(workspace)) {
      const old = itemIn(input, item.id),
        candidate = byId.get(item.id);
      if (!candidate || item.id === anchorId || candidate.locks?.position) {
        if (JSON.stringify(item) !== JSON.stringify(old)) return false;
        continue;
      }
      if (
        JSON.stringify(item.visual.scale) !== JSON.stringify(old.visual.scale) ||
        item.placement.rotation !== old.placement.rotation
      )
        return false;
      const seed = seeds.get(item.id)!;
      for (const axis of ['x', 'y', 'z'] as const) {
        const reference =
          axis === 'y' ? (candidate.heightReference?.y ?? seed.placement.y) : seed.placement[axis];
        if (
          Math.abs(item.placement[axis] - old.placement[axis]) > EPS &&
          Math.abs(item.placement[axis] - reference) > limits[axis] + EPS
        )
          return false;
      }
    }
    return true;
  }
  function translate(
    workspace: Workspace,
    group: string[],
    x: number,
    y: number,
    z: number,
  ): boolean {
    if (group.some((id) => !movable(id))) return false;
    for (const id of group) {
      const item = itemIn(workspace, id);
      item.placement.x += x;
      item.placement.y += y;
      item.placement.z += z;
    }
    return true;
  }
  function relationOrder(relations: SceneSupportRelation[]) {
    const parents = new Map(relations.map((relation) => [relation.itemId, relation.surfaceId]));
    const depth = (id: string) => {
      const seen = new Set<string>();
      while (parents.has(id) && !seen.has(id)) {
        seen.add(id);
        id = parents.get(id)!;
      }
      return seen.size;
    };
    return [...relations].sort(
      (a, b) => depth(a.itemId) - depth(b.itemId) || a.itemId.localeCompare(b.itemId),
    );
  }
  /** Complete a compound proposal with contact-derived relative placement and
   * dependency-ordered height carry. These are not accepted search steps. */
  function settle(workspace: Workspace, candidates: C[], project: boolean) {
    const relations = photoPlacementSupports(candidates);
    for (const relation of relationOrder(relations)) {
      if (!movable(relation.itemId)) continue;
      let contact = evaluateSceneSupport(workspace, relation.itemId, relation.surfaceId);
      if (!contact.available) continue;
      const group = descendants(relation.itemId, relations);
      if (project && !contact.footprintValid) {
        const offsets = getSceneSupportOffsets(workspace, relation.itemId, relation.surfaceId);
        for (const offset of offsets) {
          const moved = structuredClone(workspace);
          if (!translate(moved, group, offset.x, 0, offset.z) || !withinBounds(moved)) continue;
          for (const id of group)
            itemIn(workspace, id).placement = { ...itemIn(moved, id).placement };
          break;
        }
        contact = evaluateSceneSupport(workspace, relation.itemId, relation.surfaceId);
      }
      if (contact.footprintValid && Math.abs(contact.heightDelta) > EPS) {
        const moved = structuredClone(workspace);
        if (translate(moved, group, 0, contact.heightDelta, 0) && withinBounds(moved))
          for (const id of group)
            itemIn(workspace, id).placement = { ...itemIn(moved, id).placement };
      }
    }
  }
  type State = {
    draft: Workspace;
    candidates: C[];
    score: number[];
    key: string;
    pairs: ReturnType<typeof getSceneCollisionPairs>;
    issues: ReturnType<typeof getScenePlacementIssues>;
  };
  const keyFor = (workspace: Workspace, candidates: C[]) =>
    JSON.stringify([
      ids.map((id) => {
        const p = itemIn(workspace, id).placement;
        return [id, ...(['x', 'y', 'z'] as const).map((a) => Math.round(p[a] * 1e7))];
      }),
      candidates.map((c) => [c.proposalId, c.supportId]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ]);
  function inspect(draft: Workspace, candidates: C[]): State {
    const relations = photoPlacementSupports(candidates);
    const pairs = getSceneCollisionPairs(draft, base),
      issues = getScenePlacementIssues(base, draft, ids, relations);
    const score = scorePhotoLayout(base, draft, ids, relations, seeds, { pairs, issues });
    return {
      draft,
      candidates,
      key: keyFor(draft, candidates),
      score: [...score.slice(0, 3), options.imageError?.(draft) ?? 0, score[3]],
      pairs,
      issues,
    };
  }
  const initial = inspect(structuredClone(input), structuredClone(inputCandidates));
  let accepted = initial;
  const originalMargins = new Map(
    originalRelations.map((r) => [r.itemId, evaluateSceneSupport(input, r.itemId, r.surfaceId)]),
  );
  function acceptable(state: State): boolean {
    if (
      !withinBounds(state.draft) ||
      !WorkspaceSchema.safeParse(state.draft).success ||
      getSceneCollisionPairs(state.draft, accepted.draft).length
    )
      return false;
    const oldRelations = photoPlacementSupports(accepted.candidates);
    const oldMargins = new Map(
      oldRelations.map((r) => [
        r.itemId,
        evaluateSceneSupport(accepted.draft, r.itemId, r.surfaceId),
      ]),
    );
    const newRelations = photoPlacementSupports(state.candidates);
    for (const relation of newRelations) {
      const next = evaluateSceneSupport(state.draft, relation.itemId, relation.surfaceId);
      const previous = oldMargins.get(relation.itemId) ?? originalMargins.get(relation.itemId);
      if (
        previous &&
        (next.footprintError > previous.footprintError + EPS ||
          (previous.available && !next.available) ||
          Math.abs(next.heightDelta) > Math.max(0.005, Math.abs(previous.heightDelta)) + EPS)
      )
        return false;
    }
    const oldIssueKeys = new Set(
      getScenePlacementIssues(base, accepted.draft, ids, oldRelations)
        .filter((i) => i.code !== 'collision')
        .map((i) => `${i.itemId}:${i.code}:${i.rootCause}:${i.relatedItemId}`),
    );
    return !state.issues.some(
      (i) =>
        i.code !== 'collision' &&
        !oldIssueKeys.has(`${i.itemId}:${i.code}:${i.rootCause}:${i.relatedItemId}`),
    );
  }
  const seen = new Set<string>();
  function consider(draft: Workspace, candidates: C[]): State | undefined {
    if (evaluations >= maxEvaluations || !withinBounds(draft)) return;
    const key = keyFor(draft, candidates);
    if (seen.has(key)) return;
    seen.add(key);
    evaluations++;
    const state = inspect(draft, candidates);
    if (lessPhotoLayoutScore(state.score, accepted.score) && acceptable(state)) accepted = state;
    return state;
  }
  if (initialIssues.length && maxEvaluations && maxSweeps) {
    const starts: State[] = [initial];
    seen.add(initial.key);
    const alternatives = included.flatMap((candidate) => {
      if (
        !movable(candidate.sceneId) ||
        candidate.locks?.support ||
        candidate.supportSource === 'user'
      )
        return [];
      const relation = originalRelations.find((r) => r.itemId === candidate.sceneId);
      if (!relation) return [];
      const possible = getSceneCoveringAlternatives(input, candidate.sceneId, relation.surfaceId);
      if (
        possible.length !== 1 ||
        descendants(candidate.sceneId, originalRelations).some((id) => !movable(id))
      )
        return [];
      return [{ candidate, alternative: possible[0] }];
    });
    for (const selections of [alternatives, ...alternatives.map((a) => [a])]) {
      const draft = structuredClone(input),
        candidates = structuredClone(inputCandidates);
      for (const { candidate, alternative } of selections) {
        const next = candidates.find((c) => c.sceneId === candidate.sceneId)!;
        next.supportId =
          candidates.find((c) => c.included && c.sceneId === alternative.surfaceId)?.proposalId ??
          alternative.surfaceId;
        next.supportSource = 'geometry';
        translate(
          draft,
          descendants(candidate.sceneId, originalRelations),
          0,
          alternative.heightDelta,
          0,
        );
      }
      const raw = consider(structuredClone(draft), structuredClone(candidates));
      if (raw) starts.push(raw);
      settle(draft, candidates, true);
      const normalized = consider(draft, candidates);
      if (normalized) starts.push(normalized);
    }
    let frontier = starts.sort((a, b) => compare(a.score, b.score)).slice(0, BEAM_WIDTH);
    for (; sweeps < maxSweeps && evaluations < maxEvaluations && accepted.issues.length; sweeps++) {
      const next: State[] = [];
      for (const state of frontier) {
        if (evaluations >= maxEvaluations) break;
        const relations = photoPlacementSupports(state.candidates);
        const groups = (id: string): string[][] => {
          const all = descendants(id, relations),
            groups = [all];
          if (all.length > 1) groups.push([id]);
          const parent = relations.find((r) => r.itemId === id)?.surfaceId;
          if (parent && movable(parent)) groups.push(descendants(parent, relations));
          return groups.filter((g) => g.every(movable));
        };
        const offer = (moves: { group: string[]; offset: ScenePlanarOffset }[]) => {
          if (evaluations >= maxEvaluations) return;
          const draft = structuredClone(state.draft),
            candidates = structuredClone(state.candidates);
          const touched = new Set<string>();
          for (const { group, offset } of moves) {
            if (group.some((id) => touched.has(id))) return;
            group.forEach((id) => touched.add(id));
            if (!translate(draft, group, offset.x, 0, offset.z)) return;
          }
          if (!withinBounds(draft)) return;
          settle(draft, candidates, true);
          const candidate = consider(draft, candidates);
          if (candidate) next.push(candidate);
        };
        for (const issue of state.issues
          .filter((i) => i.code === 'support' && i.rootCause === 'overhang')
          .slice(0, 2)) {
          const surface = relations.find((r) => r.itemId === issue.itemId)?.surfaceId;
          if (!surface) continue;
          for (const offset of getSceneSupportOffsets(state.draft, issue.itemId, surface))
            for (const group of groups(issue.itemId)) offer([{ group, offset }]);
        }
        const pairs = [...state.pairs].sort((a, b) => b.penetration - a.penetration).slice(0, 1);
        for (const pair of pairs) {
          const [a, b] = pair.itemIds;
          const aGroups = groups(a),
            bGroups = groups(b);
          const byDirection = new Map<string, ScenePlanarOffset>();
          // Keep the clear-all-parts endpoint along each direction. A shorter
          // offset can clear one part while leaving a second part intersecting.
          for (const offset of getScenePairSeparationOffsets(state.draft, a, b)) {
            const length = Math.hypot(offset.x, offset.z);
            if (length < EPS) continue;
            const direction = `${Math.round((offset.x / length) * 1e6)}:${Math.round((offset.z / length) * 1e6)}`;
            const previous = byDirection.get(direction);
            if (!previous || length > Math.hypot(previous.x, previous.z))
              byDirection.set(direction, offset);
          }
          const offsets = [...byDirection.values()].sort(
            (u, v) => u.x * u.x + u.z * u.z - v.x * v.x - v.z * v.z,
          );
          for (const id of [a, b]) {
            const surface = relations.find((r) => r.itemId === id)?.surfaceId;
            if (surface)
              for (const offset of getSceneSupportOffsets(state.draft, id, surface))
                for (const group of groups(id).slice(0, 2)) offer([{ group, offset }]);
          }
          for (const offset of offsets) {
            for (const group of aGroups) if (!group.includes(b)) offer([{ group, offset }]);
            for (const group of bGroups)
              if (!group.includes(a)) offer([{ group, offset: { x: -offset.x, z: -offset.z } }]);
            if (aGroups[0] && bGroups[0])
              offer([
                { group: aGroups[0], offset: { x: offset.x / 2, z: offset.z / 2 } },
                { group: bGroups[0], offset: { x: -offset.x / 2, z: -offset.z / 2 } },
              ]);
          }
        }
      }
      if (!next.length) break;
      frontier = next.sort((a, b) => compare(a.score, b.score)).slice(0, BEAM_WIDTH);
    }
  }

  const adjustments: PhotoPlacementAdjustment[] = [];
  for (const candidate of accepted.candidates) {
    if (!candidate.included) continue;
    const before = itemIn(input, candidate.sceneId),
      after = itemIn(accepted.draft, candidate.sceneId);
    if (!before || !after) continue;
    if (JSON.stringify(before.placement) !== JSON.stringify(after.placement))
      adjustments.push({
        itemId: candidate.sceneId,
        field: 'position',
        before: { ...before.placement },
        after: { ...after.placement },
        source: 'geometry',
        reason:
          'Jointly aligned support contacts and separated overlapping parts within the original photo limits.',
      });
    const previous = inputCandidates.find((c) => c.proposalId === candidate.proposalId)!;
    if (candidate.supportId !== previous.supportId)
      adjustments.push({
        itemId: candidate.sceneId,
        field: 'support',
        before: previous.supportId,
        after: candidate.supportId,
        source: 'geometry',
        reason: 'Selected a valid nearby thin covering after complete-scene validation.',
      });
  }
  return {
    draft: accepted.draft,
    candidates: accepted.candidates,
    adjustments,
    summary: {
      status: accepted.issues.length ? 'needs-review' : 'ready',
      evaluations,
      sweeps,
      stopped: !accepted.issues.length
        ? 'clear'
        : evaluations >= maxEvaluations || sweeps >= maxSweeps
          ? 'budget'
          : 'no-improvement',
      unresolved: accepted.issues,
    },
  };
}

function compare(a: number[], b: number[]): number {
  return lessPhotoLayoutScore(a, b) ? -1 : lessPhotoLayoutScore(b, a) ? 1 : 0;
}

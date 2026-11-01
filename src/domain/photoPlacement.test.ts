import { describe, expect, it } from 'vitest';
import {
  buildSceneDraft,
  buildScenePreview,
  validateSceneReviewForApply,
  type SceneProposal,
  type SceneProposalItem,
} from './sceneProposal';
import { defaultPhotoRepairPolicy } from './photoPlacement';
import {
  repairSceneReview,
  rebindSceneReviewDevice,
  sceneReviewSupports,
  refreshSceneReview,
  revertSceneRepair,
  setSceneCandidateIncluded,
  setSceneCandidateLocks,
  setSceneCandidateSupport,
} from './sceneReview';
import { getItemBounds } from './spatial';
import { createDemoWorkspace, createSceneObject, type Workspace } from './workspace';

function empty(): Workspace {
  return {
    ...createDemoWorkspace(),
    devices: [],
    objects: [],
    connections: [],
    diagnoses: [],
    history: [],
  };
}
function item(
  id: string,
  kind: SceneProposalItem['kind'],
  placement: SceneProposalItem['placement'],
  scale = { x: 1, y: 1, z: 1 },
  supportId: string | null = 'desk',
): SceneProposalItem {
  return {
    id,
    kind,
    name: id,
    deviceId: null,
    placement,
    scale,
    supportId,
    parts: [],
    color: '#808080',
    note: '',
    imageRegion: null,
  };
}
function proposal(ids: string[]): SceneProposal {
  const objects = [
    item('desk', 'desk', { x: 0, y: 0, z: 0, rotation: 0 }, undefined, 'floor'),
    item('keyboard', 'keyboard', { x: -0.05, y: 2.4735, z: 0.4, rotation: 0 }),
    item(
      'wrist-rest',
      'wrist-rest',
      { x: -0.05, y: 2.4835, z: 0.7, rotation: 0 },
      { x: 0.9, y: 1, z: 1 },
    ),
    item('mat', 'mat', { x: 0.1, y: 2.4835, z: 0.6, rotation: 0 }, { x: 1.4, y: 1, z: 1.7 }),
    item(
      'stand',
      'laptop-stand',
      { x: 2, y: 2.4835, z: -0.1, rotation: -15 },
      { x: 0.8, y: 0.8, z: 0.8 },
    ),
    item(
      'laptop',
      'laptop',
      { x: 2, y: 2.8128, z: -0.1, rotation: -15 },
      { x: 0.95, y: 0.9, z: 0.95 },
      'stand',
    ),
  ];
  return {
    message: 'Sanitized geometry regression; not a photo quality benchmark.',
    objects: objects.filter((object) => ids.includes(object.id)),
  };
}
const geometry = (workspace: Workspace) =>
  [...workspace.objects, ...workspace.devices]
    .map((entry) => ({ id: entry.id, placement: entry.placement, scale: entry.visual.scale }))
    .sort((a, b) => a.id.localeCompare(b.id));
const find = (workspace: Workspace, kind: string) =>
  [...workspace.objects, ...workspace.devices].find((entry) => entry.kind === kind)!;

describe('photo placement acceptance from sanitized live geometry', () => {
  it('promotes only the unique thin covering while preserving the model seed', () => {
    const base = empty();
    const input = proposal(['desk', 'mat', 'keyboard']);
    const before = structuredClone(input);
    const review = buildScenePreview(base, input);
    const keyboard = review.candidates.find((candidate) => candidate.kind === 'keyboard')!;
    expect(keyboard.supportId).toBe('mat');
    expect(keyboard.supportSource).toBe('geometry');
    expect(keyboard.seed?.supportId).toBe('desk');
    expect(review.issues).toEqual([]);
    expect(review.adjustments).toContainEqual(
      expect.objectContaining({ field: 'support', itemId: keyboard.sceneId }),
    );
    expect(input).toEqual(before);
    expect(find(review.originalDraft!, 'keyboard').placement).toEqual(
      before.objects.find((object) => object.kind === 'keyboard')!.placement,
    );
  });

  it('clears the wrist collision within the photo movement budget without changing sizes or yaw', () => {
    const base = empty();
    const input = proposal(['desk', 'keyboard', 'wrist-rest']);
    const review = buildScenePreview(base, input);
    expect(review.issues).toEqual([]);
    expect(() => validateSceneReviewForApply(review, base)).not.toThrow();
    const deskBounds = getItemBounds(find(review.draft, 'desk'));
    for (const candidate of review.candidates) {
      const current = [...review.draft.objects, ...review.draft.devices].find(
        (entry) => entry.id === candidate.sceneId,
      )!;
      expect(current.visual.scale).toEqual(candidate.seed!.scale);
      expect(current.placement.rotation).toBe(candidate.seed!.placement.rotation);
      expect(Math.abs(current.placement.x - candidate.seed!.placement.x)).toBeLessThanOrEqual(
        (deskBounds.max.x - deskBounds.min.x) * defaultPhotoRepairPolicy.maxDeskWidthFraction +
          1e-8,
      );
      expect(Math.abs(current.placement.z - candidate.seed!.placement.z)).toBeLessThanOrEqual(
        (deskBounds.max.z - deskBounds.min.z) * defaultPhotoRepairPolicy.maxDeskDepthFraction +
          1e-8,
      );
    }
    expect(find(review.draft, 'wrist-rest').placement.z).toBeGreaterThan(
      find(review.draft, 'keyboard').placement.z,
    );
  });

  it('fits the observed laptop stand without enlarging either template', () => {
    const base = empty();
    const review = buildScenePreview(base, proposal(['desk', 'stand', 'laptop']));
    expect(review.issues).toEqual([]);
    expect(find(review.draft, 'laptop-stand').visual.scale).toEqual({ x: 0.8, y: 0.8, z: 0.8 });
    expect(find(review.draft, 'laptop').visual.scale).toEqual({ x: 0.95, y: 0.9, z: 0.95 });
  });
});

describe('bounded repair invariants and review state', () => {
  it('is repeatable, idempotent, independent of storage order and unrelated decoration', () => {
    const base = empty();
    const input = proposal(['desk', 'keyboard', 'wrist-rest']);
    const first = buildScenePreview(base, input);
    expect(geometry(repairSceneReview(first, base).draft)).toEqual(geometry(first.draft));
    const reordered = buildScenePreview(base, { ...input, objects: [...input.objects].reverse() });
    expect(geometry(reordered.draft)).toEqual(geometry(first.draft));
    const decorated = buildScenePreview(base, {
      ...input,
      objects: [...input.objects, item('unrelated', 'mug', { x: 2, y: 2.5, z: -0.6, rotation: 0 })],
    });
    expect(geometry(decorated.draft).filter((entry) => entry.id !== 'photo-unrelated')).toEqual(
      geometry(first.draft),
    );
    expect(geometry(buildScenePreview(base, input).draft)).toEqual(geometry(first.draft));
  });

  it('retains unresolved collisions instead of exceeding zero movement or candidate budgets', () => {
    const base = empty();
    const initial = buildScenePreview(base, proposal(['desk', 'keyboard', 'wrist-rest']), {
      repair: false,
    });
    const original = structuredClone(initial.draft);
    const noMovement = repairSceneReview(initial, base, {
      maxDeskWidthFraction: 0,
      maxDeskDepthFraction: 0,
    });
    expect(geometry(noMovement.draft)).toEqual(geometry(original));
    expect(noMovement.issues.some((issue) => issue.code === 'collision')).toBe(true);
    expect(() => validateSceneReviewForApply(noMovement, base)).toThrow(/placement/);
    const noBudget = repairSceneReview(initial, base, { maxEvaluations: 0 });
    expect(noBudget.repairSummary?.evaluations).toBe(0);
    expect(noBudget.repairSummary?.status).toBe('needs-review');
  });

  it('does not continue a budget-exhausted search on repeated repair, including after a user edit', () => {
    const base = empty();
    const input = proposal(['desk']);
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 5; column++) {
        const x = -2.8 + column * 1.4;
        const z = -0.9 + row * 0.9;
        input.objects.push(
          item(`keyboard-${row}-${column}`, 'keyboard', { x, y: 2.4735, z, rotation: 0 }),
          item(
            `wrist-${row}-${column}`,
            'wrist-rest',
            { x, y: 2.4835, z: z + 0.3, rotation: 0 },
            { x: 0.9, y: 1, z: 1 },
          ),
        );
      }
    const first = buildScenePreview(base, input);
    expect(first.repairSummary?.evaluations).toBe(defaultPhotoRepairPolicy.maxEvaluations);
    expect(first.issues.length).toBeGreaterThan(0);
    const repeated = repairSceneReview(first, base);
    expect(geometry(repeated.draft)).toEqual(geometry(first.draft));
    expect(repeated.issues).toEqual(first.issues);
    const edited = structuredClone(repeated.draft);
    const userItem = edited.devices.find((entry) => entry.id === 'photo-keyboard-1-2')!;
    userItem.placement.x += 0.02;
    const userReview = refreshSceneReview(repeated, base, edited);
    const afterEdit = repairSceneReview(userReview, base);
    expect(afterEdit.draft.devices.find((entry) => entry.id === userItem.id)?.placement).toEqual(
      userItem.placement,
    );
    expect(geometry(repairSceneReview(afterEdit, base).draft)).toEqual(geometry(afterEdit.draft));
  });

  it('respects position locks, never labels user edits as automatic and preserves seeds on reset', () => {
    const base = empty();
    const first = buildScenePreview(base, proposal(['desk', 'keyboard', 'wrist-rest']));
    const initialSeeds = structuredClone(first.candidates.map((candidate) => candidate.seed));
    const edited = structuredClone(first.draft);
    const keyboard = find(edited, 'keyboard');
    keyboard.placement.x -= 0.05;
    keyboard.placement.rotation = 4;
    keyboard.visual.scale.x = 0.97;
    const state = refreshSceneReview(first, base, edited);
    const candidate = state.candidates.find((entry) => entry.sceneId === keyboard.id)!;
    expect(candidate.locks).toMatchObject({ position: true, rotation: true, scale: true });
    const repaired = repairSceneReview(state, base);
    expect(find(repaired.draft, 'keyboard').placement).toEqual(keyboard.placement);
    expect(find(repaired.draft, 'keyboard').visual.scale).toEqual(keyboard.visual.scale);
    expect(repaired.adjustments?.some((entry) => entry.itemId === keyboard.id)).toBe(false);
    const reverted = revertSceneRepair(repaired, base);
    expect(find(reverted.draft, 'keyboard').placement).toEqual(keyboard.placement);
    expect(reverted.candidates.map((entry) => entry.seed)).toEqual(initialSeeds);
    expect(first.candidates.map((entry) => entry.seed)).toEqual(initialSeeds);
  });

  it('reset and reapply reproduce the automatic result and preserve support provenance', () => {
    const base = empty();
    const review = buildScenePreview(base, proposal(['desk', 'mat', 'keyboard']));
    const reverted = revertSceneRepair(review, base);
    expect(reverted.candidates.find((entry) => entry.kind === 'keyboard')?.supportId).toBe('desk');
    expect(reverted.adjustments).toEqual([]);
    expect(geometry(repairSceneReview(reverted, base).draft)).toEqual(geometry(review.draft));
    const keyboard = review.candidates.find((entry) => entry.kind === 'keyboard')!;
    const chosen = setSceneCandidateSupport(review, base, keyboard.proposalId, 'photo-desk');
    expect(chosen.candidates.find((entry) => entry.kind === 'keyboard')).toMatchObject({
      supportSource: 'user',
      supportId: 'desk',
      locks: { support: true },
    });
    const repaired = repairSceneReview(chosen, base);
    expect(repaired.candidates.find((entry) => entry.kind === 'keyboard')?.supportId).toBe('desk');
    expect(repaired.issues.some((issue) => issue.code === 'collision')).toBe(true);
  });

  it('does not promote an ambiguous covering or move its support anchors', () => {
    const base = empty();
    const input = proposal(['desk', 'mat', 'keyboard']);
    input.objects.push({
      ...structuredClone(input.objects.find((entry) => entry.kind === 'mat')!),
      id: 'second-mat',
    });
    const review = buildScenePreview(base, input);
    expect(review.candidates.find((entry) => entry.kind === 'keyboard')?.supportId).toBe('desk');
    for (const candidate of review.candidates.filter(
      (entry) => entry.kind === 'desk' || entry.kind === 'mat',
    )) {
      const current = review.draft.objects.find((entry) => entry.id === candidate.sceneId)!;
      expect(current.placement.x).toBe(candidate.seed!.placement.x);
      expect(current.placement.z).toBe(candidate.seed!.placement.z);
    }
    expect(review.repairSummary?.status).toBe('needs-review');
  });

  it('preserves excluded edits and immutable seeds through repair and restore', () => {
    const base = empty();
    const review = buildScenePreview(base, proposal(['desk', 'keyboard', 'wrist-rest']));
    const candidate = review.candidates.find((entry) => entry.kind === 'wrist-rest')!;
    const excluded = setSceneCandidateIncluded(review, base, candidate.proposalId, false);
    const repaired = repairSceneReview(excluded, base);
    const restored = setSceneCandidateIncluded(repaired, base, candidate.proposalId, true);
    expect(
      restored.candidates.find((entry) => entry.proposalId === candidate.proposalId)?.seed,
    ).toEqual(candidate.seed);
    expect(find(restored.draft, 'wrist-rest')).toEqual(find(review.draft, 'wrist-rest'));
  });

  it('keeps height-only server validation free from bounded placement changes', () => {
    const base = empty();
    const input = proposal(['desk', 'keyboard', 'wrist-rest']);
    const cheap = buildSceneDraft(base, input);
    const preview = buildScenePreview(base, input);
    expect(find(cheap, 'wrist-rest').placement.z).toBe(0.7);
    expect(geometry(cheap)).not.toEqual(geometry(preview.draft));
  });

  it('preserves height-budget explanations after refresh until the user confirms the support', () => {
    const base = empty();
    const input = proposal(['desk', 'keyboard']);
    input.objects.find((entry) => entry.kind === 'keyboard')!.placement.y = 0.3;
    const initial = buildScenePreview(base, input);
    expect(initial.issues).toContainEqual(
      expect.objectContaining({ itemId: 'photo-keyboard', rootCause: 'height-budget' }),
    );
    const refreshed = refreshSceneReview(initial, base);
    expect(refreshed.issues).toContainEqual(
      expect.objectContaining({ itemId: 'photo-keyboard', rootCause: 'height-budget' }),
    );
    expect(refreshed.repairSummary?.unresolved).toEqual(refreshed.issues);
    const confirmed = setSceneCandidateSupport(refreshed, base, 'keyboard', 'photo-desk');
    expect(confirmed.issues).toEqual([]);
  });

  it('does not move locked children when their support changes, and reports the remaining conflict', () => {
    const base = empty();
    let review = buildScenePreview(base, proposal(['desk', 'mat', 'keyboard']));
    const keyboard = review.candidates.find((entry) => entry.kind === 'keyboard')!;
    review = setSceneCandidateLocks(review, base, keyboard.proposalId, { position: true });
    const before = structuredClone(find(review.draft, 'keyboard').placement);
    review = setSceneCandidateSupport(review, base, keyboard.proposalId, 'floor');
    expect(find(review.draft, 'keyboard').placement).toEqual(before);
    expect(
      review.issues.some((issue) => issue.itemId === keyboard.sceneId && issue.code === 'support'),
    ).toBe(true);
    expect(review.issues.some((issue) => /Position is locked/.test(issue.message))).toBe(true);
  });

  it('refits only the changed support subtree and leaves a locked descendant unresolved', () => {
    const base = empty();
    const initial = buildScenePreview(base, proposal(['desk', 'stand', 'laptop', 'keyboard']));
    const keyboardBefore = structuredClone(find(initial.draft, 'keyboard'));
    const changed = setSceneCandidateSupport(initial, base, 'stand', 'floor');
    expect(find(changed.draft, 'keyboard')).toEqual(keyboardBefore);
    expect(getItemBounds(find(changed.draft, 'laptop')).min.y).toBeCloseTo(
      getItemBounds(find(changed.draft, 'laptop-stand')).max.y + 0.001,
      6,
    );
    const locked = setSceneCandidateLocks(initial, base, 'laptop', { position: true });
    const conflict = setSceneCandidateSupport(locked, base, 'stand', 'floor');
    expect(find(conflict.draft, 'laptop').placement).toEqual(
      find(initial.draft, 'laptop').placement,
    );
    expect(
      conflict.issues.some(
        (issue) => issue.itemId === 'photo-laptop' && /locked/.test(issue.message),
      ),
    ).toBe(true);
  });

  it('retains the height implied by a user support choice when automatic changes are reset', () => {
    const base = empty();
    const initial = buildScenePreview(base, proposal(['desk', 'stand', 'laptop']));
    const selected = setSceneCandidateSupport(initial, base, 'laptop', 'floor');
    const reset = revertSceneRepair(selected, base);
    expect(find(reset.draft, 'laptop').placement.y).toBe(
      find(selected.draft, 'laptop').placement.y,
    );
    expect(reset.candidates.find((candidate) => candidate.kind === 'laptop')).toMatchObject({
      supportId: 'floor',
      supportSource: 'user',
      locks: { support: true },
    });
  });

  it('keeps saved user geometry fixed when the bounded search cannot clear it', () => {
    const base = empty();
    const blocker = createSceneObject('generic');
    blocker.id = 'user-obstacle';
    blocker.visual.source = 'user-reported';
    blocker.placement = { x: -0.05, y: 2.49, z: 0.4, rotation: 0 };
    base.objects = [blocker];
    const before = structuredClone(base);
    const review = buildScenePreview(base, proposal(['desk', 'keyboard']));
    expect(review.draft.objects.find((object) => object.id === blocker.id)).toEqual(blocker);
    expect(base).toEqual(before);
    expect(review.repairSummary?.status).toBe('needs-review');
    expect(() => validateSceneReviewForApply(review, base)).toThrow(/placement/);
  });

  it('keeps support references on the observed candidate after rebinding and resetting its seed', () => {
    const base = empty();
    const monitor = structuredClone(
      createDemoWorkspace().devices.find((device) => device.kind === 'monitor')!,
    );
    monitor.source = 'user-reported';
    monitor.visual.source = 'user-reported';
    base.devices = [monitor];
    const observed = item(
      'observed-monitor',
      'monitor',
      { x: 0, y: 0.01, z: 2.8, rotation: 0 },
      undefined,
      'floor',
    );
    observed.deviceId = monitor.id;
    const light = item(
      'light',
      'light-bar',
      { x: 0, y: 1.5, z: 2.8, rotation: 0 },
      undefined,
      monitor.id,
    );
    const initial = buildScenePreview(base, {
      message: 'Stable support references',
      objects: [observed, light],
    });
    const separate = rebindSceneReviewDevice(initial, base, observed.id, null);
    const reset = revertSceneRepair(separate, base);
    const changedMonitor = reset.candidates.find(
      (candidate) => candidate.proposalId === observed.id,
    )!;
    expect(
      sceneReviewSupports(reset.candidates).find((relation) => relation.itemId === 'photo-light')
        ?.surfaceId,
    ).toBe(changedMonitor.sceneId);
    expect(
      reset.candidates.find((candidate) => candidate.proposalId === light.id)?.seed?.supportId,
    ).toBe(monitor.id);
  });
});

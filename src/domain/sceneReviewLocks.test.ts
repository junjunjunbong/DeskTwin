import { describe, expect, it } from 'vitest';
import {
  buildScenePreview,
  type SceneProposalItem,
  validateSceneReviewForApply,
} from './sceneProposal';
import {
  applySceneReviewSupportEdit,
  rebindSceneReviewDevice,
  refreshSceneReview,
  setSceneCandidateIncluded,
  setSceneCandidateLocks,
} from './sceneReview';
import { getItemBounds } from './spatial';
import { applyCommand, createDemoWorkspace, type Workspace } from './workspace';

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

function estimate(
  id: string,
  kind: SceneProposalItem['kind'],
  patch: Partial<SceneProposalItem> = {},
): SceneProposalItem {
  return {
    id,
    kind,
    deviceId: null,
    name: id,
    placement: { x: 0, y: kind === 'desk' ? 0 : 2.51, z: 0, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    supportId: kind === 'desk' ? 'floor' : 'desk',
    color: '#808080',
    parts: [],
    note: '',
    ...patch,
  };
}

function attachedReview() {
  const base = empty();
  const initial = buildScenePreview(base, {
    message: 'Synthetic attachment-lock regression.',
    objects: [estimate('desk', 'desk'), estimate('monitor', 'monitor')],
  });
  const attached = refreshSceneReview(
    initial,
    base,
    applyCommand(initial.draft, {
      type: 'attach-object',
      id: 'photo-monitor',
      parentId: 'photo-desk',
    }),
  );
  return { base, review: attached };
}

describe('review locks during reversible candidate restoration', () => {
  it('keeps locked attached transforms while a matched saved desk is excluded and restored', () => {
    const demo = createDemoWorkspace();
    let base = empty();
    const desk = structuredClone(demo.objects.find((item) => item.kind === 'desk')!);
    desk.visual.source = 'user-reported';
    const monitor = structuredClone(demo.devices.find((item) => item.kind === 'monitor')!);
    monitor.source = 'user-reported';
    monitor.placement = { x: 0, y: 2.51, z: 0, rotation: 0 };
    base.objects = [desk];
    base.devices = [monitor];
    base = applyCommand(base, {
      type: 'attach-object',
      id: monitor.id,
      parentId: desk.id,
    });
    let review = buildScenePreview(base, {
      message: 'Synthetic saved-desk restoration.',
      objects: [
        estimate('desk', 'desk', {
          name: desk.name,
          placement: { x: 0.5, y: 0, z: 0, rotation: 10 },
        }),
        estimate('monitor', 'monitor', {
          name: monitor.name,
          deviceId: monitor.id,
          placement: { x: 0.5, y: 2.51, z: 0, rotation: 10 },
        }),
      ],
    });
    review = setSceneCandidateLocks(review, base, 'monitor', {
      position: true,
      rotation: true,
    });
    const placement = structuredClone(review.draft.devices[0].placement);
    const excluded = setSceneCandidateIncluded(review, base, 'desk', false);
    expect(excluded.draft.devices[0].placement).toEqual(placement);
    expect(excluded.draft.objects[0]).toEqual(base.objects[0]);
    expect(() => validateSceneReviewForApply(excluded, base)).toThrow(/support/);
    const restored = setSceneCandidateIncluded(excluded, base, 'desk', true);
    expect(restored.draft.devices[0].placement).toEqual(placement);
    expect(
      restored.candidates.find((candidate) => candidate.proposalId === 'monitor')?.locks,
    ).toMatchObject({ position: true, rotation: true });
  });

  it.each(['position', 'rotation'] as const)(
    'preserves an excluded child’s independent %s lock when its parent moved',
    (lockedField) => {
      const { base, review: initial } = attachedReview();
      let review = setSceneCandidateLocks(initial, base, 'monitor', {
        position: lockedField === 'position',
        rotation: lockedField === 'rotation',
      });
      const placement = structuredClone(review.draft.devices[0].placement);
      review = setSceneCandidateIncluded(review, base, 'monitor', false);
      review = refreshSceneReview(
        review,
        base,
        applyCommand(review.draft, {
          type: 'update-object',
          id: 'photo-desk',
          patch: { placement: { x: 0.5, rotation: 10 } },
        }),
      );
      const restored = setSceneCandidateIncluded(review, base, 'monitor', true);
      const after = restored.draft.devices[0].placement;
      if (lockedField === 'position') {
        expect({ x: after.x, y: after.y, z: after.z }).toEqual({
          x: placement.x,
          y: placement.y,
          z: placement.z,
        });
        expect(after.rotation).toBeCloseTo(placement.rotation + 10);
      } else {
        expect(after.rotation).toBe(placement.rotation);
        expect(after.x).toBeCloseTo(placement.x + 0.5);
      }
      expect(restored.draft.devices[0].attachment).toEqual({ parentId: 'photo-desk' });
    },
  );

  it('preserves locked placement when a pending attachment resolves after both candidates return', () => {
    const { base, review: initial } = attachedReview();
    let review = setSceneCandidateLocks(initial, base, 'monitor', {
      position: true,
      rotation: true,
    });
    const placement = structuredClone(review.draft.devices[0].placement);
    review = setSceneCandidateIncluded(review, base, 'monitor', false);
    review = refreshSceneReview(
      review,
      base,
      applyCommand(review.draft, {
        type: 'update-object',
        id: 'photo-desk',
        patch: { placement: { x: 0.5, rotation: 10 } },
      }),
    );
    review = setSceneCandidateIncluded(review, base, 'desk', false);
    review = setSceneCandidateIncluded(review, base, 'monitor', true);
    expect(review.draft.devices[0].attachment).toBeNull();
    review = setSceneCandidateIncluded(review, base, 'desk', true);
    expect(review.draft.devices[0].placement).toEqual(placement);
    expect(review.draft.devices[0].attachment).toEqual({ parentId: 'photo-desk' });
  });

  it('keeps automatic adjustment records attached to a candidate after saved-record rebinding', () => {
    const demo = createDemoWorkspace();
    const base = empty();
    const monitor = structuredClone(demo.devices.find((item) => item.kind === 'monitor')!);
    monitor.source = 'user-reported';
    base.devices = [monitor];
    const initial = buildScenePreview(base, {
      message: 'Synthetic saved-record rebinding.',
      objects: [estimate('desk', 'desk'), estimate('monitor', 'monitor', { deviceId: monitor.id })],
    });
    const original = initial.adjustments?.find((adjustment) => adjustment.itemId === monitor.id);
    expect(original).toBeDefined();
    const rebound = rebindSceneReviewDevice(initial, base, 'monitor', null);
    const candidate = rebound.candidates.find((entry) => entry.proposalId === 'monitor')!;
    expect(candidate.sceneId).not.toBe(monitor.id);
    expect(rebound.adjustments).toContainEqual({ ...original, itemId: candidate.sceneId });
    expect(rebound.adjustments?.some((adjustment) => adjustment.itemId === monitor.id)).toBe(false);
    expect(candidate.seed).toEqual(
      initial.candidates.find((entry) => entry.proposalId === 'monitor')?.seed,
    );
  });
});

describe('placing a support parent before validating its descendants', () => {
  function standReview() {
    const base = empty();
    const review = buildScenePreview(
      base,
      {
        message: 'Synthetic parent placement with a thin mat.',
        objects: [
          estimate('desk', 'desk'),
          estimate('mat', 'mat', {
            placement: { x: 2, y: 2.4835, z: -0.1, rotation: 0 },
            scale: { x: 0.7, y: 1, z: 1.5 },
          }),
          estimate('stand', 'laptop-stand', {
            placement: { x: 2, y: 2.4835, z: -0.1, rotation: 0 },
            scale: { x: 0.8, y: 0.8, z: 0.8 },
          }),
          estimate('laptop', 'laptop', {
            placement: { x: 2, y: 2.8128, z: -0.1, rotation: 0 },
            scale: { x: 0.95, y: 0.9, z: 0.95 },
            supportId: 'stand',
          }),
        ],
      },
      { repair: false },
    );
    return { base, review };
  }

  it.each(['snap', 'attach'] as const)(
    'refits a parent’s descendants before rejecting the intermediate %s overlap',
    (operation) => {
      const { base, review } = standReview();
      const command =
        operation === 'snap'
          ? { type: 'snap-object' as const, id: 'photo-stand', surfaceId: 'photo-mat' }
          : { type: 'attach-object' as const, id: 'photo-stand', parentId: 'photo-desk' };
      expect(() => applyCommand(review.draft, command)).toThrow(/intersect|overlap/i);
      const placed = applySceneReviewSupportEdit(review, base, command)!;
      expect(placed).not.toBeNull();
      expect(placed.issues).toEqual([]);
      const stand = placed.draft.objects.find((item) => item.id === 'photo-stand')!;
      const laptop = placed.draft.devices.find((item) => item.id === 'photo-laptop')!;
      expect(getItemBounds(laptop).min.y).toBeCloseTo(getItemBounds(stand).max.y + 0.001, 7);
      expect(placed.candidates.find((item) => item.proposalId === 'stand')).toMatchObject({
        supportId: 'mat',
        supportSource: 'user',
        locks: { support: true, position: true },
      });
      expect(() => validateSceneReviewForApply(placed, base)).not.toThrow();
      if (operation === 'attach') expect(stand.attachment).toEqual({ parentId: 'photo-desk' });
    },
  );

  it('keeps a locked descendant in place and blocks apply when the parent is snapped upward', () => {
    const { base, review } = standReview();
    const locked = setSceneCandidateLocks(review, base, 'laptop', { position: true });
    const original = structuredClone(locked.draft.devices[0].placement);
    const placed = applySceneReviewSupportEdit(locked, base, {
      type: 'snap-object',
      id: 'photo-stand',
      surfaceId: 'photo-mat',
    })!;
    expect(placed.draft.devices[0].placement).toEqual(original);
    expect(placed.issues.some((issue) => issue.rootCause === 'collision')).toBe(true);
    expect(placed.issues.some((issue) => /locked/i.test(issue.message))).toBe(true);
    expect(() => validateSceneReviewForApply(placed, base)).toThrow(/placement/);
  });
});

import { describe, expect, it } from 'vitest';
import { applyCommand, createDemoWorkspace, type Device, type Workspace } from './workspace';
import {
  applySceneDraft,
  buildScenePreview,
  SceneProposalSchema,
  validateSceneReviewForApply,
  type SceneProposalItem,
} from './sceneProposal';
import {
  addSceneReviewCandidate,
  rebindSceneReviewDevice,
  refreshSceneReview,
  sceneReviewSupports,
  setSceneCandidateIncluded,
  setSceneCandidateSupport,
} from './sceneReview';

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

function candidate(patch: Partial<SceneProposalItem> = {}): SceneProposalItem {
  return {
    id: 'observation',
    deviceId: null,
    kind: 'monitor',
    name: 'Photo estimate',
    placement: { x: 0, y: 0.01, z: 2.8, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#445566',
    parts: [],
    note: 'Approximate visual shape.',
    ...patch,
  };
}

function preview(base: Workspace, ...objects: SceneProposalItem[]) {
  return buildScenePreview(base, { message: 'Review visual estimates.', objects });
}

function saved(): Workspace {
  const base = createDemoWorkspace();
  const desk = base.objects.find((item) => item.kind === 'desk')!;
  desk.visual.source = 'user-reported';
  const monitor = base.devices.find((item) => item.kind === 'monitor')!;
  monitor.source = 'user-reported';
  monitor.status = 'reported-working';
  monitor.statusNote = 'User checked this record.';
  monitor.placement = { x: 0, y: 2.51, z: 0, rotation: 0 };
  return {
    ...base,
    devices: [monitor],
    objects: [desk],
    connections: [],
    diagnoses: [],
    history: [],
  };
}

function withAttachedChild() {
  const base = empty();
  const initial = preview(
    base,
    candidate({
      id: 'desk',
      kind: 'desk',
      name: 'Estimated desk',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
    }),
    candidate({
      id: 'monitor',
      supportId: 'desk',
      placement: { x: 0, y: 2.51, z: 0, rotation: 0 },
    }),
  );
  const parent = initial.candidates[0].sceneId;
  const child = initial.candidates[1].sceneId;
  const state = refreshSceneReview(
    initial,
    base,
    applyCommand(initial.draft, {
      type: 'attach-object',
      id: child,
      parentId: parent,
    }),
  );
  return { base, state, parent, child };
}

describe('candidate review metadata and reversible inclusion', () => {
  it('keeps frozen replies compatible and bounds nullable reference-image regions', () => {
    expect(
      SceneProposalSchema.parse({ message: 'Review', objects: [candidate()] }).objects[0]
        .imageRegion,
    ).toBeUndefined();
    expect(
      SceneProposalSchema.parse({
        message: 'Review',
        objects: [candidate({ imageRegion: null, supportId: null })],
      }),
    ).toBeTruthy();
    const region = { x: 0.2, y: 0.1, width: 0.3, height: 0.4 };
    expect(preview(empty(), candidate({ imageRegion: region })).candidates[0].imageRegion).toEqual(
      region,
    );
    for (const imageRegion of [
      { ...region, x: -0.1 },
      { ...region, width: 0 },
      { ...region, x: 0.9 },
      { ...region, height: Infinity },
      { ...region, unknown: true },
    ])
      expect(() =>
        SceneProposalSchema.parse({
          message: 'Review',
          objects: [{ ...candidate(), imageRegion }],
        }),
      ).toThrow();
  });

  it('restores the same new record and all local shape edits across repeated exclusions', () => {
    const base = empty();
    let state = preview(base, candidate());
    const edited = structuredClone(state.draft);
    edited.devices[0].name = 'My reviewed estimate';
    edited.devices[0].visual.scale.x = 0.8;
    edited.devices[0].visual.color = '#112233';
    edited.devices[0].parts = [
      { position: { x: 0, y: 0.2, z: 0 }, size: { x: 0.4, y: 0.4, z: 0.2 }, color: '#112233' },
    ];
    edited.devices[0].shapeMode = 'custom';
    state = refreshSceneReview(state, base, edited);
    const expected = structuredClone(state.draft.devices[0]);
    const frozen = structuredClone(state);
    for (let count = 0; count < 2; count++) {
      state = setSceneCandidateIncluded(state, base, 'observation', false);
      expect(state.draft.devices).toEqual([]);
      expect(state.observations).toEqual([]);
      state = setSceneCandidateIncluded(state, base, 'observation', true);
      expect(state.draft.devices[0]).toEqual(expected);
    }
    expect(frozen.draft.devices[0]).toEqual(expected);
    expect(base.devices).toEqual([]);
  });

  it('restores a matched saved hardware record and leaves reported links untouched', () => {
    const base = saved();
    const other: Device = {
      ...structuredClone(base.devices[0]),
      id: 'other',
      kind: 'laptop',
      name: 'Saved laptop',
      placement: { x: -2, y: 2.51, z: 0, rotation: 0 },
    };
    base.devices.push(other);
    base.connections = [
      {
        id: 'reported-link',
        from: base.devices[0].id,
        to: 'other',
        connector: 'HDMI',
        fromPort: '',
        toPort: '',
        source: 'user-reported',
        note: 'User recorded cable.',
      },
    ];
    let state = preview(
      base,
      candidate({ deviceId: base.devices[0].id, placement: { x: 1, y: 2.51, z: 0, rotation: 0 } }),
    );
    const edited = structuredClone(state.draft);
    edited.devices[0].visual.color = '#abcdef';
    state = refreshSceneReview(state, base, edited);
    const expected = structuredClone(state.draft.devices[0]);
    const excluded = setSceneCandidateIncluded(state, base, 'observation', false);
    expect(excluded.draft.devices.find((item) => item.id === base.devices[0].id)).toEqual(
      base.devices[0],
    );
    expect(excluded.draft.connections).toEqual(base.connections);
    const restored = setSceneCandidateIncluded(excluded, base, 'observation', true);
    expect(restored.draft.devices.find((item) => item.id === base.devices[0].id)).toEqual(expected);
    expect(restored.draft.connections).toEqual(base.connections);
  });

  it('suspends record ambiguity while excluded and requires it again after restoration', () => {
    const base = saved();
    const initial = preview(base, candidate());
    expect(initial.observations[0].needsRecordChoice).toBe(true);
    const excluded = setSceneCandidateIncluded(initial, base, 'observation', false);
    expect(excluded.observations).toEqual([]);
    const included = setSceneCandidateIncluded(excluded, base, 'observation', true);
    expect(included.observations[0].needsRecordChoice).toBe(true);
  });

  it('carries retained attached records back with an excluded matched desk and forward on restore', () => {
    let base = saved();
    base = applyCommand(base, {
      type: 'attach-object',
      id: base.devices[0].id,
      parentId: base.objects[0].id,
    });
    const original = structuredClone(base.devices[0]);
    const initial = preview(
      base,
      candidate({
        id: 'desk-observation',
        kind: 'desk',
        name: base.objects[0].name,
        placement: { x: 0.5, y: 0, z: 0, rotation: 0 },
        scale: { x: 1, y: 1.2, z: 1 },
      }),
    );
    const carried = structuredClone(initial.draft.devices[0]);
    expect(carried.placement.x).toBeCloseTo(0.5);
    const excluded = setSceneCandidateIncluded(initial, base, 'desk-observation', false);
    expect(excluded.draft.objects[0]).toEqual(base.objects[0]);
    expect(excluded.draft.devices[0].placement.x).toBeCloseTo(original.placement.x);
    expect(excluded.draft.devices[0].placement.y).toBeCloseTo(original.placement.y);
    expect(excluded.draft.devices[0].statusNote).toBe(original.statusNote);
    const restored = setSceneCandidateIncluded(excluded, base, 'desk-observation', true);
    expect(restored.draft.devices[0].placement.x).toBeCloseTo(carried.placement.x);
    expect(restored.draft.devices[0].placement.y).toBeCloseTo(carried.placement.y);
  });

  it('keeps dependents in place, reports the missing support, and restores their attachment', () => {
    const { base, state, parent, child } = withAttachedChild();
    const location = structuredClone(state.draft.devices[0].placement);
    const excluded = setSceneCandidateIncluded(state, base, 'desk', false);
    expect(excluded.draft.devices[0].id).toBe(child);
    expect(excluded.draft.devices[0].placement).toEqual(location);
    expect(excluded.draft.devices[0].attachment).toBeNull();
    expect(
      excluded.issues.some((issue) => issue.itemId === child && issue.code === 'support'),
    ).toBe(true);
    expect(() => applySceneDraft(base, base, excluded.draft, undefined, excluded)).toThrow(
      /support/,
    );
    const restored = setSceneCandidateIncluded(excluded, base, 'desk', true);
    expect(restored.draft.devices[0].attachment).toEqual({ parentId: parent });
  });

  it.each([
    [
      ['desk', 'monitor'],
      ['desk', 'monitor'],
    ],
    [
      ['desk', 'monitor'],
      ['monitor', 'desk'],
    ],
    [
      ['monitor', 'desk'],
      ['desk', 'monitor'],
    ],
    [
      ['monitor', 'desk'],
      ['monitor', 'desk'],
    ],
  ])(
    'preserves attachments when exclusion order is %s and restoration order is %s',
    (exclusionOrder, restorationOrder) => {
      const { base, state, parent } = withAttachedChild();
      let next = state;
      for (const id of exclusionOrder) next = setSceneCandidateIncluded(next, base, id, false);
      for (const id of restorationOrder) next = setSceneCandidateIncluded(next, base, id, true);
      expect(next.draft.devices[0].attachment).toEqual({ parentId: parent });
      expect(next.draft.devices[0].placement).toEqual(state.draft.devices[0].placement);
    },
  );

  it('preserves a deliberate detached-child move when its parent is restored', () => {
    const { base, state } = withAttachedChild();
    let next = setSceneCandidateIncluded(state, base, 'desk', false);
    const edited = structuredClone(next.draft);
    edited.devices[0].placement.x = 2;
    next = refreshSceneReview(next, base, edited);
    next = setSceneCandidateIncluded(next, base, 'desk', true);
    expect(next.draft.devices[0].placement.x).toBe(2);
    expect(next.draft.devices[0].attachment).toBeNull();
  });

  it('restores candidate order and keeps the reserved floor reference unambiguous', () => {
    const base = empty();
    const initial = preview(
      base,
      candidate({ id: 'floor', kind: 'mug', supportId: 'floor' }),
      candidate({
        id: 'second',
        kind: 'mug',
        supportId: 'floor',
        placement: { x: 2, y: 0.01, z: 2.8, rotation: 0 },
      }),
    );
    expect(initial.issues).toEqual([]);
    const excluded = setSceneCandidateIncluded(initial, base, 'floor', false);
    const restored = setSceneCandidateIncluded(excluded, base, 'floor', true);
    expect(restored.draft.objects).toEqual(initial.draft.objects);
  });
});

describe('manual additions, record binding and final review guards', () => {
  it('adds manual templates with user provenance and never gives them an operating result', () => {
    const base = empty();
    let state = preview(base, candidate({ kind: 'mug' }));
    state = addSceneReviewCandidate(state, base, {
      kind: 'trackpad',
      name: 'Missing trackpad',
      presetId: 'trackpad-large',
    });
    const added = state.candidates.find((entry) => entry.source === 'user-reported')!;
    const device = state.draft.devices.find((entry) => entry.id === added.sceneId)!;
    expect(device).toMatchObject({
      source: 'user-reported',
      status: 'unknown',
      statusNote: '',
      visual: { source: 'user-reported', scale: { x: 1.25 } },
    });
    expect(added.imageRegion).toBeNull();
    state = setSceneCandidateSupport(state, base, added.proposalId, 'floor');
    expect(state.issues).toEqual([]);
    expect(() => applySceneDraft(base, base, state.draft, undefined, state)).not.toThrow();
    expect(() =>
      addSceneReviewCandidate(state, base, { kind: 'mug', presetId: 'trackpad-large' }),
    ).toThrow(/preset/);
  });

  it('rebinds without erasing original records or edits and remaps direct support references', () => {
    const base = saved();
    let state = preview(
      base,
      candidate({ deviceId: base.devices[0].id }),
      candidate({
        id: 'light',
        kind: 'light-bar',
        supportId: base.devices[0].id,
        placement: { x: 0, y: 4.2, z: 2.8, rotation: 0 },
      }),
    );
    const color = '#fedcba';
    const edited = structuredClone(state.draft);
    edited.devices[0].visual.color = color;
    state = refreshSceneReview(state, base, edited);
    const separate = rebindSceneReviewDevice(state, base, 'observation', null);
    const newId = separate.observations[0].sceneId;
    expect(newId).not.toBe(base.devices[0].id);
    expect(separate.draft.devices.find((item) => item.id === base.devices[0].id)).toEqual(
      base.devices[0],
    );
    expect(separate.draft.devices.find((item) => item.id === newId)?.visual.color).toBe(color);
    expect(
      sceneReviewSupports(separate.candidates).find(
        (relation) => relation.itemId === separate.candidates[1].sceneId,
      )?.surfaceId,
    ).toBe(newId);
    const rebound = rebindSceneReviewDevice(separate, base, 'observation', base.devices[0].id);
    expect(rebound.draft.devices).toHaveLength(1);
    expect(rebound.draft.devices[0].visual.color).toBe(color);
    expect(rebound.draft.devices[0].status).toBe('reported-working');
  });

  it('updates ambiguity and observation kind after a new candidate template changes', () => {
    const base = saved();
    let state = preview(base, candidate({ kind: 'trackpad' }));
    expect(state.observations[0].needsRecordChoice).toBe(false);
    const edited = structuredClone(state.draft);
    edited.devices.find((item) => item.id === state.candidates[0].sceneId)!.kind = 'monitor';
    state = refreshSceneReview(state, base, edited);
    expect(state.observations[0]).toMatchObject({ kind: 'monitor', needsRecordChoice: true });
    expect(state.candidates[0].kind).toBe('monitor');
  });

  it('rechecks missing, cyclic and unresolved support at final confirmation', () => {
    const base = empty();
    const missing = preview(base, candidate({ supportId: 'missing' }));
    expect(() => applySceneDraft(base, base, missing.draft, undefined, missing)).toThrow(/support/);
    const cycle = preview(
      base,
      candidate({ id: 'a', kind: 'mat', supportId: 'b' }),
      candidate({
        id: 'b',
        kind: 'mat',
        supportId: 'a',
        placement: { x: 2, y: 0.01, z: 2.8, rotation: 0 },
      }),
    );
    expect(() => applySceneDraft(base, base, cycle.draft, undefined, cycle)).toThrow(/circular/);
    const clear = preview(base, candidate({ supportId: 'floor' }));
    const modified = structuredClone(clear.draft);
    modified.devices[0].placement.y = 3;
    expect(() => applySceneDraft(base, base, modified, undefined, clear)).toThrow(/resting/);
  });

  it('does not allow a final confirmation to bypass ambiguity, retained data or stale-state guards', () => {
    const base = saved();
    const state = preview(base, candidate());
    expect(() => validateSceneReviewForApply(state, base)).toThrow(/existing or separate/);
    const changed = { ...base, name: 'Newer saved workspace' };
    expect(() => applySceneDraft(changed, base, state.draft, undefined, state)).toThrow(/changed/);
    const excluded = setSceneCandidateIncluded(state, base, 'observation', false);
    const forged = structuredClone(excluded.draft);
    forged.devices = [];
    expect(() => applySceneDraft(base, base, forged, undefined, excluded)).toThrow(/reports/);
    const absent = {
      ...state,
      draft: {
        ...state.draft,
        devices: state.draft.devices.filter((item) => item.id !== state.candidates[0].sceneId),
      },
    };
    expect(() => validateSceneReviewForApply(absent, base)).toThrow(/missing/);
  });

  it('includes retained template changes in final support validation', () => {
    const base = saved();
    base.devices = [];
    const initial = preview(
      base,
      candidate({
        kind: 'generic',
        name: 'Saved prop',
        supportId: base.objects[0].id,
        placement: { x: 0, y: 2.51, z: 0, rotation: 0 },
      }),
    );
    base.objects.push({
      ...initial.draft.objects.find((item) => item.kind === 'generic')!,
      id: 'saved-prop',
      shapeMode: 'template',
    });
    const review = preview(base, candidate({ supportId: 'floor' }));
    const edited = structuredClone(review.draft);
    edited.objects.find((item) => item.id === 'saved-prop')!.kind = 'desk';
    const changed = refreshSceneReview(review, base, edited);
    expect(
      changed.issues.some((issue) => issue.itemId === 'saved-prop' && issue.code === 'support'),
    ).toBe(true);
    expect(() => applySceneDraft(base, base, changed.draft, undefined, changed)).toThrow(
      /support|resting/,
    );
  });

  it('keeps later edits to a retained attached child when a support is fitted again', () => {
    let base = saved();
    base = applyCommand(base, {
      type: 'attach-object',
      id: base.devices[0].id,
      parentId: base.objects[0].id,
    });
    let state = preview(
      base,
      candidate({
        id: 'desk',
        kind: 'desk',
        name: base.objects[0].name,
        placement: { x: 0.5, y: 0, z: 0, rotation: 0 },
      }),
    );
    const edited = applyCommand(state.draft, {
      type: 'update-device',
      id: base.devices[0].id,
      patch: { placement: { x: 1 } },
    });
    state = refreshSceneReview(state, base, edited);
    const before = structuredClone(state.draft.devices[0]);
    state = setSceneCandidateSupport(state, base, 'desk', 'floor');
    expect(state.draft.devices[0].placement).toEqual(before.placement);
    expect(state.draft.devices[0].visual).toEqual(before.visual);
  });
});

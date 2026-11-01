import { beforeAll, describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/photo-scene-19-sanitized.json';
import { repairPhotoJointLayout } from './photoJointRepair';
import { photoAlignmentError } from './photoFitting';
import { photoPlacementSeed } from './photoPlacement';
import { estimatePhotoCamera } from './photoProjection';
import {
  buildScenePreview,
  sceneReviewPlacementIssues,
  sceneReviewSupports,
  validateSceneReviewForApply,
  type ScenePreview,
  type SceneProposal,
  type SceneProposalItem,
} from './sceneProposal';
import {
  autoFitSceneReviewToPhoto,
  rebindSceneReviewDevice,
  refreshSceneReview,
  setSceneCandidateIncluded,
  setSceneCandidateSupport,
  undoScenePhotoFit,
} from './sceneReview';
import { evaluateSceneSupport, getItemBounds, getSceneCollisionPairs } from './spatial';
import { createDemoWorkspace, createSceneObject, type Workspace } from './workspace';

const allItems = (workspace: Workspace) => [...workspace.objects, ...workspace.devices];
const itemIn = (workspace: Workspace, id: string) =>
  allItems(workspace).find((item) => item.id === id)!;
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
const supportMetadata = (state: ScenePreview) =>
  state.candidates.map(({ proposalId, supportId, supportSource }) => ({
    proposalId,
    supportId,
    supportSource,
  }));

function expectSeedBounds(state: ScenePreview) {
  const desk = allItems(state.draft).find((item) => item.kind === 'desk')!;
  const bounds = getItemBounds(desk);
  const maxX = (bounds.max.x - bounds.min.x) * 0.15;
  const maxZ = (bounds.max.z - bounds.min.z) * 0.15;
  for (const candidate of state.candidates.filter((entry) => entry.included)) {
    const item = itemIn(state.draft, candidate.sceneId);
    const seed = candidate.seed!;
    expect(item.visual.scale).toEqual(seed.scale);
    expect(item.placement.rotation).toBe(seed.placement.rotation);
    expect(Math.abs(item.placement.x - seed.placement.x)).toBeLessThanOrEqual(maxX + 1e-8);
    expect(Math.abs(item.placement.y - seed.placement.y)).toBeLessThanOrEqual(0.12 + 1e-8);
    expect(Math.abs(item.placement.z - seed.placement.z)).toBeLessThanOrEqual(maxZ + 1e-8);
  }
}

describe('automatic joint repair of the complete frozen photo scene', () => {
  let base: Workspace;
  let initial: ScenePreview;
  let fitted: ScenePreview;
  beforeAll(() => {
    base = empty();
    initial = buildScenePreview(base, fixture.proposal);
    fitted = autoFitSceneReviewToPhoto(initial, base, 4 / 3);
  }, 120_000);

  it('keeps all 19 objects and solves geometry through the real automatic path with one frozen camera', () => {
    expect(initial.candidates).toHaveLength(19);
    expect(fitted.candidates).toHaveLength(19);
    expect(fitted.candidates.every((candidate) => candidate.included)).toBe(true);
    expect(
      allItems(fitted.draft)
        .map((item) => item.id)
        .sort(),
    ).toEqual(
      allItems(initial.draft)
        .map((item) => item.id)
        .sort(),
    );
    expect(getSceneCollisionPairs(fitted.draft, base)).toEqual([]);
    expect(getSceneCollisionPairs(fitted.draft, initial.draft)).toEqual([]);
    expect(fitted.issues).toEqual([]);
    expect(() => validateSceneReviewForApply(fitted, base)).not.toThrow();
    expectSeedBounds(fitted);
    expect(fitted.candidates.map((candidate) => candidate.seed)).toEqual(
      initial.candidates.map((candidate) => candidate.seed),
    );
    const desk = initial.candidates.find((candidate) => candidate.kind === 'desk')!;
    expect(itemIn(fitted.draft, desk.sceneId)).toEqual(itemIn(initial.draft, desk.sceneId));
    const observed = initial.candidates.filter(
      (candidate) => candidate.included && candidate.kind !== 'desk' && candidate.imageRegion,
    );
    const camera = estimatePhotoCamera(
      initial.draft,
      observed.map((candidate) => ({ sceneId: candidate.sceneId, region: candidate.imageRegion! })),
      4 / 3,
    ).camera;
    expect(fitted.photoAlignment!.camera).toEqual(camera);
    expect(fitted.photoAlignment!.beforeDraft).toEqual(initial.draft);
    expect(fitted.photoAlignment!.beforeError).toBeCloseTo(
      photoAlignmentError(initial.draft, observed, camera),
      12,
    );
    expect(fitted.photoAlignment!.afterError).toBeCloseTo(
      photoAlignmentError(fitted.draft, observed, camera),
      12,
    );
    expect(fitted.photoAlignment!.afterError).toBeLessThan(fitted.photoAlignment!.beforeError);
  });

  it('repeats without accumulating movement and undoes both support choices and geometry', () => {
    const original = structuredClone({ base, initial, fitted });
    const repeated = autoFitSceneReviewToPhoto(fitted, base, 4 / 3);
    expect(repeated.draft).toEqual(fitted.draft);
    expect(supportMetadata(repeated)).toEqual(supportMetadata(fitted));
    const undone = undoScenePhotoFit(repeated, base);
    expect(undone.draft).toEqual(initial.draft);
    expect(supportMetadata(undone)).toEqual(supportMetadata(initial));
    expect(undone.photoAlignment).toBeUndefined();
    const reapplied = autoFitSceneReviewToPhoto(undone, base, 4 / 3);
    expect(reapplied.draft).toEqual(fitted.draft);
    expect(supportMetadata(reapplied)).toEqual(supportMetadata(fitted));
    expect({ base, initial, fitted }).toEqual(original);
  }, 120_000);

  it.each(['mug', 'monitor-riser'] as const)(
    'restores the pre-fit %s relationship and geometry after exclusion, refitting and undo',
    (kind) => {
      const candidate = fitted.candidates.find((entry) => entry.kind === kind)!;
      const before = initial.candidates.find((entry) => entry.proposalId === candidate.proposalId)!;
      const excluded = setSceneCandidateIncluded(fitted, base, candidate.proposalId, false);
      const repeated = autoFitSceneReviewToPhoto(excluded, base, 4 / 3);
      const undone = undoScenePhotoFit(repeated, base);
      const restored = setSceneCandidateIncluded(undone, base, candidate.proposalId, true);
      const after = restored.candidates.find((entry) => entry.proposalId === candidate.proposalId)!;
      expect(after.supportId).toBe(before.supportId);
      expect(after.supportSource).toBe(before.supportSource);
      expect(itemIn(restored.draft, after.sceneId).placement).toEqual(
        itemIn(initial.draft, before.sceneId).placement,
      );
      expect(itemIn(restored.draft, after.sceneId).visual.scale).toEqual(before.seed!.scale);
      expect(allItems(restored.draft)).toHaveLength(19);
      expect(restored.candidates.every((entry) => entry.included)).toBe(true);
      expect(
        sceneReviewSupports(restored.candidates).some((relation) =>
          relation.surfaceId.startsWith('excluded-'),
        ),
      ).toBe(false);
    },
    120_000,
  );

  it('preserves a later explicit support choice and position lock through retry and undo', () => {
    const mug = fitted.candidates.find((candidate) => candidate.kind === 'mug')!;
    const desk = fitted.candidates.find((candidate) => candidate.kind === 'desk')!;
    const chosen = setSceneCandidateSupport(fitted, base, mug.proposalId, desk.sceneId);
    const editedDraft = structuredClone(chosen.draft);
    itemIn(editedDraft, mug.sceneId).placement.x += 0.07;
    const edited = refreshSceneReview(chosen, base, editedDraft);
    const expected = structuredClone(itemIn(edited.draft, mug.sceneId));
    const repeated = autoFitSceneReviewToPhoto(edited, base, 4 / 3);
    const undone = undoScenePhotoFit(repeated, base);
    const candidate = undone.candidates.find((entry) => entry.proposalId === mug.proposalId)!;
    expect(candidate.supportId).toBe(desk.proposalId);
    expect(candidate.supportSource).toBe('user');
    expect(candidate.locks).toMatchObject({ support: true, position: true });
    expect(itemIn(undone.draft, candidate.sceneId)).toEqual(expected);
    expect(candidate.seed).toEqual(mug.seed);
  }, 120_000);

  it('keeps support references on proposal identity after binding a fitted monitor to a saved record', () => {
    const candidate = fitted.candidates.find((entry) => entry.kind === 'monitor')!;
    const original = initial.candidates.find((entry) => entry.proposalId === candidate.proposalId)!;
    const current = fitted.draft.devices.find((device) => device.id === candidate.sceneId)!;
    const saved = {
      ...structuredClone(current),
      id: 'saved-user-display',
      name: 'Display with a preserved report',
      source: 'user-reported' as const,
      status: 'reported-working' as const,
      statusNote: 'The user checked this display before the photo review.',
      placement: { x: 3, y: 0.001, z: 2.5, rotation: 0 },
    };
    const savedBase = { ...structuredClone(base), devices: [saved] };
    const withRecord = structuredClone(fitted);
    withRecord.draft.devices.push(structuredClone(saved));
    const rebound = rebindSceneReviewDevice(withRecord, savedBase, candidate.proposalId, saved.id);
    const repeated = autoFitSceneReviewToPhoto(rebound, savedBase, 4 / 3);
    const undone = undoScenePhotoFit(repeated, savedBase);
    const restored = undone.draft.devices.find((device) => device.id === saved.id)!;
    expect(restored.status).toBe(saved.status);
    expect(restored.statusNote).toBe(saved.statusNote);
    expect(restored.placement).toEqual(itemIn(initial.draft, original.sceneId).placement);
    const after = undone.candidates.find((entry) => entry.proposalId === candidate.proposalId)!;
    expect(after.matchedSceneId).toBe(saved.id);
    expect(after.supportId).toBe(original.supportId);
    expect(after.seed).toEqual(original.seed);
    const child = undone.candidates.find((entry) => entry.supportId === candidate.proposalId)!;
    expect(child).toBeDefined();
    expect(sceneReviewSupports(undone.candidates)).toContainEqual(
      expect.objectContaining({ itemId: child.sceneId, surfaceId: saved.id }),
    );
    expect(savedBase.devices[0]).toEqual(saved);
  }, 120_000);
});

function proposalItem(
  id: string,
  kind: SceneProposalItem['kind'],
  x: number,
  z: number,
  supportId: string | null = 'surface',
): SceneProposalItem {
  return {
    id,
    kind,
    name: id,
    deviceId: null,
    placement: { x, y: kind === 'desk' ? 0 : 2.4835, z, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#808080',
    parts: [],
    note: 'Independent synthetic geometry, not a photo measurement.',
    supportId,
    imageRegion: null,
  };
}
function partialCovering(ambiguous = false) {
  const base = empty();
  const proposal: SceneProposal = {
    message: 'Independent partial thin covering example.',
    objects: [
      proposalItem('surface', 'desk', 0, 0, 'floor'),
      proposalItem('cover', 'mat', 0, 0),
      ...(ambiguous ? [proposalItem('second-cover', 'mat', 0, 0)] : []),
      proposalItem('cup', 'mug', 1.5, 0),
    ],
  };
  const state = buildScenePreview(base, proposal);
  return { base, state };
}

describe('joint repair beyond the full-scene fixture', () => {
  it('jointly separates rotated siblings within budgets that cannot clear either child alone', () => {
    const base = empty();
    const draft = structuredClone(base);
    const desk = { ...createSceneObject('desk'), id: 'surface' };
    const riser = { ...createSceneObject('monitor-riser'), id: 'bridge' };
    riser.placement.rotation = 22;
    const side = 0.45;
    const children = ['left-block', 'right-block'].map((id) => ({
      ...createSceneObject('generic'),
      id,
      shapeMode: 'custom' as const,
      placement: { x: 0, y: 0, z: 0, rotation: 22 },
      parts: [
        {
          position: { x: 0, y: side / 2, z: 0 },
          size: { x: side, y: side, z: side },
          color: '#808080',
        },
      ],
    }));
    draft.objects = [desk, riser, ...children];
    riser.placement.y += evaluateSceneSupport(draft, riser.id, desk.id).heightDelta;
    for (const child of children)
      child.placement.y += evaluateSceneSupport(draft, child.id, riser.id).heightDelta;
    const state: ScenePreview = {
      draft,
      candidates: draft.objects.map((item) => {
        const supportId = item.id === desk.id ? 'floor' : item.id === riser.id ? desk.id : riser.id;
        return {
          proposalId: item.id,
          sceneId: item.id,
          kind: item.kind,
          proposedName: item.name,
          included: true,
          source: 'photo-inferred' as const,
          matchedSceneId: null,
          imageRegion: null,
          supportId,
          supportSource: 'model' as const,
          seed: photoPlacementSeed(item, supportId),
          locks: { position: item.id === desk.id || item.id === riser.id },
        };
      }),
      observations: [],
      issues: [],
    };
    state.issues = sceneReviewPlacementIssues(base, draft, state);
    expect(state.issues.every((issue) => issue.code === 'collision')).toBe(true);
    expect(getSceneCollisionPairs(draft, base).map((pair) => pair.itemIds)).toEqual([
      ['left-block', 'right-block'],
    ]);
    const bounds = getItemBounds(desk);
    const maxX = side * 0.6;
    const fraction = maxX / (bounds.max.x - bounds.min.x);
    const maxZ = (bounds.max.z - bounds.min.z) * fraction;
    // Even either child's extreme allowed corners leave this pair intersecting.
    // A rigid parent/subtree translation also preserves their relative overlap.
    for (const x of [-maxX, maxX])
      for (const z of [-maxZ, maxZ]) {
        const alone = structuredClone(draft);
        Object.assign(itemIn(alone, children[0].id).placement, { x, z });
        expect(
          getSceneCollisionPairs(alone, base).some(
            (pair) =>
              pair.itemIds.includes(children[0].id) && pair.itemIds.includes(children[1].id),
          ),
        ).toBe(true);
      }
    const repaired = repairPhotoJointLayout(base, draft, state.candidates, {
      maxPositionFraction: fraction,
    });
    expect(repaired.summary.status).toBe('ready');
    expect(getSceneCollisionPairs(repaired.draft, base)).toEqual([]);
    expect(getSceneCollisionPairs(repaired.draft, draft)).toEqual([]);
    expect(() => validateSceneReviewForApply({ ...state, ...repaired }, base)).not.toThrow();
    expect(itemIn(repaired.draft, riser.id)).toEqual(riser);
    for (const child of children) {
      const result = itemIn(repaired.draft, child.id);
      const contact = evaluateSceneSupport(repaired.draft, child.id, riser.id);
      expect(contact.resting && contact.footprintValid).toBe(true);
      expect(Math.abs(result.placement.x)).toBeGreaterThan(1e-5);
      expect(Math.abs(result.placement.z)).toBeGreaterThan(1e-5);
      expect(Math.abs(result.placement.x)).toBeLessThanOrEqual(maxX + 1e-8);
      expect(Math.abs(result.placement.z)).toBeLessThanOrEqual(maxZ + 1e-8);
    }
    expectSeedBounds({ ...state, ...repaired });
    expect(supportMetadata({ ...state, ...repaired })).toEqual(supportMetadata(state));
  });

  it('uses an existing valid partial mat support without changing its seed or collision policy', () => {
    const { base, state } = partialCovering();
    const before = structuredClone(state);
    const cup = state.candidates.find((candidate) => candidate.kind === 'mug')!;
    const cover = state.candidates.find((candidate) => candidate.kind === 'mat')!;
    expect(cup.supportId).toBe('surface');
    expect(getSceneCollisionPairs(state.draft, base)).not.toEqual([]);
    expect(evaluateSceneSupport(state.draft, cup.sceneId, cover.sceneId).footprintValid).toBe(true);
    const repaired = repairPhotoJointLayout(base, state.draft, state.candidates);
    const result = repaired.candidates.find(
      (candidate) => candidate.proposalId === cup.proposalId,
    )!;
    expect(result.supportId).toBe(cover.proposalId);
    expect(result.supportSource).toBe('geometry');
    expect(result.seed).toEqual(cup.seed);
    expect(getSceneCollisionPairs(repaired.draft, base)).toEqual([]);
    expect(getSceneCollisionPairs(repaired.draft, state.draft)).toEqual([]);
    expect(() => validateSceneReviewForApply({ ...state, ...repaired }, base)).not.toThrow();
    expectSeedBounds({ ...state, ...repaired });
    expect(state).toEqual(before);
  });

  it('does not pick an arbitrary mat when two fixed coverings support the same contact', () => {
    const { base, state } = partialCovering(true);
    state.candidates = state.candidates.map((candidate) => ({
      ...candidate,
      locks: { ...candidate.locks, position: candidate.kind !== 'mug' },
    }));
    const cup = state.candidates.find((candidate) => candidate.kind === 'mug')!;
    const repaired = repairPhotoJointLayout(base, state.draft, state.candidates);
    const result = repaired.candidates.find(
      (candidate) => candidate.proposalId === cup.proposalId,
    )!;
    expect(result.supportId).toBe(cup.supportId);
    expect(result.supportSource).toBe(cup.supportSource);
    for (const cover of state.candidates.filter((candidate) => candidate.kind === 'mat'))
      expect(itemIn(repaired.draft, cover.sceneId)).toEqual(itemIn(state.draft, cover.sceneId));
    expect(getSceneCollisionPairs(repaired.draft, state.draft)).toEqual([]);
    expect(repaired.summary.status).toBe('needs-review');
  });

  it.each(['locked', 'user-selected'] as const)(
    'keeps a %s support even when the item remains free to move',
    (mode) => {
      const { base, state } = partialCovering();
      state.candidates = state.candidates.map((candidate) => ({
        ...candidate,
        locks: {
          ...candidate.locks,
          position: candidate.kind !== 'mug',
          support: candidate.kind === 'mug' && mode === 'locked',
        },
        ...(candidate.kind === 'mug' && mode === 'user-selected'
          ? { supportSource: 'user' as const }
          : {}),
      }));
      const cup = state.candidates.find((candidate) => candidate.kind === 'mug')!;
      const repaired = repairPhotoJointLayout(base, state.draft, state.candidates);
      const result = repaired.candidates.find(
        (candidate) => candidate.proposalId === cup.proposalId,
      )!;
      expect(result.supportId).toBe(cup.supportId);
      expect(result.supportSource).toBe(cup.supportSource);
      expect(result.seed).toEqual(cup.seed);
      expect(getSceneCollisionPairs(repaired.draft, state.draft)).toEqual([]);
      expectSeedBounds({ ...state, ...repaired });
    },
  );

  it.each(['locked', 'user-selected'] as const)(
    'preserves a %s support together with geometry locks and saved records',
    (mode) => {
      const { base, state } = partialCovering();
      const saved = createDemoWorkspace().devices.find((device) => device.kind === 'monitor')!;
      saved.id = 'unchanged-saved-record';
      saved.source = 'user-reported';
      saved.status = 'reported-working';
      saved.statusNote = 'Preserve the operating report.';
      saved.placement = { x: -3, y: 0.001, z: 2.5, rotation: 12 };
      base.devices.push(structuredClone(saved));
      state.draft.devices.push(structuredClone(saved));
      state.candidates = state.candidates.map((candidate) => ({
        ...candidate,
        locks: { position: true, rotation: true, scale: true, support: mode === 'locked' },
        ...(candidate.kind === 'mug' && mode === 'user-selected'
          ? { supportSource: 'user' as const }
          : {}),
      }));
      const before = structuredClone({ base, state });
      const repaired = repairPhotoJointLayout(base, state.draft, state.candidates);
      expect(repaired.draft).toEqual(state.draft);
      expect(repaired.candidates).toEqual(state.candidates);
      expect(itemIn(repaired.draft, saved.id)).toEqual(saved);
      expect({ base, state }).toEqual(before);
    },
  );

  it('does not move an already-valid scene or mutate it when the search budget is zero', () => {
    const { base, state } = partialCovering();
    const untouched = repairPhotoJointLayout(base, state.draft, state.candidates, {
      maxEvaluations: 0,
    });
    expect(untouched.draft).toEqual(state.draft);
    expect(untouched.candidates).toEqual(state.candidates);
    const proposal: SceneProposal = {
      message: 'Already-valid independent scene.',
      objects: [
        proposalItem('surface', 'desk', 0, 0, 'floor'),
        proposalItem('cup', 'mug', 0.4, 0.2),
      ],
    };
    const clear = buildScenePreview(base, proposal);
    expect(clear.issues).toEqual([]);
    const repaired = repairPhotoJointLayout(base, clear.draft, clear.candidates);
    expect(repaired.draft).toEqual(clear.draft);
    expect(repaired.candidates).toEqual(clear.candidates);
    expect(repaired.summary.evaluations).toBe(0);
  });
});

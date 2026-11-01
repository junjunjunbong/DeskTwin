import { PerspectiveCamera, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { fitPhotoLayout } from './photoFitting';
import { projectPhotoItem, type PhotoCamera, type PhotoReference } from './photoProjection';
import {
  buildScenePreview,
  sceneReviewSupports,
  type ScenePreview,
  type SceneProposalItem,
} from './sceneProposal';
import {
  fitSceneReviewToPhoto,
  refreshSceneReview,
  revertSceneRepair,
  setSceneCandidateIncluded,
  setSceneCandidateLocks,
  undoScenePhotoFit,
} from './sceneReview';
import { evaluateSceneSupport } from './spatial';
import { createDemoWorkspace, type Workspace } from './workspace';

const itemIn = (workspace: Workspace, id: string) =>
  [...workspace.objects, ...workspace.devices].find((item) => item.id === id)!;
const candidateIn = (state: ScenePreview, proposalId: string) =>
  state.candidates.find((candidate) => candidate.proposalId === proposalId)!;

function fixture() {
  const base: Workspace = {
    ...createDemoWorkspace(),
    objects: [],
    devices: [],
    connections: [],
    diagnoses: [],
    history: [],
  };
  const item = (id: string, kind: SceneProposalItem['kind'], x: number): SceneProposalItem => ({
    id,
    kind,
    name: id,
    deviceId: null,
    placement: { x, y: kind === 'desk' ? 0 : 2.4835, z: 0, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#808080',
    parts: [],
    note: 'Synthetic contact geometry for support snapshot regression.',
    supportId: kind === 'desk' ? 'floor' : 'table',
    imageRegion: null,
  });
  const state = buildScenePreview(base, {
    message: 'An independently generated partial covering and cup.',
    objects: [item('table', 'desk', 0), item('cover', 'mat', 0), item('cup', 'mug', 1.5)],
  });
  const camera: PhotoCamera = {
    position: { x: 3, y: 8, z: 10 },
    target: { x: 0, y: 2.4, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    fov: 45,
    aspect: 4 / 3,
  };
  const cup = candidateIn(state, 'cup');
  const cover = candidateIn(state, 'cover');
  const target = structuredClone(itemIn(state.draft, cup.sceneId));
  target.placement.y += evaluateSceneSupport(state.draft, cup.sceneId, cover.sceneId).heightDelta;
  cup.imageAnchor = projectPhotoItem(target, camera)!.contact;
  const view = new PerspectiveCamera(camera.fov, camera.aspect, 0.01, 1000);
  view.position.set(camera.position.x, camera.position.y, camera.position.z);
  view.lookAt(camera.target.x, camera.target.y, camera.target.z);
  view.updateMatrixWorld(true);
  const names = ['backLeft', 'backRight', 'frontRight', 'frontLeft'] as const;
  const points = [
    [-3.71, -1.58],
    [3.71, -1.58],
    [3.71, 1.58],
    [-3.71, 1.58],
  ].map(([x, z]) => {
    const projected = new Vector3(x, 2.4835, z).project(view);
    return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
  });
  const reference: PhotoReference = {
    objectId: candidateIn(state, 'table').sceneId,
    corners: Object.fromEntries(
      names.map((name, index) => [name, points[index]]),
    ) as PhotoReference['corners'],
    aspect: camera.aspect,
    fov: camera.fov,
    source: 'model',
  };
  return { base, state, reference, camera };
}

describe('photo support snapshots with later position locks', () => {
  let base: Workspace;
  let original: ScenePreview;
  let fitted: ScenePreview;
  let reference: PhotoReference;
  beforeAll(() => {
    const input = fixture();
    base = input.base;
    original = input.state;
    reference = input.reference;
    fitted = fitSceneReviewToPhoto(original, base, reference);
    expect(candidateIn(original, 'cup').supportId).toBe('table');
    expect(candidateIn(fitted, 'cup').supportId).toBe('cover');
    expect(candidateIn(fitted, 'cup').supportSource).toBe('geometry');
  });

  function expectLockedCup(state: ScenePreview) {
    const cup = candidateIn(state, 'cup');
    expect(cup.locks?.position).toBe(true);
    expect(cup.supportId).toBe('cover');
    expect(cup.supportSource).toBe('geometry');
    expect(cup.seed).toEqual(candidateIn(original, 'cup').seed);
    expect(sceneReviewSupports(state.candidates)).toContainEqual({
      itemId: cup.sceneId,
      surfaceId: candidateIn(state, 'cover').sceneId,
      source: 'geometry',
    });
    expect(itemIn(state.draft, cup.sceneId).placement).toEqual(
      itemIn(fitted.draft, cup.sceneId).placement,
    );
    expect(
      evaluateSceneSupport(state.draft, cup.sceneId, candidateIn(state, 'cover').sceneId).resting,
    ).toBe(true);
    expect(state.issues.filter((issue) => issue.itemId === cup.sceneId)).toEqual([]);
  }

  it('retains the support whose fitted height has become position locked when undoing', () => {
    const locked = setSceneCandidateLocks(fitted, base, 'cup', { position: true });
    const undone = undoScenePhotoFit(locked, base);
    expectLockedCup(undone);
    expect(undone.photoAlignment).toBeUndefined();
  });

  it('retains locked contact metadata when retrying from photo snapshots', () => {
    const locked = setSceneCandidateLocks(fitted, base, 'cup', { position: true });
    const repeated = fitSceneReviewToPhoto(locked, base, reference);
    expectLockedCup(repeated);
    expectLockedCup(undoScenePhotoFit(repeated, base));
  });

  it('retains the same locked relation while the child is excluded, undone and restored', () => {
    const locked = setSceneCandidateLocks(fitted, base, 'cup', { position: true });
    const excluded = setSceneCandidateIncluded(locked, base, 'cup', false);
    const undone = undoScenePhotoFit(excluded, base);
    const restored = setSceneCandidateIncluded(undone, base, 'cup', true);
    expectLockedCup(restored);
  });

  it.each([false, true])(
    'preserves locked contact when reverting all automatic adjustments (excluded: %s)',
    (exclude) => {
      const locked = setSceneCandidateLocks(fitted, base, 'cup', { position: true });
      const input = exclude ? setSceneCandidateIncluded(locked, base, 'cup', false) : locked;
      const reverted = revertSceneRepair(input, base);
      const restored = exclude ? setSceneCandidateIncluded(reverted, base, 'cup', true) : reverted;
      expectLockedCup(restored);
      expect(restored.photoAlignment).toBeUndefined();
      expect(restored.repairSummary).toBeUndefined();
      expect(restored.adjustments).toEqual([]);
    },
  );

  const undoActions = [
    { action: 'photo fitting', undo: undoScenePhotoFit },
    { action: 'all automatic adjustments', undo: revertSceneRepair },
  ];

  it.each(
    undoActions.flatMap((action) => [false, true].map((excluded) => ({ ...action, excluded }))),
  )(
    'retains a moved support needed by its position-locked child when undoing $action (excluded: $excluded)',
    ({ undo, excluded }) => {
      const input = fixture();
      const cup = candidateIn(input.state, 'cup');
      const cover = candidateIn(input.state, 'cover');
      const desiredCover = structuredClone(itemIn(input.state.draft, cover.sceneId));
      desiredCover.placement.x += 0.4;
      cover.imageAnchor = projectPhotoItem(desiredCover, input.camera)!.contact;
      const desiredCup = structuredClone(itemIn(input.state.draft, cup.sceneId));
      desiredCup.placement.x += 0.4;
      desiredCup.placement.y += evaluateSceneSupport(
        input.state.draft,
        cup.sceneId,
        cover.sceneId,
      ).heightDelta;
      cup.imageAnchor = projectPhotoItem(desiredCup, input.camera)!.contact;
      const aligned = fitSceneReviewToPhoto(input.state, input.base, input.reference);
      const locked = setSceneCandidateLocks(aligned, input.base, 'cup', { position: true });
      expect(itemIn(aligned.draft, cover.sceneId).placement.x).toBeGreaterThan(0.3);
      expect(evaluateSceneSupport(aligned.draft, cup.sceneId, cover.sceneId)).toMatchObject({
        footprintValid: true,
        resting: true,
      });
      const repeated = fitSceneReviewToPhoto(locked, input.base, input.reference);
      const repeatedAgain = fitSceneReviewToPhoto(repeated, input.base, input.reference);
      expect(repeatedAgain.draft).toEqual(repeated.draft);
      expect(sceneReviewSupports(repeatedAgain.candidates)).toEqual(
        sceneReviewSupports(repeated.candidates),
      );
      for (const retried of [repeated, repeatedAgain]) {
        expect(itemIn(retried.draft, cup.sceneId).placement).toEqual(
          itemIn(locked.draft, cup.sceneId).placement,
        );
        expect(evaluateSceneSupport(retried.draft, cup.sceneId, cover.sceneId)).toMatchObject({
          footprintValid: true,
          resting: true,
        });
        expect(candidateIn(retried, 'cup').seed).toEqual(cup.seed);
      }
      const undoInput = excluded
        ? setSceneCandidateIncluded(locked, input.base, 'cup', false)
        : locked;
      const undone = undo(undoInput, input.base);
      const restored = excluded
        ? setSceneCandidateIncluded(undone, input.base, 'cup', true)
        : undone;
      const afterCup = candidateIn(restored, 'cup');
      expect(afterCup.locks?.position).toBe(true);
      expect(afterCup.seed).toEqual(cup.seed);
      expect(afterCup.supportId).toBe('cover');
      expect(itemIn(restored.draft, cup.sceneId).placement).toEqual(
        itemIn(locked.draft, cup.sceneId).placement,
      );
      expect(evaluateSceneSupport(restored.draft, cup.sceneId, cover.sceneId)).toMatchObject({
        footprintValid: true,
        resting: true,
      });
      expect(sceneReviewSupports(restored.candidates)).toContainEqual({
        itemId: cup.sceneId,
        surfaceId: cover.sceneId,
        source: 'geometry',
      });
      expect(restored.issues.filter((issue) => issue.itemId === cup.sceneId)).toEqual([]);
    },
  );

  it.each(undoActions)('preserves a later user support height when undoing $action', ({ undo }) => {
    const cover = candidateIn(fitted, 'cover');
    const table = candidateIn(fitted, 'table');
    const editedDraft = structuredClone(fitted.draft);
    itemIn(editedDraft, table.sceneId).placement.y += 0.04;
    const edited = refreshSceneReview(fitted, base, editedDraft, {
      userEditedIds: [table.sceneId],
    });
    const editedCup = candidateIn(edited, 'cup');
    expect(editedCup.locks?.position).not.toBe(true);
    expect(editedCup.heightReference?.source).toBe('user');
    const undone = undo(edited, base);
    const cup = candidateIn(undone, 'cup');
    expect(cup.supportId).toBe('cover');
    expect(itemIn(undone.draft, cup.sceneId).placement.y).toBe(
      itemIn(edited.draft, editedCup.sceneId).placement.y,
    );
    expect(evaluateSceneSupport(undone.draft, cup.sceneId, cover.sceneId).resting).toBe(true);
    expect(cup.seed).toEqual(candidateIn(original, 'cup').seed);
    expect(sceneReviewSupports(undone.candidates)).toContainEqual({
      itemId: cup.sceneId,
      surfaceId: cover.sceneId,
      source: 'geometry',
    });
    expect(candidateIn(undone, 'table').locks?.position).toBe(true);
  });

  it.each(undoActions)(
    'undoes later automatic changes over an existing user height reference when undoing $action',
    ({ undo }) => {
      const table = candidateIn(original, 'table');
      const editedDraft = structuredClone(original.draft);
      itemIn(editedDraft, table.sceneId).placement.y += 0.04;
      const edited = refreshSceneReview(original, base, editedDraft, {
        userEditedIds: [table.sceneId],
      });
      const beforeCup = candidateIn(edited, 'cup');
      expect(beforeCup.heightReference?.source).toBe('user');
      const afterFit = fitSceneReviewToPhoto(edited, base, reference);
      expect(candidateIn(afterFit, 'cup').supportId).toBe('cover');
      const undone = undo(afterFit, base);
      const cup = candidateIn(undone, 'cup');
      expect(cup.supportId).toBe(beforeCup.supportId);
      expect(cup.supportSource).toBe(beforeCup.supportSource);
      expect(itemIn(undone.draft, cup.sceneId).placement).toEqual(
        itemIn(edited.draft, beforeCup.sceneId).placement,
      );
      expect(itemIn(undone.draft, table.sceneId)).toEqual(itemIn(edited.draft, table.sceneId));
      expect(cup.heightReference).toEqual(beforeCup.heightReference);
      expect(cup.seed).toEqual(beforeCup.seed);
      expect(evaluateSceneSupport(undone.draft, cup.sceneId, table.sceneId).resting).toBe(true);
      expect(sceneReviewSupports(undone.candidates)).toContainEqual({
        itemId: cup.sceneId,
        surfaceId: table.sceneId,
        source: beforeCup.supportSource ?? 'model',
      });
      expect(candidateIn(undone, 'table').locks?.position).toBe(true);
    },
  );

  it('rejects a fitting policy that expands the cumulative X/Z budget beyond 15%', () => {
    expect(() =>
      fitPhotoLayout(base, original.draft, original.candidates, reference, {
        maxPositionFraction: 0.151,
      }),
    ).toThrow(/supported preview search limits/);
  });
});

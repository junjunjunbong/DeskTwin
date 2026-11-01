import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getGeometryParts } from './geometry';
import { buildScenePreview, SceneProposalSchema, type SceneProposal } from './sceneProposal';
import { fitPhotoLayout, photoAlignmentError } from './photoFitting';
import {
  fitSceneReviewToPhoto,
  autoFitSceneReviewToPhoto,
  refreshSceneReview,
  undoScenePhotoFit,
  setSceneCandidateLocks,
  setSceneCandidateIncluded,
  rebindSceneReviewDevice,
} from './sceneReview';
import { getSceneCollisionPairs, evaluateSceneSupport } from './spatial';
import type { PhotoReference } from './photoProjection';
import { createDemoWorkspace, createSceneObject, type Device, type SceneObject } from './workspace';

const names = ['backLeft', 'backRight', 'frontRight', 'frontLeft'] as const;
const view = new PerspectiveCamera(45, 5 / 3, 0.01, 1000);
view.position.set(3, 8, 10);
view.lookAt(0, 2.4, 0);
view.updateMatrixWorld(true);
const project = (point: Vector3) => {
  const p = point.clone().project(view);
  return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
};
function observedRegion(item: Device | SceneObject) {
  const points = getGeometryParts(item).flatMap((part) => {
    const rotation = part.rotation ?? { x: 0, y: 0, z: 0 };
    return [-1, 1].flatMap((x) =>
      [-1, 1].flatMap((y) =>
        [-1, 1].map((z) =>
          project(
            new Vector3((x * part.size.x) / 2, (y * part.size.y) / 2, (z * part.size.z) / 2)
              .applyEuler(
                new Euler(
                  (rotation.x * Math.PI) / 180,
                  (rotation.y * Math.PI) / 180,
                  (rotation.z * Math.PI) / 180,
                  'XYZ',
                ),
              )
              .add(new Vector3(part.position.x, part.position.y, part.position.z))
              .multiply(new Vector3(item.visual.scale.x, item.visual.scale.y, item.visual.scale.z))
              .applyAxisAngle(new Vector3(0, 1, 0), (item.placement.rotation * Math.PI) / 180)
              .add(new Vector3(item.placement.x, item.placement.y, item.placement.z)),
          ),
        ),
      ),
    );
  });
  const x = Math.min(...points.map((point) => point.x)),
    y = Math.min(...points.map((point) => point.y));
  return {
    x,
    y,
    width: Math.max(...points.map((point) => point.x)) - x,
    height: Math.max(...points.map((point) => point.y)) - y,
  };
}
function fixture() {
  const base = createDemoWorkspace();
  base.devices = [];
  base.objects = [];
  base.connections = [];
  base.history = [];
  const object = (id: string, kind: 'desk' | 'keyboard', x: number, z: number) => ({
    id,
    kind,
    name: id,
    deviceId: null,
    placement: { x, y: kind === 'desk' ? 0 : 2.4755, z, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#808080',
    parts: [],
    note: '',
    supportId: kind === 'desk' ? 'floor' : 'desk',
    imageRegion: null,
  });
  const proposal: SceneProposal = {
    message: 'Independent synthetic photo observations.',
    objects: [object('desk', 'desk', 0, 0), object('keyboard', 'keyboard', 0, 0.4)],
  };
  const state = buildScenePreview(base, proposal);
  const keyboard = state.draft.devices[0];
  const target = structuredClone(keyboard);
  target.placement.x = 0.4;
  target.placement.z = 0.6;
  const candidate = state.candidates.find((entry) => entry.kind === 'keyboard')!;
  candidate.imageRegion = observedRegion(target);
  candidate.imageRegionVisibility = 'complete';
  candidate.imageAnchor = project(
    new Vector3(target.placement.x, target.placement.y + 0.01, target.placement.z),
  );
  candidate.locks = { scale: true, rotation: true };
  const desk = state.draft.objects[0];
  const points = [
    [-3.71, -1.58],
    [3.71, -1.58],
    [3.71, 1.58],
    [-3.71, 1.58],
  ].map(([x, z]) => project(new Vector3(x, desk.placement.y + 2.4835, z)));
  const reference: PhotoReference = {
    objectId: desk.id,
    corners: Object.fromEntries(
      names.map((name, index) => [name, points[index]]),
    ) as PhotoReference['corners'],
    aspect: view.aspect,
    source: 'manual',
  };
  return { base, state, candidate, reference, target, proposal };
}

describe('source-photo fitting through actual review state', () => {
  it('reduces independently projected image error and preserves camera desk, scale/yaw and saved input', () => {
    const { base, state, reference, target } = fixture();
    const before = structuredClone({ base, state });
    const fitted = fitSceneReviewToPhoto(state, base, reference);
    expect(fitted.photoAlignment!.afterError).toBeLessThan(
      fitted.photoAlignment!.beforeError * 0.03,
    );
    expect(fitted.draft.devices[0].placement.x).toBeCloseTo(target.placement.x, 2);
    expect(fitted.draft.devices[0].placement.z).toBeCloseTo(target.placement.z, 2);
    expect(fitted.draft.objects).toEqual(state.draft.objects);
    expect(fitted.draft.devices[0].visual.scale).toEqual(state.draft.devices[0].visual.scale);
    expect(fitted.draft.devices[0].placement.rotation).toBe(
      state.draft.devices[0].placement.rotation,
    );
    expect(fitted.issues).toEqual([]);
    expect({ base, state }).toEqual(before);
    expect(fitted.candidates[1].locks).toEqual(state.candidates[1].locks);
  });

  it('repeats deterministically from the same pre-fit state instead of walking on every click', () => {
    const { base, state, reference } = fixture();
    const first = fitSceneReviewToPhoto(state, base, reference);
    expect(fitSceneReviewToPhoto(first, base, reference)).toEqual(first);
    expect(undoScenePhotoFit(first, base).draft).toEqual(state.draft);
  });

  it('preserves edits and locks made after fitting when undoing', () => {
    const { base, state, reference } = fixture();
    const fit = fitSceneReviewToPhoto(state, base, reference);
    const edited = structuredClone(fit.draft);
    edited.devices[0].placement.x = 1.3;
    const changed = refreshSceneReview(fit, base, edited);
    expect(changed.candidates[1].locks?.position).toBe(true);
    const undone = undoScenePhotoFit(changed, base);
    expect(undone.draft.devices[0].placement.x).toBe(1.3);
    expect(undone.photoAlignment).toBeUndefined();
  });

  it('does not move a locked object, even if its seed is far from the user edit', () => {
    const { base, state, reference } = fixture();
    state.draft.devices[0].placement.x = 2;
    const locked = setSceneCandidateLocks(state, base, state.candidates[1].proposalId, {
      position: true,
    });
    const fitted = fitSceneReviewToPhoto(locked, base, reference);
    expect(fitted.draft.devices[0].placement).toEqual(locked.draft.devices[0].placement);
    expect(fitted.photoAlignment!.afterError).toBe(fitted.photoAlignment!.beforeError);
  });

  it.each(['partial', 'unknown'] as const)(
    'does not resize or chase the center of a contained %s region',
    (visibility) => {
      const { base, state, reference, candidate } = fixture();
      const region = observedRegion(state.draft.devices[0]);
      candidate.imageRegion = {
        x: region.x + region.width * 0.6,
        y: region.y + region.height * 0.2,
        width: region.width * 0.2,
        height: region.height * 0.5,
      };
      candidate.imageRegionVisibility = visibility;
      candidate.imageAnchor = null;
      candidate.locks = {};
      const fitted = fitSceneReviewToPhoto(state, base, reference);
      expect(fitted.draft).toEqual(state.draft);
      expect(fitted.photoAlignment!.warnings.join(' ')).toContain('visible coverage only');
    },
  );

  it('does not add a collision to match an incorrect complete image region', () => {
    const { base, state, reference, candidate } = fixture();
    const obstacle = structuredClone(state.draft.devices[0]);
    obstacle.id = 'retained-obstacle';
    obstacle.placement.x = 1.6;
    state.draft.devices.push(obstacle);
    const imageTarget = structuredClone(obstacle);
    imageTarget.placement.x = 1.1;
    candidate.imageRegion = observedRegion(imageTarget);
    candidate.imageAnchor = null;
    const fitted = fitSceneReviewToPhoto(state, base, reference);
    expect(getSceneCollisionPairs(fitted.draft, base)).toEqual([]);
    expect(fitted.draft.devices.find((item) => item.id === obstacle.id)).toEqual(obstacle);
  });

  it('requires actual photo calibration and clearly reports missing object evidence', () => {
    const { base, state, reference, candidate } = fixture();
    candidate.imageRegion = null;
    candidate.imageAnchor = null;
    const result = fitPhotoLayout(base, state.draft, state.candidates, reference);
    expect(result.draft).toEqual(state.draft);
    expect(result.warnings.join(' ')).toContain('No object image regions');
    expect(() =>
      fitSceneReviewToPhoto(state, base, {
        ...reference,
        corners: { ...reference.corners, frontRight: reference.corners.frontLeft },
      }),
    ).toThrow();
  });

  it('keeps a hard candidate budget and rejects unbounded policy overrides', () => {
    const { base, state, reference } = fixture();
    expect(
      fitPhotoLayout(base, state.draft, state.candidates, reference, { maxEvaluations: 1 })
        .evaluations,
    ).toBe(1);
    expect(() =>
      fitPhotoLayout(base, state.draft, state.candidates, reference, { maxEvaluations: 100000 }),
    ).toThrow();
  });

  it('does not improve image alignment by making an existing child overhang worse', () => {
    const { base, reference, proposal } = fixture();
    const desk = proposal.objects[0];
    const riser = {
      ...proposal.objects[1],
      id: 'riser',
      kind: 'monitor-riser' as const,
      placement: { x: 0, y: 2.4845, z: 0, rotation: 0 },
      supportId: 'desk',
    };
    const laptop = {
      ...proposal.objects[1],
      id: 'laptop',
      kind: 'laptop' as const,
      placement: { x: 1.25, y: 2.978, z: 0, rotation: 0 },
      supportId: 'riser',
    };
    const state = buildScenePreview(
      base,
      { ...proposal, objects: [desk, riser, laptop] },
      { repair: false },
    );
    const candidate = state.candidates.find((item) => item.kind === 'monitor-riser')!;
    const target = structuredClone(
      state.draft.objects.find((item) => item.kind === 'monitor-riser')!,
    );
    target.visual.scale = { x: 0.85, y: 0.85, z: 0.85 };
    candidate.imageRegion = observedRegion(target);
    candidate.imageRegionVisibility = 'complete';
    const before = evaluateSceneSupport(state.draft, 'photo-laptop', 'photo-riser');
    const fit = fitPhotoLayout(base, state.draft, state.candidates, reference, {
      maxPositionFraction: 0,
      maxRotationDegrees: 0,
    });
    const after = evaluateSceneSupport(fit.draft, 'photo-laptop', 'photo-riser');
    expect(after.footprintError).toBeLessThanOrEqual(before.footprintError + 1e-7);
    expect(fit.draft.objects.find((item) => item.id === 'photo-riser')!.visual.scale).toEqual({
      x: 1,
      y: 1,
      z: 1,
    });
  });

  it('does not erase an observed contact error when the predicted contact leaves the image', () => {
    const { state, candidate } = fixture();
    const camera = {
      position: { x: 3, y: 8, z: 10 },
      target: { x: 0, y: 2.4, z: 0 },
      up: { x: 0, y: 1, z: 0 },
      fov: 20,
      aspect: view.aspect,
    };
    candidate.imageRegion = null;
    candidate.imageAnchor = { x: 0.5, y: 0.7 };
    state.draft.devices[0].placement = { x: 0, y: 0, z: 3.5, rotation: 0 };
    // Missing projection or an off-frame contact must retain a penalty.
    expect(photoAlignmentError(state.draft, state.candidates, camera)).toBeGreaterThan(0.1);
  });

  it('accepts old replies and validates new image evidence without persisting it', () => {
    const { proposal } = fixture();
    expect(SceneProposalSchema.safeParse(proposal).success).toBe(true);
    expect(
      SceneProposalSchema.safeParse({
        ...proposal,
        photoReference: { objectId: 'missing', corners: {} },
      }).success,
    ).toBe(false);
    expect(
      SceneProposalSchema.safeParse({
        ...proposal,
        objects: proposal.objects.map((item) => ({ ...item, imageAnchor: { x: 2, y: 0 } })),
      }).success,
    ).toBe(false);
  });

  it('rejects unreliable automatic perspective rather than moving a scene using a limit camera', () => {
    const { base, state, reference } = fixture();
    const wide = new PerspectiveCamera(110, view.aspect, 0.01, 1000);
    wide.position.copy(view.position);
    wide.lookAt(0, 2.4, 0);
    wide.updateMatrixWorld(true);
    const desk = state.draft.objects[0];
    const points = [
      [-3.71, -1.58],
      [3.71, -1.58],
      [3.71, 1.58],
      [-3.71, 1.58],
    ].map(([x, z]) => {
      const p = new Vector3(x, desk.placement.y + 2.4835, z).project(wide);
      return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
    });
    const inconsistent = {
      ...reference,
      corners: Object.fromEntries(
        names.map((name, index) => [name, points[index]]),
      ) as PhotoReference['corners'],
    };
    const before = structuredClone(state);
    expect(() => fitSceneReviewToPhoto(state, base, inconsistent)).toThrow(/reliably determine/);
    expect(state).toEqual(before);
  });

  it('does not interpret scale-edit roundoff as an explicit position lock', () => {
    const { base, state } = fixture();
    const draft = structuredClone(state.draft);
    draft.devices[0].visual.scale.x = 0.9;
    draft.devices[0].placement.y += 1e-15;
    const next = refreshSceneReview(state, base, draft);
    expect(next.candidates[1].locks?.position).not.toBe(true);
    expect(next.candidates[1].locks?.scale).toBe(true);
  });

  it('matches automatically from model evidence without manual coordinates and leaves undo undone', () => {
    const { base, state, reference } = fixture();
    state.photoReference = {
      objectId: reference.objectId,
      corners: reference.corners,
      source: 'model',
    };
    const before = structuredClone(state);
    const fitted = autoFitSceneReviewToPhoto(state, base, reference.aspect);
    expect(fitted.photoAlignment!.afterError).toBeLessThan(fitted.photoAlignment!.beforeError);
    expect(state).toEqual(before);
    expect(undoScenePhotoFit(fitted, base).draft).toEqual(state.draft);
    expect(autoFitSceneReviewToPhoto(fitted, base, reference.aspect).draft).toEqual(fitted.draft);
  });

  it('keeps a scene unchanged if automatic photo evidence is missing or insufficient', () => {
    const { base, state, reference } = fixture();
    const before = structuredClone(state);
    // A single object region does not establish an automatic source camera.
    expect(() => autoFitSceneReviewToPhoto(state, base, reference.aspect)).toThrow();
    state.candidates[1].imageRegion = null;
    state.candidates[1].imageAnchor = null;
    const empty = structuredClone(state);
    expect(() => autoFitSceneReviewToPhoto(state, base, reference.aspect)).toThrow(
      /not enough photo evidence/,
    );
    expect(state).toEqual(empty);
    expect(before.draft).toEqual(state.draft);
  });

  it('undoes excluded candidates too, including after another fit omits them', () => {
    const { base, state, reference, candidate } = fixture();
    const fitted = fitSceneReviewToPhoto(state, base, reference);
    const excluded = setSceneCandidateIncluded(fitted, base, candidate.proposalId, false);
    const repeated = fitSceneReviewToPhoto(excluded, base, reference);
    const undone = undoScenePhotoFit(repeated, base);
    const restored = setSceneCandidateIncluded(undone, base, candidate.proposalId, true);
    expect(restored.draft.devices[0].placement).toEqual(state.draft.devices[0].placement);
    expect(restored.draft.devices[0].visual.scale).toEqual(state.draft.devices[0].visual.scale);
  });

  it('keys undo by proposal identity while retaining a newly chosen saved record', () => {
    const { base, state, reference, proposal, candidate } = fixture();
    const saved = structuredClone(state.draft.devices[0]);
    saved.id = 'saved-keyboard';
    saved.name = 'Existing keyboard';
    saved.source = 'user-reported';
    saved.status = 'reported-working';
    saved.statusNote = 'User report preserved.';
    saved.visual.source = 'user-reported';
    saved.placement.x = 3;
    base.devices = [saved];
    const start = buildScenePreview(base, proposal);
    Object.assign(start.candidates[1], {
      imageRegion: candidate.imageRegion,
      imageRegionVisibility: 'complete',
      imageAnchor: candidate.imageAnchor,
      locks: { scale: true, rotation: true },
    });
    const fitted = fitSceneReviewToPhoto(start, base, reference);
    const rebound = rebindSceneReviewDevice(fitted, base, candidate.proposalId, saved.id);
    const undone = undoScenePhotoFit(rebound, base);
    const restored = undone.draft.devices.find((item) => item.id === saved.id)!;
    expect(restored.placement).toEqual(
      start.draft.devices.find((item) => item.id === candidate.sceneId)!.placement,
    );
    expect(restored.status).toBe('reported-working');
    expect(restored.statusNote).toBe('User report preserved.');
    expect(undone.candidates[1].matchedSceneId).toBe(saved.id);
  });

  it('does not hide a new component collision under an unchanged larger collision in the same pair', () => {
    const { base, state, reference } = fixture();
    const box = (x: number, z: number, width: number) => ({
      position: { x, y: 0.5, z },
      size: { x: width, y: width === 4 ? 1 : 0.4, z: width === 4 ? 1 : 0.4 },
      color: '#808080',
    });
    const retained = createSceneObject('generic');
    retained.id = 'retained';
    retained.shapeMode = 'custom';
    retained.parts = [box(0, 0.5, 4), box(3.05, 0, 0.4)];
    retained.placement = { x: 0, y: 0.001, z: 0, rotation: 0 };
    base.objects = [retained];
    state.draft.objects.push(structuredClone(retained));
    const moving = createSceneObject('generic');
    moving.id = 'moving';
    moving.shapeMode = 'custom';
    moving.parts = [box(0, 0, 4), box(2.5, 0, 0.4)];
    moving.placement = { x: 0, y: 0.001, z: 0, rotation: 0 };
    state.draft.objects.push(moving);
    state.draft.devices = [];
    const target = structuredClone(moving);
    target.placement.x = 0.2;
    state.candidates = [
      state.candidates[0],
      {
        proposalId: 'moving',
        sceneId: moving.id,
        kind: 'generic',
        proposedName: 'moving',
        included: true,
        source: 'photo-inferred',
        matchedSceneId: null,
        supportId: 'floor',
        imageRegion: observedRegion(target),
        imageRegionVisibility: 'complete',
      },
    ];
    const fitted = fitPhotoLayout(base, state.draft, state.candidates, reference);
    expect(getSceneCollisionPairs(fitted.draft, state.draft)).toEqual([]);
  });
});

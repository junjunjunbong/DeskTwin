/** Public-to-the-repository replay: numerical model estimates only, no private
 * input paths, provider calls, photo files, saved workspace or result writes. */
import assert from 'node:assert/strict';
import fixture from '../tests/fixtures/photo-scene-19-sanitized.json';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';
import {
  buildScenePreview,
  sceneReviewPlacementIssues,
  validateSceneReviewForApply,
  type ScenePreview,
} from '../src/domain/sceneProposal';
import { autoFitSceneReviewToPhoto, undoScenePhotoFit } from '../src/domain/sceneReview';
import { fitPhotoLayoutFromRegions, photoAlignmentError } from '../src/domain/photoFitting';
import { estimatePhotoCamera } from '../src/domain/photoProjection';
import { getItemBounds, getSceneCollisionPairs } from '../src/domain/spatial';

const base = createDemoWorkspace();
base.name = 'Synthetic empty replay workspace';
base.devices = [];
base.objects = [];
base.connections = [];
base.diagnoses = [];
base.history = [];
const initial = buildScenePreview(base, fixture.proposal);
const original = structuredClone({ base, initial });
const current = autoFitSceneReviewToPhoto(initial, base, 4 / 3);
const repeated = autoFitSceneReviewToPhoto(current, base, 4 / 3);
assert.deepEqual(repeated.draft, current.draft);
const supports = (state: ScenePreview) =>
  state.candidates.map(({ proposalId, supportId, supportSource }) => ({
    proposalId,
    supportId,
    supportSource,
  }));
assert.deepEqual(supports(repeated), supports(current));
assert.deepEqual(getSceneCollisionPairs(current.draft, initial.draft), []);
const undone = undoScenePhotoFit(current, base);
assert.deepEqual(undone.draft, initial.draft);
assert.deepEqual(supports(undone), supports(initial));
const observed = initial.candidates.filter(
  (candidate) => candidate.included && candidate.kind !== 'desk' && candidate.imageRegion,
);
const camera = estimatePhotoCamera(
  initial.draft,
  observed.map((candidate) => ({ sceneId: candidate.sceneId, region: candidate.imageRegion! })),
  4 / 3,
).camera;
const items = (draft: Workspace) => [...draft.objects, ...draft.devices];
const deskBounds = getItemBounds(items(initial.draft).find((item) => item.kind === 'desk')!);
const limits = {
  x: (deskBounds.max.x - deskBounds.min.x) * 0.15,
  y: 0.12,
  z: (deskBounds.max.z - deskBounds.min.z) * 0.15,
};

/** Assert the same automatic candidate path used by the UI, with the independent
 * final validator and the unchanged component-collision baseline. */
function assertComplete(state: ScenePreview, fitted: typeof current.photoAlignment) {
  assert(fitted);
  assert.equal(state.candidates.length, 19);
  assert(state.candidates.every((candidate) => candidate.included));
  assert.deepEqual(
    items(state.draft)
      .map((item) => item.id)
      .sort(),
    items(initial.draft)
      .map((item) => item.id)
      .sort(),
  );
  assert.deepEqual(getSceneCollisionPairs(state.draft, base), []);
  assert.deepEqual(getSceneCollisionPairs(state.draft, initial.draft), []);
  assert.deepEqual(sceneReviewPlacementIssues(base, state.draft, state), []);
  validateSceneReviewForApply(state, base);
  assert.deepEqual(fitted.camera, camera);
  assert.deepEqual(fitted.beforeDraft, initial.draft);
  assert(
    Math.abs(fitted.beforeError - photoAlignmentError(initial.draft, observed, camera)) < 1e-12,
  );
  assert(Math.abs(fitted.afterError - photoAlignmentError(state.draft, observed, camera)) < 1e-12);
  assert(fitted.afterError < fitted.beforeError);
  const maximumDisplacement = { x: 0, y: 0, z: 0 };
  for (const candidate of state.candidates) {
    const before = initial.candidates.find((entry) => entry.proposalId === candidate.proposalId)!;
    const item = items(state.draft).find((entry) => entry.id === candidate.sceneId)!;
    const seed = candidate.seed!;
    assert.deepEqual(seed, before.seed);
    assert.deepEqual(candidate.locks, before.locks);
    assert.deepEqual(item.visual.scale, seed.scale);
    assert.equal(item.placement.rotation, seed.placement.rotation);
    for (const axis of ['x', 'y', 'z'] as const) {
      const displacement = Math.abs(item.placement[axis] - seed.placement[axis]);
      assert(displacement <= limits[axis] + 1e-8);
      maximumDisplacement[axis] = Math.max(maximumDisplacement[axis], displacement);
    }
  }
  return {
    independentApplyPassed: true,
    scaleAndYawPreserved: true,
    originalSeedsAndLocksPreserved: true,
    noNewOrWorsenedPartCollisions: true,
    cameraUnchanged: true,
    maximumDisplacement,
    limits,
  };
}
const invariants = assertComplete(current, current.photoAlignment);
const summary = (state: typeof initial) => ({
  issueEntries: state.issues.length,
  supportIssues: state.issues.filter((issue) => issue.code === 'support').length,
  collisionPairs: getSceneCollisionPairs(state.draft, base).length,
});
const extended = process.argv.includes('--extended')
  ? fitPhotoLayoutFromRegions(base, initial.draft, initial.candidates, 4 / 3, {
      maxEvaluations: 1024,
      maxSweeps: 12,
    })
  : undefined;
const extendedState = extended && {
  ...initial,
  draft: extended.draft,
  candidates: extended.candidates,
  issues: sceneReviewPlacementIssues(base, extended.draft, {
    ...initial,
    candidates: extended.candidates,
  }),
};
const extendedInvariants = extendedState && extended && assertComplete(extendedState, extended);
assert.deepEqual({ base, initial }, original);
console.log(
  JSON.stringify(
    {
      provenance: fixture.provenance,
      objectCount: fixture.proposal.objects.length,
      initial: summary(initial),
      current: summary(current),
      imageEvidenceError: {
        before: current.photoAlignment!.beforeError,
        afterGeometryRepair: current.photoAlignment!.afterRepairError,
        after: current.photoAlignment!.afterError,
      },
      geometryRepair: current.photoAlignment!.repairSummary,
      invariants,
      unresolvedSupports: current.issues
        .filter((issue) => issue.code === 'support')
        .map((issue) => ({
          id: issue.itemId,
          supportId: issue.relatedItemId,
          cause: issue.rootCause,
        })),
      extended: extended &&
        extendedState && {
          ...summary(extendedState),
          imageEvidenceError: extended.afterError,
          evaluations: extended.evaluations,
          geometryRepair: extended.repairSummary,
          invariants: extendedInvariants,
        },
      repeatedDraftIdentical: true,
      repeatedSupportsIdentical: true,
      undoRestoresGeometryAndSupports: true,
      note: 'The real automatic path must satisfy every geometry invariant. Lower fixed-camera image-evidence error is not measured photo fidelity.',
    },
    null,
    2,
  ),
);

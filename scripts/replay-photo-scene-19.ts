/** Public-to-the-repository replay: numerical model estimates only, no private
 * input paths, provider calls, photo files, saved workspace or result writes. */
import assert from 'node:assert/strict';
import fixture from '../tests/fixtures/photo-scene-19-sanitized.json';
import { createDemoWorkspace } from '../src/domain/workspace';
import { buildScenePreview } from '../src/domain/sceneProposal';
import { autoFitSceneReviewToPhoto } from '../src/domain/sceneReview';
import { fitPhotoLayoutFromRegions } from '../src/domain/photoFitting';
import { getSceneCollisionPairs } from '../src/domain/spatial';

const base = createDemoWorkspace();
base.name = 'Synthetic empty replay workspace';
base.devices = [];
base.objects = [];
base.connections = [];
base.history = [];
const initial = buildScenePreview(base, fixture.proposal);
const current = autoFitSceneReviewToPhoto(initial, base, 4 / 3);
const repeated = autoFitSceneReviewToPhoto(current, base, 4 / 3);
assert.deepEqual(repeated.draft, current.draft);
assert.deepEqual(getSceneCollisionPairs(current.draft, initial.draft), []);
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
console.log(
  JSON.stringify(
    {
      provenance: fixture.provenance,
      objectCount: fixture.proposal.objects.length,
      initial: summary(initial),
      current: summary(current),
      imageEvidenceError: {
        before: current.photoAlignment!.beforeError,
        after: current.photoAlignment!.afterError,
      },
      unresolvedSupports: current.issues
        .filter((issue) => issue.code === 'support')
        .map((issue) => ({
          id: issue.itemId,
          supportId: issue.relatedItemId,
          cause: issue.rootCause,
        })),
      extended: extended && {
        collisionPairs: getSceneCollisionPairs(extended.draft, base).length,
        imageEvidenceError: extended.afterError,
        evaluations: extended.evaluations,
      },
      repeatedDraftIdentical: true,
      note: 'Unresolved results are reported, not asserted away. Lower image-evidence error is not measured photo fidelity.',
    },
    null,
    2,
  ),
);

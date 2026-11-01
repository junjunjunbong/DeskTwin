/** Explicit offline evaluation. Reads caller-selected frozen inputs; never calls
 * a provider, applies a workspace, or overwrites an earlier evaluation. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { buildScenePreview } from '../src/domain/sceneProposal';
import { autoFitSceneReviewToPhoto, fitSceneReviewToPhoto } from '../src/domain/sceneReview';
import { getSceneCollisionPairs } from '../src/domain/spatial';
import type { PhotoReference } from '../src/domain/photoProjection';

const { values } = parseArgs({
  options: {
    proposal: { type: 'string' },
    workspace: { type: 'string' },
    reference: { type: 'string' },
    aspect: { type: 'string', default: '1.3333333333333333' },
    output: { type: 'string' },
  },
});
if (!values.proposal || !values.workspace)
  throw new Error(
    'Usage: node --import tsx scripts/evaluate-photo-reference.ts --proposal FILE --workspace FILE [--aspect WIDTH/HEIGHT_AS_NUMBER] [--reference INTERNAL_REFERENCE_FILE] [--output NEW_FILE]',
  );
const paths = [values.proposal, values.workspace, ...(values.reference ? [values.reference] : [])];
const bytes = paths.map((path) => fs.readFileSync(path));
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const hashes = bytes.map(hash);
const proposal = JSON.parse(bytes[0].toString());
const workspaceInput = JSON.parse(bytes[1].toString());
const base = workspaceInput.workspace ?? workspaceInput;
const referenceInput = bytes[2] ? JSON.parse(bytes[2].toString()) : null;
const reference: PhotoReference | undefined =
  referenceInput?.reference ?? referenceInput ?? undefined;
const aspect = Number(values.aspect);
const run = (state: ReturnType<typeof buildScenePreview>) =>
  reference
    ? fitSceneReviewToPhoto(state, base, reference)
    : autoFitSceneReviewToPhoto(state, base, aspect);
const baseline = buildScenePreview(base, proposal);
const summary = (state: typeof baseline) => ({
  issueEntries: state.issues.length,
  supportIssues: state.issues.filter((issue) => issue.code === 'support').length,
  collisionPairs: getSceneCollisionPairs(state.draft, base).length,
});
const started = performance.now();
let result: Record<string, unknown>;
try {
  const fitted = run(baseline);
  const repeated = run(fitted);
  assert.deepEqual(repeated.draft, fitted.draft, 'Repeat fit must not continue walking the scene.');
  result = {
    outcome: 'fitted',
    before: summary(baseline),
    after: summary(fitted),
    alignment: {
      before: fitted.photoAlignment!.beforeError,
      after: fitted.photoAlignment!.afterError,
    },
    adjustedObjects: fitted.photoAlignment!.changedIds.length,
    evaluations: fitted.photoAlignment!.evaluations,
    warnings: fitted.photoAlignment!.warnings,
    independentApplyStillRequired: true,
    repeatedDraftIdentical: true,
  };
} catch (error) {
  if (error instanceof assert.AssertionError) throw error;
  result = {
    outcome: 'needs-reference-review',
    before: summary(baseline),
    reason: error instanceof Error ? error.message : 'Invalid reference.',
    previewUnchanged: true,
  };
}
for (let i = 0; i < paths.length; i++)
  assert.equal(hash(fs.readFileSync(paths[i])), hashes[i], 'Frozen source artifact changed.');
const report = {
  scope:
    'Offline geometry/image-evidence replay. No API call, saved workspace write, or photo-quality benchmark.',
  sourceSha256: { proposal: hashes[0], workspace: hashes[1], reference: hashes[2] ?? null },
  objectCount: proposal.objects.length,
  elapsedMs: Math.round(performance.now() - started),
  annotationProvenance:
    referenceInput?.annotationProvenance ??
    (reference
      ? 'Caller-supplied internal reference; not independently verified.'
      : 'No manual coordinates. View inferred from frozen model evidence.'),
  ...result,
  sourceArtifactsUnchanged: true,
};
const json = JSON.stringify(report, null, 2) + '\n';
if (values.output) fs.writeFileSync(values.output, json, { flag: 'wx', mode: 0o600 });
console.log(json);

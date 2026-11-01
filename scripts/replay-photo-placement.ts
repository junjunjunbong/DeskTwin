/** Offline acceptance for three observed photo-placement failures, using sanitized geometry.
 * Historical failures are recorded separately, never required of the current implementation.
 * No private files, network requests, or saved workspace writes are involved.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildScenePreview,
  validateSceneReviewForApply,
  type SceneProposal,
} from '../src/domain/sceneProposal';
import { getItemBounds, type ScenePlacementIssue } from '../src/domain/spatial';
import { createDemoWorkspace } from '../src/domain/workspace';

const base = createDemoWorkspace();
base.name = 'Sanitized placement diagnosis';
base.devices = [];
base.objects = [];
base.connections = [];
base.history = [];
base.diagnoses = [];

if (process.argv.includes('--baseline')) {
  console.log(
    readFileSync(
      new URL('../docs/baselines/photo-placement-d02cac93.json', import.meta.url),
      'utf8',
    ),
  );
  process.exit(0);
}

// Preserve only the six objects' type, placement, scale, and support relation.
// Names, colors, notes and image regions are replaced. These scene units are
// model estimates, not physical measurements of a real desk.
const input: SceneProposal = {
  message: 'Sanitized geometry-only diagnostic input.',
  objects: [
    {
      id: 'desk',
      kind: 'desk',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
      scale: { x: 1, y: 1, z: 1 },
      supportId: 'floor',
    },
    {
      id: 'keyboard',
      kind: 'keyboard',
      placement: { x: -0.05, y: 2.4735, z: 0.4, rotation: 0 },
      scale: { x: 1, y: 1, z: 1 },
      supportId: 'desk',
    },
    {
      id: 'wrist-rest',
      kind: 'wrist-rest',
      placement: { x: -0.05, y: 2.4835, z: 0.7, rotation: 0 },
      scale: { x: 0.9, y: 1, z: 1 },
      supportId: 'desk',
    },
    {
      id: 'mat',
      kind: 'mat',
      placement: { x: 0.1, y: 2.4835, z: 0.6, rotation: 0 },
      scale: { x: 1.4, y: 1, z: 1.7 },
      supportId: 'desk',
    },
    {
      id: 'stand',
      kind: 'laptop-stand',
      placement: { x: 2, y: 2.4835, z: -0.1, rotation: -15 },
      scale: { x: 0.8, y: 0.8, z: 0.8 },
      supportId: 'desk',
    },
    {
      id: 'laptop',
      kind: 'laptop',
      placement: { x: 2, y: 2.8128, z: -0.1, rotation: -15 },
      scale: { x: 0.95, y: 0.9, z: 0.95 },
      supportId: 'stand',
    },
  ].map((item) => ({
    ...item,
    kind: item.kind as SceneProposal['objects'][number]['kind'],
    deviceId: null,
    name: item.id,
    color: '#808080',
    parts: [],
    note: '',
    imageRegion: null,
  })),
};
const run = (ids: string[]) => {
  const objects = structuredClone(input.objects.filter((item) => ids.includes(item.id)));
  return buildScenePreview(base, { ...input, objects });
};
const counts = (issues: ScenePlacementIssue[]) => ({
  total: issues.length,
  support: issues.filter((issue) => issue.code === 'support').length,
  collisionEntries: issues.filter((issue) => issue.code === 'collision').length,
});

const scenes = {
  keyboardSupport: run(['desk', 'mat', 'keyboard']),
  wristSpacing: run(['desk', 'keyboard', 'wrist-rest']),
  laptopSupport: run(['desk', 'stand', 'laptop']),
};
for (const [name, review] of Object.entries(scenes)) {
  assert.deepEqual(review.issues, [], `${name} must pass current placement validation.`);
  validateSceneReviewForApply(review, base);
  const desk = review.draft.objects.find((item) => item.kind === 'desk')!;
  const bounds = getItemBounds(desk);
  for (const candidate of review.candidates) {
    const current = [...review.draft.objects, ...review.draft.devices].find(
      (item) => item.id === candidate.sceneId,
    )!;
    assert.deepEqual(current.visual.scale, candidate.seed!.scale, `${name}: no scale repair`);
    assert.equal(
      current.placement.rotation,
      candidate.seed!.placement.rotation,
      `${name}: no yaw repair`,
    );
    assert.ok(
      Math.abs(current.placement.x - candidate.seed!.placement.x) <=
        (bounds.max.x - bounds.min.x) * 0.03 + 1e-8,
    );
    assert.ok(
      Math.abs(current.placement.z - candidate.seed!.placement.z) <=
        (bounds.max.z - bounds.min.z) * 0.05 + 1e-8,
    );
  }
}
assert.equal(
  scenes.keyboardSupport.candidates.find((item) => item.kind === 'keyboard')!.supportId,
  'mat',
);
assert.equal(
  scenes.keyboardSupport.candidates.find((item) => item.kind === 'keyboard')!.seed!.supportId,
  'desk',
);

console.log(
  JSON.stringify(
    {
      scope:
        'Current geometry acceptance only. No API, photos or workspace writes. Use --baseline for the historical record; --expect-clear remains an alias for current acceptance.',
      baselineSource: 'd02cac93cf007321cded2a52e31bbdc96a6f88e3',
      results: Object.fromEntries(
        Object.entries(scenes).map(([name, review]) => [
          name,
          {
            issues: counts(review.issues),
            adjustments: review.adjustments,
            search: review.repairSummary,
          },
        ]),
      ),
    },
    null,
    2,
  ),
);

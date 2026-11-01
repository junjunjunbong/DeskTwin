/** Offline, sanitized reproduction of three observed photo-placement failures.
 * This diagnostic describes the known baseline; it is not an acceptance test.
 * No private files, network requests, or saved workspace writes are involved.
 */
import assert from 'node:assert/strict';
import {
  buildScenePreview,
  sceneReviewPlacementIssues,
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
const run = (ids: string[], edit = (_objects: SceneProposal['objects']) => {}) => {
  const objects = structuredClone(input.objects.filter((item) => ids.includes(item.id)));
  edit(objects);
  return buildScenePreview(base, { ...input, objects });
};
const counts = (issues: ScenePlacementIssue[]) => ({
  total: issues.length,
  support: issues.filter((issue) => issue.code === 'support').length,
  collisionEntries: issues.filter((issue) => issue.code === 'collision').length,
});

const matIds = ['desk', 'mat', 'keyboard'];
const matBaseline = run(matIds);
if (process.argv.includes('--expect-clear')) {
  assert.equal(
    matBaseline.issues.length,
    0,
    'The keyboard should rest on the mat without intersecting it.',
  );
  process.exit(0);
}
assert.equal(matBaseline.issues.length, 2);
assert.equal(run(['desk', 'mat']).issues.length, 0);
assert.equal(run(['desk', 'keyboard']).issues.length, 0);
const matCorrected = run(matIds, (objects) => {
  objects.find((item) => item.id === 'keyboard')!.supportId = 'mat';
});
assert.equal(matCorrected.issues.length, 0);

const wristIds = ['desk', 'keyboard', 'wrist-rest'];
const wristBaseline = run(wristIds);
assert.equal(wristBaseline.issues.length, 2);
assert.equal(run(['desk', 'wrist-rest']).issues.length, 0);
const wristCorrected = run(wristIds, (objects) => {
  objects.find((item) => item.id === 'wrist-rest')!.placement.z = 0.78;
});
assert.equal(wristCorrected.issues.length, 0);

const standIds = ['desk', 'stand', 'laptop'];
const standBaseline = run(standIds);
assert.equal(standBaseline.issues.length, 3);
const heightDraft = structuredClone(standBaseline.draft);
const laptop = heightDraft.devices.find((item) => item.kind === 'laptop')!;
const stand = heightDraft.objects.find((item) => item.kind === 'laptop-stand')!;
const lift = getItemBounds(stand).max.y + 0.001 - getItemBounds(laptop).min.y;
laptop.placement.y += lift;
const heightIssues = sceneReviewPlacementIssues(base, heightDraft, standBaseline);
assert.deepEqual(counts(heightIssues), { total: 1, support: 1, collisionEntries: 0 });
const largerStand = run(standIds, (objects) => {
  const support = objects.find((item) => item.id === 'stand')!;
  support.scale.x = 0.9;
  support.scale.z = 0.9;
});
assert.equal(largerStand.issues.length, 0);

console.log(
  JSON.stringify(
    {
      scope: 'Known baseline diagnosis using sanitized geometry. No API or workspace writes.',
      keyboardSupport: {
        before: counts(matBaseline.issues),
        afterChangingOnlySupportToMat: counts(matCorrected.issues),
      },
      wristSpacing: {
        before: counts(wristBaseline.issues),
        afterChangingOnlyZFrom07To078: counts(wristCorrected.issues),
      },
      laptopSupport: {
        before: counts(standBaseline.issues),
        afterChangingOnlyHeight: counts(heightIssues),
        heightChangeSceneUnits: lift,
        afterIncreasingStandXZScaleFrom08To09: counts(largerStand.issues),
      },
    },
    null,
    2,
  ),
);

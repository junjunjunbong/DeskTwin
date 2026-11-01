import { describe, expect, it } from 'vitest';
import {
  createDemoWorkspace,
  createSceneObject,
  DeviceSchema,
  type BoxPart,
  type Workspace,
} from './workspace';
import {
  evaluateSceneSupport,
  getSceneCollisionPairs,
  getSceneCoveringAlternatives,
  getScenePairSeparationOffsets,
  getSceneSupportOffsets,
  getUnambiguousCoveringSupport,
} from './spatial';

const box = (x: number, width = 1): BoxPart => ({
  position: { x, y: 0.5, z: 0 },
  size: { x: width, y: 1, z: 1 },
  color: '#8899aa',
});
function empty(): Workspace {
  const result = createDemoWorkspace();
  result.devices = [];
  result.objects = [];
  result.connections = [];
  result.history = [];
  return result;
}
function item(workspace: Workspace, id: string) {
  return [...workspace.objects, ...workspace.devices].find((entry) => entry.id === id)!;
}
function translated(workspace: Workspace, id: string, offset: { x: number; z: number }) {
  const result = structuredClone(workspace);
  item(result, id).placement.x += offset.x;
  item(result, id).placement.z += offset.z;
  return result;
}
function deskMatKeyboard() {
  const workspace = empty();
  const desk = createSceneObject('desk');
  desk.id = 'table';
  desk.placement = { x: 0, y: 0, z: 0, rotation: 0 };
  const mat = createSceneObject('mat');
  mat.id = 'cover';
  mat.placement = { x: 0, y: 2.4845, z: 0, rotation: 0 };
  workspace.objects.push(desk, mat);
  workspace.devices.push(
    DeviceSchema.parse({
      id: 'keys',
      name: 'Keys',
      kind: 'keyboard',
      model: '',
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
      placement: { x: 1.7, y: 2.4745, z: 0, rotation: 0 },
    }),
  );
  return workspace;
}

describe('read-only geometry candidates for joint photo repair', () => {
  it('proposes existing valid partial covering contact without changing conservative inference', () => {
    const workspace = deskMatKeyboard();
    const original = structuredClone(workspace);
    expect(evaluateSceneSupport(workspace, 'keys', 'cover').footprintValid).toBe(true);
    expect(getUnambiguousCoveringSupport(workspace, 'keys', 'table')).toBeNull();
    expect(getSceneCoveringAlternatives(workspace, 'keys', 'table')).toEqual([
      { surfaceId: 'cover', heightDelta: expect.closeTo(0.0285, 8) },
    ]);
    expect(workspace).toEqual(original);
  });

  it('returns ambiguous covering choices and rejects unverified support beneath a mat', () => {
    const workspace = deskMatKeyboard();
    const second = structuredClone(workspace.objects[1]);
    second.id = 'other-cover';
    second.placement.x = 1;
    workspace.objects.push(second);
    expect(
      getSceneCoveringAlternatives(workspace, 'keys', 'table').map((entry) => entry.surfaceId),
    ).toEqual(['cover', 'other-cover']);
    workspace.objects[1].placement.y += 0.2;
    workspace.objects[2].placement.y += 0.2;
    expect(getSceneCoveringAlternatives(workspace, 'keys', 'table')).toEqual([]);
  });

  it('does not use partial covering contact to extend a base beyond its solid desk', () => {
    const workspace = deskMatKeyboard();
    workspace.objects[1].placement.x = 2.16;
    workspace.devices[0].placement.x = 4.1;
    expect(evaluateSceneSupport(workspace, 'keys', 'cover').footprintValid).toBe(false);
    expect(getSceneCoveringAlternatives(workspace, 'keys', 'table')).toEqual([]);
  });

  it('derives diagonal containment corrections in a rotated support coordinate system', () => {
    const workspace = empty();
    const riser = createSceneObject('monitor-riser');
    riser.id = 'platform';
    riser.placement = { x: 0.2, y: 0.001, z: -0.1, rotation: 37 };
    riser.visual.scale = { x: 1.2, y: 0.7, z: 1 };
    const yaw = (37 * Math.PI) / 180;
    const local = { x: 1.3, z: -0.45 };
    const monitor = DeviceSchema.parse({
      id: 'display',
      name: 'Display',
      kind: 'monitor',
      model: '',
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
      placement: {
        x: riser.placement.x + local.x * Math.cos(yaw) + local.z * Math.sin(yaw),
        y: 0.35,
        z: riser.placement.z - local.x * Math.sin(yaw) + local.z * Math.cos(yaw),
        rotation: 37,
      },
    });
    workspace.objects.push(riser);
    workspace.devices.push(monitor);
    const original = structuredClone(workspace);
    expect(evaluateSceneSupport(workspace, 'display', 'platform').footprintValid).toBe(false);
    const offsets = getSceneSupportOffsets(workspace, 'display', 'platform');
    expect(offsets.length).toBeGreaterThan(1);
    expect(Math.abs(offsets[0].x)).toBeGreaterThan(0.001);
    expect(Math.abs(offsets[0].z)).toBeGreaterThan(0.1);
    for (const offset of offsets)
      expect(
        evaluateSceneSupport(translated(workspace, 'display', offset), 'display', 'platform')
          .footprintValid,
      ).toBe(true);
    expect(workspace).toEqual(original);
    workspace.devices[0].visual.scale.x = 10;
    expect(getSceneSupportOffsets(workspace, 'display', 'platform')).toEqual([]);
  });

  it('separates actual colliding parts without using empty space in a compound AABB', () => {
    const workspace = empty();
    const compound = createSceneObject('generic');
    compound.id = 'compound';
    compound.placement = { x: 0, y: 0.001, z: 0, rotation: 0 };
    compound.shapeMode = 'custom';
    compound.parts = [box(-2), box(2)];
    const blocker = createSceneObject('generic');
    blocker.id = 'blocker';
    blocker.placement = { x: 2.25, y: 0.001, z: 0, rotation: 0 };
    blocker.shapeMode = 'custom';
    blocker.parts = [box(0)];
    workspace.objects.push(compound, blocker);
    const original = structuredClone(workspace);
    const offsets = getScenePairSeparationOffsets(workspace, 'compound', 'blocker');
    const positiveX = offsets.find((offset) => offset.x > 0 && Math.abs(offset.z) < 1e-10)!;
    expect(positiveX.x).toBeCloseTo(1.251, 8);
    expect(getSceneCollisionPairs(translated(workspace, 'compound', positiveX))).toEqual([]);
    expect(workspace).toEqual(original);
    workspace.objects[1].placement.x = 0;
    expect(getScenePairSeparationOffsets(workspace, 'compound', 'blocker')).toEqual([]);
  });

  it('includes rotated separating directions while retaining the strict collision detector', () => {
    const workspace = empty();
    for (const [id, x, rotation] of [
      ['first', 0, 35],
      ['second', 0.6, -20],
    ] as const) {
      const object = createSceneObject('generic');
      object.id = id;
      object.placement = { x, y: 0.001, z: 0, rotation };
      object.shapeMode = 'custom';
      object.parts = [box(0)];
      workspace.objects.push(object);
    }
    expect(getSceneCollisionPairs(workspace)).toHaveLength(1);
    const offsets = getScenePairSeparationOffsets(workspace, 'first', 'second');
    const diagonals = offsets.filter(
      (offset) => Math.abs(offset.x) > 0.001 && Math.abs(offset.z) > 0.001,
    );
    expect(diagonals.length).toBeGreaterThan(0);
    expect(
      diagonals.some(
        (offset) => getSceneCollisionPairs(translated(workspace, 'first', offset)).length === 0,
      ),
    ).toBe(true);
  });
});

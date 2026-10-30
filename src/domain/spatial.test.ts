import { describe, expect, it } from 'vitest';
import legacy from '../../tests/fixtures/workspace-v1.json';
import {
  applyCommand,
  createDemoWorkspace,
  createSceneObject,
  defaultVisual,
  parseWorkspace,
  WorkspaceSchema,
  type BoxPart,
  type SceneObject,
  type Workspace,
} from './workspace';
import {
  findFreePlacement,
  fitSceneProposal,
  getItemBounds,
  rebaseAttachedPlacement,
  resolveSpatialEdit,
  snapToSurface,
  validateSceneCollisions,
} from './spatial';

const part = (x = 1, y = 1, z = 1): BoxPart => ({
  position: { x: 0, y: y / 2, z: 0 },
  size: { x, y, z },
  color: '#8899aa',
});
function cube(id: string, x: number, z = 0, size = 0.5): SceneObject {
  return {
    ...createSceneObject('generic'),
    id,
    name: id,
    placement: { x, y: 0.001, z, rotation: 0 },
    shapeMode: 'custom',
    parts: [part(size, size, size)],
  };
}
function empty(objects: SceneObject[]): Workspace {
  return WorkspaceSchema.parse({
    schemaVersion: 2,
    name: 'Spatial test',
    devices: [],
    objects,
    connections: [],
    history: [],
    appearance: { lighting: 'day', labels: false, decor: true },
  });
}
function move(w: Workspace, id: string, x: number, z: number, rotation?: number): Workspace {
  const next = structuredClone(w);
  const item = [...next.devices, ...next.objects].find((object) => object.id === id)!;
  item.placement.x = x;
  item.placement.z = z;
  if (rotation !== undefined) item.placement.rotation = rotation;
  return next;
}

describe('shared geometry placement', () => {
  it.each(['keyboard', 'mouse', 'ssd', 'decor-chair'])(
    'moves the default %s over its mat/rug without lowering it into the covering',
    (id) => {
      for (const delta of [-0.1, 0.1]) {
        const w = createDemoWorkspace();
        const initial = structuredClone(w);
        const item = [...w.devices, ...w.objects].find((entry) => entry.id === id)!;
        const result = resolveSpatialEdit(
          w,
          move(w, id, item.placement.x + delta, item.placement.z),
          id,
          {
            snap: 'auto',
            sweep: true,
          },
        );
        expect(result.blocked, result.reason).toBe(false);
        const moved = [...result.workspace.devices, ...result.workspace.objects].find(
          (entry) => entry.id === id,
        )!;
        expect(moved.placement.x).toBeCloseTo(item.placement.x + delta, 6);
        expect(validateSceneCollisions(result.workspace, w)).toEqual([]);
        const replay = applyCommand(w, {
          type: 'move-object',
          id,
          placement: moved.placement,
          dragPath: result.path ?? [moved.placement],
        });
        expect(
          [...replay.devices, ...replay.objects].find((entry) => entry.id === id)?.placement,
        ).toEqual(moved.placement);
        expect(replay.history).toHaveLength(1);
        expect(replay.connections).toEqual(w.connections);
        expect(w).toEqual(initial);
      }
    },
  );
  it('sweeps upward, across and down over a thin rug while retaining real blockers', () => {
    const rug = {
      ...createSceneObject('mat'),
      id: 'rug',
      name: 'Rug',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
    };
    const moving = cube('moving', -2.1, 0, 0.2);
    const w = empty([moving, rug]);
    const result = resolveSpatialEdit(w, move(w, moving.id, 2.1, 0), moving.id, { snap: 'auto' });
    expect(result.blocked, result.reason).toBe(false);
    expect(result.path).toHaveLength(3);
    expect(result.path![0].y).toBeCloseTo(getItemBounds(rug).max.y + 0.001, 5);
    expect(result.workspace.objects[0].placement.x).toBeCloseTo(2.1, 6);
    expect(result.workspace.objects[0].placement.y).toBeCloseTo(moving.placement.y, 8);
    const replay = applyCommand(w, {
      type: 'move-object',
      id: moving.id,
      placement: result.workspace.objects[0].placement,
      dragPath: result.path,
    });
    expect(replay.objects[0].placement).toEqual(result.workspace.objects[0].placement);
    const blocker = cube('blocker', 0);
    blocker.parts = [part(0.025, 1, 1)];
    const blocked = empty([moving, rug, blocker]);
    const stopped = resolveSpatialEdit(blocked, move(blocked, moving.id, 2.1, 0), moving.id, {
      snap: 'auto',
    });
    expect(stopped.blocked).toBe(true);
    expect(stopped.workspace.objects[0].placement.x).toBeLessThan(-0.11);
    expect(stopped.reason).toMatch(/blocker/);
  });
  it('does not let a rug support exemption hide thick, tilted or downward collisions', () => {
    const moving = cube('moving', -2.1, 0, 0.2);
    const rug = {
      ...createSceneObject('mat'),
      id: 'rug',
      name: 'Rug',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
    };
    for (const altered of [
      { ...rug, visual: { ...rug.visual, scale: { x: 1, y: 3, z: 1 } } },
      {
        ...rug,
        shapeMode: 'custom' as const,
        parts: [{ ...part(3, 0.02, 1), rotation: { x: 0, y: 0, z: 10 } }],
      },
    ]) {
      const w = empty([moving, altered]);
      const result = resolveSpatialEdit(w, move(w, moving.id, 2.1, 0), moving.id, { snap: 'auto' });
      expect(result.blocked).toBe(true);
    }
    const onRug = cube('on-rug', 0, 0, 0.2);
    onRug.placement.y = getItemBounds(rug).max.y + 0.001;
    const w = empty([onRug, rug]);
    expect(() =>
      applyCommand(w, { type: 'update-object', id: onRug.id, patch: { placement: { y: 0 } } }),
    ).toThrow(/blocked|intersect/);
  });
  it('checks clearance above the starting object before lifting across a covering', () => {
    const moving = cube('moving', -2.1, 0, 0.2);
    const rug = {
      ...createSceneObject('mat'),
      id: 'rug',
      name: 'Rug',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
    };
    const overhead = cube('overhead-obstruction', -2.1, 0, 0.3);
    overhead.placement.y = 0.21;
    const w = empty([moving, rug, overhead]);
    expect(validateSceneCollisions(w)).toEqual([]);
    const result = resolveSpatialEdit(w, move(w, moving.id, 2.1, 0), moving.id, { snap: 'auto' });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/overhead-obstruction/);
    expect(result.workspace.objects[0].placement.x).toBe(moving.placement.x);
    expect(validateSceneCollisions(result.workspace, w)).toEqual([]);
  });
  it('rests on actual rotated mat geometry rather than empty corners of its bounds', () => {
    const rug = {
      ...createSceneObject('mat'),
      id: 'narrow-rug',
      name: 'Narrow rug',
      placement: { x: 0, y: 0, z: 0, rotation: 45 },
      shapeMode: 'custom' as const,
      parts: [part(3, 0.03, 0.3)],
    };
    const moving = cube('moving', 1, 1, 0.1);
    const w = empty([moving, rug]);
    const result = resolveSpatialEdit(w, move(w, moving.id, 0.8, 1), moving.id, { snap: 'auto' });
    expect(result.blocked, result.reason).toBe(false);
    expect(getItemBounds(result.workspace.objects[0]).min.y).toBeCloseTo(0.001, 8);
    expect(getItemBounds(snapToSurface(w, moving.id, 'floor').objects[0]).min.y).toBeCloseTo(
      0.001,
      8,
    );
    const aboveEmptyCorner = structuredClone(w);
    aboveEmptyCorner.objects[0].parts[0].position.y = 0.07;
    aboveEmptyCorner.objects[0].placement.y = 0.131;
    aboveEmptyCorner.objects[1].placement.y = 0.12;
    const changed = structuredClone(aboveEmptyCorner);
    changed.objects[0].visual.scale.y = 2;
    // No actual support exists at this height; an explicit scaling edit should
    // retain the origin rather than inventing a resting contact in the corner.
    const scaled = resolveSpatialEdit(aboveEmptyCorner, changed, moving.id, {
      preserveSupport: true,
    });
    expect(scaled.workspace.objects[0].placement.y).toBeCloseTo(0.131, 8);
  });
  it('places and attaches above a desk mat and preserves its contact during dimension edits', () => {
    const w = createDemoWorkspace();
    const attached = applyCommand(w, {
      type: 'attach-object',
      id: 'keyboard',
      parentId: 'decor-desk',
    });
    const keyboard = attached.devices.find((item) => item.id === 'keyboard')!;
    const mat = attached.objects.find((item) => item.id === 'decor-desk-mat')!;
    expect(keyboard.attachment).toEqual({ parentId: 'decor-desk' });
    expect(getItemBounds(keyboard).min.y).toBeCloseTo(getItemBounds(mat).max.y + 0.001, 5);
    const resized = applyCommand(attached, {
      type: 'update-device',
      id: 'keyboard',
      patch: { visual: { scale: { y: 0.5 } } },
    });
    expect(
      getItemBounds(resized.devices.find((item) => item.id === 'keyboard')!).min.y,
    ).toBeCloseTo(getItemBounds(keyboard).min.y, 6);
    expect(validateSceneCollisions(resized, w)).toEqual([]);
  });
  it('stops a fast move at a thin obstacle instead of tunneling through it', () => {
    const obstacle = cube('thin wall', 0);
    obstacle.id = 'wall';
    obstacle.parts = [part(0.025, 1, 2)];
    const w = empty([cube('moving', -2), obstacle]);
    const result = resolveSpatialEdit(w, move(w, 'moving', 2, 0), 'moving');
    expect(result.blocked).toBe(true);
    expect(result.workspace.objects[0].placement.x).toBeLessThan(-0.2624);
    expect(result.workspace.objects[0].placement.x).toBeGreaterThan(-0.27);
    expect(validateSceneCollisions(result.workspace)).toEqual([]);
    expect(w.objects[0].placement.x).toBe(-2);
  });
  it('blocks rotation and scale along the path, and rejects numeric edits atomically', () => {
    const bar = cube('bar', 0);
    bar.parts = [part(2, 0.3, 0.2)];
    const w = empty([bar, cube('blocker', 0, 0.8, 0.2)]);
    expect(() =>
      applyCommand(w, {
        type: 'update-object',
        id: 'bar',
        patch: { placement: { ...bar.placement, rotation: 180 } },
      }),
    ).toThrow(/blocked|intersect/);
    expect(() =>
      applyCommand(w, {
        type: 'update-object',
        id: 'bar',
        patch: { visual: { ...bar.visual, scale: { x: 1, y: 1, z: 3 } } },
      }),
    ).not.toThrow();
    const enlarged = empty([cube('box', -0.7), cube('neighbor', 0)]);
    expect(() =>
      applyCommand(enlarged, {
        type: 'update-object',
        id: 'box',
        patch: { visual: { ...defaultVisual(), scale: { x: 3, y: 1, z: 1 } } },
      }),
    ).toThrow(/blocked|intersect/);
  });
  it('uses individual desk solids so the empty space underneath remains usable', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const w = empty([desk, cube('under', 0, 2, 0.5)]);
    const result = resolveSpatialEdit(w, move(w, 'under', 0, -1), 'under');
    expect(result.blocked).toBe(false);
    expect(result.workspace.objects[1].placement.z).toBe(-1);
    expect(validateSceneCollisions(result.workspace)).toEqual([]);
  });
  it('does not treat the empty corners of a rotated bounding box as solid', () => {
    const bar = cube('bar', 0);
    bar.parts = [part(2, 0.2, 0.1)];
    bar.placement.rotation = 45;
    const corner = cube('corner', 0.6, 0.6, 0.1);
    const w = empty([bar, corner]);
    expect(validateSceneCollisions(w)).toEqual([]);
    expect(resolveSpatialEdit(w, move(w, 'corner', 0.7, 0.7), 'corner').blocked).toBe(false);
  });
  it('snaps using the object bottom on rotated and scaled desk surfaces', () => {
    const desk = {
      ...createSceneObject('desk'),
      id: 'desk',
      placement: { x: 0, y: 0, z: 0, rotation: 30 },
      visual: { ...defaultVisual(), scale: { x: 0.8, y: 1.2, z: 0.8 } },
    };
    const item = cube('item', 0);
    item.parts = [{ ...part(0.3, 0.3, 0.3), position: { x: 0, y: -0.3, z: 0 } }];
    const w = empty([desk, item]);
    const snapped = snapToSurface(w, 'item', 'desk');
    expect(getItemBounds(snapped.objects[1]).min.y).toBeCloseTo(
      getItemBounds(desk).max.y + 0.001,
      4,
    );
    expect(validateSceneCollisions(snapped)).toEqual([]);
    const floor = snapToSurface(move(snapped, 'item', 4, 3), 'item', 'floor');
    expect(getItemBounds(floor.objects[1]).min.y).toBeCloseTo(0.001, 5);
  });
  it('prevents edits that put geometry below the floor', () => {
    const w = empty([cube('item', 0)]);
    expect(() =>
      applyCommand(w, {
        type: 'update-object',
        id: 'item',
        patch: { parts: [{ ...part(), position: { x: 0, y: -1, z: 0 } }] },
      }),
    ).toThrow(/floor/);
    const proposed = cube('new', 2);
    proposed.parts[0].position.y = -1;
    expect(validateSceneCollisions(empty([...w.objects, proposed]), w)).toContain(
      'new goes through the floor.',
    );
  });
  it('keeps a snapped monitor resting on its desk when its height scale changes', () => {
    const desk: SceneObject = {
      ...cube('desk', 0),
      kind: 'desk',
      parts: [{ ...part(3, 0.1, 2), position: { x: 0, y: 1, z: 0 } }],
    };
    const original = createDemoWorkspace().devices.find((device) => device.kind === 'monitor')!;
    const base = empty([desk]);
    base.devices = [{ ...original, placement: { x: 0, y: 2.51, z: 0, rotation: 0 } }];
    for (const attached of [false, true]) {
      const resting = applyCommand(
        base,
        attached
          ? { type: 'attach-object', id: original.id, parentId: desk.id }
          : { type: 'snap-object', id: original.id, surfaceId: desk.id },
      );
      const bottom = getItemBounds(resting.devices[0]).min.y;
      for (const y of [0.5, 1.5]) {
        const changed = applyCommand(resting, {
          type: 'update-device',
          id: original.id,
          patch: { visual: { scale: { y } } },
        });
        expect(changed.devices[0].visual.scale.y).toBe(y);
        expect(getItemBounds(changed.devices[0]).min.y).toBeCloseTo(bottom, 7);
        expect(changed.devices[0].attachment).toEqual(resting.devices[0].attachment);
        expect(changed.devices[0].status).toBe(original.status);
        expect(validateSceneCollisions(changed)).toEqual([]);
      }
    }
  });
  it('preserves a resting custom shape’s gap while editing scale, part size and part rotation', () => {
    const shape = cube('offset', 0);
    shape.parts = [{ ...part(0.2, 0.2, 0.2), position: { x: 0, y: -0.2, z: 0 } }];
    const resting = snapToSurface(empty([shape]), shape.id, 'floor');
    const bottom = getItemBounds(resting.objects[0]).min.y;
    const resized = applyCommand(resting, {
      type: 'update-object',
      id: shape.id,
      patch: { visual: { scale: { y: 0.5 } } },
    });
    const enlargedPart = applyCommand(resting, {
      type: 'update-part',
      id: shape.id,
      index: 0,
      expectedLength: 1,
      patch: { size: { y: 0.4 } },
    });
    const rotatedPart = applyCommand(resting, {
      type: 'update-part',
      id: shape.id,
      index: 0,
      expectedLength: 1,
      patch: { rotation: { z: 45 } },
    });
    for (const changed of [resized, enlargedPart, rotatedPart]) {
      expect(getItemBounds(changed.objects[0]).min.y).toBeCloseTo(bottom, 7);
      expect(validateSceneCollisions(changed)).toEqual([]);
    }
    expect(() =>
      applyCommand(resting, {
        type: 'update-part',
        id: shape.id,
        index: 0,
        expectedLength: 1,
        patch: { position: { y: -0.5 } },
      }),
    ).toThrow(/floor/);
  });
  it('keeps explicit height edits and elevated placements instead of silently snapping them', () => {
    const shape = cube('offset', 0);
    shape.parts = [{ ...part(0.2, 0.2, 0.2), position: { x: 0, y: -0.2, z: 0 } }];
    const resting = snapToSurface(empty([shape]), shape.id, 'floor');
    const raised = applyCommand(resting, {
      type: 'update-object',
      id: shape.id,
      patch: { placement: { y: 0.8 }, visual: { scale: { y: 1.5 } } },
    });
    expect(raised.objects[0].placement.y).toBe(0.8);
    const resized = applyCommand(raised, {
      type: 'update-object',
      id: shape.id,
      patch: { visual: { scale: { y: 0.5 } } },
    });
    expect(resized.objects[0].placement.y).toBe(0.8);
    expect(validateSceneCollisions(resized)).toEqual([]);
    expect(() =>
      applyCommand(resting, {
        type: 'update-object',
        id: shape.id,
        patch: {
          placement: { y: resting.objects[0].placement.y },
          visual: { scale: { y: 1.5 } },
        },
      }),
    ).toThrow(/floor/);
  });
  it('allows existing imported overlaps to move apart without permitting deeper penetration', () => {
    const w = empty([cube('a', 0), cube('b', 0.3)]);
    expect(resolveSpatialEdit(w, move(w, 'a', -1, 0), 'a').blocked).toBe(false);
    expect(resolveSpatialEdit(w, move(w, 'a', 0.15, 0), 'a').blocked).toBe(true);
  });
  it('does not create fake history for an unchanged command', () => {
    const w = empty([cube('a', 0)]);
    expect(applyCommand(w, { type: 'update-object', id: 'a', patch: { name: 'a' } })).toBe(w);
  });
});

describe('desk attachments and paths', () => {
  function attached(): Workspace {
    const desk = {
      ...cube('desk', 0, 0, 1),
      kind: 'desk' as const,
      parts: [{ position: { x: 0, y: 1, z: 0 }, size: { x: 2, y: 0.1, z: 2 }, color: '#bb9977' }],
    };
    return applyCommand(empty([desk, cube('child', 0.4, 0, 0.2)]), {
      type: 'attach-object',
      id: 'child',
      parentId: 'desk',
    });
  }
  it('moves, rotates and resizes attached placements together, preserving child size and identity', () => {
    const w = attached();
    const desk = w.objects[0];
    const result = applyCommand(w, {
      type: 'update-object',
      id: 'desk',
      patch: {
        placement: { ...desk.placement, x: 1, rotation: 90 },
        visual: { ...desk.visual, scale: { x: 1.2, y: 1, z: 1 } },
      },
    });
    const child = result.objects[1];
    expect(child.placement.x).toBeCloseTo(1);
    expect(child.placement.z).toBeCloseTo(-0.48);
    expect(child.placement.rotation).toBe(90);
    expect(child.visual.scale).toEqual({ x: 1, y: 1, z: 1 });
    expect(child.attachment).toEqual({ parentId: 'desk' });
    expect(result.history).toHaveLength(w.history.length + 1);
    expect(parseWorkspace(JSON.parse(JSON.stringify(result)))).toEqual(result);
  });
  it('stops the whole desk when an attached object would hit a separate object', () => {
    const w = attached();
    const blocker = cube('blocker', 1, 0, 0.2);
    blocker.placement.y = w.objects[1].placement.y;
    w.objects.push(blocker);
    const result = resolveSpatialEdit(w, move(w, 'desk', 1, 0), 'desk');
    expect(result.blocked).toBe(true);
    expect(result.workspace.objects[0].placement.x).toBeLessThan(0.401);
    expect(
      result.workspace.objects[1].placement.x - result.workspace.objects[0].placement.x,
    ).toBeCloseTo(0.4);
    expect(validateSceneCollisions(result.workspace)).toEqual([]);
  });
  it('keeps an unscaled monitor resting above a vertically resized desk', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const original = createDemoWorkspace().devices.find((device) => device.kind === 'monitor')!;
    const base = empty([desk]);
    base.devices = [{ ...original, placement: { x: 0, y: 2.51, z: 0, rotation: 0 } }];
    const joined = applyCommand(base, { type: 'attach-object', id: original.id, parentId: 'desk' });
    expect(joined.devices[0].visual.source).toBe('user-reported');
    expect(joined.devices[0].source).toBe('demo');
    const resized = applyCommand(joined, {
      type: 'update-object',
      id: 'desk',
      patch: { visual: { ...desk.visual, scale: { x: 1, y: 1.5, z: 1 } } },
    });
    const gap = getItemBounds(resized.devices[0]).min.y - getItemBounds(resized.objects[0]).max.y;
    expect(gap).toBeCloseTo(0.0015, 5);
    expect(resized.devices[0].visual.scale).toEqual(original.visual.scale);
    expect(validateSceneCollisions(resized)).toEqual([]);
  });
  it('records explicit surface placement, detachment and device shape changes as visual user edits', () => {
    const original = createDemoWorkspace().devices.find((device) => device.kind === 'monitor')!;
    const base = empty([{ ...createSceneObject('desk'), id: 'desk' }]);
    base.devices = [{ ...original, placement: { x: 0, y: 2.51, z: 0, rotation: 0 } }];
    const snapped = applyCommand(base, { type: 'snap-object', id: original.id, surfaceId: 'desk' });
    expect(snapped.devices[0].visual.source).toBe('user-reported');
    const custom = applyCommand(base, {
      type: 'update-device',
      id: original.id,
      patch: { shapeMode: 'custom', parts: [part(0.2, 0.2, 0.2)] },
    });
    expect(custom.devices[0].visual.source).toBe('user-reported');
    expect(custom.devices[0].status).toBe('unknown');
    const attachedImport = structuredClone(base);
    attachedImport.devices[0].attachment = { parentId: 'desk' };
    const detached = applyCommand(attachedImport, {
      type: 'attach-object',
      id: original.id,
      parentId: null,
    });
    expect(detached.devices[0].visual.source).toBe('user-reported');
  });
  it('catches the arc of a tiny attached object far from its desk pivot', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    let w = applyCommand(empty([desk, cube('tiny', 3, 0, 0.015)]), {
      type: 'attach-object',
      id: 'tiny',
      parentId: 'desk',
    });
    const half = (2 * Math.PI) / 180;
    const obstruction = cube('arc-obstacle', 3 * Math.cos(half), -3 * Math.sin(half), 0.005);
    obstruction.placement.y = w.objects[1].placement.y;
    w = empty([...w.objects, obstruction]);
    const result = resolveSpatialEdit(w, move(w, 'desk', 0, 0, 4), 'desk');
    expect(result.blocked).toBe(true);
    expect(result.workspace.objects[0].placement.rotation).toBeLessThan(2);
    expect(validateSceneCollisions(result.workspace)).toEqual([]);
  });
  it('can move a child alone, detach without a jump, and delete its desk without deleting it', () => {
    let w = attached();
    const child = w.objects[1];
    w = applyCommand(w, {
      type: 'update-object',
      id: child.id,
      patch: { placement: { ...child.placement, x: 0.6 } },
    });
    expect(w.objects[0].placement.x).toBe(0);
    const position = { ...w.objects[1].placement };
    const detached = applyCommand(w, { type: 'attach-object', id: child.id, parentId: null });
    expect(detached.objects[1].placement).toEqual(position);
    const deleted = applyCommand(w, { type: 'remove-object', id: 'desk' });
    expect(deleted.objects).toHaveLength(1);
    expect(deleted.objects[0].attachment).toBeNull();
    expect(deleted.objects[0].placement).toEqual(position);
  });
  it('rejects dangling, self, non-desk and cyclic attachment imports', () => {
    const w = attached();
    for (const parentId of ['missing', 'child']) {
      const broken = structuredClone(w);
      broken.objects[1].attachment = { parentId };
      expect(() => parseWorkspace(broken)).toThrow(/attachment/i);
    }
    w.objects[0].attachment = { parentId: 'child' };
    expect(() => parseWorkspace(w)).toThrow(/attachment/i);
  });
  it('replays a curved drag as one edit without inventing a straight shortcut through obstacles', () => {
    const w = empty([cube('a', -1), cube('b', 0)]);
    const path = [
      { x: -1, y: 0.001, z: 1, rotation: 0 },
      { x: 1, y: 0.001, z: 1, rotation: 0 },
      { x: 1, y: 0.001, z: 0, rotation: 0 },
    ];
    const next = applyCommand(w, {
      type: 'move-object',
      id: 'a',
      placement: path.at(-1)!,
      dragPath: path,
    });
    expect(next.objects[0].placement.x).toBe(1);
    expect(next.history).toHaveLength(1);
    expect(() =>
      applyCommand(w, {
        type: 'move-object',
        id: 'a',
        placement: path.at(-1)!,
        dragPath: [path.at(-1)!],
      }),
    ).toThrow(/blocked|changed/);
    expect(() =>
      applyCommand(w, {
        type: 'move-object',
        id: 'a',
        placement: path.at(-1)!,
        dragPath: [path[0]],
      }),
    ).toThrow(/path/);
  });
});

describe('photo proposal spatial fitting', () => {
  it('places pending candidates in clear positions while preserving retained objects', () => {
    const retained = cube('retained', 0);
    const base = empty([retained]);
    const proposed = empty([retained, cube('new-a', 0), cube('new-b', 0)]);
    const fitted = fitSceneProposal(base, proposed, ['new-a', 'new-b']);
    expect(fitted.objects[0]).toEqual(retained);
    expect(validateSceneCollisions(fitted, base)).toEqual([]);
    expect(fitted.objects[1].placement).not.toEqual(fitted.objects[2].placement);
    expect(base.objects).toEqual([retained]);
  });
  it('keeps an attached candidate on its required desk during free placement', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const child = cube('child', 0);
    child.attachment = { parentId: 'desk' };
    const placed = findFreePlacement(empty([desk, child]), child.id);
    expect(getItemBounds(placed.objects[1]).min.y).toBeCloseTo(
      getItemBounds(desk).max.y + 0.001,
      4,
    );
    expect(placed.objects[1].attachment).toEqual({ parentId: 'desk' });
  });
  it('preserves the offset of a retained child when a proposed existing desk moves', () => {
    const desk = {
      ...cube('desk', 0, 0, 1),
      kind: 'desk' as const,
      parts: [{ position: { x: 0, y: 1, z: 0 }, size: { x: 2, y: 0.1, z: 2 }, color: '#bb9977' }],
    };
    const base = applyCommand(empty([desk, cube('child', 0.4, 0, 0.2)]), {
      type: 'attach-object',
      id: 'child',
      parentId: 'desk',
    });
    const proposed = move(base, 'desk', 0.5, 0, 30);
    const fitted = fitSceneProposal(base, proposed, ['desk']);
    expect(fitted.objects[1].placement.x - fitted.objects[0].placement.x).toBeCloseTo(
      0.4 * Math.cos(Math.PI / 6),
    );
    expect(fitted.objects[1].placement.z - fitted.objects[0].placement.z).toBeCloseTo(-0.2);
    expect(fitted.objects[1].attachment).toEqual({ parentId: 'desk' });
    expect(validateSceneCollisions(fitted, base)).toEqual([]);
  });
  it('fits a matched photo device back to its required desk if its proposed footprint leaves it', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const base = applyCommand(empty([desk, cube('child', 0, 0, 0.2)]), {
      type: 'attach-object',
      id: 'child',
      parentId: 'desk',
    });
    const proposed = move(base, 'child', 4, 3.5);
    expect(validateSceneCollisions(proposed, base)).toContain(
      'child must stay over its attached desk.',
    );
    const fitted = fitSceneProposal(base, proposed, ['child']);
    expect(validateSceneCollisions(fitted, base)).toEqual([]);
    expect(fitted.objects[1].attachment).toEqual({ parentId: 'desk' });
  });
  it('rebases a restored original record onto the desk transform currently shown in a preview', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const base = applyCommand(empty([desk, cube('child', 0.4, 0, 0.2)]), {
      type: 'attach-object',
      id: 'child',
      parentId: 'desk',
    });
    const preview = move(base, 'desk', 1, 0, 90);
    const placement = rebaseAttachedPlacement(base, preview, base.objects[1]);
    expect(placement.x).toBeCloseTo(1);
    expect(placement.z).toBeCloseTo(-0.4);
    expect(placement.rotation).toBe(90);
    expect(base.objects[1].placement.x).toBe(0.4);
  });
});

describe('legacy compatibility', () => {
  it('reads original v1 unknown keys and wider coordinates written by the old drag UI', () => {
    const input = structuredClone(legacy) as typeof legacy & { uiCache?: string };
    input.uiCache = 'ignored legacy presentation data';
    Object.assign(input.devices[0], { oldDecoration: 'ignored' });
    Object.assign(input.devices[0].placement, { x: 4.1, z: 3.2, obsolete: true });
    const original = JSON.stringify(input);
    const upgraded = parseWorkspace(input);
    expect(upgraded.devices[0].placement).toEqual({ x: 4.1, y: 2.51, z: 3.2, rotation: 10 });
    expect(upgraded.devices[0].status).toBe('reported-working');
    expect(upgraded.connections).toEqual(input.connections);
    expect(upgraded.history).toEqual(input.history);
    expect(JSON.stringify(input)).toBe(original);
    expect(upgraded.objects.some((item) => item.kind === 'desk')).toBe(true);
    expect(upgraded.devices[0].attachment).toBeUndefined();
  });
  it('keeps v2 generic composition without forcing attachments or writing a new version', () => {
    const w = createDemoWorkspace();
    const generic = cube('custom-old', 3, 3);
    delete generic.shapeMode;
    w.objects.push(generic);
    expect(parseWorkspace(JSON.parse(JSON.stringify(w)))).toEqual(w);
  });
  it('retains legacy device identities even if they collide with generated furniture IDs', () => {
    const input = structuredClone(legacy);
    input.devices[0].id = 'decor-desk';
    input.connections[0].from = 'decor-desk';
    const upgraded = parseWorkspace(input);
    expect(upgraded.devices[0].id).toBe('decor-desk');
    expect(upgraded.connections[0].from).toBe('decor-desk');
    expect(upgraded.objects.find((item) => item.kind === 'desk')?.id).toBe('decor-desk-migrated-1');
    expect(parseWorkspace(input)).toEqual(upgraded);
  });
});

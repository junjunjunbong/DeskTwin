import { describe, expect, it } from 'vitest';
import legacy from '../../tests/fixtures/workspace-v1.json';
import {
  applyCommand,
  createDemoWorkspace,
  createSceneObject,
  defaultVisual,
  DeviceSchema,
  parseWorkspace,
  WorkspaceSchema,
  type BoxPart,
  type SceneObject,
  type Workspace,
} from './workspace';
import {
  findFreePlacement,
  fitSceneProposal,
  fitSceneProposalForReview,
  getRestingSurfaceId,
  getScenePlacementIssues,
  getSurfaceTargets,
  getItemBounds,
  rebaseAttachedPlacement,
  resolveSpatialEdit,
  snapToSurface,
  validateSceneCollisions,
  evaluateSceneSupport,
  getSceneCollisionPairs,
  getUnambiguousCoveringSupport,
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
  it('adds a manually entered monitor to a clear tabletop position without changing saved records', () => {
    const base = createDemoWorkspace();
    const original = structuredClone(base);
    const device = DeviceSchema.parse({
      id: 'manual-monitor',
      name: 'My unsaved setup monitor',
      kind: 'monitor',
      model: '',
      source: 'user-reported',
      status: 'unknown',
      statusNote: '',
      placement: { x: 0, z: 0.35, rotation: 0 },
    });
    const result = applyCommand(base, { type: 'add-device', device });
    const placed = result.devices.find((item) => item.id === device.id)!;
    const desk = result.objects.find((item) => item.id === 'decor-desk')!;
    expect(placed).toMatchObject({
      id: device.id,
      name: device.name,
      kind: 'monitor',
      source: 'user-reported',
      status: 'unknown',
      statusNote: '',
    });
    // Thin covering contact now has the same partial-overlap policy in manual
    // search and photo review. A clear mat edge is a valid tabletop position too.
    const restingId = getRestingSurfaceId(result, placed.id);
    expect([desk.id, 'decor-desk-mat']).toContain(restingId);
    const support = result.objects.find((entry) => entry.id === restingId)!;
    expect(getItemBounds(placed).min.y).toBeCloseTo(getItemBounds(support).max.y + 0.001, 6);
    expect(validateSceneCollisions(result, base)).toEqual([]);
    expect(result.devices.filter((item) => item.id !== device.id)).toEqual(base.devices);
    expect(result.objects).toEqual(base.objects);
    expect(result.connections).toEqual(base.connections);
    expect(result.history).toHaveLength(base.history.length + 1);
    expect(base).toEqual(original);
  });

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
  const photoDevice = (kind: 'keyboard' | 'monitor', id: string, x: number, y: number, z: number) =>
    DeviceSchema.parse({
      id,
      kind,
      name: id,
      model: '',
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
      placement: { x, y, z, rotation: 0 },
      visual: defaultVisual('photo-inferred'),
      parts: [],
      shapeMode: 'template',
    });

  it('fits desk, mat and riser before their devices without changing relative X/Z', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const mat = {
      ...createSceneObject('mat'),
      id: 'mat',
      placement: { x: 0.15, y: 2.52, z: 0.7, rotation: 0 },
    };
    const riser = {
      ...createSceneObject('monitor-riser'),
      id: 'riser',
      placement: { x: -0.2, y: 2.51, z: -0.6, rotation: 0 },
    };
    const retained = cube('retained', 4, 3);
    const base = empty([retained]);
    const draft = empty([retained, mat, riser, desk]);
    draft.devices = [
      photoDevice('keyboard', 'keyboard', 0, 2.54, 0.7),
      photoDevice('monitor', 'monitor', -0.2, 3.01, -0.6),
    ];
    const relations = [
      { itemId: 'keyboard', surfaceId: 'mat' },
      { itemId: 'monitor', surfaceId: 'riser' },
      { itemId: 'mat', surfaceId: 'desk' },
      { itemId: 'riser', surfaceId: 'desk' },
      { itemId: 'desk', surfaceId: 'floor' },
    ];
    const result = fitSceneProposalForReview(
      base,
      draft,
      ['keyboard', 'monitor', 'mat', 'riser', 'desk'],
      relations,
    );
    expect(result.issues).toEqual([]);
    expect(result.draft.objects[0]).toEqual(retained);
    for (const original of [...draft.devices, ...draft.objects]) {
      const placed = [...result.draft.devices, ...result.draft.objects].find(
        (item) => item.id === original.id,
      )!;
      expect(placed.placement.x).toBe(original.placement.x);
      expect(placed.placement.z).toBe(original.placement.z);
      expect(placed.placement.rotation).toBe(original.placement.rotation);
    }
    for (const relation of relations.filter((entry) => entry.surfaceId !== 'floor')) {
      const placed = [...result.draft.devices, ...result.draft.objects];
      expect(getItemBounds(placed.find((item) => item.id === relation.itemId)!).min.y).toBeCloseTo(
        getItemBounds(placed.find((item) => item.id === relation.surfaceId)!).max.y + 0.001,
        6,
      );
    }
    expect(
      getScenePlacementIssues(
        base,
        result.draft,
        relations.map((entry) => entry.itemId),
        relations,
      ),
    ).toEqual([]);
  });

  it('infers a desk mat beneath a device even when devices precede objects in scene storage', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const mat = {
      ...createSceneObject('mat'),
      id: 'mat',
      placement: { x: 0.15, y: 2.52, z: 0.65, rotation: 0 },
    };
    const draft = empty([mat, desk]);
    draft.devices.push(photoDevice('keyboard', 'keyboard', 0, 2.54, 0.5));
    const result = fitSceneProposalForReview(empty([]), draft, ['keyboard', 'mat', 'desk']);
    expect(result.issues).toEqual([]);
    expect(result.draft.objects[0].placement.y).toBeGreaterThan(2);
    expect(getItemBounds(result.draft.devices[0]).min.y).toBeCloseTo(
      getItemBounds(result.draft.objects[0]).max.y + 0.001,
      6,
    );
  });

  it('keeps an oversized tabletop item visible for review instead of dropping it to the floor', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const mat = {
      ...createSceneObject('mat'),
      id: 'mat',
      visual: { ...defaultVisual('photo-inferred'), scale: { x: 3, y: 1, z: 1 } },
      placement: { x: 0, y: 2.52, z: 0.5, rotation: 0 },
    };
    const draft = empty([desk, mat]);
    const result = fitSceneProposalForReview(empty([]), draft, ['desk', 'mat']);
    expect(result.draft.objects[1].placement).toEqual(mat.placement);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ itemId: 'mat', code: 'support' }),
    );
    expect(() => fitSceneProposal(empty([]), draft, ['desk', 'mat'])).toThrow(/resting|support/i);
  });

  it('reports collisions while preserving proposed X/Z and every untouched retained record', () => {
    const retained = cube('retained', 0);
    const base = empty([retained]);
    const draft = empty([retained, cube('new', 0)]);
    const result = fitSceneProposalForReview(base, draft, ['new']);
    expect(result.draft.objects).toEqual(draft.objects);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ itemId: 'new', code: 'collision' }),
    );
    expect(base).toEqual(empty([retained]));
  });

  it('keeps missing and cyclic support relationships reviewable without any relocation', () => {
    const draft = empty([cube('one', -1), cube('two', 1)]);
    const missing = fitSceneProposalForReview(
      empty([]),
      draft,
      ['one'],
      [{ itemId: 'one', surfaceId: 'missing' }],
    );
    expect(missing.draft).toEqual(draft);
    expect(missing.issues).toContainEqual(
      expect.objectContaining({ itemId: 'one', code: 'support' }),
    );
    const cyclic = fitSceneProposalForReview(
      empty([]),
      draft,
      ['one', 'two'],
      [
        { itemId: 'one', surfaceId: 'two' },
        { itemId: 'two', surfaceId: 'one' },
      ],
    );
    expect(cyclic.draft).toEqual(draft);
    expect(cyclic.issues.filter((issue) => issue.message.includes('circular'))).toHaveLength(2);
  });

  it('keeps an out-of-range support fit bounded and editable rather than mutating its height before failing', () => {
    const item = cube('low-origin', 0);
    item.parts = [{ ...part(0.2, 0.2, 0.2), position: { x: 0, y: -6, z: 0 } }];
    const draft = empty([item]);
    const result = fitSceneProposalForReview(
      empty([]),
      draft,
      ['low-origin'],
      [{ itemId: 'low-origin', surfaceId: 'floor' }],
    );
    expect(result.draft.objects[0].placement).toEqual(item.placement);
    expect(() => WorkspaceSchema.parse(result.draft)).not.toThrow();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ itemId: 'low-origin', code: 'support' }),
    );
  });

  it('offers and deliberately places on a mat, riser or laptop stand while retaining desk-only attachments', () => {
    const mat = {
      ...createSceneObject('mat'),
      id: 'mat',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
    };
    const riser = {
      ...createSceneObject('monitor-riser'),
      id: 'riser',
      placement: { x: 2, y: 0, z: 0, rotation: 0 },
    };
    const stand = {
      ...createSceneObject('laptop-stand'),
      id: 'stand',
      placement: { x: -2, y: 0, z: 0, rotation: 0 },
    };
    const workspace = empty([mat, riser, stand, cube('item', 0, 2, 0.2)]);
    expect(getSurfaceTargets(workspace, 'item').map((target) => target.id)).toEqual(
      expect.arrayContaining(['floor', 'mat', 'riser', 'stand']),
    );
    for (const supportId of ['mat', 'riser', 'stand']) {
      const placed = snapToSurface(workspace, 'item', supportId);
      const item = placed.objects.find((entry) => entry.id === 'item')!;
      const support = placed.objects.find((entry) => entry.id === supportId)!;
      expect(getItemBounds(item).min.y).toBeCloseTo(getItemBounds(support).max.y + 0.001, 6);
      expect(getRestingSurfaceId(placed, 'item')).toBe(supportId);
      expect(item.attachment).toBeFalsy();
    }
  });

  it('permits a light bar to rest on the monitor top without offering monitors to other items', () => {
    const monitor = photoDevice('monitor', 'monitor', 0, 0, 0);
    const light = {
      ...createSceneObject('light-bar'),
      id: 'light',
      placement: { x: 0, y: 1.51, z: 0, rotation: 0 },
    };
    const draft = empty([light, cube('other', 2)]);
    draft.devices = [monitor];
    expect(getSurfaceTargets(draft, 'light').map((target) => target.id)).toContain('monitor');
    expect(getSurfaceTargets(draft, 'other').map((target) => target.id)).not.toContain('monitor');
    const result = fitSceneProposalForReview(
      empty([]),
      draft,
      ['light'],
      [{ itemId: 'light', surfaceId: 'monitor' }],
    );
    expect(result.issues).toEqual([]);
    expect(getItemBounds(result.draft.objects[0]).min.y).toBeCloseTo(
      getItemBounds(monitor).max.y + 0.001,
      6,
    );
  });

  it('keeps an explicit desk attachment when placing a child on a mat over that desk', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const mat = {
      ...createSceneObject('mat'),
      id: 'mat',
      placement: { x: 0, y: 2.4855, z: 0, rotation: 0 },
    };
    const item = cube('item', 0, 0, 0.2);
    item.placement.y = 2.514;
    item.attachment = { parentId: 'desk' };
    const placed = snapToSurface(empty([desk, mat, item]), 'item', 'mat');
    expect(placed.objects[2].attachment).toEqual({ parentId: 'desk' });
    expect(getRestingSurfaceId(placed, 'item')).toBe('mat');
  });

  it('carries retained attached records with a proposed desk and reports a newly blocked carry', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const child = cube('child', 0.4, 0, 0.2);
    const base = applyCommand(empty([desk, child]), {
      type: 'attach-object',
      id: 'child',
      parentId: 'desk',
    });
    const draft = move(base, 'desk', 0.5, 0, 30);
    const result = fitSceneProposalForReview(base, draft, ['desk']);
    expect(result.issues).toEqual([]);
    expect(result.draft.objects[1].placement).toEqual(
      rebaseAttachedPlacement(base, result.draft, base.objects[1]),
    );
    expect(result.draft.objects[1].visual).toEqual(base.objects[1].visual);
    expect(result.draft.objects[1].parts).toEqual(base.objects[1].parts);
    const blocker = cube(
      'blocker',
      result.draft.objects[1].placement.x,
      result.draft.objects[1].placement.z,
      0.2,
    );
    blocker.placement.y = result.draft.objects[1].placement.y;
    const blockedBase = { ...base, objects: [...base.objects, blocker] };
    const blockedDraft = { ...draft, objects: [...draft.objects, blocker] };
    const blocked = fitSceneProposalForReview(blockedBase, blockedDraft, ['desk']);
    expect(blocked.draft.objects[2]).toEqual(blocker);
    expect(blocked.issues).toContainEqual(
      expect.objectContaining({ itemId: 'child', code: 'retained-placement' }),
    );
  });

  it('preserves a valid retained child record when a resized desk would carry it outside scene bounds', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const base = applyCommand(empty([desk, cube('child', 3, 0, 0.2)]), {
      type: 'attach-object',
      id: 'child',
      parentId: 'desk',
    });
    const draft = structuredClone(base);
    draft.objects[0].visual.scale = { x: 3, y: 1, z: 1 };
    draft.objects[0].placement.x = 4.3;
    const result = fitSceneProposalForReview(base, draft, ['desk']);
    expect(result.draft.objects[1]).toEqual(base.objects[1]);
    expect(rebaseAttachedPlacement(base, draft, base.objects[1])).toEqual(
      base.objects[1].placement,
    );
    expect(() => WorkspaceSchema.parse(result.draft)).not.toThrow();
    expect(result.issues).toContainEqual(
      expect.objectContaining({ itemId: 'child', code: 'retained-placement' }),
    );
  });

  it('keeps manual retained-child edits when a later support fit uses the current preview frame', () => {
    const desk = { ...createSceneObject('desk'), id: 'desk' };
    const base = applyCommand(empty([desk, cube('child', 0, 0, 0.2)]), {
      type: 'attach-object',
      id: 'child',
      parentId: 'desk',
    });
    const initial = fitSceneProposalForReview(base, move(base, 'desk', 0.5, 0), ['desk']).draft;
    const edited = move(initial, 'child', 1, 0);
    const result = fitSceneProposalForReview(
      base,
      edited,
      ['desk'],
      [{ itemId: 'desk', surfaceId: 'floor' }],
      { carryFrom: edited },
    );
    expect(result.draft.objects[1]).toEqual(edited.objects[1]);
    expect(result.issues).toEqual([]);
  });

  it('accepts the exact existing floor-origin clamp for chair wheels without broadening the resting tolerance', () => {
    const chair = {
      ...createSceneObject('chair'),
      id: 'chair',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
    };
    const result = fitSceneProposalForReview(empty([]), empty([chair]), ['chair']);
    expect(result.draft.objects[0].placement.y).toBe(0);
    expect(result.issues).toEqual([]);
    expect(getRestingSurfaceId(result.draft, 'chair')).toBe('floor');
    const raised = structuredClone(result.draft);
    raised.objects[0].placement.y = 0.03;
    expect(getScenePlacementIssues(empty([]), raised, ['chair'])).toContainEqual(
      expect.objectContaining({ itemId: 'chair', code: 'support' }),
    );
  });

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

describe('shared photo contact policies', () => {
  function device(id: string, kind: 'keyboard' | 'laptop' | 'monitor', x = 0, y = 2.5, z = 0) {
    return DeviceSchema.parse({
      id,
      kind,
      name: id,
      model: '',
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
      placement: { x, y, z, rotation: 0 },
      visual: defaultVisual('photo-inferred'),
    });
  }
  function deskAndMat() {
    const desk = {
      ...createSceneObject('desk'),
      id: 'desk',
      placement: { x: 0, y: 0.001, z: 0, rotation: 0 },
    };
    const mat = {
      ...createSceneObject('mat'),
      id: 'mat',
      placement: { x: 0, y: 2.4855, z: 0, rotation: 0 },
    };
    return empty([desk, mat]);
  }
  function standAndLaptop() {
    const desk = {
      ...createSceneObject('desk'),
      id: 'desk',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
    };
    const stand = {
      ...createSceneObject('laptop-stand'),
      id: 'stand',
      placement: { x: 2, y: 2.4835, z: -0.1, rotation: -15 },
      visual: { ...defaultVisual(), scale: { x: 0.8, y: 0.8, z: 0.8 } },
    };
    const laptop = device('laptop', 'laptop', 2, 2.8128, -0.1);
    laptop.placement.rotation = -15;
    laptop.visual.scale = { x: 0.95, y: 0.9, z: 0.95 };
    const workspace = empty([desk, stand]);
    workspace.devices = [laptop];
    return workspace;
  }
  const laptopRelations = [
    { itemId: 'desk', surfaceId: 'floor' },
    { itemId: 'stand', surfaceId: 'desk' },
    { itemId: 'laptop', surfaceId: 'stand' },
  ];

  it('keeps a valid partial-mat placement unchanged in review, snapping and free placement', () => {
    const draft = deskAndMat();
    draft.devices.push(device('keyboard', 'keyboard', 1.7, 2.49));
    const fit = fitSceneProposalForReview(
      empty([]),
      draft,
      ['keyboard'],
      [{ itemId: 'keyboard', surfaceId: 'mat' }],
    );
    expect(fit.issues).toEqual([]);
    expect(fit.draft.devices[0].placement.x).toBe(1.7);
    expect(evaluateSceneSupport(fit.draft, 'keyboard', 'mat')).toMatchObject({
      available: true,
      footprintValid: true,
      resting: true,
    });
    const snapped = snapToSurface(fit.draft, 'keyboard', 'mat');
    const searched = findFreePlacement(fit.draft, 'keyboard', { surfaceId: 'mat' });
    expect(snapped.devices[0].placement).toEqual(fit.draft.devices[0].placement);
    expect(searched.devices[0].placement).toEqual(fit.draft.devices[0].placement);
    expect(validateSceneCollisions(snapped)).toEqual([]);
  });

  it('still searches the desk after every partial-contact position on an occupied mat is blocked', () => {
    const draft = deskAndMat();
    const blocker = cube('blocker', 0);
    blocker.placement.y = 2.514;
    blocker.parts = [part(3.8, 0.5, 1.6)];
    draft.objects.push(blocker);
    draft.devices = [device('new-monitor', 'monitor', 0, 2.51, 0.35)];
    const before = structuredClone(draft);
    const result = findFreePlacement(draft, 'new-monitor', { allowFloorFallback: false });
    expect(getRestingSurfaceId(result, 'new-monitor')).toBe('desk');
    expect(validateSceneCollisions(result)).toEqual([]);
    expect(result.objects).toEqual(before.objects);
    expect(draft).toEqual(before);
  });

  it('fits the sanitized laptop overhang without changing either object size or horizontal pose', () => {
    const draft = standAndLaptop();
    const result = fitSceneProposalForReview(
      empty([]),
      draft,
      ['desk', 'stand', 'laptop'],
      laptopRelations,
    );
    expect(result.issues).toEqual([]);
    expect(result.draft.devices[0].placement.y - draft.devices[0].placement.y).toBeCloseTo(
      0.00295,
      8,
    );
    for (const original of [...draft.devices, ...draft.objects]) {
      const fitted = [...result.draft.devices, ...result.draft.objects].find(
        (entry) => entry.id === original.id,
      )!;
      expect(fitted.visual.scale).toEqual(original.visual.scale);
      expect({
        x: fitted.placement.x,
        z: fitted.placement.z,
        rotation: fitted.placement.rotation,
      }).toEqual({
        x: original.placement.x,
        z: original.placement.z,
        rotation: original.placement.rotation,
      });
    }
    expect(validateSceneCollisions(result.draft)).toEqual([]);
    expect(evaluateSceneSupport(result.draft, 'laptop', 'stand').footprintValid).toBe(true);
    expect(snapToSurface(result.draft, 'laptop', 'stand').devices[0].placement).toEqual(
      result.draft.devices[0].placement,
    );
  });

  it('accepts the explicit 5-percent-per-edge boundary and rejects excessive or off-centre overhang', () => {
    const draft = standAndLaptop();
    // The stand is 1.2 wide. A centred 1.32 base extends 0.06 beyond each edge.
    draft.devices[0].visual.scale.x = 1.32 / 1.35;
    expect(evaluateSceneSupport(draft, 'laptop', 'stand').footprintValid).toBe(true);
    draft.devices[0].visual.scale.x = 1.322 / 1.35;
    expect(evaluateSceneSupport(draft, 'laptop', 'stand').footprintValid).toBe(false);
    const offset = standAndLaptop();
    // Translate along the stand's local X axis, keeping the same yaw.
    offset.devices[0].placement.x += 0.03 * Math.cos((-15 * Math.PI) / 180);
    offset.devices[0].placement.z -= 0.03 * Math.sin((-15 * Math.PI) / 180);
    expect(evaluateSceneSupport(offset, 'laptop', 'stand').footprintValid).toBe(false);
  });

  it('keeps exact solid collision checks for an allowed support pair', () => {
    const fit = fitSceneProposalForReview(
      empty([]),
      standAndLaptop(),
      ['desk', 'stand', 'laptop'],
      laptopRelations,
    );
    fit.draft.devices[0].placement.y -= 0.02;
    const pairs = getSceneCollisionPairs(fit.draft);
    expect(pairs).toEqual([expect.objectContaining({ itemIds: ['laptop', 'stand'] })]);
    expect(pairs[0].penetration).toBeGreaterThan(0);
    expect(
      getScenePlacementIssues(empty([]), fit.draft, ['laptop', 'stand'], laptopRelations),
    ).toContainEqual(
      expect.objectContaining({ itemId: 'laptop', relatedItemId: 'stand', rootCause: 'collision' }),
    );
    expect(validateSceneCollisions(fit.draft)).not.toEqual([]);
  });

  it('uses the central light mount and the monitor foot instead of their visual envelopes', () => {
    const monitor = device('monitor', 'monitor', 0, 0);
    monitor.visual.scale.x = 0.5;
    const light = {
      ...createSceneObject('light-bar'),
      id: 'light',
      placement: { x: 0, y: 1.51, z: 0, rotation: 0 },
    };
    const draft = empty([light]);
    draft.devices = [monitor];
    const fit = fitSceneProposalForReview(
      empty([]),
      draft,
      ['light'],
      [{ itemId: 'light', surfaceId: 'monitor' }],
    );
    expect(fit.issues).toEqual([]);
    expect(getItemBounds(light).max.x - getItemBounds(light).min.x).toBeGreaterThan(
      getItemBounds(monitor).max.x - getItemBounds(monitor).min.x,
    );
    fit.draft.objects[0].placement.z = 0.2;
    expect(evaluateSceneSupport(fit.draft, 'light', 'monitor').footprintValid).toBe(false);

    const riser = {
      ...createSceneObject('monitor-riser'),
      id: 'riser',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
      visual: { ...defaultVisual(), scale: { x: 0.4, y: 1, z: 1 } },
    };
    const wideMonitor = device('wide-monitor', 'monitor', 0, 0.5);
    const supported = empty([riser]);
    supported.devices = [wideMonitor];
    expect(evaluateSceneSupport(supported, 'wide-monitor', 'riser').footprintValid).toBe(true);
  });

  it('uses a custom support actual local face without lifting an unrelated object to a remote bump', () => {
    const desk = {
      ...createSceneObject('desk'),
      id: 'desk',
      shapeMode: 'custom' as const,
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
      parts: [
        { ...part(4, 0.1, 2), position: { x: 0, y: 1, z: 0 } },
        { ...part(0.01, 0.05, 0.01), position: { x: 1.9, y: 1.075, z: 0 } },
      ],
    };
    const draft = empty([desk]);
    draft.devices = [device('keyboard', 'keyboard', -1, 1.05)];
    const fit = fitSceneProposalForReview(
      empty([]),
      draft,
      ['keyboard'],
      [{ itemId: 'keyboard', surfaceId: 'desk' }],
    );
    expect(fit.issues).toEqual([]);
    expect(getItemBounds(fit.draft.devices[0]).min.y).toBeCloseTo(1.051, 8);
    expect(getItemBounds(desk).max.y).toBeCloseTo(1.1, 8);
    expect(snapToSurface(fit.draft, 'keyboard', 'desk').devices[0].placement).toEqual(
      fit.draft.devices[0].placement,
    );
  });

  it('uses the actual custom desk face consistently for attachment validation, snapping, search and carry', () => {
    const desk = {
      ...createSceneObject('desk'),
      id: 'desk',
      shapeMode: 'custom' as const,
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
      parts: [
        { ...part(2, 0.2, 2), position: { x: -1, y: 1, z: 0 } },
        { ...part(1, 0.2, 1), position: { x: 1.5, y: 1.5, z: 0 } },
      ],
    };
    const child = cube('child', 1.5, 0, 0.4);
    child.placement.y = 1.601;
    child.attachment = { parentId: 'desk' };
    const draft = empty([desk, child]);
    expect(evaluateSceneSupport(draft, 'child', 'desk')).toMatchObject({
      available: true,
      footprintValid: true,
      resting: true,
    });
    expect(getScenePlacementIssues(empty([]), draft, ['child'])).toEqual([]);
    expect(validateSceneCollisions(draft)).toEqual([]);
    const snapped = snapToSurface(draft, 'child', 'desk');
    const free = findFreePlacement(draft, 'child');
    const directSnap = resolveSpatialEdit(draft, draft, 'child', { snap: 'desk', sweep: false });
    expect(snapped.objects[1]).toEqual(child);
    expect(free.objects[1]).toEqual(child);
    expect(directSnap.blocked, directSnap.reason).toBe(false);
    expect(validateSceneCollisions(free)).toEqual([]);
    const carry = resolveSpatialEdit(draft, move(draft, 'desk', 0.1, 0), 'desk', { sweep: false });
    expect(carry.blocked, carry.reason).toBe(false);
    expect(carry.workspace.objects[1].placement.x).toBeCloseTo(1.6, 8);
    expect(evaluateSceneSupport(carry.workspace, 'child', 'desk').resting).toBe(true);
    expect(validateSceneCollisions(carry.workspace)).toEqual([]);
    const leavesBothFaces = resolveSpatialEdit(draft, move(draft, 'child', 0.5, 0), 'child', {
      sweep: false,
    });
    expect(leavesBothFaces.blocked).toBe(true);
    expect(leavesBothFaces.reason).toMatch(/attached desk/);

    const mat = {
      ...createSceneObject('mat'),
      id: 'mat',
      placement: { x: 1.5, y: 1.601, z: 0, rotation: 0 },
      visual: { ...defaultVisual(), scale: { x: 0.2, y: 1, z: 0.4 } },
    };
    const onMat = snapToSurface(empty([desk, child, mat]), 'child', 'mat');
    expect(onMat.objects[1].attachment).toEqual({ parentId: 'desk' });
    expect(evaluateSceneSupport(onMat, 'child', 'mat').resting).toBe(true);
    expect(validateSceneCollisions(onMat)).toEqual([]);
  });

  it('bounds model height changes, allows an explicit user choice and respects user locks', () => {
    const draft = deskAndMat();
    draft.objects = draft.objects.filter((entry) => entry.id === 'desk');
    draft.devices = [device('keyboard', 'keyboard', 0, 5)];
    const model = fitSceneProposalForReview(
      empty([]),
      draft,
      ['keyboard'],
      [{ itemId: 'keyboard', surfaceId: 'desk', source: 'model' }],
    );
    expect(model.draft.devices[0].placement.y).toBe(5);
    expect(model.issues).toContainEqual(
      expect.objectContaining({
        itemId: 'keyboard',
        rootCause: 'height-budget',
        relatedItemId: 'desk',
      }),
    );
    const relation = [{ itemId: 'keyboard', surfaceId: 'desk', source: 'user' as const }];
    const user = fitSceneProposalForReview(empty([]), draft, ['keyboard'], relation);
    expect(user.issues).toEqual([]);
    expect(user.draft.devices[0].placement.y).toBeCloseTo(2.4755, 8);
    const locked = fitSceneProposalForReview(empty([]), draft, ['keyboard'], relation, {
      lockedIds: ['keyboard'],
    });
    expect(locked.draft.devices[0].placement.y).toBe(5);
    expect(locked.issues).toContainEqual(
      expect.objectContaining({ itemId: 'keyboard', rootCause: 'height' }),
    );
  });

  it('preserves a usable lower face and chooses the nearest valid face on a multi-level custom support', () => {
    const desk = {
      ...createSceneObject('desk'),
      id: 'desk',
      shapeMode: 'custom' as const,
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
      parts: [
        { ...part(3, 0.1, 2), position: { x: 0, y: 1, z: 0 } },
        { ...part(3, 0.1, 2), position: { x: 0, y: 2, z: 0 } },
      ],
    };
    const child = cube('child', 0, 0, 0.4);
    child.placement.y = 1.051;
    child.attachment = { parentId: 'desk' };
    const draft = empty([desk, child]);
    const relations = [{ itemId: 'child', surfaceId: 'desk', source: 'model' as const }];
    expect(validateSceneCollisions(draft)).toEqual([]);
    expect(getRestingSurfaceId(draft, 'child')).toBe('desk');
    expect(evaluateSceneSupport(draft, 'child', 'desk')).toMatchObject({
      footprintValid: true,
      resting: true,
      heightDelta: 0,
    });
    const fit = fitSceneProposalForReview(empty([]), draft, ['child'], relations);
    expect(fit.issues).toEqual([]);
    expect(fit.draft.objects[1].placement).toEqual(child.placement);
    expect(snapToSurface(draft, 'child', 'desk').objects[1].placement).toEqual(child.placement);
    const nearby = structuredClone(draft);
    nearby.objects[1].placement.y = 1.08;
    expect(evaluateSceneSupport(nearby, 'child', 'desk').heightDelta).toBeCloseTo(-0.029, 8);
    expect(snapToSurface(nearby, 'child', 'desk').objects[1].placement.y).toBeCloseTo(1.051, 8);
    // The lower face is no longer feasible when the object's solid shape would
    // intersect the upper slab. A support relation never exempts that collision.
    const tooTall = structuredClone(draft);
    tooTall.objects[1].parts = [part(0.4, 1.2, 0.4)];
    expect(evaluateSceneSupport(tooTall, 'child', 'desk').resting).toBe(false);
    expect(evaluateSceneSupport(tooTall, 'child', 'desk').heightDelta).toBeCloseTo(1, 8);
    expect(validateSceneCollisions(tooTall)).not.toEqual([]);
    expect(validateSceneCollisions(snapToSurface(tooTall, 'child', 'desk'))).toEqual([]);
  });

  it('promotes a complete contact to only one valid thin mat and leaves ambiguous or partial contacts unchanged', () => {
    const draft = deskAndMat();
    draft.devices = [device('keyboard', 'keyboard', 0, 2.49)];
    expect(getUnambiguousCoveringSupport(draft, 'keyboard', 'desk')).toBe('mat');
    draft.devices[0].placement.x = 1.7;
    expect(getUnambiguousCoveringSupport(draft, 'keyboard', 'desk')).toBeNull();
    draft.devices[0].placement.x = 0;
    draft.objects.push({ ...structuredClone(draft.objects[1]), id: 'second-mat' });
    expect(getUnambiguousCoveringSupport(draft, 'keyboard', 'desk')).toBeNull();
    draft.objects.pop();
    draft.objects[1].placement.y += 0.1;
    expect(getUnambiguousCoveringSupport(draft, 'keyboard', 'desk')).toBeNull();
  });

  it('reports one stable collision pair and preserves baseline contact exemptions', () => {
    const draft = empty([cube('z', 0), cube('a', 0.25)]);
    expect(getSceneCollisionPairs(draft)).toEqual([{ itemIds: ['a', 'z'], penetration: 0.25 }]);
    expect(getSceneCollisionPairs(draft, structuredClone(draft))).toEqual([]);
    const deeper = move(draft, 'a', 0.1, 0);
    expect(getSceneCollisionPairs(deeper, draft)[0].penetration).toBeCloseTo(0.4, 8);
    expect(
      getSceneCollisionPairs({ ...deeper, objects: [...deeper.objects].reverse() }, draft),
    ).toEqual(getSceneCollisionPairs(deeper, draft));
  });
});

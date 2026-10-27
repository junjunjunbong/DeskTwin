import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  createDemoWorkspace,
  createSceneObject,
  parseWorkspace,
  type BoxPart,
  type Workspace,
} from './workspace';
import { applyQueuedCommand } from './queuedCommand';
import { validateSceneCollisions } from './spatial';
import legacy from '../../tests/fixtures/workspace-v1.json';

const part = (): BoxPart => ({
  position: { x: 0, y: 0.2, z: 0 },
  size: { x: 0.4, y: 0.4, z: 0.4 },
  color: '#8899aa',
});
function fixture(): Workspace {
  const workspace = createDemoWorkspace();
  workspace.devices = [];
  workspace.connections = [];
  workspace.objects = [
    {
      ...createSceneObject('generic'),
      id: 'block',
      name: 'Block',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
      shapeMode: 'custom',
      parts: [part()],
    },
  ];
  return workspace;
}

describe('queued granular editing', () => {
  it('merges different position and scale fields without restoring stale values', () => {
    const view = fixture();
    let saved = applyQueuedCommand(view, view, {
      type: 'update-object',
      id: 'block',
      patch: { placement: { x: 0.4 } },
    });
    saved = applyQueuedCommand(saved, view, {
      type: 'update-object',
      id: 'block',
      patch: { placement: { z: 0.6 } },
    });
    saved = applyQueuedCommand(saved, view, {
      type: 'update-object',
      id: 'block',
      patch: { visual: { scale: { x: 0.5 } } },
    });
    saved = applyQueuedCommand(saved, view, {
      type: 'update-object',
      id: 'block',
      patch: { visual: { scale: { y: 0.6 } } },
    });
    saved = applyQueuedCommand(saved, view, {
      type: 'update-object',
      id: 'block',
      patch: { visual: { color: '#d29b58' } },
    });
    expect(saved.objects[0].placement).toEqual({ x: 0.4, y: 0, z: 0.6, rotation: 0 });
    expect(saved.objects[0].visual).toMatchObject({
      scale: { x: 0.5, y: 0.6, z: 1 },
      color: '#d29b58',
    });
    expect(view.objects[0].placement.x).toBe(0);
  });

  it('preserves an explicit return to the original value while an earlier edit is queued', () => {
    const view = fixture();
    const first = applyQueuedCommand(view, view, {
      type: 'update-object',
      id: 'block',
      patch: { placement: { x: 0.4 }, visual: { scale: { x: 0.5 } } },
    });
    const last = applyQueuedCommand(first, view, {
      type: 'update-object',
      id: 'block',
      patch: { placement: { x: 0 }, visual: { scale: { x: 1 } } },
    });
    expect(last.objects[0].placement.x).toBe(0);
    expect(last.objects[0].visual.scale.x).toBe(1);
  });

  it('merges device visual fields without altering identity or reported state', () => {
    const view = fixture();
    const device = createDemoWorkspace().devices[0];
    device.placement = { x: 0, y: 0, z: 0, rotation: 0 };
    device.shapeMode = 'custom';
    device.parts = [part()];
    device.status = 'reported-issue';
    device.statusNote = 'User observation';
    view.objects = [];
    view.devices = [device];
    const first = applyQueuedCommand(view, view, {
      type: 'update-device',
      id: device.id,
      patch: { visual: { scale: { x: 0.5 } }, placement: { x: 0.4 } },
    });
    const last = applyQueuedCommand(first, view, {
      type: 'update-device',
      id: device.id,
      patch: { visual: { color: '#abcdef', scale: { z: 0.6 } }, placement: { z: 0.3 } },
    });
    expect(last.devices[0]).toMatchObject({
      id: device.id,
      name: device.name,
      source: device.source,
      status: 'reported-issue',
      statusNote: 'User observation',
      placement: { x: 0.4, z: 0.3 },
      visual: { color: '#abcdef', scale: { x: 0.5, y: 1, z: 0.6 } },
    });
  });

  it('merges individual part axes, handles omitted rotation, and clears tint only for color edits', () => {
    const view = fixture();
    view.objects[0].visual.color = '#abcdef';
    let saved = applyQueuedCommand(view, view, {
      type: 'update-part',
      id: 'block',
      index: 0,
      expectedLength: 1,
      patch: { position: { x: 0.1 } },
    });
    saved = applyQueuedCommand(saved, view, {
      type: 'update-part',
      id: 'block',
      index: 0,
      expectedLength: 1,
      patch: { position: { z: 0.2 }, rotation: { y: 15 } },
    });
    expect(saved.objects[0].parts[0]).toMatchObject({
      position: { x: 0.1, y: 0.2, z: 0.2 },
      rotation: { x: 0, y: 15, z: 0 },
    });
    expect(saved.objects[0].visual.color).toBe('#abcdef');
    saved = applyQueuedCommand(saved, view, {
      type: 'update-part',
      id: 'block',
      index: 0,
      expectedLength: 1,
      patch: { color: '#123456' },
    });
    expect(saved.objects[0].visual.color).toBeNull();
    expect(saved.objects[0].parts[0].color).toBe('#123456');
  });

  it('rejects a stale whole-array replacement after an intervening part edit', () => {
    const view = fixture();
    const saved = applyQueuedCommand(view, view, {
      type: 'update-part',
      id: 'block',
      index: 0,
      expectedLength: 1,
      patch: { position: { x: 0.1 } },
    });
    expect(() =>
      applyQueuedCommand(saved, view, {
        type: 'update-object',
        id: 'block',
        patch: { parts: [...view.objects[0].parts, part()] },
      }),
    ).toThrow('shape changed');
    expect(saved.objects[0].parts[0].position.x).toBe(0.1);
    expect(saved.objects[0].parts).toHaveLength(1);
  });

  it('rejects a queued part index and second structural change after an array change', () => {
    const view = fixture();
    const first = applyQueuedCommand(view, view, {
      type: 'update-object',
      id: 'block',
      patch: { parts: [...view.objects[0].parts, part()] },
    });
    expect(() =>
      applyQueuedCommand(first, view, {
        type: 'update-part',
        id: 'block',
        index: 0,
        expectedLength: 1,
        patch: { position: { z: 0.2 } },
      }),
    ).toThrow('shape changed');
    expect(() =>
      applyQueuedCommand(first, view, {
        type: 'update-object',
        id: 'block',
        patch: { parts: [...view.objects[0].parts, part()] },
      }),
    ).toThrow('shape changed');
  });

  it('rechecks collisions on granular part edits', () => {
    const view = fixture();
    const obstacle = structuredClone(view.objects[0]);
    obstacle.id = 'obstacle';
    obstacle.placement.x = 0.6;
    view.objects.push(obstacle);
    expect(() =>
      applyQueuedCommand(view, view, {
        type: 'update-part',
        id: 'block',
        index: 0,
        expectedLength: 1,
        patch: { size: { x: 1 } },
      }),
    ).toThrow();
    expect(view.objects[0].parts[0].size.x).toBe(0.4);
  });

  it('rejects a saved drag path after an earlier queued position edit', () => {
    const view = fixture();
    const first = applyCommand(view, {
      type: 'update-object',
      id: 'block',
      patch: { placement: { x: 0.4 } },
    });
    const placement = { x: 0, y: 0, z: 0.5, rotation: 0 };
    expect(() =>
      applyQueuedCommand(first, view, {
        type: 'move-object',
        id: 'block',
        placement,
        dragPath: [placement],
      }),
    ).toThrow('moved while this drag');
  });
});

it('new example scenes start without collisions while v1 furniture placements remain unchanged', () => {
  expect(validateSceneCollisions(createDemoWorkspace())).toEqual([]);
  const migrated = parseWorkspace(legacy);
  expect(migrated.objects.find((object) => object.id === 'decor-chair')!.placement.y).toBe(0);
  expect(migrated.objects.find((object) => object.id === 'decor-lamp')!.placement.x).toBe(3.07);
  expect(migrated.objects.find((object) => object.id === 'decor-desk-mat')!.placement.y).toBe(
    2.482,
  );
});

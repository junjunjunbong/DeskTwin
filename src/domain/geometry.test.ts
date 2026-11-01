import { describe, expect, it } from 'vitest';
import { getGeometryParts, getTemplateParts } from './geometry';
import {
  BoxPartSchema,
  DeviceKindSchema,
  ObjectKindSchema,
  createDemoWorkspace,
  createSceneObject,
} from './workspace';
import { getItemBounds, validateSceneCollisions } from './spatial';

describe('editable voxel templates', () => {
  it('can save every complete template as bounded editable parts', () => {
    for (const kind of [...DeviceKindSchema.options, ...ObjectKindSchema.options]) {
      const parts = getTemplateParts(kind);
      expect(parts.length).toBeGreaterThan(0);
      expect(parts.length).toBeLessThanOrEqual(128);
      for (const part of parts) expect(BoxPartSchema.safeParse(part).success).toBe(true);
    }
  });

  it('copies template parts without modifying the code-owned geometry', () => {
    const editable = getTemplateParts('monitor');
    const original = structuredClone(editable);
    editable[0].size.x = 3;
    editable[0].color = '#123456';
    expect(getGeometryParts({ kind: 'monitor' })).toEqual(original);
    expect(getGeometryParts({ kind: 'monitor', shapeMode: 'custom', parts: editable })).toEqual(
      editable,
    );
    expect(getGeometryParts({ kind: 'monitor', shapeMode: 'custom', parts: [] })).toEqual(
      getTemplateParts('generic'),
    );
  });

  it('gives independent supports real clearance and leaves the legacy shelf unchanged', () => {
    expect(getTemplateParts('shelf')).toEqual([
      {
        size: { x: 2.1, y: 0.13, z: 0.5 },
        position: { x: 0, y: 0.065, z: 0 },
        color: '#bc946b',
        rotation: { x: 0, y: 0, z: 0 },
      },
    ]);
    for (const [supportKind, deviceKind, height] of [
      ['monitor-riser', 'monitor', 0.5],
      ['laptop-stand', 'laptop', 0.42],
    ] as const) {
      const workspace = createDemoWorkspace();
      workspace.connections = [];
      workspace.objects = [];
      const support = createSceneObject(supportKind);
      support.placement = { x: 0, y: 0, z: 0, rotation: 0 };
      const supportBounds = getItemBounds(support);
      expect(supportBounds.min.y).toBeCloseTo(0);
      expect(supportBounds.max.y).toBeCloseTo(height);
      const device = workspace.devices.find((item) => item.kind === deviceKind)!;
      device.placement = { x: 0, y: 0, z: 0, rotation: 0 };
      const deviceBottom = getItemBounds(device).min.y;
      device.placement.y = height - deviceBottom;
      workspace.devices = [device];
      workspace.objects = [support];
      expect(getItemBounds(device).min.y).toBeCloseTo(supportBounds.max.y);
      expect(validateSceneCollisions(workspace)).toEqual([]);
      // Major horizontal upper platforms have a genuine gap below them.
      expect(
        getTemplateParts(supportKind).some(
          (part) => part.position.y - part.size.y / 2 > 0.3 && part.size.x > 1,
        ),
      ).toBe(true);
    }
  });

  it('keeps separate flat accessories shallow rather than turning them into generic cubes', () => {
    for (const kind of ['wrist-rest', 'light-bar'] as const) {
      const item = createSceneObject(kind);
      const bounds = getItemBounds(item);
      expect(bounds.max.y - bounds.min.y).toBeLessThan(0.15);
      expect(bounds.max.x - bounds.min.x).toBeGreaterThan(1);
      expect(getTemplateParts(kind)).not.toEqual(getTemplateParts('generic'));
    }
    for (const kind of ['trackpad', 'tablet'] as const) {
      const parts = getTemplateParts(kind);
      expect(Math.max(...parts.map((part) => part.position.y + part.size.y / 2))).toBeLessThan(
        0.06,
      );
      expect(parts[0].size.x).toBeGreaterThan(parts[0].size.z);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { getGeometryParts, getTemplateParts } from './geometry';
import { BoxPartSchema, DeviceKindSchema, ObjectKindSchema } from './workspace';

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
});

import { describe, expect, it } from 'vitest';
import { getPhotoReviewPreset, photoReviewPresets } from './photoPresets';
import {
  DeviceKindSchema,
  DeviceSchema,
  SceneObjectSchema,
  createSceneObject,
  defaultVisual,
} from './workspace';

describe('photo review visual presets', () => {
  it('offers separate, valid starting points for accessories and omitted input devices', () => {
    expect(new Set(photoReviewPresets.map((preset) => preset.id)).size).toBe(
      photoReviewPresets.length,
    );
    for (const kind of [
      'wrist-rest',
      'monitor-riser',
      'laptop-stand',
      'light-bar',
      'trackpad',
      'tablet',
    ])
      expect(photoReviewPresets.some((preset) => preset.kind === kind)).toBe(true);
    for (const preset of photoReviewPresets) {
      const deviceKind = DeviceKindSchema.safeParse(preset.kind);
      const record = deviceKind.success
        ? DeviceSchema.parse({
            id: 'review-candidate',
            kind: deviceKind.data,
            name: preset.label,
            model: '',
            placement: { x: 0, y: 2.51, z: 0, rotation: 0 },
            visual: defaultVisual('photo-inferred'),
            source: 'photo-inferred',
            status: 'unknown',
            statusNote: '',
          })
        : SceneObjectSchema.parse({
            ...createSceneObject('generic'),
            kind: preset.kind,
            visual: defaultVisual('photo-inferred'),
          });
      const selected = getPhotoReviewPreset(preset.id, preset.kind);
      const updated = {
        ...record,
        ...selected.patch,
        visual: { ...record.visual, ...selected.patch.visual },
      };
      expect(
        (deviceKind.success ? DeviceSchema : SceneObjectSchema).safeParse(updated).success,
      ).toBe(true);
      expect(updated.visual.source).toBe('photo-inferred');
      expect(updated).not.toHaveProperty('hardwareBinding');
      if ('status' in updated) expect(updated.status).toBe('unknown');
    }
  });

  it('rejects missing or mismatched presets and does not mutate the catalog', () => {
    expect(() => getPhotoReviewPreset('missing', 'trackpad')).toThrow();
    expect(() => getPhotoReviewPreset('light-bar-standard', 'tablet')).toThrow();
    const preset = getPhotoReviewPreset('riser-wide', 'monitor-riser');
    preset.patch.visual!.scale!.x = 2.9;
    expect(getPhotoReviewPreset('riser-wide', 'monitor-riser').patch.visual?.scale?.x).toBe(1.35);
  });
});

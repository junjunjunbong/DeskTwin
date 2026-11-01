import type { BoxPart, DeviceKind, ObjectKind, VisualUpdate } from './workspace';

export type PhotoReviewPreset = {
  id: string;
  label: string;
  kind: DeviceKind | ObjectKind;
  patch: {
    visual?: Pick<VisualUpdate, 'scale' | 'color'>;
    parts?: BoxPart[];
    shapeMode?: 'template' | 'custom';
  };
};

const template = (
  id: string,
  label: string,
  kind: PhotoReviewPreset['kind'],
  scale = { x: 1, y: 1, z: 1 },
): PhotoReviewPreset => ({
  id,
  label,
  kind,
  patch: { visual: { scale }, parts: [], shapeMode: 'template' },
});

/** Visual starting points, not measured sizes or verified hardware identities. */
export const photoReviewPresets: readonly PhotoReviewPreset[] = [
  template('monitor-standard', 'Standard monitor', 'monitor'),
  template('monitor-wide', 'Wide monitor', 'monitor', { x: 1.35, y: 1, z: 1 }),
  template('monitor-tall', 'Tall monitor', 'monitor', { x: 0.7, y: 1.25, z: 1 }),
  template('laptop-open', 'Open laptop', 'laptop'),
  template('laptop-compact', 'Compact open laptop', 'laptop', { x: 0.85, y: 0.85, z: 0.85 }),
  template('keyboard-compact', 'Compact keyboard', 'keyboard'),
  template('keyboard-full', 'Full-width keyboard', 'keyboard', { x: 1.25, y: 1, z: 1.1 }),
  template('wrist-rest-compact', 'Compact wrist rest', 'wrist-rest'),
  template('wrist-rest-full', 'Full-width wrist rest', 'wrist-rest', { x: 1.25, y: 1, z: 1 }),
  template('riser-standard', 'Raised monitor shelf with legs', 'monitor-riser'),
  template('riser-wide', 'Wide monitor riser with legs', 'monitor-riser', {
    x: 1.35,
    y: 1,
    z: 1,
  }),
  template('stand-level', 'Raised level laptop platform', 'laptop-stand'),
  template('stand-large', 'Large level laptop platform', 'laptop-stand', {
    x: 1.15,
    y: 1,
    z: 1.15,
  }),
  template('trackpad-standard', 'Flat trackpad', 'trackpad'),
  template('trackpad-large', 'Large flat trackpad', 'trackpad', { x: 1.25, y: 1, z: 1.2 }),
  template('tablet-flat', 'Flat tablet', 'tablet'),
  template('tablet-large', 'Large flat tablet', 'tablet', { x: 1.25, y: 1, z: 1.25 }),
  template('light-bar-standard', 'Monitor-top light bar', 'light-bar'),
  template('light-bar-wide', 'Wide monitor-top light bar', 'light-bar', {
    x: 1.3,
    y: 1,
    z: 1,
  }),
];

/** A caller receives an editable copy and must retain the item's evidence source. */
export function getPhotoReviewPreset(
  presetId: string,
  kind: PhotoReviewPreset['kind'],
): PhotoReviewPreset {
  const preset = photoReviewPresets.find((item) => item.id === presetId && item.kind === kind);
  if (!preset) throw new Error('Choose a preset for the selected object type.');
  return structuredClone(preset);
}

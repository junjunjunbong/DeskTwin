import type { BoxPart, DeviceKind, ObjectKind } from './workspace';

type Kind = DeviceKind | ObjectKind;
type V3 = [number, number, number];
// Trigonometry may differ by a final floating-point bit between JS engines.
// Stable template data keeps conversion/JSON round trips deterministic.
const stable = (value: number) => Math.round(value * 1e10) / 1e10 || 0;
const vector = ([x, y, z]: V3) => ({ x: stable(x), y: stable(y), z: stable(z) });
const degrees = (radians: number) => (radians * 180) / Math.PI;
const normalized = (angle: number) => ((angle + 180) % 360) - 180;

/** Code-owned voxel geometry, shared by the renderer, placement solver and shape editor. */
function createTemplate(kind: Kind): BoxPart[] {
  const parts: BoxPart[] = [];
  const box = (size: V3, position: V3, color: string, rotation: V3 = [0, 0, 0]) => {
    parts.push({
      size: vector(size),
      position: vector(position),
      color,
      rotation: vector(rotation),
    });
  };
  function keyboard(scale: V3 = [1, 1, 1], offset: V3 = [0, 0, 0]) {
    const keyBox = (size: V3, position: V3, color: string) =>
      box(
        size.map((n, i) => n * scale[i]) as V3,
        position.map((n, i) => n * scale[i] + offset[i]) as V3,
        color,
      );
    const width = 1.35;
    const depth = 0.44;
    keyBox([width, 0.07, depth], [0, 0.045, 0], '#616c75');
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 14; col++)
        keyBox(
          [(width / 14) * 0.78, 0.035, (depth / 5) * 0.74],
          [
            -width * 0.46 + ((col * width) / 14) * 0.98,
            0.097,
            -depth * 0.4 + ((row * depth) / 5) * 0.95,
          ],
          col === 0 && row === 0 ? '#c88c58' : (col + row) % 5 ? '#d5d5cb' : '#a6b1b1',
        );
  }
  switch (kind) {
    case 'desk':
      box([7.4, 0.22, 3.15], [0, 2.33, 0], '#c99b69');
      // The full tabletop reaches the same height as its shallow grain trim.
      box([7.42, 0.047, 3.16], [0, 2.46, 0], '#d8ae7c');
      for (let i = 0; i < 5; i++)
        box([7.37, 0.005, 0.008], [0, 2.481, -1.27 + i * 0.63], '#c69b6e');
      for (const x of [-3.14, 3.14])
        for (const z of [-1.16, 1.16]) box([0.11, 2.2, 0.11], [x, 1.1, z], '#424947');
      box([1.22, 2.16, 2.5], [-2.67, 1.08, -0.05], '#505b60');
      for (let i = 0; i < 4; i++) {
        box([1.16, 0.48, 0.06], [-2.67, 0.35 + i * 0.51, 1.23], '#566166');
        box([0.38, 0.035, 0.045], [-2.67, 0.49 + i * 0.51, 1.28], '#323e45');
      }
      break;
    case 'chair':
      box([1.35, 0.2, 1.2], [0, 1.25, 0], '#71839a');
      box([1.37, 1.34, 0.16], [0, 1.99, 0.48], '#d4d5cd');
      for (let i = 0; i < 7; i++)
        for (let j = 0; j < 6; j++)
          box(
            [0.17, 0.18, 0.05],
            [-0.52 + i * 0.174, 1.48 + j * 0.18, 0.58],
            (i + j) % 3 ? '#718198' : '#8190a4',
          );
      for (const x of [-0.78, 0.78]) {
        box([0.08, 0.55, 0.08], [x, 1.45, 0], '#c5c9c1');
        box([0.21, 0.1, 0.67], [x, 1.74, -0.03], '#515f65');
      }
      box([0.13, 1.0, 0.13], [0, 0.66, 0], '#59636b');
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        box([0.73, 0.08, 0.1], [0.3 * Math.cos(a), 0.2, -0.3 * Math.sin(a)], '#59636b', [
          0,
          normalized(degrees(a)),
          0,
        ]);
        box([0.18, 0.16, 0.15], [0.63 * Math.cos(a), 0.1, -0.63 * Math.sin(a)], '#414a50', [
          0,
          normalized(degrees(a)),
          0,
        ]);
      }
      break;
    case 'plant': {
      box([0.43, 0.38, 0.43], [0, 0.19, 0], '#e5dfcf');
      box([0.48, 0.08, 0.48], [0, 0.39, 0], '#eee7d8');
      box([0.37, 0.02, 0.37], [0, 0.44, 0], '#70624c');
      box([0.055, 0.55, 0.055], [0, 0.68, 0], '#7c7852');
      const greens = ['#71905b', '#8da55d', '#a4b86d', '#57794f'];
      for (let i = 0; i < 28; i++) {
        const angle = i * 2.4;
        const radius = 0.12 + (i % 4) * 0.065;
        box(
          [0.18, 0.15, 0.18],
          [Math.cos(angle) * radius, 0.57 + (i % 6) * 0.09, Math.sin(angle) * radius],
          greens[i % 4],
        );
      }
      break;
    }
    case 'books': {
      const colors = ['#627a88', '#c17e61', '#87947d', '#ddd1b6'];
      for (let i = 0; i < 4; i++) {
        box([0.64 - i * 0.025, 0.13, 0.47], [(i % 2) * 0.025, 0.07 + i * 0.14, 0], colors[i]);
        box([0.57 - i * 0.025, 0.09, 0.01], [0.025, 0.07 + i * 0.14, 0.24], '#e9ddc5');
      }
      break;
    }
    case 'figurine':
      box([0.25, 0.3, 0.22], [0, 0.16, 0], '#faf0d9');
      box([0.3, 0.23, 0.25], [0, 0.4, 0], '#ebe3d3');
      box([0.09, 0.1, 0.12], [-0.1, 0.55, 0], '#555963');
      box([0.09, 0.1, 0.12], [0.1, 0.55, 0], '#555963');
      for (const x of [-0.07, 0.07]) box([0.025, 0.035, 0.01], [x, 0.43, 0.132], '#353e49');
      box([0.035, 0.025, 0.02], [0, 0.36, 0.14], '#c59c91');
      box([0.09, 0.25, 0.07], [0.18, 0.17, -0.1], '#555963');
      break;
    case 'shelf':
      box([2.1, 0.13, 0.5], [0, 0.065, 0], '#bc946b');
      break;
    case 'wrist-rest':
      box([1.4, 0.09, 0.3], [0, 0.045, 0], '#706b65');
      break;
    case 'monitor-riser':
      // A tabletop support with clearance below it, not the legacy wall shelf.
      box([2.4, 0.1, 0.8], [0, 0.45, 0], '#b49370');
      for (const x of [-1.08, 1.08]) box([0.12, 0.4, 0.74], [x, 0.2, 0], '#645f58');
      break;
    case 'laptop-stand':
      // A level upper platform lets a separate laptop rest without inventing
      // pitch in the yaw-only placement format.
      box([1.5, 0.07, 1.05], [0, 0.385, 0], '#9ca6ad');
      for (const x of [-0.5, 0.5]) {
        box([0.1, 0.29, 0.16], [x, 0.205, 0.1], '#8b969e');
        box([0.18, 0.06, 0.85], [x, 0.03, 0], '#8b969e');
      }
      break;
    case 'light-bar':
      // Local y=0 is the mounting surface; illumination is decorative only.
      box([1.4, 0.08, 0.1], [0, 0.04, 0], '#535c61');
      box([1.3, 0.015, 0.02], [0, 0.0125, 0.06], '#e4d8b7');
      box([0.18, 0.06, 0.1], [0, 0.09, 0], '#687279');
      break;
    case 'picture':
      box([1.28, 0.93, 0.1], [0, 0.465, 0], '#b49678');
      box([1.15, 0.8, 0.02], [0, 0.465, 0.07], '#f0e9dc');
      break;
    case 'organizer':
      box([0.32, 0.37, 0.32], [0, 0.185, 0], '#8b8778');
      for (let i = 0; i < 5; i++)
        box(
          [0.025, 0.44 + i * 0.02, 0.025],
          [-0.1 + i * 0.045, 0.395, (i % 2) * 0.06],
          ['#c49859', '#62738c', '#a9604b'][i % 3],
        );
      break;
    case 'mug':
      box([0.44, 0.035, 0.44], [0, 0.0175, 0], '#bc9772');
      box([0.32, 0.31, 0.32], [0, 0.19, 0], '#e8dfca');
      box([0.25, 0.015, 0.25], [0, 0.354, 0], '#68513e');
      box([0.13, 0.08, 0.07], [0.2, 0.29, 0], '#e8dfca');
      box([0.13, 0.08, 0.07], [0.2, 0.11, 0], '#e8dfca');
      box([0.07, 0.19, 0.07], [0.26, 0.2, 0], '#e8dfca');
      break;
    case 'lamp':
      box([0.48, 0.06, 0.45], [0, 0.03, 0], '#5b655f');
      box([0.07, 1.12, 0.07], [0, 0.58, 0], '#5b655f');
      box([0.75, 0.065, 0.065], [-0.3, 1.19, 0], '#5b655f', [0, 0, degrees(-0.28)]);
      box([0.42, 0.16, 0.35], [-0.64, 1.23, 0], '#697268');
      box([0.34, 0.045, 0.28], [-0.64, 1.13, 0], '#ffe1a1');
      break;
    case 'mat':
      box([3.06, 0.012, 1.04], [0, 0.006, 0], '#c5b7a1');
      box([3, 0.025, 1], [0, 0.015, 0], '#5c6666');
      break;
    case 'generic':
      box([0.7, 0.7, 0.7], [0, 0.35, 0], '#9aa5a5');
      box([0.44, 0.025, 0.44], [0, 0.713, 0], '#bfc7c5');
      break;
    case 'monitor':
      box([0.65, 0.045, 0.4], [0, 0.025, 0], '#505b62');
      box([0.095, 0.42, 0.09], [0, 0.22, -0.03], '#5f6970');
      box([1.85, 1.1, 0.11], [0, 0.95, 0], '#3b4751');
      box([1.76, 0.99, 0.02], [0, 0.965, 0.06], '#26394b');
      break;
    case 'laptop': {
      box([1.35, 0.065, 0.93], [0, 0.04, 0], '#aeb7bd');
      box([0.95, 0.01, 0.35], [0, 0.078, -0.11], '#475462');
      keyboard([0.68, 0.35, 0.72], [0, 0.08, -0.15]);
      box([0.4, 0.008, 0.22], [0, 0.08, 0.23], '#bac3c6');
      const angle = -0.18;
      box(
        [1.36, 0.86, 0.045],
        [0, 0.08 + 0.42 * Math.cos(angle), -0.43 + 0.42 * Math.sin(angle)],
        '#596773',
        [degrees(angle), 0, 0],
      );
      break;
    }
    case 'dock':
      box([0.83, 0.22, 0.5], [0, 0.12, 0], '#a2a9ac');
      box([0.79, 0.15, 0.02], [0, 0.1, 0.26], '#6a757d');
      for (let i = 0; i < 4; i++)
        box([0.115, 0.065, 0.015], [-0.28 + i * 0.18, 0.11, 0.28], i === 0 ? '#789eb0' : '#303f4a');
      break;
    case 'ssd':
      box([0.54, 0.09, 0.35], [0, 0.06, 0], '#66788d');
      box([0.14, 0.012, 0.1], [0, 0.11, 0], '#8d9ca9');
      break;
    case 'router':
      box([0.67, 0.18, 0.46], [0, 0.1, 0], '#49535a');
      for (let i = 0; i < 4; i++)
        box([0.037, 0.56, 0.037], [-0.27 + i * 0.18, 0.42, -0.13], '#505c62');
      for (let i = 0; i < 5; i++)
        box([0.018, 0.018, 0.012], [-0.2 + i * 0.07, 0.11, 0.24], '#bcc3b5');
      break;
    case 'keyboard':
      keyboard();
      break;
    case 'mouse':
      box([0.29, 0.1, 0.43], [0, 0.07, 0], '#a9b4ba');
      box([0.25, 0.06, 0.31], [0, 0.15, -0.03], '#b4bfc4');
      box([0.025, 0.02, 0.07], [0, 0.19, -0.1], '#65727c');
      break;
    case 'trackpad':
      box([0.5, 0.035, 0.38], [0, 0.0175, 0], '#b5bfc4');
      box([0.47, 0.008, 0.35], [0, 0.039, 0], '#d1d7d7');
      break;
    case 'tablet':
      // Flat tablet; an upright drawing/display arrangement can use custom boxes.
      box([0.82, 0.045, 0.58], [0, 0.0225, 0], '#65717a');
      box([0.75, 0.008, 0.51], [0, 0.049, 0], '#354956');
      break;
    case 'desktop':
      box([0.64, 1.25, 0.95], [0, 0.63, 0], '#52616c');
      box([0.55, 1.12, 0.025], [0, 0.63, 0.49], '#354954');
      for (let i = 0; i < 3; i++) box([0.34, 0.23, 0.02], [0, 0.28 + i * 0.34, 0.51], '#7f999f');
      break;
  }
  return parts;
}

const templates = new Map<Kind, BoxPart[]>();
function template(kind: Kind): BoxPart[] {
  if (!templates.has(kind)) templates.set(kind, createTemplate(kind));
  return templates.get(kind)!;
}

/** Editable copy; changing it never mutates the shared code-owned template. */
export function getTemplateParts(kind: Kind): BoxPart[] {
  return structuredClone(template(kind));
}

export function getGeometryParts(item: {
  kind: Kind;
  parts?: BoxPart[];
  shapeMode?: 'template' | 'custom';
}): readonly BoxPart[] {
  if (
    item.shapeMode === 'custom' ||
    (!item.shapeMode && item.kind === 'generic' && item.parts?.length)
  )
    // Validation rejects empty custom shapes; this also keeps a partially edited
    // in-memory shape visible and gives the placement solver finite bounds.
    return item.parts?.length ? item.parts : template('generic');
  return template(item.kind);
}

/** Contact patches describe the stylized template, not a physical stability guarantee.
 * Keeping them separate from decorative boxes avoids using a screen as a monitor foot
 * or a light bar's full width as its mounting clip. Custom geometry never inherits them. */
export type GeometryContactPatch = {
  center: { x: number; y: number; z: number };
  size: { x: number; z: number };
};
export type TemplateContactProfile = {
  contactMode: 'base' | 'covering' | 'mount';
  contactPatches: GeometryContactPatch[];
  supportPatches: GeometryContactPatch[];
  /** Maximum extension per edge, as a fraction of the support's full width/depth. */
  maxOverhangFraction?: number;
  overhangKinds?: Kind[];
};
const patch = (
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
): GeometryContactPatch => ({
  center: { x, y, z },
  size: { x: width, z: depth },
});
const contactProfiles: Partial<Record<Kind, TemplateContactProfile>> = {
  desk: {
    contactMode: 'base',
    contactPatches: [],
    // The broad tabletop and its trim share this actual horizontal surface.
    supportPatches: [patch(0, 2.4835, 0, 7.42, 3.16)],
  },
  mat: {
    contactMode: 'covering',
    contactPatches: [patch(0, 0, 0, 3.06, 1.04)],
    supportPatches: [patch(0, 0.012, 0, 3.06, 1.04), patch(0, 0.0275, 0, 3, 1)],
  },
  'monitor-riser': {
    contactMode: 'base',
    contactPatches: [patch(-1.08, 0, 0, 0.12, 0.74), patch(1.08, 0, 0, 0.12, 0.74)],
    supportPatches: [patch(0, 0.5, 0, 2.4, 0.8)],
  },
  'laptop-stand': {
    contactMode: 'base',
    contactPatches: [patch(-0.5, 0, 0, 0.18, 0.85), patch(0.5, 0, 0, 0.18, 0.85)],
    supportPatches: [patch(0, 0.42, 0, 1.5, 1.05)],
    // An explicit visual policy for a rigid laptop base. It does not apply to custom shapes.
    maxOverhangFraction: 0.05,
    overhangKinds: ['laptop'],
  },
  shelf: {
    contactMode: 'base',
    contactPatches: [patch(0, 0, 0, 2.1, 0.5)],
    supportPatches: [patch(0, 0.13, 0, 2.1, 0.5)],
  },
  monitor: {
    contactMode: 'base',
    contactPatches: [patch(0, 0.0025, 0, 0.65, 0.4)],
    supportPatches: [patch(0, 1.5, 0, 1.85, 0.11)],
  },
  laptop: {
    contactMode: 'base',
    contactPatches: [patch(0, 0.0075, 0, 1.35, 0.93)],
    supportPatches: [],
  },
  keyboard: {
    contactMode: 'base',
    contactPatches: [patch(0, 0.01, 0, 1.35, 0.44)],
    supportPatches: [],
  },
  'light-bar': {
    contactMode: 'mount',
    // The central mounting region rests on the bezel; the lamp and diffuser may overhang it.
    contactPatches: [patch(0, 0, 0, 0.18, 0.06)],
    supportPatches: [],
  },
};

export function getTemplateContactProfile(kind: Kind): TemplateContactProfile | null {
  const profile = contactProfiles[kind];
  return profile ? structuredClone(profile) : null;
}

export function getTemplateSupportTop(kind: Kind): number | null {
  const patches = contactProfiles[kind]?.supportPatches;
  return patches?.length ? Math.max(...patches.map((entry) => entry.center.y)) : null;
}

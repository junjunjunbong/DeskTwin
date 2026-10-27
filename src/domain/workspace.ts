import { z } from 'zod';
import { findFreePlacement, resolveSpatialEdit, snapToSurface } from './spatial';

export const DeviceKindSchema = z.enum([
  'laptop',
  'monitor',
  'dock',
  'ssd',
  'router',
  'keyboard',
  'mouse',
  'desktop',
]);
export const SourceSchema = z.enum(['demo', 'user-reported', 'photo-inferred']);
export const StatusSchema = z.enum(['unknown', 'reported-working', 'reported-issue']);
export const ConnectorSchema = z.enum([
  'USB-C',
  'HDMI',
  'DisplayPort',
  'Ethernet',
  'USB-A',
  'Bluetooth',
  'Unknown',
]);
export const IdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const Id = IdSchema;
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const PlacementSchema = z.strictObject({
  x: z.number().finite().min(-4.3).max(4.3),
  y: z.number().finite().min(0).max(5.5),
  z: z.number().finite().min(-1.9).max(3.7),
  rotation: z.number().finite().min(-180).max(180),
});
export type Placement = z.infer<typeof PlacementSchema>;
export type PlacementPatch = Partial<Placement>;
export const ScaleSchema = z.strictObject({
  x: z.number().finite().min(0.1).max(3),
  y: z.number().finite().min(0.1).max(3),
  z: z.number().finite().min(0.1).max(3),
});
export const VisualSchema = z.strictObject({
  scale: ScaleSchema,
  color: ColorSchema.nullable(),
  source: SourceSchema,
  note: z.string().max(300),
});
export type Visual = z.infer<typeof VisualSchema>;
export type VisualUpdate = Partial<Omit<Visual, 'scale'>> & {
  scale?: Partial<Visual['scale']>;
};
export function defaultVisual(source: z.infer<typeof SourceSchema> = 'user-reported'): Visual {
  return { scale: { x: 1, y: 1, z: 1 }, color: null, source, note: '' };
}
export const PartRotationSchema = z.strictObject({
  x: z.number().finite().min(-180).max(180),
  y: z.number().finite().min(-180).max(180),
  z: z.number().finite().min(-180).max(180),
});
export const AttachmentSchema = z.strictObject({ parentId: IdSchema });
export const ShapeModeSchema = z.enum(['template', 'custom']);
export const BoxPartSchema = z.strictObject({
  rotation: PartRotationSchema.optional(),
  position: z.strictObject({
    x: z.number().finite().min(-6).max(6),
    y: z.number().finite().min(-6).max(6),
    z: z.number().finite().min(-6).max(6),
  }),
  size: z.strictObject({
    x: z.number().finite().min(0.005).max(10),
    y: z.number().finite().min(0.005).max(10),
    z: z.number().finite().min(0.005).max(10),
  }),
  color: ColorSchema,
});
export type BoxPart = z.infer<typeof BoxPartSchema>;
export type BoxPartPatch = {
  position?: Partial<BoxPart['position']>;
  size?: Partial<BoxPart['size']>;
  rotation?: Partial<NonNullable<BoxPart['rotation']>>;
  color?: string;
};
export const ObjectKindSchema = z.enum([
  'desk',
  'chair',
  'plant',
  'lamp',
  'books',
  'mug',
  'mat',
  'shelf',
  'picture',
  'organizer',
  'figurine',
  'generic',
]);
export type ObjectKind = z.infer<typeof ObjectKindSchema>;
export const SceneObjectSchema = z
  .strictObject({
    id: Id,
    kind: ObjectKindSchema,
    name: z.string().trim().min(1).max(60),
    placement: PlacementSchema,
    visual: VisualSchema,
    parts: z.array(BoxPartSchema).max(128),
    shapeMode: ShapeModeSchema.optional(),
    attachment: AttachmentSchema.nullable().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.shapeMode === 'custom' && !item.parts?.length)
      ctx.addIssue({ code: 'custom', message: 'A custom shape needs at least one box.' });
  });
export type SceneObject = z.infer<typeof SceneObjectSchema>;
export type SceneObjectPatch = Partial<Omit<SceneObject, 'id' | 'placement' | 'visual'>> & {
  placement?: PlacementPatch;
  visual?: VisualUpdate;
};
export const objectKindLabels: Record<ObjectKind, string> = {
  desk: 'Desk',
  chair: 'Chair',
  plant: 'Plant',
  lamp: 'Lamp',
  books: 'Books',
  mug: 'Mug',
  mat: 'Mat',
  shelf: 'Shelf',
  picture: 'Picture',
  organizer: 'Organizer',
  figurine: 'Figurine',
  generic: 'Generic object',
};
export const DeviceSchema = z
  .strictObject({
    id: Id,
    kind: DeviceKindSchema,
    name: z.string().trim().min(1).max(60),
    model: z.string().max(100),
    placement: PlacementSchema.extend({ y: PlacementSchema.shape.y.default(2.51) }),
    visual: VisualSchema.default(() => defaultVisual()),
    source: SourceSchema,
    status: StatusSchema,
    statusNote: z.string().max(300),
    parts: z.array(BoxPartSchema).max(128).optional(),
    shapeMode: ShapeModeSchema.optional(),
    attachment: AttachmentSchema.nullable().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.shapeMode === 'custom' && !item.parts?.length)
      ctx.addIssue({ code: 'custom', message: 'A custom shape needs at least one box.' });
  });
export type DevicePatch = Partial<
  Omit<z.input<typeof DeviceSchema>, 'id' | 'placement' | 'visual'>
> & {
  placement?: PlacementPatch;
  visual?: VisualUpdate;
};
export const ConnectionSchema = z.object({
  id: Id,
  from: Id,
  to: Id,
  connector: ConnectorSchema,
  fromPort: z.string().max(40),
  toPort: z.string().max(40),
  source: SourceSchema,
  note: z.string().max(300),
});
const EventSchema = z.object({
  id: Id,
  at: z.string().datetime(),
  summary: z.string().max(300),
  source: SourceSchema,
});
export const WorkspaceSchema = z
  .strictObject({
    schemaVersion: z.literal(2),
    name: z.string().trim().min(1).max(60),
    devices: z.array(DeviceSchema).max(40),
    objects: z.array(SceneObjectSchema).max(60),
    connections: z.array(ConnectionSchema).max(100),
    history: z.array(EventSchema).max(100),
    appearance: z.object({
      lighting: z.enum(['day', 'sunset', 'night']),
      labels: z.boolean(),
      decor: z.boolean(),
    }),
  })
  .superRefine((workspace, ctx) => {
    const ids = workspace.devices.map((d) => d.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate device IDs' });
    const sceneIds = [...ids, ...workspace.objects.map((o) => o.id)];
    if (new Set(sceneIds).size !== sceneIds.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate scene object IDs' });
    for (const item of [...workspace.devices, ...workspace.objects]) {
      if (!item.attachment) continue;
      const parent = workspace.objects.find((object) => object.id === item.attachment?.parentId);
      if (!parent || parent.kind !== 'desk' || parent.id === item.id || item.kind === 'desk')
        ctx.addIssue({
          code: 'custom',
          message: 'An attachment must reference a different desk. Desks cannot be attached.',
        });
    }
    const connectionIds = workspace.connections.map((c) => c.id);
    if (new Set(connectionIds).size !== connectionIds.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate connection IDs' });
    const pairs = new Set<string>();
    for (const link of workspace.connections) {
      if (!ids.includes(link.from) || !ids.includes(link.to))
        ctx.addIssue({ code: 'custom', message: 'Connection endpoint does not exist' });
      if (link.from === link.to)
        ctx.addIssue({ code: 'custom', message: 'A device cannot connect to itself' });
      const pair = [link.from, link.to].sort().join(':');
      if (pairs.has(pair)) ctx.addIssue({ code: 'custom', message: 'Duplicate device pair' });
      pairs.add(pair);
    }
  });
export type Device = z.infer<typeof DeviceSchema>;
export type DeviceKind = Device['kind'];
export type Connection = z.infer<typeof ConnectionSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type Source = z.infer<typeof SourceSchema>;
export function deviceVisual(device: Device): Visual {
  return device.visual;
}

export const kindLabels: Record<DeviceKind, string> = {
  laptop: 'Laptop',
  monitor: 'Monitor',
  dock: 'Dock',
  ssd: 'External SSD',
  router: 'Router',
  keyboard: 'Keyboard',
  mouse: 'Mouse',
  desktop: 'Desktop',
};
export const sourceLabels: Record<Source, string> = {
  demo: 'Example data',
  'user-reported': 'User-reported',
  'photo-inferred': 'Photo-inferred',
};
export const statusLabels: Record<Device['status'], string> = {
  unknown: 'Status unknown',
  'reported-working': 'User reports working',
  'reported-issue': 'User reports an issue',
};

/** Safe, editable procedural templates. Dimensions are relative to each template. */
export function createSceneObject(kind: ObjectKind): SceneObject {
  const floor = kind === 'desk' || kind === 'chair';
  const wall = kind === 'shelf' || kind === 'picture';
  return SceneObjectSchema.parse({
    id: crypto.randomUUID(),
    kind,
    name: objectKindLabels[kind],
    placement: {
      x: 0,
      y: floor ? 0 : wall ? 4.5 : 2.51,
      z: wall ? -1.9 : kind === 'chair' ? 2.65 : 0,
      rotation: 0,
    },
    visual: defaultVisual(),
    parts: [],
  });
}

/** Former fixed furniture/decor becomes editable example data during v1 migration. */
export function createDemoObjects(): SceneObject[] {
  const object = (
    id: string,
    kind: ObjectKind,
    name: string,
    x: number,
    y: number,
    z: number,
    size = 1,
    rotation = 0,
    scale?: Visual['scale'],
  ): SceneObject => ({
    id: `decor-${id}`,
    kind,
    name,
    placement: { x, y, z, rotation },
    visual: { ...defaultVisual('demo'), scale: scale ?? { x: size, y: size, z: size } },
    parts: [],
  });
  return [
    object('desk', 'desk', 'Desk', 0, 0, 0),
    object('chair', 'chair', 'Desk chair', -0.55, 0, 2.65, 1, -7),
    object('plant-left', 'plant', 'Left desk plant', -3.3, 2.5, -0.78, 0.87),
    object('plant-right', 'plant', 'Right desk plant', 3.15, 2.5, 0.56, 0.65),
    object('plant-floor-left', 'plant', 'Left floor plant', -4, 0.02, 2.8, 1.75),
    object('plant-floor-right', 'plant', 'Right floor plant', 3.6, 0.02, 2.75, 1.55),
    object('plant-window', 'plant', 'Window plant', -4.27, 2.45, -0.38, 0.7),
    object('shelf-left', 'shelf', 'Left shelf', -2.65, 4.78, -1.9),
    object('shelf-right', 'shelf', 'Right shelf', 2.45, 4.78, -1.9),
    object('books-shelf', 'books', 'Shelf books', -3.22, 4.91, -1.9, 0.8),
    object('figurine', 'figurine', 'Cat figurine', -2.4, 4.94, -1.89),
    object('plant-shelf', 'plant', 'Shelf plant', 2.9, 4.93, -1.88, 0.6),
    object('picture-landscape', 'picture', 'Landscape picture', -0.5, 4.55, -1.9),
    object('picture-poster', 'picture', 'Ideas picture', 0.94, 4.5, -1.9, 1, 0, {
      x: 0.77,
      y: 1.32,
      z: 1,
    }),
    object('picture-small', 'picture', 'Small picture', 2.15, 5.08, -1.9, 0.55),
    object('books-desk', 'books', 'Desk books', 2.95, 2.5, 1.08),
    object('organizer', 'organizer', 'Pen organizer', 2.2, 2.5, -0.08),
    object('mug', 'mug', 'Desk mug', 2.05, 2.51, 1.1),
    object('lamp', 'lamp', 'Desk lamp', 3.07, 2.5, -0.97),
    {
      ...object('pegboard', 'generic', 'Wall pegboard', 2.65, 3.23, -1.9),
      parts: [
        {
          position: { x: 0, y: 0.64, z: 0 },
          size: { x: 1.45, y: 1.28, z: 0.06 },
          color: '#bca17e',
        },
        ...Array.from({ length: 15 }, (_, index) => ({
          position: {
            x: -0.46 + (index % 3) * 0.46,
            y: 0.17 + Math.floor(index / 3) * 0.23,
            z: 0.036,
          },
          size: { x: 0.025, y: 0.025, z: 0.02 },
          color: '#8a775f',
        })),
      ],
    },
    object('desk-mat', 'mat', 'Desk mat', 0.3, 2.482, 0.94),
    object('rug', 'mat', 'Floor rug', -0.55, 0.03, 2.6, 1, 0, { x: 1, y: 1, z: 2.35 }),
    {
      ...object('notebook', 'generic', 'Notebook', -1.55, 2.5, 1.08, 1, -11),
      parts: [
        { position: { x: 0, y: 0.03, z: 0 }, size: { x: 0.54, y: 0.06, z: 0.7 }, color: '#ede0bf' },
      ],
    },
  ];
}

export function createDemoWorkspace(): Workspace {
  const device = (
    id: string,
    kind: DeviceKind,
    name: string,
    x: number,
    z: number,
    rotation = 0,
  ): Device => ({
    id,
    kind,
    name,
    model: '',
    placement: { x, y: 2.51, z, rotation },
    visual: defaultVisual('demo'),
    source: 'demo',
    status: 'unknown',
    statusNote: '',
  });
  const edge = (from: string, to: string, connector: Connection['connector']): Connection => ({
    id: `${from}-${to}`,
    from,
    to,
    connector,
    fromPort: '',
    toPort: '',
    source: 'demo',
    note: 'Example only. This is not a confirmed connection.',
  });
  return WorkspaceSchema.parse({
    schemaVersion: 2,
    name: 'My workspace',
    devices: [
      device('laptop', 'laptop', 'MacBook', -2.1, 0.1, 10),
      device('monitor-left', 'monitor', 'Left monitor', -0.7, -0.7),
      device('monitor-right', 'monitor', 'Right monitor', 1.15, -0.7, -8),
      device('dock', 'dock', 'USB-C Dock', 0.15, 0.05),
      device('ssd', 'ssd', 'External SSD', 1.65, 0.6, -12),
      device('router', 'router', 'Router', 2.55, -0.55),
      device('keyboard', 'keyboard', 'Keyboard', -0.15, 0.88),
      device('mouse', 'mouse', 'Mouse', 0.98, 0.96),
    ],
    connections: [
      edge('laptop', 'dock', 'USB-C'),
      edge('dock', 'monitor-left', 'DisplayPort'),
      edge('dock', 'monitor-right', 'HDMI'),
      edge('dock', 'ssd', 'USB-C'),
      edge('dock', 'router', 'Ethernet'),
      edge('laptop', 'keyboard', 'Bluetooth'),
      edge('laptop', 'mouse', 'Bluetooth'),
    ],
    objects: createDemoObjects().map((object) => {
      // New examples start without the old decorative intersections. Existing
      // saves and v1 migration keep their original coordinates unchanged.
      const adjustments: Record<string, PlacementPatch> = {
        'decor-chair': { y: 0.04 },
        'decor-desk-mat': { y: 2.485 },
        'decor-lamp': { x: 3.4 },
        'decor-picture-poster': { x: 0.85 },
      };
      return { ...object, placement: { ...object.placement, ...adjustments[object.id] } };
    }),
    history: [],
    appearance: { lighting: 'sunset', labels: false, decor: true },
  });
}

/**
 * Translate only unchanged defaults from the original Korean demo for display.
 * User-authored values and the stored workspace are never changed by this function.
 */
export function localizeLegacyDemoForDisplay(workspace: Workspace): Workspace {
  const localized = structuredClone(workspace);
  if (localized.name === '나의 작은 작업실') localized.name = 'My workspace';

  const legacyDeviceNames: Record<string, { original: string; english: string }> = {
    'monitor-left': { original: '왼쪽 모니터', english: 'Left monitor' },
    'monitor-right': { original: '오른쪽 모니터', english: 'Right monitor' },
    ssd: { original: '외장 SSD', english: 'External SSD' },
    router: { original: '공유기', english: 'Router' },
    keyboard: { original: '키보드', english: 'Keyboard' },
    mouse: { original: '마우스', english: 'Mouse' },
  };
  for (const device of localized.devices) {
    const legacy = legacyDeviceNames[device.id];
    if (device.source === 'demo' && legacy && device.name === legacy.original)
      device.name = legacy.english;
  }
  for (const connection of localized.connections) {
    if (
      connection.source === 'demo' &&
      connection.note === '체험용 예시입니다. 실제 연결이 아닙니다.'
    )
      connection.note = 'Example only. This is not a confirmed connection.';
  }
  return localized;
}

export type WorkspaceCommand =
  | { type: 'add-device'; device: z.input<typeof DeviceSchema> }
  | { type: 'update-device'; id: string; patch: DevicePatch }
  | { type: 'add-object'; object: SceneObject }
  | { type: 'update-object'; id: string; patch: SceneObjectPatch }
  | { type: 'update-part'; id: string; index: number; expectedLength: number; patch: BoxPartPatch }
  | { type: 'remove-object'; id: string }
  | { type: 'attach-object'; id: string; parentId: string | null }
  | { type: 'snap-object'; id: string; surfaceId: string }
  | {
      type: 'move-object';
      id: string;
      x?: number;
      z?: number;
      placement?: Placement;
      dragPath?: Placement[];
    }
  | { type: 'remove-device'; id: string }
  | { type: 'connect'; connection: Connection }
  | { type: 'remove-connection'; id: string }
  | { type: 'appearance'; patch: Partial<Workspace['appearance']> }
  | { type: 'rename'; name: string };

/** Every mutation is validated. Topology changes never establish operating status. */
export function applyCommand(
  current: Workspace,
  command: WorkspaceCommand,
  at = new Date().toISOString(),
): Workspace {
  let next = structuredClone(current);
  let summary = '';
  switch (command.type) {
    case 'add-device':
      next.devices.push(
        DeviceSchema.parse({
          ...command.device,
          visual: command.device.visual ?? defaultVisual(command.device.source),
        }),
      );
      summary = `Added ${command.device.name}`;
      break;
    case 'update-device': {
      const index = next.devices.findIndex((d) => d.id === command.id);
      if (index < 0) throw new Error('Device not found. Check the latest workspace.');
      const previous = next.devices[index];
      next.devices[index] = DeviceSchema.parse({
        ...previous,
        ...command.patch,
        placement: command.patch.placement
          ? { ...previous.placement, ...command.patch.placement }
          : previous.placement,
        visual:
          command.patch.visual ||
          command.patch.placement ||
          command.patch.parts ||
          command.patch.shapeMode
            ? {
                ...previous.visual,
                ...command.patch.visual,
                scale: { ...previous.visual.scale, ...command.patch.visual?.scale },
                source: 'user-reported',
              }
            : previous.visual,
      });
      summary = `Updated ${next.devices[index].name}`;
      break;
    }
    case 'add-object':
      next.objects.push(SceneObjectSchema.parse(command.object));
      summary = `Added ${command.object.name}`;
      break;
    case 'update-object': {
      const index = next.objects.findIndex((o) => o.id === command.id);
      if (index < 0) throw new Error('Object not found. Check the latest workspace.');
      const previous = next.objects[index];
      if (
        previous.kind === 'desk' &&
        command.patch.kind &&
        command.patch.kind !== 'desk' &&
        [...next.devices, ...next.objects].some((item) => item.attachment?.parentId === previous.id)
      )
        throw new Error('Detach this desk’s attached objects before choosing another template.');
      next.objects[index] = SceneObjectSchema.parse({
        ...previous,
        ...command.patch,
        placement: { ...previous.placement, ...command.patch.placement },
        visual: {
          ...previous.visual,
          ...command.patch.visual,
          scale: { ...previous.visual.scale, ...command.patch.visual?.scale },
          source: 'user-reported',
        },
      });
      summary = `Updated ${next.objects[index].name}`;
      break;
    }
    case 'update-part': {
      const item = [...next.devices, ...next.objects].find((entry) => entry.id === command.id);
      if (!item) throw new Error('Object not found. Check the latest workspace.');
      const parts = item.parts ?? [];
      if (
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index >= parts.length ||
        command.expectedLength !== parts.length
      )
        throw new Error(
          'The shape changed before this part edit could be saved. Select the part again and retry.',
        );
      const custom =
        item.shapeMode === 'custom' ||
        (item.kind === 'generic' && item.shapeMode !== 'template' && parts.length > 0);
      if (!custom) throw new Error('Customize this template before editing its parts.');
      const part = parts[command.index];
      parts[command.index] = BoxPartSchema.parse({
        ...part,
        ...command.patch,
        position: { ...part.position, ...command.patch.position },
        size: { ...part.size, ...command.patch.size },
        ...(command.patch.rotation
          ? {
              rotation: { x: 0, y: 0, z: 0, ...part.rotation, ...command.patch.rotation },
            }
          : {}),
      });
      item.parts = parts;
      item.visual.source = 'user-reported';
      if (command.patch.color !== undefined) item.visual.color = null;
      if (command.patch.position || command.patch.size || command.patch.rotation) {
        const result = resolveSpatialEdit(current, next, command.id, {
          preserveSupport:
            !command.patch.position && !!(command.patch.size || command.patch.rotation),
        });
        if (result.blocked)
          throw new Error(result.reason || 'This part edit would intersect another object.');
        next = result.workspace;
      }
      summary = `Edited box ${command.index + 1} of ${item.name}`;
      break;
    }
    case 'remove-object': {
      const object = next.objects.find((o) => o.id === command.id);
      if (!object) throw new Error('Object not found.');
      next.objects = next.objects.filter((o) => o.id !== command.id);
      for (const item of [...next.devices, ...next.objects])
        if (item.attachment?.parentId === command.id) item.attachment = null;
      summary = `Removed ${object.name}`;
      break;
    }
    case 'remove-device':
      if (!next.devices.some((d) => d.id === command.id)) throw new Error('Device not found.');
      summary = `Removed ${next.devices.find((d) => d.id === command.id)!.name}`;
      next.devices = next.devices.filter((d) => d.id !== command.id);
      next.connections = next.connections.filter(
        (c) => c.from !== command.id && c.to !== command.id,
      );
      break;
    case 'connect': {
      const c = ConnectionSchema.parse(command.connection);
      next.connections = next.connections.filter(
        (e) => !((e.from === c.from && e.to === c.to) || (e.from === c.to && e.to === c.from)),
      );
      next.connections.push(c);
      summary = `Saved ${c.connector} connection · Working status unverified`;
      break;
    }
    case 'remove-connection':
      next.connections = next.connections.filter((c) => c.id !== command.id);
      summary = 'Removed connection';
      break;
    case 'attach-object': {
      const item = [...next.devices, ...next.objects].find((object) => object.id === command.id);
      if (!item) throw new Error('Object not found.');
      if (command.parentId) {
        const parent = next.objects.find((object) => object.id === command.parentId);
        if (!parent || parent.kind !== 'desk' || item.kind === 'desk' || parent.id === item.id)
          throw new Error('Choose a desk to attach this object. Desks cannot be attached.');
        next = snapToSurface(next, command.id, command.parentId);
        const placed = [...next.devices, ...next.objects].find(
          (object) => object.id === command.id,
        )!;
        placed.attachment = { parentId: command.parentId };
        placed.visual.source = 'user-reported';
      } else {
        item.attachment = null;
        item.visual.source = 'user-reported';
      }
      summary = command.parentId ? `Attached ${item.name} to desk` : `Detached ${item.name}`;
      break;
    }
    case 'snap-object': {
      next = snapToSurface(next, command.id, command.surfaceId);
      const placed = [...next.devices, ...next.objects].find((object) => object.id === command.id)!;
      placed.visual.source = 'user-reported';
      summary = command.surfaceId === 'floor' ? 'Placed object on floor' : 'Placed object on desk';
      break;
    }
    case 'move-object': {
      const original = [...current.devices, ...current.objects].find(
        (object) => object.id === command.id,
      );
      if (!original) throw new Error('Object not found.');
      const endpoint = PlacementSchema.parse(
        command.placement ?? {
          ...original.placement,
          x: command.x ?? original.placement.x,
          z: command.z ?? original.placement.z,
        },
      );
      const path = command.dragPath
        ? z.array(PlacementSchema).min(1).max(512).parse(command.dragPath)
        : [endpoint];
      const last = path.at(-1)!;
      if (
        command.dragPath &&
        ['x', 'y', 'z', 'rotation'].some(
          (axis) =>
            Math.abs(last[axis as keyof Placement] - endpoint[axis as keyof Placement]) > 0.0001,
        )
      )
        throw new Error('The drag path does not match its final position. Try dragging again.');
      for (const point of path) {
        const candidate = structuredClone(next);
        const item = [...candidate.devices, ...candidate.objects].find(
          (object) => object.id === command.id,
        )!;
        item.placement = point;
        item.visual.source = 'user-reported';
        const result = resolveSpatialEdit(next, candidate, command.id, {
          snap: command.dragPath ? undefined : 'auto',
        });
        if (command.dragPath && result.blocked)
          throw new Error('The scene changed during the drag. ' + result.reason);
        next = result.workspace;
      }
      summary = `Moved ${original.name}`;
      break;
    }
    case 'appearance':
      next.appearance = { ...next.appearance, ...command.patch };
      break;
    case 'rename':
      next.name = command.name;
      summary = 'Renamed workspace';
      break;
  }
  if (command.type === 'update-device' || command.type === 'update-object') {
    const patch = command.patch;
    if (patch.placement || patch.visual?.scale || patch.parts || patch.shapeMode || patch.kind) {
      const result = resolveSpatialEdit(current, next, command.id, {
        preserveSupport:
          patch.placement?.y === undefined &&
          !!(patch.visual?.scale || patch.shapeMode || patch.kind),
      });
      next = result.workspace;
      if (result.blocked)
        throw new Error(
          result.reason ||
            'This change would intersect another object. Move it to clear space first.',
        );
    }
  }
  if (command.type === 'add-object' || command.type === 'add-device') {
    const id = command.type === 'add-object' ? command.object.id : command.device.id;
    next = findFreePlacement(next, id);
  }
  if (JSON.stringify({ ...next, history: [] }) === JSON.stringify({ ...current, history: [] }))
    return current;
  if (summary)
    next.history = [
      { id: crypto.randomUUID(), at, summary, source: 'user-reported' as const },
      ...next.history,
    ].slice(0, 100);
  return WorkspaceSchema.parse(next);
}

export const ProposalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('connect'),
    from: Id,
    to: Id,
    connector: ConnectorSchema,
    reason: z.string().max(300),
  }),
  z.object({
    type: z.literal('set-status'),
    deviceId: Id,
    status: StatusSchema,
    note: z.string().min(1).max(300),
    reason: z.string().max(300),
  }),
  z.object({
    type: z.literal('rename-device'),
    deviceId: Id,
    name: z.string().trim().min(1).max(60),
    reason: z.string().max(300),
  }),
  z.object({
    type: z.literal('add-device'),
    kind: DeviceKindSchema,
    name: z.string().trim().min(1).max(60),
    x: z.number().min(-3.2).max(3.2),
    z: z.number().min(-1.3).max(1.3),
    reason: z.string().max(300),
  }),
]);
export type Proposal = z.infer<typeof ProposalSchema>;
export const AssistantResponseSchema = z.object({
  message: z.string().min(1).max(6000),
  proposals: z.array(ProposalSchema).max(8),
});
export type AssistantResponse = z.infer<typeof AssistantResponseSchema> & { mode: 'demo' | 'meta' };

/** An explicit confirmation is required in the UI before calling this function. */
export function applyProposal(
  workspace: Workspace,
  raw: Proposal,
  source: Source = 'user-reported',
): Workspace {
  const p = ProposalSchema.parse(raw);
  if (p.type === 'connect')
    return applyCommand(workspace, {
      type: 'connect',
      connection: {
        id: crypto.randomUUID(),
        from: p.from,
        to: p.to,
        connector: p.connector,
        fromPort: '',
        toPort: '',
        source: 'user-reported',
        note: p.reason,
      },
    });
  if (p.type === 'set-status')
    return applyCommand(workspace, {
      type: 'update-device',
      id: p.deviceId,
      patch: { status: p.status, statusNote: p.note },
    });
  if (p.type === 'rename-device')
    return applyCommand(workspace, {
      type: 'update-device',
      id: p.deviceId,
      patch: { name: p.name, source: 'user-reported' },
    });
  return applyCommand(workspace, {
    type: 'add-device',
    device: {
      id: crypto.randomUUID(),
      kind: p.kind,
      name: p.name,
      model: '',
      placement: { x: p.x, z: p.z, rotation: 0 },
      status: 'unknown',
      statusNote: '',
      source,
      visual: defaultVisual(source),
    },
  });
}

const LegacyPlacementSchema = z.object({
  x: PlacementSchema.shape.x,
  z: PlacementSchema.shape.z,
  rotation: z.number().finite().min(-180).max(180),
});
const LegacyWorkspaceSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(60),
  devices: z
    .array(
      z
        .object(DeviceSchema.shape)
        .omit({ visual: true, parts: true, shapeMode: true, attachment: true })
        .extend({ placement: LegacyPlacementSchema }),
    )
    .max(40),
  connections: z.array(ConnectionSchema).max(100),
  history: z.array(EventSchema).max(100),
  appearance: z.object({
    lighting: z.enum(['day', 'sunset', 'night']),
    labels: z.boolean(),
    decor: z.boolean(),
  }),
});
/** Reads v1 without writing storage. The caller controls the eventual save/undo step. */
export function parseWorkspace(value: unknown): Workspace {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion === 1
  ) {
    const legacy = LegacyWorkspaceSchema.parse(value);
    const occupied = new Set(legacy.devices.map((device) => device.id));
    const objects = createDemoObjects().map((object) => {
      let id = object.id;
      let suffix = 1;
      while (occupied.has(id)) id = `${object.id}-migrated-${suffix++}`;
      occupied.add(id);
      return { ...object, id };
    });
    return WorkspaceSchema.parse({
      ...legacy,
      schemaVersion: 2,
      devices: legacy.devices.map((device) => ({
        ...device,
        placement: { ...device.placement, y: 2.51 },
        visual: defaultVisual(device.source),
      })),
      objects,
    });
  }
  return WorkspaceSchema.parse(value);
}

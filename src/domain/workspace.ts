import { z } from 'zod';

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
const Id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const PlacementSchema = z.object({
  x: z.number().finite().min(-3.2).max(3.2),
  z: z.number().finite().min(-1.3).max(1.3),
  rotation: z.number().finite().min(-180).max(180),
});
export const DeviceSchema = z.object({
  id: Id,
  kind: DeviceKindSchema,
  name: z.string().trim().min(1).max(60),
  model: z.string().max(100),
  placement: PlacementSchema,
  source: SourceSchema,
  status: StatusSchema,
  statusNote: z.string().max(300),
});
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
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(60),
    devices: z.array(DeviceSchema).max(40),
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
    placement: { x, z, rotation },
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
    schemaVersion: 1,
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
  | { type: 'add-device'; device: Device }
  | { type: 'update-device'; id: string; patch: Partial<Omit<Device, 'id'>> }
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
  const next = structuredClone(current);
  let summary = '';
  switch (command.type) {
    case 'add-device':
      next.devices.push(DeviceSchema.parse(command.device));
      summary = `Added ${command.device.name}`;
      break;
    case 'update-device': {
      const index = next.devices.findIndex((d) => d.id === command.id);
      if (index < 0) throw new Error('Device not found. Check the latest workspace.');
      next.devices[index] = DeviceSchema.parse({ ...next.devices[index], ...command.patch });
      summary = `Updated ${next.devices[index].name}`;
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
    case 'appearance':
      next.appearance = { ...next.appearance, ...command.patch };
      break;
    case 'rename':
      next.name = command.name;
      summary = 'Renamed workspace';
      break;
  }
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
    },
  });
}

export function parseWorkspace(value: unknown): Workspace {
  return WorkspaceSchema.parse(value);
}

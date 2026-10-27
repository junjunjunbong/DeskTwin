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
  laptop: '노트북',
  monitor: '모니터',
  dock: 'Dock',
  ssd: '외장 SSD',
  router: '공유기',
  keyboard: '키보드',
  mouse: '마우스',
  desktop: '데스크톱',
};
export const sourceLabels: Record<Source, string> = {
  demo: '예시 데이터',
  'user-reported': '사용자 입력',
  'photo-inferred': '사진에서 추정',
};
export const statusLabels: Record<Device['status'], string> = {
  unknown: '작동 상태 미확인',
  'reported-working': '사용자: 정상 동작',
  'reported-issue': '사용자: 문제 있음',
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
    note: '체험용 예시입니다. 실제 연결이 아닙니다.',
  });
  return WorkspaceSchema.parse({
    schemaVersion: 1,
    name: '나의 작은 작업실',
    devices: [
      device('laptop', 'laptop', 'MacBook', -2.1, 0.1, 10),
      device('monitor-left', 'monitor', '왼쪽 모니터', -0.7, -0.7),
      device('monitor-right', 'monitor', '오른쪽 모니터', 1.15, -0.7, -8),
      device('dock', 'dock', 'USB-C Dock', 0.15, 0.05),
      device('ssd', 'ssd', '외장 SSD', 1.65, 0.6, -12),
      device('router', 'router', '공유기', 2.55, -0.55),
      device('keyboard', 'keyboard', '키보드', -0.15, 0.88),
      device('mouse', 'mouse', '마우스', 0.98, 0.96),
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
      summary = `${command.device.name} 추가`;
      break;
    case 'update-device': {
      const index = next.devices.findIndex((d) => d.id === command.id);
      if (index < 0) throw new Error('기기를 찾지 못했습니다. 최신 구성을 확인해 주세요.');
      next.devices[index] = DeviceSchema.parse({ ...next.devices[index], ...command.patch });
      summary = `${next.devices[index].name} 정보 수정`;
      break;
    }
    case 'remove-device':
      if (!next.devices.some((d) => d.id === command.id))
        throw new Error('기기를 찾지 못했습니다.');
      summary = `${next.devices.find((d) => d.id === command.id)!.name} 삭제`;
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
      summary = `${c.connector} 연결 구성 저장 · 작동 여부는 미확인`;
      break;
    }
    case 'remove-connection':
      next.connections = next.connections.filter((c) => c.id !== command.id);
      summary = '연결 구성 삭제';
      break;
    case 'appearance':
      next.appearance = { ...next.appearance, ...command.patch };
      break;
    case 'rename':
      next.name = command.name;
      summary = '작업실 이름 변경';
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

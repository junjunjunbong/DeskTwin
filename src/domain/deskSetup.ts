import { z } from 'zod';
import {
  ConnectorSchema,
  IdSchema,
  type Connection,
  type Device,
  type Workspace,
  type WorkspaceCommand,
} from './workspace';

export const SetupConnectionDraftSchema = z.strictObject({
  from: IdSchema,
  to: IdSchema,
  connector: ConnectorSchema,
  fromPort: z.string().trim().max(40),
  toPort: z.string().trim().max(40),
  note: z.string().trim().max(300),
});
export type SetupConnectionDraft = z.infer<typeof SetupConnectionDraftSchema>;
export type SetupQuestion = { deviceId: string; text: string };

export function setupConnectionForPair(workspace: Workspace, from: string, to: string) {
  return workspace.connections.find(
    (edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from),
  );
}

/** Sample and inferred edges cannot answer a question about the user's physical setup. */
export function setupConnectionQuestions(workspace: Workspace): SetupQuestion[] {
  const peers = (device: Device) =>
    workspace.connections
      .filter(
        (edge) =>
          edge.source === 'user-reported' && (edge.from === device.id || edge.to === device.id),
      )
      .map((edge) =>
        workspace.devices.find(
          (item) => item.id === (edge.from === device.id ? edge.to : edge.from),
        ),
      )
      .filter((device): device is Device => !!device);
  const priority: Partial<Record<Device['kind'], number>> = { monitor: 0, dock: 1, ssd: 2 };
  return workspace.devices
    .map((device, index) => ({ device, index }))
    .sort(
      (a, b) =>
        (priority[a.device.kind] ?? 3) - (priority[b.device.kind] ?? 3) || a.index - b.index,
    )
    .flatMap(({ device }): SetupQuestion[] => {
      const connected = peers(device);
      if (device.kind === 'dock') {
        if (connected.some((peer) => peer.kind === 'laptop' || peer.kind === 'desktop')) return [];
        return [
          {
            deviceId: device.id,
            text: `Which computer is connected to ${device.name}, and which cable or port did you check?`,
          },
        ];
      }
      if (device.kind === 'monitor') {
        if (connected.some((peer) => ['laptop', 'desktop', 'dock'].includes(peer.kind))) return [];
        return [
          {
            deviceId: device.id,
            text: `Is ${device.name} connected directly to a computer or through a dock?`,
          },
        ];
      }
      if (connected.length || device.kind === 'laptop' || device.kind === 'desktop') return [];
      return [
        {
          deviceId: device.id,
          text: `What is ${device.name} connected to? Leave it unanswered if you are unsure.`,
        },
      ];
    });
}

const setupClauseRejection =
  /[?？]|\b(?:how|should|could|would|might|maybe|perhaps|not|never|disconnected|disconnect|no)\b|않|연결할|연결안|안\s*연결/;
const setupClauseConnection =
  /\b(?:i\s+(?:have\s+)?connected|is\s+connected|are\s+connected|connected\s+.+\s+to)\b|연결했|연결되어|연결돼|연결했다/;
const setupConnectors: [Connection['connector'], RegExp][] = [
  ['USB-C', /\busb[ -]?c\b/],
  ['USB-A', /\busb[ -]?a\b/],
  ['HDMI', /\bhdmi\b/],
  ['DisplayPort', /\bdisplayport\b|\bdp\b/],
  ['Ethernet', /\bethernet\b|이더넷/],
  ['Bluetooth', /\bbluetooth\b|블루투스/],
];
const setupSuggestionNote =
  'The user reviewed and confirmed a connection described in their setup notes.';
const setupKindWords: { word: string; kind: Device['kind'] }[] = [
  { word: 'docking station', kind: 'dock' },
  { word: 'computer tower', kind: 'desktop' },
  { word: '컴퓨터 타워', kind: 'desktop' },
  { word: 'notebook', kind: 'laptop' },
  { word: 'macbook', kind: 'laptop' },
  { word: 'desktop', kind: 'desktop' },
  { word: 'display', kind: 'monitor' },
  { word: 'monitor', kind: 'monitor' },
  { word: 'screen', kind: 'monitor' },
  { word: 'laptop', kind: 'laptop' },
  { word: 'dock', kind: 'dock' },
  { word: 'hub', kind: 'dock' },
  { word: 'pc', kind: 'desktop' },
  { word: '디스플레이', kind: 'monitor' },
  { word: '노트북', kind: 'laptop' },
  { word: '데스크탑', kind: 'desktop' },
  { word: '데스크톱', kind: 'desktop' },
  { word: '모니터', kind: 'monitor' },
  { word: '맥북', kind: 'laptop' },
  { word: '화면', kind: 'monitor' },
  { word: '도크', kind: 'dock' },
  { word: '허브', kind: 'dock' },
];
const setupKindByWord = new Map(
  setupKindWords.map((entry) => [entry.word.replace(/\s+/g, ' '), entry.kind]),
);

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const setupKindMention = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(left|right)\\s+|(왼쪽|오른쪽)\\s*)?(?:computer\\s+|컴퓨터\\s*)?(${[
    ...setupKindWords,
  ]
    .sort((a, b) => b.word.length - a.word.length)
    .map((entry) =>
      entry.word
        .trim()
        .split(/\s+/)
        .map((part) => escapeRegExp(part))
        .join('\\s+'),
    )
    .join(
      '|',
    )})(?:에서|으로|에게|한테|에는|에도|은|는|이|가|을|를|에|와|과|도|만|의|로)*(?![\\p{L}\\p{N}])`,
  'gu',
);

function devicesNamedInClause(normalized: string, workspace: Workspace) {
  return workspace.devices.filter((device) => {
    const name = device.name.trim().toLocaleLowerCase('en-US');
    if (name.length < 2) return false;
    const escaped = escapeRegExp(name);
    // Unicode boundaries avoid matching "Dock" inside "Docking station".
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(normalized);
  });
}

function maskDeviceNames(normalized: string, devices: Device[]) {
  const names = [...new Set(devices.map((device) => device.name.trim().toLocaleLowerCase('en-US')))]
    .filter((name) => name.length >= 2)
    .sort((a, b) => b.length - a.length);
  return names.reduce((value, name) => {
    const escaped = escapeRegExp(name);
    return value.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu'),
      ' '.repeat(name.length),
    );
  }, normalized);
}

function resolveKindMention(kind: Device['kind'], side: string | undefined, workspace: Workspace) {
  let matches = workspace.devices.filter((device) => device.kind === kind);
  if (kind === 'monitor' && side) {
    const token = side.toLocaleLowerCase('en-US');
    matches = matches.filter((device) => device.name.toLocaleLowerCase('en-US').includes(token));
  }
  return matches.length === 1 ? matches[0] : null;
}

// A device named "USB-C Dock" does not report the cable type of this connection.
function connectorInReport(normalized: string, devices: Device[]): Connection['connector'] {
  const connectionText = devices.reduce(
    (value, device) => value.replaceAll(device.name.trim().toLocaleLowerCase('en-US'), ' '),
    normalized,
  );
  const found = setupConnectors.filter(([, pattern]) => pattern.test(connectionText));
  return found.length === 1 ? found[0][0] : 'Unknown';
}

function draftFromClause(clause: string, workspace: Workspace): SetupConnectionDraft | null {
  const normalized = clause.toLocaleLowerCase('en-US');
  if (
    !normalized ||
    setupClauseRejection.test(normalized) ||
    !setupClauseConnection.test(normalized)
  )
    return null;
  const named = devicesNamedInClause(normalized, workspace);
  const ids = new Set(named.map((device) => device.id));
  for (const match of maskDeviceNames(normalized, named).matchAll(
    new RegExp(setupKindMention.source, 'gu'),
  )) {
    const kind = setupKindByWord.get(match[3]?.replace(/\s+/g, ' ') ?? '');
    if (!kind) continue;
    const device = resolveKindMention(kind, match[1] || match[2], workspace);
    if (device) ids.add(device.id);
  }
  const mentioned = workspace.devices.filter((device) => ids.has(device.id));
  if (
    mentioned.length !== 2 ||
    mentioned[0].name.toLocaleLowerCase('en-US') === mentioned[1].name.toLocaleLowerCase('en-US')
  )
    return null;
  return {
    from: mentioned[0].id,
    to: mentioned[1].id,
    connector: connectorInReport(normalized, mentioned),
    fromPort: '',
    toPort: '',
    note: setupSuggestionNote,
  };
}

/** A deliberately narrow note helper; it never interprets a photo or infers an unseen cable. */
export function setupSuggestionFromNotes(
  notes: string,
  workspace: Workspace,
): SetupConnectionDraft | null {
  const text = notes.slice(0, 2000).trim();
  const normalized = text.toLocaleLowerCase('en-US');
  if (!text || setupClauseRejection.test(normalized) || !setupClauseConnection.test(normalized))
    return null;
  const mentioned = devicesNamedInClause(normalized, workspace);
  if (
    mentioned.length !== 2 ||
    mentioned[0].name.toLocaleLowerCase('en-US') === mentioned[1].name.toLocaleLowerCase('en-US')
  )
    return null;
  return {
    from: mentioned[0].id,
    to: mentioned[1].id,
    connector: connectorInReport(normalized, mentioned),
    fromPort: '',
    toPort: '',
    note: setupSuggestionNote,
  };
}

/** One reviewable draft per reported pair. An ambiguous or denied clause adds nothing. */
export function setupSuggestionsFromNotes(
  notes: string,
  workspace: Workspace,
): SetupConnectionDraft[] {
  const drafts: SetupConnectionDraft[] = [];
  const seen = new Set<string>();
  for (const clause of notes
    .slice(0, 2000)
    .trim()
    .split(/[.;!?\n\r。．；？！]+/u)
    .map((entry) => entry.trim())
    .filter(Boolean)) {
    const draft = draftFromClause(clause, workspace);
    if (!draft) continue;
    const pair = [draft.from, draft.to].sort().join('\0');
    if (seen.has(pair)) continue;
    const existing = setupConnectionForPair(workspace, draft.from, draft.to);
    if (existing?.source === 'user-reported' && existing.connector === draft.connector) continue;
    seen.add(pair);
    drafts.push(draft);
  }
  return drafts;
}

export const plugInReport =
  'Saved as what you reported. This does not check that it works.';

/** Devices with no saved link can be answered from the desk. Existing links stay as they are. */
export function plugInTargets(workspace: Workspace, deviceId: string): Device[] {
  if (!workspace.devices.some((device) => device.id === deviceId)) return [];
  if (workspace.connections.some((edge) => edge.from === deviceId || edge.to === deviceId))
    return [];
  return workspace.devices.filter((device) => device.id !== deviceId);
}

/** The clicked device name is the confirmation. Cable and ports stay unchecked. */
export function plugInCommand(workspace: Workspace, from: string, to: string): WorkspaceCommand {
  if (!plugInTargets(workspace, from).some((device) => device.id === to))
    throw new Error('Choose a device on this desk.');
  return setupConnectionCommand(
    workspace,
    {
      from,
      to,
      connector: 'Unknown',
      fromPort: '',
      toPort: '',
      note: plugInReport,
    },
    setupConnectionForPair(workspace, from, to) ?? null,
  );
}

/** Review is a snapshot, not blanket permission to replace a later record. */
export function setupConnectionCommand(
  workspace: Workspace,
  raw: SetupConnectionDraft,
  reviewedConnection: Connection | null,
): WorkspaceCommand {
  const draft = SetupConnectionDraftSchema.parse(raw);
  if (draft.from === draft.to) throw new Error('Choose two different devices.');
  if (![draft.from, draft.to].every((id) => workspace.devices.some((device) => device.id === id)))
    throw new Error('A selected device is no longer in this desk. Review the connection again.');
  const current = setupConnectionForPair(workspace, draft.from, draft.to) ?? null;
  if (JSON.stringify(current) !== JSON.stringify(reviewedConnection))
    throw new Error('This connection changed after your review. Review the current record again.');
  return {
    type: 'connect',
    connection: { ...draft, id: crypto.randomUUID(), source: 'user-reported' },
    expectedConnection: reviewedConnection,
  };
}

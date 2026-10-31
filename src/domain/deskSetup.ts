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

/** A deliberately narrow note helper; it never interprets a photo or infers an unseen cable. */
export function setupSuggestionFromNotes(
  notes: string,
  workspace: Workspace,
): SetupConnectionDraft | null {
  const text = notes.slice(0, 2000).trim();
  const normalized = text.toLocaleLowerCase('en-US');
  if (
    !text ||
    /[?？]|\b(?:how|should|could|would|might|maybe|perhaps|not|never|disconnected|disconnect|no)\b|않|연결할|연결안|안\s*연결/.test(
      normalized,
    ) ||
    !/\b(?:i\s+(?:have\s+)?connected|is\s+connected|are\s+connected|connected\s+.+\s+to)\b|연결했|연결되어|연결돼|연결했다/.test(
      normalized,
    )
  )
    return null;
  const mentioned = workspace.devices.filter((device) => {
    const name = device.name.trim().toLocaleLowerCase('en-US');
    if (name.length < 2) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Unicode boundaries avoid matching "Dock" inside "Docking station".
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').test(normalized);
  });
  if (
    mentioned.length !== 2 ||
    mentioned[0].name.toLocaleLowerCase('en-US') === mentioned[1].name.toLocaleLowerCase('en-US')
  )
    return null;
  const connectors: [Connection['connector'], RegExp][] = [
    ['USB-C', /\busb[ -]?c\b/],
    ['USB-A', /\busb[ -]?a\b/],
    ['HDMI', /\bhdmi\b/],
    ['DisplayPort', /\bdisplayport\b|\bdp\b/],
    ['Ethernet', /\bethernet\b|이더넷/],
    ['Bluetooth', /\bbluetooth\b|블루투스/],
  ];
  // A device named "USB-C Dock" does not report the cable type of this connection.
  const connectionText = mentioned.reduce(
    (value, device) => value.replaceAll(device.name.trim().toLocaleLowerCase('en-US'), ' '),
    normalized,
  );
  const found = connectors.filter(([, pattern]) => pattern.test(connectionText));
  return {
    from: mentioned[0].id,
    to: mentioned[1].id,
    connector: found.length === 1 ? found[0][0] : 'Unknown',
    fromPort: '',
    toPort: '',
    note: 'The user reviewed and confirmed a connection described in their setup notes.',
  };
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

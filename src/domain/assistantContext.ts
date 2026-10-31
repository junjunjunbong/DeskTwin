import type { Workspace } from './workspace';
import { diagnosticContextMatches } from './diagnosis';

export type AssistantSceneFocus = {
  deviceIds: string[];
  connectionIds: string[];
};

/** A deterministic reference to recorded topology, never a claim about a live signal path. */
export function assistantSceneFocus(
  workspace: Workspace,
  deviceId: string | null | undefined,
): AssistantSceneFocus | null {
  const target = workspace.devices.find((device) => device.id === deviceId);
  if (!target) return null;
  const devices = new Map(workspace.devices.map((device) => [device.id, device]));
  const queue: AssistantSceneFocus[] = [{ deviceIds: [target.id], connectionIds: [] }];
  const visited = new Set([target.id]);
  while (queue.length) {
    const path = queue.shift()!;
    const id = path.deviceIds.at(-1)!;
    const device = devices.get(id)!;
    if (device.kind === 'laptop' || device.kind === 'desktop') return path;
    // A monitor reference route must not travel through unrelated peripherals or data-only links.
    const candidates = workspace.connections
      .filter((connection) => connection.from === id || connection.to === id)
      .sort((a, b) => a.id.localeCompare(b.id));
    for (const connection of candidates) {
      const peerId = connection.from === id ? connection.to : connection.from;
      const peer = devices.get(peerId);
      if (!peer || visited.has(peerId)) continue;
      if (
        target.kind === 'monitor' &&
        (!['dock', 'laptop', 'desktop'].includes(peer.kind) ||
          !['HDMI', 'DisplayPort', 'USB-C', 'Unknown'].includes(connection.connector))
      )
        continue;
      visited.add(peerId);
      queue.push({
        deviceIds: [...path.deviceIds, peerId],
        connectionIds: [...path.connectionIds, connection.id],
      });
    }
  }
  // With no recorded route to a computer, show only the selected target's applicable links.
  const links = workspace.connections.filter((connection) => {
    if (connection.from !== target.id && connection.to !== target.id) return false;
    const peer = devices.get(connection.from === target.id ? connection.to : connection.from);
    return (
      !!peer &&
      (target.kind !== 'monitor' ||
        (['dock', 'laptop', 'desktop'].includes(peer.kind) &&
          ['HDMI', 'DisplayPort', 'USB-C', 'Unknown'].includes(connection.connector)))
    );
  });
  return {
    deviceIds: [...new Set([target.id, ...links.flatMap((link) => [link.from, link.to])])],
    connectionIds: links.map((link) => link.id),
  };
}

export function assistantTargetIsLocalOnly(workspace: Workspace, deviceId: string | null) {
  const device = workspace.devices.find((item) => item.id === deviceId);
  return !!(
    device &&
    (device.hardwareOrigin === 'macos' ||
      device.source === 'os-detected' ||
      device.visual.source === 'os-detected')
  );
}

/** Call only with modelWorkspace output. Free-form labels and live OS data are never added. */
export function assistantDiagnosticContext(workspace: Workspace, focusDeviceId?: string | null) {
  return (workspace.diagnoses ?? [])
    .filter(
      (session) => !session.localOnly && (!focusDeviceId || session.deviceId === focusDeviceId),
    )
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
    .slice(-5)
    .map((session) => ({
      sessionId: session.id,
      deviceId: session.deviceId,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      result: session.result,
      graphChanged: !diagnosticContextMatches(session, workspace),
      currentStep: session.result === 'active' ? session.plan[session.step].kind : null,
      answers: session.answers.map(({ kind, answer, at }) => ({ check: kind, answer, at })),
      stopReason: session.stopReason,
      recordedPath: session.path,
    }));
}

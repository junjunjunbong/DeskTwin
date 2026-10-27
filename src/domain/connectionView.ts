import type { Connection, Workspace } from './workspace';

export type ConnectionEmphasis = 'normal' | 'highlighted' | 'muted';
export interface ConnectionView {
  selectedDeviceId: string | null;
  counterpartIds: string[];
  lines: { connection: Connection; emphasis: ConnectionEmphasis }[];
}

/** View-only topology. Visibility and selection never change the saved records. */
export function getConnectionView(
  workspace: Workspace,
  selectedId: string | null,
  showConnections: boolean,
): ConnectionView {
  const selectedDeviceId = workspace.devices.some((device) => device.id === selectedId)
    ? selectedId
    : null;
  const incident = (connection: Connection) =>
    connection.from === selectedDeviceId || connection.to === selectedDeviceId;
  return {
    selectedDeviceId,
    counterpartIds: selectedDeviceId
      ? [
          ...new Set(
            workspace.connections
              .filter(incident)
              .map((connection) =>
                connection.from === selectedDeviceId ? connection.to : connection.from,
              ),
          ),
        ]
      : [],
    lines: showConnections
      ? workspace.connections.map((connection) => ({
          connection,
          emphasis: !selectedDeviceId ? 'normal' : incident(connection) ? 'highlighted' : 'muted',
        }))
      : [],
  };
}

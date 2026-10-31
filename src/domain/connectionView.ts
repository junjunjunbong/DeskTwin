import type { Connection, Workspace } from './workspace';

export type ConnectionEmphasis = 'normal' | 'highlighted' | 'muted';
export interface ConnectionFocusPath {
  deviceIds: string[];
  connectionIds: string[];
}
export interface ConnectionView {
  selectedDeviceId: string | null;
  counterpartIds: string[];
  hasFocusPath: boolean;
  focusedDeviceIds: string[];
  focusedConnectionIds: string[];
  lines: { connection: Connection; emphasis: ConnectionEmphasis }[];
}

/** View-only topology. Visibility and selection never change the saved records. */
export function getConnectionView(
  workspace: Workspace,
  selectedId: string | null,
  showConnections: boolean,
  focusPath?: ConnectionFocusPath | null,
): ConnectionView {
  const deviceIds = new Set(workspace.devices.map((device) => device.id));
  const focusedDeviceIds = [...new Set(focusPath?.deviceIds ?? [])].filter((id) =>
    deviceIds.has(id),
  );
  const focusedDevices = new Set(focusedDeviceIds);
  const requestedConnections = new Set(focusPath?.connectionIds ?? []);
  // A path is an explicit set of current records, never a guess at hidden cabling.
  const focusedConnectionIds = workspace.connections
    .filter(
      (connection) =>
        requestedConnections.has(connection.id) &&
        focusedDevices.has(connection.from) &&
        focusedDevices.has(connection.to),
    )
    .map((connection) => connection.id);
  const focusedConnections = new Set(focusedConnectionIds);
  const hasFocusPath = focusedDeviceIds.length > 0;
  const selectedDeviceId = workspace.devices.some((device) => device.id === selectedId)
    ? selectedId
    : null;
  const incident = (connection: Connection) =>
    connection.from === selectedDeviceId || connection.to === selectedDeviceId;
  return {
    selectedDeviceId,
    hasFocusPath,
    focusedDeviceIds,
    focusedConnectionIds,
    counterpartIds: hasFocusPath
      ? focusedDeviceIds.filter((id) => id !== selectedDeviceId)
      : selectedDeviceId
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
          emphasis: hasFocusPath
            ? focusedConnections.has(connection.id)
              ? 'highlighted'
              : 'muted'
            : !selectedDeviceId
              ? 'normal'
              : incident(connection)
                ? 'highlighted'
                : 'muted',
        }))
      : [],
  };
}

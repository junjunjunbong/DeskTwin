import { describe, expect, it } from 'vitest';
import { getConnectionView } from './connectionView';
import { createDemoWorkspace } from './workspace';

describe('recorded connection visibility', () => {
  it('shows every recorded connection, including wireless and unknown links', () => {
    const workspace = createDemoWorkspace();
    workspace.connections[0].connector = 'Bluetooth';
    workspace.connections[1].connector = 'Unknown';
    const view = getConnectionView(workspace, null, true);
    expect(view.lines.map(({ connection }) => connection)).toEqual(workspace.connections);
    expect(view.lines.every((line) => line.emphasis === 'normal')).toBe(true);
  });

  it('hides only lines and preserves records and selected-device counterparts', () => {
    const workspace = createDemoWorkspace();
    const original = structuredClone(workspace);
    const selected = workspace.connections[0].from;
    const shown = getConnectionView(workspace, selected, true);
    const hidden = getConnectionView(workspace, selected, false);
    expect(hidden.lines).toEqual([]);
    expect(hidden.counterpartIds).toEqual(shown.counterpartIds);
    expect(workspace).toEqual(original);
    expect(getConnectionView(workspace, selected, true)).toEqual(shown);
  });

  it('emphasizes incident records and both incoming and outgoing counterpart devices', () => {
    const workspace = createDemoWorkspace();
    const selected = workspace.connections[0].to;
    const view = getConnectionView(workspace, selected, true);
    expect(view.selectedDeviceId).toBe(selected);
    expect(view.lines).toHaveLength(workspace.connections.length);
    for (const line of view.lines) {
      const incident = line.connection.from === selected || line.connection.to === selected;
      expect(line.emphasis).toBe(incident ? 'highlighted' : 'muted');
      if (incident)
        expect(view.counterpartIds).toContain(
          line.connection.from === selected ? line.connection.to : line.connection.from,
        );
    }
    expect(view.counterpartIds).not.toContain(selected);
  });

  it('keeps every line visible when selecting furniture, props, or a removed device', () => {
    const workspace = createDemoWorkspace();
    for (const id of [workspace.objects[0].id, workspace.objects.at(-1)!.id, 'removed-device']) {
      const view = getConnectionView(workspace, id, true);
      expect(view.selectedDeviceId).toBeNull();
      expect(view.counterpartIds).toEqual([]);
      expect(view.lines).toHaveLength(workspace.connections.length);
      expect(view.lines.every((line) => line.emphasis === 'normal')).toBe(true);
    }
  });

  it('highlights only the requested path instead of every branch at the selected dock', () => {
    const workspace = createDemoWorkspace();
    const original = structuredClone(workspace);
    const view = getConnectionView(workspace, 'dock', true, {
      deviceIds: ['monitor-right', 'dock', 'laptop'],
      connectionIds: ['dock-monitor-right', 'laptop-dock'],
    });
    expect(view.hasFocusPath).toBe(true);
    expect(view.focusedDeviceIds).toEqual(['monitor-right', 'dock', 'laptop']);
    expect(view.counterpartIds).toEqual(['monitor-right', 'laptop']);
    expect(
      view.lines
        .filter((line) => line.emphasis === 'highlighted')
        .map((line) => line.connection.id),
    ).toEqual(['laptop-dock', 'dock-monitor-right']);
    expect(view.lines.find((line) => line.connection.id === 'dock-monitor-left')?.emphasis).toBe(
      'muted',
    );
    expect(view.lines.find((line) => line.connection.id === 'dock-ssd')?.emphasis).toBe('muted');
    expect(workspace).toEqual(original);
  });

  it('ignores unknown IDs and edges whose endpoints are outside the explicit path', () => {
    const workspace = createDemoWorkspace();
    const view = getConnectionView(workspace, null, true, {
      deviceIds: ['monitor-right', 'dock', 'dock', 'gone', workspace.objects[0].id],
      connectionIds: ['dock-monitor-right', 'laptop-dock', 'gone'],
    });
    expect(view.focusedDeviceIds).toEqual(['monitor-right', 'dock']);
    expect(view.focusedConnectionIds).toEqual(['dock-monitor-right']);
    expect(
      view.lines
        .filter((line) => line.emphasis === 'highlighted')
        .map((line) => line.connection.id),
    ).toEqual(['dock-monitor-right']);
    // After deletion, stale IDs cannot leave an invented highlighted connection.
    workspace.connections = workspace.connections.filter(
      (link) => link.id !== 'dock-monitor-right',
    );
    const updated = getConnectionView(workspace, null, true, {
      deviceIds: ['monitor-right', 'dock'],
      connectionIds: ['dock-monitor-right'],
    });
    expect(updated.focusedConnectionIds).toEqual([]);
    expect(updated.lines.every((line) => line.emphasis === 'muted')).toBe(true);
  });

  it('keeps focused devices while hiding all path lines with the connection toggle', () => {
    const workspace = createDemoWorkspace();
    const focus = {
      deviceIds: ['monitor-right', 'dock', 'laptop'],
      connectionIds: ['dock-monitor-right', 'laptop-dock'],
    };
    const shown = getConnectionView(workspace, 'monitor-right', true, focus);
    const hidden = getConnectionView(workspace, 'monitor-right', false, focus);
    expect(hidden.lines).toEqual([]);
    expect(hidden.focusedDeviceIds).toEqual(shown.focusedDeviceIds);
    expect(hidden.focusedConnectionIds).toEqual(shown.focusedConnectionIds);
    expect(hidden.counterpartIds).toEqual(shown.counterpartIds);
  });

  it('restores selection emphasis after clearing focus or when all focused devices are gone', () => {
    const workspace = createDemoWorkspace();
    const normalSelection = getConnectionView(workspace, 'dock', true);
    expect(getConnectionView(workspace, 'dock', true, null)).toEqual(normalSelection);
    expect(
      getConnectionView(workspace, 'dock', true, {
        deviceIds: ['gone'],
        connectionIds: ['gone'],
      }),
    ).toEqual(normalSelection);
  });
});

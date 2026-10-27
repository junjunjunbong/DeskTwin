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
});

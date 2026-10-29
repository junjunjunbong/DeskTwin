import { describe, expect, it } from 'vitest';
import {
  stoppedHardwareSnapshot,
  HardwareSnapshotSchema,
  type HardwareBinding,
  type HardwareDevice,
  type HardwareSnapshot,
} from './hardware';
import { hardwareMatchCommand, hardwarePresence, linkedDevice } from './hardwareState';
import {
  applyCommand,
  applyProposal,
  createDemoWorkspace,
  parseWorkspace,
  type Device,
  type Workspace,
} from './workspace';
import { modelWorkspace, portableWorkspace } from './workspacePrivacy';
import { applySceneDraft, buildSceneDraft, type SceneProposal } from './sceneProposal';

const scope = 'installation_test';
const sessionId = 'session_current';
const now = () => new Date().toISOString();

function observation(overrides: Partial<HardwareDevice> = {}): HardwareDevice {
  return {
    id: 'observation_display_1',
    category: 'display',
    name: 'Same monitor name',
    model: 'Vendor 1552 / Model 1234',
    source: 'macOS CoreGraphics + AppKit NSScreen',
    identity: { key: 'hardware_display_1', scope, stability: 'persistent' },
    status: 'online',
    parentId: null,
    attributes: [{ label: 'Active for drawing', value: 'No' }],
    ...overrides,
  };
}

function snapshot(devices = [observation()]): HardwareSnapshot {
  const value = stoppedHardwareSnapshot();
  value.state = 'running';
  value.sessionId = sessionId;
  value.identityScope = scope;
  value.lastCheckedAt = now();
  value.message = 'Read-only fixture observation';
  value.devices = devices;
  for (const category of ['display', 'usb'] as const)
    value.categories[category] = {
      state: 'ok',
      source: category === 'display' ? 'CoreGraphics' : 'IOKit',
      lastCheckedAt: value.lastCheckedAt,
      message: 'Successful fixture scan',
    };
  return value;
}

function binding(value = observation()): HardwareBinding {
  return { category: value.category, identity: structuredClone(value.identity), approvedAt: now() };
}

function linked(value = observation()): Device {
  return { ...createDemoWorkspace().devices[2], hardwareBinding: binding(value) };
}

function empty(): Workspace {
  return { ...createDemoWorkspace(), devices: [], objects: [], connections: [], history: [] };
}

function photo(deviceId: string | null = null): SceneProposal {
  return {
    message: 'Photo appearance only; operating status is not verified.',
    objects: [
      {
        id: 'visual-monitor',
        deviceId,
        kind: 'monitor',
        name: 'Photo monitor',
        placement: { x: 1.2, y: 2.51, z: -0.4, rotation: 0 },
        scale: { x: 1, y: 1, z: 1 },
        color: '#334455',
        parts: [],
        note: 'Visible screen shape.',
      },
    ],
  };
}

describe('OS presence is independent from operating reports', () => {
  it('does not use matching names to claim a desk device was detected', () => {
    const device = { ...createDemoWorkspace().devices[2], name: observation().name };
    expect(hardwarePresence(device, snapshot()).state).toBe('unlinked');
    expect(linkedDevice({ ...empty(), devices: [device] }, observation())).toBeUndefined();
  });

  it('can detect an inactive display while preserving a user-reported problem', () => {
    const device = linked();
    device.status = 'reported-issue';
    device.statusNote = 'No picture when I tested it.';
    const before = structuredClone(device);
    const presence = hardwarePresence(device, snapshot());
    expect(presence.state).toBe('detected');
    expect(presence.observation?.attributes[0].value).toBe('No');
    expect(presence.explanation).toContain('does not verify');
    expect(device).toEqual(before);
  });

  it.each(['stopped', 'unavailable'] as const)(
    'never derives absence or presence from a %s bridge',
    (state) => {
      const current = snapshot();
      current.state = state;
      expect(hardwarePresence(linked(), current).state).toBe(state);
      current.devices = [];
      expect(hardwarePresence(linked(), current).state).toBe(state);
    },
  );

  it.each(['permission-denied', 'error', 'unavailable'] as const)(
    'treats category %s as unknown even if old observations remain',
    (state) => {
      const current = snapshot();
      current.categories.display.state = state;
      const presence = hardwarePresence(linked(), current);
      expect(presence.state).toBe('unavailable');
      expect(presence.observation).toBeUndefined();
      expect(presence.lastCheckedAt).toBe(current.categories.display.lastCheckedAt);
    },
  );

  it('reports not-detected only after a successful scan in the approved installation', () => {
    expect(hardwarePresence(linked(), snapshot([])).state).toBe('not-detected');
    const otherInstallation = snapshot([]);
    otherInstallation.identityScope = 'installation_another';
    expect(hardwarePresence(linked(), otherInstallation).state).toBe('match-again');
    otherInstallation.identityScope = null;
    expect(hardwarePresence(linked(), otherInstallation).state).toBe('match-again');
  });

  it('treats a quarantined persistent match as ambiguous even with an empty successful scan or stale matching row', () => {
    const current = snapshot();
    current.ambiguousIdentities = [{ category: 'display', key: observation().identity.key }];
    for (const devices of [[observation()], []]) {
      current.devices = devices;
      const presence = hardwarePresence(linked(), current);
      expect(presence.state).toBe('match-again');
      expect(presence.label).toBe('Match again');
      expect(presence.explanation).toContain('ambiguous');
      expect(presence.observation).toBeUndefined();
    }
    const unrelated = observation({
      identity: { ...observation().identity, key: 'unrelated_identity' },
    });
    expect(hardwarePresence(linked(unrelated), current).state).toBe('not-detected');
    current.ambiguousIdentities = [{ category: 'usb', key: observation().identity.key }];
    expect(hardwarePresence(linked(), current).state).toBe('not-detected');
  });

  it('does not use ambiguity as evidence of detection during stopped, failed or denied checks', () => {
    const current = snapshot([]);
    current.ambiguousIdentities = [{ category: 'display', key: observation().identity.key }];
    current.state = 'stopped';
    expect(hardwarePresence(linked(), current).state).toBe('stopped');
    current.state = 'unavailable';
    expect(hardwarePresence(linked(), current).state).toBe('unavailable');
    current.state = 'running';
    current.categories.display.state = 'permission-denied';
    expect(hardwarePresence(linked(), current).state).toBe('unavailable');
  });

  it('continues to parse older snapshots without ambiguity evidence', () => {
    const { ambiguousIdentities: _omitted, ...legacy } = snapshot();
    const parsed = HardwareSnapshotSchema.parse(legacy);
    expect(hardwarePresence(linked(), parsed).state).toBe('detected');
    expect(hardwarePresence(linked(), { ...parsed, devices: [] }).state).toBe('not-detected');
  });

  it('requires a new explicit match for a serial-less reconnection despite the same name', () => {
    const first = observation({
      identity: { key: 'temporary_first', scope: sessionId, stability: 'session' },
    });
    const returned = observation({
      identity: { key: 'temporary_second', scope: sessionId, stability: 'session' },
    });
    const device = linked(first);
    expect(hardwarePresence(device, snapshot([first])).state).toBe('detected');
    expect(hardwarePresence(device, snapshot([])).state).toBe('match-again');
    expect(hardwarePresence(device, snapshot([returned])).state).toBe('match-again');
    expect(linkedDevice({ ...empty(), devices: [device] }, returned)).toBeUndefined();
    const restarted = snapshot([first]);
    restarted.sessionId = 'session_restarted';
    expect(hardwarePresence(device, restarted).state).toBe('match-again');
  });

  it('keeps a successful display check usable when USB permission is denied', () => {
    const usb = observation({
      id: 'observation_usb_1',
      category: 'usb',
      status: 'connected',
      identity: { key: 'hardware_usb_1', scope, stability: 'persistent' },
    });
    const current = snapshot([observation(), usb]);
    current.categories.usb.state = 'permission-denied';
    expect(hardwarePresence(linked(), current).state).toBe('detected');
    expect(hardwarePresence(linked(usb), current).state).toBe('unavailable');
  });
});

describe('explicit hardware matching preserves existing desk evidence', () => {
  it('rejects stale persistent review after ambiguity and accepts only an explicitly selected session observation', () => {
    const base = createDemoWorkspace();
    base.devices[2].hardwareBinding = binding();
    const before = structuredClone(base);
    const current = snapshot();
    current.ambiguousIdentities = [{ category: 'display', key: observation().identity.key }];
    expect(() =>
      hardwareMatchCommand(base, current, observation(), { existingId: 'monitor-right' }),
    ).toThrow('no longer current');
    const uncertain = observation({
      id: 'new_session_observation',
      identity: { key: 'new_session_identity', stability: 'session', scope: sessionId },
    });
    current.devices = [uncertain];
    const command = hardwareMatchCommand(base, current, uncertain, { existingId: 'monitor-right' });
    expect(base).toEqual(before);
    const saved = applyCommand(base, command);
    expect(saved.devices[2].hardwareBinding?.identity).toEqual(uncertain.identity);
    expect(hardwarePresence(saved.devices[2], current).state).toBe('detected');
    expect(saved.devices[2].status).toBe(before.devices[2].status);
    expect(saved.devices[2].statusNote).toBe(before.devices[2].statusNote);
    expect(saved.connections).toEqual(before.connections);
    expect(saved.objects).toEqual(before.objects);
    expect(JSON.stringify(portableWorkspace(saved))).not.toContain('new_session_identity');
    expect(JSON.stringify(modelWorkspace(saved))).not.toContain('new_session_identity');
  });
  it('constructs a proposal without mutation and applies only the approved association', () => {
    const base = createDemoWorkspace();
    base.devices[2].status = 'reported-issue';
    base.devices[2].statusNote = 'User confirmed flickering.';
    const before = structuredClone(base);
    const command = hardwareMatchCommand(base, snapshot(), observation(), {
      existingId: 'monitor-right',
    });
    expect(base).toEqual(before);
    expect(command.type).toBe('bind-hardware');
    const saved = applyCommand(base, command);
    const { hardwareBinding: savedBinding, ...record } = saved.devices[2];
    expect(savedBinding?.identity).toEqual(observation().identity);
    expect(record).toEqual(base.devices[2]);
    expect(saved.devices.filter((device) => device.id !== 'monitor-right')).toEqual(
      base.devices.filter((device) => device.id !== 'monitor-right'),
    );
    expect(saved.objects).toEqual(base.objects);
    expect(saved.connections).toEqual(base.connections);
    expect(saved.history).toHaveLength(base.history.length + 1);
  });

  it('adds two same-name observations as separate devices only after separate choices', () => {
    const first = observation();
    const second = observation({
      id: 'observation_display_2',
      identity: { key: 'hardware_display_2', scope, stability: 'persistent' },
    });
    const current = snapshot([first, second]);
    let workspace = empty();
    for (const item of [first, second])
      workspace = applyCommand(
        workspace,
        hardwareMatchCommand(workspace, current, item, {
          newDevice: { name: item.name, kind: 'monitor' },
        }),
      );
    expect(workspace.devices).toHaveLength(2);
    expect(new Set(workspace.devices.map((device) => device.id)).size).toBe(2);
    expect(
      workspace.devices.every(
        (device) =>
          device.name === first.name &&
          device.source === 'os-detected' &&
          device.hardwareOrigin === 'macos' &&
          device.status === 'unknown' &&
          device.statusNote === '',
      ),
    ).toBe(true);
    expect(workspace.connections).toEqual([]);
  });

  it('rejects duplicate approved identities both through matching and raw commands/import', () => {
    const base = createDemoWorkspace();
    base.devices[2].hardwareBinding = binding();
    expect(() =>
      hardwareMatchCommand(base, snapshot(), observation(), { existingId: 'monitor-left' }),
    ).toThrow('already linked');
    expect(() =>
      hardwareMatchCommand(base, snapshot(), observation(), {
        newDevice: { name: 'Duplicate', kind: 'monitor' },
      }),
    ).toThrow('already linked');
    expect(() =>
      applyCommand(base, { type: 'bind-hardware', id: 'monitor-left', binding: binding() }),
    ).toThrow('only one device');
    const malformed = structuredClone(base);
    malformed.devices[1].hardwareBinding = binding();
    expect(() => parseWorkspace(malformed)).toThrow('only one device');
  });

  it('rejects stale, stopped, failed-category and deleted-target approvals', () => {
    const base = createDemoWorkspace();
    expect(() =>
      hardwareMatchCommand(base, snapshot([]), observation(), { existingId: 'monitor-right' }),
    ).toThrow('no longer current');
    const stopped = snapshot();
    stopped.state = 'stopped';
    expect(() =>
      hardwareMatchCommand(base, stopped, observation(), { existingId: 'monitor-right' }),
    ).toThrow('no longer current');
    const denied = snapshot();
    denied.categories.display.state = 'permission-denied';
    expect(() =>
      hardwareMatchCommand(base, denied, observation(), { existingId: 'monitor-right' }),
    ).toThrow('no longer current');
    expect(() =>
      hardwareMatchCommand(base, snapshot(), observation(), { existingId: 'deleted-record' }),
    ).toThrow('no longer exists');
  });

  it('removes a match while preserving device identity, placement and user reports', () => {
    const base = createDemoWorkspace();
    base.devices[2].hardwareBinding = binding();
    base.devices[2].hardwareOrigin = 'macos';
    base.devices[2].status = 'reported-issue';
    const saved = applyCommand(base, { type: 'unbind-hardware', id: 'monitor-right' });
    const { hardwareBinding: _removed, ...expected } = base.devices[2];
    expect(saved.devices[2]).toEqual(expected);
    expect(saved.connections).toEqual(base.connections);
    expect(base.devices[2].hardwareBinding).toBeDefined();
  });
});

describe('local hardware privacy and photo retention', () => {
  it('exports approved names and reports while removing local matching identifiers', () => {
    const base = createDemoWorkspace();
    base.devices[2] = {
      ...linked(),
      source: 'os-detected',
      hardwareOrigin: 'macos',
      status: 'reported-issue',
    };
    const before = structuredClone(base);
    const portable = portableWorkspace(base);
    expect(portable.devices[2].hardwareBinding).toBeUndefined();
    expect(portable.devices[2]).toMatchObject({
      name: base.devices[2].name,
      model: base.devices[2].model,
      source: 'os-detected',
      hardwareOrigin: 'macos',
      status: 'reported-issue',
    });
    expect(portable.connections).toEqual(base.connections);
    expect(JSON.stringify(portable)).not.toContain('hardware_display_1');
    expect(JSON.stringify(portable)).not.toContain(scope);
    expect(parseWorkspace(JSON.parse(JSON.stringify(portable)))).toEqual(portable);
    expect(base).toEqual(before);
  });

  it('keeps manual records in model context but excludes OS-derived records, links and event history after rename/unbind', () => {
    let base = createDemoWorkspace();
    base.devices[2] = { ...linked(), source: 'os-detected', hardwareOrigin: 'macos' };
    base.devices[1].hardwareBinding = binding(
      observation({ identity: { key: 'hardware_other', scope, stability: 'persistent' } }),
    );
    base = applyProposal(base, {
      type: 'rename-device',
      deviceId: 'monitor-right',
      name: 'Private OS label renamed',
      reason: 'User renamed the visual record.',
    });
    base = applyCommand(base, { type: 'unbind-hardware', id: 'monitor-right' });
    const before = structuredClone(base);
    const context = modelWorkspace(base);
    expect(context.devices.some((device) => device.id === 'monitor-right')).toBe(false);
    expect(context.devices.some((device) => device.id === 'monitor-left')).toBe(true);
    expect(context.devices.every((device) => !device.hardwareBinding)).toBe(true);
    expect(
      context.connections.every(
        (link) => link.from !== 'monitor-right' && link.to !== 'monitor-right',
      ),
    ).toBe(true);
    expect(context.history).toEqual([]);
    expect(JSON.stringify(context)).not.toContain('Private OS label renamed');
    expect(base).toEqual(before);
    expect(parseWorkspace(context)).toEqual(context);
  });

  it('retains imported OS provenance when an OS record without an explicit marker is renamed', () => {
    const input = createDemoWorkspace();
    input.devices[2].source = 'os-detected';
    const imported = parseWorkspace(input);
    const renamed = applyProposal(imported, {
      type: 'rename-device',
      deviceId: 'monitor-right',
      name: 'Still private',
      reason: 'User change',
    });
    expect(modelWorkspace(renamed).devices.some((device) => device.id === 'monitor-right')).toBe(
      false,
    );
  });

  it('retains an approved match to an otherwise unused sample through a photo preview and approval', () => {
    const base = empty();
    base.devices = [linked()];
    const draft = buildSceneDraft(base, photo('monitor-right'));
    expect(draft.devices[0].hardwareBinding).toEqual(base.devices[0].hardwareBinding);
    expect(draft.devices[0].source).toBe('demo');
    const saved = applySceneDraft(base, base, draft);
    expect(saved.devices[0].hardwareBinding).toEqual(base.devices[0].hardwareBinding);
    expect(saved.devices[0].name).toBe(base.devices[0].name);
    expect(saved.devices[0].status).toBe('unknown');
  });

  it('rejects a photo draft that removes an existing hardware match or privacy marker', () => {
    const base = empty();
    // A normal rename changes source to user-reported but must keep provenance.
    base.devices = [{ ...linked(), source: 'user-reported', hardwareOrigin: 'macos' }];
    for (const field of ['hardwareBinding', 'hardwareOrigin'] as const) {
      const draft = structuredClone(base);
      delete draft.devices[0][field];
      expect(() => applySceneDraft(base, base, draft)).toThrow();
    }
  });

  it('rejects a new photo device carrying an unapproved hardware association', () => {
    const base = empty();
    const draft = buildSceneDraft(base, photo());
    draft.devices[0].hardwareBinding = binding();
    expect(() => applySceneDraft(base, base, draft)).toThrow();
  });
});

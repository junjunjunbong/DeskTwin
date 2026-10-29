import type { Device, DeviceKind, Workspace, WorkspaceCommand } from './workspace';
import { defaultVisual } from './workspace';
import {
  isAmbiguousHardwareIdentity,
  sameHardwareIdentity,
  type HardwareDevice,
  type HardwareSnapshot,
} from './hardware';

export type HardwarePresence = {
  state: 'unlinked' | 'stopped' | 'unavailable' | 'detected' | 'not-detected' | 'match-again';
  label: string;
  explanation: string;
  observation?: HardwareDevice;
  lastCheckedAt: string | null;
};

export function hardwarePresence(device: Device, snapshot: HardwareSnapshot): HardwarePresence {
  const binding = device.hardwareBinding;
  const category = binding ? snapshot.categories[binding.category] : null;
  const at = category?.lastCheckedAt ?? null;
  if (!binding)
    return {
      state: 'unlinked',
      label: 'OS match not set',
      explanation: 'Choose an OS observation explicitly to check this record.',
      lastCheckedAt: null,
    };
  if (snapshot.state === 'stopped')
    return {
      state: 'stopped',
      label: 'Detection stopped',
      explanation: 'Device presence is unknown while detection is stopped.',
      lastCheckedAt: at,
    };
  if (snapshot.state !== 'running' || category?.state !== 'ok')
    return {
      state: 'unavailable',
      label: 'Status unavailable',
      explanation:
        category?.message || 'The local bridge could not check this device. Presence is unknown.',
      lastCheckedAt: at,
    };
  if (
    (binding.identity.stability === 'persistent' &&
      binding.identity.scope !== snapshot.identityScope) ||
    (binding.identity.stability === 'session' && binding.identity.scope !== snapshot.sessionId)
  )
    return {
      state: 'match-again',
      label: 'Match again',
      explanation:
        'This approved identity cannot be resumed in this detection session or installation. Select the device again.',
      lastCheckedAt: at,
    };
  if (isAmbiguousHardwareIdentity(binding.category, binding.identity, snapshot))
    return {
      state: 'match-again',
      label: 'Match again',
      explanation:
        'macOS reported multiple devices with the same identifier. The earlier match is ambiguous, even if only one or no device remains. Choose a current observation explicitly; future detection sessions require a new match.',
      lastCheckedAt: at,
    };
  const observation = snapshot.devices.find(
    (item) =>
      item.category === binding.category && sameHardwareIdentity(item.identity, binding.identity),
  );
  if (observation)
    return {
      state: 'detected',
      label: 'OS detected',
      explanation: 'Recognized by macOS. This does not verify that all features work.',
      observation,
      lastCheckedAt: at,
    };
  if (binding.identity.stability === 'session')
    return {
      state: 'match-again',
      label: 'Match again',
      explanation:
        'The previous session observation is no longer present. Choose the corresponding device if it reconnects; its name alone is not an identity.',
      lastCheckedAt: at,
    };
  return {
    state: 'not-detected',
    label: 'Not detected',
    explanation: 'The latest successful scan of this category did not find the approved identity.',
    lastCheckedAt: at,
  };
}

export function linkedDevice(
  workspace: Workspace,
  observation: HardwareDevice,
): Device | undefined {
  return workspace.devices.find(
    (device) =>
      device.hardwareBinding?.category === observation.category &&
      sameHardwareIdentity(device.hardwareBinding.identity, observation.identity),
  );
}

/** Called only by an explicit approval action, with the latest observation and workspace. */
export function hardwareMatchCommand(
  workspace: Workspace,
  snapshot: HardwareSnapshot,
  observation: HardwareDevice,
  choice: { existingId: string } | { newDevice: { name: string; kind: DeviceKind } },
): WorkspaceCommand {
  const current = snapshot.devices.find(
    (item) =>
      item.id === observation.id && sameHardwareIdentity(item.identity, observation.identity),
  );
  if (
    snapshot.state !== 'running' ||
    snapshot.categories[observation.category].state !== 'ok' ||
    !current ||
    isAmbiguousHardwareIdentity(observation.category, observation.identity, snapshot)
  )
    throw new Error(
      'This observation is no longer current. Refresh detection and review the match again.',
    );
  const already = linkedDevice(workspace, current);
  if (already && (!('existingId' in choice) || already.id !== choice.existingId))
    throw new Error(
      `This observation is already linked to ${already.name}. Remove that match first.`,
    );
  const binding = {
    category: current.category,
    identity: current.identity,
    approvedAt: new Date().toISOString(),
  };
  if ('existingId' in choice) {
    if (!workspace.devices.some((device) => device.id === choice.existingId))
      throw new Error('The selected desk record no longer exists. Choose it again.');
    return { type: 'bind-hardware', id: choice.existingId, binding };
  }
  const name = choice.newDevice.name.trim();
  if (!name || name.length > 60) throw new Error('Use a device name between 1 and 60 characters.');
  return {
    type: 'add-device',
    device: {
      id: crypto.randomUUID(),
      kind: choice.newDevice.kind,
      name,
      model: current.model.slice(0, 100),
      placement: { x: 0, y: 2.51, z: 0, rotation: 0 },
      visual: defaultVisual('user-reported'),
      source: 'os-detected',
      status: 'unknown',
      statusNote: '',
      hardwareOrigin: 'macos',
      hardwareBinding: binding,
    },
  };
}

import type { Workspace } from './workspace';
import { diagnosisDeviceIds } from './diagnosis';

/** Portable records keep approved labels, but never installation-specific matching identities. */
export function portableWorkspace(workspace: Workspace): Workspace {
  const portable = structuredClone(workspace);
  for (const device of portable.devices) delete device.hardwareBinding;
  return portable;
}

/** No hardware-to-model transfer is offered. Keep locally derived records out of provider context. */
export function modelWorkspace(workspace: Workspace): Workspace {
  const context = portableWorkspace(workspace);
  context.devices = context.devices.filter(
    (device) =>
      device.hardwareOrigin !== 'macos' &&
      device.source !== 'os-detected' &&
      device.visual.source !== 'os-detected',
  );
  context.objects = context.objects.filter((object) => object.visual.source !== 'os-detected');
  const retainedObjectIds = new Set(context.objects.map((object) => object.id));
  for (const item of [...context.devices, ...context.objects])
    if (item.attachment && !retainedObjectIds.has(item.attachment.parentId)) delete item.attachment;
  const ids = new Set(context.devices.map((device) => device.id));
  context.connections = context.connections.filter(
    (link) => link.source !== 'os-detected' && ids.has(link.from) && ids.has(link.to),
  );
  // Sessions contain only bounded IDs and enum answers, but provenance is permanent.
  // Keep an OS-derived session local even if an observation is later renamed or removed.
  context.diagnoses = (context.diagnoses ?? []).filter(
    (session) =>
      !session.localOnly &&
      diagnosisDeviceIds(session).every((id) => ids.has(id)) &&
      session.path.connections.every((connection) => connection.source !== 'os-detected'),
  );
  // Event summaries may contain an OS-derived name after a user edit.
  context.history = [];
  return context;
}

import type { DeviceDetails, DevicePatch } from './workspace';

/** A status and its observation describe one report; never mix reports during review. */
export function mergeReviewedDeviceDetails(
  base: DeviceDetails,
  draft: DeviceDetails,
  latest: DeviceDetails,
): DeviceDetails {
  const values = { ...latest };
  for (const field of ['name', 'model'] as const)
    if (draft[field] !== base[field]) values[field] = draft[field];
  if (draft.status !== base.status || draft.statusNote !== base.statusNote) {
    values.status = draft.status;
    values.statusNote = draft.status === 'unknown' ? '' : draft.statusNote;
  }
  return values;
}

/** Changing a status does not reuse an observation made for the previous status. */
export function changeDeviceDetails(
  values: DeviceDetails,
  patch: Partial<DeviceDetails>,
): DeviceDetails {
  const next = { ...values, ...patch };
  if (next.status === 'unknown') next.statusNote = '';
  else if (patch.status !== undefined && patch.status !== values.status)
    next.statusNote = patch.statusNote ?? '';
  return next;
}

export function deviceDetailsPatch(base: DeviceDetails, values: DeviceDetails): DevicePatch {
  const patch: DevicePatch = {};
  for (const field of ['name', 'model'] as const)
    if (values[field] !== base[field]) patch[field] = values[field];
  if (patch.name !== undefined || patch.model !== undefined) patch.source = 'user-reported';
  if (values.status !== base.status || values.statusNote !== base.statusNote) {
    patch.status = values.status;
    patch.statusNote =
      values.status === 'unknown' ? '' : values.statusNote || 'The user reported this status.';
  }
  return patch;
}

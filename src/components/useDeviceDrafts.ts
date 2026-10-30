import { useEffect, useRef, useState } from 'react';
import type {
  Device,
  DeviceDetails,
  DevicePatch,
  Workspace,
  WorkspaceCommand,
} from '../domain/workspace';

const fields = ['name', 'model', 'status', 'statusNote'] as const;
export function deviceDetails(device: Device): DeviceDetails {
  return {
    name: device.name,
    model: device.model,
    status: device.status,
    statusNote: device.statusNote,
  };
}
export interface DeviceDraft {
  id: string;
  base: DeviceDetails;
  expected: DeviceDetails;
  values: DeviceDetails;
  reviewRequired: boolean;
  saving: boolean;
  error: string;
  token: number;
}
export function detailsEqual(left: DeviceDetails, right: DeviceDetails) {
  return fields.every((field) => left[field] === right[field]);
}

/** Navigation drafts are memory-only; only an explicit successful Save changes the workspace. */
export function useDeviceDrafts(
  displayed: Workspace,
  stored: Workspace,
  onCommand: (command: WorkspaceCommand) => Promise<boolean>,
  storageConflict: boolean,
) {
  const [drafts, setDrafts] = useState<Record<string, DeviceDraft>>({});
  const current = useRef(drafts);
  const sequence = useRef(0);
  function update(next: Record<string, DeviceDraft>) {
    current.current = next;
    setDrafts(next);
  }
  function discard(id: string) {
    if (current.current[id]?.saving) return;
    const next = { ...current.current };
    delete next[id];
    update(next);
  }
  function change(device: Device, patch: Partial<DeviceDetails>) {
    const existing = current.current[device.id];
    if (existing?.saving) return;
    const raw = stored.devices.find((item) => item.id === device.id);
    if (!raw) return;
    const draft: DeviceDraft = existing ?? {
      id: device.id,
      base: deviceDetails(device),
      expected: deviceDetails(raw),
      values: deviceDetails(device),
      reviewRequired: false,
      saving: false,
      error: '',
      token: ++sequence.current,
    };
    const next = { ...draft, values: { ...draft.values, ...patch }, error: '' };
    if (
      !next.reviewRequired &&
      detailsEqual(next.values, next.base) &&
      detailsEqual(next.expected, deviceDetails(raw))
    ) {
      discard(device.id);
    } else update({ ...current.current, [device.id]: next });
  }
  function needsReview(draft: DeviceDraft) {
    const raw = stored.devices.find((item) => item.id === draft.id);
    return draft.reviewRequired || !raw || !detailsEqual(draft.expected, deviceDetails(raw));
  }
  function reviewLatest(id: string) {
    const draft = current.current[id];
    const device = displayed.devices.find((item) => item.id === id);
    const raw = stored.devices.find((item) => item.id === id);
    if (!draft || draft.saving || !device || !raw || storageConflict) return;
    const latest = deviceDetails(device);
    // Retain only fields the user edited; other fields adopt the reviewed saved record.
    const values = { ...latest };
    for (const field of fields) {
      if (draft.values[field] !== draft.base[field]) {
        if (field === 'status') values.status = draft.values.status;
        else values[field] = draft.values[field];
      }
    }
    update({
      ...current.current,
      [id]: {
        ...draft,
        base: latest,
        expected: deviceDetails(raw),
        values,
        reviewRequired: false,
        error: '',
      },
    });
  }
  function invalidate() {
    update(
      Object.fromEntries(
        Object.entries(current.current).map(([id, draft]) => [
          id,
          { ...draft, reviewRequired: true },
        ]),
      ),
    );
  }
  useEffect(() => {
    const missing = Object.values(current.current).filter(
      (draft) => !draft.reviewRequired && !stored.devices.some((device) => device.id === draft.id),
    );
    if (!missing.length) return;
    const next = { ...current.current };
    for (const draft of missing) next[draft.id] = { ...draft, reviewRequired: true };
    update(next);
  }, [stored]);

  async function save(id: string) {
    const draft = current.current[id];
    if (!draft || draft.saving || storageConflict || needsReview(draft)) return false;
    const patch: DevicePatch = {};
    for (const field of fields) {
      if (draft.values[field] !== draft.base[field]) {
        if (field === 'status') patch.status = draft.values.status;
        else patch[field] = draft.values[field];
      }
    }
    if (!Object.keys(patch).length) {
      discard(id);
      return true;
    }
    if (patch.name !== undefined || patch.model !== undefined) patch.source = 'user-reported';
    if (patch.status !== undefined || patch.statusNote !== undefined) {
      patch.statusNote =
        draft.values.status === 'unknown'
          ? ''
          : draft.values.statusNote || 'The user reported this status.';
    }
    const token = ++sequence.current;
    update({ ...current.current, [id]: { ...draft, saving: true, error: '', token } });
    let saved = false;
    try {
      saved = await onCommand({
        type: 'update-device',
        id,
        patch,
        expectedDetails: draft.expected,
      });
      return saved;
    } finally {
      const pending = current.current[id];
      if (pending?.token === token) {
        const next = { ...current.current };
        if (saved) delete next[id];
        else
          next[id] = {
            ...pending,
            saving: false,
            error:
              'Your details were not saved. The draft is kept; review the storage notice and try again.',
          };
        update(next);
      }
    }
  }
  return { drafts, change, discard, needsReview, reviewLatest, invalidate, save, storageConflict };
}

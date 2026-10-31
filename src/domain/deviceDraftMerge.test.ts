import { describe, expect, it } from 'vitest';
import type { DeviceDetails } from './workspace';
import {
  changeDeviceDetails,
  deviceDetailsPatch,
  mergeReviewedDeviceDetails,
} from './deviceDraftMerge';

const unknown: DeviceDetails = {
  name: 'Monitor',
  model: '',
  status: 'unknown',
  statusNote: '',
};
const diagnosis: DeviceDetails = {
  ...unknown,
  status: 'reported-working',
  statusNote: 'User test: The screen works after checking the input. Cause not determined.',
};

describe('reviewing device details', () => {
  it('does not attach a new successful diagnostic note to an older status-only issue draft', () => {
    const draft = { ...unknown, status: 'reported-issue' as const };
    const merged = mergeReviewedDeviceDetails(unknown, draft, diagnosis);
    expect(merged).toEqual(draft);
    expect(deviceDetailsPatch(diagnosis, merged)).toEqual({
      status: 'reported-issue',
      statusNote: 'The user reported this status.',
    });
  });

  it('keeps a note-only issue draft paired with its original status after diagnosis changes it', () => {
    const base = { ...unknown, status: 'reported-issue' as const, statusNote: 'No display.' };
    const draft = { ...base, statusNote: 'Still no display after checking the input.' };
    const merged = mergeReviewedDeviceDetails(base, draft, diagnosis);
    expect(merged).toEqual(draft);
    expect(deviceDetailsPatch(diagnosis, merged)).toEqual({
      status: 'reported-issue',
      statusNote: draft.statusNote,
    });
  });

  it('adopts the complete latest report when only name or model was edited', () => {
    const draft = { ...unknown, name: 'My monitor' };
    const latest = { ...diagnosis, model: 'A model saved elsewhere' };
    const merged = mergeReviewedDeviceDetails(unknown, draft, latest);
    expect(merged).toEqual({ ...latest, name: 'My monitor' });
    expect(deviceDetailsPatch(latest, merged)).toEqual({
      name: 'My monitor',
      source: 'user-reported',
    });
  });

  it('preserves the complete edited report through repeated reviews', () => {
    const first = mergeReviewedDeviceDetails(
      unknown,
      { ...unknown, status: 'reported-issue', statusNote: 'No picture on my desk.' },
      diagnosis,
    );
    const secondLatest = { ...diagnosis, name: 'Changed saved name', statusNote: 'Another test.' };
    const second = mergeReviewedDeviceDetails(diagnosis, first, secondLatest);
    expect(second).toEqual({ ...first, name: secondLatest.name });
    expect(diagnosis.statusNote).toContain('Cause not determined');
  });
});

describe('editing and saving one user report', () => {
  it('clears an old observation when the status changes', () => {
    expect(changeDeviceDetails(diagnosis, { status: 'reported-issue' })).toEqual({
      ...diagnosis,
      status: 'reported-issue',
      statusNote: '',
    });
    expect(diagnosis.statusNote).not.toBe('');
  });

  it('allows an explicit replacement note and keeps the note for unrelated edits', () => {
    expect(
      changeDeviceDetails(diagnosis, { status: 'reported-issue', statusNote: 'Now flickering.' }),
    ).toEqual({ ...diagnosis, status: 'reported-issue', statusNote: 'Now flickering.' });
    expect(changeDeviceDetails(diagnosis, { model: 'My model' })).toEqual({
      ...diagnosis,
      model: 'My model',
    });
  });

  it('sends both report fields for a note-only change', () => {
    expect(deviceDetailsPatch(diagnosis, { ...diagnosis, statusNote: 'Checked again.' })).toEqual({
      status: 'reported-working',
      statusNote: 'Checked again.',
    });
  });

  it('clears the note when the user returns the status to unknown', () => {
    const changed = changeDeviceDetails(diagnosis, { status: 'unknown' });
    expect(changed.statusNote).toBe('');
    expect(deviceDetailsPatch(diagnosis, changed)).toEqual({ status: 'unknown', statusNote: '' });
  });

  it('does not produce changes for an unchanged draft', () => {
    expect(deviceDetailsPatch(diagnosis, diagnosis)).toEqual({});
  });
});

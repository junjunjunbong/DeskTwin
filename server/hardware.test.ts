import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app';
import {
  HardwareService,
  HardwareProbeError,
  createNativeProbe,
  type NativeSnapshot,
  type HardwareProbe,
} from './hardware';
import { HardwareSnapshotSchema } from '../src/domain/hardware';

const origin = 'http://127.0.0.1:5173';
const nativeDevice = (
  id = 'display-1',
  fingerprint: string | null = 'a'.repeat(64),
): NativeSnapshot['devices'][number] => ({
  id,
  category: 'display',
  name: 'Same display name',
  model: 'Example model',
  fingerprint,
  source: 'macOS CoreGraphics + AppKit NSScreen',
  status: 'online',
  parentId: null,
  attributes: [{ label: 'Active for drawing', value: 'Yes' }],
});
function fixture(devices = [nativeDevice()]): NativeSnapshot {
  return {
    schemaVersion: 1,
    categories: {
      display: {
        state: 'ok',
        source: 'macOS CoreGraphics + AppKit NSScreen',
        message: 'Online display metadata',
      },
      usb: {
        state: 'ok',
        source: 'macOS IOKit IOService USB registry',
        message: 'Registered USB devices',
      },
      bluetooth: {
        state: 'unavailable',
        source: 'Not collected',
        message: 'Bluetooth detection is not implemented.',
      },
    },
    devices,
  };
}
function probe(initial = fixture()) {
  return {
    platform: 'darwin',
    availability: vi.fn(async () => ({ available: true, message: 'Ready' })),
    scope: vi.fn(async () => 'installation_test'),
    read: vi.fn<HardwareProbe['read']>(async () => structuredClone(initial)),
  };
}
function service(initial = fixture()) {
  let now = Date.parse('2026-10-28T00:00:00Z');
  const provider = probe(initial);
  const hardware = new HardwareService(provider, { now: () => now });
  return {
    hardware,
    provider,
    advance: (ms = 5000) => {
      now += ms;
    },
  };
}

describe('native hardware service state and evidence', () => {
  it('does not probe during capability checks or stopped polling', async () => {
    const { hardware, provider } = service();
    const { token } = await hardware.createSession(origin);
    expect(provider.read).not.toHaveBeenCalled();
    expect((await hardware.snapshot(token, origin)).state).toBe('stopped');
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.scope).not.toHaveBeenCalled();
  });
  it('starts explicitly, validates the public shape, caches polls and stops without reporting removal', async () => {
    const { hardware, provider, advance } = service();
    const { token } = await hardware.createSession(origin);
    const first = await hardware.start(token, origin);
    expect(HardwareSnapshotSchema.parse(first).state).toBe('running');
    expect(first.devices).toHaveLength(1);
    expect(first.devices[0].identity.stability).toBe('persistent');
    expect(first.identityScope).toBe('installation_test');
    expect(first.categories.bluetooth.state).toBe('unavailable');
    expect(JSON.stringify(first)).not.toContain('fingerprint');
    expect(JSON.stringify(first)).not.toContain('display-1');
    expect(JSON.stringify(first)).not.toContain('reported-working');
    await hardware.snapshot(token, origin);
    expect(provider.read).toHaveBeenCalledTimes(1);
    advance();
    await hardware.snapshot(token, origin);
    expect(provider.read).toHaveBeenCalledTimes(2);
    const stopped = hardware.stop(token, origin);
    expect(stopped.state).toBe('stopped');
    expect(stopped.identityScope).toBeNull();
    expect(stopped.lastCheckedAt).toBe('2026-10-28T00:00:05.000Z');
    expect(stopped.categories.display.state).toBe('unavailable');
    expect(stopped.devices).toEqual([]);
    advance();
    await hardware.snapshot(token, origin);
    expect(provider.read).toHaveBeenCalledTimes(2);
  });
  it('does not silently resume an expired tab lease', async () => {
    const { hardware, provider, advance } = service();
    const { token } = await hardware.createSession(origin);
    const started = await hardware.start(token, origin);
    advance(21000);
    const expired = await hardware.snapshot(token, origin);
    expect(expired.state).toBe('stopped');
    expect(expired.message).toContain('stopped checking');
    expect(provider.read).toHaveBeenCalledTimes(1);
    const restarted = await hardware.start(token, origin);
    expect(restarted.state).toBe('running');
    expect(restarted.sessionId).not.toBe(started.sessionId);
  });
  it('isolates tab stop controls and origin-bound tokens', async () => {
    const { hardware, provider, advance } = service();
    const a = await hardware.createSession(origin);
    const b = await hardware.createSession(origin);
    await hardware.start(a.token, origin);
    await hardware.start(b.token, origin);
    hardware.stop(a.token, origin);
    advance();
    expect((await hardware.snapshot(a.token, origin)).state).toBe('stopped');
    expect((await hardware.snapshot(b.token, origin)).state).toBe('running');
    expect(provider.read).toHaveBeenCalledTimes(3);
    await expect(hardware.snapshot(b.token, 'http://127.0.0.1:9999')).rejects.toThrow('invalid');
  });
  it('revokes explicit stop before a late start request can begin reading hardware', async () => {
    const { hardware, provider } = service();
    const stopped = await hardware.createSession(origin);
    hardware.stop(stopped.token, origin);
    await expect(hardware.start(stopped.token, origin)).rejects.toMatchObject({ status: 403 });
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.scope).not.toHaveBeenCalled();
    expect((await hardware.snapshot(stopped.token, origin)).state).toBe('stopped');
    const fresh = await hardware.createSession(origin);
    expect(fresh.token).not.toBe(stopped.token);
    expect((await hardware.start(fresh.token, origin)).state).toBe('running');
    expect(provider.read).toHaveBeenCalledOnce();
    // A delayed duplicate Stop for the old token cannot stop the new session.
    hardware.stop(stopped.token, origin);
    expect((await hardware.snapshot(fresh.token, origin)).state).toBe('running');
  });
  it('treats a bridge failure as unknown and preserves the last successful time', async () => {
    const { hardware, provider, advance } = service();
    const { token } = await hardware.createSession(origin);
    const first = await hardware.start(token, origin);
    provider.read.mockRejectedValueOnce(
      new HardwareProbeError('unavailable', 'Native helper stopped.'),
    );
    advance();
    const lost = await hardware.snapshot(token, origin);
    expect(lost.state).toBe('unavailable');
    expect(lost.identityScope).toBeNull();
    expect(lost.lastCheckedAt).toBe(first.lastCheckedAt);
    expect(lost.categories.display.state).toBe('unavailable');
    expect(lost.devices).toHaveLength(0);
    advance();
    expect((await hardware.snapshot(token, origin)).devices[0].identity).toEqual(
      first.devices[0].identity,
    );
  });
  it('keeps category errors independent; denied USB cannot claim devices absent', async () => {
    const { hardware, provider, advance } = service();
    const { token } = await hardware.createSession(origin);
    const before = await hardware.start(token, origin);
    const partial = fixture();
    partial.categories.usb = {
      state: 'permission-denied',
      source: 'macOS IOKit IOService USB registry',
      message: 'macOS denied USB metadata.',
    };
    partial.devices.push({ ...nativeDevice('usb-1'), category: 'usb', status: 'connected' });
    provider.read.mockResolvedValueOnce(partial);
    advance();
    const after = await hardware.snapshot(token, origin);
    expect(after.state).toBe('running');
    expect(after.categories.display.state).toBe('ok');
    expect(after.categories.usb.state).toBe('permission-denied');
    expect(after.categories.usb.lastCheckedAt).toBe(before.categories.usb.lastCheckedAt);
    expect(after.devices.every((device) => device.category === 'display')).toBe(true);
  });
  it('reflects additions and removals only following a successful category read', async () => {
    const { hardware, provider, advance } = service();
    const { token } = await hardware.createSession(origin);
    const first = await hardware.start(token, origin);
    provider.read.mockResolvedValueOnce(fixture([]));
    advance();
    const removed = await hardware.snapshot(token, origin);
    expect(removed.categories.display.state).toBe('ok');
    expect(removed.devices).toEqual([]);
    advance();
    const reconnected = await hardware.snapshot(token, origin);
    expect(reconnected.devices[0].identity).toEqual(first.devices[0].identity);
  });
  it('returns installation scope for empty scans so a different installation is not mistaken for absence', async () => {
    const { hardware, provider, advance } = service(fixture([]));
    const { token } = await hardware.createSession(origin);
    const before = await hardware.start(token, origin);
    expect(before.identityScope).toBe('installation_test');
    provider.scope.mockResolvedValueOnce('installation_replaced');
    advance();
    const after = await hardware.snapshot(token, origin);
    expect(after.devices).toEqual([]);
    expect(after.identityScope).toBe('installation_replaced');
    expect(HardwareSnapshotSchema.parse(after).state).toBe('running');
  });
  it('reports executable permission denial before starting the native helper', async () => {
    const provider: HardwareProbe = {
      platform: 'darwin',
      availability: async () => ({
        available: false,
        failureState: 'permission-denied',
        message: 'Permission to run the native hardware helper was denied.',
      }),
      scope: vi.fn(async () => 'installation_test'),
      read: vi.fn(async () => fixture()),
    };
    const hardware = new HardwareService(provider);
    const capability = await hardware.createSession(origin);
    expect(capability.available).toBe(false);
    expect(capability).not.toHaveProperty('failureState');
    const snapshot = await hardware.start(capability.token, origin);
    expect(snapshot.state).toBe('unavailable');
    expect(snapshot.categories.usb.state).toBe('permission-denied');
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.scope).not.toHaveBeenCalled();
  });
  it('never merges same names and falls back for duplicated persistent identifiers', async () => {
    const { hardware } = service(fixture([nativeDevice('display-1'), nativeDevice('display-2')]));
    const { token } = await hardware.createSession(origin);
    const result = await hardware.start(token, origin);
    expect(result.devices).toHaveLength(2);
    expect(new Set(result.devices.map((device) => device.id)).size).toBe(2);
    expect(result.devices.every((device) => device.identity.stability === 'session')).toBe(true);
  });
  it('accepts Swift JSONEncoder omission of nil identity and parent fields without inventing them', async () => {
    const { hardware, provider } = service();
    const {
      fingerprint: _fingerprint,
      parentId: _parentId,
      ...serialless
    } = nativeDevice('display-1', null);
    provider.read.mockResolvedValueOnce({ ...fixture(), devices: [serialless] });
    const { token } = await hardware.createSession(origin);
    const result = await hardware.start(token, origin);
    expect(result.state).toBe('running');
    expect(result.devices[0].parentId).toBeNull();
    expect(result.devices[0].identity.stability).toBe('session');
  });
  it('requires a new identity after a serial-less device disappears or detection restarts', async () => {
    const { hardware, provider, advance } = service(fixture([nativeDevice('display-1', null)]));
    const { token } = await hardware.createSession(origin);
    const first = await hardware.start(token, origin);
    advance();
    expect((await hardware.snapshot(token, origin)).devices[0].identity).toEqual(
      first.devices[0].identity,
    );
    provider.read.mockResolvedValueOnce(fixture([]));
    advance();
    await hardware.snapshot(token, origin);
    advance();
    const returned = await hardware.snapshot(token, origin);
    expect(returned.devices[0].identity.key).not.toBe(first.devices[0].identity.key);
    hardware.stop(token, origin);
    const fresh = await hardware.createSession(origin);
    const restarted = await hardware.start(fresh.token, origin);
    expect(restarted.devices[0].identity.scope).not.toBe(first.devices[0].identity.scope);
    expect(restarted.devices[0].identity.key).not.toBe(returned.devices[0].identity.key);
  });
  it('does not preserve a session identity through an unknown category interval', async () => {
    const { hardware, provider, advance } = service(fixture([nativeDevice('display-1', null)]));
    const { token } = await hardware.createSession(origin);
    const first = await hardware.start(token, origin);
    provider.read.mockRejectedValueOnce(
      new HardwareProbeError('error', 'Cannot read display metadata'),
    );
    advance();
    await hardware.snapshot(token, origin);
    advance();
    const recovered = await hardware.snapshot(token, origin);
    expect(recovered.devices[0].identity.key).not.toBe(first.devices[0].identity.key);
  });
  it('reports only native USB ancestors, without inventing display cable routes', async () => {
    const hub = {
      ...nativeDevice('usb-1', 'b'.repeat(64)),
      category: 'usb' as const,
      name: 'USB hub',
      status: 'connected' as const,
    };
    const child = {
      ...nativeDevice('usb-2', null),
      category: 'usb' as const,
      parentId: 'usb-1',
      status: 'connected' as const,
    };
    const { hardware } = service(fixture([nativeDevice(), hub, child]));
    const { token } = await hardware.createSession(origin);
    const result = await hardware.start(token, origin);
    expect(result.devices[0].parentId).toBeNull();
    expect(result.devices[2].parentId).toBe(result.devices[1].id);
  });
  it('rejects invalid native snapshots without echoing raw identifiers or errors', async () => {
    const { hardware, provider } = service();
    provider.read.mockResolvedValueOnce({ ...fixture(), secretSerialNumber: 'private-serial' });
    const { token } = await hardware.createSession(origin);
    const result = await hardware.start(token, origin);
    expect(result.state).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('private-serial');
    expect(result.categories.display.state).toBe('error');
  });
  it('a stop aborts pending work and a late result cannot reactivate detection', async () => {
    const { hardware, provider } = service();
    let finish: (value: NativeSnapshot) => void = () => undefined;
    let signal: AbortSignal | undefined;
    provider.read.mockImplementationOnce((arg) => {
      signal = arg;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const { token } = await hardware.createSession(origin);
    const pending = hardware.start(token, origin);
    await vi.waitFor(() => expect(provider.read).toHaveBeenCalledOnce());
    hardware.stop(token, origin);
    expect(signal?.aborted).toBe(true);
    finish(fixture());
    expect((await pending).state).toBe('stopped');
    expect((await hardware.snapshot(token, origin)).devices).toEqual([]);
  });
  it('a late expired scan cannot erase identities from a newly started lease', async () => {
    const { hardware, provider, advance } = service(fixture([nativeDevice('display-2', null)]));
    let finish: (value: NativeSnapshot) => void = () => undefined;
    provider.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { token } = await hardware.createSession(origin);
    const pending = hardware.start(token, origin);
    await vi.waitFor(() => expect(provider.read).toHaveBeenCalledOnce());
    advance(21000);
    expect((await hardware.snapshot(token, origin)).state).toBe('stopped');
    const restarted = await hardware.start(token, origin);
    expect(restarted.devices).toHaveLength(1);
    finish(fixture([nativeDevice('display-1', null)]));
    await pending;
    advance();
    const next = await hardware.snapshot(token, origin);
    expect(next.sessionId).toBe(restarted.sessionId);
    expect(next.devices[0].identity).toEqual(restarted.devices[0].identity);
  });
  it('malformed duplicate native IDs make presence unknown rather than dropping an entry', async () => {
    const { hardware } = service(
      fixture([
        nativeDevice('display-1', 'a'.repeat(64)),
        nativeDevice('display-1', 'b'.repeat(64)),
      ]),
    );
    const { token } = await hardware.createSession(origin);
    const result = await hardware.start(token, origin);
    expect(result.state).toBe('unavailable');
    expect(result.categories.display.state).toBe('error');
    expect(result.devices).toEqual([]);
  });
  it('reclaims unused capability tokens but never evicts an active detection session', async () => {
    const { hardware, provider } = service();
    const expired = await hardware.createSession(origin);
    for (let i = 0; i < 32; i++) await hardware.createSession(origin);
    expect(provider.read).not.toHaveBeenCalled();
    await expect(hardware.start(expired.token, origin)).rejects.toThrow('invalid');
    const active: string[] = [];
    for (let i = 0; i < 16; i++) {
      const session = await hardware.createSession(origin);
      await hardware.start(session.token, origin);
      active.push(session.token);
    }
    await expect(hardware.createSession(origin)).rejects.toThrow('Too many');
    await expect(hardware.start('forged-token', origin)).rejects.toThrow('invalid');
    expect((await hardware.snapshot(active[0], origin)).state).toBe('running');
    expect(provider.read).toHaveBeenCalledTimes(16);
  });
  it('returns a truthful platform capability on Linux without fabricating Mac devices', async () => {
    if (process.platform === 'darwin') return;
    const native = createNativeProbe();
    expect((await native.availability()).available).toBe(false);
    const hardware = new HardwareService(native);
    const { token } = await hardware.createSession(origin);
    const result = await hardware.start(token, origin);
    expect(result.state).toBe('unavailable');
    expect(result.devices).toEqual([]);
    expect(result.message).toContain('not running on a Mac');
  });
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});
async function api() {
  const provider = probe();
  const server = createApp({
    apiKey: '',
    model: 'unused',
    baseURL: 'https://api.meta.ai/v1',
    hardware: new HardwareService(provider),
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const url = `http://127.0.0.1:${address.port}`;
  const headers = { 'X-DeskTwin-Hardware': '1', Origin: url };
  const session = await (await fetch(`${url}/api/hardware/session`, { headers })).json();
  const authenticated = { ...headers, 'X-DeskTwin-Hardware-Token': session.token };
  const post = (path: string, body: unknown, extra: Record<string, string> = authenticated) =>
    fetch(url + path, {
      method: 'POST',
      headers: { ...extra, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  return { provider, url, headers, authenticated, session, post };
}
describe('hardware API consent and origin boundary', () => {
  it('requires a custom header, a per-tab token and explicit consent', async () => {
    const { provider, url, post, headers } = await api();
    expect((await fetch(`${url}/api/hardware/session`)).status).toBe(403);
    expect((await post('/api/hardware/start', { consent: true }, headers)).status).toBe(403);
    expect((await post('/api/hardware/start', { consent: false })).status).toBe(400);
    expect(
      (await post('/api/hardware/start', { consent: true, command: 'echo rejected' })).status,
    ).toBe(400);
    expect(provider.read).not.toHaveBeenCalled();
    const result = await post('/api/hardware/start', { consent: true });
    expect(result.status).toBe(200);
    expect(HardwareSnapshotSchema.parse(await result.json()).state).toBe('running');
    expect(provider.read).toHaveBeenCalledOnce();
  });
  it('rejects external, different-port and cross-site requests including preflights', async () => {
    const { url, authenticated, post, provider } = await api();
    for (const origin of ['https://malicious.example', 'http://127.0.0.1:9999', 'null'])
      expect(
        (await post('/api/hardware/start', { consent: true }, { ...authenticated, Origin: origin }))
          .status,
      ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/hardware/session`, {
          headers: { ...authenticated, 'Sec-Fetch-Site': 'cross-site' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/hardware/start`, {
          method: 'OPTIONS',
          headers: { Origin: 'https://malicious.example' },
        })
      ).status,
    ).toBe(403);
    expect(provider.read).not.toHaveBeenCalled();
  });
  it('rejects malformed Origin values instead of accepting their parsed host', async () => {
    const { url, authenticated, post, provider } = await api();
    for (const origin of [
      `${url}/`,
      `${url}/path`,
      `${url}?query`,
      `${url}#fragment`,
      url.replace('://', '://user@'),
    ])
      expect(
        (await post('/api/hardware/start', { consent: true }, { ...authenticated, Origin: origin }))
          .status,
      ).toBe(403);
    expect(provider.read).not.toHaveBeenCalled();
  });
  it('keeps stop/snapshot private and returns unavailable for helper permission denial', async () => {
    const { url, authenticated, post, provider } = await api();
    provider.read.mockRejectedValueOnce(
      new HardwareProbeError(
        'permission-denied',
        'Permission to run the native helper was denied.',
      ),
    );
    const failed = await (await post('/api/hardware/start', { consent: true })).json();
    expect(failed.state).toBe('unavailable');
    expect(failed.categories.usb.state).toBe('permission-denied');
    expect((await post('/api/hardware/stop', {})).status).toBe(200);
    const stopped = await (
      await fetch(`${url}/api/hardware/snapshot`, { headers: authenticated })
    ).json();
    expect(stopped.state).toBe('stopped');
    expect(provider.read).toHaveBeenCalledOnce();
    expect((await fetch(`${url}/api/hardware/snapshot`)).status).toBe(403);
  });
  it('rejects a delayed HTTP start for a stopped token without executing the native probe', async () => {
    const { url, headers, authenticated, post, provider } = await api();
    expect((await post('/api/hardware/stop', {})).status).toBe(200);
    const lateStart = await post('/api/hardware/start', { consent: true });
    expect(lateStart.status).toBe(403);
    expect((await lateStart.json()).error).toContain('new local hardware session');
    expect(provider.read).not.toHaveBeenCalled();
    expect(provider.scope).not.toHaveBeenCalled();
    const stopped = await (
      await fetch(`${url}/api/hardware/snapshot`, { headers: authenticated })
    ).json();
    expect(stopped.state).toBe('stopped');
    const fresh = await (await fetch(`${url}/api/hardware/session`, { headers })).json();
    const restarted = await post(
      '/api/hardware/start',
      { consent: true },
      { ...headers, 'X-DeskTwin-Hardware-Token': fresh.token },
    );
    expect(restarted.status).toBe(200);
    expect(provider.read).toHaveBeenCalledOnce();
  });
});

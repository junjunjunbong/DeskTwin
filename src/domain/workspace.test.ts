import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyProposal,
  createDemoWorkspace,
  localizeLegacyDemoForDisplay,
  parseWorkspace,
} from './workspace';

describe('evidence-aware workspace', () => {
  it('does not pretend example devices are detected or working', () => {
    const w = createDemoWorkspace();
    expect(w.devices).toHaveLength(8);
    expect(w.devices.every((d) => d.source === 'demo' && d.status === 'unknown')).toBe(true);
  });
  it('localizes unchanged legacy demo defaults for display without mutating stored data', () => {
    const saved = createDemoWorkspace();
    saved.name = '나의 작은 작업실';
    const names: Record<string, string> = {
      'monitor-left': '왼쪽 모니터',
      'monitor-right': '오른쪽 모니터',
      ssd: '외장 SSD',
      router: '공유기',
      keyboard: '키보드',
      mouse: '마우스',
    };
    for (const device of saved.devices) {
      if (names[device.id]) device.name = names[device.id];
    }
    for (const connection of saved.connections) {
      connection.note = '체험용 예시입니다. 실제 연결이 아닙니다.';
    }
    const original = structuredClone(saved);
    const displayed = localizeLegacyDemoForDisplay(saved);
    expect(displayed.name).toBe('My workspace');
    expect(displayed.devices.map((device) => device.name)).toEqual([
      'MacBook',
      'Left monitor',
      'Right monitor',
      'USB-C Dock',
      'External SSD',
      'Router',
      'Keyboard',
      'Mouse',
    ]);
    expect(
      displayed.connections.every(
        (connection) => connection.note === 'Example only. This is not a confirmed connection.',
      ),
    ).toBe(true);
    expect(saved).toEqual(original);
    displayed.devices[0].name = 'Changed only in the display copy';
    expect(saved).toEqual(original);
  });
  it('preserves user data and custom values while localizing old defaults', () => {
    const saved = createDemoWorkspace();
    saved.name = 'My own workspace';
    saved.devices[1].name = 'My custom display';
    saved.devices[1].status = 'reported-issue';
    saved.devices[1].statusNote = '사용자 메모';
    saved.devices[2].name = '왼쪽 모니터'; // Original name for the other device ID.
    saved.devices[4].name = '외장 SSD';
    saved.devices[4].source = 'user-reported';
    saved.connections[0].note = '사용자가 작성한 연결 메모';
    saved.connections[1].note = '체험용 예시입니다. 실제 연결이 아닙니다.';
    saved.connections[1].source = 'user-reported';
    saved.history.push({
      id: 'event-1',
      at: new Date().toISOString(),
      summary: '사용자 기록',
      source: 'user-reported',
    });
    const original = structuredClone(saved);
    const displayed = localizeLegacyDemoForDisplay(saved);
    expect(displayed).toEqual(original);
    expect(saved).toEqual(original);
  });
  it('rejects duplicate identities', () => {
    const w = createDemoWorkspace();
    w.devices.push(w.devices[0]);
    expect(() => parseWorkspace(w)).toThrow();
  });
  it('rejects dangling and self connections', () => {
    const w = createDemoWorkspace();
    w.connections[0].to = 'missing';
    expect(() => parseWorkspace(w)).toThrow();
    w.connections[0].to = w.connections[0].from;
    expect(() => parseWorkspace(w)).toThrow();
  });
  it('rejects future versions and invalid placement', () => {
    expect(() => parseWorkspace({ ...createDemoWorkspace(), schemaVersion: 2 })).toThrow();
    expect(() =>
      applyCommand(createDemoWorkspace(), {
        type: 'update-device',
        id: 'laptop',
        patch: { placement: { x: Infinity, z: 0, rotation: 0 } },
      }),
    ).toThrow();
  });
  it('upserts reported topology without claiming operational verification', () => {
    const w = createDemoWorkspace();
    const next = applyProposal(w, {
      type: 'connect',
      from: 'dock',
      to: 'monitor-right',
      connector: 'HDMI',
      reason: '사용자가 연결을 설명했습니다.',
    });
    expect(next.connections).toHaveLength(w.connections.length);
    expect(next.connections.at(-1)?.source).toBe('user-reported');
    expect(next.devices.every((d) => d.status === 'unknown')).toBe(true);
    expect(w.connections.every((c) => c.source === 'demo')).toBe(true);
  });
  it('rejects proposals that reference devices no longer present', () => {
    const w = applyCommand(createDemoWorkspace(), { type: 'remove-device', id: 'dock' });
    expect(() =>
      applyProposal(w, {
        type: 'connect',
        from: 'dock',
        to: 'laptop',
        connector: 'USB-C',
        reason: 'stale',
      }),
    ).toThrow();
  });
  it('cascades deletion to related edges', () => {
    const w = applyCommand(createDemoWorkspace(), { type: 'remove-device', id: 'dock' });
    expect(w.connections.every((c) => c.from !== 'dock' && c.to !== 'dock')).toBe(true);
  });
  it('keeps user tests explicitly reported', () => {
    const w = applyProposal(createDemoWorkspace(), {
      type: 'set-status',
      deviceId: 'monitor-right',
      status: 'reported-working',
      note: '직접 연결 후 영상이 나옴',
      reason: '사용자 테스트',
    });
    expect(w.devices.find((d) => d.id === 'monitor-right')?.status).toBe('reported-working');
  });
  it('limits history to 100 events', () => {
    let w = createDemoWorkspace();
    for (let i = 0; i < 110; i++) w = applyCommand(w, { type: 'rename', name: `Desk ${i}` });
    expect(w.history).toHaveLength(100);
  });
});

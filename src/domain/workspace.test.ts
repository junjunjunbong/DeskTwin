import { describe, expect, it } from 'vitest';
import { applyCommand, applyProposal, createDemoWorkspace, parseWorkspace } from './workspace';

describe('evidence-aware workspace', () => {
  it('does not pretend example devices are detected or working', () => {
    const w = createDemoWorkspace();
    expect(w.devices).toHaveLength(8);
    expect(w.devices.every(d => d.source === 'demo' && d.status === 'unknown')).toBe(true);
  });
  it('rejects duplicate identities', () => {
    const w = createDemoWorkspace(); w.devices.push(w.devices[0]); expect(() => parseWorkspace(w)).toThrow();
  });
  it('rejects dangling and self connections', () => {
    const w = createDemoWorkspace(); w.connections[0].to = 'missing'; expect(() => parseWorkspace(w)).toThrow();
    w.connections[0].to = w.connections[0].from; expect(() => parseWorkspace(w)).toThrow();
  });
  it('rejects future versions and invalid placement', () => {
    expect(() => parseWorkspace({ ...createDemoWorkspace(), schemaVersion: 2 })).toThrow();
    expect(() => applyCommand(createDemoWorkspace(), { type: 'update-device', id: 'laptop', patch: { placement: { x: Infinity, z: 0, rotation: 0 } } })).toThrow();
  });
  it('upserts reported topology without claiming operational verification', () => {
    const w = createDemoWorkspace();
    const next = applyProposal(w, { type: 'connect', from: 'dock', to: 'monitor-right', connector: 'HDMI', reason: '사용자가 연결을 설명했습니다.' });
    expect(next.connections).toHaveLength(w.connections.length);
    expect(next.connections.at(-1)?.source).toBe('user-reported');
    expect(next.devices.every(d => d.status === 'unknown')).toBe(true);
    expect(w.connections.every(c => c.source === 'demo')).toBe(true);
  });
  it('rejects proposals that reference devices no longer present', () => {
    const w = applyCommand(createDemoWorkspace(), { type: 'remove-device', id: 'dock' });
    expect(() => applyProposal(w, { type: 'connect', from: 'dock', to: 'laptop', connector: 'USB-C', reason: 'stale' })).toThrow();
  });
  it('cascades deletion to related edges', () => {
    const w = applyCommand(createDemoWorkspace(), { type: 'remove-device', id: 'dock' });
    expect(w.connections.every(c => c.from !== 'dock' && c.to !== 'dock')).toBe(true);
  });
  it('keeps user tests explicitly reported', () => {
    const w = applyProposal(createDemoWorkspace(), { type: 'set-status', deviceId: 'monitor-right', status: 'reported-working', note: '직접 연결 후 영상이 나옴', reason: '사용자 테스트' });
    expect(w.devices.find(d => d.id === 'monitor-right')?.status).toBe('reported-working');
  });
  it('limits history to 100 events', () => {
    let w = createDemoWorkspace();
    for (let i = 0; i < 110; i++) w = applyCommand(w, { type: 'rename', name: `Desk ${i}` });
    expect(w.history).toHaveLength(100);
  });
});

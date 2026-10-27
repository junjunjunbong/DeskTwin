import { describe, expect, it } from 'vitest';
import { answerDiagnosis, diagnosisNote, startDiagnosis } from './diagnosis';
import { demoReply } from './demoAssistant';
import { createDemoWorkspace } from './workspace';
describe('user-guided checks', () => {
  it('does not skip or silently complete steps', () => {
    const s = startDiagnosis('monitor-right');
    expect(s.result).toBe('active');
    const next = answerDiagnosis(s, 'not-fixed');
    expect(next.step).toBe(1);
    expect(s.step).toBe(0);
  });
  it('resolves only following an explicit successful user test', () => {
    const s = answerDiagnosis(startDiagnosis('monitor-right'), 'fixed');
    expect(s.result).toBe('resolved');
    expect(diagnosisNote(s)).toContain('User test');
    expect(diagnosisNote(s)).toContain('Cause not determined');
  });
  it('does not turn skipped checks into a successful diagnosis', () => {
    let s = startDiagnosis('monitor-right');
    for (let i = 0; i < 3; i++) s = answerDiagnosis(s, 'skip');
    expect(s.result).toBe('unresolved');
  });
  it('does not advance a completed result', () => {
    const s = answerDiagnosis(startDiagnosis('monitor-right'), 'fixed');
    expect(answerDiagnosis(s, 'not-fixed')).toEqual(s);
  });
});
describe('honest offline assistant', () => {
  it('labels every reply as demo, not live AI', () => {
    expect(demoReply('안녕', createDemoWorkspace()).mode).toBe('demo');
  });
  it('does not turn questions into connection facts', () => {
    expect(demoReply('MacBook을 Dock에 연결할까?', createDemoWorkspace()).proposals).toHaveLength(
      0,
    );
  });
  it('asks about ambiguous multiple devices', () => {
    expect(
      demoReply('맥북과 왼쪽 모니터와 오른쪽 모니터를 Dock에 연결했어', createDemoWorkspace())
        .proposals,
    ).toHaveLength(0);
  });
  it('understands the English connection example without treating it as verified', () => {
    const r = demoReply(
      'I connected the right monitor to the dock with HDMI',
      createDemoWorkspace(),
    );
    expect(r.message).toContain('confirm');
    expect(r.proposals).toEqual([
      expect.objectContaining({
        type: 'connect',
        from: 'monitor-right',
        to: 'dock',
        connector: 'HDMI',
      }),
    ]);
  });
  it('understands the English monitor issue example as a user-reported issue', () => {
    const r = demoReply('The right monitor is not displaying', createDemoWorkspace());
    expect(r.proposals).toEqual([
      expect.objectContaining({
        type: 'set-status',
        deviceId: 'monitor-right',
        status: 'reported-issue',
      }),
    ]);
  });
  it('continues to understand Korean connection and issue reports', () => {
    expect(
      demoReply('오른쪽 모니터를 Dock에 HDMI로 연결했어', createDemoWorkspace()).proposals,
    ).toEqual([expect.objectContaining({ type: 'connect', connector: 'HDMI' })]);
    expect(demoReply('오른쪽 모니터가 안 나와', createDemoWorkspace()).proposals).toEqual([
      expect.objectContaining({ type: 'set-status', status: 'reported-issue' }),
    ]);
  });
  it('recognizes a successful direct-connection test as a user report', () => {
    const r = demoReply(
      'The right monitor is working now with a direct connection',
      createDemoWorkspace(),
    );
    expect(r.proposals).toEqual([
      expect.objectContaining({
        type: 'set-status',
        deviceId: 'monitor-right',
        status: 'reported-working',
      }),
    ]);
  });
  it('does not turn English connection questions into facts', () => {
    expect(
      demoReply('How do I connect the right monitor to the dock', createDemoWorkspace()).proposals,
    ).toHaveLength(0);
  });
  it('does not confuse Thunderbolt with verified USB-C capabilities', () => {
    const r = demoReply('MacBook과 Dock을 Thunderbolt로 연결했어', createDemoWorkspace());
    expect(r.proposals[0]).toMatchObject({ connector: 'Unknown' });
  });
});

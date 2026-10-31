import { describe, expect, it } from 'vitest';
import {
  answerDiagnosis,
  diagnosisNote,
  startDiagnosis,
  diagnosticContextMatches,
  diagnosticStep,
  diagnosisDeviceIds,
  DiagnosticSessionSchema,
  endChangedDiagnosis,
  type DiagnosticSession,
} from './diagnosis';
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
describe('graph-informed checks', () => {
  function dockWorkspace() {
    const workspace = createDemoWorkspace();
    workspace.connections.forEach((connection) => {
      connection.source = 'user-reported';
    });
    return workspace;
  }
  function answerUntil(state: DiagnosticSession, target: string) {
    while (state.result === 'active' && state.plan[state.step].kind !== target) {
      const kind = state.plan[state.step].kind;
      state = answerDiagnosis(
        state,
        kind === 'confirm-route' || kind === 'compatibility' ? 'confirmed' : 'not-fixed',
      );
    }
    return state;
  }
  it('uses the recorded monitor-dock-computer chain and asks the user to confirm it', () => {
    const workspace = dockWorkspace();
    const initial = startDiagnosis('monitor-right', workspace);
    expect(initial.path.deviceIds).toEqual(['monitor-right', 'dock', 'laptop']);
    expect(initial.plan.map((step) => step.kind)).toEqual([
      'power',
      'confirm-route',
      'monitor-link',
      'dock-link',
      'display-settings',
      'compatibility',
      'direct-test',
    ]);
    const next = answerDiagnosis(initial, 'not-fixed');
    expect(next.plan[next.step].kind).toBe('confirm-route');
    expect(diagnosticStep(next, workspace).text).toContain('Right monitor → USB-C Dock → MacBook');
    expect(workspace.devices.every((device) => device.status === 'unknown')).toBe(true);
  });
  it('uses a different plan for a direct monitor-to-computer route', () => {
    const workspace = dockWorkspace();
    workspace.connections = [
      {
        id: 'direct',
        from: 'monitor-right',
        to: 'laptop',
        connector: 'HDMI',
        fromPort: '',
        toPort: '',
        source: 'user-reported',
        note: '',
      },
    ];
    const state = startDiagnosis('monitor-right', workspace);
    expect(state.path.deviceIds).toEqual(['monitor-right', 'laptop']);
    expect(state.plan.some((step) => ['dock-link', 'direct-test'].includes(step.kind))).toBe(false);
  });
  it('asks for missing wiring instead of inventing a computer path', () => {
    const workspace = dockWorkspace();
    workspace.connections = [];
    let state = answerDiagnosis(startDiagnosis('monitor-right', workspace), 'not-fixed');
    expect(state.plan[state.step].kind).toBe('record-route');
    expect(diagnosticStep(state, workspace).text).toContain('no recorded candidate display path');
    state = answerDiagnosis(state, 'not-confirmed');
    expect(state.result).toBe('unresolved');
    expect(state.stopReason).toBe('route-unknown');
    expect(state.answers[1].answer).toBe('not-confirmed');
  });
  it('does not assume a Bluetooth or Ethernet link carries display video', () => {
    const workspace = dockWorkspace();
    workspace.connections.forEach((edge) => {
      edge.connector = 'Bluetooth';
    });
    expect(startDiagnosis('monitor-right', workspace).path.connections).toEqual([]);
  });
  it('blocks cable tests when power cannot be checked or the recorded route is rejected', () => {
    const workspace = dockWorkspace();
    const skipped = answerDiagnosis(startDiagnosis('monitor-right', workspace), 'skip');
    expect(skipped.result).toBe('unresolved');
    expect(skipped.stopReason).toBe('prerequisite-skipped');
    const rejected = answerDiagnosis(
      answerDiagnosis(startDiagnosis('monitor-right', workspace), 'not-fixed'),
      'not-confirmed',
    );
    expect(rejected.result).toBe('unresolved');
    expect(rejected.stopReason).toBe('route-not-confirmed');
  });
  it('branches past physical tests after a skipped cable check and never recommends a dependent bypass', () => {
    const workspace = dockWorkspace();
    const cable = answerUntil(startDiagnosis('monitor-right', workspace), 'monitor-link');
    const failed = answerDiagnosis(cable, 'not-fixed');
    const skipped = answerDiagnosis(cable, 'skip');
    expect(failed.plan[failed.step].kind).toBe('dock-link');
    expect(skipped.plan[skipped.step].kind).toBe('display-settings');
    const compatibility = answerDiagnosis(skipped, 'not-fixed');
    const stopped = answerDiagnosis(compatibility, 'confirmed');
    expect(stopped.result).toBe('unresolved');
    expect(stopped.stopReason).toBe('prerequisite-skipped');
    expect(stopped.answers.some((item) => item.kind === 'direct-test')).toBe(false);
  });
  it('requires explicit compatibility confirmation before the direct-connection test', () => {
    const workspace = dockWorkspace();
    const review = answerUntil(startDiagnosis('monitor-right', workspace), 'compatibility');
    expect(answerDiagnosis(review, 'skip').stopReason).toBe('compatibility-unknown');
    expect(answerDiagnosis(review, 'not-supported').stopReason).toBe('compatibility-not-supported');
    const direct = answerDiagnosis(review, 'confirmed');
    expect(direct.plan[direct.step].kind).toBe('direct-test');
    expect(diagnosticStep(direct, workspace).note).toContain('does not prove');
    const result = answerDiagnosis(direct, 'fixed');
    expect(result.result).toBe('resolved');
    expect(result.answers.at(-1)).toMatchObject({ kind: 'direct-test', answer: 'fixed' });
    expect(diagnosisNote(result)).toContain('Cause not determined');
  });
  it('keeps unresolved and skipped outcomes in a serializable validated history', () => {
    const workspace = dockWorkspace();
    const original = startDiagnosis('monitor-right', workspace);
    const ended = answerDiagnosis(original, 'skip');
    const restored = DiagnosticSessionSchema.parse(JSON.parse(JSON.stringify(ended)));
    expect(restored).toEqual(ended);
    expect(original.answers).toHaveLength(0);
    expect(restored.answers).toHaveLength(1);
    expect(diagnosisNote(restored)).toContain('skipped check is not a failure');
  });
  it('rejects forged resolved results and answers that bypass prerequisites', () => {
    const workspace = dockWorkspace();
    const state = startDiagnosis('monitor-right', workspace);
    expect(
      DiagnosticSessionSchema.safeParse({ ...state, result: 'resolved', stopReason: 'resolved' })
        .success,
    ).toBe(false);
    const route = answerDiagnosis(state, 'not-fixed');
    expect(() => answerDiagnosis(route, 'fixed')).toThrow('does not apply');
    const malformed = {
      ...route,
      answers: [{ ...route.answers[0], step: 2, kind: 'monitor-link' }],
    };
    expect(DiagnosticSessionSchema.safeParse(malformed).success).toBe(false);
  });
  it('detects changed graph evidence without deleting prior answers', () => {
    const workspace = dockWorkspace();
    const state = answerDiagnosis(startDiagnosis('monitor-right', workspace), 'not-fixed');
    expect(diagnosticContextMatches(state, workspace)).toBe(true);
    workspace.connections.find(
      (edge) => edge.from === 'monitor-right' || edge.to === 'monitor-right',
    )!.connector = 'Unknown';
    expect(diagnosticContextMatches(state, workspace)).toBe(false);
    const ended = endChangedDiagnosis(state);
    expect(ended.result).toBe('unresolved');
    expect(ended.stopReason).toBe('graph-changed');
    expect(ended.answers).toEqual(state.answers);
    expect(DiagnosticSessionSchema.safeParse(ended).success).toBe(true);
  });
  it('keeps OS-origin diagnosis provenance local after device renaming', () => {
    const workspace = dockWorkspace();
    workspace.devices.find((device) => device.id === 'dock')!.hardwareOrigin = 'macos';
    const state = startDiagnosis('monitor-right', workspace);
    expect(state.localOnly).toBe(true);
    expect(diagnosisDeviceIds(state).sort()).toEqual(['dock', 'laptop', 'monitor-right']);
    expect(JSON.stringify(state)).not.toContain('USB-C Dock');
    const next = answerDiagnosis(state, 'not-fixed');
    expect(next.localOnly).toBe(true);
  });
  it('marks multiple recorded routes as ambiguous and still requires route confirmation', () => {
    const workspace = dockWorkspace();
    workspace.connections.push({
      id: 'direct-alternative',
      from: 'monitor-right',
      to: 'laptop',
      connector: 'DisplayPort',
      fromPort: '',
      toPort: '',
      source: 'user-reported',
      note: '',
    });
    const state = answerDiagnosis(startDiagnosis('monitor-right', workspace), 'not-fixed');
    expect(state.path.ambiguous).toBe(true);
    expect(state.plan[state.step].kind).toBe('confirm-route');
    expect(diagnosticStep(state, workspace).note).toContain('More than one recorded route');
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

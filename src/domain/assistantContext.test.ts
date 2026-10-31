import { describe, expect, it } from 'vitest';
import { createDemoWorkspace } from './workspace';
import {
  assistantSceneFocus,
  assistantTargetIsLocalOnly,
  assistantDiagnosticContext,
} from './assistantContext';
import { demoReply } from './demoAssistant';
import { startDiagnosis, answerDiagnosis, diagnosticStep } from './diagnosis';
import { modelWorkspace } from './workspacePrivacy';

describe('selected conversation target and recorded scene route', () => {
  it('focuses the chosen monitor route without lighting unrelated dock branches', () => {
    const workspace = createDemoWorkspace();
    const focus = assistantSceneFocus(workspace, 'monitor-right')!;
    expect(focus.deviceIds).toEqual(['monitor-right', 'dock', 'laptop']);
    expect(focus.connectionIds).toHaveLength(2);
    expect(
      focus.connectionIds.every((id) =>
        workspace.connections.some((connection) => connection.id === id),
      ),
    ).toBe(true);
    expect(focus.deviceIds).not.toContain('monitor-left');
    expect(focus.deviceIds).not.toContain('ssd');
  });
  it('does not manufacture missing endpoints or treat a keyboard route as a monitor video path', () => {
    const workspace = createDemoWorkspace();
    workspace.connections = [
      {
        ...workspace.connections[0],
        id: 'wrong-route',
        from: 'monitor-right',
        to: 'keyboard',
        connector: 'Bluetooth',
      },
      { ...workspace.connections[0], id: 'missing-peer', from: 'monitor-right', to: 'removed' },
    ];
    expect(assistantSceneFocus(workspace, 'monitor-right')).toEqual({
      deviceIds: ['monitor-right'],
      connectionIds: [],
    });
    expect(assistantSceneFocus(workspace, 'removed')).toBeNull();
    expect(assistantSceneFocus(workspace, null)).toBeNull();
  });
  it('marks renamed and unmatched OS-origin records local-only', () => {
    const workspace = createDemoWorkspace();
    const device = workspace.devices[0];
    device.hardwareOrigin = 'macos';
    device.source = 'user-reported';
    device.name = 'Renamed local device';
    expect(assistantTargetIsLocalOnly(workspace, device.id)).toBe(true);
    expect(assistantTargetIsLocalOnly(workspace, 'monitor-right')).toBe(false);
  });
  it('resolves a pronoun to the target but honors an explicitly named different monitor', () => {
    const workspace = createDemoWorkspace();
    expect(
      demoReply('This monitor is not displaying', workspace, 'monitor-right').proposals[0],
    ).toMatchObject({ type: 'set-status', deviceId: 'monitor-right' });
    expect(
      demoReply('The left monitor is not displaying', workspace, 'monitor-right').proposals[0],
    ).toMatchObject({ type: 'set-status', deviceId: 'monitor-left' });
  });
  it('records only an explicitly described connection with the selected target', () => {
    const workspace = createDemoWorkspace();
    expect(
      demoReply('I connected this monitor to the dock with HDMI', workspace, 'monitor-right')
        .proposals[0],
    ).toMatchObject({ type: 'connect', connector: 'HDMI' });
    expect(
      demoReply('Should I connect this monitor to the dock?', workspace, 'monitor-right').proposals,
    ).toEqual([]);
  });
});

describe('guided-check conversation memory and privacy', () => {
  it('resumes the unanswered check without proposing to repeat a completed power check', () => {
    const workspace = createDemoWorkspace();
    const session = answerDiagnosis(startDiagnosis('monitor-right', workspace), 'not-fixed');
    workspace.diagnoses = [session];
    const reply = demoReply('What should I check next?', workspace, 'monitor-right');
    expect(reply.message).toContain('Saved user checks: Check power and input source');
    expect(reply.message).toContain(
      `Current unanswered check: ${diagnosticStep(session, workspace).title}`,
    );
    expect(reply.message).not.toContain('Current unanswered check: Check power');
    expect(reply.proposals).toEqual([]);
  });
  it('includes safe answer enums and marks historical topology as changed', () => {
    const workspace = createDemoWorkspace();
    const session = answerDiagnosis(startDiagnosis('monitor-right', workspace), 'not-fixed');
    workspace.diagnoses = [session];
    let context = assistantDiagnosticContext(modelWorkspace(workspace), 'monitor-right');
    expect(context[0]).toMatchObject({
      deviceId: 'monitor-right',
      graphChanged: false,
      answers: [{ check: 'power', answer: 'not-fixed' }],
    });
    workspace.connections.find((edge) => edge.id === session.path.connections[0].id)!.connector =
      'Unknown';
    context = assistantDiagnosticContext(modelWorkspace(workspace), 'monitor-right');
    expect(context[0].graphChanged).toBe(true);
    expect(demoReply('What next?', workspace, 'monitor-right').message).toContain(
      'connection path changed',
    );
  });
  it('never transmits local-only or newly OS-derived session references', () => {
    const workspace = createDemoWorkspace();
    const session = startDiagnosis('monitor-right', workspace);
    workspace.diagnoses = [{ ...session, localOnly: true }];
    expect(modelWorkspace(workspace).diagnoses).toEqual([]);
    workspace.diagnoses = [session];
    workspace.devices.find((device) => device.id === 'dock')!.hardwareOrigin = 'macos';
    const shared = modelWorkspace(workspace);
    expect(shared.diagnoses).toEqual([]);
    expect(shared.devices.some((device) => device.id === 'dock')).toBe(false);
    expect(shared.connections.some((edge) => edge.from === 'dock' || edge.to === 'dock')).toBe(
      false,
    );
  });
  it('excludes an OS-sourced link even when both endpoint names are manually recorded', () => {
    const workspace = createDemoWorkspace();
    workspace.connections[0].source = 'os-detected';
    workspace.connections[0].note = 'Local OS relationship detail';
    const shared = modelWorkspace(workspace);
    expect(shared.connections.some((edge) => edge.id === workspace.connections[0].id)).toBe(false);
    expect(JSON.stringify(shared)).not.toContain('Local OS relationship detail');
  });
  it('excludes sessions with missing references and historical OS connection provenance', () => {
    const workspace = createDemoWorkspace();
    const session = startDiagnosis('monitor-right', workspace);
    workspace.diagnoses = [session];
    session.path.connections[0].source = 'os-detected';
    expect(modelWorkspace(workspace).diagnoses).toEqual([]);
    session.path.connections[0].source = 'user-reported';
    workspace.devices = workspace.devices.filter((device) => device.id !== 'dock');
    expect(modelWorkspace(workspace).diagnoses).toEqual([]);
  });
});

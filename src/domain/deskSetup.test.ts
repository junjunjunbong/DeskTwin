import { describe, expect, it } from 'vitest';
import { createDemoWorkspace } from './workspace';
import {
  setupConnectionCommand,
  setupConnectionForPair,
  setupConnectionQuestions,
  setupSuggestionFromNotes,
  type SetupConnectionDraft,
} from './deskSetup';

const draft: SetupConnectionDraft = {
  from: 'monitor-right',
  to: 'dock',
  connector: 'HDMI',
  fromPort: 'HDMI 1',
  toPort: '',
  note: 'The user checked this connection.',
};

describe('guided desk setup questions', () => {
  it('asks about sample connections rather than treating them as physical evidence', () => {
    const workspace = createDemoWorkspace();
    const questions = setupConnectionQuestions(workspace);
    expect(questions.slice(0, 3).map((question) => question.deviceId)).toEqual([
      'monitor-left',
      'monitor-right',
      'dock',
    ]);
    expect(questions[0].text).toContain('directly to a computer or through a dock');
    expect(questions.some((question) => question.deviceId === 'laptop')).toBe(false);
  });

  it('clarifies the dock upstream even when a downstream monitor is recorded', () => {
    const workspace = createDemoWorkspace();
    workspace.connections.find((edge) => edge.to === 'monitor-right')!.source = 'user-reported';
    let questions = setupConnectionQuestions(workspace);
    expect(questions.some((question) => question.deviceId === 'monitor-right')).toBe(false);
    expect(questions.find((question) => question.deviceId === 'dock')?.text).toContain(
      'Which computer',
    );
    workspace.connections.find((edge) => edge.id === 'laptop-dock')!.source = 'user-reported';
    questions = setupConnectionQuestions(workspace);
    expect(questions.some((question) => question.deviceId === 'dock')).toBe(false);
  });

  it('does not answer a cabling question from an OS-derived or photo-inferred edge', () => {
    const workspace = createDemoWorkspace();
    const edge = workspace.connections.find((edge) => edge.to === 'monitor-right')!;
    edge.source = 'os-detected';
    expect(
      setupConnectionQuestions(workspace).some((question) => question.deviceId === 'monitor-right'),
    ).toBe(true);
    edge.source = 'photo-inferred';
    expect(
      setupConnectionQuestions(workspace).some((question) => question.deviceId === 'monitor-right'),
    ).toBe(true);
  });

  it('does not mistake a downstream peripheral for a monitor display input', () => {
    const workspace = createDemoWorkspace();
    const edge = workspace.connections.find((edge) => edge.to === 'monitor-right')!;
    edge.source = 'user-reported';
    edge.from = 'keyboard';
    expect(
      setupConnectionQuestions(workspace).some((question) => question.deviceId === 'monitor-right'),
    ).toBe(true);
  });
});

describe('setup notes produce reviewable suggestions only', () => {
  it('uses an explicit report naming exactly two current devices', () => {
    const workspace = createDemoWorkspace();
    const before = structuredClone(workspace);
    const suggestion = setupSuggestionFromNotes(
      'I connected Right monitor to USB-C Dock with HDMI.',
      workspace,
    );
    expect(suggestion).toMatchObject({ from: 'monitor-right', to: 'dock', connector: 'HDMI' });
    // USB-C in the saved dock name is not evidence about the actual cable.
    expect(workspace).toEqual(before);
    workspace.devices.find((device) => device.id === 'dock')!.name = 'Work dock';
    expect(
      setupSuggestionFromNotes('I connected Right monitor to Work dock with HDMI.', workspace),
    ).toMatchObject({ connector: 'HDMI' });
  });

  it.each([
    'Should I connect Right monitor to USB-C Dock with HDMI?',
    'Right monitor is not connected to USB-C Dock.',
    'Maybe Right monitor is connected to USB-C Dock.',
    'I connected MacBook to USB-C Dock and Right monitor.',
    'Right monitor and USB-C Dock look close together.',
    'I connected Right monitor to an unknown display.',
  ])('does not turn ambiguous or non-report text into an edge: %s', (text) => {
    expect(setupSuggestionFromNotes(text, createDemoWorkspace())).toBeNull();
  });

  it('requires unambiguous record names and avoids substring device matches', () => {
    const workspace = createDemoWorkspace();
    workspace.devices.find((device) => device.id === 'dock')!.name = 'Dock';
    expect(
      setupSuggestionFromNotes('I connected Right monitor to Docking station.', workspace),
    ).toBeNull();
    workspace.devices.find((device) => device.id === 'monitor-left')!.name = 'Right monitor';
    expect(setupSuggestionFromNotes('I connected Right monitor to Dock.', workspace)).toBeNull();
  });

  it('leaves connector capabilities and ports unknown when they were not stated', () => {
    const workspace = createDemoWorkspace();
    expect(
      setupSuggestionFromNotes('Right monitor is connected to USB-C Dock.', workspace),
    ).toMatchObject({ connector: 'Unknown', fromPort: '', toPort: '' });
  });
});

describe('connection review approval', () => {
  it('preserves the exact reviewed edge as a precondition without changing workspace', () => {
    const workspace = createDemoWorkspace();
    const previous = structuredClone(setupConnectionForPair(workspace, draft.from, draft.to)!);
    const before = structuredClone(workspace);
    const command = setupConnectionCommand(workspace, draft, previous);
    expect(command).toMatchObject({
      type: 'connect',
      expectedConnection: previous,
      connection: { ...draft, source: 'user-reported' },
    });
    expect(workspace).toEqual(before);
  });

  it('does not treat initial no-connection approval as permission to replace a newly saved edge', () => {
    const workspace = createDemoWorkspace();
    expect(() => setupConnectionCommand(workspace, draft, null)).toThrow(
      'changed after your review',
    );
    workspace.connections = [];
    expect(setupConnectionCommand(workspace, draft, null)).toMatchObject({
      expectedConnection: null,
    });
  });

  it('rejects changed notes/ports and missing endpoints before enqueueing a command', () => {
    const workspace = createDemoWorkspace();
    const previous = structuredClone(setupConnectionForPair(workspace, draft.from, draft.to)!);
    setupConnectionForPair(workspace, draft.from, draft.to)!.fromPort = 'A later edit';
    expect(() => setupConnectionCommand(workspace, draft, previous)).toThrow(
      'changed after your review',
    );
    workspace.devices = workspace.devices.filter((device) => device.id !== draft.from);
    expect(() => setupConnectionCommand(workspace, draft, previous)).toThrow(
      'no longer in this desk',
    );
  });

  it('rejects self-links and invalid imported connector values', () => {
    expect(() =>
      setupConnectionCommand(createDemoWorkspace(), { ...draft, to: draft.from }, null),
    ).toThrow('two different devices');
    expect(() =>
      setupConnectionCommand(
        createDemoWorkspace(),
        { ...draft, connector: 'Thunderbolt' } as unknown as SetupConnectionDraft,
        null,
      ),
    ).toThrow();
  });
});

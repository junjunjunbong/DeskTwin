import { describe, expect, it } from 'vitest';
import { createDemoWorkspace, type Connection, type Device } from './workspace';
import {
  setupConnectionCommand,
  setupConnectionForPair,
  setupConnectionQuestions,
  setupSuggestionFromNotes,
  setupSuggestionsFromNotes,
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

const described = 'The user reviewed and confirmed a connection described in their setup notes.';
const exampleNote =
  'The right monitor is connected to the dock with HDMI. The dock is connected to the laptop USB-C port. The right monitor shows nothing.';

function photoDevices(connections: Connection[] = []) {
  const workspace = createDemoWorkspace();
  const template = structuredClone(workspace.devices[0]);
  const specs: { id: string; kind: Device['kind']; name: string }[] = [
    { id: 'photo-left', kind: 'monitor', name: 'Left computer monitor' },
    { id: 'photo-right', kind: 'monitor', name: 'Right computer monitor' },
    { id: 'photo-dock', kind: 'dock', name: 'Silver docking station' },
    { id: 'photo-laptop', kind: 'laptop', name: 'Silver laptop' },
  ];
  workspace.devices = specs.map((spec, index) => ({
    ...structuredClone(template),
    ...spec,
    placement: { x: -2 + index, y: 2.51, z: 0, rotation: 0 },
    source: 'photo-inferred',
    visual: { ...template.visual, source: 'photo-inferred' },
  }));
  workspace.connections = connections;
  return workspace;
}

function reported(
  from: string,
  to: string,
  connector: Connection['connector'],
  source: Connection['source'] = 'user-reported',
): Connection {
  return {
    id: `${from}-${to}-${connector}`,
    from,
    to,
    connector,
    fromPort: '',
    toPort: '',
    source,
    note: 'Recorded for the test.',
  };
}

describe('photo notes suggest one reviewable connection per clause', () => {
  it('turns the example note into the monitor-dock and dock-laptop drafts only', () => {
    const suggestions = setupSuggestionsFromNotes(exampleNote, photoDevices());
    expect(suggestions).toEqual([
      {
        from: 'photo-right',
        to: 'photo-dock',
        connector: 'HDMI',
        fromPort: '',
        toPort: '',
        note: described,
      },
      {
        from: 'photo-dock',
        to: 'photo-laptop',
        connector: 'USB-C',
        fromPort: '',
        toPort: '',
        note: described,
      },
    ]);
    expect(setupSuggestionFromNotes(exampleNote, photoDevices())).toBeNull();
  });

  it.each(['. ', '; ', '\n', '。'])('keeps each connection when clauses are split by %j', (gap) => {
    const note = `The right monitor is connected to the dock with HDMI${gap}The dock is connected to the laptop with USB-C`;
    expect(setupSuggestionsFromNotes(note, photoDevices()).map((draft) => draft.connector)).toEqual(
      ['HDMI', 'USB-C'],
    );
  });

  it('does not guess when monitor mentions are ambiguous', () => {
    const workspace = photoDevices();
    expect(
      setupSuggestionsFromNotes('The monitor is connected to the dock with HDMI.', workspace),
    ).toEqual([]);
    workspace.devices.find((device) => device.id === 'photo-left')!.name = 'Far right monitor';
    expect(
      setupSuggestionsFromNotes('The right monitor is connected to the dock with HDMI.', workspace),
    ).toEqual([]);
  });

  it('drops a negated or questioning clause without dropping a later report', () => {
    const workspace = photoDevices();
    expect(
      setupSuggestionsFromNotes(
        'The right monitor is not connected to the dock with HDMI.',
        workspace,
      ),
    ).toEqual([]);
    expect(
      setupSuggestionsFromNotes(
        'The right monitor is not connected to the dock. The dock is connected to the laptop with USB-C.',
        workspace,
      ),
    ).toEqual([
      {
        from: 'photo-dock',
        to: 'photo-laptop',
        connector: 'USB-C',
        fromPort: '',
        toPort: '',
        note: described,
      },
    ]);
    expect(
      setupSuggestionsFromNotes(
        'Should the right monitor be connected to the dock? The dock is connected to the laptop with USB-C.',
        workspace,
      ).map((draft) => draft.connector),
    ).toEqual(['USB-C']);
  });

  it('resolves Korean kind words and side words clause by clause', () => {
    const workspace = photoDevices();
    for (const device of workspace.devices) {
      device.name =
        device.id === 'photo-left'
          ? '왼쪽 컴퓨터 모니터'
          : device.id === 'photo-right'
            ? '오른쪽 컴퓨터 모니터'
            : device.id === 'photo-dock'
              ? '실버 도크'
              : '실버 노트북';
    }
    expect(
      setupSuggestionsFromNotes(
        '오른쪽 모니터는 도크에 HDMI로 연결되어 있습니다. 도크는 노트북에 USB-C로 연결했습니다. 오른쪽 모니터에는 아무것도 나오지 않습니다.',
        workspace,
      ),
    ).toEqual([
      {
        from: 'photo-right',
        to: 'photo-dock',
        connector: 'HDMI',
        fromPort: '',
        toPort: '',
        note: described,
      },
      {
        from: 'photo-dock',
        to: 'photo-laptop',
        connector: 'USB-C',
        fromPort: '',
        toPort: '',
        note: described,
      },
    ]);
    expect(
      setupSuggestionsFromNotes('오른쪽 모니터는 도크에 연결되어 있지 않습니다.', workspace),
    ).toEqual([]);
    expect(
      setupSuggestionsFromNotes('맥북은 도크에 USB-C로 연결했습니다.', workspace),
    ).toMatchObject([{ from: 'photo-dock', to: 'photo-laptop', connector: 'USB-C' }]);
  });

  it('skips a pair that already has the same user-reported connector', () => {
    const existing = photoDevices([reported('photo-right', 'photo-dock', 'HDMI')]);
    expect(setupSuggestionsFromNotes(exampleNote, existing)).toEqual([
      {
        from: 'photo-dock',
        to: 'photo-laptop',
        connector: 'USB-C',
        fromPort: '',
        toPort: '',
        note: described,
      },
    ]);
    const differentConnector = photoDevices([reported('photo-right', 'photo-dock', 'USB-C')]);
    expect(
      setupSuggestionsFromNotes(exampleNote, differentConnector).map((draft) => draft.connector),
    ).toEqual(['HDMI', 'USB-C']);
    const sample = photoDevices([reported('photo-right', 'photo-dock', 'HDMI', 'demo')]);
    expect(setupSuggestionsFromNotes(exampleNote, sample)).toHaveLength(2);
  });

  it('keeps exact saved names and does not read USB-C from a device name', () => {
    const workspace = createDemoWorkspace();
    const text = 'I connected Right monitor to USB-C Dock with HDMI.';
    expect(setupSuggestionsFromNotes(text, workspace)).toEqual([
      setupSuggestionFromNotes(text, workspace),
    ]);
    expect(
      setupSuggestionsFromNotes('Right monitor is connected to USB-C Dock.', workspace),
    ).toMatchObject([{ connector: 'Unknown', fromPort: '', toPort: '' }]);
    workspace.devices.find((device) => device.id === 'dock')!.name = 'Dock';
    expect(
      setupSuggestionsFromNotes(
        'I connected Right monitor to the docking station with HDMI.',
        workspace,
      ),
    ).toMatchObject([{ from: 'monitor-right', to: 'dock', connector: 'HDMI' }]);
    expect(
      setupSuggestionsFromNotes(
        'The right monitor is connected to the dock with HDMI. The right monitor is connected to the dock with HDMI.',
        photoDevices(),
      ),
    ).toHaveLength(1);
  });

  it('maps a computer tower or PC onto the only desktop', () => {
    const workspace = photoDevices();
    workspace.devices.push({
      ...structuredClone(workspace.devices[0]),
      id: 'photo-desktop',
      kind: 'desktop',
      name: 'Office tower',
    });
    expect(
      setupSuggestionsFromNotes(
        'The computer tower is connected to the right monitor with HDMI.',
        workspace,
      ),
    ).toMatchObject([{ from: 'photo-right', to: 'photo-desktop', connector: 'HDMI' }]);
    expect(
      setupSuggestionsFromNotes('The PC is connected to the dock with USB-C.', workspace),
    ).toMatchObject([{ from: 'photo-dock', to: 'photo-desktop', connector: 'USB-C' }]);
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

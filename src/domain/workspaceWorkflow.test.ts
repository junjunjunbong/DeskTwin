import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyProposal,
  connectionBetween,
  createDemoWorkspace,
  localizeLegacyDemoForDisplay,
  parseWorkspace,
  type Connection,
} from './workspace';
import { answerDiagnosis, endChangedDiagnosis, startDiagnosis } from './diagnosis';
import { applySceneDraft, buildSceneDraft, retainedDevices } from './sceneProposal';

const at = '2026-10-31T04:00:00.000Z';
const later = '2026-10-31T04:01:00.000Z';

describe('reviewed connection transactions', () => {
  it('accepts the exact legacy sample display translation without accepting changed reports', () => {
    const raw = createDemoWorkspace();
    raw.connections[0].note = '체험용 예시입니다. 실제 연결이 아닙니다.';
    const reviewed = localizeLegacyDemoForDisplay(raw).connections[0];
    const result = applyCommand(raw, {
      type: 'connect',
      connection: { ...reviewed, source: 'user-reported' },
      expectedConnection: reviewed,
    });
    expect(result.connections.at(-1)?.source).toBe('user-reported');
    raw.connections[0].note = 'A newly edited report';
    expect(() =>
      applyCommand(raw, { type: 'connect', connection: reviewed, expectedConnection: reviewed }),
    ).toThrow('connection changed');
  });
  it('rejects replacement without review, including reverse-direction proposals', () => {
    const workspace = createDemoWorkspace();
    expect(() =>
      applyProposal(workspace, {
        type: 'connect',
        from: 'monitor-right',
        to: 'dock',
        connector: 'USB-C',
        reason: 'User report',
      }),
    ).toThrow('Review and confirm');
    expect(connectionBetween(workspace, 'dock', 'monitor-right')?.source).toBe('demo');
  });

  it('compares all reviewed edge fields at save time and preserves operating status', () => {
    const workspace = createDemoWorkspace();
    const old = connectionBetween(workspace, 'dock', 'monitor-right')!;
    const replacement: Connection = {
      ...old,
      id: 'replacement',
      connector: 'DisplayPort',
      source: 'user-reported',
    };
    const saved = applyCommand(workspace, {
      type: 'connect',
      connection: replacement,
      expectedConnection: old,
    });
    expect(saved.connections).toHaveLength(workspace.connections.length);
    expect(saved.devices).toEqual(workspace.devices);
    expect(() =>
      applyCommand(saved, {
        type: 'connect',
        connection: { ...replacement, connector: 'HDMI' },
        expectedConnection: old,
      }),
    ).toThrow('connection changed');
    const sameIdChangedNote = structuredClone(workspace);
    sameIdChangedNote.connections.find((edge) => edge.id === old.id)!.note = 'A newer report';
    expect(() =>
      applyCommand(sameIdChangedNote, {
        type: 'connect',
        connection: replacement,
        expectedConnection: old,
      }),
    ).toThrow('connection changed');
  });

  it('rejects a queued new edge when another command created that pair first', () => {
    const workspace = createDemoWorkspace();
    const connection: Connection = {
      id: 'direct',
      from: 'monitor-right',
      to: 'laptop',
      connector: 'HDMI',
      fromPort: '',
      toPort: '',
      source: 'user-reported',
      note: '',
    };
    const saved = applyCommand(workspace, {
      type: 'connect',
      connection,
      expectedConnection: null,
    });
    expect(() =>
      applyCommand(saved, {
        type: 'connect',
        connection: { ...connection, id: 'second' },
        expectedConnection: null,
      }),
    ).toThrow('connection changed');
  });
});

describe('persisted guided check transactions', () => {
  it('reads old v2 saves without changing the input and validates session references', () => {
    const old = { ...createDemoWorkspace() } as Record<string, unknown>;
    delete old.diagnoses;
    expect(parseWorkspace(old).diagnoses).toEqual([]);
    expect(old).not.toHaveProperty('diagnoses');
    const workspace = createDemoWorkspace();
    const session = startDiagnosis('monitor-right', workspace, at);
    const missing = {
      ...workspace,
      devices: workspace.devices.filter((device) => device.id !== 'monitor-right'),
      connections: [],
      diagnoses: [session],
    };
    expect(() => parseWorkspace(missing)).toThrow('missing device');
    expect(() => parseWorkspace({ ...workspace, diagnoses: [session, session] })).toThrow(
      'Duplicate diagnostic',
    );
  });

  it('preserves answers, rejects stale writes, and never changes device status on its own', () => {
    const workspace = createDemoWorkspace();
    const session = startDiagnosis('monitor-right', workspace, at);
    const started = applyCommand(
      workspace,
      { type: 'save-diagnosis', session, expectedSession: null },
      at,
    );
    const answered = answerDiagnosis(session, 'not-fixed', later);
    const saved = applyCommand(
      started,
      { type: 'save-diagnosis', session: answered, expectedSession: session },
      later,
    );
    expect(saved.diagnoses[0].answers).toHaveLength(1);
    expect(saved.devices).toEqual(workspace.devices);
    expect(() =>
      applyCommand(saved, {
        type: 'save-diagnosis',
        session: answerDiagnosis(session, 'fixed', later),
        expectedSession: session,
      }),
    ).toThrow('guided check changed');
    expect(() =>
      applyCommand(saved, { type: 'save-diagnosis', session, expectedSession: answered }),
    ).toThrow('one next answer');
    expect(() =>
      applyCommand(workspace, { type: 'save-diagnosis', session: answered, expectedSession: null }),
    ).toThrow('Start a guided check');
  });

  it('rejects an answer queued after a topology change but allows closing the old attempt', () => {
    const workspace = createDemoWorkspace();
    const session = startDiagnosis('monitor-right', workspace, at);
    const started = applyCommand(
      workspace,
      { type: 'save-diagnosis', session, expectedSession: null },
      at,
    );
    const changed = applyCommand(started, { type: 'remove-connection', id: 'dock-monitor-right' });
    expect(() =>
      applyCommand(changed, {
        type: 'save-diagnosis',
        session: answerDiagnosis(session, 'fixed', later),
        expectedSession: session,
      }),
    ).toThrow('recorded route changed');
    const closed = applyCommand(changed, {
      type: 'save-diagnosis',
      session: endChangedDiagnosis(session, later),
      expectedSession: session,
    });
    expect(closed.diagnoses[0].stopReason).toBe('graph-changed');
    expect(closed.diagnoses[0].answers).toEqual([]);
  });

  it('keeps original local-only provenance and removes sessions when a referenced device is deleted', () => {
    const workspace = createDemoWorkspace();
    workspace.devices.find((device) => device.id === 'dock')!.hardwareOrigin = 'macos';
    const session = startDiagnosis('monitor-right', workspace, at);
    const started = applyCommand(
      workspace,
      { type: 'save-diagnosis', session, expectedSession: null },
      at,
    );
    expect(() =>
      applyCommand(started, {
        type: 'save-diagnosis',
        session: { ...answerDiagnosis(session, 'fixed', later), localOnly: false },
        expectedSession: session,
      }),
    ).toThrow('privacy boundary');
    const removed = applyCommand(started, { type: 'remove-device', id: 'dock' });
    expect(removed.diagnoses).toEqual([]);
  });

  it('checks the resolved session, route, and current report when committing a user test result', () => {
    const workspace = createDemoWorkspace();
    const session = startDiagnosis('monitor-right', workspace, at);
    const started = applyCommand(
      workspace,
      { type: 'save-diagnosis', session, expectedSession: null },
      at,
    );
    const resolved = answerDiagnosis(session, 'fixed', later);
    const checked = applyCommand(
      started,
      { type: 'save-diagnosis', session: resolved, expectedSession: session },
      later,
    );
    const { name, model, status, statusNote } = checked.devices.find(
      (device) => device.id === session.deviceId,
    )!;
    const command = {
      type: 'record-diagnosis-result' as const,
      session: resolved,
      expectedDetails: { name, model, status, statusNote },
    };
    const changedRoute = applyCommand(checked, {
      type: 'remove-connection',
      id: 'dock-monitor-right',
    });
    expect(() => applyCommand(changedRoute, command)).toThrow('route changed');
    const changedReport = applyCommand(checked, {
      type: 'update-device',
      id: session.deviceId,
      patch: { status: 'reported-issue', statusNote: 'A newer user report.' },
    });
    expect(() => applyCommand(changedReport, command)).toThrow('device report changed');
    const saved = applyCommand(checked, command);
    expect(saved.devices.find((device) => device.id === session.deviceId)?.status).toBe(
      'reported-working',
    );
    expect(saved.diagnoses).toEqual(checked.diagnoses);
    const nextAttempt = startDiagnosis(session.deviceId, checked, later);
    const restarted = applyCommand(checked, {
      type: 'save-diagnosis',
      session: nextAttempt,
      expectedSession: null,
    });
    expect(() => applyCommand(restarted, command)).toThrow('guided check or its route changed');
  });

  it('saves a reviewed test result for a legacy display label without renaming the raw device', () => {
    let workspace = createDemoWorkspace();
    workspace.devices.find((device) => device.id === 'monitor-right')!.name = '오른쪽 모니터';
    const session = startDiagnosis('monitor-right', workspace, at);
    workspace = applyCommand(workspace, { type: 'save-diagnosis', session, expectedSession: null });
    const resolved = answerDiagnosis(session, 'fixed', later);
    workspace = applyCommand(workspace, {
      type: 'save-diagnosis',
      session: resolved,
      expectedSession: session,
    });
    const { name, model, status, statusNote } = localizeLegacyDemoForDisplay(
      workspace,
    ).devices.find((device) => device.id === 'monitor-right')!;
    const saved = applyCommand(workspace, {
      type: 'record-diagnosis-result',
      session: resolved,
      expectedDetails: { name, model, status, statusNote },
    });
    expect(saved.devices.find((device) => device.id === 'monitor-right')?.name).toBe(
      '오른쪽 모니터',
    );
    expect(saved.devices.find((device) => device.id === 'monitor-right')?.status).toBe(
      'reported-working',
    );
  });

  it('preserves checked sample records and disallows photo previews from rewriting check history', () => {
    const workspace = createDemoWorkspace();
    const session = startDiagnosis('monitor-right', workspace, at);
    const started = applyCommand(
      workspace,
      { type: 'save-diagnosis', session, expectedSession: null },
      at,
    );
    expect(retainedDevices(started).map((device) => device.id)).toEqual(
      expect.arrayContaining(['monitor-right', 'dock', 'laptop']),
    );
    const draft = buildSceneDraft(started, {
      message: 'Synthetic photo fixture',
      objects: [
        {
          id: 'photo-chair',
          deviceId: null,
          kind: 'chair',
          name: 'Photo chair',
          placement: { x: 0, y: 0, z: 3, rotation: 0 },
          scale: { x: 1, y: 1, z: 1 },
          color: '#889977',
          parts: [],
          note: 'Fixture only',
        },
      ],
    });
    expect(draft.diagnoses).toEqual(started.diagnoses);
    expect(() => applySceneDraft(started, started, { ...draft, diagnoses: [] })).toThrow(
      'guided-check history',
    );
  });
});

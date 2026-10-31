import { useEffect, useRef, useState } from 'react';
import { Check, ArrowRight, ArrowCounterClockwise } from '@phosphor-icons/react';
import {
  answerDiagnosis,
  diagnosisNote,
  diagnosticContextMatches,
  diagnosticStep,
  diagnosticStepTitles,
  endChangedDiagnosis,
  startDiagnosis,
  type DiagnosticAnswer,
  type DiagnosticSession,
} from '../domain/diagnosis';
import type { Device, Workspace, WorkspaceCommand } from '../domain/workspace';
import '../styles/diagnosis.css';

const answerLabels: Record<DiagnosticAnswer, string> = {
  fixed: 'Screen worked',
  'not-fixed': 'Still no display',
  skip: 'Skipped / not checked',
  confirmed: 'User confirmed',
  'not-confirmed': 'Not confirmed',
  'not-supported': 'User reports unsupported',
};
const recordKey = (session: DiagnosticSession | null) => JSON.stringify(session);

export function DiagnosticPanel({
  workspace,
  device,
  onCommand,
  onFocusPath,
  onReviewConnections,
}: {
  workspace: Workspace;
  device: Device;
  onCommand: (command: WorkspaceCommand) => boolean | Promise<boolean>;
  onFocusPath?: (focus: { deviceIds: string[]; connectionIds: string[] }) => void;
  onReviewConnections?: () => void;
}) {
  const attempts = workspace.diagnoses.filter((session) => session.deviceId === device.id);
  const stored = attempts[0] ?? null;
  // Bridge a successful queued write until React publishes the accepted workspace.
  const [accepted, setAccepted] = useState<{
    before: string;
    next: DiagnosticSession;
  } | null>(null);
  const state = accepted && recordKey(stored) === accepted.before ? accepted.next : stored;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  useEffect(() => {
    if (accepted && recordKey(stored) !== accepted.before) setAccepted(null);
  }, [stored, accepted]);
  const matches = state ? diagnosticContextMatches(state, workspace) : true;
  const step = state ? diagnosticStep(state, workspace) : null;

  async function persist(next: DiagnosticSession, expected: DiagnosticSession | null) {
    const saved = await onCommand({
      type: 'save-diagnosis',
      session: next,
      expectedSession: expected,
    });
    if (!saved) {
      setError(
        'This check was not saved. Your previous answers are unchanged. Review the storage notice and try again.',
      );
      return false;
    }
    setAccepted({ before: recordKey(stored), next });
    return true;
  }
  async function perform(action: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.split('\n')[0]
          : 'The check could not be saved. Try again.',
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  async function start() {
    await perform(async () => {
      if (state?.result === 'active') {
        if (matches) return;
        if (!(await persist(endChangedDiagnosis(state), state))) return;
      }
      const next = startDiagnosis(device.id, workspace);
      await persist(next, null);
    });
  }
  function answer(value: DiagnosticAnswer) {
    if (!state || state.result !== 'active' || !matches) return;
    void perform(() => persist(answerDiagnosis(state, value), state));
  }
  const resultSaved = Boolean(
    state && device.status === 'reported-working' && device.statusNote === diagnosisNote(state),
  );

  if (!state)
    return (
      <section className="diagnostic-entry" aria-label="Monitor troubleshooting">
        <button className="button secondary full" disabled={saving} onClick={() => void start()}>
          {saving ? 'Starting check...' : 'Troubleshoot monitor step by step'}
        </button>
        <p className="micro-note">
          Your answers are saved in this browser. Operating status changes only after you confirm a
          result.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </section>
    );

  return (
    <section className="diagnostic-card" aria-label="Monitor troubleshooting">
      <span className="eyebrow">USER-GUIDED CHECK · NOT AUTOMATIC DETECTION</span>
      <div className="diagnostic-route">
        <strong>Recorded route</strong>
        <p>
          {state.path.deviceIds
            .map((id) => workspace.devices.find((item) => item.id === id)?.name || 'Removed device')
            .join(' → ')}
          {!state.path.connections.length && ' · Connection to a computer is unknown'}
        </p>
        {state.path.connections.some((item) => item.source === 'demo') && (
          <small>Contains example records. Confirm the physical route before cable tests.</small>
        )}
        {state.localOnly && (
          <small>
            This attempt contains locally derived records and stays out of Meta context.
          </small>
        )}
        {onFocusPath && state.path.connections.length > 0 && (
          <button
            className="text-button"
            onClick={() =>
              onFocusPath({
                deviceIds: state.path.deviceIds,
                connectionIds: state.path.connections.map((item) => item.id),
              })
            }
          >
            Show diagnostic route
          </button>
        )}
      </div>
      {state.result === 'active' && !matches ? (
        <div className="diagnostic-route-change" role="status">
          <h3>The recorded route changed</h3>
          <p>
            Your earlier answers are kept. Start a new attempt before applying checks to the changed
            connections.
          </p>
          <button className="button secondary" disabled={saving} onClick={() => void start()}>
            Start with current connections
          </button>
        </div>
      ) : state.result === 'active' && step ? (
        <>
          <div className="diagnostic-progress">
            Check {state.step + 1} of {state.plan.length} · Answers saved locally
          </div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <small>{step.note}</small>
          <div className="diagnostic-actions">
            {step.kind === 'confirm-route' ? (
              <>
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => answer('confirmed')}
                >
                  This matches my checked connections
                </button>
                <button
                  className="button secondary"
                  disabled={saving}
                  onClick={() => answer('not-confirmed')}
                >
                  The route is different
                </button>
              </>
            ) : step.kind === 'compatibility' ? (
              <>
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => answer('confirmed')}
                >
                  Documentation confirms support
                </button>
                <button
                  className="button secondary"
                  disabled={saving}
                  onClick={() => answer('not-supported')}
                >
                  Documentation rules out this test
                </button>
              </>
            ) : step.kind === 'record-route' ? (
              <>
                {onReviewConnections && (
                  <button
                    className="button secondary"
                    disabled={saving}
                    onClick={onReviewConnections}
                  >
                    Review missing connections
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={saving}
                  onClick={() => answer('not-confirmed')}
                >
                  Connections are still unknown
                </button>
              </>
            ) : (
              <>
                <button
                  className="button primary"
                  disabled={saving}
                  onClick={() => answer('fixed')}
                >
                  <Check size={15} />
                  The screen works
                </button>
                <button
                  className="button secondary"
                  disabled={saving}
                  onClick={() => answer('not-fixed')}
                >
                  Still no display
                  <ArrowRight size={14} />
                </button>
              </>
            )}
            <button className="text-button" disabled={saving} onClick={() => answer('skip')}>
              I can't check right now
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>
            {state.result === 'resolved'
              ? 'You confirmed the screen works'
              : 'Further checks needed'}
          </h3>
          <p>{diagnosisNote(state)}</p>
          <p className="micro-note">
            The attempt and all answers are saved. This does not change operating status or the
            recorded cable path.
          </p>
          {!matches && (
            <p className="micro-note" role="status">
              The recorded route changed after this attempt. Its result remains in history; start a
              new check before updating operating status.
            </p>
          )}
          {state.result === 'resolved' &&
            (resultSaved ? (
              <span className="applied-note">
                <Check size={14} />
                Saved as a user-reported test result
              </span>
            ) : (
              <button
                className="button primary"
                disabled={saving || !matches}
                onClick={() =>
                  void perform(async () => {
                    if (!matches) return;
                    const result = await onCommand({
                      type: 'record-diagnosis-result',
                      session: state,
                      expectedDetails: {
                        name: device.name,
                        model: device.model,
                        status: device.status,
                        statusNote: device.statusNote,
                      },
                    });
                    if (!result)
                      setError(
                        'The test result was not saved. Check the storage notice and try again.',
                      );
                  })
                }
              >
                {saving ? 'Saving test result...' : 'Save result as user-reported'}
              </button>
            ))}
          {onReviewConnections &&
            ['route-unknown', 'route-not-confirmed', 'graph-changed'].includes(
              state.stopReason,
            ) && (
              <button className="button secondary" disabled={saving} onClick={onReviewConnections}>
                Review missing connections
              </button>
            )}
          <button className="text-button" disabled={saving} onClick={() => void start()}>
            <ArrowCounterClockwise size={15} />
            Check again
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {state.answers.length > 0 && (
        <details className="diagnostic-answer-history">
          <summary>Answers in this attempt ({state.answers.length})</summary>
          <ol>
            {state.answers.map((item, index) => (
              <li key={`${item.step}-${index}`}>
                <strong>{diagnosticStepTitles[item.kind]}</strong>
                <span>{answerLabels[item.answer]}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {attempts.length > 1 && (
        <details className="diagnostic-attempt-history">
          <summary>Previous attempts ({attempts.length - 1})</summary>
          {attempts.slice(1).map((attempt) => (
            <article key={attempt.id}>
              <strong>
                {new Date(attempt.startedAt).toLocaleString()} ·{' '}
                {attempt.result === 'active' ? 'Incomplete' : attempt.result}
              </strong>
              <p>{diagnosisNote(attempt)}</p>
              <ol>
                {attempt.answers.map((item, index) => (
                  <li key={`${item.step}-${index}`}>
                    {diagnosticStepTitles[item.kind]}: {answerLabels[item.answer]}
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </details>
      )}
    </section>
  );
}

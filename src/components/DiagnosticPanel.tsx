import { useState } from 'react';
import { Check, ArrowRight, ArrowCounterClockwise } from '@phosphor-icons/react';
import {
  answerDiagnosis,
  diagnosisNote,
  diagnosticSteps,
  startDiagnosis,
  type DiagnosticAnswer,
} from '../domain/diagnosis';
import type { Device, Proposal } from '../domain/workspace';
export function DiagnosticPanel({
  device,
  onPropose,
}: {
  device: Device;
  onPropose: (p: Proposal) => void;
}) {
  const [state, setState] = useState<ReturnType<typeof startDiagnosis> | null>(null);
  const [saved, setSaved] = useState(false);
  if (!state)
    return (
      <button className="button secondary full" onClick={() => setState(startDiagnosis(device.id))}>
        Troubleshoot monitor step by step
      </button>
    );
  const step = diagnosticSteps[state.step];
  function answer(value: DiagnosticAnswer) {
    setState((s) => (s ? answerDiagnosis(s, value) : s));
  }
  return (
    <section className="diagnostic-card">
      <span className="eyebrow">USER-GUIDED CHECK · NOT AUTOMATIC DETECTION</span>
      {state.result === 'active' ? (
        <>
          <div className="diagnostic-progress">
            {state.step + 1} / {diagnosticSteps.length}
          </div>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <small>{step.note}</small>
          <div className="diagnostic-actions">
            <button className="button primary" onClick={() => answer('fixed')}>
              <Check size={15} />
              The screen works
            </button>
            <button className="button secondary" onClick={() => answer('not-fixed')}>
              Still no display
              <ArrowRight size={14} />
            </button>
            <button className="text-button" onClick={() => answer('skip')}>
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
          {state.result === 'resolved' &&
            (saved ? (
              <span className="applied-note">
                <Check size={14} />
                Saved as a user-reported test result
              </span>
            ) : (
              <button
                className="button primary"
                onClick={() => {
                  onPropose({
                    type: 'set-status',
                    deviceId: device.id,
                    status: 'reported-working',
                    note: diagnosisNote(state),
                    reason: 'The user checked the result after following the guided steps.',
                  });
                  setSaved(true);
                }}
              >
                Save result as user-reported
              </button>
            ))}
          <button
            className="text-button"
            onClick={() => {
              setState(startDiagnosis(device.id));
              setSaved(false);
            }}
          >
            <ArrowCounterClockwise size={15} />
            Check again
          </button>
        </>
      )}
    </section>
  );
}

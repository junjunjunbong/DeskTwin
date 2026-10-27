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
        모니터 문제 단계별 확인
      </button>
    );
  const step = diagnosticSteps[state.step];
  function answer(value: DiagnosticAnswer) {
    setState((s) => (s ? answerDiagnosis(s, value) : s));
  }
  return (
    <section className="diagnostic-card">
      <span className="eyebrow">USER-GUIDED CHECK · 자동 감지 아님</span>
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
              화면이 나와요
            </button>
            <button className="button secondary" onClick={() => answer('not-fixed')}>
              여전히 안 나와요
              <ArrowRight size={14} />
            </button>
            <button className="text-button" onClick={() => answer('skip')}>
              지금은 확인할 수 없어요
            </button>
          </div>
        </>
      ) : (
        <>
          <h3>
            {state.result === 'resolved' ? '사용자가 동작을 확인했어요' : '추가 확인이 필요해요'}
          </h3>
          <p>{diagnosisNote(state)}</p>
          {state.result === 'resolved' &&
            (saved ? (
              <span className="applied-note">
                <Check size={14} />
                사용자 테스트 결과로 저장됨
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
                    reason: '단계별 안내 후 사용자가 직접 결과를 확인했습니다.',
                  });
                  setSaved(true);
                }}
              >
                확인 결과를 사용자 보고로 저장
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
            다시 확인하기
          </button>
        </>
      )}
    </section>
  );
}

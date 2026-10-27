import { useEffect, useRef } from 'react';
import { Sparkle, X, Check, ArrowRight } from '@phosphor-icons/react';
import type { ChatMessage } from '../domain/useAssistant';
import type { Proposal, Workspace } from '../domain/workspace';
interface Props {
  workspace: Workspace;
  messages: ChatMessage[];
  pending: boolean;
  mode: 'demo' | 'meta';
  decisions: Record<string, 'applied' | 'dismissed'>;
  onApply: (p: Proposal, key: string) => void;
  onDismiss: (key: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
}
export function AssistantPanel({
  workspace,
  messages,
  pending,
  mode,
  decisions,
  onApply,
  onDismiss,
  onSend,
  onClose,
}: Props) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, pending]);
  const deviceName = (id: string) =>
    workspace.devices.find((d) => d.id === id)?.name || '삭제된 기기';
  const title = (p: Proposal) =>
    p.type === 'connect'
      ? `${deviceName(p.from)} ↔ ${deviceName(p.to)} · ${p.connector}`
      : p.type === 'add-device'
        ? `${p.name} 추가`
        : p.type === 'rename-device'
          ? `${deviceName(p.deviceId)} → ${p.name}`
          : `${deviceName(p.deviceId)} · 사용자 상태 보고`;
  return (
    <aside className="floating-panel assistant-panel" aria-label="DeskTwin 대화">
      <div className="panel-heading">
        <div className="device-heading">
          <span className="assistant-glyph">
            <Sparkle size={24} weight="fill" />
          </span>
          <div>
            <h2>DeskTwin Assistant</h2>
            <small className="muted">
              {mode === 'demo' ? '로컬 데모 · LLM 미연결' : 'Meta AI · 서버 연결'}
            </small>
          </div>
        </div>
        <button className="icon-button" aria-label="대화 닫기" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="conversation panel-scroll" aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant-intro">
            <span className="eyebrow">A LITTLE CONTEXT GOES A LONG WAY</span>
            <h3>
              내 책상을,
              <br />
              함께 이해해요.
            </h3>
            <p>
              사진에는 배치를 맡기고,
              <br />
              연결은 직접 알려주세요.
            </p>
            <button
              className="example-prompt"
              onClick={() => onSend('오른쪽 모니터를 Dock에 HDMI로 연결했어')}
            >
              오른쪽 모니터를 Dock에 HDMI로 연결했어
              <ArrowRight size={17} />
            </button>
            <button className="example-prompt" onClick={() => onSend('오른쪽 모니터가 안 나와')}>
              오른쪽 모니터가 안 나와
              <ArrowRight size={17} />
            </button>
            <p className="micro-note">
              AI 제안은 확인 후에만 반영합니다.
              <br />
              기기 조작이나 시스템 변경은 수행하지 않습니다.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-message ${m.role}`}>
            <div className="message-author">
              {m.role === 'user'
                ? '나'
                : m.mode === 'meta'
                  ? 'DeskTwin · Meta'
                  : 'DeskTwin · 로컬 데모'}
            </div>
            <p>{m.content}</p>
            {m.proposals.map((p, i) => {
              const key = `${m.id}:${i}`;
              return (
                <div className="proposal-card" key={key}>
                  <strong>{title(p)}</strong>
                  <p>{p.reason}</p>
                  {decisions[key] ? (
                    <span className="applied-note">
                      <Check size={14} />
                      {decisions[key] === 'applied' ? '확인 후 반영됨' : '반영하지 않음'}
                    </span>
                  ) : (
                    <div className="proposal-actions">
                      <button className="button primary" onClick={() => onApply(p, key)}>
                        확인하고 반영
                      </button>
                      <button className="text-button" onClick={() => onDismiss(key)}>
                        취소
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {pending && (
          <div className="assistant-pending" role="status">
            <span className="loading-dot" />
            구성을 살펴보고 있어요.
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="panel-footnote">
        {mode === 'demo'
          ? '로컬 데모는 외부 API로 데이터를 전송하지 않습니다.'
          : '전송한 대화와 기기 구성을 Meta 모델이 처리합니다.'}
      </div>
    </aside>
  );
}

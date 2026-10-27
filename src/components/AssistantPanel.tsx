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
    workspace.devices.find((d) => d.id === id)?.name || 'Deleted device';
  const title = (p: Proposal) =>
    p.type === 'connect'
      ? `${deviceName(p.from)} ↔ ${deviceName(p.to)} · ${p.connector}`
      : p.type === 'add-device'
        ? `Add ${p.name}`
        : p.type === 'rename-device'
          ? `${deviceName(p.deviceId)} → ${p.name}`
          : `${deviceName(p.deviceId)} · user-reported status`;
  return (
    <aside className="floating-panel assistant-panel" aria-label="DeskTwin conversation">
      <div className="panel-heading">
        <div className="device-heading">
          <span className="assistant-glyph">
            <Sparkle size={24} weight="fill" />
          </span>
          <div>
            <h2>DeskTwin Assistant</h2>
            <small className="muted">
              {mode === 'demo' ? 'Local demo · no LLM connected' : 'Meta AI · server connected'}
            </small>
          </div>
        </div>
        <button className="icon-button" aria-label="Close conversation" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="conversation panel-scroll" aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant-intro">
            <span className="eyebrow">A LITTLE CONTEXT GOES A LONG WAY</span>
            <h3>
              Understand your desk,
              <br />
              together.
            </h3>
            <p>
              Start with a photo,
              <br />
              then tell us about your connections.
            </p>
            <button
              className="example-prompt"
              onClick={() => onSend('I connected the right monitor to the dock with HDMI')}
            >
              I connected the right monitor to the dock with HDMI
              <ArrowRight size={17} />
            </button>
            <button
              className="example-prompt"
              onClick={() => onSend('The right monitor is not displaying')}
            >
              The right monitor is not displaying
              <ArrowRight size={17} />
            </button>
            <p className="micro-note">
              AI suggestions are applied only after your confirmation.
              <br />
              DeskTwin does not control devices or change system settings.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`chat-message ${m.role}`}>
            <div className="message-author">
              {m.role === 'user'
                ? 'You'
                : m.mode === 'meta'
                  ? 'DeskTwin · Meta'
                  : 'DeskTwin · local demo'}
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
                      {decisions[key] === 'applied' ? 'Applied after confirmation' : 'Dismissed'}
                    </span>
                  ) : (
                    <div className="proposal-actions">
                      <button className="button primary" onClick={() => onApply(p, key)}>
                        Confirm and apply
                      </button>
                      <button className="text-button" onClick={() => onDismiss(key)}>
                        Cancel
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
            Reviewing your setup.
          </div>
        )}
        <div ref={end} />
      </div>
      <div className="panel-footnote">
        {mode === 'demo'
          ? 'The local demo does not send data to an external API.'
          : 'Your submitted conversation and device setup are processed by a Meta model.'}
      </div>
    </aside>
  );
}

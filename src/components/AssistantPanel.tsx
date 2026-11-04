import { useEffect, useRef, useState } from 'react';
import { Sparkle, X, Check, ArrowRight } from '@phosphor-icons/react';
import type { ChatMessage } from '../domain/useAssistant';
import {
  assistantSceneFocus,
  assistantTargetIsLocalOnly,
  type AssistantSceneFocus,
} from '../domain/assistantContext';
import '../styles/assistantContext.css';
import { statusLabels, type Connection, type Proposal, type Workspace } from '../domain/workspace';

const focusedReplyIds = new Set<string>();
interface Props {
  workspace: Workspace;
  messages: ChatMessage[];
  pending: boolean;
  mode: 'demo' | 'meta';
  decisions: Record<string, 'applied' | 'dismissed'>;
  onApply: (
    p: Proposal,
    key: string,
    options?: { expectedConnection?: Connection | null },
  ) => unknown;
  targetDeviceId?: string | null;
  onTargetChange?: (id: string | null) => void;
  onFocusPath?: (focus: AssistantSceneFocus) => void;
  onDismiss: (key: string) => void;
  onSend: (text: string) => void;
  onClose: () => void;
  editing: boolean;
  onEditConnections: () => void;
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
  editing,
  onEditConnections,
  targetDeviceId = null,
  onTargetChange,
  onFocusPath,
}: Props) {
  const end = useRef<HTMLDivElement>(null);
  const [replacementReviews, setReplacementReviews] = useState<Record<string, Connection>>({});
  const [applying, setApplying] = useState<string | null>(null);
  const [applyError, setApplyError] = useState('');
  const applyingRef = useRef(false);
  const target = workspace.devices.find((device) => device.id === targetDeviceId);
  // Suggestions are questions, not observations. Keep labels out of generated messages:
  // the selected target is transferred separately only after its privacy checks pass.
  const connectionExample = target
    ? 'Help me review the recorded connections for this device.'
    : 'Help me review the recorded connections on my desk.';
  const monitorExample = target
    ? 'What should I check next for this device?'
    : 'Help me choose a device and a safe check.';
  const targetFocus = assistantSceneFocus(workspace, target?.id);
  const localOnly = assistantTargetIsLocalOnly(workspace, target?.id ?? null);
  async function apply(p: Proposal, key: string, expectedConnection: Connection | null) {
    if (applyingRef.current) return;
    applyingRef.current = true;
    setApplying(key);
    setApplyError('');
    try {
      const accepted = await onApply(
        p,
        key,
        p.type === 'connect' ? { expectedConnection } : undefined,
      );
      if (accepted === false)
        setApplyError('The proposal was not saved. Review the current record and try again.');
    } catch {
      setApplyError('The proposal was not saved. Review the current record and try again.');
    } finally {
      applyingRef.current = false;
      setApplying(null);
    }
  }
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, pending]);
  useEffect(() => {
    const latest = messages.at(-1);
    if (!latest || latest.role !== 'assistant' || !latest.focusDeviceId) return;
    if (focusedReplyIds.has(latest.id)) return;
    focusedReplyIds.add(latest.id);
    const focus = assistantSceneFocus(workspace, latest.focusDeviceId);
    if (focus) onFocusPath?.(focus);
  }, [messages, workspace, onFocusPath]);
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
        <section className="assistant-target" aria-label="Conversation context">
          <label>
            Conversation target
            <select
              aria-label="Conversation target"
              value={target?.id ?? ''}
              disabled={pending || !onTargetChange}
              onChange={(event) => onTargetChange?.(event.target.value || null)}
            >
              <option value="">Whole desk</option>
              {workspace.devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                  {assistantTargetIsLocalOnly(workspace, device.id) ? ' · local only' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="micro-note">
            {target
              ? `Questions about “this device” refer to ${target.name}.`
              : 'Choose a device to keep its recorded connections and checks in the conversation.'}
          </p>
          {localOnly && mode === 'meta' && (
            <p className="form-error" role="status">
              This target comes from Mac observations and stays local. Switch to the local demo or
              choose another target before sending.
            </p>
          )}
          {targetFocus && onFocusPath && (
            <button className="text-button" onClick={() => onFocusPath(targetFocus)}>
              Show target and recorded path
            </button>
          )}
          {targetFocus && <small>Recorded links are not proof of a working signal path.</small>}
        </section>
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
            <button className="example-prompt" onClick={() => onSend(connectionExample)}>
              {connectionExample}
              <ArrowRight size={17} />
            </button>
            <button className="example-prompt" onClick={() => onSend(monitorExample)}>
              {monitorExample}
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
                : m.kind === 'notice'
                  ? 'DeskTwin · local notice'
                  : m.mode === 'meta'
                    ? 'DeskTwin · Meta'
                    : 'DeskTwin · local demo'}
            </div>
            {m.focusDeviceId && (
              <small className="message-target">
                Conversation target: {deviceName(m.focusDeviceId)}
              </small>
            )}
            <p>{m.content}</p>
            {m.role === 'assistant' &&
              m.focusDeviceId &&
              onFocusPath &&
              assistantSceneFocus(workspace, m.focusDeviceId) && (
                <button
                  className="text-button"
                  onClick={() => {
                    const focus = assistantSceneFocus(workspace, m.focusDeviceId);
                    if (focus) onFocusPath(focus);
                  }}
                >
                  Show current recorded path for {deviceName(m.focusDeviceId)}
                </button>
              )}
            {m.proposals.map((p, i) => {
              const key = `${m.id}:${i}`;
              const existing =
                p.type === 'connect'
                  ? (workspace.connections.find(
                      (connection) =>
                        (connection.from === p.from && connection.to === p.to) ||
                        (connection.from === p.to && connection.to === p.from),
                    ) ?? null)
                  : null;
              const reviewed = replacementReviews[key];
              const replacementConfirmed =
                !!existing && !!reviewed && JSON.stringify(reviewed) === JSON.stringify(existing);
              return (
                <div className="proposal-card" key={key}>
                  <strong>{title(p)}</strong>
                  <p>{p.reason}</p>
                  {p.type === 'set-status' && (
                    <dl className="record-facts" aria-label="Proposed status details">
                      <div>
                        <dt>Proposed operating status</dt>
                        <dd>{statusLabels[p.status]}</dd>
                      </div>
                      <div>
                        <dt>User-reported note</dt>
                        <dd>{p.note || 'No note'}</dd>
                      </div>
                    </dl>
                  )}
                  {existing && !decisions[key] && (
                    <div className="connection-replacement-review" role="note">
                      <strong>Replace an existing connection</strong>
                      <p>
                        Saved: {deviceName(existing.from)} ↔ {deviceName(existing.to)} ·{' '}
                        {existing.connector}.
                        {existing.fromPort && ` First port: ${existing.fromPort}.`}
                        {existing.toPort && ` Second port: ${existing.toPort}.`}
                      </p>
                      <p>
                        Only one connection per device pair is stored. Replacing it removes the
                        saved port details.
                      </p>
                      {editing && (
                        <label className="replacement-confirmation">
                          <input
                            type="checkbox"
                            checked={replacementConfirmed}
                            onChange={(event) => {
                              if (event.target.checked)
                                setReplacementReviews((reviews) => ({
                                  ...reviews,
                                  [key]: structuredClone(existing),
                                }));
                              else
                                setReplacementReviews((reviews) => {
                                  const next = { ...reviews };
                                  delete next[key];
                                  return next;
                                });
                            }}
                          />
                          I reviewed the saved connection and want to replace it.
                        </label>
                      )}
                    </div>
                  )}
                  {decisions[key] ? (
                    <span className="applied-note">
                      <Check size={14} />
                      {decisions[key] === 'applied' ? 'Applied after confirmation' : 'Dismissed'}
                    </span>
                  ) : (
                    <div className="proposal-actions">
                      {p.type === 'connect' && !editing ? (
                        <button className="button secondary" onClick={onEditConnections}>
                          Edit to review connection
                        </button>
                      ) : (
                        <button
                          className="button primary"
                          disabled={applying !== null || (!!existing && !replacementConfirmed)}
                          onClick={() => void apply(p, key, existing ? reviewed : null)}
                        >
                          {applying === key
                            ? 'Saving proposal...'
                            : existing
                              ? 'Confirm replacement'
                              : 'Confirm and apply'}
                        </button>
                      )}
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
      {applyError && (
        <p role="alert" className="form-error">
          {applyError}
        </p>
      )}
      <div className="panel-footnote">
        {mode === 'demo'
          ? 'The local demo does not send data to an external API.'
          : 'Meta receives your submitted conversation and eligible records. Mac-only records stay local.'}
      </div>
    </aside>
  );
}

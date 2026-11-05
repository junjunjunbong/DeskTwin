import { useRef, useState } from 'react';
import { ArrowRight, Camera, Check, Plus, X } from '@phosphor-icons/react';
import {
  setupConnectionCommand,
  setupConnectionForPair,
  setupConnectionQuestions,
  setupSuggestionsFromNotes,
  type SetupConnectionDraft,
} from '../domain/deskSetup';
import type { HardwareController } from '../domain/useHardware';
import {
  ConnectorSchema,
  sourceLabels,
  type Connection,
  type Device,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
import { HardwareBadge, HardwareSummary } from './HardwarePanel';
import '../styles/deskSetup.css';

export interface DeskSetupPanelProps {
  workspace: Workspace;
  hardware: HardwareController;
  editing: boolean;
  onEditConnections: () => void;
  onCommand: (command: WorkspaceCommand) => Promise<boolean>;
  onPhoto: () => void;
  onAddDevice: () => void;
  onOpenMacHardware: () => void;
  onSelect: (id: string) => void;
  onAskAssistant: (id: string) => void;
  onClose: () => void;
  photoContext?: string;
  initialStep?: 0 | 1 | 2;
  onConnectionSaved?: (from: string, to: string) => void;
}

type ConnectionReview = { draft: SetupConnectionDraft; previous: Connection | null };

function operationLabel(status: Device['status']) {
  return status === 'reported-working'
    ? 'User reports working'
    : status === 'reported-issue'
      ? 'User reports an issue'
      : 'Not checked';
}

function emptyDraft(from = ''): SetupConnectionDraft {
  return {
    from,
    to: '',
    connector: 'Unknown',
    fromPort: '',
    toPort: '',
    note: 'The user reviewed and confirmed this connection during desk setup.',
  };
}

export function DeskSetupPanel({
  workspace,
  hardware,
  editing,
  onEditConnections,
  onCommand,
  onPhoto,
  onAddDevice,
  onOpenMacHardware,
  onSelect,
  onAskAssistant,
  onClose,
  photoContext = '',
  initialStep = 0,
  onConnectionSaved,
}: DeskSetupPanelProps) {
  const [step, setStep] = useState<0 | 1 | 2>(initialStep);
  const questions = setupConnectionQuestions(workspace);
  const [draft, setDraft] = useState<SetupConnectionDraft>(() =>
    emptyDraft(questions[0]?.deviceId ?? workspace.devices[0]?.id),
  );
  const [review, setReview] = useState<ConnectionReview | null>(null);
  const [portsOpen, setPortsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const snapshot = hardware.snapshot;
  const samples = workspace.devices.filter((device) => device.source === 'demo');
  const suggestions = setupSuggestionsFromNotes(photoContext, workspace);
  const name = (id: string) =>
    workspace.devices.find((device) => device.id === id)?.name ?? 'Removed device';
  const countStatus = (status: Device['status']) =>
    workspace.devices.filter((device) => device.status === status).length;
  const counts = {
    working: countStatus('reported-working'),
    issues: countStatus('reported-issue'),
    unknown: countStatus('unknown'),
  };
  /** Devices with a reported problem first, then the rest in desk order. */
  const troubleRank = (device: Device) => (device.status === 'reported-issue' ? 0 : 1);
  const troubleOrder = workspace.devices
    .map((device, index) => ({ device, index }))
    .sort((a, b) => troubleRank(a.device) - troubleRank(b.device) || a.index - b.index)
    .map(({ device }) => device);
  const validConnection =
    draft.from !== draft.to &&
    [draft.from, draft.to].every((id) => workspace.devices.some((device) => device.id === id));

  function editDraft(patch: Partial<SetupConnectionDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setReview(null);
    setError('');
    setMessage('');
  }
  function startDraft(next: SetupConnectionDraft) {
    setDraft(next);
    setPortsOpen(!!(next.fromPort || next.toPort));
    setReview(null);
    setError('');
    setMessage('');
    if (!editing) onEditConnections();
  }
  function saveDraft(saved: SetupConnectionDraft, previous: Connection | null) {
    return saveCommand(
      () => setupConnectionCommand(workspace, saved, previous),
      () => {
        setReview(null);
        setDraft(emptyDraft());
        setPortsOpen(false);
        onConnectionSaved?.(saved.from, saved.to);
      },
      'Connection saved as your report. Working status is unchanged.',
    );
  }
  /** New pairs save directly; replacing an existing record still needs a second confirmation. */
  function submitConnection() {
    if (!validConnection || !editing) return;
    const snapshot = structuredClone(draft);
    const previous = structuredClone(
      setupConnectionForPair(workspace, draft.from, draft.to) ?? null,
    );
    if (previous) setReview({ draft: snapshot, previous });
    else void saveDraft(snapshot, null);
  }
  async function saveCommand(build: () => WorkspaceCommand, after: () => void, success: string) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      if (await onCommand(build())) {
        after();
        setMessage(success);
      } else
        setError(
          'This change was not saved. Your review is kept; check the workspace notice before trying again.',
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.split('\n')[0]
          : 'The change could not be saved. Review it again.',
      );
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <aside className="floating-panel desk-setup-panel" aria-label="Hardware panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">DEVICES AND CONNECTIONS</span>
          <h2>Hardware</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close hardware"
          disabled={saving}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <nav className="desk-setup-steps" aria-label="Hardware sections">
        {(['Devices', 'Connections', 'Fix a problem'] as const).map((label, index) => (
          <button
            key={label}
            aria-current={step === index ? 'step' : undefined}
            disabled={saving}
            onClick={() => {
              setStep(index as 0 | 1 | 2);
              setError('');
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="panel-scroll">
        {message && (
          <p className="applied-note" role="status">
            <Check size={16} />
            {message}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {step === 0 && (
          <>
            <section className="desk-setup-device-list" aria-label="Device evidence review">
              <div className="desk-setup-list-head">
                <h3>Your devices ({workspace.devices.length})</h3>
                <small>
                  {counts.working} reported working · {counts.issues} reported issues ·{' '}
                  {counts.unknown} not checked
                </small>
              </div>
              {samples.length > 0 && (
                <p className="desk-setup-note" role="note">
                  {samples.length === workspace.devices.length
                    ? 'These are sample devices, not your hardware.'
                    : `${samples.length} sample ${samples.length === 1 ? 'device is' : 'devices are'} still shown.`}{' '}
                  Build from a desk photo to replace them.
                </p>
              )}
              {workspace.devices.map((device) => (
                <button
                  key={device.id}
                  className="desk-setup-device-row"
                  aria-label={`Review device ${device.name}`}
                  onClick={() => onSelect(device.id)}
                >
                  <span className={`status-dot ${device.status}`} aria-hidden="true" />
                  <span className="desk-setup-device-text">
                    <strong>{device.name}</strong>
                    <small>
                      {sourceLabels[device.source]} · {operationLabel(device.status)}
                    </small>
                  </span>
                  {(snapshot.state === 'running' || device.hardwareBinding) && (
                    <HardwareBadge device={device} snapshot={snapshot} />
                  )}
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              ))}
              {!workspace.devices.length && (
                <p className="empty-copy">No devices yet. Add one or build from a desk photo.</p>
              )}
              <div className="desk-setup-actions">
                <button
                  className="button secondary"
                  disabled={workspace.devices.length >= 40}
                  onClick={onAddDevice}
                >
                  <Plus size={16} />
                  Add a device
                </button>
                <button className="button secondary" onClick={onPhoto}>
                  <Camera size={16} />
                  Use a photo
                </button>
              </div>
            </section>
            <HardwareSummary
              hardware={hardware}
              workspace={workspace}
              onOpen={onOpenMacHardware}
              onSelect={onSelect}
            />
            <button
              className="button primary full"
              disabled={workspace.devices.length < 2}
              onClick={() => setStep(1)}
            >
              Continue to connections
              <ArrowRight size={16} />
            </button>
            {workspace.devices.length === 1 && (
              <p className="micro-note">Add the computer or dock it connects to.</p>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <h3>What connects to what</h3>
            <p className="muted">
              Pick a device and what it plugs into. Choose Unknown if you have not checked the
              cable.
            </p>
            <section className="desk-setup-records" aria-label="Recorded connections">
              <h4>Recorded connections ({workspace.connections.length})</h4>
              {workspace.connections.map((edge) => (
                <div className="desk-setup-edge" key={edge.id}>
                  <span>
                    <strong>
                      {name(edge.from)} → {name(edge.to)}
                    </strong>
                    <small>
                      {edge.connector} · {sourceLabels[edge.source]}
                    </small>
                  </span>
                  <button
                    className="text-button"
                    disabled={saving}
                    aria-label={`Change ${name(edge.from)} to ${name(edge.to)}`}
                    onClick={() => {
                      startDraft({
                        from: edge.from,
                        to: edge.to,
                        connector: edge.connector,
                        fromPort: edge.fromPort,
                        toPort: edge.toPort,
                        note: 'The user reviewed and confirmed this connection during desk setup.',
                      });
                    }}
                  >
                    Change
                  </button>
                </div>
              ))}
              {!workspace.connections.length && (
                <p className="micro-note">None yet. Unknown connections can stay unanswered.</p>
              )}
            </section>
            {photoContext && (
              <details className="desk-setup-notes" open>
                <summary>Your photo setup notes</summary>
                <p>{photoContext}</p>
                <small>
                  Kept only in this open app. The photo did not verify these connections.
                </small>
                {suggestions.length > 0 && (
                  <div className="desk-setup-suggestions">
                    {suggestions.map((suggestion) => (
                      <button
                        key={`${suggestion.from}:${suggestion.to}`}
                        className="button secondary full"
                        onClick={() => startDraft(suggestion)}
                      >
                        Review: {name(suggestion.from)} → {name(suggestion.to)} ·{' '}
                        {suggestion.connector}
                      </button>
                    ))}
                  </div>
                )}
                {suggestions.length === 0 && (
                  <p className="micro-note">
                    Select the two devices below to turn a connection you described into a record.
                  </p>
                )}
              </details>
            )}
            {questions.length > 0 && (
              <section className="desk-setup-questions" aria-label="Missing connection questions">
                <h4>Not recorded yet</h4>
                <div className="desk-setup-chips">
                  {questions.map((question) => (
                    <button
                      key={question.deviceId}
                      className={editing && draft.from === question.deviceId ? 'active' : ''}
                      disabled={saving}
                      onClick={() => startDraft(emptyDraft(question.deviceId))}
                      aria-label={`Record connection for ${name(question.deviceId)}`}
                      title={question.text}
                    >
                      {name(question.deviceId)}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {!editing ? (
              <button className="button primary full" onClick={onEditConnections}>
                <Plus size={16} />
                Edit connections
              </button>
            ) : (
              <form
                className="desk-setup-connection-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitConnection();
                }}
              >
                <label>
                  Device
                  <select
                    aria-label="Setup first device"
                    value={draft.from}
                    disabled={saving}
                    onChange={(event) => editDraft({ from: event.target.value })}
                  >
                    <option value="">Choose a device</option>
                    {workspace.devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Connected to
                  <select
                    aria-label="Setup connected device"
                    value={draft.to}
                    disabled={saving}
                    onChange={(event) => editDraft({ to: event.target.value })}
                  >
                    <option value="">Choose the connected device</option>
                    {workspace.devices
                      .filter((device) => device.id !== draft.from)
                      .map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Cable or connection type
                  <select
                    aria-label="Setup connector"
                    value={draft.connector}
                    disabled={saving}
                    onChange={(event) =>
                      editDraft({ connector: event.target.value as Connection['connector'] })
                    }
                  >
                    {ConnectorSchema.options.map((connector) => (
                      <option key={connector} value={connector}>
                        {connector === 'Unknown' ? 'Unknown — I have not checked' : connector}
                      </option>
                    ))}
                  </select>
                </label>
                <details
                  className="desk-setup-ports"
                  open={portsOpen}
                  onToggle={(event) => setPortsOpen(event.currentTarget.open)}
                >
                  <summary>
                    Port names <span className="muted">optional</span>
                  </summary>
                  <div className="two-columns">
                    <label>
                      First device port
                      <input
                        aria-label="Setup first port"
                        value={draft.fromPort}
                        maxLength={40}
                        disabled={saving}
                        onChange={(event) => editDraft({ fromPort: event.target.value })}
                      />
                    </label>
                    <label>
                      Other device port
                      <input
                        aria-label="Setup other port"
                        value={draft.toPort}
                        maxLength={40}
                        disabled={saving}
                        onChange={(event) => editDraft({ toPort: event.target.value })}
                      />
                    </label>
                  </div>
                </details>
                {!review && (
                  <>
                    <button
                      className="button primary full"
                      type="submit"
                      disabled={!validConnection || saving}
                    >
                      {saving ? 'Saving connection...' : 'Save connection'}
                    </button>
                    <p className="micro-note">
                      Saved as your report. It does not prove the link works.
                    </p>
                  </>
                )}
              </form>
            )}
            {review && editing && (
              <div
                className="desk-setup-confirm"
                role="region"
                aria-label="Confirm setup connection"
              >
                <h4>Replace the existing connection?</h4>
                <p>
                  Now: {name(review.previous!.from)} → {name(review.previous!.to)} ·{' '}
                  {review.previous!.connector}
                </p>
                <p>
                  New: {name(review.draft.from)} → {name(review.draft.to)} ·{' '}
                  {review.draft.connector}
                </p>
                <p className="micro-note">One connection per device pair is supported.</p>
                <button
                  className="button primary full"
                  disabled={saving}
                  onClick={() => void saveDraft(review.draft, review.previous)}
                >
                  {saving ? 'Saving connection...' : 'Confirm replacement'}
                </button>
                <button className="text-button" disabled={saving} onClick={() => setReview(null)}>
                  Cancel connection
                </button>
              </div>
            )}
            <button className="button secondary full" disabled={saving} onClick={() => setStep(2)}>
              Continue to Fix a problem
              <ArrowRight size={16} />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h3>What isn&rsquo;t working?</h3>
            <p className="muted">
              Pick the device. AI chat opens with a question about it and uses your recorded
              connections. Nothing is sent until you press Send.
            </p>
            <div className="desk-setup-checks">
              {troubleOrder.map((device) => (
                <button
                  className="button secondary full"
                  key={device.id}
                  onClick={() => onAskAssistant(device.id)}
                >
                  <span>
                    {device.name}
                    <small>
                      {sourceLabels[device.source]} · {operationLabel(device.status)}
                    </small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
            {!workspace.devices.length && (
              <>
                <p className="empty-copy">No devices yet. Add the device that has a problem.</p>
                <button className="button secondary full" onClick={onAddDevice}>
                  Add a device
                </button>
              </>
            )}
            <button className="text-button" onClick={() => setStep(1)}>
              Back to connections
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

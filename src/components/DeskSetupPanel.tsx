import { useRef, useState } from 'react';
import { ArrowRight, Check, Cpu, Image as ImageIcon, Link, Plus, X } from '@phosphor-icons/react';
import {
  setupConnectionCommand,
  setupConnectionForPair,
  setupConnectionQuestions,
  setupSuggestionFromNotes,
  type SetupConnectionDraft,
} from '../domain/deskSetup';
import { hardwareMatchCommand, linkedDevice } from '../domain/hardwareState';
import { type HardwareBinding, type HardwareDevice } from '../domain/hardware';
import type { HardwareController } from '../domain/useHardware';
import {
  ConnectorSchema,
  sourceLabels,
  type Connection,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
import { HardwareBadge } from './HardwarePanel';
import '../styles/deskSetup.css';

export interface DeskSetupPanelProps {
  workspace: Workspace;
  hardware: HardwareController;
  editing: boolean;
  onEditConnections: () => void;
  onCommand: (command: WorkspaceCommand) => Promise<boolean>;
  onPhoto: () => void;
  onAddDevice: () => void;
  onSelect: (id: string) => void;
  onTroubleshoot: (id: string) => void;
  onClose: () => void;
  photoContext?: string;
}

type ConnectionReview = { draft: SetupConnectionDraft; previous: Connection | null };
type MatchReview = {
  deviceId: string;
  observation: HardwareDevice;
  previous: HardwareBinding | null;
};

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
  onSelect,
  onTroubleshoot,
  onClose,
  photoContext = '',
}: DeskSetupPanelProps) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const questions = setupConnectionQuestions(workspace);
  const [draft, setDraft] = useState<SetupConnectionDraft>(() =>
    emptyDraft(questions[0]?.deviceId ?? workspace.devices[0]?.id),
  );
  const [review, setReview] = useState<ConnectionReview | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [matchTargetId, setMatchTargetId] = useState('');
  const [observationId, setObservationId] = useState('');
  const [matchReview, setMatchReview] = useState<MatchReview | null>(null);
  const pending = useRef(false);
  const snapshot = hardware.snapshot;
  const confirmed = workspace.connections.filter((edge) => edge.source === 'user-reported');
  const samples = workspace.devices.filter((device) => device.source === 'demo');
  const suggested = setupSuggestionFromNotes(photoContext, workspace);
  const name = (id: string) =>
    workspace.devices.find((device) => device.id === id)?.name ?? 'Removed device';
  const matchTarget = workspace.devices.find((device) => device.id === matchTargetId);
  const observation =
    snapshot.state === 'running'
      ? snapshot.devices.find(
          (item) => item.id === observationId && snapshot.categories[item.category].state === 'ok',
        )
      : undefined;
  const validConnection =
    draft.from !== draft.to &&
    [draft.from, draft.to].every((id) => workspace.devices.some((device) => device.id === id));

  function editDraft(patch: Partial<SetupConnectionDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
    setReview(null);
    setError('');
    setMessage('');
  }
  function reviewConnection() {
    if (!validConnection || !editing) return;
    setReview({
      draft: structuredClone(draft),
      previous: structuredClone(setupConnectionForPair(workspace, draft.from, draft.to) ?? null),
    });
    setError('');
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
    <aside className="floating-panel desk-setup-panel" aria-label="Desk setup panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">FROM A PHOTO TO A USEFUL DESK</span>
          <h2>Set up your desk</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close desk setup"
          disabled={saving}
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <nav className="desk-setup-steps" aria-label="Desk setup steps">
        {(['1. Devices', '2. Connections', '3. Try a check'] as const).map((label, index) => (
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
            <h3>Start with the devices you can identify</h3>
            <p className="muted">
              Use a photo or add devices yourself. Then compare each desk record with what you know.
              A visual match, an OS observation and a working device are separate claims.
            </p>
            <div className="desk-setup-actions">
              <button className="button secondary" onClick={onPhoto}>
                <ImageIcon size={17} />
                Use a desk photo
              </button>
              <button
                className="button secondary"
                disabled={workspace.devices.length >= 40}
                onClick={onAddDevice}
              >
                <Plus size={17} />
                Add a device
              </button>
            </div>
            {samples.length > 0 && (
              <p className="desk-setup-note" role="note">
                {samples.length} sample {samples.length === 1 ? 'device is' : 'devices are'} still
                shown. Samples do not describe your hardware. Replace them through the photo flow or
                review your own records before making connections.
              </p>
            )}
            <details className="desk-setup-local">
              <summary>
                <Cpu size={16} />
                Compare with this Mac <span>optional · local only</span>
              </summary>
              <p>
                Read display names and OS flags, USB product/vendor details and USB registry
                hierarchy. Identifiers are minimized locally. No screen capture, device control or
                settings changes.
              </p>
              <p className="micro-note">
                Nothing is sent to Meta. Detection does not change your desk until you approve a
                match. It refreshes about every 5 seconds while active. OS recognition does not
                verify feature operation or a cable route.
              </p>
              {hardware.enabled ? (
                <button className="button secondary full" onClick={() => void hardware.stop()}>
                  Stop local detection
                </button>
              ) : (
                <>
                  <label className="desk-setup-check">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => setConsent(event.target.checked)}
                    />
                    I agree to read this Mac’s hardware metadata locally.
                  </label>
                  <button
                    className="button secondary full"
                    disabled={!consent || hardware.busy || hardware.session?.available === false}
                    onClick={() => void hardware.start()}
                  >
                    {hardware.busy ? 'Starting local detection...' : 'Start local detection'}
                  </button>
                  <button
                    className="text-button"
                    disabled={hardware.busy}
                    onClick={() => void hardware.refreshAvailability()}
                  >
                    Check bridge availability
                  </button>
                </>
              )}
              <p role="status">
                {hardware.error ||
                  (hardware.session?.available === false && hardware.session.message) ||
                  snapshot.message}
              </p>
              <small>Bluetooth live detection is unavailable.</small>
            </details>
            <div className="desk-setup-devices" aria-label="Device evidence review">
              {workspace.devices.map((device) => (
                <article key={device.id} className="desk-setup-device">
                  <div className="desk-setup-device-title">
                    <strong>{device.name}</strong>
                    <button
                      className="text-button"
                      onClick={() => onSelect(device.id)}
                      aria-label={`Review device ${device.name}`}
                    >
                      Review
                    </button>
                  </div>
                  <dl>
                    <div>
                      <dt>Record</dt>
                      <dd>{sourceLabels[device.source]}</dd>
                    </div>
                    <div>
                      <dt>Appearance</dt>
                      <dd>{sourceLabels[device.visual.source]}</dd>
                    </div>
                    <div>
                      <dt>Operation</dt>
                      <dd>
                        {device.status === 'reported-working'
                          ? 'User reports working'
                          : device.status === 'reported-issue'
                            ? 'User reports an issue'
                            : 'Not checked'}
                      </dd>
                    </div>
                  </dl>
                  {device.statusNote && (
                    <p className="micro-note">User note: {device.statusNote}</p>
                  )}
                  <HardwareBadge device={device} snapshot={snapshot} />
                  <button
                    className="text-button"
                    onClick={() => {
                      setMatchTargetId(device.id);
                      setObservationId('');
                      setMatchReview(null);
                      setError('');
                    }}
                  >
                    <Link size={14} />
                    {device.hardwareBinding ? 'Review local match' : 'Match local observation'}
                  </button>
                  {matchTargetId === device.id && (
                    <div
                      className="desk-setup-match"
                      aria-label={`Match OS observation to ${device.name}`}
                    >
                      <p className="micro-note">
                        Choose the observation that you recognize as this device. Names alone are
                        not a match.
                      </p>
                      {snapshot.state !== 'running' ? (
                        <p className="micro-note">
                          Open “Compare with this Mac” above and start detection with your consent,
                          or continue without OS matching.
                        </p>
                      ) : (
                        <>
                          <label>
                            Local observation
                            <select
                              aria-label={`Local observation for ${device.name}`}
                              value={observationId}
                              disabled={saving}
                              onChange={(event) => {
                                setObservationId(event.target.value);
                                setMatchReview(null);
                                setError('');
                              }}
                            >
                              <option value="">Choose an observation</option>
                              {snapshot.devices
                                .filter((item) => snapshot.categories[item.category].state === 'ok')
                                .map((item) => {
                                  const linked = linkedDevice(workspace, item);
                                  return (
                                    <option
                                      key={item.id}
                                      value={item.id}
                                      disabled={!!linked && linked.id !== device.id}
                                    >
                                      {item.name} · {item.category}
                                      {linked ? ` · matched to ${linked.name}` : ''}
                                    </option>
                                  );
                                })}
                            </select>
                          </label>
                          {observation && (
                            <p className="micro-note">
                              {observation.source} · OS reports {observation.status}.{' '}
                              {observation.identity.stability === 'session'
                                ? 'This identity is session-only; another detection session needs a new match.'
                                : 'This identity is local to this installation.'}
                            </p>
                          )}
                          {!matchReview ? (
                            <button
                              className="button secondary full"
                              disabled={!observation || saving}
                              onClick={() => {
                                if (observation && matchTarget)
                                  setMatchReview({
                                    deviceId: matchTarget.id,
                                    observation: structuredClone(observation),
                                    previous: structuredClone(matchTarget.hardwareBinding ?? null),
                                  });
                              }}
                            >
                              Review this OS match
                            </button>
                          ) : (
                            <div
                              className="inline-confirm"
                              role="region"
                              aria-label="Confirm setup OS match"
                            >
                              <p>
                                Match “{matchReview.observation.name}” to “
                                {name(matchReview.deviceId)}”?
                                {matchReview.previous
                                  ? ' This replaces the previous local match.'
                                  : ''}{' '}
                                The device name, reported status and cable records stay unchanged.
                              </p>
                              <button
                                className="button primary"
                                disabled={saving || !observation}
                                onClick={() =>
                                  void saveCommand(
                                    () => {
                                      const current = workspace.devices.find(
                                        (item) => item.id === matchReview.deviceId,
                                      );
                                      if (
                                        !current ||
                                        JSON.stringify(current.hardwareBinding ?? null) !==
                                          JSON.stringify(matchReview.previous)
                                      )
                                        throw new Error(
                                          'The local match changed after your review. Choose and review it again.',
                                        );
                                      return hardwareMatchCommand(
                                        workspace,
                                        snapshot,
                                        matchReview.observation,
                                        { existingId: matchReview.deviceId },
                                      );
                                    },
                                    () => {
                                      setMatchReview(null);
                                      setMatchTargetId('');
                                      setObservationId('');
                                    },
                                    'Local match saved. Operation and cables remain unverified.',
                                  )
                                }
                              >
                                {saving ? 'Saving match...' : 'Confirm OS match'}
                              </button>
                              <button
                                className="text-button"
                                disabled={saving}
                                onClick={() => setMatchReview(null)}
                              >
                                Cancel match
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </article>
              ))}
              {!workspace.devices.length && (
                <p className="empty-copy">
                  Add your first device or review a desk photo to get started.
                </p>
              )}
            </div>
            <button
              className="button primary full"
              disabled={workspace.devices.length < 2}
              onClick={() => setStep(1)}
            >
              Continue to connections
              <ArrowRight size={16} />
            </button>
            {workspace.devices.length === 1 && (
              <p className="micro-note">
                Add the computer, dock or other device it connects to. You can also go directly to a
                check and keep unknown connections unanswered.
              </p>
            )}
          </>
        )}
        {step === 1 && (
          <>
            <h3>Record what connects to what</h3>
            <p className="muted">
              Confirm one connection at a time. Use Unknown if you have not checked the cable type.
              A saved link records your account; it does not prove the link works.
            </p>
            {photoContext && (
              <details className="desk-setup-notes" open>
                <summary>Your photo setup notes</summary>
                <p>{photoContext}</p>
                <small>
                  Kept only in this open app. The photo did not verify these connections.
                </small>
                {suggested && (
                  <button
                    className="button secondary full"
                    onClick={() => {
                      setDraft(suggested);
                      setReview(null);
                      setError('');
                    }}
                  >
                    Review connection from my notes
                  </button>
                )}
                {!suggested && (
                  <p className="micro-note">
                    Select the two devices below to turn a connection you described into a record.
                  </p>
                )}
              </details>
            )}
            {questions.length > 0 && (
              <section className="desk-setup-questions" aria-label="Missing connection questions">
                <h4>Still to clarify</h4>
                {questions.map((question) => (
                  <button
                    key={question.deviceId}
                    className={draft.from === question.deviceId ? 'active' : ''}
                    onClick={() => {
                      setDraft(emptyDraft(question.deviceId));
                      setReview(null);
                      setError('');
                    }}
                    aria-label={`Review connection for ${name(question.deviceId)}`}
                  >
                    {question.text}
                    <ArrowRight size={14} />
                  </button>
                ))}
                <small>
                  Questions are based on missing user-reported records. You can leave unknown
                  connections unanswered.
                </small>
              </section>
            )}
            {!editing && (
              <div className="desk-setup-note">
                <p>Switch to Edit to add or replace recorded connections.</p>
                <button className="button secondary" onClick={onEditConnections}>
                  Edit connections
                </button>
              </div>
            )}
            <form
              className="desk-setup-connection-form"
              onSubmit={(event) => {
                event.preventDefault();
                reviewConnection();
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
              <div className="two-columns">
                <label>
                  First device port <span className="muted">optional</span>
                  <input
                    aria-label="Setup first port"
                    value={draft.fromPort}
                    maxLength={40}
                    disabled={saving}
                    onChange={(event) => editDraft({ fromPort: event.target.value })}
                  />
                </label>
                <label>
                  Other device port <span className="muted">optional</span>
                  <input
                    aria-label="Setup other port"
                    value={draft.toPort}
                    maxLength={40}
                    disabled={saving}
                    onChange={(event) => editDraft({ toPort: event.target.value })}
                  />
                </label>
              </div>
              {!review && (
                <button
                  className="button primary full"
                  type="submit"
                  disabled={!validConnection || !editing || saving}
                >
                  Review connection
                </button>
              )}
            </form>
            {review && (
              <div
                className="desk-setup-confirm"
                role="region"
                aria-label="Confirm setup connection"
              >
                <h4>
                  {review.previous ? 'Replace the existing connection?' : 'Save this connection?'}
                </h4>
                <p>
                  {name(review.draft.from)} → {name(review.draft.to)} · {review.draft.connector}
                </p>
                <p className="micro-note">
                  Ports: {review.draft.fromPort || 'not recorded'} →{' '}
                  {review.draft.toPort || 'not recorded'}
                </p>
                {review.previous && (
                  <p className="desk-setup-note">
                    Existing record: {name(review.previous.from)} → {name(review.previous.to)} ·{' '}
                    {review.previous.connector} · {sourceLabels[review.previous.source]}. Ports:{' '}
                    {review.previous.fromPort || 'not recorded'} →{' '}
                    {review.previous.toPort || 'not recorded'}. Only one connection per device pair
                    is supported.
                  </p>
                )}
                <p className="micro-note">
                  Confirm only a connection you have identified. This records your report, not an
                  automatic verification.
                </p>
                <button
                  className="button primary full"
                  disabled={saving || !editing}
                  onClick={() =>
                    void saveCommand(
                      () => setupConnectionCommand(workspace, review.draft, review.previous),
                      () => {
                        setReview(null);
                        setDraft(emptyDraft());
                      },
                      'Connection saved as user-reported. Working status is unchanged.',
                    )
                  }
                >
                  {saving
                    ? 'Saving connection...'
                    : review.previous
                      ? 'Confirm replacement'
                      : 'Confirm connection'}
                </button>
                <button className="text-button" disabled={saving} onClick={() => setReview(null)}>
                  Cancel connection
                </button>
              </div>
            )}
            <details className="desk-setup-records">
              <summary>Recorded connections ({workspace.connections.length})</summary>
              {workspace.connections.map((edge) => (
                <div className="desk-setup-edge" key={edge.id}>
                  <strong>
                    {name(edge.from)} → {name(edge.to)}
                  </strong>
                  <span>
                    {edge.connector} · {sourceLabels[edge.source]}
                  </span>
                  <button
                    className="text-button"
                    disabled={saving}
                    onClick={() => {
                      setDraft({
                        from: edge.from,
                        to: edge.to,
                        connector: edge.connector,
                        fromPort: edge.fromPort,
                        toPort: edge.toPort,
                        note: 'The user reviewed and confirmed this connection during desk setup.',
                      });
                      setReview(null);
                      setError('');
                    }}
                  >
                    Review this connection
                  </button>
                </div>
              ))}
              {!workspace.connections.length && <p>No connections recorded yet.</p>}
            </details>
            <p className="micro-note">
              {confirmed.length} user-reported{' '}
              {confirmed.length === 1 ? 'connection' : 'connections'}. Unknown or missing records
              remain open questions.
            </p>
            <button className="button secondary full" disabled={saving} onClick={() => setStep(2)}>
              Continue to a check
              <ArrowRight size={16} />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <h3>Choose a monitor to troubleshoot</h3>
            <p className="muted">
              The guided check uses your recorded path and your answers. It will ask about gaps and
              will not treat a photo or OS detection as proof that the screen works.
            </p>
            {questions.filter(
              (question) =>
                workspace.devices.find((device) => device.id === question.deviceId)?.kind ===
                'monitor',
            ).length > 0 && (
              <p className="desk-setup-note">
                Some monitors have no user-reported connection yet. You can return to Connections or
                start a check with those details unknown.
              </p>
            )}
            <div className="desk-setup-checks">
              {workspace.devices
                .filter((device) => device.kind === 'monitor')
                .map((device) => (
                  <button
                    className="button secondary full"
                    key={device.id}
                    onClick={() => onTroubleshoot(device.id)}
                  >
                    <span>
                      {device.name}
                      <small>
                        {sourceLabels[device.source]} ·{' '}
                        {device.status === 'reported-working'
                          ? 'User reports working'
                          : device.status === 'reported-issue'
                            ? 'User reports an issue'
                            : 'Not checked'}
                      </small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
            </div>
            {!workspace.devices.some((device) => device.kind === 'monitor') && (
              <>
                <p className="empty-copy">
                  No monitor is recorded yet. Add one or review the devices identified from your
                  photo.
                </p>
                <button className="button secondary full" onClick={onAddDevice}>
                  Add a monitor
                </button>
              </>
            )}
            <button className="text-button" onClick={() => setStep(1)}>
              Review connections first
            </button>
          </>
        )}
      </div>
    </aside>
  );
}

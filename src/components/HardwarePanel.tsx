import { useState } from 'react';
import {
  Cpu,
  CheckCircle,
  Question,
  PauseCircle,
  WarningCircle,
  Link,
  X,
  ArrowRight,
  Plus,
  PlugsConnected,
} from '@phosphor-icons/react';
import {
  hardwareCategoryLabels,
  sameHardwareIdentity,
  type HardwareBinding,
  type HardwareDevice,
  type HardwareSnapshot,
} from '../domain/hardware';
import { hardwareMatchCommand, hardwarePresence, linkedDevice } from '../domain/hardwareState';
import type { HardwareController } from '../domain/useHardware';
import {
  kindLabels,
  type Device,
  type DeviceKind,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
import '../styles/hardware.css';

type CommandHandler = (command: WorkspaceCommand) => void | boolean | Promise<boolean>;

function checkedTime(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { hour12: false }) : 'Not checked';
}

function serviceLabel(hardware: HardwareController) {
  if (hardware.enabled && hardware.busy) return 'Starting detection…';
  return hardware.snapshot.state === 'running'
    ? 'Detection active'
    : hardware.snapshot.state === 'stopped'
      ? 'Detection stopped'
      : 'Status unavailable';
}

export function HardwareBadge({
  device,
  snapshot,
}: {
  device: Device;
  snapshot: HardwareSnapshot;
}) {
  const presence = hardwarePresence(device, snapshot);
  const Icon =
    presence.state === 'detected'
      ? PlugsConnected
      : presence.state === 'stopped'
        ? PauseCircle
        : presence.state === 'not-detected' || presence.state === 'unavailable'
          ? WarningCircle
          : Question;
  return (
    <span className={`hardware-badge ${presence.state}`}>
      <Icon size={14} aria-hidden="true" />
      {presence.label}
    </span>
  );
}

export function HardwareSummary({
  hardware,
  workspace,
  onOpen,
  onSelect,
}: {
  hardware: HardwareController;
  workspace: Workspace;
  onOpen: () => void;
  onSelect: (id: string) => void;
}) {
  const { snapshot } = hardware;
  const linked = workspace.devices.filter((device) => device.hardwareBinding);
  return (
    <section className="hardware-summary" aria-label="OS detection summary">
      <div className="section-heading">
        <h3>
          <Cpu size={16} aria-hidden="true" /> Mac recognition
        </h3>
        <span className="local-data-label">LOCAL ONLY</span>
      </div>
      <strong className="hardware-service-state">{serviceLabel(hardware)}</strong>
      <p>
        {snapshot.state === 'running'
          ? `${snapshot.devices.length} OS observations · ${linked.filter((device) => hardwarePresence(device, snapshot).state === 'detected').length} matched desk devices`
          : 'OS recognition is separate from your saved connections and user reports.'}
      </p>
      <small>Last successful check: {checkedTime(snapshot.lastCheckedAt)}</small>
      {linked.length > 0 && (
        <div className="hardware-summary-devices">
          {linked.map((device) => (
            <button key={device.id} onClick={() => onSelect(device.id)}>
              <span>{device.name}</span>
              <HardwareBadge device={device} snapshot={snapshot} />
            </button>
          ))}
        </div>
      )}
      <button className="text-button" onClick={onOpen}>
        <Cpu size={16} />
        Open Mac hardware
        <ArrowRight size={14} />
      </button>
    </section>
  );
}

function ObservationFacts({
  observation,
  snapshot,
}: {
  observation: HardwareDevice;
  snapshot: HardwareSnapshot;
}) {
  const parent = snapshot.devices.find((device) => device.id === observation.parentId);
  return (
    <dl className="record-facts hardware-facts">
      <div>
        <dt>OS name</dt>
        <dd>{observation.name}</dd>
      </div>
      <div>
        <dt>Model / codes</dt>
        <dd>{observation.model || 'Not supplied by macOS'}</dd>
      </div>
      <div>
        <dt>OS state</dt>
        <dd>{observation.status} · Feature operation unverified</dd>
      </div>
      <div>
        <dt>Source</dt>
        <dd>{observation.source}</dd>
      </div>
      <div>
        <dt>Identity</dt>
        <dd>
          {observation.identity.stability === 'persistent'
            ? 'Installation-specific persistent identity'
            : 'Session only · match again after reconnect'}
        </dd>
      </div>
      {observation.category === 'usb' && (
        <div>
          <dt>OS USB parent</dt>
          <dd>
            {parent?.name || 'No enumerated USB ancestor supplied'}
            <small>IOKit registry hierarchy; not a measured cable route.</small>
          </dd>
        </div>
      )}
      {observation.attributes.map((attribute, index) => (
        <div key={`${index}-${attribute.label}`}>
          <dt>{attribute.label}</dt>
          <dd>{attribute.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DeviceHardwareStatus({
  device,
  snapshot,
  onManage,
  onCommand,
}: {
  device: Device;
  snapshot: HardwareSnapshot;
  onManage: () => void;
  onCommand: CommandHandler;
}) {
  const [removing, setRemoving] = useState(false);
  const [reviewedRemoval, setReviewedRemoval] = useState<HardwareBinding | null>(null);
  const [saving, setSaving] = useState(false);
  const presence = hardwarePresence(device, snapshot);
  const removalIsCurrent =
    JSON.stringify(device.hardwareBinding ?? null) === JSON.stringify(reviewedRemoval);
  return (
    <section
      className="panel-section device-hardware"
      aria-label="OS recognition for selected device"
    >
      <h3>
        <Cpu size={17} aria-hidden="true" /> OS recognition
      </h3>
      <HardwareBadge device={device} snapshot={snapshot} />
      <p className="muted">{presence.explanation}</p>
      <p className="micro-note">
        Last successful category check: {checkedTime(presence.lastCheckedAt)}
      </p>
      {device.hardwareBinding && (
        <p className="micro-note">
          Source: {snapshot.categories[device.hardwareBinding.category].source}
          <br />
          Match approved: {checkedTime(device.hardwareBinding.approvedAt)}
        </p>
      )}
      {presence.observation && (
        <ObservationFacts observation={presence.observation} snapshot={snapshot} />
      )}
      <button className="text-button" onClick={onManage}>
        <Link size={15} />
        {device.hardwareBinding ? 'Review Mac hardware matches' : 'Choose an OS observation'}
      </button>
      {device.hardwareBinding &&
        (!removing ? (
          <button
            className="text-button danger-text"
            onClick={() => {
              setReviewedRemoval(structuredClone(device.hardwareBinding ?? null));
              setRemoving(true);
            }}
          >
            Remove OS match
          </button>
        ) : (
          <div className="inline-confirm" role="group" aria-label="Remove OS match confirmation">
            <p>
              Remove only this local match? Your device, layout, connections and user reports stay
              saved.
            </p>
            {!removalIsCurrent && (
              <p role="alert">
                The OS match changed. Keep the current match, then review removal again.
              </p>
            )}
            <button
              className="button secondary"
              disabled={saving}
              onClick={() => setRemoving(false)}
            >
              Keep match
            </button>
            <button
              className="button secondary"
              disabled={saving || !removalIsCurrent}
              onClick={async () => {
                if (!removalIsCurrent) return;
                setSaving(true);
                try {
                  if (
                    (await onCommand({
                      type: 'unbind-hardware',
                      id: device.id,
                      expectedBinding: reviewedRemoval,
                    })) !== false
                  )
                    setRemoving(false);
                } finally {
                  setSaving(false);
                }
              }}
            >
              Confirm remove match
            </button>
          </div>
        ))}
    </section>
  );
}

export function HardwarePanel({
  hardware,
  workspace,
  onCommand,
  onSelect,
  onClose,
}: {
  hardware: HardwareController;
  workspace: Workspace;
  onCommand: CommandHandler;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [consent, setConsent] = useState(false);
  const [selected, setSelected] = useState<HardwareDevice | null>(null);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('monitor');
  const [reviewing, setReviewing] = useState(false);
  const [reviewedBinding, setReviewedBinding] = useState<HardwareBinding | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { snapshot } = hardware;
  const observation =
    selected &&
    snapshot.state === 'running' &&
    snapshot.categories[selected.category].state === 'ok'
      ? snapshot.devices.find(
          (device) =>
            device.id === selected.id && sameHardwareIdentity(device.identity, selected.identity),
        )
      : undefined;
  const linked = observation ? linkedDevice(workspace, observation) : undefined;
  const existing = workspace.devices.find((device) => device.id === target);
  const matchIsCurrent =
    target === 'new' ||
    (!!existing &&
      JSON.stringify(existing.hardwareBinding ?? null) === JSON.stringify(reviewedBinding));
  function choose(value: HardwareDevice) {
    setSelected(value);
    setTarget('');
    setName(value.name.slice(0, 60));
    setKind(value.category === 'display' ? 'monitor' : 'dock');
    setReviewing(false);
    setError('');
  }
  return (
    <aside className="floating-panel hardware-panel" aria-label="Mac hardware panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">READ-ONLY · LOCAL TO THIS MAC</span>
          <h2>Mac hardware</h2>
        </div>
        <button className="icon-button" aria-label="Close Mac hardware" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="panel-scroll">
        <section className="hardware-consent" aria-label="Hardware detection controls">
          <div className="hardware-state-title">
            <Cpu size={20} aria-hidden="true" />
            <strong>{serviceLabel(hardware)}</strong>
          </div>
          <p>
            {hardware.enabled && hardware.busy
              ? 'Reading OS metadata locally. You can stop this check at any time.'
              : snapshot.message}
          </p>
          <p className="micro-note">Last successful check: {checkedTime(snapshot.lastCheckedAt)}</p>
          {!hardware.enabled && (
            <>
              <p>
                Read display names and OS flags, USB product/vendor details and the USB registry
                hierarchy. Identifiers are minimized locally. No screen capture, key recording,
                device control or settings changes.
              </p>
              <label className="hardware-consent-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                />
                I agree to read this Mac’s hardware metadata locally.
              </label>
              <p className="micro-note">
                Nothing is sent to Meta. Detection does not add or update your desk until you
                approve a match. Refreshes about every 5 seconds while active.
              </p>
            </>
          )}
          {hardware.session && !hardware.session.available && (
            <p className="hardware-unavailable" role="note">
              {hardware.session.message}
            </p>
          )}
          {hardware.error && (
            <p className="error-copy" role="alert">
              {hardware.error}
            </p>
          )}
          {hardware.enabled ? (
            <button className="button secondary full" onClick={() => void hardware.stop()}>
              <PauseCircle size={17} />
              Stop detection
            </button>
          ) : (
            <button
              className="button primary full"
              disabled={!consent || hardware.busy || hardware.session?.available === false}
              onClick={() => void hardware.start()}
            >
              <Cpu size={17} />
              {hardware.busy ? 'Starting detection…' : 'Start detection'}
            </button>
          )}
          {!hardware.enabled && (
            <button
              className="text-button"
              disabled={hardware.busy}
              onClick={() => void hardware.refreshAvailability()}
            >
              Check bridge availability
            </button>
          )}
        </section>
        <section className="hardware-categories" aria-label="Detection sources">
          {(['display', 'usb', 'bluetooth'] as const).map((category) => (
            <div key={category}>
              <strong>{hardwareCategoryLabels[category]}</strong>
              <span className={`category-state ${snapshot.categories[category].state}`}>
                {snapshot.categories[category].state === 'ok'
                  ? 'Checked'
                  : snapshot.categories[category].state === 'permission-denied'
                    ? 'Permission denied'
                    : snapshot.categories[category].state === 'error'
                      ? 'Check failed'
                      : 'Unavailable'}
              </span>
              <small>{snapshot.categories[category].source}</small>
              <p>{snapshot.categories[category].message}</p>
              <small>
                Last successful check: {checkedTime(snapshot.categories[category].lastCheckedAt)}
              </small>
            </div>
          ))}
        </section>
        <section aria-label="OS observations" className="observation-list">
          <h3>
            OS observations{' '}
            <span className="count">
              {snapshot.state === 'running' ? snapshot.devices.length : 0}
            </span>
          </h3>
          {snapshot.state === 'running' &&
            snapshot.devices.map((item) => {
              const match = linkedDevice(workspace, item);
              return (
                <button
                  className={`observation-row ${observation?.id === item.id ? 'active' : ''}`}
                  key={item.id}
                  onClick={() => choose(item)}
                >
                  <Cpu size={19} aria-hidden="true" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {hardwareCategoryLabels[item.category]} · {item.status}
                    </small>
                    <small>{match ? `Linked to ${match.name}` : 'Not linked to your desk'}</small>
                  </span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              );
            })}
          {!snapshot.devices.length && (
            <p className="muted">
              {snapshot.state === 'running'
                ? 'No observations were returned by the successfully checked categories. Review each category’s result above.'
                : 'Enable local detection to review available observations.'}
            </p>
          )}
        </section>
        {selected && !observation && (
          <p className="error-copy" role="status">
            The selected observation is no longer current. Detection may have stopped or the device
            may have changed. Review a current observation before saving.
          </p>
        )}
        {observation && (
          <section className="observation-detail" aria-label="Selected OS observation">
            <h3>{observation.name}</h3>
            <ObservationFacts observation={observation} snapshot={snapshot} />
            {linked ? (
              <>
                <p className="hardware-already-linked">
                  <CheckCircle size={16} />
                  Already linked to {linked.name}. A second record is not needed.
                </p>
                <button className="button secondary full" onClick={() => onSelect(linked.id)}>
                  Open linked desk device
                </button>
              </>
            ) : (
              <>
                <label>
                  Desk device match
                  <select
                    aria-label="Desk device match"
                    value={target}
                    disabled={saving}
                    onChange={(event) => {
                      setTarget(event.target.value);
                      setReviewing(false);
                      setError('');
                    }}
                  >
                    <option value="">Choose explicitly…</option>
                    <option value="new" disabled={workspace.devices.length >= 40}>
                      Add as a separate new device
                    </option>
                    {workspace.devices.map((device) => (
                      <option key={device.id} value={device.id}>
                        {device.name}
                        {device.hardwareBinding ? ' (replaces its OS match)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                {target === 'new' && (
                  <>
                    <label>
                      New device name
                      <input
                        aria-label="New hardware device name"
                        value={name}
                        maxLength={60}
                        disabled={saving}
                        onChange={(event) => {
                          setName(event.target.value);
                          setReviewing(false);
                        }}
                      />
                    </label>
                    <label>
                      3D template
                      <select
                        aria-label="Hardware device template"
                        value={kind}
                        disabled={saving}
                        onChange={(event) => {
                          setKind(event.target.value as DeviceKind);
                          setReviewing(false);
                        }}
                      >
                        {Object.entries(kindLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="micro-note">
                      Choose the closest visual template. macOS does not provide a 3D shape or a
                      physical desk position.
                    </p>
                  </>
                )}
                {!reviewing ? (
                  <button
                    className="button secondary full"
                    disabled={!target || (target === 'new' && !name.trim())}
                    onClick={() => {
                      setReviewedBinding(structuredClone(existing?.hardwareBinding ?? null));
                      setReviewing(true);
                      setError('');
                    }}
                  >
                    <Link size={16} />
                    Review match
                  </button>
                ) : (
                  <div
                    className="hardware-match-review"
                    role="group"
                    aria-label="Confirm hardware match"
                  >
                    <h4>Review before saving</h4>
                    <p>
                      <strong>{observation.name}</strong> →{' '}
                      <strong>
                        {target === 'new' ? name.trim() : existing?.name || 'Missing desk record'}
                      </strong>
                    </p>
                    <p>
                      {target === 'new'
                        ? 'Add one device with the selected 3D template and unknown operating status. A free scene position will be chosen.'
                        : 'Save only this local OS association. Keep the existing name, model, layout, connections and user-reported status.'}
                    </p>
                    {existing?.hardwareBinding && (
                      <p>This replaces the previously approved OS match for this desk device.</p>
                    )}
                    {!matchIsCurrent && (
                      <p role="alert">
                        The OS match changed while you were reviewing. Cancel and review the current
                        match again.
                      </p>
                    )}
                    <p className="micro-note">
                      Recognition does not prove a device works. No connection record will be
                      created.
                    </p>
                    <div className="inline-actions">
                      <button
                        className="button secondary"
                        disabled={saving}
                        onClick={() => setReviewing(false)}
                      >
                        Cancel match
                      </button>
                      <button
                        className="button primary"
                        disabled={saving || !matchIsCurrent}
                        onClick={async () => {
                          if (!matchIsCurrent) return;
                          setSaving(true);
                          setError('');
                          try {
                            const command = hardwareMatchCommand(
                              workspace,
                              snapshot,
                              observation,
                              target === 'new'
                                ? { newDevice: { name, kind } }
                                : { existingId: target },
                            );
                            const saved = await onCommand(command);
                            if (saved !== false) {
                              setReviewing(false);
                              onSelect(command.type === 'add-device' ? command.device.id : target);
                            } else
                              setError(
                                'The match was not saved. Review the storage notice and try again.',
                              );
                          } catch (cause) {
                            setError(
                              cause instanceof Error ? cause.message : 'Could not save this match.',
                            );
                          } finally {
                            setSaving(false);
                          }
                        }}
                      >
                        <Plus size={15} />
                        {saving ? 'Saving…' : 'Confirm and save match'}
                      </button>
                    </div>
                  </div>
                )}
                {error && (
                  <p className="error-copy" role="alert">
                    {error}
                  </p>
                )}
              </>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

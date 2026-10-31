import { useRef, useState, type ReactNode } from 'react';
import { Plus, Link, ArrowRight } from '@phosphor-icons/react';
import { Modal } from './ui';
import {
  ConnectorSchema,
  DeviceKindSchema,
  kindLabels,
  sourceLabels,
  type Connection,
  type DeviceKind,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
export function AddDeviceDialog({
  onClose,
  onCommand,
  notices,
}: {
  onClose: () => void;
  onCommand: (command: WorkspaceCommand) => boolean | Promise<boolean>;
  notices?: ReactNode;
}) {
  const [kind, setKind] = useState<DeviceKind>('monitor');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  return (
    <Modal
      title="Add device"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <p className="muted">You can build your setup without a photo.</p>
      {notices}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setSaving(true);
          setError('');
          try {
            const saved = await onCommand({
              type: 'add-device',
              device: {
                id: crypto.randomUUID(),
                name: name.trim() || kindLabels[kind],
                kind,
                model: '',
                source: 'user-reported',
                status: 'unknown',
                statusNote: '',
                placement: { x: 0, z: 0.35, rotation: 0 },
              },
            });
            if (saved) onClose();
            else
              setError(
                'The device was not saved. Check the storage or placement notice and try again.',
              );
          } catch {
            setError('The device could not be saved. Your entries have been kept.');
          } finally {
            pending.current = false;
            setSaving(false);
          }
        }}
      >
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
            {DeviceKindSchema.options.map((k) => (
              <option key={k} value={k}>
                {kindLabels[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Device name
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Work monitor"
          />
        </label>
        <p className="micro-note">
          Added devices start with an unconfirmed status. You can move them in placement editing.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="button primary full" type="submit" disabled={saving}>
          <Plus size={18} /> {saving ? 'Saving device...' : 'Add to my desk'}
        </button>
      </form>
    </Modal>
  );
}
export function ConnectionDialog({
  workspace,
  selected,
  onClose,
  onCommand,
  notices,
}: {
  workspace: Workspace;
  selected: string | null;
  onClose: () => void;
  onCommand: (command: WorkspaceCommand) => boolean | Promise<boolean>;
  notices?: ReactNode;
}) {
  const [from, setFrom] = useState(
    workspace.devices.some((device) => device.id === selected)
      ? selected!
      : workspace.devices[0]?.id || '',
  );
  const [to, setTo] = useState(workspace.devices.find((d) => d.id !== from)?.id || '');
  const [connector, setConnector] = useState<Connection['connector']>('USB-C');
  const [fromPort, setFromPort] = useState('');
  const [toPort, setToPort] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<{
    previous: Connection;
    proposed: Connection;
  } | null>(null);
  const pending = useRef(false);
  const valid =
    from !== to && [from, to].every((id) => workspace.devices.some((device) => device.id === id));
  const existing = workspace.connections.find(
    (connection) =>
      (connection.from === from && connection.to === to) ||
      (connection.from === to && connection.to === from),
  );
  const reviewIsCurrent =
    review !== null && valid && JSON.stringify(existing) === JSON.stringify(review.previous);
  const deviceName = (id: string) =>
    workspace.devices.find((device) => device.id === id)?.name || 'Removed device';

  async function save(connection: Connection, expectedConnection: Connection | null) {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await onCommand({ type: 'connect', connection, expectedConnection });
      if (saved) onClose();
      else {
        setReview(null);
        setError('The connection was not saved. Review the latest record and storage notice.');
      }
    } catch {
      setReview(null);
      setError('The connection could not be saved. Your entries have been kept; review and retry.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  function connectionFacts(connection: Connection) {
    return (
      <dl className="record-facts">
        <div>
          <dt>Devices</dt>
          <dd>
            {deviceName(connection.from)} → {deviceName(connection.to)}
          </dd>
        </div>
        <div>
          <dt>Connector</dt>
          <dd>{connection.connector}</dd>
        </div>
        <div>
          <dt>{deviceName(connection.from)} port</dt>
          <dd>{connection.fromPort || 'Not recorded'}</dd>
        </div>
        <div>
          <dt>{deviceName(connection.to)} port</dt>
          <dd>{connection.toPort || 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{sourceLabels[connection.source]}</dd>
        </div>
        <div>
          <dt>Note</dt>
          <dd>{connection.note || 'No note'}</dd>
        </div>
      </dl>
    );
  }
  return (
    <Modal
      title="Record a connection"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <p className="muted">
        Record which devices are connected. This does not confirm whether the connection works.
      </p>
      {notices}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || pending.current || review) return;
          setError('');
          const proposed: Connection = {
            id: crypto.randomUUID(),
            from,
            to,
            connector,
            fromPort,
            toPort,
            source: 'user-reported',
            note: 'The user entered this connection.',
          };
          if (existing) {
            setReview({ previous: structuredClone(existing), proposed });
            return;
          }
          await save(proposed, null);
        }}
      >
        <div className="connection-form-row">
          <label>
            First device
            <select
              value={from}
              disabled={saving || !!review}
              onChange={(e) => setFrom(e.target.value)}
            >
              {workspace.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <ArrowRight size={20} />
          <label>
            Second device
            <select
              value={to}
              disabled={saving || !!review}
              onChange={(e) => setTo(e.target.value)}
            >
              {workspace.devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Connector
          <select
            value={connector}
            disabled={saving || !!review}
            onChange={(e) => setConnector(e.target.value as Connection['connector'])}
          >
            {ConnectorSchema.options.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="two-columns">
          <label>
            First device port <span className="muted">optional</span>
            <input
              value={fromPort}
              disabled={saving || !!review}
              maxLength={40}
              onChange={(e) => setFromPort(e.target.value)}
              placeholder="e.g. Left USB-C"
            />
          </label>
          <label>
            Second device port <span className="muted">optional</span>
            <input
              value={toPort}
              disabled={saving || !!review}
              maxLength={40}
              onChange={(e) => setToPort(e.target.value)}
              placeholder="e.g. HDMI 1"
            />
          </label>
        </div>
        {from === to && (
          <p role="alert" className="form-error">
            Select two different devices.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {existing && !review && (
          <p className="micro-note" role="note">
            These devices already have a recorded {existing.connector} connection. Review it before
            replacing it; only one connection per device pair is currently supported.
          </p>
        )}
        {review ? (
          <section
            className="draft-review"
            role="region"
            aria-label="Connection replacement review"
          >
            <h3>Review connection replacement</h3>
            <p>The current record will be replaced only after you confirm.</p>
            <h4>Previously saved connection</h4>
            {connectionFacts(review.previous)}
            <h4>Your replacement</h4>
            {connectionFacts(review.proposed)}
            {!reviewIsCurrent && (
              <div role="alert">
                <p>
                  The saved connection changed while you were reviewing. Review it again before
                  saving.
                </p>
                {existing && connectionFacts(existing)}
                <button
                  className="button secondary full"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    if (existing && valid)
                      setReview({ ...review, previous: structuredClone(existing) });
                    else setReview(null);
                  }}
                >
                  Review latest connection
                </button>
              </div>
            )}
            <p className="micro-note">
              This records your account of the connection, not proof that it works.
            </p>
            <button
              className="button primary full"
              type="button"
              disabled={saving || !reviewIsCurrent}
              onClick={() => {
                if (reviewIsCurrent) void save(review.proposed, review.previous);
              }}
            >
              {saving ? 'Saving connection...' : 'Confirm replacement'}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={saving}
              onClick={() => setReview(null)}
            >
              Cancel replacement and edit
            </button>
          </section>
        ) : (
          <button className="button primary full" disabled={!valid || saving} type="submit">
            <Link size={18} />
            {saving
              ? 'Saving connection...'
              : existing
                ? 'Review replacement'
                : 'Save as user-reported'}
          </button>
        )}
      </form>
    </Modal>
  );
}

import { useRef, useState } from 'react';
import { Plus, Link, ArrowRight } from '@phosphor-icons/react';
import { Modal } from './ui';
import {
  ConnectorSchema,
  DeviceKindSchema,
  kindLabels,
  type Connection,
  type DeviceKind,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
export function AddDeviceDialog({
  onClose,
  onCommand,
}: {
  onClose: () => void;
  onCommand: (command: WorkspaceCommand) => boolean | Promise<boolean>;
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
}: {
  workspace: Workspace;
  selected: string | null;
  onClose: () => void;
  onCommand: (command: WorkspaceCommand) => boolean | Promise<boolean>;
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
  const pending = useRef(false);
  const valid =
    from !== to && [from, to].every((id) => workspace.devices.some((device) => device.id === id));
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
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || pending.current) return;
          pending.current = true;
          setSaving(true);
          setError('');
          try {
            const saved = await onCommand({
              type: 'connect',
              connection: {
                id: crypto.randomUUID(),
                from,
                to,
                connector,
                fromPort,
                toPort,
                source: 'user-reported',
                note: 'The user entered this connection.',
              },
            });
            if (saved) onClose();
            else setError('The connection was not saved. Check the storage notice and try again.');
          } catch {
            setError('The connection could not be saved. Your entries have been kept.');
          } finally {
            pending.current = false;
            setSaving(false);
          }
        }}
      >
        <div className="connection-form-row">
          <label>
            First device
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
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
            <select value={to} onChange={(e) => setTo(e.target.value)}>
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
              maxLength={40}
              onChange={(e) => setFromPort(e.target.value)}
              placeholder="e.g. Left USB-C"
            />
          </label>
          <label>
            Second device port <span className="muted">optional</span>
            <input
              value={toPort}
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
        <button className="button primary full" disabled={!valid || saving} type="submit">
          <Link size={18} />
          {saving ? 'Saving connection...' : 'Save as user-reported'}
        </button>
      </form>
    </Modal>
  );
}

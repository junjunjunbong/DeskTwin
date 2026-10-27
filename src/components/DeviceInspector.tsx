import { useEffect, useState } from 'react';
import { X, Link, Trash, Check, PencilSimple } from '@phosphor-icons/react';
import { DeviceIcon } from './ui';
import { DiagnosticPanel } from './DiagnosticPanel';
import { TransformEditor } from './TransformEditor';
import { ShapeEditor } from './ShapeEditor';
import { PlacementControls } from './PlacementControls';
import {
  kindLabels,
  sourceLabels,
  statusLabels,
  type Device,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
interface Props {
  device: Device;
  workspace: Workspace;
  mode: string;
  onCommand: (command: WorkspaceCommand) => void | boolean | Promise<boolean>;
  onClose: () => void;
  onConnect: () => void;
  onSelect: (id: string) => void;
}
export function DeviceInspector({
  device: d,
  workspace,
  mode,
  onCommand,
  onClose,
  onConnect,
  onSelect,
}: Props) {
  const [name, setName] = useState(d.name);
  const [model, setModel] = useState(d.model);
  const [status, setStatus] = useState(d.status);
  const [note, setNote] = useState(d.statusNote);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setName(d.name);
    setModel(d.model);
    setStatus(d.status);
    setNote(d.statusNote);
  }, [d.name, d.model, d.status, d.statusNote]);
  const links = workspace.connections.filter((c) => c.from === d.id || c.to === d.id);
  return (
    <aside className="floating-panel inspector" aria-label="Selected device">
      <div className="panel-heading">
        <div className="device-heading">
          <span className="device-glyph">
            <DeviceIcon kind={d.kind} size={29} />
          </span>
          <div>
            <span className="eyebrow">{kindLabels[d.kind]}</span>
            <h2>{d.name}</h2>
          </div>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close device details">
          <X size={19} />
        </button>
      </div>
      <div className="panel-scroll">
        <div className="evidence-row">
          <span className={`source-badge ${d.source}`}>{sourceLabels[d.source]}</span>
          <span className="muted">Not detected in real time</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCommand({
              type: 'update-device',
              id: d.id,
              patch: {
                ...(name !== d.name ? { name } : {}),
                model,
                source: name !== d.name || model !== d.model ? 'user-reported' : d.source,
                status,
                statusNote: status === 'unknown' ? '' : note || 'The user reported this status.',
              },
            });
          }}
        >
          <label>
            Device name
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            Model <span className="muted">optional</span>
            <input
              value={model}
              maxLength={100}
              placeholder="Do you know the exact model?"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label>
            Operating status <span className="muted">user-reported</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Device['status'])}>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {status !== 'unknown' && (
            <label>
              What did you check?
              <textarea
                value={note}
                maxLength={300}
                placeholder="e.g. The screen worked after connecting it directly."
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <button className="button secondary full" type="submit">
            <Check size={17} />
            Save device details
          </button>
        </form>
        {mode === 'edit' && (
          <section className="panel-section">
            <h3>
              <PencilSimple size={16} />
              Edit placement
            </h3>
            <p className="muted">Drag in the scene or adjust position, size, and color below.</p>
            <TransformEditor
              placement={d.placement}
              visual={d.visual}
              prefix="Device"
              onChange={(patch) => onCommand({ type: 'update-device', id: d.id, patch })}
            />
            <PlacementControls
              item={d}
              workspace={workspace}
              onCommand={onCommand}
              prefix="Device"
            />
            <ShapeEditor
              item={d}
              onChange={(patch) => onCommand({ type: 'update-device', id: d.id, patch })}
              onPartChange={(index, patch) =>
                onCommand({
                  type: 'update-part',
                  id: d.id,
                  index,
                  expectedLength: d.parts?.length ?? 0,
                  patch,
                })
              }
            />
          </section>
        )}
        <section className="panel-section">
          <div className="section-heading">
            <h3>
              Connections <span className="count">{links.length}</span>
            </h3>
            <button className="text-button" onClick={onConnect}>
              <Link size={15} />
              Add
            </button>
          </div>
          {links.length === 0 ? (
            <p className="empty-copy">No connections recorded yet.</p>
          ) : (
            links.map((c) => {
              const other = workspace.devices.find(
                (item) => item.id === (c.from === d.id ? c.to : c.from),
              )!;
              return (
                <div className="connection-item" key={c.id}>
                  <DeviceIcon kind={other.kind} size={20} />
                  <div className="connection-details">
                    <button
                      className="connection-counterpart"
                      aria-label={`Select connected device ${other.name}`}
                      onClick={() => onSelect(other.id)}
                    >
                      <strong>{other.name}</strong>
                    </button>
                    <dl>
                      <div>
                        <dt>Connection</dt>
                        <dd>{c.connector}</dd>
                      </div>
                      <div>
                        <dt>{d.name} port</dt>
                        <dd>{(c.from === d.id ? c.fromPort : c.toPort) || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>{other.name} port</dt>
                        <dd>{(c.from === d.id ? c.toPort : c.fromPort) || 'Not recorded'}</dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>
                          <span className={`source-badge ${c.source}`}>
                            {sourceLabels[c.source]}
                          </span>
                        </dd>
                      </div>
                    </dl>
                    {c.note && <p className="connection-note">{c.note}</p>}
                  </div>
                  <button
                    className="icon-button small"
                    aria-label={`Remove connection to ${other.name}`}
                    onClick={() => onCommand({ type: 'remove-connection', id: c.id })}
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })
          )}
          <p className="micro-note">
            These are recorded relationships. Live hardware operation and physical cable routes have
            not been verified. Photo estimates do not establish hidden wiring.
          </p>
        </section>
        {d.kind === 'monitor' && (
          <DiagnosticPanel
            key={d.id}
            device={d}
            onPropose={(p) => {
              if (p.type === 'set-status')
                return onCommand({
                  type: 'update-device',
                  id: d.id,
                  patch: { status: p.status, statusNote: p.note },
                });
            }}
          />
        )}
        {deleting ? (
          <div className="delete-confirm">
            <p>Delete this device and its associated connections?</p>
            <button
              className="button danger"
              onClick={async () => {
                if ((await onCommand({ type: 'remove-device', id: d.id })) !== false) onClose();
              }}
            >
              Confirm deletion
            </button>
            <button className="text-button" onClick={() => setDeleting(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="text-button danger-text" onClick={() => setDeleting(true)}>
            <Trash size={15} />
            Delete device
          </button>
        )}
      </div>
    </aside>
  );
}

import { useEffect, useState, type ReactNode } from 'react';
import { X, Link, Trash, Check, PencilSimple, ChatCircleDots } from '@phosphor-icons/react';
import type { ConnectionFocusPath } from '../domain/connectionView';
import { DeviceIcon } from './ui';
import { DiagnosticPanel } from './DiagnosticPanel';
import { TransformEditor } from './TransformEditor';
import { ShapeEditor } from './ShapeEditor';
import { PlacementControls } from './PlacementControls';
import { ReportedStatus } from './WorkspaceOverview';
import { deviceDetails, type useDeviceDrafts } from './useDeviceDrafts';
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
  onEdit: () => void;
  onAsk?: () => void;
  onFocusPath?: (path: ConnectionFocusPath) => void;
  onReviewConnections?: () => void;
  hardwareDetails?: ReactNode;
  drafts: ReturnType<typeof useDeviceDrafts>;
}
export function DeviceInspector({
  device: d,
  workspace,
  mode,
  onCommand,
  onClose,
  onConnect,
  onSelect,
  onEdit,
  onAsk,
  onFocusPath,
  onReviewConnections,
  hardwareDetails,
  drafts,
}: Props) {
  const draft = drafts.drafts[d.id];
  const { name, model, status, statusNote: note } = draft?.values ?? deviceDetails(d);
  const saving = draft?.saving ?? false;
  const needsReview = draft ? drafts.needsReview(draft) : false;
  const [deleting, setDeleting] = useState(false);
  const [removingConnection, setRemovingConnection] = useState<string | null>(null);
  const [removalPending, setRemovalPending] = useState(false);
  const [removalError, setRemovalError] = useState('');
  useEffect(() => {
    if (mode !== 'edit') {
      setRemovingConnection(null);
      setRemovalError('');
    }
  }, [mode]);
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
          <span className="muted">Record source</span>
        </div>
        <section className="panel-section" hidden={mode !== 'edit'}>
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
          <PlacementControls item={d} workspace={workspace} onCommand={onCommand} prefix="Device" />
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
        <div className="device-evidence-summary">
          <dl className="record-facts">
            <div>
              <dt>Model</dt>
              <dd>{d.model || 'Not recorded'}</dd>
            </div>
            <div>
              <dt>User report</dt>
              <dd>
                <ReportedStatus status={d.status} />
              </dd>
            </div>
            <div>
              <dt>Visual source</dt>
              <dd>{sourceLabels[d.visual.source]}</dd>
            </div>
          </dl>
          {d.statusNote && <p className="record-note">{d.statusNote}</p>}
        </div>
        {hardwareDetails}
        {draft && (
          <section className="device-draft-notice" aria-label="Unsaved device details">
            <strong>{saving ? 'Saving device details...' : 'Unsaved device details'}</strong>
            <p>
              Your draft stays when you switch modes, devices, or panels. Only Save changes the
              record.
            </p>
            {drafts.storageConflict && (
              <p role="alert">Load the latest saved workspace before saving. Your draft is kept.</p>
            )}
            {needsReview && !drafts.storageConflict && (
              <div className="draft-review" role="alert">
                <strong>Saved details changed. Review before saving.</strong>
                <p>Your edited operating status and its note are kept together when you review.</p>
                <dl className="record-facts">
                  <div>
                    <dt>Saved name</dt>
                    <dd>{d.name}</dd>
                  </div>
                  <div>
                    <dt>Saved model</dt>
                    <dd>{d.model || 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Saved user report</dt>
                    <dd>{statusLabels[d.status]}</dd>
                  </div>
                  <div>
                    <dt>Saved note</dt>
                    <dd>{d.statusNote || 'No note'}</dd>
                  </div>
                </dl>
                {mode === 'edit' && (
                  <button
                    className="button secondary full"
                    disabled={saving}
                    onClick={() => drafts.reviewLatest(d.id)}
                  >
                    Keep my edited fields after review
                  </button>
                )}
              </div>
            )}
            {draft.error && (
              <p className="form-error" role="alert">
                {draft.error}
              </p>
            )}
          </section>
        )}
        <div hidden={mode === 'edit'}>
          <button className="button secondary full" onClick={onEdit}>
            <PencilSimple size={16} />
            {draft ? 'Resume editing draft' : 'Edit device details'}
          </button>
        </div>
        <form
          hidden={mode !== 'edit'}
          aria-busy={saving}
          onSubmit={async (e) => {
            e.preventDefault();
            await drafts.save(d.id);
          }}
        >
          <label>
            Device name
            <input
              value={name}
              maxLength={60}
              onChange={(e) => drafts.change(d, { name: e.target.value })}
              disabled={saving}
              required
            />
          </label>
          <label>
            Model <span className="muted">optional</span>
            <input
              value={model}
              disabled={saving}
              maxLength={100}
              placeholder="Do you know the exact model?"
              onChange={(e) => drafts.change(d, { model: e.target.value })}
            />
          </label>
          <label>
            Operating status <span className="muted">user-reported</span>
            <select
              value={status}
              disabled={saving}
              onChange={(e) => drafts.change(d, { status: e.target.value as Device['status'] })}
            >
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
                disabled={saving}
                maxLength={300}
                placeholder="e.g. The screen worked after connecting it directly."
                onChange={(e) => drafts.change(d, { statusNote: e.target.value })}
              />
            </label>
          )}
          <button
            className="button secondary full"
            type="submit"
            disabled={saving || needsReview || drafts.storageConflict}
          >
            <Check size={17} />
            Save device details
          </button>
          {draft && (
            <button
              className="text-button"
              type="button"
              disabled={saving}
              onClick={() => drafts.discard(d.id)}
            >
              Discard draft
            </button>
          )}
        </form>
        <section className="panel-section">
          <div className="section-heading">
            <h3>
              Connections <span className="count">{links.length}</span>
            </h3>
            <button className="text-button" onClick={mode === 'edit' ? onConnect : onEdit}>
              <Link size={15} />
              {mode === 'edit' ? 'Add' : 'Edit connections'}
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
                  {mode === 'edit' && (
                    <button
                      className="icon-button small"
                      aria-label={`Remove connection to ${other.name}`}
                      disabled={removalPending}
                      onClick={() => {
                        setRemovingConnection(c.id);
                        setRemovalError('');
                      }}
                    >
                      <X size={15} />
                    </button>
                  )}
                  {mode === 'edit' && removingConnection === c.id && (
                    <div
                      className="connection-remove-confirm"
                      role="region"
                      aria-label={`Confirm removing connection to ${other.name}`}
                    >
                      <p>
                        Remove this recorded {c.connector} relationship with {other.name}?
                      </p>
                      <p className="micro-note">
                        This only removes the saved record. It does not disconnect hardware.
                      </p>
                      {removalError && (
                        <p className="form-error" role="alert">
                          {removalError}
                        </p>
                      )}
                      <div className="placement-actions">
                        <button
                          className="button danger"
                          disabled={removalPending}
                          onClick={async () => {
                            if (removalPending || mode !== 'edit') return;
                            setRemovalPending(true);
                            try {
                              if (await onCommand({ type: 'remove-connection', id: c.id }))
                                setRemovingConnection(null);
                              else
                                setRemovalError(
                                  'The connection was not removed. Check the storage notice and try again.',
                                );
                            } finally {
                              setRemovalPending(false);
                            }
                          }}
                        >
                          Confirm removal
                        </button>
                        <button
                          className="button secondary"
                          disabled={removalPending}
                          onClick={() => setRemovingConnection(null)}
                        >
                          Cancel removal
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <p className="micro-note">
            These are recorded relationships. Live hardware operation and physical cable routes have
            not been verified. Photo estimates do not establish hidden wiring.
          </p>
        </section>
        {onAsk && (
          <button className="button secondary full" onClick={onAsk}>
            <ChatCircleDots size={17} /> Ask about this device
          </button>
        )}
        {d.kind === 'monitor' && (
          <DiagnosticPanel
            key={d.id}
            device={d}
            workspace={workspace}
            onCommand={async (c) => (await onCommand(c)) !== false}
            onFocusPath={onFocusPath}
            onReviewConnections={onReviewConnections}
          />
        )}
        <div hidden={mode !== 'edit'}>
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
      </div>
    </aside>
  );
}

import { lazy, Suspense, useState } from 'react';
import { Check, Cube, X } from '@phosphor-icons/react';
import {
  applyCommand,
  ObjectKindSchema,
  objectKindLabels,
  kindLabels,
  type ObjectKind,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
import { Modal } from './ui';
import { PartsEditor, TransformEditor, type VisualPatch } from './TransformEditor';
const DeskCanvas = lazy(() => import('./DeskCanvas'));

export function ScenePreview({
  base,
  initialDraft,
  current,
  message,
  photo,
  onApply,
  onDiscard,
}: {
  base: Workspace;
  initialDraft: Workspace;
  current: Workspace;
  message: string;
  photo: string;
  onApply: (draft: Workspace, base: Workspace) => void;
  onDiscard: () => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [selected, setSelected] = useState<string | null>(
    initialDraft.objects[0]?.id ?? initialDraft.devices[0]?.id ?? null,
  );
  const [error, setError] = useState('');
  const items = [...draft.objects, ...draft.devices];
  const item = items.find((entry) => entry.id === selected);
  const stale = JSON.stringify(current) !== JSON.stringify(base);
  function command(c: WorkspaceCommand) {
    try {
      const next = applyCommand(draft, c);
      setDraft(next);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'Could not update the preview.');
    }
  }
  function update(patch: VisualPatch) {
    if (!item) return;
    if ('status' in item) command({ type: 'update-device', id: item.id, patch });
    else command({ type: 'update-object', id: item.id, patch });
  }
  const existing =
    !!item &&
    (base.objects.some((o) => o.id === item.id) || base.devices.some((d) => d.id === item.id));
  return (
    <Modal title="Review your desk scene" onClose={onDiscard} className="scene-preview-modal">
      <div className="preview-intro">
        <span className="preview-badge">
          <Cube size={16} />
          Unsaved preview
        </span>
        <p>{message}</p>
        <p className="micro-note">
          Adjust the estimate before applying. Existing records are retained; unused sample objects
          are replaced. Your saved workspace stays unchanged until you confirm.
        </p>
      </div>
      <div className="scene-preview-layout">
        <div className="preview-scene" aria-label="Proposed 3D scene">
          <Suspense fallback={<p>Preparing the 3D preview...</p>}>
            <DeskCanvas
              workspace={draft}
              selected={selected}
              mode="edit"
              onSelect={setSelected}
              onMove={(id, x, z) => {
                const entity = items.find((o) => o.id === id);
                if (!entity) return;
                const patch = {
                  placement: { ...entity.placement, x, z },
                  visual: { ...entity.visual, source: 'user-reported' as const },
                };
                command(
                  'status' in entity
                    ? { type: 'update-device', id, patch }
                    : { type: 'update-object', id, patch },
                );
              }}
            />
          </Suspense>
          <span className="preview-scene-note">
            Drag objects to move · Drag empty space to rotate
          </span>
        </div>
        <div className="preview-inspector">
          <details className="preview-reference">
            <summary>Reference photo</summary>
            <img src={photo} alt="Photo used for this scene proposal" />
          </details>
          <label>
            Object to edit
            <select
              aria-label="Preview object"
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value || null)}
            >
              <option value="">Select an object</option>
              {items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} · {'status' in o ? kindLabels[o.kind] : objectKindLabels[o.kind]}
                </option>
              ))}
            </select>
          </label>
          {item ? (
            <>
              <h3>{item.name}</h3>
              {existing && (
                <p className="micro-note">
                  Existing record. Identity, connections, and reported status are preserved.
                </p>
              )}
              {!('status' in item) && (
                <label>
                  Template
                  <select
                    aria-label="Preview template"
                    value={item.kind}
                    onChange={(e) =>
                      command({
                        type: 'update-object',
                        id: item.id,
                        patch: {
                          kind: e.target.value as ObjectKind,
                          parts: [],
                          visual: { ...item.visual, source: 'user-reported' },
                        },
                      })
                    }
                  >
                    {ObjectKindSchema.options.map((k) => (
                      <option key={k} value={k}>
                        {objectKindLabels[k]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <TransformEditor
                placement={item.placement}
                visual={item.visual}
                onChange={update}
                prefix="Preview object"
              />
              {!('status' in item) && item.kind === 'generic' && (
                <PartsEditor
                  parts={item.parts}
                  onChange={(parts) =>
                    command({
                      type: 'update-object',
                      id: item.id,
                      patch: {
                        parts,
                        visual: { ...item.visual, color: null, source: 'user-reported' },
                      },
                    })
                  }
                />
              )}
              {!existing && (
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    command(
                      'status' in item
                        ? { type: 'remove-device', id: item.id }
                        : { type: 'remove-object', id: item.id },
                    );
                    setSelected(null);
                  }}
                >
                  Remove from preview
                </button>
              )}
            </>
          ) : (
            <p className="muted">Select an object in the scene or the list to adjust it.</p>
          )}
        </div>
      </div>
      <div className="preview-actions">
        <p className="micro-note">
          Room shell and lighting are illustrative. Screen artwork and cable paths do not establish
          device activity or physical wiring.
        </p>
        {(error || stale) && (
          <p role="alert" className="form-error">
            {stale
              ? 'Your saved workspace changed after this preview started. Discard it and analyze again to preserve your latest edits.'
              : error}
          </p>
        )}
        <div className="preview-action-buttons">
          <button className="button secondary" onClick={onDiscard}>
            <X size={17} />
            Discard preview
          </button>
          <button
            className="button primary"
            disabled={stale}
            onClick={() => {
              try {
                onApply(draft, base);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message.split('\n')[0] : 'Could not apply this scene.',
                );
              }
            }}
          >
            <Check size={18} />
            Confirm and apply scene
          </button>
        </div>
      </div>
    </Modal>
  );
}

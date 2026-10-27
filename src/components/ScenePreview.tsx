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
import { TransformEditor, type VisualPatch } from './TransformEditor';
import { ShapeEditor } from './ShapeEditor';
import { PlacementControls } from './PlacementControls';
import {
  rebindSceneDevice,
  retainedDevices,
  type SceneDeviceObservation,
} from '../domain/sceneProposal';
const DeskCanvas = lazy(() => import('./DeskCanvas'));

export function ScenePreview({
  base,
  initialDraft,
  current,
  message,
  photo,
  onApply,
  onDiscard,
  storageConflict = false,
  initialObservations = [],
}: {
  base: Workspace;
  initialDraft: Workspace;
  current: Workspace;
  message: string;
  photo: string;
  onApply: (draft: Workspace, base: Workspace) => void | Promise<void>;
  onDiscard: () => void;
  storageConflict?: boolean;
  initialObservations?: SceneDeviceObservation[];
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [observations, setObservations] = useState(initialObservations);
  const [selected, setSelected] = useState<string | null>(
    initialDraft.objects[0]?.id ?? initialDraft.devices[0]?.id ?? null,
  );
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const items = [...draft.objects, ...draft.devices];
  const item = items.find((entry) => entry.id === selected);
  const observation = observations.find((entry) => entry.sceneId === selected);
  const stale = storageConflict || JSON.stringify(current) !== JSON.stringify(base);
  function command(c: WorkspaceCommand) {
    try {
      const next = applyCommand(draft, c);
      setDraft(next);
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message.split('\n')[0] : 'Could not update the preview.');
      return false;
    }
  }
  function update(patch: VisualPatch) {
    if (!item) return;
    if ('status' in item) return command({ type: 'update-device', id: item.id, patch });
    return command({ type: 'update-object', id: item.id, patch });
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
              onMove={(id, placement, dragPath) => {
                command({ type: 'move-object', id, placement, dragPath });
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
              {observation && (
                <label>
                  Device record
                  <select
                    aria-label="Preview device record"
                    value={observation.matchedDeviceId ?? ''}
                    onChange={(event) => {
                      try {
                        const result = rebindSceneDevice(
                          draft,
                          base,
                          observations,
                          observation.proposalId,
                          event.target.value || null,
                        );
                        setDraft(result.draft);
                        setObservations(result.observations);
                        setSelected(
                          result.observations.find(
                            (entry) => entry.proposalId === observation.proposalId,
                          )!.sceneId,
                        );
                        setError('');
                      } catch (cause) {
                        setError(
                          cause instanceof Error ? cause.message : 'Could not match this device.',
                        );
                      }
                    }}
                  >
                    <option value="">Keep as a separate new device</option>
                    {retainedDevices(base)
                      .filter((device) => device.kind === observation.kind)
                      .map((device) => (
                        <option
                          key={device.id}
                          value={device.id}
                          disabled={observations.some(
                            (entry) =>
                              entry.proposalId !== observation.proposalId &&
                              entry.matchedDeviceId === device.id,
                          )}
                        >
                          Use existing: {device.name}
                          {base.devices.filter(
                            (entry) =>
                              entry.kind === device.kind &&
                              entry.name.trim().toLowerCase() === device.name.trim().toLowerCase(),
                          ).length > 1
                            ? ` (x ${device.placement.x.toFixed(2)}, z ${device.placement.z.toFixed(2)})`
                            : ''}
                        </option>
                      ))}
                  </select>
                  <span className="micro-note">
                    This is a suggested visual match. Confirm the record to avoid duplicates; names
                    and reported status are preserved.
                  </span>
                </label>
              )}
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
                          shapeMode: 'template',
                          visual: { source: 'user-reported' },
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
              <PlacementControls
                item={item}
                workspace={draft}
                onCommand={command}
                prefix="Preview object"
              />
              <ShapeEditor
                item={item}
                onPartChange={(index, patch) =>
                  command({
                    type: 'update-part',
                    id: item.id,
                    index,
                    expectedLength: item.parts?.length ?? 0,
                    patch,
                  })
                }
                onChange={(patch) =>
                  'status' in item
                    ? command({ type: 'update-device', id: item.id, patch })
                    : command({ type: 'update-object', id: item.id, patch })
                }
              />
              {!existing && (
                <button
                  className="text-button danger-text"
                  onClick={() => {
                    command(
                      'status' in item
                        ? { type: 'remove-device', id: item.id }
                        : { type: 'remove-object', id: item.id },
                    );
                    setObservations((current) =>
                      current.filter((entry) => entry.sceneId !== item.id),
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
            disabled={stale || applying}
            onClick={async () => {
              if (applying) return;
              setApplying(true);
              try {
                await onApply(draft, base);
              } catch (e) {
                setError(
                  e instanceof Error ? e.message.split('\n')[0] : 'Could not apply this scene.',
                );
              } finally {
                setApplying(false);
              }
            }}
          >
            <Check size={18} />
            {applying ? 'Saving scene...' : 'Confirm and apply scene'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

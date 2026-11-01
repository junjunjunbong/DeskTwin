import { lazy, Suspense, useState } from 'react';
import { Check, Cube, X } from '@phosphor-icons/react';
import {
  applyCommand,
  DeviceKindSchema,
  ObjectKindSchema,
  objectKindLabels,
  kindLabels,
  type DeviceKind,
  type ObjectKind,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
import {
  retainedDevices,
  type SceneDeviceObservation,
  type SceneReviewMetadata,
} from '../domain/sceneProposal';
import {
  addSceneReviewCandidate,
  rebindSceneReviewDevice,
  refreshSceneReview,
  setSceneCandidateIncluded,
  setSceneCandidateSupport,
  validateSceneReviewForApply,
  type SceneReviewState,
} from '../domain/sceneReview';
import { getSurfaceTargets } from '../domain/spatial';
import { photoReviewPresets } from '../domain/photoPresets';
import { Modal } from './ui';
import { CommitTextInput } from './CommitInput';
import { TransformEditor, type VisualPatch } from './TransformEditor';
import { ShapeEditor } from './ShapeEditor';
import { PlacementControls } from './PlacementControls';
import { PreviewObjectList, previewKindLabel } from './PreviewObjectList';
import { PreviewPhotoReference } from './PreviewPhotoReference';
const DeskCanvas = lazy(() => import('./DeskCanvas'));

type Selection =
  { proposalId: string; sceneId?: never } | { sceneId: string; proposalId?: never } | null;

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
  initialCandidates,
  initialIssues,
}: {
  base: Workspace;
  initialDraft: Workspace;
  current: Workspace;
  message: string;
  photo: string;
  onApply: (draft: Workspace, base: Workspace, review: SceneReviewMetadata) => void | Promise<void>;
  onDiscard: () => void;
  storageConflict?: boolean;
  initialObservations?: SceneDeviceObservation[];
  initialCandidates: SceneReviewState['candidates'];
  initialIssues: SceneReviewState['issues'];
}) {
  const [review, setReview] = useState<SceneReviewState>({
    draft: initialDraft,
    observations: initialObservations,
    candidates: initialCandidates,
    issues: initialIssues,
  });
  const [selection, setSelection] = useState<Selection>(
    initialCandidates[0]
      ? { proposalId: initialCandidates[0].proposalId }
      : initialDraft.objects[0] || initialDraft.devices[0]
        ? { sceneId: (initialDraft.objects[0] ?? initialDraft.devices[0]).id }
        : null,
  );
  const [error, setError] = useState('');
  const [applying, setApplying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<DeviceKind | ObjectKind>('generic');
  const [newPreset, setNewPreset] = useState('');
  const { draft, observations, candidates, issues } = review;
  const candidate = candidates.find((entry) => entry.proposalId === selection?.proposalId);
  const selected = candidate
    ? candidate.included
      ? candidate.sceneId
      : null
    : (selection?.sceneId ?? null);
  const items = [...draft.objects, ...draft.devices];
  const item = items.find((entry) => entry.id === selected);
  const observation = observations.find((entry) => entry.sceneId === selected);
  const unresolved = observations.filter((entry) => entry.needsRecordChoice);
  const itemIssues = issues.filter((issue) => issue.itemId === selected);
  const supportTargets = item ? getSurfaceTargets(draft, item.id) : [];
  const intendedSupportId = candidate?.supportId
    ? (candidates.find((entry) => entry.proposalId === candidate.supportId && entry.included)
        ?.sceneId ?? candidate.supportId)
    : '';
  const stale = storageConflict || JSON.stringify(current) !== JSON.stringify(base);
  const existing =
    !!item && [...base.objects, ...base.devices].some((entry) => entry.id === item.id);
  const canChangeDeviceKind =
    !!item && 'status' in item && !!candidate && !candidate.matchedSceneId && !existing;

  function selectScene(id: string | null) {
    const represented = candidates.find((entry) => entry.included && entry.sceneId === id);
    setSelection(
      represented ? { proposalId: represented.proposalId } : id ? { sceneId: id } : null,
    );
  }
  function changeReview(change: (state: SceneReviewState) => SceneReviewState) {
    try {
      const next = change(review);
      setReview(next);
      setError('');
      return next;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message.split('\n')[0] : 'Could not update the preview.',
      );
      return false;
    }
  }
  function command(c: WorkspaceCommand) {
    return !!changeReview((state) => {
      let next = refreshSceneReview(state, base, applyCommand(state.draft, c));
      if (c.type === 'snap-object' || (c.type === 'attach-object' && c.parentId)) {
        const changedCandidate = next.candidates.find(
          (entry) => entry.included && entry.sceneId === c.id,
        );
        if (changedCandidate)
          next = setSceneCandidateSupport(
            next,
            base,
            changedCandidate.proposalId,
            c.type === 'snap-object' ? c.surfaceId : c.parentId,
          );
      }
      return next;
    });
  }
  function update(patch: VisualPatch) {
    if (!item) return false;
    return command(
      'status' in item
        ? { type: 'update-device', id: item.id, patch }
        : { type: 'update-object', id: item.id, patch },
    );
  }
  function include(proposalId: string, included: boolean) {
    if (changeReview((state) => setSceneCandidateIncluded(state, base, proposalId, included)))
      setSelection({ proposalId });
  }

  return (
    <Modal title="Review your desk scene" onClose={onDiscard} className="scene-preview-modal">
      <div className="preview-intro">
        <span className="preview-badge">
          <Cube size={16} />
          Unsaved preview
        </span>
        <p>{message}</p>
        <p className="micro-note">
          Review each photo estimate, exclude mistakes, or add anything missed. Excluding a match
          keeps its saved record. Your workspace stays unchanged until you confirm.
        </p>
      </div>
      <div className="scene-preview-layout">
        <div className="preview-scene" aria-label="Proposed 3D scene">
          <Suspense fallback={<p>Preparing the 3D preview...</p>}>
            <DeskCanvas
              workspace={draft}
              selected={selected}
              mode="edit"
              onSelect={selectScene}
              onMove={(id, placement, dragPath) => {
                command({ type: 'move-object', id, placement, dragPath });
              }}
            />
          </Suspense>
          <PreviewPhotoReference photo={photo} candidate={candidate} />
          <span className="preview-scene-note">
            Drag objects to move · Drag empty space to rotate
          </span>
        </div>
        <div className="preview-inspector">
          <PreviewObjectList
            candidates={candidates}
            draft={draft}
            selectedProposalId={selection?.proposalId ?? null}
            selectedSceneId={selected}
            onSelectCandidate={(proposalId) => setSelection({ proposalId })}
            onSelectSaved={(sceneId) => setSelection({ sceneId })}
            onInclude={include}
            onAdd={() => setAdding((value) => !value)}
          />
          <div className="preview-edit-controls" aria-label="Selected preview object">
            {adding && (
              <form
                className="preview-add-form"
                aria-label="Add missing preview object"
                onSubmit={(event) => {
                  event.preventDefault();
                  const next = changeReview((state) =>
                    addSceneReviewCandidate(state, base, {
                      kind: newKind,
                      name: newName.trim() || previewKindLabel(newKind),
                      presetId: newPreset || undefined,
                    }),
                  );
                  if (next) {
                    setSelection({ proposalId: next.candidates.at(-1)!.proposalId });
                    setNewName('');
                    setAdding(false);
                  }
                }}
              >
                <h3>Add an object the photo missed</h3>
                <label>
                  Name
                  <input
                    aria-label="Missing object name"
                    maxLength={60}
                    value={newName}
                    placeholder={previewKindLabel(newKind)}
                    onChange={(event) => setNewName(event.target.value)}
                  />
                </label>
                <label>
                  Type
                  <select
                    aria-label="Missing object type"
                    value={newKind}
                    onChange={(event) => {
                      setNewKind(event.target.value as DeviceKind | ObjectKind);
                      setNewPreset('');
                    }}
                  >
                    <optgroup label="Devices">
                      {DeviceKindSchema.options.map((kind) => (
                        <option key={kind} value={kind}>
                          {kindLabels[kind]}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Furniture and objects">
                      {ObjectKindSchema.options.map((kind) => (
                        <option key={kind} value={kind}>
                          {objectKindLabels[kind]}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                <label>
                  Visual preset
                  <select
                    aria-label="Missing object preset"
                    value={newPreset}
                    onChange={(event) => setNewPreset(event.target.value)}
                  >
                    <option value="">Standard template</option>
                    {photoReviewPresets
                      .filter((preset) => preset.kind === newKind)
                      .map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.label}
                        </option>
                      ))}
                  </select>
                </label>
                <p className="micro-note">
                  Added by you as an editable visual approximation. A device starts with unknown
                  operating status.
                </p>
                <div className="placement-actions">
                  <button type="submit" className="button secondary">
                    Add to preview
                  </button>
                  <button type="button" className="text-button" onClick={() => setAdding(false)}>
                    Cancel addition
                  </button>
                </div>
              </form>
            )}
            <label>
              Object to edit
              <select
                aria-label="Preview object"
                value={selected ?? ''}
                onChange={(event) => selectScene(event.target.value || null)}
              >
                <option value="">Select an object</option>
                {items.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name} · {previewKindLabel(entry.kind)}
                  </option>
                ))}
              </select>
            </label>
            {candidate && !candidate.included ? (
              <section className="preview-excluded-note" aria-label="Excluded preview object">
                <h3>{candidate.proposedName}</h3>
                <p>This candidate is excluded. Its preview edits are kept so you can restore it.</p>
                {candidate.matchedSceneId && (
                  <p className="micro-note">
                    The original saved record remains, with its connections and reported status.
                  </p>
                )}
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => include(candidate.proposalId, true)}
                >
                  Restore to preview
                </button>
              </section>
            ) : item ? (
              <div key={item.id}>
                <h3>{item.name}</h3>
                <p className="preview-source-note">
                  {candidate
                    ? candidate.source === 'photo-inferred'
                      ? 'Photo estimate · review required'
                      : 'Added by you · unsaved'
                    : 'Saved record retained'}
                </p>
                <label>
                  Name
                  <CommitTextInput
                    aria-label="Preview object name"
                    maxLength={60}
                    value={item.name}
                    disabled={existing && 'status' in item}
                    onCommit={(name) =>
                      command(
                        'status' in item
                          ? { type: 'update-device', id: item.id, patch: { name } }
                          : { type: 'update-object', id: item.id, patch: { name } },
                      )
                    }
                  />
                </label>
                {observation && (
                  <label>
                    Device record
                    <select
                      aria-label="Preview device record"
                      aria-invalid={observation.needsRecordChoice}
                      aria-describedby={
                        observation.needsRecordChoice ? 'scene-record-choice-help' : undefined
                      }
                      value={
                        observation.needsRecordChoice
                          ? ':choose-record'
                          : (observation.matchedDeviceId ?? '')
                      }
                      onChange={(event) => {
                        if (event.target.value !== ':choose-record')
                          changeReview((state) =>
                            rebindSceneReviewDevice(
                              state,
                              base,
                              observation.proposalId,
                              event.target.value || null,
                            ),
                          );
                      }}
                    >
                      {observation.needsRecordChoice && (
                        <option value=":choose-record" disabled>
                          Choose an existing or separate new device
                        </option>
                      )}
                      <option value="">Keep as a separate new device</option>
                      {retainedDevices(base)
                        .filter((device) => device.kind === item.kind)
                        .map((device) => (
                          <option
                            key={device.id}
                            value={device.id}
                            disabled={candidates.some(
                              (entry) =>
                                entry.proposalId !== observation.proposalId &&
                                entry.matchedSceneId === device.id,
                            )}
                          >
                            Use existing: {device.name}
                            {base.devices.filter(
                              (entry) =>
                                entry.kind === device.kind &&
                                entry.name.trim().toLowerCase() ===
                                  device.name.trim().toLowerCase(),
                            ).length > 1
                              ? ` (x ${device.placement.x.toFixed(2)}, z ${device.placement.z.toFixed(2)})`
                              : ''}
                          </option>
                        ))}
                    </select>
                    <span className="micro-note">
                      {observation.needsRecordChoice
                        ? 'An existing device has the same type. Choose its record or explicitly keep a separate new device to avoid duplicates.'
                        : 'This is a suggested visual match. Correct its record if needed; saved reports and connections are preserved.'}
                    </span>
                  </label>
                )}
                {existing && (
                  <p className="micro-note">
                    Existing record. Identity, connections, and reported status are preserved. Saved
                    device names and types stay with their records.
                  </p>
                )}
                {(!('status' in item) || canChangeDeviceKind) && (
                  <label>
                    Template
                    <select
                      aria-label="Preview template"
                      value={item.kind}
                      onChange={(event) =>
                        command(
                          'status' in item
                            ? {
                                type: 'update-device',
                                id: item.id,
                                patch: {
                                  kind: event.target.value as DeviceKind,
                                  parts: [],
                                  shapeMode: 'template',
                                  visual: { source: 'user-reported' },
                                },
                              }
                            : {
                                type: 'update-object',
                                id: item.id,
                                patch: {
                                  kind: event.target.value as ObjectKind,
                                  parts: [],
                                  shapeMode: 'template',
                                  visual: { source: 'user-reported' },
                                },
                              },
                        )
                      }
                    >
                      {('status' in item ? DeviceKindSchema.options : ObjectKindSchema.options).map(
                        (kind) => (
                          <option key={kind} value={kind}>
                            {previewKindLabel(kind)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                {itemIssues.length > 0 && (
                  <section
                    className="preview-placement-issues"
                    aria-label="Selected object review issues"
                  >
                    <h4>Placement needs review</h4>
                    <ul>
                      {itemIssues.map((issue, index) => (
                        <li key={`${issue.code}-${index}`}>{issue.message}</li>
                      ))}
                    </ul>
                    <p>
                      Choose the intended support, then adjust position or size to clear overlaps.
                    </p>
                  </section>
                )}
                {candidate && (
                  <label>
                    Intended support
                    <select
                      aria-label="Preview intended support"
                      value={intendedSupportId}
                      onChange={(event) =>
                        changeReview((state) =>
                          setSceneCandidateSupport(
                            state,
                            base,
                            candidate.proposalId,
                            event.target.value || null,
                          ),
                        )
                      }
                    >
                      <option value="">Infer from current placement</option>
                      {intendedSupportId &&
                        !supportTargets.some((surface) => surface.id === intendedSupportId) && (
                          <option value={intendedSupportId}>Original support (unavailable)</option>
                        )}
                      {supportTargets.map((surface) => (
                        <option key={surface.id} value={surface.id}>
                          {surface.name}
                        </option>
                      ))}
                    </select>
                    <span className="micro-note">
                      Choosing a support adjusts height without moving the object to a different
                      surface to hide an overlap.
                    </span>
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
                    command(
                      'status' in item
                        ? { type: 'update-device', id: item.id, patch }
                        : { type: 'update-object', id: item.id, patch },
                    )
                  }
                />
                {candidate && (
                  <button
                    className="text-button danger-text"
                    type="button"
                    onClick={() => include(candidate.proposalId, false)}
                  >
                    Remove from preview
                  </button>
                )}
              </div>
            ) : (
              <p className="muted">Select an object in the scene or the list to adjust it.</p>
            )}
          </div>
        </div>
      </div>
      <div className="preview-actions">
        <p className="micro-note">
          Room shell and lighting are illustrative. Screen artwork and cable paths do not establish
          device activity or physical wiring.
        </p>
        {unresolved.length > 0 && (
          <div className="inference-note" role="status" id="scene-record-choice-help">
            <p>
              Choose a device record for {unresolved.length} photo{' '}
              {unresolved.length === 1 ? 'object' : 'objects'} before applying. Select an existing
              device or explicitly keep a separate new device. Your recorded connections stay
              unchanged.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => selectScene(unresolved[0].sceneId)}
            >
              Review device record
            </button>
          </div>
        )}
        {issues.length > 0 && (
          <div className="preview-issues-summary" role="status">
            <p>
              {issues.length} placement {issues.length === 1 ? 'issue needs' : 'issues need'} review
              before applying. Fix the intended support or placement, or exclude the candidate.
            </p>
            <button
              type="button"
              className="text-button"
              onClick={() => selectScene(issues[0].itemId)}
            >
              Review placement issue
            </button>
          </div>
        )}
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
            disabled={stale || applying || unresolved.length > 0 || issues.length > 0}
            onClick={async () => {
              if (applying || stale || unresolved.length > 0 || issues.length > 0) return;
              setApplying(true);
              try {
                validateSceneReviewForApply(review, base);
                await onApply(draft, base, { candidates, observations });
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message.split('\n')[0]
                    : 'Could not apply this scene.',
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

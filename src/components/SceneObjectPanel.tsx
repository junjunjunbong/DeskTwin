import { useState } from 'react';
import { Cube, Plus, Trash, X, PencilSimple } from '@phosphor-icons/react';
import {
  createSceneObject,
  ObjectKindSchema,
  objectKindLabels,
  kindLabels,
  sourceLabels,
  type SceneObject,
  type SceneObjectPatch,
  type Workspace,
  type WorkspaceCommand,
  type ObjectKind,
} from '../domain/workspace';
import { DeviceIcon, Modal } from './ui';
import { TransformEditor } from './TransformEditor';
import { ShapeEditor } from './ShapeEditor';
import { PlacementControls } from './PlacementControls';
import { CommitTextInput } from './CommitInput';

export function SceneObjectList({
  workspace,
  onSelect,
  onClose,
  onAdd,
}: {
  workspace: Workspace;
  onSelect: (id: string) => void;
  onClose: () => void;
  onAdd: () => void;
}) {
  const [search, setSearch] = useState('');
  return (
    <aside className="floating-panel" aria-label="Scene objects panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h2>
            Scene objects{' '}
            <span className="count">{workspace.objects.length + workspace.devices.length}</span>
          </h2>
        </div>
        <button className="icon-button" aria-label="Close scene objects" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="panel-scroll">
        <input
          className="search-input"
          aria-label="Search scene objects"
          placeholder="Search furniture, devices, decor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {!workspace.appearance.decor && (
          <p className="inference-note">
            Decor is hidden. Turn it on in settings to see furniture and props.
          </p>
        )}
        {[...workspace.objects, ...workspace.devices]
          .filter((o) => `${o.name} ${o.kind}`.toLowerCase().includes(search.toLowerCase()))
          .map((o) => (
            <button className="device-list-row" key={o.id} onClick={() => onSelect(o.id)}>
              <span className="list-device-glyph">
                {'status' in o ? <DeviceIcon kind={o.kind} size={24} /> : <Cube size={24} />}
              </span>
              <span>
                <strong>{o.name}</strong>
                <small>
                  {'status' in o ? kindLabels[o.kind] : objectKindLabels[o.kind]} ·{' '}
                  {sourceLabels[o.visual.source]}
                </small>
              </span>
            </button>
          ))}
        <button
          className="button secondary full"
          disabled={workspace.objects.length >= 60}
          onClick={onAdd}
        >
          <Plus size={18} />
          Add an object
        </button>
      </div>
      <div className="panel-footnote">
        Select an object to inspect it. Switch to Edit to change placement, size, color, and shape.
      </div>
    </aside>
  );
}

export function SceneObjectInspector({
  object,
  workspace,
  mode,
  onCommand,
  onClose,
  onEdit,
}: {
  object: SceneObject;
  workspace: Workspace;
  mode: string;
  onEdit: () => void;
  onCommand: (command: WorkspaceCommand) => void | boolean | Promise<boolean>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const update = (patch: SceneObjectPatch) =>
    onCommand({ type: 'update-object', id: object.id, patch });
  return (
    <aside className="floating-panel inspector" aria-label="Selected scene object">
      <div className="panel-heading">
        <div className="device-heading">
          <span className="device-glyph">
            <Cube size={29} />
          </span>
          <div>
            <span className="eyebrow">{objectKindLabels[object.kind]}</span>
            <h2>{object.name}</h2>
          </div>
        </div>
        <button className="icon-button" aria-label="Close object details" onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      <div className="panel-scroll">
        <div hidden={mode === 'edit'}>
          <dl className="record-facts">
            <div>
              <dt>Template</dt>
              <dd>{objectKindLabels[object.kind]}</dd>
            </div>
            <div>
              <dt>Visual source</dt>
              <dd>{sourceLabels[object.visual.source]}</dd>
            </div>
            <div>
              <dt>Attachment</dt>
              <dd>
                {object.attachment
                  ? workspace.objects.find((item) => item.id === object.attachment?.parentId)
                      ?.name || 'Desk'
                  : 'Independent object'}
              </dd>
            </div>
          </dl>
          {object.visual.note && <p className="record-note">{object.visual.note}</p>}
          <p className="micro-note">
            Furniture and props have no operating status. Shape and placement are editable
            approximations.
          </p>
          <button className="button secondary full" onClick={onEdit}>
            <PencilSimple size={16} />
            Edit selected object
          </button>
        </div>
        <div hidden={mode !== 'edit'}>
          <label>
            Object name
            <CommitTextInput
              aria-label="Object name"
              maxLength={60}
              value={object.name}
              onCommit={(name) => update({ name })}
            />
          </label>
          <label>
            Template
            <select
              aria-label="Object template"
              value={object.kind}
              onChange={(e) =>
                update({
                  kind: e.target.value as ObjectKind,
                  parts: [],
                  shapeMode: 'template',
                  visual: { source: 'user-reported' },
                })
              }
            >
              {ObjectKindSchema.options.map((kind) => (
                <option key={kind} value={kind}>
                  {objectKindLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          <TransformEditor placement={object.placement} visual={object.visual} onChange={update} />
          <PlacementControls item={object} workspace={workspace} onCommand={onCommand} />
          <ShapeEditor
            item={object}
            onChange={update}
            onPartChange={(index, patch) =>
              onCommand({
                type: 'update-part',
                id: object.id,
                index,
                expectedLength: object.parts.length,
                patch,
              })
            }
          />
          <p className="micro-note">
            Furniture and props have no operating status. Templates and dimensions are editable
            approximations.
          </p>
          {deleting ? (
            <div className="delete-confirm">
              <p>Delete this object? You can undo this change.</p>
              <button
                className="button danger"
                onClick={async () => {
                  if ((await onCommand({ type: 'remove-object', id: object.id })) !== false)
                    onClose();
                }}
              >
                Confirm object deletion
              </button>
              <button className="text-button" onClick={() => setDeleting(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="text-button danger-text" onClick={() => setDeleting(true)}>
              <Trash size={15} />
              Delete object
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

export function AddObjectDialog({
  onClose,
  onCommand,
}: {
  onClose: () => void;
  onCommand: (command: WorkspaceCommand) => void | boolean | Promise<boolean>;
}) {
  const [kind, setKind] = useState<ObjectKind>('plant');
  const [name, setName] = useState('');
  return (
    <Modal title="Add scene object" onClose={onClose}>
      <p className="muted">Choose a voxel template or build a generic object from boxes.</p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const object = createSceneObject(kind);
          if (name.trim()) object.name = name.trim();
          if ((await onCommand({ type: 'add-object', object })) !== false) onClose();
        }}
      >
        <label>
          Template
          <select
            aria-label="New object template"
            value={kind}
            onChange={(e) => setKind(e.target.value as ObjectKind)}
          >
            {ObjectKindSchema.options.map((k) => (
              <option value={k} key={k}>
                {objectKindLabels[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Object name
          <input
            aria-label="New object name"
            value={name}
            maxLength={60}
            placeholder={objectKindLabels[kind]}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="button primary full" type="submit">
          <Plus size={18} />
          Add object to scene
        </button>
      </form>
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { getRestingSurfaceId, getSurfaceTargets } from '../domain/spatial';
import type { Device, SceneObject, Workspace, WorkspaceCommand } from '../domain/workspace';

/** Surface placement and attachment are deliberate, undoable scene edits. */
export function PlacementControls({
  item,
  workspace,
  onCommand,
  prefix = 'Object',
}: {
  item: Device | SceneObject;
  workspace: Workspace;
  onCommand: (command: WorkspaceCommand) => unknown;
  prefix?: string;
}) {
  const desks = workspace.objects.filter(
    (object) => object.kind === 'desk' && object.id !== item.id,
  );
  const parentId = item.attachment?.parentId ?? null;
  const parent = desks.find((desk) => desk.id === parentId);
  const targets = getSurfaceTargets(workspace, item.id);
  const [surface, setSurface] = useState(getRestingSurfaceId(workspace, item.id) ?? parentId ?? '');
  useEffect(() => {
    setSurface(getRestingSurfaceId(workspace, item.id) ?? parentId ?? '');
  }, [item.id, parentId]);
  useEffect(() => {
    if (surface && !targets.some((target) => target.id === surface)) setSurface('');
  }, [targets, surface]);
  return (
    <section className="placement-controls" aria-label={`${prefix} surface and attachment`}>
      <h3>Surface and attachment</h3>
      <label>
        Place on
        <select
          aria-label={`${prefix} surface`}
          value={surface}
          onChange={(e) => setSurface(e.target.value)}
        >
          <option value="">Choose a support surface</option>
          {targets.map((target) => (
            <option key={target.id} value={target.id}>
              {target.name}
            </option>
          ))}
        </select>
      </label>
      <div className="placement-actions">
        <button
          type="button"
          className="button secondary"
          disabled={!surface}
          onClick={() => onCommand({ type: 'snap-object', id: item.id, surfaceId: surface })}
        >
          Place on surface
        </button>
        {desks.some((desk) => desk.id === surface) &&
          item.kind !== 'desk' &&
          parentId !== surface && (
            <button
              type="button"
              className="button secondary"
              onClick={() => onCommand({ type: 'attach-object', id: item.id, parentId: surface })}
            >
              Attach to desk
            </button>
          )}
        {parentId && (
          <button
            type="button"
            className="text-button"
            onClick={() => onCommand({ type: 'attach-object', id: item.id, parentId: null })}
          >
            Detach from desk
          </button>
        )}
      </div>
      <p className="micro-note">
        {parent
          ? `Attached to ${parent.name}. Moving or rotating the desk carries this object. You can still adjust it separately or detach it.`
          : 'Place objects on a floor, desk, mat, riser, or stand. Attach an object to a desk to carry it with the desk.'}
      </p>
      <p className="micro-note">
        Blocked edits keep the last valid placement. Surface placement does not change device
        connections.
      </p>
      {!workspace.appearance.decor && (
        <p className="inference-note">
          Hidden decor still occupies space. Show furniture and decor in Settings to see obstacles.
        </p>
      )}
    </section>
  );
}

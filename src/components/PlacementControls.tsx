import { useEffect, useState } from 'react';
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
  const [surface, setSurface] = useState(
    parentId ?? (item.placement.y > 1 ? desks[0]?.id : null) ?? 'floor',
  );
  useEffect(() => {
    if (surface !== 'floor' && !desks.some((desk) => desk.id === surface)) setSurface('floor');
  }, [desks, surface]);
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
          <option value="floor">Floor</option>
          {desks.map((desk) => (
            <option key={desk.id} value={desk.id}>
              {desk.name}
            </option>
          ))}
        </select>
      </label>
      <div className="placement-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => onCommand({ type: 'snap-object', id: item.id, surfaceId: surface })}
        >
          Place on surface
        </button>
        {surface !== 'floor' && item.kind !== 'desk' && parentId !== surface && (
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
          : 'Dragging snaps to nearby floor or desk surfaces. Attach an object to a desk to carry it with the desk.'}
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

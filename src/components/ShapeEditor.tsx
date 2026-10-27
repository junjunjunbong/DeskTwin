import type { Device, SceneObject, BoxPart, VisualUpdate, BoxPartPatch } from '../domain/workspace';
import { getTemplateParts } from '../domain/geometry';
import { PartsEditor } from './TransformEditor';

export type ShapePatch = {
  parts: BoxPart[];
  shapeMode: 'template' | 'custom';
  visual: VisualUpdate;
};

export function ShapeEditor({
  item,
  onChange,
  onPartChange,
}: {
  item: Device | SceneObject;
  onChange: (patch: ShapePatch) => unknown;
  onPartChange: (index: number, patch: BoxPartPatch) => unknown;
}) {
  const custom =
    item.shapeMode === 'custom' ||
    (item.kind === 'generic' && item.shapeMode !== 'template' && !!item.parts?.length);
  const parts = item.parts ?? [];
  return (
    <section className="shape-editor" aria-label="Voxel shape editor">
      <h3>Voxel shape</h3>
      <p className="micro-note">
        Start with the current template, then change its boxes or add your own. The same shape is
        used for rendering and collision checks.
      </p>
      {custom ? (
        <>
          <PartsEditor
            parts={parts}
            onPartChange={onPartChange}
            onChange={(next) =>
              onChange({
                parts: next,
                shapeMode: 'custom',
                visual: { source: 'user-reported' },
              })
            }
          />
          <button
            type="button"
            className="text-button"
            onClick={() =>
              onChange({ parts: [], shapeMode: 'template', visual: { source: 'user-reported' } })
            }
          >
            Restore template shape
          </button>
          <p className="micro-note">
            Restoring the template is undoable. Editing a part color clears the overall tint.
          </p>
        </>
      ) : (
        <button
          type="button"
          className="button secondary full"
          onClick={() =>
            onChange({
              parts: getTemplateParts(item.kind),
              shapeMode: 'custom',
              visual: { source: 'user-reported' },
            })
          }
        >
          Customize template shape
        </button>
      )}
    </section>
  );
}

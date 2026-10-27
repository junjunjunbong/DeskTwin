import { useState } from 'react';
import type {
  Placement,
  Visual,
  BoxPart,
  PlacementPatch,
  VisualUpdate,
  BoxPartPatch,
} from '../domain/workspace';
import { sourceLabels } from '../domain/workspace';
import { CommitNumberInput } from './CommitInput';
import { RangeInput } from './RangeInput';

export type VisualPatch = { placement?: PlacementPatch; visual?: VisualUpdate };

export function TransformEditor({
  placement,
  visual,
  onChange,
  prefix = 'Object',
}: {
  placement: Placement;
  visual: Visual;
  onChange: (patch: VisualPatch) => unknown;
  prefix?: string;
}) {
  const edited = { source: 'user-reported' as const };
  const positions = [
    { axis: 'x', label: 'Left / right', min: -4.3, max: 4.3 },
    { axis: 'y', label: 'Height', min: 0, max: 5.5 },
    { axis: 'z', label: 'Front / back', min: -1.9, max: 3.7 },
    { axis: 'rotation', label: 'Rotation', min: -180, max: 180 },
  ] as const;
  return (
    <div className="transform-editor">
      <p className="micro-note">
        Position and size use scene units. These are editable approximations.
      </p>
      {positions.map(({ axis, label, min, max }) => (
        <label className="range-label" key={axis}>
          {label}
          <output>
            {Number(placement[axis].toFixed(4))}
            {axis === 'rotation' ? '°' : ''}
          </output>
          <RangeInput
            aria-label={`${prefix} ${axis === 'rotation' ? 'rotation' : `${label.toLowerCase()} position`}`}
            min={min}
            max={max}
            step={axis === 'rotation' ? 1 : 0.01}
            // Match the browser's native step normalization without rounding the
            // saved geometry. Otherwise React's async controlled-value restore
            // can make the final change event look like a second, stale edit.
            value={placement[axis]}
            onCommit={(value) => {
              return onChange({
                placement: { [axis]: value },
                visual: edited,
              });
            }}
          />
        </label>
      ))}
      <div className="three-columns">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <label key={axis}>
            {['Width', 'Height', 'Depth'][i]} scale
            <CommitNumberInput
              aria-label={`${prefix} ${['width', 'height', 'depth'][i]} scale`}
              min={0.1}
              max={3}
              step={0.05}
              value={visual.scale[axis]}
              onCommit={(value) => onChange({ visual: { ...edited, scale: { [axis]: value } } })}
            />
          </label>
        ))}
      </div>
      <div className="object-color-row">
        <label>
          Primary color
          <input
            type="color"
            aria-label={`${prefix} color`}
            value={(visual.color ?? '#8b9ba4').toLowerCase()}
            onChange={(e) => onChange({ visual: { ...edited, color: e.target.value } })}
          />
        </label>
        <button
          className="text-button"
          type="button"
          disabled={visual.color === null}
          onClick={() => onChange({ visual: { ...edited, color: null } })}
        >
          Use template colors
        </button>
      </div>
      <p className="micro-note">Visual properties: {sourceLabels[visual.source]}.</p>
      {visual.note && <p className="inference-note">Original estimate: {visual.note}</p>}
    </div>
  );
}

export function PartsEditor({
  parts,
  onChange,
  onPartChange,
}: {
  parts: BoxPart[];
  onChange: (parts: BoxPart[]) => unknown;
  onPartChange: (index: number, patch: BoxPartPatch) => unknown;
}) {
  const [selection, setSelection] = useState(0);
  const index = Math.min(selection, Math.max(0, parts.length - 1));
  const part = parts[index];
  function change(patch: BoxPartPatch) {
    return onPartChange(index, patch);
  }
  return (
    <details className="parts-editor" open>
      <summary>Box composition ({parts.length} parts)</summary>
      <p className="micro-note">
        Edit local box position, size, rotation and color. Up to 128 parts; parts within the same
        object may overlap.
      </p>
      <label>
        Part to edit
        <select
          aria-label="Shape part"
          value={index}
          onChange={(event) => setSelection(Number(event.target.value))}
        >
          {parts.map((_, i) => (
            <option key={i} value={i}>
              Box {i + 1}
            </option>
          ))}
        </select>
      </label>
      {part && (
        <fieldset key={index}>
          <legend>Box {index + 1}</legend>
          {(['size', 'position', 'rotation'] as const).map((group) => (
            <div className="three-columns" key={group}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis}>
                  {group} {axis}
                  {group === 'rotation' ? ' (°)' : ''}
                  <CommitNumberInput
                    step={group === 'rotation' ? 1 : 0.01}
                    value={part[group]?.[axis] ?? 0}
                    aria-label={`Box ${index + 1} ${group} ${axis}`}
                    min={group === 'size' ? 0.005 : group === 'rotation' ? -180 : -6}
                    max={group === 'size' ? 10 : group === 'rotation' ? 180 : 6}
                    onCommit={(n) => change({ [group]: { [axis]: n } })}
                  />
                </label>
              ))}
            </div>
          ))}
          <div className="object-color-row">
            <label>
              Part color
              <input
                type="color"
                aria-label={`Box ${index + 1} color`}
                value={part.color.toLowerCase()}
                onChange={(event) => change({ color: event.target.value })}
              />
            </label>
            <button
              type="button"
              className="text-button danger-text"
              disabled={parts.length <= 1}
              onClick={() => onChange(parts.filter((_, i) => i !== index))}
            >
              Remove box {index + 1}
            </button>
          </div>
        </fieldset>
      )}
      <div className="placement-actions">
        <button
          type="button"
          className="button secondary"
          disabled={parts.length >= 128}
          onClick={async () => {
            const changed = await onChange([
              ...parts,
              {
                position: { x: 0, y: 0.3, z: 0 },
                size: { x: 0.6, y: 0.6, z: 0.6 },
                color: '#8b9ba4',
              },
            ]);
            if (changed !== false) setSelection(parts.length);
          }}
        >
          Add box
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={!part || parts.length >= 128}
          onClick={async () => {
            const changed = await onChange([...parts, structuredClone(part)]);
            if (changed !== false) setSelection(parts.length);
          }}
        >
          Duplicate box
        </button>
      </div>
    </details>
  );
}

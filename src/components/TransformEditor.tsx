import type { Placement, Visual, BoxPart } from '../domain/workspace';
import { sourceLabels } from '../domain/workspace';

export type VisualPatch = { placement?: Placement; visual?: Visual };

export function TransformEditor({
  placement,
  visual,
  onChange,
  prefix = 'Object',
}: {
  placement: Placement;
  visual: Visual;
  onChange: (patch: VisualPatch) => void;
  prefix?: string;
}) {
  const edited = { ...visual, source: 'user-reported' as const };
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
            {placement[axis]}
            {axis === 'rotation' ? '°' : ''}
          </output>
          <input
            type="range"
            aria-label={`${prefix} ${axis === 'rotation' ? 'rotation' : `${label.toLowerCase()} position`}`}
            min={min}
            max={max}
            step={axis === 'rotation' ? 1 : 0.01}
            value={placement[axis]}
            onChange={(e) =>
              onChange({
                placement: { ...placement, [axis]: Number(e.target.value) },
                visual: edited,
              })
            }
          />
        </label>
      ))}
      <div className="three-columns">
        {(['x', 'y', 'z'] as const).map((axis, i) => (
          <label key={axis}>
            {['Width', 'Height', 'Depth'][i]} scale
            <input
              type="number"
              aria-label={`${prefix} ${['width', 'height', 'depth'][i]} scale`}
              min={0.1}
              max={3}
              step={0.05}
              value={visual.scale[axis]}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (Number.isFinite(value) && value >= 0.1 && value <= 3)
                  onChange({ visual: { ...edited, scale: { ...visual.scale, [axis]: value } } });
              }}
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
            value={visual.color ?? '#8b9ba4'}
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
}: {
  parts: BoxPart[];
  onChange: (parts: BoxPart[]) => void;
}) {
  function change(index: number, part: BoxPart) {
    onChange(parts.map((p, i) => (i === index ? part : p)));
  }
  return (
    <details className="parts-editor">
      <summary>Box composition ({parts.length || 'default box'})</summary>
      <p className="micro-note">Build an approximate object from up to 16 boxes.</p>
      {parts.map((part, index) => (
        <fieldset key={index}>
          <legend>Box {index + 1}</legend>
          {(['size', 'position'] as const).map((group) => (
            <div className="three-columns" key={group}>
              {(['x', 'y', 'z'] as const).map((axis) => (
                <label key={axis}>
                  {group} {axis}
                  <input
                    type="number"
                    step={0.05}
                    value={part[group][axis]}
                    aria-label={`Box ${index + 1} ${group} ${axis}`}
                    min={group === 'size' ? 0.02 : -3}
                    max={group === 'size' ? 6 : 3}
                    onChange={(e) => {
                      const n = e.target.valueAsNumber;
                      if (
                        Number.isFinite(n) &&
                        n >= (group === 'size' ? 0.02 : -3) &&
                        n <= (group === 'size' ? 6 : 3)
                      )
                        change(index, { ...part, [group]: { ...part[group], [axis]: n } });
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
          <div className="object-color-row">
            <input
              type="color"
              aria-label={`Box ${index + 1} color`}
              value={part.color}
              onChange={(e) => change(index, { ...part, color: e.target.value })}
            />
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => onChange(parts.filter((_, i) => i !== index))}
            >
              Remove box {index + 1}
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="button secondary full"
        disabled={parts.length >= 16}
        onClick={() =>
          onChange([
            ...parts,
            {
              position: { x: 0, y: 0.3, z: 0 },
              size: { x: 0.6, y: 0.6, z: 0.6 },
              color: '#8b9ba4',
            },
          ])
        }
      >
        Add box
      </button>
    </details>
  );
}

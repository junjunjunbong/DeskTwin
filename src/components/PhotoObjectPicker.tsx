import { useRef, useState, type CSSProperties } from 'react';
import type { SceneReviewCandidate } from '../domain/sceneProposal';
import { kindLabels, objectKindLabels } from '../domain/workspace';
import { Modal } from './ui';

export type PhotoPickerRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhotoPickerItem = {
  id: string;
  name: string;
  kind: SceneReviewCandidate['kind'];
  note?: string;
  region?: PhotoPickerRegion | null;
};

function objectKindLabel(kind: PhotoPickerItem['kind']) {
  return kind in kindLabels
    ? kindLabels[kind as keyof typeof kindLabels]
    : objectKindLabels[kind as keyof typeof objectKindLabels];
}

function hasRegion(region: PhotoPickerRegion | null | undefined): region is PhotoPickerRegion {
  return !!region && region.width > 0 && region.height > 0;
}

/** Larger rectangles paint first, so a click lands on the smallest box that contains it. */
function regionsBackToFront(items: readonly PhotoPickerItem[]) {
  return items
    .map((item, index) => ({ item, index }))
    .filter(
      (entry): entry is { item: PhotoPickerItem & { region: PhotoPickerRegion }; index: number } =>
        hasRegion(entry.item.region),
    )
    .sort(
      (a, b) =>
        b.item.region.width * b.item.region.height - a.item.region.width * a.item.region.height ||
        a.index - b.index,
    );
}

export function PhotoObjectPicker({
  photo,
  items,
  error = '',
  initialIncluded,
  onContinue,
  onDiscard,
}: {
  photo: string;
  items: PhotoPickerItem[];
  error?: string;
  initialIncluded?: ReadonlySet<string>;
  onContinue: (included: ReadonlySet<string>) => void;
  onDiscard: () => void;
}) {
  const [included, setIncluded] = useState(
    () => new Set(initialIncluded ?? items.map((item) => item.id)),
  );
  const [highlight, setHighlight] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [aspect, setAspect] = useState(1.5);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const found = items.length;
  const selected = included.size;
  const boxes = regionsBackToFront(items);
  const summary = boxes.length
    ? `Meta found ${found} ${found === 1 ? 'object' : 'objects'} in your photo. Click a box on the photo or uncheck a row to leave something out. You can still change this in the next step.`
    : `Meta found ${found} ${found === 1 ? 'object' : 'objects'} in your photo. Uncheck anything you do not want in your desk scene. You can still change this in the next step.`;

  function toggle(id: string, checked: boolean) {
    setIncluded((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function pointAt(id: string | null) {
    setHighlight((current) => (current === id ? current : id));
  }

  function showFromPhoto(id: string) {
    pointAt(id);
    rows.current.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <Modal
      title="Choose what to add"
      onClose={onDiscard}
      className={`photo-object-picker${expanded ? ' is-expanded' : ''}`}
    >
      <div className="photo-object-picker-intro">
        <p>{summary}</p>
      </div>
      <div className="photo-object-picker-body">
        <div
          className="photo-object-picker-photo"
          style={{ '--photo-aspect': String(aspect) } as CSSProperties}
        >
          <img
            src={photo}
            alt="Selected desk photo"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0)
                setAspect(image.naturalWidth / image.naturalHeight);
            }}
          />
          {boxes.map(({ item }, index) => {
            const region = item.region;
            const on = included.has(item.id);
            const active = highlight === item.id;
            return (
              <button
                key={item.id}
                type="button"
                tabIndex={-1}
                className={[
                  'photo-object-region',
                  on ? '' : 'is-excluded',
                  active ? 'is-highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: `${region.x * 100}%`,
                  top: `${region.y * 100}%`,
                  width: `${region.width * 100}%`,
                  height: `${region.height * 100}%`,
                  zIndex: active ? 40 : index + 1,
                }}
                aria-pressed={on}
                aria-label={`${item.name} photo region`}
                onMouseEnter={() => showFromPhoto(item.id)}
                onMouseLeave={() => pointAt(null)}
                onClick={() => toggle(item.id, !on)}
              />
            );
          })}
          {highlight &&
            boxes
              .filter(({ item }) => item.id === highlight)
              .map(({ item }) => {
                const region = item.region;
                const nearTop = region.y < 0.18;
                const nearRight = region.x + region.width > 0.75;
                return (
                  <span
                    key={`${item.id}-label`}
                    className="photo-object-region-label"
                    style={{
                      left: nearRight ? 'auto' : `${region.x * 100}%`,
                      right: nearRight ? `${(1 - region.x - region.width) * 100}%` : 'auto',
                      top: nearTop ? `${(region.y + region.height) * 100}%` : `${region.y * 100}%`,
                      transform: nearTop ? 'translateY(4px)' : 'translateY(calc(-100% - 4px))',
                    }}
                    aria-hidden="true"
                  >
                    {item.name}
                  </span>
                );
              })}
        </div>
        <div className="photo-object-picker-side">
          <div className="photo-object-picker-tools">
            <button
              type="button"
              className="text-button"
              onClick={() => setIncluded(new Set(items.map((item) => item.id)))}
            >
              Select all
            </button>
            <button type="button" className="text-button" onClick={() => setIncluded(new Set())}>
              Clear all
            </button>
            <button
              type="button"
              className="text-button photo-object-picker-zoom"
              aria-expanded={expanded}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Reduce photo' : 'Enlarge photo'}
            </button>
          </div>
          <ul className="photo-object-picker-list" aria-label="Objects found in the photo">
            {items.map((item) => (
              <li
                key={item.id}
                className={highlight === item.id ? 'is-highlighted' : undefined}
                ref={(node) => {
                  if (node) rows.current.set(item.id, node);
                  else rows.current.delete(item.id);
                }}
                onMouseEnter={() => pointAt(item.id)}
                onMouseLeave={() => pointAt(null)}
              >
                <label className="photo-object-choice">
                  <input
                    type="checkbox"
                    checked={included.has(item.id)}
                    onChange={(event) => toggle(item.id, event.target.checked)}
                    onFocus={() => pointAt(item.id)}
                    onBlur={() => pointAt(null)}
                  />
                  <span className="photo-object-choice-text">
                    <strong>{item.name}</strong>
                    <span>{objectKindLabel(item.kind)}</span>
                    {item.note && <small>{item.note}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="photo-object-picker-actions">
        <button
          type="button"
          className="button primary"
          disabled={selected === 0}
          onClick={() => {
            if (selected === 0) return;
            onContinue(included);
          }}
        >
          Continue with {selected} {selected === 1 ? 'object' : 'objects'}
        </button>
        <button type="button" className="button secondary" onClick={onDiscard}>
          Discard photo results
        </button>
      </div>
    </Modal>
  );
}

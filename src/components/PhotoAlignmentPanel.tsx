import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  autoFitSceneReviewToPhoto,
  undoScenePhotoFit,
  type SceneReviewState,
} from '../domain/sceneReview';
import { projectPhotoItem, type PhotoPoint } from '../domain/photoProjection';
import type { Workspace } from '../domain/workspace';

const svgPoints = (points: PhotoPoint[]) =>
  points.map((point) => `${point.x * 1000},${point.y * 1000}`).join(' ');
const projectedGeometry = (workspace: Workspace) =>
  JSON.stringify(
    [...workspace.objects, ...workspace.devices].map((item) => ({
      id: item.id,
      kind: item.kind,
      placement: item.placement,
      scale: item.visual.scale,
      parts: item.parts,
      shapeMode: item.shapeMode,
    })),
  );
const referenceGeometry = (workspace: Workspace, objectId: string) =>
  projectedGeometry({
    ...workspace,
    objects: workspace.objects.filter((item) => item.id === objectId),
    devices: workspace.devices.filter((item) => item.id === objectId),
  });

type MatchStatus = 'waiting' | 'matching' | 'matched' | 'unavailable' | 'undone';

/** Photo matching is local and automatic. Only review state changes until confirmation. */
export function PhotoAlignmentPanel({
  state,
  base,
  photo,
  onChange,
  onDiscard,
  disabled = false,
}: {
  state: SceneReviewState;
  base: Workspace;
  photo: string;
  onChange: (next: SceneReviewState) => void;
  onDiscard: () => void;
  disabled?: boolean;
}) {
  const panel = useRef<HTMLDetailsElement>(null);
  const attempted = useRef(!!state.photoAlignment);
  const [aspect, setAspect] = useState<number | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [status, setStatus] = useState<MatchStatus>(state.photoAlignment ? 'matched' : 'waiting');
  const alignment = state.photoAlignment;
  const geometryChanged =
    !!alignment && projectedGeometry(state.draft) !== projectedGeometry(alignment.afterDraft);
  const referenceGeometryChanged =
    !!alignment?.reference &&
    referenceGeometry(state.draft, alignment.reference.objectId) !==
      referenceGeometry(alignment.afterDraft, alignment.reference.objectId);
  const showingOverlay = overlay && !!alignment && !referenceGeometryChanged;
  const projections = useMemo(() => {
    if (!alignment || referenceGeometryChanged) return [];
    return [...state.draft.objects, ...state.draft.devices].flatMap((item) => {
      const projection = projectPhotoItem(item, alignment.camera);
      return projection ? [{ item, ...projection }] : [];
    });
  }, [state.draft, alignment, referenceGeometryChanged]);

  const matchPhoto = useCallback(() => {
    if (disabled || !aspect) return;
    // Set the guard before calling the fitter. Strict Mode and undo must never
    // schedule a second automatic pass over a user's reviewed layout.
    attempted.current = true;
    setStatus('matching');
    try {
      const next = autoFitSceneReviewToPhoto(state, base, aspect);
      if (!next.photoAlignment) {
        setStatus('unavailable');
        return;
      }
      onChange(next);
      setOverlay(true);
      setStatus('matched');
    } catch {
      setStatus('unavailable');
    }
  }, [disabled, aspect, state, base, onChange]);

  useEffect(() => {
    if (attempted.current || disabled || !aspect) return;
    matchPhoto();
  }, [aspect, disabled, matchPhoto]);

  return (
    <details ref={panel} className="photo-alignment-panel" aria-label="Automatic photo comparison">
      <summary>
        Compare with your photo
        <span>
          {status === 'unavailable'
            ? 'Continue with the current preview'
            : status === 'undone'
              ? 'Photo match undone'
              : alignment
                ? 'Automatic match · review required'
                : 'Matching the photo…'}
        </span>
      </summary>
      <div className="photo-alignment-content">
        <div className="photo-alignment-reference">
          <div
            className="photo-alignment-frame"
            style={aspect ? { width: `min(100%, calc(280px * ${aspect}))` } : undefined}
          >
            <img
              className="photo-alignment-source"
              src={photo}
              alt="Source photo for automatic scene comparison"
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth && image.naturalHeight)
                  setAspect(image.naturalWidth / image.naturalHeight);
              }}
              onError={() => {
                attempted.current = true;
                setAspect(null);
                setStatus('unavailable');
              }}
            />
            {showingOverlay && alignment && (
              <svg
                className="photo-alignment-projection"
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                role="img"
                aria-label="Projected preview shapes in the source photo view"
              >
                {projections.map(({ item, polygons }) => (
                  <g key={item.id} data-scene-id={item.id}>
                    <title>{item.name}: projected preview shape</title>
                    {polygons.map((polygon, index) => (
                      <polygon
                        key={index}
                        points={svgPoints(polygon)}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                  </g>
                ))}
              </svg>
            )}
          </div>
          <p className="micro-note photo-alignment-legend">
            {showingOverlay
              ? 'Gold: current preview shapes in the estimated photo view.'
              : 'Your source photo. The preview remains editable.'}
          </p>
          <button
            type="button"
            className="text-button"
            aria-pressed={showingOverlay}
            disabled={disabled || !alignment || referenceGeometryChanged}
            onClick={() => setOverlay((value) => !value)}
          >
            Compare scene shapes
          </button>
        </div>
        <div className="photo-alignment-controls">
          {status === 'unavailable' ? (
            <div className="photo-alignment-result" role="status">
              <p>We could not confidently match this photo.</p>
              <p>
                Keep reviewing the current preview, or choose another photo. Your scene edits are
                preserved.
              </p>
              <div className="photo-alignment-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    if (panel.current) panel.current.open = false;
                  }}
                >
                  Keep current preview
                </button>
                <button type="button" className="text-button" onClick={onDiscard}>
                  Choose another photo
                </button>
              </div>
            </div>
          ) : status === 'undone' ? (
            <p className="micro-note" role="status">
              Photo match undone. Your later edits remain in the preview.
            </p>
          ) : !alignment ? (
            <p className="micro-note" role="status">
              Matching the scene to the photo automatically…
            </p>
          ) : (
            <div className="photo-alignment-result" role="status">
              <p>
                {alignment.changedIds.length}{' '}
                {alignment.changedIds.length === 1 ? 'object adjusted' : 'objects adjusted'} to
                match the photo. Check the estimate before confirming.
              </p>
              {referenceGeometryChanged ? (
                <p>
                  The layout reference changed after matching. Match the photo again to update this
                  view. The earlier comparison is hidden until you match again.
                </p>
              ) : geometryChanged ? (
                <p>
                  The layout changed after matching. Shapes show your current preview in the earlier
                  photo view.
                </p>
              ) : null}
              {alignment.warnings.length > 0 && (
                <p className="micro-note">
                  This comparison is approximate. Check object types and supports before saving.
                </p>
              )}
            </div>
          )}
          <div className="photo-alignment-actions">
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !aspect || status === 'matching'}
              onClick={matchPhoto}
            >
              Match photo again
            </button>
            <button
              type="button"
              className="text-button"
              disabled={disabled || !alignment}
              onClick={() => {
                if (disabled || !alignment) return;
                attempted.current = true;
                try {
                  onChange(undoScenePhotoFit(state, base));
                  setStatus('undone');
                } catch {
                  setStatus('unavailable');
                }
              }}
            >
              Undo photo match
            </button>
          </div>
          <p className="micro-note">
            This is a visual estimate. It does not verify dimensions, wiring, or device activity.
            Nothing is saved until you confirm the scene.
          </p>
        </div>
      </div>
    </details>
  );
}

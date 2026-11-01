import { useState } from 'react';
import type { SceneReviewState } from '../domain/sceneReview';

type Candidate = SceneReviewState['candidates'][number];

/** Regions come only from validated proposal metadata, never from scene coordinates. */
export function PreviewPhotoReference({
  photo,
  candidate,
}: {
  photo: string;
  candidate?: Candidate;
}) {
  const [expanded, setExpanded] = useState(false);
  const [aspect, setAspect] = useState(1.4);
  const region = candidate?.imageRegion;
  return (
    <section
      className={`preview-reference ${expanded ? 'preview-reference-expanded' : ''}`}
      aria-label="Reference photo comparison"
    >
      <div className="preview-reference-heading">
        <h3>Reference photo</h3>
        <button
          type="button"
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Reduce photo' : 'Enlarge photo'}
        </button>
      </div>
      <div
        className="preview-photo-frame"
        style={{ width: `min(100%, calc(var(--preview-reference-height) * ${aspect}))` }}
      >
        <img
          src={photo}
          alt="Photo used for this scene proposal"
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight)
              setAspect(image.naturalWidth / image.naturalHeight);
          }}
        />
        {region && (
          <span
            className="preview-photo-region"
            role="img"
            aria-label={`Approximate photo region for ${candidate.proposedName}`}
            style={{
              left: `${region.x * 100}%`,
              top: `${region.y * 100}%`,
              width: `${region.width * 100}%`,
              height: `${region.height * 100}%`,
            }}
          />
        )}
      </div>
      <p className="preview-reference-caption">
        {region
          ? `${candidate.proposedName}: approximate model region, not verified identification.`
          : candidate?.source === 'user-reported'
            ? 'Added by you. No photo region is assigned.'
            : candidate
              ? 'No photo region was supplied for this object.'
              : 'Select an object to compare. Photo inference does not verify wiring or activity.'}
      </p>
    </section>
  );
}

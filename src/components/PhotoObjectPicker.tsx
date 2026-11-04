import { useState } from 'react';
import type { SceneReviewCandidate } from '../domain/sceneProposal';
import { kindLabels, objectKindLabels } from '../domain/workspace';
import { Modal } from './ui';

function objectKindLabel(kind: SceneReviewCandidate['kind']) {
  return kind in kindLabels
    ? kindLabels[kind as keyof typeof kindLabels]
    : objectKindLabels[kind as keyof typeof objectKindLabels];
}

export function PhotoObjectPicker({
  photo,
  candidates,
  error = '',
  onContinue,
  onDiscard,
}: {
  photo: string;
  candidates: SceneReviewCandidate[];
  error?: string;
  onContinue: (included: ReadonlySet<string>) => void;
  onDiscard: () => void;
}) {
  const [included, setIncluded] = useState(
    () => new Set(candidates.map((candidate) => candidate.proposalId)),
  );
  const found = candidates.length;
  const selected = included.size;
  const summary = `Meta found ${found} ${found === 1 ? 'object' : 'objects'} in your photo. Uncheck anything you do not want in your desk scene. You can still change this in the next step.`;

  function toggle(proposalId: string, checked: boolean) {
    setIncluded((current) => {
      const next = new Set(current);
      if (checked) next.add(proposalId);
      else next.delete(proposalId);
      return next;
    });
  }

  return (
    <Modal title="Choose what to add" onClose={onDiscard} className="photo-object-picker">
      <div className="photo-object-picker-intro">
        <img src={photo} alt="Selected desk photo" />
        <p>{summary}</p>
      </div>
      <div className="photo-object-picker-tools">
        <button
          type="button"
          className="text-button"
          onClick={() => setIncluded(new Set(candidates.map((candidate) => candidate.proposalId)))}
        >
          Select all
        </button>
        <button type="button" className="text-button" onClick={() => setIncluded(new Set())}>
          Clear all
        </button>
      </div>
      <ul className="photo-object-picker-list" aria-label="Objects found in the photo">
        {candidates.map((candidate) => (
          <li key={candidate.proposalId}>
            <label className="photo-object-choice">
              <input
                type="checkbox"
                checked={included.has(candidate.proposalId)}
                onChange={(event) => toggle(candidate.proposalId, event.target.checked)}
              />
              <span className="photo-object-choice-text">
                <strong>{candidate.proposedName}</strong>
                <span>{objectKindLabel(candidate.kind)}</span>
                {candidate.matchedSceneId !== null && <small>Updates your saved record</small>}
              </span>
            </label>
          </li>
        ))}
      </ul>
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

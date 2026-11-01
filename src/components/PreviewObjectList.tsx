import { kindLabels, objectKindLabels, type Workspace } from '../domain/workspace';
import type { SceneReviewState } from '../domain/sceneReview';

type Candidate = SceneReviewState['candidates'][number];

export function previewKindLabel(kind: Candidate['kind']) {
  return kind in kindLabels
    ? kindLabels[kind as keyof typeof kindLabels]
    : objectKindLabels[kind as keyof typeof objectKindLabels];
}

export function PreviewObjectList({
  candidates,
  draft,
  selectedProposalId,
  selectedSceneId,
  onSelectCandidate,
  onSelectSaved,
  onInclude,
  onAdd,
}: {
  candidates: Candidate[];
  draft: Workspace;
  selectedProposalId: string | null;
  selectedSceneId: string | null;
  onSelectCandidate: (proposalId: string) => void;
  onSelectSaved: (sceneId: string) => void;
  onInclude: (proposalId: string, included: boolean) => void;
  onAdd: () => void;
}) {
  const items = [...draft.objects, ...draft.devices];
  const candidateIds = new Set(
    candidates.filter((item) => item.included).map((item) => item.sceneId),
  );
  const retained = items.filter((item) => !candidateIds.has(item.id));
  const included = candidates.filter((candidate) => candidate.included).length;
  return (
    <section className="preview-object-list" aria-label="Preview objects">
      <div className="preview-list-heading">
        <h3>Review objects</h3>
        <span
          className="count"
          aria-label={`${included} of ${candidates.length} candidates included`}
        >
          {included}/{candidates.length}
        </span>
        <button type="button" className="text-button" onClick={onAdd}>
          Add missing object
        </button>
      </div>
      <p className="micro-note">
        Uncheck a candidate to exclude it. You can restore it before applying.
      </p>
      <div className="preview-object-rows">
        <ul className="preview-candidate-list" aria-label="Photo and manual candidates">
          {candidates.map((candidate) => {
            const item = candidate.included
              ? items.find((entry) => entry.id === candidate.sceneId)
              : undefined;
            const name = item?.name ?? candidate.proposedName;
            return (
              <li
                key={candidate.proposalId}
                className={`preview-object-row ${selectedProposalId === candidate.proposalId ? 'is-selected' : ''} ${candidate.included ? '' : 'is-excluded'}`}
              >
                <input
                  type="checkbox"
                  checked={candidate.included}
                  aria-label={`Include ${name} in scene`}
                  onChange={(event) => onInclude(candidate.proposalId, event.target.checked)}
                />
                <button
                  type="button"
                  aria-pressed={selectedProposalId === candidate.proposalId}
                  onClick={() => onSelectCandidate(candidate.proposalId)}
                >
                  <strong>{name}</strong>
                  <small>
                    {previewKindLabel(candidate.kind)} ·{' '}
                    {candidate.source === 'photo-inferred' ? 'Photo estimate' : 'Added by you'}
                    {!candidate.included
                      ? ' · Excluded'
                      : candidate.matchedSceneId
                        ? ' · Saved record'
                        : ''}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
        {retained.length > 0 && (
          <div className="preview-retained-list">
            <h4>Saved objects kept</h4>
            <p className="micro-note">
              These records remain even when a matching candidate is excluded.
            </p>
            <ul aria-label="Retained saved objects">
              {retained.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`preview-retained-row ${selectedProposalId === null && selectedSceneId === item.id ? 'is-selected' : ''}`}
                    aria-pressed={selectedProposalId === null && selectedSceneId === item.id}
                    onClick={() => onSelectSaved(item.id)}
                  >
                    <strong>{item.name}</strong>
                    <small>{previewKindLabel(item.kind)} · Saved record retained</small>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

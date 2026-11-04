import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X, Sparkle, Plus, Check, ArrowRight } from '@phosphor-icons/react';
import { z } from 'zod';
import { modelWorkspace } from '../domain/workspacePrivacy';
import { type Workspace } from '../domain/workspace';
import {
  SceneProposalSchema,
  buildScenePreview,
  type SceneReviewMetadata,
} from '../domain/sceneProposal';
import { setSceneCandidateIncluded, type SceneReviewState } from '../domain/sceneReview';
import { PhotoObjectPicker } from './PhotoObjectPicker';
import { ScenePreview } from './ScenePreview';
import { PHOTO_ACCEPT, preparePhoto } from '../domain/photoInput';
export { preparePhoto } from '../domain/photoInput';

// Optional transport metadata stays outside the proposal contract. Old frozen
// replies remain usable, and malformed measurements never become UI durations.
const responseTimingsSchema = z
  .object({
    providerMs: z.number().finite().nonnegative(),
    validationMs: z.number().finite().nonnegative(),
    totalMs: z.number().finite().nonnegative(),
    responseBytes: z.number().int().nonnegative(),
    objectCount: z.number().int().min(1).max(32),
  })
  .refine((value) => value.providerMs + value.validationMs <= value.totalMs + 1);

function elapsedLabel(milliseconds: number) {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

interface Props {
  workspace: Workspace;
  photo: string | null;
  onPhoto: (data: string | null) => void;
  available: boolean;
  onClose: () => void;
  onAdd: () => void;
  onApply: (draft: Workspace, base: Workspace, review: SceneReviewMetadata) => void | Promise<void>;
  storageConflict?: boolean;
  onRefresh: () => void;
  onContinue?: (context: string) => void;
}
export function PhotoPanel({
  workspace,
  photo,
  onPhoto,
  available,
  onClose,
  onAdd,
  onApply,
  onRefresh,
  storageConflict = false,
  onContinue,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const preparation = useRef<AbortController | null>(null);
  const version = useRef(0);
  const [consent, setConsent] = useState(false);
  const [context, setContext] = useState('');
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<'analyzing' | 'fitting' | null>(null);
  const analysisStarted = useRef(0);
  const preparedPhotoTiming = useRef<{ photo: string; milliseconds: number } | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timingSummary, setTimingSummary] = useState('');
  const [timingBreakdown, setTimingBreakdown] = useState<{ label: string; milliseconds: number }[]>(
    [],
  );
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [timedOut, setTimedOut] = useState(false);
  const [result, setResult] = useState<
    | (ReturnType<typeof buildScenePreview> & {
        base: Workspace;
        message: string;
      })
    | null
  >(null);
  const [stage, setStage] = useState<'pick' | 'review' | null>(null);
  const [reviewState, setReviewState] = useState<SceneReviewState | null>(null);
  const [pickerError, setPickerError] = useState('');
  const [applied, setApplied] = useState(false);
  useEffect(
    () => () => {
      version.current++;
      request.current?.abort();
      preparation.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(
      () => setElapsedSeconds(Math.floor((performance.now() - analysisStarted.current) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [pending]);
  function cancel() {
    version.current++;
    request.current?.abort();
    preparation.current?.abort();
    request.current = null;
    preparation.current = null;
    setPending(false);
    setPhase(null);
    setTimingSummary('');
    setTimingBreakdown([]);
    setPreparing(false);
    setResult(null);
    setStage(null);
    setReviewState(null);
    setPickerError('');
  }
  function dismissResults() {
    setResult(null);
    setStage(null);
    setReviewState(null);
    setPickerError('');
  }
  function continueWith(included: ReadonlySet<string>) {
    if (!result) return;
    try {
      let state: SceneReviewState = {
        draft: result.draft,
        observations: result.observations,
        candidates: result.candidates,
        issues: result.issues,
        originalDraft: result.originalDraft,
        adjustments: result.adjustments,
        repairSummary: result.repairSummary,
        photoReference: result.photoReference,
      };
      for (const candidate of result.candidates) {
        if (included.has(candidate.proposalId)) continue;
        state = setSceneCandidateIncluded(state, result.base, candidate.proposalId, false);
      }
      setReviewState(state);
      setPickerError('');
      setStage('review');
    } catch (cause) {
      setPickerError(
        cause instanceof Error
          ? cause.message.split('\n')[0]
          : 'Could not apply the selected objects.',
      );
    }
  }
  async function analyze() {
    if (!photo || !consent || !available || pending || request.current) return;
    cancel();
    const token = version.current;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 65000);
    const base = structuredClone(workspace);
    analysisStarted.current = performance.now();
    setElapsedSeconds(0);
    setPending(true);
    setPhase('analyzing');
    setError('');
    setTimedOut(false);
    setApplied(false);
    try {
      const res = await fetch('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          image: photo,
          consent: true,
          workspace: modelWorkspace(base),
          context,
        }),
      });
      const data = await res.json();
      const requestFinished = performance.now();
      if (token !== version.current) return;
      if (!res.ok) {
        if (res.status === 504) setTimedOut(true);
        throw new Error(data.error || 'Analysis failed.');
      }
      if (data.mode !== 'meta')
        throw new Error('The photo response was not a Meta scene proposal.');
      // Transport measurements are separate from scene data. Older frozen replies omit them.
      const { mode: _mode, timings: _timings, ...proposal } = data;
      const validationStarted = performance.now();
      const parsed = SceneProposalSchema.safeParse(proposal);
      if (!parsed.success)
        throw new Error('The returned scene was invalid. Your saved workspace was not changed.');
      const localValidationMs = performance.now() - validationStarted;
      const serverTimings = responseTimingsSchema.safeParse(_timings);
      setPhase('fitting');
      // Yield once before local fitting so cancellation and the actual stage can be reflected.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (token !== version.current) return;
      controller.signal.throwIfAborted();
      const fittingStarted = performance.now();
      const preview = buildScenePreview(base, parsed.data);
      const previewReady = performance.now();
      const preparationMs =
        preparedPhotoTiming.current?.photo === photo
          ? preparedPhotoTiming.current.milliseconds
          : null;
      const measuredServer =
        serverTimings.success && serverTimings.data.objectCount === parsed.data.objects.length
          ? serverTimings.data
          : null;
      setResult({ base, ...preview, message: parsed.data.message });
      setReviewState(null);
      setPickerError('');
      setStage('pick');
      setTimingSummary(
        `Preview prepared in ${((previewReady - analysisStarted.current) / 1000).toFixed(1)} s · ${preview.candidates.length} candidate objects.`,
      );
      setTimingBreakdown([
        ...(preparationMs === null
          ? []
          : [{ label: 'Photo preparation', milliseconds: preparationMs }]),
        ...(measuredServer
          ? [
              { label: 'Model response', milliseconds: measuredServer.providerMs },
              { label: 'Response checks', milliseconds: measuredServer.validationMs },
            ]
          : [
              {
                label: 'Analysis request',
                milliseconds: requestFinished - analysisStarted.current,
              },
            ]),
        { label: 'Local response checks', milliseconds: localValidationMs },
        { label: 'Scene fitting', milliseconds: previewReady - fittingStarted },
        {
          label: 'Analysis to preview',
          milliseconds: previewReady - analysisStarted.current,
        },
      ]);
    } catch (e) {
      if (token !== version.current) return;
      if (controller.signal.aborted) setTimedOut(true);
      setError(
        controller.signal.aborted
          ? 'Photo analysis timed out. Your workspace was not changed.'
          : e instanceof Error
            ? e.message.split('\n')[0]
            : 'Could not analyze the photo.',
      );
    } finally {
      clearTimeout(timeout);
      if (token === version.current) {
        setPending(false);
        setPhase(null);
        request.current = null;
      }
    }
  }
  return (
    <>
      <aside className="floating-panel photo-panel" aria-label="Desk photo panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">START WITH YOUR DESK</span>
            <h2>My desk photo</h2>
          </div>
          <button
            className="icon-button"
            aria-label="Close photo panel"
            onClick={() => {
              cancel();
              onClose();
            }}
          >
            <X size={19} />
          </button>
        </div>
        <div className="panel-scroll">
          <p className="muted">
            Turn visible devices, furniture, and decor into an editable voxel scene. Review every
            proposal before it changes your workspace.
          </p>
          <button
            className="photo-drop"
            disabled={preparing}
            onClick={() => fileRef.current?.click()}
          >
            {photo ? (
              <img src={photo} alt="Desk reference photo selected by the user" />
            ) : (
              <>
                <ImageIcon size={38} />
                <strong>{preparing ? 'Preparing photo...' : 'Choose a photo'}</strong>
                <span>PNG, JPEG, WebP, HEIC/HEIF · up to 8 MB</span>
              </>
            )}
          </button>
          <input
            hidden
            ref={fileRef}
            type="file"
            accept={PHOTO_ACCEPT}
            aria-label="Desk photo file"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              cancel();
              const token = version.current;
              const controller = new AbortController();
              preparation.current = controller;
              preparedPhotoTiming.current = null;
              const preparationStarted = performance.now();
              setPreparing(true);
              setError('');
              setTimedOut(false);
              setConsent(false);
              setApplied(false);
              onPhoto(null);
              try {
                const data = await preparePhoto(file, controller.signal);
                if (token === version.current) {
                  preparedPhotoTiming.current = {
                    photo: data,
                    milliseconds: performance.now() - preparationStarted,
                  };
                  onPhoto(data);
                }
              } catch (e) {
                if (token === version.current)
                  setError(e instanceof Error ? e.message : 'Could not read the photo.');
              } finally {
                if (token === version.current) {
                  preparation.current = null;
                  setPreparing(false);
                }
              }
            }}
          />
          {preparing && (
            <button className="text-button" onClick={cancel}>
              Cancel photo preparation
            </button>
          )}
          <p className="micro-note">
            Photos stay in memory, are resized to at most 1280 pixels, and are stripped of metadata.
            Selecting a photo does not send it.
          </p>
          <label>
            What do you know about this setup?
            <textarea
              aria-label="Device and connection notes"
              value={context}
              maxLength={2000}
              disabled={pending}
              placeholder="e.g. The closed laptop is my work computer. I connected its USB-C port to the dock."
              onChange={(e) => setContext(e.target.value)}
            />
          </label>
          <p className="micro-note">
            Your saved device and connection records are included. These notes guide the visual
            proposal. After reviewing the scene, continue to desk setup to confirm the connections
            you described. A photo cannot confirm hidden wiring or device activity.
          </p>
          {available ? (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={pending}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                I agree to send this photo, my setup, and these notes to the Meta API for analysis.
              </label>
              <button
                className="button primary full"
                disabled={!photo || !consent || pending || preparing}
                onClick={() => void analyze()}
              >
                <Sparkle size={18} />
                {pending
                  ? phase === 'fitting'
                    ? 'Preparing the scene preview...'
                    : 'Meta is analyzing the photo...'
                  : timedOut
                    ? 'Retry photo analysis'
                    : 'Create scene preview with Meta'}
              </button>
              {pending && (
                <div className="photo-progress" aria-label="Photo analysis progress">
                  <span className="photo-progress-indicator" aria-hidden="true" />
                  <div>
                    <strong role="status">
                      {phase === 'fitting' ? 'Preparing the scene preview' : 'Analyzing the photo'}
                    </strong>
                    <p aria-live="off">{elapsedSeconds} s elapsed</p>
                  </div>
                  <button className="text-button" onClick={cancel}>
                    Cancel analysis
                  </button>
                </div>
              )}
              {!pending && timingSummary && <p className="micro-note">{timingSummary}</p>}
              {!pending && timingBreakdown.length > 0 && (
                <details className="micro-note" aria-label="Photo processing times">
                  <summary>View processing times</summary>
                  <ul>
                    {timingBreakdown.map(({ label, milliseconds }) => (
                      <li key={label}>
                        {label}: {elapsedLabel(milliseconds)}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Photo preparation happens before analysis. The analysis total includes the
                    request and local processing, and ends when the preview is ready to display.
                  </p>
                </details>
              )}
            </>
          ) : (
            <div className="integration-note">
              <strong>AI photo analysis: Meta key not configured</strong>
              <p>
                Configure the Meta key on the local server to enable photo analysis. You can edit
                the scene manually.
              </p>
              <button className="text-button" onClick={onRefresh}>
                Check connection settings again
              </button>
            </div>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
              {timedOut && ' You can retry using the same photo and notes.'}
            </p>
          )}
          {applied && (
            <>
              <p className="applied-note">
                <Check size={16} />
                Scene applied. You can edit any object or undo this change.
              </p>
              {onContinue && (
                <button className="button primary full" onClick={() => onContinue(context)}>
                  Continue to device and connection review
                  <ArrowRight size={16} />
                </button>
              )}
            </>
          )}
          <button
            className="button secondary full"
            onClick={onAdd}
            disabled={pending || workspace.devices.length >= 40}
          >
            <Plus size={18} />
            Add a device manually
          </button>
          {photo && (
            <button
              className="text-button danger-text"
              onClick={() => {
                cancel();
                preparedPhotoTiming.current = null;
                onPhoto(null);
                setConsent(false);
                setError('');
                setApplied(false);
              }}
            >
              Remove photo
            </button>
          )}
        </div>
      </aside>
      {result && photo && stage === 'pick' && (
        <PhotoObjectPicker
          photo={photo}
          candidates={result.candidates}
          error={pickerError}
          onDiscard={dismissResults}
          onContinue={continueWith}
        />
      )}
      {result && photo && stage === 'review' && reviewState && (
        <ScenePreview
          base={result.base}
          initialDraft={reviewState.draft}
          initialObservations={reviewState.observations}
          initialCandidates={reviewState.candidates}
          initialIssues={reviewState.issues}
          initialOriginalDraft={reviewState.originalDraft}
          initialAdjustments={reviewState.adjustments}
          initialRepairSummary={reviewState.repairSummary}
          initialPhotoReference={reviewState.photoReference}
          current={workspace}
          storageConflict={storageConflict}
          message={result.message}
          photo={photo}
          onDiscard={dismissResults}
          onApply={async (draft, base, review) => {
            await onApply(draft, base, review);
            dismissResults();
            setApplied(true);
          }}
        />
      )}
    </>
  );
}

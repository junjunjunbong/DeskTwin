import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, X, Sparkle, Plus, Check, ArrowRight } from '@phosphor-icons/react';
import { modelWorkspace } from '../domain/workspacePrivacy';
import { type Workspace } from '../domain/workspace';
import {
  SceneProposalSchema,
  buildScenePreview,
  type SceneReviewMetadata,
} from '../domain/sceneProposal';
import { ScenePreview } from './ScenePreview';
import { PHOTO_ACCEPT, preparePhoto } from '../domain/photoInput';
export { preparePhoto } from '../domain/photoInput';
interface Props {
  workspace: Workspace;
  photo: string | null;
  onPhoto: (data: string | null) => void;
  available: boolean;
  onClose: () => void;
  onAdd: () => void;
  onApply: (draft: Workspace, base: Workspace, review: SceneReviewMetadata) => void | Promise<void>;
  storageConflict?: boolean;
  onClearDemo: () => unknown | Promise<unknown>;
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
  onClearDemo,
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
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<
    | (ReturnType<typeof buildScenePreview> & {
        base: Workspace;
        message: string;
      })
    | null
  >(null);
  const [applied, setApplied] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  useEffect(
    () => () => {
      version.current++;
      request.current?.abort();
      preparation.current?.abort();
    },
    [],
  );
  function cancel() {
    version.current++;
    request.current?.abort();
    preparation.current?.abort();
    request.current = null;
    preparation.current = null;
    setPending(false);
    setPreparing(false);
    setResult(null);
  }
  async function analyze() {
    if (!photo || !consent || !available || pending || request.current) return;
    cancel();
    const token = version.current;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 40000);
    const base = structuredClone(workspace);
    setPending(true);
    setError('');
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
      if (token !== version.current) return;
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');
      if (data.mode !== 'meta')
        throw new Error('The photo response was not a Meta scene proposal.');
      const { mode: _mode, ...proposal } = data;
      const parsed = SceneProposalSchema.safeParse(proposal);
      if (!parsed.success)
        throw new Error('The returned scene was invalid. Your saved workspace was not changed.');
      setResult({ base, ...buildScenePreview(base, parsed.data), message: parsed.data.message });
    } catch (e) {
      if (token !== version.current) return;
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
          <button className="icon-button" aria-label="Close photo panel" onClick={onClose}>
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
              setPreparing(true);
              setError('');
              setConsent(false);
              setApplied(false);
              onPhoto(null);
              try {
                const data = await preparePhoto(file, controller.signal);
                if (token === version.current) onPhoto(data);
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
                {pending ? 'Meta is analyzing the photo...' : 'Create scene preview with Meta'}
              </button>
              {pending && (
                <button className="text-button" onClick={cancel}>
                  Cancel analysis
                </button>
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
          {workspace.devices.some((d) => d.source === 'demo') && (
            <div className="clear-demo-row">
              <button
                className="text-button"
                disabled={pending}
                onClick={async () => {
                  if (clearConfirm) {
                    if ((await onClearDemo()) !== false) setClearConfirm(false);
                  } else setClearConfirm(true);
                }}
              >
                {clearConfirm
                  ? 'Confirm removal of sample devices'
                  : 'Remove sample devices and start my setup'}
              </button>
              {clearConfirm && (
                <button className="text-button" onClick={() => setClearConfirm(false)}>
                  Cancel
                </button>
              )}
            </div>
          )}
          {photo && (
            <button
              className="text-button danger-text"
              onClick={() => {
                cancel();
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
      {result && photo && (
        <ScenePreview
          base={result.base}
          initialDraft={result.draft}
          initialObservations={result.observations}
          initialCandidates={result.candidates}
          initialIssues={result.issues}
          current={workspace}
          storageConflict={storageConflict}
          message={result.message}
          photo={photo}
          onDiscard={() => setResult(null)}
          onApply={async (draft, base, review) => {
            await onApply(draft, base, review);
            setResult(null);
            setApplied(true);
          }}
        />
      )}
    </>
  );
}

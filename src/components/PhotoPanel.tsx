import { useRef, useState } from 'react';
import { Image as ImageIcon, X, Sparkle, Plus, Check } from '@phosphor-icons/react';
import { AssistantResponseSchema, type Proposal, type Workspace } from '../domain/workspace';

export async function preparePhoto(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024)
    throw new Error('Choose a PNG, JPEG, or WebP image up to 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height)
      throw new Error('Could not determine the image dimensions.');
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process the photo.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Re-encoding strips EXIF and reduces resolution before any explicit external transfer.
    const data = canvas.toDataURL('image/jpeg', 0.82);
    if (data.length > 1_900_000) throw new Error('The photo is too large. Choose a smaller image.');
    return data;
  } finally {
    bitmap.close();
  }
}
interface Props {
  workspace: Workspace;
  photo: string | null;
  onPhoto: (data: string | null) => void;
  available: boolean;
  onClose: () => void;
  onAdd: () => void;
  onApply: (p: Proposal) => void;
  onClearDemo: () => void;
  onRefresh: () => void;
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
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ message: string; proposals: Proposal[] } | null>(null);
  const [accepted, setAccepted] = useState<number[]>([]);
  const [clearConfirm, setClearConfirm] = useState(false);
  async function analyze() {
    if (!photo || !consent || !available || pending) return;
    setPending(true);
    setError('');
    setResult(null);
    setAccepted([]);
    try {
      const res = await fetch('/api/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(40000),
        body: JSON.stringify({ image: photo, consent: true, workspace }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed.');
      const parsed = AssistantResponseSchema.parse(data);
      if (data.mode !== 'meta' || parsed.proposals.some((p) => p.type !== 'add-device'))
        throw new Error('The photo analysis result cannot be applied safely.');
      setResult(parsed);
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'TimeoutError'
          ? 'Photo analysis timed out.'
          : e instanceof Error
            ? e.message
            : 'Could not analyze the photo.',
      );
    } finally {
      setPending(false);
    }
  }
  return (
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
          Find devices and their approximate positions in a photo. This does not reconstruct the
          entire room in 3D or detect cables.
        </p>
        <button
          className="photo-drop"
          disabled={pending || preparing}
          onClick={() => fileRef.current?.click()}
        >
          {photo ? (
            <img src={photo} alt="Desk reference photo selected by the user" />
          ) : (
            <>
              <ImageIcon size={38} />
              <strong>{preparing ? 'Preparing photo...' : 'Choose a photo'}</strong>
              <span>PNG, JPEG, WebP · up to 8 MB</span>
            </>
          )}
        </button>
        <input
          hidden
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Desk photo file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            setPreparing(true);
            setError('');
            setConsent(false);
            setResult(null);
            setAccepted([]);
            try {
              onPhoto(await preparePhoto(f));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Could not read the photo.');
            } finally {
              setPreparing(false);
            }
          }}
        />
        <p className="micro-note">
          Photos are resized to at most 1280 pixels and stripped of metadata. Selecting a photo does
          not send it. It will be removed when you refresh the page.
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
              I agree to send this photo and my device setup to the Meta API for analysis.
            </label>
            <button
              className="button primary full"
              disabled={!photo || !consent || pending || preparing}
              onClick={() => void analyze()}
            >
              <Sparkle size={18} />
              {pending
                ? 'Meta is analyzing the photo...'
                : 'Analyze devices and placement with Meta'}
            </button>
          </>
        ) : (
          <div className="integration-note">
            <strong>AI photo analysis: Meta key not configured</strong>
            <p>
              Set <code>MODEL_API_KEY</code> in the server's <code>.env</code> file, then restart
              the API server. Do not enter your key on this screen.
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
        {result && (
          <section className="panel-section">
            <h3>Devices inferred from the photo</h3>
            <p className="muted">{result.message}</p>
            {result.proposals.map((p, i) =>
              p.type === 'add-device' ? (
                <div className="proposal-card" key={i}>
                  <strong>{p.name}</strong>
                  <p>{p.reason}</p>
                  {accepted.includes(i) ? (
                    <span className="applied-note">
                      <Check size={14} />
                      Added as photo-inferred
                    </span>
                  ) : (
                    <button
                      className="button secondary"
                      disabled={workspace.devices.length >= 40}
                      onClick={() => {
                        try {
                          onApply(p);
                          setAccepted((old) => [...old, i]);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Could not add the device.');
                        }
                      }}
                    >
                      Confirm and add
                    </button>
                  )}
                </div>
              ) : null,
            )}
            <p className="micro-note">
              Added devices are saved as photo-inferred with an unconfirmed operating status. You
              can adjust them in placement editing.
            </p>
          </section>
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
              onClick={() => {
                if (clearConfirm) {
                  onClearDemo();
                  setClearConfirm(false);
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
            disabled={pending}
            onClick={() => {
              onPhoto(null);
              setResult(null);
              setConsent(false);
            }}
          >
            Remove photo
          </button>
        )}
      </div>
    </aside>
  );
}

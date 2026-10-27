import { useRef, useState } from 'react';
import { Image as ImageIcon, X, Sparkle, Plus, Check } from '@phosphor-icons/react';
import { AssistantResponseSchema, type Proposal, type Workspace } from '../domain/workspace';

export async function preparePhoto(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) throw new Error('PNG, JPEG, WebP 이미지(8 MB 이하)를 선택해 주세요.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height) throw new Error('이미지 크기를 확인할 수 없습니다.');
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('사진을 처리할 수 없습니다.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Re-encoding strips EXIF and reduces resolution before any explicit external transfer.
    const data = canvas.toDataURL('image/jpeg', .82);
    if (data.length > 1_900_000) throw new Error('사진이 너무 큽니다. 더 작은 이미지를 선택해 주세요.');
    return data;
  } finally { bitmap.close(); }
}
interface Props { workspace: Workspace; photo: string | null; onPhoto: (data: string | null) => void; available: boolean; onClose: () => void; onAdd: () => void; onApply: (p: Proposal) => void; onClearDemo: () => void; onRefresh: () => void }
export function PhotoPanel({ workspace, photo, onPhoto, available, onClose, onAdd, onApply, onClearDemo, onRefresh }: Props) {
  const fileRef = useRef<HTMLInputElement>(null); const [consent, setConsent] = useState(false); const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState(false); const [error, setError] = useState('');
  const [result, setResult] = useState<{ message: string; proposals: Proposal[] } | null>(null); const [accepted, setAccepted] = useState<number[]>([]); const [clearConfirm, setClearConfirm] = useState(false);
  async function analyze() {
    if (!photo || !consent || !available || pending) return;
    setPending(true); setError(''); setResult(null); setAccepted([]);
    try {
      const res = await fetch('/api/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(40000), body: JSON.stringify({ image: photo, consent: true, workspace }) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || '분석에 실패했습니다.');
      const parsed = AssistantResponseSchema.parse(data);
      if (data.mode !== 'meta' || parsed.proposals.some(p => p.type !== 'add-device')) throw new Error('안전하게 반영할 수 없는 사진 분석 결과입니다.');
      setResult(parsed);
    } catch (e) { setError(e instanceof Error && e.name === 'TimeoutError' ? '사진 분석 시간이 초과되었습니다.' : e instanceof Error ? e.message : '사진을 분석하지 못했습니다.'); }
    finally { setPending(false); }
  }
  return <aside className="floating-panel photo-panel" aria-label="책상 사진 패널"><div className="panel-heading"><div><span className="eyebrow">START WITH YOUR DESK</span><h2>내 책상 사진</h2></div><button className="icon-button" aria-label="사진 패널 닫기" onClick={onClose}><X size={19}/></button></div><div className="panel-scroll">
    <p className="muted">사진에서 기기와 대략적인 배치를 찾습니다. 방 전체 3D 복원이나 케이블 감지 기능은 아닙니다.</p>
    <button className="photo-drop" disabled={pending || preparing} onClick={() => fileRef.current?.click()}>{photo ? <img src={photo} alt="사용자가 선택한 책상 참고 사진"/> : <><ImageIcon size={38}/><strong>{preparing ? '사진 준비 중...' : '사진 선택'}</strong><span>PNG, JPEG, WebP · 최대 8 MB</span></>}</button>
    <input hidden ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label="책상 사진 파일" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; setPreparing(true); setError(''); setConsent(false); setResult(null); setAccepted([]); try { onPhoto(await preparePhoto(f)); } catch (e) { setError(e instanceof Error ? e.message : '사진을 읽지 못했습니다.'); } finally { setPreparing(false); } }}/>
    <p className="micro-note">사진은 최대 1280px로 축소하고 메타데이터를 제거합니다. 선택만으로 전송하지 않습니다. 새로고침하면 사진은 사라집니다.</p>
    {available ? <><label className="checkbox-label"><input type="checkbox" checked={consent} disabled={pending} onChange={e => setConsent(e.target.checked)}/>이 사진과 기기 구성을 Meta API로 보내 분석하는 데 동의합니다.</label><button className="button primary full" disabled={!photo || !consent || pending || preparing} onClick={() => void analyze()}><Sparkle size={18}/>{pending ? 'Meta가 사진을 분석하고 있어요...' : 'Meta로 기기·배치 분석'}</button></> : <div className="integration-note"><strong>사진 AI 분석: Meta 키 미설정</strong><p>서버의 <code>.env</code>에 <code>MODEL_API_KEY</code>를 설정한 뒤 API 서버를 재시작하세요. 키를 이 화면에 입력하지 마세요.</p><button className="text-button" onClick={onRefresh}>연결 설정 다시 확인</button></div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {result && <section className="panel-section"><h3>사진에서 추정한 기기</h3><p className="muted">{result.message}</p>{result.proposals.map((p, i) => p.type === 'add-device' ? <div className="proposal-card" key={i}><strong>{p.name}</strong><p>{p.reason}</p>{accepted.includes(i) ? <span className="applied-note"><Check size={14}/>사진 추정으로 추가됨</span> : <button className="button secondary" disabled={workspace.devices.length >= 40} onClick={() => { try { onApply(p); setAccepted(old => [...old, i]); } catch (e) { setError(e instanceof Error ? e.message : '추가하지 못했습니다.'); } }}>확인하고 추가</button>}</div> : null)}<p className="micro-note">추가한 기기는 ‘사진에서 추정’과 ‘작동 상태 미확인’으로 저장됩니다. 배치 편집에서 수정할 수 있습니다.</p></section>}
    <button className="button secondary full" onClick={onAdd} disabled={pending || workspace.devices.length >= 40}><Plus size={18}/>기기 직접 추가</button>
    {workspace.devices.some(d => d.source === 'demo') && <div className="clear-demo-row"><button className="text-button" disabled={pending} onClick={() => { if (clearConfirm) { onClearDemo(); setClearConfirm(false); } else setClearConfirm(true); }}>{clearConfirm ? '예시 기기만 비우기 확인' : '예시 기기를 비우고 내 구성 시작'}</button>{clearConfirm && <button className="text-button" onClick={() => setClearConfirm(false)}>취소</button>}</div>}
    {photo && <button className="text-button danger-text" disabled={pending} onClick={() => { onPhoto(null); setResult(null); setConsent(false); }}>사진 지우기</button>}
  </div></aside>;
}

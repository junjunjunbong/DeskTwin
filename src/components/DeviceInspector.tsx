import { useEffect, useState } from 'react';
import { X, Link, Trash, Check, PencilSimple } from '@phosphor-icons/react';
import { DeviceIcon } from './ui';
import { DiagnosticPanel } from './DiagnosticPanel';
import {
  kindLabels,
  sourceLabels,
  statusLabels,
  type Device,
  type Workspace,
  type WorkspaceCommand,
} from '../domain/workspace';
interface Props {
  device: Device;
  workspace: Workspace;
  mode: string;
  onCommand: (command: WorkspaceCommand) => void;
  onClose: () => void;
  onConnect: () => void;
}
export function DeviceInspector({
  device: d,
  workspace,
  mode,
  onCommand,
  onClose,
  onConnect,
}: Props) {
  const [name, setName] = useState(d.name);
  const [model, setModel] = useState(d.model);
  const [status, setStatus] = useState(d.status);
  const [note, setNote] = useState(d.statusNote);
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    setName(d.name);
    setModel(d.model);
    setStatus(d.status);
    setNote(d.statusNote);
  }, [d.name, d.model, d.status, d.statusNote]);
  const links = workspace.connections.filter((c) => c.from === d.id || c.to === d.id);
  return (
    <aside className="floating-panel inspector" aria-label="선택한 기기">
      <div className="panel-heading">
        <div className="device-heading">
          <span className="device-glyph">
            <DeviceIcon kind={d.kind} size={29} />
          </span>
          <div>
            <span className="eyebrow">{kindLabels[d.kind]}</span>
            <h2>{d.name}</h2>
          </div>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="기기 상세 닫기">
          <X size={19} />
        </button>
      </div>
      <div className="panel-scroll">
        <div className="evidence-row">
          <span className={`source-badge ${d.source}`}>{sourceLabels[d.source]}</span>
          <span className="muted">실시간 감지 아님</span>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onCommand({
              type: 'update-device',
              id: d.id,
              patch: {
                name,
                model,
                source: name !== d.name || model !== d.model ? 'user-reported' : d.source,
                status,
                statusNote:
                  status === 'unknown' ? '' : note || '사용자가 직접 상태를 입력했습니다.',
              },
            });
          }}
        >
          <label>
            기기 이름
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label>
            모델명 <span className="muted">선택 사항</span>
            <input
              value={model}
              maxLength={100}
              placeholder="정확한 모델을 알고 있나요?"
              onChange={(e) => setModel(e.target.value)}
            />
          </label>
          <label>
            작동 상태 <span className="muted">사용자 확인</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Device['status'])}>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {status !== 'unknown' && (
            <label>
              확인한 내용
              <textarea
                value={note}
                maxLength={300}
                placeholder="예: 직접 연결한 뒤 화면이 나왔어요."
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          )}
          <button className="button secondary full" type="submit">
            <Check size={17} />
            기기 정보 저장
          </button>
        </form>
        {mode === 'edit' && (
          <section className="panel-section">
            <h3>
              <PencilSimple size={16} />
              배치 편집
            </h3>
            <p className="muted">장면에서 드래그하거나 아래 값을 조절하세요.</p>
            {(['x', 'z', 'rotation'] as const).map((axis) => (
              <label className="range-label" key={axis}>
                {axis === 'rotation' ? '회전' : axis === 'x' ? '좌우' : '앞뒤'}
                <output>
                  {d.placement[axis]}
                  {axis === 'rotation' ? '°' : ''}
                </output>
                <input
                  type="range"
                  aria-label={
                    axis === 'rotation'
                      ? '기기 회전'
                      : axis === 'x'
                        ? '기기 좌우 위치'
                        : '기기 앞뒤 위치'
                  }
                  min={axis === 'rotation' ? -180 : axis === 'x' ? -3.2 : -1.3}
                  max={axis === 'rotation' ? 180 : axis === 'x' ? 3.2 : 1.3}
                  step={axis === 'rotation' ? 5 : 0.05}
                  value={d.placement[axis]}
                  onChange={(e) =>
                    onCommand({
                      type: 'update-device',
                      id: d.id,
                      patch: { placement: { ...d.placement, [axis]: Number(e.target.value) } },
                    })
                  }
                />
              </label>
            ))}
          </section>
        )}
        <section className="panel-section">
          <div className="section-heading">
            <h3>
              연결 구성 <span className="count">{links.length}</span>
            </h3>
            <button className="text-button" onClick={onConnect}>
              <Link size={15} />
              추가
            </button>
          </div>
          {links.length === 0 ? (
            <p className="empty-copy">아직 기록된 연결이 없습니다.</p>
          ) : (
            links.map((c) => {
              const other = workspace.devices.find(
                (item) => item.id === (c.from === d.id ? c.to : c.from),
              )!;
              return (
                <div className="connection-item" key={c.id}>
                  <DeviceIcon kind={other.kind} size={20} />
                  <div>
                    <strong>{other.name}</strong>
                    <small>
                      {c.connector} · {sourceLabels[c.source]}
                    </small>
                  </div>
                  <button
                    className="icon-button small"
                    aria-label={`${other.name} 연결 삭제`}
                    onClick={() => onCommand({ type: 'remove-connection', id: c.id })}
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })
          )}
          <p className="micro-note">연결 기록은 케이블의 현재 동작을 증명하지 않습니다.</p>
        </section>
        {d.kind === 'monitor' && (
          <DiagnosticPanel
            key={d.id}
            device={d}
            onPropose={(p) => {
              if (p.type === 'set-status')
                onCommand({
                  type: 'update-device',
                  id: d.id,
                  patch: { status: p.status, statusNote: p.note },
                });
            }}
          />
        )}
        {deleting ? (
          <div className="delete-confirm">
            <p>기기와 관련 연결을 삭제할까요?</p>
            <button
              className="button danger"
              onClick={() => {
                onCommand({ type: 'remove-device', id: d.id });
                onClose();
              }}
            >
              삭제 확인
            </button>
            <button className="text-button" onClick={() => setDeleting(false)}>
              취소
            </button>
          </div>
        ) : (
          <button className="text-button danger-text" onClick={() => setDeleting(true)}>
            <Trash size={15} />
            기기 삭제
          </button>
        )}
      </div>
    </aside>
  );
}

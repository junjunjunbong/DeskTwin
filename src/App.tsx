import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Cube,
  House,
  Desktop,
  ShareNetwork,
  PencilSimple,
  Image as ImageIcon,
  ClockCounterClockwise,
  GearSix,
  GithubLogo,
  Plus,
  Minus,
  ArrowsOut,
  Sun,
  Moon,
  ArrowUp,
  ArrowCounterClockwise,
  ArrowUUpLeft,
  ArrowUUpRight,
  Check,
  DownloadSimple,
  UploadSimple,
  X,
  ChatCircleDots,
  Link,
  WarningCircle,
  Hand,
  Sparkle,
} from '@phosphor-icons/react';
import { useWorkspace, downloadFile } from './domain/useWorkspace';
import { useAssistant } from './domain/useAssistant';
import {
  createDemoWorkspace,
  kindLabels,
  parseWorkspace,
  sourceLabels,
  type WorkspaceCommand,
} from './domain/workspace';
import type { DeskMode } from './scene/deskScene';
import type { CanvasHandle } from './components/DeskCanvas';
import { DeviceInspector } from './components/DeviceInspector';
import { AddDeviceDialog, ConnectionDialog } from './components/WorkspaceDialogs';
import { DeviceIcon, Modal } from './components/ui';
import { AssistantPanel } from './components/AssistantPanel';
import { PhotoPanel } from './components/PhotoPanel';
import './styles/app.css';
const DeskCanvas = lazy(() => import('./components/DeskCanvas'));
type Panel = 'devices' | 'assistant' | 'history' | 'settings' | 'photo' | null;
export default function App() {
  const store = useWorkspace();
  const { workspace } = store;
  const assistant = useAssistant(workspace);
  const [mode, setMode] = useState<DeskMode>('desk');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<'device' | 'connection' | 'cloud' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [referencePhoto, setReferencePhoto] = useState<string | null>(null);
  const scene = useRef<CanvasHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const device = workspace.devices.find((d) => d.id === selected);
  const issues = workspace.devices.filter((d) => d.status === 'reported-issue').length;
  const safe = (run: () => void) => {
    try {
      run();
    } catch (e) {
      setToast(e instanceof Error ? e.message.split('\n')[0] : '요청을 처리하지 못했습니다.');
    }
  };
  function command(c: WorkspaceCommand) {
    safe(() => store.command(c));
  }
  function select(id: string | null) {
    setSelected(id);
    if (id) setPanel(null);
  }
  function openPanel(next: Panel) {
    setSelected(null);
    setPanel((p) => (p === next ? null : next));
  }
  function send(text: string) {
    if (!text.trim() || assistant.pending) return;
    setPanel('assistant');
    setSelected(null);
    setPrompt('');
    void assistant.send(text);
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    send(prompt);
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (selected && !workspace.devices.some((d) => d.id === selected)) setSelected(null);
  }, [selected, workspace.devices]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) store.redo();
        else store.undo();
      }
      if (e.key === 'Escape') {
        setSelected(null);
        setPanel(null);
      }
    }
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  });
  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPanel(null);
            setSelected(null);
            setMode('desk');
          }}
        >
          <span className="brand-mark">
            <Cube size={25} weight="duotone" />
          </span>
          <span>
            <strong>DeskTwin</strong>
            <small>Your desk, understood.</small>
          </span>
        </a>
        <div className="header-divider" />
        <span className="workspace-title">{workspace.name}</span>
        <div className="header-actions">
          <span className="local-pill">
            <Check size={13} />
            {store.error ? '저장 확인 필요' : '브라우저 저장'}
          </span>
          <a
            className="github-link"
            href="https://github.com/junjunjunbong/DeskTwin"
            target="_blank"
            rel="noreferrer"
          >
            <GithubLogo size={19} />
            <span>GitHub</span>
          </a>
          <button
            className="icon-button"
            aria-label="설정 열기"
            onClick={() => openPanel('settings')}
          >
            <GearSix size={21} />
          </button>
        </div>
      </header>
      <div className="workspace-body">
        <nav className="nav-rail" aria-label="주 탐색">
          <div className="nav-top">
            <button
              className={`nav-button ${mode === 'desk' && !panel && !selected ? 'active' : ''}`}
              aria-label="내 책상"
              title="내 책상"
              onClick={() => {
                setMode('desk');
                setPanel(null);
                setSelected(null);
              }}
            >
              <House size={22} />
            </button>
            <button
              className={`nav-button ${panel === 'devices' ? 'active' : ''}`}
              aria-label="기기 목록"
              title="기기 목록"
              onClick={() => openPanel('devices')}
            >
              <Desktop size={22} />
            </button>
            <button
              className={`nav-button ${mode === 'connections' ? 'active' : ''}`}
              aria-label="연결 보기"
              title="연결 보기"
              onClick={() => {
                setMode('connections');
                setPanel(null);
              }}
            >
              <ShareNetwork size={22} />
            </button>
            <button
              className={`nav-button ${mode === 'edit' ? 'active' : ''}`}
              aria-label="배치 편집"
              title="배치 편집"
              onClick={() => {
                setMode('edit');
                setPanel(null);
              }}
            >
              <PencilSimple size={22} />
            </button>
            <div className="rail-divider" />
            <button
              className={`nav-button ${panel === 'photo' ? 'active' : ''}`}
              aria-label="책상 사진"
              title="책상 사진"
              onClick={() => openPanel('photo')}
            >
              <ImageIcon size={22} />
            </button>
            <button
              className={`nav-button ${panel === 'history' ? 'active' : ''}`}
              aria-label="변경 기록"
              title="변경 기록"
              onClick={() => openPanel('history')}
            >
              <ClockCounterClockwise size={22} />
            </button>
          </div>
          <div className="nav-bottom">
            <button
              className="nav-button"
              aria-label="기기 추가"
              title="기기 추가"
              disabled={workspace.devices.length >= 40}
              onClick={() => setDialog('device')}
            >
              <Plus size={23} />
            </button>
            <button
              className={`nav-button ${panel === 'assistant' ? 'active' : ''}`}
              aria-label="AI 대화"
              title="AI 대화"
              onClick={() => openPanel('assistant')}
            >
              <ChatCircleDots size={23} />
            </button>
          </div>
        </nav>
        <main className="scene-area" aria-label="나의 작업 공간">
          <Suspense
            fallback={
              <div className="scene-loading">
                <Cube size={36} />
                <p>작업실을 구성하고 있어요.</p>
              </div>
            }
          >
            <DeskCanvas
              ref={scene}
              workspace={workspace}
              selected={selected}
              mode={mode}
              onSelect={select}
              onMove={(id, x, z) => {
                const d = workspace.devices.find((d) => d.id === id);
                if (d)
                  command({
                    type: 'update-device',
                    id,
                    patch: { placement: { ...d.placement, x, z } },
                  });
              }}
            />
          </Suspense>
          <div className="scene-heading">
            <span className="eyebrow">A SPACE THAT FEELS LIKE YOU</span>
            <h1>{workspace.name}</h1>
            <span className="scene-caption">
              <span className="neutral-dot" />
              예시 기반 3D 장면 · 실시간 감지 아님
            </span>
          </div>
          <div className="view-switch" aria-label="보기 모드">
            {(
              [
                ['desk', '내 책상'],
                ['connections', '연결'],
                ['edit', '배치 편집'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={mode === value ? 'active' : ''}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);
                  setPanel(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="scene-toolbar">
            <div className="scene-counter">
              <Desktop size={19} />
              <strong>{workspace.devices.length}</strong>
              <span>기기</span>
            </div>
            <button
              className="icon-button"
              title="확대"
              aria-label="확대"
              onClick={() => scene.current?.zoom(0.15)}
            >
              <Plus size={19} />
            </button>
            <button
              className="icon-button"
              title="축소"
              aria-label="축소"
              onClick={() => scene.current?.zoom(-0.15)}
            >
              <Minus size={19} />
            </button>
            <button
              className="icon-button"
              title="시점 초기화"
              aria-label="시점 초기화"
              onClick={() => scene.current?.reset()}
            >
              <ArrowsOut size={19} />
            </button>
            <div className="toolbar-divider" />
            <button
              className="icon-button"
              title="조명 전환"
              aria-label="조명 전환"
              onClick={() =>
                command({
                  type: 'appearance',
                  patch: {
                    lighting: workspace.appearance.lighting === 'night' ? 'sunset' : 'night',
                  },
                })
              }
            >
              {workspace.appearance.lighting === 'night' ? <Moon size={20} /> : <Sun size={20} />}
            </button>
          </div>
          <div className="canvas-footer">
            <span>
              <Hand size={15} />
              {mode === 'edit'
                ? '기기를 드래그해 배치를 바꿔보세요'
                : '드래그로 둘러보기 · 스크롤로 확대'}
            </span>
            <div>
              <button
                className="icon-button small"
                aria-label="실행 취소"
                disabled={!store.canUndo}
                onClick={store.undo}
              >
                <ArrowUUpLeft size={18} />
              </button>
              <button
                className="icon-button small"
                aria-label="다시 실행"
                disabled={!store.canRedo}
                onClick={store.redo}
              >
                <ArrowUUpRight size={18} />
              </button>
            </div>
          </div>
          {mode === 'connections' && (
            <div className="connection-legend">
              <span>
                <i className="legend-line solid" />
                사용자 입력
              </span>
              <span>
                <i className="legend-line dashed" />
                예시 / 추정
              </span>
              <button
                className="text-button"
                disabled={workspace.devices.length < 2}
                onClick={() => setDialog('connection')}
              >
                <Link size={16} />
                연결 추가
              </button>
            </div>
          )}
          {issues > 0 && !selected && !panel && (
            <button
              className="issue-summary"
              onClick={() => {
                const d = workspace.devices.find((d) => d.status === 'reported-issue');
                if (d) select(d.id);
              }}
            >
              <WarningCircle size={17} />
              {issues}개 기기 · 사용자가 보고한 문제
            </button>
          )}
          {device && (
            <DeviceInspector
              key={device.id}
              device={device}
              workspace={workspace}
              mode={mode}
              onCommand={command}
              onClose={() => setSelected(null)}
              onConnect={() => setDialog('connection')}
            />
          )}
          {panel === 'devices' && (
            <aside className="floating-panel device-library" aria-label="기기 목록 패널">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">YOUR COLLECTION</span>
                  <h2>
                    내 책상 위의 기기 <span className="count">{workspace.devices.length}</span>
                  </h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="기기 목록 닫기"
                  onClick={() => setPanel(null)}
                >
                  <X size={19} />
                </button>
              </div>
              <div className="panel-scroll">
                <input
                  className="search-input"
                  aria-label="기기 검색"
                  placeholder="기기 검색..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {workspace.devices
                  .filter((d) =>
                    `${d.name} ${d.model} ${kindLabels[d.kind]}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((d) => (
                    <button className="device-list-row" key={d.id} onClick={() => select(d.id)}>
                      <span className="list-device-glyph">
                        <DeviceIcon kind={d.kind} size={24} />
                      </span>
                      <span>
                        <strong>{d.name}</strong>
                        <small>
                          {kindLabels[d.kind]} · {sourceLabels[d.source]}
                        </small>
                      </span>
                      <i className={`status-dot ${d.status}`} />
                    </button>
                  ))}
                {workspace.devices.length === 0 && (
                  <p className="empty-copy">첫 번째 기기를 추가해 보세요.</p>
                )}
                <button
                  className="button secondary full"
                  onClick={() => setDialog('device')}
                  disabled={workspace.devices.length >= 40}
                >
                  <Plus size={18} />
                  기기 직접 추가
                </button>
              </div>
              <div className="panel-footnote">회색 점: 상태 미확인 · 주황 점: 사용자 보고 문제</div>
            </aside>
          )}
          {panel === 'assistant' && (
            <AssistantPanel
              workspace={workspace}
              messages={assistant.messages}
              pending={assistant.pending}
              mode={assistant.mode}
              decisions={assistant.decisions}
              onClose={() => setPanel(null)}
              onSend={send}
              onDismiss={(key) => assistant.decide(key, 'dismissed')}
              onApply={(p, key) =>
                safe(() => {
                  store.proposal(p);
                  assistant.decide(key, 'applied');
                  setToast('사용자 확인 후 구성에 반영했습니다.');
                })
              }
            />
          )}
          {panel === 'history' && (
            <aside className="floating-panel" aria-label="변경 기록 패널">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">A LITTLE MEMORY</span>
                  <h2>변경 기록</h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="기록 닫기"
                  onClick={() => setPanel(null)}
                >
                  <X size={19} />
                </button>
              </div>
              <div className="panel-scroll">
                {workspace.history.length ? (
                  workspace.history.map((event) => (
                    <div className="history-item" key={event.id}>
                      <ClockCounterClockwise size={18} />
                      <div>
                        <strong>{event.summary}</strong>
                        <small>
                          {new Date(event.at).toLocaleString('ko-KR')} ·{' '}
                          {sourceLabels[event.source]}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <ClockCounterClockwise size={36} />
                    <h3>아직 변경 기록이 없어요</h3>
                    <p>기기와 연결을 수정하면 여기에 기록됩니다.</p>
                  </div>
                )}
              </div>
            </aside>
          )}
          {panel === 'photo' && (
            <PhotoPanel
              workspace={workspace}
              photo={referencePhoto}
              onPhoto={setReferencePhoto}
              available={assistant.available}
              onClose={() => setPanel(null)}
              onAdd={() => setDialog('device')}
              onApply={(p) => store.proposal(p, 'photo-inferred')}
              onRefresh={assistant.refreshHealth}
              onClearDemo={() =>
                safe(() => {
                  const devices = workspace.devices.filter((d) => d.source !== 'demo');
                  const ids = new Set(devices.map((d) => d.id));
                  store.replace({
                    ...workspace,
                    devices,
                    connections: workspace.connections.filter(
                      (c) => ids.has(c.from) && ids.has(c.to),
                    ),
                  });
                  setToast('예시 기기를 비웠습니다. 실행 취소로 되돌릴 수 있습니다.');
                })
              }
            />
          )}
        </main>
      </div>
      <footer className="command-area">
        <form className="composer" onSubmit={submit}>
          <span className="composer-star">
            <Sparkle size={22} weight="fill" />
          </span>
          <input
            ref={inputRef}
            aria-label="DeskTwin에게 메시지"
            maxLength={2000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="내 책상에 대해 알려주세요. 예: 오른쪽 모니터를 Dock에 HDMI로 연결했어"
          />
          <button
            className="send-button"
            type="submit"
            aria-label="메시지 보내기"
            disabled={!prompt.trim() || assistant.pending}
          >
            <ArrowUp size={22} weight="bold" />
          </button>
        </form>
        <div className="composer-bottom">
          <span className="privacy-note">
            <span className="neutral-dot" />
            {assistant.mode === 'demo'
              ? '로컬 데모 · 외부 전송 없음'
              : 'Meta 모델 · 대화와 기기 구성 전송'}
          </span>
          <div className="quick-prompts">
            <button className="provider-toggle" onClick={() => setDialog('cloud')}>
              {assistant.mode === 'meta' ? 'Meta 연결 설정' : 'Meta API 연결'}
            </button>
            <button onClick={() => send('오른쪽 모니터를 Dock에 HDMI로 연결했어')}>
              연결 구성 알려주기
            </button>
            <button onClick={() => send('오른쪽 모니터가 안 나와')}>모니터 문제 해결</button>
          </div>
        </div>
      </footer>
      {dialog === 'device' && (
        <AddDeviceDialog onClose={() => setDialog(null)} onCommand={command} />
      )}
      {dialog === 'connection' && (
        <ConnectionDialog
          workspace={workspace}
          selected={selected}
          onClose={() => setDialog(null)}
          onCommand={command}
        />
      )}
      {panel === 'settings' && (
        <Modal title="작업실 설정" onClose={() => setPanel(null)}>
          <label>
            작업실 이름
            <input
              defaultValue={workspace.name}
              maxLength={60}
              onBlur={(e) => {
                if (e.target.value.trim()) command({ type: 'rename', name: e.target.value.trim() });
              }}
            />
          </label>
          <label>
            조명
            <select
              value={workspace.appearance.lighting}
              onChange={(e) =>
                command({
                  type: 'appearance',
                  patch: { lighting: e.target.value as 'day' | 'sunset' | 'night' },
                })
              }
            >
              <option value="day">맑은 낮</option>
              <option value="sunset">따뜻한 오후</option>
              <option value="night">조용한 밤</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={workspace.appearance.labels}
              onChange={(e) => command({ type: 'appearance', patch: { labels: e.target.checked } })}
            />
            모든 기기 이름 표시
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={workspace.appearance.decor}
              onChange={(e) => command({ type: 'appearance', patch: { decor: e.target.checked } })}
            />
            식물·의자·소품 표시
          </label>
          <div className="two-columns">
            <button
              className="button secondary"
              onClick={() =>
                downloadFile('desktwin-workspace.json', JSON.stringify(workspace, null, 2))
              }
            >
              <DownloadSimple size={18} />
              JSON 내보내기
            </button>
            <button className="button secondary" onClick={() => importRef.current?.click()}>
              <UploadSimple size={18} />
              JSON 불러오기
            </button>
          </div>
          <p className="micro-note">
            기기와 연결 구성은 브라우저에 저장됩니다. 사진, 대화, API 키는 JSON에 포함하지 않습니다.
          </p>
          <hr />
          {resetConfirm ? (
            <div className="delete-confirm">
              <p>현재 구성을 예시로 되돌릴까요? 실행 취소할 수 있습니다.</p>
              <button
                className="button danger"
                onClick={() => {
                  store.replace(createDemoWorkspace());
                  setResetConfirm(false);
                  setPanel(null);
                }}
              >
                예시로 초기화 확인
              </button>
              <button className="text-button" onClick={() => setResetConfirm(false)}>
                취소
              </button>
            </div>
          ) : (
            <button className="text-button danger-text" onClick={() => setResetConfirm(true)}>
              <ArrowCounterClockwise size={16} />
              예시 구성으로 초기화
            </button>
          )}
        </Modal>
      )}
      <input
        hidden
        ref={importRef}
        type="file"
        accept=".json,application/json"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            if (f.size > 256000) throw new Error('JSON 파일은 256 KB 이하여야 합니다.');
            const next = parseWorkspace(JSON.parse(await f.text()));
            store.replace(next);
            setSelected(null);
            setToast('구성을 불러왔습니다. 실행 취소로 이전 상태로 돌아갈 수 있습니다.');
          } catch {
            setToast('올바른 DeskTwin v1 JSON 파일이 아닙니다. 기존 구성은 유지했습니다.');
          }
        }}
      />
      {dialog === 'cloud' && (
        <Modal title="Meta AI 연결" onClose={() => setDialog(null)}>
          <div className="integration-note">
            <strong>
              {assistant.available
                ? `서버 설정 확인: ${assistant.model}`
                : assistant.healthState === 'checking'
                  ? '서버 설정을 확인하고 있습니다.'
                  : 'Meta API 키가 설정되지 않았습니다.'}
            </strong>
            <p>
              {assistant.available
                ? '키가 설정되어 있습니다. 실제 모델 응답 성공 여부는 아직 이 화면에서 검증하지 않았습니다.'
                : '프로젝트의 .env에 MODEL_API_KEY를 설정하고 API 서버를 재시작하세요. API 키는 브라우저에 입력하거나 Git에 올리지 마세요.'}
            </p>
            <button className="text-button" onClick={assistant.refreshHealth}>
              서버 설정 다시 확인
            </button>
          </div>
          <p className="muted">
            활성화하면 이후 전송하는 메시지, 최근 대화 12개, 기기·연결 구성을 Meta API로 보냅니다.
            사진은 별도 분석 동의 없이 보내지 않습니다. API 사용료가 발생할 수 있습니다.
          </p>
          <p className="micro-note">
            로컬 데모는 제한된 규칙 기반 예시입니다. 실제 LLM은 아닙니다. Meta 응답도 검증된
            하드웨어 상태가 아니며, 변경은 별도로 확인해야 적용됩니다.
          </p>
          {assistant.mode === 'meta' ? (
            <button
              className="button secondary full"
              disabled={assistant.pending}
              onClick={() => {
                assistant.disableMeta();
                setDialog(null);
              }}
            >
              Meta 끄고 로컬 데모로 전환
            </button>
          ) : (
            <button
              className="button primary full"
              disabled={!assistant.available || assistant.pending}
              onClick={() => {
                assistant.enableMeta();
                setDialog(null);
                setToast('Meta 연결을 활성화했습니다. 다음 메시지부터 외부 API로 전송합니다.');
              }}
            >
              전송 내용을 확인했고 Meta 연결 켜기
            </button>
          )}
        </Modal>
      )}

      {(toast || store.error) && (
        <div className="toast" role="status">
          <WarningCircle size={18} />
          <span>{toast || store.error}</span>
          <button className="icon-button small" aria-label="알림 닫기" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

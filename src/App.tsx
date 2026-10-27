import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Cube,
  House,
  Desktop,
  ShareNetwork,
  PencilSimple,
  Image as ImageIcon,
  ClockCounterClockwise,
  GearSix,
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
  localizeLegacyDemoForDisplay,
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
import {
  AddObjectDialog,
  SceneObjectInspector,
  SceneObjectList,
} from './components/SceneObjectPanel';
import { applySceneDraft } from './domain/sceneProposal';
import { CommitTextInput } from './components/CommitInput';
import './styles/app.css';
const DeskCanvas = lazy(() => import('./components/DeskCanvas'));
type Panel = 'objects' | 'devices' | 'assistant' | 'history' | 'settings' | 'photo' | null;
export default function App() {
  const store = useWorkspace();
  const workspace = useMemo(() => localizeLegacyDemoForDisplay(store.workspace), [store.workspace]);
  const assistant = useAssistant(workspace);
  const [mode, setMode] = useState<DeskMode>('desk');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [dialog, setDialog] = useState<'object' | 'device' | 'connection' | 'cloud' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [referencePhoto, setReferencePhoto] = useState<string | null>(null);
  const scene = useRef<CanvasHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const device = workspace.devices.find((d) => d.id === selected);
  const sceneObject = workspace.objects.find((o) => o.id === selected);
  const issues = workspace.devices.filter((d) => d.status === 'reported-issue').length;
  const safe = async (run: () => unknown | Promise<unknown>): Promise<boolean> => {
    try {
      return (await run()) !== false;
    } catch (e) {
      setToast(e instanceof Error ? e.message.split('\n')[0] : 'Could not process the request.');
      return false;
    }
  };
  function command(c: WorkspaceCommand) {
    return safe(() => store.command(c));
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
    if (
      selected &&
      !workspace.devices.some((d) => d.id === selected) &&
      !workspace.objects.some((o) => o.id === selected)
    )
      setSelected(null);
  }, [selected, workspace.devices, workspace.objects]);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('[role="dialog"]')) return;
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
            {store.error ? 'Check notice' : 'Browser storage'}
          </span>
          <button
            className="icon-button"
            aria-label="Open settings"
            onClick={() => openPanel('settings')}
          >
            <GearSix size={21} />
          </button>
        </div>
      </header>
      <div className="workspace-body">
        <nav className="nav-rail" aria-label="Main navigation">
          <div className="nav-top">
            <button
              className={`nav-button ${mode === 'desk' && !panel && !selected ? 'active' : ''}`}
              aria-label="My desk"
              title="My desk"
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
              aria-label="Device list"
              title="Device list"
              onClick={() => openPanel('devices')}
            >
              <Desktop size={22} />
            </button>
            <button
              className={`nav-button ${panel === 'objects' ? 'active' : ''}`}
              aria-label="Scene objects"
              title="Scene objects"
              onClick={() => openPanel('objects')}
            >
              <Cube size={22} />
            </button>
            <button
              className={`nav-button ${mode === 'connections' ? 'active' : ''}`}
              aria-label="View connections"
              title="View connections"
              onClick={() => {
                setMode('connections');
                setPanel(null);
              }}
            >
              <ShareNetwork size={22} />
            </button>
            <button
              className={`nav-button ${mode === 'edit' ? 'active' : ''}`}
              aria-label="Edit placement"
              title="Edit placement"
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
              aria-label="Desk photo"
              title="Desk photo"
              onClick={() => openPanel('photo')}
            >
              <ImageIcon size={22} />
            </button>
            <button
              className={`nav-button ${panel === 'history' ? 'active' : ''}`}
              aria-label="Change history"
              title="Change history"
              onClick={() => openPanel('history')}
            >
              <ClockCounterClockwise size={22} />
            </button>
          </div>
          <div className="nav-bottom">
            <button
              className="nav-button"
              aria-label="Add device"
              title="Add device"
              disabled={workspace.devices.length >= 40}
              onClick={() => setDialog('device')}
            >
              <Plus size={23} />
            </button>
            <button
              className={`nav-button ${panel === 'assistant' ? 'active' : ''}`}
              aria-label="AI chat"
              title="AI chat"
              onClick={() => openPanel('assistant')}
            >
              <ChatCircleDots size={23} />
            </button>
          </div>
        </nav>
        <main className="scene-area" aria-label="My workspace">
          <Suspense
            fallback={
              <div className="scene-loading">
                <Cube size={36} />
                <p>Setting up your workspace...</p>
              </div>
            }
          >
            <DeskCanvas
              ref={scene}
              workspace={workspace}
              selected={selected}
              mode={mode}
              onSelect={select}
              onMove={(id, placement, dragPath) => {
                void command({ type: 'move-object', id, placement, dragPath });
              }}
            />
          </Suspense>
          <div className="scene-heading">
            <span className="eyebrow">A SPACE THAT FEELS LIKE YOU</span>
            <h1>{workspace.name}</h1>
            <span className="scene-caption">
              <span className="neutral-dot" />
              Editable voxel scene · No live device detection
            </span>
          </div>
          <div className="view-switch" aria-label="View mode">
            {(
              [
                ['desk', 'My desk'],
                ['connections', 'Connections'],
                ['edit', 'Edit placement'],
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
              <span>devices</span>
            </div>
            <button
              className="icon-button"
              title="Zoom in"
              aria-label="Zoom in"
              onClick={() => scene.current?.zoom(0.15)}
            >
              <Plus size={19} />
            </button>
            <button
              className="icon-button"
              title="Zoom out"
              aria-label="Zoom out"
              onClick={() => scene.current?.zoom(-0.15)}
            >
              <Minus size={19} />
            </button>
            <button
              className="icon-button"
              title="Reset view"
              aria-label="Reset view"
              onClick={() => scene.current?.reset()}
            >
              <ArrowsOut size={19} />
            </button>
            <div className="toolbar-divider" />
            <button
              className="icon-button"
              title="Change lighting"
              aria-label="Change lighting"
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
                ? 'Drag objects to rearrange them'
                : 'Drag to look around · Scroll to zoom'}
            </span>
            <div>
              <button
                className="icon-button small"
                aria-label="Undo"
                disabled={!store.canUndo}
                onClick={store.undo}
              >
                <ArrowUUpLeft size={18} />
              </button>
              <button
                className="icon-button small"
                aria-label="Redo"
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
                User-reported
              </span>
              <span>
                <i className="legend-line dashed" />
                Example / inferred
              </span>
              <button
                className="text-button"
                disabled={workspace.devices.length < 2}
                onClick={() => setDialog('connection')}
              >
                <Link size={16} />
                Add connection
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
              {issues} {issues === 1 ? 'device' : 'devices'} · User-reported issues
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
          {sceneObject && (
            <SceneObjectInspector
              key={sceneObject.id}
              object={sceneObject}
              workspace={workspace}
              onCommand={command}
              onClose={() => setSelected(null)}
            />
          )}
          {panel === 'objects' && (
            <SceneObjectList
              workspace={workspace}
              onSelect={select}
              onClose={() => setPanel(null)}
              onAdd={() => setDialog('object')}
            />
          )}
          {panel === 'devices' && (
            <aside className="floating-panel device-library" aria-label="Device list panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">YOUR COLLECTION</span>
                  <h2>
                    Devices on my desk <span className="count">{workspace.devices.length}</span>
                  </h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close device list"
                  onClick={() => setPanel(null)}
                >
                  <X size={19} />
                </button>
              </div>
              <div className="panel-scroll">
                <input
                  className="search-input"
                  aria-label="Search devices"
                  placeholder="Search devices..."
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
                  <p className="empty-copy">Add your first device.</p>
                )}
                <button
                  className="button secondary full"
                  onClick={() => setDialog('device')}
                  disabled={workspace.devices.length >= 40}
                >
                  <Plus size={18} />
                  Add a device manually
                </button>
              </div>
              <div className="panel-footnote">
                Gray: status unknown · Orange: user-reported issue
              </div>
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
                safe(async () => {
                  if (!(await store.proposal(p))) return false;
                  assistant.decide(key, 'applied');
                  setToast('Applied to your workspace after confirmation.');
                })
              }
            />
          )}
          {panel === 'history' && (
            <aside className="floating-panel" aria-label="Change history panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">A LITTLE MEMORY</span>
                  <h2>Change history</h2>
                </div>
                <button
                  className="icon-button"
                  aria-label="Close history"
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
                          {new Date(event.at).toLocaleString('en-US')} ·{' '}
                          {sourceLabels[event.source]}
                        </small>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <ClockCounterClockwise size={36} />
                    <h3>No changes yet</h3>
                    <p>Changes to devices and connections will appear here.</p>
                  </div>
                )}
              </div>
            </aside>
          )}
          {panel === 'photo' && (
            <PhotoPanel
              workspace={store.workspace}
              photo={referencePhoto}
              onPhoto={setReferencePhoto}
              available={assistant.available}
              onClose={() => setPanel(null)}
              onAdd={() => setDialog('device')}
              onApply={async (draft, base) => {
                if (!(await store.replace(applySceneDraft(store.workspace, base, draft), base)))
                  throw new Error(
                    'The scene was not saved. Resolve the storage notice and try again.',
                  );
              }}
              storageConflict={store.conflict}
              onRefresh={assistant.refreshHealth}
              onClearDemo={() =>
                safe(async () => {
                  const reportedEndpoints = new Set(
                    store.workspace.connections
                      .filter((c) => c.source !== 'demo')
                      .flatMap((c) => [c.from, c.to]),
                  );
                  const devices = store.workspace.devices.filter(
                    (d) =>
                      d.source !== 'demo' ||
                      d.status !== 'unknown' ||
                      d.statusNote ||
                      d.visual.source !== 'demo' ||
                      reportedEndpoints.has(d.id),
                  );
                  const ids = new Set(devices.map((d) => d.id));
                  const saved = await store.replace({
                    ...store.workspace,
                    devices,
                    connections: store.workspace.connections.filter(
                      (c) => ids.has(c.from) && ids.has(c.to),
                    ),
                  });
                  if (!saved) return false;
                  setToast(
                    'Unused example devices removed. Devices with user reports were kept. You can undo this change.',
                  );
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
            aria-label="Message DeskTwin"
            maxLength={2000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Tell me about your desk. For example: I connected the right monitor to the dock with HDMI."
          />
          <button
            className="send-button"
            type="submit"
            aria-label="Send message"
            disabled={!prompt.trim() || assistant.pending}
          >
            <ArrowUp size={22} weight="bold" />
          </button>
        </form>
        <div className="composer-bottom">
          <span className="privacy-note">
            <span className="neutral-dot" />
            {assistant.mode === 'demo'
              ? 'Local demo · No external data sent'
              : 'Meta model · Sends conversation and device setup'}
          </span>
          <div className="quick-prompts">
            <button className="provider-toggle" onClick={() => setDialog('cloud')}>
              {assistant.mode === 'meta' ? 'Meta connection settings' : 'Connect Meta API'}
            </button>
            <button onClick={() => send('I connected the right monitor to the dock with HDMI')}>
              Describe a connection
            </button>
            <button onClick={() => send('The right monitor is not displaying')}>
              Troubleshoot a monitor
            </button>
          </div>
        </div>
      </footer>
      {dialog === 'object' && (
        <AddObjectDialog onClose={() => setDialog(null)} onCommand={command} />
      )}
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
        <Modal title="Workspace settings" onClose={() => setPanel(null)}>
          <label>
            Workspace name
            <CommitTextInput
              value={workspace.name}
              maxLength={60}
              onCommit={(name) => command({ type: 'rename', name })}
            />
          </label>
          <label>
            Lighting
            <select
              value={workspace.appearance.lighting}
              onChange={(e) =>
                command({
                  type: 'appearance',
                  patch: { lighting: e.target.value as 'day' | 'sunset' | 'night' },
                })
              }
            >
              <option value="day">Daylight</option>
              <option value="sunset">Warm afternoon</option>
              <option value="night">Quiet night</option>
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={workspace.appearance.labels}
              onChange={(e) => command({ type: 'appearance', patch: { labels: e.target.checked } })}
            />
            Show object names
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={workspace.appearance.decor}
              onChange={(e) => command({ type: 'appearance', patch: { decor: e.target.checked } })}
            />
            Show furniture and decor
          </label>
          <div className="two-columns">
            <button
              className="button secondary"
              onClick={() =>
                downloadFile('desktwin-workspace.json', JSON.stringify(store.workspace, null, 2))
              }
            >
              <DownloadSimple size={18} />
              Export JSON
            </button>
            <button className="button secondary" onClick={() => importRef.current?.click()}>
              <UploadSimple size={18} />
              Import JSON
            </button>
          </div>
          <p className="micro-note">
            Scene objects, devices, and connections are stored in your browser. Photos,
            conversations, and API keys are not included in the JSON export.
          </p>
          <hr />
          {resetConfirm ? (
            <div className="delete-confirm">
              <p>Reset your workspace to the example? You can undo this change.</p>
              <button
                className="button danger"
                onClick={async () => {
                  if (!(await store.replace(createDemoWorkspace()))) return;
                  setResetConfirm(false);
                  setPanel(null);
                }}
              >
                Confirm reset to example
              </button>
              <button className="text-button" onClick={() => setResetConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="text-button danger-text" onClick={() => setResetConfirm(true)}>
              <ArrowCounterClockwise size={16} />
              Reset to example
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
            if (f.size > 12_000_000) throw new Error('The JSON file must be 12 MB or smaller.');
            const next = parseWorkspace(JSON.parse(await f.text()));
            if (!(await store.replace(next))) return;
            setSelected(null);
            setToast('Workspace imported. Undo to restore the previous state.');
          } catch {
            setToast('Invalid DeskTwin v1/v2 JSON file. Your existing workspace was preserved.');
          }
        }}
      />
      {dialog === 'cloud' && (
        <Modal title="Meta AI connection" onClose={() => setDialog(null)}>
          <div className="integration-note">
            <strong>
              {assistant.available
                ? `Server configured: ${assistant.model}`
                : assistant.healthState === 'checking'
                  ? 'Checking server configuration...'
                  : 'No Meta API key is configured.'}
            </strong>
            <p>
              {assistant.available
                ? 'A key is configured. A successful model response has not yet been verified here.'
                : 'Set MODEL_API_KEY in the project’s .env file and restart the API server. Do not enter your key in the browser or commit it to Git.'}
            </p>
            <button className="text-button" onClick={assistant.refreshHealth}>
              Check server settings again
            </button>
          </div>
          <p className="muted">
            Once enabled, messages you send, your last 12 conversation messages, and your device and
            connection setup are sent to the Meta API. Photos are only sent with separate consent.
            API usage may incur charges.
          </p>
          <p className="micro-note">
            The local demo uses limited rules and is not an LLM. Meta responses do not verify
            hardware status; changes still require your confirmation.
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
              Turn off Meta and use the local demo
            </button>
          ) : (
            <button
              className="button primary full"
              disabled={!assistant.available || assistant.pending}
              onClick={() => {
                assistant.enableMeta();
                setDialog(null);
                setToast('Meta enabled. Future messages will be sent to the external API.');
              }}
            >
              I understand what will be sent · Enable Meta
            </button>
          )}
        </Modal>
      )}

      {store.conflict && (
        <section className="storage-conflict" role="alert" aria-label="Storage conflict">
          <strong>This workspace changed in another tab.</strong>
          <p>
            Your view is preserved. Export it if needed, then load the latest saved workspace before
            making more changes.
          </p>
          <div className="placement-actions">
            <button
              className="button secondary"
              onClick={() =>
                downloadFile('desktwin-local-copy.json', JSON.stringify(store.workspace, null, 2))
              }
            >
              Export this tab's copy
            </button>
            <button
              className="button primary"
              disabled={store.saving}
              onClick={async () => {
                if (await store.reloadLatest()) {
                  setSelected(null);
                  setToast(
                    'Loaded the latest saved workspace. Undo history was reset for this tab.',
                  );
                }
              }}
            >
              Load latest saved workspace
            </button>
          </div>
        </section>
      )}

      {(toast || store.error) && (
        <div className="toast" role="status">
          <WarningCircle size={18} />
          <span>{toast || store.error}</span>
          <button
            className="icon-button small"
            aria-label="Dismiss notification"
            onClick={() => setToast('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

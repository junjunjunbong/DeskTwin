import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Cube,
  House,
  Desktop,
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
  Hand,
  Sparkle,
  Cpu,
  WarningCircle,
  CaretDown,
  CaretUp,
  Eye,
} from '@phosphor-icons/react';
import { useWorkspace, downloadFile } from './domain/useWorkspace';
import { useAssistant } from './domain/useAssistant';
import { useHardware } from './domain/useHardware';
import { portableWorkspace } from './domain/workspacePrivacy';
import {
  HardwarePanel,
  HardwareSummary,
  HardwareBadge,
  DeviceHardwareStatus,
} from './components/HardwarePanel';
import {
  createDemoWorkspace,
  localizeLegacyDemoForDisplay,
  parseWorkspace,
  sourceLabels,
  type WorkspaceCommand,
} from './domain/workspace';
import type { DeskMode } from './scene/deskScene';
import type { CanvasHandle } from './components/DeskCanvas';
import { DeviceInspector } from './components/DeviceInspector';
import { WorkspaceOverview } from './components/WorkspaceOverview';
import { AddDeviceDialog, ConnectionDialog } from './components/WorkspaceDialogs';
import { Modal } from './components/ui';
import { AssistantPanel } from './components/AssistantPanel';
import { DeskSetupPanel } from './components/DeskSetupPanel';
import type { ConnectionFocusPath } from './domain/connectionView';
import {
  AddObjectDialog,
  SceneObjectInspector,
  SceneObjectList,
} from './components/SceneObjectPanel';
import { applySceneDraft, retainedDevices } from './domain/sceneProposal';
import { CommitTextInput } from './components/CommitInput';
import { useDeviceDrafts } from './components/useDeviceDrafts';
import './styles/app.css';
const PhotoPanel = lazy(() =>
  import('./components/PhotoPanel').then((module) => ({ default: module.PhotoPanel })),
);
const DeskCanvas = lazy(() => import('./components/DeskCanvas'));
type Panel =
  'objects' | 'assistant' | 'history' | 'settings' | 'photo' | 'hardware' | 'setup' | null;
export default function App() {
  const store = useWorkspace();
  const workspace = useMemo(() => localizeLegacyDemoForDisplay(store.workspace), [store.workspace]);
  const assistant = useAssistant(workspace);
  const hardware = useHardware();
  const [mode, setMode] = useState<DeskMode>('desk');
  const [showConnections, setShowConnections] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [dialog, setDialog] = useState<'object' | 'device' | 'connection' | 'cloud' | null>(null);
  const [prompt, setPrompt] = useState('');
  const [toast, setToast] = useState('');
  const [resetConfirm, setResetConfirm] = useState(false);
  const [referencePhoto, setReferencePhoto] = useState<string | null>(null);
  const [photoContext, setPhotoContext] = useState('');
  const [focusPath, setFocusPath] = useState<ConnectionFocusPath | null>(null);
  const scene = useRef<CanvasHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const device = workspace.devices.find((d) => d.id === selected);
  const sceneObject = workspace.objects.find((o) => o.id === selected);
  const safe = async (run: () => unknown | Promise<unknown>): Promise<boolean> => {
    try {
      return (await run()) !== false;
    } catch (e) {
      setToast(e instanceof Error ? e.message.split('\n')[0] : 'Could not process the request.');
      return false;
    }
  };
  function command(c: WorkspaceCommand) {
    if ((c.type === 'connect' || c.type === 'remove-connection') && mode !== 'edit') {
      setToast('Switch to Edit to change recorded connections.');
      return Promise.resolve(false);
    }
    return safe(() => store.command(c));
  }
  const deviceDrafts = useDeviceDrafts(workspace, store.workspace, command, store.conflict);
  function select(id: string | null, revealDetails = true) {
    setSelected(id);
    setFocusPath(null);
    if (id) {
      setPanel(null);
      if (revealDetails) setDetailsExpanded(true);
    }
  }
  function openPanel(next: Panel) {
    if (next === 'assistant' && device) assistant.setTarget(device.id);
    setSelected(null);
    setPanel((p) => (p === next ? null : next));
    setDetailsExpanded(true);
  }
  function send(text: string) {
    if (!text.trim() || assistant.pending) return;
    setPanel('assistant');
    setDetailsExpanded(true);
    setSelected(null);
    setPrompt('');
    void assistant.send(text, device?.id ?? assistant.targetDeviceId);
  }
  function showPath(path: ConnectionFocusPath) {
    setFocusPath(path);
    setShowConnections(true);
  }
  function openSetup() {
    setSelected(null);
    setPanel('setup');
    setDetailsExpanded(true);
  }
  const removableSamples = store.workspace.devices.length - retainedDevices(store.workspace).length;
  function clearSamples() {
    return safe(async () => {
      const devices = retainedDevices(store.workspace);
      const ids = new Set(devices.map((d) => d.id));
      const saved = await store.replace({
        ...store.workspace,
        devices,
        connections: store.workspace.connections.filter((c) => ids.has(c.from) && ids.has(c.to)),
      });
      if (!saved) return false;
      setToast(
        'Unused example devices removed. Devices with user reports were kept. You can undo this change.',
      );
    });
  }
  async function startOwnDesk() {
    if (await clearSamples()) openSetup();
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
  const noticeMessage = store.error || toast;
  const allDrafts = Object.values(deviceDrafts.drafts);
  const otherDrafts = allDrafts.filter((draft) => draft.id !== device?.id);
  const hasNotice = Boolean(store.conflict || noticeMessage || allDrafts.length);
  const notices = (store.conflict || noticeMessage || otherDrafts.length > 0) && (
    <div className="workspace-notices" role="region" aria-label="Workspace notices">
      {otherDrafts.length > 0 && (
        <section className="device-draft-list" aria-label="Unsaved device drafts">
          <strong>Unsaved device details</strong>
          <p>Kept in this open app until you save or discard them.</p>
          {otherDrafts.map((draft) => {
            const currentDevice = workspace.devices.find((item) => item.id === draft.id);
            return currentDevice ? (
              <button
                key={draft.id}
                className="text-button"
                onClick={() => {
                  select(draft.id);
                  setMode('edit');
                }}
                aria-label={`Review unsaved details for ${currentDevice.name}`}
              >
                <PencilSimple size={14} /> {currentDevice.name} ·{' '}
                {draft.saving ? 'Saving...' : 'Review draft'}
              </button>
            ) : (
              <details key={draft.id}>
                <summary>{draft.base.name} · Device no longer in this workspace</summary>
                <p>
                  The draft is kept for reference. Undo the removal to review it, or discard it.
                </p>
                <dl className="record-facts">
                  <div>
                    <dt>Draft name</dt>
                    <dd>{draft.values.name}</dd>
                  </div>
                  <div>
                    <dt>Draft model</dt>
                    <dd>{draft.values.model || 'Not recorded'}</dd>
                  </div>
                  <div>
                    <dt>Draft status</dt>
                    <dd>{draft.values.status}</dd>
                  </div>
                  <div>
                    <dt>Draft note</dt>
                    <dd>{draft.values.statusNote || 'No note'}</dd>
                  </div>
                </dl>
                <button
                  className="text-button"
                  disabled={draft.saving}
                  onClick={() => deviceDrafts.discard(draft.id)}
                >
                  Discard draft for {draft.base.name}
                </button>
              </details>
            );
          })}
        </section>
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
                downloadFile(
                  'desktwin-local-copy.json',
                  JSON.stringify(portableWorkspace(store.workspace), null, 2),
                )
              }
            >
              Export this tab's copy
            </button>
            <button
              className="button primary"
              disabled={store.saving}
              onClick={async () => {
                if (await store.reloadLatest()) {
                  deviceDrafts.invalidate();
                  assistant.resetConversation();
                  setFocusPath(null);
                  setPhotoContext('');
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
      {noticeMessage && (
        <div className="toast" role="status">
          <WarningCircle size={18} />
          <span>{noticeMessage}</span>
          {!store.error && (
            <button
              className="icon-button small"
              aria-label="Dismiss notification"
              onClick={() => setToast('')}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
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
          <button
            className="connection-toggle"
            role="switch"
            aria-label="Show connections"
            aria-checked={showConnections}
            onClick={() => setShowConnections((visible) => !visible)}
          >
            <span>Show connections</span>
            <span className="connection-toggle-state" aria-hidden="true">
              {showConnections ? 'ON' : 'OFF'}
            </span>
          </button>
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
      <div
        className={`workspace-body ${detailsExpanded ? 'details-expanded' : 'details-collapsed'}`}
      >
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
              className={`nav-button ${panel === 'setup' ? 'active' : ''}`}
              aria-label="Setup guide"
              title="Setup guide"
              onClick={openSetup}
            >
              <Check size={22} />
            </button>
            <button
              className={`nav-button ${panel === 'photo' ? 'active' : ''}`}
              aria-label="Desk photo"
              title="Desk photo"
              onClick={() => openPanel('photo')}
            >
              <ImageIcon size={22} />
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
              className={`nav-button ${panel === 'hardware' ? 'active' : ''}`}
              aria-label="Mac hardware"
              title="Mac hardware"
              onClick={() => openPanel('hardware')}
            >
              <Cpu size={22} />
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
              className={`nav-button ${panel === 'assistant' ? 'active' : ''}`}
              aria-label="AI chat"
              title="AI chat"
              onClick={() => openPanel('assistant')}
            >
              <ChatCircleDots size={23} />
            </button>
          </div>
        </nav>
        <main
          className="scene-area"
          aria-label="My workspace"
          data-mode={mode}
          data-labels={workspace.appearance.labels}
        >
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
              showConnections={showConnections}
              focusPath={focusPath}
              onSelect={(id) => select(id, mode !== 'edit')}
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
              Your layout · Evidence has a source
            </span>
          </div>
          <div className="view-switch" role="group" aria-label="Workspace mode">
            <button
              className={mode !== 'edit' ? 'active' : ''}
              aria-pressed={mode !== 'edit'}
              onClick={() => setMode('desk')}
            >
              <Eye size={16} aria-hidden="true" /> View
            </button>
            <button
              className={mode === 'edit' ? 'active' : ''}
              aria-pressed={mode === 'edit'}
              onClick={() => setMode('edit')}
            >
              <PencilSimple size={16} aria-hidden="true" /> Edit
            </button>
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
          {(showConnections || focusPath) && (
            <div className="connection-legend" role="note" aria-label="Connection display guide">
              {focusPath && (
                <div
                  className="focused-path-banner"
                  role="region"
                  aria-label="Focused connection path"
                >
                  <span>
                    Focus:{' '}
                    {focusPath.deviceIds
                      .map((id) => workspace.devices.find((item) => item.id === id)?.name)
                      .filter(Boolean)
                      .join(' → ') || 'No remaining devices'}
                  </span>
                  <button className="text-button" onClick={() => setFocusPath(null)}>
                    Clear path
                  </button>
                </div>
              )}
              <span className="connection-legend-copy">
                Recorded relationships · Physical cable routes are unverified
              </span>
              <div className="connection-legend-key">
                <span>Select a device for ports and sources.</span>
                <button
                  className="text-button"
                  disabled={workspace.devices.length < 2}
                  onClick={() => (mode === 'edit' ? setDialog('connection') : setMode('edit'))}
                >
                  <Link size={16} />
                  {mode === 'edit' ? 'Add connection' : 'Edit connections'}
                </button>
              </div>
            </div>
          )}
        </main>
        <section className="detail-dock" aria-label="Workspace details">
          <button
            className={`detail-dock-toggle ${hasNotice ? 'has-notice' : ''}`}
            aria-expanded={detailsExpanded}
            aria-controls="workspace-details"
            onClick={() => setDetailsExpanded((expanded) => !expanded)}
          >
            <span>
              <strong>
                {device?.name ||
                  sceneObject?.name ||
                  (panel ? `${panel[0].toUpperCase()}${panel.slice(1)}` : 'Workspace overview')}
              </strong>
              <small>
                {detailsExpanded
                  ? 'Collapse to make more room for your desk'
                  : store.conflict
                    ? 'Saved workspace changed · Expand to resolve'
                    : allDrafts.length
                      ? 'Unsaved device details · Expand to review'
                      : hasNotice
                        ? 'New notice · Expand to read'
                        : 'Expand details and controls'}
              </small>
            </span>
            {detailsExpanded ? <CaretDown size={18} /> : <CaretUp size={18} />}
          </button>
          <div className="detail-dock-content" id="workspace-details">
            {!device && !sceneObject && (!panel || panel === 'settings') && (
              <WorkspaceOverview
                workspace={workspace}
                mode={mode}
                onSelect={select}
                onAdd={() => setDialog('device')}
                onAddObject={() => setDialog('object')}
                onConnect={() => (mode === 'edit' ? setDialog('connection') : setMode('edit'))}
                onSetup={openSetup}
                removableSamples={removableSamples}
                onStartOwnDesk={startOwnDesk}
                hardwareSummary={
                  <HardwareSummary
                    hardware={hardware}
                    workspace={workspace}
                    onOpen={() => openPanel('hardware')}
                    onSelect={select}
                  />
                }
                renderHardwareStatus={(device) => (
                  <HardwareBadge device={device} snapshot={hardware.snapshot} />
                )}
              />
            )}
            {device && (
              <DeviceInspector
                key={device.id}
                device={device}
                workspace={workspace}
                mode={mode}
                drafts={deviceDrafts}
                onEdit={() => setMode('edit')}
                onCommand={command}
                onClose={() => setSelected(null)}
                onConnect={() => mode === 'edit' && setDialog('connection')}
                onSelect={select}
                onAsk={() => {
                  assistant.setTarget(device.id);
                  openPanel('assistant');
                }}
                onFocusPath={showPath}
                onReviewConnections={openSetup}
                hardwareDetails={
                  <DeviceHardwareStatus
                    device={device}
                    snapshot={hardware.snapshot}
                    onManage={() => openPanel('hardware')}
                    onCommand={command}
                  />
                }
              />
            )}
            {sceneObject && (
              <SceneObjectInspector
                key={sceneObject.id}
                object={sceneObject}
                workspace={workspace}
                mode={mode}
                onEdit={() => setMode('edit')}
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
            {panel === 'hardware' && (
              <HardwarePanel
                hardware={hardware}
                workspace={workspace}
                onCommand={command}
                onSelect={select}
                onClose={() => setPanel(null)}
              />
            )}
            {panel === 'setup' && (
              <DeskSetupPanel
                workspace={workspace}
                hardware={hardware}
                onCommand={command}
                onPhoto={() => openPanel('photo')}
                onAddDevice={() => setDialog('device')}
                onSelect={select}
                onTroubleshoot={(id) => select(id)}
                onClose={() => setPanel(null)}
                editing={mode === 'edit'}
                onEditConnections={() => setMode('edit')}
                photoContext={photoContext}
              />
            )}
            {panel === 'assistant' && (
              <AssistantPanel
                workspace={workspace}
                messages={assistant.messages}
                pending={assistant.pending}
                mode={assistant.mode}
                decisions={assistant.decisions}
                editing={mode === 'edit'}
                targetDeviceId={assistant.targetDeviceId}
                onTargetChange={assistant.setTarget}
                onFocusPath={showPath}
                onEditConnections={() => setMode('edit')}
                onClose={() => setPanel(null)}
                onSend={send}
                onDismiss={(key) => assistant.decide(key, 'dismissed')}
                onApply={(p, key, review) =>
                  safe(async () => {
                    if (p.type === 'connect' && mode !== 'edit') return false;
                    if (!(await store.proposal(p, undefined, review))) return false;
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
              <Suspense
                fallback={
                  <aside className="side-panel" role="status">
                    Preparing photo review...
                  </aside>
                }
              >
                <PhotoPanel
                  workspace={store.workspace}
                  photo={referencePhoto}
                  onPhoto={setReferencePhoto}
                  available={assistant.available}
                  onClose={() => setPanel(null)}
                  onAdd={() => setDialog('device')}
                  onContinue={(context) => {
                    setPhotoContext(context);
                    openSetup();
                  }}
                  onApply={async (draft, base, review) => {
                    if (
                      !(await store.replace(
                        applySceneDraft(store.workspace, base, draft, undefined, review),
                        base,
                      ))
                    )
                      throw new Error(
                        'The scene was not saved. Resolve the storage notice and try again.',
                      );
                  }}
                  storageConflict={store.conflict}
                  onRefresh={assistant.refreshHealth}
                />
              </Suspense>
            )}
            {panel !== 'settings' && dialog !== 'connection' && dialog !== 'device' && notices}
          </div>
        </section>
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
            placeholder={
              assistant.targetDevice
                ? `Ask about ${assistant.targetDevice.name}, or describe what you checked.`
                : 'Describe your devices, connections, or a problem you observed.'
            }
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
          </div>
        </div>
      </footer>
      {dialog === 'object' && (
        <AddObjectDialog onClose={() => setDialog(null)} onCommand={command} />
      )}
      {dialog === 'device' && (
        <AddDeviceDialog notices={notices} onClose={() => setDialog(null)} onCommand={command} />
      )}
      {dialog === 'connection' && mode === 'edit' && (
        <ConnectionDialog
          workspace={workspace}
          notices={notices}
          selected={selected}
          onClose={() => setDialog(null)}
          onCommand={command}
        />
      )}
      {panel === 'settings' && (
        <Modal title="Workspace settings" onClose={() => setPanel(null)}>
          {notices}
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
                downloadFile(
                  'desktwin-workspace.json',
                  JSON.stringify(portableWorkspace(store.workspace), null, 2),
                )
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
            Scene objects, devices, connections, and the last 30 guided checks are stored in your
            browser. Photos, conversations, and API keys are not included in the JSON export.
          </p>
          <hr />
          {resetConfirm ? (
            <div className="delete-confirm">
              <p>Reset your workspace to the example? You can undo this change.</p>
              <button
                className="button danger"
                onClick={async () => {
                  if (!(await store.replace(createDemoWorkspace()))) return;
                  deviceDrafts.invalidate();
                  assistant.resetConversation();
                  setFocusPath(null);
                  setPhotoContext('');
                  setReferencePhoto(null);
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
            const next = portableWorkspace(parseWorkspace(JSON.parse(await f.text())));
            if (!(await store.replace(next))) return;
            deviceDrafts.invalidate();
            assistant.resetConversation();
            setFocusPath(null);
            setPhotoContext('');
            setReferencePhoto(null);
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
            Once enabled, messages you send, your last 12 Meta conversation messages, and your
            photo-inferred or manually recorded device and connection setup, selected device, and
            eligible guided-check answers are sent to the Meta API. Local-demo history, OS
            observations, local matching identifiers and records created from Mac detection are
            excluded. Photos are only sent with separate consent. API usage may incur charges.
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
    </div>
  );
}

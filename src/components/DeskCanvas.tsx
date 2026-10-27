import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Cube, Monitor, WarningCircle } from '@phosphor-icons/react';
import {
  createDeskScene,
  type DeskScene,
  type DeskMode,
  type Marker,
  type ConnectionLine,
} from '../scene/deskScene';
import { sourceLabels, type Placement, type Workspace } from '../domain/workspace';
import { getConnectionView } from '../domain/connectionView';
export type CanvasHandle = Pick<DeskScene, 'reset' | 'zoom' | 'capture'>;
interface Props {
  workspace: Workspace;
  selected: string | null;
  mode: DeskMode;
  showConnections?: boolean;
  onSelect: (id: string | null) => void;
  onMove: (id: string, placement: Placement, path: Placement[]) => void;
  onFeedback?: (message: string) => void;
}
const DeskCanvas = forwardRef<CanvasHandle, Props>(function DeskCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<DeskScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [connectionLines, setConnectionLines] = useState<ConnectionLine[]>([]);
  const [error, setError] = useState(false);
  const [feedback, setFeedback] = useState('');
  const connectionView = getConnectionView(
    props.workspace,
    props.selected,
    props.showConnections ?? false,
  );
  useImperativeHandle(
    ref,
    () => ({
      reset: () => engine.current?.reset(),
      zoom: (delta) => engine.current?.zoom(delta),
      capture: () => engine.current?.capture() ?? '',
    }),
    [],
  );
  useEffect(() => {
    if (!host.current) return;
    try {
      const scene = createDeskScene(host.current, {
        onSelect: (id) => latest.current.onSelect(id),
        onMove: (id, placement, path) => latest.current.onMove(id, placement, path),
        onFeedback: (message) => {
          setFeedback(message);
          latest.current.onFeedback?.(message);
        },
        onMarkers: setMarkers,
        onConnectionLines: setConnectionLines,
      });
      engine.current = scene;
      scene.setWorkspace(latest.current.workspace);
      scene.setSelected(latest.current.selected);
      scene.setMode(latest.current.mode);
      scene.setShowConnections(latest.current.showConnections ?? false);
      return () => {
        scene.dispose();
        engine.current = null;
      };
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => engine.current?.setWorkspace(props.workspace), [props.workspace]);
  useEffect(() => engine.current?.setSelected(props.selected), [props.selected]);
  useEffect(() => engine.current?.setMode(props.mode), [props.mode]);
  useEffect(
    () => engine.current?.setShowConnections(props.showConnections ?? false),
    [props.showConnections],
  );
  return (
    <div className="desk-canvas-wrap">
      <div ref={host} className="desk-canvas-host" />
      {!error && props.showConnections && (
        <ul aria-label="Visible recorded connections" className="connection-summary">
          {connectionLines.map((line) => {
            const connection = props.workspace.connections.find((item) => item.id === line.id);
            if (!connection) return null;
            const from = props.workspace.devices.find((item) => item.id === connection.from);
            const to = props.workspace.devices.find((item) => item.id === connection.to);
            return (
              <li
                key={line.id}
                data-connection-id={line.id}
                data-emphasis={line.emphasis}
                data-from-position={line.from.join(',')}
                data-to-position={line.to.join(',')}
              >
                {from?.name} to {to?.name}: {connection.connector}. Source:{' '}
                {sourceLabels[connection.source]}.{' '}
                {line.emphasis === 'highlighted' ? 'Highlighted recorded relationship.' : ''}
              </li>
            );
          })}
        </ul>
      )}
      {feedback && (
        <div className="spatial-feedback" role="status" aria-live="polite">
          {feedback}
        </div>
      )}
      {error ? (
        <div className="scene-error" role="status">
          <WarningCircle size={36} />
          <h2>Unable to open the 3D view</h2>
          <p>
            Enable hardware acceleration in a browser that supports WebGL 2.
            <br />
            You can still use the device and scene object lists to edit your workspace.
          </p>
        </div>
      ) : (
        markers.map((marker) => {
          const d = props.workspace.devices.find((d) => d.id === marker.id);
          const object = props.workspace.objects.find((item) => item.id === marker.id);
          const item = d ?? object;
          if (!item) return null;
          const isSelected = item.id === props.selected;
          const isCounterpart = connectionView.counterpartIds.includes(item.id);
          return (
            <button
              key={item.id}
              className={`device-marker ${d?.status === 'reported-issue' ? 'has-issue' : ''} ${isSelected ? 'is-selected' : ''} ${isCounterpart ? 'is-connected' : ''}`}
              style={{ left: marker.x, top: marker.y }}
              onClick={() => props.onSelect(item.id)}
              aria-label={`Select ${item.name}`}
              aria-pressed={isSelected}
              aria-description={isCounterpart ? 'Recorded connection counterpart' : undefined}
              data-connection-role={
                isSelected ? 'selected' : isCounterpart ? 'counterpart' : 'unrelated'
              }
            >
              {d ? <Monitor size={20} /> : <Cube size={20} />}
              <span>
                <strong>{item.name}</strong>
                <small>Visual: {sourceLabels[item.visual.source]}</small>
              </span>
              {d && <i className={`status-dot ${d.status}`} />}
            </button>
          );
        })
      )}
    </div>
  );
});
export default DeskCanvas;

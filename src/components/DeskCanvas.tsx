import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Monitor, WarningCircle } from '@phosphor-icons/react';
import { createDeskScene, type DeskScene, type DeskMode, type Marker } from '../scene/deskScene';
import { sourceLabels, type Workspace } from '../domain/workspace';
export type CanvasHandle = Pick<DeskScene, 'reset' | 'zoom' | 'capture'>;
interface Props {
  workspace: Workspace;
  selected: string | null;
  mode: DeskMode;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
}
const DeskCanvas = forwardRef<CanvasHandle, Props>(function DeskCanvas(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<DeskScene | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [error, setError] = useState(false);
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
        onMove: (id, x, z) => latest.current.onMove(id, x, z),
        onMarkers: setMarkers,
      });
      engine.current = scene;
      scene.setWorkspace(latest.current.workspace);
      scene.setSelected(latest.current.selected);
      scene.setMode(latest.current.mode);
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
  return (
    <div className="desk-canvas-wrap">
      <div ref={host} className="desk-canvas-host" />
      {error ? (
        <div className="scene-error" role="status">
          <WarningCircle size={36} />
          <h2>Unable to open the 3D view</h2>
          <p>
            Enable hardware acceleration in a browser that supports WebGL 2.
            <br />
            You can still use the device list and edit connections.
          </p>
        </div>
      ) : (
        markers.map((marker) => {
          const d = props.workspace.devices.find((d) => d.id === marker.id);
          if (!d) return null;
          return (
            <button
              key={d.id}
              className={`device-marker ${d.status === 'reported-issue' ? 'has-issue' : ''}`}
              style={{ left: marker.x, top: marker.y }}
              onClick={() => props.onSelect(d.id)}
              aria-label={`Select ${d.name}`}
            >
              <Monitor size={20} />
              <span>
                <strong>{d.name}</strong>
                <small>{sourceLabels[d.source]}</small>
              </span>
              <i className={`status-dot ${d.status}`} />
            </button>
          );
        })
      )}
    </div>
  );
});
export default DeskCanvas;

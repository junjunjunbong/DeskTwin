import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  deviceVisual,
  type Device,
  type Placement,
  type SceneObject,
  type Workspace,
} from '../domain/workspace';
import { getGeometryParts } from '../domain/geometry';
import { resolveSpatialEdit } from '../domain/spatial';

export type DeskMode = 'desk' | 'connections' | 'edit';
export type Marker = { id: string; x: number; y: number };
export interface SceneCallbacks {
  onSelect: (id: string | null) => void;
  onMove: (id: string, placement: Placement, path: Placement[]) => void;
  onFeedback: (message: string) => void;
  onMarkers: (markers: Marker[]) => void;
}

/** Original procedural models: no photographed workspace or third-party 3D assets. */
export function createDeskScene(host: HTMLDivElement, cb: SceneCallbacks) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute(
    'aria-label',
    '3D desk with selectable devices, furniture and objects, and a rotatable view',
  );
  renderer.domElement.dataset.testid = 'desk-canvas';
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ebe7e0');
  const camera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 1.8;
  controls.minPolarAngle = 0.55;
  controls.maxPolarAngle = 1.35;
  controls.minAzimuthAngle = -0.35;
  controls.maxAzimuthAngle = 1.1;
  const sceneRoot = new THREE.Group();
  scene.add(sceneRoot);
  const devices = new THREE.Group();
  sceneRoot.add(devices);
  const cables = new THREE.Group();
  sceneRoot.add(cables);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const plane = new THREE.PlaneGeometry(1, 1);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const ownedMaterials: THREE.Material[] = [];
  const ownedTextures: THREE.Texture[] = [];
  const deviceGroups = new Map<string, THREE.Group>();
  const lampLights: THREE.PointLight[] = [];
  let workspace: Workspace | null = null;
  let selected: string | null = null;
  let hovered: string | null = null;
  let mode: DeskMode = 'desk';
  let dirty = true;
  let disposed = false;

  const mat = (color: string) => {
    let m = materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.86,
        metalness: 0.03,
        flatShading: true,
      });
      materials.set(color, m);
    }
    return m;
  };
  const box = (
    parent: THREE.Object3D,
    size: [number, number, number],
    pos: [number, number, number],
    color: string,
    shadow = true,
  ) => {
    const mesh = new THREE.Mesh(cube, mat(color));
    mesh.scale.set(...size);
    mesh.position.set(...pos);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const screenMaterials = new Map<THREE.Texture, THREE.MeshBasicMaterial>();
  const panel = (
    parent: THREE.Object3D,
    w: number,
    h: number,
    pos: [number, number, number],
    texture: THREE.Texture,
  ) => {
    let material = screenMaterials.get(texture);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      screenMaterials.set(texture, material);
      ownedMaterials.push(material);
    }
    const mesh = new THREE.Mesh(plane, material);
    mesh.scale.set(w, h, 1);
    mesh.position.set(...pos);
    parent.add(mesh);
    return mesh;
  };
  function pixelTexture(style: 'lake' | 'sunset' | 'blue' | 'city' | 'poster' | 'issue') {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 100;
    const ctx = canvas.getContext('2d')!;
    const sunset = style === 'sunset' || style === 'city';
    const palette = sunset
      ? ['#8884d5', '#bf8ed2', '#ecabac', '#f6c18b']
      : ['#71aeed', '#8bc5f5', '#b9dff6', '#d4e9ee'];
    palette.forEach((color, i) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, i * 16, 160, 18);
    });
    ctx.fillStyle = sunset ? '#ffdfaa' : '#eff7eb';
    ctx.fillRect(110, 17, 15, 15);
    ctx.fillStyle = sunset ? '#4c6193' : '#618bb9';
    ctx.fillRect(0, 61, 160, 39);
    for (let layer = 0; layer < 3; layer++) {
      ctx.fillStyle = sunset
        ? ['#81719c', '#62567e', '#3a4564'][layer]
        : ['#7897b9', '#436e96', '#2b526d'][layer];
      for (let x = 0; x < 160; x += 4) {
        const height = 12 + Math.sin(x * 0.054 + layer * 2) * 12 + Math.sin(x * 0.13 + layer) * 5;
        ctx.fillRect(x, 49 + layer * 12 - height, 4, height + 12);
      }
    }
    ctx.fillStyle = sunset ? '#d4a1ad' : '#a4d7d4';
    for (let y = 74; y < 99; y += 6) {
      const x = 72 + Math.round(Math.sin(y * 0.2) * 10);
      ctx.fillRect(x, y, 45 - (99 - y) / 2, 2);
    }
    if (style === 'city') {
      for (let i = 0; i < 15; i++) {
        const h = 12 + ((i * 17) % 40);
        ctx.fillStyle = i % 2 ? '#71647e' : '#8a7791';
        ctx.fillRect(i * 12, 100 - h, 10, h);
        ctx.fillStyle = '#edc18d';
        for (let y = 104 - h; y < 96; y += 8) ctx.fillRect(i * 12 + 3, y, 2, 3);
      }
    } else if (style !== 'sunset') {
      for (const [x, y] of [
        [12, 62],
        [25, 67],
        [137, 65],
        [145, 72],
      ]) {
        ctx.fillStyle = '#3f7965';
        ctx.fillRect(x, y - 12, 5, 18);
        ctx.fillRect(x - 4, y - 8, 13, 10);
        ctx.fillStyle = '#83a975';
        ctx.fillRect(x - 2, y - 10, 7, 4);
      }
    }
    if (style === 'poster') {
      ctx.fillStyle = '#f2dfbf';
      ctx.fillRect(0, 0, 160, 100);
      ctx.fillStyle = '#667f78';
      ctx.font = 'bold 17px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('MAKE ROOM', 80, 40);
      ctx.fillText('FOR IDEAS', 80, 65);
    }
    if (style === 'issue') {
      ctx.fillStyle = '#233347';
      ctx.fillRect(0, 0, 160, 100);
      ctx.fillStyle = '#e6bc77';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('USER REPORTED', 80, 44);
      ctx.fillText('DISPLAY ISSUE', 80, 61);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.colorSpace = THREE.SRGBColorSpace;
    ownedTextures.push(texture);
    return texture;
  }
  const tex = {
    lake: pixelTexture('lake'),
    sunset: pixelTexture('sunset'),
    blue: pixelTexture('blue'),
    city: pixelTexture('city'),
    poster: pixelTexture('poster'),
    issue: pixelTexture('issue'),
  };

  // Room shell and individual floorboards.
  box(sceneRoot, [9.1, 0.16, 7.3], [-0.25, -0.12, 0.45], '#bd9572');
  for (let row = 0; row < 19; row++)
    for (let col = 0; col < 4; col++) {
      const colors = ['#d8b58b', '#d3ab80', '#dcbc96', '#cea77f'];
      box(
        sceneRoot,
        [2.25, 0.035, 0.37],
        [-3.65 + col * 2.26, -0.016, -2.95 + row * 0.38],
        colors[(row + col * 3) % 4],
        false,
      );
    }
  box(sceneRoot, [9.1, 6.2, 0.16], [-0.25, 3.02, -2.25], '#dfd9ce');
  box(sceneRoot, [0.16, 6.2, 7.1], [-4.73, 3.02, 1.23], '#e9e0d3');
  box(sceneRoot, [9, 0.12, 0.1], [-0.25, 0.05, -2.12], '#c7b69d');
  box(sceneRoot, [0.1, 0.12, 6.6], [-4.61, 0.05, 1.1], '#c7b69d');
  // Window as a pixel-sky panel inset in a timber frame.
  const windowPane = panel(sceneRoot, 3.1, 3.2, [-4.62, 4.05, 0.35], tex.city);
  windowPane.rotation.y = Math.PI / 2;
  for (const z of [-1.26, 0.35, 1.96])
    box(sceneRoot, [0.18, 3.44, 0.09], [-4.5, 4.05, z], '#b29478');
  for (const y of [2.4, 4.04, 5.7]) box(sceneRoot, [0.18, 0.1, 3.4], [-4.5, y, 0.35], '#b29478');
  box(sceneRoot, [0.56, 0.14, 3.65], [-4.39, 2.34, 0.35], '#ba9872');

  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#ffe1a1',
    emissive: '#ffca79',
    emissiveIntensity: 0.9,
  });
  ownedMaterials.push(bulbMat);

  function finishModel(g: THREE.Group, item: Device | SceneObject) {
    const visual = 'status' in item ? deviceVisual(item) : item.visual;
    // Preserve tonal details while applying an editable overall tint. Pixel screens
    // use MeshBasicMaterial and remain decorative illustrations, not live status.
    if (visual.color) {
      const tint = new THREE.Color(visual.color);
      g.traverse((node) => {
        if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial))
          return;
        if (node.material === bulbMat) return;
        const color = node.material.color;
        const brightness = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
        node.material = mat(
          `#${tint
            .clone()
            .multiplyScalar(Math.max(0.3, brightness * 1.65))
            .getHexString()}`,
        );
      });
    }
    const bounds = new THREE.Box3().setFromObject(g);
    g.userData.markerHeight = bounds.isEmpty() ? 0.7 : bounds.max.y + 0.15;
    g.userData.deviceId = item.id;
    g.position.set(item.placement.x, item.placement.y, item.placement.z);
    g.rotation.y = THREE.MathUtils.degToRad(item.placement.rotation);
    g.scale.set(visual.scale.x, visual.scale.y, visual.scale.z);
    devices.add(g);
    deviceGroups.set(item.id, g);
  }

  function buildModel(item: Device | SceneObject) {
    const g = new THREE.Group();
    const template = item.shapeMode !== 'custom';
    for (const part of getGeometryParts(item)) {
      const mesh = box(
        g,
        [part.size.x, part.size.y, part.size.z],
        [part.position.x, part.position.y, part.position.z],
        part.color,
      );
      if (part.rotation)
        mesh.rotation.set(
          THREE.MathUtils.degToRad(part.rotation.x),
          THREE.MathUtils.degToRad(part.rotation.y),
          THREE.MathUtils.degToRad(part.rotation.z),
        );
      if (template && item.kind === 'lamp' && part.color === '#ffe1a1') mesh.material = bulbMat;
    }
    // Decorative screen artwork and room light only; never an operating-status claim.
    // Custom geometry is exactly the editable part list, without hidden template parts.
    if (template && item.kind === 'monitor') {
      panel(
        g,
        1.73,
        0.96,
        [0, 0.968, 0.074],
        'status' in item && item.status === 'reported-issue'
          ? tex.issue
          : item.id.includes('right')
            ? tex.sunset
            : tex.lake,
      );
    } else if (template && item.kind === 'laptop') {
      const lid = new THREE.Group();
      lid.position.set(0, 0.08, -0.43);
      lid.rotation.x = -0.18;
      g.add(lid);
      panel(lid, 1.25, 0.73, [0, 0.44, 0.026], tex.blue);
    } else if (template && item.kind === 'picture') {
      panel(g, 1.03, 0.68, [0, 0.465, 0.091], item.id.includes('poster') ? tex.poster : tex.lake);
    } else if (template && item.kind === 'lamp' && lampLights.length < 4) {
      const light = new THREE.PointLight('#ffcf8b', 3, 4, 2);
      light.position.set(-0.64, 1.06, 0);
      g.add(light);
      lampLights.push(light);
    }
    finishModel(g, item);
    g.visible = 'status' in item || item.kind === 'desk' || !!workspace?.appearance.decor;
  }

  const ambient = new THREE.HemisphereLight('#f3f4ef', '#ac8f74', 2.1);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight('#ffe0aa', 3.6);
  sun.position.set(-3.8, 8, 4.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -7;
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.0001;
  sun.target.position.set(0, 1, 0);
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#d3e3f8', 0.7);
  fill.position.set(4, 6, 4);
  scene.add(fill);

  const outline = new THREE.BoxHelper(new THREE.Object3D(), '#639aff');
  outline.visible = false;
  scene.add(outline);
  (outline.material as THREE.LineBasicMaterial).transparent = true;
  (outline.material as THREE.LineBasicMaterial).opacity = 0.8;
  function rebuildCables() {
    for (const child of [...cables.children]) {
      const line = child as THREE.Line;
      line.geometry.dispose();
      if (Array.isArray(line.material)) line.material.forEach((m) => m.dispose());
      else line.material.dispose();
    }
    cables.clear();
    if (!workspace) return;
    for (const c of workspace.connections) {
      if (c.connector === 'Bluetooth' && mode !== 'connections') continue;
      if (mode === 'connections' && selected && c.from !== selected && c.to !== selected) continue;
      const a = deviceGroups.get(c.from),
        b = deviceGroups.get(c.to);
      if (!a || !b) continue;
      // Routes illustrate user records. They are not recovered cable geometry.
      const start = a.localToWorld(new THREE.Vector3(0, 0.09, -0.16));
      const end = b.localToWorld(new THREE.Vector3(0, 0.09, -0.16));
      const routeHeight = Math.min(start.y, end.y) + 0.02;
      const curve = new THREE.CatmullRomCurve3([
        start,
        new THREE.Vector3(start.x, routeHeight, start.z - 0.26),
        new THREE.Vector3((start.x + end.x) / 2, routeHeight, Math.min(start.z, end.z) - 0.33),
        new THREE.Vector3(end.x, routeHeight, end.z - 0.26),
        end,
      ]);
      const color =
        mode === 'connections' ? (c.source === 'user-reported' ? '#3b83e9' : '#d4a65b') : '#555e61';
      const material = new THREE.LineDashedMaterial({
        color,
        dashSize: 0.08,
        gapSize: c.source === 'user-reported' || mode === 'desk' ? 0 : 0.05,
        transparent: true,
        opacity: mode === 'connections' ? 0.95 : 0.55,
        depthTest: true,
      });
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(55)),
        material,
      );
      line.computeLineDistances();
      cables.add(line);
    }
  }
  function updateMarkers() {
    if (!workspace) return;
    const w = host.clientWidth,
      h = host.clientHeight;
    cb.onMarkers(
      [...workspace.devices, ...workspace.objects]
        .filter(
          (item) => workspace!.appearance.labels || item.id === selected || item.id === hovered,
        )
        .flatMap((item) => {
          const g = deviceGroups.get(item.id);
          if (!g?.visible) return [];
          const p = g
            .localToWorld(new THREE.Vector3(0, g.userData.markerHeight, 0))
            .project(camera);
          return p.z < 1 && p.z > -1
            ? [{ id: item.id, x: ((p.x + 1) * w) / 2, y: ((1 - p.y) * h) / 2 }]
            : [];
        }),
    );
  }
  function select(id: string | null) {
    selected = id;
    const group = id ? deviceGroups.get(id) : null;
    outline.visible = !!group?.visible;
    if (group?.visible) outline.setFromObject(group);
    rebuildCables();
    dirty = true;
  }
  function lighting(value: Workspace['appearance']['lighting']) {
    const night = value === 'night',
      day = value === 'day';
    scene.background = new THREE.Color(night ? '#293546' : day ? '#e8eae5' : '#ebe7e0');
    ambient.intensity = night ? 0.7 : day ? 2.4 : 2.0;
    ambient.color.set(night ? '#7795c4' : '#f4f2e8');
    sun.intensity = night ? 0.15 : day ? 2.6 : 3.6;
    sun.color.set(day ? '#f4f5df' : '#ffd5a0');
    lampLights.forEach((light) => {
      light.intensity = night ? 6 : 2.8;
    });
    dirty = true;
  }
  function reset() {
    camera.position.set(8.4, 7.7, 11.5);
    controls.target.set(-0.2, 2.65, 0.35);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.update();
    dirty = true;
  }
  function resize() {
    const width = host.clientWidth,
      height = host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height,
      span = Math.max(7.6, 10.8 / aspect);
    camera.left = (-span * aspect) / 2;
    camera.right = (span * aspect) / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    dirty = true;
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.51);
  function ray(e: PointerEvent) {
    const r = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  }
  function pick(e: PointerEvent) {
    ray(e);
    const hit = raycaster.intersectObjects(
      devices.children.filter((item) => item.visible),
      true,
    )[0];
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node && !node.userData.deviceId) node = node.parent;
    return node?.userData.deviceId as string | undefined;
  }
  function showTransforms(value: Workspace) {
    for (const item of [...value.devices, ...value.objects]) {
      const group = deviceGroups.get(item.id);
      if (!group) continue;
      group.position.set(item.placement.x, item.placement.y, item.placement.z);
      group.rotation.y = THREE.MathUtils.degToRad(item.placement.rotation);
      group.scale.set(item.visual.scale.x, item.visual.scale.y, item.visual.scale.z);
    }
    const group = selected ? deviceGroups.get(selected) : null;
    if (group?.visible) outline.setFromObject(group);
    rebuildCables();
    dirty = true;
  }
  let down: {
    x: number;
    y: number;
    id?: string;
    dragging: boolean;
    offset: THREE.Vector3;
    startWorkspace: Workspace;
    liveWorkspace: Workspace;
    path: Placement[];
  } | null = null;
  function onDown(e: PointerEvent) {
    if (e.button !== 0 || !workspace) return;
    const id = pick(e);
    const p = new THREE.Vector3();
    const group = id ? deviceGroups.get(id) : null;
    dragPlane.constant = -(group?.position.y ?? 2.51);
    raycaster.ray.intersectPlane(dragPlane, p);
    down = {
      x: e.clientX,
      y: e.clientY,
      id,
      dragging: mode === 'edit' && !!group,
      offset: group ? p.sub(group.position) : p,
      startWorkspace: workspace,
      liveWorkspace: workspace,
      path: [],
    };
    cb.onFeedback('');
    if (down.dragging) {
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
    }
  }
  function onMove(e: PointerEvent) {
    if (down?.dragging && down.id) {
      if (down.path.length >= 512) {
        cb.onFeedback('Release and drag again to continue.');
        return;
      }
      ray(e);
      const p = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(dragPlane, p)) return;
      p.sub(down.offset);
      const current = down.liveWorkspace;
      const id = down.id;
      const item = [...current.devices, ...current.objects].find((entry) => entry.id === id);
      if (!item) return;
      const placement = {
        ...item.placement,
        x: THREE.MathUtils.clamp(p.x, -4.3, 4.3),
        z: THREE.MathUtils.clamp(p.z, -1.9, 3.7),
      };
      const candidate: Workspace = {
        ...current,
        devices: current.devices.map((entry) =>
          entry.id === id ? { ...entry, placement } : entry,
        ),
        objects: current.objects.map((entry) =>
          entry.id === id ? { ...entry, placement } : entry,
        ),
      };
      const result = resolveSpatialEdit(current, candidate, id, { snap: 'auto', sweep: true });
      const next = [...result.workspace.devices, ...result.workspace.objects].find(
        (entry) => entry.id === id,
      );
      if (next && JSON.stringify(next.placement) !== JSON.stringify(item.placement)) {
        down.path.push({ ...next.placement });
        down.liveWorkspace = result.workspace;
        showTransforms(result.workspace);
      }
      cb.onFeedback(result.reason || (result.blocked ? 'Movement stopped at another object.' : ''));
      renderer.domElement.style.cursor = result.blocked ? 'not-allowed' : 'grabbing';
      return;
    }
    const id = pick(e) ?? null;
    renderer.domElement.style.cursor = id ? (mode === 'edit' ? 'grab' : 'pointer') : 'grab';
    if (hovered !== id) {
      hovered = id;
      dirty = true;
    }
  }
  function onUp(e: PointerEvent) {
    if (!down) return;
    const drag = down;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4;
    // Clear before release: lostpointercapture must not cancel an accepted edit.
    down = null;
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(e.pointerId))
      renderer.domElement.releasePointerCapture(e.pointerId);
    if (drag.dragging && drag.id) {
      // Render the persisted state until the command commits. A rejected/save-conflicted
      // edit must not leave an unsaved visual transform on screen.
      showTransforms(workspace ?? drag.startWorkspace);
      const final = [...drag.liveWorkspace.devices, ...drag.liveWorkspace.objects].find(
        (entry) => entry.id === drag.id,
      );
      if (final && moved && drag.path.length) cb.onMove(drag.id, final.placement, drag.path);
      cb.onSelect(drag.id);
    } else if (!moved) cb.onSelect(drag.id ?? null);
    dirty = true;
  }
  function onCancel() {
    if (down?.dragging) showTransforms(workspace ?? down.startWorkspace);
    down = null;
    controls.enabled = true;
    dirty = true;
  }
  renderer.domElement.addEventListener('pointerdown', onDown, true);
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerup', onUp);
  renderer.domElement.addEventListener('pointercancel', onCancel);
  renderer.domElement.addEventListener('lostpointercapture', onCancel);
  controls.addEventListener('change', () => {
    dirty = true;
  });
  reset();
  resize();
  let frame = 0;
  const animate = () => {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    controls.update();
    if (dirty) {
      renderer.render(scene, camera);
      updateMarkers();
      dirty = false;
    }
  };
  animate();
  return {
    setWorkspace(w: Workspace) {
      onCancel();
      workspace = w;
      devices.clear();
      deviceGroups.clear();
      lampLights.length = 0;
      w.devices.forEach(buildModel);
      w.objects.forEach(buildModel);
      lighting(w.appearance.lighting);
      select(selected);
      dirty = true;
    },
    setSelected: select,
    setMode(m: DeskMode) {
      if (mode !== m) onCancel();
      mode = m;
      rebuildCables();
      dirty = true;
    },
    reset,
    zoom(delta: number) {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom + delta, 0.65, 1.8);
      camera.updateProjectionMatrix();
      dirty = true;
    },
    capture() {
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown, true);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointercancel', onCancel);
      renderer.domElement.removeEventListener('lostpointercapture', onCancel);
      for (const c of cables.children) {
        (c as THREE.Line).geometry.dispose();
        ((c as THREE.Line).material as THREE.Material).dispose();
      }
      cube.dispose();
      plane.dispose();
      outline.geometry.dispose();
      (outline.material as THREE.Material).dispose();
      materials.forEach((m) => m.dispose());
      ownedMaterials.forEach((m) => m.dispose());
      ownedTextures.forEach((t) => t.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
export type DeskScene = ReturnType<typeof createDeskScene>;

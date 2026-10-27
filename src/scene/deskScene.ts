import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Device, Workspace } from '../domain/workspace';

export type DeskMode = 'desk' | 'connections' | 'edit';
export type Marker = { id: string; x: number; y: number };
export interface SceneCallbacks {
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, z: number) => void;
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
    '3D desk with selectable devices and a rotatable view',
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
  const decor = new THREE.Group();
  sceneRoot.add(decor);
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

  // Desk, legs, drawer pedestal and desk mat.
  box(sceneRoot, [7.4, 0.22, 3.15], [0, 2.33, 0], '#c99b69');
  box(sceneRoot, [7.42, 0.035, 3.16], [0, 2.46, 0], '#d8ae7c');
  for (let i = 0; i < 5; i++)
    box(sceneRoot, [7.37, 0.005, 0.008], [0, 2.481, -1.27 + i * 0.63], '#c69b6e', false);
  for (const x of [-3.14, 3.14])
    for (const z of [-1.16, 1.16]) box(sceneRoot, [0.11, 2.2, 0.11], [x, 1.1, z], '#424947');
  box(sceneRoot, [1.22, 2.16, 2.5], [-2.67, 1.08, -0.05], '#505b60');
  for (let i = 0; i < 4; i++) {
    box(sceneRoot, [1.16, 0.48, 0.06], [-2.67, 0.35 + i * 0.51, 1.23], '#566166');
    box(sceneRoot, [0.38, 0.035, 0.045], [-2.67, 0.49 + i * 0.51, 1.28], '#323e45');
  }
  box(sceneRoot, [3.0, 0.025, 1.0], [0.3, 2.495, 0.94], '#5c6666');
  box(sceneRoot, [3.06, 0.012, 1.04], [0.3, 2.482, 0.94], '#c5b7a1');

  function plant(parent: THREE.Object3D, x: number, y: number, z: number, scale = 1) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    parent.add(g);
    box(g, [0.43, 0.38, 0.43], [0, 0.19, 0], '#e5dfcf');
    box(g, [0.48, 0.08, 0.48], [0, 0.39, 0], '#eee7d8');
    box(g, [0.37, 0.02, 0.37], [0, 0.44, 0], '#70624c');
    box(g, [0.055, 0.55, 0.055], [0, 0.68, 0], '#7c7852');
    const greens = ['#71905b', '#8da55d', '#a4b86d', '#57794f'];
    for (let i = 0; i < 28; i++) {
      const angle = i * 2.4,
        radius = 0.12 + (i % 4) * 0.065;
      box(
        g,
        [0.18, 0.15, 0.18],
        [Math.cos(angle) * radius, 0.57 + (i % 6) * 0.09, Math.sin(angle) * radius],
        greens[i % 4],
      );
    }
    return g;
  }
  function books(parent: THREE.Object3D, x: number, y: number, z: number, count = 4) {
    const colors = ['#627a88', '#c17e61', '#87947d', '#ddd1b6', '#59676d'];
    for (let i = 0; i < count; i++) {
      box(
        parent,
        [0.64 - i * 0.025, 0.13, 0.47],
        [x + (i % 2) * 0.025, y + i * 0.14, z],
        colors[i % colors.length],
      );
      box(parent, [0.57 - i * 0.025, 0.09, 0.01], [x + 0.025, y + i * 0.14, z + 0.24], '#e9ddc5');
    }
  }
  function cat(parent: THREE.Object3D, x: number, y: number, z: number) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    box(g, [0.25, 0.3, 0.22], [0, 0.16, 0], '#faf0d9');
    box(g, [0.3, 0.23, 0.25], [0, 0.4, 0], '#ebe3d3');
    box(g, [0.09, 0.1, 0.12], [-0.1, 0.55, 0], '#555963');
    box(g, [0.09, 0.1, 0.12], [0.1, 0.55, 0], '#555963');
    for (const x2 of [-0.07, 0.07])
      box(g, [0.025, 0.035, 0.01], [x2, 0.43, 0.132], '#353e49', false);
    box(g, [0.035, 0.025, 0.02], [0, 0.36, 0.14], '#c59c91', false);
    box(g, [0.09, 0.25, 0.07], [0.18, 0.17, -0.1], '#555963');
  }
  plant(decor, -3.3, 2.5, -0.78, 0.87);
  plant(decor, 3.15, 2.5, 0.56, 0.65);
  plant(decor, -4.0, 0.02, 2.8, 1.75);
  plant(decor, 3.6, 0.02, 2.75, 1.55);
  plant(decor, -4.27, 2.45, -0.38, 0.7);
  // Floating shelves and framed artwork.
  box(decor, [2.1, 0.13, 0.5], [-2.65, 4.85, -1.96], '#bc946b');
  box(decor, [2.0, 0.13, 0.5], [2.45, 4.85, -1.96], '#bc946b');
  books(decor, -3.22, 4.98, -1.94, 3);
  cat(decor, -2.4, 4.94, -1.89);
  plant(decor, 2.9, 4.93, -1.88, 0.6);
  for (let i = 0; i < 9; i++)
    box(
      decor,
      [0.14, 0.15, 0.13],
      [3.02 + Math.sin(i * 0.8) * 0.12, 4.88 - i * 0.17, -1.57],
      i % 2 ? '#87a16b' : '#678653',
    );
  const artFrame = (x: number, y: number, w: number, h: number, texture: THREE.Texture) => {
    box(decor, [w + 0.13, h + 0.13, 0.1], [x, y, -2.09], '#b49678');
    box(decor, [w, h, 0.02], [x, y, -2.02], '#f0e9dc');
    panel(decor, w - 0.12, h - 0.12, [x, y, -1.999], texture);
  };
  artFrame(-0.5, 5.02, 1.15, 0.8, tex.lake);
  artFrame(0.94, 5.1, 0.86, 1.1, tex.poster);
  artFrame(2.15, 5.42, 0.5, 0.55, tex.sunset);
  // Pegboard, pen cup, books, notebook, mug, adjustable desk lamp.
  box(decor, [1.45, 1.28, 0.06], [2.65, 3.87, -2.1], '#bca17e');
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 5; j++)
      box(
        decor,
        [0.025, 0.025, 0.012],
        [2.08 + i * 0.23, 3.4 + j * 0.23, -2.058],
        '#8a775f',
        false,
      );
  books(decor, 2.95, 2.57, 1.08, 4);
  box(decor, [0.32, 0.37, 0.32], [2.2, 2.68, -0.08], '#8b8778');
  for (let i = 0; i < 5; i++)
    box(
      decor,
      [0.025, 0.44 + i * 0.02, 0.025],
      [2.1 + i * 0.045, 2.89, -0.08 + (i % 2) * 0.06],
      ['#c49859', '#62738c', '#a9604b'][i % 3],
    );
  const notebook = box(decor, [0.54, 0.06, 0.7], [-1.55, 2.53, 1.08], '#ede0bf');
  notebook.rotation.y = -0.2;
  box(decor, [0.035, 0.035, 0.7], [-1.21, 2.53, 1.1], '#b58b54');
  const mug = new THREE.Group();
  mug.position.set(2.05, 2.52, 1.1);
  decor.add(mug);
  box(mug, [0.32, 0.31, 0.32], [0, 0.16, 0], '#e8dfca');
  box(mug, [0.25, 0.015, 0.25], [0, 0.324, 0], '#68513e');
  box(mug, [0.13, 0.08, 0.07], [0.2, 0.26, 0], '#e8dfca');
  box(mug, [0.13, 0.08, 0.07], [0.2, 0.08, 0], '#e8dfca');
  box(mug, [0.07, 0.19, 0.07], [0.26, 0.17, 0], '#e8dfca');
  box(mug, [0.44, 0.035, 0.44], [0, -0.015, 0], '#bc9772');
  const lamp = new THREE.Group();
  lamp.position.set(3.07, 2.5, -0.97);
  decor.add(lamp);
  box(lamp, [0.48, 0.06, 0.45], [0, 0, 0], '#5b655f');
  box(lamp, [0.07, 1.12, 0.07], [0, 0.55, 0], '#5b655f');
  const arm = box(lamp, [0.75, 0.065, 0.065], [-0.3, 1.16, 0], '#5b655f');
  arm.rotation.z = -0.28;
  box(lamp, [0.42, 0.16, 0.35], [-0.64, 1.2, 0], '#697268');
  const bulbMat = new THREE.MeshStandardMaterial({
    color: '#ffe1a1',
    emissive: '#ffca79',
    emissiveIntensity: 0.9,
  });
  ownedMaterials.push(bulbMat);
  const bulb = new THREE.Mesh(cube, bulbMat);
  bulb.scale.set(0.34, 0.045, 0.28);
  bulb.position.set(-0.64, 1.1, 0);
  lamp.add(bulb);
  const lampLight = new THREE.PointLight('#ffcf8b', 3.0, 4.0, 2);
  lampLight.position.set(2.43, 3.55, -0.97);
  scene.add(lampLight);
  // Fabric-like chair built from stepped blocks. It does not obscure the keyboard.
  const chair = new THREE.Group();
  chair.position.set(-0.55, 0, 2.65);
  chair.rotation.y = -0.12;
  decor.add(chair);
  box(chair, [1.35, 0.2, 1.2], [0, 1.25, 0], '#71839a');
  box(chair, [1.37, 1.34, 0.16], [0, 1.99, 0.48], '#d4d5cd');
  for (let i = 0; i < 7; i++)
    for (let j = 0; j < 6; j++)
      box(
        chair,
        [0.17, 0.18, 0.05],
        [-0.52 + i * 0.174, 1.48 + j * 0.18, 0.58],
        (i + j) % 3 ? '#718198' : '#8190a4',
        false,
      );
  for (const x of [-0.78, 0.78]) {
    box(chair, [0.08, 0.55, 0.08], [x, 1.45, 0], '#c5c9c1');
    box(chair, [0.21, 0.1, 0.67], [x, 1.74, -0.03], '#515f65');
  }
  box(chair, [0.13, 1.0, 0.13], [0, 0.66, 0], '#59636b');
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    g.rotation.y = (i * Math.PI * 2) / 5;
    chair.add(g);
    box(g, [0.73, 0.08, 0.1], [0.3, 0.2, 0], '#59636b');
    box(g, [0.18, 0.16, 0.15], [0.63, 0.1, 0], '#414a50');
  }
  box(decor, [3.0, 0.025, 2.45], [-0.55, 0.03, 2.6], '#b8b4a4');
  for (let i = 0; i < 18; i++)
    box(
      decor,
      [2.97, 0.005, 0.025],
      [-0.55, 0.047, 1.5 + i * 0.13],
      i % 2 ? '#c9c1ad' : '#a6a695',
      false,
    );

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

  function keyboard(parent: THREE.Object3D, width = 1.35, depth = 0.44) {
    box(parent, [width, 0.07, depth], [0, 0.045, 0], '#616c75');
    const cols = 14,
      rows = 5;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        box(
          parent,
          [(width / cols) * 0.78, 0.035, (depth / rows) * 0.74],
          [
            -width * 0.46 + ((col * width) / cols) * 0.98,
            0.097,
            -depth * 0.4 + ((row * depth) / rows) * 0.95,
          ],
          col === 0 && row === 0 ? '#c88c58' : (col + row) % 5 ? '#d5d5cb' : '#a6b1b1',
          false,
        );
      }
  }
  function buildDevice(d: Device) {
    const g = new THREE.Group();
    g.userData.deviceId = d.id;
    g.position.set(d.placement.x, 2.51, d.placement.z);
    g.rotation.y = THREE.MathUtils.degToRad(d.placement.rotation);
    if (d.kind === 'monitor') {
      box(g, [0.65, 0.045, 0.4], [0, 0.025, 0], '#505b62');
      box(g, [0.095, 0.42, 0.09], [0, 0.22, -0.03], '#5f6970');
      box(g, [1.85, 1.1, 0.11], [0, 0.95, 0], '#3b4751');
      box(g, [1.76, 0.99, 0.02], [0, 0.965, 0.06], '#26394b');
      panel(
        g,
        1.73,
        0.96,
        [0, 0.968, 0.074],
        d.status === 'reported-issue' ? tex.issue : d.id.includes('right') ? tex.sunset : tex.lake,
      );
    } else if (d.kind === 'laptop') {
      box(g, [1.35, 0.065, 0.93], [0, 0.04, 0], '#aeb7bd');
      box(g, [0.95, 0.01, 0.35], [0, 0.078, -0.11], '#475462');
      const keys = new THREE.Group();
      keys.scale.set(0.68, 0.35, 0.72);
      keys.position.set(0, 0.08, -0.15);
      g.add(keys);
      keyboard(keys);
      box(g, [0.4, 0.008, 0.22], [0, 0.08, 0.23], '#bac3c6');
      const lid = new THREE.Group();
      lid.position.set(0, 0.08, -0.43);
      lid.rotation.x = -0.18;
      g.add(lid);
      box(lid, [1.36, 0.86, 0.045], [0, 0.42, 0], '#596773');
      panel(lid, 1.25, 0.73, [0, 0.44, 0.026], tex.blue);
    } else if (d.kind === 'dock') {
      box(g, [0.83, 0.22, 0.5], [0, 0.12, 0], '#a2a9ac');
      box(g, [0.79, 0.15, 0.02], [0, 0.1, 0.26], '#6a757d');
      for (let i = 0; i < 4; i++)
        box(
          g,
          [0.115, 0.065, 0.015],
          [-0.28 + i * 0.18, 0.11, 0.28],
          i === 0 ? '#789eb0' : '#303f4a',
        );
    } else if (d.kind === 'ssd') {
      box(g, [0.54, 0.09, 0.35], [0, 0.06, 0], '#66788d');
      box(g, [0.14, 0.012, 0.1], [0, 0.11, 0], '#8d9ca9', false);
    } else if (d.kind === 'router') {
      box(g, [0.67, 0.18, 0.46], [0, 0.1, 0], '#49535a');
      for (let i = 0; i < 4; i++)
        box(g, [0.037, 0.56, 0.037], [-0.27 + i * 0.18, 0.42, -0.13], '#505c62');
      for (let i = 0; i < 5; i++)
        box(g, [0.018, 0.018, 0.012], [-0.2 + i * 0.07, 0.11, 0.24], '#bcc3b5', false);
    } else if (d.kind === 'keyboard') keyboard(g);
    else if (d.kind === 'mouse') {
      box(g, [0.29, 0.1, 0.43], [0, 0.07, 0], '#a9b4ba');
      box(g, [0.25, 0.06, 0.31], [0, 0.15, -0.03], '#b4bfc4');
      box(g, [0.025, 0.02, 0.07], [0, 0.19, -0.1], '#65727c');
    } else {
      box(g, [0.64, 1.25, 0.95], [0, 0.63, 0], '#52616c');
      box(g, [0.55, 1.12, 0.025], [0, 0.63, 0.49], '#354954');
      for (let i = 0; i < 3; i++) box(g, [0.34, 0.23, 0.02], [0, 0.28 + i * 0.34, 0.51], '#7f999f');
    }
    devices.add(g);
    deviceGroups.set(d.id, g);
  }
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
      const start = a.position.clone().add(new THREE.Vector3(0, 0.09, -0.16));
      const end = b.position.clone().add(new THREE.Vector3(0, 0.09, -0.16));
      const curve = new THREE.CatmullRomCurve3([
        start,
        new THREE.Vector3(start.x, 2.53, start.z - 0.26),
        new THREE.Vector3((start.x + end.x) / 2, 2.53, Math.min(start.z, end.z) - 0.33),
        new THREE.Vector3(end.x, 2.53, end.z - 0.26),
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
      workspace.devices
        .filter((d) => workspace!.appearance.labels || d.id === selected || d.id === hovered)
        .flatMap((d) => {
          const g = deviceGroups.get(d.id);
          if (!g) return [];
          const height =
            d.kind === 'monitor'
              ? 1.65
              : d.kind === 'laptop'
                ? 1.05
                : d.kind === 'router'
                  ? 0.9
                  : 0.42;
          const p = g.position
            .clone()
            .add(new THREE.Vector3(0, height, 0))
            .project(camera);
          return p.z < 1 && p.z > -1
            ? [{ id: d.id, x: ((p.x + 1) * w) / 2, y: ((1 - p.y) * h) / 2 }]
            : [];
        }),
    );
  }
  function select(id: string | null) {
    selected = id;
    const group = id ? deviceGroups.get(id) : null;
    outline.visible = !!group;
    if (group) outline.setFromObject(group);
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
    lampLight.intensity = night ? 6 : 2.8;
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
  const deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.51);
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
    const hit = raycaster.intersectObjects(devices.children, true)[0];
    let node: THREE.Object3D | null = hit?.object ?? null;
    while (node && !node.userData.deviceId) node = node.parent;
    return node?.userData.deviceId as string | undefined;
  }
  let down: { x: number; y: number; id?: string; dragging: boolean; offset: THREE.Vector3 } | null =
    null;
  function onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const id = pick(e);
    const p = new THREE.Vector3();
    raycaster.ray.intersectPlane(deskPlane, p);
    const group = id ? deviceGroups.get(id) : null;
    down = {
      x: e.clientX,
      y: e.clientY,
      id,
      dragging: mode === 'edit' && !!group,
      offset: group ? p.sub(group.position) : p,
    };
    if (down.dragging) {
      controls.enabled = false;
      renderer.domElement.setPointerCapture(e.pointerId);
      e.stopImmediatePropagation();
    }
  }
  function onMove(e: PointerEvent) {
    if (down?.dragging && down.id) {
      ray(e);
      const p = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(deskPlane, p)) return;
      p.sub(down.offset);
      const g = deviceGroups.get(down.id)!;
      g.position.x = THREE.MathUtils.clamp(p.x, -3.2, 3.2);
      g.position.z = THREE.MathUtils.clamp(p.z, -1.3, 1.3);
      if (selected === down.id) outline.setFromObject(g);
      dirty = true;
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
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4;
    if (down.dragging && down.id) {
      const g = deviceGroups.get(down.id)!;
      if (moved)
        cb.onMove(
          down.id,
          Math.round(g.position.x * 100) / 100,
          Math.round(g.position.z * 100) / 100,
        );
      cb.onSelect(down.id);
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(e.pointerId))
        renderer.domElement.releasePointerCapture(e.pointerId);
    } else if (!moved) cb.onSelect(down.id ?? null);
    down = null;
    dirty = true;
  }
  function onCancel() {
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
      workspace = w;
      devices.clear();
      deviceGroups.clear();
      w.devices.forEach(buildDevice);
      decor.visible = w.appearance.decor;
      lighting(w.appearance.lighting);
      select(selected);
      dirty = true;
    },
    setSelected: select,
    setMode(m: DeskMode) {
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

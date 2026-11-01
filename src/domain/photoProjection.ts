import { getGeometryParts, getTemplateContactProfile } from './geometry';
import { getItemBounds } from './spatial';
import type { Device, SceneObject, Workspace } from './workspace';

export type PhotoPoint = { x: number; y: number };
export type PhotoDeskCorners = {
  backLeft: PhotoPoint;
  backRight: PhotoPoint;
  frontRight: PhotoPoint;
  frontLeft: PhotoPoint;
};
export type PhotoReference = {
  objectId: string;
  /** Screen references use back/front corner keys as top/bottom, respectively. */
  surface?: 'tabletop' | 'monitor-screen';
  corners: PhotoDeskCorners;
  aspect: number;
  /** Explicit user-entered vertical FOV prior in degrees, never inferred by the model. */
  fov?: number;
  source: 'model' | 'manual';
};
type V = { x: number; y: number; z: number };
export type PhotoCamera = {
  position: V;
  target: V;
  up: V;
  /** Vertical field of view, in degrees. This camera never changes the room camera. */
  fov: number;
  aspect: number;
};

type Item = Device | SceneObject;
type ReferencePlane = {
  center: V;
  xAxis: V;
  downAxis: V;
  normal: V;
  width: number;
  height: number;
};
type CameraBasis = { right: V; up: V; forward: V; focal: number };
const ZERO: V = { x: 0, y: 0, z: 0 };
const MIN_FOV = 12;
const MAX_FOV = 110;
const MIN_LOG_FOCAL = Math.log(0.5 / Math.tan((MAX_FOV * Math.PI) / 360));
const MAX_LOG_FOCAL = Math.log(0.5 / Math.tan((MIN_FOV * Math.PI) / 360));
const radians = (n: number) => (n * Math.PI) / 180;
const add = (a: V, b: V): V => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: V, n: number): V => ({ x: a.x * n, y: a.y * n, z: a.z * n });
const dot = (a: V, b: V) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V, b: V): V => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (v: V) => Math.hypot(v.x, v.y, v.z);
const finite = (v: V) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const normalize = (v: V) => mul(v, 1 / length(v));
const cornerNames = ['backLeft', 'backRight', 'frontRight', 'frontLeft'] as const;

function yaw(v: V, angle: number): V {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
}

// Same XYZ Euler convention as the scene and spatial solver: Rx * Ry * Rz.
function euler(v: V, x: number, y: number, z: number): V {
  const aroundZ = {
    x: v.x * Math.cos(z) - v.y * Math.sin(z),
    y: v.x * Math.sin(z) + v.y * Math.cos(z),
    z: v.z,
  };
  const aroundY = yaw(aroundZ, y);
  return {
    x: aroundY.x,
    y: aroundY.y * Math.cos(x) - aroundY.z * Math.sin(x),
    z: aroundY.y * Math.sin(x) + aroundY.z * Math.cos(x),
  };
}

function itemPoint(item: Item, point: V): V {
  const scale = item.visual.scale;
  return add(
    item.placement,
    yaw(
      { x: point.x * scale.x, y: point.y * scale.y, z: point.z * scale.z },
      radians(item.placement.rotation),
    ),
  );
}

function templateGeometry(item: Item): boolean {
  return (
    item.shapeMode !== 'custom' &&
    !(!item.shapeMode && item.kind === 'generic' && item.parts?.length)
  );
}

function referencePlane(workspace: Workspace, reference: PhotoReference): ReferencePlane {
  const screen = reference.surface === 'monitor-screen';
  const item = [...workspace.objects, ...workspace.devices].find(
    (entry) => entry.id === reference.objectId,
  );
  if (!item || item.kind !== (screen ? 'monitor' : 'desk'))
    throw new Error(
      screen
        ? 'Select a monitor in the current scene before marking its visible screen corners.'
        : 'Select a desk in the current scene before fitting the source photo.',
    );
  if (!templateGeometry(item))
    throw new Error(
      screen
        ? 'Photo calibration needs the rectangular monitor template. Restore it before marking the four visible bezel corners.'
        : 'Photo calibration needs a level rectangular template desk. Restore the desk template before marking its four tabletop corners.',
    );
  if (
    !finite(item.placement) ||
    !Number.isFinite(item.placement.rotation) ||
    !finite(item.visual.scale) ||
    Object.values(item.visual.scale).some((value) => value <= 0)
  )
    throw new Error(
      'The reference dimensions are invalid. Repair its scale before fitting a photo.',
    );
  const angle = radians(item.placement.rotation);
  const xAxis = yaw({ x: 1, y: 0, z: 0 }, angle);
  if (screen) {
    // The largest X/Y panel is the actual outer bezel, ahead of the stand/base.
    const panel = [...getGeometryParts(item)].sort(
      (a, b) => b.size.x * b.size.y - a.size.x * a.size.y,
    )[0];
    if (!panel || (panel.rotation && Object.values(panel.rotation).some((n) => n !== 0)))
      throw new Error('The monitor template must have an upright rectangular bezel.');
    const downAxis = { x: 0, y: -1, z: 0 };
    return {
      center: itemPoint(item, add(panel.position, { x: 0, y: 0, z: panel.size.z / 2 })),
      xAxis,
      downAxis,
      normal: cross(xAxis, downAxis),
      width: panel.size.x * item.visual.scale.x,
      height: panel.size.y * item.visual.scale.y,
    };
  }
  const patch = getTemplateContactProfile('desk')?.supportPatches[0];
  if (!patch) throw new Error('The desk template needs a rectangular tabletop support profile.');
  const downAxis = yaw({ x: 0, y: 0, z: 1 }, angle);
  return {
    center: itemPoint(item, patch.center),
    xAxis,
    downAxis,
    normal: cross(xAxis, downAxis),
    width: patch.size.x * item.visual.scale.x,
    height: patch.size.z * item.visual.scale.z,
  };
}

function planeCorners(plane: ReferencePlane): V[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) =>
    add(
      plane.center,
      add(mul(plane.xAxis, (x * plane.width) / 2), mul(plane.downAxis, (z * plane.height) / 2)),
    ),
  );
}

/** Template reference corners in named order; back/front mean top/bottom for a screen. */
export function getPhotoReferenceWorldCorners(
  workspace: Workspace,
  reference: PhotoReference,
): V[] {
  return planeCorners(referencePlane(workspace, reference));
}

export const getPhotoDeskWorldCorners = getPhotoReferenceWorldCorners;

function validateReference(reference: PhotoReference): PhotoPoint[] {
  if (!Number.isFinite(reference.aspect) || reference.aspect <= 0)
    throw new Error('The source photo needs a valid width-to-height aspect ratio.');
  if (
    reference.fov !== undefined &&
    (!Number.isFinite(reference.fov) || reference.fov < MIN_FOV || reference.fov > MAX_FOV)
  )
    throw new Error(
      'Enter a vertical field of view from 12 to 110 degrees, or clear the FOV prior.',
    );
  const points = cornerNames.map((name) => reference.corners?.[name]);
  if (
    points.some(
      (point) =>
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.x > 1 ||
        point.y < 0 ||
        point.y > 1,
    )
  )
    throw new Error('Keep all four reference corners inside the source photo.');
  const turn = (a: PhotoPoint, b: PhotoPoint, c: PhotoPoint) =>
    (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  const area =
    points.reduce((sum, point, i) => {
      const next = points[(i + 1) % 4];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2;
  if (
    points.some(
      (point, i) =>
        Math.hypot(point.x - points[(i + 1) % 4].x, point.y - points[(i + 1) % 4].y) < 0.015,
    ) ||
    area < 0.002 ||
    points.some((point, i) => turn(point, points[(i + 1) % 4], points[(i + 2) % 4]) <= 0.0001)
  )
    throw new Error(
      reference.surface === 'monitor-screen'
        ? 'Mark a visible, convex bezel in top-left, top-right, bottom-right, bottom-left order. The corners must be distinct and show the front of the monitor.'
        : 'Mark a visible, convex tabletop in back-left, back-right, front-right, front-left order. The corners must be distinct and show the top of the desk.',
    );
  return points;
}

/** Pivoted elimination, used only for small, bounded calibration systems. */
function solve(matrix: number[][], right: number[]): number[] | null {
  const n = right.length;
  const rows = matrix.map((row, i) => [...row, right[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-13) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let j = column; j <= n; j++) rows[column][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let j = column; j <= n; j++) rows[row][j] -= factor * rows[column][j];
    }
  }
  const result = rows.map((row) => row[n]);
  return result.every(Number.isFinite) ? result : null;
}

// Parameters are XYZ camera-frame Euler rotation, translation, and log focal length.
// Plane axes are (reference right, reference down, their normal); camera axes
// are (right, down, forward). Visible reference faces point opposite the normal.
function residuals(
  parameters: number[],
  local: V[],
  observed: PhotoPoint[],
  aspect: number,
): number[] {
  const focal = Math.exp(parameters[6]);
  const residual: number[] = [];
  for (let i = 0; i < local.length; i++) {
    const point = euler(local[i], parameters[0], parameters[1], parameters[2]);
    const depth = point.z + parameters[5];
    if (!Number.isFinite(depth) || depth <= 0.00001) return Array(8).fill(1e3);
    residual.push(
      0.5 + (focal * (point.x + parameters[3])) / (depth * aspect) - observed[i].x,
      0.5 + (focal * (point.y + parameters[4])) / depth - observed[i].y,
    );
  }
  return residual;
}
const squaredError = (values: number[]) => values.reduce((sum, value) => sum + value * value, 0);

function refine(
  initial: number[],
  local: V[],
  observed: PhotoPoint[],
  aspect: number,
  fixedFocal = false,
): number[] {
  let parameters = [...initial];
  const dimensions = fixedFocal ? 6 : 7;
  let residual = residuals(parameters, local, observed, aspect);
  let error = squaredError(residual);
  let damping = 0.0001;
  for (let iteration = 0; iteration < 45 && error > 1e-18; iteration++) {
    const jacobian = parameters.slice(0, dimensions).map((value, column) => {
      const delta = 1e-6 * Math.max(1, Math.abs(value));
      const shifted = [...parameters];
      shifted[column] += delta;
      return residuals(shifted, local, observed, aspect).map(
        (r, row) => (r - residual[row]) / delta,
      );
    });
    const normal = jacobian.map((a) =>
      jacobian.map((b) => a.reduce((sum, value, row) => sum + value * b[row], 0)),
    );
    const gradient = jacobian.map(
      (column) => -column.reduce((sum, value, row) => sum + value * residual[row], 0),
    );
    for (let i = 0; i < dimensions; i++) normal[i][i] += damping * Math.max(normal[i][i], 0.00001);
    const step = solve(normal, gradient);
    if (!step) break;
    const candidate = parameters.map((value, i) => value + (step[i] ?? 0));
    candidate[6] = Math.max(MIN_LOG_FOCAL, Math.min(MAX_LOG_FOCAL, candidate[6]));
    const nextResidual = residuals(candidate, local, observed, aspect);
    const nextError = squaredError(nextResidual);
    if (nextError < error) {
      parameters = candidate;
      residual = nextResidual;
      if (error - nextError < 1e-18) break;
      error = nextError;
      damping = Math.max(damping / 3, 1e-10);
    } else damping = Math.min(damping * 10, 1e8);
  }
  return parameters;
}

function initialPose(h: number[], focal: number): number[] | null {
  const a = { x: h[0] / focal, y: h[3] / focal, z: h[6] };
  const b = { x: h[1] / focal, y: h[4] / focal, z: h[7] };
  const scale = 2 / (length(a) + length(b));
  if (!Number.isFinite(scale) || length(cross(a, b)) < 1e-12) return null;
  // Closest orthonormal pair for the two normalized homography columns.
  const sum = normalize(add(normalize(a), normalize(b)));
  const difference = normalize(sub(normalize(a), normalize(b)));
  const first = mul(add(sum, difference), Math.SQRT1_2);
  const second = mul(sub(sum, difference), Math.SQRT1_2);
  const third = cross(first, second);
  const y = Math.asin(Math.max(-1, Math.min(1, third.x)));
  const x =
    Math.abs(third.x) < 0.9999999 ? Math.atan2(-third.y, third.z) : Math.atan2(second.z, second.y);
  const z = Math.abs(third.x) < 0.9999999 ? Math.atan2(-second.x, first.x) : 0;
  return [x, y, z, (scale * h[2]) / focal, (scale * h[5]) / focal, scale, Math.log(focal)];
}

function poseCamera(parameters: number[], plane: ReferencePlane, aspect: number): PhotoCamera {
  const columns = [
    euler({ x: 1, y: 0, z: 0 }, parameters[0], parameters[1], parameters[2]),
    euler({ x: 0, y: 1, z: 0 }, parameters[0], parameters[1], parameters[2]),
    euler({ x: 0, y: 0, z: 1 }, parameters[0], parameters[1], parameters[2]),
  ];
  const toWorld = (v: V) =>
    add(add(mul(plane.xAxis, v.x), mul(plane.downAxis, v.y)), mul(plane.normal, v.z));
  const translation = { x: parameters[3], y: parameters[4], z: parameters[5] };
  const position = sub(
    plane.center,
    toWorld({
      x: dot(columns[0], translation),
      y: dot(columns[1], translation),
      z: dot(columns[2], translation),
    }),
  );
  const forward = toWorld({ x: columns[0].z, y: columns[1].z, z: columns[2].z });
  const up = toWorld({ x: -columns[0].y, y: -columns[1].y, z: -columns[2].y });
  return {
    position,
    target: add(position, forward),
    up,
    fov: (360 / Math.PI) * Math.atan(0.5 / Math.exp(parameters[6])),
    aspect,
  };
}

/** Fits a separate approximate perspective camera to a rectangular template surface.
 * The current tabletop width/depth or monitor bezel width/height ratio is assumed,
 * not measured from the photo. Cropped/occluded corners must never be invented.
 * Centered principal point, square pixels, no lens distortion; this is not metric calibration.
 * All reference corners must be visible/in-frame. Out-of-view geometry and occlusion cannot
 * establish dimensions; a near-affine view cannot identify camera distance and focal length.
 * An explicit user FOV prior fixes focal length and can make a frontal view identifiable;
 * its output is conditional on that assumption, not an independent intrinsics measurement.
 * Error is RMS corner distance in normalized image coordinates, not pixels or world units. */
export function calibratePhotoCamera(
  workspace: Workspace,
  reference: PhotoReference,
): { camera: PhotoCamera; error: number; warnings: string[] } {
  const observed = validateReference(reference);
  const plane = referencePlane(workspace, reference);
  const local = [
    { x: -plane.width / 2, y: -plane.height / 2, z: 0 },
    { x: plane.width / 2, y: -plane.height / 2, z: 0 },
    { x: plane.width / 2, y: plane.height / 2, z: 0 },
    { x: -plane.width / 2, y: plane.height / 2, z: 0 },
  ];
  const matrix: number[][] = [];
  const right: number[] = [];
  local.forEach((point, i) => {
    const x = (observed[i].x - 0.5) * reference.aspect;
    const y = observed[i].y - 0.5;
    matrix.push([point.x, point.y, 1, 0, 0, 0, -x * point.x, -x * point.y]);
    right.push(x);
    matrix.push([0, 0, 0, point.x, point.y, 1, -y * point.x, -y * point.y]);
    right.push(y);
  });
  const h = solve(matrix, right);
  if (!h)
    throw new Error('The reference corners are degenerate. Mark four distinct visible corners.');
  if (
    reference.fov === undefined &&
    Math.hypot((h[6] * plane.width) / 2, (h[7] * plane.height) / 2) < 0.012
  )
    throw new Error(
      'This view has too little perspective to recover a camera. Use a more oblique reference surface or adjust its visible corners.',
    );

  const starts: { parameters: number[]; error: number }[] = [];
  const focalStarts =
    reference.fov === undefined
      ? Array.from({ length: 29 }, (_, i) =>
          Math.exp(MIN_LOG_FOCAL + ((MAX_LOG_FOCAL - MIN_LOG_FOCAL) * i) / 28),
        )
      : [0.5 / Math.tan(radians(reference.fov) / 2)];
  for (const focal of focalStarts) {
    const parameters = initialPose(h, focal);
    if (parameters)
      starts.push({
        parameters,
        error: squaredError(residuals(parameters, local, observed, reference.aspect)),
      });
  }
  const candidates = starts
    .sort((a, b) => a.error - b.error)
    .slice(0, 4)
    .map(({ parameters }) => {
      const fitted = refine(
        parameters,
        local,
        observed,
        reference.aspect,
        reference.fov !== undefined,
      );
      return {
        parameters: fitted,
        error: squaredError(residuals(fitted, local, observed, reference.aspect)),
      };
    })
    .sort((a, b) => a.error - b.error);
  const best = candidates[0];
  const error = best ? Math.sqrt(best.error / 4) : Infinity;
  if (!best || !Number.isFinite(error) || error > 0.0125)
    throw new Error(
      'The four corners do not fit the current rectangular template and a perspective camera. Check corner order, reference proportions, and photo cropping.',
    );
  const camera = poseCamera(best.parameters, plane, reference.aspect);
  const projected = planeCorners(plane).map((point) => projectPhotoPoint(point, camera));
  if (
    dot(sub(camera.position, plane.center), plane.normal) >= -0.00001 ||
    projected.some((point) => !point) ||
    projected.some(
      (point, i) => point && Math.hypot(point.x - observed[i].x, point.y - observed[i].y) > 0.025,
    )
  )
    throw new Error(
      'The camera fit cannot see the reference face reliably. Check its four visible corners and their order.',
    );
  const warnings = [
    'Approximate one-photo fit using the current rectangular template dimensions; this is not a metric measurement.',
  ];
  if (reference.fov !== undefined)
    warnings.push(
      `The user-entered ${reference.fov} degree vertical FOV is held fixed. This camera estimate depends on that prior and the template dimensions.`,
    );
  if (error > 0.003)
    warnings.push(
      'The reference fit has visible residual error. Review the corner marks and template proportions.',
    );
  if (camera.fov < MIN_FOV + 0.5 || camera.fov > MAX_FOV - 0.5)
    warnings.push(
      'The fitted field of view is at the supported limit. Source cropping or desk proportions may reduce accuracy.',
    );
  return { camera, error, warnings };
}

type RegionObservation = {
  sceneId: string;
  region: { x: number; y: number; width: number; height: number };
};
type ViewData = {
  world: V[];
  image: PhotoPoint[];
  center: V;
  span: number;
  aspect: number;
  frontYaw: number;
};
const AUTO_MIN_FOCAL = Math.log(0.5 / Math.tan(radians(90) / 2));
const AUTO_MAX_FOCAL = Math.log(0.5 / Math.tan(radians(20) / 2));
const AUTO_DEFAULT_FOCAL = Math.log(0.5 / Math.tan(radians(50) / 2));

function viewBasis(parameters: number[], frontYaw: number) {
  const azimuth = parameters[0] + frontYaw;
  const elevation = parameters[1];
  const forward = {
    x: -Math.sin(azimuth) * Math.cos(elevation),
    y: -Math.sin(elevation),
    z: -Math.cos(azimuth) * Math.cos(elevation),
  };
  const right = { x: Math.cos(azimuth), y: 0, z: -Math.sin(azimuth) };
  const up = cross(right, forward);
  const roll = parameters[2];
  return {
    right: add(mul(right, Math.cos(roll)), mul(up, Math.sin(roll))),
    up: sub(mul(up, Math.cos(roll)), mul(right, Math.sin(roll))),
    forward,
  };
}

function inferredCamera(parameters: number[], data: ViewData): PhotoCamera {
  const basis = viewBasis(parameters, data.frontYaw);
  const distance = Math.exp(parameters[3]);
  const position = sub(
    data.center,
    add(
      add(mul(basis.right, parameters[4]), mul(basis.up, parameters[5])),
      mul(basis.forward, distance),
    ),
  );
  return {
    position,
    target: add(position, basis.forward),
    up: basis.up,
    fov: (360 / Math.PI) * Math.atan(0.5 / Math.exp(parameters[6])),
    aspect: data.aspect,
  };
}

function automaticResiduals(parameters: number[], data: ViewData, robust: boolean): number[] {
  const basis = viewBasis(parameters, data.frontYaw);
  const distance = Math.exp(parameters[3]);
  const focal = Math.exp(parameters[6]);
  const result: number[] = [];
  for (let i = 0; i < data.world.length; i++) {
    const delta = sub(data.world[i], data.center);
    const depth = dot(delta, basis.forward) + distance;
    if (!Number.isFinite(depth) || depth < data.span * 0.03)
      return Array(data.world.length * 2 + (robust ? 2 : 0)).fill(100);
    const x = 0.5 + (focal * (dot(delta, basis.right) + parameters[4])) / (depth * data.aspect);
    const y = 0.5 - (focal * (dot(delta, basis.up) + parameters[5])) / depth;
    const dx = x - data.image[i].x;
    const dy = y - data.image[i].y;
    // Region centers can shift because of occlusion, perspective and incorrect seed sizes.
    const weight = robust ? Math.sqrt(Math.min(1, 0.055 / Math.max(Math.hypot(dx, dy), 1e-12))) : 1;
    result.push(dx * weight, dy * weight);
  }
  if (robust) result.push(0.012 * (parameters[6] - AUTO_DEFAULT_FOCAL), 0.012 * parameters[2]);
  return result;
}

function boundAutomatic(parameters: number[], span: number): number[] {
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  return [
    clamp(parameters[0], radians(-80), radians(80)),
    clamp(parameters[1], radians(4), radians(78)),
    clamp(parameters[2], radians(-18), radians(18)),
    clamp(parameters[3], Math.log(span * 0.65), Math.log(span * 12)),
    clamp(parameters[4], -span * 2, span * 2),
    clamp(parameters[5], -span * 2, span * 2),
    clamp(parameters[6], AUTO_MIN_FOCAL, AUTO_MAX_FOCAL),
  ];
}

function refineAutomatic(initial: number[], data: ViewData): number[] {
  let parameters = [...initial];
  let residual = automaticResiduals(parameters, data, true);
  let error = squaredError(residual);
  let damping = 0.001;
  for (let iteration = 0; iteration < 40; iteration++) {
    const jacobian = parameters.map((value, column) => {
      const delta = 1e-5 * Math.max(1, Math.abs(value));
      const shifted = [...parameters];
      shifted[column] += delta;
      return automaticResiduals(shifted, data, true).map((r, row) => (r - residual[row]) / delta);
    });
    const normal = jacobian.map((a) =>
      jacobian.map((b) => a.reduce((sum, value, row) => sum + value * b[row], 0)),
    );
    const gradient = jacobian.map(
      (column) => -column.reduce((sum, value, row) => sum + value * residual[row], 0),
    );
    for (let i = 0; i < 7; i++) normal[i][i] += damping * Math.max(normal[i][i], 1e-5);
    const step = solve(normal, gradient);
    if (!step) break;
    const candidate = boundAutomatic(
      parameters.map((value, i) => value + step[i]),
      data.span,
    );
    const nextResidual = automaticResiduals(candidate, data, true);
    const nextError = squaredError(nextResidual);
    if (nextError < error) {
      parameters = candidate;
      residual = nextResidual;
      if (error - nextError < 1e-12) break;
      error = nextError;
      damping = Math.max(damping / 3, 1e-9);
    } else damping = Math.min(damping * 8, 1e9);
  }
  return parameters;
}

/** Automatic source-view inference for legacy regions, without invented calibration points.
 * Geometry AABB centers and region centers are only approximate correspondences: hidden parts,
 * incorrect template seeds and perspective can move either center. A bounded orbit/FOV prior
 * regularizes this fit; it does not establish intrinsics, dimensions or photographic fidelity.
 * Search is deterministic: 60 fixed starts, at most 8 refinements of 40 iterations, 128 observations. */
export function estimatePhotoCamera(
  workspace: Workspace,
  observations: RegionObservation[],
  aspect: number,
): { camera: PhotoCamera; error: number; warnings: string[] } {
  if (!Number.isFinite(aspect) || aspect <= 0)
    throw new Error('Automatic photo view needs a valid image aspect ratio.');
  if (observations.length < 4 || observations.length > 128)
    throw new Error(
      'Automatic photo view needs 4-128 distinct observed objects with image regions.',
    );
  const seen = new Set<string>();
  const world: V[] = [];
  const image: PhotoPoint[] = [];
  const matched: Item[] = [];
  for (const observation of observations) {
    const region = observation.region;
    if (
      seen.has(observation.sceneId) ||
      !region ||
      !Object.values(region).every(Number.isFinite) ||
      region.width <= 0 ||
      region.height <= 0 ||
      region.x < 0 ||
      region.y < 0 ||
      region.x + region.width > 1 + 1e-8 ||
      region.y + region.height > 1 + 1e-8
    )
      throw new Error(
        'Automatic photo view needs distinct objects and finite image regions inside the photo.',
      );
    seen.add(observation.sceneId);
    const item = [...workspace.objects, ...workspace.devices].find(
      (entry) => entry.id === observation.sceneId,
    );
    if (!item)
      throw new Error(
        'An observed object is missing from the current preview. Analyze the current scene again.',
      );
    if (
      !finite(item.placement) ||
      !Number.isFinite(item.placement.rotation) ||
      !finite(item.visual.scale) ||
      Object.values(item.visual.scale).some((value) => value <= 0)
    )
      throw new Error(
        'An observed template has invalid geometry. Repair its dimensions before fitting.',
      );
    const bounds = getItemBounds(item);
    const center = mul(add(bounds.min, bounds.max), 0.5);
    if (!finite(center))
      throw new Error(
        'An observed template has invalid geometry. Repair its dimensions before fitting.',
      );
    world.push(center);
    image.push({ x: region.x + region.width / 2, y: region.y + region.height / 2 });
    matched.push(item);
  }
  const ranges = (['x', 'y', 'z'] as const).map(
    (axis) => Math.max(...world.map((p) => p[axis])) - Math.min(...world.map((p) => p[axis])),
  );
  const span = Math.max(...ranges);
  const center = mul(world.reduce(add, ZERO), 1 / world.length);
  const covariance = (a: keyof V, b: keyof V) =>
    world.reduce((sum, p) => sum + (p[a] - center[a]) * (p[b] - center[b]), 0) / world.length;
  const xx = covariance('x', 'x'),
    yy = covariance('y', 'y'),
    zz = covariance('z', 'z');
  const xy = covariance('x', 'y'),
    xz = covariance('x', 'z'),
    yz = covariance('y', 'z');
  const determinant =
    xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
  const imageWidth = Math.max(...image.map((p) => p.x)) - Math.min(...image.map((p) => p.x));
  const imageHeight = Math.max(...image.map((p) => p.y)) - Math.min(...image.map((p) => p.y));
  if (
    ranges[0] < 0.3 ||
    ranges[1] < 0.18 ||
    ranges[2] < 0.25 ||
    determinant / Math.max(((xx + yy + zz) / 3) ** 3, 1e-12) < 1e-5 ||
    imageWidth < 0.08 ||
    imageHeight < 0.05
  )
    throw new Error(
      'The observed objects have too little independent scene/image spread to estimate a source view reliably.',
    );
  const facing = matched.filter((item) => item.kind === 'monitor');
  const anchors = facing.length ? facing : matched.filter((item) => item.kind === 'desk');
  const frontYaw = anchors.length
    ? Math.atan2(
        anchors.reduce((sum, item) => sum + Math.sin(radians(item.placement.rotation)), 0),
        anchors.reduce((sum, item) => sum + Math.cos(radians(item.placement.rotation)), 0),
      )
    : 0;
  const data: ViewData = { world, image, center, span, aspect, frontYaw };
  const imageCenter = image.reduce(
    (sum, point) => ({ x: sum.x + point.x / image.length, y: sum.y + point.y / image.length }),
    { x: 0, y: 0 },
  );
  const starts: { parameters: number[]; error: number }[] = [];
  for (const azimuth of [-65, -32, 0, 32, 65])
    for (const elevation of [8, 25, 45, 65])
      for (const fov of [35, 50, 70]) {
        const initial = [
          radians(azimuth),
          radians(elevation),
          0,
          0,
          0,
          0,
          Math.log(0.5 / Math.tan(radians(fov) / 2)),
        ];
        const basis = viewBasis(initial, frontYaw);
        let numerator = 0,
          denominator = 0;
        world.forEach((point, i) => {
          const delta = sub(point, center);
          const x = dot(delta, basis.right),
            y = dot(delta, basis.up);
          numerator += x * (image[i].x - imageCenter.x) * aspect - y * (image[i].y - imageCenter.y);
          denominator += x * x + y * y;
        });
        const ratio = numerator / Math.max(denominator, 1e-10);
        if (ratio <= 0) continue;
        const distance = Math.exp(initial[6]) / ratio;
        initial[3] = Math.log(distance);
        initial[4] = ((imageCenter.x - 0.5) * aspect) / ratio;
        initial[5] = (0.5 - imageCenter.y) / ratio;
        const parameters = boundAutomatic(initial, span);
        starts.push({
          parameters,
          error: squaredError(automaticResiduals(parameters, data, true)),
        });
      }
  const solutions = starts
    .sort((a, b) => a.error - b.error)
    .slice(0, 8)
    .map(({ parameters }) => {
      const fitted = refineAutomatic(parameters, data);
      return { parameters: fitted, score: squaredError(automaticResiduals(fitted, data, true)) };
    })
    .sort((a, b) => a.score - b.score);
  const best = solutions[0];
  if (!best)
    throw new Error('The object regions do not support a consistent front-facing source view.');
  const camera = inferredCamera(best.parameters, data);
  const residual = automaticResiduals(best.parameters, data, false);
  const distances = world.map((_, i) => Math.hypot(residual[i * 2], residual[i * 2 + 1]));
  const error = Math.sqrt(squaredError(residual) / world.length);
  const inliers = distances.filter((distance) => distance <= 0.08).length;
  if (
    !Number.isFinite(error) ||
    error > 0.14 ||
    inliers < Math.max(4, Math.ceil(world.length * 0.6)) ||
    dot(sub(camera.position, center), { x: Math.sin(frontYaw), y: 0, z: Math.cos(frontYaw) }) <
      span * 0.05 ||
    camera.position.y < Math.max(0.3, center.y - span * 0.1) ||
    camera.position.y > center.y + span * 5
  )
    throw new Error(
      'The template seeds and object regions disagree too strongly to infer a reliable source view. Review the scene estimates.',
    );
  const warnings = [
    'Approximate source view inferred automatically from template geometry and object image regions; this is not camera calibration or a metric measurement.',
    'Region centers can shift with occlusion, cropping and incorrect template proportions. The bounded orbit and field-of-view priors limit this estimate.',
  ];
  if (error > 0.035)
    warnings.push(
      'Source-view uncertainty is substantial; remaining object alignment needs review.',
    );
  if (camera.fov < 20.5 || camera.fov > 89.5)
    warnings.push(
      'The inferred field of view reached its automatic prior limit. Treat depth and scale as uncertain.',
    );
  return { camera, error, warnings };
}

function cameraBasis(camera: PhotoCamera): CameraBasis | null {
  if (
    !finite(camera.position) ||
    !finite(camera.target) ||
    !finite(camera.up) ||
    !Number.isFinite(camera.aspect) ||
    camera.aspect <= 0 ||
    !Number.isFinite(camera.fov) ||
    camera.fov <= 0 ||
    camera.fov >= 180
  )
    return null;
  const forward = sub(camera.target, camera.position);
  if (length(forward) < 1e-10) return null;
  const right = cross(forward, camera.up);
  if (length(right) < 1e-10) return null;
  return {
    forward: normalize(forward),
    right: normalize(right),
    up: normalize(cross(right, forward)),
    focal: 0.5 / Math.tan(radians(camera.fov) / 2),
  };
}

/** Normalized source-image point; outside-frame points stay outside for clipping. */
export function projectPhotoPoint(point: V, camera: PhotoCamera): PhotoPoint | null {
  const basis = cameraBasis(camera);
  if (!basis || !finite(point)) return null;
  const delta = sub(point, camera.position);
  const depth = dot(delta, basis.forward);
  if (depth <= 0.00001) return null;
  const x = 0.5 + (basis.focal * dot(delta, basis.right)) / (depth * camera.aspect);
  const y = 0.5 - (basis.focal * dot(delta, basis.up)) / depth;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function hull(points: PhotoPoint[]): PhotoPoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const turn = (a: PhotoPoint, b: PhotoPoint, c: PhotoPoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: PhotoPoint[] = [];
  const upper: PhotoPoint[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-14
    )
      lower.pop();
    lower.push(point);
  }
  for (const point of sorted.reverse()) {
    while (
      upper.length >= 2 &&
      turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-14
    )
      upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function clip(polygon: PhotoPoint[]): PhotoPoint[] {
  let result = polygon;
  for (const [axis, bound, sign] of [
    ['x', 0, 1],
    ['x', 1, -1],
    ['y', 0, 1],
    ['y', 1, -1],
  ] as const) {
    const input = result;
    result = [];
    for (let i = 0; i < input.length; i++) {
      const start = input[i];
      const end = input[(i + 1) % input.length];
      const startInside = sign * (start[axis] - bound) >= 0;
      const endInside = sign * (end[axis] - bound) >= 0;
      if (startInside) result.push(start);
      if (startInside !== endInside) {
        const fraction = (bound - start[axis]) / (end[axis] - start[axis]);
        result.push({
          x: start.x + fraction * (end.x - start.x),
          y: start.y + fraction * (end.y - start.y),
        });
      }
    }
  }
  return result;
}

function contactPoint(item: Item, worldVertices: V[][]): V | null {
  const patches = templateGeometry(item)
    ? getTemplateContactProfile(item.kind)?.contactPatches
    : undefined;
  if (patches?.length) {
    const area = patches.reduce((sum, patch) => sum + patch.size.x * patch.size.z, 0);
    const center = patches.reduce(
      (sum, patch) => add(sum, mul(patch.center, (patch.size.x * patch.size.z) / area)),
      ZERO,
    );
    return itemPoint(item, center);
  }
  const vertices = worldVertices.flat();
  const minimum = Math.min(...vertices.map((point) => point.y));
  const bottom = vertices.filter((point) => point.y <= minimum + 0.035);
  return bottom.length ? mul(bottom.reduce(add, ZERO), 1 / bottom.length) : null;
}

/** Each polygon outlines one actual transformed box part, clipped to the source image.
 * These are geometry guides, without scene occlusion or photographic segmentation. */
export function projectPhotoItem(
  item: Item,
  camera: PhotoCamera,
): {
  region: { x: number; y: number; width: number; height: number };
  /** Full projected bounds before image clipping; use these for complete-region fitting. */
  unclippedRegion: { x: number; y: number; width: number; height: number };
  polygons: PhotoPoint[][];
  contact: PhotoPoint | null;
} | null {
  if (
    !cameraBasis(camera) ||
    !finite(item.placement) ||
    !Number.isFinite(item.placement.rotation) ||
    !finite(item.visual.scale) ||
    Object.values(item.visual.scale).some((value) => value <= 0)
  )
    return null;
  const worldVertices = getGeometryParts(item).map((part) => {
    const vertices: V[] = [];
    const rotation = part.rotation ?? ZERO;
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1])
          vertices.push(
            itemPoint(
              item,
              add(
                part.position,
                euler(
                  { x: (x * part.size.x) / 2, y: (y * part.size.y) / 2, z: (z * part.size.z) / 2 },
                  radians(rotation.x),
                  radians(rotation.y),
                  radians(rotation.z),
                ),
              ),
            ),
          );
    return vertices;
  });
  const projected = worldVertices.map((vertices) =>
    vertices.map((point) => projectPhotoPoint(point, camera)),
  );
  // A box crossing the camera plane has an unbounded silhouette; never invent one.
  if (projected.some((points) => points.some((point) => !point))) return null;
  const fullPoints = projected.flat() as PhotoPoint[];
  if (!fullPoints.length) return null;
  const fullX = Math.min(...fullPoints.map((point) => point.x));
  const fullY = Math.min(...fullPoints.map((point) => point.y));
  const unclippedRegion = {
    x: fullX,
    y: fullY,
    width: Math.max(...fullPoints.map((point) => point.x)) - fullX,
    height: Math.max(...fullPoints.map((point) => point.y)) - fullY,
  };
  const polygons = projected
    .map((points) => clip(hull(points as PhotoPoint[])))
    .filter((polygon) => polygon.length >= 3);
  const points = polygons.flat();
  if (!points.length) return null;
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  const width = Math.max(...points.map((point) => point.x)) - x;
  const height = Math.max(...points.map((point) => point.y)) - y;
  if (width < 1e-10 || height < 1e-10) return null;
  const worldContact = contactPoint(item, worldVertices);
  const contact = worldContact ? projectPhotoPoint(worldContact, camera) : null;
  return {
    region: { x, y, width, height },
    unclippedRegion,
    polygons,
    contact:
      contact && contact.x >= 0 && contact.x <= 1 && contact.y >= 0 && contact.y <= 1
        ? contact
        : null,
  };
}

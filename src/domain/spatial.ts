import { getGeometryParts, getTemplateContactProfile, type GeometryContactPatch } from './geometry';
import type { Device, Placement, SceneObject, Workspace } from './workspace';

type Item = Device | SceneObject;
type V = { x: number; y: number; z: number };
export type Bounds = { min: V; max: V };
type Box = { center: V; edges: [V, V, V]; bounds: Bounds };
type Body = { item: Item; boxes: Box[]; bounds: Bounds };
const EPS = 0.00001;
const GAP = 0.001;
const REST_TOLERANCE = 0.005;
export const DEFAULT_SCENE_HEIGHT_ADJUSTMENT = 0.12;
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
const length = (a: V) => Math.hypot(a.x, a.y, a.z);
const origin: V = { x: 0, y: 0, z: 0 };
const items = (w: Workspace): Item[] => [...w.devices, ...w.objects];
const find = (w: Workspace, id: string): Item => {
  const item = items(w).find((object) => object.id === id);
  if (!item) throw new Error('Object not found. Check the latest workspace.');
  return item;
};
const normalizedAngle = (n: number) => ((((n + 180) % 360) + 360) % 360) - 180;
function yaw(v: V, angle: number): V {
  const c = Math.cos(radians(angle));
  const s = Math.sin(radians(angle));
  return { x: c * v.x + s * v.z, y: v.y, z: -s * v.x + c * v.z };
}
// Same XYZ Euler convention as THREE.Euler: matrix Rx * Ry * Rz.
function euler(v: V, rotation: V): V {
  const a = radians(rotation.z);
  const z = {
    x: v.x * Math.cos(a) - v.y * Math.sin(a),
    y: v.x * Math.sin(a) + v.y * Math.cos(a),
    z: v.z,
  };
  const y = yaw(z, rotation.y);
  const b = radians(rotation.x);
  return {
    x: y.x,
    y: y.y * Math.cos(b) - y.z * Math.sin(b),
    z: y.y * Math.sin(b) + y.z * Math.cos(b),
  };
}
function scale(v: V, by: V): V {
  return { x: v.x * by.x, y: v.y * by.y, z: v.z * by.z };
}
function boxBounds(center: V, edges: V[]): Bounds {
  const extent = edges.reduce(
    (a, e) => add(a, { x: Math.abs(e.x), y: Math.abs(e.y), z: Math.abs(e.z) }),
    origin,
  );
  return { min: sub(center, extent), max: add(center, extent) };
}
function union(bounds: Bounds[]): Bounds {
  return {
    min: {
      x: Math.min(...bounds.map((b) => b.min.x)),
      y: Math.min(...bounds.map((b) => b.min.y)),
      z: Math.min(...bounds.map((b) => b.min.z)),
    },
    max: {
      x: Math.max(...bounds.map((b) => b.max.x)),
      y: Math.max(...bounds.map((b) => b.max.y)),
      z: Math.max(...bounds.map((b) => b.max.z)),
    },
  };
}
function intersectsBounds(a: Bounds, b: Bounds, margin = 0): boolean {
  return (
    a.min.x < b.max.x + margin &&
    a.max.x > b.min.x - margin &&
    a.min.y < b.max.y + margin &&
    a.max.y > b.min.y - margin &&
    a.min.z < b.max.z + margin &&
    a.max.z > b.min.z - margin
  );
}
function body(item: Item): Body {
  const transform = (v: V) => yaw(scale(v, item.visual.scale), item.placement.rotation);
  const boxes = getGeometryParts(item).map((part): Box => {
    const r = part.rotation ?? origin;
    const edges: [V, V, V] = [
      transform(euler({ x: part.size.x / 2, y: 0, z: 0 }, r)),
      transform(euler({ x: 0, y: part.size.y / 2, z: 0 }, r)),
      transform(euler({ x: 0, y: 0, z: part.size.z / 2 }, r)),
    ];
    const center = add(item.placement, transform(part.position));
    return { center, edges, bounds: boxBounds(center, edges) };
  });
  // Empty custom shapes remain visible/editable through the geometry module's fallback.
  return { item, boxes, bounds: union(boxes.map((box) => box.bounds)) };
}
export function getItemBounds(item: Item): Bounds {
  return body(item).bounds;
}
function axes(a: Box, b: Box): V[] {
  return [
    cross(a.edges[0], a.edges[1]),
    cross(a.edges[1], a.edges[2]),
    cross(a.edges[2], a.edges[0]),
    cross(b.edges[0], b.edges[1]),
    cross(b.edges[1], b.edges[2]),
    cross(b.edges[2], b.edges[0]),
    ...a.edges.flatMap((edge) => b.edges.map((other) => cross(edge, other))),
  ]
    .filter((v) => length(v) > 1e-10)
    .map((v) => mul(v, 1 / length(v)));
}
const radius = (box: Box, axis: V) =>
  box.edges.reduce((sum, edge) => sum + Math.abs(dot(edge, axis)), 0);
/** Separating-axis test for transformed boxes, including nonuniform scale + rotated parts. */
function penetration(a: Box, b: Box): number {
  if (!intersectsBounds(a.bounds, b.bounds)) return 0;
  let depth = Infinity;
  for (const axis of axes(a, b)) {
    const overlap =
      radius(a, axis) + radius(b, axis) - Math.abs(dot(sub(a.center, b.center), axis));
    if (overlap <= EPS) return 0;
    depth = Math.min(depth, overlap);
  }
  return depth;
}
function sameEdges(a: Box, b: Box) {
  return a.edges.every((edge, i) => length(sub(edge, b.edges[i])) < 1e-9);
}
/** Exact swept SAT for linear translations; conservative arc envelope for yaw/scale segments. */
function sweptCollision(a0: Box, a1: Box, b0: Box, b1: Box, padding: number): boolean {
  const linear = sameEdges(a0, a1) && sameEdges(b0, b1);
  const testAxes = [...axes(a0, b0), ...(linear ? [] : axes(a1, b1))];
  const d0 = sub(a0.center, b0.center);
  const d1 = sub(a1.center, b1.center);
  if (linear) {
    let enter = 0;
    let leave = 1;
    for (const axis of testAxes) {
      const r = radius(a0, axis) + radius(b0, axis) - EPS;
      const d = dot(d0, axis);
      const speed = dot(sub(d1, d0), axis);
      if (Math.abs(speed) < 1e-12) {
        if (Math.abs(d) >= r) return false;
        continue;
      }
      const t0 = (-r - d) / speed;
      const t1 = (r - d) / speed;
      enter = Math.max(enter, Math.min(t0, t1));
      leave = Math.min(leave, Math.max(t0, t1));
      if (enter >= leave) return false;
    }
    return leave > 0 && enter < 1;
  }
  for (const axis of testAxes) {
    // World yaw does not change vertical projections. Preserve zero-gap support contact.
    const arc = padding * Math.hypot(axis.x, axis.z);
    const min =
      Math.min(
        dot(d0, axis) - radius(a0, axis) - radius(b0, axis),
        dot(d1, axis) - radius(a1, axis) - radius(b1, axis),
      ) - arc;
    const max =
      Math.max(
        dot(d0, axis) + radius(a0, axis) + radius(b0, axis),
        dot(d1, axis) + radius(a1, axis) + radius(b1, axis),
      ) + arc;
    if (min >= -EPS || max <= EPS) return false;
  }
  return true;
}

type Surface = {
  id: string;
  name: string;
  height: number;
  box: Box | null;
  covering?: boolean;
  /** Actual solid faces beneath a thin covering. Partial contact with the
   * covering must not create support beyond these underlying faces. */
  coveringSupports?: Surface[];
  maxOverhangFraction?: number;
  overhangKinds?: Item['kind'][];
};
const solidSupportKinds = new Set(['desk', 'shelf', 'monitor-riser', 'laptop-stand']);
function hasTemplateGeometry(item: Item): boolean {
  return (
    item.shapeMode !== 'custom' &&
    !(!item.shapeMode && item.kind === 'generic' && item.parts?.length)
  );
}
function patchBox(item: Item, patch: GeometryContactPatch): Box {
  const transform = (v: V) => yaw(scale(v, item.visual.scale), item.placement.rotation);
  const center = add(item.placement, transform(patch.center));
  const edges: [V, V, V] = [
    transform({ x: patch.size.x / 2, y: 0, z: 0 }),
    { x: 0, y: 0, z: 0 },
    transform({ x: 0, y: 0, z: patch.size.z / 2 }),
  ];
  return { center, edges, bounds: boxBounds(center, edges) };
}
function contactBoxes(b: Body): Box[] {
  const patches = hasTemplateGeometry(b.item)
    ? getTemplateContactProfile(b.item.kind)?.contactPatches
    : undefined;
  if (patches?.length) return patches.map((patch) => patchBox(b.item, patch));
  return b.boxes.filter((box) => box.bounds.min.y <= b.bounds.min.y + 0.035);
}
function contactPoints(b: Body): V[] {
  const explicit =
    hasTemplateGeometry(b.item) && !!getTemplateContactProfile(b.item.kind)?.contactPatches.length;
  return contactBoxes(b).flatMap((box) =>
    corners(box).filter((point) => explicit || point.y <= b.bounds.min.y + 0.035),
  );
}
function supportSurfaces(item: Item): Surface[] {
  const profile = hasTemplateGeometry(item) ? getTemplateContactProfile(item.kind) : null;
  if (profile?.supportPatches.length)
    return profile.supportPatches.map((patch) => {
      const box = patchBox(item, patch);
      return {
        id: item.id,
        name: item.name,
        height: box.center.y,
        box,
        maxOverhangFraction: profile.maxOverhangFraction,
        overhangKinds: profile.overhangKinds,
      };
    });
  const b = body(item);
  const horizontal = b.boxes.filter((box) =>
    box.edges.some(
      (edge) => Math.abs(edge.x) < EPS && Math.abs(edge.z) < EPS && Math.abs(edge.y) > EPS,
    ),
  );
  // Custom shapes use actual faces. A tiny, remote protrusion must never raise a
  // broad, imaginary supporting plane over the rest of an object.
  return horizontal.map((box) => ({ id: item.id, name: item.name, height: box.bounds.max.y, box }));
}
function surfaces(w: Workspace): Surface[] {
  return [
    { id: 'floor', name: 'Floor', height: 0, box: null },
    ...w.objects.filter((o) => solidSupportKinds.has(o.kind)).flatMap(supportSurfaces),
  ];
}

/** Placement support is separate from the desk-only carry attachment. */
function placementSurfaces(w: Workspace, item: Item): Surface[] {
  const monitors =
    item.kind === 'light-bar'
      ? w.devices.filter((candidate) => candidate.kind === 'monitor').flatMap(supportSurfaces)
      : [];
  return [...surfaces(w), ...coveringSurfaces(w), ...monitors].filter(
    (target) =>
      target.id !== item.id &&
      ((item.kind !== 'desk' && item.kind !== 'chair') || target.id === 'floor'),
  );
}

/** Only thin, horizontal mats are walk-over support layers. Thick or tilted custom
 * mats remain ordinary solid obstacles, as do every other object and device. */
function coveringSurfaces(w: Workspace, excluded: Set<string> = new Set()): Surface[] {
  const mats = w.objects.filter((item) => item.kind === 'mat' && !excluded.has(item.id));
  if (!mats.length) return [];
  const solids = surfaces(w);
  const solidBodies = new Map(
    items(w)
      .filter((item) => solidSupportKinds.has(item.kind))
      .map((item) => [item.id, body(item)]),
  );
  return mats.flatMap((item) => {
    const b = body(item);
    if (b.bounds.max.y - b.bounds.min.y > 0.06) return [];
    const horizontal = b.boxes.every((box) =>
      box.edges.every(
        (edge) => Math.abs(edge.y) < EPS || (Math.abs(edge.x) < EPS && Math.abs(edge.z) < EPS),
      ),
    );
    if (!horizontal) return [];
    const coveringSupports = solids.filter(
      (target) =>
        fitsBody(b, target) &&
        restingOn(b, target) &&
        (target.id === 'floor' || pairCollisions(b, solidBodies.get(target.id)!).length === 0),
    );
    // Each box retains its real height/footprint: a thin border or disconnected
    // custom part cannot lend the rest of the mat an invented support surface.
    return supportSurfaces(item).map((target) => ({
      ...target,
      covering: true,
      coveringSupports,
    }));
  });
}

function boundsOverlapXZ(bounds: Bounds, target: Surface): boolean {
  if (!target.box) return true;
  const other = target.box.bounds;
  return (
    bounds.min.x < other.max.x - EPS &&
    bounds.max.x > other.min.x + EPS &&
    bounds.min.z < other.max.z - EPS &&
    bounds.max.z > other.min.z + EPS
  );
}

function footprintContact(b: Body, target: Surface): boolean {
  if (!target.box) return true;
  const layer = target.box;
  return contactBoxes(b).some((box) => {
    // The projection of a transformed box is a convex polygon whose edge
    // directions are its projected box edges. SAT uses their horizontal normals.
    const normals = [...box.edges, ...layer.edges]
      .map((edge) => ({ x: -edge.z, y: 0, z: edge.x }))
      .filter((axis) => length(axis) > 1e-10)
      .map((axis) => mul(axis, 1 / length(axis)));
    return normals.every(
      (axis) =>
        radius(box, axis) +
          radius(layer, axis) -
          Math.abs(dot(sub(box.center, layer.center), axis)) >
        EPS,
    );
  });
}

/** A drag across a thin covering lifts, translates, then rests. Each segment is
 * still swept against all solid geometry and returned for exact save replay.
 * Snapping only to the desk/floor used to lower keyboards and chair wheels INTO
 * the omitted mat/rug, making an otherwise horizontal drag immediately block. */
function resolveCoveringMove(
  before: Workspace,
  proposed: Workspace,
  id: string,
  options: SpatialOptions,
): SpatialResult | null {
  const original = find(before, id);
  const wanted = find(proposed, id);
  if (
    original.kind === 'mat' ||
    original.kind === 'desk' ||
    original.placement.rotation !== wanted.placement.rotation ||
    JSON.stringify(original.visual.scale) !== JSON.stringify(wanted.visual.scale) ||
    JSON.stringify(getGeometryParts(original)) !== JSON.stringify(getGeometryParts(wanted))
  )
    return null;
  const start = getItemBounds(original);
  const endBody = body(wanted);
  const end = endBody.bounds;
  const changed = descendants(before, id);
  const coverings = coveringSurfaces(proposed, changed).filter(
    (target) => Math.abs(target.height - start.min.y) < 0.18,
  );
  // A conservative footprint envelope only chooses a clearance height. It never
  // waives a collision: all three movements below use the normal swept solver.
  const crossed = coverings.filter((target) => boundsOverlapXZ(union([start, end]), target));
  if (!crossed.length) return null;
  const supports = surfaces(proposed)
    .filter((target) => target.id !== id && fits(wanted, target))
    .sort((a, b) => b.height - a.height);
  const attached = wanted.attachment
    ? selectSupportSurface(
        proposed,
        wanted,
        supports.filter((target) => target.id === wanted.attachment?.parentId),
      )
    : undefined;
  const base =
    attached ??
    selectSupportSurface(
      proposed,
      wanted,
      supports.filter((target) => Math.abs(target.height - start.min.y) < 0.18),
    );
  const resting = coverings
    .filter(
      (target) =>
        supportedFootprint(endBody, target) &&
        (!attached ||
          (target.height >= attached.height - EPS && target.height <= attached.height + 0.08)),
    )
    .sort((a, b) => b.height - a.height)[0];
  const target = resting && (!base || resting.height > base.height) ? resting : base;
  if (!target) return null;
  const final = structuredClone(wanted);
  try {
    setHeight(final, target);
  } catch (error) {
    return {
      workspace: before,
      blocked: true,
      reason: error instanceof Error ? error.message : 'This shape cannot rest on the surface.',
    };
  }
  const plane = Math.max(
    start.min.y,
    getItemBounds(final).min.y,
    ...crossed.map((s) => s.height + GAP),
  );
  const lift = original.placement.y + plane - start.min.y;
  const travel = final.placement.y + plane - getItemBounds(final).min.y;
  const placements: Placement[] = [
    { ...original.placement, y: lift },
    { ...final.placement, y: travel },
    { ...final.placement },
  ];
  let current = before;
  const path: Placement[] = [];
  for (const placement of placements) {
    if (
      (['x', 'y', 'z', 'rotation'] as const).every(
        (axis) => Math.abs(find(current, id).placement[axis] - placement[axis]) < 1e-9,
      )
    )
      continue;
    const candidate = structuredClone(current);
    Object.assign(find(candidate, id), { ...wanted, placement });
    const result = resolveSpatialEdit(current, candidate, id, { ...options, snap: undefined });
    const next = find(result.workspace, id).placement;
    if (JSON.stringify(next) !== JSON.stringify(find(current, id).placement))
      path.push({ ...next });
    current = result.workspace;
    if (result.blocked) return { ...result, path };
  }
  return { workspace: current, blocked: false, reason: '', path };
}
export function getSurfaceTargets(w: Workspace, id: string): { id: string; name: string }[] {
  const item = find(w, id);
  return [
    ...new Map(placementSurfaces(w, item).map(({ id, name }) => [id, { id, name }])).values(),
  ];
}
export function getRestingSurfaceId(workspace: Workspace, id: string): string | null {
  const item = find(workspace, id);
  const b = body(item);
  return (
    placementSurfaces(workspace, item)
      .filter((target) => supportedFootprint(b, target) && restingOn(b, target))
      .sort((a, b) => b.height - a.height)[0]?.id ?? null
  );
}

export type SceneSupportEvaluation = {
  available: boolean;
  footprintValid: boolean;
  resting: boolean;
  heightDelta: number;
  issue?: string;
};

/** The same contact policy is used by fitting, review, manual snapping and search. */
export function evaluateSceneSupport(
  workspace: Workspace,
  itemId: string,
  surfaceId: string,
): SceneSupportEvaluation {
  const item = find(workspace, itemId);
  const target = intendedSupport(workspace, item, new Map([[itemId, surfaceId]]));
  if (!target)
    return {
      available: false,
      footprintValid: false,
      resting: false,
      heightDelta: 0,
      issue: 'The selected support is unavailable.',
    };
  const b = body(item);
  const footprintValid = supportedFootprint(b, target);
  const resting = restingOn(b, target);
  return {
    available: true,
    footprintValid,
    resting,
    heightDelta: target.height + GAP - b.bounds.min.y,
    ...(!footprintValid
      ? { issue: `${item.name} exceeds the contact allowance on ${target.name}.` }
      : !resting
        ? { issue: `${item.name} is not resting on ${target.name}.` }
        : {}),
  };
}

/** A conservative direct-support correction: one thin mat must fully contain the
 * contact base and itself rest on the originally selected solid surface. Partial
 * mat contact is valid for manual placement but is not enough to infer a relation. */
export function getUnambiguousCoveringSupport(
  workspace: Workspace,
  itemId: string,
  currentSupportId: string,
): string | null {
  const item = find(workspace, itemId);
  if (item.kind === 'desk' || item.kind === 'chair' || item.kind === 'mat') return null;
  const current = intendedSupport(workspace, item, new Map([[itemId, currentSupportId]]));
  if (!current || current.covering || current.id === 'floor') return null;
  const b = body(item);
  const candidates = new Set(
    coveringSurfaces(workspace, new Set([itemId]))
      .filter((target) => {
        const mat = body(find(workspace, target.id));
        return (
          fitsBody(b, target) &&
          fitsBody(mat, current) &&
          restingOn(mat, current) &&
          target.height >= current.height - EPS &&
          target.height <= current.height + 0.06 + GAP + REST_TOLERANCE
        );
      })
      .map((target) => target.id),
  );
  return candidates.size === 1 ? [...candidates][0] : null;
}
function corners(box: Box): V[] {
  return [-1, 1].flatMap((a) =>
    [-1, 1].flatMap((b) =>
      [-1, 1].map((c) =>
        add(box.center, add(mul(box.edges[0], a), add(mul(box.edges[1], b), mul(box.edges[2], c)))),
      ),
    ),
  );
}
function containsXZ(box: Box, point: V, overhangFraction = 0): boolean {
  const edges = box.edges.filter((edge) => Math.abs(edge.y) < EPS && length(edge) > EPS);
  if (edges.length !== 2) return false;
  const [a, b] = edges;
  const p = sub(point, box.center);
  const det = a.x * b.z - a.z * b.x;
  if (Math.abs(det) < 1e-10) return false;
  const u = (p.x * b.z - p.z * b.x) / det;
  const v = (a.x * p.z - a.z * p.x) / det;
  // u/v use half-extents; the policy is expressed in full support dimensions.
  return (
    Math.abs(u) <= 1 + 2 * overhangFraction + EPS && Math.abs(v) <= 1 + 2 * overhangFraction + EPS
  );
}
function fits(item: Item, target: Surface): boolean {
  return supportedFootprint(body(item), target);
}
function fitsBody(b: Body, target: Surface): boolean {
  if (!target.box) return true;
  const points = contactPoints(b);
  const overhang =
    hasTemplateGeometry(b.item) && target.overhangKinds?.includes(b.item.kind)
      ? (target.maxOverhangFraction ?? 0)
      : 0;
  if (!points.length || !points.every((point) => containsXZ(target.box!, point, overhang)))
    return false;
  if (overhang > 0) {
    // A bounded edge allowance is not permission to support an off-centre object.
    const center = mul(
      points.reduce((sum, point) => add(sum, point), origin),
      1 / points.length,
    );
    if (!containsXZ(target.box, center)) return false;
  }
  return true;
}
function supportedFootprint(b: Body, target: Surface): boolean {
  // A thin mat may cover only part of a contact base when a verified solid face
  // beneath it still supports the complete base. A sliver of mat at a desk edge
  // cannot authorize an arbitrarily large extension beyond the desk itself.
  if (target.covering && !fitsBody(b, target))
    return (
      footprintContact(b, target) &&
      !!target.coveringSupports?.some((underlying) => fitsBody(b, underlying))
    );
  // Solid surfaces use the explicit kind-specific contact policy, including
  // only the bounded laptop/stand overhang.
  return fitsBody(b, target);
}
function restingOn(b: Body, target: Surface): boolean {
  const gap = b.bounds.min.y - target.height - GAP;
  return (
    Math.abs(gap) <= REST_TOLERANCE ||
    // Keep the existing floor-origin clamp for chair wheels and other template
    // origins that would otherwise need a small negative root coordinate.
    (target.id === 'floor' && b.item.placement.y === 0 && gap > 0 && gap < 0.051)
  );
}
function restingRootHeight(item: Item, target: Surface): number {
  const delta = target.height + GAP - getItemBounds(item).min.y;
  if (Math.abs(delta) < 1e-10) return item.placement.y;
  let height = item.placement.y + delta;
  if (target.id === 'floor' && height > -0.051 && height < 0) height = 0;
  return height >= -EPS ? Math.max(0, height) : height;
}
function setHeight(item: Item, target: Surface): void {
  const height = restingRootHeight(item, target);
  if (height < -EPS || height > 5.5)
    throw new Error('This shape cannot rest on that surface within the scene height limit.');
  item.placement.y = height;
}

function descendants(w: Workspace, id: string): Set<string> {
  return new Set([
    id,
    ...items(w)
      .filter((item) => item.attachment?.parentId === id)
      .map((item) => item.id),
  ]);
}
function childPlacement(parentBefore: Item, parentAfter: Item, oldChild: Item): Placement {
  const local = yaw(
    sub(oldChild.placement, parentBefore.placement),
    -parentBefore.placement.rotation,
  );
  const ratio = {
    x: parentAfter.visual.scale.x / parentBefore.visual.scale.x,
    y: parentAfter.visual.scale.y / parentBefore.visual.scale.y,
    z: parentAfter.visual.scale.z / parentBefore.visual.scale.z,
  };
  const location = add(
    parentAfter.placement,
    yaw(scale(local, ratio), parentAfter.placement.rotation),
  );
  // The child's own dimensions do not scale with the desk. Transform its bottom
  // contact point, then compensate for the unchanged local origin offset.
  const bottomOffset = getItemBounds(oldChild).min.y - oldChild.placement.y;
  location.y += bottomOffset * (ratio.y - 1);
  return {
    ...location,
    rotation: normalizedAngle(
      oldChild.placement.rotation +
        parentAfter.placement.rotation -
        parentBefore.placement.rotation,
    ),
  };
}
function transformChildren(before: Workspace, candidate: Workspace, id: string): void {
  const parentBefore = find(before, id);
  const parentAfter = find(candidate, id);
  for (const oldChild of items(before).filter((item) => item.attachment?.parentId === id))
    find(candidate, oldChild.id).placement = childPlacement(parentBefore, parentAfter, oldChild);
}
/** Restore an original attached record relative to the desk's current preview transform. */
export function rebaseAttachedPlacement(
  base: Workspace,
  current: Workspace,
  item: Item,
): Placement {
  if (!item.attachment) return { ...item.placement };
  const from = base.objects.find(
    (object) => object.id === item.attachment?.parentId && object.kind === 'desk',
  );
  const to = current.objects.find(
    (object) => object.id === item.attachment?.parentId && object.kind === 'desk',
  );
  if (!from || !to)
    throw new Error('The original attached desk is no longer available in this preview.');
  const placement = childPlacement(from, to, item);
  const carried = { ...item, placement };
  return validPlacement(carried) &&
    getItemBounds(carried).min.y >= Math.min(0, getItemBounds(item).min.y) - EPS
    ? placement
    : { ...item.placement };
}
function interpolate(before: Workspace, candidate: Workspace, id: string, t: number): Workspace {
  const result = structuredClone(candidate);
  const a = find(before, id);
  const b = find(result, id);
  for (const axis of ['x', 'y', 'z'] as const) {
    b.placement[axis] = a.placement[axis] + (b.placement[axis] - a.placement[axis]) * t;
    b.visual.scale[axis] = a.visual.scale[axis] + (b.visual.scale[axis] - a.visual.scale[axis]) * t;
  }
  b.placement.rotation = a.placement.rotation + (b.placement.rotation - a.placement.rotation) * t;
  transformChildren(before, result, id);
  return result;
}
type Collision = { key: string; depth: number; distance: number; name: string };
const collisionKey = (a: Item, i: number, b: Item, j: number) =>
  a.id < b.id ? `${a.id}/${i}:${b.id}/${j}` : `${b.id}/${j}:${a.id}/${i}`;
function pairCollisions(a: Body, b: Body): Collision[] {
  if (!intersectsBounds(a.bounds, b.bounds)) return [];
  const hits: Collision[] = [];
  a.boxes.forEach((one, i) =>
    b.boxes.forEach((two, j) => {
      const depth = penetration(one, two);
      if (depth > 0)
        hits.push({
          key: collisionKey(a.item, i, b.item, j),
          depth,
          distance: length(sub(one.center, two.center)),
          name: b.item.name,
        });
    }),
  );
  return hits;
}
function collisionPairs(bodies: Body[], changed: Set<string>): [Body, Body][] {
  const result: [Body, Body][] = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      if (changed.has(bodies[i].item.id) || changed.has(bodies[j].item.id))
        result.push([bodies[i], bodies[j]]);
    }
  return result;
}
function allowedExisting(hit: Collision, initial: Map<string, Collision>): boolean {
  const old = initial.get(hit.key);
  return !!old && hit.depth <= old.depth + EPS && hit.distance >= old.distance - EPS;
}
function validPlacement(item: Item): boolean {
  const p = item.placement;
  return (
    p.x >= -4.3 - EPS &&
    p.x <= 4.3 + EPS &&
    p.y >= -EPS &&
    p.y <= 5.5 + EPS &&
    p.z >= -1.9 - EPS &&
    p.z <= 3.7 + EPS
  );
}

export type SpatialOptions = {
  snap?: 'auto' | 'floor' | string;
  sweep?: boolean;
  /** Dimension edits can keep an existing resting contact without changing an intentional height. */
  preserveSupport?: boolean;
};
export type SpatialResult = {
  workspace: Workspace;
  blocked: boolean;
  reason: string;
  /** Collision-checked support transitions, replayed as one undoable drag. */
  path?: Placement[];
};
/** Immutable placement solver used by live dragging and persisted commands. */
export function resolveSpatialEdit(
  before: Workspace,
  proposed: Workspace,
  id: string,
  options: SpatialOptions = {},
): SpatialResult {
  if (options.snap === 'auto') {
    const coveringMove = resolveCoveringMove(before, proposed, id, options);
    if (coveringMove) return coveringMove;
  }
  const candidate = structuredClone(proposed);
  const oldItem = find(before, id);
  const item = find(candidate, id);
  const changed = descendants(before, id);
  if (options.preserveSupport && item.placement.y === oldItem.placement.y && !options.snap) {
    const oldBody = body(oldItem);
    const coveringIds = new Set(coveringSurfaces(before).map((target) => target.id));
    const resting = [...surfaces(before), ...coveringSurfaces(before)]
      .filter((target) => {
        const gap = oldBody.bounds.min.y - target.height;
        return (
          target.id !== id &&
          (item.kind !== 'desk' || target.id === 'floor') &&
          (!oldItem.attachment ||
            target.id === oldItem.attachment.parentId ||
            coveringIds.has(target.id)) &&
          gap >= -EPS &&
          gap <= REST_TOLERANCE &&
          supportedFootprint(oldBody, target)
        );
      })
      .sort((a, b) => b.height - a.height)[0];
    if (resting) {
      // Template origins need not coincide with their lowest geometry. Scaling a
      // resting monitor down must not lower its feet into the desk. Keep the old
      // bottom and its deliberate small gap, rather than snapping to a new surface.
      const y = item.placement.y + oldBody.bounds.min.y - getItemBounds(item).min.y;
      if (y >= -EPS && y <= 5.5 + EPS) item.placement.y = Math.max(0, Math.min(5.5, y));
    }
  }
  if (options.snap === 'auto') {
    const bottom = getItemBounds(oldItem).min.y;
    const candidates = surfaces(candidate)
      .filter((s) => s.id !== id && (item.kind !== 'desk' || s.id === 'floor') && fits(item, s))
      .sort((a, b) => b.height - a.height);
    const attached = item.attachment
      ? selectSupportSurface(
          candidate,
          item,
          candidates.filter((s) => s.id === item.attachment?.parentId),
        )
      : undefined;
    const nearby =
      attached ??
      selectSupportSurface(
        candidate,
        item,
        candidates.filter((s) => Math.abs(s.height - bottom) < 0.18),
      );
    if (nearby) {
      try {
        setHeight(item, nearby);
      } catch (error) {
        return {
          workspace: before,
          blocked: true,
          reason: error instanceof Error ? error.message : 'This shape cannot rest on the surface.',
        };
      }
    }
  } else if (options.snap) {
    const target = intendedSupport(candidate, item, new Map([[id, options.snap]]));
    if (!target || target.id === id || !fits(item, target))
      return {
        workspace: before,
        blocked: true,
        reason: 'Move the object fully over the selected surface first.',
      };
    try {
      setHeight(item, target);
    } catch (error) {
      return {
        workspace: before,
        blocked: true,
        reason: error instanceof Error ? error.message : 'This shape cannot rest on the surface.',
      };
    }
  }
  transformChildren(before, candidate, id);
  const startBodies = items(before).map(body);
  const shape = (entry: Item) =>
    getGeometryParts(entry).map(({ position, size, rotation }) => ({ position, size, rotation }));
  const geometryChanged = JSON.stringify(shape(oldItem)) !== JSON.stringify(shape(item));
  const rigidGroup =
    !geometryChanged &&
    (['x', 'y', 'z'] as const).every(
      (axis) => oldItem.visual.scale[axis] === item.visual.scale[axis],
    );
  const activePairs = (bodies: Body[]) =>
    collisionPairs(bodies, changed).filter(
      ([a, b]) => !(rigidGroup && changed.has(a.item.id) && changed.has(b.item.id)),
    );
  const initial = new Map(
    activePairs(startBodies)
      .flatMap(([a, b]) => pairCollisions(a, b))
      .map((hit) => [hit.key, hit]),
  );
  const originalBodies = new Map(startBodies.map((b) => [b.item.id, b]));
  // Attached children orbit the desk pivot, which can be far outside a child's own bounds.
  const orbitRadius = Math.max(
    1,
    ...[before, candidate].flatMap((w) => {
      const pivot = find(w, id).placement;
      return items(w)
        .filter((entry) => changed.has(entry.id))
        .flatMap((entry) =>
          body(entry).boxes.flatMap((box) =>
            corners(box).map((point) => length(sub(point, pivot))),
          ),
        );
    }),
  );
  let radialChange = 0;
  for (const movingId of changed) {
    const from = originalBodies.get(movingId)!;
    const to = body(find(candidate, movingId));
    from.boxes.forEach((box, index) => {
      if (!to.boxes[index]) return;
      const endCorners = corners(to.boxes[index]);
      corners(box).forEach((point, corner) => {
        const startLocal = yaw(sub(point, oldItem.placement), -oldItem.placement.rotation);
        const endLocal = yaw(sub(endCorners[corner], item.placement), -item.placement.rotation);
        radialChange = Math.max(radialChange, length(sub(endLocal, startLocal)));
      });
    });
  }
  const travel = length(sub(oldItem.placement, item.placement));
  const angle = Math.abs(item.placement.rotation - oldItem.placement.rotation);
  const scaleChange = Math.max(
    ...(['x', 'y', 'z'] as const).map((axis) =>
      Math.abs(item.visual.scale[axis] - oldItem.visual.scale[axis]),
    ),
  );
  const steps =
    options.sweep === false || geometryChanged
      ? 1
      : Math.max(1, Math.ceil(angle / 4), Math.ceil(scaleChange / 0.1), Math.ceil(travel / 0.4));
  let previous = before;
  let previousBodies = originalBodies;
  let safeT = 0;
  let reason = '';
  function validate(next: Workspace, t: number, sweeping: boolean): string {
    const nextBodies = items(next).map((entry) =>
      changed.has(entry.id) ? body(entry) : originalBodies.get(entry.id)!,
    );
    const bodyMap = new Map(nextBodies.map((b) => [b.item.id, b]));
    for (const movingId of changed) {
      const b = bodyMap.get(movingId)!;
      const original = originalBodies.get(movingId)!;
      if (!validPlacement(b.item))
        return 'The object or an attached object would leave the scene limits.';
      if (b.bounds.min.y < Math.min(0, original.bounds.min.y) - EPS)
        return `${b.item.name} would go through the floor.`;
      if (b.item.attachment) {
        const desk = next.objects.find((o) => o.id === b.item.attachment?.parentId);
        const target = desk && intendedSupport(next, b.item, new Map([[b.item.id, desk.id]]));
        if (!target || !supportedFootprint(b, target))
          return `${b.item.name} must stay over its attached desk. Detach it to move elsewhere.`;
      }
    }
    for (const [a, b] of activePairs(nextBodies)) {
      const endpointHits = pairCollisions(a, b);
      const bad = endpointHits.find((hit) => !allowedExisting(hit, initial));
      if (bad) return `${a.item.name} would intersect ${b.item.name}.`;
      if (!sweeping) continue;
      const a0 = previousBodies.get(a.item.id)!;
      const b0 = previousBodies.get(b.item.id)!;
      const sweptBoundsA = union([a0.bounds, a.bounds]);
      const sweptBoundsB = union([b0.bounds, b.bounds]);
      // Linear interpolation error <= max |p''| * dt² / 8. This also bounds
      // simultaneous rotation + nonuniform scaling and distant attached children.
      const angularSpeed = radians(angle);
      const padding =
        ((orbitRadius * angularSpeed ** 2 + 2 * radialChange * angularSpeed) * (t - safeT) ** 2) /
        8;
      if (!intersectsBounds(sweptBoundsA, sweptBoundsB, padding)) continue;
      for (let i = 0; i < a.boxes.length; i++)
        for (let j = 0; j < b.boxes.length; j++) {
          const key = collisionKey(a.item, i, b.item, j);
          const previousA = a0.boxes[i];
          const previousB = b0.boxes[j];
          if (!previousA || !previousB) continue;
          if (initial.has(key)) {
            // Imported overlaps may escape, but cannot move deeper or create another contact.
            const old = initial.get(key)!;
            if (length(sub(a.boxes[i].center, b.boxes[j].center)) < old.distance - EPS)
              return `${a.item.name} would move further into ${b.item.name}.`;
            continue;
          }
          if (sweptCollision(previousA, a.boxes[i], previousB, b.boxes[j], padding))
            return `${a.item.name} is blocked by ${b.item.name}.`;
        }
    }
    return '';
  }
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const next = interpolate(before, candidate, id, t);
    reason = validate(next, t, options.sweep !== false && !geometryChanged);
    if (reason) {
      if (geometryChanged || options.sweep === false)
        return { workspace: before, blocked: true, reason };
      let low = safeT;
      let high = t;
      for (let iteration = 0; iteration < 15; iteration++) {
        const mid = (low + high) / 2;
        const attempt = interpolate(before, candidate, id, mid);
        if (validate(attempt, mid, true)) high = mid;
        else low = mid;
      }
      if (low > safeT + 1e-7) previous = interpolate(before, candidate, id, low);
      return { workspace: previous, blocked: true, reason };
    }
    safeT = t;
    previous = next;
    previousBodies = new Map(
      items(next).map((entry) => [
        entry.id,
        changed.has(entry.id) ? body(entry) : originalBodies.get(entry.id)!,
      ]),
    );
  }
  return { workspace: previous, blocked: false, reason: '' };
}

/** Prepare an editable preview relocation before its support descendants refit.
 * This pure helper does not authorize application: review must revalidate the
 * complete draft, and ordinary editing must use snapToSurface below. */
export function prepareSurfacePlacement(
  workspace: Workspace,
  id: string,
  surfaceId: string,
): { draft: Workspace; surfaceId: string } {
  const candidate = structuredClone(workspace);
  const item = find(candidate, id);
  const targets = placementSurfaces(candidate, item)
    .filter((s) => s.id === surfaceId)
    .sort((a, b) => b.height - a.height);
  const target = selectSupportSurface(candidate, item, targets);
  if (!target) throw new Error('Choose a valid support surface.');
  if (!fits(item, target)) {
    if (!target.box) throw new Error('This shape does not fit on the selected surface.');
    item.placement.x = target.box.center.x;
    item.placement.z = target.box.center.z;
  }
  if (!fits(item, target))
    throw new Error('This object is too large for that surface. Reduce its size first.');
  setHeight(item, target);
  const covering = coveringSurfaces(candidate, descendants(candidate, id))
    .filter(
      (layer) =>
        layer.height >= target.height - EPS &&
        layer.height <= target.height + 0.08 &&
        supportedFootprint(body(item), layer),
    )
    .sort((a, b) => b.height - a.height)[0];
  const covered = covering && item.kind !== 'mat' && item.kind !== 'desk';
  if (covered) setHeight(item, covering);
  const attachedDesk = candidate.objects.find(
    (object) => object.id === item.attachment?.parentId && object.kind === 'desk',
  );
  const selectedDesk = candidate.objects.some(
    (object) => object.id === surfaceId && object.kind === 'desk',
  );
  const attachedSurface = attachedDesk
    ? intendedSupport(candidate, item, new Map([[id, attachedDesk.id]]))
    : undefined;
  const keepsDeskAttachment =
    attachedSurface &&
    !selectedDesk &&
    surfaceId !== 'floor' &&
    target.height >= attachedSurface.height - EPS &&
    fits(item, attachedSurface);
  if (item.attachment?.parentId !== surfaceId && !keepsDeskAttachment) item.attachment = null;
  return { draft: candidate, surfaceId: covered ? covering.id : target.id };
}

/** Place deliberately on a support. This is an explicit relocation, not a physical animation. */
export function snapToSurface(workspace: Workspace, id: string, surfaceId: string): Workspace {
  const candidate = prepareSurfacePlacement(workspace, id, surfaceId);
  const result = resolveSpatialEdit(workspace, candidate.draft, id, { sweep: false });
  if (result.blocked) throw new Error(result.reason);
  return result.workspace;
}

/** Find a nearby vacant rest position only for a newly added/photo-proposed object. */
function translatedBody(base: Body, item: Item): Body {
  const delta = sub(item.placement, base.item.placement);
  const shift = (bounds: Bounds): Bounds => ({
    min: add(bounds.min, delta),
    max: add(bounds.max, delta),
  });
  return {
    item,
    bounds: shift(base.bounds),
    boxes: base.boxes.map((box) => ({
      center: add(box.center, delta),
      edges: box.edges,
      bounds: shift(box.bounds),
    })),
  };
}
export function findFreePlacement(
  workspace: Workspace,
  id: string,
  options: { surfaceId?: string; allowFloorFallback?: boolean } = {},
): Workspace {
  const source = find(workspace, id);
  const sourceBody = body(source);
  const rest = items(workspace)
    .filter((item) => item.id !== id)
    .map(body);
  const possible = placementSurfaces(workspace, source).filter(
    (s) =>
      s.id !== id &&
      ((source.kind !== 'desk' && source.kind !== 'chair') || s.id === 'floor') &&
      (!source.attachment || s.id === source.attachment.parentId) &&
      (!options.surfaceId || s.id === options.surfaceId) &&
      (options.allowFloorFallback !== false || s.id !== 'floor' || sourceBody.bounds.min.y < 0.22),
  );
  if (!possible.length)
    throw new Error(
      source.attachment
        ? 'The attached desk is no longer available. Detach this object before placing it elsewhere.'
        : 'No intended support surface is available. Choose a support surface before placing this object.',
    );
  possible.sort(
    (a, b) =>
      Math.abs(a.height - sourceBody.bounds.min.y) - Math.abs(b.height - sourceBody.bounds.min.y),
  );
  const offsets: [number, number][] = [[0, 0]];
  for (let r = 1; r <= 24; r++) {
    for (let x = -r; x <= r; x++) offsets.push([x * 0.2, -r * 0.2], [x * 0.2, r * 0.2]);
    for (let z = -r + 1; z < r; z++) offsets.push([-r * 0.2, z * 0.2], [r * 0.2, z * 0.2]);
  }
  for (const target of possible) {
    // Every support gets its own bounded search. Nearby mat layers must not
    // exhaust the budget before an ordinary manual addition can reach the desk.
    let attempts = 0;
    for (const [dx, dz] of offsets) {
      if (++attempts > 4096) break;
      let y = source.placement.y + target.height + GAP - sourceBody.bounds.min.y;
      if (target.id === 'floor' && y > -0.051 && y < 0) y = 0;
      const candidate = {
        ...source,
        placement: {
          ...source.placement,
          x: source.placement.x + dx,
          y,
          z: source.placement.z + dz,
        },
      };
      if (!validPlacement(candidate)) continue;
      const b = translatedBody(sourceBody, candidate);
      if (!supportedFootprint(b, target)) continue;
      if (rest.some((other) => pairCollisions(b, other).length > 0)) continue;
      const next = structuredClone(workspace);
      Object.assign(find(next, id), candidate);
      return next;
    }
  }
  throw new Error(
    'No clear resting position was found. Move another object or reduce this object’s size, then try again.',
  );
}

export type SceneSupportRelation = {
  itemId: string;
  surfaceId: string;
  source?: 'model' | 'user' | 'geometry';
  maxHeightAdjustment?: number;
};
export type SceneCollisionPair = { itemIds: [string, string]; penetration: number };

/** Exact transformed-box collisions, grouped by stable object IDs rather than
 * one warning per object or per decorative box. A baseline keeps old contacts
 * from becoming new failures while still reporting worsened penetration. */
export function getSceneCollisionPairs(
  workspace: Workspace,
  baseline?: Workspace,
): SceneCollisionPair[] {
  const all = items(workspace).map(body);
  const changed = new Set(all.map((entry) => entry.item.id));
  const initial = new Map(
    baseline
      ? collisionPairs(items(baseline).map(body), changed)
          .flatMap(([a, b]) => pairCollisions(a, b))
          .map((hit) => [hit.key, hit])
      : [],
  );
  return collisionPairs(all, changed)
    .flatMap(([a, b]): SceneCollisionPair[] => {
      const hits = pairCollisions(a, b).filter((hit) => !allowedExisting(hit, initial));
      if (!hits.length) return [];
      const itemIds = [a.item.id, b.item.id].sort() as [string, string];
      return [{ itemIds, penetration: Math.max(...hits.map((hit) => hit.depth)) }];
    })
    .sort(
      (a, b) =>
        a.itemIds[0].localeCompare(b.itemIds[0]) || a.itemIds[1].localeCompare(b.itemIds[1]),
    );
}
export type ScenePlacementIssue = {
  itemId: string;
  code: 'support' | 'collision' | 'retained-placement';
  message: string;
  relatedItemId?: string;
  rootCause?:
    | 'missing-support'
    | 'support-cycle'
    | 'overhang'
    | 'height'
    | 'height-budget'
    | 'collision'
    | 'scene-bounds'
    | 'retained-placement';
};

/** A surface ID can expose several real faces. Preserve a valid resting face,
 * then prefer the nearest feasible face. A face buried under another part of
 * the same support is not a usable rest plane (for example a mat's lower layer). */
function selectSupportSurface(
  workspace: Workspace,
  item: Item,
  possible: Surface[],
): Surface | undefined {
  const b = body(item);
  const parentBodies = new Map<string, Body>();
  return possible
    .map((target) => {
      const footprint = supportedFootprint(b, target);
      let clear = footprint;
      if (footprint && target.id !== 'floor') {
        let parent = parentBodies.get(target.id);
        if (!parent) {
          const owner = items(workspace).find((entry) => entry.id === target.id);
          if (owner) {
            parent = body(owner);
            parentBodies.set(target.id, parent);
          }
        }
        const projected = {
          ...item,
          placement: {
            ...item.placement,
            y: item.placement.y + target.height + GAP - b.bounds.min.y,
          },
        };
        clear = !!parent && pairCollisions(translatedBody(b, projected), parent).length === 0;
      }
      return {
        target,
        footprint,
        clear,
        resting: footprint && clear && restingOn(b, target),
        distance: Math.abs(target.height + GAP - b.bounds.min.y),
      };
    })
    .sort(
      (a, b) =>
        Number(b.footprint && b.clear) - Number(a.footprint && a.clear) ||
        Number(b.footprint) - Number(a.footprint) ||
        Number(b.resting) - Number(a.resting) ||
        a.distance - b.distance ||
        b.target.height - a.target.height,
    )[0]?.target;
}

function intendedSupport(
  workspace: Workspace,
  item: Item,
  supports: Map<string, string>,
): Surface | undefined {
  const possible = placementSurfaces(workspace, item);
  const required = supports.get(item.id) ?? item.attachment?.parentId;
  if (required) {
    return selectSupportSurface(
      workspace,
      item,
      possible.filter((target) => target.id === required),
    );
  }
  const b = body(item);
  // A tabletop observation cannot acquire an unrelated floor position when its
  // intended desk or stand is crowded, too small, missing, or unsupported.
  const nearby = possible.filter(
    (target) =>
      Math.abs(target.height - b.bounds.min.y) <= 0.22 &&
      (target.id === 'floor' || footprintContact(b, target)),
  );
  return selectSupportSurface(workspace, item, nearby);
}

function reviewScope(base: Workspace, draft: Workspace, changedIds: Iterable<string>): Set<string> {
  const changed = new Set(changedIds);
  for (const item of items(draft)) {
    const original = items(base).find((candidate) => candidate.id === item.id);
    if (original?.attachment && changed.has(original.attachment.parentId)) changed.add(item.id);
  }
  return changed;
}

/** Inspect an editable photo draft without moving any object or rejecting the preview. */
export function getScenePlacementIssues(
  base: Workspace,
  draft: Workspace,
  changedIds: Iterable<string>,
  relations: Iterable<SceneSupportRelation> = [],
): ScenePlacementIssue[] {
  const supports = new Map([...relations].map(({ itemId, surfaceId }) => [itemId, surfaceId]));
  const explicitChanges = new Set(changedIds);
  const changed = reviewScope(base, draft, explicitChanges);
  const issues: ScenePlacementIssue[] = [];
  const append = (
    itemId: string,
    code: ScenePlacementIssue['code'],
    message: string,
    rootCause?: ScenePlacementIssue['rootCause'],
    relatedItemId?: string,
  ) => {
    if (!issues.some((issue) => issue.itemId === itemId && issue.message === message))
      issues.push({
        itemId,
        code,
        message,
        ...(rootCause ? { rootCause } : {}),
        ...(relatedItemId ? { relatedItemId } : {}),
      });
  };
  for (const item of items(draft).filter((candidate) => changed.has(candidate.id))) {
    const b = body(item);
    const supportCode = explicitChanges.has(item.id) ? 'support' : 'retained-placement';
    const target = intendedSupport(draft, item, supports);
    let next = supports.get(item.id);
    const chain = new Set([item.id]);
    let cycle = false;
    while (next && next !== 'floor') {
      if (chain.has(next)) {
        cycle = true;
        break;
      }
      chain.add(next);
      next = supports.get(next);
    }
    if (cycle)
      append(
        item.id,
        supportCode,
        `${item.name} has a circular support relationship.`,
        'support-cycle',
        supports.get(item.id),
      );
    else if (!target)
      append(
        item.id,
        supportCode,
        supports.has(item.id)
          ? `${item.name}'s selected support is unavailable. Choose a support surface.`
          : `${item.name} has no nearby support. Choose a support surface or adjust its height.`,
        'missing-support',
        supports.get(item.id),
      );
    else if (!supportedFootprint(b, target))
      append(
        item.id,
        supportCode,
        `${item.name} extends beyond ${target.name}. Adjust its placement or support.`,
        'overhang',
        target.id,
      );
    else if (!restingOn(b, target))
      append(
        item.id,
        supportCode,
        `${item.name} is not resting on ${target.name}. Place it on the selected support.`,
        'height',
        target.id,
      );
    const original = items(base).find((candidate) => candidate.id === item.id);
    const allowedFloor = original ? Math.min(0, getItemBounds(original).min.y) : 0;
    if (
      original?.attachment &&
      item.attachment?.parentId === original.attachment.parentId &&
      !explicitChanges.has(item.id)
    ) {
      const fromParent = base.objects.find((parent) => parent.id === original.attachment?.parentId);
      const toParent = draft.objects.find((parent) => parent.id === original.attachment?.parentId);
      if (fromParent && toParent) {
        const expected = { ...item, placement: childPlacement(fromParent, toParent, original) };
        if (
          !validPlacement(expected) &&
          JSON.stringify(item.placement) === JSON.stringify(original.placement)
        )
          append(
            item.id,
            'retained-placement',
            `${item.name} would be carried outside the scene limits. Adjust the desk or detach and place the object.`,
            'retained-placement',
            original.attachment.parentId,
          );
      }
    }
    if (!validPlacement(item) || b.bounds.min.y < allowedFloor - EPS)
      append(
        item.id,
        supportCode,
        `${item.name} leaves the scene limits or goes through the floor.`,
        'scene-bounds',
      );
  }
  const all = items(draft).map(body);
  const initial = new Map(
    collisionPairs(items(base).map(body), changed)
      .flatMap(([a, b]) => pairCollisions(a, b))
      .map((hit) => [hit.key, hit]),
  );
  for (const [a, b] of collisionPairs(all, changed)) {
    if (!pairCollisions(a, b).some((hit) => !allowedExisting(hit, initial))) continue;
    for (const [one, other] of [
      [a, b],
      [b, a],
    ]) {
      if (!changed.has(one.item.id)) continue;
      append(
        one.item.id,
        explicitChanges.has(one.item.id) ? 'collision' : 'retained-placement',
        `${one.item.name} overlaps ${other.item.name}. Adjust the proposed objects before applying.`,
        'collision',
        other.item.id,
      );
    }
  }
  return issues;
}

/** Fit support heights in dependency order, preserving the photo's relative X/Z.
 * Unresolved shapes stay visible in place and produce review issues, never a floor fallback. */
export function fitSceneProposalForReview(
  base: Workspace,
  draft: Workspace,
  changedIds: Iterable<string>,
  relations: Iterable<SceneSupportRelation> = [],
  options: {
    carryFrom?: Workspace;
    lockedIds?: Iterable<string>;
    /** Bounds the complete correction across fitting stages against a fixed
     * photo seed or a newly confirmed user-action reference. */
    heightReferences?: Iterable<{ itemId: string; y: number; maxDisplacement: number }>;
  } = {},
): { draft: Workspace; issues: ScenePlacementIssue[] } {
  const result = structuredClone(draft);
  const changed = new Set(changedIds);
  const explicitSupports = [...relations];
  const supports = new Map(explicitSupports.map(({ itemId, surfaceId }) => [itemId, surfaceId]));
  const supportMetadata = new Map(explicitSupports.map((relation) => [relation.itemId, relation]));
  const locked = new Set(options.lockedIds ?? []);
  const heightReferences = new Map(
    [...(options.heightReferences ?? [])].map((reference) => [reference.itemId, reference]),
  );
  const budgetIssues: ScenePlacementIssue[] = [];
  const planned = new Map<string, string>();
  for (const item of items(draft).filter((candidate) => changed.has(candidate.id))) {
    const target = intendedSupport(draft, item, supports);
    if (target) planned.set(item.id, target.id);
  }
  const active = new Set<string>();
  const done = new Set<string>();
  const cyclic = new Set<string>();
  function place(id: string): void {
    if (done.has(id)) return;
    if (active.has(id)) {
      for (const cycleId of active) cyclic.add(cycleId);
      return;
    }
    active.add(id);
    const supportId = planned.get(id);
    if (supportId && changed.has(supportId)) place(supportId);
    if (!cyclic.has(id) && supportId) {
      const item = find(result, id);
      const target = intendedSupport(result, item, new Map([[id, supportId]]));
      const heightAdjustment = target
        ? Math.abs(target.height + GAP - getItemBounds(item).min.y)
        : Infinity;
      const relation = supportMetadata.get(id);
      // A model-provided ID is still an estimate. Only an explicit user choice
      // or an existing user attachment authorizes an unrestricted height change.
      const deliberateSupport = relation?.source === 'user' || (!relation && !!item.attachment);
      const limit =
        relation?.maxHeightAdjustment ??
        (deliberateSupport ? Infinity : DEFAULT_SCENE_HEIGHT_ADJUSTMENT);
      const reference = heightReferences.get(id);
      const outsideReference =
        !!reference &&
        !!target &&
        Math.abs(restingRootHeight(item, target) - reference.y) > reference.maxDisplacement + EPS;
      if (
        target &&
        supportedFootprint(body(item), target) &&
        !locked.has(id) &&
        heightAdjustment <= limit + EPS &&
        !outsideReference
      ) {
        try {
          setHeight(item, target);
        } catch {
          // The issue inspector explains an out-of-range or unsupported shape.
        }
      } else if (
        target &&
        supportedFootprint(body(item), target) &&
        !locked.has(id) &&
        (outsideReference || (heightAdjustment > limit + EPS && !restingOn(body(item), target)))
      ) {
        budgetIssues.push({
          itemId: id,
          code: 'support',
          rootCause: 'height-budget',
          relatedItemId: target.id,
          message: `${item.name} needs a larger height adjustment. Confirm its support or adjust its height.`,
        });
      }
    }
    active.delete(id);
    done.add(id);
  }
  for (const item of items(result).filter((candidate) => changed.has(candidate.id))) place(item.id);
  // An existing explicit attachment carries its retained child as a rigid group.
  // The child never participates in the search for vacant positions.
  const carryFrom = options.carryFrom ?? base;
  for (const original of items(carryFrom)) {
    if (
      !changed.has(original.id) &&
      !locked.has(original.id) &&
      original.attachment &&
      changed.has(original.attachment.parentId) &&
      items(result).some(
        (candidate) =>
          candidate.id === original.id &&
          candidate.attachment?.parentId === original.attachment?.parentId,
      ) &&
      result.objects.some(
        (candidate) => candidate.id === original.attachment?.parentId && candidate.kind === 'desk',
      )
    ) {
      const child = find(result, original.id);
      const placement = rebaseAttachedPlacement(carryFrom, result, original);
      const carried = { ...child, placement };
      if (
        validPlacement(carried) &&
        getItemBounds(carried).min.y >= Math.min(0, getItemBounds(original).min.y) - EPS
      )
        child.placement = placement;
      // An impossible carry leaves the original valid record in place. The
      // inspector includes retained children and explains their missing support.
      else child.placement = { ...original.placement };
    }
  }
  const plannedRelations = [...planned].map(([itemId, surfaceId]) => ({ itemId, surfaceId }));
  const issues = getScenePlacementIssues(base, result, changed, [
    ...plannedRelations,
    ...explicitSupports,
  ]);
  return {
    draft: result,
    issues: [
      ...issues.filter(
        (issue) =>
          !(
            issue.rootCause === 'height' &&
            budgetIssues.some((budget) => budget.itemId === issue.itemId)
          ),
      ),
      ...budgetIssues,
    ],
  };
}

/** Arrange only proposal candidates. Retained user records are obstacles, never silently relocated. */
export function fitSceneProposal(
  base: Workspace,
  draft: Workspace,
  changedIds: Iterable<string>,
): Workspace {
  const result = structuredClone(draft);
  const changed = new Set(
    [...changedIds].filter((id) => items(result).some((item) => item.id === id)),
  );
  const retainedChildren = new Set<string>();
  for (const id of [...changed]) {
    const originalDesk = base.objects.find((item) => item.id === id && item.kind === 'desk');
    const proposedDesk = result.objects.find((item) => item.id === id && item.kind === 'desk');
    if (!originalDesk || !proposedDesk) continue;
    const explicitChildren = new Map(
      items(result)
        .filter((item) => changed.has(item.id))
        .map((item) => [item.id, structuredClone(item.placement)]),
    );
    // Only children still present in the draft participate in this spatial update.
    const retainedBase = {
      ...base,
      devices: base.devices.filter((item) => result.devices.some((other) => other.id === item.id)),
      objects: base.objects.filter((item) => result.objects.some((other) => other.id === item.id)),
    };
    transformChildren(retainedBase, result, id);
    for (const child of items(result).filter((item) => item.attachment?.parentId === id)) {
      if (explicitChildren.has(child.id)) child.placement = explicitChildren.get(child.id)!;
      else {
        changed.add(child.id);
        retainedChildren.add(child.id);
      }
    }
  }
  let working: Workspace = {
    ...structuredClone(result),
    devices: result.devices.filter((item) => !changed.has(item.id)),
    objects: result.objects.filter((item) => !changed.has(item.id)),
  };
  const ordered = items(result)
    .filter((item) => changed.has(item.id))
    .sort((a, b) => {
      const rank = (item: Item) =>
        item.kind === 'desk' ? 0 : solidSupportKinds.has(item.kind) || item.kind === 'mat' ? 1 : 2;
      return rank(a) - rank(b);
    });
  for (const original of ordered) {
    const item = structuredClone(original);
    if ('status' in item) working.devices.push(item);
    else working.objects.push(item);
    if (retainedChildren.has(item.id)) {
      const errors = validateSceneCollisions(working, base);
      if (errors.length)
        throw new Error(
          'The proposed desk would push an attached object into another object. Detach or move it first.',
        );
    } else {
      const beforePlacement = structuredClone(working);
      const previouslySaved = items(base).some((entry) => entry.id === item.id);
      // An existing object's intentional height is preserved when the proposal already fits.
      if (!previouslySaved || validateSceneCollisions(working, base).length)
        working = findFreePlacement(working, item.id, { allowFloorFallback: false });
      if (item.kind === 'desk') {
        const movedDesk = find(working, item.id);
        // Children not inserted yet must follow any extra placement adjustment of their parent.
        const pending = items(result).filter(
          (child) => retainedChildren.has(child.id) && child.attachment?.parentId === item.id,
        );
        if (pending.length) {
          const frameBefore = {
            ...beforePlacement,
            devices: [
              ...beforePlacement.devices,
              ...pending.filter((child): child is Device => 'status' in child),
            ],
            objects: [
              ...beforePlacement.objects,
              ...pending.filter((child): child is SceneObject => !('status' in child)),
            ],
          };
          const frameAfter = structuredClone(frameBefore);
          Object.assign(find(frameAfter, item.id), movedDesk);
          transformChildren(frameBefore, frameAfter, item.id);
          for (const child of pending) child.placement = find(frameAfter, child.id).placement;
        }
      }
    }
  }
  const placed = new Map(items(working).map((item) => [item.id, item]));
  result.devices = result.devices.map((item) => placed.get(item.id) as Device);
  result.objects = result.objects.map((item) => placed.get(item.id) as SceneObject);
  return result;
}

/** Check only newly introduced or worsened contacts relative to an optional old scene. */
export function validateSceneCollisions(workspace: Workspace, baseline?: Workspace): string[] {
  const all = items(workspace).map(body);
  const changed = new Set(all.map((b) => b.item.id));
  const initial = new Map(
    baseline
      ? collisionPairs(items(baseline).map(body), changed)
          .flatMap(([a, b]) => pairCollisions(a, b))
          .map((hit) => [hit.key, hit])
      : [],
  );
  const issues = new Set<string>();
  for (const b of all) {
    const original = baseline && items(baseline).find((item) => item.id === b.item.id);
    const allowedFloor = original ? Math.min(0, getItemBounds(original).min.y) : 0;
    if (b.bounds.min.y < allowedFloor - EPS) issues.add(`${b.item.name} goes through the floor.`);
    if (b.item.attachment) {
      const parent = workspace.objects.find((item) => item.id === b.item.attachment?.parentId);
      const target =
        parent && intendedSupport(workspace, b.item, new Map([[b.item.id, parent.id]]));
      const supported = !!target && supportedFootprint(b, target);
      if (!supported) {
        const oldParent = baseline?.objects.find((item) => item.id === b.item.attachment?.parentId);
        const unchanged =
          original &&
          oldParent &&
          parent &&
          JSON.stringify({
            placement: original.placement,
            visual: original.visual,
            parts: original.parts,
            shapeMode: original.shapeMode,
            attachment: original.attachment,
          }) ===
            JSON.stringify({
              placement: b.item.placement,
              visual: b.item.visual,
              parts: b.item.parts,
              shapeMode: b.item.shapeMode,
              attachment: b.item.attachment,
            }) &&
          JSON.stringify(oldParent) === JSON.stringify(parent);
        if (!unchanged) issues.add(`${b.item.name} must stay over its attached desk.`);
      }
    }
  }
  for (const [a, b] of collisionPairs(all, changed))
    if (pairCollisions(a, b).some((hit) => !allowedExisting(hit, initial)))
      issues.add(`${a.item.name} overlaps ${b.item.name}.`);
  return [...issues];
}

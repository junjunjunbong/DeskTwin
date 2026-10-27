import { getGeometryParts } from './geometry';
import type { Device, Placement, SceneObject, Workspace } from './workspace';

type Item = Device | SceneObject;
type V = { x: number; y: number; z: number };
export type Bounds = { min: V; max: V };
type Box = { center: V; edges: [V, V, V]; bounds: Bounds };
type Body = { item: Item; boxes: Box[]; bounds: Bounds };
const EPS = 0.00001;
const GAP = 0.001;
const REST_TOLERANCE = 0.005;
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

type Surface = { id: string; name: string; height: number; box: Box | null };
function surface(desk: SceneObject): Surface {
  const b = body(desk);
  const horizontal = b.boxes.filter((box) =>
    box.edges.some((edge) => Math.abs(edge.x) < EPS && Math.abs(edge.z) < EPS),
  );
  const top = horizontal.sort(
    (a, b) =>
      (b.bounds.max.x - b.bounds.min.x) * (b.bounds.max.z - b.bounds.min.z) -
      (a.bounds.max.x - a.bounds.min.x) * (a.bounds.max.z - a.bounds.min.z),
  )[0];
  if (!top)
    throw new Error(
      'This desk has no flat top. Add a horizontal box before placing objects on it.',
    );
  const nearbyTop = Math.max(
    ...b.boxes
      .filter((box) => box.bounds.max.y <= top.bounds.max.y + 0.06)
      .map((box) => box.bounds.max.y),
  );
  return { id: desk.id, name: desk.name, height: Math.max(top.bounds.max.y, nearbyTop), box: top };
}
function surfaces(w: Workspace): Surface[] {
  return [
    { id: 'floor', name: 'Floor', height: 0, box: null },
    ...w.objects
      .filter((o) => o.kind === 'desk')
      .flatMap((o) => {
        try {
          return [surface(o)];
        } catch {
          return [];
        }
      }),
  ];
}
export function getSurfaceTargets(w: Workspace, id: string): { id: string; name: string }[] {
  const item = find(w, id);
  return surfaces(w)
    .filter((s) => s.id !== item.id && (item.kind !== 'desk' || s.id === 'floor'))
    .map(({ id, name }) => ({ id, name }));
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
function containsXZ(box: Box, point: V): boolean {
  const edges = box.edges.filter((edge) => Math.abs(edge.y) < EPS);
  if (edges.length !== 2) return false;
  const [a, b] = edges;
  const p = sub(point, box.center);
  const det = a.x * b.z - a.z * b.x;
  if (Math.abs(det) < 1e-10) return false;
  const u = (p.x * b.z - p.z * b.x) / det;
  const v = (a.x * p.z - a.z * p.x) / det;
  return Math.abs(u) <= 1 + EPS && Math.abs(v) <= 1 + EPS;
}
function fits(item: Item, target: Surface): boolean {
  return fitsBody(body(item), target);
}
function fitsBody(b: Body, target: Surface): boolean {
  if (!target.box) return true;
  const contact = b.boxes.filter((box) => box.bounds.min.y <= b.bounds.min.y + 0.035);
  return contact.every((box) =>
    corners(box)
      .filter((p) => p.y <= b.bounds.min.y + 0.035)
      .every((p) => containsXZ(target.box!, p)),
  );
}
function setHeight(item: Item, target: Surface): void {
  item.placement.y += target.height + GAP - getItemBounds(item).min.y;
  if (target.id === 'floor' && item.placement.y > -0.051 && item.placement.y < 0)
    item.placement.y = 0;
  if (item.placement.y < -EPS || item.placement.y > 5.5)
    throw new Error('This shape cannot rest on that surface within the scene height limit.');
  item.placement.y = Math.max(0, item.placement.y);
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
  return childPlacement(from, to, item);
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
export type SpatialResult = { workspace: Workspace; blocked: boolean; reason: string };
/** Immutable placement solver used by live dragging and persisted commands. */
export function resolveSpatialEdit(
  before: Workspace,
  proposed: Workspace,
  id: string,
  options: SpatialOptions = {},
): SpatialResult {
  const candidate = structuredClone(proposed);
  const oldItem = find(before, id);
  const item = find(candidate, id);
  const changed = descendants(before, id);
  if (options.preserveSupport && item.placement.y === oldItem.placement.y && !options.snap) {
    const oldBody = body(oldItem);
    const resting = surfaces(before)
      .filter((target) => {
        const gap = oldBody.bounds.min.y - target.height;
        return (
          target.id !== id &&
          (item.kind !== 'desk' || target.id === 'floor') &&
          (!oldItem.attachment || target.id === oldItem.attachment.parentId) &&
          gap >= -EPS &&
          gap <= REST_TOLERANCE &&
          fitsBody(oldBody, target)
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
    const candidates = surfaces(candidate).filter(
      (s) => s.id !== id && (item.kind !== 'desk' || s.id === 'floor') && fits(item, s),
    );
    const attached = item.attachment
      ? candidates.find((s) => s.id === item.attachment?.parentId)
      : undefined;
    const nearby =
      attached ??
      candidates
        .filter((s) => Math.abs(s.height - bottom) < 0.18)
        .sort((a, b) => b.height - a.height)[0];
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
    const target = surfaces(candidate).find((s) => s.id === options.snap);
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
        if (!desk || !fits(b.item, surface(desk)))
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

/** Place deliberately on a floor/desk. This is an explicit relocation, not a physical animation. */
export function snapToSurface(workspace: Workspace, id: string, surfaceId: string): Workspace {
  const candidate = structuredClone(workspace);
  const item = find(candidate, id);
  const target = surfaces(candidate).find((s) => s.id === surfaceId && s.id !== id);
  if (!target || (item.kind === 'desk' && surfaceId !== 'floor'))
    throw new Error('Choose a valid floor or desk surface.');
  if (!fits(item, target)) {
    if (!target.box) throw new Error('This shape does not fit on the selected surface.');
    item.placement.x = target.box.center.x;
    item.placement.z = target.box.center.z;
  }
  if (!fits(item, target))
    throw new Error('This object is too large for that desk. Reduce its size first.');
  setHeight(item, target);
  if (item.attachment?.parentId !== surfaceId) item.attachment = null;
  const result = resolveSpatialEdit(workspace, candidate, id, { sweep: false });
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
export function findFreePlacement(workspace: Workspace, id: string): Workspace {
  const source = find(workspace, id);
  const sourceBody = body(source);
  const rest = items(workspace)
    .filter((item) => item.id !== id)
    .map(body);
  const possible = surfaces(workspace).filter(
    (s) =>
      s.id !== id &&
      ((source.kind !== 'desk' && source.kind !== 'chair') || s.id === 'floor') &&
      (!source.attachment || s.id === source.attachment.parentId),
  );
  if (!possible.length)
    throw new Error(
      'The attached desk is no longer available. Detach this object before placing it elsewhere.',
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
  let attempts = 0;
  for (const target of possible)
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
      if (!fitsBody(b, target)) continue;
      if (rest.some((other) => pairCollisions(b, other).length > 0)) continue;
      const next = structuredClone(workspace);
      Object.assign(find(next, id), candidate);
      return next;
    }
  throw new Error(
    'No clear resting position was found. Move another object or reduce this object’s size, then try again.',
  );
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
    .sort((a, b) => Number(b.kind === 'desk') - Number(a.kind === 'desk'));
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
        working = findFreePlacement(working, item.id);
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
      let supported = false;
      try {
        supported = !!parent && fitsBody(b, surface(parent));
      } catch {
        /* No flat support. */
      }
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

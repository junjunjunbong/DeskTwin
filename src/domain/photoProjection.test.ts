import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { getGeometryParts } from './geometry';
import {
  calibratePhotoCamera,
  estimatePhotoCamera,
  getPhotoDeskWorldCorners,
  getPhotoReferenceWorldCorners,
  projectPhotoItem,
  projectPhotoPoint,
  type PhotoCamera,
  type PhotoPoint,
  type PhotoReference,
} from './photoProjection';
import {
  createDemoWorkspace,
  createSceneObject,
  DeviceSchema,
  type Device,
  type SceneObject,
  type Workspace,
} from './workspace';

const Y_AXIS = new Vector3(0, 1, 0);
const names = ['backLeft', 'backRight', 'frontRight', 'frontLeft'] as const;
const v = (point: { x: number; y: number; z: number }) => new Vector3(point.x, point.y, point.z);
const radians = (degrees: number) => (degrees * Math.PI) / 180;

function workspace(): Workspace {
  const w = createDemoWorkspace();
  w.objects = [
    { ...createSceneObject('desk'), id: 'desk', placement: { x: 0, y: 0, z: 0, rotation: 0 } },
  ];
  w.devices = [];
  return w;
}

function camera(
  position = new Vector3(6, 8, 10),
  target = new Vector3(0, 2.4, 0),
  fov = 48,
  aspect = 1.6,
  roll = 0,
): PerspectiveCamera {
  const result = new PerspectiveCamera(fov, aspect, 0.01, 1000);
  result.position.copy(position);
  result.lookAt(target);
  result.rotateZ(roll);
  result.updateMatrixWorld(true);
  return result;
}

function independentProject(point: Vector3, view: PerspectiveCamera): PhotoPoint {
  const ndc = point.clone().project(view);
  return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
}

// These dimensions are independently specified from the actual tabletop template.
// Three's own matrices generate observations; no calibration/projector implementation is reused.
function independentDeskCorners(w: Workspace): Vector3[] {
  const desk = w.objects.find((item) => item.id === 'desk')!;
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) =>
    new Vector3(x * 3.71, 2.4835, z * 1.58)
      .multiply(v(desk.visual.scale))
      .applyAxisAngle(Y_AXIS, radians(desk.placement.rotation))
      .add(v(desk.placement)),
  );
}

function reference(w: Workspace, view: PerspectiveCamera): PhotoReference {
  const points = independentDeskCorners(w).map((point) => independentProject(point, view));
  return {
    objectId: 'desk',
    aspect: view.aspect,
    source: 'manual',
    corners: {
      backLeft: points[0],
      backRight: points[1],
      frontRight: points[2],
      frontLeft: points[3],
    },
  };
}

function independentScreenCorners(monitor: Device): Vector3[] {
  return [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([x, y]) =>
    new Vector3(x * 0.925, 0.95 + y * 0.55, 0.055)
      .multiply(v(monitor.visual.scale))
      .applyAxisAngle(Y_AXIS, radians(monitor.placement.rotation))
      .add(v(monitor.placement)),
  );
}

function viewParameters(view: PerspectiveCamera): PhotoCamera {
  const forward = view.getWorldDirection(new Vector3());
  const up = new Vector3(0, 1, 0).applyQuaternion(view.quaternion);
  return {
    position: { ...view.position },
    target: { ...view.position.clone().add(forward) },
    up: { ...up },
    fov: view.fov,
    aspect: view.aspect,
  };
}

function independentPartVertices(item: Device | SceneObject): Vector3[][] {
  return getGeometryParts(item).map((part) => {
    const rotation = part.rotation ?? { x: 0, y: 0, z: 0 };
    const vertices: Vector3[] = [];
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1])
          vertices.push(
            new Vector3((part.size.x * x) / 2, (part.size.y * y) / 2, (part.size.z * z) / 2)
              .applyEuler(
                new Euler(radians(rotation.x), radians(rotation.y), radians(rotation.z), 'XYZ'),
              )
              .add(v(part.position))
              .multiply(v(item.visual.scale))
              .applyAxisAngle(Y_AXIS, radians(item.placement.rotation))
              .add(v(item.placement)),
          );
    return vertices;
  });
}

describe('source photo perspective camera', () => {
  it.each([
    { position: new Vector3(6, 8, 10), fov: 48, aspect: 1.6, roll: 0 },
    { position: new Vector3(-5, 11, 9), fov: 58, aspect: 1, roll: 0.18 },
    { position: new Vector3(4, 9, -10), fov: 40, aspect: 1.8, roll: -0.1 },
    { position: new Vector3(3, 14, 8), fov: 50, aspect: 0.75, roll: 0 },
  ])(
    'recovers an independent perspective scene: $fov degrees, aspect $aspect',
    ({ position, fov, aspect, roll }) => {
      const w = workspace();
      const view = camera(position, new Vector3(0, 2.4, 0), fov, aspect, roll);
      const ref = reference(w, view);
      const before = structuredClone(w);
      const result = calibratePhotoCamera(w, ref);
      expect(result.error).toBeLessThan(1e-7);
      expect(result.camera.fov).toBeCloseTo(fov, 3);
      expect(v(result.camera.position).distanceTo(position)).toBeLessThan(0.0001);
      expect(result.warnings.join(' ')).toContain('not a metric measurement');
      for (const point of [new Vector3(0.5, 4, 0), new Vector3(-1, 2.5, 0.6)]) {
        const projected = projectPhotoPoint(point, result.camera)!;
        const expected = independentProject(point, view);
        expect(projected.x).toBeCloseTo(expected.x, 6);
        expect(projected.y).toBeCloseTo(expected.y, 6);
      }
      expect(w).toEqual(before);
      expect(calibratePhotoCamera(w, ref)).toEqual(result);
    },
  );

  it('uses the actual scaled and yawed desk plane, separately from its camera', () => {
    const w = workspace();
    const desk = w.objects[0];
    desk.placement = { x: 1.2, y: 0.3, z: -0.4, rotation: 34 };
    desk.visual.scale = { x: 1.15, y: 0.85, z: 0.7 };
    const view = camera(new Vector3(7, 9, 12), new Vector3(1.2, 2.4, -0.4), 52, 1.5);
    const ref = reference(w, view);
    getPhotoDeskWorldCorners(w, ref).forEach((point, i) =>
      expect(v(point).distanceTo(independentDeskCorners(w)[i])).toBeLessThan(1e-10),
    );
    const result = calibratePhotoCamera(w, ref);
    expect(result.error).toBeLessThan(1e-7);
    expect(result.camera.fov).toBeCloseTo(52, 3);
    expect(v(result.camera.position).distanceTo(view.position)).toBeLessThan(0.0001);
  });

  it.each([new Vector3(2.1, 1.2, 4), new Vector3(-1.6, -0.8, 4.5)])(
    'uses a visible monitor bezel when the desk corners are outside the photo',
    (offset) => {
      const w = workspace();
      const monitor = DeviceSchema.parse({
        id: 'monitor-reference',
        kind: 'monitor',
        name: 'Monitor',
        model: '',
        source: 'photo-inferred',
        status: 'unknown',
        statusNote: '',
        placement: { x: 0, y: 2.49, z: -0.6, rotation: 15 },
      });
      monitor.visual.scale = { x: 1.2, y: 1.05, z: 0.8 };
      w.devices.push(monitor);
      const center = new Vector3(0, 0.95, 0.055)
        .multiply(v(monitor.visual.scale))
        .applyAxisAngle(Y_AXIS, radians(15))
        .add(v(monitor.placement));
      const view = camera(center.clone().add(offset), center, 42, 1.6, 0.09);
      const points = independentScreenCorners(monitor).map((point) =>
        independentProject(point, view),
      );
      expect(
        points.every((point) => point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1),
      ).toBe(true);
      const deskPoints = independentDeskCorners(w).map((point) => independentProject(point, view));
      expect(
        deskPoints.some((point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1),
      ).toBe(true);
      const ref: PhotoReference = {
        objectId: monitor.id,
        surface: 'monitor-screen',
        aspect: view.aspect,
        source: 'manual',
        corners: {
          backLeft: points[0],
          backRight: points[1],
          frontRight: points[2],
          frontLeft: points[3],
        },
      };
      getPhotoReferenceWorldCorners(w, ref).forEach((point, i) =>
        expect(v(point).distanceTo(independentScreenCorners(monitor)[i])).toBeLessThan(1e-10),
      );
      const fit = calibratePhotoCamera(w, ref);
      expect(fit.error).toBeLessThan(1e-7);
      expect(fit.camera.fov).toBeCloseTo(view.fov, 3);
      expect(v(fit.camera.position).distanceTo(view.position)).toBeLessThan(0.0001);
      const probe = new Vector3(0.5, 2.5, 0.8);
      const actual = projectPhotoPoint(probe, fit.camera)!;
      const expected = independentProject(probe, view);
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
    },
  );

  it('requires a template monitor for monitor-screen calibration', () => {
    const w = workspace();
    const ref = { ...reference(w, camera()), surface: 'monitor-screen' as const };
    expect(() => calibratePhotoCamera(w, ref)).toThrow(/Select a monitor/);
    const monitor = DeviceSchema.parse({
      id: 'monitor',
      kind: 'monitor',
      name: 'Monitor',
      model: '',
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
      placement: { x: 0, y: 2.5, z: 0, rotation: 0 },
      shapeMode: 'custom',
      parts: [{ position: { x: 0, y: 0.5, z: 0 }, size: { x: 2, y: 1, z: 0.1 }, color: '#888888' }],
    });
    w.devices.push(monitor);
    expect(() => calibratePhotoCamera(w, { ...ref, objectId: monitor.id })).toThrow(
      /rectangular monitor template/,
    );
  });

  it.each([0, 0.025])(
    'uses an explicit FOV prior for an otherwise unidentifiable frontal screen (offset %s)',
    (offset) => {
      const w = workspace();
      const monitor = DeviceSchema.parse({
        id: 'screen-reference',
        kind: 'monitor',
        name: 'Monitor',
        model: '',
        source: 'photo-inferred',
        status: 'unknown',
        statusNote: '',
        placement: { x: 0, y: 2.5, z: -0.6, rotation: 0 },
      });
      w.devices.push(monitor);
      const center = new Vector3(0, 3.45, -0.545);
      const view = camera(center.clone().add(new Vector3(offset, 0, 4)), center, 42, 1.6, 0.04);
      const points = independentScreenCorners(monitor).map((point) =>
        independentProject(point, view),
      );
      const ref: PhotoReference = {
        objectId: monitor.id,
        surface: 'monitor-screen',
        aspect: view.aspect,
        source: 'manual',
        corners: {
          backLeft: points[0],
          backRight: points[1],
          frontRight: points[2],
          frontLeft: points[3],
        },
      };
      expect(() => calibratePhotoCamera(w, ref)).toThrow(/too little perspective/);
      const fit = calibratePhotoCamera(w, { ...ref, fov: 42 });
      expect(fit.error).toBeLessThan(1e-8);
      expect(fit.camera.fov).toBeCloseTo(42, 12);
      expect(v(fit.camera.position).distanceTo(view.position)).toBeLessThan(1e-7);
      expect(fit.warnings.join(' ')).toContain('user-entered 42 degree vertical FOV is held fixed');
      const probe = new Vector3(0.6, 2.6, 0.9);
      const actual = projectPhotoPoint(probe, fit.camera)!;
      const expected = independentProject(probe, view);
      expect(actual.x).toBeCloseTo(expected.x, 8);
      expect(actual.y).toBeCloseTo(expected.y, 8);

      // Nonzero residual forces pose refinement; the supplied intrinsic stays fixed.
      ref.corners.backLeft.x += 0.0003;
      ref.corners.frontRight.y -= 0.0002;
      const noisy = calibratePhotoCamera(w, { ...ref, fov: 42 });
      expect(noisy.error).toBeGreaterThan(0.000001);
      expect(noisy.error).toBeLessThan(0.001);
      expect(noisy.camera.fov).toBeCloseTo(42, 12);
    },
  );

  it.each([NaN, Infinity, -1, 0, 11.99, 110.01])('rejects invalid user FOV prior %s', (fov) => {
    const w = workspace();
    expect(() => calibratePhotoCamera(w, { ...reference(w, camera()), fov })).toThrow(
      /vertical field of view from 12 to 110/,
    );
  });

  it.each([12, 110])('accepts the inclusive user FOV prior boundary %s', (fov) => {
    const w = workspace();
    const view = camera(new Vector3(0, 15, 0), new Vector3(0, 2.4835, 0), 50);
    const fit = calibratePhotoCamera(w, { ...reference(w, view), fov });
    expect(fit.camera.fov).toBeCloseTo(fov, 10);
    expect(fit.warnings.join(' ')).toContain('user-entered');
  });

  it('fits small corner-mark noise with a bounded, reported residual', () => {
    const w = workspace();
    const ref = reference(w, camera());
    const noise = [
      [0.001, -0.0005],
      [-0.0004, 0.0008],
      [0.0006, -0.0002],
      [-0.0005, 0.0002],
    ];
    names.forEach((name, i) => {
      ref.corners[name].x += noise[i][0];
      ref.corners[name].y += noise[i][1];
    });
    const fit = calibratePhotoCamera(w, ref);
    expect(fit.error).toBeLessThan(0.002);
    expect(fit.error).toBeGreaterThan(0.00001);
    expect(fit.camera.position.y).toBeGreaterThan(2.4835);
  });

  it.each(['out-of-frame', 'duplicate', 'crossed', 'inverted', 'non-finite', 'collapsed'])(
    'rejects %s observations without inventing a camera',
    (kind) => {
      const w = workspace();
      const ref = reference(w, camera());
      if (kind === 'out-of-frame') ref.corners.backLeft.x = -0.01;
      if (kind === 'duplicate') ref.corners.frontRight = { ...ref.corners.frontLeft };
      if (kind === 'crossed')
        [ref.corners.frontRight, ref.corners.backRight] = [
          ref.corners.backRight,
          ref.corners.frontRight,
        ];
      if (kind === 'inverted')
        [ref.corners.frontLeft, ref.corners.backRight] = [
          ref.corners.backRight,
          ref.corners.frontLeft,
        ];
      if (kind === 'non-finite') ref.corners.backLeft.y = NaN;
      if (kind === 'collapsed')
        names.forEach((name, i) => {
          ref.corners[name] = { x: 0.5 + i * 0.001, y: 0.5 };
        });
      expect(() => calibratePhotoCamera(w, ref)).toThrow(/corners|convex/);
    },
  );

  it('rejects an affine overhead view whose camera height and focal length are unidentifiable', () => {
    const w = workspace();
    const ref = reference(w, camera(new Vector3(0, 15, 0), new Vector3(0, 2.4835, 0), 50));
    expect(() => calibratePhotoCamera(w, ref)).toThrow(/too little perspective/);
  });

  it('rejects missing, custom/tilted or invalid desk priors and bad image dimensions', () => {
    const w = workspace();
    const ref = reference(w, camera());
    expect(() => calibratePhotoCamera(w, { ...ref, objectId: 'missing' })).toThrow(/Select a desk/);
    expect(() => calibratePhotoCamera(w, { ...ref, aspect: 0 })).toThrow(/aspect ratio/);
    w.objects[0].shapeMode = 'custom';
    w.objects[0].parts = [
      {
        position: { x: 0, y: 2.4, z: 0 },
        size: { x: 7, y: 0.2, z: 3 },
        color: '#888888',
        rotation: { x: 15, y: 0, z: 0 },
      },
    ];
    expect(() => calibratePhotoCamera(w, ref)).toThrow(/level rectangular template/);
    w.objects[0].shapeMode = 'template';
    w.objects[0].visual.scale.x = 0;
    expect(() => calibratePhotoCamera(w, ref)).toThrow(/reference dimensions/);
  });

  it('rejects a convex quadrilateral inconsistent with the rectangular desk prior', () => {
    const w = workspace();
    const ref: PhotoReference = {
      objectId: 'desk',
      source: 'manual',
      aspect: 1.5,
      corners: {
        backLeft: { x: 0.1, y: 0.15 },
        backRight: { x: 0.9, y: 0.35 },
        frontRight: { x: 0.6, y: 0.8 },
        frontLeft: { x: 0.4, y: 0.9 },
      },
    };
    expect(() => calibratePhotoCamera(w, ref)).toThrow(/do not fit|cannot see/);
  });
});

describe('source photo geometry guides', () => {
  it('matches independent Three projection and rejects points behind or invalid cameras', () => {
    const view = camera();
    const parameters = viewParameters(view);
    const point = new Vector3(1, 3, -0.5);
    const expected = independentProject(point, view);
    expect(projectPhotoPoint(point, parameters)!.x).toBeCloseTo(expected.x, 12);
    expect(projectPhotoPoint(point, parameters)!.y).toBeCloseTo(expected.y, 12);
    expect(
      projectPhotoPoint(
        view.position.clone().sub(view.getWorldDirection(new Vector3())),
        parameters,
      ),
    ).toBeNull();
    expect(projectPhotoPoint(point, { ...parameters, target: parameters.position })).toBeNull();
    expect(projectPhotoPoint(point, { ...parameters, up: { x: 0, y: 0, z: 0 } })).toBeNull();
    expect(projectPhotoPoint({ x: Infinity, y: 0, z: 0 }, parameters)).toBeNull();
  });

  it.each(['monitor', 'laptop'] as const)(
    'projects actual %s parts and its base contact, not a whole-item box',
    (kind) => {
      const item = DeviceSchema.parse({
        id: kind,
        kind,
        name: kind,
        model: '',
        source: 'photo-inferred',
        status: 'unknown',
        statusNote: '',
        placement: { x: 0.2, y: 2.5, z: 0, rotation: 27 },
      });
      item.visual.scale = { x: 1.3, y: 0.8, z: 0.7 };
      const view = camera();
      const guide = projectPhotoItem(item, viewParameters(view))!;
      const expected = independentPartVertices(item)
        .flat()
        .map((point) => independentProject(point, view));
      expect(guide.polygons).toHaveLength(getGeometryParts(item).length);
      expect(guide.region.x).toBeCloseTo(Math.min(...expected.map((point) => point.x)), 12);
      expect(guide.region.y).toBeCloseTo(Math.min(...expected.map((point) => point.y)), 12);
      expect(guide.region.width).toBeCloseTo(
        Math.max(...expected.map((point) => point.x)) - guide.region.x,
        12,
      );
      expect(guide.region.height).toBeCloseTo(
        Math.max(...expected.map((point) => point.y)) - guide.region.y,
        12,
      );
      const baseY = kind === 'monitor' ? 0.0025 : 0.0075;
      const contact = independentProject(
        new Vector3(0, baseY * item.visual.scale.y, 0).add(v(item.placement)),
        view,
      );
      expect(guide.contact!.x).toBeCloseTo(contact.x, 12);
      expect(guide.contact!.y).toBeCloseTo(contact.y, 12);
      // Laptop screen pitch is included: at least one projected part has a non-axis-aligned edge.
      expect(guide.polygons.every((polygon) => polygon.length >= 3)).toBe(true);
    },
  );

  it('preserves custom part XYZ rotation before nonuniform scale and item yaw', () => {
    const item: SceneObject = {
      ...createSceneObject('generic'),
      shapeMode: 'custom',
      placement: { x: 0.3, y: 2.5, z: -0.2, rotation: -31 },
      parts: [
        {
          position: { x: 0.2, y: 0.5, z: -0.1 },
          size: { x: 1.1, y: 0.4, z: 0.7 },
          rotation: { x: 17, y: -23, z: 36 },
          color: '#888888',
        },
      ],
    };
    item.visual.scale = { x: 1.7, y: 0.6, z: 1.2 };
    const view = camera();
    const guide = projectPhotoItem(item, viewParameters(view))!;
    const vertices = independentPartVertices(item).flat();
    const expected = vertices.map((point) => independentProject(point, view));
    expect(guide.region.x).toBeCloseTo(Math.min(...expected.map((point) => point.x)), 12);
    expect(guide.region.y).toBeCloseTo(Math.min(...expected.map((point) => point.y)), 12);
    expect(guide.region.width).toBeCloseTo(
      Math.max(...expected.map((point) => point.x)) - guide.region.x,
      12,
    );
    expect(guide.region.height).toBeCloseTo(
      Math.max(...expected.map((point) => point.y)) - guide.region.y,
      12,
    );
    for (const point of guide.polygons[0])
      expect(
        expected.some(
          (candidate) => Math.hypot(point.x - candidate.x, point.y - candidate.y) < 1e-10,
        ),
      ).toBe(true);
    const bottom = vertices.filter(
      (point) => point.y <= Math.min(...vertices.map((entry) => entry.y)) + 0.035,
    );
    const contact = independentProject(
      bottom.reduce((sum, point) => sum.add(point), new Vector3()).divideScalar(bottom.length),
      view,
    );
    expect(guide.contact!.x).toBeCloseTo(contact.x, 12);
    expect(guide.contact!.y).toBeCloseTo(contact.y, 12);
  });

  it('uses support contact patches for stands instead of their elevated platform', () => {
    const item = createSceneObject('laptop-stand');
    item.placement = { x: 0.2, y: 2.5, z: -0.1, rotation: 40 };
    const view = camera();
    const guide = projectPhotoItem(item, viewParameters(view))!;
    const expected = independentProject(v(item.placement), view);
    expect(guide.contact!.x).toBeCloseTo(expected.x, 12);
    expect(guide.contact!.y).toBeCloseTo(expected.y, 12);
  });

  it('clips partially visible parts, and omits fully off-frame or camera-plane-crossing items', () => {
    const item: SceneObject = {
      ...createSceneObject('generic'),
      shapeMode: 'custom',
      placement: { x: 2.8, y: 0, z: 0, rotation: 0 },
      parts: [{ position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 1, z: 1 }, color: '#888888' }],
    };
    const view = camera(new Vector3(0, 0, 5), new Vector3(0, 0, 0), 50, 1);
    const parameters = viewParameters(view);
    const guide = projectPhotoItem(item, parameters)!;
    expect(guide.region.x + guide.region.width).toBeCloseTo(1, 12);
    const fullPoints = independentPartVertices(item)
      .flat()
      .map((point) => independentProject(point, view));
    expect(guide.unclippedRegion.x).toBeCloseTo(
      Math.min(...fullPoints.map((point) => point.x)),
      12,
    );
    expect(guide.unclippedRegion.width).toBeCloseTo(
      Math.max(...fullPoints.map((point) => point.x)) - guide.unclippedRegion.x,
      12,
    );
    expect(guide.unclippedRegion.x + guide.unclippedRegion.width).toBeGreaterThan(1.4);
    expect(guide.unclippedRegion.width).toBeGreaterThan(guide.region.width);
    expect(
      guide.polygons
        .flat()
        .every((point) => point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1),
    ).toBe(true);
    expect(guide.contact).toBeNull();
    item.placement.x = 20;
    expect(projectPhotoItem(item, parameters)).toBeNull();
    item.placement.x = 0;
    item.placement.z = 5;
    expect(projectPhotoItem(item, parameters)).toBeNull();
    item.placement.z = 8;
    expect(projectPhotoItem(item, parameters)).toBeNull();
    item.placement.z = 0;
    item.visual.scale.x = -1;
    expect(projectPhotoItem(item, parameters)).toBeNull();
  });
});

function automaticFixture() {
  const w = workspace();
  const device = (
    id: string,
    kind: 'monitor' | 'laptop' | 'keyboard' | 'desktop',
    x: number,
    y: number,
    z: number,
  ) =>
    DeviceSchema.parse({
      id,
      kind,
      name: id,
      model: '',
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
      placement: { x, y, z, rotation: 0 },
    });
  w.devices = [
    device('view-monitor', 'monitor', -1.4, 2.49, -0.8),
    device('view-laptop', 'laptop', 0.9, 2.49, 0.2),
    device('view-keyboard', 'keyboard', -0.7, 2.49, 0.9),
    device('view-tower', 'desktop', 2.7, 0.01, 0),
  ];
  w.objects.push(
    {
      ...createSceneObject('plant'),
      id: 'view-plant',
      placement: { x: -2.5, y: 2.49, z: 0.4, rotation: 0 },
    },
    {
      ...createSceneObject('mug'),
      id: 'view-mug',
      placement: { x: 2, y: 2.49, z: -0.4, rotation: 0 },
    },
  );
  const view = camera(new Vector3(4, 7, 10), new Vector3(0, 2.3, 0), 47, 1.6, 0.035);
  const observations = [...w.objects, ...w.devices]
    .filter((item) => item.kind !== 'desk')
    .map((item) => {
      const points = independentPartVertices(item)
        .flat()
        .map((point) => independentProject(point, view));
      const x = Math.min(...points.map((point) => point.x));
      const y = Math.min(...points.map((point) => point.y));
      return {
        sceneId: item.id,
        region: {
          x,
          y,
          width: Math.max(...points.map((point) => point.x)) - x,
          height: Math.max(...points.map((point) => point.y)) - y,
        },
      };
    });
  return { w, view, observations };
}

function regionCenterError(
  w: Workspace,
  observations: ReturnType<typeof automaticFixture>['observations'],
  view: PhotoCamera,
) {
  const errors = observations.map(({ sceneId, region }) => {
    const item = [...w.objects, ...w.devices].find((entry) => entry.id === sceneId)!;
    const actual = projectPhotoItem(item, view)?.unclippedRegion;
    return actual
      ? (actual.x + actual.width / 2 - region.x - region.width / 2) ** 2 +
          (actual.y + actual.height / 2 - region.y - region.height / 2) ** 2
      : 1;
  });
  return Math.sqrt(errors.reduce((sum, value) => sum + value, 0) / errors.length);
}

describe('automatic source view from object image regions', () => {
  it('lowers independently projected region-center error despite perturbed template seeds', () => {
    const { w, view, observations } = automaticFixture();
    [...w.objects, ...w.devices]
      .filter((item) => item.kind !== 'desk')
      .forEach((item, i) => {
        item.placement.x += i % 2 ? 0.11 : -0.08;
        item.placement.z += i % 3 ? -0.1 : 0.09;
        item.placement.y += i % 2 ? -0.025 : 0.02;
        item.visual.scale.x *= i % 2 ? 1.04 : 0.96;
        item.visual.scale.y *= i % 2 ? 0.95 : 1.03;
      });
    const before = structuredClone({ w, observations });
    const generic = viewParameters(
      camera(new Vector3(9, 10, 12), new Vector3(0, 2.4, 0), 40, view.aspect),
    );
    const start = performance.now();
    const result = estimatePhotoCamera(w, observations, view.aspect);
    expect(performance.now() - start).toBeLessThan(1000);
    const beforeError = regionCenterError(w, observations, generic);
    const afterError = regionCenterError(w, observations, result.camera);
    expect(afterError).toBeLessThan(beforeError * 0.45);
    expect(afterError).toBeLessThan(0.025);
    expect(result.error).toBeLessThan(0.025);
    expect(result.camera.fov).toBeGreaterThanOrEqual(20);
    expect(result.camera.fov).toBeLessThanOrEqual(90);
    expect(result.camera.position.y).toBeGreaterThan(1);
    expect(result.camera.position.z).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toContain('inferred automatically');
    expect(result.warnings.join(' ')).toContain('not camera calibration');
    expect(estimatePhotoCamera(w, observations, view.aspect)).toEqual(result);
    expect({ w, observations }).toEqual(before);
  });

  it('keeps a consistent estimate when one region center is moderately wrong', () => {
    const { w, view, observations } = automaticFixture();
    const baseline = estimatePhotoCamera(w, observations, view.aspect);
    observations[0].region.x += 0.16;
    const result = estimatePhotoCamera(w, observations, view.aspect);
    expect(result.error).toBeLessThan(0.09);
    expect(regionCenterError(w, observations.slice(1), result.camera)).toBeLessThan(0.05);
    expect(v(result.camera.position).distanceTo(v(baseline.camera.position))).toBeLessThan(8);
  });

  it('rejects too few, duplicated, unspread or invalid observations', () => {
    const { w, view, observations } = automaticFixture();
    expect(() => estimatePhotoCamera(w, observations.slice(0, 3), view.aspect)).toThrow(
      /4-128 distinct/,
    );
    expect(() =>
      estimatePhotoCamera(
        w,
        [observations[0], observations[0], ...observations.slice(2)],
        view.aspect,
      ),
    ).toThrow(/distinct objects/);
    expect(() =>
      estimatePhotoCamera(
        w,
        observations.map((entry) => ({
          ...entry,
          region: { x: 0.4, y: 0.4, width: 0.1, height: 0.1 },
        })),
        view.aspect,
      ),
    ).toThrow(/too little independent/);
    expect(() => estimatePhotoCamera(w, observations, NaN)).toThrow(/aspect ratio/);
    const invalid = structuredClone(observations);
    invalid[0].region.width = 0;
    expect(() => estimatePhotoCamera(w, invalid, view.aspect)).toThrow(/finite image regions/);
    invalid[0].region.width = Infinity;
    expect(() => estimatePhotoCamera(w, invalid, view.aspect)).toThrow(/finite image regions/);
    const missing = structuredClone(observations);
    missing[0].sceneId = 'missing';
    expect(() => estimatePhotoCamera(w, missing, view.aspect)).toThrow(
      /missing from the current preview/,
    );
  });

  it('rejects coincident world centers even when supplied image regions differ', () => {
    const { w, observations, view } = automaticFixture();
    w.devices = [];
    w.objects = observations.map((entry) => ({
      ...createSceneObject('generic'),
      id: entry.sceneId,
      placement: { x: 0, y: 2.5, z: 0, rotation: 0 },
    }));
    expect(() => estimatePhotoCamera(w, observations, view.aspect)).toThrow(
      /too little independent/,
    );
  });

  it('rejects spurious mirrored correspondences inconsistent with a front-facing view', () => {
    const { w, observations, view } = automaticFixture();
    const mirrored = observations.map((entry) => ({
      ...entry,
      region: { ...entry.region, x: 1 - entry.region.x - entry.region.width },
    }));
    expect(() => estimatePhotoCamera(w, mirrored, view.aspect)).toThrow(
      /disagree too strongly|consistent front-facing/,
    );
  });
});

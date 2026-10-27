import { describe, expect, it } from 'vitest';
import legacyFixture from '../../tests/fixtures/workspace-v1.json';
import {
  applyCommand,
  createDemoWorkspace,
  createSceneObject,
  parseWorkspace,
  WorkspaceSchema,
  type Workspace,
} from './workspace';
import {
  applySceneDraft,
  buildSceneDraft,
  SceneProposalSchema,
  type SceneProposal,
} from './sceneProposal';

const proposal = (): SceneProposal => ({
  message: 'An editable visual estimate. Hidden wiring and operating status are not inferred.',
  objects: [
    {
      id: 'observed-monitor',
      deviceId: null,
      kind: 'monitor',
      name: 'Monitor from photo',
      placement: { x: 1, y: 2.51, z: -0.6, rotation: -5 },
      scale: { x: 1.2, y: 1, z: 1 },
      color: '#304050',
      parts: [],
      note: 'The screen appears dark gray; its exact dimensions are uncertain.',
    },
    {
      id: 'unknown-accessory',
      deviceId: null,
      kind: 'generic',
      name: 'Small desk accessory',
      placement: { x: 2, y: 2.51, z: 0.5, rotation: 15 },
      scale: { x: 1, y: 1, z: 1 },
      color: '#887766',
      parts: [
        { position: { x: 0, y: 0.2, z: 0 }, size: { x: 0.4, y: 0.4, z: 0.3 }, color: '#887766' },
      ],
      note: 'Approximation of an unsupported object; adjust it before applying.',
    },
  ],
});

function legacy(): Workspace {
  return parseWorkspace(structuredClone(legacyFixture));
}

describe('v1 compatibility and bounded scene data', () => {
  it('migrates a literal previously saved v1 document without changing facts or the input', () => {
    const input = structuredClone(legacyFixture);
    const before = JSON.stringify(input);
    const migrated = parseWorkspace(input);
    expect(migrated.schemaVersion).toBe(2);
    expect(JSON.stringify(input)).toBe(before);
    expect(migrated.name).toBe(input.name);
    expect(migrated.connections).toEqual(input.connections);
    expect(migrated.history).toEqual(input.history);
    expect(migrated.appearance).toEqual(input.appearance);
    for (const [index, device] of migrated.devices.entries()) {
      const original = input.devices[index];
      expect(device).toMatchObject(original);
      expect(device.placement.y).toBe(2.51);
      expect(device.visual.source).toBe(original.source);
      expect(device.visual.scale).toEqual({ x: 1, y: 1, z: 1 });
    }
    expect(migrated.objects.some((object) => object.kind === 'desk')).toBe(true);
    expect(migrated.objects.some((object) => object.kind === 'chair')).toBe(true);
    expect(migrated.objects.every((object) => object.visual.source === 'demo')).toBe(true);
  });

  it('still rejects broken v1 topology and unsupported versions', () => {
    const broken = structuredClone(legacyFixture);
    broken.connections[0].to = 'missing';
    expect(() => parseWorkspace(broken)).toThrow();
    expect(() => parseWorkspace({ ...legacyFixture, schemaVersion: 99 })).toThrow();
  });

  it('round trips all visual fields, parts, evidence and reports through JSON', () => {
    let w = legacy();
    const object = createSceneObject('generic');
    object.placement = { x: -1.25, y: 0.4, z: 2.3, rotation: -45 };
    object.visual = {
      color: '#123abc',
      scale: { x: 0.4, y: 1.2, z: 2 },
      source: 'photo-inferred',
      note: 'Approximate box assembly.',
    };
    object.parts = proposal().objects[1].parts;
    w = applyCommand(w, { type: 'add-object', object });
    w = applyCommand(w, {
      type: 'update-device',
      id: 'my-monitor',
      patch: { placement: { x: 2, z: 1, rotation: 20 } },
    });
    const decoded = parseWorkspace(JSON.parse(JSON.stringify(w)));
    expect(decoded).toEqual(w);
    expect(decoded.devices[1].status).toBe('reported-issue');
    expect(decoded.devices[1].source).toBe('photo-inferred');
    expect(decoded.devices[1].visual.source).toBe('user-reported');
  });

  it('rejects duplicate object/device IDs, unbounded transforms, parts and executable fields', () => {
    const w = createDemoWorkspace();
    w.objects[0].id = w.devices[0].id;
    expect(() => WorkspaceSchema.parse(w)).toThrow();
    const visual = createSceneObject('generic');
    for (const value of [Infinity, NaN, -1, 10]) {
      const changed = structuredClone(visual);
      changed.visual.scale.x = value;
      expect(() => applyCommand(legacy(), { type: 'add-object', object: changed })).toThrow();
    }
    const code = { ...visual, code: 'alert(1)' };
    expect(() => WorkspaceSchema.parse({ ...legacy(), objects: [code] })).toThrow();
    const parts = Array.from({ length: 17 }, () => proposal().objects[1].parts[0]);
    expect(() => WorkspaceSchema.parse({ ...legacy(), objects: [{ ...visual, parts }] })).toThrow();
  });

  it('supports furniture and generic edits through the same validated command path', () => {
    const base = createDemoWorkspace();
    const desk = base.objects.find((object) => object.kind === 'desk')!;
    const moved = applyCommand(base, {
      type: 'update-object',
      id: desk.id,
      patch: {
        placement: { ...desk.placement, x: 0.5, rotation: 10 },
        visual: { ...desk.visual, color: '#667788', scale: { x: 0.8, y: 1, z: 0.9 } },
      },
    });
    expect(moved.objects.find((object) => object.id === desk.id)?.visual.source).toBe(
      'user-reported',
    );
    expect(base.objects.find((object) => object.id === desk.id)?.visual.color).toBeNull();
    const removed = applyCommand(moved, { type: 'remove-object', id: desk.id });
    expect(removed.objects.some((object) => object.id === desk.id)).toBe(false);
    expect(removed.connections).toEqual(base.connections);
  });
});

describe('photo scene draft isolation and evidence', () => {
  it('constructs an isolated draft and replaces only disposable sample objects', () => {
    const base = createDemoWorkspace();
    const before = JSON.stringify(base);
    const draft = buildSceneDraft(base, proposal());
    expect(JSON.stringify(base)).toBe(before);
    expect(draft.devices).toHaveLength(1);
    expect(draft.devices[0]).toMatchObject({
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
    });
    expect(draft.connections).toEqual([]);
    expect(draft.objects).toHaveLength(1);
    expect(draft.objects[0].kind).toBe('generic');
    expect(draft.objects[0].visual.source).toBe('photo-inferred');
    expect(draft.history).toEqual(base.history);
  });

  it('matches only real existing device IDs and preserves names, reports and user connections', () => {
    const base = legacy();
    const input = proposal();
    input.objects[0].deviceId = 'my-monitor';
    const original = structuredClone(base);
    const draft = buildSceneDraft(base, input);
    expect(draft.devices).toHaveLength(2);
    expect(draft.devices[1]).toMatchObject({
      name: 'Office monitor',
      source: 'photo-inferred',
      status: 'reported-issue',
      statusNote: base.devices[1].statusNote,
    });
    expect(draft.devices[1].placement).toEqual(input.objects[0].placement);
    expect(draft.connections).toEqual(base.connections);
    expect(base.appearance.decor).toBe(false);
    expect(draft.appearance).toEqual({ ...base.appearance, decor: true });
    expect(base).toEqual(original);
    for (const ref of ['missing', 'laptop']) {
      const invalid = proposal();
      invalid.objects[0].deviceId = ref;
      expect(() => buildSceneDraft(createDemoWorkspace(), invalid)).toThrow();
    }
    const mismatched = proposal();
    mismatched.objects[0].deviceId = 'work-laptop';
    expect(() => buildSceneDraft(base, mismatched)).toThrow();
  });

  it('keeps user reports attached to original example IDs', () => {
    let base = createDemoWorkspace();
    base = applyCommand(base, {
      type: 'connect',
      connection: { ...base.connections[0], source: 'user-reported' },
    });
    base = applyCommand(base, {
      type: 'update-device',
      id: 'monitor-right',
      patch: { status: 'reported-working' },
    });
    const draft = buildSceneDraft(base, proposal());
    expect(draft.devices.map((device) => device.id)).toEqual(
      expect.arrayContaining(['laptop', 'dock', 'monitor-right']),
    );
    expect(draft.connections).toContainEqual(
      base.connections.find((connection) => connection.source === 'user-reported'),
    );
    expect(draft.devices.find((device) => device.id === 'monitor-right')?.status).toBe(
      'reported-working',
    );
  });

  it('rejects repeated references and any model connection, status or code fields', () => {
    const duplicate = proposal();
    duplicate.objects.push(duplicate.objects[0]);
    expect(() => SceneProposalSchema.parse(duplicate)).toThrow();
    for (const injected of [
      { status: 'reported-working' },
      { source: 'user-reported' },
      { code: 'run()' },
      { connections: [] },
    ]) {
      const invalid = { ...proposal(), objects: [{ ...proposal().objects[0], ...injected }] };
      expect(() => SceneProposalSchema.parse(invalid)).toThrow();
    }
    expect(() => SceneProposalSchema.parse({ ...proposal(), connections: [] })).toThrow();
    const nonGenericParts = proposal();
    nonGenericParts.objects[0].parts = proposal().objects[1].parts;
    expect(() => SceneProposalSchema.parse(nonGenericParts)).toThrow();
  });

  it('uses collision-free IDs and enforces retained plus proposed capacity', () => {
    const base = legacy();
    base.objects.push({ ...createSceneObject('generic'), id: 'photo-unknown-accessory' });
    const draft = buildSceneDraft(base, proposal());
    expect(new Set([...draft.devices, ...draft.objects].map((object) => object.id)).size).toBe(
      draft.devices.length + draft.objects.length,
    );
    const full = legacy();
    while (full.devices.length < 40)
      full.devices.push({ ...full.devices[0], id: `retained-${full.devices.length}` });
    expect(() => buildSceneDraft(full, proposal())).toThrow();
  });

  it('applies one reviewed event, drops temporary edit events, and rejects stale or forged drafts', () => {
    const base = legacy();
    const draft = buildSceneDraft(base, proposal());
    const object = draft.objects[0];
    const edited = applyCommand(draft, {
      type: 'update-object',
      id: object.id,
      patch: { placement: { ...object.placement, x: 2.5 } },
    });
    const approved = applySceneDraft(base, base, edited, '2026-10-27T10:00:00.000Z');
    expect(approved.history).toHaveLength(base.history.length + 1);
    expect(approved.history[0].summary).toContain('reviewed photo scene');
    expect(approved.history.slice(1)).toEqual(base.history);
    expect(approved.objects[0].placement.x).toBe(2.5);
    const changed = applyCommand(base, { type: 'rename', name: 'Newer workspace' });
    expect(() => applySceneDraft(changed, base, draft)).toThrow(/changed/);
    const forged = structuredClone(draft);
    forged.devices[0].status = 'unknown';
    expect(() => applySceneDraft(base, base, forged)).toThrow(/reports/);
    const fakeConnection = structuredClone(draft);
    fakeConnection.connections[0].connector = 'USB-C';
    expect(() => applySceneDraft(base, base, fakeConnection)).toThrow(/connections/);
  });
});

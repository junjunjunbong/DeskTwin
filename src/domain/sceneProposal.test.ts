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
  buildScenePreview,
  rebindSceneDevice,
  SceneProposalSchema,
  type SceneProposal,
} from './sceneProposal';
import { getItemBounds, validateSceneCollisions } from './spatial';

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
    // Compatibility assertions do not depend on overlapping decorative sample furniture.
    w.objects = [];
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
    const parts = Array.from({ length: 129 }, () => proposal().objects[1].parts[0]);
    expect(() => WorkspaceSchema.parse({ ...legacy(), objects: [{ ...visual, parts }] })).toThrow();
  });

  it('supports furniture and generic edits through the same validated command path', () => {
    const base = createDemoWorkspace();
    const desk = base.objects.find((object) => object.kind === 'desk')!;
    base.objects = [desk];
    base.devices = [];
    base.connections = [];
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
  it('keeps distinct same-name props and reuses their separate stable records on repeat', () => {
    const input = proposal();
    const plant = { ...input.objects[1], kind: 'plant' as const, name: 'Plant', parts: [] };
    input.objects = [
      { ...plant, id: 'plant-left' },
      { ...plant, id: 'plant-right' },
    ];
    const first = buildSceneDraft(createDemoWorkspace(), input);
    expect(first.objects).toHaveLength(2);
    expect(new Set(first.objects.map((item) => item.id)).size).toBe(2);
    const repeated = buildSceneDraft(first, input);
    expect(repeated.objects).toHaveLength(2);
    expect(repeated.objects.map((item) => item.id)).toEqual(first.objects.map((item) => item.id));
  });

  it('rebinds an attached device without restoring it outside a moved and resized desk', () => {
    let base = createDemoWorkspace();
    base.devices = [base.devices.find((device) => device.id === 'monitor-left')!];
    base.devices[0].placement = { x: 0, y: 2.51, z: 0, rotation: 0 };
    base.devices[0].status = 'reported-working';
    base.connections = [];
    base.objects = [base.objects.find((object) => object.kind === 'desk')!];
    base.objects[0].visual.source = 'user-reported';
    base = applyCommand(base, {
      type: 'attach-object',
      id: base.devices[0].id,
      parentId: base.objects[0].id,
    });
    const monitor = proposal().objects[0];
    const input: SceneProposal = {
      message: 'Review approximate scene',
      objects: [
        {
          ...monitor,
          id: 'desk',
          deviceId: null,
          kind: 'desk',
          name: 'Desk',
          placement: { x: 0.5, y: 0, z: 0, rotation: 0 },
          scale: { x: 1, y: 1.2, z: 1 },
        },
        {
          ...monitor,
          deviceId: base.devices[0].id,
          name: base.devices[0].name,
          placement: { x: 0.5, y: 3, z: 0, rotation: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    };
    const preview = buildScenePreview(base, input);
    const separate = rebindSceneDevice(preview.draft, base, preview.observations, monitor.id, null);
    const restored = separate.draft.devices.find((device) => device.id === base.devices[0].id)!;
    const desk = separate.draft.objects[0];
    expect(restored.placement.x).toBeCloseTo(0.5);
    expect(restored.attachment?.parentId).toBe(desk.id);
    expect(restored.status).toBe('reported-working');
    expect(getItemBounds(restored).min.y).toBeGreaterThanOrEqual(getItemBounds(desk).max.y);
    expect(validateSceneCollisions(separate.draft, base)).toEqual([]);
    expect(() => applySceneDraft(base, base, separate.draft)).not.toThrow();
  });

  it('does not allow a reviewed scene to silently remove an existing user prop', () => {
    const base = createDemoWorkspace();
    base.objects[0].visual.source = 'user-reported';
    const draft = buildSceneDraft(base, proposal());
    draft.objects = draft.objects.filter((object) => object.id !== base.objects[0].id);
    expect(() => applySceneDraft(base, base, draft)).toThrow(/furniture|props/);
  });
  it('reuses previous photo records on repeated analysis and keeps reports and links', () => {
    const first = buildSceneDraft(createDemoWorkspace(), proposal());
    first.devices[0].status = 'reported-working';
    first.devices[0].statusNote = 'User checked the screen.';
    const repeated = buildScenePreview(first, proposal());
    expect(repeated.draft.devices).toHaveLength(1);
    expect(repeated.draft.objects).toHaveLength(1);
    expect(repeated.draft.devices[0].id).toBe(first.devices[0].id);
    expect(repeated.draft.devices[0].status).toBe('reported-working');
    expect(repeated.observations[0].matchedDeviceId).toBe(first.devices[0].id);
    expect(repeated.draft.objects[0].id).toBe(first.objects[0].id);
  });

  it('matches a unique existing name and lets the reviewer keep a separate new device', () => {
    const base = legacy();
    const input = proposal();
    input.objects[0].name = '  Office   monitor  ';
    const preview = buildScenePreview(base, input);
    expect(preview.observations[0].matchedDeviceId).toBe('my-monitor');
    expect(preview.observations[0].needsRecordChoice).toBe(false);
    expect(preview.draft.devices).toHaveLength(2);
    const separate = rebindSceneDevice(
      preview.draft,
      base,
      preview.observations,
      input.objects[0].id,
      null,
    );
    expect(separate.draft.devices).toHaveLength(3);
    expect(separate.draft.devices.find((device) => device.id === 'my-monitor')).toEqual(
      base.devices[1],
    );
    const newId = separate.observations[0].sceneId;
    expect(separate.draft.devices.find((device) => device.id === newId)).toMatchObject({
      status: 'unknown',
      statusNote: '',
      source: 'photo-inferred',
    });
    expect(separate.draft.connections).toEqual(base.connections);
    const rebound = rebindSceneDevice(
      separate.draft,
      base,
      separate.observations,
      input.objects[0].id,
      'my-monitor',
    );
    expect(rebound.draft.devices).toHaveLength(2);
    expect(rebound.draft.devices[1].status).toBe('reported-issue');
    expect(rebound.draft.connections).toEqual(base.connections);
  });

  it('requires a record choice for an unmatched photo of a sample device with user connections', () => {
    const base = createDemoWorkspace();
    base.devices = base.devices.filter((device) => ['laptop', 'monitor-left'].includes(device.id));
    base.objects = [];
    base.connections = [
      {
        id: 'my-hdmi',
        from: 'laptop',
        to: 'monitor-left',
        connector: 'HDMI',
        fromPort: 'HDMI output',
        toPort: 'HDMI 1',
        source: 'user-reported',
        note: 'I recorded this cable. Its operation has not been tested.',
      },
    ];
    const before = structuredClone(base);
    const input = proposal();
    input.objects = [input.objects[0]];
    input.objects[0].name = 'Different photo label';
    const preview = buildScenePreview(base, input);
    expect(preview.observations[0]).toMatchObject({
      matchedDeviceId: null,
      needsRecordChoice: true,
    });
    expect(preview.draft.devices).toHaveLength(3);
    expect(preview.draft.connections).toEqual(base.connections);

    const separate = rebindSceneDevice(
      preview.draft,
      base,
      preview.observations,
      input.objects[0].id,
      null,
    );
    expect(separate.observations[0]).toMatchObject({
      sceneId: preview.observations[0].sceneId,
      matchedDeviceId: null,
      needsRecordChoice: false,
    });
    expect(separate.draft).toBe(preview.draft);
    expect(preview.observations[0].needsRecordChoice).toBe(true);

    const matched = rebindSceneDevice(
      preview.draft,
      base,
      preview.observations,
      input.objects[0].id,
      'monitor-left',
    );
    expect(matched.observations[0]).toMatchObject({
      sceneId: 'monitor-left',
      matchedDeviceId: 'monitor-left',
      needsRecordChoice: false,
    });
    expect(matched.draft.devices).toHaveLength(2);
    expect(matched.draft.devices.find((device) => device.id === 'monitor-left')).toMatchObject({
      id: before.devices[1].id,
      name: before.devices[1].name,
      model: before.devices[1].model,
      source: before.devices[1].source,
      status: before.devices[1].status,
      statusNote: before.devices[1].statusNote,
    });
    expect(matched.draft.connections).toEqual(before.connections);
    const applied = applySceneDraft(base, base, matched.draft);
    expect(applied.history).toHaveLength(base.history.length + 1);
    expect(applied.connections).toEqual(before.connections);
    expect(base).toEqual(before);
    expect(preview.draft.devices).toHaveLength(3);
  });

  it('does not require record choices when no retained device has the candidate’s type', () => {
    const preview = buildScenePreview(createDemoWorkspace(), proposal());
    expect(preview.observations).toHaveLength(1);
    expect(preview.observations[0]).toMatchObject({
      matchedDeviceId: null,
      needsRecordChoice: false,
    });
  });

  it('accepts a formerly sample device when the user attached real reports to that record', () => {
    const base = createDemoWorkspace();
    const device = base.devices.find((entry) => entry.kind === 'monitor')!;
    device.status = 'reported-working';
    device.statusNote = 'Checked by the user.';
    const input = proposal();
    input.objects[0].deviceId = device.id;
    const preview = buildScenePreview(base, input);
    expect(preview.observations[0].matchedDeviceId).toBe(device.id);
    expect(preview.observations[0].needsRecordChoice).toBe(false);
    expect(preview.draft.devices.find((entry) => entry.id === device.id)?.status).toBe(
      'reported-working',
    );
  });

  it('allows bounded custom box shapes for photographed devices without inventing operating evidence', () => {
    const input = proposal();
    input.objects[0].parts = [{ ...input.objects[1].parts[0], rotation: { x: 0, y: 15, z: 0 } }];
    const draft = buildSceneDraft(createDemoWorkspace(), input);
    expect(draft.devices[0].shapeMode).toBe('custom');
    expect(draft.devices[0].parts).toEqual(input.objects[0].parts);
    expect(draft.devices[0].status).toBe('unknown');
    expect(draft.connections).toEqual([]);
  });
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
    expect(SceneProposalSchema.parse(nonGenericParts).objects[0].parts).toHaveLength(1);
    nonGenericParts.objects[0].parts = Array.from(
      { length: 33 },
      () => proposal().objects[1].parts[0],
    );
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

import { z } from 'zod';
import {
  BoxPartSchema,
  ColorSchema,
  DeviceKindSchema,
  DeviceSchema,
  IdSchema,
  ObjectKindSchema,
  PlacementSchema,
  ScaleSchema,
  SceneObjectSchema,
  WorkspaceSchema,
  parseWorkspace,
  type Device,
  type Workspace,
} from './workspace';

/** A model may propose only bounded visual data, never executable geometry or device facts. */
export const SceneProposalItemSchema = z.strictObject({
  id: IdSchema,
  deviceId: IdSchema.nullable(),
  kind: z.enum([...DeviceKindSchema.options, ...ObjectKindSchema.options]),
  name: z.string().trim().min(1).max(60),
  placement: PlacementSchema,
  scale: ScaleSchema,
  color: ColorSchema,
  parts: z.array(BoxPartSchema).max(16),
  note: z.string().max(300),
});
export const SceneProposalSchema = z
  .strictObject({
    message: z.string().trim().min(1).max(6000),
    objects: z.array(SceneProposalItemSchema).min(1).max(32),
  })
  .superRefine((scene, ctx) => {
    const ids = new Set<string>();
    const deviceIds = new Set<string>();
    scene.objects.forEach((object, index) => {
      if (ids.has(object.id))
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'id'],
          message: 'Duplicate proposal ID.',
        });
      ids.add(object.id);
      if (object.deviceId !== null) {
        if (deviceIds.has(object.deviceId))
          ctx.addIssue({
            code: 'custom',
            path: ['objects', index, 'deviceId'],
            message: 'Duplicate device reference.',
          });
        deviceIds.add(object.deviceId);
        if (!DeviceKindSchema.safeParse(object.kind).success)
          ctx.addIssue({
            code: 'custom',
            path: ['objects', index, 'deviceId'],
            message: 'Only device templates can reference a device.',
          });
      }
      if (object.kind !== 'generic' && object.parts.length)
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'parts'],
          message: 'Only generic objects can contain custom parts.',
        });
    });
  });
export type SceneProposal = z.infer<typeof SceneProposalSchema>;
export type SceneProposalItem = z.infer<typeof SceneProposalItemSchema>;

function retainedDevices(base: Workspace): Device[] {
  // A user report can refer to an original demo ID. Keep the evidence and its endpoints.
  const reportedEndpoints = new Set(
    base.connections
      .filter((connection) => connection.source !== 'demo')
      .flatMap((connection) => [connection.from, connection.to]),
  );
  return base.devices.filter(
    (device) =>
      device.source !== 'demo' ||
      device.status !== 'unknown' ||
      device.statusNote !== '' ||
      device.visual.source !== 'demo' ||
      reportedEndpoints.has(device.id),
  );
}

/** Pure draft creation: no persistence, history event, provider call, or mutation of base. */
export function buildSceneDraft(base: Workspace, value: unknown): Workspace {
  const source = parseWorkspace(base);
  const proposal = SceneProposalSchema.parse(value);
  const next = structuredClone(source);
  // A hidden-decor preference must not conceal the proposal the user is asked to review.
  next.appearance.decor = true;
  next.devices = retainedDevices(source);
  next.objects = source.objects.filter((object) => object.visual.source !== 'demo');
  const retainedIds = new Set(next.devices.map((device) => device.id));
  next.connections = source.connections.filter(
    (connection) => retainedIds.has(connection.from) && retainedIds.has(connection.to),
  );
  // Include removed sample IDs too: a new visual observation must not inherit sample identity.
  const taken = new Set([...source.devices, ...source.objects].map((object) => object.id));
  function freshId(candidate: string) {
    const prefix = `photo-${candidate.slice(0, 80)}`;
    let id = prefix;
    for (let suffix = 2; taken.has(id); suffix++) id = `${prefix}-${suffix}`;
    taken.add(id);
    return id;
  }
  for (const object of proposal.objects) {
    const visual = {
      scale: object.scale,
      color: object.color,
      source: 'photo-inferred' as const,
      note: object.note,
    };
    const deviceKind = DeviceKindSchema.safeParse(object.kind);
    if (deviceKind.success) {
      if (object.deviceId !== null) {
        const existing = source.devices.find((device) => device.id === object.deviceId);
        if (!existing || existing.source === 'demo' || existing.kind !== object.kind)
          throw new Error(
            'A photo suggestion references an unknown, sample, or mismatched device.',
          );
        const index = next.devices.findIndex((device) => device.id === existing.id);
        // Keep name, model, status, identity source and every user connection unchanged.
        next.devices[index] = DeviceSchema.parse({
          ...existing,
          placement: object.placement,
          visual,
        });
      } else {
        next.devices.push(
          DeviceSchema.parse({
            id: freshId(object.id),
            kind: deviceKind.data,
            name: object.name,
            model: '',
            placement: object.placement,
            visual,
            source: 'photo-inferred',
            status: 'unknown',
            statusNote: '',
          }),
        );
      }
    } else {
      next.objects.push(
        SceneObjectSchema.parse({
          id: freshId(object.id),
          kind: object.kind,
          name: object.name,
          placement: object.placement,
          visual,
          parts: object.parts,
        }),
      );
    }
  }
  return WorkspaceSchema.parse(next);
}

function identity(device: Device) {
  return {
    id: device.id,
    kind: device.kind,
    name: device.name,
    model: device.model,
    source: device.source,
    status: device.status,
    statusNote: device.statusNote,
  };
}

/** Called only after explicit approval; the store records the returned snapshot as one undo step. */
export function applySceneDraft(
  current: Workspace,
  base: Workspace,
  draft: Workspace,
  at = new Date().toISOString(),
): Workspace {
  const currentValidated = parseWorkspace(current);
  const baseValidated = parseWorkspace(base);
  if (JSON.stringify(currentValidated) !== JSON.stringify(baseValidated))
    throw new Error(
      'Your workspace changed while this preview was open. Discard it and analyze again.',
    );
  const next = parseWorkspace(draft);
  const protectedDevices = retainedDevices(baseValidated);
  for (const original of protectedDevices) {
    const updated = next.devices.find((device) => device.id === original.id);
    if (!updated || JSON.stringify(identity(updated)) !== JSON.stringify(identity(original)))
      throw new Error('A scene preview cannot change or remove existing device reports.');
  }
  const existingIds = new Set(baseValidated.devices.map((device) => device.id));
  for (const device of next.devices) {
    if (existingIds.has(device.id)) {
      const original = baseValidated.devices.find((candidate) => candidate.id === device.id)!;
      if (JSON.stringify(identity(device)) !== JSON.stringify(identity(original)))
        throw new Error('A scene preview cannot change existing device reports.');
    } else if (
      device.source !== 'photo-inferred' ||
      device.status !== 'unknown' ||
      device.statusNote !== ''
    ) {
      throw new Error('New photo devices must have an unknown operating status.');
    }
  }
  const keptIds = new Set(next.devices.map((device) => device.id));
  const expectedConnections = baseValidated.connections.filter(
    (connection) => keptIds.has(connection.from) && keptIds.has(connection.to),
  );
  if (JSON.stringify(next.connections) !== JSON.stringify(expectedConnections))
    throw new Error('A scene preview cannot change reported connections.');
  // Draft edits may use applyCommand. Their temporary events never enter saved history.
  next.history = [
    {
      id: crypto.randomUUID(),
      at,
      summary: 'Applied reviewed photo scene · Visual estimates, not live device verification',
      source: 'user-reported' as const,
    },
    ...currentValidated.history,
  ].slice(0, 100);
  return WorkspaceSchema.parse(next);
}

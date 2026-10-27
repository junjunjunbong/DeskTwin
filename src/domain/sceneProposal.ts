import { z } from 'zod';
import {
  fitSceneProposal,
  findFreePlacement,
  rebaseAttachedPlacement,
  validateSceneCollisions,
} from './spatial';
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
  type SceneObject,
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
  parts: z.array(BoxPartSchema).max(32),
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
    });
  });
export type SceneProposal = z.infer<typeof SceneProposalSchema>;
export type SceneProposalItem = z.infer<typeof SceneProposalItemSchema>;

export function retainedDevices(base: Workspace): Device[] {
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
      !!device.attachment ||
      reportedEndpoints.has(device.id),
  );
}

function retainedObjects(base: Workspace): SceneObject[] {
  const explicit = base.objects.filter(
    (object) => object.visual.source !== 'demo' || !!object.attachment,
  );
  const parents = new Set(
    [...retainedDevices(base), ...explicit].flatMap((item) =>
      item.attachment ? [item.attachment.parentId] : [],
    ),
  );
  return base.objects.filter((object) => explicit.includes(object) || parents.has(object.id));
}

export type SceneDeviceObservation = {
  proposalId: string;
  sceneId: string;
  kind: Device['kind'];
  proposedName: string;
  matchedDeviceId: string | null;
};

const normalizedName = (name: string) =>
  name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

/** Conservative record matching is visible and reversible in the preview, never live identification. */
function suggestedMatch<T extends Device | SceneObject>(
  objects: T[],
  candidate: SceneProposalItem,
  used: Set<string>,
): T | undefined {
  const available = objects.filter(
    (object) => object.kind === candidate.kind && !used.has(object.id),
  );
  const stable = available.find((object) => object.id === `photo-${candidate.id.slice(0, 80)}`);
  if (stable && normalizedName(stable.name) === normalizedName(candidate.name)) return stable;
  const named = available.filter(
    (object) => normalizedName(object.name) === normalizedName(candidate.name),
  );
  return named.length === 1 ? named[0] : undefined;
}

/** Pure draft creation: no persistence, history event, provider call, or mutation of base. */
export function buildSceneDraft(base: Workspace, value: unknown): Workspace {
  return buildScenePreview(base, value).draft;
}

export function buildScenePreview(
  base: Workspace,
  value: unknown,
): {
  draft: Workspace;
  observations: SceneDeviceObservation[];
} {
  const source = parseWorkspace(base);
  const proposal = SceneProposalSchema.parse(value);
  const next = structuredClone(source);
  // A hidden-decor preference must not conceal the proposal the user is asked to review.
  next.appearance.decor = true;
  next.devices = retainedDevices(source);
  // A sample desk with user-attached objects is no longer disposable scenery.
  next.objects = retainedObjects(source);
  const retainedIds = new Set(next.devices.map((device) => device.id));
  next.connections = source.connections.filter(
    (connection) => retainedIds.has(connection.from) && retainedIds.has(connection.to),
  );
  // Include removed sample IDs too: a new visual observation must not inherit sample identity.
  const taken = new Set([...source.devices, ...source.objects].map((object) => object.id));
  const matched = new Set<string>();
  const observations: SceneDeviceObservation[] = [];
  const changedIds: string[] = [];
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
      const eligible = retainedDevices(source);
      const existing =
        object.deviceId !== null
          ? eligible.find((device) => device.id === object.deviceId)
          : suggestedMatch(eligible, object, matched);
      if (object.deviceId !== null && (!existing || existing.kind !== object.kind))
        throw new Error(
          'A photo suggestion references an unknown, unused sample, or mismatched device.',
        );
      if (existing) {
        if (matched.has(existing.id))
          throw new Error('Two photo objects reference the same device record.');
        matched.add(existing.id);
        const index = next.devices.findIndex((device) => device.id === existing.id);
        // Keep name, model, status, identity source and every user connection unchanged.
        next.devices[index] = DeviceSchema.parse({
          ...existing,
          placement: object.placement,
          visual,
          parts: object.parts,
          shapeMode: object.parts.length ? 'custom' : 'template',
        });
        observations.push({
          proposalId: object.id,
          sceneId: existing.id,
          kind: deviceKind.data,
          proposedName: object.name,
          matchedDeviceId: existing.id,
        });
        changedIds.push(existing.id);
      } else {
        const id = freshId(object.id);
        next.devices.push(
          DeviceSchema.parse({
            id,
            kind: deviceKind.data,
            name: object.name,
            model: '',
            placement: object.placement,
            visual,
            parts: object.parts,
            shapeMode: object.parts.length ? 'custom' : 'template',
            source: 'photo-inferred',
            status: 'unknown',
            statusNote: '',
          }),
        );
        observations.push({
          proposalId: object.id,
          sceneId: id,
          kind: deviceKind.data,
          proposedName: object.name,
          matchedDeviceId: null,
        });
        changedIds.push(id);
      }
    } else {
      const existing = suggestedMatch(next.objects, object, matched);
      const replacement = SceneObjectSchema.parse({
        ...(existing ?? {}),
        id: existing?.id ?? freshId(object.id),
        kind: object.kind,
        name: existing?.name ?? object.name,
        placement: object.placement,
        visual,
        parts: object.parts,
        shapeMode: object.parts.length ? 'custom' : 'template',
      });
      if (existing) {
        matched.add(existing.id);
        next.objects[next.objects.findIndex((item) => item.id === existing.id)] = replacement;
      } else next.objects.push(replacement);
      matched.add(replacement.id);
      changedIds.push(replacement.id);
    }
  }
  const bounded = WorkspaceSchema.parse(next);
  return {
    draft: WorkspaceSchema.parse(fitSceneProposal(source, bounded, changedIds)),
    observations,
  };
}

/** User-selected identity binding changes only the preview's visual association. */
export function rebindSceneDevice(
  draft: Workspace,
  base: Workspace,
  observations: SceneDeviceObservation[],
  proposalId: string,
  targetId: string | null,
): { draft: Workspace; observations: SceneDeviceObservation[] } {
  const observation = observations.find((item) => item.proposalId === proposalId);
  if (!observation) throw new Error('Photo object not found.');
  if (targetId === observation.matchedDeviceId) return { draft, observations };
  const current = draft.devices.find((item) => item.id === observation.sceneId);
  if (!current) throw new Error('Photo device not found.');
  if (
    targetId &&
    observations.some((item) => item.proposalId !== proposalId && item.matchedDeviceId === targetId)
  )
    throw new Error('That device is already represented by another photo object.');
  const target = targetId
    ? retainedDevices(base).find((item) => item.id === targetId && item.kind === observation.kind)
    : undefined;
  if (targetId && !target) throw new Error('Choose an existing device of the same type.');
  const next = structuredClone(draft);
  const restoredIds: string[] = [];
  if (observation.matchedDeviceId) {
    const original = base.devices.find((item) => item.id === observation.matchedDeviceId)!;
    const restored = structuredClone(original);
    restored.placement = rebaseAttachedPlacement(base, next, original);
    next.devices[next.devices.findIndex((item) => item.id === original.id)] = restored;
    restoredIds.push(original.id);
  } else next.devices = next.devices.filter((item) => item.id !== current.id);
  let replacement: Device;
  if (target) {
    replacement = DeviceSchema.parse({
      ...target,
      placement: current.placement,
      visual: current.visual,
      parts: current.parts,
      shapeMode: current.shapeMode,
    });
    next.devices[next.devices.findIndex((item) => item.id === target.id)] = replacement;
  } else {
    const taken = new Set(
      [...base.devices, ...base.objects, ...next.devices, ...next.objects].map((item) => item.id),
    );
    const prefix = `photo-${proposalId.slice(0, 80)}`;
    let id = prefix;
    for (let suffix = 2; taken.has(id); suffix++) id = `${prefix}-${suffix}`;
    replacement = DeviceSchema.parse({
      ...current,
      id,
      name: observation.proposedName,
      model: '',
      source: 'photo-inferred',
      status: 'unknown',
      statusNote: '',
      attachment: null,
    });
    next.devices.push(replacement);
  }
  return {
    draft: WorkspaceSchema.parse(
      findFreePlacement(
        fitSceneProposal(base, next, [...restoredIds, replacement.id]),
        replacement.id,
      ),
    ),
    observations: observations.map((item) =>
      item.proposalId === proposalId
        ? { ...item, sceneId: replacement.id, matchedDeviceId: targetId }
        : item,
    ),
  };
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
  if (
    retainedObjects(baseValidated).some(
      (original) => !next.objects.some((object) => object.id === original.id),
    )
  )
    throw new Error('A scene preview cannot remove existing furniture or props.');
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
  const collisions = validateSceneCollisions(next, baseValidated);
  if (collisions.length)
    throw new Error(`Resolve the scene placement before applying: ${collisions[0]}`);
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

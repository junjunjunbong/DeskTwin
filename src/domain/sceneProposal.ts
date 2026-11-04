import { z } from 'zod';
import type { PhotoCamera, PhotoDeskCorners, PhotoPoint, PhotoReference } from './photoProjection';
import { diagnosisDeviceIds } from './diagnosis';
import {
  photoPlacementSeed,
  photoPlacementHeightReferences,
  photoPlacementSupports,
  repairPhotoLayout,
  type PhotoPlacementAdjustment,
  type PhotoPlacementLocks,
  type PhotoPlacementSeed,
  type PhotoRepairSummary,
  type PhotoSupportSource,
  type PhotoHeightReference,
} from './photoPlacement';
import {
  fitSceneProposalForReview,
  DEFAULT_SCENE_HEIGHT_ADJUSTMENT,
  evaluateSceneSupport,
  getSurfaceTargets,
  getUnambiguousCoveringSupport,
  getScenePlacementIssues,
  rebaseAttachedPlacement,
  validateSceneCollisions,
  type ScenePlacementIssue,
  type SceneSupportRelation,
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

/** Normalized image coordinates are a visual estimate, never an identification result. */
export const SceneImageRegionSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .refine((region) => region.x + region.width <= 1 && region.y + region.height <= 1, {
    message: 'The image region must stay within the reference image.',
  });

const PhotoObjectKindSchema = z.enum([...DeviceKindSchema.options, ...ObjectKindSchema.options]);
/** One concrete English noun phrase for a single SAM concept prompt. */
export const SamPhraseSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/)
  .refine((phrase) => phrase.split(/ +/).length <= 6, {
    message: 'A SAM phrase is at most 6 words.',
  });
export const PhotoObjectCandidateSchema = z.strictObject({
  id: IdSchema,
  kind: PhotoObjectKindSchema,
  name: z.string().trim().min(1).max(60),
  samPhrase: SamPhraseSchema,
  imageRegion: SceneImageRegionSchema.nullable(),
  imageRegionVisibility: z.enum(['complete', 'partial', 'unknown']),
});
export const PhotoObjectListSchema = z
  .strictObject({
    message: z.string().trim().min(1).max(2000),
    objects: z.array(PhotoObjectCandidateSchema).max(32),
  })
  .superRefine((list, ctx) => {
    const ids = new Set<string>();
    list.objects.forEach((object, index) => {
      if (!ids.has(object.id)) {
        ids.add(object.id);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['objects', index, 'id'],
        message: 'Duplicate object ID.',
      });
    });
  });
export type PhotoObjectCandidate = z.infer<typeof PhotoObjectCandidateSchema>;
export type PhotoObjectList = z.infer<typeof PhotoObjectListSchema>;

export const PhotoSelectionItemSchema = z.strictObject({
  id: IdSchema,
  kind: PhotoObjectKindSchema,
  name: z.string().trim().min(1).max(60),
  imageRegion: SceneImageRegionSchema.nullable(),
});
export const PhotoSelectionSchema = z
  .strictObject({
    objects: z.array(PhotoSelectionItemSchema).min(1).max(32),
  })
  .superRefine((selection, ctx) => {
    const ids = new Set<string>();
    selection.objects.forEach((object, index) => {
      if (!ids.has(object.id)) {
        ids.add(object.id);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['objects', index, 'id'],
        message: 'Duplicate selected object ID.',
      });
    });
  });
export type PhotoSelection = z.infer<typeof PhotoSelectionSchema>;
export type PhotoSelectionItem = z.infer<typeof PhotoSelectionItemSchema>;

export const SceneImagePointSchema = z.strictObject({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
export const ScenePhotoReferenceSchema = z.strictObject({
  objectId: IdSchema,
  surface: z.enum(['tabletop', 'monitor-screen']).optional(),
  corners: z.strictObject({
    backLeft: SceneImagePointSchema,
    backRight: SceneImagePointSchema,
    frontRight: SceneImagePointSchema,
    frontLeft: SceneImagePointSchema,
  }),
});

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
  // Older frozen provider replies omit these fields. New provider schemas require nullable values.
  supportId: IdSchema.nullable().optional(),
  imageRegion: SceneImageRegionSchema.nullable().optional(),
  imageRegionVisibility: z.enum(['complete', 'partial', 'unknown']).nullable().optional(),
  imageAnchor: SceneImagePointSchema.nullable().optional(),
});
export const SceneProposalSchema = z
  .strictObject({
    message: z.string().trim().min(1).max(6000),
    objects: z.array(SceneProposalItemSchema).min(1).max(32),
    photoReference: ScenePhotoReferenceSchema.nullable().optional(),
  })
  .superRefine((scene, ctx) => {
    if (
      scene.photoReference &&
      !scene.objects.some(
        (item) =>
          item.id === scene.photoReference!.objectId &&
          item.kind === (scene.photoReference!.surface === 'monitor-screen' ? 'monitor' : 'desk'),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['photoReference', 'objectId'],
        message:
          'The photo reference must identify a proposed rectangular desk or monitor surface.',
      });
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
export type SceneReviewCandidate = {
  proposalId: string;
  sceneId: string;
  kind: SceneProposalItem['kind'];
  proposedName: string;
  included: boolean;
  source: 'photo-inferred' | 'user-reported';
  matchedSceneId: string | null;
  imageRegion: z.infer<typeof SceneImageRegionSchema> | null;
  imageRegionVisibility?: 'complete' | 'partial' | 'unknown';
  imageAnchor?: PhotoPoint | null;
  /** A proposal ID, existing scene ID, floor, or null for inferred support. */
  supportId: string | null;
  supportSource?: PhotoSupportSource;
  locks?: Partial<PhotoPlacementLocks>;
  /** Never replaced by automatic fitting or a later user edit. Review-only metadata. */
  seed?: PhotoPlacementSeed;
  heightReference?: PhotoHeightReference;
  /** Unsaved edited geometry retained while this candidate is excluded. */
  excludedItem?: Device | SceneObject;
  excludedIndex?: number;
  excludedParent?: SceneObject;
  excludedObservation?: SceneDeviceObservation;
  pendingAttachment?: {
    attachment: NonNullable<Device['attachment']>;
    parent?: SceneObject;
    placement: Device['placement'];
  };
  suspendedAttachments?: {
    itemId: string;
    attachment: NonNullable<Device['attachment']>;
    placement: Device['placement'];
  }[];
};
export type ScenePreview = {
  draft: Workspace;
  observations: SceneDeviceObservation[];
  candidates: SceneReviewCandidate[];
  issues: ScenePlacementIssue[];
  /** The parsed proposal before geometry correction, never persisted into Workspace. */
  originalDraft?: Workspace;
  adjustments?: PhotoPlacementAdjustment[];
  repairSummary?: PhotoRepairSummary;
  /** User-edited support geometry remains an anchor when automatic changes are undone. */
  editedSupportIds?: string[];
  /** Source-photo evidence is review-only; it is never part of a saved Workspace. */
  photoReference?: {
    objectId: string;
    corners: PhotoDeskCorners;
    source: 'model' | 'manual';
    surface?: 'tabletop' | 'monitor-screen';
    fov?: number;
  };
  photoAlignment?: {
    reference?: PhotoReference;
    camera: PhotoCamera;
    beforeError: number;
    afterError: number;
    evaluations: number;
    changedIds: string[];
    warnings: string[];
    beforeDraft: Workspace;
    afterDraft: Workspace;
    /** Joint geometry repair and image refinement share the recorded camera. */
    afterRepairError?: number;
    repairSummary?: PhotoRepairSummary;
    supports?: {
      proposalId: string;
      before: Pick<SceneReviewCandidate, 'supportId' | 'supportSource'>;
      after: Pick<SceneReviewCandidate, 'supportId' | 'supportSource'>;
      /** Distinguish earlier user heights from edits made after this fit. */
      heightReference?: PhotoHeightReference;
    }[];
    items?: {
      proposalId: string;
      before: Device | SceneObject;
      after: Device | SceneObject;
    }[];
  };
};
export type SceneReviewMetadata = Pick<ScenePreview, 'candidates' | 'observations'>;

/** Proposal references follow a candidate even when its saved-record association changes. */
export function sceneReviewSupports(candidates: SceneReviewCandidate[]): SceneSupportRelation[] {
  return photoPlacementSupports(candidates);
}

/** Promote only a uniquely supported thin covering. A model support is a hypothesis;
 * a user's chosen or locked support is never silently replaced. */
export function inferSceneCoveringSupports(
  draft: Workspace,
  candidates: SceneReviewCandidate[],
): SceneReviewCandidate[] {
  const relations = new Map(
    sceneReviewSupports(candidates).map((relation) => [relation.itemId, relation.surfaceId]),
  );
  return candidates.map((candidate) => {
    if (!candidate.included || candidate.locks?.support || candidate.supportSource === 'user')
      return candidate;
    const current = relations.get(candidate.sceneId);
    if (!current) {
      const resting = getSurfaceTargets(draft, candidate.sceneId).filter((target) => {
        const contact = evaluateSceneSupport(draft, candidate.sceneId, target.id);
        return contact.available && contact.footprintValid && contact.resting;
      });
      if (resting.length !== 1) return candidate;
      const surfaceId = resting[0].id;
      const target =
        surfaceId === 'floor'
          ? undefined
          : candidates.find((entry) => entry.included && entry.sceneId === surfaceId);
      return {
        ...candidate,
        supportId: target?.proposalId ?? surfaceId,
        supportSource: 'geometry' as const,
      };
    }
    const covering = getUnambiguousCoveringSupport(draft, candidate.sceneId, current);
    if (!covering) return candidate;
    const target = candidates.find((entry) => entry.included && entry.sceneId === covering);
    return {
      ...candidate,
      supportId: target?.proposalId ?? covering,
      supportSource: 'geometry' as const,
    };
  });
}

/** Inspect all affected geometry, including retained children detached by an excluded support. */
export function sceneReviewPlacementIssues(
  base: Workspace,
  draft: Workspace,
  review: SceneReviewMetadata,
): ScenePlacementIssue[] {
  const geometry = (item: Device | SceneObject) => ({
    kind: item.kind,
    placement: item.placement,
    scale: item.visual.scale,
    parts: item.parts,
    shapeMode: item.shapeMode,
    attachment: item.attachment,
  });
  const originals = new Map([...base.devices, ...base.objects].map((item) => [item.id, item]));
  const changed = new Set(
    review.candidates
      .filter((candidate) => candidate.included)
      .map((candidate) => candidate.sceneId),
  );
  for (const item of [...draft.devices, ...draft.objects]) {
    const original = originals.get(item.id);
    if (!original || JSON.stringify(geometry(original)) !== JSON.stringify(geometry(item)))
      changed.add(item.id);
  }
  return getScenePlacementIssues(base, draft, changed, sceneReviewSupports(review.candidates)).map(
    (issue) => {
      const candidate = review.candidates.find(
        (entry) => entry.included && entry.sceneId === issue.itemId,
      );
      if (candidate?.locks?.position)
        return {
          ...issue,
          message: `${issue.message} Position is locked; unlock it or adjust the other object.`,
        };
      if (candidate && issue.rootCause === 'height' && issue.relatedItemId) {
        const contact = evaluateSceneSupport(draft, issue.itemId, issue.relatedItemId);
        const item = [...draft.objects, ...draft.devices].find(
          (entry) => entry.id === issue.itemId,
        )!;
        const referenceY =
          candidate.heightReference?.y ?? candidate.seed?.placement.y ?? item.placement.y;
        if (
          Math.abs(item.placement.y + contact.heightDelta - referenceY) >
          DEFAULT_SCENE_HEIGHT_ADJUSTMENT
        )
          return {
            ...issue,
            rootCause: 'height-budget' as const,
            message: `${issue.message} A larger height adjustment needs your support confirmation.`,
          };
      }
      return issue;
    },
  );
}

/** The final confirmation rechecks the full review rather than trusting rendered warning state. */
export function validateSceneReviewForApply(
  review: SceneReviewMetadata & { draft: Workspace },
  base: Workspace,
): Workspace {
  const draft = WorkspaceSchema.parse(review.draft);
  const included = review.candidates.filter((candidate) => candidate.included);
  const all = [...draft.objects, ...draft.devices];
  if (included.some((candidate) => !all.some((item) => item.id === candidate.sceneId)))
    throw new Error('An included review object is missing. Restore it or exclude its candidate.');
  if (
    review.observations.some(
      (observation) =>
        observation.needsRecordChoice &&
        included.some((candidate) => candidate.proposalId === observation.proposalId),
    )
  )
    throw new Error('Choose an existing or separate new device for each included candidate.');
  const issues = sceneReviewPlacementIssues(base, draft, review);
  if (issues.length)
    throw new Error(`Resolve the scene placement before applying: ${issues[0].message}`);
  return draft;
}

export function retainedDevices(base: Workspace): Device[] {
  // A user report can refer to an original demo ID. Keep the evidence and its endpoints.
  const reportedEndpoints = new Set(
    base.connections
      .filter((connection) => connection.source !== 'demo')
      .flatMap((connection) => [connection.from, connection.to]),
  );
  const checkedDevices = new Set(base.diagnoses.flatMap(diagnosisDeviceIds));
  return base.devices.filter(
    (device) =>
      device.source !== 'demo' ||
      !!device.hardwareBinding ||
      device.status !== 'unknown' ||
      device.statusNote !== '' ||
      device.visual.source !== 'demo' ||
      !!device.attachment ||
      checkedDevices.has(device.id) ||
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
  /** The reviewer must distinguish a new device from retained records of the same kind. */
  needsRecordChoice: boolean;
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
  // Server semantic validation shares this path but must not repeat browser repair search.
  return buildScenePreview(base, value, { repair: false }).draft;
}

export function buildScenePreview(
  base: Workspace,
  value: unknown,
  options: { repair?: boolean } = {},
): ScenePreview {
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
  const candidates: SceneReviewCandidate[] = [];
  const changedIds: string[] = [];
  function freshId(candidate: string) {
    const prefix = `photo-${candidate.slice(0, 80)}`;
    let id = prefix;
    for (let suffix = 2; taken.has(id); suffix++) id = `${prefix}-${suffix}`;
    taken.add(id);
    return id;
  }
  for (const object of proposal.objects) {
    let sceneId: string;
    let matchedSceneId: string | null = null;
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
        sceneId = existing.id;
        matchedSceneId = existing.id;
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
          needsRecordChoice: false,
        });
        changedIds.push(existing.id);
      } else {
        const id = freshId(object.id);
        sceneId = id;
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
          needsRecordChoice: eligible.some((device) => device.kind === deviceKind.data),
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
      sceneId = replacement.id;
      matchedSceneId = existing?.id ?? null;
      changedIds.push(replacement.id);
    }
    candidates.push({
      proposalId: object.id,
      sceneId,
      kind: object.kind,
      proposedName: object.name,
      included: true,
      source: 'photo-inferred',
      matchedSceneId,
      supportId: object.supportId ?? null,
      supportSource: 'model',
      locks: {},
      seed: photoPlacementSeed(
        [...next.objects, ...next.devices].find((item) => item.id === sceneId)!,
        object.supportId ?? null,
      ),
      heightReference: { y: object.placement.y, source: 'model' },
      imageRegion: object.imageRegion ?? null,
      imageRegionVisibility: object.imageRegionVisibility ?? 'unknown',
      imageAnchor: object.imageAnchor ?? null,
    });
  }
  const bounded = WorkspaceSchema.parse(next);
  const referenceCandidate =
    proposal.photoReference &&
    candidates.find((candidate) => candidate.proposalId === proposal.photoReference!.objectId);
  const photoReference =
    referenceCandidate && proposal.photoReference
      ? {
          objectId: referenceCandidate.sceneId,
          corners: proposal.photoReference.corners,
          source: 'model' as const,
          surface: proposal.photoReference.surface ?? 'tabletop',
        }
      : undefined;
  const supports = sceneReviewSupports(candidates);
  const fitted = fitSceneProposalForReview(source, bounded, changedIds, supports, {
    heightReferences: photoPlacementHeightReferences(candidates),
  });
  if (options.repair !== false) {
    const resolvedCandidates = inferSceneCoveringSupports(fitted.draft, candidates);
    const repaired = repairPhotoLayout(source, fitted.draft, resolvedCandidates);
    const issues = sceneReviewPlacementIssues(source, repaired.draft, {
      candidates: resolvedCandidates,
      observations,
    });
    const supportAdjustments = resolvedCandidates.flatMap(
      (candidate): PhotoPlacementAdjustment[] =>
        candidate.supportSource === 'geometry' && candidate.supportId !== candidate.seed?.supportId
          ? [
              {
                itemId: candidate.sceneId,
                field: 'support',
                before: candidate.seed?.supportId ?? null,
                after: candidate.supportId,
                source: 'geometry',
                reason: candidate.seed?.supportId
                  ? 'Selected the unique thin mat covering the original support.'
                  : 'Resolved the unique resting surface from geometry.',
              },
            ]
          : [],
    );
    return {
      draft: WorkspaceSchema.parse(repaired.draft),
      observations,
      candidates: resolvedCandidates,
      issues,
      originalDraft: structuredClone(bounded),
      adjustments: [...supportAdjustments, ...repaired.adjustments],
      repairSummary: {
        ...repaired.summary,
        unresolved: issues,
        status: issues.length ? 'needs-review' : 'ready',
      },
      photoReference,
    };
  }
  return {
    draft: WorkspaceSchema.parse(fitted.draft),
    observations,
    candidates,
    issues: fitted.issues,
    originalDraft: structuredClone(bounded),
    photoReference,
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
  const current = draft.devices.find((item) => item.id === observation.sceneId);
  if (!current) throw new Error('Photo device not found.');
  if (targetId === observation.matchedDeviceId)
    return {
      draft,
      // Choosing "separate new device" is meaningful even when there was no
      // suggested match. It resolves the ambiguity without replacing its ID or geometry.
      observations: observation.needsRecordChoice
        ? observations.map((item) =>
            item.proposalId === proposalId ? { ...item, needsRecordChoice: false } : item,
          )
        : observations,
    };
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
      fitSceneProposalForReview(base, next, [...restoredIds, replacement.id]).draft,
    ),
    observations: observations.map((item) =>
      item.proposalId === proposalId
        ? { ...item, sceneId: replacement.id, matchedDeviceId: targetId, needsRecordChoice: false }
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
    hardwareBinding: device.hardwareBinding,
    hardwareOrigin: device.hardwareOrigin,
  };
}

/** Called only after explicit approval; the store records the returned snapshot as one undo step. */
export function applySceneDraft(
  current: Workspace,
  base: Workspace,
  draft: Workspace,
  at = new Date().toISOString(),
  review?: SceneReviewMetadata,
): Workspace {
  const currentValidated = parseWorkspace(current);
  const baseValidated = parseWorkspace(base);
  if (JSON.stringify(currentValidated) !== JSON.stringify(baseValidated))
    throw new Error(
      'Your workspace changed while this preview was open. Discard it and analyze again.',
    );
  const next = review
    ? validateSceneReviewForApply({ ...review, draft: parseWorkspace(draft) }, baseValidated)
    : parseWorkspace(draft);
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
      !['photo-inferred', 'user-reported'].includes(device.source) ||
      device.status !== 'unknown' ||
      device.statusNote !== '' ||
      device.hardwareBinding !== undefined ||
      device.hardwareOrigin !== undefined
    ) {
      throw new Error('New reviewed devices must have an unknown operating status.');
    }
  }
  const keptIds = new Set(next.devices.map((device) => device.id));
  const expectedConnections = baseValidated.connections.filter(
    (connection) => keptIds.has(connection.from) && keptIds.has(connection.to),
  );
  if (JSON.stringify(next.connections) !== JSON.stringify(expectedConnections))
    throw new Error('A scene preview cannot change reported connections.');
  if (JSON.stringify(next.diagnoses) !== JSON.stringify(baseValidated.diagnoses))
    throw new Error('A scene preview cannot change guided-check history.');
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

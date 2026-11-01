import {
  DeviceKindSchema,
  BoxPartSchema,
  DeviceSchema,
  SceneObjectSchema,
  WorkspaceSchema,
  createSceneObject,
  defaultVisual,
  kindLabels,
  type Device,
  type SceneObject,
  type Workspace,
  type WorkspaceCommand,
} from './workspace';
import {
  retainedDevices,
  inferSceneCoveringSupports,
  sceneReviewPlacementIssues,
  sceneReviewSupports,
  type ScenePreview,
  type SceneProposalItem,
  type SceneReviewCandidate,
} from './sceneProposal';
import {
  fitSceneProposalForReview,
  prepareSurfacePlacement,
  rebaseAttachedPlacement,
  type SceneSupportRelation,
} from './spatial';
import { getPhotoReviewPreset } from './photoPresets';
import {
  photoPlacementSeed,
  repairPhotoLayout,
  type PhotoPlacementAdjustment,
  type PhotoPlacementLocks,
  type PhotoRepairPolicy,
} from './photoPlacement';

export type SceneReviewState = ScenePreview;
export { sceneReviewSupports, validateSceneReviewForApply } from './sceneProposal';
type Item = Device | SceneObject;

const allItems = (draft: Workspace): Item[] => [...draft.objects, ...draft.devices];
const itemIn = (draft: Workspace, id: string) => allItems(draft).find((item) => item.id === id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const geometry = (item: Item) => ({
  kind: item.kind,
  placement: item.placement,
  scale: item.visual.scale,
  parts: item.parts?.map((part) => ({
    position: part.position,
    size: part.size,
    rotation: part.rotation,
  })),
  shapeMode: item.shapeMode,
});

function supportSubtree(relations: SceneSupportRelation[], roots: Iterable<string>): Set<string> {
  const affected = new Set(roots);
  let added = true;
  while (added) {
    added = false;
    for (const relation of relations)
      if (affected.has(relation.surfaceId) && !affected.has(relation.itemId)) {
        affected.add(relation.itemId);
        added = true;
      }
  }
  return affected;
}

function rememberUserHeightReferences(
  candidates: SceneReviewCandidate[],
  draft: Workspace,
  ids: Iterable<string>,
): SceneReviewCandidate[] {
  const changed = new Set(ids);
  return candidates.map((candidate) => {
    const item =
      candidate.included && changed.has(candidate.sceneId)
        ? itemIn(draft, candidate.sceneId)
        : undefined;
    return item
      ? { ...candidate, heightReference: { y: item.placement.y, source: 'user' as const } }
      : candidate;
  });
}

function putItem(draft: Workspace, item: Item) {
  if ('status' in item) {
    const index = draft.devices.findIndex((entry) => entry.id === item.id);
    if (index < 0) draft.devices.push(DeviceSchema.parse(item));
    else draft.devices[index] = DeviceSchema.parse(item);
  } else {
    const index = draft.objects.findIndex((entry) => entry.id === item.id);
    if (index < 0) draft.objects.push(SceneObjectSchema.parse(item));
    else draft.objects[index] = SceneObjectSchema.parse(item);
  }
}

function uniqueId(
  draft: Workspace,
  base: Workspace,
  candidates: SceneReviewCandidate[],
  prefix: string,
) {
  const taken = new Set([
    ...allItems(base).map((item) => item.id),
    ...allItems(draft).map((item) => item.id),
    ...candidates.map((candidate) => candidate.sceneId),
  ]);
  const bounded = prefix.slice(0, 90);
  let id = bounded;
  for (let suffix = 2; taken.has(id); suffix++) id = `${bounded}-${suffix}`;
  return id;
}

/** Preserve direct user edits and refit only the heights of their support descendants.
 * No new horizontal carry is inferred; out-of-footprint children remain review issues. */
export function refreshSceneReview(
  state: SceneReviewState,
  base: Workspace,
  editedDraft: Workspace = state.draft,
  options: { origin?: 'user' | 'geometry'; userEditedIds?: Iterable<string> } = {},
): SceneReviewState {
  let draft = WorkspaceSchema.parse(editedDraft);
  const userEdit = options.origin !== 'geometry' && editedDraft !== state.draft;
  const directEdits = options.userEditedIds ? new Set(options.userEditedIds) : undefined;
  const editedGeometryIds = new Set(
    userEdit
      ? allItems(draft)
          .filter((item) => {
            if (directEdits && !directEdits.has(item.id)) return false;
            const previous = itemIn(state.draft, item.id);
            return previous && !same(geometry(previous), geometry(item));
          })
          .map((item) => item.id)
      : [],
  );
  let candidates = state.candidates.map((candidate) => {
    const item = candidate.included ? itemIn(draft, candidate.sceneId) : undefined;
    const previous = candidate.included ? itemIn(state.draft, candidate.sceneId) : undefined;
    const locks = { ...candidate.locks };
    if (item && previous && userEdit && (!directEdits || directEdits.has(item.id))) {
      if (
        ['x', 'y', 'z'].some(
          (axis) =>
            item.placement[axis as 'x' | 'y' | 'z'] !== previous.placement[axis as 'x' | 'y' | 'z'],
        )
      )
        locks.position = true;
      if (item.placement.rotation !== previous.placement.rotation) locks.rotation = true;
      if (!same(item.visual.scale, previous.visual.scale)) locks.scale = true;
    }
    return item
      ? {
          ...candidate,
          kind: item.kind,
          proposedName: candidate.matchedSceneId ? candidate.proposedName : item.name,
          locks,
          seed: candidate.seed ?? photoPlacementSeed(previous ?? item, candidate.supportId),
        }
      : candidate;
  });
  const relations = sceneReviewSupports(candidates);
  const supportIds = new Set(relations.map((relation) => relation.surfaceId));
  const editedRoots = [...editedGeometryIds].filter((id) => supportIds.has(id));
  const editedSupportIds = [...new Set([...(state.editedSupportIds ?? []), ...editedRoots])];
  const heightReferenceIds = new Set(editedGeometryIds);
  let adjustments = state.adjustments;
  if (editedRoots.length) {
    const affected = supportSubtree(relations, editedRoots);
    for (const id of editedGeometryIds) affected.delete(id);
    const beforeFit = draft;
    draft = fitSceneProposalForReview(
      base,
      draft,
      affected,
      relations.map((relation) =>
        affected.has(relation.itemId) ? { ...relation, source: 'user' as const } : relation,
      ),
      {
        carryFrom: beforeFit,
        lockedIds: [
          ...editedGeometryIds,
          ...candidates
            .filter((candidate) => candidate.locks?.position)
            .map((candidate) => candidate.sceneId),
        ],
      },
    ).draft;
    for (const id of affected) {
      heightReferenceIds.add(id);
      const before = itemIn(beforeFit, id);
      const after = itemIn(draft, id);
      if (!before || !after || same(before.placement, after.placement)) continue;
      const existing = adjustments?.find(
        (adjustment) => adjustment.itemId === id && adjustment.field === 'position',
      );
      const seed = candidates.find((candidate) => candidate.sceneId === id)?.seed;
      adjustments = [
        ...(adjustments ?? []).filter(
          (adjustment) => adjustment.itemId !== id || adjustment.field !== 'position',
        ),
        {
          itemId: id,
          field: 'position',
          before: existing?.before ?? { ...(seed?.placement ?? before.placement) },
          after: { ...after.placement },
          source: 'geometry',
          reason: 'Updated height after its support was edited.',
        },
      ];
    }
  }
  if (userEdit) {
    for (const candidate of candidates) {
      const before = itemIn(state.draft, candidate.sceneId);
      const after = itemIn(draft, candidate.sceneId);
      if (before && after && before.placement.y !== after.placement.y)
        heightReferenceIds.add(candidate.sceneId);
    }
    candidates = rememberUserHeightReferences(candidates, draft, heightReferenceIds);
  }
  const observations = state.observations.map((observation) => {
    const candidate = candidates.find((entry) => entry.proposalId === observation.proposalId);
    const item = candidate?.included
      ? draft.devices.find((entry) => entry.id === candidate.sceneId)
      : undefined;
    if (!item) return observation;
    return {
      ...observation,
      kind: item.kind,
      proposedName: candidate?.proposedName ?? item.name,
      needsRecordChoice:
        item.kind !== observation.kind && !observation.matchedDeviceId
          ? retainedDevices(base).some((device) => device.kind === item.kind)
          : observation.needsRecordChoice,
    };
  });
  const issues = sceneReviewPlacementIssues(base, draft, { candidates, observations });
  return {
    ...state,
    draft,
    candidates,
    observations,
    issues,
    ...(editedSupportIds.length ? { editedSupportIds } : {}),
    adjustments: adjustments?.filter((adjustment) => {
      const candidate = candidates.find((entry) => entry.sceneId === adjustment.itemId);
      return (
        !(adjustment.field === 'position' && candidate?.locks?.position) &&
        !(
          adjustment.field === 'support' &&
          (candidate?.locks?.support || candidate?.supportSource === 'user')
        )
      );
    }),
    repairSummary: state.repairSummary
      ? {
          ...state.repairSummary,
          status: issues.length ? 'needs-review' : 'ready',
          unresolved: issues,
        }
      : undefined,
  };
}

/** Preview-only support editing defers collision rejection until after dependent
 * heights are fitted. Other commands keep the normal editor's swept/SAT checks.
 * Invalid geometry remains visible with issues and cannot pass final confirmation. */
export function applySceneReviewSupportEdit(
  state: SceneReviewState,
  base: Workspace,
  command: WorkspaceCommand,
): SceneReviewState | null {
  if (!('id' in command)) return null;
  if (!sceneReviewSupports(state.candidates).some((relation) => relation.surfaceId === command.id))
    return null;
  if (command.type === 'snap-object' || (command.type === 'attach-object' && command.parentId)) {
    const surfaceId = command.type === 'snap-object' ? command.surfaceId : command.parentId!;
    const original = itemIn(state.draft, command.id);
    if (!original) throw new Error('Support object not found.');
    if (command.type === 'attach-object') {
      const parent = state.draft.objects.find((item) => item.id === surfaceId);
      if (
        !parent ||
        parent.kind !== 'desk' ||
        original.kind === 'desk' ||
        parent.id === original.id
      )
        throw new Error('Choose a desk to attach this object. Desks cannot be attached.');
    }
    // The parent can temporarily intersect its child at the new surface height.
    // Fit the dependent heights before the final review checks actual penetration.
    const placed = prepareSurfacePlacement(state.draft, command.id, surfaceId);
    const item = itemIn(placed.draft, command.id)!;
    item.visual.source = 'user-reported';
    if (command.type === 'attach-object') item.attachment = { parentId: surfaceId };
    const directSupport = state.candidates.find(
      (candidate) => candidate.included && candidate.sceneId === placed.surfaceId,
    );
    const candidates = state.candidates.map((candidate) =>
      candidate.included && candidate.sceneId === command.id
        ? {
            ...candidate,
            supportId: directSupport?.proposalId ?? placed.surfaceId,
            supportSource: 'user' as const,
            locks: { ...candidate.locks, support: true },
          }
        : candidate,
    );
    carryAttachedChildren(state.draft, placed.draft, command.id, reviewLocks(candidates));
    return refreshSceneReview({ ...state, candidates }, base, placed.draft, {
      userEditedIds: [command.id],
    });
  }
  if (
    command.type !== 'update-device' &&
    command.type !== 'update-object' &&
    command.type !== 'update-part'
  )
    return null;
  const original = itemIn(state.draft, command.id);
  if (!original) throw new Error('Support object not found.');
  const draft = structuredClone(state.draft);
  const item = itemIn(draft, command.id)!;
  if (command.type === 'update-part') {
    const parts = item.parts ?? [];
    if (
      !Number.isInteger(command.index) ||
      command.index < 0 ||
      command.index >= parts.length ||
      command.expectedLength !== parts.length
    )
      throw new Error(
        'The shape changed before this part edit could be saved. Select the part again and retry.',
      );
    if (!(
      item.shapeMode === 'custom' ||
      (item.kind === 'generic' && item.shapeMode !== 'template' && parts.length)
    ))
      throw new Error('Customize this template before editing its parts.');
    const part = parts[command.index];
    parts[command.index] = BoxPartSchema.parse({
      ...part,
      ...command.patch,
      position: { ...part.position, ...command.patch.position },
      size: { ...part.size, ...command.patch.size },
      ...(command.patch.rotation
        ? { rotation: { x: 0, y: 0, z: 0, ...part.rotation, ...command.patch.rotation } }
        : {}),
    });
    item.parts = parts;
    item.visual.source = 'user-reported';
    if (command.patch.color !== undefined) item.visual.color = null;
  } else {
    const patch = command.patch;
    if (!patch.placement && !patch.visual?.scale && !patch.parts && !patch.shapeMode) return null;
    if (
      Object.keys(patch).some((key) => !['placement', 'visual', 'parts', 'shapeMode'].includes(key))
    )
      return null;
    if (
      (command.type === 'update-device' && !('status' in item)) ||
      (command.type === 'update-object' && 'status' in item)
    )
      throw new Error('Support type changed. Select it again before editing.');
    if (
      command.type === 'update-device' &&
      command.expectedDetails &&
      'status' in item &&
      (['name', 'model', 'status', 'statusNote'] as const).some(
        (field) => item[field] !== command.expectedDetails![field],
      )
    )
      throw new Error(
        'Saved device details changed. Review the latest record before saving your draft.',
      );
    item.placement = { ...item.placement, ...patch.placement };
    item.visual = {
      ...item.visual,
      ...patch.visual,
      scale: { ...item.visual.scale, ...patch.visual?.scale },
      source: 'user-reported',
    };
    if (patch.parts) item.parts = structuredClone(patch.parts);
    if (patch.shapeMode) item.shapeMode = patch.shapeMode;
    if (
      'status' in item &&
      'status' in original &&
      !item.hardwareOrigin &&
      (original.source === 'os-detected' || original.visual.source === 'os-detected')
    )
      item.hardwareOrigin = 'macos';
  }
  putItem(draft, item);
  // Retain the existing explicit desk-only attachment behavior. Photo support
  // relations never become persistent carry attachments.
  carryAttachedChildren(
    state.draft,
    draft,
    item.id,
    new Map(
      state.candidates
        .filter((candidate) => candidate.included)
        .map((candidate) => [candidate.sceneId, candidate.locks ?? {}]),
    ),
  );
  return refreshSceneReview(state, base, WorkspaceSchema.parse(draft), {
    userEditedIds: [item.id],
  });
}

/** Explicit locks are review-only constraints. Unlocking never changes geometry by itself. */
export function setSceneCandidateLocks(
  state: SceneReviewState,
  base: Workspace,
  proposalId: string,
  patch: Partial<PhotoPlacementLocks>,
): SceneReviewState {
  if (!state.candidates.some((candidate) => candidate.proposalId === proposalId))
    throw new Error('Review candidate not found.');
  const candidates = state.candidates.map((candidate) =>
    candidate.proposalId === proposalId
      ? { ...candidate, locks: { ...candidate.locks, ...patch } }
      : candidate,
  );
  return refreshSceneReview({ ...state, candidates }, base);
}

/** Repair the current review while retaining immutable photo seeds and user constraints. */
export function repairSceneReview(
  state: SceneReviewState,
  base: Workspace,
  policy: Partial<PhotoRepairPolicy> = {},
): SceneReviewState {
  const seeded = state.candidates.map((candidate) => {
    const item = candidate.included
      ? itemIn(state.draft, candidate.sceneId)
      : candidate.excludedItem;
    return item && !candidate.seed
      ? { ...candidate, seed: photoPlacementSeed(item, candidate.supportId) }
      : candidate;
  });
  const candidates = inferSceneCoveringSupports(state.draft, seeded);
  const repaired = repairPhotoLayout(base, state.draft, candidates, policy);
  const supportAdjustments = candidates.flatMap((candidate): PhotoPlacementAdjustment[] =>
    candidate.included &&
    candidate.supportSource === 'geometry' &&
    candidate.supportId !== candidate.seed?.supportId
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
  return refreshSceneReview(
    {
      ...state,
      candidates,
      originalDraft: state.originalDraft ?? structuredClone(state.draft),
      adjustments: [...supportAdjustments, ...repaired.adjustments],
      repairSummary: repaired.summary,
    },
    base,
    repaired.draft,
    { origin: 'geometry' },
  );
}

/** Undo automatic changes only. User-locked edits and saved evidence remain intact. */
export function revertSceneRepair(state: SceneReviewState, base: Workspace): SceneReviewState {
  let draft = structuredClone(state.draft);
  const editedSupports = new Set(state.editedSupportIds ?? []);
  const candidates = state.candidates.map((candidate) => {
    if (!candidate.included || !candidate.seed) return candidate;
    const item = itemIn(draft, candidate.sceneId);
    if (item && !candidate.locks?.position && !editedSupports.has(candidate.sceneId)) {
      item.placement.x = candidate.seed.placement.x;
      item.placement.y =
        candidate.heightReference?.source === 'user'
          ? candidate.heightReference.y
          : candidate.seed.placement.y;
      item.placement.z = candidate.seed.placement.z;
    }
    const seedSupport = candidate.seed.supportId;
    const originalSupport =
      seedSupport === 'floor'
        ? undefined
        : state.candidates.find(
            (entry) => entry.proposalId === seedSupport || entry.seed?.sceneId === seedSupport,
          );
    return candidate.locks?.support || candidate.supportSource === 'user'
      ? candidate
      : {
          ...candidate,
          supportId: originalSupport?.proposalId ?? seedSupport,
          supportSource: 'model' as const,
        };
  });
  const relations = sceneReviewSupports(candidates);
  const affected = supportSubtree(relations, [
    ...editedSupports,
    ...candidates
      .filter(
        (candidate) =>
          candidate.included && candidate.supportSource === 'user' && candidate.supportId,
      )
      .map((candidate) => candidate.sceneId),
  ]);
  for (const id of editedSupports) affected.delete(id);
  if (affected.size)
    draft = fitSceneProposalForReview(
      base,
      draft,
      affected,
      relations.map((relation) =>
        affected.has(relation.itemId) ? { ...relation, source: 'user' as const } : relation,
      ),
      {
        carryFrom: draft,
        lockedIds: candidates
          .filter((candidate) => candidate.locks?.position)
          .map((candidate) => candidate.sceneId),
      },
    ).draft;
  return refreshSceneReview(
    { ...state, candidates, adjustments: [], repairSummary: undefined },
    base,
    draft,
    { origin: 'geometry' },
  );
}

/** Read-only comparison; callers must not use it as the editable or applicable draft. */
export function originalSceneReviewDraft(state: SceneReviewState): Workspace {
  return structuredClone(state.originalDraft ?? state.draft);
}

function restoreOriginal(draft: Workspace, base: Workspace, id: string) {
  const original = itemIn(base, id);
  if (!original)
    throw new Error('The saved record is missing. Analyze the current workspace again.');
  const restored = structuredClone(original);
  restored.placement = rebaseAttachedPlacement(base, draft, original);
  putItem(draft, restored);
}

function carryAttachedChildren(
  before: Workspace,
  after: Workspace,
  parentId: string,
  locks = new Map<string, Partial<PhotoPlacementLocks>>(),
) {
  if (
    !before.objects.some((item) => item.id === parentId && item.kind === 'desk') ||
    !after.objects.some((item) => item.id === parentId && item.kind === 'desk')
  )
    return;
  for (const original of allItems(before).filter(
    (item) => item.attachment?.parentId === parentId,
  )) {
    const child = itemIn(after, original.id);
    const lock = locks.get(original.id);
    if (child?.attachment?.parentId === parentId)
      child.placement = preserveLockedPlacement(
        original.placement,
        rebaseAttachedPlacement(before, after, original),
        lock,
      );
  }
}

function reviewLocks(candidates: SceneReviewCandidate[]) {
  return new Map(candidates.map((candidate) => [candidate.sceneId, candidate.locks ?? {}]));
}

/** Restoring an attachment can propose a new transform, but it must not replace
 * an independent position or rotation that the reviewer has explicitly locked. */
function preserveLockedPlacement(
  current: Item['placement'],
  proposed: Item['placement'],
  locks?: Partial<PhotoPlacementLocks>,
): Item['placement'] {
  return {
    ...proposed,
    ...(locks?.position ? { x: current.x, y: current.y, z: current.z } : {}),
    ...(locks?.rotation ? { rotation: current.rotation } : {}),
  };
}

/** Excluding an observation restores its matched saved record; it never deletes saved evidence. */
export function setSceneCandidateIncluded(
  state: SceneReviewState,
  base: Workspace,
  proposalId: string,
  included: boolean,
): SceneReviewState {
  const candidate = state.candidates.find((entry) => entry.proposalId === proposalId);
  if (!candidate) throw new Error('Review candidate not found.');
  if (candidate.included === included) return state;
  const next = structuredClone(state);
  const before = structuredClone(state.draft);
  const target = next.candidates.find((entry) => entry.proposalId === proposalId)!;
  if (!included) {
    const current = itemIn(next.draft, target.sceneId);
    if (!current) throw new Error('Review object not found.');
    target.excludedItem = structuredClone(current);
    target.excludedIndex =
      'status' in current
        ? next.draft.devices.findIndex((item) => item.id === current.id)
        : next.draft.objects.findIndex((item) => item.id === current.id);
    const suspended = next.candidates
      .flatMap((entry) => entry.suspendedAttachments ?? [])
      .find((entry) => entry.itemId === current.id && same(entry.placement, current.placement));
    if (!target.excludedItem.attachment && suspended)
      target.excludedItem.attachment = structuredClone(suspended.attachment);
    if (
      !target.excludedItem.attachment &&
      target.pendingAttachment &&
      same(target.pendingAttachment.placement, current.placement)
    )
      target.excludedItem.attachment = structuredClone(target.pendingAttachment.attachment);
    const parentId = target.excludedItem.attachment?.parentId;
    if (parentId)
      target.excludedParent = structuredClone(
        next.draft.objects.find((item) => item.id === parentId) ??
          (next.candidates.find((entry) => entry.sceneId === parentId)?.excludedItem as
            SceneObject | undefined) ??
          target.pendingAttachment?.parent,
      );
    target.excludedObservation = next.observations.find((entry) => entry.proposalId === proposalId);
    next.observations = next.observations.filter((entry) => entry.proposalId !== proposalId);
    if (target.matchedSceneId) {
      restoreOriginal(next.draft, base, target.matchedSceneId);
      carryAttachedChildren(before, next.draft, target.sceneId, reviewLocks(next.candidates));
    } else {
      // Bypass remove-device commands: those commands intentionally cascade evidence removal.
      next.draft.devices = next.draft.devices.filter((item) => item.id !== target.sceneId);
      next.draft.objects = next.draft.objects.filter((item) => item.id !== target.sceneId);
      target.suspendedAttachments = [];
      for (const child of allItems(next.draft)) {
        if (child.attachment?.parentId !== target.sceneId) continue;
        target.suspendedAttachments.push({
          itemId: child.id,
          attachment: structuredClone(child.attachment),
          placement: structuredClone(child.placement),
        });
        child.attachment = null;
      }
    }
    target.included = false;
  } else {
    if (!target.excludedItem) throw new Error('The excluded candidate has no saved preview edits.');
    const restored = structuredClone(target.excludedItem);
    if (restored.attachment && !itemIn(next.draft, restored.attachment.parentId)) {
      target.pendingAttachment = {
        attachment: structuredClone(restored.attachment),
        parent: target.excludedParent,
        placement: structuredClone(restored.placement),
      };
      restored.attachment = null;
    } else if (restored.attachment && target.excludedParent) {
      const oldFrame = structuredClone(next.draft);
      putItem(oldFrame, target.excludedParent);
      restored.placement = preserveLockedPlacement(
        restored.placement,
        rebaseAttachedPlacement(oldFrame, next.draft, restored),
        target.locks,
      );
      delete target.pendingAttachment;
    }
    putItem(next.draft, restored);
    if (!target.matchedSceneId && target.excludedIndex !== undefined) {
      if ('status' in restored) {
        next.draft.devices = next.draft.devices.filter((item) => item.id !== restored.id);
        next.draft.devices.splice(target.excludedIndex, 0, restored);
      } else {
        next.draft.objects = next.draft.objects.filter((item) => item.id !== restored.id);
        next.draft.objects.splice(target.excludedIndex, 0, restored);
      }
    }
    carryAttachedChildren(before, next.draft, target.sceneId, reviewLocks(next.candidates));
    if (target.excludedObservation) next.observations.push(target.excludedObservation);
    for (const suspended of target.suspendedAttachments ?? []) {
      const child = itemIn(next.draft, suspended.itemId);
      // A deliberate child edit made while its support was absent wins over restoration.
      if (child && !child.attachment && same(child.placement, suspended.placement))
        child.attachment = structuredClone(suspended.attachment);
    }
    for (const pending of next.candidates) {
      const link = pending.pendingAttachment;
      if (!link || link.attachment.parentId !== target.sceneId || !pending.included) continue;
      const child = itemIn(next.draft, pending.sceneId);
      if (child && !child.attachment && same(child.placement, link.placement)) {
        child.attachment = structuredClone(link.attachment);
        if (link.parent) {
          const oldFrame = structuredClone(next.draft);
          putItem(oldFrame, link.parent);
          child.placement = preserveLockedPlacement(
            child.placement,
            rebaseAttachedPlacement(oldFrame, next.draft, child),
            pending.locks,
          );
        }
      }
      delete pending.pendingAttachment;
    }
    target.included = true;
    delete target.excludedItem;
    delete target.excludedIndex;
    delete target.excludedParent;
    delete target.excludedObservation;
    delete target.suspendedAttachments;
  }
  return refreshSceneReview(next, base);
}

export function setSceneCandidateSupport(
  state: SceneReviewState,
  base: Workspace,
  proposalId: string,
  supportId: string | null,
): SceneReviewState {
  const candidate = state.candidates.find((entry) => entry.proposalId === proposalId);
  if (!candidate?.included) throw new Error('Include this candidate before choosing its support.');
  const candidates = state.candidates.map((entry) =>
    entry.proposalId === proposalId
      ? {
          ...entry,
          supportSource: 'user' as const,
          locks: { ...entry.locks, support: true },
          supportId:
            supportId === 'floor'
              ? supportId
              : (state.candidates.find(
                  (surface) => surface.included && surface.sceneId === supportId,
                )?.proposalId ?? supportId),
        }
      : entry,
  );
  const relations = sceneReviewSupports(candidates);
  // Include the full support subtree, independent of proposal/storage order.
  const affected = supportSubtree(relations, [candidate.sceneId]);
  const fitted = fitSceneProposalForReview(
    base,
    state.draft,
    [...affected],
    relations.map((relation) =>
      affected.has(relation.itemId) ? { ...relation, source: 'user' as const } : relation,
    ),
    {
      carryFrom: state.draft,
      lockedIds: candidates.filter((entry) => entry.locks?.position).map((entry) => entry.sceneId),
    },
  );
  return refreshSceneReview(
    { ...state, candidates: rememberUserHeightReferences(candidates, fitted.draft, affected) },
    base,
    fitted.draft,
    { origin: 'geometry' },
  );
}

/** Manual additions are user reports with unknown status, never model detections or working claims. */
export function addSceneReviewCandidate(
  state: SceneReviewState,
  base: Workspace,
  options: { kind: SceneProposalItem['kind']; name?: string; presetId?: string },
): SceneReviewState {
  const next = structuredClone(state);
  const id = uniqueId(next.draft, base, next.candidates, 'manual-item');
  const proposalId = `manual-${crypto.randomUUID()}`;
  const kind = DeviceKindSchema.safeParse(options.kind);
  let item: Item = kind.success
    ? DeviceSchema.parse({
        id,
        kind: kind.data,
        name: options.name ?? kindLabels[kind.data],
        model: '',
        source: 'user-reported',
        status: 'unknown',
        statusNote: '',
        placement: { x: 0, y: 2.51, z: 0, rotation: 0 },
        visual: defaultVisual('user-reported'),
        parts: [],
        shapeMode: 'template',
      })
    : SceneObjectSchema.parse({ ...createSceneObject(options.kind as SceneObject['kind']), id });
  if (options.name !== undefined) item.name = options.name;
  if (options.presetId) {
    const { patch } = getPhotoReviewPreset(options.presetId, options.kind);
    item = {
      ...item,
      ...patch,
      visual: {
        ...item.visual,
        ...patch.visual,
        scale: { ...item.visual.scale, ...patch.visual?.scale },
      },
    };
  }
  putItem(next.draft, item);
  const candidate: SceneReviewCandidate = {
    proposalId,
    sceneId: id,
    kind: options.kind,
    proposedName: item.name,
    included: true,
    source: 'user-reported',
    matchedSceneId: null,
    imageRegion: null,
    supportId: null,
    supportSource: 'user',
    locks: { rotation: true, scale: true },
    seed: photoPlacementSeed(item, null),
    heightReference: { y: item.placement.y, source: 'user' },
  };
  next.candidates.push(candidate);
  if (kind.success)
    next.observations.push({
      proposalId,
      sceneId: id,
      kind: kind.data,
      proposedName: item.name,
      matchedDeviceId: null,
      needsRecordChoice: retainedDevices(base).some((device) => device.kind === kind.data),
    });
  const fitted = fitSceneProposalForReview(base, WorkspaceSchema.parse(next.draft), [id], [], {
    carryFrom: next.draft,
  });
  next.candidates = rememberUserHeightReferences(next.candidates, fitted.draft, [id]);
  return refreshSceneReview(next, base, fitted.draft, { origin: 'geometry' });
}

/** Change only this observation's association, preserving both original reports and review edits. */
export function rebindSceneReviewDevice(
  state: SceneReviewState,
  base: Workspace,
  proposalId: string,
  targetId: string | null,
): SceneReviewState {
  const candidate = state.candidates.find((entry) => entry.proposalId === proposalId);
  const observation = state.observations.find((entry) => entry.proposalId === proposalId);
  if (!candidate?.included || !observation) throw new Error('Included device candidate not found.');
  const current = state.draft.devices.find((device) => device.id === candidate.sceneId);
  if (!current) throw new Error('Review device not found.');
  if (targetId === observation.matchedDeviceId) {
    return refreshSceneReview(
      {
        ...state,
        observations: state.observations.map((entry) =>
          entry.proposalId === proposalId ? { ...entry, needsRecordChoice: false } : entry,
        ),
      },
      base,
    );
  }
  if (
    targetId &&
    state.candidates.some(
      (entry) => entry.proposalId !== proposalId && entry.matchedSceneId === targetId,
    )
  )
    throw new Error('That saved device is already assigned to another review candidate.');
  const target = targetId
    ? retainedDevices(base).find((device) => device.id === targetId && device.kind === current.kind)
    : undefined;
  if (targetId && !target) throw new Error('Choose an existing device of the same type.');
  const next = structuredClone(state);
  const updated = next.candidates.find((entry) => entry.proposalId === proposalId)!;
  if (candidate.matchedSceneId) restoreOriginal(next.draft, base, candidate.matchedSceneId);
  else next.draft.devices = next.draft.devices.filter((device) => device.id !== current.id);
  const replacement = DeviceSchema.parse(
    target
      ? {
          ...target,
          placement: current.placement,
          visual: current.visual,
          parts: current.parts,
          shapeMode: current.shapeMode,
        }
      : {
          ...current,
          id: uniqueId(next.draft, base, next.candidates, `photo-${proposalId}`),
          name: candidate.proposedName,
          model: '',
          source: candidate.source,
          status: 'unknown',
          statusNote: '',
          attachment: null,
          hardwareBinding: undefined,
          hardwareOrigin: undefined,
        },
  );
  putItem(next.draft, replacement);
  updated.sceneId = replacement.id;
  updated.matchedSceneId = targetId;
  next.adjustments = next.adjustments?.map((adjustment) =>
    adjustment.itemId === current.id ? { ...adjustment, itemId: replacement.id } : adjustment,
  );
  if (next.editedSupportIds?.includes(current.id))
    next.editedSupportIds = [
      ...new Set(next.editedSupportIds.map((id) => (id === current.id ? replacement.id : id))),
    ];
  for (const other of next.candidates)
    if (other.supportId === current.id) other.supportId = replacement.id;
  next.observations = next.observations.map((entry) =>
    entry.proposalId === proposalId
      ? {
          ...entry,
          sceneId: replacement.id,
          matchedDeviceId: targetId,
          needsRecordChoice: false,
        }
      : entry,
  );
  return refreshSceneReview(next, base);
}

import { z } from 'zod';
import type { Workspace } from './workspace';
import {
  PhotoObjectCandidateSchema,
  PhotoObjectListSchema,
  type PhotoObjectCandidate,
  type PhotoSelectionItem,
} from './sceneProposal';

export const PhotoRegionSourceSchema = z.enum(['sam', 'model', 'none']);
export const PhotoObjectsResponseSchema = z
  .strictObject({
    message: PhotoObjectListSchema.shape.message,
    objects: z.array(PhotoObjectCandidateSchema).max(32),
    regionSources: z.record(z.string(), PhotoRegionSourceSchema),
    sam: z.strictObject({
      enabled: z.boolean(),
      requests: z.number().int().min(0).max(32),
      failed: z.number().int().min(0).max(32),
    }),
  })
  .superRefine((value, ctx) => {
    const ids = value.objects.map((object) => object.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate object ID.' });
    const keys = Object.keys(value.regionSources);
    if (keys.length !== ids.length || ids.some((id) => value.regionSources[id] === undefined))
      ctx.addIssue({ code: 'custom', message: 'Region sources must match the object ids.' });
    value.objects.forEach((object, index) => {
      const source = value.regionSources[object.id];
      const absent = object.imageRegion === null;
      if (source === 'none' && !absent)
        ctx.addIssue({
          code: 'custom',
          path: ['objects', index, 'imageRegion'],
          message: 'An absent region must be null.',
        });
      if ((source === 'model' || source === 'sam') && absent)
        ctx.addIssue({
          code: 'custom',
          path: ['regionSources', object.id],
          message: 'A reported region needs a rectangle.',
        });
    });
    if (value.sam.failed > value.sam.requests)
      ctx.addIssue({
        code: 'custom',
        path: ['sam', 'failed'],
        message: 'Failed SAM requests cannot exceed attempts.',
      });
  });
export type PhotoObjectsResponse = z.infer<typeof PhotoObjectsResponseSchema>;
export type PhotoRegionSource = z.infer<typeof PhotoRegionSourceSchema>;

export interface PhotoObjectsRequest {
  image: string;
  consent: true;
  workspace: Workspace;
  context?: string;
}

export async function findPhotoObjects(body: PhotoObjectsRequest, signal?: AbortSignal) {
  const response = await fetch('/api/photo/objects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof payload.error === 'string'
        ? payload.error
        : 'Photo object detection failed.';
    throw new Error(message);
  }
  return PhotoObjectsResponseSchema.parse(payload);
}

/** Stage-2 body: chosen inventory rows only, without SAM phrases or region provenance. */
export function photoSceneRequest(
  request: PhotoObjectsRequest,
  objects: readonly Pick<PhotoObjectCandidate, 'id' | 'kind' | 'name' | 'imageRegion'>[],
): PhotoObjectsRequest & { selection: { objects: PhotoSelectionItem[] } } {
  return {
    image: request.image,
    consent: request.consent,
    workspace: request.workspace,
    ...(request.context === undefined ? {} : { context: request.context }),
    selection: {
      objects: objects.map((object) => ({
        id: object.id,
        kind: object.kind,
        name: object.name,
        imageRegion: object.imageRegion,
      })),
    },
  };
}

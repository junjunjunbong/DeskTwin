import { SceneImageRegionSchema, type PhotoObjectCandidate } from '../src/domain/sceneProposal';
import { abortable, ApiError, cancelBody, metaURL, type MetaConfig } from './meta';

const phraseTimeoutMs = 15_000;
const overallTimeoutMs = 25_000;
const samConcurrency = 2;
const responseByteLimit = 1_000_000;

export interface SamBox {
  objectId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  confidence?: number;
}

export type PhotoRegionSource = 'sam' | 'model' | 'none';

type Region = { x: number; y: number; width: number; height: number };

/** Image output is one `<Nf>` line. A bad record is skipped; an empty lane is no match. */
export function parseSamBoxes(outputText: string): SamBox[] {
  if (outputText.trim() === '') return [];
  const boxes: SamBox[] = [];
  for (const line of outputText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) boxes.push(...parseSamLine(trimmed));
  }
  return boxes;
}

function parseSamLine(line: string): SamBox[] {
  const frame = /^<(\d+)f>/.exec(line);
  if (!frame || !Number.isSafeInteger(Number(frame[1]))) return [];
  const boxes: SamBox[] = [];
  let index = frame[0].length;
  while (index < line.length) {
    if (line[index] === ',') {
      index += 1;
      continue;
    }
    const id = readInt(line, index);
    const box = id ? readToken(line, id.next, 'box') : null;
    const mask = box ? readToken(line, box.next, 'mask') : null;
    if (!id || !box || !mask) {
      const next = resync(line, index);
      if (next <= index) break;
      index = next;
      continue;
    }
    const parsed = parseBox(box.body);
    const maskInfo = readMask(mask.body);
    if (parsed && maskInfo) {
      const confidence = parsed.confidence ?? maskInfo.confidence;
      boxes.push({
        objectId: id.value,
        x1: parsed.x1,
        y1: parsed.y1,
        x2: parsed.x2,
        y2: parsed.y2,
        width: parsed.width,
        height: parsed.height,
        ...(confidence === undefined ? {} : { confidence }),
      });
    }
    index = mask.next;
  }
  return boxes;
}

function readInt(text: string, index: number): { value: number; next: number } | null {
  const match = /^(\d+)/.exec(text.slice(index));
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value)) return null;
  return { value, next: index + match[1].length };
}

// Mask payloads may contain "|", ",", "~", and "!". A token ends at the "|>" closer.
function readToken(
  line: string,
  index: number,
  kind: 'box' | 'mask',
): { body: string; next: number } | null {
  const open = `<|${kind};`;
  if (!line.startsWith(open, index)) return null;
  const bodyStart = index + open.length;
  const end = line.indexOf('|>', bodyStart);
  if (end < 0) return null;
  return { body: line.slice(bodyStart, end), next: end + 2 };
}

function resync(line: string, index: number) {
  const match = /\d+<\|box;/.exec(line.slice(index + 1));
  return match ? index + 1 + match.index : line.length;
}

function parseFields(body: string): Record<string, string> | null {
  if (!body) return null;
  const fields: Record<string, string> = {};
  for (const part of body.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) return null;
    const key = part.slice(0, separator);
    if (!/^[a-z][a-z0-9]*$/.test(key) || Object.hasOwn(fields, key)) return null;
    fields[key] = part.slice(separator + 1);
  }
  return fields;
}

function parseConfidence(value: string): number | null {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return null;
  return parsed;
}

function parseBox(body: string): Omit<SamBox, 'objectId'> | null {
  const fields = parseFields(body);
  if (!fields) return null;
  const allowed = new Set(['x1', 'y1', 'x2', 'y2', 'w', 'h', 'c']);
  if (Object.keys(fields).some((key) => !allowed.has(key))) return null;
  if (!['x1', 'y1', 'x2', 'y2', 'w', 'h'].every((key) => key in fields)) return null;
  const x1 = readFieldInt(fields.x1);
  const y1 = readFieldInt(fields.y1);
  const x2 = readFieldInt(fields.x2);
  const y2 = readFieldInt(fields.y2);
  const width = readFieldInt(fields.w);
  const height = readFieldInt(fields.h);
  if (
    x1 === null ||
    y1 === null ||
    x2 === null ||
    y2 === null ||
    width === null ||
    height === null ||
    width < 1 ||
    height < 1 ||
    x1 > x2 ||
    y1 > y2 ||
    x2 >= width ||
    y2 >= height
  )
    return null;
  if (!('c' in fields)) return { x1, y1, x2, y2, width, height };
  const confidence = parseConfidence(fields.c);
  if (confidence === null) return null;
  return { x1, y1, x2, y2, width, height, confidence };
}

function readFieldInt(value: string | undefined): number | null {
  if (!value || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readMask(body: string): { confidence?: number } | null {
  const match = /^x=0;y=0(?:;c=([0-9]+(?:\.[0-9]+)?))?;data=([0-9]+),([0-9]+),([~!])/.exec(body);
  if (!match) return null;
  const height = Number(match[2]);
  const width = Number(match[3]);
  if (!Number.isSafeInteger(height) || !Number.isSafeInteger(width) || height < 1 || width < 1)
    return null;
  if (match[1] === undefined) return {};
  const confidence = parseConfidence(match[1]);
  return confidence === null ? null : { confidence };
}

export function samBoxToRegion(box: SamBox): Region | null {
  if (
    box.width < 1 ||
    box.height < 1 ||
    box.x1 > box.x2 ||
    box.y1 > box.y2 ||
    box.x2 >= box.width ||
    box.y2 >= box.height
  )
    return null;
  const parsed = SceneImageRegionSchema.safeParse({
    x: box.x1 / box.width,
    y: box.y1 / box.height,
    width: (box.x2 - box.x1 + 1) / box.width,
    height: (box.y2 - box.y1 + 1) / box.height,
  });
  return parsed.success ? parsed.data : null;
}

function iou(a: Region, b: Region) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return 0;
  const intersection = width * height;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function modelSources(objects: readonly PhotoObjectCandidate[]): Record<string, PhotoRegionSource> {
  return Object.fromEntries(
    objects.map((object) => [object.id, object.imageRegion ? 'model' : 'none']),
  );
}

/** Pair boxes inside one noun phrase. Unmatched objects keep the stage-1 region. */
export function matchSamRegions(objects: PhotoObjectCandidate[], boxes: SamBox[]) {
  const normalized = boxes.flatMap((box, index) => {
    const region = samBoxToRegion(box);
    return region ? [{ region, confidence: box.confidence ?? -1, index }] : [];
  });
  const assigned = new Map<string, (typeof normalized)[number]>();
  const usedBoxes = new Set<number>();
  const pairs = objects.flatMap((object) => {
    if (!object.imageRegion) return [];
    return normalized.flatMap((box, boxIndex) => {
      const score = iou(object.imageRegion!, box.region);
      return score > 0 ? [{ id: object.id, boxIndex, score }] : [];
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.boxIndex - b.boxIndex);
  const usedObjects = new Set<string>();
  for (const pair of pairs) {
    if (usedObjects.has(pair.id) || usedBoxes.has(pair.boxIndex)) continue;
    usedObjects.add(pair.id);
    usedBoxes.add(pair.boxIndex);
    assigned.set(pair.id, normalized[pair.boxIndex]);
  }
  const remaining = normalized
    .map((box, boxIndex) => ({ box, boxIndex }))
    .filter((item) => !usedBoxes.has(item.boxIndex))
    .sort((a, b) => b.box.confidence - a.box.confidence || a.box.index - b.box.index);
  let cursor = 0;
  for (const object of objects) {
    if (object.imageRegion || assigned.has(object.id)) continue;
    const next = remaining[cursor];
    if (!next) break;
    cursor += 1;
    assigned.set(object.id, next.box);
  }
  const regionSources: Record<string, PhotoRegionSource> = {};
  const nextObjects = objects.map((object) => {
    const match = assigned.get(object.id);
    if (!match) {
      regionSources[object.id] = object.imageRegion ? 'model' : 'none';
      return object;
    }
    regionSources[object.id] = 'sam';
    return { ...object, imageRegion: match.region };
  });
  return { objects: nextObjects, regionSources };
}

function samModelName(config: MetaConfig) {
  return config.samModel?.trim() || 'sam-3.1';
}

async function readBoundedBody(response: Response, signal: AbortSignal) {
  if (Number(response.headers.get('content-length') || 0) > responseByteLimit)
    throw new Error('Too large');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty response');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > responseByteLimit) throw new Error('Too large');
      chunks.push(value);
    }
    complete = true;
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function outputText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { status?: unknown; output?: unknown };
  if (record.status !== undefined && record.status !== 'completed') return null;
  if (!Array.isArray(record.output)) return null;
  const parts: string[] = [];
  for (const item of record.output) {
    if (!item || typeof item !== 'object') continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const typed = part as { type?: unknown; text?: unknown };
      if (typed.type !== 'output_text') continue;
      if (typeof typed.text !== 'string') return null;
      parts.push(typed.text);
    }
  }
  return parts.join('');
}

async function postSam(config: MetaConfig, phrase: string, image: string, signal: AbortSignal) {
  const fetcher = config.fetchImpl || fetch;
  signal.throwIfAborted();
  const response = await abortable(
    fetcher(metaURL(config, 'responses'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      signal,
      redirect: 'error',
      body: JSON.stringify({
        model: samModelName(config),
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: phrase },
              { type: 'input_image', image_url: image },
            ],
          },
        ],
        stream: false,
        metadata: { include_confidence: 'true' },
      }),
    }),
    signal,
    cancelBody,
  );
  if (!response.ok) {
    cancelBody(response);
    throw new Error('SAM request failed');
  }
  const text = outputText(JSON.parse(await readBoundedBody(response, signal)));
  if (text === null) throw new Error('SAM response was not readable');
  return text;
}

async function segmentPhrase(
  config: MetaConfig,
  image: string,
  phrase: string,
  parent: AbortSignal | undefined,
  overall: AbortSignal,
) {
  const phraseDeadline = new AbortController();
  const timer = setTimeout(
    () => phraseDeadline.abort(new DOMException('SAM phrase deadline exceeded.', 'TimeoutError')),
    phraseTimeoutMs,
  );
  timer.unref();
  const signal = parent
    ? AbortSignal.any([parent, overall, phraseDeadline.signal])
    : AbortSignal.any([overall, phraseDeadline.signal]);
  try {
    if (parent?.aborted)
      throw new ApiError(499, 'The request was canceled. Your workspace was not changed.');
    const text = await postSam(config, phrase, image, signal);
    if (parent?.aborted)
      throw new ApiError(499, 'The request was canceled. Your workspace was not changed.');
    return parseSamBoxes(text);
  } catch (error) {
    if (parent?.aborted)
      throw error instanceof ApiError
        ? error
        : new ApiError(499, 'The request was canceled. Your workspace was not changed.');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function segmentPhotoObjects(
  config: MetaConfig,
  image: string,
  objects: PhotoObjectCandidate[],
  parent?: AbortSignal,
): Promise<{
  objects: PhotoObjectCandidate[];
  regionSources: Record<string, PhotoRegionSource>;
  sam: { enabled: boolean; requests: number; failed: number };
}> {
  if (!config.samEnabled)
    return {
      objects,
      regionSources: modelSources(objects),
      sam: { enabled: false, requests: 0, failed: 0 },
    };
  const phrases: string[] = [];
  for (const object of objects)
    if (!phrases.includes(object.samPhrase)) phrases.push(object.samPhrase);
  const overall = new AbortController();
  const overallTimer = setTimeout(
    () => overall.abort(new DOMException('SAM deadline exceeded.', 'TimeoutError')),
    overallTimeoutMs,
  );
  overallTimer.unref();
  const boxesByPhrase = new Map<string, SamBox[] | null>();
  let requests = 0;
  let failed = 0;
  let cursor = 0;
  const canceled = () => parent?.aborted === true;
  const worker = async () => {
    for (;;) {
      if (canceled())
        throw new ApiError(499, 'The request was canceled. Your workspace was not changed.');
      const index = cursor++;
      if (index >= phrases.length) return;
      requests += 1;
      const boxes = await segmentPhrase(config, image, phrases[index], parent, overall.signal);
      if (canceled())
        throw new ApiError(499, 'The request was canceled. Your workspace was not changed.');
      if (boxes === null) failed += 1;
      boxesByPhrase.set(phrases[index], boxes);
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(samConcurrency, phrases.length) }, () =>
        worker().catch((error: unknown) => {
          if (canceled()) return;
          throw error;
        }),
      ),
    );
    if (canceled())
      throw new ApiError(499, 'The request was canceled. Your workspace was not changed.');
  } finally {
    clearTimeout(overallTimer);
  }
  let next = objects;
  let regionSources = modelSources(objects);
  for (const phrase of phrases) {
    const boxes = boxesByPhrase.get(phrase);
    if (!boxes) continue;
    const matched = matchSamRegions(
      next.filter((object) => object.samPhrase === phrase),
      boxes,
    );
    const byId = new Map(matched.objects.map((object) => [object.id, object]));
    next = next.map((object) => byId.get(object.id) ?? object);
    regionSources = { ...regionSources, ...matched.regionSources };
  }
  return { objects: next, regionSources, sam: { enabled: true, requests, failed } };
}

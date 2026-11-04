import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PhotoObjectCandidate } from '../src/domain/sceneProposal';
import { parseSamBoxes, segmentPhotoObjects } from './sam';
import type { MetaConfig } from './meta';

afterEach(() => vi.useRealTimers());

const image = 'data:image/jpeg;base64,YWJj';

function candidate(
  id: string,
  phrase: string,
  region: PhotoObjectCandidate['imageRegion'],
): PhotoObjectCandidate {
  return {
    id,
    kind: 'monitor',
    name: id,
    samPhrase: phrase,
    imageRegion: region,
    imageRegionVisibility: region ? 'complete' : 'unknown',
  };
}

function box(id: number, x1: number, y1: number, x2: number, y2: number, confidence?: number) {
  const score = confidence === undefined ? '' : `;c=${confidence}`;
  return `${id}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=1000;h=1000${score}|><|mask;x=0;y=0${score};data=4,4,~ok|>`;
}

function config(fetchImpl: typeof fetch, overrides: Partial<MetaConfig> = {}): MetaConfig {
  return {
    apiKey: 'test-only-secret',
    model: 'muse-spark-1.3',
    baseURL: 'https://api.meta.ai/v1',
    samEnabled: true,
    samModel: 'sam-3.1',
    fetchImpl,
    ...overrides,
  };
}

function samResponse(text: string, status = 200) {
  return new Response(
    JSON.stringify({
      id: 'resp_test',
      object: 'response',
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text, annotations: [] }],
        },
      ],
    }),
    { status },
  );
}

describe('SAM box text', () => {
  it('reads several records, with and without confidence, without cutting a mask on special characters', () => {
    const payload = '~a|b,c~d!e,1<|box;fake|tail';
    const line = `<0f>0<|box;x1=10;y1=20;x2=109;y2=219;w=1000;h=800|><|mask;x=0;y=0;data=40,80,${payload}|>,1<|box;broken|>,4<|box;x1=400;y1=100;x2=699;y2=499;w=1000;h=800;c=0.9609375|><|mask;x=0;y=0;c=0.9609375;data=50,60,!xy|z,~!|>,9<|box;x1=0;y1=0;x2=1000;y2=10;w=1000;h=800|><|mask;x=0;y=0;data=1,1,~a|>`;
    expect(parseSamBoxes(line)).toEqual([
      { objectId: 0, x1: 10, y1: 20, x2: 109, y2: 219, width: 1000, height: 800 },
      {
        objectId: 4,
        x1: 400,
        y1: 100,
        x2: 699,
        y2: 499,
        width: 1000,
        height: 800,
        confidence: 0.9609375,
      },
    ]);
  });

  it('reads confidence from the mask when the box omits it', () => {
    expect(
      parseSamBoxes(
        '<0f>2<|box;x1=0;y1=0;x2=1;y2=1;w=10;h=10|><|mask;x=0;y=0;c=0.25;data=2,2,!ab|>',
      ),
    ).toEqual([
      { objectId: 2, x1: 0, y1: 0, x2: 1, y2: 1, width: 10, height: 10, confidence: 0.25 },
    ]);
  });

  it('treats empty and unreadable output as no boxes', () => {
    expect(parseSamBoxes('')).toEqual([]);
    expect(parseSamBoxes(' \n\t')).toEqual([]);
    expect(parseSamBoxes('<0f>')).toEqual([]);
    expect(parseSamBoxes('not a frame')).toEqual([]);
    expect(
      parseSamBoxes(
        '<0f>3<|box;x1=0;y1=0;x2=1;y2=1;w=10;h=10;c=1.5|><|mask;x=0;y=0;c=1.5;data=2,2,~z|>',
      ),
    ).toEqual([]);
  });
});

describe('SAM region pairing', () => {
  const left = candidate('monitor-a', 'black monitor', { x: 0, y: 0, width: 0.2, height: 0.2 });
  const right = candidate('monitor-b', 'black monitor', {
    x: 0.55,
    y: 0.1,
    width: 0.3,
    height: 0.3,
  });

  it('pairs two boxes with two objects of the same phrase by overlap, not by reply order', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        samResponse(`<0f>${box(7, 600, 100, 899, 399, 0.4)},${box(2, 0, 0, 199, 199, 0.99)}`),
      );
    const result = await segmentPhotoObjects(config(fetchImpl), image, [left, right]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.sam).toEqual({ enabled: true, requests: 1, failed: 0 });
    expect(result.regionSources).toEqual({ 'monitor-a': 'sam', 'monitor-b': 'sam' });
    expect(result.objects[0].imageRegion).toEqual({ x: 0, y: 0, width: 0.2, height: 0.2 });
    expect(result.objects[1].imageRegion).toEqual({ x: 0.6, y: 0.1, width: 0.3, height: 0.3 });
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(fetchImpl.mock.calls[0][0]).toBe('https://api.meta.ai/v1/responses');
    expect(body.model).toBe('sam-3.1');
    expect(body.stream).toBe(false);
    expect(body.metadata).toEqual({ include_confidence: 'true' });
    expect(body.input[0].content[0]).toEqual({ type: 'input_text', text: 'black monitor' });
    expect(body.input[0].content[1].image_url).toBe(image);
    expect(JSON.stringify(body)).not.toContain('test-only-secret');
  });

  it('keeps the inventory rectangle when a phrase returns fewer boxes', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(samResponse(`<0f>${box(2, 0, 0, 199, 199)}`));
    const result = await segmentPhotoObjects(config(fetchImpl), image, [left, right]);
    expect(result.regionSources).toEqual({ 'monitor-a': 'sam', 'monitor-b': 'model' });
    expect(result.objects[1].imageRegion).toEqual(right.imageRegion);
  });

  it('assigns boxes by confidence when the inventory has no rectangle', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        samResponse(`<0f>${box(1, 0, 0, 99, 99, 0.2)},${box(2, 500, 500, 599, 599, 0.9)}`),
      );
    const result = await segmentPhotoObjects(config(fetchImpl), image, [
      candidate('monitor-a', 'black monitor', null),
      candidate('monitor-b', 'black monitor', null),
    ]);
    expect(result.regionSources).toEqual({ 'monitor-a': 'sam', 'monitor-b': 'sam' });
    expect(result.objects[0].imageRegion).toEqual({ x: 0.5, y: 0.5, width: 0.1, height: 0.1 });
    expect(result.objects[1].imageRegion).toEqual({ x: 0, y: 0, width: 0.1, height: 0.1 });
  });

  it('keeps inventory rectangles when SAM returns HTTP 500 or times out', async () => {
    const http = vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 500 }));
    const httpResult = await segmentPhotoObjects(config(http), image, [left]);
    expect(httpResult.sam).toEqual({ enabled: true, requests: 1, failed: 1 });
    expect(httpResult.regionSources).toEqual({ 'monitor-a': 'model' });
    expect(httpResult.objects[0].imageRegion).toEqual(left.imageRegion);

    vi.useFakeTimers();
    const hung = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
    const pending = segmentPhotoObjects(config(hung), image, [left, right]);
    await vi.advanceTimersByTimeAsync(15_000);
    const timedOut = await pending;
    expect(timedOut.sam).toEqual({ enabled: true, requests: 1, failed: 1 });
    expect(timedOut.regionSources).toEqual({ 'monitor-a': 'model', 'monitor-b': 'model' });
    expect(timedOut.objects.map((object) => object.imageRegion)).toEqual([
      left.imageRegion,
      right.imageRegion,
    ]);
  });

  it('does not call SAM when it is disabled', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const samEnabled of [false, undefined]) {
      const result = await segmentPhotoObjects(config(fetchImpl, { samEnabled }), image, [left]);
      expect(result.sam).toEqual({ enabled: false, requests: 0, failed: 0 });
      expect(result.regionSources).toEqual({ 'monitor-a': 'model' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('runs at most two phrase requests at a time and continues after one failure', async () => {
    const gates: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          gates.push(resolve);
        }),
    );
    const objects = [
      candidate('desk', 'desk surface', { x: 0, y: 0.5, width: 0.4, height: 0.2 }),
      candidate('lamp', 'desk lamp', { x: 0.7, y: 0.1, width: 0.2, height: 0.3 }),
      candidate('mug', 'white mug', null),
    ];
    const pending = segmentPhotoObjects(config(fetchImpl), image, objects);
    await expect.poll(() => gates.length).toBe(2);
    expect(gates).toHaveLength(2);
    gates[0](new Response('bad', { status: 500 }));
    await expect.poll(() => gates.length).toBe(3);
    gates[1](samResponse(''));
    gates[2](samResponse(`<0f>${box(1, 0, 0, 99, 99, 0.8)}`));
    const result = await pending;
    expect(result.sam).toEqual({ enabled: true, requests: 3, failed: 1 });
    expect(result.regionSources.desk).toBe('model');
    expect(result.regionSources.lamp).toBe('model');
    expect(result.regionSources.mug).toBe('sam');
  });

  it('propagates caller cancellation instead of returning a partial inventory', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const controller = new AbortController();
    const pending = segmentPhotoObjects(config(fetchImpl), image, [left], controller.signal);
    const canceled = expect(pending).rejects.toMatchObject({ status: 499 });
    await expect.poll(() => signal?.aborted).toBe(false);
    controller.abort();
    await canceled;
    expect(signal?.aborted).toBe(true);
  });
});

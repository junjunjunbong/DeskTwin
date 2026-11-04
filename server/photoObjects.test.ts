import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from './app';
import { callMetaPhotoObjects, photoObjectListResponseSchema } from './meta';
import type { PhotoObjectList } from '../src/domain/sceneProposal';
import { createDemoWorkspace } from '../src/domain/workspace';
import {
  findPhotoObjects,
  photoSceneRequest,
  PhotoObjectsResponseSchema,
} from '../src/domain/photoObjects';

const servers: Server[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function app(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const server = createApp({
    apiKey: '',
    model: 'muse-spark-1.3',
    baseURL: 'https://api.meta.ai/v1',
    ...overrides,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return `http://127.0.0.1:${address.port}`;
}

const post = (url: string, path: string, body: unknown, signal?: AbortSignal) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

const photoBody = () => ({
  image: 'data:image/jpeg;base64,YWJj',
  consent: true as const,
  workspace: createDemoWorkspace(),
  context: 'The laptop is on the left.',
});

const inventory = (): PhotoObjectList => ({
  message: 'Visible objects only. This is not a placement or a working-device check.',
  objects: [
    {
      id: 'monitor-a',
      kind: 'monitor',
      name: 'Left monitor',
      samPhrase: 'black computer monitor',
      imageRegion: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
      imageRegionVisibility: 'complete',
    },
    {
      id: 'mug-a',
      kind: 'mug',
      name: 'White mug',
      samPhrase: 'white mug',
      imageRegion: null,
      imageRegionVisibility: 'unknown',
    },
  ],
});

const upstream = (content: unknown, status = 200) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
    }),
    { status },
  );

const scene = () => ({
  message: 'A coarse desk layout inferred from the photo. Review every object before applying.',
  objects: [
    {
      id: 'photo-monitor',
      deviceId: null,
      kind: 'monitor',
      name: 'Monitor in photo',
      placement: { x: 1, y: 2.51, z: -0.5, rotation: -8 },
      scale: { x: 1.2, y: 1, z: 1 },
      color: '#27303d',
      parts: [],
      note: 'Visible monitor shape.',
      supportId: 'floor',
      imageRegion: { x: 0.01, y: 0.01, width: 0.1, height: 0.1 },
      imageRegionVisibility: 'partial',
    },
    {
      id: 'photo-mug',
      deviceId: null,
      kind: 'mug',
      name: 'Mug in photo',
      placement: { x: -0.4, y: 2.51, z: 0.4, rotation: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: '#f4f4f4',
      parts: [],
      note: '',
      supportId: 'floor',
      imageRegion: { x: 0.4, y: 0.4, width: 0.15, height: 0.15 },
      imageRegionVisibility: 'complete',
    },
  ],
});

describe('photo object inventory', () => {
  it('validates an inventory and omits placement from the provider schema', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(inventory()));
    const url = await app({ apiKey: 'test-only-secret', fetchImpl });
    const response = await post(url, '/api/photo/objects', photoBody());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ...inventory(),
      regionSources: { 'monitor-a': 'model', 'mug-a': 'none' },
      sam: { enabled: false, requests: 0, failed: 0 },
    });
    expect(body.mode).toBeUndefined();
    expect(PhotoObjectsResponseSchema.parse(body)).toEqual(body);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [endpoint, options] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe('https://api.meta.ai/v1/chat/completions');
    const sent = JSON.parse(String(options?.body));
    expect(sent.max_completion_tokens).toBe(3000);
    expect(sent.response_format.json_schema.name).toBe('desktwin_photo_objects');
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.schema).toEqual(photoObjectListResponseSchema);
    expect(JSON.stringify(photoObjectListResponseSchema)).not.toContain('"oneOf"');
    expect(JSON.stringify(photoObjectListResponseSchema)).toContain('"additionalProperties":false');
    const prompt = sent.messages[0].content as string;
    expect(prompt).toContain('photo-inferred');
    expect(prompt).toContain('user-reported');
    expect(prompt).toContain('samPhrase');
    expect(prompt).not.toContain('TEMPLATE DIMENSIONS');
    expect(sent.messages[2].content).toContain(JSON.stringify(photoBody().context));
    expect(sent.messages.at(-1).content[1].image_url.url).toBe(photoBody().image);
    expect(JSON.stringify(sent)).not.toContain('test-only-secret');
  });

  it('rejects placement, status, connection, and executable fields, and more than 32 objects', async () => {
    const listed = inventory();
    const cases: unknown[] = [
      {
        ...listed,
        objects: [{ ...listed.objects[0], placement: { x: 0, y: 0, z: 0, rotation: 0 } }],
      },
      { ...listed, objects: [{ ...listed.objects[0], scale: { x: 1, y: 1, z: 1 } }] },
      { ...listed, objects: [{ ...listed.objects[0], rotation: 12 }] },
      { ...listed, objects: [{ ...listed.objects[0], supportId: 'floor' }] },
      { ...listed, connections: [{ from: 'laptop', to: 'dock' }] },
      { ...listed, status: 'reported-working' },
      { ...listed, objects: [{ ...listed.objects[0], status: 'unknown' }] },
      { ...listed, code: 'alert(1)' },
      { ...listed, objects: [{ ...listed.objects[0], code: 'eval(1)' }] },
      { ...listed, objects: [{ ...listed.objects[0], samPhrase: 'bus, bicycle' }] },
      {
        ...listed,
        objects: [{ ...listed.objects[0], samPhrase: 'one two three four five six seven' }],
      },
      {
        ...listed,
        objects: Array.from({ length: 33 }, (_, index) => ({
          ...listed.objects[0],
          id: `object-${index}`,
        })),
      },
    ];
    for (const malicious of cases) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(malicious));
      const url = await app({ apiKey: 'test-only-secret', fetchImpl });
      expect((await post(url, '/api/photo/objects', photoBody())).status).toBe(502);
    }
  });

  it('requires consent and a configured key before any provider call', async () => {
    const fetchImpl = vi.fn();
    const url = await app({ fetchImpl });
    expect(
      (await post(url, '/api/photo/objects', { ...photoBody(), consent: undefined })).status,
    ).toBe(400);
    expect((await post(url, '/api/photo/objects', photoBody())).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps OS-derived records out of the inventory provider payload', async () => {
    const workspace = createDemoWorkspace();
    workspace.devices[2].name = 'PRIVATE OS MONITOR';
    workspace.devices[2].model = 'PRIVATE OS MODEL';
    workspace.devices[2].source = 'os-detected';
    workspace.devices[2].hardwareOrigin = 'macos';
    workspace.devices[2].hardwareBinding = {
      category: 'display',
      identity: {
        key: 'private_local_identity',
        stability: 'persistent',
        scope: 'installation_private_scope',
      },
      approvedAt: new Date().toISOString(),
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(inventory()));
    const url = await app({ apiKey: 'test-only-secret', fetchImpl });
    expect((await post(url, '/api/photo/objects', { ...photoBody(), workspace })).status).toBe(200);
    const body = String(fetchImpl.mock.calls[0][1]?.body);
    expect(body).toContain('Left monitor');
    for (const privateValue of [
      'PRIVATE OS',
      'private_local_identity',
      'installation_private_scope',
      'hardwareBinding',
      'hardwareOrigin',
      'monitor-right',
    ])
      expect(body).not.toContain(privateValue);
  });

  it('uses a 30 second inventory deadline and propagates cancellation', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const pending = callMetaPhotoObjects(
      {
        apiKey: 'test-only-secret',
        model: 'mock-only',
        baseURL: 'https://api.meta.ai/v1',
        fetchImpl: (_input, init) => {
          signal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        },
      },
      createDemoWorkspace(),
      { image: photoBody().image },
    );
    const timedOut = expect(pending).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await timedOut;
    expect(signal?.aborted).toBe(true);
    vi.useRealTimers();

    let live: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, init) => {
      live = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const url = await app({ apiKey: 'test-only-secret', fetchImpl });
    const controller = new AbortController();
    const request = post(url, '/api/photo/objects', photoBody(), controller.signal);
    await expect.poll(() => fetchImpl.mock.calls.length).toBe(1);
    controller.abort();
    await expect(request).rejects.toThrow();
    await expect.poll(() => live?.aborted).toBe(true);
  });

  it('keeps the inventory when SAM fails and skips SAM when disabled', async () => {
    const disabled = vi.fn<typeof fetch>().mockResolvedValue(upstream(inventory()));
    const off = await app({ apiKey: 'test-only-secret', fetchImpl: disabled, samEnabled: false });
    const offBody = await (await post(off, '/api/photo/objects', photoBody())).json();
    expect(offBody.sam).toEqual({ enabled: false, requests: 0, failed: 0 });
    expect(disabled).toHaveBeenCalledOnce();

    const enabled = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(upstream(inventory()))
      .mockResolvedValueOnce(new Response('sam failed', { status: 500 }))
      .mockResolvedValueOnce(new Response('sam failed', { status: 500 }));
    const url = await app({
      apiKey: 'test-only-secret',
      fetchImpl: enabled,
      samEnabled: true,
      samModel: 'sam-3.1',
    });
    const response = await post(url, '/api/photo/objects', photoBody());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.objects).toEqual(inventory().objects);
    expect(body.regionSources).toEqual({ 'monitor-a': 'model', 'mug-a': 'none' });
    expect(body.sam).toEqual({ enabled: true, requests: 2, failed: 2 });
    expect(JSON.stringify(body)).not.toContain('sam failed');
    expect(String(enabled.mock.calls[1][0])).toBe('https://api.meta.ai/v1/responses');
  });
});

describe('selected scene placement', () => {
  const selectedRegion = { x: 0.2, y: 0.3, width: 0.4, height: 0.25 };
  const selection = () => ({
    objects: [
      {
        id: 'photo-monitor',
        kind: 'monitor' as const,
        name: 'Monitor in photo',
        imageRegion: selectedRegion,
      },
      { id: 'photo-mug', kind: 'mug' as const, name: 'Mug in photo', imageRegion: null },
    ],
  });

  it('rejects an id outside the selection and copies a provided rectangle', async () => {
    const outside = vi.fn<typeof fetch>().mockResolvedValue(upstream(scene()));
    const outsideUrl = await app({ apiKey: 'test-only-secret', fetchImpl: outside });
    const rejected = await post(outsideUrl, '/api/photo', {
      ...photoBody(),
      selection: { objects: [selection().objects[0]] },
    });
    expect(rejected.status).toBe(502);
    expect(await rejected.json()).toEqual({
      error:
        'The model returned an object outside the selected photo list. No changes were applied.',
    });

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(scene()));
    const url = await app({ apiKey: 'test-only-secret', fetchImpl });
    const response = await post(url, '/api/photo', { ...photoBody(), selection: selection() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.objects[0].imageRegion).toEqual(selectedRegion);
    expect(body.objects[1].imageRegion).toEqual(scene().objects[1].imageRegion);
    expect(body.mode).toBe('meta');
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(sent.messages).toHaveLength(5);
    expect(sent.messages[0].content).toContain('SELECTED OBJECT LIST');
    expect(sent.messages[3].content).toContain('photo-monitor');
    expect(sent.messages.at(-1).content[1].type).toBe('image_url');
    expect(sent.max_completion_tokens).toBe(12000);
  });

  it('keeps the existing scene call when no selection is sent', async () => {
    const expected = scene();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(expected));
    const url = await app({ apiKey: 'test-only-secret', fetchImpl });
    const response = await post(url, '/api/photo', photoBody());
    expect(response.status).toBe(200);
    const { timings: _timings, ...proposal } = await response.json();
    expect(proposal).toEqual({ ...expected, mode: 'meta' });
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(sent.messages).toHaveLength(4);
    expect(sent.messages[0].content).not.toContain('SELECTED OBJECT LIST');
  });

  it('still rejects a device reference the selection does not make valid', async () => {
    const workspace = createDemoWorkspace();
    const monitor = workspace.devices.find((device) => device.id === 'monitor-right')!;
    monitor.source = 'user-reported';
    const proposed = {
      ...scene(),
      objects: [{ ...scene().objects[0], deviceId: 'missing-device' }],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(proposed));
    const url = await app({ apiKey: 'test-only-secret', fetchImpl });
    expect(
      (
        await post(url, '/api/photo', {
          ...photoBody(),
          workspace,
          selection: { objects: [selection().objects[0]] },
        })
      ).status,
    ).toBe(502);

    const accepted = {
      ...scene(),
      objects: [{ ...scene().objects[0], deviceId: monitor.id }],
    };
    const okFetch = vi.fn<typeof fetch>().mockResolvedValue(upstream(accepted));
    const okUrl = await app({ apiKey: 'test-only-secret', fetchImpl: okFetch });
    const response = await post(okUrl, '/api/photo', {
      ...photoBody(),
      workspace,
      selection: { objects: [selection().objects[0]] },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.objects[0].deviceId).toBe(monitor.id);
    expect(body.objects[0].imageRegion).toEqual(selectedRegion);
  });
});

describe('photo object client helpers', () => {
  it('builds a stage-2 body from chosen rows and parses the inventory response', async () => {
    const request = photoBody();
    const chosen = inventory().objects[0];
    const sceneRequest = photoSceneRequest(request, [chosen]);
    expect(sceneRequest.selection.objects).toEqual([
      {
        id: chosen.id,
        kind: chosen.kind,
        name: chosen.name,
        imageRegion: chosen.imageRegion,
      },
    ]);
    expect(JSON.stringify(sceneRequest)).not.toContain('samPhrase');
    expect(sceneRequest.context).toBe(request.context);

    const payload = {
      ...inventory(),
      regionSources: { 'monitor-a': 'model', 'mug-a': 'none' },
      sam: { enabled: false, requests: 0, failed: 0 },
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    try {
      await expect(findPhotoObjects(request)).resolves.toEqual(payload);
      expect(String(fetchImpl.mock.calls[0][0])).toBe('/api/photo/objects');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

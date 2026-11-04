import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import {
  responseSchema,
  sceneResponseSchema,
  validateModelReply,
  validateSceneReply,
} from './meta';
import { createDemoWorkspace } from '../src/domain/workspace';
import { answerDiagnosis, startDiagnosis } from '../src/domain/diagnosis';
import type { Server } from 'node:http';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
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
const request = () => ({
  message: '오른쪽 모니터를 Dock에 HDMI로 연결했어',
  workspace: createDemoWorkspace(),
  history: [],
  consent: true,
});
const post = (url: string, path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
const validReply = {
  message: '사용자 입력으로 기록할까요?',
  proposals: [
    { type: 'connect', from: 'laptop', to: 'dock', connector: 'USB-C', reason: '사용자의 설명' },
  ],
};
const upstream = (content: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }],
    }),
    { status: 200 },
  );
const photoRequest = () => ({
  image: 'data:image/jpeg;base64,YWJj',
  consent: true,
  workspace: createDemoWorkspace(),
});
const sceneReply = () => ({
  message: 'A coarse desk layout inferred from the photo. Review every object before applying.',
  objects: [
    {
      id: 'photo-desk',
      deviceId: null,
      kind: 'desk',
      name: 'Wood desk',
      placement: { x: 0, y: 0, z: 0, rotation: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: '#a58062',
      parts: [],
      note: 'Approximate wooden surface visible in the photo.',
    },
    {
      id: 'photo-monitor',
      deviceId: null,
      kind: 'monitor',
      name: 'Monitor in photo',
      placement: { x: 1, y: 2.51, z: -0.5, rotation: -8 },
      scale: { x: 1.2, y: 1, z: 1 },
      color: '#27303d',
      parts: [],
      note: 'Visible monitor shape; identity and working state are unverified.',
    },
    {
      id: 'photo-prop',
      deviceId: null,
      kind: 'generic',
      name: 'Small tabletop object',
      placement: { x: -1, y: 2.51, z: 0.7, rotation: 0 },
      scale: { x: 1, y: 1, z: 1 },
      color: '#859372',
      parts: [
        { position: { x: 0, y: 0.2, z: 0 }, size: { x: 0.4, y: 0.4, z: 0.4 }, color: '#859372' },
      ],
      note: 'An editable box approximation because the exact object is unclear.',
    },
  ],
});

describe('local API and Meta boundary', () => {
  it('returns an offline reply without any upstream request', async () => {
    const fetchImpl = vi.fn();
    const url = await app({ fetchImpl });
    const res = await post(url, '/api/chat', request());
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe('demo');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('never exposes the API key through health', async () => {
    const url = await app({ apiKey: 'test-secret-not-real' });
    const text = await (await fetch(url + '/api/health')).text();
    expect(text).not.toContain('test-secret');
    expect(JSON.parse(text).photoAvailable).toBe(true);
  });
  it('serves production assets with local workers while retaining the script policy', async () => {
    const productionRoot = await realpath(await mkdtemp(join(tmpdir(), 'desktwin-csp-')));
    try {
      await writeFile(join(productionRoot, 'index.html'), '<!doctype html><title>DeskTwin</title>');
      const url = await app({ productionRoot });
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const policy = response.headers.get('content-security-policy');
      expect(policy).toContain("worker-src 'self';");
      expect(policy).toContain("script-src 'self';");
      expect(policy).toContain("connect-src 'self';");
      expect(policy).not.toContain('unsafe-eval');
      expect(policy).not.toContain('wasm-unsafe-eval');
      expect(policy).not.toContain("worker-src 'self' blob:");
    } finally {
      await rm(productionRoot, { recursive: true, force: true });
    }
  });
  it('requires explicit consent before a live call', async () => {
    const fetchImpl = vi.fn();
    const url = await app({ apiKey: 'test-secret', fetchImpl });
    expect((await post(url, '/api/chat', { ...request(), consent: undefined })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects cross-site and different-port origins', async () => {
    const url = await app();
    expect(
      (await post(url, '/api/chat', request(), { Origin: 'https://malicious.example' })).status,
    ).toBe(403);
    expect(
      (await post(url, '/api/chat', request(), { Origin: 'http://localhost:9999' })).status,
    ).toBe(403);
  });
  it('accepts the exact local origin', async () => {
    const url = await app();
    expect((await post(url, '/api/chat', request(), { Origin: url })).status).toBe(200);
  });
  it('rejects invalid input, body formats, oversized messages and payloads', async () => {
    const url = await app();
    expect((await post(url, '/api/chat', { ...request(), message: 'x'.repeat(2001) })).status).toBe(
      400,
    );
    expect((await post(url, '/api/chat', request(), { 'Content-Type': 'text/plain' })).status).toBe(
      415,
    );
    expect(
      (
        await fetch(url + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{bad',
        })
      ).status,
    ).toBe(400);
    expect((await post(url, '/api/chat', { big: 'x'.repeat(8_000_001) })).status).toBe(413);
  });
  it('constrains model responses and sends only bounded current context', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(validReply));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    const res = await post(url, '/api/chat', request());
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe('meta');
    const [endpoint, options] = fetchImpl.mock.calls[0];
    expect(endpoint).toBe('https://api.meta.ai/v1/chat/completions');
    const body = JSON.parse(String(options?.body));
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.max_completion_tokens).toBe(4096);
    expect(body.messages[0].role).toBe('developer');
    expect(body.messages[0].content).toContain('English');
  });
  it('rejects nonexistent references without changing data', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        upstream({ ...validReply, proposals: [{ ...validReply.proposals[0], from: 'invented' }] }),
      );
    const url = await app({ apiKey: 'test-key', fetchImpl });
    expect((await post(url, '/api/chat', request())).status).toBe(502);
  });
  it('keeps OS-derived records and local identities out of chat and photo provider payloads', async () => {
    const workspace = createDemoWorkspace();
    workspace.devices[2].name = 'PRIVATE OS MONITOR';
    workspace.devices[2].model = 'PRIVATE OS MODEL';
    workspace.devices[2].source = 'os-detected';
    workspace.devices[2].hardwareOrigin = 'macos';
    const binding = {
      category: 'display' as const,
      identity: {
        key: 'private_local_identity',
        stability: 'persistent' as const,
        scope: 'installation_private_scope',
      },
      approvedAt: new Date().toISOString(),
    };
    workspace.devices[2].hardwareBinding = binding;
    workspace.devices[1].hardwareBinding = {
      ...binding,
      identity: { ...binding.identity, key: 'manual_linked_identity' },
    };
    workspace.history.push({
      id: 'private-history',
      at: new Date().toISOString(),
      summary: 'Updated PRIVATE OS MONITOR',
      source: 'user-reported',
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(upstream(validReply))
      .mockResolvedValueOnce(upstream(sceneReply()));
    const url = await app({ apiKey: 'test-only-key', fetchImpl });
    expect((await post(url, '/api/chat', { ...request(), workspace })).status).toBe(200);
    expect((await post(url, '/api/photo', { ...photoRequest(), workspace })).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchImpl.mock.calls) {
      const body = String(options?.body);
      expect(body).toContain('Left monitor');
      for (const privateValue of [
        'PRIVATE OS',
        'private_local_identity',
        'manual_linked_identity',
        'installation_private_scope',
        'hardwareBinding',
        'hardwareOrigin',
        'monitor-right',
      ])
        expect(body).not.toContain(privateValue);
    }
    expect(workspace.devices[2].hardwareBinding).toEqual(binding);
  });
  it('rejects a model proposal referencing a local-only hardware record omitted from its context', async () => {
    const input = request();
    input.workspace.devices[2].source = 'os-detected';
    input.workspace.devices[2].hardwareOrigin = 'macos';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      upstream({
        message: 'Rename the display?',
        proposals: [
          {
            type: 'rename-device',
            deviceId: 'monitor-right',
            name: 'Invented shared device',
            reason: 'A guessed reference',
          },
        ],
      }),
    );
    const url = await app({ apiKey: 'test-only-key', fetchImpl });
    expect((await post(url, '/api/chat', input)).status).toBe(502);
  });
  it('hides arbitrary provider error bodies', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('do not leak test-secret', { status: 401 }));
    const url = await app({ apiKey: 'test-secret', fetchImpl });
    const res = await post(url, '/api/chat', request());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('test-secret');
  });
  it('reports timeout instead of pretending a demo is live', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('Timeout', 'TimeoutError'));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    expect((await post(url, '/api/chat', request())).status).toBe(504);
  });
  it('rejects malformed model JSON and truncated responses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{broken', { status: 200 }));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    expect((await post(url, '/api/chat', request())).status).toBe(502);
  });
  it('requires photo consent and refuses offline fake analysis', async () => {
    const url = await app();
    const photo = { image: 'data:image/jpeg;base64,YWJj', workspace: createDemoWorkspace() };
    expect((await post(url, '/api/photo', photo)).status).toBe(400);
    expect((await post(url, '/api/photo', { ...photo, consent: true })).status).toBe(503);
  });
  it('photo analysis returns a validated scene and sends the user description as data', async () => {
    expect(() => validateModelReply(validReply, createDemoWorkspace(), true)).toThrow();
    const expected = sceneReply();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(expected));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    const input = {
      ...photoRequest(),
      context: 'My laptop connects to the monitor through my USB-C dock.',
    };
    const before = structuredClone(input.workspace);
    const res = await post(url, '/api/photo', input);
    expect(res.status).toBe(200);
    const { timings, ...proposal } = await res.json();
    expect(proposal).toEqual({ ...expected, mode: 'meta' });
    expect(timings).toEqual({
      providerMs: expect.any(Number),
      validationMs: expect.any(Number),
      totalMs: expect.any(Number),
      responseBytes: expect.any(Number),
      objectCount: expected.objects.length,
    });
    expect(
      Object.values(timings).every((value) => Number.isFinite(value) && Number(value) >= 0),
    ).toBe(true);
    expect(input.workspace).toEqual(before);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.response_format.json_schema.name).toBe('desktwin_scene');
    expect(body.response_format.json_schema.schema).toEqual(sceneResponseSchema);
    expect(body.max_completion_tokens).toBe(12000);
    expect(body.messages[2].content).toContain(JSON.stringify(input.context));
    expect(body.messages[2].content).toContain('unverified user-provided data');
    expect(body.messages.at(-1).content[1].type).toBe('image_url');
    expect(body.messages.at(-1).content[0].text).toContain('in English');
    expect(JSON.stringify(body)).not.toContain('test-key');
    expect(body.messages[1].content).not.toContain('"history"');
  });
  it('grounds independent photo objects in actual template sizes and nullable visual evidence', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(sceneReply()));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    expect((await post(url, '/api/photo', photoRequest())).status).toBe(200);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain('separate a keyboard from its wrist rest');
    expect(prompt).toContain('a monitor from its riser');
    expect(prompt).toContain('a laptop from its stand');
    expect(prompt).toContain('Do not invent any of these objects');
    expect(prompt).toContain('left-to-right order, front-to-back order');
    expect(prompt).toContain('not real-world measurements');
    expect(prompt).toContain('supportId');
    expect(prompt).toContain('imageRegion');
    expect(prompt).toContain('DIRECT supporting surface');
    expect(prompt).toContain('keyboard -> mat -> desk -> floor');
    expect(prompt).toContain('Prefer parts=[]');
    const dimensions = JSON.parse(prompt.split('TEMPLATE DIMENSIONS (unscaled scene units):\n')[1]);
    expect(dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'monitor-riser', width: 2.4, depth: 0.8, supportTop: 0.5 }),
        expect.objectContaining({
          kind: 'laptop-stand',
          width: 1.5,
          depth: 1.05,
          supportTop: 0.42,
        }),
        expect.objectContaining({ kind: 'wrist-rest', width: 1.4, height: 0.09, depth: 0.3 }),
        expect.objectContaining({ kind: 'shelf', width: 2.1, height: 0.13, depth: 0.5 }),
        expect.objectContaining({ kind: 'trackpad', width: 0.5 }),
        expect.objectContaining({ kind: 'tablet', width: 0.82 }),
        expect.objectContaining({ kind: 'light-bar', width: 1.4 }),
        expect.objectContaining({ kind: 'mat', supportTop: 0.0275 }),
      ]),
    );
    const itemSchema = body.response_format.json_schema.schema.properties.objects.items;
    expect(itemSchema.required).toEqual(expect.arrayContaining(['supportId', 'imageRegion']));
    expect(JSON.stringify(itemSchema.properties.supportId)).toContain('null');
    expect(JSON.stringify(itemSchema.properties.imageRegion)).toContain('null');
  });
  it('validates photo consent and context before making an upstream request', async () => {
    const fetchImpl = vi.fn();
    const url = await app({ apiKey: 'test-key', fetchImpl });
    for (const consent of [undefined, false]) {
      expect((await post(url, '/api/photo', { ...photoRequest(), consent })).status).toBe(400);
    }
    expect(
      (await post(url, '/api/photo', { ...photoRequest(), context: 'x'.repeat(2001) })).status,
    ).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('accepts a cropped image region by clipping it to the frame', () => {
    const reply: unknown = {
      ...sceneReply(),
      objects: [
        sceneReply().objects[0],
        {
          ...sceneReply().objects[1],
          imageRegion: { x: 0.77, y: 0.38, width: 0.27, height: 0.3 },
          imageRegionVisibility: 'complete',
        },
        {
          ...sceneReply().objects[2],
          imageRegion: { x: 0, y: 0.2, width: 1.0000001, height: 0.25 },
          imageRegionVisibility: 'unknown',
        },
      ],
    };
    const accepted = validateSceneReply(reply, createDemoWorkspace());
    const cropped = accepted.objects[1].imageRegion!;
    expect(cropped.y).toBe(0.38);
    expect(cropped.height).toBe(0.3);
    expect(cropped.width).toBeCloseTo(0.23);
    expect(cropped.x + cropped.width).toBeLessThanOrEqual(1);
    expect(accepted.objects[1].imageRegionVisibility).toBe('partial');
    expect(accepted.objects[2].imageRegion).toEqual({ x: 0, y: 0.2, width: 1, height: 0.25 });
    expect(accepted.objects[2].imageRegionVisibility).toBe('partial');
  });
  it('drops a region outside the frame and clips one that crosses the left edge', () => {
    const reply: unknown = {
      ...sceneReply(),
      objects: [
        sceneReply().objects[0],
        {
          ...sceneReply().objects[1],
          imageRegion: { x: 1.2, y: 0.2, width: 0.3, height: 0.4 },
          imageRegionVisibility: 'complete',
        },
        {
          ...sceneReply().objects[2],
          imageRegion: { x: -0.25, y: 0.25, width: 0.5, height: 0.5 },
          imageRegionVisibility: 'complete',
        },
      ],
    };
    const accepted = validateSceneReply(reply, createDemoWorkspace());
    expect(accepted.objects[1].imageRegion).toBeNull();
    expect(accepted.objects[1].imageRegionVisibility).toBe('unknown');
    expect(accepted.objects[2].imageRegion).toEqual({ x: 0, y: 0.25, width: 0.25, height: 0.5 });
    expect(accepted.objects[2].imageRegionVisibility).toBe('partial');
  });
  it('drops an out-of-frame anchor and photo reference instead of clamping them', () => {
    const reply: unknown = {
      ...sceneReply(),
      objects: [
        sceneReply().objects[0],
        {
          ...sceneReply().objects[1],
          imageAnchor: { x: 1.2, y: 0.4 },
          imageRegion: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
        },
        sceneReply().objects[2],
      ],
      photoReference: {
        objectId: 'photo-desk',
        surface: 'tabletop',
        corners: {
          backLeft: { x: 0.1, y: 0.2 },
          backRight: { x: 1.04, y: 0.2 },
          frontRight: { x: 0.8, y: 0.8 },
          frontLeft: { x: 0.2, y: 0.8 },
        },
      },
    };
    const accepted = validateSceneReply(reply, createDemoWorkspace());
    expect(accepted.objects[1].imageAnchor).toBeNull();
    expect(accepted.objects[1].imageRegion).toEqual({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 });
    expect(accepted.photoReference).toBeNull();
  });
  it('still rejects forbidden scene fields when an image region is out of frame', () => {
    for (const injected of [
      { status: 'reported-working' },
      { connections: [{ from: 'a', to: 'b' }] },
    ]) {
      const reply: unknown = {
        ...sceneReply(),
        objects: [
          {
            ...sceneReply().objects[1],
            ...injected,
            imageRegion: { x: 0.77, y: 0.38, width: 0.27, height: 0.3 },
          },
        ],
      };
      expect(() => validateSceneReply(reply, createDemoWorkspace())).toThrow();
    }
  });
  it('returns the clipped image region from photo analysis', async () => {
    const reply = {
      ...sceneReply(),
      objects: [
        sceneReply().objects[0],
        {
          ...sceneReply().objects[1],
          imageRegion: { x: 0.77, y: 0.38, width: 0.27, height: 0.3 },
          imageRegionVisibility: 'complete',
        },
        sceneReply().objects[2],
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(reply));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    const res = await post(url, '/api/photo', photoRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.objects[1].imageRegion.x).toBe(0.77);
    expect(body.objects[1].imageRegion.y).toBe(0.38);
    expect(body.objects[1].imageRegion.height).toBe(0.3);
    expect(body.objects[1].imageRegion.width).toBeCloseTo(0.23);
    expect(body.objects[1].imageRegion.x + body.objects[1].imageRegion.width).toBeLessThanOrEqual(
      1,
    );
    expect(body.objects[1].imageRegionVisibility).toBe('partial');
    expect(body.objects[0].imageRegion).toBeUndefined();
    expect(body.mode).toBe('meta');
  });
  it('rejects photo responses containing connection, status or executable fields', async () => {
    const cases: unknown[] = [
      { ...sceneReply(), connections: [{ from: 'laptop', to: 'dock' }] },
      { ...sceneReply(), status: 'reported-working' },
      { ...sceneReply(), code: 'window.alert(1)' },
      { ...sceneReply(), objects: [{ ...sceneReply().objects[1], status: 'reported-working' }] },
      { ...sceneReply(), objects: [{ ...sceneReply().objects[2], code: 'eval(1)' }] },
      {
        ...sceneReply(),
        objects: [
          {
            ...sceneReply().objects[2],
            parts: [{ ...sceneReply().objects[2].parts[0], script: 'run()' }],
          },
        ],
      },
    ];
    for (const malicious of cases) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(upstream(malicious));
      const url = await app({ apiKey: 'test-key', fetchImpl });
      const res = await post(url, '/api/photo', photoRequest());
      expect(res.status).toBe(502);
      expect((await res.json()).error).toContain('No changes were applied');
    }
  });
  it('rejects invalid or duplicate device references in photo scenes', async () => {
    const base = createDemoWorkspace();
    const monitor = base.devices.find((device) => device.kind === 'monitor')!;
    monitor.source = 'user-reported';
    const candidate = { ...sceneReply().objects[1], deviceId: monitor.id };
    const cases = [
      [{ ...candidate, deviceId: 'missing-device' }],
      [{ ...candidate, deviceId: 'laptop', kind: 'laptop' }], // Existing demo is not a user record.
      [{ ...candidate, kind: 'plant' }],
      [candidate, { ...candidate, id: 'another-photo-monitor' }],
    ];
    for (const objects of cases) {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(upstream({ ...sceneReply(), objects }));
      const url = await app({ apiKey: 'test-key', fetchImpl });
      expect((await post(url, '/api/photo', { ...photoRequest(), workspace: base })).status).toBe(
        502,
      );
    }
  });
  it('validates existing device matches without mutating reported connections or status', () => {
    const base = createDemoWorkspace();
    const monitor = base.devices.find((device) => device.kind === 'monitor')!;
    monitor.source = 'user-reported';
    monitor.status = 'reported-issue';
    monitor.statusNote = 'I saw flickering.';
    base.connections[0].source = 'user-reported';
    const before = structuredClone(base);
    const proposed = {
      ...sceneReply(),
      objects: [{ ...sceneReply().objects[1], deviceId: monitor.id }],
    };
    expect(validateSceneReply(proposed, base)).toEqual(proposed);
    expect(base).toEqual(before);
  });
  it('rejects malformed, truncated and unbounded scene output', async () => {
    const responses = [
      new Response('{broken', { status: 200 }),
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: 'length', message: { content: JSON.stringify(sceneReply()) } },
          ],
        }),
      ),
      upstream({
        ...sceneReply(),
        objects: [{ ...sceneReply().objects[1], scale: { x: 99, y: 1, z: 1 } }],
      }),
      upstream({
        ...sceneReply(),
        objects: Array.from({ length: 33 }, (_, i) => ({
          ...sceneReply().objects[1],
          id: `object-${i}`,
        })),
      }),
    ];
    for (const response of responses) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
      const url = await app({ apiKey: 'test-key', fetchImpl });
      expect((await post(url, '/api/photo', photoRequest())).status).toBe(502);
    }
  });
  it('keeps photo provider errors private and never substitutes an offline scene', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('private-photo test-secret', { status: 401 }));
    const url = await app({ apiKey: 'test-secret', fetchImpl });
    const response = await post(url, '/api/photo', photoRequest());
    expect(response.status).toBe(502);
    const body = await response.text();
    expect(body).not.toContain('test-secret');
    expect(body).not.toContain('private-photo');
    expect(body).not.toContain('"objects"');
  });
  it('does not send photo data or the API key to an unsupported provider', async () => {
    const fetchImpl = vi.fn();
    const url = await app({ apiKey: 'test-key', fetchImpl, baseURL: 'https://example.com/v1' });
    expect((await post(url, '/api/photo', photoRequest())).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does not allow arbitrary URL fetches or non-Meta key destinations', async () => {
    const fetchImpl = vi.fn();
    const url = await app({ apiKey: 'test-key', fetchImpl, baseURL: 'https://example.com/v1' });
    expect((await post(url, '/api/chat', request())).status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      (
        await post(url, '/api/photo', {
          image: 'https://example.com/a.jpg',
          consent: true,
          workspace: createDemoWorkspace(),
        })
      ).status,
    ).toBe(400);
  });
  it('limits requests', async () => {
    const url = await app({ requestsPerMinute: 1 });
    expect((await post(url, '/api/chat', request())).status).toBe(200);
    expect((await post(url, '/api/chat', request())).status).toBe(429);
  });
  it('uses the supported strict schema subset', () => {
    for (const schema of [responseSchema, sceneResponseSchema]) {
      const text = JSON.stringify(schema);
      expect(text).not.toContain('"oneOf"');
      expect(text).not.toContain('"allOf"');
      expect(text).toContain('"additionalProperties":false');
    }
  });
});

describe('selected conversation target API boundary', () => {
  it('passes only a validated selected target and its current recorded route to the provider', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(upstream({ message: 'Review this target.', proposals: [] }));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    const response = await post(url, '/api/chat', {
      ...request(),
      message: 'This monitor has no signal.',
      focusDeviceId: 'monitor-right',
    });
    expect(response.status).toBe(200);
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    const entry = sent.messages.find(
      (message: { content: unknown }) =>
        typeof message.content === 'string' && message.content.startsWith('CURRENT WORKSPACE'),
    );
    const context = JSON.parse(entry.content.slice(entry.content.indexOf('\n') + 1));
    expect(context.focusDeviceId).toBe('monitor-right');
    expect(context.recordedReferencePath.deviceIds).toEqual(['monitor-right', 'dock', 'laptop']);
    expect(context.recordedReferencePath.connectionIds).toHaveLength(2);
  });
  it('rejects removed, malformed and local-only targets before any provider request', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const url = await app({ apiKey: 'test-key', fetchImpl });
    const workspace = createDemoWorkspace();
    const target = workspace.devices.find((device) => device.id === 'monitor-right')!;
    target.hardwareOrigin = 'macos';
    target.source = 'user-reported';
    for (const focusDeviceId of ['missing-device', '../bad-target', 'monitor-right']) {
      const response = await post(url, '/api/chat', { ...request(), workspace, focusDeviceId });
      expect(response.status).toBe(400);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('uses the selected target locally without consent or any network transport', async () => {
    const fetchImpl = vi.fn();
    const url = await app({ fetchImpl });
    const response = await post(url, '/api/chat', {
      ...request(),
      message: 'This monitor is not displaying',
      focusDeviceId: 'monitor-right',
      consent: undefined,
    });
    expect(response.status).toBe(200);
    expect((await response.json()).proposals[0]).toMatchObject({
      type: 'set-status',
      deviceId: 'monitor-right',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('guided-check provider summaries', () => {
  it('sends enum answers and changed-graph context while dropping local checks and OS-sourced links', async () => {
    const workspace = createDemoWorkspace();
    const safeSession = answerDiagnosis(startDiagnosis('monitor-right', workspace), 'not-fixed');
    const localSession = startDiagnosis('monitor-left', workspace);
    localSession.localOnly = true;
    workspace.diagnoses = [safeSession, localSession];
    workspace.connections.find(
      (edge) => edge.id === safeSession.path.connections[0].id,
    )!.connector = 'Unknown';
    const osEdge = workspace.connections.find((edge) => edge.to === 'ssd' || edge.from === 'ssd')!;
    osEdge.source = 'os-detected';
    osEdge.note = 'Private OS-only link note';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(upstream({ message: 'Review the changed path.', proposals: [] }));
    const url = await app({ apiKey: 'test-key', fetchImpl });
    const response = await post(url, '/api/chat', {
      ...request(),
      workspace,
      focusDeviceId: 'monitor-right',
    });
    expect(response.status).toBe(200);
    const raw = String(fetchImpl.mock.calls[0][1]?.body);
    const sent = JSON.parse(raw);
    const entry = sent.messages.find(
      (message: { content: unknown }) =>
        typeof message.content === 'string' && message.content.startsWith('CURRENT WORKSPACE'),
    );
    const context = JSON.parse(entry.content.slice(entry.content.indexOf('\n') + 1));
    expect(context.guidedChecks).toHaveLength(1);
    expect(context.guidedChecks[0]).toMatchObject({
      sessionId: safeSession.id,
      deviceId: 'monitor-right',
      graphChanged: true,
      answers: [{ check: 'power', answer: 'not-fixed' }],
    });
    expect(raw).not.toContain(localSession.id);
    expect(raw).not.toContain('Private OS-only link note');
    expect(context.connections.some((edge: { id: string }) => edge.id === osEdge.id)).toBe(false);
  });
});

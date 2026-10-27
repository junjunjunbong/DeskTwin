import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import {
  responseSchema,
  sceneResponseSchema,
  validateModelReply,
  validateSceneReply,
} from './meta';
import { createDemoWorkspace } from '../src/domain/workspace';
import type { Server } from 'node:http';
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
    expect((await post(url, '/api/chat', { big: 'x'.repeat(2_100_001) })).status).toBe(413);
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
    expect(await res.json()).toEqual({ ...expected, mode: 'meta' });
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

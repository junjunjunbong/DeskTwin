import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';
import { responseSchema, validateModelReply } from './meta';
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
  it('photo analysis cannot propose connection or status edits', async () => {
    expect(() => validateModelReply(validReply, createDemoWorkspace(), true)).toThrow();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      upstream({
        message: '화면 오른쪽에 모니터가 보입니다.',
        proposals: [
          {
            type: 'add-device',
            kind: 'monitor',
            name: '추정 모니터',
            x: 2,
            z: -0.5,
            reason: '사진에서 보이는 형태',
          },
        ],
      }),
    );
    const url = await app({ apiKey: 'test-key', fetchImpl });
    const res = await post(url, '/api/photo', {
      image: 'data:image/jpeg;base64,YWJj',
      consent: true,
      workspace: createDemoWorkspace(),
    });
    expect(res.status).toBe(200);
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.messages.at(-1).content[1].type).toBe('image_url');
    expect(body.messages.at(-1).content[0].text).toContain('in English');
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
    const text = JSON.stringify(responseSchema);
    expect(text).not.toContain('"oneOf"');
    expect(text).not.toContain('"allOf"');
    expect(text).toContain('"additionalProperties":false');
  });
});

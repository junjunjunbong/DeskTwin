import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { createApp } from './app';
import type { MetaRequestMeasurement } from './meta';
import { createDemoWorkspace } from '../src/domain/workspace';

const servers: Server[] = [];
afterEach(async () => {
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function start(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
  const server = createApp({
    apiKey: 'test-only-secret',
    model: 'mock-only',
    baseURL: 'https://api.meta.ai/v1',
    ...overrides,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  return `http://127.0.0.1:${address.port}`;
}

function upstream() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: JSON.stringify({
              message: 'Synthetic test preview.',
              objects: [
                {
                  id: 'desk',
                  kind: 'desk',
                  name: 'Synthetic desk',
                  deviceId: null,
                  placement: { x: 0, y: 0, z: 0, rotation: 0 },
                  scale: { x: 1, y: 1, z: 1 },
                  color: '#828282',
                  parts: [],
                  note: '',
                  supportId: 'floor',
                  imageRegion: null,
                },
              ],
            }),
          },
        },
      ],
    }),
  );
}

function post(url: string, signal?: AbortSignal) {
  return fetch(`${url}/api/photo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      image: 'data:image/jpeg;base64,YWJj',
      consent: true,
      workspace: createDemoWorkspace(),
    }),
  });
}

describe('photo transport over real local HTTP with a fake provider', () => {
  it('does not cancel when the uploaded request body finishes and returns only aggregate timings', async () => {
    const pending = deferred<Response>();
    const measurements: MetaRequestMeasurement[] = [];
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, options) => {
      signal = options?.signal ?? undefined;
      return pending.promise;
    });
    const url = await start({
      fetchImpl,
      onRequestMeasurement: (value) => measurements.push(value),
    });
    const response = post(url);
    await expect.poll(() => fetchImpl.mock.calls.length).toBe(1);
    await setImmediate();
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    pending.resolve(upstream());
    const completed = await response;
    expect(completed.status).toBe(200);
    const body = await completed.json();
    expect(body.objects).toHaveLength(1);
    expect(body.timings.objectCount).toBe(1);
    expect(body.timings.responseBytes).toBeGreaterThan(0);
    expect(measurements).toHaveLength(1);
    expect(Object.keys(measurements[0]).sort()).toEqual(
      ['request', 'outcome', 'providerMs', 'validationMs', 'totalMs', 'responseBytes'].sort(),
    );
    expect(measurements[0].outcome).toBe('success');
    expect(measurements[0].request).toBe('photo');
    expect(JSON.stringify(measurements)).not.toMatch(/test-only-secret|data:image|Synthetic desk/);
    expect(signal!.aborted).toBe(false);
  });

  it('aborts disconnected clients, releases their slots immediately, and discards late provider results', async () => {
    const pending: ReturnType<typeof deferred<Response>>[] = [];
    const signals: AbortSignal[] = [];
    const measurements: MetaRequestMeasurement[] = [];
    const fetchImpl = vi.fn<typeof fetch>((_input, options) => {
      signals.push(options!.signal!);
      const next = deferred<Response>();
      pending.push(next);
      // Deliberately ignore abort: local resource limits must still recover promptly.
      return next.promise;
    });
    const url = await start({
      fetchImpl,
      onRequestMeasurement: (value) => measurements.push(value),
    });
    const controllers = [new AbortController(), new AbortController()];
    const canceled = controllers.map((controller) =>
      post(url, controller.signal).then(
        () => 'unexpected response',
        (error: Error) => error.name,
      ),
    );
    await expect.poll(() => pending.length).toBe(2);
    expect((await post(url)).status).toBe(429);
    controllers.forEach((controller) => controller.abort());
    expect(await Promise.all(canceled)).toEqual(['AbortError', 'AbortError']);
    await expect.poll(() => signals.slice(0, 2).every((signal) => signal.aborted)).toBe(true);
    await expect
      .poll(() => measurements.filter((item) => item.outcome === 'canceled').length)
      .toBe(2);

    const replacements = [post(url), post(url)];
    await expect.poll(() => pending.length).toBe(4);
    expect((await post(url)).status).toBe(429);
    const lateCancel = vi.fn();
    for (const old of pending.slice(0, 2))
      old.resolve(new Response(new ReadableStream({ cancel: lateCancel })));
    await expect.poll(() => lateCancel.mock.calls.length).toBe(2);
    // Late completion must not release a second slot or disturb the replacement requests.
    expect((await post(url)).status).toBe(429);
    pending.slice(2).forEach((next) => next.resolve(upstream()));
    const completed = await Promise.all(replacements);
    expect(completed.map((response) => response.status)).toEqual([200, 200]);
    expect(measurements.filter((item) => item.outcome === 'success')).toHaveLength(2);
    expect(measurements).toHaveLength(4);
  });

  it('classifies a deadline while reading the body as 504 and releases the slot without awaiting stream cancellation', async () => {
    const measurements: MetaRequestMeasurement[] = [];
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"choices":['));
            },
            cancel,
          }),
        ),
      )
      .mockImplementation(async () => upstream());
    const url = await start({
      fetchImpl,
      timeoutMs: 30,
      onRequestMeasurement: (value) => measurements.push(value),
    });
    const response = await post(url);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({
      error: 'The Meta response timed out. Your workspace was not changed.',
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(measurements[0].outcome).toBe('timeout');
    expect(measurements[0].responseBytes).toBeGreaterThan(0);
    expect(measurements[0].validationMs).toBe(0);
    expect((await post(url)).status).toBe(200);
  });

  it('enforces the deadline even when the fake provider never settles its fetch promise', async () => {
    const measurements: MetaRequestMeasurement[] = [];
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_input, options) => {
      signal = options?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const url = await start({
      fetchImpl,
      timeoutMs: 20,
      onRequestMeasurement: (value) => measurements.push(value),
    });
    expect((await post(url)).status).toBe(504);
    expect(signal!.aborted).toBe(true);
    expect(measurements).toHaveLength(1);
    expect(measurements[0].outcome).toBe('timeout');
    expect(measurements[0].responseBytes).toBe(0);
  });
});

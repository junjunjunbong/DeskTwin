import { afterEach, describe, expect, it, vi } from 'vitest';
import { callMeta, callMetaScene, type MetaConfig } from './meta';
import { createDemoWorkspace } from '../src/domain/workspace';

afterEach(() => vi.useRealTimers());

describe('provider deadlines', () => {
  it.each([
    { request: 'photo', timeoutMs: undefined, deadline: 120000 },
    { request: 'chat', timeoutMs: undefined, deadline: 35000 },
    { request: 'photo', timeoutMs: 1200, deadline: 1200 },
    { request: 'chat', timeoutMs: 1200, deadline: 1200 },
  ] as const)(
    '$request uses the configured deadline ($deadline ms)',
    async ({ request, timeoutMs, deadline }) => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      const config: MetaConfig = {
        apiKey: 'test-only-secret',
        model: 'mock-only',
        baseURL: 'https://api.meta.ai/v1',
        timeoutMs,
        fetchImpl: (_input, init) => {
          signal = init?.signal ?? undefined;
          return new Promise<Response>(() => undefined);
        },
      };
      const workspace = createDemoWorkspace();
      const pending =
        request === 'photo'
          ? callMetaScene(config, workspace, { image: 'data:image/jpeg;base64,YWJj' })
          : callMeta(config, workspace, { message: 'Synthetic test' });
      const outcome = expect(pending).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(deadline - 1);
      expect(signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await outcome;
      expect(signal?.aborted).toBe(true);
    },
  );
});

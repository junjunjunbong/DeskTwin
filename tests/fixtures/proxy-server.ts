import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, loadConfigFromFile, type ViteDevServer } from 'vite';
import { createApp } from '../../server/app';
import { HardwareService, type HardwareProbe, type NativeSnapshot } from '../../server/hardware';

export const proxyReply = {
  message: 'The test transport received your consented request through the local API.',
  proposals: [],
};

type RequestRecord = {
  method: string;
  path: string;
  host: string | null;
  origin: string | null;
  status: number | null;
};

function originOf(server: Pick<Server, 'address'>) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture listener.');
  return `http://127.0.0.1:${address.port}`;
}

/** Real HTTP/API/proxy stack; only native reads and the paid transport are replaced. */
export async function startProxyFixture() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const cacheDir = await mkdtemp(join(tmpdir(), 'desktwin-proxy-test-'));
  const stats = { nativeReads: 0, metaCalls: 0, requests: [] as RequestRecord[] };
  const native: NativeSnapshot = {
    schemaVersion: 1,
    categories: {
      display: { state: 'ok', source: 'Proxy test display fixture', message: 'Synthetic display.' },
      usb: { state: 'ok', source: 'Proxy test USB fixture', message: 'Synthetic USB hub.' },
      bluetooth: {
        state: 'unavailable',
        source: 'Not collected',
        message: 'Bluetooth detection is not implemented.',
      },
    },
    devices: [
      {
        id: 'fixture-display',
        category: 'display',
        name: 'Proxy fixture display',
        model: 'Synthetic integration fixture',
        fingerprint: 'a'.repeat(64),
        source: 'Proxy test display fixture',
        status: 'online',
        parentId: null,
        attributes: [],
      },
      {
        id: 'fixture-hub',
        category: 'usb',
        name: 'Proxy fixture USB hub',
        model: 'Synthetic integration fixture',
        fingerprint: 'b'.repeat(64),
        source: 'Proxy test USB fixture',
        status: 'connected',
        parentId: null,
        attributes: [],
      },
    ],
  };
  const probe: HardwareProbe = {
    platform: 'darwin',
    async availability() {
      return { available: true, message: 'Test-only probe; no Mac hardware is read.' };
    },
    async scope() {
      return 'installation_proxy_test_fixture';
    },
    async read() {
      stats.nativeReads++;
      return structuredClone(native);
    },
  };
  const api = createApp({
    apiKey: 'test-only-not-a-real-api-key',
    model: 'test-only-model',
    baseURL: 'https://api.meta.ai/v1',
    requestsPerMinute: 100,
    hardware: new HardwareService(probe, { minPollMs: 0 }),
    async fetchImpl() {
      // No network fallback: even an unexpected provider call stays in this fixture.
      stats.metaCalls++;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proxyReply) } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    },
  });
  api.prependListener('request', (request, response) => {
    // Tokens, request bodies and device identities are deliberately not recorded.
    const record: RequestRecord = {
      method: request.method ?? '',
      path: (request.url ?? '').split('?')[0],
      host: request.headers.host ?? null,
      origin: request.headers.origin ?? null,
      status: null,
    };
    stats.requests.push(record);
    response.once('finish', () => (record.status = response.statusCode));
  });
  let vite: ViteDevServer | undefined;
  async function close() {
    await vite?.close();
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await rm(cacheDir, { recursive: true, force: true });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      api.once('error', reject);
      api.listen(0, '127.0.0.1', resolve);
    });
    const apiOrigin = originOf(api);
    const previousPort = process.env.PORT;
    let loaded;
    try {
      // Load the repository's actual proxy declaration. Do not reproduce or
      // override its target/changeOrigin policy in the test harness.
      process.env.PORT = new URL(apiOrigin).port;
      loaded = await loadConfigFromFile(
        { command: 'serve', mode: 'development' },
        join(root, 'vite.config.ts'),
        root,
        'error',
      );
    } finally {
      if (previousPort === undefined) delete process.env.PORT;
      else process.env.PORT = previousPort;
    }
    if (!loaded) throw new Error('The actual Vite configuration could not be loaded.');
    vite = await createViteServer({
      ...loaded.config,
      configFile: false,
      root,
      cacheDir,
      logLevel: 'error',
      server: { ...loaded.config.server, host: '127.0.0.1', port: 0 },
    });
    await vite.listen();
    return { origin: originOf(vite.httpServer!), apiOrigin, stats, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export type ProxyFixture = Awaited<ReturnType<typeof startProxyFixture>>;

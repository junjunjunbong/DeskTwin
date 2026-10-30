import { test as base, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDemoWorkspace } from '../src/domain/workspace';
import { HardwareSessionSchema, HardwareSnapshotSchema } from '../src/domain/hardware';
import { proxyReply, startProxyFixture, type ProxyFixture } from './fixtures/proxy-server';

const test = base.extend<{ proxyStack: ProxyFixture }>({
  proxyStack: async ({}, use, testInfo) => {
    const proxy = await startProxyFixture();
    try {
      await use(proxy);
    } finally {
      const evidence = testInfo.outputPath('actual-proxy-request-path.json');
      await mkdir(testInfo.outputDir, { recursive: true });
      await writeFile(
        evidence,
        JSON.stringify(
          { origin: proxy.origin, apiOrigin: proxy.apiOrigin, ...proxy.stats },
          null,
          2,
        ),
      );
      await testInfo.attach('actual-proxy-request-path', {
        path: evidence,
        contentType: 'application/json',
      });
      await proxy.close();
    }
  },
});

async function browserRequest(
  page: Page,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
) {
  return page.evaluate(
    async ({ path, headers, body }) => {
      const response = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
    { path, headers, body },
  );
}

test('browser hardware consent, session, start, polling and stop cross the real Vite proxy', async ({
  page,
  proxyStack: proxy,
}) => {
  await page.goto(proxy.origin);
  await page.getByRole('button', { name: 'Mac hardware', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Mac hardware panel', exact: true });
  const start = panel.getByRole('button', { name: 'Start detection', exact: true });
  await expect(start).toBeDisabled();
  await expect
    .poll(() => proxy.stats.requests.filter((request) => request.path.endsWith('/session')).length)
    .toBeGreaterThan(0);
  expect(proxy.stats.nativeReads).toBe(0);
  const storedBefore = await page.evaluate(() => localStorage.getItem('desktwin.workspace.v1'));
  await panel.getByRole('checkbox', { name: /I agree to read this Mac/ }).check();
  await expect(start).toBeEnabled();
  expect(proxy.stats.nativeReads).toBe(0);
  const started = page.waitForResponse('**/api/hardware/start');
  await start.click();
  const response = await started;
  expect(response.status()).toBe(200);
  expect(HardwareSnapshotSchema.parse(await response.json()).state).toBe('running');
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection active');
  await expect(panel.getByRole('region', { name: 'OS observations', exact: true })).toContainText(
    'Proxy fixture display',
  );
  const polled = await page.waitForResponse('**/api/hardware/snapshot', { timeout: 12000 });
  expect(polled.status()).toBe(200);
  expect(HardwareSnapshotSchema.parse(await polled.json()).devices).toHaveLength(2);
  expect(proxy.stats.nativeReads).toBeGreaterThanOrEqual(2);
  const stopped = page.waitForResponse('**/api/hardware/stop');
  await panel.getByRole('button', { name: 'Stop detection', exact: true }).click();
  const stopResponse = await stopped;
  expect(stopResponse.status()).toBe(200);
  expect(HardwareSnapshotSchema.parse(await stopResponse.json()).state).toBe('stopped');
  await expect(panel.locator('.hardware-state-title')).toHaveText('Detection stopped');
  const readsAfterStop = proxy.stats.nativeReads;
  const token = (await response.request().allHeaders())['x-desktwin-hardware-token'];
  const afterStop = await browserRequest(page, '/api/hardware/snapshot', {
    'X-DeskTwin-Hardware': '1',
    'X-DeskTwin-Hardware-Token': token,
  });
  expect(afterStop.status).toBe(200);
  expect(HardwareSnapshotSchema.parse(afterStop.body).state).toBe('stopped');
  expect(proxy.stats.nativeReads).toBe(readsAfterStop);
  expect(proxy.stats.metaCalls).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem('desktwin.workspace.v1'))).toBe(
    storedBefore,
  );
  for (const request of proxy.stats.requests.filter((item) =>
    item.path.startsWith('/api/hardware/'),
  )) {
    expect(request.host).toBe(new URL(proxy.origin).host);
    if (request.method === 'POST') expect(request.origin).toBe(proxy.origin);
  }
});

test('browser chat preserves the frontend Host and Origin through the real proxy', async ({
  page,
  proxyStack: proxy,
}) => {
  await page.goto(proxy.origin);
  const payload = {
    message: 'Review my recorded desk.',
    workspace: createDemoWorkspace(),
    history: [],
  };
  const accepted = await browserRequest(page, '/api/chat', {}, { ...payload, consent: true });
  expect(accepted.status).toBe(200);
  expect(accepted.body).toEqual({ ...proxyReply, mode: 'meta' });
  expect(proxy.stats.metaCalls).toBe(1);
  expect((await browserRequest(page, '/api/chat', {}, payload)).status).toBe(400);
  expect(proxy.stats.metaCalls).toBe(1);
  expect(proxy.stats.nativeReads).toBe(0);
  expect(proxy.stats.requests.filter((request) => request.path === '/api/chat')).toEqual([
    {
      method: 'POST',
      path: '/api/chat',
      host: new URL(proxy.origin).host,
      origin: proxy.origin,
      status: 200,
    },
    {
      method: 'POST',
      path: '/api/chat',
      host: new URL(proxy.origin).host,
      origin: proxy.origin,
      status: 400,
    },
  ]);
});

test('real HTTP rejects bad Origin, forged Host and cross-site requests at both local entry points', async ({
  request,
  proxyStack: proxy,
}) => {
  // Browser scripts cannot set Host. These deliberately malformed boundary
  // requests use a real HTTP client; positive proxy cases above use the browser.
  for (const origin of [proxy.origin, proxy.apiOrigin]) {
    const rejectedHeaders: Record<string, string>[] = [
      { Origin: 'https://malicious.example' },
      { Origin: 'http://127.0.0.1:1' },
      { Origin: 'null' },
      { Origin: `${origin}/path` },
      { Origin: origin.replace('127.0.0.1', 'localhost') },
      { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: origin, Host: 'malicious.example' },
      { Origin: origin, Host: '127.0.0.1:1' },
      { Origin: origin, Host: `${new URL(origin).host}/path` },
      { Origin: origin, Host: `user@${new URL(origin).host}` },
    ];
    for (const headers of rejectedHeaders) {
      const response = await request.post(`${origin}/api/chat`, {
        headers,
        data: { message: 'Blocked request', workspace: createDemoWorkspace(), consent: true },
      });
      expect(response.status(), JSON.stringify({ origin, headers })).toBe(403);
    }
    const preflight = await request.fetch(`${origin}/api/hardware/start`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://malicious.example' },
    });
    // Vite's CORS middleware answers OPTIONS before its proxy, but grants no
    // access to this foreign origin. Direct API preflights are rejected as 403.
    expect(preflight.status()).toBe(origin === proxy.origin ? 204 : 403);
    expect(preflight.headers()).not.toHaveProperty('access-control-allow-origin');
  }
  expect(proxy.stats.nativeReads).toBe(0);
  expect(proxy.stats.metaCalls).toBe(0);
});

test('direct same-origin browser requests retain hardware consent and valid chat without Vite', async ({
  page,
  proxyStack: proxy,
}) => {
  // API handlers are shared with production. The production smoke separately
  // exercises built static assets, CSP and WebGL through server/index.ts.
  expect((await page.goto(`${proxy.apiOrigin}/api/health`))!.status()).toBe(200);
  const header = { 'X-DeskTwin-Hardware': '1' };
  const session = await browserRequest(page, '/api/hardware/session', header);
  expect(session.status).toBe(200);
  const authenticated = {
    ...header,
    'X-DeskTwin-Hardware-Token': HardwareSessionSchema.parse(session.body).token,
  };
  expect(proxy.stats.nativeReads).toBe(0);
  expect(
    (await browserRequest(page, '/api/hardware/start', header, { consent: true })).status,
  ).toBe(403);
  expect(
    (await browserRequest(page, '/api/hardware/start', authenticated, { consent: false })).status,
  ).toBe(400);
  expect(proxy.stats.nativeReads).toBe(0);
  const started = await browserRequest(page, '/api/hardware/start', authenticated, {
    consent: true,
  });
  expect(started.status).toBe(200);
  expect(HardwareSnapshotSchema.parse(started.body).state).toBe('running');
  const snapshot = await browserRequest(page, '/api/hardware/snapshot', authenticated);
  expect(snapshot.status).toBe(200);
  expect(HardwareSnapshotSchema.parse(snapshot.body).devices).toHaveLength(2);
  const stopped = await browserRequest(page, '/api/hardware/stop', authenticated, {});
  expect(stopped.status).toBe(200);
  expect(HardwareSnapshotSchema.parse(stopped.body).state).toBe('stopped');
  const readsAfterStop = proxy.stats.nativeReads;
  expect((await browserRequest(page, '/api/hardware/snapshot', authenticated)).body.state).toBe(
    'stopped',
  );
  expect(proxy.stats.nativeReads).toBe(readsAfterStop);
  const chat = await browserRequest(
    page,
    '/api/chat',
    {},
    {
      message: 'Review my recorded desk.',
      workspace: createDemoWorkspace(),
      consent: true,
    },
  );
  expect(chat.status).toBe(200);
  expect(chat.body).toEqual({ ...proxyReply, mode: 'meta' });
  expect(proxy.stats.metaCalls).toBe(1);
  for (const observed of proxy.stats.requests) {
    expect(observed.host).toBe(new URL(proxy.apiOrigin).host);
    if (observed.method === 'POST') expect(observed.origin).toBe(proxy.apiOrigin);
  }
});

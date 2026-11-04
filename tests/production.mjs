import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';

// Use a fresh local port and an empty key. This smoke test never calls a paid API.
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const child = spawn(
  process.execPath,
  ['node_modules/tsx/dist/cli.mjs', 'server/index.ts', '--production'],
  {
    cwd: process.cwd(),
    env: { ...process.env, MODEL_API_KEY: '', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverOutput = '';
child.stdout.on('data', (chunk) => {
  serverOutput += chunk;
});
child.stderr.on('data', (chunk) => {
  serverOutput += chunk;
});
let browser;
try {
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) {
        assert.equal((await res.json()).mode, 'demo');
        ready = true;
        break;
      }
    } catch {
      /* startup only */
    }
    if (child.exitCode !== null) throw new Error(serverOutput);
    await delay(100);
  }
  assert.ok(ready, 'Production server did not start');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DESKTWIN_CHROMIUM_EXECUTABLE
      ? {
          executablePath: process.env.DESKTWIN_CHROMIUM_EXECUTABLE,
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        }
      : {}),
  });
  const page = await browser.newPage({ viewport: { width: 1448, height: 1086 } });
  const errors = [];
  let photoRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/photo') photoRequests++;
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const response = await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  assert.ok(response.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
  assert.ok(response.headers()['content-security-policy'].includes("worker-src 'self'"));
  await page.getByTestId('desk-canvas').waitFor();
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: /USB-C Dock Dock/ })
    .click();
  await page.getByRole('button', { name: 'Close device details' }).click();
  await page.screenshot({ path: 'test-results/production.png' });
  // Exercise the local HEIC decoder through the production bundle and CSP. This
  // tiny red/blue fixture was generated for tests; no user photo is included.
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  await page
    .getByLabel('Desk photo file')
    .setInputFiles(resolve('tests/fixtures/synthetic-rotated.heic'));
  const photo = page.getByAltText('Desk reference photo selected by the user');
  await photo.waitFor();
  await photo.evaluate((element) => element.decode());
  const heic = await photo.evaluate((element) => ({
    width: element.naturalWidth,
    height: element.naturalHeight,
    jpeg: element.src.startsWith('data:image/jpeg;base64,'),
    storedPhoto: [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) =>
      value.includes('data:image/'),
    ),
  }));
  assert.deepEqual(heic, { width: 32, height: 64, jpeg: true, storedPhoto: false });
  assert.equal(photoRequests, 0, 'Selecting a HEIC image must never send it for analysis.');
  const result = await page.evaluate(async () => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello', workspace: { schemaVersion: 999 } }),
    });
    return res.status;
  });
  assert.equal(result, 400);
  // The intentionally invalid POST above is a handled 400, not a UI runtime error.
  assert.deepEqual(
    errors.filter((e) => !e.includes('400 (Bad Request)')),
    [],
  );
  const missing = await fetch(base + '/not-present.js');
  assert.equal(missing.status, 404);
  console.log(
    JSON.stringify({
      production: 'passed',
      webgl: true,
      errors: [],
      csp: true,
      heic: { ...heic, photoRequests },
      invalidInput: 'rejected',
      port,
    }),
  );
} finally {
  if (browser) await browser.close();
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once('exit', resolve);
  });
}

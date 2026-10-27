import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
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
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1448, height: 1086 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const response = await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(response.status(), 200);
  assert.ok(response.headers()['content-security-policy'].includes("frame-ancestors 'none'"));
  await page.getByTestId('desk-canvas').waitFor();
  await page.getByRole('button', { name: '기기 목록', exact: true }).click();
  await page.getByRole('button', { name: /USB-C Dock Dock/ }).click();
  await page.getByRole('button', { name: '기기 상세 닫기' }).click();
  await page.screenshot({ path: 'docs/screenshots/hero-production.png' });
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

import { test, expect } from '@playwright/test';
import { createDemoWorkspace } from '../src/domain/workspace';
const key = 'desktwin.workspace.v1';
let pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});
test('renders a real canvas without claiming detected hardware', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  await expect(page.getByText('Example 3D scene · No live device detection')).toBeVisible();
  await expect(page.locator('header').getByRole('link', { name: /github/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await expect(page.getByRole('button', { name: /MacBook Laptop/ })).toBeVisible();
  await page.getByRole('button', { name: /USB-C Dock Dock/ }).click();
  await expect(page.getByRole('complementary', { name: 'Selected device' })).toBeVisible();
  await expect(page.getByLabel('Operating status user-reported')).toHaveValue('unknown');
  expect(errors).toEqual([]);
});
test('adds a device and persists across reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add device' });
  await modal.getByLabel('Device name').fill('Test display');
  await modal.getByRole('button', { name: 'Add to my desk' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await expect(page.getByRole('button', { name: /Test display Monitor/ })).toBeVisible();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices.find((d: { name: string }) => d.name === 'Test display').source).toBe(
    'user-reported',
  );
  expect(stored.devices.find((d: { name: string }) => d.name === 'Test display').status).toBe(
    'unknown',
  );
});
test('viewing legacy workspace settings does not rewrite the saved name', async ({ page }) => {
  const legacy = createDemoWorkspace();
  legacy.name = '나의 작은 작업실';
  const original = JSON.stringify(legacy);
  await page.addInitScript(({ storageKey, value }) => localStorage.setItem(storageKey, value), {
    storageKey: key,
    value: original,
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'My workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Open settings' }).click();
  const name = page.getByLabel('Workspace name');
  await expect(name).toHaveValue('My workspace');
  await name.focus();
  await page.getByRole('dialog').getByLabel('Lighting').focus();
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), key)).toBe(original);
});
test('editing a legacy example device model preserves the saved name', async ({ page }) => {
  const legacy = createDemoWorkspace();
  const originalName = '오른쪽 모니터';
  legacy.devices.find((device) => device.id === 'monitor-right')!.name = originalName;
  await page.addInitScript(({ storageKey, value }) => localStorage.setItem(storageKey, value), {
    storageKey: key,
    value: JSON.stringify(legacy),
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page.getByRole('button', { name: /Right monitor Monitor/ }).click();
  await expect(page.getByLabel('Device name')).toHaveValue('Right monitor');
  await page.getByLabel('Model optional').fill('Display model');
  await page.getByRole('button', { name: 'Save device details' }).click();
  const stored = await page.evaluate(
    (storageKey) => JSON.parse(localStorage.getItem(storageKey)!),
    key,
  );
  const monitor = stored.devices.find((device: { id: string }) => device.id === 'monitor-right');
  expect(monitor.name).toBe(originalName);
  expect(monitor.model).toBe('Display model');
});
test('conversation proposals require confirmation and never verify operation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Describe a connection' }).click();
  await expect(
    page.getByText('I connected the right monitor to the dock with HDMI', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm and apply' })).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await page.getByRole('button', { name: 'Confirm and apply' }).click();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(
    stored.connections.filter((c: { source: string }) => c.source === 'user-reported'),
  ).toHaveLength(1);
  expect(stored.devices.every((d: { status: string }) => d.status === 'unknown')).toBe(true);
  await expect(page.getByText('Applied after confirmation')).toBeVisible();
});
test('supports manual connections and undo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'View connections', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Record a connection' });
  await modal.getByRole('combobox', { name: 'First device', exact: true }).selectOption('laptop');
  await modal
    .getByRole('combobox', { name: 'Second device', exact: true })
    .selectOption('monitor-right');
  await modal.getByRole('combobox', { name: 'Connector', exact: true }).selectOption('HDMI');
  await modal.getByRole('button', { name: 'Save as user-reported' }).click();
  let stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.connections).toHaveLength(8);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.connections).toHaveLength(7);
});
test('rejects invalid import without replacing the workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Workspace name').fill('Workspace to keep');
  await page.getByRole('dialog').getByLabel('Lighting').focus();
  const before = await page.evaluate((k) => localStorage.getItem(k), key);
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(
    page.getByText('Invalid DeskTwin v1 JSON file. Your existing workspace was preserved.'),
  ).toBeVisible();
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(before);
});
test('mobile layout fits the viewport and opens a usable device dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'docs/screenshots/hero-mobile.png' });
});
test('guided troubleshooting records only an explicit user test', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page.getByRole('button', { name: /Right monitor Monitor/ }).click();
  await page.getByRole('button', { name: 'Troubleshoot monitor step by step' }).click();
  await expect(page.getByRole('heading', { name: 'Check power and input source' })).toBeVisible();
  await page.getByRole('button', { name: 'Still no display' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check the current cable connection' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'The screen works' }).click();
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await page.getByRole('button', { name: 'Save result as user-reported' }).click();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  const monitor = stored.devices.find((d: { id: string }) => d.id === 'monitor-right');
  expect(monitor.status).toBe('reported-working');
  expect(monitor.statusNote).toContain('Cause not determined');
});
test('photo selection alone never sends an image; adding a proposal needs a second confirmation', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'test-model', photoAvailable: true } }),
  );
  let calls = 0;
  await page.route('**/api/photo', async (route) => {
    calls++;
    const data = route.request().postDataJSON();
    expect(data.consent).toBe(true);
    expect(data.image).toMatch(/^data:image\/jpeg;base64,/);
    await route.fulfill({
      json: {
        mode: 'meta',
        message: 'I found an object that looks like a monitor.',
        proposals: [
          {
            type: 'add-device',
            kind: 'monitor',
            name: 'Monitor in photo',
            x: 1,
            z: -0.6,
            reason: 'Visual inference from the photo',
          },
        ],
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const dataURL = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    return canvas.toDataURL('image/png');
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'desk.png',
    mimeType: 'image/png',
    buffer: Buffer.from(dataURL.split(',')[1], 'base64'),
  });
  await expect(page.getByAltText('Desk reference photo selected by the user')).toBeVisible();
  expect(calls).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Analyze devices and placement with Meta' }),
  ).toBeDisabled();
  await page
    .getByRole('checkbox', { name: /I agree to send this photo and my device setup/ })
    .check();
  await page.getByRole('button', { name: 'Analyze devices and placement with Meta' }).click();
  await expect(page.getByRole('button', { name: 'Confirm and add' })).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await page.getByRole('button', { name: 'Confirm and add' }).click();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices.at(-1).source).toBe('photo-inferred');
  expect(stored.devices.at(-1).status).toBe('unknown');
});
test('Meta is off until explicitly enabled and provider errors preserve state', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'test-model', photoAvailable: true } }),
  );
  let calls = 0;
  await page.route('**/api/chat', async (route) => {
    calls++;
    expect(route.request().postDataJSON().consent).toBe(true);
    await route.fulfill({ status: 502, json: { error: 'Test provider error' } });
  });
  await page.goto('/');
  await expect(page.getByText('Local demo · No external data sent')).toBeVisible();
  await page.getByRole('button', { name: 'Connect Meta API' }).click();
  await page.getByRole('button', { name: 'I understand what will be sent · Enable Meta' }).click();
  await page
    .getByRole('textbox', { name: 'Message DeskTwin' })
    .fill('I connected the right monitor to the dock');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(/Test provider error/)).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
});
test('position changes and deletes can be undone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit placement', exact: true }).first().click();
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page.getByRole('button', { name: /USB-C Dock Dock/ }).click();
  await page.getByRole('slider', { name: 'Device left / right position' }).fill('1.25');
  let stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices.find((d: { id: string }) => d.id === 'dock').placement.x).toBe(1.25);
  await page.getByRole('button', { name: 'Delete device', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices).toHaveLength(7);
  expect(
    stored.connections.some(
      (c: { from: string; to: string }) => c.from === 'dock' || c.to === 'dock',
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices).toHaveLength(8);
});
test('exports inspectable workspace JSON without chat or photos', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('desktwin-workspace.json');
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const data = JSON.parse(Buffer.concat(chunks).toString());
  expect(data.schemaVersion).toBe(1);
  expect(data.devices).toHaveLength(8);
  expect(data).not.toHaveProperty('messages');
  expect(data).not.toHaveProperty('photo');
});

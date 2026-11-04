import { test, expect, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';
const key = 'desktwin.workspace.v1';
async function saved(page: Page): Promise<Workspace | null> {
  return page.evaluate((name) => {
    const value = localStorage.getItem(name);
    return value ? JSON.parse(value) : null;
  }, key);
}
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
  await expect(page.getByRole('button', { name: 'View', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const overview = page.getByRole('complementary', { name: 'Workspace overview', exact: true });
  await expect(overview).toBeVisible();
  await expect(page.locator('header').getByRole('link', { name: /github/i })).toHaveCount(0);
  await expect(overview.getByRole('button', { name: /MacBook Laptop/ })).toBeVisible();
  await overview.getByRole('button', { name: /USB-C Dock Dock/ }).click();
  await expect(page.getByRole('complementary', { name: 'Selected device' })).toBeVisible();
  await expect(page.getByLabel('Operating status user-reported')).toHaveValue('unknown');
  expect(errors).toEqual([]);
});
test('adds a device and persists across reload', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: 'Add a device manually', exact: true })
    .click();
  const modal = page.getByRole('dialog', { name: 'Add device' });
  await modal.getByLabel('Device name').fill('Test display');
  await modal.getByRole('button', { name: 'Add to my desk' }).click();
  await expect(modal).not.toBeVisible();
  await expect
    .poll(async () => (await saved(page))?.devices.find((d) => d.name === 'Test display')?.source)
    .toBe('user-reported');
  await page.reload();
  await expect(
    page
      .getByRole('complementary', { name: 'Workspace overview', exact: true })
      .getByRole('button', { name: /Test display Monitor/ }),
  ).toBeVisible();
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
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: /Right monitor Monitor/ })
    .click();
  await page.getByRole('button', { name: 'Edit device details', exact: true }).click();
  await expect(page.getByLabel('Device name')).toHaveValue('Right monitor');
  await page.getByLabel('Model optional').fill('Display model');
  await page.getByRole('button', { name: 'Save device details' }).click();
  await expect
    .poll(async () => (await saved(page))?.devices.find((d) => d.id === 'monitor-right')?.model)
    .toBe('Display model');
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
  await page
    .getByRole('textbox', { name: 'Message DeskTwin' })
    .fill('I connected the right monitor to the dock with HDMI');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    page.getByText('I connected the right monitor to the dock with HDMI', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit to review connection' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm and apply' })).toHaveCount(0);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await page.getByRole('button', { name: 'Edit to review connection' }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await expect(page.getByRole('button', { name: 'Confirm replacement' })).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'I reviewed the saved connection and want to replace it.' })
    .check();
  await page.getByRole('button', { name: 'Confirm replacement' }).click();
  await expect(page.getByText('Applied after confirmation')).toBeVisible();
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(
    stored.connections.filter((c: { source: string }) => c.source === 'user-reported'),
  ).toHaveLength(1);
  expect(stored.devices.every((d: { status: string }) => d.status === 'unknown')).toBe(true);
  await expect(page.getByText('Applied after confirmation')).toBeVisible();
});
test('supports manual connections and undo', async ({ page }) => {
  await page.goto('/');
  const connections = page.getByRole('switch', { name: 'Show connections' });
  if ((await connections.getAttribute('aria-checked')) !== 'true') await connections.click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Record a connection' });
  await modal.getByRole('combobox', { name: 'First device', exact: true }).selectOption('laptop');
  await modal
    .getByRole('combobox', { name: 'Second device', exact: true })
    .selectOption('monitor-right');
  await modal.getByRole('combobox', { name: 'Connector', exact: true }).selectOption('HDMI');
  await modal.getByRole('button', { name: 'Save as user-reported' }).click();
  await expect.poll(async () => (await saved(page))?.connections.length).toBe(8);
  let stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.connections).toHaveLength(8);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.connections.length).toBe(7);
  stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.connections).toHaveLength(7);
});
test('a first visit starts an own desk from the example without losing furniture', async ({
  page,
}) => {
  await page.goto('/');
  const overview = page.getByRole('complementary', { name: 'Workspace overview', exact: true });
  const start = overview.getByRole('region', { name: 'Start your own desk' });
  await expect(start.getByText('This is an example desk')).toBeVisible();
  await expect(start).toContainText('8 sample devices');
  await start.getByRole('button', { name: 'Start my own desk' }).click();
  await expect(page.getByRole('complementary', { name: 'Desk setup panel' })).toBeVisible();
  await expect.poll(async () => (await saved(page))?.devices.length).toBe(0);
  const stored = (await saved(page))!;
  expect(stored.connections).toHaveLength(0);
  expect(stored.objects.length).toBe(createDemoWorkspace().objects.length);
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  await expect(overview.getByRole('region', { name: 'Start your own desk' })).toHaveCount(0);
  await expect(overview.getByRole('region', { name: 'Get started with your desk' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.devices.length).toBe(8);
  await expect(overview.getByRole('region', { name: 'Start your own desk' })).toBeVisible();
});
test('rejects invalid import without replacing the workspace', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByLabel('Workspace name').fill('Workspace to keep');
  await page.getByRole('dialog').getByLabel('Lighting').focus();
  await expect.poll(async () => (await saved(page))?.name).toBe('Workspace to keep');
  const before = await page.evaluate((k) => localStorage.getItem(k), key);
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"schemaVersion":999}'),
  });
  await expect(
    page.getByText('Invalid DeskTwin v1/v2 JSON file. Your existing workspace was preserved.'),
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
  const expand = page.getByRole('button', { name: /Expand details and controls/ });
  if (await expand.isVisible()) await expand.click();
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: 'Add a device manually', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: 'test-results/hero-mobile.png' });
});
test('guided troubleshooting records only an explicit user test', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: /Right monitor Monitor/ })
    .click();
  await page.getByRole('button', { name: 'Troubleshoot monitor step by step' }).click();
  await expect(page.getByRole('heading', { name: 'Check power and input source' })).toBeVisible();
  await page.getByRole('button', { name: 'Still no display' }).click();
  await expect(
    page.getByRole('heading', { name: 'Confirm the recorded display route' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'This matches my checked connections' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check the current cable connection' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'The screen works' }).click();
  await expect.poll(async () => (await saved(page))?.diagnoses[0]?.result).toBe('resolved');
  expect((await saved(page))?.devices.find((device) => device.id === 'monitor-right')?.status).toBe(
    'unknown',
  );
  await page.getByRole('button', { name: 'Save result as user-reported' }).click();
  await expect
    .poll(async () => (await saved(page))?.devices.find((d) => d.id === 'monitor-right')?.status)
    .toBe('reported-working');
  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  const monitor = stored.devices.find((d: { id: string }) => d.id === 'monitor-right');
  expect(monitor.status).toBe('reported-working');
  expect(monitor.statusNote).toContain('Cause not determined');
});
test('photo selection alone never sends an image; applying a scene needs a second confirmation', async ({
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
        objects: [
          {
            id: 'desk-photo',
            deviceId: null,
            kind: 'desk',
            name: 'Desk in photo',
            placement: { x: 0, y: 0, z: 0, rotation: 0 },
            scale: { x: 1, y: 1, z: 1 },
            color: '#795b43',
            parts: [],
            note: 'Synthetic support for the consent and confirmation test.',
          },
          {
            id: 'monitor-photo',
            deviceId: null,
            kind: 'monitor',
            name: 'Monitor in photo',
            placement: { x: 1, y: 2.51, z: -0.6, rotation: 0 },
            scale: { x: 1, y: 1, z: 1 },
            color: '#334455',
            parts: [],
            note: 'Visual inference from the photo',
            supportId: 'desk-photo',
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
  await expect(page.getByRole('button', { name: 'Create scene preview with Meta' })).toBeDisabled();
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  await page.getByRole('button', { name: /^Continue with \d+ objects?$/ }).click();
  await expect(page.getByRole('button', { name: 'Confirm and apply scene' })).toBeVisible();
  expect(calls).toBe(1);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
  await page.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect.poll(async () => (await saved(page))?.devices.at(-1)?.source).toBe('photo-inferred');
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
  const initial = createDemoWorkspace();
  initial.objects = [];
  initial.devices.forEach((device, i) => {
    device.placement = { x: -3 + (i % 4) * 2, y: 0.1 + Math.floor(i / 4) * 3, z: 0, rotation: 0 };
  });
  initial.devices.find((device) => device.id === 'dock')!.placement = {
    x: -1,
    y: 1.8,
    z: 2.8,
    rotation: 0,
  };
  await page.addInitScript(({ storageKey, value }) => localStorage.setItem(storageKey, value), {
    storageKey: key,
    value: JSON.stringify(initial),
  });
  await page.goto('/');
  await page
    .getByRole('group', { name: 'Workspace mode' })
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: /USB-C Dock Dock/ })
    .click();
  await page.getByRole('slider', { name: 'Device left / right position' }).fill('1.25');
  await expect
    .poll(async () => (await saved(page))?.devices.find((d) => d.id === 'dock')?.placement.x)
    .toBe(1.25);
  let stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices.find((d: { id: string }) => d.id === 'dock').placement.x).toBe(1.25);
  await page.getByRole('button', { name: 'Delete device', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.devices.length).toBe(7);
  stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), key);
  expect(stored.devices).toHaveLength(7);
  expect(
    stored.connections.some(
      (c: { from: string; to: string }) => c.from === 'dock' || c.to === 'dock',
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page))?.devices.length).toBe(8);
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
  expect(data.schemaVersion).toBe(2);
  expect(data.devices).toHaveLength(8);
  expect(data).not.toHaveProperty('messages');
  expect(data).not.toHaveProperty('photo');
});

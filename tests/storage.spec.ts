import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

const key = 'desktwin.workspace.v1';
const lockName = 'desktwin.workspace.write';
test.setTimeout(60_000);

async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name)!), key);
}
async function openTwoTabs(context: BrowserContext, page: Page, fixture?: Workspace) {
  await context.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await context.route('**/api/health', (route) => route.fulfill({ json: { mode: 'demo' } }));
  await page.goto('/');
  const initial = fixture ? structuredClone(fixture) : createDemoWorkspace();
  initial.name = 'Shared desk';
  await page.evaluate(({ name, value }) => localStorage.setItem(name, value), {
    name: key,
    value: JSON.stringify(initial),
  });
  await page.reload();
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('heading', { name: 'Shared desk', exact: true })).toBeVisible();
  return { second, initial };
}
async function beginRename(page: Page, name: string) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const modal = page.getByRole('dialog', { name: 'Workspace settings' });
  await modal.getByLabel('Workspace name', { exact: true }).fill(name);
  return modal;
}
async function commitRename(page: Page, name: string) {
  const modal = await beginRename(page, name);
  await modal.getByLabel('Workspace name', { exact: true }).press('Tab');
  await expect.poll(async () => (await saved(page)).name).toBe(name);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
}

// These pages share one browser context: this exercises real localStorage events
// and the browser's cross-document Web Locks implementation, not a mocked store.
test('a stale tab cannot overwrite another tab; reload resets undo and retains the winner', async ({
  context,
  page,
}) => {
  const { second } = await openTwoTabs(context, page);
  await commitRename(page, 'Saved by tab A');
  await expect(second.getByRole('button', { name: 'Load latest saved workspace' })).toBeVisible();
  const stale = await beginRename(second, 'Stale edit from tab B');
  await stale.getByLabel('Workspace name', { exact: true }).press('Tab');
  await stale.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await saved(page)).name).toBe('Saved by tab A');
  await expect(second.getByRole('heading', { name: 'Shared desk', exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Load latest saved workspace' }).click();
  await expect(second.getByRole('heading', { name: 'Saved by tab A', exact: true })).toBeVisible();
  await expect(second.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await commitRename(second, 'Saved by tab B after reload');
  await second.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await saved(page)).name).toBe('Saved by tab A');
  await second.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(async () => (await saved(page)).name).toBe('Saved by tab B after reload');
  await second.reload();
  await expect(
    second.getByRole('heading', { name: 'Saved by tab B after reload', exact: true }),
  ).toBeVisible();
});

test('an open photo preview cannot overwrite a newer save from another tab', async ({
  context,
  page,
}) => {
  const fixture = createDemoWorkspace();
  fixture.connections[0] = {
    ...fixture.connections[0],
    source: 'user-reported',
    fromPort: 'Left USB-C port',
    toPort: 'Host input',
    note: 'Recorded by the user; operation has not been tested.',
  };
  const { second, initial } = await openTwoTabs(context, page, fixture);
  await second.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'mock-only', photoAvailable: true } }),
  );
  await second.route('**/api/photo', (route) =>
    route.fulfill({
      json: {
        mode: 'meta',
        message: 'Mock-only proposal for the older workspace.',
        objects: [
          {
            id: 'desk',
            deviceId: null,
            kind: 'desk',
            name: 'Unapplied photo desk',
            placement: { x: 0, y: 0, z: 0, rotation: 0 },
            scale: { x: 1, y: 1, z: 1 },
            color: '#aabbcc',
            parts: [],
            note: 'A visual estimate, not a device or cable test.',
          },
        ],
      },
    }),
  );
  await second.reload();
  await second.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await second.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#aabbcc';
    ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await second.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-cross-tab-desk.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await second.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await second.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const preview = second.getByRole('dialog', { name: 'Review your desk scene' });
  const apply = preview.getByRole('button', { name: 'Confirm and apply scene' });
  await expect(preview).toBeVisible();
  await expect(apply).toBeEnabled();
  expect(await saved(second)).toEqual(initial);

  // Tab A saves through the real UI after tab B has prepared its photo snapshot.
  await commitRename(page, 'Newer workspace from tab A');
  const latest = await saved(page);
  expect(latest.connections).toEqual(initial.connections);
  await expect(apply).toBeDisabled();
  await expect(
    preview.getByText(/Your saved workspace changed after this preview started/),
  ).toBeVisible();
  expect(await saved(second)).toEqual(latest);
  await expect(preview).toBeVisible();

  await preview.getByRole('button', { name: 'Discard preview' }).click();
  await expect(preview).not.toBeVisible();
  await second.getByRole('button', { name: 'Load latest saved workspace' }).click();
  await expect(
    second.getByRole('heading', { name: 'Newer workspace from tab A', exact: true }),
  ).toBeVisible();
  await expect(second.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await saved(second)).toEqual(latest);
  expect((await saved(second)).connections).toEqual(initial.connections);
  expect(
    (await saved(second)).objects.some((object) => object.name === 'Unapplied photo desk'),
  ).toBe(false);
});

test('two writes queued behind the same Web Lock produce one winner without a lost update', async ({
  context,
  page,
}) => {
  const { second } = await openTwoTabs(context, page);
  await page.evaluate((lock) => {
    const held = window as typeof window & { releaseTestLock?: () => void };
    void navigator.locks.request(
      lock,
      () =>
        new Promise<void>((release) => {
          held.releaseTestLock = release;
        }),
    );
  }, lockName);
  await expect.poll(() => page.evaluate(() => 'releaseTestLock' in window)).toBe(true);
  const firstSettings = await beginRename(page, 'Concurrent A');
  const secondSettings = await beginRename(second, 'Concurrent B');
  await firstSettings.getByLabel('Workspace name', { exact: true }).press('Tab');
  await secondSettings.getByLabel('Workspace name', { exact: true }).press('Tab');
  await expect
    .poll(() =>
      page.evaluate(async (name) => {
        const locks = await navigator.locks.query();
        return locks.pending?.filter((lock) => lock.name === name).length ?? 0;
      }, lockName),
    )
    .toBe(2);
  expect((await saved(page)).name).toBe('Shared desk');
  await page.evaluate(() => {
    (window as typeof window & { releaseTestLock: () => void }).releaseTestLock();
  });
  await expect.poll(async () => (await saved(page)).name).toBe('Concurrent A');
  await expect(second.getByRole('button', { name: 'Load latest saved workspace' })).toBeVisible();
  expect(
    (await saved(page)).history.filter((event) => event.summary === 'Renamed workspace'),
  ).toHaveLength(1);
});

test('stale undo cannot restore an older snapshot over another tab and invalid external data is kept', async ({
  context,
  page,
}) => {
  const { second } = await openTwoTabs(context, page);
  await commitRename(page, 'Tab A history');
  await second.getByRole('button', { name: 'Load latest saved workspace' }).click();
  await commitRename(second, 'Tab B latest');
  // An existing Undo history in tab A must obey the same compare-and-write guard.
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).name).toBe('Tab B latest');
  await second.evaluate((name) => localStorage.setItem(name, '{invalid external data'), key);
  await expect(page.getByRole('button', { name: 'Load latest saved workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Load latest saved workspace' }).click();
  await expect(page.getByText(/The latest saved workspace is invalid/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tab A history', exact: true })).toBeVisible();
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(
    '{invalid external data',
  );
});

test('a browser without Web Locks never falls back to unsafe overwrite', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.goto('/');
  const original = await page.evaluate((name) => localStorage.getItem(name), key);
  const settings = await beginRename(page, 'Unsafe browser attempt');
  await settings.getByLabel('Workspace name', { exact: true }).press('Tab');
  await expect(page.getByText(/Safe saving requires a browser with Web Locks/)).toBeVisible();
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(original);
});

test('a failed browser save keeps a photo preview open and does not consume an undo step', async ({
  page,
}) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'mock-only', photoAvailable: true } }),
  );
  await page.route('**/api/photo', (route) =>
    route.fulfill({
      json: {
        mode: 'meta',
        message: 'Mock-only desk proposal.',
        objects: [
          {
            id: 'desk',
            deviceId: null,
            kind: 'desk',
            name: 'Proposed desk',
            placement: { x: 0, y: 0, z: 0, rotation: 0 },
            scale: { x: 1, y: 1, z: 1 },
            color: '#aabbcc',
            parts: [],
            note: 'Approximate desk.',
          },
        ],
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#aabbcc';
    ctx.fillRect(0, 0, 4, 4);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'mock-desk.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const preview = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(preview).toBeVisible();
  const before = await page.evaluate((name) => localStorage.getItem(name), key);
  await page.evaluate((name) => {
    const original = Storage.prototype.setItem;
    (window as typeof window & { restoreStorage?: () => void }).restoreStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (entry, value) {
      if (entry === name) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, entry, value);
    };
  }, key);
  await preview.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(page.getByText(/Could not save in your browser/)).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await page.evaluate((name) => localStorage.getItem(name), key)).toBe(before);
  await page.evaluate(() => {
    (window as typeof window & { restoreStorage: () => void }).restoreStorage();
  });
  await preview.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(preview).not.toBeVisible();
  await expect.poll(async () => (await saved(page)).objects[0].name).toBe('Proposed desk');
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});

test('a prepared import cannot overwrite a same-tab edit queued before it', async ({
  context,
  page,
}) => {
  const { second, initial } = await openTwoTabs(context, page);
  await second.close();
  await page.evaluate((lock) => {
    const held = window as typeof window & { releaseTestLock?: () => void };
    void navigator.locks.request(
      lock,
      () =>
        new Promise<void>((release) => {
          held.releaseTestLock = release;
        }),
    );
  }, lockName);
  await expect.poll(() => page.evaluate(() => 'releaseTestLock' in window)).toBe(true);
  const settings = await beginRename(page, 'Earlier queued edit');
  await settings.getByLabel('Workspace name', { exact: true }).press('Tab');
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'prepared.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...initial, name: 'Later stale replacement' })),
  });
  await expect
    .poll(() =>
      page.evaluate(async (name) => {
        const locks = await navigator.locks.query();
        return locks.pending?.filter((lock) => lock.name === name).length ?? 0;
      }, lockName),
    )
    .toBe(1);
  // Operations in this tab have their own queue, so only the first reaches Web Locks yet.
  await page.evaluate(() => {
    (window as typeof window & { releaseTestLock: () => void }).releaseTestLock();
  });
  await expect.poll(async () => (await saved(page)).name).toBe('Earlier queued edit');
  await expect(
    page.getByText(/The workspace changed before this replacement could be saved/),
  ).toBeVisible();
});

test('device and connection dialogs retain entries after a failed save and close only on success', async ({
  page,
}) => {
  const fixture = createDemoWorkspace();
  fixture.objects = [];
  fixture.devices = fixture.devices.slice(0, 2);
  fixture.connections = [];
  await page.addInitScript(({ name, value }) => localStorage.setItem(name, value), {
    name: key,
    value: JSON.stringify(fixture),
  });
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.goto('/');
  await page.evaluate((name) => {
    const original = Storage.prototype.setItem;
    const controls = window as typeof window & { blockWrites?: boolean };
    controls.blockWrites = true;
    Storage.prototype.setItem = function (entry, value) {
      if (entry === name && controls.blockWrites)
        throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, entry, value);
    };
  }, key);
  await page.getByRole('button', { name: 'Add device', exact: true }).click();
  const device = page.getByRole('dialog', { name: 'Add device', exact: true });
  await device.getByLabel('Device name', { exact: true }).fill('Kept display entry');
  await device.getByRole('button', { name: 'Add to my desk' }).click();
  await expect(device.getByRole('alert')).toHaveText(/The device was not saved/);
  await expect(device.getByLabel('Device name', { exact: true })).toHaveValue('Kept display entry');
  expect((await saved(page)).devices).toHaveLength(2);
  await page.evaluate(() => {
    (window as typeof window & { blockWrites: boolean }).blockWrites = false;
  });
  await device.getByRole('button', { name: 'Add to my desk' }).click();
  await expect(device).not.toBeVisible();
  await expect.poll(async () => (await saved(page)).devices.length).toBe(3);

  await page.evaluate(() => {
    (window as typeof window & { blockWrites: boolean }).blockWrites = true;
  });
  await page.getByRole('button', { name: 'View connections', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const connection = page.getByRole('dialog', { name: 'Record a connection' });
  await connection.getByRole('combobox', { name: 'Connector', exact: true }).selectOption('HDMI');
  await connection.getByLabel(/First device port/).fill('Kept HDMI port');
  await connection.getByRole('button', { name: 'Save as user-reported' }).click();
  await expect(connection.getByRole('alert')).toHaveText(/The connection was not saved/);
  await expect(connection.getByLabel(/First device port/)).toHaveValue('Kept HDMI port');
  expect((await saved(page)).connections).toHaveLength(0);
  await page.evaluate(() => {
    (window as typeof window & { blockWrites: boolean }).blockWrites = false;
  });
  await connection.getByRole('button', { name: 'Save as user-reported' }).click();
  await expect(connection).not.toBeVisible();
  expect((await saved(page)).connections[0]).toMatchObject({
    connector: 'HDMI',
    fromPort: 'Kept HDMI port',
    source: 'user-reported',
  });
});

test('a failed diagnostic save never claims the user-reported result was saved', async ({
  page,
}) => {
  const fixture = createDemoWorkspace();
  fixture.objects = [];
  fixture.devices = [fixture.devices.find((device) => device.id === 'monitor-left')!];
  fixture.connections = [];
  await page.addInitScript(({ name, value }) => localStorage.setItem(name, value), {
    name: key,
    value: JSON.stringify(fixture),
  });
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.goto('/');
  await page.evaluate((name) => {
    const original = Storage.prototype.setItem;
    const controls = window as typeof window & { blockWrites?: boolean };
    controls.blockWrites = true;
    Storage.prototype.setItem = function (entry, value) {
      if (entry === name && controls.blockWrites)
        throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, entry, value);
    };
  }, key);
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page.getByRole('button', { name: /^Left monitor Monitor/ }).click();
  await page.getByRole('button', { name: 'Troubleshoot monitor step by step' }).click();
  await page.getByRole('button', { name: 'The screen works', exact: true }).click();
  await page.getByRole('button', { name: 'Save result as user-reported' }).click();
  await expect(page.getByText(/The test result was not saved/)).toBeVisible();
  await expect(
    page.getByText('Saved as a user-reported test result', { exact: true }),
  ).not.toBeVisible();
  expect((await saved(page)).devices[0].status).toBe(fixture.devices[0].status);
  await page.evaluate(() => {
    (window as typeof window & { blockWrites: boolean }).blockWrites = false;
  });
  await page.getByRole('button', { name: 'Save result as user-reported' }).click();
  await expect(
    page.getByText('Saved as a user-reported test result', { exact: true }),
  ).toBeVisible();
  expect((await saved(page)).devices[0].status).toBe('reported-working');
});

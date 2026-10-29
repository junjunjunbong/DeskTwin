import { expect, test, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

const key = 'desktwin.workspace.v1';
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name)!), key);
}
async function seed(page: Page) {
  const workspace = createDemoWorkspace();
  await page.addInitScript(
    ({ name, value }) => {
      if (!sessionStorage.getItem('mode-fixture')) {
        localStorage.setItem(name, JSON.stringify(value));
        sessionStorage.setItem('mode-fixture', 'yes');
      }
    },
    { name: key, value: workspace },
  );
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  return workspace;
}

test('View and Edit use the same non-overlapping fixed details area and preserve drafts', async ({
  page,
}) => {
  const initial = await seed(page);
  const overview = page.getByRole('complementary', { name: 'Workspace overview', exact: true });
  await expect(overview).toBeVisible();
  await expect(overview.getByLabel('Workspace counts')).toContainText('8');
  await expect(page.getByRole('button', { name: 'View', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const canvas = (await page.getByTestId('desk-canvas').boundingBox())!;
  const dock = (await page
    .getByRole('region', { name: 'Workspace details', exact: true })
    .boundingBox())!;
  expect(canvas.x + canvas.width).toBeLessThanOrEqual(dock.x + 1);
  await page.screenshot({ path: 'test-results/workspace-overview-desktop.png' });
  await overview.getByRole('button', { name: /^USB-C Dock Dock/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected device', exact: true });
  await expect(inspector).toBeVisible();
  await expect(inspector.getByText('Needs a user check', { exact: true })).toBeVisible();
  await expect(inspector.getByLabel('Device width scale', { exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('.device-marker:visible')).toHaveCount(0);
  const name = inspector.getByLabel('Device name', { exact: true });
  const model = inspector.getByLabel('Model optional');
  const width = inspector.getByLabel('Device width scale', { exact: true });
  await name.fill('My unsaved dock');
  await model.fill('Model draft');
  await width.fill('-');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(inspector.getByRole('heading', { name: 'USB-C Dock', exact: true })).toBeVisible();
  await expect(width).not.toBeVisible();
  expect(await saved(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(name).toHaveValue('My unsaved dock');
  await expect(model).toHaveValue('Model draft');
  await expect(width).toHaveValue('-');
  await width.press('Escape');
  await inspector.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices.find((d) => d.id === 'dock')?.name)
    .toBe('My unsaved dock');
  expect((await saved(page)).connections).toEqual(initial.connections);
  const editedCanvas = (await page.getByTestId('desk-canvas').boundingBox())!;
  expect(editedCanvas).toEqual(canvas);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/workspace-edit-desktop.png' });
});

test('a reported issue opens its fixed inspector and existing checks without an automatic status change', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const monitor = initial.devices.find((device) => device.id === 'monitor-right')!;
  monitor.status = 'reported-issue';
  monitor.statusNote = 'The display has no picture.';
  await page.addInitScript(({ name, value }) => localStorage.setItem(name, JSON.stringify(value)), {
    name: key,
    value: initial,
  });
  await page.goto('/');
  await page
    .getByRole('region', { name: 'Devices with reported issues', exact: true })
    .getByRole('button', { name: /Right monitor/ })
    .click();
  const inspector = page.getByRole('complementary', { name: 'Selected device', exact: true });
  await expect(inspector.locator('.reported-status')).toHaveText('User reports an issue');
  await expect(inspector.locator('.reported-status')).toBeVisible();
  await expect(inspector.locator('.record-note')).toHaveText('The display has no picture.');
  await expect(inspector.locator('.record-note')).toBeVisible();
  await expect(
    inspector.getByRole('button', { name: 'Select connected device USB-C Dock' }),
  ).toBeVisible();
  await inspector.getByRole('button', { name: 'Troubleshoot monitor step by step' }).click();
  await expect(
    inspector.getByRole('button', { name: 'Still no display', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await saved(page)).toEqual(initial);
});

test('the mobile details area collapses to give the canvas room without changing the workspace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = await seed(page);
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Device list panel', exact: true })
    .getByRole('button', { name: /^USB-C Dock Dock/ })
    .click();
  const toggle = page.locator('.detail-dock-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const expanded = (await page.getByTestId('desk-canvas').boundingBox())!;
  expect(expanded.height).toBeGreaterThan(180);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect
    .poll(async () => (await page.getByTestId('desk-canvas').boundingBox())!.height)
    .toBeGreaterThan(expanded.height + 80);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('switch', { name: 'Show connections', exact: true }).click();
  await expect(page.locator('.connection-summary [data-connection-id]')).toHaveCount(7);
  await toggle.click();
  await expect(
    page.getByRole('complementary', { name: 'Selected device', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Device width scale', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await saved(page)).toEqual(initial);
  await page.screenshot({ path: 'test-results/workspace-edit-mobile.png' });
});

test('a save click waits for the storage transaction and remains pending across a mode switch', async ({
  page,
}) => {
  const initial = await seed(page);
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: /^USB-C Dock Dock/ })
    .click();
  await page.getByRole('button', { name: 'Edit device details', exact: true }).click();
  await page.getByLabel('Model optional').fill('Saved after the lock');
  await page.evaluate(async () => {
    await new Promise<void>((acquired) => {
      void navigator.locks.request('desktwin.workspace.write', async () => {
        await new Promise<void>((release) => {
          (window as Window & { releaseModeSave?: () => void }).releaseModeSave = release;
          acquired();
        });
      });
    });
  });
  const save = page.getByRole('button', { name: 'Save device details', exact: true });
  await save.click();
  await expect(save).toBeDisabled();
  await expect(page.getByLabel('Device name', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Model optional')).toBeDisabled();
  // This is why an immediate localStorage assertion after click was racy: the
  // browser has accepted the action, but the transaction has not committed.
  expect(await saved(page)).toEqual(initial);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  expect(await saved(page)).toEqual(initial);
  await page.evaluate(() =>
    (window as Window & { releaseModeSave?: () => void }).releaseModeSave?.(),
  );
  await expect
    .poll(async () => (await saved(page)).devices.find((d) => d.id === 'dock')?.model)
    .toBe('Saved after the lock');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(save).toBeEnabled();
  await expect(page.getByLabel('Model optional')).toHaveValue('Saved after the lock');
  expect((await saved(page)).history).toHaveLength(1);
});

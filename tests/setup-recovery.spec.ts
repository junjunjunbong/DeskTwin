import { expect, test, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

const key = 'desktwin.workspace.v1';
test.setTimeout(60_000);

async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name)!), key);
}

test('adding a device can recover from another tab without losing its entered name or template', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  context.on('page', (opened) => opened.on('pageerror', (error) => errors.push(error.message)));
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/health', (route) => route.fulfill({ json: { mode: 'demo' } }));
  await context.route('**/api/chat', (route) => route.abort('blockedbyclient'));
  await context.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await context.route('**/api/hardware/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Fixture: hardware is unavailable.' } }),
  );
  const initial = createDemoWorkspace();
  await page.addInitScript(
    ({ storageKey, workspace }) => {
      if (!sessionStorage.getItem('setup-recovery-seeded')) {
        localStorage.setItem(storageKey, JSON.stringify(workspace));
        sessionStorage.setItem('setup-recovery-seeded', 'yes');
      }
    },
    { storageKey: key, workspace: initial },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Setup guide', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Desk setup panel', exact: true })
    .getByRole('button', { name: 'Add a device', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add device', exact: true });
  await dialog.getByRole('combobox', { name: 'Type', exact: true }).selectOption('monitor');
  await dialog.getByLabel('Device name', { exact: true }).fill('My unsaved setup monitor');

  const second = await context.newPage();
  await second.goto('/');
  await second
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: /^MacBook / })
    .click();
  await second.getByRole('button', { name: 'Edit device details', exact: true }).click();
  await second.getByLabel('Model optional').fill('A model saved in the second tab');
  await second.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices.find((device) => device.id === 'laptop')?.model)
    .toBe('A model saved in the second tab');
  const changed = await saved(page);

  await expect(dialog.getByRole('alert', { name: 'Storage conflict', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to my desk', exact: true }).click();
  await expect(dialog).toContainText('The device was not saved.');
  expect(await saved(page)).toEqual(changed);
  await dialog.getByRole('button', { name: 'Load latest saved workspace', exact: true }).click();
  await expect(dialog.getByLabel('Device name', { exact: true })).toHaveValue(
    'My unsaved setup monitor',
  );
  await expect(dialog.getByRole('combobox', { name: 'Type', exact: true })).toHaveValue('monitor');
  await dialog.getByRole('button', { name: 'Add to my desk', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = await saved(page);
  expect(result.devices).toHaveLength(changed.devices.length + 1);
  expect(result.devices.find((device) => device.name === 'My unsaved setup monitor')).toMatchObject(
    {
      kind: 'monitor',
      status: 'unknown',
      statusNote: '',
      source: 'user-reported',
    },
  );
  expect(result.devices.find((device) => device.id === 'laptop')?.model).toBe(
    'A model saved in the second tab',
  );
  expect(result.history).toHaveLength(changed.history.length + 1);
  expect(errors).toEqual([]);
});

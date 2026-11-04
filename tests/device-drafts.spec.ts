import { expect, test, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

const key = 'desktwin.workspace.v1';
const lock = 'desktwin.workspace.write';
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { mode: 'demo' } }));
  await page.route('**/api/chat', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
});
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name)!), key);
}
async function seed(page: Page, workspace = createDemoWorkspace()) {
  await page.addInitScript(
    ({ name, value }) => {
      if (!sessionStorage.getItem('device-drafts-seeded')) {
        localStorage.setItem(name, JSON.stringify(value));
        sessionStorage.setItem('device-drafts-seeded', 'yes');
      }
    },
    { name: key, value: workspace },
  );
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  return workspace;
}
async function revealOverview(page: Page) {
  const overview = page.getByRole('complementary', { name: 'Workspace overview', exact: true });
  if (await overview.isVisible()) return overview;
  const expand = page.getByRole('button', { name: /Expand details and controls/ });
  if (await expand.isVisible()) await expand.click();
  if (await overview.isVisible()) return overview;
  const edit = page
    .getByRole('group', { name: 'Workspace mode' })
    .getByRole('button', { name: 'Edit', exact: true });
  const editing = (await edit.getAttribute('aria-pressed')) === 'true';
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  if (editing) await edit.click();
  if (!(await overview.isVisible()) && (await expand.isVisible())) await expand.click();
  return overview;
}
async function selectDevice(page: Page, name: string) {
  await (
    await revealOverview(page)
  )
    .getByRole('button', { name: new RegExp(`^${name} .+ · `) })
    .click();
}
function inspector(page: Page) {
  return page.getByRole('complementary', { name: 'Selected device', exact: true });
}
async function edit(page: Page) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
}
async function holdWrites(page: Page) {
  await page.evaluate(async (name) => {
    await new Promise<void>((acquired) => {
      void navigator.locks.request(
        name,
        () =>
          new Promise<void>((release) => {
            (window as Window & { releaseDraftLock?: () => void }).releaseDraftLock = release;
            acquired();
          }),
      );
    });
  }, lock);
}
async function releaseWrites(page: Page) {
  await page.evaluate(() =>
    (window as Window & { releaseDraftLock?: () => void }).releaseDraftLock?.(),
  );
}

test('device drafts survive View, Home, device switches, close and other panels without saving', async ({
  page,
}, testInfo) => {
  const initial = await seed(page);
  await selectDevice(page, 'USB-C Dock');
  await page.getByRole('button', { name: 'Edit device details', exact: true }).click();
  await page.getByLabel('Device name', { exact: true }).fill('My unsaved dock');
  await page.getByLabel('Model optional').fill('Unsaved model 731');
  await page.getByLabel('Operating status user-reported').selectOption('reported-working');
  await page.getByLabel('What did you check?').fill('Unsaved user observation');
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(
    inspector(page).getByRole('heading', { name: 'USB-C Dock', exact: true }),
  ).toBeVisible();
  await expect(inspector(page).locator('.reported-status')).toHaveText('Needs a user check');
  await expect(
    inspector(page).getByRole('region', { name: 'Unsaved device details' }),
  ).toBeVisible();
  expect(await saved(page)).toEqual(initial);
  await page.screenshot({ path: testInfo.outputPath('unsaved-details-view.png') });
  await edit(page);
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue('My unsaved dock');
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  await selectDevice(page, 'USB-C Dock');
  await page.getByRole('button', { name: 'Resume editing draft' }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue('My unsaved dock');
  await expect(page.getByLabel('Model optional')).toHaveValue('Unsaved model 731');
  await expect(page.getByLabel('Operating status user-reported')).toHaveValue('reported-working');
  await expect(page.getByLabel('What did you check?')).toHaveValue('Unsaved user observation');

  await inspector(page)
    .getByRole('button', { name: 'Select connected device MacBook', exact: true })
    .click();
  await page.getByLabel('Model optional').fill('Separate laptop draft');
  await page.getByRole('button', { name: 'Close device details' }).click();
  await page
    .getByRole('complementary', { name: 'Workspace overview', exact: true })
    .getByRole('button', { name: 'Build from a photo', exact: true })
    .click();
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  const drafts = page.getByRole('region', { name: 'Unsaved device drafts', exact: true });
  await expect(
    drafts.getByRole('button', { name: 'Review unsaved details for USB-C Dock' }),
  ).toBeVisible();
  await expect(
    drafts.getByRole('button', { name: 'Review unsaved details for MacBook' }),
  ).toBeVisible();
  expect(await saved(page)).toEqual(initial);
  await page.screenshot({ path: testInfo.outputPath('unsaved-drafts-after-home.png') });
  await drafts.getByRole('button', { name: 'Review unsaved details for USB-C Dock' }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue('My unsaved dock');
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue('USB-C Dock');
  await expect(page.getByLabel('Operating status user-reported')).toHaveValue('unknown');
  await page.getByRole('button', { name: 'Review unsaved details for MacBook' }).click();
  await expect(page.getByLabel('Model optional')).toHaveValue('Separate laptop draft');
  await page.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices.find((item) => item.id === 'laptop')?.model)
    .toBe('Separate laptop draft');
  const result = await saved(page);
  expect(result.devices.find((item) => item.id === 'dock')).toEqual(
    initial.devices.find((item) => item.id === 'dock'),
  );
  expect(result.devices.every((item) => item.status === 'unknown')).toBe(true);
  expect(result.connections).toEqual(initial.connections);
  expect(result.history).toHaveLength(1);
  await expect(
    page.getByRole('region', { name: 'Unsaved device drafts', exact: true }),
  ).toHaveCount(0);
});

test('a preserved draft requires review after another tab changes the saved record', async ({
  page,
  context,
}) => {
  const initial = await seed(page);
  await selectDevice(page, 'USB-C Dock');
  await edit(page);
  await page.getByLabel('Device name', { exact: true }).fill('Reviewed dock draft');
  const second = await context.newPage();
  await second.goto('/');
  await selectDevice(second, 'USB-C Dock');
  await edit(second);
  await second.getByLabel('Model optional').fill('Saved in another tab');
  await second.getByLabel('Operating status user-reported').selectOption('reported-issue');
  await second.getByLabel('What did you check?').fill('Other tab checked the dock output');
  await second.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices.find((item) => item.id === 'dock')?.model)
    .toBe('Saved in another tab');
  await expect(
    page.getByRole('button', { name: 'Save device details', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Load latest saved workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Review unsaved details for USB-C Dock' }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue('Reviewed dock draft');
  await expect(
    inspector(page).getByText('Saved details changed. Review before saving.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save device details', exact: true }),
  ).toBeDisabled();
  await expect(inspector(page).locator('.reported-status')).toHaveText('User reports an issue');
  await page.getByRole('button', { name: 'Keep my edited fields after review' }).click();
  await expect(page.getByLabel('Model optional')).toHaveValue('Saved in another tab');
  await expect(page.getByLabel('Operating status user-reported')).toHaveValue('reported-issue');
  await page.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices.find((item) => item.id === 'dock')?.name)
    .toBe('Reviewed dock draft');
  const result = await saved(page);
  expect(result.devices.find((item) => item.id === 'dock')).toMatchObject({
    name: 'Reviewed dock draft',
    model: 'Saved in another tab',
    status: 'reported-issue',
    statusNote: 'Other tab checked the dock output',
    placement: initial.devices.find((item) => item.id === 'dock')!.placement,
  });
  expect(result.connections).toEqual(initial.connections);
});

test('deleted and imported devices cannot silently reuse an old draft', async ({ page }) => {
  const initial = await seed(page);
  await selectDevice(page, 'USB-C Dock');
  await edit(page);
  await page.getByLabel('Device name', { exact: true }).fill('Recoverable deleted draft');
  await page.getByRole('button', { name: 'Delete device', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm deletion', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices.some((item) => item.id === 'dock'))
    .toBe(false);
  const removedDraft = page.locator('.device-draft-list details');
  await removedDraft.locator('summary').click();
  await expect(removedDraft).toContainText('Recoverable deleted draft');
  await expect(removedDraft).toContainText('Device no longer in this workspace');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(initial);
  await page.getByRole('button', { name: 'Review unsaved details for USB-C Dock' }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue(
    'Recoverable deleted draft',
  );
  await expect(
    page.getByRole('button', { name: 'Save device details', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await page.getByLabel('Model optional').fill('Draft before import');
  const imported = { ...initial, name: 'Imported replacement workspace' };
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'draft-safety-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect.poll(async () => (await saved(page)).name).toBe(imported.name);
  await page
    .getByRole('dialog', { name: 'Workspace settings' })
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await page.getByRole('button', { name: 'Review unsaved details for USB-C Dock' }).click();
  await expect(page.getByLabel('Model optional')).toHaveValue('Draft before import');
  await expect(
    page.getByRole('button', { name: 'Save device details', exact: true }),
  ).toBeDisabled();
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  expect(await saved(page)).toEqual(imported);
});

test('a pending save survives inspector unmount and leaves another device draft untouched', async ({
  page,
}) => {
  const initial = await seed(page);
  await selectDevice(page, 'USB-C Dock');
  await edit(page);
  await page.getByLabel('Model optional').fill('Saved after navigation');
  await holdWrites(page);
  await page.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect(page.getByLabel('Model optional')).toBeDisabled();
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  await selectDevice(page, 'MacBook');
  await edit(page);
  await page.getByLabel('Model optional').fill('Unrelated unsaved laptop model');
  expect(await saved(page)).toEqual(initial);
  await selectDevice(page, 'USB-C Dock');
  await expect(page.getByLabel('Model optional')).toBeDisabled();
  await expect(page.getByLabel('Model optional')).toHaveValue('Saved after navigation');
  await releaseWrites(page);
  await expect
    .poll(async () => (await saved(page)).devices.find((item) => item.id === 'dock')?.model)
    .toBe('Saved after navigation');
  await expect(page.getByLabel('Model optional')).toBeEnabled();
  await expect(
    inspector(page).getByRole('region', { name: 'Unsaved device details', exact: true }),
  ).toHaveCount(0);
  await selectDevice(page, 'MacBook');
  await expect(page.getByLabel('Model optional')).toHaveValue('Unrelated unsaved laptop model');
  expect((await saved(page)).devices.find((item) => item.id === 'laptop')!.model).toBe(
    initial.devices.find((item) => item.id === 'laptop')!.model,
  );
});

test('a queued detail save cannot overwrite a diagnostic report committed ahead of it', async ({
  page,
}) => {
  await seed(page);
  await selectDevice(page, 'Right monitor');
  await edit(page);
  await page.getByLabel('Device name', { exact: true }).fill('Draft waiting behind a diagnosis');
  await page.getByRole('button', { name: 'Troubleshoot monitor step by step' }).click();
  await page.getByRole('button', { name: 'The screen works', exact: true }).click();
  await expect
    .poll(async () =>
      (await saved(page)).diagnoses.some(
        (session) => session.deviceId === 'monitor-right' && session.result === 'resolved',
      ),
    )
    .toBe(true);
  const beforeStatusSave = await saved(page);
  await holdWrites(page);
  await page.getByRole('button', { name: 'Save result as user-reported' }).click();
  await page.getByRole('button', { name: 'Save device details', exact: true }).click();
  expect(await saved(page)).toEqual(beforeStatusSave);
  await releaseWrites(page);
  await expect
    .poll(
      async () => (await saved(page)).devices.find((item) => item.id === 'monitor-right')?.status,
    )
    .toBe('reported-working');
  await expect(
    inspector(page).getByText('Your details were not saved.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Device name', { exact: true })).toHaveValue(
    'Draft waiting behind a diagnosis',
  );
  const result = await saved(page);
  expect(result.devices.find((item) => item.id === 'monitor-right')!.name).toBe('Right monitor');
  expect(result.devices.find((item) => item.id === 'monitor-right')!.statusNote).not.toBe('');
  expect(result.history).toHaveLength(beforeStatusSave.history.length + 1);
  await expect(
    page.getByRole('button', { name: 'Save device details', exact: true }),
  ).toBeDisabled();
});

test('a status-only draft cannot inherit a newer diagnostic success note during review', async ({
  page,
}) => {
  await seed(page);
  await selectDevice(page, 'Right monitor');
  await edit(page);
  await page.getByLabel('Operating status user-reported').selectOption('reported-issue');
  await expect(page.getByLabel('What did you check?')).toHaveValue('');

  await page.getByRole('button', { name: 'Troubleshoot monitor step by step' }).click();
  await page.getByRole('button', { name: 'The screen works', exact: true }).click();
  await page.getByRole('button', { name: 'Save result as user-reported' }).click();
  await expect
    .poll(
      async () => (await saved(page)).devices.find((item) => item.id === 'monitor-right')?.status,
    )
    .toBe('reported-working');
  await expect(inspector(page)).toContainText('Saved details changed. Review before saving.');
  await expect(
    page.getByRole('button', { name: 'Save device details', exact: true }),
  ).toBeDisabled();

  await page.getByRole('button', { name: 'Keep my edited fields after review' }).click();
  await expect(page.getByLabel('Operating status user-reported')).toHaveValue('reported-issue');
  await expect(page.getByLabel('What did you check?')).toHaveValue('');
  await page.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect
    .poll(async () => {
      const monitor = (await saved(page)).devices.find((item) => item.id === 'monitor-right')!;
      return { status: monitor.status, note: monitor.statusNote };
    })
    .toEqual({ status: 'reported-issue', note: 'The user reported this status.' });
});

test('a note-only draft keeps its original issue status when reviewed after a diagnostic success', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const monitor = initial.devices.find((item) => item.id === 'monitor-right')!;
  monitor.status = 'reported-issue';
  monitor.statusNote = 'No display before checking.';
  await seed(page, initial);
  await selectDevice(page, 'Right monitor');
  await edit(page);
  await page.getByLabel('What did you check?').fill('My earlier check still showed no display.');
  await page.getByRole('button', { name: 'Troubleshoot monitor step by step' }).click();
  await page.getByRole('button', { name: 'The screen works', exact: true }).click();
  await page.getByRole('button', { name: 'Save result as user-reported' }).click();
  await expect
    .poll(
      async () => (await saved(page)).devices.find((item) => item.id === 'monitor-right')?.status,
    )
    .toBe('reported-working');

  await page.getByRole('button', { name: 'Keep my edited fields after review' }).click();
  await expect(page.getByLabel('Operating status user-reported')).toHaveValue('reported-issue');
  await expect(page.getByLabel('What did you check?')).toHaveValue(
    'My earlier check still showed no display.',
  );
  await page.getByRole('button', { name: 'Save device details', exact: true }).click();
  await expect
    .poll(async () => {
      const current = (await saved(page)).devices.find((item) => item.id === 'monitor-right')!;
      return { status: current.status, note: current.statusNote };
    })
    .toEqual({ status: 'reported-issue', note: 'My earlier check still showed no display.' });
});

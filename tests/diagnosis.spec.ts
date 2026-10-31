import { expect, test, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

const storageKey = 'desktwin.workspace.v1';
test.setTimeout(60_000);
test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { mode: 'demo' } }));
  await page.route('**/api/chat', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
});
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function seed(page: Page) {
  await page.addInitScript(
    ({ key, workspace }) => {
      if (!sessionStorage.getItem('diagnosis-seeded')) {
        localStorage.setItem(key, JSON.stringify(workspace));
        sessionStorage.setItem('diagnosis-seeded', 'yes');
      }
    },
    { key: storageKey, workspace: createDemoWorkspace() },
  );
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
}
async function selectMonitor(page: Page) {
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Device list panel' })
    .getByRole('button', { name: /^Right monitor Monitor/ })
    .click();
}
function panel(page: Page) {
  return page.getByRole('region', { name: 'Monitor troubleshooting', exact: true });
}
async function start(page: Page) {
  await selectMonitor(page);
  await page
    .getByRole('button', { name: 'Troubleshoot monitor step by step', exact: true })
    .click();
  await expect.poll(async () => (await saved(page)).diagnoses.length).toBe(1);
  await expect(
    panel(page).getByRole('heading', { name: 'Check power and input source' }),
  ).toBeVisible();
}
async function reachCable(page: Page) {
  await panel(page).getByRole('button', { name: 'Still no display', exact: true }).click();
  await panel(page)
    .getByRole('button', { name: 'This matches my checked connections', exact: true })
    .click();
  await expect(
    panel(page).getByRole('heading', { name: 'Check the current cable connection' }),
  ).toBeVisible();
}

test('diagnostic answers resume after navigation and reload, with operating status saved separately', async ({
  page,
}, testInfo) => {
  await seed(page);
  await start(page);
  await reachCable(page);
  await expect.poll(async () => (await saved(page)).diagnoses[0].answers.length).toBe(2);
  const attemptId = (await saved(page)).diagnoses[0].id;
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  await page.reload();
  await selectMonitor(page);
  await expect(
    panel(page).getByRole('heading', { name: 'Check the current cable connection' }),
  ).toBeVisible();
  expect((await saved(page)).diagnoses[0].id).toBe(attemptId);
  await panel(page).getByRole('button', { name: 'The screen works', exact: true }).click();
  await expect.poll(async () => (await saved(page)).diagnoses[0].result).toBe('resolved');
  expect((await saved(page)).devices.find((device) => device.id === 'monitor-right')!.status).toBe(
    'unknown',
  );
  await panel(page)
    .getByRole('button', { name: 'Save result as user-reported', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === 'monitor-right')!.status,
    )
    .toBe('reported-working');
  const result = await saved(page);
  expect(result.diagnoses[0].answers.map((answer) => answer.answer)).toEqual([
    'not-fixed',
    'confirmed',
    'fixed',
  ]);
  expect(result.diagnoses[0].path.deviceIds).toEqual(['monitor-right', 'dock', 'laptop']);
  expect(result.devices.find((device) => device.id === 'monitor-right')!.statusNote).toContain(
    'Cause not determined',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === 'monitor-right')!.status,
    )
    .toBe('unknown');
  expect((await saved(page)).diagnoses[0].result).toBe('resolved');
  await expect(
    panel(page).getByText('Saved as a user-reported test result', { exact: true }),
  ).toHaveCount(0);
  await panel(page)
    .getByRole('button', { name: 'Save result as user-reported', exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page)).devices.find((device) => device.id === 'monitor-right')!.status,
    )
    .toBe('reported-working');
  await panel(page).getByText('Answers in this attempt (3)', { exact: true }).click();
  await expect(panel(page)).toContainText('Screen worked');
  await page.screenshot({ path: testInfo.outputPath('diagnosis-saved-history.png') });
});

test('a skipped cable check branches to observation, blocks bypass, and retains unsuccessful attempt history', async ({
  page,
}) => {
  await seed(page);
  await start(page);
  await reachCable(page);
  await panel(page).getByRole('button', { name: "I can't check right now", exact: true }).click();
  await expect(
    panel(page).getByRole('heading', { name: 'Check the computer’s display settings' }),
  ).toBeVisible();
  await panel(page).getByRole('button', { name: 'Still no display', exact: true }).click();
  await panel(page)
    .getByRole('button', { name: 'Documentation confirms support', exact: true })
    .click();
  await expect(panel(page).getByRole('heading', { name: 'Further checks needed' })).toBeVisible();
  await expect
    .poll(async () => (await saved(page)).diagnoses[0].stopReason)
    .toBe('prerequisite-skipped');
  const old = (await saved(page)).diagnoses[0];
  expect(old.answers.find((answer) => answer.kind === 'monitor-link')?.answer).toBe('skip');
  expect(old.answers.some((answer) => answer.kind === 'direct-test')).toBe(false);
  await panel(page).getByRole('button', { name: 'Check again', exact: true }).click();
  await expect.poll(async () => (await saved(page)).diagnoses.length).toBe(2);
  const result = await saved(page);
  expect(result.diagnoses[1]).toEqual(old);
  expect(result.diagnoses[0].result).toBe('active');
  expect(result.devices.find((device) => device.id === 'monitor-right')!.status).toBe('unknown');
  await panel(page).getByText('Previous attempts (1)', { exact: true }).click();
  await expect(panel(page)).toContainText('Skipped / not checked');
});

test('changing the recorded graph requires a new attempt and preserves the old answers', async ({
  page,
}) => {
  await seed(page);
  await start(page);
  await panel(page).getByRole('button', { name: 'Still no display', exact: true }).click();
  await expect.poll(async () => (await saved(page)).diagnoses[0].answers.length).toBe(1);
  const prior = (await saved(page)).diagnoses[0];
  await page.getByRole('button', { name: 'View connections', exact: true }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Record a connection', exact: true });
  await dialog
    .getByRole('combobox', { name: 'First device', exact: true })
    .selectOption('monitor-right');
  await dialog.getByRole('combobox', { name: 'Second device', exact: true }).selectOption('laptop');
  await dialog.getByRole('combobox', { name: 'Connector', exact: true }).selectOption('HDMI');
  await dialog.getByRole('button', { name: 'Save as user-reported', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await selectMonitor(page);
  await expect(
    panel(page).getByRole('heading', { name: 'The recorded route changed', exact: true }),
  ).toBeVisible();
  await expect(
    panel(page).getByRole('button', { name: 'This matches my checked connections', exact: true }),
  ).toHaveCount(0);
  await panel(page)
    .getByRole('button', { name: 'Start with current connections', exact: true })
    .click();
  await expect.poll(async () => (await saved(page)).diagnoses.length).toBe(2);
  const result = await saved(page);
  expect(result.diagnoses[1]).toMatchObject({
    id: prior.id,
    answers: prior.answers,
    result: 'unresolved',
    stopReason: 'graph-changed',
  });
  expect(result.diagnoses[0].path.deviceIds).toEqual(['monitor-right', 'laptop']);
  expect(result.diagnoses[0].path.ambiguous).toBe(true);
  expect(result.devices.find((device) => device.id === 'monitor-right')!.status).toBe('unknown');
});

test('a failed browser-storage write does not advance or claim to save an answer', async ({
  page,
}) => {
  await seed(page);
  await start(page);
  const prior = (await saved(page)).diagnoses[0];
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    (window as Window & { restoreDiagnosticStorage?: () => void }).restoreDiagnosticStorage =
      () => {
        Storage.prototype.setItem = original;
      };
    Storage.prototype.setItem = function (name, value) {
      if (this === localStorage && name === key)
        throw new DOMException('Test-only quota failure', 'QuotaExceededError');
      return original.call(this, name, value);
    };
  }, storageKey);
  await panel(page).getByRole('button', { name: 'Still no display', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('This check was not saved');
  await expect(
    panel(page).getByRole('heading', { name: 'Check power and input source' }),
  ).toBeVisible();
  expect((await saved(page)).diagnoses[0]).toEqual(prior);
  await page.evaluate(() =>
    (window as Window & { restoreDiagnosticStorage?: () => void }).restoreDiagnosticStorage?.(),
  );
  await panel(page).getByRole('button', { name: 'Still no display', exact: true }).click();
  await expect.poll(async () => (await saved(page)).diagnoses[0].answers.length).toBe(1);
  await expect(
    panel(page).getByRole('heading', { name: 'Confirm the recorded display route' }),
  ).toBeVisible();
});

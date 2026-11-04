import { test, expect, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

const storageKey = 'desktwin.workspace.v1';
async function seed(page: Page, workspace: Workspace) {
  await page.goto('/');
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey,
    value: workspace,
  });
  await page.reload();
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
}
async function send(page: Page, message: string) {
  await page.getByRole('textbox', { name: 'Message DeskTwin' }).fill(message);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
}

test('selected device stays in local conversation and a pronoun references it without changing saved records', async ({
  page,
}) => {
  const workspace = createDemoWorkspace();
  await seed(page, workspace);
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'DeskTwin conversation', exact: true });
  await panel.getByRole('combobox', { name: 'Conversation target' }).selectOption('monitor-right');
  await send(page, 'This monitor is not displaying');
  await expect(panel.locator('.chat-message.assistant')).toContainText('Right monitor');
  const proposalDetails = panel.getByLabel('Proposed status details');
  await expect(proposalDetails).toContainText('User reports an issue');
  await expect(proposalDetails).toContainText('This monitor is not displaying');
  await expect(panel.getByRole('button', { name: 'Confirm and apply', exact: true })).toBeVisible();
  await expect(panel.getByRole('combobox', { name: 'Conversation target' })).toHaveValue(
    'monitor-right',
  );
  await page.getByRole('button', { name: 'My desk', exact: true }).click();
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Conversation target' })).toHaveValue(
    'monitor-right',
  );
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey)).toEqual(
    workspace,
  );
});

test('Meta fixture receives selected target only after consent and local-only targets never enter the transport', async ({
  page,
}) => {
  const workspace = createDemoWorkspace();
  const osDevice = workspace.devices.find((device) => device.id === 'ssd')!;
  osDevice.hardwareOrigin = 'macos';
  osDevice.name = 'Private local SSD';
  const payloads: Array<{ focusDeviceId: string; workspace: Workspace; history: unknown[] }> = [];
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'fixture-only', photoAvailable: true } }),
  );
  await page.route('**/api/chat', async (route) => {
    payloads.push(route.request().postDataJSON());
    await route.fulfill({
      json: { mode: 'meta', message: 'Fixture reply for the selected device.', proposals: [] },
    });
  });
  await seed(page, workspace);
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'DeskTwin conversation', exact: true });
  await panel.getByRole('combobox', { name: 'Conversation target' }).selectOption('monitor-right');
  expect(payloads).toHaveLength(0);
  await page.getByRole('button', { name: 'Connect Meta API' }).click();
  await page.getByRole('button', { name: 'I understand what will be sent · Enable Meta' }).click();
  await send(page, 'What is my current recorded path?');
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0].focusDeviceId).toBe('monitor-right');
  expect(JSON.stringify(payloads[0])).not.toContain('Private local SSD');
  await expect(panel.locator('.chat-message.assistant')).toContainText('Fixture reply');
  await panel.getByRole('combobox', { name: 'Conversation target' }).selectOption('ssd');
  await expect(
    panel.getByText('This target comes from Mac observations and stays local.', { exact: false }),
  ).toBeVisible();
  await send(page, 'Check this private target');
  await expect(panel.locator('.chat-message.assistant').last()).toContainText(
    'cannot be sent to Meta',
  );
  await expect(
    panel.locator('.chat-message.assistant').last().locator('.message-author'),
  ).toHaveText('DeskTwin · local notice');
  expect(payloads).toHaveLength(1);
  await panel.getByRole('combobox', { name: 'Conversation target' }).selectOption('monitor-right');
  await send(page, 'Continue with this monitor');
  await expect.poll(() => payloads.length).toBe(2);
  expect(JSON.stringify(payloads[1].history)).not.toContain('Check this private target');
  expect(JSON.stringify(payloads[1].history)).not.toContain('cannot be sent to Meta');
  expect(JSON.stringify(payloads[1])).not.toContain('Private local SSD');
});

test('resetting the workspace aborts a pending conversation and discards the old target and proposal', async ({
  page,
}) => {
  let release: (() => void) | undefined;
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'fixture-only' } }),
  );
  await page.route('**/api/chat', async (route) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route
      .fulfill({
        json: {
          mode: 'meta',
          message: 'A stale response that must be discarded.',
          proposals: [
            {
              type: 'set-status',
              deviceId: 'monitor-right',
              status: 'reported-working',
              note: 'Stale fixture',
              reason: 'Stale response',
            },
          ],
        },
      })
      .catch(() => {});
  });
  await seed(page, createDemoWorkspace());
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'DeskTwin conversation', exact: true });
  await panel.getByRole('combobox', { name: 'Conversation target' }).selectOption('monitor-right');
  await page.getByRole('button', { name: 'Connect Meta API' }).click();
  await page.getByRole('button', { name: 'I understand what will be sent · Enable Meta' }).click();
  await send(page, 'Review this device');
  await expect.poll(() => !!release).toBe(true);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  await page.getByRole('button', { name: 'Erase my desk', exact: true }).click();
  await page
    .getByRole('group', { name: 'Erase my desk confirmation' })
    .getByRole('button', { name: 'Confirm erase my desk', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: 'Workspace settings' })).toHaveCount(0);
  release!();
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  await expect(panel.getByRole('combobox', { name: 'Conversation target' })).toHaveValue('');
  await expect(panel.locator('.chat-message')).toHaveCount(0);
  await expect(
    page.getByText('A stale response that must be discarded.', { exact: true }),
  ).toHaveCount(0);
});

for (const target of ['', 'laptop']) {
  for (const suggestion of ['connections', 'check']) {
    test(`generated ${suggestion} suggestion keeps OS labels local with ${target || 'whole-desk'} context`, async ({
      page,
    }) => {
      const workspace = createDemoWorkspace();
      const osMonitor = workspace.devices.find((device) => device.kind === 'monitor')!;
      osMonitor.hardwareOrigin = 'macos';
      osMonitor.name = 'Private OS Display 742';
      const payloads: Array<{
        message: string;
        focusDeviceId: string | null;
        workspace: Workspace;
      }> = [];
      await page.route('**/api/health', (route) =>
        route.fulfill({ json: { mode: 'meta', model: 'fixture-only' } }),
      );
      await page.route('**/api/chat', async (route) => {
        payloads.push(route.request().postDataJSON());
        await route.fulfill({
          json: {
            mode: 'meta',
            message: 'Which user-observed issue would you like to investigate?',
            proposals: [],
          },
        });
      });
      await seed(page, workspace);
      await page.getByRole('button', { name: 'AI chat', exact: true }).click();
      const panel = page.getByRole('complementary', { name: 'DeskTwin conversation', exact: true });
      await panel.getByRole('combobox', { name: 'Conversation target' }).selectOption(target);
      await page.getByRole('button', { name: 'Connect Meta API' }).click();
      await page
        .getByRole('button', { name: 'I understand what will be sent · Enable Meta' })
        .click();
      const expected =
        suggestion === 'connections'
          ? target
            ? 'Help me review the recorded connections for this device.'
            : 'Help me review the recorded connections on my desk.'
          : target
            ? 'What should I check next for this device?'
            : 'Help me choose a device and a safe check.';
      await panel.getByRole('button', { name: expected, exact: true }).click();
      await expect.poll(() => payloads.length).toBe(1);
      expect(payloads[0].message).toBe(expected);
      expect(payloads[0].focusDeviceId).toBe(target || null);
      expect(payloads[0].message).not.toMatch(/not displaying|not working|no signal/i);
      expect(JSON.stringify(payloads[0])).not.toContain('Private OS Display 742');
      expect(
        await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey),
      ).toEqual(workspace);
    });
  }
}

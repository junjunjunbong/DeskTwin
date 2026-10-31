import { expect, test } from '@playwright/test';
import { createDemoWorkspace } from '../src/domain/workspace';

test('assistant focuses one recorded route without highlighting sibling branches or saving changes', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  initial.appearance.labels = true;
  const key = 'desktwin.workspace.v1';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/chat', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key,
    value: initial,
  });
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'AI chat', exact: true }).click();
  await page.getByRole('combobox', { name: 'Conversation target' }).selectOption('monitor-right');
  await page.getByRole('button', { name: 'Show target and recorded path', exact: true }).click();

  const toggle = page.getByRole('switch', { name: 'Show connections', exact: true });
  const highlighted = page.locator('.connection-summary [data-emphasis="highlighted"]');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(highlighted).toHaveCount(2);
  await expect(page.locator('[data-connection-id="dock-monitor-right"]')).toHaveAttribute(
    'data-emphasis',
    'highlighted',
  );
  await expect(page.locator('[data-connection-id="laptop-dock"]')).toHaveAttribute(
    'data-emphasis',
    'highlighted',
  );
  await expect(page.locator('[data-connection-id="dock-monitor-left"]')).toHaveAttribute(
    'data-emphasis',
    'muted',
  );
  await expect(page.locator('[data-connection-id="dock-ssd"]')).toHaveAttribute(
    'data-emphasis',
    'muted',
  );
  await expect(page.locator('.device-marker[data-connection-role="path"]')).toHaveCount(3);
  await expect(
    page.getByRole('button', { name: 'Select Right monitor', exact: true }),
  ).toHaveAttribute('aria-description', /focused recorded path/);
  await expect(
    page.getByRole('button', { name: 'Select Left monitor', exact: true }),
  ).toHaveAttribute('data-focus-muted', 'true');

  await toggle.click();
  await expect(page.getByRole('list', { name: 'Visible recorded connections' })).toHaveCount(0);
  await expect(page.locator('.device-marker[data-connection-role="path"]')).toHaveCount(3);
  await toggle.click();
  await expect(highlighted).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear path', exact: true }).click();
  await expect(page.locator('.connection-summary [data-emphasis="normal"]')).toHaveCount(
    initial.connections.length,
  );
  await expect(page.locator('.device-marker[data-connection-role="path"]')).toHaveCount(0);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), key)).toEqual(
    initial,
  );
  expect(pageErrors).toEqual([]);
});

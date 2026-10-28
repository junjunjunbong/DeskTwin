import { test, expect, type Page } from '@playwright/test';
import { createDemoWorkspace, createSceneObject, type Workspace } from '../src/domain/workspace';

const key = 'desktwin.workspace.v1';
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name)!), key);
}

test('names retain spaces while typing and decimal fields commit once without blocking intermediate text', async ({
  page,
}) => {
  const fixture = createDemoWorkspace();
  fixture.devices = [];
  fixture.connections = [];
  fixture.objects = [createSceneObject('generic')];
  const object = fixture.objects[0];
  object.name = 'Editable block';
  object.placement = { x: 0, y: 0, z: 0, rotation: 0 };
  await page.addInitScript(
    ({ name, value }) => {
      if (!sessionStorage.getItem('input-fixture')) {
        localStorage.setItem(name, value);
        sessionStorage.setItem('input-fixture', 'yes');
      }
    },
    { name: key, value: JSON.stringify(fixture) },
  );
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Scene objects', exact: true }).click();
  await page.getByRole('button', { name: /^Editable block Generic object/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected scene object' });
  const name = inspector.getByLabel('Object name', { exact: true });
  await name.fill('');
  await name.pressSequentially('My desk object');
  await expect(name).toHaveValue('My desk object');
  expect((await saved(page)).objects[0].name).toBe('Editable block');
  await name.press('Enter');
  await expect.poll(async () => (await saved(page)).objects[0].name).toBe('My desk object');

  const width = inspector.getByLabel('Object width scale');
  await width.fill('0.');
  await expect(width).toHaveValue('0.');
  expect((await saved(page)).objects[0].visual.scale.x).toBe(1);
  await width.pressSequentially('25');
  await expect(width).toHaveValue('0.25');
  const beforeCommit = (await saved(page)).history.length;
  await width.press('Enter');
  await expect.poll(async () => (await saved(page)).objects[0].visual.scale.x).toBe(0.25);
  await width.press('Tab');
  expect((await saved(page)).history.length).toBe(beforeCommit + 1);

  await width.fill('-');
  await expect(width).toHaveValue('-');
  await width.press('Escape');
  await expect(width).toHaveValue('0.25');
  await width.fill('0.01');
  await width.press('Enter');
  await expect(width).toHaveAttribute('aria-invalid', 'true');
  expect((await saved(page)).objects[0].visual.scale.x).toBe(0.25);
  await width.press('Escape');
  await expect(width).toHaveValue('0.25');

  await name.fill('   ');
  await name.press('Enter');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  expect((await saved(page)).objects[0].name).toBe('My desk object');
  await name.press('Escape');
  await expect(name).toHaveValue('My desk object');

  // A second deliberate commit while the first waits on another tab must not
  // be discarded by the input's duplicate-Enter/blur protection.
  await page.evaluate(() => {
    void navigator.locks.request(
      'desktwin.workspace.write',
      () =>
        new Promise<void>((release) => {
          (window as typeof window & { releaseInputLock?: () => void }).releaseInputLock = release;
        }),
    );
  });
  await expect.poll(() => page.evaluate(() => 'releaseInputLock' in window)).toBe(true);
  await width.fill('0.35');
  await width.press('Enter');
  await width.fill('0.4');
  await width.press('Enter');
  await expect(width).toHaveValue('0.4');
  await page.evaluate(() => {
    (window as typeof window & { releaseInputLock: () => void }).releaseInputLock();
  });
  await expect.poll(async () => (await saved(page)).objects[0].visual.scale.x).toBe(0.4);
  await expect(width).toHaveValue('0.4');

  // Regression for typing 0.5 being normalized into 1.5 between keystrokes.
  await width.fill('');
  await width.pressSequentially('0.');
  await expect(width).toHaveValue('0.');
  expect((await saved(page)).objects[0].visual.scale.x).toBe(0.4);
  await width.pressSequentially('5');
  await expect(width).toHaveValue('0.5');
  await width.press('Enter');
  await expect.poll(async () => (await saved(page)).objects[0].visual.scale.x).toBe(0.5);
  await page.reload();
  const restored = await saved(page);
  expect(restored.objects[0].name).toBe('My desk object');
  expect(restored.objects[0].visual.scale.x).toBe(0.5);
  expect(restored.objects[0].visual.scale.x).not.toBe(1.5);
});

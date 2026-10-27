import { test, expect, type Page } from '@playwright/test';
import { createDemoWorkspace, createSceneObject, type Workspace } from '../src/domain/workspace';

const key = 'desktwin.workspace.v1';
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((name) => JSON.parse(localStorage.getItem(name)!), key);
}
async function holdWrites(page: Page) {
  await page.evaluate(() => {
    void navigator.locks.request(
      'desktwin.workspace.write',
      () =>
        new Promise<void>((release) => {
          (window as typeof window & { releaseQueuedEditLock?: () => void }).releaseQueuedEditLock =
            release;
        }),
    );
  });
  await expect.poll(() => page.evaluate(() => 'releaseQueuedEditLock' in window)).toBe(true);
}
async function releaseWrites(page: Page) {
  await page.evaluate(() => {
    const held = window as typeof window & { releaseQueuedEditLock?: () => void };
    held.releaseQueuedEditLock!();
    delete held.releaseQueuedEditLock;
  });
}

test('queued edits to different position, scale, color, and part fields preserve every changed value', async ({
  page,
}) => {
  const fixture = createDemoWorkspace();
  fixture.devices = [];
  fixture.connections = [];
  const block = createSceneObject('generic');
  block.name = 'Queued block';
  block.placement = { x: 0, y: 0, z: 0, rotation: 0 };
  block.shapeMode = 'custom';
  block.parts = [
    {
      position: { x: 0, y: 0.2, z: 0 },
      size: { x: 0.4, y: 0.4, z: 0.4 },
      color: '#9aa5a5',
    },
  ];
  fixture.objects = [block];
  await page.addInitScript(
    ({ name, value }) => {
      if (!sessionStorage.getItem('queued-edit-fixture')) {
        localStorage.setItem(name, value);
        sessionStorage.setItem('queued-edit-fixture', 'yes');
      }
    },
    { name: key, value: JSON.stringify(fixture) },
  );
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Scene objects', exact: true }).click();
  await page.getByRole('button', { name: /^Queued block Generic object/ }).click();
  const panel = page.getByRole('complementary', { name: 'Selected scene object' });

  await holdWrites(page);
  await panel
    .getByRole('slider', { name: 'Object left / right position', exact: true })
    .fill('0.4');
  await panel
    .getByRole('slider', { name: 'Object front / back position', exact: true })
    .fill('0.6');
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).objects[0].placement.z).toBe(0.6);
  expect((await saved(page)).objects[0].placement.x).toBe(0.4);

  const beforeRangeReturn = (await saved(page)).history.length;
  await holdWrites(page);
  await panel
    .getByRole('slider', { name: 'Object left / right position', exact: true })
    .fill('0.9');
  await panel
    .getByRole('slider', { name: 'Object left / right position', exact: true })
    .fill('0.4');
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).history.length).toBe(beforeRangeReturn + 2);
  expect((await saved(page)).objects[0].placement.x).toBe(0.4);

  await holdWrites(page);
  await panel.getByLabel('Object width scale').fill('0.5');
  await panel.getByLabel('Object width scale').press('Enter');
  await panel.getByLabel('Object height scale').fill('0.6');
  await panel.getByLabel('Object height scale').press('Enter');
  await panel.getByLabel('Object color', { exact: true }).evaluate((element) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(element, '#d29b58');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).objects[0].visual.color).toBe('#d29b58');
  expect((await saved(page)).objects[0].visual.scale).toEqual({ x: 0.5, y: 0.6, z: 1 });

  const beforeReturn = (await saved(page)).history.length;
  await holdWrites(page);
  await panel.getByLabel('Object width scale').fill('0.7');
  await panel.getByLabel('Object width scale').press('Enter');
  await panel.getByLabel('Object width scale').fill('0.5');
  await panel.getByLabel('Object width scale').press('Enter');
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).history.length).toBe(beforeReturn + 2);
  expect((await saved(page)).objects[0].visual.scale.x).toBe(0.5);

  await holdWrites(page);
  await panel.getByLabel('Box 1 position x').fill('0.1');
  await panel.getByLabel('Box 1 position x').press('Enter');
  await panel.getByLabel('Box 1 position z').fill('0.2');
  await panel.getByLabel('Box 1 position z').press('Enter');
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).objects[0].parts[0].position.z).toBe(0.2);
  expect((await saved(page)).objects[0].parts[0].position.x).toBe(0.1);
  expect((await saved(page)).objects[0].visual.color).toBe('#d29b58');

  await holdWrites(page);
  await panel.getByLabel('Box 1 position x').fill('0.15');
  await panel.getByLabel('Box 1 position x').press('Enter');
  await panel.getByRole('button', { name: 'Add box', exact: true }).click();
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).objects[0].parts[0].position.x).toBe(0.15);
  await expect(
    page.getByText(/The shape changed before this replacement could be saved/),
  ).toBeVisible();
  expect((await saved(page)).objects[0].parts).toHaveLength(1);
  await panel.getByRole('button', { name: 'Add box', exact: true }).click();
  await expect.poll(async () => (await saved(page)).objects[0].parts.length).toBe(2);
  await page.reload();
  const restored = (await saved(page)).objects[0];
  expect(restored.placement).toMatchObject({ x: 0.4, z: 0.6 });
  expect(restored.visual.scale).toEqual({ x: 0.5, y: 0.6, z: 1 });
  expect(restored.parts[0].position).toEqual({ x: 0.15, y: 0.2, z: 0.2 });
});

import { expect, test, type Page } from '@playwright/test';
import { OrthographicCamera, Vector3 } from 'three';
import {
  createDemoWorkspace,
  createSceneObject,
  type SceneObject,
  type Workspace,
} from '../src/domain/workspace';
import { getItemBounds, validateSceneCollisions } from '../src/domain/spatial';
import { getTemplateParts } from '../src/domain/geometry';

const storageKey = 'desktwin.workspace.v1';
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as Page & { spatialErrors?: string[] }).spatialErrors = errors;
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { spatialErrors?: string[] }).spatialErrors).toEqual([]);
});

function box(id: string, x: number, z: number): SceneObject {
  return {
    ...createSceneObject('generic'),
    id,
    name: id === 'moving-box' ? 'Moving box' : 'Blocking box',
    placement: { x, y: 0, z, rotation: 0 },
    shapeMode: 'custom',
    parts: [
      { position: { x: 0, y: 0.3, z: 0 }, size: { x: 0.6, y: 0.6, z: 0.6 }, color: '#82a59b' },
    ],
  };
}
function emptyWorkspace(objects: SceneObject[]): Workspace {
  return {
    ...createDemoWorkspace(),
    name: 'Placement test',
    devices: [],
    objects,
    connections: [],
    history: [],
    appearance: { lighting: 'day', decor: true, labels: false },
  };
}
async function seed(page: Page, value: Workspace) {
  await page.addInitScript(
    ({ key, workspace }) => {
      if (!sessionStorage.getItem('spatial-seeded')) {
        localStorage.setItem(key, JSON.stringify(workspace));
        sessionStorage.setItem('spatial-seeded', 'yes');
      }
    },
    { key: storageKey, workspace: value },
  );
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Edit placement', exact: true }).first().click();
}
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}
async function position(page: Page, id: string) {
  const value = await saved(page);
  return [...value.devices, ...value.objects].find((item) => item.id === id)!.placement;
}

/** Project a physical point into the untouched default camera, then send real pointer input. */
async function screen(page: Page, x: number, y: number, z: number) {
  const bounds = (await page.getByTestId('desk-canvas').boundingBox())!;
  const aspect = bounds.width / bounds.height;
  const span = Math.max(7.6, 10.8 / aspect);
  const camera = new OrthographicCamera(
    (-span * aspect) / 2,
    (span * aspect) / 2,
    span / 2,
    -span / 2,
    0.1,
    100,
  );
  camera.position.set(8.4, 7.7, 11.5);
  camera.lookAt(-0.2, 2.65, 0.35);
  camera.updateMatrixWorld();
  const point = new Vector3(x, y, z).project(camera);
  return {
    x: bounds.x + ((point.x + 1) * bounds.width) / 2,
    y: bounds.y + ((1 - point.y) * bounds.height) / 2,
  };
}
async function movePointer(page: Page, point: { x: number; y: number }, steps = 1) {
  await page.mouse.move(point.x, point.y, { steps });
}
async function exportJSON(page: Page): Promise<Workspace> {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await waiting;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

for (const [id, grabHeight, grabZ, grabXOffset] of [
  ['keyboard', 2.6, 0.88, 0],
  ['mouse', 2.68, 0.96, 0],
  // The mug occludes the SSD's center from this camera. Grab its visible left end.
  ['ssd', 2.615, 0.6, -0.2],
  ['decor-chair', 2.68, 3.13, 0],
] as const) {
  test(`the default ${id} drags naturally over its mat or rug and remains one reversible save`, async ({
    page,
  }) => {
    const initial = createDemoWorkspace();
    const item = [...initial.devices, ...initial.objects].find((entry) => entry.id === id)!;
    await seed(page, initial);
    await page.getByRole('switch', { name: 'Show connections', exact: true }).click();
    const relationship = initial.connections.find((connection) => connection.to === id);
    const line = relationship ? page.locator(`[data-connection-id="${relationship.id}"]`) : null;
    const beforeEndpoint = line ? await line.getAttribute('data-to-position') : null;
    await movePointer(page, await screen(page, item.placement.x + grabXOffset, grabHeight, grabZ));
    await page.mouse.down();
    await movePointer(
      page,
      await screen(page, item.placement.x + grabXOffset + 0.24, grabHeight, grabZ),
      6,
    );
    if (line)
      await expect.poll(() => line.getAttribute('data-to-position')).not.toBe(beforeEndpoint);
    expect(await saved(page)).toEqual(initial);
    await page.mouse.up();
    await expect
      .poll(async () => (await position(page, id)).x)
      .toBeGreaterThan(item.placement.x + 0.18);
    const moved = await saved(page);
    expect((await position(page, id)).x).toBeCloseTo(item.placement.x + 0.24, 2);
    expect(validateSceneCollisions(moved, initial)).toEqual([]);
    expect(moved.connections).toEqual(initial.connections);
    expect(moved.history).toHaveLength(1);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => saved(page)).toEqual(initial);
    await page.getByRole('button', { name: 'Redo', exact: true }).click();
    await expect.poll(() => saved(page)).toEqual(moved);
  });
}

test('a fast real drag stops at a thin blocker without saving intermediate frames', async ({
  page,
}) => {
  const blocker = box('blocking-box', 0, 1.1);
  blocker.parts[0].size.x = 0.025;
  const initial = emptyWorkspace([box('moving-box', -1.2, 1.1), blocker]);
  await seed(page, initial);
  await movePointer(page, await screen(page, -1.2, 0.55, 1.1));
  await page.mouse.down();
  await movePointer(page, await screen(page, 1.3, 0.55, 1.1));
  expect(await saved(page)).toEqual(initial);
  await page.mouse.up();
  await expect.poll(async () => (await position(page, 'moving-box')).x).toBeGreaterThan(-1.2);
  const moved = await position(page, 'moving-box');
  expect(moved.x).toBeLessThanOrEqual(-0.31);
  expect(moved.x).toBeGreaterThan(-0.38);
  expect((await position(page, 'blocking-box')).x).toBe(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => position(page, 'moving-box')).toEqual(initial.objects[0].placement);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => position(page, 'moving-box')).toEqual(moved);
  await page.reload();
  expect(await position(page, 'moving-box')).toEqual(moved);
});

test('a curved real drag around an obstacle is one undo step and survives export/import', async ({
  page,
}) => {
  const initial = emptyWorkspace([box('moving-box', -1.2, 1.1), box('blocking-box', 0, 1.1)]);
  await seed(page, initial);
  await movePointer(page, await screen(page, -1.2, 0.55, 1.1));
  await page.mouse.down();
  for (const [x, z] of [
    [-1.2, 2.2],
    [1.2, 2.2],
    [1.2, 1.1],
  ])
    await movePointer(page, await screen(page, x, 0.55, z), 8);
  expect(await saved(page)).toEqual(initial);
  await page.mouse.up();
  await expect.poll(async () => (await position(page, 'moving-box')).x).toBeGreaterThan(1.1);
  const moved = await position(page, 'moving-box');
  expect(moved.x).toBeCloseTo(1.2, 2);
  expect(moved.z).toBeCloseTo(1.1, 2);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => position(page, 'moving-box')).toEqual(initial.objects[0].placement);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => position(page, 'moving-box')).toEqual(moved);
  const exported = await exportJSON(page);
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'spatial-workspace.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.reload();
  expect(await position(page, 'moving-box')).toEqual(moved);
  expect((await saved(page)).objects[0].parts).toEqual(exported.objects[0].parts);
});

function attachedWorkspace() {
  const desk = createSceneObject('desk');
  desk.id = 'small-desk';
  desk.name = 'Small desk';
  desk.visual.scale = { x: 0.45, y: 0.55, z: 0.45 };
  const attached = box('attached-box', 0, 0);
  attached.name = 'Attached box';
  attached.placement.y = 2.4835 * 0.55;
  attached.attachment = { parentId: desk.id };
  const value = emptyWorkspace([desk, attached]);
  value.appearance.labels = true;
  return value;
}

test('attached objects follow the desk during an actual drag and restore together', async ({
  page,
}) => {
  const initial = attachedWorkspace();
  await seed(page, initial);
  // Edit mode suppresses scene labels, but the renderer still projects this
  // attached object on each live frame. Check that projection alongside the
  // persisted transforms instead of requiring a scene-obscuring popup.
  const marker = page.locator('button[aria-label="Select Attached box"]');
  await expect(marker).toBeAttached();
  await expect(marker).toBeHidden();
  const markerX = () => marker.evaluate((node) => parseFloat((node as HTMLElement).style.left));
  const before = await markerX();
  await movePointer(page, await screen(page, 0.85, 1.36, 0.5));
  await page.mouse.down();
  await movePointer(page, await screen(page, 1.45, 1.36, 0.5), 8);
  await expect.poll(markerX).toBeGreaterThan(before + 10);
  expect(await saved(page)).toEqual(initial);
  await page.mouse.up();
  await expect.poll(async () => (await position(page, 'small-desk')).x).toBeGreaterThan(0.5);
  const moved = await saved(page);
  const desk = moved.objects.find((item) => item.id === 'small-desk')!;
  const child = moved.objects.find((item) => item.id === 'attached-box')!;
  expect(child.placement.x).toBeCloseTo(desk.placement.x, 5);
  expect(child.attachment).toEqual({ parentId: 'small-desk' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => position(page, 'small-desk')).toEqual(initial.objects[0].placement);
  expect((await saved(page)).objects[1]).toEqual(initial.objects[1]);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => position(page, 'attached-box')).toEqual(child.placement);
  await page.reload();
  expect((await saved(page)).objects).toEqual(moved.objects);
});

test('pointer cancellation restores both desk and attached object without a save', async ({
  page,
}) => {
  const initial = attachedWorkspace();
  await seed(page, initial);
  // Edit mode suppresses scene labels, but the renderer still projects this
  // attached object on each live frame. Check that projection alongside the
  // persisted transforms instead of requiring a scene-obscuring popup.
  const marker = page.locator('button[aria-label="Select Attached box"]');
  await expect(marker).toBeAttached();
  await expect(marker).toBeHidden();
  const markerX = () => marker.evaluate((node) => parseFloat((node as HTMLElement).style.left));
  const before = await markerX();
  await movePointer(page, await screen(page, 0.85, 1.36, 0.5));
  await page.mouse.down();
  await movePointer(page, await screen(page, 1.45, 1.36, 0.5), 8);
  await expect.poll(markerX).toBeGreaterThan(before + 10);
  await page.getByTestId('desk-canvas').dispatchEvent('pointercancel', { pointerId: 1 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await markerX()) - before)).toBeLessThan(1);
  expect(await saved(page)).toEqual(initial);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

async function selectObject(page: Page, name: string) {
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Scene objects', exact: true }).click();
  const list = page.getByRole('complementary', { name: 'Scene objects panel' });
  await list.getByRole('button', { name: new RegExp(`^${name} `) }).click();
  await expect(page.getByRole('complementary', { name: 'Selected scene object' })).toBeVisible();
}

test('surface placement, attachment, individual adjustment and detachment survive reload', async ({
  page,
}) => {
  const initial = attachedWorkspace();
  initial.appearance.labels = false;
  const child = initial.objects[1];
  child.attachment = null;
  child.placement = { x: 0, y: 0, z: 2.3, rotation: 0 };
  await seed(page, initial);
  await selectObject(page, 'Attached box');
  await page.getByLabel('Object surface', { exact: true }).selectOption('small-desk');
  await page.getByRole('button', { name: 'Place on surface', exact: true }).click();
  await expect.poll(async () => (await position(page, 'attached-box')).y).toBeGreaterThan(1.3);
  let value = await saved(page);
  const deskTop = getItemBounds(value.objects[0]).max.y;
  expect(getItemBounds(value.objects[1]).min.y).toBeCloseTo(deskTop + 0.001, 4);
  expect(value.objects[1].attachment).toBeNull();
  await page.getByRole('button', { name: 'Attach to desk', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).objects[1].attachment)
    .toEqual({ parentId: 'small-desk' });
  await page.getByRole('slider', { name: 'Object left / right position' }).fill('-0.4');
  await expect.poll(async () => (await position(page, 'attached-box')).x).toBeCloseTo(-0.4, 3);
  expect((await saved(page)).objects[1].attachment).toEqual({ parentId: 'small-desk' });
  await selectObject(page, 'Small desk');
  await page.getByRole('slider', { name: 'Object rotation', exact: true }).fill('30');
  await expect.poll(async () => (await position(page, 'small-desk')).rotation).toBeCloseTo(30, 3);
  value = await saved(page);
  expect(value.objects[1].placement.x).toBeCloseTo(-0.4 * Math.cos(Math.PI / 6), 3);
  expect(value.objects[1].placement.z).toBeCloseTo(0.2, 3);
  expect(validateSceneCollisions(value)).toEqual([]);
  await selectObject(page, 'Attached box');
  await page.getByRole('button', { name: 'Detach from desk', exact: true }).click();
  await expect.poll(async () => (await saved(page)).objects[1].attachment).toBeNull();
  const detached = await position(page, 'attached-box');
  await selectObject(page, 'Small desk');
  await page.getByRole('slider', { name: 'Object left / right position' }).fill('0.6');
  await expect.poll(async () => (await position(page, 'small-desk')).x).toBeCloseTo(0.6, 3);
  expect(await position(page, 'attached-box')).toEqual(detached);
  await page.reload();
  expect(await position(page, 'attached-box')).toEqual(detached);
  expect((await saved(page)).objects[1].attachment).toBeNull();
});

test('rotation controls retain the last valid angle when a turn would hit another object', async ({
  page,
}) => {
  const rotating = box('moving-box', 0, 1.3);
  rotating.parts[0].size = { x: 1.6, y: 0.6, z: 0.2 };
  const blocker = box('blocking-box', 0, 2.0);
  blocker.parts[0].size = { x: 0.3, y: 0.6, z: 0.3 };
  await seed(page, emptyWorkspace([rotating, blocker]));
  await selectObject(page, 'Moving box');
  await page.getByRole('slider', { name: 'Object rotation', exact: true }).fill('10');
  await expect.poll(async () => (await position(page, 'moving-box')).rotation).toBe(10);
  await page.getByRole('slider', { name: 'Object rotation', exact: true }).fill('90');
  await expect(page.getByText(/Moving box.*Blocking box\./)).toBeVisible();
  const value = await saved(page);
  expect(value.objects[0].placement.rotation).toBe(10);
  await expect(page.getByRole('slider', { name: 'Object rotation', exact: true })).toHaveValue(
    '10',
  );
  expect(validateSceneCollisions(value)).toEqual([]);
  await page.reload();
  expect((await saved(page)).objects[0].placement).toEqual(value.objects[0].placement);
});

test('decimal scale entry commits on Enter and rejects a size that intersects another object', async ({
  page,
}) => {
  await seed(page, emptyWorkspace([box('moving-box', -1, 1.3), box('blocking-box', 0, 1.3)]));
  await selectObject(page, 'Moving box');
  const width = page.getByLabel('Object width scale', { exact: true });
  await width.fill('1.25');
  expect((await saved(page)).objects[0].visual.scale.x).toBe(1);
  await width.press('Enter');
  await expect.poll(async () => (await saved(page)).objects[0].visual.scale.x).toBe(1.25);
  await width.fill('3');
  await width.press('Enter');
  await expect(page.getByText(/Moving box.*Blocking box\./)).toBeVisible();
  const value = await saved(page);
  expect(value.objects[0].visual.scale.x).toBe(1.25);
  await expect(width).toHaveValue('1.25');
  expect(validateSceneCollisions(value)).toEqual([]);
  await page.reload();
  expect((await saved(page)).objects[0].visual.scale).toEqual(value.objects[0].visual.scale);
});

test('monitor template parts can be extended, rotated, undone and reloaded without changing reports', async ({
  page,
}) => {
  const initial = emptyWorkspace([]);
  const monitor = createDemoWorkspace().devices.find((item) => item.kind === 'monitor')!;
  monitor.id = 'editable-monitor';
  monitor.name = 'Editable monitor';
  monitor.model = 'My display';
  monitor.source = 'user-reported';
  monitor.status = 'reported-working';
  monitor.statusNote = 'I tested it myself.';
  monitor.placement = { x: 0, y: 0, z: 1.1, rotation: 0 };
  initial.devices = [monitor];
  await seed(page, initial);
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page.getByRole('button', { name: /^Editable monitor Monitor/ }).click();
  await page.getByRole('button', { name: 'Customize template shape', exact: true }).click();
  await expect.poll(async () => (await saved(page)).devices[0].parts?.length).toBe(4);
  expect((await saved(page)).devices[0].parts).toEqual(getTemplateParts('monitor'));
  await page.getByRole('button', { name: 'Add box', exact: true }).click();
  await expect.poll(async () => (await saved(page)).devices[0].parts?.length).toBe(5);
  await expect(page.getByLabel('Shape part', { exact: true })).toHaveValue('4');
  for (const [label, value] of [
    ['Box 5 size x', '0.42'],
    ['Box 5 position y', '1.8'],
    ['Box 5 position x', '0.7'],
    ['Box 5 rotation z', '30'],
  ]) {
    await page.getByLabel(label, { exact: true }).fill(value);
    await page.getByLabel(label, { exact: true }).press('Enter');
  }
  await expect.poll(async () => (await saved(page)).devices[0].parts?.[4].rotation?.z).toBe(30);
  const modified = await saved(page);
  expect(modified.devices[0]).toMatchObject({
    source: 'user-reported',
    status: 'reported-working',
    statusNote: 'I tested it myself.',
    model: 'My display',
    shapeMode: 'custom',
  });
  expect(validateSceneCollisions(modified)).toEqual([]);
  await page.getByLabel('Box 5 position y', { exact: true }).fill('-1');
  await page.getByLabel('Box 5 position y', { exact: true }).press('Enter');
  await expect(page.getByText(/Editable monitor would go through the floor/)).toBeVisible();
  expect(await saved(page)).toEqual(modified);
  await expect(page.getByLabel('Box 5 position y', { exact: true })).toHaveValue('1.8');
  await page.getByRole('button', { name: 'Restore template shape', exact: true }).click();
  await expect.poll(async () => (await saved(page)).devices[0].shapeMode).toBe('template');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices[0].parts)
    .toEqual(modified.devices[0].parts);
  const exported = await exportJSON(page);
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'custom-monitor.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  await page.reload();
  expect((await saved(page)).devices[0].parts).toEqual(modified.devices[0].parts);
  expect((await saved(page)).devices[0].shapeMode).toBe('custom');
});

test('furniture template parts can be resized, duplicated, rotated and removed', async ({
  page,
}) => {
  const chair = createSceneObject('chair');
  chair.id = 'editable-chair';
  chair.name = 'Editable chair';
  chair.placement = { x: 0, y: 0, z: 1.8, rotation: 0 };
  await seed(page, emptyWorkspace([chair]));
  await selectObject(page, 'Editable chair');
  await page.getByRole('button', { name: 'Customize template shape', exact: true }).click();
  await expect.poll(async () => (await saved(page)).objects[0].shapeMode).toBe('custom');
  expect((await saved(page)).objects[0].parts).toEqual(getTemplateParts('chair'));
  await page.getByLabel('Shape part', { exact: true }).selectOption('0');
  await page.getByLabel('Box 1 size x', { exact: true }).fill('1.55');
  await page.getByLabel('Box 1 size x', { exact: true }).press('Enter');
  await expect.poll(async () => (await saved(page)).objects[0].parts[0].size.x).toBe(1.55);
  await page.getByRole('button', { name: 'Duplicate box', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).objects[0].parts.length)
    .toBe(getTemplateParts('chair').length + 1);
  const value = await saved(page);
  const index = value.objects[0].parts.length;
  await page.getByLabel(`Box ${index} rotation y`, { exact: true }).fill('15');
  await page.getByLabel(`Box ${index} rotation y`, { exact: true }).press('Enter');
  await expect
    .poll(async () => (await saved(page)).objects[0].parts[index - 1].rotation?.y)
    .toBe(15);
  await page.getByRole('button', { name: `Remove box ${index}`, exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).objects[0].parts.length)
    .toBe(getTemplateParts('chair').length);
  await page.reload();
  expect((await saved(page)).objects[0].parts[0].size.x).toBe(1.55);
});

test('changing a snapped height commits once despite native range step rounding', async ({
  page,
}) => {
  const prop = box('moving-box', 0, 1.1);
  prop.placement.y = 2.4845;
  const initial = emptyWorkspace([prop]);
  await seed(page, initial);
  await selectObject(page, 'Moving box');
  const height = page.getByRole('slider', { name: 'Object height position', exact: true });
  // Snapping preserves geometric precision; a native range displays its nearest step.
  await expect(height).toHaveValue('2.48');
  await height.fill('2.8');
  await expect.poll(async () => (await position(page, 'moving-box')).y).toBe(2.8);
  await page.reload();
  const restored = await saved(page);
  expect(restored.objects[0].placement.y).toBe(2.8);
  expect(restored.history).toHaveLength(1);
});

async function holdWrites(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((acquired) => {
      void navigator.locks.request('desktwin.workspace.write', async () => {
        await new Promise<void>((release) => {
          (window as Window & { releaseTestWriteLock?: () => void }).releaseTestWriteLock = release;
          acquired();
        });
      });
    });
  });
}
async function releaseWrites(page: Page) {
  await page.evaluate(() =>
    (window as Window & { releaseTestWriteLock?: () => void }).releaseTestWriteLock?.(),
  );
}
async function setColor(page: Page, label: string, color: string, inputEvent = true) {
  await page.getByLabel(label, { exact: true }).evaluate(
    (element, update) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(element, update.color);
      if (update.inputEvent) element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { color, inputEvent },
  );
}

test('uppercase imported colors do not queue stale writes and change-only color events remain supported', async ({
  page,
}) => {
  const prop = box('moving-box', 0, 1.1);
  prop.visual.color = '#AABBCC';
  prop.parts[0].color = '#DDEEFF';
  const initial = emptyWorkspace([prop]);
  await seed(page, initial);
  await selectObject(page, 'Moving box');
  await holdWrites(page);
  await setColor(page, 'Object color', '#123456');
  expect(await saved(page)).toEqual(initial);
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).objects[0].visual.color).toBe('#123456');
  await page.reload();
  expect((await saved(page)).objects[0].visual.color).toBe('#123456');
  expect((await saved(page)).history).toHaveLength(1);
  await selectObject(page, 'Moving box');
  await holdWrites(page);
  await setColor(page, 'Box 1 color', '#654321');
  await releaseWrites(page);
  await expect.poll(async () => (await saved(page)).objects[0].parts[0].color).toBe('#654321');
  await page.reload();
  expect((await saved(page)).objects[0].parts[0].color).toBe('#654321');
  expect((await saved(page)).objects[0].visual.color).toBeNull();
  expect((await saved(page)).history).toHaveLength(2);
  await selectObject(page, 'Moving box');
  await setColor(page, 'Object color', '#778899', false);
  await expect.poll(async () => (await saved(page)).objects[0].visual.color).toBe('#778899');
  expect((await saved(page)).history).toHaveLength(3);
});

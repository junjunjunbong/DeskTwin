import { expect, test, type Page } from '@playwright/test';
import { OrthographicCamera, Vector3 } from 'three';
import {
  createDemoWorkspace,
  createSceneObject,
  type Device,
  type Workspace,
} from '../src/domain/workspace';

const storageKey = 'desktwin.workspace.v1';
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as Page & { connectionErrors?: string[] }).connectionErrors = errors;
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.route('**/api/chat', (route) => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { connectionErrors?: string[] }).connectionErrors).toEqual([]);
});

async function seed(page: Page, workspace: Workspace) {
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem('connections-seeded')) {
        localStorage.setItem(key, JSON.stringify(value));
        sessionStorage.setItem('connections-seeded', 'yes');
      }
    },
    { key: storageKey, value: workspace },
  );
  await page.goto('/');
  await expect(page.getByTestId('desk-canvas')).toBeVisible();
}
async function saved(page: Page): Promise<Workspace> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), storageKey);
}
function renderedLines(page: Page) {
  // These accessible descriptions are emitted from the actual rendered geometry,
  // including unsaved drag frames, rather than copied from the saved workspace.
  return page.locator('.connection-summary [data-connection-id]');
}
async function selectDevice(page: Page, name: string) {
  await page.getByRole('button', { name: 'Device list', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Device list panel' })
    .getByRole('button', { name: new RegExp(`^${name} `) })
    .click();
}

test('connection visibility is independent of editing and preserves every connection record', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  await seed(page, initial);
  const toggle = page.getByRole('switch', { name: 'Show connections', exact: true });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(renderedLines(page)).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(renderedLines(page)).toHaveCount(initial.connections.length);
  await expect(renderedLines(page).filter({ hasText: 'Bluetooth' })).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit placement', exact: true }).first().click();
  await expect(renderedLines(page)).toHaveCount(initial.connections.length);
  await toggle.click();
  await expect(renderedLines(page)).toHaveCount(0);
  expect(await saved(page)).toEqual(initial);
  await page.getByRole('button', { name: 'View connections', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(renderedLines(page)).toHaveCount(initial.connections.length);
  await page.getByRole('button', { name: 'My desk', exact: true }).first().click();
  await expect(renderedLines(page)).toHaveCount(initial.connections.length);
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  expect(await saved(page)).toEqual(initial);
  await page.reload();
  expect((await saved(page)).connections).toEqual(initial.connections);
  expect((await saved(page)).history).toEqual(initial.history);
});

test('device selection highlights its counterparts and shows source-aware endpoint details', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  const cable = initial.connections.find((connection) => connection.id === 'laptop-dock')!;
  cable.source = 'user-reported';
  cable.fromPort = 'Left USB-C port';
  cable.toPort = 'Upstream host';
  cable.note = 'I recorded this cable after looking at my desk.';
  await seed(page, initial);
  await page.getByRole('switch', { name: 'Show connections' }).click();
  await selectDevice(page, 'USB-C Dock');
  await expect(renderedLines(page)).toHaveCount(7);
  await expect(page.locator('.connection-summary [data-emphasis="highlighted"]')).toHaveCount(5);
  await expect(page.locator('.connection-summary [data-emphasis="muted"]')).toHaveCount(2);
  await expect(page.locator('.device-marker[data-connection-role="counterpart"]')).toHaveCount(5);
  const inspector = page.getByRole('complementary', { name: 'Selected device' });
  const record = inspector.locator('.connection-item').filter({
    has: page.getByRole('button', { name: 'Select connected device MacBook', exact: true }),
  });
  await expect(record).toContainText('USB-C');
  await expect(record).toContainText('USB-C Dock port');
  await expect(record).toContainText('Upstream host');
  await expect(record).toContainText('MacBook port');
  await expect(record).toContainText('Left USB-C port');
  await expect(record).toContainText('User-reported');
  await expect(record).toContainText(cable.note);
  await expect(inspector).toContainText('Live hardware operation and physical cable routes');
  await record.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/connections-overview-desktop.png' });
  await record.getByRole('button', { name: 'Select connected device MacBook' }).click();
  await expect(inspector.getByRole('heading', { name: 'MacBook', exact: true })).toBeVisible();
  await expect(page.locator('.connection-summary [data-emphasis="highlighted"]')).toHaveCount(3);

  await page.getByRole('button', { name: 'Scene objects', exact: true }).click();
  await page
    .getByRole('complementary', { name: 'Scene objects panel' })
    .getByRole('button', { name: /^Desk Desk / })
    .click();
  await expect(page.getByRole('complementary', { name: 'Selected scene object' })).toBeVisible();
  await expect(renderedLines(page)).toHaveCount(7);
  await expect(page.locator('.connection-summary [data-emphasis="normal"]')).toHaveCount(7);
  expect(await saved(page)).toEqual(initial);
});

function dragWorkspace(): Workspace {
  const sample = createDemoWorkspace();
  const device = (id: string, x: number): Device => ({
    ...sample.devices[0],
    id,
    name: id === 'moving-device' ? 'Moving device' : 'Stationary device',
    kind: 'dock',
    source: 'user-reported',
    shapeMode: 'custom',
    placement: { x, y: 0, z: 1.1, rotation: 0 },
    parts: [
      {
        position: { x: 0, y: 0.3, z: 0 },
        size: { x: 0.6, y: 0.6, z: 0.6 },
        color: '#82a59b',
      },
    ],
  });
  return {
    ...sample,
    objects: [],
    devices: [device('moving-device', -1.2), device('stationary-device', 1.4)],
    connections: [
      {
        id: 'recorded-usb',
        from: 'moving-device',
        to: 'stationary-device',
        connector: 'USB-C',
        fromPort: 'Port A',
        toPort: 'Port B',
        source: 'user-reported',
        note: 'A user record only.',
      },
    ],
    appearance: { lighting: 'day', decor: true, labels: false },
  };
}

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

test('a real drag with connections on moves the rendered endpoint before its single saved change', async ({
  page,
}) => {
  const initial = dragWorkspace();
  await seed(page, initial);
  await page.getByRole('button', { name: 'Edit placement', exact: true }).first().click();
  await page.getByRole('switch', { name: 'Show connections' }).click();
  const line = renderedLines(page);
  await expect(line).toHaveCount(1);
  const fromBefore = (await line.getAttribute('data-from-position'))!;
  const toBefore = (await line.getAttribute('data-to-position'))!;
  const start = await screen(page, -1.2, 0.55, 1.1);
  const end = await screen(page, -0.3, 0.55, 1.1);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect.poll(() => line.getAttribute('data-from-position')).not.toBe(fromBefore);
  expect(Number((await line.getAttribute('data-from-position'))!.split(',')[0])).toBeCloseTo(
    -0.3,
    1,
  );
  await expect(line).toHaveAttribute('data-to-position', toBefore);
  expect(await saved(page)).toEqual(initial);
  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).devices[0].placement.x).toBeGreaterThan(-0.4);
  const moved = await saved(page);
  expect(moved.connections).toEqual(initial.connections);
  expect(moved.history).toHaveLength(initial.history.length + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices[0].placement)
    .toEqual(initial.devices[0].placement);
  await expect(line).toHaveAttribute('data-from-position', fromBefore);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect
    .poll(async () => (await saved(page)).devices[0].placement)
    .toEqual(moved.devices[0].placement);
  await expect(page.getByRole('switch', { name: 'Show connections' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.screenshot({ path: 'test-results/connections-drag-desktop.png' });
});

test('the mobile toggle stays reachable while a device inspector is open in placement mode', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const initial = createDemoWorkspace();
  await seed(page, initial);
  await page.getByRole('button', { name: 'Edit placement', exact: true }).first().click();
  await selectDevice(page, 'USB-C Dock');
  const toggle = page.getByRole('switch', { name: 'Show connections' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(renderedLines(page)).toHaveCount(7);
  await page.screenshot({ path: 'test-results/connections-inspector-mobile.png' });
  await toggle.click();
  await expect(renderedLines(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await saved(page)).toEqual(initial);
});

test('a real desk drag carries its attached device and live connection as one undo step', async ({
  page,
}) => {
  const initial = dragWorkspace();
  const desk = createSceneObject('desk');
  desk.id = 'connected-desk';
  desk.name = 'Connected desk';
  desk.visual.scale = { x: 0.45, y: 0.55, z: 0.45 };
  initial.objects = [desk];
  initial.devices[0].placement = { x: 0, y: 2.4835 * 0.55, z: 0, rotation: 0 };
  initial.devices[0].attachment = { parentId: desk.id };
  initial.devices[1].placement.x = 3.2;
  await seed(page, initial);
  await page.getByRole('button', { name: 'Edit placement', exact: true }).first().click();
  await page.getByRole('switch', { name: 'Show connections' }).click();
  const line = renderedLines(page);
  await expect(line).toHaveCount(1);
  const fromBefore = (await line.getAttribute('data-from-position'))!;
  const toBefore = (await line.getAttribute('data-to-position'))!;

  // Same physical desktop points as the spatial attachment drag regression.
  const start = await screen(page, 0.85, 1.36, 0.5);
  const end = await screen(page, 1.45, 1.36, 0.5);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect.poll(() => line.getAttribute('data-from-position')).not.toBe(fromBefore);
  const fromDuring = (await line.getAttribute('data-from-position'))!;
  expect(Number(fromDuring.split(',')[0])).toBeCloseTo(0.6, 1);
  await expect(line).toHaveAttribute('data-to-position', toBefore);
  expect(await saved(page)).toEqual(initial);

  await page.mouse.up();
  await expect.poll(async () => (await saved(page)).objects[0].placement.x).toBeGreaterThan(0.5);
  const moved = await saved(page);
  for (const axis of ['x', 'y', 'z'] as const) {
    const deskDelta = moved.objects[0].placement[axis] - initial.objects[0].placement[axis];
    const deviceDelta = moved.devices[0].placement[axis] - initial.devices[0].placement[axis];
    expect(deviceDelta).toBeCloseTo(deskDelta, 5);
  }
  expect(moved.devices[0].attachment).toEqual({ parentId: desk.id });
  expect(moved.devices[1]).toEqual(initial.devices[1]);
  expect(moved.connections).toEqual(initial.connections);
  expect(moved.history).toHaveLength(initial.history.length + 1);
  await expect(line).toHaveAttribute('data-from-position', fromDuring);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(initial);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await expect(line).toHaveAttribute('data-from-position', fromBefore);
  await expect(line).toHaveAttribute('data-to-position', toBefore);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(moved);
  await expect(line).toHaveAttribute('data-from-position', fromDuring);
});

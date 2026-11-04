import { test, expect, type Page, type Locator } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';
import type { SceneProposal, SceneProposalItem } from '../src/domain/sceneProposal';

const storageKey = 'desktwin.workspace.v1';
test.setTimeout(60_000);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as Page & { sceneErrors?: string[] }).sceneErrors = errors;
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'mock-only', photoAvailable: true } }),
  );
  // Every photo response below is a browser fixture. Never fall through to a paid provider.
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { sceneErrors?: string[] }).sceneErrors).toEqual([]);
});

function proposal(): SceneProposal {
  const item = (
    id: string,
    kind: SceneProposalItem['kind'],
    name: string,
    y = 2.51,
  ): SceneProposalItem => ({
    id,
    deviceId: null,
    kind,
    name,
    // Consent, identity and persistence checks use a plausible, non-overlapping
    // scene. Placement rejection is covered separately in photo-review.spec.ts.
    placement: {
      x: kind === 'plant' ? 2.9 : kind === 'monitor' ? -0.7 : kind === 'generic' ? 1.6 : 0,
      y,
      z:
        kind === 'chair'
          ? 2.8
          : kind === 'monitor'
            ? -0.7
            : kind === 'generic'
              ? 0.8
              : kind === 'plant'
                ? 0.6
                : 0,
      rotation: 0,
    },
    scale: { x: 1, y: 1, z: 1 },
    color: '#829575',
    parts: [],
    note: 'Coarse visual estimate from the supplied photo.',
  });
  return {
    message: 'Review this approximate scene before applying it.',
    objects: [
      item('desk', 'desk', 'Photo desk', 0),
      item('chair', 'chair', 'Photo chair', 0.02),
      item('plant', 'plant', 'Photo plant'),
      item('monitor', 'monitor', 'Photo monitor'),
      {
        ...item('prop', 'generic', 'Photo prop'),
        parts: [
          { position: { x: 0, y: 0.25, z: 0 }, size: { x: 0.5, y: 0.5, z: 0.5 }, color: '#829575' },
        ],
      },
    ],
  };
}

async function saved(page: Page): Promise<Workspace | null> {
  return page.evaluate((key) => {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  }, storageKey);
}
async function seed(page: Page, workspace: Workspace) {
  await page.addInitScript(
    ({ key, value }) => {
      if (!sessionStorage.getItem('scene-test-seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('scene-test-seeded', 'yes');
      }
    },
    { key: storageKey, value: JSON.stringify(workspace) },
  );
}
async function choosePhoto(page: Page, color = '#889977') {
  const data = await page.evaluate((fill) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png').split(',')[1];
  }, color);
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-desk.png',
    mimeType: 'image/png',
    buffer: Buffer.from(data, 'base64'),
  });
  await expect(page.getByAltText('Desk reference photo selected by the user')).toBeVisible();
}
async function openDeskPhoto(page: Page) {
  const overview = page.getByRole('complementary', { name: 'Workspace overview', exact: true });
  if (!(await overview.isVisible()))
    await page.getByRole('button', { name: 'My desk', exact: true }).click();
  const expand = page.getByRole('button', { name: /Expand details and controls/ });
  if (!(await overview.isVisible()) && (await expand.isVisible())) await expand.click();
  await overview.getByRole('button', { name: 'Build from a photo', exact: true }).click();
}
async function openPhoto(page: Page) {
  await page.goto('/');
  await openDeskPhoto(page);
  await choosePhoto(page);
}
async function analyze(page: Page) {
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  await page.getByRole('button', { name: /^Continue with \d+ objects?$/ }).click();
  const modal = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(modal).toBeVisible();
  return modal;
}
async function changeColor(input: Locator, value: string) {
  await input.evaluate((element, color) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(element, color);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}
async function openObjects(page: Page) {
  const overview = page.getByRole('complementary', { name: 'Workspace overview', exact: true });
  const edit = page
    .getByRole('group', { name: 'Workspace mode' })
    .getByRole('button', { name: 'Edit', exact: true });
  if (!(await overview.isVisible())) {
    const closeObject = page.getByRole('button', { name: 'Close object details', exact: true });
    const closeDevice = page.getByRole('button', { name: 'Close device details', exact: true });
    if (await closeObject.isVisible()) await closeObject.click();
    else if (await closeDevice.isVisible()) await closeDevice.click();
    else {
      const editing = (await edit.getAttribute('aria-pressed')) === 'true';
      await page.getByRole('button', { name: 'My desk', exact: true }).click();
      if (editing) await edit.click();
    }
  }
  const expand = page.getByRole('button', { name: /Expand details and controls/ });
  if (!(await overview.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(overview).toBeVisible();
  const room = overview.locator('details.room-objects');
  if ((await room.getAttribute('open')) === null) await room.locator('summary').click();
  return overview;
}
async function exportJSON(page: Page) {
  await page.getByRole('button', { name: 'Open settings' }).click();
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await waiting;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString()) as Workspace;
}

test('repeated photo analysis matches an existing device and exposes a reversible record choice', async ({
  page,
}) => {
  const fixture = proposal();
  fixture.objects = fixture.objects.filter((item) => ['desk', 'monitor'].includes(item.id));
  fixture.objects.find((item) => item.kind === 'monitor')!.parts = [
    { position: { x: 0, y: 0.03, z: 0 }, size: { x: 0.6, y: 0.06, z: 0.4 }, color: '#52616c' },
    { position: { x: 0, y: 0.3, z: 0 }, size: { x: 0.08, y: 0.5, z: 0.08 }, color: '#52616c' },
    {
      position: { x: 0, y: 0.9, z: 0 },
      size: { x: 1.4, y: 0.8, z: 0.1 },
      rotation: { x: 0, y: 0, z: 0 },
      color: '#374956',
    },
  ];
  let calls = 0;
  await page.route('**/api/photo', (route) => {
    calls++;
    return route.fulfill({ json: { mode: 'meta', ...fixture } });
  });
  await openPhoto(page);
  let modal = await analyze(page);
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo monitor · Monitor' });
  await expect(modal.getByLabel('Preview device record')).toHaveValue('');
  await expect(modal.getByLabel('Shape part')).toHaveCount(1);
  await modal.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(modal).not.toBeVisible();
  const first = (await saved(page))!;
  expect(first.devices).toHaveLength(1);
  expect(first.devices[0].shapeMode).toBe('custom');
  expect(first.devices[0].parts).toHaveLength(3);
  modal = await analyze(page);
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo monitor · Monitor' });
  await expect(modal.getByLabel('Preview device record')).toHaveValue(first.devices[0].id);
  await modal.getByLabel('Preview device record').selectOption('');
  await expect(modal.getByLabel('Preview device record')).toHaveValue('');
  expect(await saved(page)).toEqual(first);
  await modal.getByLabel('Preview device record').selectOption(first.devices[0].id);
  await modal.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(modal).not.toBeVisible();
  const repeated = (await saved(page))!;
  expect(repeated.devices).toHaveLength(1);
  expect(repeated.objects).toHaveLength(1);
  expect(repeated.devices[0].id).toBe(first.devices[0].id);
  expect(repeated.devices[0].status).toBe('unknown');
  await page.reload();
  expect(await saved(page)).toEqual(repeated);
  expect(calls).toBe(2);
});

test('photo consent and notes lead to an editable preview; discarding never writes storage', async ({
  page,
}) => {
  let calls = 0;
  const notes = 'The monitor connects to my dock with HDMI. I have not tested it.';
  await page.route('**/api/photo', async (route) => {
    calls++;
    const request = route.request().postDataJSON();
    expect(request.context).toBe(notes);
    expect(request.consent).toBe(true);
    expect(request.image).toMatch(/^data:image\/jpeg;base64,/);
    await route.fulfill({ json: { mode: 'meta', ...proposal() } });
  });
  await openPhoto(page);
  expect(calls).toBe(0);
  await expect(page.getByRole('button', { name: 'Create scene preview with Meta' })).toBeDisabled();
  await page.getByLabel('Device and connection notes').fill(notes);
  const modal = await analyze(page);
  await expect(modal.getByTestId('desk-canvas')).toBeVisible();
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo desk · Desk' });
  await modal.getByRole('slider', { name: 'Preview object left / right position' }).fill('0.45');
  await modal.getByRole('slider', { name: 'Preview object rotation' }).fill('12');
  await modal.getByLabel('Preview object width scale').fill('1.25');
  await changeColor(modal.getByLabel('Preview object color', { exact: true }), '#997755');
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  await expect(modal).not.toBeVisible();
  expect(await saved(page)).toBeNull();
  expect(calls).toBe(1);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('an unmatched photo device requires an explicit record choice and keeps user connections', async ({
  page,
}) => {
  const base = createDemoWorkspace();
  base.devices = base.devices.filter((device) => ['laptop', 'monitor-left'].includes(device.id));
  base.objects = [];
  base.connections = [
    {
      id: 'recorded-hdmi',
      from: 'laptop',
      to: 'monitor-left',
      connector: 'HDMI',
      fromPort: 'HDMI output',
      toPort: 'HDMI 1',
      source: 'user-reported',
      note: 'Cable recorded by the user. Working status is unknown.',
    },
  ];
  const fixture = proposal();
  fixture.objects = fixture.objects.filter((item) => ['desk', 'monitor'].includes(item.kind));
  fixture.objects.find((item) => item.kind === 'monitor')!.name = 'Monitor in the photo';
  // Identity review must remain valid for either an additional or a matched
  // monitor; keep the candidate clear of the retained left monitor.
  fixture.objects.find((item) => item.kind === 'monitor')!.placement.x = 1.3;
  await seed(page, base);
  await page.route('**/api/photo', (route) =>
    route.fulfill({ json: { mode: 'meta', ...fixture } }),
  );
  await openPhoto(page);
  let modal = await analyze(page);
  const apply = () => modal.getByRole('button', { name: 'Confirm and apply scene' });
  await expect(apply()).toBeDisabled();
  await expect(
    modal.getByText(/Choose a device record for 1 photo object before applying/),
  ).toBeVisible();
  expect(await saved(page)).toEqual(base);
  await modal.getByRole('button', { name: 'Review device record', exact: true }).click();
  const record = () => modal.getByLabel('Preview device record');
  await expect(record()).toHaveValue(':choose-record');
  await expect(record()).toHaveAttribute('aria-invalid', 'true');

  // Keeping a new device is an explicit, reversible review decision, not a default.
  await record().selectOption('');
  await expect(apply()).toBeEnabled();
  await expect(record()).toHaveValue('');
  expect(await saved(page)).toEqual(base);
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  expect(await saved(page)).toEqual(base);

  // A fresh preview still requires its own decision. Matching keeps the original record and cable.
  modal = await analyze(page);
  await expect(apply()).toBeDisabled();
  await modal.getByRole('button', { name: 'Review device record', exact: true }).click();
  await record().selectOption('monitor-left');
  await expect(apply()).toBeEnabled();
  await expect(record()).toHaveValue('monitor-left');
  expect(await saved(page)).toEqual(base);
  await apply().click();
  await expect(modal).not.toBeVisible();
  const applied = (await saved(page))!;
  expect(applied.devices).toHaveLength(2);
  expect(applied.devices.find((device) => device.id === 'monitor-left')).toMatchObject({
    name: 'Left monitor',
    source: 'demo',
    status: 'unknown',
  });
  expect(applied.connections).toEqual(base.connections);
  expect(applied.history).toHaveLength(base.history.length + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(base);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(applied);
});

test('applying a scene is one undo step and preserves user-reported identity, links and status', async ({
  page,
}) => {
  const base = createDemoWorkspace();
  const monitor = base.devices.find((device) => device.id === 'monitor-left')!;
  monitor.source = 'user-reported';
  monitor.model = 'My display model';
  monitor.status = 'reported-issue';
  monitor.statusNote = 'I observed flickering.';
  base.devices.find((device) => device.id === 'dock')!.source = 'user-reported';
  base.connections[1].source = 'user-reported';
  base.connections[1].note = 'I connected this cable myself.';
  await seed(page, base);
  const scene = proposal();
  // Keep the approval/Undo fixture clear of the intended desk movement. Collision rejection has dedicated tests.
  scene.objects.find((object) => object.kind === 'chair')!.placement.z = 2.8;
  scene.objects.find((object) => object.kind === 'monitor')!.deviceId = monitor.id;
  await page.route('**/api/photo', (route) => route.fulfill({ json: { mode: 'meta', ...scene } }));
  await openPhoto(page);
  const modal = await analyze(page);
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo desk · Desk' });
  await modal.getByRole('slider', { name: 'Preview object left / right position' }).fill('0.6');
  await modal.getByLabel('Preview object width scale').fill('1.2');
  expect(await saved(page)).toEqual(base);
  await modal.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(modal).not.toBeVisible();
  const applied = (await saved(page))!;
  expect(applied.objects.find((object) => object.name === 'Photo desk')?.placement.x).toBe(0.6);
  expect(applied.objects.find((object) => object.name === 'Photo desk')?.visual.scale.x).toBe(1.2);
  expect(applied.devices.find((device) => device.id === monitor.id)).toMatchObject({
    name: monitor.name,
    model: monitor.model,
    source: 'user-reported',
    status: 'reported-issue',
    statusNote: monitor.statusNote,
  });
  expect(
    applied.connections.find((connection) => connection.id === base.connections[1].id),
  ).toEqual(base.connections[1]);
  expect(applied.history).toHaveLength(base.history.length + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(base);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => saved(page)).toEqual(applied);
  await page.reload();
  expect(await saved(page)).toEqual(applied);
  const list = await openObjects(page);
  await expect(list.getByRole('button', { name: /Photo prop Generic object/ })).toBeVisible();
});

test('desk, chair, plants and generic box parts remain editable and survive JSON round trips', async ({
  page,
}) => {
  const initial = createDemoWorkspace();
  initial.devices = [];
  initial.connections = [];
  initial.objects = initial.objects.filter((object) =>
    ['decor-desk', 'decor-chair', 'decor-plant-left'].includes(object.id),
  );
  await seed(page, initial);
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  let list = await openObjects(page);
  await list.getByRole('button', { name: /^Desk Desk / }).click();
  await page.getByLabel('Object width scale').fill('1.15');
  list = await openObjects(page);
  await list.getByRole('button', { name: /^Desk chair Chair / }).click();
  await page.getByRole('slider', { name: 'Object rotation', exact: true }).fill('25');
  list = await openObjects(page);
  await list.getByRole('button', { name: /^Left desk plant Plant / }).click();
  await changeColor(page.getByLabel('Object color', { exact: true }), '#42845f');
  list = await openObjects(page);
  await list.getByRole('button', { name: 'Add an object' }).click();
  const add = page.getByRole('dialog', { name: 'Add scene object' });
  await add.getByLabel('New object template').selectOption('generic');
  await add.getByLabel('New object name').fill('Editable prop');
  await add.getByRole('button', { name: 'Add object to scene' }).click();
  list = await openObjects(page);
  await list.getByRole('button', { name: /Editable prop Generic object/ }).click();
  const inspector = page.getByRole('complementary', { name: 'Selected scene object' });
  await inspector.getByRole('button', { name: 'Customize template shape' }).click();
  await inspector.getByLabel('Shape part').selectOption('0');
  await inspector.getByLabel('Box 1 size x').fill('0.85');
  await inspector.getByLabel('Box 1 position y').fill('0.4');
  await changeColor(inspector.getByLabel('Box 1 color'), '#d29b58');
  await inspector.getByRole('slider', { name: 'Object height position', exact: true }).fill('2.8');
  await expect
    .poll(
      async () =>
        (await saved(page))?.objects.find((object) => object.name === 'Editable prop')?.placement.y,
    )
    .toBe(2.8);
  const expected = (await saved(page))!;
  expect(expected.objects.find((object) => object.id === 'decor-desk')?.visual.scale.x).toBe(1.15);
  expect(expected.objects.find((object) => object.id === 'decor-chair')?.placement.rotation).toBe(
    25,
  );
  expect(expected.objects.find((object) => object.id === 'decor-plant-left')?.visual.color).toBe(
    '#42845f',
  );
  expect(expected.objects.find((object) => object.name === 'Editable prop')).toMatchObject({
    kind: 'generic',
    placement: { y: 2.8 },
    shapeMode: 'custom',
    parts: [
      expect.objectContaining({
        size: expect.objectContaining({ x: 0.85 }),
        position: expect.objectContaining({ y: 0.4 }),
        color: '#d29b58',
      }),
      expect.any(Object),
    ],
  });
  await page.reload();
  expect(await saved(page)).toEqual(expected);
  const exported = await exportJSON(page);
  expect(exported).toEqual(expected);
  expect(exported).not.toHaveProperty('photo');
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'scene-roundtrip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  });
  expect(await saved(page)).toEqual(expected);
});

test('a literal v1 JSON import migrates without losing user device or connection records', async ({
  page,
}) => {
  // Deliberately independent of the current demo factory: this is the old serialized contract.
  const legacy = {
    schemaVersion: 1,
    name: 'Legacy desk',
    devices: [
      {
        id: 'old-laptop',
        kind: 'laptop',
        name: 'Personal laptop',
        model: 'Saved model',
        placement: { x: -1, z: 0, rotation: 8 },
        source: 'user-reported',
        status: 'reported-working',
        statusNote: 'I tested it.',
      },
      {
        id: 'old-monitor',
        kind: 'monitor',
        name: 'Personal monitor',
        model: '',
        placement: { x: 1, z: -0.5, rotation: 0 },
        source: 'photo-inferred',
        status: 'unknown',
        statusNote: '',
      },
    ],
    connections: [
      {
        id: 'old-link',
        from: 'old-laptop',
        to: 'old-monitor',
        connector: 'HDMI',
        fromPort: 'HDMI 1',
        toPort: 'HDMI 2',
        source: 'user-reported',
        note: 'My cable record',
      },
    ],
    history: [
      {
        id: 'old-event',
        at: '2026-10-26T12:00:00.000Z',
        summary: 'Saved before scene editing',
        source: 'user-reported',
      },
    ],
    appearance: { lighting: 'night', labels: true, decor: false },
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.locator('input[type=file][accept=".json,application/json"]').setInputFiles({
    name: 'legacy-v1.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(legacy)),
  });
  await expect(page.getByRole('heading', { name: 'Legacy desk', exact: true })).toBeVisible();
  const migrated = (await saved(page))!;
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.devices).toHaveLength(2);
  expect(migrated.devices[0]).toMatchObject({
    ...legacy.devices[0],
    placement: { ...legacy.devices[0].placement, y: 2.51 },
  });
  expect(migrated.connections).toEqual(legacy.connections);
  expect(migrated.history).toEqual(legacy.history);
  expect(migrated.appearance).toEqual(legacy.appearance);
  expect(migrated.objects.some((object) => object.kind === 'desk')).toBe(true);
  await page.reload();
  expect(await saved(page)).toEqual(migrated);
  await expect(page.getByRole('heading', { name: 'Legacy desk', exact: true })).toBeVisible();
});

test('provider failures and hostile scene fields preserve the saved workspace', async ({
  page,
}) => {
  const base = createDemoWorkspace();
  await seed(page, base);
  let calls = 0;
  await page.route('**/api/photo', (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 502, json: { error: 'Mock provider unavailable' } })
      : route.fulfill({
          json: {
            mode: 'meta',
            ...proposal(),
            connections: [{ from: 'laptop', to: 'dock' }],
            code: 'window.badSceneExecuted = true',
          },
        });
  });
  await openPhoto(page);
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  await expect(page.getByRole('alert')).toHaveText('Mock provider unavailable');
  expect(await saved(page)).toEqual(base);
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'The returned scene was invalid. Your saved workspace was not changed.',
  );
  await expect(page.getByRole('dialog', { name: 'Review your desk scene' })).not.toBeVisible();
  expect(await saved(page)).toEqual(base);
  expect(await page.evaluate(() => 'badSceneExecuted' in window)).toBe(false);
});

test('canceling a delayed analysis prevents it from replacing a newer preview', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completed!: () => void;
  const delivered = new Promise<void>((resolve) => {
    completed = resolve;
  });
  let calls = 0;
  await page.route('**/api/photo', async (route) => {
    calls++;
    if (calls === 1) {
      await gate;
      try {
        await route.fulfill({
          json: { mode: 'meta', ...proposal(), message: 'Obsolete response must not appear' },
        });
      } catch {
        /* The browser may already have canceled the request. */
      } finally {
        completed();
      }
    } else
      await route.fulfill({
        json: { mode: 'meta', ...proposal(), message: 'Current scene proposal' },
      });
  });
  try {
    await openPhoto(page);
    await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
    await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
    await expect.poll(() => calls).toBe(1);
    await page.getByRole('button', { name: 'Cancel analysis' }).click();
    await page.getByLabel('Device and connection notes').fill('Use this newer description.');
    const modal = await analyze(page);
    await expect(modal.getByText('Current scene proposal')).toBeVisible();
    release();
    await delivered;
    await expect(modal.getByText('Current scene proposal')).toBeVisible();
    await expect(page.getByText('Obsolete response must not appear')).not.toBeVisible();
    expect(await saved(page)).toBeNull();
    await modal.getByRole('button', { name: 'Discard preview' }).click();
  } finally {
    release();
  }
});

test('replacing a photo cancels the old analysis and requires fresh consent', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let completed!: () => void;
  const delivered = new Promise<void>((resolve) => {
    completed = resolve;
  });
  let calls = 0;
  await page.route('**/api/photo', async (route) => {
    calls++;
    await gate;
    try {
      await route.fulfill({ json: { mode: 'meta', ...proposal() } });
    } catch {
      /* The old request is intentionally aborted by replacing the photo. */
    } finally {
      completed();
    }
  });
  try {
    await openPhoto(page);
    await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
    await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
    await expect.poll(() => calls).toBe(1);
    await choosePhoto(page, '#887799');
    await expect(
      page.getByRole('checkbox', { name: /I agree to send this photo/ }),
    ).not.toBeChecked();
    await expect(
      page.getByRole('button', { name: 'Create scene preview with Meta' }),
    ).toBeDisabled();
    release();
    await delivered;
    await expect(page.getByRole('dialog', { name: 'Review your desk scene' })).not.toBeVisible();
    expect(calls).toBe(1);
    expect(await saved(page)).toBeNull();
  } finally {
    release();
  }
});

test('scene object editing and creation are usable in a narrow viewport', async ({ page }) => {
  const initial = createDemoWorkspace();
  initial.objects = initial.objects.filter(
    (object) => object.kind === 'desk' || object.kind === 'chair',
  );
  await seed(page, initial);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const list = await openObjects(page);
  await list.getByRole('button', { name: /^Desk chair Chair / }).click();
  await expect(page.getByRole('complementary', { name: 'Selected scene object' })).toBeVisible();
  await page.getByRole('slider', { name: 'Object rotation', exact: true }).fill('18');
  await expect
    .poll(
      async () =>
        (await saved(page))!.objects.find((object) => object.id === 'decor-chair')?.placement
          .rotation,
    )
    .toBe(18);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await openObjects(page);
  await page.getByRole('button', { name: 'Add an object' }).click();
  const modal = page.getByRole('dialog', { name: 'Add scene object' });
  await expect(modal).toBeVisible();
  await modal.getByLabel('New object template').selectOption('mug');
  await modal.getByLabel('New object name').fill('My mug');
  await modal.getByRole('button', { name: 'Add object to scene' }).click();
  await expect
    .poll(async () => (await saved(page))!.objects.some((object) => object.name === 'My mug'))
    .toBe(true);
});

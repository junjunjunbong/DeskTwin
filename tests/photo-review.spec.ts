import { test, expect, type Page } from '@playwright/test';
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';
import type { SceneProposal, SceneProposalItem } from '../src/domain/sceneProposal';

const storageKey = 'desktwin.workspace.v1';
test.setTimeout(60_000);

function candidate(
  id: string,
  kind: SceneProposalItem['kind'],
  name: string,
  x: number,
  z: number,
  y = 2.51,
): SceneProposalItem {
  return {
    id,
    kind,
    name,
    deviceId: null,
    placement: { x, y, z, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#829575',
    parts: [],
    note: 'Synthetic browser fixture, not a real photo observation.',
    supportId: kind === 'desk' ? 'floor' : 'desk',
    imageRegion: null,
  };
}
function proposal(): SceneProposal {
  return {
    message: 'Review these synthetic visual estimates.',
    objects: [
      candidate('desk', 'desk', 'Photo desk', 0, 0, 0),
      candidate('monitor', 'monitor', 'Photo monitor', -1.3, -0.65),
      {
        ...candidate('plant', 'plant', 'Photo plant', 2.3, 0.7),
        imageRegion: { x: 0.65, y: 0.2, width: 0.2, height: 0.45 },
      },
    ],
  };
}
async function saved(page: Page): Promise<Workspace | null> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), storageKey);
}
async function seed(page: Page, workspace: Workspace) {
  await page.addInitScript(
    ({ key, workspace }) => localStorage.setItem(key, JSON.stringify(workspace)),
    { key: storageKey, workspace },
  );
}
async function openPreview(page: Page, fixture = proposal()) {
  await page.route('**/api/photo', (route) =>
    route.fulfill({ json: { mode: 'meta', ...fixture } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 12;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#92a28a';
    context.fillRect(0, 0, 20, 12);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-review.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const modal = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('desk-canvas')).toBeVisible();
  return modal;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as Page & { reviewErrors?: string[] }).reviewErrors = errors;
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'mock-only', photoAvailable: true } }),
  );
  // All photo responses are local synthetic fixtures; this suite must never call a provider.
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { reviewErrors?: string[] }).reviewErrors).toEqual([]);
});

test('candidate edits survive exclusion and restore without writing before confirmation', async ({
  page,
}) => {
  const modal = await openPreview(page);
  await expect(modal.getByRole('checkbox', { name: /^Include / })).toHaveCount(3);
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo plant · Plant' });
  await expect(
    modal.getByRole('img', { name: 'Approximate photo region for Photo plant' }),
  ).toBeVisible();
  await modal.getByLabel('Preview object name').fill('My plant estimate');
  await modal.getByLabel('Preview object name').press('Enter');
  await modal.getByLabel('Preview object width scale').fill('0.7');
  await modal.getByRole('checkbox', { name: 'Include My plant estimate in scene' }).uncheck();
  await expect(modal.getByRole('region', { name: 'Excluded preview object' })).toBeVisible();
  await expect(
    modal.getByRole('checkbox', { name: 'Include Photo monitor in scene' }),
  ).toBeChecked();
  await expect(
    modal.getByRole('img', { name: 'Approximate photo region for My plant estimate' }),
  ).toBeVisible();
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: 'Restore to preview' }).click();
  await expect(modal.getByLabel('Preview object name')).toHaveValue('My plant estimate');
  await expect(modal.getByLabel('Preview object width scale')).toHaveValue('0.7');
  await modal.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(modal).not.toBeVisible();
  const applied = (await saved(page))!;
  expect(applied.objects.find((item) => item.name === 'My plant estimate')?.visual.scale.x).toBe(
    0.7,
  );
  expect(JSON.stringify(applied)).not.toContain('imageRegion');
  expect(JSON.stringify(applied)).not.toContain('data:image');
});

test('manual additions use the selected type and preset and have no invented photo region', async ({
  page,
}) => {
  const modal = await openPreview(page);
  await modal.getByRole('button', { name: 'Add missing object', exact: true }).click();
  await modal.getByLabel('Missing object name').fill('My missing trackpad');
  await modal.getByLabel('Missing object type').selectOption('trackpad');
  await modal.getByLabel('Missing object preset').selectOption('trackpad-large');
  await modal.getByRole('button', { name: 'Add to preview', exact: true }).click();
  await expect(modal.getByLabel('Preview object name')).toHaveValue('My missing trackpad');
  await expect(modal.getByText('Added by you · unsaved', { exact: true })).toBeVisible();
  await expect(
    modal.getByText('Added by you. No photo region is assigned.', { exact: true }),
  ).toBeVisible();
  await expect(modal.locator('.preview-photo-region')).toHaveCount(0);
  await expect(modal.getByLabel('Preview object width scale')).toHaveValue('1.25');
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(modal).not.toBeVisible();
  expect(
    (await saved(page))!.devices.find((item) => item.name === 'My missing trackpad'),
  ).toMatchObject({
    kind: 'trackpad',
    source: 'user-reported',
    status: 'unknown',
    visual: { source: 'user-reported', scale: { x: 1.25, y: 1, z: 1.2 } },
  });
});

test('excluding a matched device keeps its saved record, privacy provenance and connections', async ({
  page,
}) => {
  const base = createDemoWorkspace();
  base.objects = base.objects.filter((item) => item.kind === 'desk');
  base.objects[0].visual.source = 'user-reported';
  base.devices = base.devices.filter((item) => ['laptop', 'monitor-left'].includes(item.id));
  const original = base.devices.find((item) => item.id === 'monitor-left')!;
  original.source = 'user-reported';
  original.status = 'reported-issue';
  original.statusNote = 'I observed flickering.';
  original.hardwareOrigin = 'macos';
  base.connections = [
    {
      id: 'my-cable',
      from: 'laptop',
      to: original.id,
      connector: 'HDMI',
      fromPort: '',
      toPort: '',
      source: 'user-reported',
      note: 'My reported cable.',
    },
  ];
  const fixture = proposal();
  fixture.objects = fixture.objects.filter((item) => item.kind === 'monitor');
  fixture.objects[0].deviceId = original.id;
  fixture.objects[0].placement.x = 0.8;
  fixture.objects[0].supportId = base.objects[0].id;
  await seed(page, base);
  const modal = await openPreview(page, fixture);
  await expect(modal.getByLabel('Preview object name')).toBeDisabled();
  await modal.getByRole('checkbox', { name: 'Include Left monitor in scene' }).uncheck();
  const retained = modal.getByRole('list', { name: 'Retained saved objects' });
  await expect(retained.getByRole('button', { name: /Left monitor/ })).toBeVisible();
  expect(await saved(page)).toEqual(base);
  await modal.getByRole('button', { name: 'Confirm and apply scene' }).click();
  await expect(modal).not.toBeVisible();
  const applied = (await saved(page))!;
  expect(applied.devices.find((item) => item.id === original.id)).toEqual(original);
  expect(applied.connections).toEqual(base.connections);
});

test('excluding an intended support leaves an actionable issue until it is restored', async ({
  page,
}) => {
  const modal = await openPreview(page);
  await modal.getByRole('checkbox', { name: 'Include Photo desk in scene' }).uncheck();
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeDisabled();
  await modal.getByRole('button', { name: 'Review placement issue', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'Selected object review issues' })).toContainText(
    'selected support is unavailable',
  );
  await expect(modal.getByLabel('Preview intended support')).toHaveValue('desk');
  expect(
    Number(
      await modal.getByRole('slider', { name: 'Preview object height position' }).inputValue(),
    ),
  ).toBeGreaterThan(2);
  expect(await saved(page)).toBeNull();
  await modal.getByRole('checkbox', { name: 'Include Photo desk in scene' }).check();
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  expect(await saved(page)).toBeNull();
});

test('overlapping photo estimates stay visible for review and block confirmation until corrected', async ({
  page,
}) => {
  const fixture = proposal();
  fixture.objects.push({
    ...candidate('second-plant', 'plant', 'Overlapping plant', 2.3, 0.7),
    imageRegion: null,
  });
  const modal = await openPreview(page, fixture);
  await expect(
    modal.getByRole('checkbox', { name: 'Include Overlapping plant in scene' }),
  ).toBeChecked();
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeDisabled();
  await modal.getByRole('button', { name: 'Review placement issue', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'Selected object review issues' })).toContainText(
    'overlaps',
  );
  expect(await saved(page)).toBeNull();
  await modal.getByRole('checkbox', { name: 'Include Overlapping plant in scene' }).uncheck();
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  expect(await saved(page)).toBeNull();
});

test('review controls and reference comparison remain usable on a narrow screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const modal = await openPreview(page);
  await modal.getByRole('button', { name: 'Enlarge photo', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Reduce photo', exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Reduce photo', exact: true }).click();
  const include = modal.getByRole('checkbox', { name: 'Include Photo plant in scene' });
  await include.uncheck();
  await include.check();
  await expect(include).toBeChecked();
  await modal.getByRole('button', { name: 'Add missing object', exact: true }).click();
  await expect(modal.getByLabel('Missing object name')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  expect(await saved(page)).toBeNull();
});

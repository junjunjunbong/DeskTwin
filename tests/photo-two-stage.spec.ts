import { test, expect, type Page } from '@playwright/test';
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
function scene(): SceneProposal {
  return {
    message: 'Review these synthetic visual estimates.',
    objects: [
      candidate('desk', 'desk', 'Photo desk', 0, 0, 0),
      candidate('monitor', 'monitor', 'Photo monitor', -1.3, -0.65),
      candidate('plant', 'plant', 'Photo plant', 2.3, 0.7),
    ],
  };
}
function inventory() {
  return {
    message: 'Visible objects only. Placement is not decided.',
    objects: [
      {
        id: 'monitor-a',
        kind: 'monitor',
        name: 'Black monitor',
        samPhrase: 'black computer monitor',
        imageRegion: { x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
        imageRegionVisibility: 'complete',
      },
      {
        id: 'keyboard-a',
        kind: 'keyboard',
        name: 'Desk keyboard',
        samPhrase: 'computer keyboard',
        imageRegion: { x: 0.2, y: 0.6, width: 0.4, height: 0.15 },
        imageRegionVisibility: 'partial',
      },
      {
        id: 'mug-a',
        kind: 'mug',
        name: 'White mug',
        samPhrase: 'white mug',
        imageRegion: null,
        imageRegionVisibility: 'unknown',
      },
    ],
    regionSources: {
      'monitor-a': 'sam',
      'keyboard-a': 'model',
      'mug-a': 'none',
    },
    sam: { enabled: true, requests: 3, failed: 0 },
  };
}
async function saved(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}
async function openPhotoPanel(page: Page) {
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
    name: 'synthetic-two-stage.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
}
function pathIs(pathname: string) {
  return (url: URL) => url.pathname === pathname;
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  (page as Page & { reviewErrors?: string[] }).reviewErrors = errors;
});
test.afterEach(async ({ page }) => {
  expect((page as Page & { reviewErrors?: string[] }).reviewErrors).toEqual([]);
});

test('two-stage inventory keeps SAM labels, sends only checked ids, and opens review directly', async ({
  page,
}) => {
  let objectCalls = 0;
  let photoCalls = 0;
  const selections: string[][] = [];
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: { mode: 'meta', model: 'mock-only', photoAvailable: true, photoTwoStage: true },
    }),
  );
  await page.route(pathIs('/api/photo/objects'), async (route) => {
    objectCalls += 1;
    await route.fulfill({ json: inventory() });
  });
  await page.route(pathIs('/api/photo'), async (route) => {
    photoCalls += 1;
    const body = route.request().postDataJSON() as {
      selection?: { objects?: { id: string }[] };
    };
    selections.push((body.selection?.objects ?? []).map((object) => object.id));
    await route.fulfill({ json: { mode: 'meta', ...scene() } });
  });
  await openPhotoPanel(page);
  const before = await saved(page);
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose what to add' });
  await expect(picker).toBeVisible();
  expect(objectCalls).toBe(1);
  expect(photoCalls).toBe(0);
  await expect(picker.getByRole('checkbox', { name: /Black monitor/ })).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: /Desk keyboard/ })).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: /White mug/ })).toBeChecked();
  await expect(picker.getByText('Outlined by SAM 3.1', { exact: true })).toHaveCount(1);
  await expect(picker.getByRole('checkbox', { name: /Black monitor/ })).toHaveAccessibleName(
    /Outlined by SAM 3.1/,
  );
  await expect(picker.getByRole('checkbox', { name: /Desk keyboard/ })).not.toHaveAccessibleName(
    /Outlined by SAM 3.1/,
  );
  await expect(picker.getByRole('checkbox', { name: /White mug/ })).not.toHaveAccessibleName(
    /Outlined by SAM 3.1/,
  );
  await picker.getByRole('checkbox', { name: /Desk keyboard/ }).uncheck();
  await picker.getByRole('button', { name: 'Continue with 2 objects', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(review).toBeVisible();
  await expect(review.getByTestId('desk-canvas')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Choose what to add' })).toHaveCount(0);
  expect(photoCalls).toBe(1);
  expect(objectCalls).toBe(1);
  expect(selections).toEqual([['monitor-a', 'mug-a']]);
  expect(await saved(page)).toEqual(before);
  await review.getByRole('button', { name: 'Discard preview' }).click();
  const timings = page.getByLabel('Photo processing times');
  await timings.getByText('View processing times', { exact: true }).click();
  await expect(timings).toContainText(/Finding objects: /);
  await expect(timings).toContainText(/Placing selected objects: /);
  await expect(timings).toContainText(/Scene fitting: /);
  await expect(timings).toContainText(/Analysis to preview: /);
  await expect(page.getByText(/SAM 3.1 outlined 1 of 3 objects/)).toBeVisible();
  expect(await saved(page)).toEqual(before);
});

test('a failed placement reopens the picker with the same checks and does not list objects again', async ({
  page,
}) => {
  let objectCalls = 0;
  let photoCalls = 0;
  const selections: string[][] = [];
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: { mode: 'meta', model: 'mock-only', photoAvailable: true, photoTwoStage: true },
    }),
  );
  await page.route(pathIs('/api/photo/objects'), async (route) => {
    objectCalls += 1;
    await route.fulfill({ json: inventory() });
  });
  await page.route(pathIs('/api/photo'), async (route) => {
    photoCalls += 1;
    const body = route.request().postDataJSON() as {
      selection?: { objects?: { id: string }[] };
    };
    selections.push((body.selection?.objects ?? []).map((object) => object.id));
    if (photoCalls === 1) {
      await route.fulfill({ status: 502, json: { error: 'Scene placement failed.' } });
      return;
    }
    await route.fulfill({ json: { mode: 'meta', ...scene() } });
  });
  await openPhotoPanel(page);
  const before = await saved(page);
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose what to add' });
  await expect(picker).toBeVisible();
  await picker.getByRole('checkbox', { name: /Desk keyboard/ }).uncheck();
  await picker.getByRole('button', { name: 'Continue with 2 objects', exact: true }).click();
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('alert')).toContainText('Scene placement failed.');
  await expect(picker.getByRole('checkbox', { name: /Desk keyboard/ })).not.toBeChecked();
  await expect(picker.getByRole('checkbox', { name: /Black monitor/ })).toBeChecked();
  await expect(picker.getByRole('checkbox', { name: /White mug/ })).toBeChecked();
  await expect(page.getByRole('dialog', { name: 'Review your desk scene' })).toHaveCount(0);
  expect(objectCalls).toBe(1);
  await picker.getByRole('button', { name: 'Continue with 2 objects', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(review).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Choose what to add' })).toHaveCount(0);
  expect(objectCalls).toBe(1);
  expect(photoCalls).toBe(2);
  expect(selections).toEqual([
    ['monitor-a', 'mug-a'],
    ['monitor-a', 'mug-a'],
  ]);
  expect(await saved(page)).toEqual(before);
});

test('health without photoTwoStage keeps the single photo request', async ({ page }) => {
  let objectCalls = 0;
  let photoCalls = 0;
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'mock-only', photoAvailable: true } }),
  );
  await page.route(pathIs('/api/photo/objects'), async (route) => {
    objectCalls += 1;
    await route.fulfill({ status: 500, json: { error: 'Object listing was not expected.' } });
  });
  await page.route(pathIs('/api/photo'), async (route) => {
    photoCalls += 1;
    await route.fulfill({ json: { mode: 'meta', ...scene() } });
  });
  await openPhotoPanel(page);
  const before = await saved(page);
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose what to add' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('checkbox', { name: /Photo desk/ })).toBeChecked();
  await expect(picker.getByText('Outlined by SAM 3.1')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Review your desk scene' })).toHaveCount(0);
  expect(objectCalls).toBe(0);
  expect(photoCalls).toBe(1);
  expect(await saved(page)).toEqual(before);
});

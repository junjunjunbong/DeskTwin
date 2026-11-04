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
async function openPicker(
  page: Page,
  fixture = proposal(),
  timings: unknown = {
    providerMs: 15,
    validationMs: 2,
    totalMs: 17,
    responseBytes: 800,
    objectCount: fixture.objects.length,
  },
  notes = '',
) {
  await page.route('**/api/photo', (route) =>
    route.fulfill({
      json: {
        mode: 'meta',
        ...fixture,
        ...(timings === null ? {} : { timings }),
      },
    }),
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
  if (notes) await page.getByLabel('Device and connection notes').fill(notes);
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const picker = page.getByRole('dialog', { name: 'Choose what to add' });
  await expect(picker).toBeVisible();
  return picker;
}
async function openPreview(
  page: Page,
  fixture = proposal(),
  timings: unknown = {
    providerMs: 15,
    validationMs: 2,
    totalMs: 17,
    responseBytes: 800,
    objectCount: fixture.objects.length,
  },
) {
  const picker = await openPicker(page, fixture, timings);
  await picker.getByRole('button', { name: /^Continue with \d+ objects?$/ }).click();
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

test('photo request remains active until the 125-second browser deadline', async ({ page }) => {
  await page.addInitScript((fixture) => {
    const originalFetch = window.fetch;
    let attempts = 0;
    window.fetch = (input, init) => {
      if (input === '/api/photo') {
        attempts++;
        if (attempts > 1)
          return Promise.resolve(
            new Response(JSON.stringify({ mode: 'meta', ...fixture }), {
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      }
      return originalFetch(input, init);
    };
  }, proposal());
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 12;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-timeout.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  const analyze = page.getByRole('button', { name: 'Create scene preview with Meta' });
  await expect(analyze).toBeEnabled();
  const start = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(start);
  await analyze.click();
  const progress = page.getByLabel('Photo analysis progress');
  await expect(progress).toContainText('Analyzing the photo');
  await expect(progress.getByRole('button', { name: 'Cancel analysis' })).toBeVisible();
  const timeout = page.getByRole('alert');
  await page.clock.fastForward(124999);
  await expect(timeout).toHaveCount(0);
  await expect(progress).toContainText('124 s elapsed');
  await page.clock.fastForward(1);
  await expect(timeout).toContainText('Photo analysis timed out. Your workspace was not changed.');
  await expect(timeout).toContainText('retry using the same photo and notes');
  await page.getByRole('button', { name: 'Retry photo analysis' }).click();
  await page.clock.runFor(10);
  await page.getByRole('button', { name: /^Continue with \d+ objects?$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Review your desk scene' })).toBeVisible();
});

test('photo analysis can be canceled on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) =>
      input === '/api/photo'
        ? new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          })
        : originalFetch(input, init);
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 12;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-cancel.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const cancel = page.getByRole('button', { name: 'Cancel analysis' });
  await expect(cancel).toBeVisible();
  await cancel.focus();
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Photo analysis progress')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create scene preview with Meta' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a server timeout offers a manual retry without losing photo consent', async ({ page }) => {
  await page.route('**/api/photo', (route) =>
    route.fulfill({
      status: 504,
      json: { error: 'The Meta response timed out. Your workspace was not changed.' },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 20;
    canvas.height = 12;
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-server-timeout.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  const consent = page.getByRole('checkbox', { name: /I agree to send this photo/ });
  await consent.check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  await expect(page.getByRole('alert')).toContainText('retry using the same photo and notes');
  await expect(consent).toBeChecked();
  await expect(page.getByRole('button', { name: 'Retry photo analysis' })).toBeEnabled();
});

test('photo processing times distinguish preparation, response checks and scene fitting without saving', async ({
  page,
}) => {
  const modal = await openPreview(page);
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  const timings = page.getByLabel('Photo processing times');
  await timings.getByText('View processing times', { exact: true }).click();
  await expect(timings).toContainText(/Photo preparation: \d+(?:\.\d+)? (?:ms|s)/);
  await expect(timings).toContainText('Model response: 15 ms');
  await expect(timings).toContainText('Response checks: 2 ms');
  await expect(timings).toContainText(/Local response checks: \d+(?:\.\d+)? (?:ms|s)/);
  await expect(timings).toContainText(/Scene fitting: \d+(?:\.\d+)? (?:ms|s)/);
  await expect(timings).toContainText(/Analysis to preview: \d+(?:\.\d+)? (?:ms|s)/);
  expect(await saved(page)).toBeNull();
});

for (const [description, timings] of [
  ['missing', null],
  [
    'invalid',
    {
      providerMs: -1,
      validationMs: 'not a number',
      totalMs: 10,
      responseBytes: 10,
      objectCount: 3,
    },
  ],
] as const) {
  test(`${description} timing metadata keeps the frozen proposal compatible and uses observed request time`, async ({
    page,
  }) => {
    const modal = await openPreview(page, proposal(), timings);
    await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
    await modal.getByRole('button', { name: 'Discard preview' }).click();
    const breakdown = page.getByLabel('Photo processing times');
    await breakdown.getByText('View processing times', { exact: true }).click();
    await expect(breakdown).toContainText(/Analysis request: \d+(?:\.\d+)? (?:ms|s)/);
    await expect(breakdown).not.toContainText('Model response:');
    await expect(breakdown).not.toContainText('NaN');
    expect(await saved(page)).toBeNull();
  });
}

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
  await expect(modal.locator('.preview-issues-summary')).toContainText(
    '1 placement problem needs review',
  );
  await modal.getByRole('button', { name: 'Fit small gaps', exact: true }).click();
  await expect(modal.locator('.preview-issues-summary')).toContainText(
    '1 placement problem needs review',
  );
  await modal.getByRole('button', { name: 'Review placement issue', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'Selected object review issues' })).toContainText(
    'overlaps',
  );
  await expect(
    modal.getByRole('region', { name: 'Selected object review issues' }).locator('li'),
  ).toHaveCount(1);
  expect(await saved(page)).toBeNull();
  await modal.getByRole('checkbox', { name: 'Include Overlapping plant in scene' }).uncheck();
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  expect(await saved(page)).toBeNull();
});

function gapProposal(): SceneProposal {
  return {
    message: 'Sanitized spacing regression. Geometry acceptance is not photo fidelity.',
    objects: [
      candidate('desk', 'desk', 'Photo desk', 0, 0, 0),
      candidate('keyboard', 'keyboard', 'Photo keyboard', -0.05, 0.4, 2.4735),
      {
        ...candidate('wrist-rest', 'wrist-rest', 'Photo wrist rest', -0.05, 0.7, 2.4835),
        scale: { x: 0.9, y: 1, z: 1 },
      },
    ],
  };
}

test('automatic gap fitting can be compared, undone and reapplied without saving the preview', async ({
  page,
}) => {
  const modal = await openPreview(page, gapProposal());
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo wrist rest · Wrist rest' });
  const z = modal.getByRole('slider', { name: 'Preview object front / back position' });
  const fittedZ = await z.inputValue();
  await expect(modal.getByRole('region', { name: 'Photo placement adjustments' })).toContainText(
    'adjusted',
  );
  await modal.getByRole('button', { name: 'Show original estimate', exact: true }).click();
  await expect(z).toBeDisabled();
  await expect(modal.getByLabel('Preview object name')).toBeDisabled();
  await expect(
    modal.getByRole('checkbox', { name: 'Include Photo keyboard in scene' }),
  ).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeDisabled();
  await expect(modal.getByRole('button', { name: 'Fit small gaps', exact: true })).toBeDisabled();
  await expect(
    modal.getByText('Original estimate · rotate to compare', { exact: true }),
  ).toBeVisible();
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: 'Show reviewed layout', exact: true }).click();
  await expect(z).toHaveValue(fittedZ);
  await modal.getByRole('button', { name: 'Undo automatic adjustments', exact: true }).click();
  await expect(z).toHaveValue('0.7');
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeDisabled();
  await expect(
    modal.getByRole('button', { name: 'Undo automatic adjustments', exact: true }),
  ).toBeDisabled();
  await modal.getByRole('button', { name: 'Fit small gaps', exact: true }).click();
  await expect(z).toHaveValue(fittedZ);
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: 'Confirm and apply scene' }).click();
  // Saving waits for the cross-tab Web Lock; a click can finish before the write.
  await expect(modal).toBeHidden();
  const applied = (await saved(page))!;
  expect(applied.objects.find((item) => item.kind === 'wrist-rest')?.visual.scale.x).toBe(0.9);
  expect(JSON.stringify(applied)).not.toMatch(
    /supportSource|originalDraft|repairSummary|adjustments|seed/,
  );
});

test('manual position, rotation, size and support survive automatic repair and undo', async ({
  page,
}) => {
  const modal = await openPreview(page, gapProposal());
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo keyboard · Keyboard' });
  const x = modal.getByRole('slider', { name: 'Preview object left / right position' });
  const yaw = modal.getByRole('slider', { name: 'Preview object rotation' });
  const scale = modal.getByLabel('Preview object width scale');
  // Move clear of the wrist rest before rotating; ordinary editing still rejects real overlap.
  await x.fill('-1.5');
  await expect(x).toHaveValue('-1.5');
  await yaw.fill('4');
  await expect(yaw).toHaveValue('4');
  await scale.fill('0.95');
  await scale.press('Enter');
  await modal.getByLabel('Preview intended support').selectOption('floor');
  for (const name of ['Lock position', 'Lock rotation', 'Lock size', 'Lock support']) {
    await expect(modal.getByRole('checkbox', { name, exact: true })).toBeChecked();
  }
  await expect(modal.getByRole('region', { name: 'Selected object review issues' })).toContainText(
    'locked',
  );
  for (const name of ['Fit small gaps', 'Undo automatic adjustments']) {
    await modal.getByRole('button', { name, exact: true }).click();
    await expect(x).toHaveValue('-1.5');
    await expect(yaw).toHaveValue('4');
    await expect(scale).toHaveValue('0.95');
    await expect(modal.getByLabel('Preview intended support')).toHaveValue('floor');
    await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeDisabled();
  }
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: 'Discard preview' }).click();
});

test('small-screen placement comparison and locks preserve the primary 3D scene', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const modal = await openPreview(page, gapProposal());
  const scene = modal.locator('.preview-scene');
  const bounds = await scene.boundingBox();
  expect(bounds?.height).toBeGreaterThanOrEqual(260);
  await modal.getByRole('button', { name: 'Show original estimate', exact: true }).click();
  await modal.getByRole('button', { name: 'Show reviewed layout', exact: true }).click();
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Photo keyboard · Keyboard' });
  await modal.getByRole('checkbox', { name: 'Lock position', exact: true }).check();
  await modal.getByRole('button', { name: 'Fit small gaps', exact: true }).click();
  await expect(modal.getByRole('checkbox', { name: 'Lock position', exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scene.scrollIntoViewIfNeeded();
  await testInfo.attach('mobile-photo-review', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await modal.getByRole('button', { name: 'Discard preview' }).click();
  expect(await saved(page)).toBeNull();
});

test('editing a support in the inspector updates only unlocked children and preserves the edit on undo', async ({
  page,
}) => {
  const fixture: SceneProposal = {
    message: 'Synthetic support edit regression.',
    objects: [
      candidate('desk', 'desk', 'Photo desk', 0, 0, 0),
      {
        ...candidate('stand', 'laptop-stand', 'Photo stand', 2, -0.1, 2.4835),
        scale: { x: 0.8, y: 0.8, z: 0.8 },
      },
      {
        ...candidate('laptop', 'laptop', 'Photo laptop', 2, -0.1, 2.8128),
        scale: { x: 0.95, y: 0.9, z: 0.95 },
        supportId: 'stand',
      },
    ],
  };
  const modal = await openPreview(page, fixture);
  const select = modal.getByLabel('Preview object', { exact: true });
  const height = modal.getByRole('slider', { name: 'Preview object height position' });
  await select.selectOption({ label: 'Photo laptop · Laptop' });
  const initialHeight = Number(await height.inputValue());
  await select.selectOption({ label: 'Photo stand · Laptop stand' });
  const scale = modal.getByLabel('Preview object height scale');
  await scale.fill('1.2');
  await scale.press('Enter');
  await expect(scale).toHaveValue('1.2');
  await expect(modal.getByRole('checkbox', { name: 'Lock size', exact: true })).toBeChecked();
  await select.selectOption({ label: 'Photo laptop · Laptop' });
  const fittedHeight = await height.inputValue();
  expect(Number(fittedHeight)).toBeGreaterThan(initialHeight + 0.15);
  await expect(
    modal.getByRole('checkbox', { name: 'Lock position', exact: true }),
  ).not.toBeChecked();
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
  await modal.getByRole('button', { name: 'Undo automatic adjustments', exact: true }).click();
  await expect(height).toHaveValue(fittedHeight);
  await select.selectOption({ label: 'Photo stand · Laptop stand' });
  await expect(scale).toHaveValue('1.2');
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
  await select.selectOption({ label: 'Photo laptop · Laptop' });
  await modal.getByRole('checkbox', { name: 'Lock position', exact: true }).check();
  await select.selectOption({ label: 'Photo stand · Laptop stand' });
  await scale.fill('1.4');
  await scale.press('Enter');
  await expect(scale).toHaveValue('1.4');
  await select.selectOption({ label: 'Photo laptop · Laptop' });
  await expect(height).toHaveValue(fittedHeight);
  await expect(modal.getByRole('region', { name: 'Selected object review issues' })).toContainText(
    'locked',
  );
  await modal.getByRole('button', { name: 'Fit small gaps', exact: true }).click();
  await expect(height).toHaveValue(fittedHeight);
  await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeDisabled();
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: 'Discard preview' }).click();
});

test('Place on surface moves a support before checking its child and preserves a locked child for review', async ({
  page,
}) => {
  const fixture: SceneProposal = {
    message: 'Synthetic parent surface placement with a thin mat.',
    objects: [
      candidate('desk', 'desk', 'Photo desk', 0, 0, 0),
      {
        ...candidate('mat', 'mat', 'Photo mat', 2, -0.1, 2.4835),
        scale: { x: 0.7, y: 1, z: 1.5 },
      },
      {
        ...candidate('stand', 'laptop-stand', 'Photo stand', 2, -0.1, 2.4835),
        scale: { x: 0.8, y: 0.8, z: 0.8 },
      },
      {
        ...candidate('laptop', 'laptop', 'Photo laptop', 2, -0.1, 2.8128),
        scale: { x: 0.95, y: 0.9, z: 0.95 },
        supportId: 'stand',
      },
    ],
  };
  for (const lockChild of [false, true]) {
    const modal = await openPreview(page, fixture);
    // Restore the model's intersecting estimates so the manual surface path,
    // rather than the initial automatic fitter, must resolve the parent/child.
    await modal.getByRole('button', { name: 'Undo automatic adjustments', exact: true }).click();
    const select = modal.getByLabel('Preview object', { exact: true });
    const height = modal.getByRole('slider', { name: 'Preview object height position' });
    await select.selectOption({ label: 'Photo laptop · Laptop' });
    const originalHeight = await height.inputValue();
    if (lockChild)
      await modal.getByRole('checkbox', { name: 'Lock position', exact: true }).check();
    await select.selectOption({ label: 'Photo stand · Laptop stand' });
    await modal.getByLabel('Preview object surface', { exact: true }).selectOption('photo-mat');
    await modal.getByRole('button', { name: 'Place on surface', exact: true }).click();
    await expect(modal.getByLabel('Preview intended support')).toHaveValue('photo-mat');
    await expect(modal.getByRole('checkbox', { name: 'Lock support', exact: true })).toBeChecked();
    await select.selectOption({ label: 'Photo laptop · Laptop' });
    if (lockChild) {
      await expect(height).toHaveValue(originalHeight);
      await expect(
        modal.getByRole('region', { name: 'Selected object review issues' }),
      ).toContainText('locked');
      await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeDisabled();
    } else {
      expect(Number(await height.inputValue())).toBeGreaterThan(Number(originalHeight) + 0.02);
      await expect(
        modal.getByRole('checkbox', { name: 'Lock position', exact: true }),
      ).not.toBeChecked();
      await expect(modal.getByRole('button', { name: 'Confirm and apply scene' })).toBeEnabled();
    }
    expect(await saved(page)).toBeNull();
    await modal.getByRole('button', { name: 'Discard preview' }).click();
    expect(await saved(page)).toBeNull();
  }
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

test('the object picker lists every found object before the 3D review', async ({ page }) => {
  const base = createDemoWorkspace();
  const savedMonitor = base.devices.find((item) => item.id === 'monitor-left')!;
  savedMonitor.source = 'user-reported';
  const fixture = proposal();
  fixture.objects.find((item) => item.kind === 'monitor')!.deviceId = savedMonitor.id;
  await seed(page, base);
  const picker = await openPicker(page, fixture);
  await expect(page.getByRole('dialog', { name: 'Review your desk scene' })).toHaveCount(0);
  await expect(picker).toContainText(
    'Meta found 3 objects in your photo. Uncheck anything you do not want in your desk scene. You can still change this in the next step.',
  );
  await expect(picker.getByRole('img', { name: 'Selected desk photo' })).toBeVisible();
  for (const name of ['Photo desk', 'Photo monitor', 'Photo plant']) {
    await expect(picker.getByRole('checkbox', { name: new RegExp(name) })).toBeChecked();
  }
  await expect(picker.getByText('Desk', { exact: true })).toBeVisible();
  await expect(picker.getByText('Monitor', { exact: true })).toBeVisible();
  await expect(picker.getByText('Plant', { exact: true })).toBeVisible();
  await expect(picker.getByText('Updates your saved record', { exact: true })).toBeVisible();
  const plant = picker.getByRole('checkbox', { name: /Photo plant/ });
  await plant.focus();
  await expect(plant).toBeFocused();
  await page.keyboard.press('Space');
  await expect(plant).not.toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await saved(page)).toEqual(base);
});

test('an unchecked object stays excluded, can be restored, and is absent after apply', async ({
  page,
}) => {
  const picker = await openPicker(page);
  await picker.getByRole('checkbox', { name: /Photo plant/ }).uncheck();
  await picker.getByRole('button', { name: 'Continue with 2 objects', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('desk-canvas')).toBeVisible();
  const plant = modal.getByRole('checkbox', { name: 'Include Photo plant in scene' });
  await expect(plant).not.toBeChecked();
  expect(await saved(page)).toBeNull();
  await modal.getByRole('button', { name: /Photo plant.*Excluded/ }).click();
  await expect(modal.getByRole('region', { name: 'Excluded preview object' })).toBeVisible();
  await modal.getByRole('button', { name: 'Restore to preview' }).click();
  await expect(plant).toBeChecked();
  expect(await saved(page)).toBeNull();
  await plant.uncheck();
  const apply = modal.getByRole('button', { name: 'Confirm and apply scene' });
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(modal).toBeHidden();
  const applied = (await saved(page))!;
  expect([...applied.objects, ...applied.devices].some((item) => item.name === 'Photo plant')).toBe(
    false,
  );
  expect(applied.objects.some((item) => item.name === 'Photo desk')).toBe(true);
  expect(applied.devices.some((item) => item.name === 'Photo monitor')).toBe(true);
});

test('clear all disables continuing with the photo results', async ({ page }) => {
  const picker = await openPicker(page);
  const clear = picker.getByRole('button', { name: 'Clear all', exact: true });
  await clear.focus();
  await expect(clear).toBeFocused();
  await page.keyboard.press('Enter');
  const continueButton = picker.getByRole('button', {
    name: 'Continue with 0 objects',
    exact: true,
  });
  await expect(continueButton).toBeDisabled();
  for (const name of ['Photo desk', 'Photo monitor', 'Photo plant']) {
    await expect(picker.getByRole('checkbox', { name: new RegExp(name) })).not.toBeChecked();
  }
  const select = picker.getByRole('button', { name: 'Select all', exact: true });
  await select.focus();
  await page.keyboard.press('Enter');
  await expect(
    picker.getByRole('button', { name: 'Continue with 3 objects', exact: true }),
  ).toBeEnabled();
});

test('discard photo results keeps the saved workspace and does not send another photo request', async ({
  page,
}) => {
  let calls = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/photo') calls += 1;
  });
  const base = createDemoWorkspace();
  await seed(page, base);
  const notes = 'The closed laptop is my work computer.';
  const picker = await openPicker(page, proposal(), undefined, notes);
  expect(calls).toBe(1);
  await picker.getByRole('button', { name: 'Discard photo results', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Review your desk scene' })).toHaveCount(0);
  expect(calls).toBe(1);
  expect(await saved(page)).toEqual(base);
  await expect(page.getByAltText('Desk reference photo selected by the user')).toBeVisible();
  await expect(page.getByLabel('Device and connection notes')).toHaveValue(notes);
  await expect(page.getByRole('checkbox', { name: /I agree to send this photo/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Create scene preview with Meta' })).toBeEnabled();
});

test('the object picker scrolls its list without horizontal overflow on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = proposal();
  for (let index = 0; index < 10; index += 1) {
    fixture.objects.push(
      candidate(
        `mug-${index}`,
        'mug',
        `Photo mug ${index + 1}`,
        -1.8 + (index % 5) * 0.9,
        index < 5 ? 0.35 : 1.15,
      ),
    );
  }
  const picker = await openPicker(page, fixture);
  const list = picker.getByRole('list', { name: 'Objects found in the photo' });
  await expect(list.getByRole('checkbox')).toHaveCount(fixture.objects.length);
  expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(
    true,
  );
  const continueButton = picker.getByRole('button', { name: /^Continue with \d+ objects?$/ });
  await expect(continueButton).toBeInViewport();
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(continueButton).toBeInViewport();
  await expect(picker.getByRole('checkbox', { name: /Photo mug 10/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await picker.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
});

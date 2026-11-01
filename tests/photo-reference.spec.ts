import { test, expect, type Page } from '@playwright/test';
import { createDemoWorkspace } from '../src/domain/workspace';
import {
  buildScenePreview,
  type SceneProposal,
  type SceneProposalItem,
} from '../src/domain/sceneProposal';
import {
  getPhotoReferenceWorldCorners,
  projectPhotoItem,
  projectPhotoPoint,
  type PhotoCamera,
  type PhotoDeskCorners,
  type PhotoReference,
} from '../src/domain/photoProjection';

const storageKey = 'desktwin.workspace.v1';
const cornerNames = ['backLeft', 'backRight', 'frontRight', 'frontLeft'] as const;
test.setTimeout(60_000);
type FixtureOptions = { modelReference?: boolean; evidence?: 'mixed' | 'complete' | 'none' };
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

function fixtureItem(
  id: string,
  kind: SceneProposalItem['kind'],
  name: string,
  x: number,
  z: number,
  y = 2.51,
): SceneProposalItem {
  return {
    id,
    deviceId: null,
    kind,
    name,
    placement: { x, y, z, rotation: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#829575',
    parts: [],
    note: 'Synthetic local browser fixture, not a real photo observation.',
    supportId: kind === 'desk' ? 'floor' : 'desk',
  };
}

function photoFixture({ modelReference = true, evidence = 'mixed' }: FixtureOptions = {}) {
  const proposal: SceneProposal = {
    message: 'Synthetic local automatic photo matching fixture.',
    objects: [
      fixtureItem('desk', 'desk', 'Reference desk', 0, 0, 0),
      fixtureItem('monitor', 'monitor', 'Reference monitor', -1.3, -0.65),
      fixtureItem('plant', 'plant', 'Reference plant', 2.3, 0.7),
      ...(evidence === 'complete'
        ? [
            fixtureItem('keyboard', 'keyboard', 'Reference keyboard', -0.9, 0.65),
            fixtureItem('lamp', 'lamp', 'Reference lamp', 1, -0.65),
          ]
        : []),
    ],
  };
  const preview = buildScenePreview(createDemoWorkspace(), proposal);
  const reference: PhotoReference = {
    objectId: preview.candidates.find((candidate) => candidate.kind === 'desk')!.sceneId,
    surface: 'tabletop',
    corners: {} as PhotoDeskCorners,
    aspect: 5 / 3,
    source: 'model',
  };
  const camera: PhotoCamera = {
    position: { x: 3, y: 8, z: 10 },
    target: { x: 0, y: 2, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    fov: 45,
    aspect: reference.aspect,
  };
  reference.corners = Object.fromEntries(
    getPhotoReferenceWorldCorners(preview.draft, reference).map((point, index) => [
      cornerNames[index],
      projectPhotoPoint(point, camera)!,
    ]),
  ) as PhotoDeskCorners;
  for (const item of proposal.objects) {
    const sceneId = preview.candidates.find(
      (candidate) => candidate.proposalId === item.id,
    )!.sceneId;
    const target = structuredClone(
      [...preview.draft.objects, ...preview.draft.devices].find((entry) => entry.id === sceneId)!,
    );
    if (item.kind === 'monitor') target.placement.x = -0.4;
    const projected = projectPhotoItem(target, camera)!;
    item.imageRegion = evidence === 'none' ? null : projected.region;
    item.imageRegionVisibility =
      evidence === 'complete' || item.kind === 'monitor'
        ? 'complete'
        : item.kind === 'plant'
          ? 'partial'
          : 'unknown';
    item.imageAnchor = evidence !== 'none' && item.kind === 'monitor' ? projected.contact : null;
  }
  if (modelReference)
    proposal.photoReference = { objectId: 'desk', surface: 'tabletop', corners: reference.corners };
  return { proposal, reference };
}

async function stored(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), storageKey);
}

async function openPreview(page: Page, options: FixtureOptions = {}) {
  const fixture = photoFixture(options);
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'local-fixture-only', photoAvailable: true } }),
  );
  let calls = 0;
  await page.route('**/api/photo', (route) => {
    calls++;
    return route.fulfill({ json: { mode: 'meta', ...fixture.proposal } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate((corners) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 540;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#5e6c72';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#bda085';
    context.beginPath();
    context.moveTo(corners.backLeft.x * canvas.width, corners.backLeft.y * canvas.height);
    context.lineTo(corners.backRight.x * canvas.width, corners.backRight.y * canvas.height);
    context.lineTo(corners.frontRight.x * canvas.width, corners.frontRight.y * canvas.height);
    context.lineTo(corners.frontLeft.x * canvas.width, corners.frontLeft.y * canvas.height);
    context.closePath();
    context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  }, fixture.reference.corners);
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'automatic-local-reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  expect(calls).toBe(0);
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  const modal = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(modal).toBeVisible();
  await modal.getByText('Compare with your photo', { exact: false }).click();
  const panel = modal.getByLabel('Automatic photo comparison', { exact: true });
  await expect(panel.getByAltText('Source photo for automatic scene comparison')).toBeVisible();
  await expect(modal.getByTestId('desk-canvas')).toBeVisible();
  return { ...fixture, modal, panel, calls: () => calls };
}

test('photo preview matches automatically and compares actual shapes without calibration controls or saving', async ({
  page,
}, testInfo) => {
  const { modal, panel, calls } = await openPreview(page);
  const projection = panel.getByRole('img', {
    name: 'Projected preview shapes in the source photo view',
  });
  await expect(projection).toBeVisible();
  await expect(panel).toContainText('Automatic match · review required');
  expect(await projection.locator('polygon').count()).toBeGreaterThan(3);
  await expect(panel.locator('input, select')).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /mark|corner|field of view/i })).toHaveCount(0);
  const image = (await panel
    .getByAltText('Source photo for automatic scene comparison')
    .boundingBox())!;
  expect(image.width / image.height).toBeCloseTo(5 / 3, 2);
  const compare = panel.getByRole('button', { name: 'Compare scene shapes', exact: true });
  await compare.click();
  await expect(projection).toHaveCount(0);
  await expect(compare).toHaveAttribute('aria-pressed', 'false');
  await compare.click();
  await expect(projection).toBeVisible();
  await modal.getByRole('button', { name: 'Show original estimate', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Match photo again', exact: true }),
  ).toBeDisabled();
  await expect(panel.getByRole('button', { name: 'Undo photo match', exact: true })).toBeDisabled();
  await modal.getByRole('button', { name: 'Show reviewed layout', exact: true }).click();
  expect(await stored(page)).toBeNull();
  expect(calls()).toBe(1);
  await panel.locator('.photo-alignment-content').evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({ path: testInfo.outputPath('automatic-photo-comparison.png') });
  await modal.getByRole('button', { name: 'Discard preview', exact: true }).click();
  expect(await stored(page)).toBeNull();
});

test('undo preserves later edits and stays undone through review rerenders', async ({ page }) => {
  const { modal, panel, calls } = await openPreview(page);
  await expect(panel.getByRole('button', { name: 'Undo photo match', exact: true })).toBeEnabled();
  await modal
    .getByLabel('Preview object', { exact: true })
    .selectOption({ label: 'Reference monitor · Monitor' });
  const position = modal.getByLabel('Preview object left / right position', { exact: true });
  await expect(position).not.toHaveValue('-1.3');
  await modal.getByLabel('Preview object name', { exact: true }).fill('My reviewed monitor');
  await modal.getByLabel('Preview object name', { exact: true }).press('Enter');
  const width = modal.getByLabel('Preview object width scale', { exact: true });
  await width.fill('0.9');
  await width.press('Enter');
  await expect(panel).toContainText('The layout changed after matching.');
  await panel.getByRole('button', { name: 'Undo photo match', exact: true }).click();
  await expect(position).toHaveValue('-1.3');
  await expect(width).toHaveValue('0.9');
  await expect(
    panel.getByText('Photo match undone. Your later edits remain in the preview.', { exact: true }),
  ).toBeVisible();
  await modal.getByLabel('Preview object name', { exact: true }).fill('Still my reviewed monitor');
  await modal.getByLabel('Preview object name', { exact: true }).press('Enter');
  await expect(position).toHaveValue('-1.3');
  await expect(panel.getByRole('button', { name: 'Undo photo match', exact: true })).toBeDisabled();
  await expect(
    panel.getByRole('img', { name: 'Projected preview shapes in the source photo view' }),
  ).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  expect(calls()).toBe(1);
});

test('insufficient photo evidence keeps the editable preview and offers local retry or another photo', async ({
  page,
}) => {
  const { modal, panel, calls } = await openPreview(page, {
    modelReference: false,
    evidence: 'none',
  });
  await expect(
    panel.getByText('We could not confidently match this photo.', { exact: true }),
  ).toBeVisible();
  await expect(modal.getByTestId('desk-canvas')).toBeVisible();
  await expect(panel.locator('input, select')).toHaveCount(0);
  await modal.getByLabel('Preview object name', { exact: true }).fill('My editable desk');
  await modal.getByLabel('Preview object name', { exact: true }).press('Enter');
  await panel.getByRole('button', { name: 'Match photo again', exact: true }).click();
  await expect(modal.getByLabel('Preview object name', { exact: true })).toHaveValue(
    'My editable desk',
  );
  await expect(
    panel.getByText('We could not confidently match this photo.', { exact: true }),
  ).toBeVisible();
  expect(await stored(page)).toBeNull();
  expect(calls()).toBe(1);
  await panel.getByRole('button', { name: 'Keep current preview', exact: true }).click();
  await expect(panel).not.toHaveAttribute('open');
  await panel.locator('summary').click();
  await panel.getByRole('button', { name: 'Choose another photo', exact: true }).click();
  await expect(modal).not.toBeVisible();
  await expect(page.getByLabel('Desk photo file')).toBeAttached();
  expect(await stored(page)).toBeNull();
  expect(calls()).toBe(1);
});

test('complete region estimates can be matched without a provider corner reference', async ({
  page,
}) => {
  const { panel, calls } = await openPreview(page, { modelReference: false, evidence: 'complete' });
  await expect(
    panel.getByRole('img', { name: 'Projected preview shapes in the source photo view' }),
  ).toBeVisible();
  await expect(panel.locator('input, select')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Match photo again', exact: true }).click();
  await expect(
    panel.getByRole('img', { name: 'Projected preview shapes in the source photo view' }),
  ).toBeVisible();
  expect(await stored(page)).toBeNull();
  expect(calls()).toBe(1);
});

test('automatic photo comparison fits a mobile viewport and saves only after confirmation', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { modal, panel } = await openPreview(page);
  await expect(
    panel.getByRole('img', { name: 'Projected preview shapes in the source photo view' }),
  ).toBeVisible();
  await expect(panel.locator('input, select')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
  expect(await modal.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
  expect(await stored(page)).toBeNull();
  await panel.locator('summary').evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: testInfo.outputPath('mobile-automatic-photo-comparison.png') });
  await modal.getByRole('button', { name: 'Confirm and apply scene', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const saved = await stored(page);
  expect(saved).not.toBeNull();
  expect(saved).not.toMatch(/data:image|photoAlignment|photoReference|imageRegion|imageAnchor/);
});

import { expect, test } from '@playwright/test';
import fixture from './fixtures/photo-scene-19-sanitized.json' with { type: 'json' };
import { createDemoWorkspace, type Workspace } from '../src/domain/workspace';

const storageKey = 'desktwin.workspace.v1';

test('the complete local photo response is repaired automatically, repeated and undone before explicit saving', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let photoRequests = 0;
  const workspace: Workspace = {
    ...createDemoWorkspace(),
    devices: [],
    objects: [],
    connections: [],
    diagnoses: [],
    history: [],
  };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey,
    value: workspace,
  });
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'local-fixture-only', photoAvailable: true } }),
  );
  // This response and the uploaded PNG are synthetic. No provider request leaves the browser.
  await page.route('**/api/photo', (route) => {
    photoRequests++;
    return route.fulfill({ json: { mode: 'meta', ...fixture.proposal } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 90;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#88917a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-full-scene.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await page.getByRole('checkbox', { name: /I agree to send this photo/ }).check();
  await page.getByRole('button', { name: 'Create scene preview with Meta' }).click();
  await page.getByRole('button', { name: /^Continue with \d+ objects?$/ }).click();
  const modal = page.getByRole('dialog', { name: 'Review your desk scene' });
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('desk-canvas')).toBeVisible();
  await expect(modal.getByRole('checkbox', { name: /^Include / })).toHaveCount(19);
  const comparison = modal.getByLabel('Automatic photo comparison', { exact: true });
  await comparison.getByText('Compare with your photo', { exact: false }).click();
  const apply = modal.getByRole('button', { name: 'Confirm and apply scene' });
  await expect(comparison).toContainText('Automatic match · review required');
  await expect(apply).toBeEnabled();
  await expect(
    comparison.getByRole('spinbutton', { name: /corner|camera|field of view/i }),
  ).toHaveCount(0);
  const overlay = comparison.getByRole('img', {
    name: 'Projected preview shapes in the source photo view',
  });
  await expect(overlay.locator('g[data-scene-id]')).toHaveCount(19);
  const projected = () =>
    overlay.locator('g[data-scene-id]').evaluateAll((groups) =>
      groups.map((group) => ({
        id: group.getAttribute('data-scene-id'),
        geometry: group.innerHTML,
      })),
    );
  const first = await projected();
  await comparison.getByRole('button', { name: 'Match photo again', exact: true }).click();
  await expect(apply).toBeEnabled();
  await expect.poll(projected).toEqual(first);
  expect(photoRequests).toBe(1);
  const savedBefore = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    storageKey,
  );
  expect(savedBefore).toEqual(workspace);

  await comparison.getByRole('button', { name: 'Undo photo match', exact: true }).click();
  await expect(comparison).toContainText('Photo match undone');
  await expect(apply).toBeDisabled();
  await expect(overlay).toHaveCount(0);
  await comparison.getByRole('button', { name: 'Match photo again', exact: true }).click();
  await expect(apply).toBeEnabled();
  await expect.poll(projected).toEqual(first);
  expect(photoRequests).toBe(1);

  await apply.click();
  await expect(modal).toBeHidden();
  await expect
    .poll(async () => {
      const saved = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        storageKey,
      );
      return saved.objects.length + saved.devices.length;
    })
    .toBe(19);
  expect(errors).toEqual([]);
});

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Created from a synthetic 64x32 PNG (red left, blue right), encoded with macOS sips,
// with its existing irot byte set to 3 (clockwise 90 degrees). No camera/user image.
const heicFixture = readFileSync(new URL('./fixtures/synthetic-rotated.heic', import.meta.url));
test.setTimeout(60_000);

async function openPanel(page: Page) {
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { mode: 'meta', model: 'mock-only', photoAvailable: true } }),
  );
  // Photo selection must never fall through to a real integration, even if a regression sends it.
  await page.route('**/api/photo', (route) => route.abort('blockedbyclient'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
}
async function syntheticPng(page: Page, color: string, width = 64, height = 32) {
  return Buffer.from(
    await page.evaluate(
      ({ color, width, height }) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.fillStyle = color;
        context.fillRect(0, 0, width, height);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { color, width, height },
    ),
    'base64',
  );
}
async function previewPixels(page: Page) {
  const preview = page.getByAltText('Desk reference photo selected by the user');
  await expect(preview).toBeVisible();
  return preview.evaluate((element) => {
    const image = element as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return {
      src: image.src,
      width: image.naturalWidth,
      height: image.naturalHeight,
      first: Array.from(context.getImageData(4, 4, 1, 1).data),
      last: Array.from(context.getImageData(canvas.width - 5, canvas.height - 5, 1, 1).data),
    };
  });
}

test('HEIC is decoded locally with orientation, stripped to JPEG, and never sent on selection', async ({
  page,
}) => {
  const outgoingPhotos: string[] = [];
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/photo')) outgoingPhotos.push(request.url());
    if (/^https?:/.test(request.url()) && new URL(request.url()).hostname !== '127.0.0.1')
      remoteRequests.push(request.url());
  });
  await openPanel(page);
  await expect(page.getByLabel('Desk photo file')).toHaveAttribute('accept', /\.heic,\.heif/);
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'synthetic-rotated.HEIC',
    mimeType: 'application/octet-stream',
    buffer: heicFixture,
  });
  const image = await previewPixels(page);
  expect([image.width, image.height]).toEqual([32, 64]);
  expect(image.first[0]).toBeGreaterThan(200);
  expect(image.first[2]).toBeLessThan(70);
  expect(image.last[2]).toBeGreaterThan(200);
  expect(image.last[0]).toBeLessThan(70);
  expect(image.src).toMatch(/^data:image\/jpeg;base64,/);
  expect(image.src.length).toBeLessThanOrEqual(1_900_000);
  const jpeg = Buffer.from(image.src.split(',')[1], 'base64');
  expect(jpeg.includes(Buffer.from('Exif'))).toBe(false);
  expect(jpeg.includes(Buffer.from('ftyp'))).toBe(false);
  await expect(
    page.getByRole('checkbox', { name: /I agree to send this photo/ }),
  ).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Create scene preview with Meta' })).toBeDisabled();
  expect(outgoingPhotos).toEqual([]);
  expect(remoteRequests).toEqual([]);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain('data:image');
  await page.reload();
  await page.getByRole('button', { name: 'Desk photo', exact: true }).click();
  await expect(page.getByAltText('Desk reference photo selected by the user')).toHaveCount(0);
});

test('native JPEG EXIF orientation is applied before resize and original metadata is removed', async ({
  page,
}) => {
  await openPanel(page);
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2400;
    canvas.height = 1200;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#ed2424';
    context.fillRect(0, 0, 1200, 1200);
    context.fillStyle = '#243aed';
    context.fillRect(1200, 0, 1200, 1200);
    return canvas.toDataURL('image/jpeg').split(',')[1];
  });
  const original = Buffer.from(encoded, 'base64');
  // Minimal little-endian EXIF IFD with Orientation=6, a clockwise quarter turn.
  const exif = Buffer.from([
    0x45, 0x78, 0x69, 0x66, 0, 0, 0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0,
    6, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const marker = Buffer.from([0xff, 0xe1, 0, exif.length + 2]);
  const oriented = Buffer.concat([original.subarray(0, 2), marker, exif, original.subarray(2)]);
  await page
    .getByLabel('Desk photo file')
    .setInputFiles({ name: 'synthetic-oriented.jpg', mimeType: 'image/jpeg', buffer: oriented });
  const image = await previewPixels(page);
  expect([image.width, image.height]).toEqual([640, 1280]);
  expect(image.first[0]).toBeGreaterThan(200);
  expect(image.last[2]).toBeGreaterThan(200);
  expect(Buffer.from(image.src.split(',')[1], 'base64').includes(Buffer.from('Exif'))).toBe(false);
});

test('malformed and oversized HEIC files fail clearly without leaving a stale preview', async ({
  page,
}) => {
  await openPanel(page);
  for (const file of [
    { name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('not a HEIC file') },
    { name: 'truncated.heic', mimeType: 'image/heic', buffer: heicFixture.subarray(0, 36) },
    { name: 'too-large.heic', mimeType: 'image/heic', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) },
  ]) {
    await page.getByLabel('Desk photo file').setInputFiles(file);
    await expect(page.getByRole('alert')).toHaveText(/invalid|decoded locally|up to 8 MB/i);
    await expect(page.getByAltText('Desk reference photo selected by the user')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose a photo' })).toBeEnabled();
  }
});

test('canceled native decoding cannot overwrite a newer selected photo', async ({ page }) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    Object.defineProperty(window, 'createImageBitmap', {
      value: (source: ImageBitmapSource, options?: ImageBitmapOptions) => {
        if (source instanceof File && source.name === 'late.png')
          return new Promise<ImageBitmap>((resolve) => {
            (window as unknown as { releaseLatePhoto: () => Promise<void> }).releaseLatePhoto =
              async () => {
                resolve(await decode(source, options));
              };
          });
        return decode(source, options);
      },
    });
  });
  await openPanel(page);
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'late.png',
    mimeType: 'image/png',
    buffer: await syntheticPng(page, '#ff0000'),
  });
  await page.getByRole('button', { name: 'Cancel photo preparation' }).click();
  await page.getByLabel('Desk photo file').setInputFiles({
    name: 'new.png',
    mimeType: 'image/png',
    buffer: await syntheticPng(page, '#00dd00'),
  });
  const selected = await previewPixels(page);
  await page.evaluate(() =>
    (window as unknown as { releaseLatePhoto: () => Promise<void> }).releaseLatePhoto(),
  );
  await expect(page.getByAltText('Desk reference photo selected by the user')).toHaveAttribute(
    'src',
    selected.src,
  );
  expect((await previewPixels(page)).first[1]).toBeGreaterThan(190);
});

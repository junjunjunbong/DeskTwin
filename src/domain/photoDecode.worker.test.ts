import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = readFileSync(
  new URL('../../tests/fixtures/synthetic-rotated.heic', import.meta.url),
);
let scope: {
  onmessage?: (event: { data: { buffer: ArrayBuffer } }) => Promise<void>;
  postMessage: ReturnType<typeof vi.fn>;
};
let imageData: { data: Uint8ClampedArray; width: number; height: number } | undefined;
const createBitmap = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  scope = { postMessage: vi.fn() };
  imageData = undefined;
  createBitmap.mockReset().mockResolvedValue({ width: 32, height: 64, close: vi.fn() });
  vi.stubGlobal('self', scope);
  vi.stubGlobal('createImageBitmap', createBitmap);
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {
        imageData = this;
      }
    },
  );
  await import('./photoDecode.worker');
});
afterEach(() => vi.unstubAllGlobals());
const buffer = (bytes: Uint8Array) => new Uint8Array(bytes).buffer;

describe('real local HEIF decoder worker', () => {
  it('decodes the synthetic primary image with rotation and padded row strides applied', async () => {
    await scope.onmessage?.({ data: { buffer: buffer(fixture) } });
    expect(scope.postMessage).toHaveBeenCalledOnce();
    expect(scope.postMessage.mock.calls[0][0]).toHaveProperty('bitmap');
    expect(imageData).toMatchObject({ width: 32, height: 64 });
    expect(imageData!.data).toHaveLength(32 * 64 * 4);
    // The self-generated source had red on its left and blue on its right; irot=3 turns it clockwise.
    expect([...imageData!.data.slice(0, 3)]).toEqual([235, 35, 35]);
    const lastPixel = [...imageData!.data.slice(-4)];
    expect(lastPixel[2]).toBeGreaterThan(200);
    expect(lastPixel[0]).toBeLessThan(60);
    expect(lastPixel[3]).toBe(255);
    expect(createBitmap).toHaveBeenCalledWith(expect.anything(), {
      resizeWidth: 32,
      resizeHeight: 64,
      resizeQuality: 'high',
    });
  });

  it('rejects excessive declared dimensions before allocating ImageData or decoding pixels', async () => {
    const excessive = new Uint8Array(fixture);
    const ispe = Buffer.from(excessive).indexOf('ispe');
    new DataView(excessive.buffer).setUint32(ispe + 8, 20_000);
    await scope.onmessage?.({ data: { buffer: excessive.buffer } });
    expect(scope.postMessage.mock.calls[0][0]).toEqual({
      error: expect.stringContaining('exceeds 64 megapixels'),
    });
    expect(imageData).toBeUndefined();
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('rejects malformed containers and oversized compressed bytes without producing pixels', async () => {
    for (const bytes of [fixture.subarray(0, 36), new Uint8Array(8 * 1024 * 1024 + 1)]) {
      await scope.onmessage?.({ data: { buffer: buffer(bytes) } });
      expect(scope.postMessage.mock.lastCall?.[0]).toHaveProperty('error');
    }
    expect(imageData).toBeUndefined();
    expect(createBitmap).not.toHaveBeenCalled();
  });
});

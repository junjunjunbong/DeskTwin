import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PHOTO_DECODE_TIMEOUT_MS,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_DATA_URL,
  isHeifPhoto,
  preparePhoto,
  validatePhotoInput,
} from './photoInput';

const fixture = readFileSync(
  new URL('../../tests/fixtures/synthetic-rotated.heic', import.meta.url),
);
const heifFile = (name = 'synthetic.heic', type = 'image/heic') =>
  new File([fixture], name, { type });
const bitmap = (width = 8, height = 4) => ({ width, height, close: vi.fn() });

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
class UndecodableImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    if (value) queueMicrotask(() => this.onerror?.());
  }
}

let canvas: {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  toDataURL: ReturnType<typeof vi.fn>;
};
let context: {
  fillStyle: string;
  fillRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  FakeWorker.instances = [];
  context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,/9j/test'),
  };
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap()),
  );
  vi.stubGlobal('Image', UndecodableImage);
  vi.stubGlobal('Worker', FakeWorker);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function startWorker(signal?: AbortSignal) {
  vi.mocked(createImageBitmap).mockRejectedValue(new Error('No native HEIC decoder'));
  const preparing = preparePhoto(heifFile(), signal);
  await vi.waitFor(() => expect(FakeWorker.instances[0]?.postMessage).toHaveBeenCalled());
  return { preparing, worker: FakeWorker.instances[0] };
}

describe('local photo preparation', () => {
  it('accepts iPhone extensions with missing or generic MIME types after verifying the container', async () => {
    expect(isHeifPhoto({ name: 'IMG_1234.HEIC', type: '' })).toBe(true);
    await expect(validatePhotoInput(heifFile('IMG_1234.HEIC', ''))).resolves.toBe('heif');
    await expect(
      validatePhotoInput(heifFile('IMG_1234.heif', 'application/octet-stream')),
    ).resolves.toBe('heif');
  });

  it('rejects empty, oversized, unsupported, and mislabeled bytes before native or fallback decoding', async () => {
    for (const file of [
      new File([], 'empty.heic', { type: 'image/heic' }),
      new File([new Uint8Array(PHOTO_MAX_BYTES + 1)], 'large.heic', { type: 'image/heic' }),
      new File(['hello'], 'example.svg', { type: 'image/svg+xml' }),
      new File(['tiny'], 'broken.heic', { type: 'image/heic' }),
      ...[1, 2, 3].map(
        (size) => new File([new Uint8Array(size)], 'short.heic', { type: 'image/heic' }),
      ),
      new File([new Uint8Array(32)], 'not-a-photo.heif', { type: 'image/heif' }),
    ])
      await expect(preparePhoto(file)).rejects.toThrow(/Choose|invalid/);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('uses orientation-aware native decoding without loading a worker and enforces 1280px output', async () => {
    const decoded = bitmap(4032, 3024);
    vi.mocked(createImageBitmap).mockResolvedValue(decoded as unknown as ImageBitmap);
    const file = new File(['native'], 'desk.jpeg', { type: 'image/jpeg' });
    await expect(preparePhoto(file)).resolves.toMatch(/^data:image\/jpeg;base64,/);
    expect(createImageBitmap).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(context.drawImage).toHaveBeenCalledWith(decoded, 0, 0, 1280, 960);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(FakeWorker.instances).toHaveLength(0);
    expect(canvas.width).toBe(1);
  });

  it('rejects pixel and encoded output limits while closing decoded resources', async () => {
    const large = bitmap(10_000, 10_000);
    vi.mocked(createImageBitmap).mockResolvedValueOnce(large as unknown as ImageBitmap);
    await expect(preparePhoto(heifFile())).rejects.toThrow('exceeds 64 megapixels');
    expect(large.close).toHaveBeenCalledOnce();
    canvas.toDataURL.mockReturnValue('data:image/jpeg;base64,' + 'x'.repeat(PHOTO_MAX_DATA_URL));
    await expect(preparePhoto(heifFile())).rejects.toThrow('prepared photo is too large');
  });

  it('terminates the fallback worker on success and releases its transferred bitmap', async () => {
    const { preparing, worker } = await startWorker();
    const decoded = bitmap(32, 64);
    worker.onmessage?.({ data: { bitmap: decoded } });
    await expect(preparing).resolves.toMatch(/^data:image\/jpeg;base64,/);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(decoded.close).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-photo');
  });

  it.each(['error', 'messageerror', 'decode'] as const)(
    'terminates the fallback worker on %s failure',
    async (kind) => {
      const { preparing, worker } = await startWorker();
      const rejected = expect(preparing).rejects.toThrow(/local|photo|decode/i);
      if (kind === 'error') worker.onerror?.();
      else if (kind === 'messageerror') worker.onmessageerror?.();
      else worker.onmessage?.({ data: { error: 'Could not decode local photo.' } });
      await rejected;
      expect(worker.terminate).toHaveBeenCalledOnce();
    },
  );

  it('terminates the worker when posting compressed bytes fails', async () => {
    vi.mocked(createImageBitmap).mockRejectedValue(new Error('No native decoder'));
    // Instance creation precedes the asynchronous File read, so override postMessage there.
    class BrokenWorker extends FakeWorker {
      constructor() {
        super();
        this.postMessage.mockImplementation(() => {
          throw new Error('DataCloneError');
        });
      }
    }
    vi.stubGlobal('Worker', BrokenWorker);
    await expect(preparePhoto(heifFile())).rejects.toThrow('Could not read this photo');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it('terminates canceled preparation and rejects late results without encoding them', async () => {
    const controller = new AbortController();
    const { preparing, worker } = await startWorker(controller.signal);
    const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejected;
    const late = bitmap();
    worker.onmessage?.({ data: { bitmap: late } });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(late.close).toHaveBeenCalledOnce();
    expect(canvas.toDataURL).not.toHaveBeenCalled();
  });

  it('terminates the fallback worker after the local conversion deadline', async () => {
    const { preparing, worker } = await startWorker();
    // Move an already running timeout into the fake clock by starting a second preparation.
    worker.onmessage?.({ data: { error: 'Could not decode local photo.' } });
    await expect(preparing).rejects.toThrow();
    vi.useFakeTimers();
    const second = preparePhoto(heifFile());
    const rejected = expect(second).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(PHOTO_DECODE_TIMEOUT_MS + 1);
    await rejected;
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalledOnce();
  });

  it('closes a native bitmap that finishes after cancellation', async () => {
    let finish!: (value: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController();
    const preparing = preparePhoto(heifFile(), controller.signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    controller.abort();
    const rejected = expect(preparing).rejects.toMatchObject({ name: 'AbortError' });
    const late = bitmap();
    finish(late as unknown as ImageBitmap);
    await rejected;
    expect(late.close).toHaveBeenCalledOnce();
    expect(canvas.toDataURL).not.toHaveBeenCalled();
  });
});

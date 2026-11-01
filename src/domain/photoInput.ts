export const PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PHOTO_MAX_SIDE = 1280;
export const PHOTO_MAX_PIXELS = 64_000_000;
export const PHOTO_MAX_DATA_URL = 1_900_000;
export const PHOTO_DECODE_TIMEOUT_MS = 45_000;
export const PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif';

const ordinaryTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const heifTypes = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);
const formatError = 'Choose a PNG, JPEG, WebP, HEIC, or HEIF image up to 8 MB.';
const decodeError = 'Could not read this photo. Export it as JPEG or PNG and try again.';

function aborted() {
  return new DOMException('Photo preparation was canceled.', 'AbortError');
}
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw aborted();
}
function checkDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
    throw new Error('Could not determine the image dimensions.');
  if (width > 16_384 || height > 16_384 || width * height > PHOTO_MAX_PIXELS)
    throw new Error(
      'This photo exceeds 64 megapixels or 16384 pixels per side. Choose a smaller image.',
    );
}

/** Extensions help with iPhone files whose MIME type is empty or application/octet-stream. */
export function isHeifPhoto(file: Pick<File, 'type' | 'name'>) {
  return heifTypes.has(file.type.toLowerCase()) || /\.hei[cf]$/i.test(file.name);
}

/** A filename alone must never send arbitrary bytes to the HEIF decoder. */
export async function validatePhotoInput(file: File): Promise<'ordinary' | 'heif'> {
  if (!file.size || file.size > PHOTO_MAX_BYTES) throw new Error(formatError);
  if (!isHeifPhoto(file)) {
    if (!ordinaryTypes.has(file.type.toLowerCase())) throw new Error(formatError);
    return 'ordinary';
  }
  const bytes = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  const brand = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
  if (bytes.length < 16)
    throw new Error('This HEIC/HEIF file is invalid. Export it as JPEG or PNG and try again.');
  const boxSize = new DataView(bytes.buffer).getUint32(0);
  if (brand(4) !== 'ftyp' || boxSize < 16 || boxSize > file.size)
    throw new Error('This HEIC/HEIF file is invalid. Export it as JPEG or PNG and try again.');
  let supported = heifBrands.has(brand(8));
  for (let offset = 16; offset + 4 <= Math.min(boxSize, bytes.length); offset += 4)
    supported ||= heifBrands.has(brand(offset));
  if (!supported)
    throw new Error(
      'This HEIC/HEIF format is not supported. Export it as JPEG or PNG and try again.',
    );
  return 'heif';
}

function decodeHeif(file: File, signal?: AbortSignal): Promise<ImageBitmap> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    // Vite emits a local module worker. The decoder is never loaded for native formats.
    const worker = new Worker(new URL('./photoDecode.worker.ts', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const cancel = () => fail(aborted());
    const timeout = setTimeout(
      () =>
        fail(
          new Error(
            'Local HEIC/HEIF conversion timed out. Export it as JPEG or PNG and try again.',
          ),
        ),
      PHOTO_DECODE_TIMEOUT_MS,
    );
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = () =>
      fail(new Error('Local HEIC/HEIF conversion failed. Export it as JPEG or PNG and try again.'));
    worker.onmessageerror = () => fail(new Error(decodeError));
    worker.onmessage = ({ data }: MessageEvent<{ bitmap?: ImageBitmap; error?: string }>) => {
      if (settled) {
        data.bitmap?.close();
        return;
      }
      if (!data.bitmap || data.error) {
        data.bitmap?.close();
        fail(new Error(data.error || decodeError));
        return;
      }
      settled = true;
      cleanup();
      resolve(data.bitmap);
    };
    file.arrayBuffer().then(
      (buffer) => {
        if (!settled) {
          try {
            worker.postMessage({ buffer }, [buffer]);
          } catch {
            fail(new Error(decodeError));
          }
        }
      },
      () => fail(new Error(decodeError)),
    );
  });
}

function nativeBitmap(file: File, signal?: AbortSignal): Promise<ImageBitmap> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const cancel = () => fail(aborted());
    const timeout = setTimeout(() => fail(new Error(decodeError)), PHOTO_DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', cancel, { once: true });
    // Native decoding cannot be interrupted, but a canceled/timed-out result is immediately closed.
    Promise.resolve()
      .then(() => createImageBitmap(file, { imageOrientation: 'from-image' }))
      .then((bitmap) => {
        if (settled) {
          bitmap.close();
          return;
        }
        settled = true;
        cleanup();
        resolve(bitmap);
      }, fail);
  });
}

function nativeImage(file: File, signal?: AbortSignal): Promise<HTMLImageElement> {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', cancel);
      URL.revokeObjectURL(url);
    };
    const cancel = () => {
      cleanup();
      image.src = '';
      reject(aborted());
    };
    const timeout = setTimeout(() => {
      cleanup();
      image.src = '';
      reject(new Error(decodeError));
    }, PHOTO_DECODE_TIMEOUT_MS);
    signal?.addEventListener('abort', cancel, { once: true });
    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(decodeError));
    };
    image.src = url;
  });
}

/** Re-encode locally before the explicit external-analysis consent step. Never stores or sends a file. */
export async function preparePhoto(file: File, signal?: AbortSignal): Promise<string> {
  checkAbort(signal);
  const format = await validatePhotoInput(file);
  checkAbort(signal);
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await nativeBitmap(file, signal);
  } catch {
    checkAbort(signal);
    try {
      // Safari may display HEIC in an img even when createImageBitmap cannot decode it.
      source = await nativeImage(file, signal);
    } catch {
      checkAbort(signal);
      if (format !== 'heif') throw new Error(decodeError);
      source = await decodeHeif(file, signal);
    }
  }
  try {
    checkAbort(signal);
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
    checkDimensions(width, height);
    const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    try {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Could not process the photo.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      // Rasterization applies orientation; JPEG encoding drops location, EXIF, and other original metadata.
      const data = canvas.toDataURL('image/jpeg', 0.82);
      if (!data.startsWith('data:image/jpeg;base64,'))
        throw new Error('Could not process the photo.');
      if (data.length > PHOTO_MAX_DATA_URL)
        throw new Error('The prepared photo is too large. Choose a smaller image.');
      return data;
    } finally {
      canvas.width = canvas.height = 1;
    }
  } finally {
    if ('close' in source) source.close();
    else source.src = '';
  }
}

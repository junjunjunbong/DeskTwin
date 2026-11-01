import createLibheif, {
  type heif_context,
  type heif_image,
  type heif_image_handle,
} from 'libheif-js/libheif/libheif.js';

// This is the pinned pure-JavaScript build: no WASM, eval, remote scripts, or conversion service.
const libheif = createLibheif();
const maxPixels = 64_000_000;
const maxSide = 16_384;
const outputSide = 1280;
const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<{ buffer: ArrayBuffer }>) => void) | null;
  postMessage: (
    message: { bitmap: ImageBitmap } | { error: string },
    transfer?: Transferable[],
  ) => void;
};
interface DecodedImage {
  code?: unknown;
  image: heif_image;
  width: number;
  height: number;
  channels: {
    id: { value: number };
    stride: number;
    width: number;
    height: number;
    data: Uint8Array;
  }[];
}
function checkDimensions(width: number, height: number) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > maxSide ||
    height > maxSide ||
    width * height > maxPixels
  )
    throw new Error(
      'This photo exceeds 64 megapixels or 16384 pixels per side. Choose a smaller image.',
    );
}

workerScope.onmessage = async ({ data }) => {
  let context: heif_context | undefined;
  let handle: heif_image_handle | undefined;
  let decoded: DecodedImage | undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    if (
      !(data.buffer instanceof ArrayBuffer) ||
      !data.buffer.byteLength ||
      data.buffer.byteLength > 8 * 1024 * 1024
    )
      throw new Error('Choose a HEIC/HEIF image up to 8 MB.');
    context = libheif.heif_context_alloc();
    const result = libheif.heif_context_read_from_memory(context, new Uint8Array(data.buffer));
    if (result.code !== libheif.heif_error_code.heif_error_Ok)
      throw new Error('Invalid HEIF container.');
    // Decode only the primary picture, never an image sequence, thumbnail, or auxiliary depth image.
    handle = libheif.heif_js_context_get_primary_image_handle(context) as heif_image_handle;
    if (!handle || 'code' in handle) throw new Error('No primary HEIF image.');
    const width = libheif.heif_image_handle_get_width(handle);
    const height = libheif.heif_image_handle_get_height(handle);
    // Bounds are checked before libheif decoding or a full RGBA/ImageData allocation.
    checkDimensions(width, height);
    decoded = (await libheif.heif_js_decode_image2(
      handle,
      libheif.heif_colorspace.heif_colorspace_RGB,
      libheif.heif_chroma.heif_chroma_interleaved_RGBA,
    )) as DecodedImage;
    if (!decoded || decoded.code || !decoded.image)
      throw new Error('Could not decode HEIF pixels.');
    checkDimensions(decoded.width, decoded.height);
    const channel = decoded.channels.find((item) => item.id.value === 10);
    if (
      !channel ||
      channel.width !== decoded.width ||
      channel.height !== decoded.height ||
      channel.stride < decoded.width * 4 ||
      channel.data.length < channel.stride * (decoded.height - 1) + decoded.width * 4
    )
      throw new Error('Invalid HEIF pixel layout.');
    const pixels = new Uint8ClampedArray(decoded.width * decoded.height * 4);
    for (let y = 0; y < decoded.height; y++)
      pixels.set(
        channel.data.subarray(y * channel.stride, y * channel.stride + decoded.width * 4),
        y * decoded.width * 4,
      );
    const scale = Math.min(1, outputSide / Math.max(decoded.width, decoded.height));
    // libheif applies the HEIF crop/rotation/mirror properties during decoding.
    bitmap = await createImageBitmap(new ImageData(pixels, decoded.width, decoded.height), {
      resizeWidth: Math.max(1, Math.round(decoded.width * scale)),
      resizeHeight: Math.max(1, Math.round(decoded.height * scale)),
      resizeQuality: 'high',
    });
    workerScope.postMessage({ bitmap }, [bitmap]);
    bitmap = undefined;
  } catch (error) {
    workerScope.postMessage({
      error:
        error instanceof Error && /exceeds 64 megapixels/.test(error.message)
          ? error.message
          : 'This HEIC/HEIF photo could not be decoded locally. Export it as JPEG or PNG and try again.',
    });
  } finally {
    bitmap?.close();
    if (decoded?.image) libheif.heif_image_release(decoded.image);
    if (handle && !('code' in handle)) libheif.heif_image_handle_release(handle);
    if (context) libheif.heif_context_free(context);
  }
};

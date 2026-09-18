/// <reference lib="webworker" />
// Marks the execution context; it is not what supplies the types, and it is
// why postMessage needs a cast below. Measured 2026-09-06:
// ./notes.md#the-webworker-reference-and-the-postmessage-cast

/**
 * Bytes in, derivatives and metadata out. STUDIO ONLY, deliberately thin.
 * Orientation maths is confined to the HEIC branch below — everything else
 * still comes from bitmap.width/height. ./notes.md#the-worker-is-thin-and-where-the-decisions-live
 */
import heicDecode from "heic-decode";
import { readMetadata } from "./exif";
import { orientationTransform } from "./orientation";
import { TARGETS, fitWithin, withinBlurBudget } from "./targets";

export type WorkerRequest = { id: number; file: Blob };
export type WorkerResponse =
  { id: number; ok: true; result: TransferableResult } | { id: number; ok: false; message: string };

export type TransferableResult = {
  web: { blob: Blob; width: number; height: number };
  thumb: { blob: Blob; width: number; height: number };
  blurDataUrl?: string;
  metadata: ReturnType<typeof readMetadata>;
};

/** Preferred first, then the fallback. §7.3: what comes back is what counts. */
const ENCODE_ORDER = ["image/webp", "image/jpeg"] as const;

async function encode(
  bitmap: ImageBitmap,
  longestEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, longestEdge);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context in this worker");
  context.drawImage(bitmap, 0, 0, width, height);

  let blob: Blob | null = null;
  for (const type of ENCODE_ORDER) {
    const candidate = await canvas.convertToBlob({ type, quality });
    // convertToBlob does NOT throw on an unsupported type — it returns PNG.
    // So the check is on what came back, and we try the next type rather than
    // shipping a PNG under a WebP name.
    if (candidate.type === type) return { blob: candidate, width, height };
    blob = candidate;
  }
  // Both requests fell back. Return the fallback honestly: upload.ts names the
  // file from blob.type, so a PNG is stored as a PNG or refused outright.
  if (!blob) throw new Error("the canvas encoded nothing");
  return { blob, width, height };
}

/**
 * The one format `createImageBitmap` cannot decode: no browser ships a HEIC
 * codec. `heic-decode` sniffs the ftyp brand and frees its own WASM heap;
 * libheif does not auto-rotate, so `orientation` is applied below by hand.
 * ./notes.md#heic-decode-applies-its-own-orientation
 */
async function decodeHeic(file: Blob, orientation: number | undefined): Promise<ImageBitmap> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const { width, height, data } = await heicDecode({ buffer });
  // No copy: heic-decode's `data` is already a real ArrayBuffer; the cast
  // just narrows its declared `ArrayBufferLike` for ImageData's constructor.
  // ./notes.md#the-orientation-cast-is-not-a-copy
  const pixels = data as Uint8ClampedArray<ArrayBuffer>;
  const source = await createImageBitmap(new ImageData(pixels, width, height));

  const transform = orientationTransform(orientation, width, height);
  const [outWidth, outHeight] = transform.swapsDimensions ? [height, width] : [width, height];
  const canvas = new OffscreenCanvas(outWidth, outHeight);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context in this worker");
  context.transform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);
  context.drawImage(source, 0, 0);
  source.close();
  return createImageBitmap(canvas);
}

// THE RE-ENCODE IS THE EXIF STRIP. A canvas holds pixels and nothing else, so
// there is no separate strip to skip. DO NOT add an "it is already small
// enough, pass the original through" shortcut: it reads as an optimisation and
// it uploads the owner's GPS into a publicly readable container.
// ./notes.md#the-re-encode-is-the-exif-strip
async function run(file: Blob): Promise<TransferableResult> {
  const bytes = await file.arrayBuffer();
  const metadata = readMetadata(bytes);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch (cause) {
    // Neither Chrome nor Firefox ship a HEIC/HEIF image decoder, so this is
    // the expected path for that format rather than a real failure. Reported
    // as `cause` if the fallback ALSO fails — e.g. a truly unsupported file —
    // so the error is the browser's own, not heic-decode's sniff message.
    try {
      bitmap = await decodeHeic(file, metadata.orientation);
    } catch {
      throw cause;
    }
  }
  try {
    const web = await encode(bitmap, TARGETS.web.longestEdge, TARGETS.web.quality);
    const thumb = await encode(bitmap, TARGETS.thumb.longestEdge, TARGETS.thumb.quality);
    const blur = await encode(bitmap, TARGETS.blur.longestEdge, TARGETS.blur.quality);

    const buffer = await blur.blob.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    const dataUrl = `data:${blur.blob.type};base64,${btoa(binary)}`;

    return {
      web,
      thumb,
      ...(withinBlurBudget(dataUrl) ? { blurDataUrl: dataUrl } : {}),
      metadata,
    };
  } finally {
    // Free ~200 MB of bitmap for a 50 MP photo rather than waiting for GC.
    bitmap.close();
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, file } = event.data;
  run(file).then(
    (result) =>
      (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies WorkerResponse),
    (cause: unknown) =>
      (self as unknown as Worker).postMessage({
        id,
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
      } satisfies WorkerResponse),
  );
});

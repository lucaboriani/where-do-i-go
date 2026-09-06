/// <reference lib="webworker" />
// The reference marks the execution context; it is not what supplies the types.
// Measured 2026-09-06: tsconfig's lib is ["dom","dom.iterable","esnext"], which
// already declares OffscreenCanvas, createImageBitmap and ImageBitmap, and
// typecheck is clean with the line removed. What the line DOES do is load
// lib.webworker.d.ts alongside lib.dom.d.ts, whose 34 collision errors are
// invisible only because skipLibCheck is true — turn that off and they appear
// inside lib.dom.d.ts, nowhere near this file. `self` still resolves to
// `Window & typeof globalThis` (dom wins), which is why postMessage below needs
// the cast: Window.postMessage takes a targetOrigin, Worker.postMessage does not.
/**
 * Bytes in, derivatives and metadata out. STUDIO ONLY.
 *
 * DELIBERATELY THIN. A worker is the least testable place in this project, so
 * everything decidable without pixels lives in ./targets.ts and ./exif.ts and
 * is unit-tested there. What is left here is decode, draw, encode — and that
 * is verified in a real browser by e2e/media-pipeline.spec.ts.
 *
 * THE RE-ENCODE IS THE EXIF STRIP. A canvas holds pixels and nothing else, so
 * metadata is dropped as a consequence of drawing and re-encoding rather than
 * by a separate step. DO NOT add a "it is already small enough, pass the
 * original through" shortcut: it reads as an optimisation and it uploads the
 * user's GPS to a publicly readable container.
 *
 * ORIENTATION IS HANDLED BY THE DECODER. `imageOrientation: "from-image"`
 * means the bitmap arrives already rotated, so every target is computed from
 * bitmap.width/height and this file does no orientation maths at all. An
 * orientation-6 photo is stored 4032x3024 and displays 3024x4032; computing
 * targets from the file's recorded size gets both the aspect ratio and the
 * stored schema:width/height wrong.
 */
import { readMetadata } from "./exif";
import { TARGETS, fitWithin, withinBlurBudget } from "./targets";

export type WorkerRequest = { id: number; file: Blob };
export type WorkerResponse =
  | { id: number; ok: true; result: TransferableResult }
  | { id: number; ok: false; message: string };

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

async function run(file: Blob): Promise<TransferableResult> {
  const bytes = await file.arrayBuffer();
  const metadata = readMetadata(bytes);

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
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

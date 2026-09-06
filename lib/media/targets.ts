/**
 * The part of the resize that needs no pixels. STUDIO ONLY — never imported by
 * app/(public); enforced by no-restricted-imports.
 *
 * This module exists so that the Web Worker can stay thin. A worker is the
 * least testable place in this project (jsdom has no createImageBitmap, no
 * OffscreenCanvas, no toBlob), so every decision that can be made here is made
 * here, where a fast test can check it.
 */

/** Longest edge in px, and the encoder quality for each derivative (§5). */
export const TARGETS = {
  web: { longestEdge: 1600, quality: 0.82 },
  thumb: { longestEdge: 400, quality: 0.75 },
  blur: { longestEdge: 20, quality: 0.5 },
} as const;

/**
 * The blur placeholder rides inside the entry's Turtle, which is publicly
 * readable and fetched on every page view (§6.4). Over this, it is dropped:
 * a missing placeholder degrades to a plain image load, an oversized one
 * degrades every reader's first paint, multiplied by photo count.
 */
export const BLUR_BUDGET_BYTES = 1200;

/**
 * Fit within a box by the longest edge, preserving aspect ratio.
 *
 * NEVER UPSCALES. A source smaller than the target is returned unchanged, so a
 * 800px photo stays 800px rather than being inflated to 1600px of invented
 * detail at Pod-quota cost.
 *
 * The 1px floor is not defensive tidying: an extreme aspect ratio rounds the
 * short edge to 0, and a zero-height OffscreenCanvas throws.
 */
export function fitWithin(
  width: number,
  height: number,
  longestEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longestEdge) return { width, height };
  const scale = longestEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The three types the canvas encoder can hand back.
 *
 * `undefined` for anything else is deliberate and is half of the §6.1 guard:
 * `convertToBlob` does not throw when it cannot encode the requested type, it
 * silently returns PNG. So the extension and `schema:encodingFormat` are
 * derived from the type the blob ACTUALLY has, and a type we do not recognise
 * has to fail at the call site rather than produce `web.undefined`.
 */
const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function extensionFor(mimeType: string): string | undefined {
  return EXTENSIONS[mimeType.split(";")[0]!.trim().toLowerCase()];
}

/** Bytes, not characters — see the test. */
export function withinBlurBudget(dataUrl: string): boolean {
  return new TextEncoder().encode(dataUrl).length <= BLUR_BUDGET_BYTES;
}

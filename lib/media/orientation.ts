/**
 * The pure half of HEIC's manual rotate: the ctx.transform matrix per EXIF
 * orientation, and whether it swaps width/height. No canvas here — that
 * stays in pipeline.worker.ts. ./notes.md#heic-decode-applies-its-own-orientation
 */

export type OrientationTransform = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  swapsDimensions: boolean;
};

const SWAPS_DIMENSIONS = new Set([5, 6, 7, 8]);

const IDENTITY: OrientationTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
  swapsDimensions: false,
};

/** blueimp/StackOverflow's well-known matrix per EXIF value; unrecognised falls back to identity. */
export function orientationTransform(
  orientation: number | undefined,
  width: number,
  height: number,
): OrientationTransform {
  const swapsDimensions = orientation !== undefined && SWAPS_DIMENSIONS.has(orientation);
  switch (orientation) {
    case 2:
      return { a: -1, b: 0, c: 0, d: 1, e: width, f: 0, swapsDimensions };
    case 3:
      return { a: -1, b: 0, c: 0, d: -1, e: width, f: height, swapsDimensions };
    case 4:
      return { a: 1, b: 0, c: 0, d: -1, e: 0, f: height, swapsDimensions };
    case 5:
      return { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0, swapsDimensions };
    case 6:
      return { a: 0, b: 1, c: -1, d: 0, e: height, f: 0, swapsDimensions };
    case 7:
      return { a: 0, b: -1, c: -1, d: 0, e: height, f: width, swapsDimensions };
    case 8:
      return { a: 0, b: -1, c: 1, d: 0, e: 0, f: width, swapsDimensions };
    default:
      return IDENTITY;
  }
}

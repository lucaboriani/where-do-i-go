import { describe, expect, it } from "vitest";
import { orientationTransform } from "@/lib/media/orientation";

/**
 * The pure decision `pipeline.worker.ts` cannot be unit-tested through:
 * jsdom has no OffscreenCanvas to draw with, but the matrix it would feed
 * `ctx.transform` is plain arithmetic. Values are blueimp/StackOverflow's
 * well-known table, pinned against a fixed 100x50 (w x h) source.
 */
const W = 100;
const H = 50;

const CASES: Array<[number, { a: number; b: number; c: number; d: number; e: number; f: number }, boolean]> = [
  [1, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }, false],
  [2, { a: -1, b: 0, c: 0, d: 1, e: W, f: 0 }, false],
  [3, { a: -1, b: 0, c: 0, d: -1, e: W, f: H }, false],
  [4, { a: 1, b: 0, c: 0, d: -1, e: 0, f: H }, false],
  [5, { a: 0, b: 1, c: 1, d: 0, e: 0, f: 0 }, true],
  [6, { a: 0, b: 1, c: -1, d: 0, e: H, f: 0 }, true],
  [7, { a: 0, b: -1, c: -1, d: 0, e: H, f: W }, true],
  [8, { a: 0, b: -1, c: 1, d: 0, e: 0, f: W }, true],
];

describe("orientationTransform", () => {
  it.each(CASES)("orientation %i matches the known matrix, swap=%s", (orientation, matrix, swaps) => {
    expect(orientationTransform(orientation, W, H)).toEqual({ ...matrix, swapsDimensions: swaps });
  });

  it("falls back to identity, no swap, for an out-of-range orientation", () => {
    expect(orientationTransform(0, W, H)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, swapsDimensions: false });
    expect(orientationTransform(9, W, H)).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, swapsDimensions: false });
  });

  it("falls back to identity, no swap, for an absent orientation, without throwing", () => {
    expect(() => orientationTransform(undefined, W, H)).not.toThrow();
    expect(orientationTransform(undefined, W, H)).toEqual({
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: 0,
      f: 0,
      swapsDimensions: false,
    });
  });
});

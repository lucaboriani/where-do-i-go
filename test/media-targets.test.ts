import { describe, expect, it } from "vitest";
import {
  BLUR_BUDGET_BYTES,
  TARGETS,
  extensionFor,
  fitWithin,
  withinBlurBudget,
} from "@/lib/media/targets";

/**
 * lib/media/targets.ts — everything about the resize that can be decided
 * without pixels. It is pure on purpose: jsdom has no decoder, so this is the
 * half of the pipeline a fast test can actually check, and the worker is kept
 * thin so that this half is the big one.
 */
describe("TARGETS", () => {
  it("pins the exact longest-edge and quality the brief specifies for each derivative", () => {
    // These are the numbers §5 fixes: web 1600px, thumb 400px, blur 20px, at
    // qualities 0.82 / 0.75 / 0.5. Nothing else in this file reads
    // TARGETS.*.longestEdge or TARGETS.*.quality as a literal — the
    // aspect-ratio test below only checks the RATIO between two derivatives,
    // so it stays green even if both longest edges are doubled, and it never
    // touches `blur` at all. Mutation-tested: doubling web to 3200, thumb to
    // 800, or halving blur to 10 must fail here.
    expect(TARGETS.web).toEqual({ longestEdge: 1600, quality: 0.82 });
    expect(TARGETS.thumb).toEqual({ longestEdge: 400, quality: 0.75 });
    expect(TARGETS.blur).toEqual({ longestEdge: 20, quality: 0.5 });
  });
});

describe("fitWithin", () => {
  it("scales a landscape photo to the longest edge, preserving aspect", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait photo by its longest edge, which is the height", () => {
    // The bug this catches is fitting to width unconditionally: a portrait
    // photo would come back 1600 wide and 2133 tall, i.e. LARGER than asked.
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("NEVER upscales a source smaller than the target", () => {
    // §5: upscaling inflates Pod storage to manufacture detail that is not
    // there. The source dimensions come straight back.
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(20, 15, 400)).toEqual({ width: 20, height: 15 });
  });

  it("leaves a photo already exactly at the target alone", () => {
    expect(fitWithin(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    // 10000x3 scaled to 1600 gives a height of 0.48. A zero-height canvas
    // throws in the worker, so the floor is 1px and the aspect is sacrificed.
    expect(fitWithin(10000, 3, 1600)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(3, 10000, 1600)).toEqual({ width: 1, height: 1600 });
  });

  it("gives web and thumb the same aspect ratio, which is what lets us store only one", () => {
    // §4 stores no thumb dimensions because the ratios are identical by
    // construction. If that ever stops being true, the public page lays out
    // every thumb against the wrong box.
    //
    // This checks the RATIO between whatever TARGETS.web.longestEdge and
    // TARGETS.thumb.longestEdge currently are — it holds for any pair of
    // longest edges, by construction of fitWithin, so it does NOT pin the
    // actual 1600/400 values (that's the "TARGETS" describe block above) and
    // does not exercise `blur` at all. Its only job is the ratio invariant.
    const web = fitWithin(4000, 3000, TARGETS.web.longestEdge);
    const thumb = fitWithin(4000, 3000, TARGETS.thumb.longestEdge);
    expect(web.width / web.height).toBeCloseTo(thumb.width / thumb.height, 5);
  });
});

describe("extensionFor", () => {
  it("maps the three types the encoder can return", () => {
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
  });

  it("ignores parameters and case, because blob.type is not normalised for us", () => {
    expect(extensionFor("IMAGE/JPEG")).toBe("jpg");
    expect(extensionFor("image/jpeg;charset=binary")).toBe("jpg");
  });

  it("returns undefined for a type it does not know, rather than guessing", () => {
    // §6.1: the extension comes from the ACTUAL blob type. An unknown type
    // must fail loudly at the call site, not produce `web.undefined`.
    expect(extensionFor("image/avif")).toBeUndefined();
    expect(extensionFor("")).toBeUndefined();
  });
});

describe("withinBlurBudget", () => {
  it("accepts a placeholder at the budget and rejects one over it", () => {
    // §6.4: the blur rides in a publicly readable TTL fetched on every page
    // view. Over budget it is dropped rather than written.
    expect(BLUR_BUDGET_BYTES).toBe(1200);
    expect(withinBlurBudget("d".repeat(BLUR_BUDGET_BYTES))).toBe(true);
    expect(withinBlurBudget("d".repeat(BLUR_BUDGET_BYTES + 1))).toBe(false);
  });

  it("measures bytes, not characters", () => {
    // A data URI is ASCII, but measuring `.length` would be wrong the moment
    // anything non-ASCII appears, and it is one call to be right.
    expect(withinBlurBudget("é".repeat(BLUR_BUDGET_BYTES))).toBe(false);
  });
});

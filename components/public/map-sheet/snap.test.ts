import { describe, expect, it } from "vitest";
import { nextSnap, targetForRow } from "./snap";

// The numbers an 800px viewport actually produced in the spec's probe.
const OFFSETS = { peek: 0, half: 240, full: 576 };

describe("nextSnap", () => {
  it("cycles peek → half → full → peek", () => {
    expect(nextSnap(0, OFFSETS)).toBe(240);
    expect(nextSnap(240, OFFSETS)).toBe(576);
    expect(nextSnap(576, OFFSETS)).toBe(0);
  });

  it("takes the next point ABOVE where a flick left it, not the nearest", () => {
    expect(nextSnap(100, OFFSETS)).toBe(240);
    expect(nextSnap(300, OFFSETS)).toBe(576);
  });

  it("wraps from anywhere past full, which a long timeline reaches", () => {
    expect(nextSnap(1200, OFFSETS)).toBe(0);
  });

  it("tolerates a fractional rest position", () => {
    expect(nextSnap(239.6, OFFSETS)).toBe(576);
  });
});

describe("targetForRow", () => {
  it("never closes the sheet: a row at the top still opens to half", () => {
    expect(targetForRow(600, 32, OFFSETS)).toBe(568);
    expect(targetForRow(240, 32, OFFSETS)).toBe(240);
  });

  it("opens far enough to put a row below the fold under the handle", () => {
    expect(targetForRow(1400, 32, OFFSETS)).toBe(1368);
  });
});

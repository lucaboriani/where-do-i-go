/**
 * How `dy:precisionMeters` is rendered. Public-path, unlike the rest of what
 * `place.ts` holds: ./notes.md#why-precisionlabel-left-placets
 */

import { describe, expect, it } from "vitest";
import { precisionLabel } from "@/lib/place/precision";

describe("precisionLabel", () => {
  it("renders metres under a kilometre as metres", () => {
    expect(precisionLabel(100)).toBe("~100 m");
    expect(precisionLabel(500)).toBe("~500 m");
  });

  it("renders round kilometres as kilometres", () => {
    expect(precisionLabel(1000)).toBe("~1 km");
    expect(precisionLabel(10_000)).toBe("~10 km");
    expect(precisionLabel(1500)).toBe("~1.5 km");
  });

  it("keeps a value that does not divide into a tidy kilometre in metres", () => {
    expect(precisionLabel(1050)).toBe("~1050 m");
  });

  it("always says about, because what is published is a cell rather than a distance", () => {
    for (const metres of [100, 500, 1000, 1050, 10_000])
      expect(precisionLabel(metres).startsWith("~"), String(metres)).toBe(true);
  });
});

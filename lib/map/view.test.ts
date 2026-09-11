import { describe, expect, it } from "vitest";
import { CLUSTER_THRESHOLD, fitOptions, shouldCluster } from "@/lib/map/view";

describe("shouldCluster", () => {
  it("does not cluster at the threshold, only above it", () => {
    expect(shouldCluster(CLUSTER_THRESHOLD)).toBe(false);
    expect(shouldCluster(CLUSTER_THRESHOLD + 1)).toBe(true);
  });

  it("does not cluster an empty trip", () => {
    expect(shouldCluster(0)).toBe(false);
  });
});

describe("fitOptions", () => {
  it("turns a bbox into the [[w,s],[e,n]] MapLibre wants", () => {
    expect(fitOptions({ west: 1, south: 2, east: 3, north: 4 }).bounds).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("never animates, so the first paint is already the trip", () => {
    expect(fitOptions({ west: 1, south: 2, east: 3, north: 4 }).animate).toBe(false);
  });
});

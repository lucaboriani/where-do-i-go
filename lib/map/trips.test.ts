import { describe, expect, it } from "vitest";
import { buildTripPoints, flyOptions, type TripPoint } from "./trips";

const japan: TripPoint = {
  slug: "2026-japan",
  name: "Japan, spring",
  center: { lat: 35.6938, long: 139.7034 },
  bbox: { west: 135.0, south: 34.0, east: 140.0, north: 36.0 },
};
const patagonia: TripPoint = {
  slug: "2025-patagonia",
  name: "Patagonia, autumn",
  center: { lat: -49.3315, long: -72.886 },
  bbox: { west: -73.5, south: -50.0, east: -72.0, north: -49.0 },
};
const unplaced: TripPoint = { slug: "2024-notes", name: "No coordinates at all" };

describe("buildTripPoints", () => {
  it("makes one Point per placed trip, carrying the slug and the name", () => {
    const collection = buildTripPoints([japan, patagonia]);

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].geometry.coordinates).toEqual([139.7034, 35.6938]);
    expect(collection.features[0].properties).toEqual({
      slug: "2026-japan",
      name: "Japan, spring",
    });
  });

  it("drops a trip with no centre rather than placing it at null island", () => {
    const collection = buildTripPoints([japan, unplaced]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.slug).toBe("2026-japan");
  });
});

describe("flyOptions", () => {
  it("is fitOptions with the animation turned on", () => {
    const options = flyOptions(japan.bbox!);

    expect(options.bounds).toEqual([
      [135.0, 34.0],
      [140.0, 36.0],
    ]);
    expect(options.animate).toBe(true);
  });
});

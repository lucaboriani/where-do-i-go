import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/pod/schema";
import { buildPoints, hasCoordinate } from "@/lib/map/points";

function entry(over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    iri: "https://pod.example/travel/trips/t/entries.ttl#e1",
    entryResource: "https://pod.example/travel/trips/t/e1.ttl",
    title: { value: "Arrival", language: "en" },
    slug: "arrival",
    lat: 35.68,
    long: 139.76,
    sortOrder: 1,
    ...over,
  };
}

describe("buildPoints", () => {
  it("keeps an entry that has both halves of a coordinate", () => {
    const fc = buildPoints([entry()]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([139.76, 35.68]);
  });

  it("puts long before lat, because GeoJSON is x,y and the schema is not", () => {
    const fc = buildPoints([entry({ lat: 1, long: 2 })]);
    expect(fc.features[0].geometry.coordinates).toEqual([2, 1]);
  });

  it("drops an entry with no coordinate at all", () => {
    expect(buildPoints([entry({ lat: undefined, long: undefined })]).features).toEqual([]);
  });

  it("drops an entry with only one half, which is not a point", () => {
    expect(buildPoints([entry({ long: undefined })]).features).toEqual([]);
    expect(buildPoints([entry({ lat: undefined })]).features).toEqual([]);
  });

  it("keeps a zero coordinate, which is a real place and not a missing one", () => {
    expect(buildPoints([entry({ lat: 0, long: 0 })]).features).toHaveLength(1);
  });

  it("carries the properties the marker needs and nothing else", () => {
    const fc = buildPoints([
      entry({ thumbnail: "https://pod.example/t.jpg", precisionMeters: 1000, sortOrder: 4 }),
    ]);
    expect(fc.features[0].properties).toEqual({
      slug: "arrival",
      title: "Arrival",
      thumbnail: "https://pod.example/t.jpg",
      precisionMeters: 1000,
      sortOrder: 4,
    });
  });

  it("omits absent optional properties rather than writing undefined into them", () => {
    const props = buildPoints([entry()]).features[0].properties;
    expect("thumbnail" in props).toBe(false);
    expect("precisionMeters" in props).toBe(false);
  });

  it("is a valid empty FeatureCollection for no entries, not null", () => {
    expect(buildPoints([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("hasCoordinate", () => {
  it("narrows so callers do not re-check", () => {
    const e = entry();
    expect(hasCoordinate(e)).toBe(true);
    expect(hasCoordinate(entry({ lat: undefined }))).toBe(false);
  });
});

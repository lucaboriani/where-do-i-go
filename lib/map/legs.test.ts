import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/pod/schema";
import { buildLegs, orderEntries } from "@/lib/map/legs";

function entry(slug: string, over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    iri: `https://pod.example/travel/trips/t/entries.ttl#${slug}`,
    entryResource: `https://pod.example/travel/trips/t/${slug}.ttl`,
    title: { value: slug, language: "en" },
    slug,
    lat: 1,
    long: 1,
    sortOrder: 1,
    ...over,
  };
}

describe("orderEntries", () => {
  it("orders by sortOrder first", () => {
    const ordered = orderEntries([entry("b", { sortOrder: 2 }), entry("a", { sortOrder: 1 })]);
    expect(ordered.map((e) => e.slug)).toEqual(["a", "b"]);
  });

  it("breaks a sortOrder tie with occurredAt", () => {
    const ordered = orderEntries([
      entry("late", { sortOrder: 1, occurredAt: "2026-03-30T09:00:00+09:00" }),
      entry("early", { sortOrder: 1, occurredAt: "2026-03-29T09:00:00+09:00" }),
    ]);
    expect(ordered.map((e) => e.slug)).toEqual(["early", "late"]);
  });

  it("does not mutate its argument, because the caller renders from the same array", () => {
    const input = [entry("b", { sortOrder: 2 }), entry("a", { sortOrder: 1 })];
    orderEntries(input);
    expect(input.map((e) => e.slug)).toEqual(["b", "a"]);
  });
});

describe("buildLegs", () => {
  it("joins two placed entries into one line", () => {
    const fc = buildLegs([
      entry("a", { sortOrder: 1, lat: 1, long: 2 }),
      entry("b", { sortOrder: 2, lat: 3, long: 4 }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });

  it("takes the mode from the DESTINATION, because travelModeFrom is the leg arriving there", () => {
    const fc = buildLegs([
      entry("a", { sortOrder: 1, travelModeFrom: "Walk" }),
      entry("b", { sortOrder: 2, travelModeFrom: "Train" }),
    ]);
    expect(fc.features[0].properties.mode).toBe("Train");
  });

  it("names both ends, so a leg can be traced back to its entries", () => {
    const fc = buildLegs([entry("a", { sortOrder: 1 }), entry("b", { sortOrder: 2 })]);
    expect(fc.features[0].properties).toMatchObject({ fromSlug: "a", toSlug: "b" });
  });

  it("falls back to Unknown when the destination carries no mode", () => {
    const fc = buildLegs([entry("a", { sortOrder: 1 }), entry("b", { sortOrder: 2 })]);
    expect(fc.features[0].properties.mode).toBe("Unknown");
  });

  it("joins across a placeless entry rather than splitting the route in two", () => {
    const fc = buildLegs([
      entry("a", { sortOrder: 1 }),
      entry("nowhere", { sortOrder: 2, lat: undefined, long: undefined }),
      entry("c", { sortOrder: 3 }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ fromSlug: "a", toSlug: "c" });
  });

  it("orders before pairing, so an out-of-order array does not zigzag", () => {
    const fc = buildLegs([
      entry("c", { sortOrder: 3 }),
      entry("a", { sortOrder: 1 }),
      entry("b", { sortOrder: 2 }),
    ]);
    expect(fc.features.map((f) => f.properties.toSlug)).toEqual(["b", "c"]);
  });

  it("makes no leg from a single entry, and none from none", () => {
    expect(buildLegs([entry("a")]).features).toEqual([]);
    expect(buildLegs([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});

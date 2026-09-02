import { describe, expect, it } from "vitest";
import { computeIndex, serialiseIndex } from "@/lib/pod/index-model";
import { readTripIndex } from "@/lib/pod/read";
import { graphEquals, triples } from "./graph";
import { servePod } from "./msw";
import type { Entry } from "@/lib/pod/schema";

const POD = "https://me.solidcommunity.net";
const INDEX = `${POD}/travel/trips/2026-japan/entries.ttl`;
const TRIP = `${POD}/travel/trips/2026-japan/trip.ttl#it`;

const entry = (over: Partial<Entry> & Pick<Entry, "slug">): Entry => ({
  iri: `${POD}/travel/trips/2026-japan/entries/${over.slug}.ttl#it`,
  status: "published",
  schemaVersion: 1,
  headline: { value: over.slug, language: "en" },
  photos: [],
  tags: [],
  ...over,
});

describe("computeIndex", () => {
  it("keeps only published entries — the index is the publication boundary", () => {
    const c = computeIndex([
      entry({ slug: "a" }),
      entry({ slug: "secret", status: "draft" }),
      entry({ slug: "b" }),
    ]);
    expect(c.entryCount).toBe(2);
    expect(c.rows.map((r) => r.slug)).toEqual(["a", "b"]);
    expect(JSON.stringify(c)).not.toContain("secret");
  });

  it("orders by occurredAt and renumbers sortOrder densely from 1", () => {
    const c = computeIndex([
      entry({ slug: "late", occurredAt: "2026-04-02T10:00:00+09:00" }),
      entry({ slug: "early", occurredAt: "2026-03-29T21:40:00+09:00" }),
    ]);
    expect(c.rows.map((r) => r.slug)).toEqual(["early", "late"]);
    expect(c.rows.map((r) => r.sortOrder)).toEqual([1, 2]);
  });

  it("derives bbox and centre from the points, ignoring entries without one", () => {
    const c = computeIndex([
      entry({ slug: "a", place: { geo: { lat: 35.0, long: 139.0 } } }),
      entry({ slug: "b", place: { geo: { lat: 31.5, long: 129.8 } } }),
      entry({ slug: "no-place" }),
    ]);
    expect(c.bbox).toEqual({ west: 129.8, south: 31.5, east: 139.0, north: 35.0 });
    expect(c.center).toEqual({ lat: 33.25, long: 134.4 });
  });

  it("has no bbox at all when nothing is placed", () => {
    const c = computeIndex([entry({ slug: "a" })]);
    expect(c.bbox).toBeUndefined();
    expect(c.center).toBeUndefined();
  });
});

describe("serialiseIndex", () => {
  it("round-trips through the real reader", async () => {
    const computed = computeIndex([
      entry({
        slug: "2026-03-29-arrival",
        headline: { value: "First night in Shinjuku", language: "en" },
        occurredAt: "2026-03-29T21:40:00+09:00",
        travelModeFrom: "Flight",
        place: { geo: { lat: 35.6938, long: 139.7034, precisionMeters: 500 } },
      }),
    ]);
    const ttl = await serialiseIndex(INDEX, TRIP, computed, "2026-04-20T18:02:11+02:00");

    // Read it back through the production path, not a bespoke parser.
    servePod({ [INDEX]: ttl });
    const r = await readTripIndex(INDEX);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entries[0].slug).toBe("2026-03-29-arrival");
    expect(r.value.entries[0].occurredAt).toBe("2026-03-29T21:40:00+09:00");
    expect(r.value.entries[0].travelModeFrom).toBe("Flight");
    expect(r.value.entries[0].lat).toBeCloseTo(35.6938);
    expect(r.value.entryCount).toBe(1);
  });

  it("is stable as a graph across reserialisation, whatever the bytes do", async () => {
    const computed = computeIndex([entry({ slug: "a", place: { geo: { lat: 1.5, long: 2.5 } } })]);
    const a = await serialiseIndex(INDEX, TRIP, computed, "2026-04-20T18:02:11+02:00");
    const b = await serialiseIndex(INDEX, TRIP, computed, "2026-04-20T18:02:11+02:00");
    const cmp = graphEquals(a, b, INDEX);
    expect(cmp.missing).toEqual([]);
    expect(cmp.extra).toEqual([]);
    expect(cmp.equal).toBe(true);
  });

  it("emits no blank nodes", async () => {
    const computed = computeIndex([entry({ slug: "a", place: { geo: { lat: 1, long: 2 } } })]);
    const ttl = await serialiseIndex(INDEX, TRIP, computed, "2026-04-20T18:02:11+02:00");
    expect(() => triples(ttl, INDEX)).not.toThrow();
  });
});

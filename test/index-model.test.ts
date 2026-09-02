import { describe, expect, it } from "vitest";
import { computeIndex, serialiseIndex } from "@/lib/pod/index-model";
import { readTripIndex } from "@/lib/pod/read";
import { readFileSync } from "node:fs";
import { triples } from "./graph";
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

  it("orders by the instant, not the text, across time zones", () => {
    // dy:occurredAt carries the LOCAL offset of the place (§7.3), which is the
    // whole point of the field — so lexical order is not chronological order,
    // and a trip that crosses a time zone is the normal case, not an edge one.
    // Tokyo 00:30+09:00 is 15:30Z on the 28th; Milan 23:00+01:00 is 22:00Z.
    const c = computeIndex([
      entry({ slug: "milan", occurredAt: "2026-03-28T23:00:00+01:00" }),
      entry({ slug: "tokyo", occurredAt: "2026-03-29T00:30:00+09:00" }),
    ]);
    expect(c.rows.map((r) => r.slug)).toEqual(["tokyo", "milan"]);
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

  it("matches the normative §7.4 fixture as a graph", async () => {
    // Serialising twice and comparing proves nothing: serialiseIndex is pure, so
    // the bytes are identical and graphEquals is never exercised. Compare against
    // the specification instead — that is what §11 guardrail 6 asks for, and it
    // would catch a shared writer/reader error that every other test tolerates.
    const doc = readFileSync("docs/data-model.md", "utf8");
    const fixture = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1])[3];

    const computed = computeIndex([
      entry({
        slug: "2026-03-29-arrival",
        headline: { value: "First night in Shinjuku", language: "en" },
        occurredAt: "2026-03-29T21:40:00+09:00",
        travelModeFrom: "Flight",
        place: { geo: { lat: 35.6938, long: 139.7034, precisionMeters: 500 } },
        photos: [
          {
            contentUrl: `${POD}/travel/media/6f2a1c8e/web.jpg`,
            thumbnailUrl: `${POD}/travel/media/6f2a1c8e/thumb.jpg`,
          },
        ],
      }),
    ]);
    const ours = await serialiseIndex(INDEX, TRIP, computed, "2026-04-20T18:02:11+02:00");

    // The fixture carries derived values for the whole 14-entry trip; ours is
    // built from one entry. Compare the shape of the row we do produce.
    const oursTriples = triples(ours, INDEX);
    const specTriples = triples(fixture, INDEX);
    const rowOf = (set: Set<string>) =>
      new Set([...set].filter((t) => t.includes("e-2026-03-29-arrival")));
    const missing = [...rowOf(specTriples)].filter((t) => !rowOf(oursTriples).has(t));
    expect(missing).toEqual([]);
  });

  it("never emits exponent notation, which is not a valid xsd:decimal", async () => {
    // Reachable through the computed centre when a bbox straddles the equator
    // or prime meridian narrowly: String(1e-7) is "1e-7", which no xsd:decimal
    // parser is obliged to accept.
    const computed = computeIndex([
      entry({ slug: "a", place: { geo: { lat: 0.0000001, long: -0.0000002 } } }),
      entry({ slug: "b", place: { geo: { lat: 0.0000003, long: 0.0000004 } } }),
    ]);
    const ttl = await serialiseIndex(INDEX, TRIP, computed, "2026-04-20T18:02:11+02:00");
    expect(ttl).not.toMatch(/\de[+-]?\d/i);
  });

  it("emits no blank nodes", async () => {
    const computed = computeIndex([entry({ slug: "a", place: { geo: { lat: 1, long: 2 } } })]);
    const ttl = await serialiseIndex(INDEX, TRIP, computed, "2026-04-20T18:02:11+02:00");
    expect(() => triples(ttl, INDEX)).not.toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { DataFactory, Writer, type Quad } from "n3";
import {
  DCTERMS, DY, DY_CLASS, NS, RDF, SCHEMA_VERSION, TRAVEL_MODE, XSD,
} from "@/lib/vocab";
import {
  computeIndex, derivedQuads, identityQuads, rowQuads, serialiseIndex,
} from "@/lib/pod/index-model";
import { readTripIndex } from "@/lib/pod/read";
import { readFileSync } from "node:fs";
import { graphEquals, triples } from "@/test/graph";
import { servePod } from "@/test/msw";
import type { Entry } from "@/lib/pod/schema";
import type { IndexRow } from "@/lib/pod/index-model";

const { literal, namedNode, quad } = DataFactory;

const POD = "https://me.solidcommunity.net";
const INDEX = `${POD}/travel/trips/2026-japan/entries.ttl`;
const TRIP = `${POD}/travel/trips/2026-japan/trip.ttl#it`;
const IT = namedNode(`${INDEX}#it`);

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
            contentUrl: `${POD}/travel/media/6f2a1c8e/web.webp`,
            thumbnailUrl: `${POD}/travel/media/6f2a1c8e/thumb.webp`,
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

/* ------------------------------------------------- the §7.4 clauses, direct */

async function turtleOf(quads: Quad[]): Promise<string> {
  const writer = new Writer({ prefixes: { xsd: NS.xsd, dcterms: NS.dcterms, dy: NS.dy } });
  writer.addQuads(quads);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

/** Graph isomorphism, never bytes (§11 guardrail 6). The expected side uses
 *  explicit `literal()` calls rather than `lib/pod/literals.ts`, so a wrong
 *  datatype there cannot move both sides of the comparison together. */
async function expectGraph(actual: Quad[], expected: Quad[]) {
  const { missing, extra } = graphEquals(await turtleOf(expected), await turtleOf(actual), INDEX);
  expect({ missing, extra }).toEqual({ missing: [], extra: [] });
}

const row = (over: Partial<IndexRow> = {}): IndexRow => ({
  fragment: "e-2026-03-29-arrival",
  entryResource: `${POD}/travel/trips/2026-japan/entries/2026-03-29-arrival.ttl#it`,
  title: { value: "First night in Shinjuku", language: "en" },
  slug: "2026-03-29-arrival",
  sortOrder: 1,
  ...over,
});

describe("identityQuads — §7.4 <#it>, what the resource IS", () => {
  it("names what it indexes, and stamps dy:schemaVersion from THIS code", async () => {
    // §11 guardrail 3: the version is written, never echoed. Nothing in a
    // ComputedIndex can supply it, and that is the point — the read-side gate
    // rejects anything this serialiser did not stamp with its own constant.
    await expectGraph(identityQuads(IT, TRIP, "2026-04-20T18:02:11+02:00"), [
      quad(IT, namedNode(RDF.type), namedNode(DY_CLASS.TripIndex)),
      quad(IT, namedNode(DY.indexOf), namedNode(TRIP)),
      quad(IT, namedNode(DY.schemaVersion), literal(String(SCHEMA_VERSION), namedNode(XSD.integer))),
      quad(IT, namedNode(DCTERMS.modified), literal("2026-04-20T18:02:11+02:00", namedNode(XSD.dateTime))),
    ]);
  });
});

describe("derivedQuads — §7.4's derived half", () => {
  it("writes count, bbox and centre — the three functions of the entry set", async () => {
    const computed = computeIndex([
      entry({ slug: "a", place: { geo: { lat: 35.0, long: 139.0 } } }),
      entry({ slug: "b", place: { geo: { lat: 31.5, long: 129.8 } } }),
    ]);
    await expectGraph(derivedQuads(IT, computed), [
      quad(IT, namedNode(DY.entryCount), literal("2", namedNode(XSD.integer))),
      quad(IT, namedNode(DY.bboxWest), literal("129.8", namedNode(XSD.decimal))),
      quad(IT, namedNode(DY.bboxSouth), literal("31.5", namedNode(XSD.decimal))),
      quad(IT, namedNode(DY.bboxEast), literal("139.0", namedNode(XSD.decimal))),
      quad(IT, namedNode(DY.bboxNorth), literal("35.0", namedNode(XSD.decimal))),
      quad(IT, namedNode(DY.centerLat), literal("33.25", namedNode(XSD.decimal))),
      quad(IT, namedNode(DY.centerLong), literal("134.4", namedNode(XSD.decimal))),
    ]);
  });

  it("still writes dy:entryCount when nothing is placed, and no bbox or centre", async () => {
    // A trip with no coordinates yet is the first-entry case, not an error.
    // The count is not optional: the archive list and the OG image read it.
    await expectGraph(derivedQuads(IT, computeIndex([entry({ slug: "a" })])), [
      quad(IT, namedNode(DY.entryCount), literal("1", namedNode(XSD.integer))),
    ]);
  });

  it("writes zero as a count, not as an absence, for an emptied trip", async () => {
    await expectGraph(derivedQuads(IT, computeIndex([])), [
      quad(IT, namedNode(DY.entryCount), literal("0", namedNode(XSD.integer))),
    ]);
  });
});

describe("rowQuads — §7.4 <#e-slug>", () => {
  it("hangs the row off <#it> and writes the whole flat shape", async () => {
    const node = namedNode(`${INDEX}#e-2026-03-29-arrival`);
    await expectGraph(
      rowQuads(IT, INDEX, row({
        occurredAt: "2026-03-29T21:40:00+09:00",
        lat: 35.6938,
        long: 139.7034,
        precisionMeters: 500,
        thumbnail: `${POD}/travel/media/6f2a1c8e/thumb.webp`,
        travelModeFrom: "Flight",
      })),
      [
        quad(IT, namedNode(DY.entry), node),
        quad(node, namedNode(RDF.type), namedNode(DY_CLASS.IndexEntry)),
        quad(node, namedNode(DY.entryResource), namedNode(row().entryResource)),
        quad(node, namedNode(DCTERMS.title), literal("First night in Shinjuku", "en")),
        quad(node, namedNode(DY.slug), literal("2026-03-29-arrival")),
        quad(node, namedNode(DY.sortOrder), literal("1", namedNode(XSD.integer))),
        quad(node, namedNode(DY.occurredAt), literal("2026-03-29T21:40:00+09:00", namedNode(XSD.dateTime))),
        quad(node, namedNode(DY.lat), literal("35.6938", namedNode(XSD.decimal))),
        quad(node, namedNode(DY.long), literal("139.7034", namedNode(XSD.decimal))),
        quad(node, namedNode(DY.precisionMeters), literal("500", namedNode(XSD.integer))),
        quad(node, namedNode(DY.thumbnail), namedNode(`${POD}/travel/media/6f2a1c8e/thumb.webp`)),
        quad(node, namedNode(DY.travelModeFrom), namedNode(TRAVEL_MODE.Flight)),
      ],
    );
  });

  it("omits every absent optional rather than writing an empty term", async () => {
    const written = [...triples(await turtleOf(rowQuads(IT, INDEX, row())), INDEX)]
      .map((t) => t.split(" ")[1].slice(2));
    for (const absent of [
      DY.occurredAt, DY.lat, DY.long, DY.precisionMeters, DY.thumbnail, DY.travelModeFrom,
    ])
      expect(written, `${absent} was written for a row that has no value for it`)
        .not.toContain(absent);
  });

  it("writes a lat of 0 — the equator is a coordinate, not a missing one", async () => {
    const written = [...triples(await turtleOf(rowQuads(IT, INDEX, row({ lat: 0, long: 0 }))), INDEX)];
    expect(written).toContain(`N|${INDEX}#e-2026-03-29-arrival N|${DY.lat} L|0.0|${XSD.decimal}|`);
    expect(written).toContain(`N|${INDEX}#e-2026-03-29-arrival N|${DY.long} L|0.0|${XSD.decimal}|`);
  });
});

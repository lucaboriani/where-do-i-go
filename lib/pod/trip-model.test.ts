import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Parser, Writer, type Quad } from "n3";
import { DY, NS, SCHEMA, SCHEMA_VERSION, STATUS } from "@/lib/vocab";
import { graphEquals, triples } from "@/test/graph";
import type { Trip } from "@/lib/pod/schema";

/**
 * The §7.2 fixture, extracted at runtime rather than hand-copied — normative,
 * exactly like `read.test.ts` does for `readTrip`. Second block in the file.
 */
const doc = readFileSync("docs/data-model.md", "utf8");
const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);
const [, TRIP] = blocks;

const POD = "https://me.solidcommunity.net";
const TRIP_DOC = `${POD}/travel/trips/2026-japan/trip.ttl`;
const IT = `${TRIP_DOC}#it`;

async function turtleOf(quads: Quad[]): Promise<string> {
  const writer = new Writer({
    prefixes: { xsd: NS.xsd, schema: NS.schema, dcterms: NS.dcterms, geo: NS.geo, dy: NS.dy },
  });
  writer.addQuads(quads);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

/** Graph isomorphism, never bytes (§11 guardrail 6) — the same helper
 *  `entry-model.test.ts` uses, via `test/graph.ts`'s `graphEquals`. */
async function expectGraph(actualTurtle: string, expectedQuads: Quad[]) {
  const { missing, extra } = graphEquals(await turtleOf(expectedQuads), actualTurtle, TRIP_DOC);
  expect({ missing, extra }).toEqual({ missing: [], extra: [] });
}

/**
 * §7.2 minus the deferred `schema:tripOrigin`/`dy:track` (task-1-brief.md
 * Task 1.3 — both land in a later task). Filtered at the quad level off the
 * REAL fixture rather than hand-copied, so a §7.2 edit upstream moves this
 * test with it instead of silently drifting from the spec.
 */
function withoutDeferred(quads: Quad[]): Quad[] {
  const droppedSubjects = new Set([`${TRIP_DOC}#origin`, `${TRIP_DOC}#origin-geo`]);
  return quads.filter(
    (q) =>
      q.predicate.value !== SCHEMA.tripOrigin &&
      q.predicate.value !== DY.track &&
      !droppedSubjects.has(q.subject.value),
  );
}

const FIXTURE_QUADS = withoutDeferred(new Parser({ baseIRI: TRIP_DOC }).parse(TRIP));

/** The §7.2 trip, as `Trip` — `creator` is Task 1.2's field, added to the
 *  schema alongside `readTrip`'s parity fix. */
const publishedTrip = {
  iri: IT,
  slug: "2026-japan",
  status: "published",
  schemaVersion: SCHEMA_VERSION,
  name: { value: "Japan, spring", language: "en" },
  description: { value: "Three weeks from Tokyo to Kyushu, mostly by train.", language: "en" },
  startDate: "2026-03-28",
  endDate: "2026-04-17",
  index: `${POD}/travel/trips/2026-japan/entries.ttl#it`,
  coverImage: `${POD}/travel/media/6f2a1c8e/web.webp`,
  tags: ["japan", "trains", "food"],
  created: "2026-03-01T09:12:00+01:00",
  modified: "2026-04-20T18:02:11+02:00",
  creator: "https://me.solidcommunity.net/profile/card#me",
} as Trip;

describe("serialiseTrip", () => {
  // Guards the fixture filter itself: if `withoutDeferred` matched nothing —
  // a renamed predicate, a moved fragment — this fails loudly instead of the
  // isomorphism test silently comparing against the UNFILTERED fixture.
  it("the §7.2 fixture actually declares tripOrigin and track, for the filter below to strip", () => {
    const unfiltered = new Parser({ baseIRI: TRIP_DOC }).parse(TRIP);
    expect(FIXTURE_QUADS.length).toBeGreaterThan(0);
    expect(FIXTURE_QUADS.length).toBeLessThan(unfiltered.length);
    expect(unfiltered.some((q) => q.predicate.value === SCHEMA.tripOrigin)).toBe(true);
    expect(unfiltered.some((q) => q.predicate.value === DY.track)).toBe(true);
  });

  it("is graph-isomorphic to the §7.2 fixture, minus the deferred tripOrigin/track", async () => {
    const { serialiseTrip } = await import("@/lib/pod/trip-model");
    const r = await serialiseTrip(publishedTrip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await expectGraph(r.value, FIXTURE_QUADS);
  });

  it("serialises a draft trip as dy:status dy:Draft, not dy:Published", async () => {
    const { serialiseTrip } = await import("@/lib/pod/trip-model");
    const r = await serialiseTrip({ ...publishedTrip, status: "draft" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const set = triples(r.value, TRIP_DOC);
    expect(set.has(`N|${IT} N|${DY.status} N|${STATUS.Draft}`)).toBe(true);
    expect(set.has(`N|${IT} N|${DY.status} N|${STATUS.Published}`)).toBe(false);
  });

  /**
   * §11 guardrail 7's invariant on the write side, via `assertSlug` — the
   * CONTAINER-segment check `readTrip` already runs, not `assertEntrySlug`
   * (which strips `.ttl` off a filename and would reject every trip, since
   * `trips/<slug>/trip.ttl`'s filename is always "trip").
   */
  it("refuses a trip whose slug does not match its container segment", async () => {
    const { serialiseTrip } = await import("@/lib/pod/trip-model");
    const r = await serialiseTrip({ ...publishedTrip, slug: "not-the-container-segment" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("slugMismatch");
  });
});

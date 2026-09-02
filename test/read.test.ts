import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readDiary, readEntry, readTrip, readTripIndex } from "@/lib/pod/read";
import { servePod } from "./msw";

/**
 * Read the §7 fixtures straight out of docs/data-model.md and run them through
 * the real read path. Those blocks are normative — "the Turtle examples are the
 * specification, not illustrations" — so testing against a hand-copied version
 * would test a copy of the spec rather than the spec.
 */
const doc = readFileSync("docs/data-model.md", "utf8");
const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);
const [DIARY, TRIP, ENTRY, INDEX] = blocks;

const POD = "https://me.solidcommunity.net";
const URLS = {
  diary: `${POD}/travel/diary.ttl`,
  trip: `${POD}/travel/trips/2026-japan/trip.ttl`,
  entry: `${POD}/travel/trips/2026-japan/entries/2026-03-29-arrival.ttl`,
  index: `${POD}/travel/trips/2026-japan/entries.ttl`,
};


describe("readTrip", () => {
  it("returns a typed trip from the normative fixture", async () => {
    servePod({ [URLS.trip]: TRIP });
    const r = await readTrip(URLS.trip);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.slug).toBe("2026-japan");
    expect(r.value.status).toBe("published");
    expect(r.value.name).toEqual({ value: "Japan, spring", language: "en" });
    expect(r.value.startDate).toBe("2026-03-28");
    expect(r.value.tags).toEqual(expect.arrayContaining(["japan", "trains", "food"]));
    expect(r.value.origin?.geo?.lat).toBeCloseTo(45.4642);
  });

  it("reports a structured error, not a throw, for a missing resource", async () => {
    servePod({ [URLS.trip]: 404 });
    const r = await readTrip(URLS.trip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: URLS.trip, status: 404 });
  });

  it("rejects a schemaVersion it does not understand", async () => {
    servePod({ [URLS.trip]: TRIP.replace("dy:schemaVersion   1", "dy:schemaVersion   99") });
    const r = await readTrip(URLS.trip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("schemaVersion");
  });

  it("rejects a slug that does not match its container segment", async () => {
    servePod({ [URLS.trip]: TRIP.replace('dy:slug            "2026-japan"', 'dy:slug            "elsewhere"') });
    const r = await readTrip(URLS.trip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("slugMismatch");
  });

  it("rejects a coordinate typed as xsd:float", async () => {
    servePod({
      [URLS.trip]: TRIP.replace("schema:latitude    45.4642 ;", 'schema:latitude    "45.4642"^^xsd:float ;'),
    });
    const r = await readTrip(URLS.trip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("datatype");
  });

  it("reports malformed Turtle as a parse error", async () => {
    servePod({ [URLS.trip]: "@prefix broken" });
    const r = await readTrip(URLS.trip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("parse");
  });
});

describe("readEntry", () => {
  it("returns a typed entry, preserving the local UTC offset", async () => {
    servePod({ [URLS.entry]: ENTRY });
    const r = await readEntry(URLS.entry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.headline.value).toBe("First night in Shinjuku");
    // 21:40+09:00 must survive as evening in Tokyo, not be normalised to UTC.
    expect(r.value.occurredAt).toBe("2026-03-29T21:40:00+09:00");
    expect(r.value.travelModeFrom).toBe("Flight");
    expect(r.value.place?.locality).toBe("Tokyo");
    expect(r.value.photos).toHaveLength(1);
    expect(r.value.photos[0].width).toBe(1600);
  });

  it("rejects a slug that does not match its own filename", async () => {
    // §11 guardrail 7 and §4: assert on read, because a mismatch makes an entry
    // unreachable from the web while looking intact in the Pod — it reaches the
    // index, the sitemap and the feed, and every one of those links is dead.
    servePod({
      [URLS.entry]: ENTRY.replace(
        'dy:slug              "2026-03-29-arrival"',
        'dy:slug              "totally-different"',
      ),
    });
    const r = await readEntry(URLS.entry);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("slugMismatch");
  });

  it("rejects a date that is not xsd:date", async () => {
    servePod({
      [URLS.trip]: TRIP.replace('"2026-03-28"^^xsd:date', '"2026-03-28"'),
    });
    const r = await readTrip(URLS.trip);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("datatype");
  });

  it("rejects a dateTime with no UTC offset", async () => {
    servePod({
      [URLS.entry]: ENTRY.replace('"2026-03-29T21:40:00+09:00"^^xsd:dateTime', '"2026-03-29T21:40:00"^^xsd:dateTime'),
    });
    const r = await readEntry(URLS.entry);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
  });
});

/** The §7.4 fixture declares two dy:entry links but only gives one of them any
 *  triples, so the reader filters the other out and every ordering assertion
 *  runs on a single row. Add a fully-populated second row, declared LAST but
 *  sorting FIRST, so the sort is actually exercised. */
const TWO_ROW_INDEX =
  INDEX.replace(
    "dy:entry         <#e-2026-03-29-arrival>, <#e-2026-03-31-nara> .",
    "dy:entry         <#e-2026-03-29-arrival>, <#e-2026-03-28-departure> .",
  ).trimEnd() +
  `

<#e-2026-03-28-departure>
    a dy:IndexEntry ;
    dy:entryResource   <entries/2026-03-28-departure.ttl#it> ;
    dcterms:title      "Leaving Milan"@en ;
    dy:slug            "2026-03-28-departure" ;
    dy:occurredAt      "2026-03-28T07:00:00+01:00"^^xsd:dateTime ;
    dy:sortOrder       0 .
`;

describe("readTripIndex", () => {
  it("returns entries sorted by dy:sortOrder, with the bbox", async () => {
    servePod({ [URLS.index]: INDEX });
    const r = await readTripIndex(URLS.index);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entryCount).toBe(14);
    expect(r.value.bbox).toEqual({ west: 129.8721, south: 31.5904, east: 139.8107, north: 35.7148 });
    expect(r.value.entries[0].slug).toBe("2026-03-29-arrival");
    expect(r.value.entries.map((e) => e.sortOrder)).toEqual(
      [...r.value.entries.map((e) => e.sortOrder)].sort((a, b) => a - b),
    );
  });

  it("sorts rows by dy:sortOrder regardless of document order", async () => {
    servePod({ [URLS.index]: TWO_ROW_INDEX });
    const r = await readTripIndex(URLS.index);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entries).toHaveLength(2);
    // Declared second, sortOrder 0 — must come first.
    expect(r.value.entries.map((e) => e.slug)).toEqual([
      "2026-03-28-departure",
      "2026-03-29-arrival",
    ]);
  });

  it("rejects a row with no dy:sortOrder rather than defaulting it to 0", async () => {
    // §6: "Ordering is always explicit … parse order carries no meaning and
    // must never be relied on." A silent 0 does exactly what that forbids, and
    // does it where every other bad field produces a structured error.
    servePod({ [URLS.index]: INDEX.replace("dy:sortOrder       1 .", ".") });
    const r = await readTripIndex(URLS.index);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
  });

  it("rejects a count that is not xsd:integer", async () => {
    servePod({ [URLS.index]: INDEX.replace("dy:entryCount    14 ;", 'dy:entryCount    "14" ;') });
    const r = await readTripIndex(URLS.index);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("datatype");
  });
});

describe("URL construction", () => {
  it("percent-encodes slugs so a crafted one cannot address another resource", async () => {
    // new URL("travel/trips/a#b/trip.ttl", root) silently fetches the container
    // travel/trips/a — a different resource entirely.
    const { tripUrl, tripIndexUrl } = await import("@/lib/pod/read");
    expect(tripUrl(`${POD}/`, "a#b")).toContain("a%23b");
    expect(tripUrl(`${POD}/`, "a?b")).toContain("a%3Fb");
    expect(tripIndexUrl(`${POD}/`, "a#b")).toContain("a%23b");
  });
});

describe("readDiary", () => {
  it("returns the trip list", async () => {
    servePod({ [URLS.diary]: DIARY });
    const r = await readDiary(URLS.diary);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title?.value).toBe("Somewhere Else");
    expect(r.value.trips).toHaveLength(2);
  });
});

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

  it("rejects a dateTime with no UTC offset", async () => {
    servePod({
      [URLS.entry]: ENTRY.replace('"2026-03-29T21:40:00+09:00"^^xsd:dateTime', '"2026-03-29T21:40:00"^^xsd:dateTime'),
    });
    const r = await readEntry(URLS.entry);
    expect(r.ok).toBe(false);
  });
});

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

  it("never exposes dy:status — the index is the publication boundary", async () => {
    servePod({ [URLS.index]: INDEX });
    const r = await readTripIndex(URLS.index);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(r.value)).not.toContain("status");
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

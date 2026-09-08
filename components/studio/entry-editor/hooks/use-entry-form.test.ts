/**
 * The five seedings, and the two that a lazy spelling gets wrong while every
 * refusal a test can make still passes. ./notes.md#the-five-seedings-that-are-not-obvious
 */
import { describe, expect, it } from "vitest";
import { initialEntryFormState } from "./use-entry-form";
import type { Entry } from "@/lib/pod/schema";

const TRIP = "https://pod.example/travel/japan-2026/trip.ttl#it";

/** The narrowest entry `Entry` accepts, as the editor receives it on an edit. */
const entry = (over: Partial<Entry> = {}): Entry => ({
  iri: "https://pod.example/travel/japan-2026/entries/a.ttl#it",
  slug: "2026-04-11-morning",
  status: "published",
  schemaVersion: 1,
  headline: { value: "Morning in Yanaka", language: "en" },
  trip: TRIP,
  tags: ["walking", "morning"],
  photos: [],
  ...over,
});

describe("initialEntryFormState — a create", () => {
  it("opens empty, with nobody credited for anything", () => {
    const state = initialEntryFormState({ existing: undefined, tripIris: [TRIP] });
    expect(state.tripIri).toBe("");
    expect(state.occurred).toBe("");
    expect(state.coordinateAuthor).toEqual({ kind: "nobody" });
    expect(state.occurredAuthor).toEqual({ kind: "nobody" });
    expect(state.offsetAuthor).toEqual({ kind: "nobody" });
    expect(state.offsetGuess, "the create opens marked, before any photo has spoken").toBe(false);
  });

  it("shows THIS MACHINE'S offset rather than `+00:00`", () => {
    // `offsetHere("")` is `+00:00`, so the chain has to ask about `wallClockNow()`
    // and not about `occurred`, which is empty on a create.
    const state = initialEntryFormState({ existing: undefined, tripIris: [] });
    expect(state.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
    const local = -new Date().getTimezoneOffset();
    const sign = local < 0 ? "-" : "+";
    const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
    expect(state.offset).toBe(`${sign}${pad(Math.trunc(local / 60))}:${pad(local % 60)}`);
  });
});

describe("initialEntryFormState — an edit", () => {
  it("leaves the coordinate boxes EMPTY, so the published pair is not re-snapped", () => {
    const state = initialEntryFormState({
      existing: entry({
        place: {
          name: { value: "Yanaka", language: "en" },
          geo: { lat: 35.69, long: 139.7, precisionMeters: 500 },
        },
      }),
      tripIris: [TRIP],
    });
    expect([state.lat, state.long]).toEqual(["", ""]);
    expect(state.precision, "a grid the settings have not answered for yet").toBe("");
  });

  it("SEEDS the place text, which is the opposite answer and deliberately so", () => {
    const state = initialEntryFormState({
      existing: entry({
        place: {
          name: { value: "Yanaka Ginza", language: "en" },
          locality: "Taito",
          country: "JP",
        },
      }),
      tripIris: [TRIP],
    });
    expect([state.placeName, state.locality, state.country]).toEqual([
      "Yanaka Ginza",
      "Taito",
      "JP",
    ]);
  });

  it("does not seed the slots from the entry's photos", () => {
    const state = initialEntryFormState({
      existing: entry({ photos: [{ contentUrl: "https://pod.example/travel/media/a/web.jpg" }] }),
      tripIris: [TRIP],
    });
    expect(state.slots, "a seeded row would renumber sortOrder and announce at mount").toEqual([]);
  });

  it("leaves the trip picker unchosen for a trip that is not on offer", () => {
    expect(initialEntryFormState({ existing: entry(), tripIris: [] }).tripIri).toBe("");
    expect(initialEntryFormState({ existing: entry(), tripIris: [TRIP] }).tripIri).toBe(TRIP);
  });
});

/* ─── the two conditional seedings: rulings T3-B and T4-B ────────────────── */

describe("initialEntryFormState — the credits are seeded from the ENTRY", () => {
  it("protects a stored pin from the next photo (T3-B)", () => {
    const pinned = entry({
      place: {
        name: { value: "Yanaka", language: "en" },
        geo: { lat: 35.69, long: 139.7, precisionMeters: 500 },
      },
    });
    expect(initialEntryFormState({ existing: pinned, tripIris: [TRIP] }).coordinateAuthor).toEqual({
      kind: "owner",
    });
  });

  it("still lets a photo fill an edit that has NO geometry — the allow-case", () => {
    // `{ kind: "owner" }` unconditionally passes every refusal a test can make
    // and switches auto-fill off for every edit ever made. This is what
    // separates the two spellings.
    const placeless = entry({ place: { name: { value: "Yanaka", language: "en" } } });
    expect(
      initialEntryFormState({ existing: placeless, tripIris: [TRIP] }).coordinateAuthor,
    ).toEqual({ kind: "nobody" });
    expect(initialEntryFormState({ existing: entry(), tripIris: [TRIP] }).coordinateAuthor).toEqual(
      { kind: "nobody" },
    );
  });

  it("protects a stored timestamp's two halves from the next photo (T4-B)", () => {
    const dated = entry({ occurredAt: "2026-04-11T07:05:00+09:00" });
    const state = initialEntryFormState({ existing: dated, tripIris: [TRIP] });
    expect(state.occurredAuthor).toEqual({ kind: "owner" });
    expect(state.offsetAuthor).toEqual({ kind: "owner" });
    expect(state.occurred, "the clock is the entry's own wall clock, unshifted").toBe(
      "2026-04-11T07:05",
    );
    expect(state.offset, "the offset is the entry's own, not this machine's").toBe("+09:00");
  });

  it("still lets a photo date an edit with no `dy:occurredAt` — the allow-case", () => {
    const state = initialEntryFormState({ existing: entry(), tripIris: [TRIP] });
    expect(state.occurredAuthor).toEqual({ kind: "nobody" });
    expect(state.offsetAuthor).toEqual({ kind: "nobody" });
  });
});

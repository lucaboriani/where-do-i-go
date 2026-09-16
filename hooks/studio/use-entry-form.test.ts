// @vitest-environment jsdom
/**
 * The five seedings, and the two that a lazy spelling gets wrong while every
 * refusal a test can make still passes. ./notes.md#the-five-seedings-that-are-not-obvious
 */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { OFFSETS, offsetMinutes } from "@/lib/time/offsets";
import { initialEntryFormState, useEntryForm } from "./use-entry-form";
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
  sections: [],
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

  it("opens with exactly one empty section, ready to type into", () => {
    const state = initialEntryFormState({ existing: undefined, tripIris: [TRIP] });
    expect(state.sections).toHaveLength(1);
    expect(state.sections[0].text).toBe("");
    expect(state.sections[0].slots).toEqual([]);
    expect(typeof state.sections[0].id, "a section needs a stable synthetic id").toBe("string");
    expect(state.sections[0].id.length).toBeGreaterThan(0);
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

  it("builds one section per existing section, with its text and its restored photos", () => {
    const state = initialEntryFormState({
      existing: entry({
        sections: [
          { text: { value: "Morning in Yanaka", language: "en" }, photos: [], sortOrder: 1 },
          {
            text: { value: "Then the cemetery", language: "en" },
            photos: [{ contentUrl: "https://pod.example/travel/media/a/web.jpg" }],
            sortOrder: 2,
          },
        ],
      }),
      tripIris: [TRIP],
    });
    expect(state.sections).toHaveLength(2);
    expect(state.sections.map((s) => s.text)).toEqual(["Morning in Yanaka", "Then the cemetery"]);
    expect(state.sections[0].slots).toEqual([]);
    expect(state.sections[1].slots).toHaveLength(1);
    expect(state.sections[1].slots[0]).toMatchObject({
      state: "ready",
      photo: { contentUrl: "https://pod.example/travel/media/a/web.jpg" },
    });
    // A section with no text comes back as `""`, never `undefined`, so the
    // controlled textarea has a string to render.
    const noText = initialEntryFormState({
      existing: entry({
        sections: [
          { photos: [{ contentUrl: "https://pod.example/travel/media/z/web.jpg" }], sortOrder: 1 },
        ],
      }),
      tripIris: [TRIP],
    });
    expect(noText.sections[0].text).toBe("");
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

/* ─── the section setters replace the single story control ───────────────── */

describe("useEntryForm — the section setters", () => {
  it("no longer offers a `story` control", () => {
    const { result } = renderHook(() => useEntryForm({ existing: undefined, tripIris: [TRIP] }));
    expect(result.current.set, "the flat story setter outlived the flat story field").not.toHaveProperty(
      "story",
    );
  });

  it("sets a section's text by id", () => {
    const { result } = renderHook(() => useEntryForm({ existing: undefined, tripIris: [TRIP] }));
    const id = result.current.values.sections[0].id;
    act(() => {
      result.current.setSectionText(id, "First light on the path");
    });
    expect(result.current.values.sections[0].text).toBe("First light on the path");
  });

  it("adds, removes and moves sections", () => {
    const { result } = renderHook(() => useEntryForm({ existing: undefined, tripIris: [TRIP] }));
    const first = result.current.values.sections[0].id;

    act(() => {
      result.current.addSection();
    });
    expect(result.current.values.sections).toHaveLength(2);
    const second = result.current.values.sections[1].id;
    expect(second, "the added section got a fresh id").not.toBe(first);

    act(() => {
      result.current.moveSection(second, "up");
    });
    expect(result.current.values.sections.map((s) => s.id)).toEqual([second, first]);

    act(() => {
      result.current.removeSection(first);
    });
    expect(result.current.values.sections.map((s) => s.id)).toEqual([second]);
  });

  it("attaches a slot to the named section", () => {
    const { result } = renderHook(() => useEntryForm({ existing: undefined, tripIris: [TRIP] }));
    const id = result.current.values.sections[0].id;
    act(() => {
      result.current.addSlot(id, { key: "photo-0", name: "a.jpg", state: "decoding" });
    });
    expect(result.current.values.sections[0].slots.map((s) => s.key)).toEqual(["photo-0"]);
  });
});

/* ─── what the offset control offers, which is a projection of one field ──── */

describe("useEntryForm — offsetOptions", () => {
  const options = (offset: string) =>
    renderHook(() =>
      useEntryForm({
        existing: entry({ occurredAt: `2026-04-11T07:05:00${offset}` }),
        tripIris: [TRIP],
      }),
    ).result.current.offsetOptions;

  it("offers every listed zone, once, for a value that is on the list", () => {
    const shown = options("+09:00");
    expect(shown).toEqual([...OFFSETS].sort((a, b) => offsetMinutes(a) - offsetMinutes(b)));
    expect(shown.filter((o) => o === "+09:00")).toHaveLength(1);
  });

  it("unions a value the list does NOT carry, unconditionally", () => {
    // Measured: with the union deleted and an entry stored at `+05:15`, the
    // control showed `-12:00` — the FIRST option, not an empty box. React marks
    // no option as selected when the value matches none, and a single `<select>`
    // with nothing selected reports its first option.
    expect(options("+05:15")).toContain("+05:15");
  });

  it("puts it where a reader will look, sorted by MINUTES and not lexically", () => {
    const shown = options("+05:15");
    expect(shown.indexOf("+05:15")).toBe(shown.indexOf("+05:00") + 1);
    expect(shown.indexOf("+05:30")).toBe(shown.indexOf("+05:15") + 1);
    expect(shown.at(-1), "appending after +14:00 looks like a bug in the list").toBe("+14:00");
  });

  it("keeps offering it after an edit that never touched the control", () => {
    const props = { existing: entry({ occurredAt: "2026-04-11T07:05:00+05:15" }), tripIris: [TRIP] };
    const { result, rerender } = renderHook((p: typeof props) => useEntryForm(p), {
      initialProps: props,
    });
    act(() => {
      result.current.set.headline("Something else");
    });
    rerender(props);
    expect(result.current.offsetOptions).toContain("+05:15");
  });
});

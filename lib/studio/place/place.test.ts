/**
 * The `Place` §9 governs (§7.3 for its Turtle), assembled from three text
 * boxes, a precision select and a fuzz result — asserted directly.
 * Why it had no direct cases before: ./notes.md#tested-through-the-dom-until-now
 */

import { describe, expect, it } from "vitest";
import {
  PRECISION_GRIDS,
  gridOf,
  placeFor,
  placeTextOf,
} from "@/lib/studio/place/place";
import type { EntryPlace } from "@/lib/studio/place/place";

/** §7.3's own fixture, already snapped to 500 m when it was written. */
const SHINJUKU: EntryPlace = {
  name: { value: "Shinjuku, Tokyo", language: "en" },
  locality: "Tokyo",
  country: "JP",
  geo: { lat: 35.6938, long: 139.7034, precisionMeters: 500 },
};

/** What the three controls hold when nobody has opened them: the entry's own
 *  values, because the editor seeds them from the entry. */
const asTyped = (place: EntryPlace) =>
  placeTextOf(
    {
      placeName: place.name?.value ?? "",
      locality: place.locality ?? "",
      country: place.country ?? "",
    },
    place.name?.language ?? "en",
  );

/** `placeFor`'s answer, asserted to be a place at all: the return is optional
 *  and the "nothing left in it" case has its own assertions below. */
function some(place: EntryPlace | undefined): EntryPlace {
  expect(place).toBeDefined();
  return place as EntryPlace;
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. `placeFor` — untouched, replaced, removed, and the four fields moving
 * independently: ./notes.md#untouched-replaced-removed
 * ══════════════════════════════════════════════════════════════════════════ */

describe("placeFor — untouched", () => {
  it("carries a stored place through unchanged when the form re-supplies it", () => {
    // What an edit that touched neither coordinate box looks like: the geometry
    // is the entry's own, so nothing is re-snapped and the pin does not walk.
    expect(placeFor(SHINJUKU, SHINJUKU.geo, asTyped(SHINJUKU))).toEqual(SHINJUKU);
  });

  it("keeps a field this form does not hold", () => {
    // Hypothetical today — `Place` has exactly four fields — and the spread of
    // `existing` is what would keep a fifth from being dropped by every save.
    const withFifth = { ...SHINJUKU, sortOrder: 3 } as unknown as EntryPlace;
    expect(some(placeFor(withFifth, SHINJUKU.geo, asTyped(SHINJUKU)))).toMatchObject({
      sortOrder: 3,
    });
  });
});

describe("placeFor — replaced", () => {
  it("takes this save's geometry over the stored one", () => {
    const fuzzed = { lat: 35.69, long: 139.7, precisionMeters: 1000 };
    expect(some(placeFor(SHINJUKU, fuzzed, asTyped(SHINJUKU))).geo).toEqual(fuzzed);
  });

  it("takes this save's text over the stored text", () => {
    const renamed = placeTextOf({ placeName: "Kyoto", locality: "Kyoto", country: "JP" }, "en");
    expect(some(placeFor(SHINJUKU, SHINJUKU.geo, renamed))).toEqual({
      name: { value: "Kyoto", language: "en" },
      locality: "Kyoto",
      country: "JP",
      geo: SHINJUKU.geo,
    });
  });

  it("builds a place from nothing on a create", () => {
    const typed = placeTextOf({ placeName: "Shinjuku", locality: "", country: "" }, "en");
    expect(some(placeFor(undefined, undefined, typed))).toEqual({
      name: { value: "Shinjuku", language: "en" },
      locality: undefined,
      country: undefined,
      geo: undefined,
    });
  });
});

describe("placeFor — removed", () => {
  it("reads an undefined geometry as a removal, not as an omission", () => {
    // §9 step 2's drop. If this were an omission, a coordinate would survive
    // on a world-readable resource that the owner asked to have taken down.
    expect(some(placeFor(SHINJUKU, undefined, asTyped(SHINJUKU))).geo).toBeUndefined();
  });

  it("leaves the name standing when the geometry goes", () => {
    // §9: "it is the geometry that is absent, not the entry."
    const dropped = some(placeFor(SHINJUKU, undefined, asTyped(SHINJUKU)));
    expect(dropped).toMatchObject({ name: SHINJUKU.name, locality: "Tokyo", country: "JP" });
  });

  it("leaves the geometry standing when the three text boxes are emptied", () => {
    const emptied = placeTextOf({ placeName: "", locality: "", country: "" }, "en");
    const kept = some(placeFor(SHINJUKU, SHINJUKU.geo, emptied));
    expect(kept.geo).toEqual(SHINJUKU.geo);
    expect(kept.name).toBeUndefined();
    expect(kept.locality).toBeUndefined();
    expect(kept.country).toBeUndefined();
  });

  it("removes one text field without taking the other two", () => {
    const partial = placeTextOf({ placeName: "", locality: "Tokyo", country: "JP" }, "en");
    expect(some(placeFor(SHINJUKU, SHINJUKU.geo, partial))).toMatchObject({
      name: undefined,
      locality: "Tokyo",
      country: "JP",
    });
  });

  it("answers no place at all when nothing is left in it", () => {
    // Rather than a `<#place>` node asserting nothing.
    const emptied = placeTextOf({ placeName: "", locality: "", country: "" }, "en");
    expect(placeFor(SHINJUKU, undefined, emptied)).toBeUndefined();
    expect(placeFor(undefined, undefined, emptied)).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. `placeTextOf` — the one place `""` and `undefined` are translated
 * between, on three fields that want three different things (§7.3).
 * ══════════════════════════════════════════════════════════════════════════ */

describe("placeTextOf", () => {
  it("reads an empty box as a removal on all three fields", () => {
    expect(placeTextOf({ placeName: "", locality: "", country: "" }, "en")).toEqual({
      name: undefined,
      locality: undefined,
      country: undefined,
    });
  });

  it("reads a box holding only spaces as a removal too", () => {
    // Measured, and nothing downstream would catch it: `Place.name` is
    // `min(1)`, so `" "` parses and publishes `schema:name " "@en` — a name
    // that renders as nothing and that a `value === ""` check never finds.
    expect(placeTextOf({ placeName: " ", locality: "  ", country: " " }, "en")).toEqual({
      name: undefined,
      locality: undefined,
      country: undefined,
    });
  });

  it("trims what it keeps", () => {
    expect(
      placeTextOf({ placeName: "  Shinjuku ", locality: " Tokyo ", country: " JP " }, "en"),
    ).toEqual({ name: { value: "Shinjuku", language: "en" }, locality: "Tokyo", country: "JP" });
  });

  it("tags the name with the entry's own language rather than a fixed one", () => {
    expect(placeTextOf({ placeName: "新宿", locality: "", country: "" }, "ja").name).toEqual({
      value: "新宿",
      language: "ja",
    });
  });

  it("leaves the locality and the country untagged here", () => {
    // The locality is tagged at serialisation; the country is a CODE and stays
    // untagged, because `"JP"@en` is a different RDF term from `"JP"` and every
    // consumer filtering on the plain literal would stop matching (§7.3).
    const text = placeTextOf({ placeName: "Shinjuku", locality: "Tokyo", country: "JP" }, "en");
    expect(text.locality).toBe("Tokyo");
    expect(text.country).toBe("JP");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. The precision select: `gridOf` reads it, `precisionLabel` renders it,
 * `PRECISION_GRIDS` is what it offers besides the owner's own default.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("gridOf", () => {
  it("accepts a value the select does not offer", () => {
    // Not fenced to `PRECISION_GRIDS`: the owner's own default arrives from
    // their settings and can be any positive integer of metres.
    expect(gridOf("250")).toBe(250);
    expect(PRECISION_GRIDS).not.toContain(250);
  });

  it("accepts each value the select does offer", () => {
    for (const grid of PRECISION_GRIDS) expect(gridOf(String(grid))).toBe(grid);
  });

  it("answers null for a box holding nothing", () => {
    expect(gridOf("")).toBeNull();
    expect(gridOf("   ")).toBeNull();
  });

  it("refuses a fractional metre rather than rounding on the owner's behalf", () => {
    // `dy:precisionMeters` is `xsd:integer` (§6), so this is a refusal rather
    // than a display question.
    expect(gridOf("1.5")).toBeNull();
    expect(gridOf("999.999")).toBeNull();
  });

  it("refuses zero, a negative grid, prose and infinity", () => {
    for (const bad of ["0", "-100", "banana", "Infinity", "NaN"])
      expect(gridOf(bad), bad).toBeNull();
  });

  it("tolerates the surrounding whitespace and the exponent Number tolerates", () => {
    // TODAY'S BEHAVIOUR, recorded because it is `Number`'s and not a decision:
    // nothing in the editor can produce either, since the value comes from a
    // select whose options this module supplies.
    expect(gridOf(" 250 ")).toBe(250);
    expect(gridOf("1e3")).toBe(1000);
  });
});

describe("PRECISION_GRIDS", () => {
  it("offers whole positive metres, in ascending order", () => {
    expect([...PRECISION_GRIDS]).toEqual([...PRECISION_GRIDS].sort((a, b) => a - b));
    for (const grid of PRECISION_GRIDS) {
      expect(Number.isInteger(grid), String(grid)).toBe(true);
      expect(grid, String(grid)).toBeGreaterThan(0);
    }
  });

  it("offers no exact option, which is a decision rather than an omission", () => {
    // `fuzzForPublication` has no exact mode, and going around it goes around
    // the home-region drop. What it would take is an open item:
    // ./notes.md#no-exact-option-and-what-it-would-take
    expect(PRECISION_GRIDS).not.toContain(0);
    expect(gridOf("0")).toBeNull();
  });
});

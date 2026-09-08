/**
 * The owner accepting a draft: thirteen setters and a credit call, as one
 * transition. What it credits is what stops the next photo overwriting it.
 */
import { describe, expect, it } from "vitest";
import { applyPhotoCoordinate, applyPhotoTimestamp } from "./apply-photo-offer";
import { applyRestore } from "./apply-restore";
import type { EntryFormState, RestoreContext } from "./actions";
import type { Draft } from "@/lib/studio/drafts";

/** An untouched create, with this machine's offset in the control. */
const opened: EntryFormState = {
  tripIri: "",
  slug: "",
  headline: "",
  story: "",
  occurred: "",
  offset: "+02:00",
  tagsText: "",
  mode: "",
  status: "draft",
  lat: "",
  long: "",
  precision: "",
  placeName: "",
  locality: "",
  country: "",
  slots: [],
  coordinateAuthor: { kind: "nobody" },
  occurredAuthor: { kind: "nobody" },
  offsetAuthor: { kind: "nobody" },
  offsetGuess: false,
};

/** An edit, as `EntryEditor` seeds it: the place text is the entry's. */
const editing: EntryFormState = {
  ...opened,
  placeName: "Yanaka Ginza",
  locality: "Taito",
  country: "JP",
  occurred: "2026-04-10T18:00",
  coordinateAuthor: { kind: "owner" },
  occurredAuthor: { kind: "owner" },
  offsetAuthor: { kind: "owner" },
};

const full: Draft = {
  tripIri: "https://pod.example/travel/japan-2026/trip.ttl#it",
  slug: "2026-04-11-morning",
  headline: "Morning in Yanaka",
  story: "Coffee, then the cemetery.",
  occurred: "2026-04-11T07:05",
  offset: "+09:00",
  tagsText: "walking, morning",
  mode: "Train",
  status: "published",
  lat: "35.7205",
  long: "139.7658",
  precision: "500",
  placeName: "Yanaka Ginza",
  locality: "Taito",
  country: "JP",
  photos: [],
};

const context: RestoreContext = {
  addressFixed: false,
  tripIris: [full.tripIri],
  presetPrecision: "500",
};

const restore = (state: EntryFormState, draft: Draft, over: Partial<RestoreContext> = {}) =>
  applyRestore(state, { kind: "restore", draft, context: { ...context, ...over } });

describe("applyRestore — the fields", () => {
  it("puts every one of them back", () => {
    const next = restore(opened, full);
    expect(next).toMatchObject({
      tripIri: full.tripIri,
      slug: full.slug,
      headline: full.headline,
      story: full.story,
      occurred: full.occurred,
      offset: full.offset,
      tagsText: full.tagsText,
      mode: "Train",
      status: "published",
      lat: full.lat,
      long: full.long,
      precision: "500",
      placeName: "Yanaka Ginza",
      locality: "Taito",
      country: "JP",
    });
  });

  it("leaves the trip and the slug alone where they are the address (§11 guardrail 7)", () => {
    const next = restore(opened, full, { addressFixed: true });
    expect(next.tripIri, "a restore wrote through a control the resource lives at").toBe("");
    expect(next.slug).toBe("");
    expect(next.headline, "the rest of the draft did not come back").toBe(full.headline);
  });

  it("leaves the picker unchosen for a trip that is no longer on offer", () => {
    const next = restore(opened, full, { tripIris: [] });
    expect(next.tripIri).toBe("");
  });

  it("refuses a precision the control cannot show, and falls back to §7.6's", () => {
    // `gridOf` is a SHAPE, not the option list — `precisionOptions` unions
    // whatever the form holds into the select, so an unlisted 37 still shows.
    // What cannot show is a draft kept while the settings were unreadable, and
    // anything a hand-edited payload put there.
    for (const unusable of ["", "banana", "0", "12.5"]) {
      expect(
        restore(opened, { ...full, precision: unusable }).precision,
        `${JSON.stringify(unusable)} reached the control`,
      ).toBe("500");
    }
    expect(restore(opened, { ...full, precision: "37" }).precision).toBe("37");
    expect(restore(opened, { ...full, precision: "1000" }).precision).toBe("1000");
    // No settings to fall back to, so the control stays empty rather than
    // taking a distance this project would be choosing for someone else.
    expect(restore(opened, { ...full, precision: "" }, { presetPrecision: "" }).precision).toBe("");
  });

  it("restores an offset by SHAPE, not by the list", () => {
    expect(restore(opened, { ...full, offset: "+05:15" }).offset).toBe("+05:15");
  });

  it("leaves the control showing what it shows when the draft has no offset", () => {
    for (const nothing of ["", "banana"]) {
      const next = restore(opened, { ...full, offset: nothing });
      expect(next.offset, `${JSON.stringify(nothing)} was written through`).toBe(opened.offset);
    }
  });

  it("keeps an absent place field, and empties an emptied one", () => {
    const older = { ...full, placeName: undefined, locality: undefined, country: undefined };
    expect(restore(editing, older)).toMatchObject({
      placeName: "Yanaka Ginza",
      locality: "Taito",
      country: "JP",
    });
    expect(restore(editing, { ...full, placeName: "", locality: "", country: "" })).toMatchObject({
      placeName: "",
      locality: "",
      country: "",
    });
  });

  it("brings the photos back as ready slots, already on the Pod", () => {
    const photos = [
      { contentUrl: "https://pod.example/travel/media/abc/web.jpg" },
      {
        contentUrl: "https://pod.example/travel/media/def/web.jpg",
        caption: { value: "The cat", language: "en" },
      },
    ];
    const next = restore(opened, { ...full, photos });
    expect(next.slots).toEqual([
      { key: "restored-0", name: "Photo 1", state: "ready", photo: photos[0] },
      { key: "restored-1", name: "The cat", state: "ready", photo: photos[1] },
    ]);
  });
});

/* ─── the credits, which is what a restore is FOR ────────────────────────── */

describe("applyRestore — a restored value is the owner's", () => {
  it("credits the owner for the clock, the offset and the pair it carried", () => {
    const next = restore(opened, full);
    expect(next.occurredAuthor, "the restored clock reads as nobody's").toEqual({ kind: "owner" });
    expect(next.offsetAuthor, "the restored offset reads as nobody's").toEqual({ kind: "owner" });
    expect(next.coordinateAuthor, "the restored pair reads as nobody's").toEqual({ kind: "owner" });
    expect(next.offsetGuess, "a restored offset came back marked as a guess").toBe(false);
  });

  it("is what stops the next photo taking the timestamp back", () => {
    // The whole point: `restore()` writes the controls with no DOM event, so it
    // comes through neither `onChange`. Without the credit a photo attached
    // afterwards takes both halves — §11.3's overwrite by the one path that
    // does not look like typing.
    const next = applyPhotoTimestamp(restore(opened, full), {
      kind: "photo-timestamp",
      key: "photo-0",
      name: "later.jpg",
      wall: "2026-04-11T23:41",
      offset: "+12:45",
    });
    expect(next.occurred).toBe(full.occurred);
    expect(next.offset).toBe(full.offset);
  });

  it("is what stops the next photo taking the coordinate back", () => {
    const next = applyPhotoCoordinate(restore(opened, full), {
      kind: "photo-coordinate",
      name: "later.jpg",
      lat: "-43.95",
      long: "-176.55",
    });
    expect([next.lat, next.long]).toEqual([full.lat, full.long]);
  });

  it("leaves the clock open when the draft carried no date", () => {
    // The common case, and marking it the owner's would switch auto-date off
    // for the rest of the session.
    const next = restore(opened, { ...full, occurred: "" });
    expect(next.occurredAuthor).toEqual({ kind: "nobody" });
  });

  it("leaves the coordinate open when the draft carried no pair", () => {
    const next = restore(opened, { ...full, lat: "", long: "" });
    expect(next.coordinateAuthor).toEqual({ kind: "nobody" });
    // Half a pair is still something the owner put there.
    expect(restore(opened, { ...full, long: "" }).coordinateAuthor).toEqual({ kind: "owner" });
  });

  it("keeps the offset's author where the draft has nothing to say", () => {
    // `setOffset` writes only for a shape-valid payload, so when it has nothing
    // to say the control keeps its value AND the record keeps its author.
    const photographed: EntryFormState = {
      ...opened,
      offset: "+09:00",
      offsetAuthor: { kind: "photo", key: "photo-0", name: "first.jpg" },
    };
    const next = restore(photographed, { ...full, offset: "" });
    expect(next.offsetAuthor).toEqual({ kind: "photo", key: "photo-0", name: "first.jpg" });
  });
});

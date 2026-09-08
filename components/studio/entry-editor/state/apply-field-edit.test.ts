/**
 * A keystroke, and which of the three credits it moves. T4-C and T4-G are the
 * two the DOM suite reaches only through `fireEvent`.
 */
import { describe, expect, it } from "vitest";
import { applyFieldEdit } from "./apply-field-edit";
import type { EntryFormState } from "./actions";

/** A create's opening state, with §11.5's mark already up: a photo dated the
 *  entry and nobody has offset it. */
const marked: EntryFormState = {
  tripIri: "",
  slug: "",
  headline: "",
  story: "",
  occurred: "2026-04-11T07:05",
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
  occurredAuthor: { kind: "photo", key: "photo-0", name: "first.jpg" },
  offsetAuthor: { kind: "nobody" },
  offsetGuess: true,
};

describe("applyFieldEdit — the plain fields", () => {
  it("sets the value and credits nothing", () => {
    const next = applyFieldEdit(marked, { kind: "field", field: "headline", value: "Morning" });
    expect(next.headline).toBe("Morning");
    expect(next.coordinateAuthor).toEqual(marked.coordinateAuthor);
    expect(next.occurredAuthor).toEqual(marked.occurredAuthor);
    expect(next.offsetAuthor).toEqual(marked.offsetAuthor);
    expect(next.offsetGuess, "typing a headline said something about the offset").toBe(true);
  });

  it("carries the two fields whose values are not strings", () => {
    expect(applyFieldEdit(marked, { kind: "mode", value: "Train" }).mode).toBe("Train");
    expect(applyFieldEdit(marked, { kind: "status", value: "published" }).status).toBe("published");
  });

  it("never touches the photos", () => {
    const next = applyFieldEdit(marked, { kind: "field", field: "slug", value: "s" });
    expect(next.slots).toBe(marked.slots);
  });
});

describe("applyFieldEdit — the keystroke is what makes the pair the owner's", () => {
  it("credits the owner for either box, because half a pair is nowhere", () => {
    for (const field of ["lat", "long"] as const) {
      const next = applyFieldEdit(marked, { kind: "field", field, value: "45.5" });
      expect(next[field]).toBe("45.5");
      expect(next.coordinateAuthor).toEqual({ kind: "owner" });
    }
  });

  it("says nothing about the timestamp", () => {
    const next = applyFieldEdit(marked, { kind: "field", field: "lat", value: "45.5" });
    expect(next.occurredAuthor).toEqual(marked.occurredAuthor);
    expect(next.offsetAuthor).toEqual(marked.offsetAuthor);
    expect(next.offsetGuess).toBe(true);
  });
});

describe("applyFieldEdit — the timestamp's two halves stay independent (T4-C)", () => {
  it("credits the clock to the owner and passes the offset's record through", () => {
    const next = applyFieldEdit(marked, {
      kind: "field",
      field: "occurred",
      value: "2026-04-11T07:06",
    });
    expect(next.occurred).toBe("2026-04-11T07:06");
    expect(next.occurredAuthor).toEqual({ kind: "owner" });
    expect(next.offsetAuthor, "the owner correcting WHEN said something about the zone").toEqual({
      kind: "nobody",
    });
  });

  it("leaves the warning standing when the clock is nudged (T4-G)", () => {
    // `07:05` to `07:06` leaves the clock substantially the photo's, and
    // clearing the mark would leave §11.5's composition with the warning gone.
    const next = applyFieldEdit(marked, {
      kind: "field",
      field: "occurred",
      value: "2026-04-11T07:06",
    });
    expect(next.offsetGuess, "a keystroke in the clock cleared the offset's warning").toBe(true);
  });

  it("ends the guess when the offset is chosen, and only then", () => {
    const next = applyFieldEdit(marked, { kind: "field", field: "offset", value: "+09:00" });
    expect(next.offset).toBe("+09:00");
    expect(next.offsetAuthor).toEqual({ kind: "owner" });
    expect(next.offsetGuess).toBe(false);
    expect(next.occurredAuthor, "choosing a zone said something about the clock").toEqual(
      marked.occurredAuthor,
    );
  });

  it("does not put the mark UP when the offset is emptied by a photo-less form", () => {
    // The mark is a record, not a comparison: an owner who chooses the zone
    // they are sitting in must not be told their own choice is a guess.
    const clean = { ...marked, occurredAuthor: { kind: "owner" } as const, offsetGuess: false };
    const next = applyFieldEdit(clean, {
      kind: "field",
      field: "occurred",
      value: "2026-04-11T09:00",
    });
    expect(next.offsetGuess).toBe(false);
  });
});

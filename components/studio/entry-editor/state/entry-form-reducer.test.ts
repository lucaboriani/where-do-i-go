/**
 * The switch, and the one property the switch buys: actions FOLD, so a second
 * photo is handed what the first one returned. ./notes.md#guard-inside-the-transition
 */
import { describe, expect, it } from "vitest";
import { entryFormReducer } from "./entry-form-reducer";
import type { EntryFormAction, EntryFormState, PhotoSlot, SectionDraft } from "./actions";

const blank: EntryFormState = {
  tripIri: "",
  slug: "",
  headline: "",
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
  sections: [{ id: "sec-0", text: "", slots: [] }],
  coordinateAuthor: { kind: "nobody" },
  occurredAuthor: { kind: "nobody" },
  offsetAuthor: { kind: "nobody" },
  offsetGuess: false,
};

/** A state with the sections handed in, otherwise blank. */
const withSections = (...sections: SectionDraft[]): EntryFormState => ({ ...blank, sections });

/** What React does with a queue of actions, which is the whole point. */
const fold = (from: EntryFormState, ...actions: EntryFormAction[]) =>
  actions.reduce(entryFormReducer, from);

describe("entryFormReducer — routing", () => {
  it("sends each kind to its own transition", () => {
    expect(fold(blank, { kind: "field", field: "headline", value: "Hi" }).headline).toBe("Hi");
    expect(fold(blank, { kind: "mode", value: "Bus" }).mode).toBe("Bus");
    expect(fold(blank, { kind: "status", value: "published" }).status).toBe("published");
    expect(
      fold(blank, { kind: "photo-coordinate", name: "a.jpg", lat: "1.5", long: "2.5" }).lat,
    ).toBe("1.5");
    expect(
      fold(blank, { kind: "photo-timestamp", key: "photo-0", name: "a.jpg", offset: "+09:00" })
        .offset,
    ).toBe("+09:00");
  });

  it("refuses an action it does not know, rather than returning the state", () => {
    // The `never` binding makes a NEW action a compile error; this is the
    // runtime half, and a silent no-op is what it exists not to be.
    const unknown = { kind: "field-typo" } as unknown as EntryFormAction;
    expect(() => entryFormReducer(blank, unknown)).toThrow(/unhandled action/);
  });
});

/* ─── the sections: the text, and the three list moves ───────────────────── */

describe("entryFormReducer — a section's text", () => {
  const two = withSections(
    { id: "a", text: "First", slots: [] },
    { id: "b", text: "Second", slots: [] },
  );

  it("sets the named section's text and leaves every other one alone", () => {
    const next = entryFormReducer(two, { kind: "section-text", id: "b", value: "Rewritten" });
    expect(next.sections.map((s) => s.text)).toEqual(["First", "Rewritten"]);
    // Identity untouched: reorder relies on the id staying with the section.
    expect(next.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("ignores a section-text for an id that is no longer held", () => {
    expect(entryFormReducer(two, { kind: "section-text", id: "gone", value: "X" }).sections).toEqual(
      two.sections,
    );
  });
});

describe("entryFormReducer — adding and removing a section", () => {
  it("appends an empty section with a fresh, unique id", () => {
    const start = withSections({ id: "a", text: "First", slots: [] });
    const next = entryFormReducer(start, { kind: "section-added" });
    expect(next.sections).toHaveLength(2);
    const added = next.sections[1];
    expect(added.text, "a new section opens empty").toBe("");
    expect(added.slots, "and with no photos").toEqual([]);
    expect(typeof added.id, "the id is a synthetic string").toBe("string");
    expect(added.id.length).toBeGreaterThan(0);
    expect(added.id, "the id must not collide with a section already present").not.toBe("a");
  });

  it("removes the named section only", () => {
    const three = withSections(
      { id: "a", text: "A", slots: [] },
      { id: "b", text: "B", slots: [] },
      { id: "c", text: "C", slots: [] },
    );
    const next = entryFormReducer(three, { kind: "section-removed", id: "b" });
    expect(next.sections.map((s) => s.id)).toEqual(["a", "c"]);
  });
});

describe("entryFormReducer — moving a section", () => {
  const three = withSections(
    { id: "a", text: "A", slots: [] },
    { id: "b", text: "B", slots: [] },
    { id: "c", text: "C", slots: [] },
  );

  it("moves a section up past its predecessor", () => {
    const next = entryFormReducer(three, { kind: "section-moved", id: "b", dir: "up" });
    expect(next.sections.map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("moves a section down past its successor", () => {
    const next = entryFormReducer(three, { kind: "section-moved", id: "b", dir: "down" });
    expect(next.sections.map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at the ends: the first cannot go up, the last cannot go down", () => {
    expect(
      entryFormReducer(three, { kind: "section-moved", id: "a", dir: "up" }).sections.map((s) => s.id),
      "the first section moved up",
    ).toEqual(["a", "b", "c"]);
    expect(
      entryFormReducer(three, { kind: "section-moved", id: "c", dir: "down" }).sections.map(
        (s) => s.id,
      ),
      "the last section moved down",
    ).toEqual(["a", "b", "c"]);
  });
});

/* ─── the slots, now scoped to the section they belong to ─────────────────── */

describe("entryFormReducer — the slots are a section's, not the form's", () => {
  const decoding = (key: string, name: string): PhotoSlot => ({ key, name, state: "decoding" });
  const two = withSections(
    { id: "a", text: "", slots: [] },
    { id: "b", text: "", slots: [] },
  );

  it("appends to the named section and touches no other", () => {
    const next = fold(
      two,
      { kind: "slot-added", sectionId: "b", slot: decoding("photo-0", "first.jpg") },
      { kind: "slot-added", sectionId: "b", slot: decoding("photo-1", "second.jpg") },
    );
    expect(next.sections[0].slots, "the other section gained a slot").toEqual([]);
    expect(next.sections[1].slots.map((slot) => slot.key)).toEqual(["photo-0", "photo-1"]);
  });

  it("settles the row it names, in the section it names, and leaves the rest", () => {
    const filled = fold(
      two,
      { kind: "slot-added", sectionId: "a", slot: decoding("photo-0", "a.jpg") },
      { kind: "slot-added", sectionId: "b", slot: decoding("photo-1", "b0.jpg") },
      { kind: "slot-added", sectionId: "b", slot: decoding("photo-2", "b1.jpg") },
    );
    const next = entryFormReducer(filled, {
      kind: "slot-settled",
      sectionId: "b",
      key: "photo-2",
      slot: { key: "photo-2", name: "b1.jpg", state: "uploading" },
    });
    expect(next.sections[0].slots.map((s) => s.state)).toEqual(["decoding"]);
    expect(next.sections[1].slots.map((s) => s.state)).toEqual(["decoding", "uploading"]);
  });

  it("ignores a settle for a section that is gone, and one for a key not held", () => {
    expect(
      entryFormReducer(two, {
        kind: "slot-settled",
        sectionId: "gone",
        key: "photo-0",
        slot: decoding("photo-0", "a.jpg"),
      }).sections,
    ).toEqual(two.sections);
  });
});

describe("entryFormReducer — two photo offers in one queue", () => {
  it("gives the second the state the first returned, so the first writer wins", () => {
    // The pure analogue of section 12m. React applies queued actions in order
    // against the accumulated state, which is what replaces the ref read.
    const next = fold(
      blank,
      { kind: "photo-timestamp", key: "photo-0", name: "first.jpg", wall: "2026-04-11T07:05" },
      {
        kind: "photo-timestamp",
        key: "photo-1",
        name: "second.jpg",
        wall: "2026-04-11T23:41",
        offset: "+12:45",
      },
    );
    expect(next.occurred, "the second photo overwrote the first photo's clock").toBe(
      "2026-04-11T07:05",
    );
    expect(
      next.offset,
      "the second photo's zone landed beside the first photo's clock: §11.5's instant that happened nowhere",
    ).toBe(blank.offset);
    expect(next.occurredAuthor).toEqual({ kind: "photo", key: "photo-0", name: "first.jpg" });
    expect(next.offsetGuess).toBe(true);
  });

  it("and both coordinate offers go to the first, not the last", () => {
    const next = fold(
      blank,
      { kind: "photo-coordinate", name: "first.jpg", lat: "35.72", long: "139.76" },
      { kind: "photo-coordinate", name: "second.jpg", lat: "-43.95", long: "-176.55" },
    );
    expect([next.lat, next.long]).toEqual(["35.72", "139.76"]);
    expect(next.coordinateAuthor).toEqual({ kind: "photo", name: "first.jpg" });
  });
});

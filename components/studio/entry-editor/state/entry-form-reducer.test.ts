/**
 * The switch, and the one property the switch buys: actions FOLD, so a second
 * photo is handed what the first one returned. ./notes.md#guard-inside-the-transition
 */
import { describe, expect, it } from "vitest";
import { entryFormReducer } from "./entry-form-reducer";
import type { EntryFormAction, EntryFormState, PhotoSlot } from "./actions";

const blank: EntryFormState = {
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

describe("entryFormReducer — the slots", () => {
  const decoding = (key: string, name: string): PhotoSlot => ({ key, name, state: "decoding" });

  it("appends without reading the list from a render", () => {
    // A wholesale `{ kind: "slots" }` would be built from the slots the render
    // held, and two photos picked at once would each append to the same stale
    // array. ./notes.md#three-deviations-from-the-plans-action-union-each-measured
    const next = fold(
      blank,
      { kind: "slot-added", slot: decoding("photo-0", "first.jpg") },
      { kind: "slot-added", slot: decoding("photo-1", "second.jpg") },
    );
    expect(next.slots.map((slot) => slot.key)).toEqual(["photo-0", "photo-1"]);
  });

  it("settles the row it names and leaves the others alone", () => {
    const two = fold(
      blank,
      { kind: "slot-added", slot: decoding("photo-0", "first.jpg") },
      { kind: "slot-added", slot: decoding("photo-1", "second.jpg") },
    );
    const next = entryFormReducer(two, {
      kind: "slot-settled",
      key: "photo-1",
      slot: { key: "photo-1", name: "second.jpg", state: "uploading" },
    });
    expect(next.slots.map((slot) => slot.state)).toEqual(["decoding", "uploading"]);
  });

  it("ignores a settle for a key that is no longer held", () => {
    expect(
      entryFormReducer(blank, {
        kind: "slot-settled",
        key: "gone",
        slot: decoding("gone", "gone.jpg"),
      }).slots,
    ).toEqual([]);
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

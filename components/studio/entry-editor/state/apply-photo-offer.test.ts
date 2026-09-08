/**
 * §11.3 and §11.5 as pure calls: first writer wins per half, the cross-half
 * guard, and the owner outranking every photo. See ./notes.md#guard-inside-the-transition
 */
import { describe, expect, it } from "vitest";
import { applyPhotoCoordinate, applyPhotoTimestamp } from "./apply-photo-offer";
import type { EntryFormState } from "./actions";

/** A create's opening state: nobody has authored anything. */
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

const one = { key: "photo-0", name: "first.jpg" };
const two = { key: "photo-1", name: "second.jpg" };

/** The two actions, spelled once so every case below reads as the offer it is. */
const timed = (of: { key: string; name: string; wall?: string; offset?: string }) =>
  ({ kind: "photo-timestamp", ...of }) as const;
const pinned = (of: { name: string; lat: string; long: string }) =>
  ({ kind: "photo-coordinate", ...of }) as const;

/* ─── the wall clock ─────────────────────────────────────────────────────── */

describe("applyPhotoTimestamp — the wall clock, first writer wins", () => {
  it("fills a clock nobody has supplied, and credits the photo by name", () => {
    const next = applyPhotoTimestamp(blank, timed({ ...one, wall: "2026-04-11T07:05:33" }));
    expect(next.occurred, "the clock was not filled to the minute").toBe("2026-04-11T07:05");
    expect(next.occurredAuthor).toEqual({ kind: "photo", ...one });
    // The half the photo said nothing about is untouched, and still nobody's.
    expect(next.offset).toBe(blank.offset);
    expect(next.offsetAuthor).toEqual({ kind: "nobody" });
  });

  it("refuses a clock an earlier photo already supplied", () => {
    const first = applyPhotoTimestamp(blank, timed({ ...one, wall: "2026-04-11T07:05" }));
    const second = applyPhotoTimestamp(first, timed({ ...two, wall: "2026-04-11T23:41" }));
    expect(second.occurred, "the second photo overwrote the first photo's clock").toBe(
      "2026-04-11T07:05",
    );
    expect(
      second.occurredAuthor,
      "the credit names the photo whose clock is not in the box",
    ).toEqual({ kind: "photo", ...one });
  });

  it("refuses a clock the owner typed", () => {
    const owned = {
      ...blank,
      occurred: "2026-04-11T09:00",
      occurredAuthor: { kind: "owner" } as const,
    };
    const next = applyPhotoTimestamp(owned, timed({ ...one, wall: "2026-04-11T07:05" }));
    expect(next.occurred).toBe("2026-04-11T09:00");
    expect(next.occurredAuthor).toEqual({ kind: "owner" });
  });
});

/* ─── the offset ─────────────────────────────────────────────────────────── */

describe("applyPhotoTimestamp — the offset, first writer wins", () => {
  it("fills an offset nobody has supplied", () => {
    const next = applyPhotoTimestamp(blank, timed({ ...one, offset: "+09:00" }));
    expect(next.offset).toBe("+09:00");
    expect(next.offsetAuthor).toEqual({ kind: "photo", ...one });
    // A photo that carried no clock has said nothing about the clock, so it
    // marks nothing: the mark reads "a photo dated it and nobody offset it".
    expect(next.occurred).toBe("");
    expect(next.offsetGuess).toBe(false);
  });

  it("refuses an offset an earlier photo already supplied", () => {
    const first = applyPhotoTimestamp(blank, timed({ ...one, offset: "+09:00" }));
    const second = applyPhotoTimestamp(first, timed({ ...two, offset: "+12:45" }));
    expect(second.offset).toBe("+09:00");
    expect(second.offsetAuthor).toEqual({ kind: "photo", ...one });
  });

  it("refuses an offset the owner chose", () => {
    const chosen = { ...blank, offset: "+09:00", offsetAuthor: { kind: "owner" } as const };
    const next = applyPhotoTimestamp(chosen, timed({ ...one, offset: "+12:45" }));
    expect(next.offset).toBe("+09:00");
    expect(next.offsetAuthor).toEqual({ kind: "owner" });
  });

  it("refuses an offset that is shape-valid and impossible (F4), both ways", () => {
    // `+99:99` is 6 039 minutes east of Greenwich; `+05:61` composes to 361,
    // comfortably inside ±840. exif.ts's regex accepts both.
    for (const impossible of ["+99:99", "+05:61", "-14:30"]) {
      const next = applyPhotoTimestamp(blank, timed({ ...one, offset: impossible }));
      expect(next.offset, `${impossible} reached the control`).toBe(blank.offset);
      expect(next.offsetAuthor).toEqual({ kind: "nobody" });
    }
    expect(applyPhotoTimestamp(blank, timed({ ...one, offset: "+14:00" })).offset).toBe("+14:00");
  });
});

/* ─── the cross-half guard, T4-E and F1 ──────────────────────────────────── */

describe("applyPhotoTimestamp — two photos' halves never compose (§11.5)", () => {
  it("refuses a clock beside ANOTHER photo's offset", () => {
    const zoned = applyPhotoTimestamp(blank, timed({ ...one, offset: "+12:45" }));
    const next = applyPhotoTimestamp(zoned, timed({ ...two, wall: "2026-04-11T07:05" }));
    expect(next.occurred, "photo A's clock landed beside photo B's zone").toBe("");
    expect(next.occurredAuthor).toEqual({ kind: "nobody" });
  });

  it("refuses an offset beside ANOTHER photo's clock", () => {
    const clocked = applyPhotoTimestamp(blank, timed({ ...one, wall: "2026-04-11T07:05" }));
    const next = applyPhotoTimestamp(clocked, timed({ ...two, offset: "+12:45" }));
    expect(next.offset, "photo B's zone landed beside photo A's clock").toBe(blank.offset);
    expect(next.offsetAuthor).toEqual({ kind: "nobody" });
    expect(next.offsetGuess, "the composition cleared the mark on photo A's clock").toBe(true);
  });

  it("lets ONE photo supply both halves, which the same-key comparison is for", () => {
    const next = applyPhotoTimestamp(
      blank,
      timed({
        ...one,
        wall: "2026-04-11T07:05",
        offset: "+09:00",
      }),
    );
    expect(next.occurred).toBe("2026-04-11T07:05");
    expect(next.offset).toBe("+09:00");
    expect(next.occurredAuthor).toEqual({ kind: "photo", ...one });
    expect(next.offsetAuthor).toEqual({ kind: "photo", ...one });
    expect(next.offsetGuess, "the photo answered the offset, so nothing is a guess").toBe(false);
  });

  it("asks on `key` and not on `name`: two cameras share a first-photo name", () => {
    // F1. The guard compared file names for a day, and two cameras both calling
    // their first photo `IMG_0001.jpg` walked back through it as one file.
    const collide = { key: "photo-1", name: "IMG_0001.jpg" };
    const first = applyPhotoTimestamp(
      blank,
      timed({ key: "photo-0", name: "IMG_0001.jpg", wall: "2026-04-11T07:05" }),
    );
    const next = applyPhotoTimestamp(first, timed({ ...collide, offset: "+12:45" }));
    expect(
      next.offset,
      "the second camera's zone was accepted because the two files share a name",
    ).toBe(blank.offset);
    expect(next.offsetAuthor).toEqual({ kind: "nobody" });
  });
});

/* ─── the mark, §11.5's own state ────────────────────────────────────────── */

describe("applyPhotoTimestamp — the guess mark", () => {
  it("goes on when a photo dates an entry and nobody has offset it", () => {
    const next = applyPhotoTimestamp(blank, timed({ ...one, wall: "2026-04-11T07:05" }));
    expect(next.offsetGuess).toBe(true);
  });

  it("stays off on an edit whose stored offset is the owner's", () => {
    const edit = { ...blank, offsetAuthor: { kind: "owner" } as const };
    const next = applyPhotoTimestamp(edit, timed({ ...one, wall: "2026-04-11T07:05" }));
    expect(next.offsetGuess, "a photo that lacked the tag cast doubt on confirmed data").toBe(
      false,
    );
  });

  it("says nothing about a photo that carried neither tag", () => {
    expect(applyPhotoTimestamp(blank, timed(one))).toEqual(blank);
  });
});

/* ─── the coordinate, §11.3 ──────────────────────────────────────────────── */

describe("applyPhotoCoordinate — first writer wins", () => {
  const gps = { lat: "35.6938", long: "139.7034" };

  it("fills a pair nobody has supplied, at full precision", () => {
    const next = applyPhotoCoordinate(blank, pinned({ name: one.name, ...gps }));
    expect([next.lat, next.long]).toEqual([gps.lat, gps.long]);
    expect(next.coordinateAuthor).toEqual({ kind: "photo", name: one.name });
  });

  it("refuses a pair an earlier photo already supplied", () => {
    const first = applyPhotoCoordinate(blank, pinned({ name: one.name, ...gps }));
    const second = applyPhotoCoordinate(
      first,
      pinned({ name: two.name, lat: "-43.9", long: "-176.5" }),
    );
    expect([second.lat, second.long]).toEqual([gps.lat, gps.long]);
    expect(second.coordinateAuthor).toEqual({ kind: "photo", name: one.name });
  });

  it("refuses a pair the owner typed", () => {
    const typed = {
      ...blank,
      lat: "45.5",
      long: "9.2",
      coordinateAuthor: { kind: "owner" } as const,
    };
    const next = applyPhotoCoordinate(typed, pinned({ name: one.name, ...gps }));
    expect([next.lat, next.long]).toEqual(["45.5", "9.2"]);
    expect(next.coordinateAuthor).toEqual({ kind: "owner" });
  });

  it("refuses an edit's empty boxes, because the stored pair stands (T3-B)", () => {
    const edit = { ...blank, coordinateAuthor: { kind: "owner" } as const };
    const next = applyPhotoCoordinate(edit, pinned({ name: one.name, ...gps }));
    expect([next.lat, next.long], "a photo moved a pin the edit was loaded with").toEqual(["", ""]);
  });

  it("leaves the timestamp's two records alone", () => {
    const next = applyPhotoCoordinate(blank, pinned({ name: one.name, ...gps }));
    expect(next.occurredAuthor).toEqual({ kind: "nobody" });
    expect(next.offsetAuthor).toEqual({ kind: "nobody" });
    expect(next.offsetGuess).toBe(false);
  });
});

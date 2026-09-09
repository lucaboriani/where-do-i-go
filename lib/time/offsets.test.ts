/**
 * The offset arithmetic behind `dy:occurredAt` (§7.3), asserted directly.
 *
 * These functions were reachable only through the editor's DOM until Stage B.
 * Why that mattered: ./notes.md#tested-through-the-dom-until-now
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import {
  LOCAL_DATETIME,
  OFFSETS,
  OFFSET_SHAPE,
  TRAILING_OFFSET,
  nowWithOffset,
  offsetHere,
  offsetMinutes,
  offsetOf,
  pad,
  toOffsetDateTime,
  wallClockNow,
  wallClockOf,
} from "@/lib/time/offsets";

/** +10:30 in winter and +11:00 in summer, so the minutes half and the
 *  "computed at the instant" claim are both checkable, and neither is the
 *  developer's own zone: ./notes.md#the-clock-this-file-runs-on */
const REAL_TZ = process.env.TZ;
process.env.TZ = "Australia/Lord_Howe";
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

/** The instant every fake-timer case below sits at: 12:00 local on Lord Howe
 *  in its daylight half, which is 01:00Z. Local and UTC differ in the DATE
 *  digits too at some hours; this one differs only in the clock. */
const SUMMER_NOON_UTC = "2026-01-15T01:00:00.000Z";

/* ══════════════════════════════════════════════════════════════════════════
 * 0. The pin itself. A zone assignment that stopped taking effect would make
 * every offset below the machine's own, silently.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("the clock this file runs on", () => {
  it("is Lord Howe, not the machine's", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Australia/Lord_Howe");
  });

  it("has a daylight half, which is what makes offsetHere's date argument mean anything", () => {
    expect(new Date("2026-01-15T12:00").getTimezoneOffset()).toBe(-660);
    expect(new Date("2026-07-15T12:00").getTimezoneOffset()).toBe(-630);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. `pad` and `offsetMinutes` — four lines of string arithmetic each, and
 * the comparator the offset select is ordered by.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("pad", () => {
  it("gives every number two digits", () => {
    expect(pad(0)).toBe("00");
    expect(pad(9)).toBe("09");
    expect(pad(45)).toBe("45");
  });

  it("does not truncate a number already wider than two", () => {
    expect(pad(100)).toBe("100");
  });
});

describe("offsetMinutes", () => {
  it("reads both halves of a non-whole-hour zone", () => {
    // The defect this catches: reading the hours and dropping the minutes,
    // which makes Nepal, Eucla and the Chathams sort as whole hours.
    expect(offsetMinutes("+05:45")).toBe(345);
    expect(offsetMinutes("+08:45")).toBe(525);
    expect(offsetMinutes("-09:30")).toBe(-570);
    expect(offsetMinutes("+12:45")).toBe(765);
  });

  it("does not agree with the same zone's whole hour", () => {
    expect(offsetMinutes("+05:45")).not.toBe(offsetMinutes("+05:00"));
  });

  it("applies the sign to the whole offset, not to the hours alone", () => {
    // -(9 * 60 + 30), never -(9 * 60) + 30. The second spelling is -510 and
    // orders the Marquesas on the wrong side of half an hour.
    expect(offsetMinutes("-09:30")).toBe(-570);
    expect(offsetMinutes("-03:30")).toBe(-210);
  });

  it("answers zero for both ends of the meridian and reaches both ends of the world", () => {
    expect(offsetMinutes("+00:00")).toBe(0);
    expect(offsetMinutes("-12:00")).toBe(-720);
    expect(offsetMinutes("+14:00")).toBe(840);
  });

  it("is a sort key, so a listed offset never exceeds the editor's own ±840 fence", () => {
    for (const offset of OFFSETS) expect(Math.abs(offsetMinutes(offset))).toBeLessThanOrEqual(840);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. `toOffsetDateTime` — the form's two controls to one `xsd:dateTime`.
 * §7.3: the wall clock is COPIED, and normalising to UTC destroys the fact
 * that it was evening.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("toOffsetDateTime", () => {
  it("supplies the seconds a datetime-local control does not", () => {
    expect(toOffsetDateTime("2026-03-29T21:40", "+09:00")).toBe("2026-03-29T21:40:00+09:00");
  });

  it("passes seconds through when the control did supply them", () => {
    expect(toOffsetDateTime("2026-03-29T21:40:07", "+09:00")).toBe("2026-03-29T21:40:07+09:00");
  });

  it("copies the wall clock rather than recomputing it", () => {
    // Three offsets, one wall clock, and 21:40 in all three: the value is
    // never routed through a `Date`, so this machine's +11:00 cannot reach it.
    for (const offset of ["+09:00", "-09:30", "+14:00"])
      expect(toOffsetDateTime("2026-03-29T21:40", offset)).toBe(`2026-03-29T21:40:00${offset}`);
  });

  it("concatenates whatever offset it is given, unlisted ones included", () => {
    expect(toOffsetDateTime("2026-03-29T21:40", "+05:15")).toBe("2026-03-29T21:40:00+05:15");
  });

  it("refuses a half-formed local value rather than guessing at it", () => {
    // Every one of these is a state the control can be in mid-edit, and a
    // guess here would stamp a permanent record with an invented instant.
    for (const half of ["", "2026-03-29", "2026-03-29T", "2026-03-29T21", "2026-03-29T21:4"])
      expect(toOffsetDateTime(half, "+09:00"), half).toBeUndefined();
  });

  it("refuses a value that already carries an offset, and one carrying millis", () => {
    expect(toOffsetDateTime("2026-03-29T21:40+09:00", "+09:00")).toBeUndefined();
    expect(toOffsetDateTime("2026-03-29T21:40:00.500", "+09:00")).toBeUndefined();
  });

  it("refuses prose", () => {
    expect(toOffsetDateTime("banana", "+09:00")).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. `offsetOf` and `wallClockOf` — a stored timestamp back into the two
 * controls, without shifting either half into this machine's zone.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("offsetOf", () => {
  it("reads the offset a stored timestamp carries", () => {
    expect(offsetOf("2026-03-29T21:40:00+09:00")).toBe("+09:00");
    expect(offsetOf("2026-03-29T21:40:00-09:30")).toBe("-09:30");
  });

  it("normalises a stored Z onto the explicit spelling", () => {
    // §6 and lib/pod/rdf.ts want `+00:00`; `OFFSETS` offers no `Z` at all, so
    // returning one would blank the control on every UTC-stamped entry.
    expect(offsetOf("2026-03-29T21:40:00Z")).toBe("+00:00");
  });

  it("answers undefined for an absent value and for one with no offset on it", () => {
    expect(offsetOf(undefined)).toBeUndefined();
    expect(offsetOf("2026-03-29T21:40:00")).toBeUndefined();
    expect(offsetOf("2026-03-29")).toBeUndefined();
  });
});

describe("wallClockOf", () => {
  it("slices a stored timestamp to the minute the control accepts", () => {
    expect(wallClockOf("2026-03-29T21:40:00+09:00")).toBe("2026-03-29T21:40");
  });

  it("shows the clock as stored rather than as this machine would read it", () => {
    // 21:40+09:00 is 23:40 on Lord Howe in January. The control says 21:40,
    // because §7.3's offset is the place's and the reader's is irrelevant.
    expect(wallClockOf("2026-01-15T21:40:00+09:00")).toBe("2026-01-15T21:40");
  });

  it("answers the empty string for an absent value, which is what a create holds", () => {
    expect(wallClockOf(undefined)).toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. `offsetHere`, `wallClockNow`, `nowWithOffset` — the three that read the
 * machine, and the only three that need the zone pin above.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("offsetHere", () => {
  it("answers for the instant asked about, not for today", () => {
    // The daylight half and the standard half of one zone, one machine, one
    // call each — which is the whole reason it takes an argument.
    expect(offsetHere("2026-01-15T12:00")).toBe("+11:00");
    expect(offsetHere("2026-07-15T12:00")).toBe("+10:30");
  });

  it("answers +00:00 for a wall clock it cannot parse, which is not this zone", () => {
    // Measured, and the reason `wallClockNow` exists: seeding the offset
    // control from `occurred` on a create would ask about `""` and get UTC,
    // which is a silently wrong offset for every owner outside Greenwich.
    expect(offsetHere("")).toBe("+00:00");
    expect(offsetHere("banana")).toBe("+00:00");
  });

  it("always produces something OFFSET_SHAPE accepts", () => {
    for (const wall of ["2026-01-15T12:00", "2026-07-15T12:00", ""])
      expect(OFFSET_SHAPE.test(offsetHere(wall)), wall).toBe(true);
  });
});

describe("wallClockNow", () => {
  it("reads the local clock, to the second, with no offset on it", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(SUMMER_NOON_UTC));
      // 01:00Z is noon on Lord Howe: a UTC-based spelling would say 01:00:00.
      expect(wallClockNow()).toBe("2026-01-15T12:00:00");
      expect(TRAILING_OFFSET.test(wallClockNow())).toBe(false);
      expect(LOCAL_DATETIME.test(wallClockNow())).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pads every field, so the shape holds in single-digit months and hours", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-03-08T22:04:05.000Z"));
      expect(wallClockNow()).toBe("2026-03-09T09:04:05");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("nowWithOffset", () => {
  it("stamps the local wall clock with this machine's own offset", () => {
    // Unlike `dy:occurredAt`, `dcterms:created` and `schema:datePublished` are
    // moments in the owner's life, so the editing machine's zone is right here.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(SUMMER_NOON_UTC));
      expect(nowWithOffset()).toBe("2026-01-15T12:00:00+11:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("never answers a bare wall clock and never a Z", () => {
    const stamp = nowWithOffset();
    expect(TRAILING_OFFSET.test(stamp), stamp).toBe(true);
    expect(stamp.endsWith("Z")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. `OFFSETS` and `OFFSET_SHAPE` — what is offered, and what is merely
 * accepted. The gap between them is deliberate and is an open item:
 * ./notes.md#the-offset-shape-is-wider-than-the-list
 * ══════════════════════════════════════════════════════════════════════════ */

describe("OFFSETS", () => {
  it("offers only values the shape accepts", () => {
    for (const offset of OFFSETS) expect(OFFSET_SHAPE.test(offset), offset).toBe(true);
  });

  it("is in ascending order of minutes, which is not the order a string sort gives", () => {
    // The trap this pins: `-` precedes `+` in ASCII, so a string sort puts the
    // western hemisphere first and then runs it backwards.
    const minutes = OFFSETS.map(offsetMinutes);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect([...OFFSETS].sort()).not.toEqual([...OFFSETS]);
  });

  it("lists each value once", () => {
    expect(new Set(OFFSETS).size).toBe(OFFSETS.length);
  });

  it("spells UTC as +00:00 and offers no Z", () => {
    expect(OFFSETS).toContain("+00:00");
    expect(OFFSETS).not.toContain("Z");
  });

  it("offers only minute values civil zones actually use", () => {
    // A typo like `+05:47` is shape-valid, sorts plausibly, and would be
    // offered to the owner. The names of the odd zones are pinned by
    // ODD_OFFSETS in the editor's own suite; this is the structural half.
    for (const offset of OFFSETS)
      expect([0, 30, 45], offset).toContain(Math.abs(offsetMinutes(offset)) % 60);
  });
});

describe("OFFSET_SHAPE", () => {
  it("accepts a well-formed offset that OFFSETS does not offer", () => {
    // Deliberately wider than the list: an entry written by another tool can
    // carry `+05:15`, and this editor's job is to put it back unchanged.
    expect(OFFSET_SHAPE.test("+05:15")).toBe(true);
    expect(OFFSETS).not.toContain("+05:15");
  });

  it("rejects the spellings that are not this one", () => {
    for (const bad of ["Z", "", "+9:00", "09:00", "+09:00:00", "+09-00", "+09:00 "])
      expect(OFFSET_SHAPE.test(bad), JSON.stringify(bad)).toBe(false);
  });

  it("accepts a minute value no clock has, which is the unpinned width", () => {
    // TODAY'S BEHAVIOUR, NOT AN ENDORSEMENT. The minute-range fence lives in
    // the editor's photo-offset guard rather than here, and restore consults
    // only the shape: ./notes.md#the-offset-shape-is-wider-than-the-list
    expect(OFFSET_SHAPE.test("+05:61")).toBe(true);
    expect(OFFSET_SHAPE.test("+99:99")).toBe(true);
    expect(offsetMinutes("+05:61")).toBe(361);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. The two regexes the functions above are built from, exported because
 * phase 4 reads timestamps this editor wrote.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("LOCAL_DATETIME", () => {
  it("accepts what datetime-local produces, with the seconds optional", () => {
    expect(LOCAL_DATETIME.test("2026-03-29T21:40")).toBe(true);
    expect(LOCAL_DATETIME.test("2026-03-29T21:40:07")).toBe(true);
  });

  it("is anchored at both ends, so nothing may sit either side of it", () => {
    expect(LOCAL_DATETIME.test("2026-03-29T21:40+09:00")).toBe(false);
    expect(LOCAL_DATETIME.test(" 2026-03-29T21:40")).toBe(false);
  });
});

describe("TRAILING_OFFSET", () => {
  it("finds an offset only at the end, and reads Z as one", () => {
    expect(TRAILING_OFFSET.test("2026-03-29T21:40:00Z")).toBe(true);
    expect(TRAILING_OFFSET.test("2026-03-29T21:40:00+09:00")).toBe(true);
    expect(TRAILING_OFFSET.test("2026-03-29T21:40:00")).toBe(false);
  });
});

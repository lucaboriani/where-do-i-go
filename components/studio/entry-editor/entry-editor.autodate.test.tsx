// @vitest-environment jsdom
/** The studio's entry editor: sections 12.0-12g — auto-date from one photo, and an offset the owner can see is a guess.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  DRAFT_FIELDS,
  GUESS_WORDING,
  LABEL,
  MACHINE_OFFSET,
  NEW_SCOPE,
  OFFSET_ONLY,
  OFFSET_OUT_OF_RANGE,
  OFFSET_WALL,
  OUT_OF_RANGE_OFFSET,
  OWNER,
  PHOTO_WALL,
  PINNED_ONLY,
  SECOND_OFFSET,
  SECOND_WALL,
  SPEC_OCCURRED,
  TIMED,
  TIMED_WITH_OTHER_OFFSET,
  TOKYO,
  alt,
  awaitLiveCoordinateControls,
  datatypeOf,
  describedTextOf,
  draftKeyFor,
  exifBytes,
  fakePipeline,
  fakeStorage,
  fakeStudioSession,
  fromFixture,
  indexRowOf,
  jpegWithExif,
  mediaFake,
  metadataOf,
  offsetMarkedAsGuess,
  offsetOptions,
  offsetPattern,
  oneObject,
  parseDraft,
  pickAndSettle,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  requireOffsetControl,
  saveButton,
  seededDraft,
  setChoice,
  setText,
  shownValue,
  specEntry,
  typeAsUser,
  wallClockShapes,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { DY, SCHEMA, XSD } from "@/lib/vocab";
import type { Entry } from "@/lib/pod/schema";
import type { ExifOptions } from "@/test/fixtures/exif-jpeg";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 12. AUTO-DATE, AND AN OFFSET THE OWNER CAN SEE IS A GUESS (§11.5).
 *
 * `DateTimeOriginal` carries NO offset — measured, and the reason §11.5 exists
 * — while `dy:occurredAt` requires one. Section 1c built the control; this
 * section is what fills it, and what admits when the filling was a guess.
 *
 * §11.5's argument, in its own words: prefilling a wall clock and silently
 * stamping the editing machine's zone "is worse than not auto-dating at all,
 * because it looks right". The owner writing up an evening in Tokyo from the
 * sofa in Milan sees `21:38 +02:00`, and every part of that reads as data.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T4-A: THE MARK BELONGS TO THIS MACHINE'S GUESS, NEVER TO THE ENTRY'S
 * OWN STORED OFFSET.
 *
 * On a CREATE the offset control holds `offsetHere(wallClockNow())` — a guess,
 * and one the photo had nothing to say about when it carried no
 * `OffsetTimeOriginal`. On an EDIT it holds `offsetOf(existing?.occurredAt)`
 * (section 1c), which is confirmed data the owner or a previous save settled.
 * Marking THAT unconfirmed because a newly attached photo happens to lack the
 * tag is §11.5's error with the sign flipped: it casts doubt on a value the
 * photo cannot speak to. 12d is the pair, and its allow-case leg is an edit of
 * an entry with no timestamp at all, where the offset shown IS the machine's.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T4-B: THE TWO AUTHORSHIP RECORDS ARE SEEDED FROM THE ENTRY, exactly as
 * `coordinateAuthor` is (`entry-editor.tsx:1302-1304`).
 *
 * T3-B's defect in a new field, and worse-shaped. `occurred` is seeded
 * `wallClockOf(existing?.occurredAt)` (`:1130`) and `offset`
 * `offsetOf(existing?.occurredAt) ?? offsetHere(wallClockNow())` (`:1160-1161`), so
 * ON AN EDIT THESE BOXES ARE NOT EMPTY — unlike the coordinate, which starts
 * blank by design. Authorship tracked as "only the owner's typing forbids
 * auto-fill" therefore reads a seeded value as unauthored, and a photo replaces
 * THE ENTRY'S STORED DATE: "when the moment happened", the single most
 * load-bearing fact on a travel diary entry, with the replaced value visible on
 * screen the whole time. The coordinate's version at least hid behind an empty
 * box.
 *
 * AND THE LAZY SPELLING THE FIX ROUND MEASURED. `initial === undefined ?
 * nobody : owner` silently switches auto-fill off for EVERY edit while every
 * refusal assertion in this section still passes. What separates it from the
 * correct `existing?.occurredAt === undefined ? nobody : owner` is exactly one
 * leg — 12d's first, an edit of an entry with no `dy:occurredAt` (the field is
 * `.optional()`, `lib/pod/schema.ts:142`) where the photo's date must STILL
 * fill. It is written first inside that test for that reason.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T4-C: THE WALL CLOCK AND THE OFFSET ARE NOT ONE UNIT. T3-A DOES NOT
 * TRANSFER.
 *
 * T3-A fused latitude and longitude because a latitude from the owner beside a
 * longitude from the photo is a point that is nowhere. A wall clock is "the
 * time at the place" and an offset is "the place's zone": owner-typed time with
 * the photo's zone is coherent (the owner correcting when, the photo supplying
 * where), and so is the reverse. Neither composes into a value that is nowhere.
 * So there are TWO records, and 12e/12f are the pair that says so — each is a
 * refusal on one field and, in the same leg, the ALLOW-CASE on the other. An
 * implementation that tidies them into one flag fails both.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T4-E AMENDS T4-C AND DOES NOT UNDO IT: THE TWO ARE INDEPENDENT ONLY
 * WHILE ONE SIDE IS THE OWNER.
 *
 * T4-C's argument turns on one side of the pair being a competent authority —
 * the owner, who can see both halves and correct either. Photo-A's clock beside
 * photo-B's zone has no authority anywhere in it. It composes exactly the
 * "value that is nowhere" T3-A was written to prevent for the coordinate, and
 * the composition CLEARS ITS OWN WARNING on the way past: the mark reads "a
 * photo dated it and NOBODY offset it", and accepting the second photo's zone
 * makes the offset a photo's. T4-C stands for owner-vs-photo (12e, 12f); it
 * simply never considered photo-vs-photo. 12h and 12i are that pair, in both
 * arrival orders — which order the owner picks first is an accident, so the
 * answer cannot depend on it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T4-F: A VALUE A PHOTO SUPPLIED IS CREDITED EVEN WHEN IT IS NOT A
 * GUESS. §11.3, the parent of §11.4 and §11.5: the owner is told a photo
 * supplied a value "so a wrong pin is attributable to the photo instead of to
 * the editor". The mark alone leaves the both-tags case (12b) and the zone-only
 * case attributed to nobody at all. 12b-bis, and it took no existing assertion
 * with it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T4-G: THE NOTE AND THE MARK HAVE DIFFERENT LIFETIMES. The note claims
 * "the time above came from a.jpg", and a keystroke in the clock makes that
 * uncheckable. The mark claims "the offset beside this time is this machine's
 * guess", and a keystroke in the clock says nothing about the offset's
 * authorship — so it is still TRUE. Choosing an offset ends the mark and
 * nothing else does, which is what scenario 3 says in words and what 12c
 * already pins from the other side. 12c-bis is the pair.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * A READING OF T4-A, NOT A NEW RULE: A PHOTO THAT CARRIED NO TIME AT ALL MARKS
 * NOTHING.
 *
 * By T4-A's letter, a GPS-only photo on a create satisfies both of its
 * conditions — the offset shown is `offsetHere(...)`, and the photo supplied no
 * offset — so it would be marked. That is the same lie in miniature: the mark
 * exists because a wall clock the PHOTO supplied sits beside a zone it did not,
 * and a note "naming the photo and the fact that the offset is not from it"
 * (the brief's scenario 3) is meaningless about a photo that said nothing about
 * time. The mark therefore follows the auto-DATE. 12g's second leg pins it, and
 * an implementer who disagrees has one assertion to argue with rather than a
 * silent difference.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW THE UNCONFIRMED STATE IS MARKED, AND WHY NEITHER A ROLE NOR A SENTENCE.
 *
 * `offsetMarkedAsGuess()` reads a state attribute off the control. Both
 * alternatives were ruled out by measuring rather than by taste:
 *
 *   - A LIVE REGION IS RULED OUT BY THE EXISTING SUITE. This project's own
 *     precedent for "structural, not wording" is section 7c — a clean save is
 *     `role="status"`, a stale one `role="alert"` — and it cannot be reused
 *     here. Section 10a — "a picked photo", the one that WORKS — pins
 *     `queryAllByRole("alert")` to `[]` at `test:7739`, and its fixture is
 *     `jpegFile("beach.jpg")`, which `jpegFile` builds with `DateTimeOriginal`
 *     and NO `OffsetTimeOriginal` (`test:7560`): scenario 3's exact state,
 *     reached in a test whose subject is photos rather than time. An alert
 *     would turn that test red. Its `status` assertion on the next line is
 *     `not.toHaveLength(0)` — a FLOOR, not a count, so a second `status`
 *     region would not move it, and that is not the argument. `outcomeText()`
 *     is: it scans both roles plus `aria-live` globally, so a persistent region
 *     about the offset would leak into the save-outcome assertions in six other
 *     sections. (Cited as 10b here until 2026-09-07. 10b is "a photo that
 *     FAILS" and asserts the opposite — `findAllByRole("alert")` over
 *     `broken.jpg` — so the pointer named the one section where an alert is
 *     expected. Ruling T3-C, deferring a live region for the coordinate note,
 *     rests on this same measurement, which is why the pointer is worth being
 *     exact about.)
 *   - A SENTENCE ALONE WOULD BE VACUOUS HERE, AND VISIBLY SO. The offset
 *     control's permanent hint already reads "The offset of the place it
 *     happened in, not of wherever you are writing this." A regex about
 *     machines and guesses can match THAT, in every state, including the
 *     confirmed ones — which is the shape that let a data-visibility bug ship
 *     in this project once (a deny-case matched `/public|site|cache|stale|
 *     visitor/` against a success message ending "and the public site has been
 *     refreshed"). So 12c asserts, in the same render and before the pick, that
 *     `GUESS_WORDING` does NOT match the baseline description. If the hint is
 *     ever reworded into it, that assertion fails and says so, instead of the
 *     pin going quietly vacuous.
 *
 * WHAT THE OWNER IS ACTUALLY TOLD IS STILL ASSERTED, and by the one fence in
 * this file that phrasing cannot fake: the note must name the PHOTO, matched
 * with `alt(file)` against a file name that comes from the fixture. A static
 * hint can never contain it. The attribute is the test's grip on the STATE; the
 * description is the owner's information, and both are asserted at the same
 * moment so they cannot drift.
 *
 * An implementer who marks the state differently changes `OFFSET_GUESS_ATTR`
 * and `offsetMarkedAsGuess()` — one constant and one helper, the same deal
 * `LABEL` and `setChoice` offer.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT JSDOM DOES TO A `datetime-local` VALUE, MEASURED ON 30.0.1 AND NOT
 * ASSUMED (the delta's second trap):
 *
 *     "2026-04-11T07:05:33"       → "2026-04-11T07:05:33.000"
 *     "2026-04-11T07:05:00"       → "2026-04-11T07:05"
 *     "2026-04-11T07:05"          → "2026-04-11T07:05"
 *     "undefined" / "NaN" / "null" → ""
 *     "…T07:05:33+09:00" / "…Z"    → ""
 *
 * Three consequences, and each shows up in an assertion below. (1) The two
 * honest implementations — truncate to the minute, or keep the photo's seconds
 * — read back as three different strings, so `wallClockShapes` accepts the set
 * and nothing else. (2) Mutation 1 from the brief (appending `Z` or the
 * machine's offset to `dateTimeOriginal`) EMPTIES the box in this environment,
 * so scenario 1's own assertion catches it. (3) `String(undefined)` is
 * invisible in this control, exactly as it is in the `type="number"` boxes
 * (11d), so the flushed draft — built from state by `writeDraft`, never put
 * through a control — is the only surface that can see it. 12g reads it there.
 *
 * The whole table is re-measured by the control below, so a jsdom upgrade that
 * changes any of it fails one control that says which, rather than four
 * scenarios that do not.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EVERY RENDER GETS ITS OWN `fakeStorage()`, section 11's measurement carried
 * over: `window.localStorage` is one object for the whole file, the unmount
 * that ends a leg FLUSHES the pending autosave window into it, and the next
 * render is then offered that draft back — which holds the controls behind the
 * banner (8e) and reports as "the control never became live".
 *
 * WHAT IS DELIBERATELY NOT PINNED: the wording of the note beyond the two
 * fences above; whether it is one element or two; and whether the photo's
 * SECONDS survive into the box (both are honest, and `toOffsetDateTime`'s
 * `LOCAL_DATETIME` already accepts either).
 *
 * ONE ITEM LEFT THIS LIST ON 2026-09-07, AND THE REASON IS RECORDED BECAUSE IT
 * WAS MINE. It read: "whether a photo that DID supply the offset is credited
 * with a provenance note of its own — that would be an honest thing to say and
 * forbidding it would be over-specification". Not forbidding it was right;
 * leaving it optional was not. The guess mark is `null` for every photo that
 * supplied BOTH halves, so under that reading a wrong `dy:occurredAt` from a
 * camera with the wrong year is attributable to nothing on the form — which is
 * §11.3's stated purpose for surfacing auto-fill at all, and §11.5's silence
 * about it is no more a withdrawal than its silence about "never overwrites".
 * 12b-bis pins it now (ruling T4-F); the state attribute is still what the
 * MARK's absence is asserted on, because the two facts remain different — "who
 * supplied this" and "is the offset beside it a guess".
 * ════════════════════════════════════════════════════════════════════════ */

/** A phone that wrote both. `+05:45` is Kathmandu: on the offset control's list
 *  (section 1c), a three-quarter hour so a whole-hour parse is visible, and NOT
 *  this machine's zone — which is what makes scenario 2 able to fail. */
const TIMED_WITH_OFFSET: ExifOptions = { ...TIMED, offsetTimeOriginal: "+05:45" };

const PHOTO_OFFSET = fromFixture(
  metadataOf(TIMED_WITH_OFFSET).offsetTimeOriginal,
  "OffsetTimeOriginal",
);

/* ─────────────────────────────────────────── 12.0 controls for section 12 ── */

describe("controls for section 12", () => {
  /**
   * NOT A TEST OF THE EDITOR — section 0's kind and section 11.0's, and it
   * passes on its first run for the same reason.
   *
   * Everything below rests on six EXIF fixtures carrying exactly one
   * combination each, on the photo's offset differing from this machine's, on
   * the SECOND photo's two tags differing from the first's, and on knowing what
   * a `datetime-local` control does to a value in this environment. Stage 1
   * lost a Playwright leg to a mutation whose guard the specified fixture could
   * not reach, with both briefed tests green — and 12d leg two is a live
   * example in this very file, where the stored offset is byte-identical to the
   * photo tag it is being told apart from.
   */
  it("the six EXIF fixtures carry what this section thinks, and the controls coerce what it measured", () => {
    /* ── the fixtures, through the real reader ──────────────────────────── */
    const timed = metadataOf(TIMED);
    expect(timed.dateTimeOriginal, "the date-only fixture's wall clock has moved").toBe(PHOTO_WALL);
    expect(
      timed.offsetTimeOriginal,
      "the date-only fixture carries OffsetTimeOriginal, so scenarios 1, 3 and 4 are not the case they claim",
    ).toBeUndefined();
    expect(
      timed.gps,
      "the date-only fixture carries GPS, so scenario 6's first leg is not the case it claims",
    ).toBeUndefined();

    const both = metadataOf(TIMED_WITH_OFFSET);
    expect(both.dateTimeOriginal, "the two-tag fixture lost its date").toBe(PHOTO_WALL);
    expect(both.offsetTimeOriginal, "the two-tag fixture lost its offset").toBe(PHOTO_OFFSET);

    const pinned = metadataOf(PINNED_ONLY);
    expect(
      pinned.dateTimeOriginal,
      "the GPS-only fixture carries a date, so scenario 6's second leg is not the case it claims",
    ).toBeUndefined();
    expect(
      pinned.offsetTimeOriginal,
      "the GPS-only fixture carries an offset, so the mark assertion in scenario 6's second leg is not about a photo that said nothing",
    ).toBeUndefined();
    expect(pinned.gps, "the GPS-only fixture carries no coordinate to fill with").toEqual(TOKYO);

    /* ── THE TWO SECOND-PHOTO FIXTURES, AND WHETHER THEY REACH THE BRANCH ──
       12h and 12i are about one photo standing beside ANOTHER photo's half, so
       every one of their refusals is vacuous if the second file's tags cannot
       be told from the first's, or if the reader drops them. */
    const other = metadataOf(TIMED_WITH_OTHER_OFFSET);
    expect(other.dateTimeOriginal, "the second two-tag fixture lost its date").toBe(SECOND_WALL);
    expect(other.offsetTimeOriginal, "the second two-tag fixture lost its offset").toBe(
      SECOND_OFFSET,
    );
    expect(
      SECOND_WALL.slice(0, 16),
      "both two-tag fixtures carry the same wall clock: 12h's 'the first photo's clock survived' would hold for an editor in which the SECOND photo won",
    ).not.toBe(PHOTO_WALL.slice(0, 16));
    for (const [what, taken] of [
      ["the first photo's", PHOTO_OFFSET],
      ["this machine's", MACHINE_OFFSET],
    ] as const) {
      expect(
        SECOND_OFFSET,
        `the second photo's offset is ${what}, so no assertion in 12d's third leg, 12h or 12i can tell whose offset the control is holding`,
      ).not.toBe(taken);
    }

    const zoneOnly = metadataOf(OFFSET_ONLY);
    expect(
      zoneOnly.offsetTimeOriginal,
      "the zone-only fixture's OffsetTimeOriginal does not survive the reader when no DateTimeOriginal stands beside it: 12i's first pick fills nothing, and the mirror case is a claim about a form no photo touched",
    ).toBe(SECOND_OFFSET);
    expect(
      zoneOnly.dateTimeOriginal,
      "the zone-only fixture carries a date, so 12i's first photo is not the case it claims",
    ).toBeUndefined();
    expect(
      zoneOnly.gps,
      "the zone-only fixture carries GPS, which 12i's assertions say nothing about",
    ).toBeUndefined();

    /* ── and the values can tell the two sources apart ──────────────────── */
    expect(
      PHOTO_OFFSET,
      "the photo's OffsetTimeOriginal is this machine's own zone: scenario 2 would pass against an editor that never read the tag",
    ).not.toBe(MACHINE_OFFSET);
    expect(PHOTO_OFFSET, "not an offset at all").toMatch(/^[+-]\d{2}:\d{2}$/);

    for (const [what, other] of [
      ["the §7.3 fixture's own", SPEC_OCCURRED.slice(0, 16)],
      ["what fillNewEntry types", OFFSET_WALL],
      ["what seededDraft carries", seededDraft().occurred],
    ] as const) {
      expect(
        PHOTO_WALL.slice(0, 16),
        `the photo's wall clock is ${what}: "the box changed" below could be a coincidence`,
      ).not.toBe(other);
    }

    /* A UTC NORMALISATION WOULD BE VISIBLE ON THE DATE, not only on the hour —
       which is what makes "the wall clock was not recomputed" a claim these
       fixtures can support. */
    expect(
      new Date(`${PHOTO_WALL}${MACHINE_OFFSET}`).toISOString().slice(0, 10),
      "the photo's wall clock is the same DAY in UTC: an editor that normalised through a Date would only move the hour",
    ).not.toBe(PHOTO_WALL.slice(0, 10));

    /* ── what the control actually reads back: the delta's second trap ──── */
    const probe = document.createElement("input");
    probe.setAttribute("type", "datetime-local");
    expect(
      probe.type,
      "jsdom does not know this input type, so nothing measured here is about the control the editor renders",
    ).toBe("datetime-local");

    for (const [set, read] of [
      [PHOTO_WALL, `${PHOTO_WALL}.000`],
      [`${PHOTO_WALL.slice(0, 16)}:00`, PHOTO_WALL.slice(0, 16)],
      [PHOTO_WALL.slice(0, 16), PHOTO_WALL.slice(0, 16)],
      ["undefined", ""],
      ["NaN", ""],
      ["null", ""],
      [`${PHOTO_WALL}${MACHINE_OFFSET}`, ""],
      [`${PHOTO_WALL}Z`, ""],
    ] as const) {
      probe.value = set;
      expect(
        probe.value,
        `jsdom's coercion of ${JSON.stringify(set)} has moved: the tolerances and the draft-only assertions below were measured against the old behaviour`,
      ).toBe(read);
    }

    /* …and the shape list is the honest set rather than a wildcard. */
    expect(wallClockShapes(PHOTO_WALL)).toContain(`${PHOTO_WALL}.000`);
    expect(wallClockShapes(PHOTO_WALL)).toContain(PHOTO_WALL.slice(0, 16));
    expect(
      wallClockShapes(PHOTO_WALL),
      "the shape list accepts an empty box: every wall-clock assertion built on it would be vacuous",
    ).not.toContain("");
    expect(
      wallClockShapes(PHOTO_WALL),
      "the shape list accepts a UTC-shifted wall clock",
    ).not.toContain(new Date(`${PHOTO_WALL}${MACHINE_OFFSET}`).toISOString().slice(0, 16));

    /* ── 12j's AND 12k's FIXTURES, both added 2026-09-07 ──────────────────
       12k needs a tag `lib/media/exif.ts` lets through and no real zone would
       produce; 12j needs two files that are ONE NAME and TWO PHOTOS. Each of
       those is a premise the test cannot restate for itself: a reader that
       dropped the tag, or two files the media path collapsed into one, would
       both report as a green refusal. */
    const outOfRange = metadataOf(OFFSET_OUT_OF_RANGE);
    expect(
      outOfRange.offsetTimeOriginal,
      "the out-of-range tag does not survive the reader, so 12k is about a form no photo touched",
    ).toBe("+99:99");
    expect(
      outOfRange.dateTimeOriginal,
      "12k's fixture carries no wall clock: `toOffsetDateTime` would have nothing to concatenate the bad offset onto, `occurredAt` would be undefined, and the save it is about would succeed for the wrong reason",
    ).toBe(PHOTO_WALL);
    expect(
      OUT_OF_RANGE_OFFSET,
      "the out-of-range tag is not offset-SHAPED, so it is refused before it reaches the control and 12k proves nothing about the editor",
    ).toMatch(/^[+-]\d{2}:\d{2}$/);
    expect(
      Number(OUT_OF_RANGE_OFFSET.slice(1, 3)),
      "the out-of-range tag is within the hours a real zone can have, so an editor that range-checked it correctly would still be allowed to accept it",
    ).toBeGreaterThan(14);

    expect(
      new Uint8Array(exifBytes(TIMED_WITH_OTHER_OFFSET)),
      "12j's two files are byte-identical: the media path is content-addressed, so they would collapse into ONE photo, the second `attach` would never run, and the collision the test is about would be out of reach",
    ).not.toEqual(new Uint8Array(exifBytes(TIMED)));

    /* 12j-bis PICKS THE SAME TWO CAMERAS IN THE OTHER ORDER, so its pair is the
       zone-only fixture beside the date-only one and it needs the same premise
       for the same reason. `fakePipeline` returns FIXED derivative bytes for
       every file, so the container hash can only be derived from the SOURCE:
       two identical sources are one photo, and the second `attach` never
       runs. */
    expect(
      new Uint8Array(exifBytes(OFFSET_ONLY)),
      "12j-bis's two files are byte-identical: the media path is content-addressed, so they would collapse into ONE photo, the second `attach` would never run, and the collision that test is about would be out of reach",
    ).not.toEqual(new Uint8Array(exifBytes(TIMED)));

    /* ── and the wording fence is not satisfied by the fixture names ────── */
    expect(
      GUESS_WORDING.test(""),
      "GUESS_WORDING matches the empty string, so a control with no description at all would satisfy it",
    ).toBe(false);
  });
});

/* ─────────────────────── 12a. a photo offers the time at the place ───────── */

describe("entry editor — a photo's DateTimeOriginal reaches the wall clock", () => {
  /**
   * SCENARIO 1. `attach`'s own comment says of `derived.metadata` that "its
   * `DateTimeOriginal` is still deliberately unused, because it has no UTC
   * offset and §6 requires one" — that is today's code, and this is the test
   * that ends it. The offset control (section 1c) is what makes the value
   * publishable at all: there is now a place for the missing half to come from
   * and to be corrected in.
   *
   * THE VALUE IS THE TIME AT THE PLACE, unshifted, which is what the field
   * means (§7.3: "carries the local UTC offset of the place", so the timestamp
   * "always reads as that time of day"). `07:05` at `+09:00` is the previous
   * day in UTC, so an implementation that routed the wall clock through a
   * `Date` moves the DATE and not merely the hour — asserted by the control
   * above, so this test can lean on it.
   *
   * BOTH SURFACES, AND THE SECOND IS NOT DECORATION. A box showing the right
   * thing while the write mangles it is this project's "half a check" — an HTTP
   * status asserted without its body once shipped a zero-byte 404. Here the
   * concrete failure is `LOCAL_DATETIME`: `toOffsetDateTime` returns
   * `undefined` for a wall clock it cannot parse, and `save()` reads that as
   * `occurredAt: undefined`, so an entry can be published with NO timestamp
   * while the control reads perfectly.
   *
   * WHAT WOULD BREAK IT: leaving `derived.metadata.dateTimeOriginal` unused,
   * which is today's code; appending `Z` or this machine's offset to it (the
   * brief's mutation 1 — in this environment the box then reads `""`, measured
   * by the control above); filling at SAVE time rather than at `ready`, which
   * leaves the box empty here; converting through a `Date` and back.
   */
  it("prefills the wall clock from the photo, and writes it with the offset the control holds", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const source = jpegWithExif("morning.jpg", TIMED);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    requireOffsetControl();

    /* THE PREMISE: there is nothing in the box, so "filled" is a change rather
       than a coincidence. */
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");

    await pickAndSettle(source, media);

    /* …and the file really went through the reader, rather than around it. */
    expect(rig.processed, "the pipeline was not given the picked file").toEqual([source.size]);

    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo's DateTimeOriginal never reached the control, and everything after this line is about a form the photo did not date",
      ).not.toBe("");
    });

    expect(
      wallClockShapes(PHOTO_WALL),
      `the wall clock shows ${JSON.stringify(shownValue(LABEL.occurredAt))}, which is not the photo's local time in any spelling this control can hold`,
    ).toContain(shownValue(LABEL.occurredAt));

    /* AND THE CONTROL IS STILL THE OWNER'S — §11.3's second half: a photo is
       never the only way to reach a value, and never the last word on one. */
    expect(screen.getByLabelText(LABEL.occurredAt), "auto-date disabled the control it filled").
      toBeEnabled();

    /* ── AND WHAT A STRANGER CAN FETCH SAYS THE SAME THING ─────────────────
       The rest of the form by hand rather than through `fillNewEntry`, which
       types its own wall clock into the very control this test is about and
       would make every assertion above about a date the owner supplied. */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-market-before-it-opened");
    setText(LABEL.headline, "The market before it opened");
    setText(LABEL.articleBody, "Nobody there but the fishmongers.");
    setText(LABEL.tags, "walking, morning");
    setChoice(LABEL.travelModeFrom, /train/i);
    setChoice(LABEL.status, /publish/i);
    expect(
      shownValue(LABEL.occurredAt),
      "filling the rest of the form cleared the auto-filled wall clock",
    ).not.toBe("");

    /* Not `clickSaveAndWait`: the attached photo's own `role="status"` has
       already made `outcomeText()` non-empty (10e's reasoning). */
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());
    await waitFor(() => expect(pod.indexPut()).toBeDefined());

    const put = pod.entryPut()!;
    const occurred = oneObject(quadsOf(put.body, put.url), `${put.url}#it`, DY.occurredAt);
    expect(
      occurred,
      "no dy:occurredAt reached the Pod at all: the control showed a date the write could not parse, which is what `toOffsetDateTime` returning `undefined` looks like from the outside",
    ).toBeDefined();
    /* Named separately so a failure says WHICH half moved, then §6's shape. */
    expect(
      occurred!.value.slice(0, 16),
      "the published wall clock is not the photo's: it was shifted, rounded or replaced on the way to the Pod",
    ).toBe(PHOTO_WALL.slice(0, 16));
    expect(
      occurred!.value.slice(-6),
      "the published offset is not the one the control holds",
    ).toBe(MACHINE_OFFSET);
    expect(occurred!.value, "§6: an xsd:dateTime with seconds and an explicit offset").toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
    expect(occurred!.value, "§3: an offset is required, and Z is not the spelling").not.toMatch(/Z$/);
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);

    /* THE INDEX ROW CARRIES IT TOO — §7.4's row is what the public trip page
       renders and sorts on, so a timestamp that survived in the document and
       not in the row is a timestamp the visitor has lost. */
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put.url);
    expect(row, "the new entry has no row in the index it was written to").toBeDefined();
    expect(
      oneObject(rows, row!, DY.occurredAt)?.value.slice(0, 16),
      "the index row's timestamp is not the one the entry was published with",
    ).toBe(PHOTO_WALL.slice(0, 16));
  });
});

/* ──────────────────── 12b. the offset a modern phone does write ──────────── */

describe("entry editor — a photo that carries OffsetTimeOriginal", () => {
  /**
   * SCENARIO 2, and the only case in this section where the photo can answer
   * BOTH halves. `lib/media/exif.ts` reads tag 0x9011 and validates its shape
   * (`/^[+-]\d{2}:\d{2}$/`), so what arrives is already an offset or nothing.
   *
   * IT IS `+05:45`, WHICH THIS MACHINE IS NOT. The file fixes Asia/Tokyo, so a
   * photo offset of `+09:00` would be indistinguishable from the guess this
   * section exists to replace — the control asserts they differ. Kathmandu also
   * makes a whole-hour parse visible, which is section 1c's reason for a select
   * over a stepper.
   *
   * AND NOTHING IS MARKED UNCONFIRMED, because nothing here is a guess: the
   * offset is the photo's own. Marking it would be §11.5's error pointed at a
   * value that is exactly as trustworthy as the wall clock beside it.
   *
   * WHAT WOULD BREAK IT: reading only `dateTimeOriginal`; passing the tag
   * through `offsetHere` or a `Date`, which returns this machine's zone for any
   * input it can parse and `+00:00` for one it cannot; marking every
   * photo-dated entry unconfirmed regardless of the tag.
   */
  it("takes the photo's own offset, and writes that rather than this machine's", async () => {
    const pod = podFake();
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithExif("kathmandu.jpg", TIMED_WITH_OFFSET);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    requireOffsetControl();

    /* THE PREMISE, IN BOTH BOXES: this machine's guess, and an empty clock. */
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(
      offsetOptions(),
      `${PHOTO_OFFSET} is not one of the offsets this editor offers, so a controlled <select> could not show it even if the fill were correct`,
    ).toContain(PHOTO_OFFSET);

    await pickAndSettle(source, media);

    await waitFor(() => {
      expect(
        shownValue(LABEL.offset),
        "the photo's OffsetTimeOriginal never reached the control: the tag was read and dropped, or never read",
      ).toBe(PHOTO_OFFSET);
    });
    expect(
      wallClockShapes(PHOTO_WALL),
      "the offset arrived without the wall clock it belongs to",
    ).toContain(shownValue(LABEL.occurredAt));
    expect(
      offsetMarkedAsGuess(),
      "the offset came from the photo and is marked as this machine's guess anyway: the mark is keyed on 'a photo was attached' rather than on where the offset came from",
    ).toBe(false);

    /* ── AND IT IS THE PHOTO'S OFFSET THAT REACHES THE POD ─────────────── */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-kathmandu-morning");
    setText(LABEL.headline, "Five past seven in Kathmandu");
    setText(LABEL.articleBody, "The dogs were still asleep.");
    setText(LABEL.tags, "walking, morning");
    setChoice(LABEL.travelModeFrom, /train/i);
    setChoice(LABEL.status, /publish/i);

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const occurred = oneObject(quadsOf(put.body, put.url), `${put.url}#it`, DY.occurredAt);
    expect(occurred, "no dy:occurredAt reached the Pod at all").toBeDefined();
    expect(
      occurred!.value.slice(-6),
      "the photo said which zone it was taken in and the entry was published in this machine's instead",
    ).toBe(PHOTO_OFFSET);
    expect(
      occurred!.value.slice(0, 16),
      "the wall clock moved: the timestamp was recomputed from the offset instead of being copied",
    ).toBe(PHOTO_WALL.slice(0, 16));
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
  });
});

/* ── 12b-bis. a value a photo supplied is a value the photo can be blamed for ── */

describe("entry editor — a photo that supplied the time, said out loud", () => {
  /**
   * RULING T4-F, AND IT CLOSES A SPEC GAP RATHER THAN CHANGING A DECISION.
   *
   * The normative line is §11.3, the parent of both auto-fill instances:
   * "Auto-fill is also surfaced rather than magical: the owner is told a photo
   * supplied a value, so a wrong pin is attributable to the photo instead of to
   * the editor" (`docs/superpowers/specs/2026-09-06-media-pipeline-design.md`,
   * §11.3). §11.5 does not restate it, exactly as it does not restate "never
   * overwrites" — and reading its silence as a withdrawal would withdraw the
   * no-overwrite rule with it.
   *
   * THE GAP, IN THE TWO STATES WHERE NOTHING ON SCREEN SAYS ANYTHING. The guess
   * mark is `null` unless a photo dated the form AND nobody set the offset, so:
   *
   *   - A PHONE THAT WROTE BOTH TAGS is uncredited entirely. A camera reset to
   *     factory time, or a phone with the year wrong, supplies both; the entry
   *     publishes a wrong `dy:occurredAt` — "when the moment happened", the
   *     most load-bearing fact on the entry — and the form attributes it to
   *     nobody. This is the case 12b already covers for the VALUES and leaves
   *     silent on the provenance.
   *   - A PHONE THAT WROTE ONLY THE ZONE is uncredited for the same reason from
   *     the other side: the offset moved, and neither the mark (there is no
   *     photo clock) nor any note says which file moved it.
   *
   * IT COSTS EXISTING ASSERTIONS NOTHING, which is why it is closed here rather
   * than filed: the section docblock already declares the note surface
   * deliberately unpinned for confirmed offsets, `offsetMarkedAsGuess()` reads
   * a state attribute rather than "is there a note", and no test in this file
   * asserted anything at all about the WALL CLOCK control's description before
   * this one.
   *
   * WHAT IS PINNED AND WHAT IS NOT. Pinned: the control holding an auto-filled
   * value announces the file name, through an association that resolves. Not
   * pinned: the wording, whether it is one element or two, and whether the two
   * controls share a note — the file name is the fence a static hint can never
   * satisfy, and `describedTextOf` is what makes the association real rather
   * than a `title` or a dangling IDREF (8e-bis measured both).
   *
   * AND IT MUST NOT CREDIT WHAT THE PHOTO DID NOT SUPPLY, which is leg two's
   * second half and the reason this is not "name the photo on every control": a
   * note that says a zone-only photo supplied the clock is a false claim, and a
   * rule that credits everything discriminates nothing.
   *
   * WHAT WOULD BREAK IT: today's code, where the guess mark is the only
   * surface; crediting the clock whenever a photo is attached, which leg two's
   * refusal catches; a note on a wrapper with an `aria-label` rather than an
   * association (`PHOTOS_LABEL`'s six-test failure); a note that outlives the
   * value it describes — the owner types over the clock and is still told where
   * it came from (T4-G's coordinate precedent, and 11a's for the coordinate).
   */
  it("credits the photo for the clock it filled, and for the offset when it filled that too", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const both = jpegWithExif("kathmandu.jpg", TIMED_WITH_OFFSET);
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    requireOffsetControl();

    /* ── THE ALLOW-CASE FIRST, 11a's shape: with no photo picked, neither
       control names a file, so "never mention a file name" cannot pass. ─── */
    expect(
      describedTextOf(LABEL.occurredAt),
      "the wall clock names a photo before one has been attached",
    ).not.toMatch(alt(both));
    expect(
      describedTextOf(LABEL.offset),
      "the offset control names a photo before one has been attached",
    ).not.toMatch(alt(both));
    const clockHint = describedTextOf(LABEL.occurredAt);
    expect(
      clockHint,
      "the wall clock announces no description at all, so 'the note appeared' below cannot be told from 'the hint was always there'",
    ).not.toBe("");

    /* ── THE PREMISE: 12b's own case, both halves filled by one photo ───── */
    await pickAndSettle(both, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.offset),
        "the photo's offset never reached the control, so nothing here is about a photo that supplied both halves",
      ).toBe(PHOTO_OFFSET);
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(
      offsetMarkedAsGuess(),
      "the offset is the photo's own and is marked as this machine's guess: 12b's assertion, repeated here because this test must not be satisfied by the mark coming back",
    ).toBe(false);

    /* ── THE CREDIT. The clock first: a wrong `dy:occurredAt` nobody can
       attribute is the harm §11.3 names. ────────────────────────────────── */
    await waitFor(() => {
      expect(
        screen.getByLabelText(LABEL.occurredAt),
        "the entry's timestamp came from a photo and nothing on the form says which one: a camera with the wrong year set publishes a wrong 'when it happened' attributable to the editor rather than to the file",
      ).toHaveAccessibleDescription(alt(both));
    });
    expect(
      describedTextOf(LABEL.occurredAt),
      "the credit is not reachable from the control it is about",
    ).toMatch(alt(both));
    expect(
      describedTextOf(LABEL.occurredAt),
      "the credit replaced the control's permanent hint instead of joining it",
    ).toContain(clockHint);
    expect(
      describedTextOf(LABEL.offset),
      "the offset moved because the photo carried OffsetTimeOriginal, and nothing says which file moved it",
    ).toMatch(alt(both));

    /* ── AND IT DOES NOT OUTLIVE THE VALUE, 11a's last leg and T4-G's
       reasoning: a claim about a number the owner has typed over is one they
       have no way to check. ─────────────────────────────────────────────── */
    const RETYPED = "2026-04-11T09:30";
    expect(RETYPED, "the retyped clock is the photo's own").not.toBe(PHOTO_WALL.slice(0, 16));
    expect(typeAsUser(LABEL.occurredAt, RETYPED), "the wall-clock control refused the keystroke").
      toBe(true);
    expect(shownValue(LABEL.occurredAt), "the keystroke did not stick").toBe(RETYPED);
    expect(
      describedTextOf(LABEL.occurredAt),
      "the credit still names the photo over a clock the owner has typed themselves",
    ).not.toMatch(alt(both));
    expect(
      describedTextOf(LABEL.occurredAt),
      "the keystroke took the permanent hint away with the credit",
    ).toContain(clockHint);

    cleanup();

    /* ── LEG TWO: A PHOTO THAT WROTE ONLY THE ZONE ───────────────────────
       The same gap from the other side, and its own refusal beside it: the
       offset is credited, the clock — which this photo said nothing about —
       is not. */
    const second = mediaFake();
    const zoneOnly = jpegWithExif("chathams.jpg", OFFSET_ONLY);
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    requireOffsetControl();
    expect(
      describedTextOf(LABEL.offset),
      "the offset control names a photo before one has been attached",
    ).not.toMatch(alt(zoneOnly));

    await pickAndSettle(zoneOnly, second);
    await waitFor(() => {
      expect(
        shownValue(LABEL.offset),
        "the zone-only photo's offset never reached the control, so this leg is about a form no photo touched",
      ).toBe(SECOND_OFFSET);
    });

    expect(
      describedTextOf(LABEL.offset),
      "the offset the form will publish came from a photo and nothing says which one",
    ).toMatch(alt(zoneOnly));
    expect(
      shownValue(LABEL.occurredAt),
      "a photo with no DateTimeOriginal filled the wall clock",
    ).toBe("");
    expect(
      describedTextOf(LABEL.occurredAt),
      "the wall clock credits a photo that said nothing about the time and filled nothing: a note that credits everything discriminates nothing",
    ).not.toMatch(alt(zoneOnly));
    expect(
      offsetMarkedAsGuess(),
      "the offset is the photo's own and the form calls it this machine's guess",
    ).toBe(false);
  });
});

/* ─────────── 12c. the offset the owner must be told is not the photo's ───── */

describe("entry editor — a photo with no OffsetTimeOriginal", () => {
  /**
   * SCENARIOS 3 AND 4, in one narrative for 11a's reason: "the note goes away"
   * is not an assertion unless the note was there, and an editor that never
   * says anything satisfies the second half perfectly.
   *
   * THE STATE IS ASSERTED STRUCTURALLY AND THE SENTENCE IS FENCED BY THE FILE
   * NAME — see the section docblock for why a role is ruled out by the existing
   * suite and why a wording match alone would be vacuous against a permanent
   * hint that already reads "not of wherever you are writing this". The
   * baseline capture below is what keeps `GUESS_WORDING` honest: if the hint is
   * ever reworded into it, THAT assertion fails instead of this test quietly
   * asserting nothing.
   *
   * THE LAST LEG IS THE ONE THAT SEPARATES A RECORD FROM A COMPARISON. An
   * implementation that marks the offset whenever it equals
   * `offsetHere(wallClockNow())` passes everything above; the owner then picks
   * this machine's own zone deliberately — which for most entries is the right
   * answer — and is told their own choice is a guess. Choosing away and back is
   * the only way to drive that, because React does not deliver a `change` for a
   * value that did not change.
   *
   * WHAT WOULD BREAK IT: no mark at all, which is today's code; treating a
   * missing `OffsetTimeOriginal` as confirmed (the brief's mutation 2); leaving
   * the mark on after the owner chooses; wording the note without naming the
   * photo; pointing `aria-describedby` at an id nothing renders, which computes
   * to `""` and is caught by `describedTextOf`.
   */
  it("marks the offset as this machine's guess, names the photo, and stops once the owner chooses", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithExif("evening.jpg", TIMED);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    requireOffsetControl();

    /* ── THE BASELINE, AND THE THREE THINGS IT FENCES ───────────────────── */
    const hint = describedTextOf(LABEL.offset);
    expect(
      hint,
      "the offset control announces no description at all, so 'the note appeared' below cannot be told from 'the hint was always there'",
    ).not.toBe("");
    expect(
      hint,
      "the offset control's PERMANENT hint matches GUESS_WORDING: the wording half of this test would hold in every state, including the confirmed ones, which is exactly the shape that shipped a bug in this project once",
    ).not.toMatch(GUESS_WORDING);
    expect(hint, "the permanent hint names this test's photo").not.toMatch(alt(source));
    expect(
      offsetMarkedAsGuess(),
      "the offset is marked as a guess before any photo has been attached",
    ).toBe(false);
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );

    await pickAndSettle(source, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo's date never reached the wall clock, and nothing after this line is about an auto-dated form",
      ).not.toBe("");
    });

    /* THE PHOTO DATED IT AND SAID NOTHING ABOUT THE ZONE. */
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(
      shownValue(LABEL.offset),
      "the offset moved for a photo that carried no OffsetTimeOriginal",
    ).toBe(MACHINE_OFFSET);

    /* THE MARK: THE STATE FIRST — the half no phrasing can fake. */
    expect(
      offsetMarkedAsGuess(),
      "the owner is shown a wall clock from the photo beside an offset from this machine, with nothing marking which is which: §11.5's 'worse than not auto-dating at all, because it looks right'",
    ).toBe(true);

    /* …THEN WHAT THE OWNER IS ACTUALLY TOLD, through the control's own
       association. `describedTextOf` resolves every IDREF first, because a
       dangling one computes to `""` and the failure would otherwise read "no
       note" (8e-bis's measurement). */
    await waitFor(() => {
      expect(
        screen.getByLabelText(LABEL.offset),
        "the marked control says nothing the owner can hear",
      ).toHaveAccessibleDescription(alt(source));
    });
    const note = describedTextOf(LABEL.offset);
    expect(note, "the note is not reachable from the control it is about").toMatch(alt(source));
    expect(
      note,
      "the note names the photo but not what is wrong: the owner cannot act on 'this came from evening.jpg' when the problem is that the OFFSET did not",
    ).toMatch(GUESS_WORDING);

    /* ── THE OWNER CHOOSES, AND THE NOTE HAS STOPPED BEING TRUE ─────────── */
    setChoice(LABEL.offset, offsetPattern(PHOTO_OFFSET));
    expect(shownValue(LABEL.offset), `the ${PHOTO_OFFSET} choice did not take`).toBe(PHOTO_OFFSET);

    expect(
      offsetMarkedAsGuess(),
      "the offset the owner chose themselves is still marked as this machine's guess",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.offset),
      "the note still credits the photo for an offset the owner has since chosen",
    ).not.toMatch(alt(source));
    expect(
      describedTextOf(LABEL.offset),
      "the note still says the offset is not the photo's, over a value the owner chose",
    ).not.toMatch(GUESS_WORDING);
    expect(
      screen.getByLabelText(LABEL.offset),
      "the note still credits the photo, announced",
    ).not.toHaveAccessibleDescription(alt(source));
    /* AND THE PERMANENT HINT SURVIVED, so "the note went away" is not "the
       whole description went away" — 11a's guard, in its shape. */
    expect(
      describedTextOf(LABEL.offset),
      "choosing an offset removed the control's permanent hint along with the note",
    ).not.toBe("");

    /* ── AND THE MARK IS A RECORD, NOT A COMPARISON ─────────────────────── */
    setChoice(LABEL.offset, offsetPattern(MACHINE_OFFSET));
    expect(shownValue(LABEL.offset), "the second choice did not take").toBe(MACHINE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "the mark is a comparison against this machine's zone rather than a record of who supplied the value: the owner deliberately chose +09:00 and is told it is a guess",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.offset),
      "the note came back when the owner chose the offset the machine had guessed",
    ).not.toMatch(alt(source));
  });
});

/* ───── 12c-bis. two claims about the same pair, with two lifetimes ─────── */

describe("entry editor — typing over the clock a photo filled", () => {
  /**
   * RULING T4-G, and it is a reading of scenario 3 rather than a new rule:
   * scenario 3 says the mark "stops once the owner chooses", and choosing is
   * something that happens to the OFFSET control. 12c pins that direction. This
   * pins the other one — a keystroke in the WALL CLOCK, which is a different
   * control and a different claim.
   *
   * TWO SURFACES, TWO CLAIMS, AND THEY STOP BEING TRUE AT DIFFERENT MOMENTS:
   *
   *   - THE NOTE claims "the time above came from evening.jpg". One keystroke
   *     makes that unverifiable, and the coordinate's precedent applies without
   *     amendment — "a note left standing beside a number the owner typed over
   *     is a claim they have no way to check". It goes.
   *   - THE MARK claims "the offset beside this time is this machine's guess".
   *     A keystroke in the clock says NOTHING about who supplied the offset, so
   *     the claim is still TRUE. It stays.
   *
   * THE DEFENCE THAT WAS OFFERED FOR CLEARING BOTH DOES NOT HOLD, which is why
   * this is a test and not a preference. The comment on the clock's `onChange`
   * argued that a typed-over clock leaves "the default every create opens with,
   * which the control's permanent hint already covers". On an ordinary create
   * the owner types a clock from memory beside a guess they were never misled
   * about. Here the clock is still substantially the photo's — `07:05` nudged to
   * `07:06` because the owner remembers it was a minute later — and clearing the
   * mark leaves `07:06 +09:00` with §11.5's composition fully intact and the
   * warning gone. A true warning that stays cannot mislead; one that is dropped
   * can.
   *
   * THE NUDGE IS ONE MINUTE ON PURPOSE. Retyping the clock wholesale would be
   * arguable as "a different moment entirely"; a minute is the case where the
   * photo's date is still doing all the work and the offset is untouched.
   *
   * WHAT IS ASSERTED ABOUT THE DESCRIPTION AFTER THE KEYSTROKE IS ONLY THAT IT
   * NO LONGER NAMES THE PHOTO. Whether the implementation replaces the note
   * with a photo-less sentence about the machine's guess is not pinned here —
   * the section docblock's "deliberately not pinned" list already covers the
   * wording, and the state attribute is this file's grip on the state.
   *
   * WHAT WOULD BREAK IT: clearing the mark on a clock keystroke, which is
   * today's code (one `creditTime` call carries both facts); leaving the note
   * standing over a clock the owner typed; deriving the mark from
   * `occurredAuthor` alone so that it also disappears; making the mark
   * unclearable, which the last leg here and 12c both catch.
   */
  it("drops the note when the owner nudges the clock, and keeps the mark until an offset is chosen", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithExif("evening.jpg", TIMED);
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    requireOffsetControl();

    /* ── THE ALLOW-CASE LEG, IN THE SAME RENDER: there is a note and a mark to
       lose. Without it "the note went away" is satisfied by an editor that
       never said anything. ─────────────────────────────────────────────────── */
    expect(
      offsetMarkedAsGuess(),
      "the offset is marked as a guess before any photo has been attached",
    ).toBe(false);

    await pickAndSettle(source, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo's date never reached the wall clock, so nothing below is about typing over an auto-filled clock",
      ).not.toBe("");
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(
      offsetMarkedAsGuess(),
      "the photo dated the entry beside this machine's offset and nothing marks it, so this test cannot tell 'the mark survived' from 'there was never a mark'",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the marked control does not name the photo, so 'the note went away' below is not about a note",
    ).toMatch(alt(source));

    /* ── ONE MINUTE LATER, TYPED BY THE OWNER ───────────────────────────── */
    const NUDGED = `${PHOTO_WALL.slice(0, 14)}06`;
    expect(
      NUDGED,
      "the nudge is the photo's own wall clock, so the keystroke below changes nothing and React delivers no `change`",
    ).not.toBe(shownValue(LABEL.occurredAt));
    expect(typeAsUser(LABEL.occurredAt, NUDGED), "the wall-clock control refused the keystroke").
      toBe(true);
    expect(shownValue(LABEL.occurredAt), "the keystroke did not stick").toBe(NUDGED);

    /* THE NOTE HAS STOPPED BEING CHECKABLE. */
    expect(
      describedTextOf(LABEL.offset),
      "a note still credits the photo for a clock the owner has typed over: a claim they have no way to check",
    ).not.toMatch(alt(source));
    expect(
      screen.getByLabelText(LABEL.offset),
      "the note still credits the photo, announced",
    ).not.toHaveAccessibleDescription(alt(source));
    /* …and the permanent hint survived it, 11a's guard in its shape. */
    expect(
      describedTextOf(LABEL.offset),
      "the keystroke took the control's permanent hint away with the note",
    ).not.toBe("");

    /* THE MARK HAS NOT, BECAUSE THE OFFSET IS STILL NOBODY'S. */
    expect(
      shownValue(LABEL.offset),
      "the keystroke moved the offset, which no keystroke in the clock may do",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "one minute typed into the clock cleared the mark on an offset nobody has chosen: the owner is left with the photo's date beside this machine's zone and §11.5's warning gone, which is the composition the warning exists for",
    ).toBe(true);

    /* ── AND CHOOSING THE OFFSET IS WHAT ENDS IT, exactly as 12c pins in the
       un-nudged case: the mark is clearable, and this leg says by what. ──── */
    setChoice(LABEL.offset, offsetPattern(PHOTO_OFFSET));
    expect(shownValue(LABEL.offset), `the ${PHOTO_OFFSET} choice did not take`).toBe(PHOTO_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "the offset the owner chose themselves is still marked as this machine's guess: the mark has become unclearable rather than long-lived",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.offset),
      "choosing the offset brought the photo's note back",
    ).not.toMatch(alt(source));
  });
});

/* ─────── 12d. whose offset it is, and whose date a photo may not touch ──── */

describe("entry editor — whose offset the mark belongs to", () => {
  /**
   * RULING T4-A AND RULING T4-B, IN THE TWO LEGS THAT ARE EACH OTHER'S
   * ALLOW-CASE. This is the most important test in the task, and the first leg
   * is the reason: it is the ONLY assertion in this file that separates the
   * correct authorship seed
   *
   *     existing?.occurredAt === undefined ? { kind: "nobody" } : { kind: "owner" }
   *
   * from the lazy spelling `initial === undefined ? nobody : owner`, which
   * switches auto-date off for EVERY edit ever made, silently, while every
   * refusal assertion in section 12 still passes. Task 3's fix round measured
   * exactly that shape on `coordinateAuthor`. It is written FIRST for that
   * reason, against 11i's convention of refusal-then-allow-case: the failure
   * the implementer should read first is the one that is invisible everywhere
   * else.
   *
   * LEG ONE — an edit of an entry with NO `dy:occurredAt` (`.optional()`,
   * `lib/pod/schema.ts:142`). There is no stored date to protect, both halves
   * of the timestamp are unauthored, and the offset control is holding
   * `offsetHere(wallClockNow())` because `offsetOf(undefined)` is `undefined`.
   * So the photo MAY date it — and must — and the guess it lands beside MUST be
   * marked: T4-A's condition is "the displayed offset is this machine's", not
   * "this is a create".
   *
   * LEG TWO — an edit of the §7.3 entry with a stored `+05:45`. The boxes are
   * NOT empty here (`:1130`, `:1160-1161`), which is what makes this worse-shaped
   * than the coordinate's version: a fill replaces "when the moment happened"
   * while the replaced value is on screen. And the offset must be left alone
   * AND left unmarked — badging confirmed data because a photo lacked a tag is
   * §11.5's error with the sign flipped, and it is doubt the photo cannot
   * justify.
   *
   * THE STORED OFFSET IS NEPAL'S, NOT §7.3's OWN. `+09:00` is this machine's
   * zone, so an editor that ignored the entry and read the machine would agree
   * with the fixture by coincidence — section 1c's reasoning for the same
   * substitution.
   *
   * LEG THREE — THE SAME EDIT, WITH A PHOTO THAT CARRIES THE OFFSET TOO, and
   * the only leg here that touches `offsetAuthor`'s SEED. Leg two's photo has
   * no `OffsetTimeOriginal` at all, which is what T4-A's refusal needs; that
   * makes its offset assertion hold for an editor whose `offsetAuthor` starts
   * `nobody` on every edit, because nothing ever offers a value. So the seed
   * that leg two appears to pin is in fact unpinned, and the mutation
   * `offsetAuthor = { kind: "nobody" }` passes legs one and two untouched.
   *
   * IT IS A THIRD LEG RATHER THAN A SUBSTITUTION IN LEG TWO, deliberately:
   * swapping leg two's fixture for a two-tag one would buy T4-B's pin by
   * selling T4-A's refusal, which needs a photo WITHOUT the tag. And a
   * substitution would have been blind anyway — leg two's `STORED_OFFSET` is
   * byte-identical to `TIMED_WITH_OFFSET`'s tag, so "the stored offset is
   * still there" would have been satisfied by the photo's overwriting it.
   * `TIMED_WITH_OTHER_OFFSET` carries `+12:45`, which is neither the stored
   * offset nor this machine's, so the assertion discriminates.
   *
   * IT IS A PIN, NOT A CHANGE: the review established the invariant, that on an
   * edit whose entry has a stored `occurredAt` no writer can take either record
   * back to `nobody` — the seed is `owner`, `offerTimestamp` passes the current
   * value or `{photo}`, both `onChange`s write or pass through, and `restore()`
   * writes `{owner}` for a shape-valid offset. This leg is what makes that
   * invariant fail out loud if a later change breaks it.
   *
   * WHAT WOULD BREAK IT: seeding either record `nobody` on an edit (leg two for
   * `occurredAuthor`, leg three for `offsetAuthor`); seeding from `initial ===
   * undefined` (leg one); seeding the wall clock's record from `occurred ===
   * ""`, which is the same defect spelled through the box; marking the offset
   * whenever the attached photo lacked the tag (leg two's mark).
   */
  it("dates an edit that has no date, and leaves the date and the offset an entry was stored with alone", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithExif("evening.jpg", TIMED);
    const entry = await specEntry();

    /* THE FIXTURES, AND THE MUTATIONS REALLY HAPPENED — a negative built by
       editing a fixture passes the UNMODIFIED fixture the day the edit stops
       applying, and does it silently. */
    expect(entry.occurredAt, "the §7.3 fixture carries no timestamp, so neither leg is what it claims").
      toBeDefined();
    const dateless: Entry = { ...entry, occurredAt: undefined };
    expect(dateless.occurredAt, "the dateless fixture still carries a timestamp").toBeUndefined();
    expect(
      dateless.headline.value,
      "the dateless fixture lost more than its date, so it is not the entry this leg claims to edit",
    ).toBe(entry.headline.value);
    const nepal: Entry = { ...entry, occurredAt: "2026-03-29T21:40:00+05:45" };
    expect(nepal.occurredAt, "the Nepal fixture is the unmodified entry").not.toBe(entry.occurredAt);
    const STORED_WALL = "2026-03-29T21:40";
    const STORED_OFFSET = "+05:45";
    expect(
      STORED_OFFSET,
      "the stored offset is this machine's zone: leg two would pass against an editor that read the machine and never the entry",
    ).not.toBe(MACHINE_OFFSET);

    /* ── LEG ONE, THE ALLOW-CASE, AND IT IS FIRST ON PURPOSE ────────────── */
    await renderEditor(fake.session, {
      initial: { entry: dateless, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    requireOffsetControl();
    expect(
      shownValue(LABEL.occurredAt),
      "an edit of an entry with no timestamp shows a wall clock anyway",
    ).toBe("");
    expect(
      shownValue(LABEL.offset),
      "an edit of an entry with no timestamp is not showing this machine's offset, so there is no guess for this leg to mark",
    ).toBe(MACHINE_OFFSET);

    await pickAndSettle(source, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo dated nothing on an edit of an entry with no date to protect: auto-date is off for every edit, and leg two below proves only that",
      ).not.toBe("");
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(
      offsetMarkedAsGuess(),
      "the wall clock came from the photo and the offset from this machine, and nothing says so — on an edit, where T4-A's condition is the offset's origin and not whether this is a create",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the marked control does not name the photo whose date it is standing beside",
    ).toMatch(alt(source));

    cleanup();

    /* ── LEG TWO, THE REFUSAL: an entry with a timestamp of its own ─────── */
    const pod = podFake();
    const second = mediaFake();
    await renderEditor(fake.session, {
      initial: { entry: nepal, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the stored wall clock is not in the box").toBe(
      STORED_WALL,
    );
    expect(shownValue(LABEL.offset), "the stored offset is not in the control").toBe(STORED_OFFSET);

    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await pickAndSettle(source, second);
    await waitFor(() => expect(second.puts).toHaveLength(2));

    expect(
      shownValue(LABEL.occurredAt),
      "attaching a photo replaced the date the entry was stored with — when the moment happened, the most load-bearing fact on the entry, and the replaced value was on screen the whole time",
    ).toBe(STORED_WALL);
    expect(
      shownValue(LABEL.offset),
      "attaching a photo replaced the offset the entry was stored with",
    ).toBe(STORED_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "a photo without the tag cast doubt on the offset the entry was STORED with: confirmed data the owner or a previous save already settled, and the photo has nothing to say about it (T4-A)",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.offset),
      "a note credits the photo for an offset the entry arrived with",
    ).not.toMatch(alt(source));

    /* AND WHAT A STRANGER CAN FETCH IS THE ENTRY'S OWN TIMESTAMP. The box
       above would already have failed for the ordinary defect; this covers the
       one that fills at SAVE time, where the form looks untouched and the wire
       does not. */
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    /* The mutation half: this is a save that changed something. */
    expect(oneObject(quads, `${put.url}#it`, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited",
    );
    expect(
      oneObject(quads, `${put.url}#it`, DY.occurredAt)?.value,
      "the entry was published with the photo's timestamp instead of its own",
    ).toBe(nepal.occurredAt);
    expect(
      pod.wire(),
      "the photo's wall clock is on the wire for an edit that kept its own date",
    ).not.toContain(PHOTO_WALL.slice(0, 16));

    cleanup();

    /* ── LEG THREE: THE SAME EDIT, AND A PHOTO THAT CARRIES BOTH TAGS ─────
       The leg that pins `offsetAuthor`'s seed. Leg two's photo carries no
       offset, so its "the stored offset is still there" holds for an editor
       whose `offsetAuthor` starts `nobody` on every edit — nothing ever offers
       it a value to refuse. Here something does. */
    const third = podFake();
    const carrying = mediaFake();
    const chathams = jpegWithExif("chathams.jpg", TIMED_WITH_OTHER_OFFSET);

    /* THE FENCE, BEFORE THE RENDER: this photo's two tags are neither the
       entry's nor this machine's, so every assertion below can say whose value
       the control is holding. `STORED_OFFSET` is byte-identical to
       `TIMED_WITH_OFFSET`'s `+05:45`, which is exactly why that fixture could
       not have been used here. */
    expect(
      SECOND_OFFSET,
      "the photo's offset is the one the entry was stored with, so 'the stored offset stands' would be satisfied by the photo overwriting it",
    ).not.toBe(STORED_OFFSET);
    expect(
      SECOND_OFFSET,
      "the photo's offset is this machine's, so an editor that read the machine would agree by coincidence",
    ).not.toBe(MACHINE_OFFSET);
    expect(
      SECOND_WALL.slice(0, 16),
      "the photo's wall clock is the one the entry was stored with",
    ).not.toBe(STORED_WALL);

    await renderEditor(fake.session, {
      initial: { entry: nepal, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the stored wall clock is not in the box").toBe(
      STORED_WALL,
    );
    expect(shownValue(LABEL.offset), "the stored offset is not in the control").toBe(STORED_OFFSET);
    expect(
      offsetOptions(),
      `${SECOND_OFFSET} is not one of the offsets this editor offers, so the control could not show it even if the fill this leg forbids did happen`,
    ).toContain(SECOND_OFFSET);

    setText(LABEL.headline, "First night in Shinjuku, revisited again");
    await pickAndSettle(chathams, carrying);

    expect(
      shownValue(LABEL.offset),
      "a photo's OffsetTimeOriginal replaced the offset the entry was stored with: `offsetAuthor` is seeded `nobody` on an edit, and leg two cannot see it because its photo carries no offset to offer",
    ).toBe(STORED_OFFSET);
    expect(
      shownValue(LABEL.occurredAt),
      "the same photo's DateTimeOriginal replaced the stored wall clock",
    ).toBe(STORED_WALL);
    expect(
      offsetMarkedAsGuess(),
      "the entry's own stored offset is marked as this machine's guess (T4-A)",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.offset),
      "a note credits the photo for the offset the entry arrived with",
    ).not.toMatch(alt(chathams));

    /* AND WHAT A STRANGER CAN FETCH IS STILL THE ENTRY'S OWN TIMESTAMP, both
       halves of it — the box above would already have failed for the ordinary
       defect, and this covers the one that composes at SAVE time. */
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(third.entryPut()).toBeDefined());

    const last = third.entryPut()!;
    const lastQuads = quadsOf(last.body, last.url);
    /* The mutation half: this is a save that changed something. */
    expect(oneObject(lastQuads, `${last.url}#it`, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited again",
    );
    expect(
      oneObject(lastQuads, `${last.url}#it`, DY.occurredAt)?.value,
      "the entry was published with a timestamp built from the photo's tags instead of its own",
    ).toBe(nepal.occurredAt);
    expect(
      third.wire(),
      "the photo's offset is on the wire for an edit that kept its own",
    ).not.toContain(SECOND_OFFSET);
    expect(
      third.wire(),
      "the photo's wall clock is on the wire for an edit that kept its own date",
    ).not.toContain(SECOND_WALL.slice(0, 16));
  });
});

/* ─────────── 12e/12f. what the owner set, and what is still open ────────── */

describe("entry editor — a photo added after the owner set the time", () => {
  /**
   * SCENARIO 5, first half, and RULING T4-C's first half.
   *
   * THE REFUSAL AND THE ALLOW-CASE ARE THE SAME LEG, which is what stops this
   * test passing before the implementation exists — Task 3's round found three
   * of seven doing exactly that, because a photo cannot overwrite what nothing
   * fills. The owner typed the wall clock, so the photo may not touch it; the
   * owner said nothing about the zone, so the photo's `OffsetTimeOriginal` MAY
   * fill it, and must. One photo, two records, opposite outcomes.
   *
   * T4-C IS WHY THAT IS NOT A CONTRADICTION. T3-A fused latitude and longitude
   * because a mixed pair is a point that is nowhere; a wall clock from the owner
   * beside a zone from the photo is coherent — the owner correcting when, the
   * photo supplying where. An implementation that tidied the two records into
   * one flag fails the second half here and the second half of 12f.
   *
   * WHAT WOULD BREAK IT: letting the photo overwrite a typed wall clock (the
   * brief's mutation 3, in its wall-clock direction); one authorship record for
   * both halves; inferring authorship from emptiness, which cannot tell a typed
   * value from a seeded one.
   */
  it("keeps the wall clock the owner typed, and still takes the offset the photo carries", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithExif("kathmandu.jpg", TIMED_WITH_OFFSET);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    requireOffsetControl();

    /* THE OWNER TYPES THE TIME, and it really took. */
    expect(typeAsUser(LABEL.occurredAt, OFFSET_WALL), "the wall-clock control refused the keystroke").
      toBe(true);
    expect(shownValue(LABEL.occurredAt), "the keystroke did not stick").toBe(OFFSET_WALL);
    expect(shownValue(LABEL.offset), "the offset is not this machine's guess to begin with").toBe(
      MACHINE_OFFSET,
    );

    await pickAndSettle(source, media);

    /* THE ALLOW-CASE HALF, and the one that is red before the implementation
       lands: the offset was nobody's, so the photo's may have it. */
    await waitFor(() => {
      expect(
        shownValue(LABEL.offset),
        "the photo's offset filled nothing over an offset nobody had set: either auto-date does not exist, or the wall clock and the offset are one record and the typed clock locked both",
      ).toBe(PHOTO_OFFSET);
    });

    /* THE REFUSAL HALF. Given a moment to get it wrong first — the fill lands
       asynchronously, so a bare synchronous read would pass against an editor
       that overwrote one tick later. */
    await waitFor(() => expect(media.puts).toHaveLength(2));
    expect(
      shownValue(LABEL.occurredAt),
      "the photo overwrote the wall clock the owner typed",
    ).toBe(OFFSET_WALL);
    expect(
      offsetMarkedAsGuess(),
      "the offset came from the photo and is marked as this machine's guess anyway",
    ).toBe(false);
  });
});

describe("entry editor — a photo added after the owner chose the offset", () => {
  /**
   * SCENARIO 5, second half, and T4-C's mirror image. `+12:45` is the Chathams:
   * on the list, and neither this machine's zone nor the photo's, so "the
   * choice survived" cannot be satisfied by either of the two values an
   * implementation might reach for instead.
   *
   * AND NOTHING IS MARKED. The displayed offset is the owner's own choice, so
   * T4-A's condition does not hold — this is the create-side version of leg two
   * in 12d, and it is the case a "mark whenever the photo lacked the tag" rule
   * gets wrong even before the photo carries one.
   *
   * WHAT WOULD BREAK IT: letting `OffsetTimeOriginal` overwrite a chosen offset
   * (the brief's mutation 3); one record for both halves, which would refuse
   * the wall clock as well; marking a chosen offset because the fill happened.
   */
  it("keeps the offset the owner chose, and still takes the wall clock the photo carries", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithExif("kathmandu.jpg", TIMED_WITH_OFFSET);
    const CHOSEN = "+12:45";
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    requireOffsetControl();
    for (const [what, other] of [["this machine's", MACHINE_OFFSET], ["the photo's", PHOTO_OFFSET]] as const) {
      expect(CHOSEN, `the chosen offset is ${what}, so "the choice survived" proves nothing`).not.
        toBe(other);
    }

    /* THE OWNER CHOOSES, and it really took. */
    setChoice(LABEL.offset, offsetPattern(CHOSEN));
    expect(shownValue(LABEL.offset), `the ${CHOSEN} choice did not take`).toBe(CHOSEN);
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");

    await pickAndSettle(source, media);

    /* THE ALLOW-CASE HALF, red before the implementation lands. */
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo dated nothing over an empty clock: either auto-date does not exist, or choosing an offset locked the wall clock with it",
      ).not.toBe("");
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));

    /* THE REFUSAL HALF. */
    await waitFor(() => expect(media.puts).toHaveLength(2));
    expect(
      shownValue(LABEL.offset),
      "the photo's OffsetTimeOriginal overwrote the offset the owner chose",
    ).toBe(CHOSEN);
    expect(
      offsetMarkedAsGuess(),
      "the offset the owner chose is marked as this machine's guess because a photo was attached",
    ).toBe(false);
  });
});

/* ──────────── 12g. a photo may carry either half, and often does ────────── */

describe("entry editor — a photo that carries one of the two", () => {
  /**
   * SCENARIO 6. `lib/media/exif.ts` reads GPS and the date from different IFDs
   * and guards each separately, so all four combinations are real: location
   * services off, a scan with a date and no camera, a camera with a GPS and an
   * unset clock. Neither half may stand in for the other, and neither may
   * clear it.
   *
   * TRAP 1, ANSWERED WHERE IT BITES. This is the one test in the section that
   * touches the coordinate as well as the date, so it uses
   * `awaitLiveCoordinateControls()` — §7.6's settings arrive over MSW
   * mid-flight and have made two pins in this file vacuous this stage.
   * `toBeEnabled()` alone would also hold for a build that never gated the
   * boxes; the precision reading §7.6's own 500 can only happen after
   * `readPrivacySettings` resolved.
   *
   * TRAP 2, ANSWERED IN THE ONE SURFACE THAT CAN SEE IT. `setOccurred(String
   * (metadata.dateTimeOriginal))` on a photo that carries no date writes the
   * five characters `undefined` into the state, and the `datetime-local`
   * control reads that back as `""` — measured on jsdom 30.0.1 by the control
   * above. So the box CANNOT show it and every on-screen assertion here passes
   * for that mutant. The flushed draft is built from state by `writeDraft` and
   * is not put through a control, which is why the second leg ends in
   * `cleanup()` and an inspection of what was kept — 11d's mechanism, for 11d's
   * reason.
   *
   * THE SECOND LEG PASSES TODAY, AND IT SAYS SO ITSELF. Nothing auto-dates yet,
   * so "the wall clock stayed empty" records an absence; its allow-case is the
   * FIRST leg, in the same test, where a photo with a date must fill it. The
   * coordinate half of the second leg is Task 3's behaviour and is here as the
   * premise that makes "and not the time" a refusal rather than a dead form.
   *
   * WHAT WOULD BREAK IT: filling the coordinate from a photo that has only a
   * date, or the date from one that has only GPS; clearing either half because
   * the other was absent; `String(...)` over an optional field; marking the
   * offset unconfirmed for a photo that said nothing about time (the reading of
   * T4-A recorded in the section docblock).
   */
  it("fills the time without the coordinate, and the coordinate without the time", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const timedOnly = jpegWithExif("receipt.jpg", TIMED);
    const pinnedOnly = jpegWithExif("shrine.jpg", PINNED_ONLY);

    /* ── leg one: a date and no GPS ─────────────────────────────────────── */
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    requireOffsetControl();
    await awaitLiveCoordinateControls();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.latitude), "the latitude box was not empty to begin with").toBe("");

    await pickAndSettle(timedOnly, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo's date never reached the wall clock, and the second leg below cannot prove auto-date exists",
      ).not.toBe("");
    });

    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(shownValue(LABEL.latitude), "a photo with no GPS filled the latitude").toBe("");
    expect(shownValue(LABEL.longitude), "a photo with no GPS filled the longitude").toBe("");
    expect(
      describedTextOf(LABEL.latitude),
      "a photo with no coordinate is credited with one anyway",
    ).not.toMatch(alt(timedOnly));
    /* It is also scenario 3's state, so the guess beside it is marked. */
    expect(
      offsetMarkedAsGuess(),
      "the photo dated the entry and said nothing about the zone, and nothing marks the offset",
    ).toBe(true);

    cleanup();

    /* ── leg two: GPS and no date ───────────────────────────────────────── */
    const store = fakeStorage();
    const openMedia = mediaFake();
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: store.storage,
    });

    requireOffsetControl();
    await awaitLiveCoordinateControls();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the offset is not this machine's guess to begin with").toBe(
      MACHINE_OFFSET,
    );

    await pickAndSettle(pinnedOnly, openMedia);
    /* THE PREMISE, and it is Task 3's behaviour rather than this task's: the
       photo really did reach the form. Without it, "and not the time" would be
       a claim about a form nothing touched. */
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the GPS-only photo filled no coordinate either, so nothing in this leg is about a photo that reached the form",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(TOKYO.long);

    expect(
      shownValue(LABEL.occurredAt),
      "a photo with no DateTimeOriginal filled the wall clock",
    ).toBe("");
    expect(
      shownValue(LABEL.offset),
      "a photo that said nothing about time moved the offset",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "a photo that carried no time at all left the owner told their offset is a guess: the mark follows the auto-DATE, and nothing here was dated",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.offset),
      "the offset control names a photo that said nothing about time",
    ).not.toMatch(alt(pinnedOnly));

    /* ── AND NOTHING LIKE A STRINGIFIED ABSENCE REACHED THE STATE ───────── */
    cleanup();

    expect(
      store.calls.set,
      "nothing was kept at all, so the draft cannot answer this: the pick armed no autosave window",
    ).not.toEqual([]);
    const flushed = store.calls.set.at(-1)!;
    expect(flushed.key).toBe(draftKeyFor(OWNER, NEW_SCOPE));
    const payload = parseDraft(flushed.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );
    expect(
      payload.occurred,
      "the `occurred` state holds a stringified absence: the datetime-local control reads `undefined` back as `\"\"` (measured), so the box cannot show this and the draft is the only surface here that can",
    ).toBe("");
    expect(
      payload.offset,
      "the `offset` state holds a stringified absence, or an offset a photo with no time supplied",
    ).toBe(MACHINE_OFFSET);
  });
});

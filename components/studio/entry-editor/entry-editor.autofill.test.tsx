// @vitest-environment jsdom
/** The studio's entry editor: section 11 — auto-fill from a photo's metadata.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  DRAFT_FIELDS,
  GPS_TOKYO,
  type Gps,
  INSIDE_HOME,
  LABEL,
  NEW_SCOPE,
  NO_SETTINGS_REASON,
  OUTSIDE_HOME,
  OWNER,
  PRIVACY_TTL,
  SETTINGS_URL,
  SNAP_OUTSIDE_500,
  SPEC_PLACE_NAME,
  TOKYO,
  TYPED,
  alt,
  awaitLiveCoordinateControls,
  coordinateControls,
  datatypeOf,
  describedTextOf,
  draftKeyFor,
  fakePipeline,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  geoNodeOf,
  gpsBytes,
  gpsOf,
  indexRowOf,
  jpegFile,
  mediaFake,
  objectsOf,
  oneObject,
  parseDraft,
  pickAndSettle,
  placeNodeOf,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  requireCoordinateControls,
  saveButton,
  seededDraft,
  setText,
  shownValue,
  specEntry,
  typeAsUser,
  typeCoordinate,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DY, GEO, SCHEMA, XSD } from "@/lib/vocab";
import { readPrivacySettings } from "@/lib/pod/read";
import { fuzzForPublication } from "@/lib/pod/fuzz";
import { describe as describeError } from "@/lib/pod/result";
import { triples } from "@/test/graph";
import { servePod } from "@/test/msw";
import type { Entry } from "@/lib/pod/schema";
import { readMetadata } from "@/lib/media/exif";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 11. AUTO-FILL FROM A PHOTO'S METADATA (task 3).
 *
 * THE RULE, §11.3, and every test below is a face of it:
 *
 *   "Auto-fill only ever writes into a control the owner has not touched. A
 *    photo added after a manual edit never overwrites it, and adding a photo is
 *    never the only way to reach a value."
 *
 * …and the direction §11.3 names explicitly beside it: a second photo must not
 * quietly replace the first photo's coordinate. So the FIRST photo carrying a
 * value wins, and neither the owner's typing nor an earlier photo is ever
 * overwritten.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T3-A: THE COORDINATE IS ONE UNIT FOR OWNER-TOUCH PURPOSES.
 *
 * Per-field touch tracking — the obvious reading — makes longitude untouched
 * when the owner typed only a latitude, so auto-fill fills it: a coordinate
 * whose latitude came from the owner and whose longitude came from the photo,
 * which is a point neither of them meant. §9 then fuzzes and publishes it as if
 * it were a real location.
 *
 * IT IS ONE-SIDED, AND THAT IS MEASURED RATHER THAN ASSUMED. `readMetadata`
 * assigns `candidate.gps` in exactly one place (`lib/media/exif.ts`, the
 * `finite(lat) && finite(long)` guard — 87-90 today, and the symbol is the
 * durable form of that), so `gps` exists only when BOTH `Latitude` and
 * `Longitude` do and a photo can never supply half a coordinate. Only the
 * owner can, by typing into one box. One source, one cure: if the owner has
 * touched EITHER box, a photo fills NEITHER. 11b-bis is that case.
 *
 * This does NOT change `touchedCoordinate`, which is
 * `lat.trim() !== "" || long.trim() !== ""` and decides whether a coordinate is
 * WRITTEN at all — an auto-filled coordinate should be written, so it keeps its
 * meaning. The owner-touch record is a separate thing answering a different
 * question: may auto-fill write here.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * RULING T3-B: ON AN EDIT, AUTO-FILL MUST NOT TOUCH THE BOXES AT ALL.
 *
 * This paragraph replaces one that read "WHETHER A PHOTO MAY FILL OVER A
 * COORDINATE AN ENTRY WAS LOADED WITH … is not a state these controls can be
 * in, and the brief asks for no scenario about it. Every test below drives a
 * CREATE." The first clause was the mistake. On an edit both boxes DO start
 * empty by design (see the `lat` state's own note: the stored pair is already
 * snapped, so prefilling would re-snap it on every save and walk the pin) — and
 * emptiness is precisely what the save reads as "leave the stored coordinate
 * alone". So there is no "loaded" state to overwrite, and that is exactly why a
 * fill is destructive there: it turns the owner's inaction into "replace it".
 *
 * §11.3's letter permits the fill, because the control was not touched. The
 * design spec glosses its own rule as "the same distinction `touchedCoordinate`
 * already draws, applied to a second source of values", and
 * `touchedCoordinate`'s distinction is that EMPTY MEANS LEAVE IT ALONE. Read
 * against the sentence the spec offers as its own key, filling on an edit IS
 * the overwrite §11.3 forbids — and §11.3 names this failure shape itself: "the
 * kind of silent data loss that only surfaces a day later".
 *
 * 11i is that case, in three outcomes, two of which destroy published data. The
 * cost the ruling accepts: an owner who genuinely wants the photo's location on
 * an edit has to type the pair. Same trade as T3-A, and the safe direction is
 * the one that cannot delete a pin a stranger can already fetch.
 *
 * 11a through 11g all drive a CREATE, which is where the fill belongs; 11h and
 * 11i are the two states it must keep its hands out of.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHERE THE VALUES COME FROM, AND WHY NOT FROM A LITERAL.
 *
 * `fakePipeline` runs the REAL `readMetadata` over the REAL file bytes — its
 * own docblock says why — so a photo's GPS is whatever exifreader makes of the
 * EXIF this section writes. The expected numbers are therefore read back out of
 * the same reader rather than typed in here: a hand-written expectation would
 * be asserting this file's DMS arithmetic against exifreader's, and would
 * "fail" on a fixture rather than on the editor. The one exception is the
 * SNAPPED pair in 11e, which is hard-coded to the module constant
 * `SNAP_OUTSIDE_500` for the reason section 1 gives at length: computing the
 * oracle with the function under test passes for an editor that called it on
 * the wrong input in the same way.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HOW THE PROVENANCE NOTES ARE QUERIED, AND WHY IT CANNOT COLLIDE.
 *
 * FROM THE CONTROL, FOLLOWING ITS OWN `aria-describedby` —
 * `toHaveAccessibleDescription` and `describedByIdsOf`. Never a screen-wide
 * text query, and never a label.
 *
 *   - A SCREEN-WIDE TEXT QUERY FOR THE FILE NAME CANNOT WORK HERE. The photo
 *     row itself says "beach.jpg is attached to this entry" (section 10a), so
 *     `queryByText(/beach\.jpg/)` matches whether or not a provenance note
 *     exists — a vacuous pass on the positive half and a false failure on the
 *     "the note goes away" half. Starting at the control is the only query that
 *     distinguishes them.
 *   - IT CANNOT COLLIDE WITH THE FIFTEEN-PLUS ENTRIES IN `LABEL`, because it is
 *     not a label query at all: `getByLabelText(LABEL.latitude)` already
 *     resolves to exactly one control (section 1's "exactly three coordinate
 *     controls" pins that), and the description is read off THAT element. No
 *     new accessible name is introduced, so 8b's shadowing loop — one match per
 *     `LABEL` entry — is unaffected.
 *   - NO `aria-label` ON A WRAPPER. Step 5 of the brief says so, and this file
 *     has the receipt: `PHOTOS_LABEL`'s docblock records six tests failing with
 *     "found multiple elements" when a `<section aria-label="Photos">` shadowed
 *     the file input.
 *   - EVERY IDREF MUST RESOLVE. A dangling `aria-describedby` computes to the
 *     empty string, silently — 8e-bis's control measured exactly that — so the
 *     ids are resolved as well as the text, and a note nobody can hear fails
 *     with "points at an id nothing has" rather than with "no note".
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT PINNED HERE:
 *
 *   - THE DATE. `metadata.dateTimeOriginal` has no UTC offset and §6 requires
 *     one; that is a separate decision with a separate control (1c) and is not
 *     this task.
 *   - THE WORDING of any note. `alt()` matches the file NAME, which is the one
 *     thing the brief requires ("by file name"), and nothing here asserts a
 *     sentence.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * EVERY RENDER HERE GETS ITS OWN DRAFT STORE, AND THAT IS A MEASUREMENT.
 *
 * Three tests below carry an allow-case in a second render — section 1's
 * home-region shape, `cleanup()` and render again — and those legs do NOT save.
 * `window.localStorage` is one object for the whole file, and the unmount that
 * ends the first leg FLUSHES the pending autosave window into it (8f). So the
 * second render is offered that draft back, and an outstanding offer holds the
 * coordinate controls behind the banner (8e, pinned for these three
 * specifically at the end of 8h).
 *
 * Measured rather than foreseen: the first run of those legs failed with "the
 * latitude control never became live" over a `title="Unsaved draft"` region — a
 * banner wearing a settings failure's error message, which is exactly the shape
 * that gets a good test deleted as flaky. A fresh `fakeStorage()` per render
 * keeps each leg's draft to itself and takes the banner out of the section
 * entirely. The home-region test does not need it because its first leg SAVES,
 * and a successful save settles the draft.
 * ════════════════════════════════════════════════════════════════════════ */

const jpegWithGps = (name: string, gps: Gps): File =>
  new File([gpsBytes(gps)], name, { type: "image/jpeg" });

/** Ushuaia, both hemispheres negative — the SECOND photo in 11c. Chosen as far
 *  from Tokyo as a coordinate gets: an overwrite is a sign flip, not a rounding
 *  difference, so 11c cannot pass on a near-miss. */
const GPS_USHUAIA: Gps = {
  latRef: "S",
  lat: [[54, 1], [48, 1], [687, 100]],
  longRef: "W",
  long: [[68, 1], [18, 1], [1080, 100]],
};

/**
 * §7.6's own home region, from the two ends that matter, in EXIF.
 *
 * TWO FIXTURES, NOT ONE, AND THE DMS SPELLINGS ARE CHOSEN SO THEY LAND EXACTLY
 * ON THE MODULE CONSTANTS `OUTSIDE_HOME` AND `INSIDE_HOME` — 45°30'55.80"N is
 * 45.5155 to the last bit, verified by the control below and not by arithmetic
 * done here. That is what lets 11e assert the hard-coded `SNAP_OUTSIDE_500`,
 * and it is the delta's second trap answered: a mutation proves nothing unless
 * the fixture can reach the mutated branch, so the control runs each of these
 * through the real `fuzzForPublication` against the real §7.6 document and
 * shows one snapping and the other dropping.
 */
const GPS_OUTSIDE_HOME: Gps = {
  latRef: "N",
  lat: [[45, 1], [30, 1], [5580, 100]],
  longRef: "E",
  long: [[9, 1], [12, 1], [3708, 100]],
};
const GPS_INSIDE_HOME: Gps = {
  latRef: "N",
  lat: [[45, 1], [27, 1], [579672, 10_000]],
  longRef: "E",
  long: [[9, 1], [11, 1], [245544, 10_000]],
};

const USHUAIA = gpsOf(GPS_USHUAIA);
const AT_HOME = gpsOf(GPS_INSIDE_HOME);
const AWAY = gpsOf(GPS_OUTSIDE_HOME);

/* ─────────────────────────────────────────── 11.0 controls for section 11 ── */

describe("controls for section 11", () => {
  /**
   * NOT A TEST OF THE EDITOR — section 0's kind, and it passes on its first run
   * for the same reason.
   *
   * Every assertion in this section rests on four EXIF fixtures carrying the
   * coordinates it thinks they carry, on those coordinates being far enough
   * apart that an overwrite is visible, and — for 11e, the most important test
   * in the task — on one of them landing OUTSIDE §7.6's home region and the
   * other INSIDE it. That last pair is the delta's second trap in as many
   * words: stage 1 lost a Playwright leg to a mutation whose guard the
   * specified fixture could not reach, and both briefed tests stayed green.
   */
  it("the four GPS fixtures land where this section thinks they do", async () => {
    /* THE SETTINGS THE HARNESS SERVES, through the real reader. */
    servePod({ [SETTINGS_URL]: PRIVACY_TTL });
    const settings = await readPrivacySettings(SETTINGS_URL);
    expect(settings.ok, settings.ok ? "" : describeError(settings.error)).toBe(true);
    if (!settings.ok) return;

    /* EXACT, TO THE LAST BIT, on the two that 11e leans on: these are the module
       constants section 1 already ties to the grid, so `SNAP_OUTSIDE_500` and
       "inside a 3 km radius" carry over rather than being re-derived. */
    expect(AWAY, "the outside-home fixture is not OUTSIDE_HOME to the bit").toEqual({
      lat: Number(OUTSIDE_HOME.lat),
      long: Number(OUTSIDE_HOME.long),
    });
    expect(AT_HOME, "the inside-home fixture is not INSIDE_HOME to the bit").toEqual({
      lat: Number(INSIDE_HOME.lat),
      long: Number(INSIDE_HOME.long),
    });

    /* AND EACH REALLY REACHES THE BRANCH IT IS FOR. Not asserted through the
       editor: through the same `fuzzForPublication` the editor has to call,
       against the same §7.6 document the harness serves it. */
    const snapped = fuzzForPublication(AWAY, settings.value);
    expect(
      snapped.kind,
      "the outside-home photo does not snap: 11e's snapped half is unreachable and its mutation cannot go red",
    ).toBe("snap");
    if (snapped.kind !== "snap") return;
    // As numbers, never as bytes — §11 guardrail 6 — and against the SAME
    // module constant 11e asserts, which is what carries section 1's grid
    // control over instead of re-deriving it.
    expect({
      lat: Number(snapped.lat),
      long: Number(snapped.long),
      precisionMeters: snapped.precisionMeters,
    }).toEqual({ ...SNAP_OUTSIDE_500, precisionMeters: 500 });

    expect(
      fuzzForPublication(AT_HOME, settings.value),
      "the inside-home photo is not inside the home region: 11e's no-geometry half proves nothing",
    ).toEqual({ kind: "drop", reason: "insideHome" });

    /* THE TWO ORDINARY PHOTOS DIFFER FROM EACH OTHER AND FROM WHAT THE OWNER
       TYPES. Without this, 11b and 11c could not fail: "the value did not
       change" is not an assertion when the two candidate values are equal. */
    expect(TOKYO.lat).not.toBe(USHUAIA.lat);
    expect(TOKYO.long).not.toBe(USHUAIA.long);
    for (const [what, point] of [["tokyo", TOKYO], ["ushuaia", USHUAIA]] as const) {
      expect(point.lat, `${what} is what the owner types`).not.toBe(Number(TYPED.lat));
      expect(point.long, `${what} is what the owner types`).not.toBe(Number(TYPED.long));
    }
    /* Sign-carrying, so 11c's "the second photo did not win" is a hemisphere
       apart rather than a rounding difference. */
    expect(USHUAIA.lat).toBeLessThan(0);
    expect(USHUAIA.long).toBeLessThan(0);

    /* THE SUBSTRING PROPERTY 11e's "reaches no request at all" needs. The raw
       digits must not occur inside the snapped ones, or the leak assertion
       could not fail. */
    const published = `${SNAP_OUTSIDE_500.lat} ${SNAP_OUTSIDE_500.long}`;
    expect(published).not.toContain(String(AWAY.lat));
    expect(published).not.toContain(String(AWAY.long));

    /* AND A PHOTO WITH NO GPS REALLY HAS NONE — 11d's premise. `jpegFile` is
       stage 1's fixture and this is the one property 11d needs from it. */
    const plain = jpegFile("scan.jpg");
    const bytes = await plain.arrayBuffer();
    expect(plain.size, "the no-GPS fixture is empty, so 11d asserts nothing").toBeGreaterThan(0);
    expect(
      readMetadata(bytes).gps,
      "stage 1's jpegFile now carries GPS, so 11d's photo is not the no-GPS case",
    ).toBeUndefined();
    expect(
      readMetadata(bytes).dateTimeOriginal,
      "the no-GPS fixture carries no EXIF at all, so 11d cannot tell 'no GPS' from 'no metadata'",
    ).toBe("2026-03-29T21:38:02");
  });
});

/* ──────────────────────────────── 11a. a photo offers what nothing else can ── */

describe("entry editor — a photo's GPS reaches the coordinate controls", () => {
  /**
   * SCENARIO 1. The whole point of stage 1's seam: `derived.metadata` was read
   * and thrown away when this test was written (`entry-editor.tsx` carried a
   * "deliberately unused for now" comment inside `attach`). `offerCoordinate`
   * is what reads it now, and it is the mechanism every failure message in this
   * section names — the seam is gone and a message about it would send the next
   * reader looking for code that is not there.
   *
   * THE VALUE IS THE PHOTO'S, AT FULL PRECISION, and that is a decision rather
   * than a convenience: the brief's words are "to the precision `exifreader`
   * returned", and the form is what `fuzzForPublication` is fed at save time
   * (step 4: "feed the form, not the write path"). A value rounded on the way
   * IN is a snap the owner did not choose, applied before the grid they did,
   * and invisible on the wire because both numbers look equally deliberate.
   * Compared as NUMBERS, never as bytes — §11 guardrail 6 — so the lexical form
   * stays the implementer's.
   *
   * WHAT WOULD BREAK IT: leaving `derived.metadata` unused, which is today's
   * code; filling from `metadata.gps` at SAVE time instead of at `ready`, which
   * leaves the boxes empty here and takes the provenance note with it; rounding
   * or `toFixed`-ing on the way in.
   */
  it("prefills both boxes from a photo that carries GPS", async () => {
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const source = jpegWithGps("beach.jpg", GPS_TOKYO);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    await awaitLiveCoordinateControls();

    /* THE PREMISE: there is nothing in either box, so "filled" below is a
       change rather than a coincidence. */
    expect(shownValue(LABEL.latitude), "the latitude box was not empty to begin with").toBe("");
    expect(shownValue(LABEL.longitude), "the longitude box was not empty to begin with").toBe("");

    await pickAndSettle(source, media);

    /* …and the file really went through the reader, rather than around it. */
    expect(rig.processed, "the pipeline was not given the picked file").toEqual([source.size]);

    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the photo's latitude never reached the control: `offerCoordinate` did not fill it",
      ).not.toBe("");
    });

    expect(Number(shownValue(LABEL.latitude)), "the latitude is not the photo's").toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude)), "the longitude is not the photo's").toBe(
      TOKYO.long,
    );

    /* AND THE CONTROLS ARE STILL THE OWNER'S. An auto-fill that disabled what it
       filled would make the photo the only way to reach the value, which is the
       second half of §11.3's sentence. */
    for (const [what, el] of coordinateControls()) {
      expect(el, `auto-fill left the ${what} control disabled`).toBeEnabled();
    }
  });

  /**
   * SCENARIO 6. A value that appeared without being typed has to say where it
   * came from, or the owner cannot tell an auto-fill from something they did
   * yesterday — and the note has to stop being said once it stops being true.
   *
   * QUERIED FROM THE CONTROL, through its own `aria-describedby`. The section
   * docblock says why no other query works: the photo row already contains the
   * file name, so a screen-wide text query matches with or without a note.
   *
   * WHAT IS NOT ASSERTED: whether the OTHER box's note also goes away when one
   * is edited. A single note for the pair and two per-field notes are both
   * honest answers — T3-A is about who may WRITE, not about how many sentences
   * there are — and both satisfy everything below.
   *
   * WHAT WOULD BREAK IT: no note at all, which is what this test was red
   * against before `offerCoordinate` landed; a note on a
   * wrapper with an `aria-label` instead of an association (step 5 forbids it,
   * and `PHOTOS_LABEL`'s docblock records the six-test failure it caused); an
   * `aria-describedby` pointing at an id nothing renders, which computes to ""
   * and is caught by `describedTextOf`; a note left in place after the owner
   * edits the field.
   */
  it("says which photo a filled coordinate came from, and stops saying it once the owner edits", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithGps("beach.jpg", GPS_TOKYO);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    await awaitLiveCoordinateControls();

    /* THE ALLOW-CASE FIRST, AND IT IS WHAT STOPS "NEVER MENTION A FILE NAME"
       FROM PASSING: with no photo picked, neither control names one. */
    expect(describedTextOf(LABEL.latitude)).not.toMatch(alt(source));
    expect(describedTextOf(LABEL.longitude)).not.toMatch(alt(source));

    await pickAndSettle(source, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the photo's coordinate never reached the control: `offerCoordinate` did not fill it, and everything after this line is about a form the photo did not touch",
      ).not.toBe("");
    });

    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      await waitFor(() => {
        expect(
          screen.getByLabelText(label),
          "the filled control does not say which photo the value came from",
        ).toHaveAccessibleDescription(alt(source));
      });
      /* And it is an ASSOCIATION that resolves, not a `title` and not a
         dangling IDREF — 8e-bis measured that both of those look like a
         description and are heard as nothing (or as a tooltip nobody on a
         keyboard sees). */
      expect(describedTextOf(label), "the note is not reachable from the control").toMatch(
        alt(source),
      );
    }

    /* THE OWNER EDITS THE LATITUDE. The note about it has stopped being true. */
    expect(typeAsUser(LABEL.latitude, TYPED.lat), "the latitude control refused the keystroke").toBe(
      true,
    );
    expect(shownValue(LABEL.latitude), "the keystroke did not stick").toBe(TYPED.lat);

    expect(
      describedTextOf(LABEL.latitude),
      "the note still credits the photo for a value the owner has since typed over",
    ).not.toMatch(alt(source));
    expect(
      screen.getByLabelText(LABEL.latitude),
      "the note still credits the photo, announced",
    ).not.toHaveAccessibleDescription(alt(source));

    /* THE LATITUDE'S HINT IS STILL THERE, so "the note went away" is not
       "the whole description went away". */
    expect(
      describedTextOf(LABEL.latitude),
      "editing the latitude removed its permanent hint along with the note",
    ).toMatch(/snapped to the precision/i);
  });
});

/* ─────────────────────────── 11b. what the owner typed is never overwritten ── */

describe("entry editor — a photo added after the owner typed", () => {
  /**
   * SCENARIO 2, and the first half of §11.3's sentence. A photo picked after a
   * coordinate was typed silently replaces a place the owner CHOSE with the
   * place a camera happened to be — and §9 then fuzzes and publishes it, so the
   * only surface that could show the substitution is a public triple.
   *
   * WHAT WOULD BREAK IT: filling whenever the target is empty-or-not without
   * asking who put it there; inferring owner-touch from emptiness (step 3 says
   * why not: a field can be non-empty because the owner typed, because a photo
   * filled it, or because an entry was loaded, and only the first forbids
   * auto-fill); running the fill on every `ready` rather than once.
   */
  it("never overwrites the coordinate the owner typed", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithGps("beach.jpg", GPS_TOKYO);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    await typeCoordinate(TYPED);
    await pickAndSettle(source, media);

    /* Given a moment to get it wrong: the fill lands asynchronously, so a bare
       synchronous assertion here would pass against an editor that overwrote
       one tick later. */
    await waitFor(() => expect(media.puts).toHaveLength(2));

    expect(shownValue(LABEL.latitude), "the photo overwrote the typed latitude").toBe(TYPED.lat);
    expect(shownValue(LABEL.longitude), "the photo overwrote the typed longitude").toBe(TYPED.long);

    /* AND NOTHING CLAIMS THE PHOTO SUPPLIED IT. A note beside the owner's own
       number is a lie the owner has no way to check. */
    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      expect(
        describedTextOf(label),
        "a provenance note credits the photo for a value the owner typed",
      ).not.toMatch(alt(source));
    }

    cleanup();

    /* THE ALLOW-CASE, IN THE SAME TEST AND WITH THE SAME FILE, and it is the
       leg that makes this test red before the implementation lands. Nothing
       typed this time, so the photo MAY fill — and must. Without it, every
       refusal above is satisfied by an editor that never auto-fills anything,
       which is what these legs were red against before `offerCoordinate`
       landed: "a rule that rejects everything is useless", and
       section 1's home-region test carries its allow-case for the same reason. */
    const openForm = mediaFake();
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });
    await awaitLiveCoordinateControls();
    await pickAndSettle(source, openForm);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the same photo fills nothing on a form nobody has typed into: the refusal above proves only that auto-fill does not exist",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(TOKYO.long);
    expect(describedTextOf(LABEL.latitude), "the filled control names no source photo").toMatch(
      alt(source),
    );
  });

  /**
   * RULING T3-A, and the case the brief's scenario 2 is silent about.
   *
   * The owner types ONE number. Per-field touch tracking leaves the other box
   * untouched, so auto-fill fills it, and the result is a coordinate half
   * chosen and half photographed: a point that is nowhere, published as if it
   * were somewhere, with a note claiming only the longitude came from the
   * photo. `lib/media/exif.ts:87-90` means a photo can never do this by
   * itself — `gps` is set only when both tags are present — so the owner's one
   * keystroke is the only way in, and refusing BOTH boxes is the only way out.
   *
   * WHAT WOULD BREAK IT: one owner-touch flag per input, which is the obvious
   * reading of step 3 and the whole reason this ruling exists.
   */
  it("fills neither box when the owner has typed into one of them", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithGps("beach.jpg", GPS_TOKYO);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    await awaitLiveCoordinateControls();

    /* ONE box, and it really took the keystroke. */
    expect(typeAsUser(LABEL.latitude, TYPED.lat), "the latitude control refused the keystroke").toBe(
      true,
    );
    expect(shownValue(LABEL.latitude), "the keystroke did not stick").toBe(TYPED.lat);
    expect(shownValue(LABEL.longitude), "the longitude box was not left empty").toBe("");

    await pickAndSettle(source, media);
    await waitFor(() => expect(media.puts).toHaveLength(2));

    expect(shownValue(LABEL.latitude), "the photo overwrote the typed latitude").toBe(TYPED.lat);
    expect(
      shownValue(LABEL.longitude),
      "the photo completed the owner's half-typed coordinate: latitude from the owner, longitude from the camera, published as one point",
    ).toBe("");

    expect(
      describedTextOf(LABEL.longitude),
      "a note credits the photo for a longitude the form does not hold",
    ).not.toMatch(alt(source));

    cleanup();

    /* THE ALLOW-CASE, IN THE SAME TEST AND WITH THE SAME FILE, and it is the
       leg that makes this test red before the implementation lands. Nothing
       typed this time, so the photo MAY fill — and must. Without it, every
       refusal above is satisfied by an editor that never auto-fills anything,
       which is what these legs were red against before `offerCoordinate`
       landed: "a rule that rejects everything is useless", and
       section 1's home-region test carries its allow-case for the same reason. */
    const openPair = mediaFake();
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });
    await awaitLiveCoordinateControls();
    await pickAndSettle(source, openPair);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the same photo fills nothing on a form nobody has typed into: the refusal above proves only that auto-fill does not exist",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(TOKYO.long);
    expect(describedTextOf(LABEL.latitude), "the filled control names no source photo").toMatch(
      alt(source),
    );
  });
});

/* ──────────────────────────── 11c. the first photo wins, not the last one ── */

describe("entry editor — a second photo with GPS of its own", () => {
  /**
   * SCENARIO 3, the direction §11.3 names explicitly and the one that is easy
   * to get wrong: an owner-touch flag alone does not stop it, because neither
   * photo is the owner. The natural implementation — fill on every `ready`
   * where the box is not owner-typed — moves the entry to wherever the LAST
   * photo was taken, which on a day's walk is a different place every time a
   * picture is added, with the note updating politely as it goes.
   *
   * A HEMISPHERE APART on purpose (see the control): if the second photo won,
   * the latitude changes sign.
   *
   * WHAT WOULD BREAK IT: recording only "did the owner type" and not "has a
   * photo already supplied this"; re-running the fill on every `ready` slot;
   * keying the guard on the slot rather than on the coordinate.
   */
  it("keeps the first photo's coordinate when a second one arrives", async () => {
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const first = jpegWithGps("beach.jpg", GPS_TOKYO);
    const second = jpegWithGps("shrine.jpg", GPS_USHUAIA);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    await awaitLiveCoordinateControls();
    await pickAndSettle(first, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the photo's coordinate never reached the control: `offerCoordinate` did not fill it, and everything after this line is about a form the photo did not touch",
      ).not.toBe("");
    });

    /* THE PREMISE: the first photo's value is in the box, so what follows is
       "it was not replaced" rather than "nothing ever filled it". */
    expect(Number(shownValue(LABEL.latitude)), "the first photo did not fill the box").toBe(
      TOKYO.lat,
    );

    await pickAndSettle(second, media);

    /* THE SECOND PHOTO REALLY LANDED — two files through the pipeline, two
       containers, four PUTs. Without this the assertion below holds for an
       editor that dropped the second pick on the floor. */
    expect(rig.processed, "the second file never reached the pipeline").toHaveLength(2);
    expect(media.puts, "the second photo's derivatives never went up").toHaveLength(4);
    expect(media.containers(), "both photos went to one container").toHaveLength(2);
    await screen.findByRole("img", { name: alt(second) });

    expect(
      Number(shownValue(LABEL.latitude)),
      "the second photo replaced the first photo's latitude",
    ).toBe(TOKYO.lat);
    expect(
      Number(shownValue(LABEL.longitude)),
      "the second photo replaced the first photo's longitude",
    ).toBe(TOKYO.long);

    /* AND THE NOTE STILL NAMES THE PHOTO THE VALUE IS ACTUALLY FROM. A note
       that followed the last pick would credit `shrine.jpg` for `beach.jpg`'s
       coordinate — the value right, the provenance wrong, which is worse than
       no note at all. */
    expect(describedTextOf(LABEL.latitude)).toMatch(alt(first));
    expect(
      describedTextOf(LABEL.latitude),
      "the note credits the second photo for the first photo's coordinate",
    ).not.toMatch(alt(second));
  });
});

/* ──────────────────────────────── 11d. a photo with nothing to offer ──────── */

describe("entry editor — a photo that carries no GPS", () => {
  /**
   * SCENARIO 4, and the common case: screenshots, scans, location services off.
   * `lib/media/exif.ts` returns `{}` for a file it cannot read at all, so
   * "absent" is the shape the editor meets most often.
   *
   * BOTH HALVES, and the second is what stops the first being vacuous. An
   * editor that never auto-fills passes "the boxes are still empty" perfectly;
   * an editor that does `setLat(String(metadata.gps?.lat))` blanks a value the
   * owner typed — or writes the string `"undefined"` into the `lat` state —
   * and passes nothing.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE BOXES CANNOT SEE THAT SECOND FAILURE IN JSDOM, AND THE DRAFT CAN.
   * Measured against the installed jsdom 30.0.1 rather than reasoned about:
   * setting `.value = "undefined"` on an `<input type="number">` reads back
   * `""`, and so do `"NaN"` and `"null"`; a `type="text"` input keeps all
   * three. (` "1e5"` survives and `" 35.5 "` does not, which is the same
   * sanitiser at work.) So the `/undefined|null|NaN/i` loop below can only ever
   * fire on the precision `<select>`, whose value comes from its option list —
   * close to unfalsifiable — and the loop's original reason was a false reason
   * for a correct behaviour.
   *
   * That matters because of the mutation it hid: an `offerCoordinate` that
   * filled unconditionally and credited nothing goes GREEN across the whole of
   * section 11. Half one passes (the box shows `""`), no note appears so every
   * "no note" assertion passes, the allow-cases still fill, and 11b-bis is
   * caught by the author guard rather than by this. Its real consequence is the
   * `lat` STATE holding `"undefined"` — which on an edit is exactly 11i's third
   * outcome, a `touchedCoordinate` that is true over a form the owner can see
   * nothing in, and a stored pin dropped for it.
   *
   * The flushed draft is built from that state by `writeDraft` and is NOT put
   * through a number input, so it is the one surface in this environment that
   * can see a stringified absence. Hence `cleanup()` in the middle of this
   * test, and hence half two moving to a second render: the flush has to happen
   * while the form still holds the no-GPS state, because the GPS pick would
   * otherwise overwrite the very value being inspected. Half two keeps its job
   * unchanged — it is the allow-case, and a fresh `fakeStorage` keeps its
   * render out of the banner (see the section docblock).
   *
   * WHAT WOULD BREAK IT: filling unconditionally from an optional field;
   * clearing the boxes when a photo has no GPS "to keep them consistent";
   * treating `{}` as a reason to reset the form.
   */
  it("changes nothing, and clears nothing, when the photo has no GPS", async () => {
    const media = mediaFake();
    const store = fakeStorage();
    const fake = fakeStudioSession();
    const plain = jpegFile("scan.jpg");
    const located = jpegWithGps("beach.jpg", GPS_TOKYO);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: store.storage });

    await awaitLiveCoordinateControls();

    /* ── half one: nothing typed, and a photo with no GPS ─────────────────── */
    await pickAndSettle(plain, media);

    expect(shownValue(LABEL.latitude), "a photo with no GPS filled the latitude").toBe("");
    expect(shownValue(LABEL.longitude), "a photo with no GPS filled the longitude").toBe("");
    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      expect(
        describedTextOf(label),
        "a photo with no coordinate is credited with one anyway",
      ).not.toMatch(alt(plain));
    }
    /* Nothing that looks like a stringified absence is being SHOWN. Kept, and
       demoted to what it can actually claim: in jsdom this reaches only the
       precision select (see the docblock's measurement), and in a real browser
       it covers all three. The claim it used to make is the one below. */
    for (const [what, el] of coordinateControls()) {
      expect((el as HTMLInputElement).value, `the ${what} control holds a stringified absence`).not.
        toMatch(/undefined|null|NaN/i);
    }

    /* ── AND NOTHING LIKE ONE REACHED THE STATE EITHER, read off the flushed
       draft because that is the only unsanitised copy of it here. The unmount
       flush is 8f's mechanism and 11f's, on real timers. ──────────────────── */
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
      payload.lat,
      "the `lat` state holds a stringified absence: the number input sanitises it out of sight, and on an edit it is what makes `touchedCoordinate` true over a form the owner can see nothing in",
    ).toBe("");
    expect(
      payload.long,
      "the `long` state holds a stringified absence, invisible in the box that shows it",
    ).toBe("");

    /* ── half two, the allow-case: a photo that DOES carry GPS ────────────────
       A second render rather than the same form, because the flush above had to
       happen before this pick could overwrite the state it reads. Without this
       leg, an editor with no auto-fill at all passes half one. */
    const openLocated = mediaFake();
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });
    await awaitLiveCoordinateControls();
    await pickAndSettle(located, openLocated);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "a photo WITH GPS did not fill the box either, so half one proves nothing",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(TOKYO.long);
  });

  /**
   * The other direction of "must not clear anything": a value already in the
   * box, and then a photo with no GPS. Kept separate from the pair above
   * because the failure is a LOSS rather than a no-op — the owner watches their
   * coordinate disappear when they attach a scan.
   */
  it("leaves a coordinate already in the boxes alone", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithGps("beach.jpg", GPS_TOKYO);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    await typeCoordinate(TYPED);
    await pickAndSettle(jpegFile("scan.jpg"), media);
    await waitFor(() => expect(media.puts).toHaveLength(2));

    expect(shownValue(LABEL.latitude), "a photo with no GPS cleared the typed latitude").toBe(
      TYPED.lat,
    );
    expect(shownValue(LABEL.longitude), "a photo with no GPS cleared the typed longitude").toBe(
      TYPED.long,
    );

    cleanup();

    /* THE ALLOW-CASE, IN THE SAME TEST AND WITH A DIFFERENT FILE — and the
       difference is not an oversight, it is what this leg can and cannot prove.
       The refusal above picks `scan.jpg`, which carries no GPS at all, so
       re-picking it here would offer nothing to fill with and the leg would
       assert nothing. It therefore has to be `beach.jpg`, and that makes this
       leg's claim "auto-fill exists and reaches these boxes" rather than "the
       guard above refuses". 11b and 11b-bis are the two that really do use one
       file for both halves, because there the refusal is about who TYPED
       rather than about what the file carries.

       It is still the leg that makes this test red before the implementation
       lands: without it, every refusal above is satisfied by an editor that
       never auto-fills anything — "a rule that rejects everything is useless",
       and section 1's home-region test carries its allow-case for the same
       reason. */
    const openScan = mediaFake();
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });
    await awaitLiveCoordinateControls();
    await pickAndSettle(source, openScan);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the same photo fills nothing on a form nobody has typed into: the refusal above proves only that auto-fill does not exist",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(TOKYO.long);
    expect(describedTextOf(LABEL.latitude), "the filled control names no source photo").toMatch(
      alt(source),
    );
  });
});

/* ────────── 11e. the auto-filled coordinate still goes through §9 ─────────── */

describe("entry editor — what a stranger can fetch after an auto-fill", () => {
  /**
   * THE MOST IMPORTANT ASSERTION IN THIS STAGE, and the brief says so.
   *
   * A photo's GPS is a coordinate like any other, and §9 has no second path for
   * it: "The studio applies fuzzing before the write and discards the precise
   * original." The tempting shortcut is the one that makes the whole feature a
   * privacy regression — a photo's GPS is *already* a real reading, so it
   * arrives looking authoritative, and an implementation that puts it on the
   * `Entry` directly publishes the exact spot a picture was taken. There is no
   * render-time mitigation behind this and no second chance after the PUT.
   *
   * THE ORDER IS THE FEATURE, and step 4 fixes it: feed the FORM, not the write
   * path. The inputs hold the precise coordinate exactly as manual entry does,
   * and `fuzzForPublication` runs at save as it already does — one path to the
   * Pod rather than two, and §9's guarantee comes from that path being the only
   * route.
   *
   * TWO HALVES, TWO FIXTURES, and the delta's second trap is why: a mutation
   * proves nothing unless the fixture can reach the mutated branch. The
   * snapped half needs GPS OUTSIDE the home region; the no-geometry half needs
   * GPS INSIDE it. Both are checked against the real `readPrivacySettings` and
   * the real `fuzzForPublication` in this section's control, over the very
   * `privacy.ttl` the harness serves — not asserted here for the first time.
   *
   * §9 STEP 2 IS DROPPED, NOT COARSENED: "Inside the home radius, drop the
   * coordinate entirely. Do not coarsen it." A photo taken at home publishes no
   * geometry at all, and the entry is still written.
   *
   * THE SETTINGS ARE WAITED FOR BEFORE EITHER SAVE — the delta's first trap,
   * which has already made two pins in this file vacuous this stage. §7.6
   * arrives over MSW mid-flight; this test asserts on a save AND depends on the
   * settings being loaded, so it is the most exposed one in the section.
   * `awaitLiveCoordinateControls` is that wait, and it checks the precision is
   * showing §7.6's own 500 rather than merely that a control is enabled.
   *
   * WHAT WOULD BREAK IT: building `place.geo` from `metadata.gps` instead of
   * from the form; calling `fuzzForPublication` for typed coordinates and not
   * for auto-filled ones; skipping the home-region check for a photo's GPS
   * because "the camera was there, so it is a fact"; coarsening instead of
   * dropping.
   */
  it("publishes the snapped pair from a photo's GPS, and no geometry at all from one taken at home", async () => {
    const fake = fakeStudioSession();

    /* ── half one: outside the home region, snapped ───────────────────────── */
    const pod = podFake();
    const media = mediaFake();
    const away = jpegWithGps("bridge.jpg", GPS_OUTSIDE_HOME);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    fillNewEntry();
    await awaitLiveCoordinateControls();
    await pickAndSettle(away, media);

    /* THE PREMISE: the FORM holds the precise pair, which is step 4's decision
       and the thing that makes the snap below a snap of the photo's reading. */
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the photo's coordinate never reached the control: `offerCoordinate` did not fill it, and everything after this line is about a form the photo did not touch",
      ).not.toBe("");
    });
    const rawLat = shownValue(LABEL.latitude);
    const rawLong = shownValue(LABEL.longitude);
    expect(Number(rawLat), "the form does not hold the photo's latitude").toBe(AWAY.lat);
    expect(Number(rawLong), "the form does not hold the photo's longitude").toBe(AWAY.long);

    /* Not `clickSaveAndWait`: the attached photo's own `role="status"` has
       already made `outcomeText()` non-empty (10e's reasoning). */
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());
    await waitFor(() => expect(pod.indexPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);

    /* The premise that this is the save of the form that was filled in. */
    expect(oneObject(quads, `${put.url}#it`, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );

    const geo = geoNodeOf(quads, put.url);
    expect(
      geo,
      "a photo's GPS published no geometry outside the home region: the auto-fill never reached the save path",
    ).toBeDefined();
    for (const predicate of [SCHEMA.latitude, GEO.lat]) {
      expect(
        Number(oneObject(quads, geo!, predicate)?.value),
        `${predicate} is not the snapped latitude`,
      ).toBe(SNAP_OUTSIDE_500.lat);
    }
    for (const predicate of [SCHEMA.longitude, GEO.long]) {
      expect(
        Number(oneObject(quads, geo!, predicate)?.value),
        `${predicate} is not the snapped longitude`,
      ).toBe(SNAP_OUTSIDE_500.long);
    }
    expect(oneObject(quads, geo!, DY.precisionMeters)?.value).toBe("500");
    expect(datatypeOf(oneObject(quads, geo!, SCHEMA.latitude))).toBe(XSD.decimal);

    /* THE PHOTO'S RAW READING IS IN NOTHING THAT LEFT THE BROWSER. Not scoped
       to the entry document: through the index row or a query string is still
       out. Read off the CONTROLS rather than from a literal, so this is the
       value that was actually in flight. */
    const wire = pod.wire();
    expect(wire, "the photo's raw latitude is on the wire").not.toContain(rawLat);
    expect(wire, "the photo's raw longitude is on the wire").not.toContain(rawLong);
    /* …and the snapped one IS, so "nowhere" cannot be satisfied by publishing
       no coordinate. */
    expect(wire).toContain(String(SNAP_OUTSIDE_500.lat));

    /* The index row carries the same snapped pair — §7.4's flat dy: terms. */
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put.url);
    expect(row, "no index row points at the entry that was just written").toBeDefined();
    expect(Number(oneObject(rows, row!, DY.lat)?.value)).toBe(SNAP_OUTSIDE_500.lat);
    expect(Number(oneObject(rows, row!, DY.long)?.value)).toBe(SNAP_OUTSIDE_500.long);

    /* No blank nodes anywhere in it (§11 guardrail 4) — `triples` throws. */
    expect(() => triples(put.body, put.url)).not.toThrow();

    cleanup();

    /* ── half two: taken at home, so §9 step 2 drops it entirely ──────────── */
    const home = podFake();
    const homeMedia = mediaFake();
    const athome = jpegWithGps("kitchen.jpg", GPS_INSIDE_HOME);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    fillNewEntry();
    await awaitLiveCoordinateControls();
    await pickAndSettle(athome, homeMedia);

    /* THE PREMISE THAT MAKES THIS HALF NON-VACUOUS: the auto-fill DID happen.
       Without it "no geometry was published" is satisfied by an editor that
       never read `metadata.gps` at all — which is what this test was red
       against before `offerCoordinate` landed, and which must fail this test on
       the half above rather than pass it here. */
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the at-home photo filled nothing, so 'no geometry' says nothing about the home region",
      ).not.toBe("");
    });
    const homeLat = shownValue(LABEL.latitude);
    const homeLong = shownValue(LABEL.longitude);
    expect(Number(homeLat)).toBe(AT_HOME.lat);
    expect(Number(homeLong)).toBe(AT_HOME.long);

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(home.entryPut()).toBeDefined());
    await waitFor(() => expect(home.indexPut()).toBeDefined());

    const homePut = home.entryPut()!;
    const homeQuads = quadsOf(homePut.body, homePut.url);

    /* THE ENTRY IS STILL WRITTEN. §9: "it is the geometry that is absent, not
       the entry." */
    expect(oneObject(homeQuads, `${homePut.url}#it`, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );

    /* NOT ONE COORDINATE TRIPLE, anywhere in the document. */
    for (const predicate of [
      SCHEMA.geo,
      SCHEMA.latitude,
      SCHEMA.longitude,
      GEO.lat,
      GEO.long,
      DY.precisionMeters,
    ]) {
      expect(
        homeQuads.filter((q) => q.predicate.value === predicate),
        `${predicate} survived a photo taken inside the home region`,
      ).toEqual([]);
    }

    /* Nor the digits, anywhere on the wire — this is the pair that would
       identify the owner's front door. */
    expect(home.wire(), "the at-home photo's latitude is on the wire").not.toContain(homeLat);
    expect(home.wire(), "the at-home photo's longitude is on the wire").not.toContain(homeLong);

    /* …and the index row carries none of it either. */
    const { quads: homeRows, row: homeRow } = indexRowOf(
      home.indexPut()!.body,
      home.indexPut()!.url,
      homePut.url,
    );
    expect(homeRow, "the entry has no row in the index it was written to").toBeDefined();
    for (const predicate of [DY.lat, DY.long, DY.precisionMeters]) {
      expect(
        objectsOf(homeRows, homeRow!, predicate),
        `the index row kept ${predicate} for a photo taken inside the home region`,
      ).toEqual([]);
    }
  });
});

/* ─────────────── 11f. the auto-filled coordinate survives a lost tab ──────── */

describe("entry editor — an auto-filled coordinate in the local draft", () => {
  /**
   * NOT IN THE BRIEF, and asserted because "probably, via a neighbour" is the
   * shape that hid a real defect in phase 2: a `clearTimeout` was deletable
   * with 80 tests green, because every one of them drove the path where another
   * mechanism covered for it.
   *
   * It probably IS already covered — attaching a photo mutates `slots`, which
   * arms the autosave, so the coordinate should ride along — and that is
   * exactly the reason to pin it rather than assume it. `docs/decisions.md`
   * §10: losing a long entry in a hostel is what kills the habit.
   *
   * THE INVARIANT, NOT THE BYTES. `savedAt` is a field a live debounce is
   * allowed to move, and section 8's fake clock cannot be used here — the
   * settings arrive over the network and a faked timer stops everything that
   * waits on one. So this uses 8h's mechanism instead: the UNMOUNT flushes the
   * pending window, on real timers.
   *
   * WHAT WOULD BREAK IT: filling the boxes through a path that does not mark
   * the form touched, so the autosave effect returns at `if (!touched.current)`
   * and the window is never armed; holding the auto-filled value outside the
   * `lat`/`long` state the draft is built from.
   *
   * …AND THE FIRST OF THOSE TWO IS NOT REACHABLE FROM HERE, WHICH IS RECORDED
   * RATHER THAN FIXED. `offerCoordinate` is called from exactly one place, on
   * the line after `move({ state: "ready" })`, and `move` sets
   * `touched.current = true` for `ready`. The fill's own `touched.current =
   * true` is therefore an idempotent write unconditionally dominated in the
   * same continuation — never the first writer — so deleting it turns nothing
   * in this file red, and the production comment beside it says exactly that.
   * What this test's failure can only be about is the second clause: the VALUE
   * in the flushed draft.
   *
   * THE ARMING INVARIANT IS PINNED, BY 10f, FOR THE OTHER MECHANISM: a save
   * landing between the pick and the settle, where `settleDraft` has already
   * put `touched` back to `false` at the moment the photo becomes `ready`.
   * Removing `if (next.state === "ready") touched.current = true` from `move`
   * turns 10f red with `[]` for the draft keys, which is measured in 10f's own
   * docblock.
   *
   * A TEST FOR THE ARMING HALF HERE IS DELIBERATELY NOT ADDED, so that the next
   * reader does not "fix" its absence. Exposing it would require deleting
   * mechanism 2 as well — a source mutation, not a test — and a test that can
   * only fail when two mechanisms are removed at once is worse than no test:
   * it passes for every single-line regression either one of them has, while
   * reading like coverage of both.
   */
  it("keeps a coordinate a photo filled, not the one that would be published", async () => {
    const media = mediaFake();
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: store.storage,
    });

    await awaitLiveCoordinateControls();
    await pickAndSettle(jpegWithGps("bridge.jpg", GPS_OUTSIDE_HOME), media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the photo's coordinate never reached the control: `offerCoordinate` did not fill it, and everything after this line is about a form the photo did not touch",
      ).not.toBe("");
    });

    const rawLat = shownValue(LABEL.latitude);
    const rawLong = shownValue(LABEL.longitude);
    fillNewEntry();
    cleanup();

    expect(store.calls.set, "nothing was kept at all").not.toEqual([]);
    const written = store.calls.set.at(-1)!;
    expect(written.key).toBe(draftKeyFor(OWNER, NEW_SCOPE));

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );
    expect(payload.lat, "the draft does not hold the coordinate the photo filled").toBe(rawLat);
    expect(payload.long).toBe(rawLong);

    /* …and it is the FORM's value rather than the published one, 8h's decision
       carried over: `localStorage` is not a resource and never leaves the
       browser. */
    expect(written.value, "the draft holds the SNAPPED pair, not the one the form holds").not.
      toContain(String(SNAP_OUTSIDE_500.lat));
  });
});

/* ────────────── 11g. a photo is never the only way to reach a value ───────── */

describe("entry editor — typing over what a photo filled", () => {
  /**
   * SCENARIO 7, and the second half of §11.3's sentence: "adding a photo is
   * never the only way to reach a value." The direction with no photo in it at
   * all is section 1's, which types a coordinate into a form that has never
   * seen one; this is the harder direction — a control auto-fill has already
   * written into, which an implementation may reasonably have marked as "filled
   * by beach.jpg" and may be tempted to keep authoritative.
   *
   * THE SECOND CLAIM IS WHAT MAKES IT MORE THAN SCENARIO 6: once the owner has
   * typed over an auto-filled value, that box is OWNER-TOUCHED, so a later
   * photo may not take it back. Without this half, an editor that accepted the
   * keystroke and then reverted on the next `ready` passes.
   *
   * WHAT WOULD BREAK IT: making the auto-filled control read-only or disabled;
   * re-applying the photo's value on any later render or any later `ready`;
   * setting the owner-touch flag only for a box that was empty when it was
   * typed into.
   */
  it("lets the owner type over an auto-filled coordinate, and a later photo does not take it back", async () => {
    const media = mediaFake();
    const fake = fakeStudioSession();
    const first = jpegWithGps("beach.jpg", GPS_TOKYO);
    const later = jpegWithGps("shrine.jpg", GPS_USHUAIA);
    await renderEditor(fake.session, { pipeline: fakePipeline().pipeline, storage: fakeStorage().storage });

    await awaitLiveCoordinateControls();
    await pickAndSettle(first, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the photo's coordinate never reached the control: `offerCoordinate` did not fill it, and everything after this line is about a form the photo did not touch",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude)), "the first photo did not fill the box").toBe(
      TOKYO.lat,
    );

    /* THE OWNER TYPES OVER IT, in both boxes. */
    expect(typeAsUser(LABEL.latitude, TYPED.lat), "the auto-filled latitude refused a keystroke").
      toBe(true);
    expect(typeAsUser(LABEL.longitude, TYPED.long), "the auto-filled longitude refused a keystroke").
      toBe(true);
    expect(shownValue(LABEL.latitude), "the typed latitude did not stick").toBe(TYPED.lat);
    expect(shownValue(LABEL.longitude), "the typed longitude did not stick").toBe(TYPED.long);

    /* AND A LATER PHOTO DOES NOT TAKE IT BACK. */
    await pickAndSettle(later, media);
    await waitFor(() => expect(media.puts).toHaveLength(4));

    expect(
      shownValue(LABEL.latitude),
      "a photo picked after the owner typed over an auto-fill reverted the latitude",
    ).toBe(TYPED.lat);
    expect(
      shownValue(LABEL.longitude),
      "a photo picked after the owner typed over an auto-fill reverted the longitude",
    ).toBe(TYPED.long);

    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      for (const source of [first, later]) {
        expect(
          describedTextOf(label),
          `a note credits ${source.name} for a value the owner typed`,
        ).not.toMatch(alt(source));
      }
    }
  });
});

/* ──── 11h. the fill asks the same gate every other coordinate writer does ── */

describe("entry editor — a photo's GPS against settings that cannot be read", () => {
  /**
   * §9 FAILS CLOSED, AND A PHOTO IS NOT AN EXCEPTION TO IT.
   *
   * With `privacy.ttl` unreadable — a 404, which is what a Pod that has never
   * had one answers, and §9's own example — all three coordinate controls are
   * DEAD and already carry `NO_SETTINGS_NOTE`: "This entry will be saved
   * without a map pin". Section 1 pins that state. What this pins is the one
   * writer that does not arrive as a keystroke: the fill has no gate check, so
   * a GPS photo fills two disabled boxes and composes into the same accessible
   * description a second sentence reading "Latitude and longitude came from
   * beach.jpg. Type in either box to replace them." That is an instruction to
   * type into a control the owner cannot type into, beside the sentence saying
   * no pin will be saved — two claims in one description, and the one that is
   * false is the one that looks actionable.
   *
   * IT IS A MECHANISM AND NOT ONLY A CONTRADICTION. `fuzzed()` returns
   * `undefined` for any gate that is not `ready`, and `placeFor` reads
   * `undefined` as a REMOVAL — so on an EDIT this same fill deletes the entry's
   * stored `#geo`. That is 11i's third outcome, reached from here rather than
   * from the home region. Before the picker existed the fail-closed branch was
   * harmless in that direction only because the boxes could not become
   * non-empty, which is the sort of safety that stops being safety without
   * anything changing where it was written.
   *
   * THE STATE IS DRIVEN BY A REAL DOCUMENT, NOT BY A STUB, which is section 1's
   * arrangement and this file's docblock's reason: "the settings could not be
   * read" is the state the whole feature turns on, so it is produced by a real
   * read of a real (missing) resource over MSW and put through the real reader.
   *
   * WHAT WOULD BREAK IT: no gate check in the fill, which is the defect;
   * gating the fill on `presetPrecision` or on the precision select instead of
   * on the gate itself — both are `""` while the read is still in flight, so
   * that spelling refuses the CHECKING state for the wrong reason and says
   * nothing about a read that FAILED; leaving the note in place while
   * disabling the boxes.
   */
  it("fills nothing, and credits nothing, when the privacy settings cannot be read", async () => {
    podFake({ settings: 404 });
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithGps("beach.jpg", GPS_TOKYO);
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    /* THE STATE THIS TEST IS ABOUT, ASSERTED BEFORE THE PICK. Section 1's pin
       is the premise here: without it every assertion below would hold on a
       form whose settings had simply not arrived yet, which is the delta's
       first trap and has already made two pins in this file vacuous. */
    requireCoordinateControls();
    await waitFor(() =>
      expect(
        screen.getByLabelText(LABEL.latitude),
        "the latitude control never explained why it is dead, so this test never reached the fail-closed state it is about",
      ).toHaveAccessibleDescription(NO_SETTINGS_REASON),
    );
    for (const [what, control] of coordinateControls()) {
      expect(
        control,
        `the ${what} control takes input although the settings could not be read`,
      ).toBeDisabled();
    }
    expect(shownValue(LABEL.latitude), "the latitude box was not empty to begin with").toBe("");
    expect(shownValue(LABEL.longitude), "the longitude box was not empty to begin with").toBe("");

    await pickAndSettle(source, media);
    /* Given a moment to get it wrong: the fill lands in `attach`'s
       continuation, so a bare synchronous assertion would pass against an
       editor that filled one tick later (11b's reasoning). */
    await waitFor(() => expect(media.puts).toHaveLength(2));

    expect(
      shownValue(LABEL.latitude),
      "a photo filled the latitude of a form whose settings could not be read: the fill does not ask the gate, and on an edit that same fill deletes the entry's stored #geo",
    ).toBe("");
    expect(
      shownValue(LABEL.longitude),
      "a photo filled the longitude of a form whose settings could not be read",
    ).toBe("");

    /* AND THE CONTROLS ARE STILL DEAD. A fill that also brought them alive
       would be a second defect wearing the first one's clothes. */
    for (const [what, control] of coordinateControls()) {
      expect(
        control,
        `the ${what} control came alive because a photo filled it, on settings this app does not trust`,
      ).toBeDisabled();
    }

    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      expect(
        describedTextOf(label),
        "a note credits a photo for a value in a control the owner cannot type into, and tells them to type in it",
      ).not.toMatch(alt(source));
      /* …and the reason it is dead is still being said. "The note went away"
         must not be the way this passes. */
      expect(
        describedTextOf(label),
        "the control stopped saying why it is dead",
      ).toMatch(NO_SETTINGS_REASON);
    }

    /* THE PHOTO ITSELF IS UNAFFECTED: an unreadable privacy.ttl costs the owner
       a map pin, not a picture. */
    expect(media.puts, "the photo's derivatives never went up").toHaveLength(2);
    await screen.findByRole("img", { name: alt(source) });

    cleanup();

    /* THE ALLOW-CASE, IN THE SAME TEST AND WITH THE SAME FILE, and it is what
       stops the refusal above being satisfied by an editor that never
       auto-fills anything — and by the one-liner written as an unconditional
       `return`. Readable settings, so the gate is open and the photo MAY fill —
       and must. `podFake()` re-registers §7.6's normative block and msw's
       `use()` prepends, so it wins over the 404 above (section 1's arrangement
       exactly). */
    podFake();
    const openMedia = mediaFake();
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });
    await awaitLiveCoordinateControls();
    await pickAndSettle(source, openMedia);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the same photo fills nothing on a form whose settings ARE readable: the refusal above proves only that auto-fill does not exist",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(TOKYO.long);
    expect(describedTextOf(LABEL.latitude), "the filled control names no source photo").toMatch(
      alt(source),
    );
  });
});

/* ──── 11i. a photo can never take away a pin an edit was loaded with ─────── */

/**
 * RULING T3-B, AT THE WIRE. See the section docblock for the ruling; these two
 * tests are its consequences, and both of them destroy data a stranger can
 * already fetch.
 *
 * WHY THE SUITE DID NOT ALREADY CATCH THIS, measured rather than supposed. The
 * opposite invariant is asserted in section 3 — "they were stored fuzzed and
 * must survive an edit exactly as they are" — and it stays green because that
 * test picks no photo. The one existing test that edits AND picks
 * ("keeps both, and numbers the new one after the one that was there") asserts
 * nothing about geometry at all: swapping `jpegWithGps` into its fixture leaves
 * it passing, verified before these tests were written. So the two halves of
 * the defect each sat under a green test, and neither test could see the other
 * half. That is why these are new tests rather than a fixture swap.
 *
 * BOTH LEGS ASSERT AT THE WIRE AND NOT ONLY ON THE CONTROLS, because a deletion
 * has no other surface: the boxes are empty either way, no message is shown, and
 * the entry saves successfully. The only place a dropped `#geo` is visible is
 * the outgoing Turtle and the index row built from it — which is also where a
 * VISITOR sees it, since §7.4's row is what the public trip page renders a pin
 * from.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — a photo's GPS on an entry that already has a pin", () => {
  /**
   * OUTCOME 1: THE PIN MOVES. Settings ready, photo taken away from home, so
   * `fuzzForPublication` snaps rather than drops and the snapped pair REPLACES
   * the coordinate the entry was stored with. Attach a photo of a bridge in
   * Milan to an entry about Shinjuku and the entry is published in Milan.
   *
   * `specEntry()` IS THE FIXTURE BECAUSE IT CARRIES GEOMETRY (§7.3, and the
   * normative block is the contract — §11 guardrail 6). The stored pair is read
   * out of it and never typed here, so this cannot pass against a fixture that
   * stopped carrying a pin: that is what the two premise assertions are for.
   *
   * THE PHOTO IS `GPS_OUTSIDE_HOME`, which this section's control has already
   * put through the real `readPrivacySettings` and the real
   * `fuzzForPublication` against the very §7.6 document the harness serves, and
   * shown to SNAP to `SNAP_OUTSIDE_500`. So the branch this test needs is
   * reachable and the mutation can go red — the delta's second trap answered
   * where it is answerable, in a control rather than here.
   *
   * WHAT WOULD BREAK IT: seeding the author record `nobody` on an edit, which
   * is the defect; seeding it from `lat`/`long` (both are `""` on an edit by
   * design, so that is the same bug spelled differently); consulting the record
   * in `save()` instead, which would publish nothing for every photo-filled
   * CREATE.
   */
  it("keeps the geometry an edit was loaded with, and credits the photo with nothing", async () => {
    const pod = podFake();
    const media = mediaFake();
    const fake = fakeStudioSession();
    const away = jpegWithGps("bridge.jpg", GPS_OUTSIDE_HOME);
    const entry = await specEntry();

    /* NON-VACUOUS: §7.3 really does carry a pin to lose, and it is a fuzzed one
       — which is why it is allowed to be on a world-readable resource at all. */
    const stored = entry.place?.geo;
    expect(stored, "the §7.3 fixture carries no coordinate to keep").toBeDefined();
    expect(stored!.precisionMeters, "the fixture's pin is not a fuzzed one").toBe(500);

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    await awaitLiveCoordinateControls();

    /* THE DESIGN, AND THE PREMISE OF THE WHOLE RULING: both boxes are empty on
       an edit, and `save()` reads empty as "leave the stored coordinate
       alone". */
    expect(shownValue(LABEL.latitude), "the latitude box was prefilled on an edit").toBe("");
    expect(shownValue(LABEL.longitude), "the longitude box was prefilled on an edit").toBe("");

    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await pickAndSettle(away, media);
    await waitFor(() => expect(media.puts).toHaveLength(2));

    /* Not `clickSaveAndWait`: the attached photo's own `role="status"` has
       already made `outcomeText()` non-empty (10e's reasoning). */
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());
    await waitFor(() => expect(pod.indexPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);

    /* The mutation half: this is a save that changed something. */
    expect(oneObject(quads, `${put.url}#it`, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited",
    );

    /* THE PIN DID NOT MOVE. Compared as NUMBERS (§11 guardrail 6) against what
       the fixture arrived with, and the datatype checked too: a value that
       merely passed through is held to §6 like any other. */
    const geo = geoNodeOf(quads, put.url);
    expect(geo, "the edit dropped the #geo node the entry arrived with").toBeDefined();
    for (const [predicate, expected] of [
      [SCHEMA.latitude, stored!.lat],
      [GEO.lat, stored!.lat],
      [SCHEMA.longitude, stored!.long],
      [GEO.long, stored!.long],
    ] as const) {
      const term = oneObject(quads, geo!, predicate);
      expect(
        Number(term?.value),
        `${predicate} is not the coordinate this entry was stored with: attaching a photo moved the entry's published pin to wherever the picture was taken`,
      ).toBe(expected);
      expect(datatypeOf(term), predicate).toBe(XSD.decimal);
    }
    expect(oneObject(quads, geo!, DY.precisionMeters)?.value).toBe(
      String(stored!.precisionMeters),
    );

    /* AND NEITHER THE PHOTO'S READING NOR WHAT §9 WOULD HAVE PUBLISHED FROM IT
       IS ON ANYTHING THAT LEFT THE BROWSER. Against the module constants rather
       than against the controls: the boxes are empty, and `not.toContain("")`
       is true of every string — reading the expectation off the form here would
       be the vacuous spelling. */
    const wire = pod.wire();
    expect(
      wire,
      "the photo's snapped coordinate was published over the entry's own",
    ).not.toContain(String(SNAP_OUTSIDE_500.lat));
    expect(wire).not.toContain(String(SNAP_OUTSIDE_500.long));
    expect(wire, "the photo's raw reading is on the wire").not.toContain(String(AWAY.lat));
    expect(wire).not.toContain(String(AWAY.long));

    /* THE INDEX ROW CARRIES THE SAME PAIR. §7.4's row is what the public trip
       page renders, so a pin that survived in the document and not in the row
       is a pin the visitor has lost. */
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put.url);
    expect(row, "the edited entry has no row in the index it was written to").toBeDefined();
    expect(
      Number(oneObject(rows, row!, DY.lat)?.value),
      "the index row's pin moved to the photo's",
    ).toBe(stored!.lat);
    expect(Number(oneObject(rows, row!, DY.long)?.value)).toBe(stored!.long);

    /* AND THE CONTROLS ARE WHERE THE EDIT LEFT THEM: empty, crediting nobody.
       The latitude hint promises "Leave both boxes empty to keep the coordinate
       this entry already has", and this is that promise in the presence of the
       picker. */
    expect(shownValue(LABEL.latitude), "the photo filled the latitude of an edit").toBe("");
    expect(shownValue(LABEL.longitude), "the photo filled the longitude of an edit").toBe("");
    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      expect(
        describedTextOf(label),
        "a note credits the photo for a coordinate the form does not hold and the entry did not get from it",
      ).not.toMatch(alt(away));
    }

    cleanup();

    /* THE ALLOW-CASE, WITH THE SAME FILE AND THE SAME FIXTURE MINUS ITS PIN.
       An entry with no geometry has nothing to lose, so the photo MAY fill —
       and must. This is the FALSE branch of the one-liner that fixes both legs
       here, and it is the only thing standing between that fix and its lazy
       spelling: an unconditional `{ kind: "owner" }` would switch auto-fill off
       for every edit ever made, silently, and every refusal above would still
       pass. It is also §11.3's second half on an edit — "adding a photo is
       never the only way to reach a value" has a mirror image, and this is it. */
    const openMedia = mediaFake();
    const unpinned: Entry = { ...entry, place: { ...entry.place!, geo: undefined } };
    expect(
      unpinned.place?.geo,
      "the unpinned fixture still carries a coordinate, so this leg is the same case as the one above",
    ).toBeUndefined();
    expect(
      unpinned.place?.name?.value,
      "the unpinned fixture lost its place name too, so it is not the entry this leg claims to edit",
    ).toBe(SPEC_PLACE_NAME);

    await renderEditor(fake.session, {
      initial: { entry: unpinned, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });
    await awaitLiveCoordinateControls();
    await pickAndSettle(away, openMedia);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "the same photo fills nothing on an edit of an entry with no pin to protect: auto-fill is off for every edit, and the refusals above prove only that",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(AWAY.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(AWAY.long);
    expect(describedTextOf(LABEL.latitude), "the filled control names no source photo").toMatch(
      alt(away),
    );
  });

  /**
   * OUTCOME 2: THE PIN IS DELETED, AND THIS IS THE ORDINARY CASE.
   *
   * Settings ready, photo taken INSIDE the home region, so `fuzzForPublication`
   * DROPS — §9 step 2, "inside the home radius, drop the coordinate entirely.
   * Do not coarsen it." `fuzzed()` returns `undefined` for a drop, and
   * `placeFor` reads `undefined` as a REMOVAL rather than an omission (which is
   * correct and deliberate: it is what lets an owner retract a coordinate at
   * all). The two correct pieces compose into a deletion nobody asked for.
   *
   * Attach a photo you took at home to an entry you are correcting, and that
   * entry loses its pin — from the document AND from the index row the public
   * trip page renders it from. No message says so, the save reports success,
   * and the boxes look exactly as they did.
   *
   * THE FIXTURE REALLY REACHES THE DROP BRANCH, and it is not asserted here for
   * the first time: this section's control runs `GPS_INSIDE_HOME` through the
   * real `fuzzForPublication` against the real §7.6 document and shows
   * `{ kind: "drop", reason: "insideHome" }`. Without that, "the geometry
   * survived" would be a claim about a photo that never triggered a drop.
   *
   * THE ALLOW-CASE FOR BOTH TESTS IS IN THE ONE ABOVE — an edit of an entry
   * with no stored geometry, where the same fill must still happen. It is
   * deliberately not repeated here: it is the same one-liner's false branch,
   * and a second copy would cost two renders and pin nothing new.
   *
   * WHAT WOULD BREAK IT: the same seeding defect as outcome 1; "fill, then drop
   * only the NEW coordinate" spellings that treat a drop as an omission —
   * which would fix this test and break §9's retraction, so `placeFor` is not
   * where this belongs.
   */
  it("does not delete the pin when the photo was taken inside the home region", async () => {
    const pod = podFake();
    const media = mediaFake();
    const fake = fakeStudioSession();
    const athome = jpegWithGps("kitchen.jpg", GPS_INSIDE_HOME);
    const entry = await specEntry();

    const stored = entry.place?.geo;
    expect(stored, "the §7.3 fixture carries no coordinate to lose").toBeDefined();
    expect(stored!.precisionMeters, "the fixture's pin is not a fuzzed one").toBe(500);

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
      storage: fakeStorage().storage,
    });

    await awaitLiveCoordinateControls();
    expect(shownValue(LABEL.latitude), "the latitude box was prefilled on an edit").toBe("");
    expect(shownValue(LABEL.longitude), "the longitude box was prefilled on an edit").toBe("");

    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await pickAndSettle(athome, media);
    await waitFor(() => expect(media.puts).toHaveLength(2));

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());
    await waitFor(() => expect(pod.indexPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);

    /* The mutation half, and here it is doing double duty: the save went
       through, which is what makes the missing geometry a deletion rather than
       a refusal. */
    expect(oneObject(quads, `${put.url}#it`, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited",
    );

    /* THE PIN IS STILL THERE. This is the assertion the defect fails, and it can
       only be made here: on screen nothing changed and the save said it
       worked. */
    const geo = geoNodeOf(quads, put.url);
    expect(
      geo,
      "the entry's #geo was DELETED from a world-readable resource: a photo taken inside the home region fuzzed to `undefined`, and `placeFor` reads `undefined` as a removal",
    ).toBeDefined();
    for (const [predicate, expected] of [
      [SCHEMA.latitude, stored!.lat],
      [GEO.lat, stored!.lat],
      [SCHEMA.longitude, stored!.long],
      [GEO.long, stored!.long],
    ] as const) {
      const term = oneObject(quads, geo!, predicate);
      expect(
        Number(term?.value),
        `${predicate} is not the coordinate this entry was stored with`,
      ).toBe(expected);
      expect(datatypeOf(term), predicate).toBe(XSD.decimal);
    }
    expect(oneObject(quads, geo!, DY.precisionMeters)?.value).toBe(
      String(stored!.precisionMeters),
    );

    /* AND THE PLACE KEPT ITS NAME, so this is "the pin survived" rather than
       "the whole place node happened to survive". */
    const place = placeNodeOf(quads, put.url);
    expect(place, "the edit dropped the place node the entry arrived with").toBeDefined();
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe(SPEC_PLACE_NAME);

    /* THE INDEX ROW KEPT IT TOO — this is the surface a visitor loses the pin
       on, since §7.4's row is what the public trip page renders. */
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put.url);
    expect(row, "the edited entry has no row in the index it was written to").toBeDefined();
    expect(
      objectsOf(rows, row!, DY.lat).map((t) => Number(t.value)),
      "the index row lost the pin the entry arrived with",
    ).toEqual([stored!.lat]);
    expect(objectsOf(rows, row!, DY.long).map((t) => Number(t.value))).toEqual([stored!.long]);

    /* AND THE OWNER'S FRONT DOOR IS ON NOTHING THAT LEFT THE BROWSER. Against
       the module constant, not the control: the boxes are empty and
       `not.toContain("")` holds for every string. This one is true of today's
       code as well — the drop is what makes it true — and it is here because
       the fix must not buy the pin back by publishing the reading instead. */
    expect(pod.wire(), "the at-home photo's latitude is on the wire").not.toContain(
      String(AT_HOME.lat),
    );
    expect(pod.wire(), "the at-home photo's longitude is on the wire").not.toContain(
      String(AT_HOME.long),
    );

    expect(shownValue(LABEL.latitude), "the photo filled the latitude of an edit").toBe("");
    expect(shownValue(LABEL.longitude), "the photo filled the longitude of an edit").toBe("");
    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      expect(
        describedTextOf(label),
        "a note credits the photo for a coordinate that was never published and is not in the form",
      ).not.toMatch(alt(athome));
    }
  });
});

/* ──── 11j. a coordinate that came back from a draft is not the photo's ───── */

describe("entry editor — a photo after a draft was restored", () => {
  /**
   * `restore()`'s ONE CONDITIONAL CREDIT, IN BOTH DIRECTIONS — and until now
   * neither direction had an assertion about its consequence. The line was
   * REACHED by two existing tests (8h's Restore round trip runs the true
   * branch, the banner tests run the false one), which is a different thing
   * from being covered: reached-and-unasserted is exactly the state that lets a
   * line be deleted with the suite green.
   *
   * THE TRUE BRANCH. `restore()` writes the boxes with no DOM event — the
   * form's own comment says so about `touched` — so it comes through neither
   * `onChange`, and without the credit the record reads `nobody` over a form
   * that visibly holds a pair. Attach a photo and it takes both boxes: §11.3's
   * forbidden overwrite, reached by the one path that does not look like typing.
   *
   * THE FALSE BRANCH MATTERS AS MUCH, and that is the half a "just credit
   * unconditionally" simplification gets wrong. `seededDraft` defaults `lat` and
   * `long` to `""` because a draft with no coordinate in it is the ordinary one
   * — the owner types the story first — and crediting the owner for that would
   * silently switch auto-fill off for the whole session, for everyone who ever
   * clicks Restore. Both legs are therefore here, and each is the other's
   * allow-case.
   *
   * ACCEPTED COST, RECORDED SO IT IS A DECISION AND NOT A DEFECT: a coordinate
   * that came from a photo loses its attribution across a restore. It comes
   * back credited to the owner, and a later photo may not replace it. The draft
   * keeps `lat`/`long` as text and nothing about where they came from, and both
   * available answers are refusals — so the third, "remember it was a photo's",
   * would mean adding a provenance field to the payload to store something no
   * reader needs. The photo itself IS restored into the slot list, so the owner
   * is not left with a number and no explanation.
   *
   * WHAT WOULD BREAK IT: deleting the credit from `restore()` (leg one goes
   * red); crediting unconditionally, i.e. dropping the `if` (leg two goes red);
   * crediting `{ kind: "photo" }` there, which would pass both legs and put a
   * file name that is not on screen into the note.
   */
  it("keeps what a restore put in the boxes, and still fills a draft that held no coordinate", async () => {
    const KEY = draftKeyFor(OWNER, NEW_SCOPE);
    const media = mediaFake();
    const fake = fakeStudioSession();
    const source = jpegWithGps("beach.jpg", GPS_TOKYO);

    /* ── leg one: a draft that HELD a coordinate ─────────────────────────── */
    const kept = fakeStorage({
      [KEY]: JSON.stringify(seededDraft({ lat: TYPED.lat, long: TYPED.long, precision: "500" })),
    });
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: kept.storage,
    });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "no draft was offered, so there is no restore to observe: the editor is reading a key this file no longer writes (v1 rather than v2), or is not reading one at all",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    await awaitLiveCoordinateControls();

    /* THE PREMISE, AND THE WHOLE REASON THE CREDIT IS NEEDED: the pair is in
       the boxes and no keystroke put it there. */
    expect(
      shownValue(LABEL.latitude),
      "Restore did not put the kept latitude back into the control",
    ).toBe(TYPED.lat);
    expect(shownValue(LABEL.longitude)).toBe(TYPED.long);

    await pickAndSettle(source, media);
    await waitFor(() => expect(media.puts).toHaveLength(2));

    expect(
      shownValue(LABEL.latitude),
      "a photo overwrote a latitude a restore had put in the box: `restore()` credited nobody, so the record read `nobody` over a form that visibly held a pair",
    ).toBe(TYPED.lat);
    expect(
      shownValue(LABEL.longitude),
      "a photo overwrote a longitude a restore had put in the box",
    ).toBe(TYPED.long);

    for (const label of [LABEL.latitude, LABEL.longitude] as const) {
      expect(
        describedTextOf(label),
        "a note credits the photo for a coordinate that came back from a draft",
      ).not.toMatch(alt(source));
    }

    cleanup();

    /* ── leg two: the ORDINARY draft, which holds no coordinate at all ───── */
    const openMedia = mediaFake();
    const empty = fakeStorage({ [KEY]: JSON.stringify(seededDraft()) });
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: empty.storage,
    });

    const second = screen.queryAllByRole("region", { name: /draft/i });
    expect(second, "no draft was offered on the second leg").toHaveLength(1);
    fireEvent.click(within(second[0]).getByRole("button", { name: "Restore" }));

    await awaitLiveCoordinateControls();

    /* TWO PREMISES, AND THE SECOND IS THE ONE THAT STOPS THIS LEG BEING "a
       photo filled an untouched form" — which 11a already pins. A restore
       really did happen here, and it left auto-fill alone. */
    expect(
      shownValue(LABEL.latitude),
      "the default seeded draft carries a coordinate, so this leg is not the empty case it is about",
    ).toBe("");
    expect(shownValue(LABEL.longitude)).toBe("");
    expect(
      shownValue(LABEL.headline),
      "the draft was not restored at all, so nothing here is about a restored form",
    ).toBe("Rain on the Philosopher's Path");

    await pickAndSettle(source, openMedia);
    await waitFor(() => {
      expect(
        shownValue(LABEL.latitude),
        "restoring a draft with no coordinate in it switched auto-fill off for the rest of the session: the credit in `restore()` is unconditional",
      ).not.toBe("");
    });
    expect(Number(shownValue(LABEL.latitude))).toBe(TOKYO.lat);
    expect(Number(shownValue(LABEL.longitude))).toBe(TOKYO.long);
    expect(describedTextOf(LABEL.latitude), "the filled control names no source photo").toMatch(
      alt(source),
    );
  });
});

// @vitest-environment jsdom
/** The studio's entry editor: sections 12h-12m — a second photo, a colliding file name, an offset that is not an offset, and two photos in one pick.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  COLLIDING_NAME,
  DRAFT_FIELDS,
  GUESS_WORDING,
  LABEL,
  MACHINE_OFFSET,
  MINUTES_OUT_OF_RANGE_OFFSET,
  NEW_SCOPE,
  OFFSET_MINUTES_OUT_OF_RANGE,
  OFFSET_ONLY,
  OFFSET_OUT_OF_RANGE,
  OUT_OF_RANGE_OFFSET,
  OWNER,
  PHOTOS_LABEL,
  PHOTO_WALL,
  PINNED_ONLY,
  SECOND_OFFSET,
  SECOND_WALL,
  TIMED,
  TIMED_WITH_OTHER_OFFSET,
  alt,
  awaitLiveCoordinateControls,
  clickSaveAndWait,
  datatypeOf,
  describedTextOf,
  draftKeyFor,
  fakePipeline,
  fakeStorage,
  fakeStudioSession,
  jpegWithExif,
  mediaFake,
  metadataOf,
  offsetMarkedAsGuess,
  offsetOptions,
  oneObject,
  outcomeText,
  parseDraft,
  pickAndSettle,
  pickPhoto,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  requireOffsetControl,
  saveButton,
  setChoice,
  setText,
  shownValue,
  wallClockShapes,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { DY, XSD } from "@/lib/vocab";
import type { Pipeline, PipelineResult } from "@/lib/media/pipeline";

registerEditorLifecycle();

/* ─── 12h/12i. two photos, and the timestamp that happened at neither ────── */

describe("entry editor — a second photo with an offset of its own", () => {
  /**
   * RULING T4-E, AND IT IS 11c FOR THE TIMESTAMP. §11.3 names this direction
   * explicitly for the coordinate — "the first photo wins, not the last one" —
   * and until this test the time had no analogue: `TIMED_WITH_OFFSET` was the
   * only fixture in the suite carrying `offsetTimeOriginal`, and no test in
   * section 12 attached two photos.
   *
   * THE SEQUENCE, WHICH IS THE ONE ANY DAY'S WALK PRODUCES:
   *
   *   1. `tokyo.jpg` — a phone in Tokyo with the clock set and no zone tag.
   *      The clock fills, the offset is left as this machine's guess, the mark
   *      goes on and the note names the photo. This is 12c's state exactly.
   *   2. `chathams.jpg` — a phone that writes both. The clock is REFUSED,
   *      correctly, because the first photo already supplied it.
   *   3. And then the offset is ACCEPTED, because `offsetAuthor` is still
   *      `nobody` — the guard asks only about the offset's own record and never
   *      about whose clock is standing beside it.
   *   4. Which composes `07:05` in Tokyo with `+12:45` in the Chathams and, in
   *      the same motion, clears the mark and removes the note: `creditTime`
   *      derives the mark from "a photo dated it and NOBODY offset it", and
   *      step 3 has just made the offset a photo's.
   *
   * WHY IT IS WORSE THAN THE COORDINATE'S VERSION, AND WHY IT IS T3-A's "value
   * that is nowhere" AFTER ALL. T4-C says a wall clock and an offset are not
   * one unit, and it stands: the owner correcting WHEN beside a photo supplying
   * WHERE is coherent, because one side is a competent authority who can see
   * both halves and fix either. Photo-A's clock beside photo-B's zone has no
   * authority anywhere in it, and neither the timestamp nor the warning about
   * it survives. §11.5's own words for what that publishes: "worse than not
   * auto-dating at all, because it looks right".
   *
   * FOUR ASSERTIONS ARE THE DEFECT, AND THE OTHERS ARE THE PREMISE THAT KEEPS
   * THEM HONEST — the clock, the offset, the mark, and the value on the wire.
   * The wire is not decoration: the two halves are concatenated by `save()` at
   * a single line, so an editor could hold both wrong values on screen and be
   * caught only there, and 12a's reasoning about "half a check" applies with
   * the sign reversed.
   *
   * THE ALLOW-CASE IS IN THE SAME RENDER, per the shape three of Task 3's
   * scenarios and three of Task 4's got wrong: before the second pick, the
   * first photo's fill, mark and note are all asserted, so "the first photo's
   * value survived" cannot be satisfied by an editor in which nothing fills.
   *
   * WHAT WOULD BREAK IT: today's code, which guards the zone branch on
   * `offsetTo.kind === "nobody"` alone; guarding it on "no photo has been
   * attached before" rather than on WHOSE clock is beside it, which would break
   * 12b, where the same photo supplies both; clearing the mark whenever any
   * offset arrives from anywhere.
   *
   * WHAT IT MUST NOT COST: 12b. One photo carrying both tags fills both, and
   * the guard has to let that through — which is the case where the clock's
   * record already names the photo being offered.
   */
  it("refuses a second photo's offset beside the first photo's clock, and keeps the warning", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const first = jpegWithExif("tokyo.jpg", TIMED);
    const second = jpegWithExif("chathams.jpg", TIMED_WITH_OTHER_OFFSET);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(
      offsetOptions(),
      `${SECOND_OFFSET} is not one of the offsets this editor offers, so the control could not show it even if the fill this test forbids did happen`,
    ).toContain(SECOND_OFFSET);

    /* ── THE FIRST PHOTO, AND EVERY ASSERTION BELOW RESTS ON IT ─────────── */
    await pickAndSettle(first, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the first photo's date never reached the wall clock, so nothing here is about a second photo standing beside it",
      ).not.toBe("");
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(
      offsetMarkedAsGuess(),
      "the first photo dated the form beside this machine's offset and nothing marks it: 'the mark survived' below cannot be told from 'there was never a mark'",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the marked control does not name the first photo, so 'the note still names it' below is not about a note",
    ).toMatch(alt(first));

    /* ── THE SECOND PHOTO REALLY LANDED — 11c's guard, in its shape: without
       it every refusal below holds for an editor that dropped the pick. ─── */
    await pickAndSettle(second, media);
    expect(rig.processed, "the second file never reached the pipeline").toHaveLength(2);
    expect(media.puts, "the second photo's derivatives never went up").toHaveLength(4);
    expect(media.containers(), "both photos went to one container").toHaveLength(2);
    await screen.findByRole("img", { name: alt(second) });

    /* ── THE REFUSALS ───────────────────────────────────────────────────── */
    expect(
      wallClockShapes(PHOTO_WALL),
      `the wall clock shows ${JSON.stringify(shownValue(LABEL.occurredAt))}: the second photo replaced the first photo's clock`,
    ).toContain(shownValue(LABEL.occurredAt));
    expect(
      shownValue(LABEL.offset),
      "the second photo's zone was accepted beside the FIRST photo's clock: the guard asks whether anyone has set the offset and never whose clock it is standing next to, and the two halves now describe an instant that happened at neither place",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "accepting the second photo's zone cleared the mark on the first photo's clock: the composition §11.5 exists to warn about, with the warning removed by the act of composing it",
    ).toBe(true);

    /* AND THE NOTE STILL NAMES THE PHOTO THE CLOCK IS ACTUALLY FROM — 11c's
       last assertion, for its reason: the value right and the provenance wrong
       is worse than no note at all. */
    expect(
      describedTextOf(LABEL.offset),
      "the note stopped naming the photo whose clock is in the box",
    ).toMatch(alt(first));
    expect(
      describedTextOf(LABEL.offset),
      "the note credits the second photo, which supplied neither the clock in the box nor the offset beside it",
    ).not.toMatch(alt(second));

    /* ── AND WHAT A STRANGER CAN FETCH IS ONE PLACE'S TIME, NOT TWO ─────── */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-two-cameras");
    setText(LABEL.headline, "Two cameras, one morning");
    setText(LABEL.articleBody, "One of them had been to the Chathams.");
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
      occurred!.value,
      "the published timestamp is the first photo's wall clock on the second photo's offset: an instant that happened at neither place, and §11.5's failure exactly",
    ).not.toBe(`${PHOTO_WALL.slice(0, 16)}:00${SECOND_OFFSET}`);
    expect(
      occurred!.value.slice(-6),
      "the published offset is not the one the control holds",
    ).toBe(MACHINE_OFFSET);
    expect(
      occurred!.value.slice(0, 16),
      "the published wall clock is not the first photo's",
    ).toBe(PHOTO_WALL.slice(0, 16));
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
    expect(
      pod.wire(),
      "the second photo's zone is on the wire for an entry it did not date",
    ).not.toContain(SECOND_OFFSET);
    expect(
      pod.wire(),
      "the second photo's wall clock is on the wire",
    ).not.toContain(SECOND_WALL.slice(0, 16));
  });
});

describe("entry editor — a second photo with a clock of its own", () => {
  /**
   * THE MIRROR OF 12h, AND UNGUARDED IN THE SAME PLACE FOR THE SAME REASON.
   * The order of the two picks is an accident of which photo the owner reaches
   * for first; the composition it produces is identical, so the answer has to
   * be. Here `chathams.jpg` carries a zone and NO clock — legal in EXIF and
   * read independently by `lib/media/exif.ts` — and `tokyo.jpg` then arrives
   * with a clock and no zone. The wall branch asks only `occurredTo.kind ===
   * "nobody"`, so it fills, and the form holds Tokyo's clock on the Chathams'
   * offset.
   *
   * IT IS THE HALF THE OBVIOUS FIX MISSES. Guarding the ZONE branch on whose
   * clock stands beside it — the fix 12h asks for — leaves this direction
   * exactly as it is, because nothing in the wall branch asks whose OFFSET is
   * standing beside the clock. Two guards, or neither.
   *
   * NOTHING IS MARKED HERE, IN EITHER STATE, AND THAT IS NOT AN OVERSIGHT. The
   * offset is a photo's rather than this machine's, so T4-A's condition never
   * holds and there is no surface on the form that would warn about this
   * composition — which is the argument for refusing it rather than admitting
   * it and explaining it. A refusal costs the owner one keystroke in a clock
   * they can see; admitting it costs them a timestamp that is wrong and
   * unmarked.
   *
   * THE ALLOW-CASE IS THE FIRST PICK, IN THE SAME RENDER: the zone-only photo
   * must fill the offset, and does today. Without it "the clock stayed empty"
   * is an absence rather than a refusal — the exact shape three of Task 3's
   * scenarios and three of Task 4's had.
   *
   * THE DRAFT IS READ AT THE END FOR 11d's AND 12g's REASON, and here it is
   * load-bearing twice: `setOccurred(String(metadata.dateTimeOriginal))` on a
   * photo with no date writes the characters `undefined` into the state and the
   * `datetime-local` control reads that back as `""` (measured by the control
   * above), so the box cannot tell a refusal from a stringified absence and the
   * flushed draft is the only surface in this test that can.
   *
   * WHAT WOULD BREAK IT: today's code, in which the second photo's clock fills;
   * refusing the FIRST photo's offset too, which the first leg catches; filling
   * the clock and leaving the offset behind, which is the same composition
   * spelled through one control.
   */
  it("refuses a second photo's clock beside the first photo's offset", async () => {
    const media = mediaFake();
    const rig = fakePipeline();
    const store = fakeStorage();
    const fake = fakeStudioSession();
    const first = jpegWithExif("chathams.jpg", OFFSET_ONLY);
    const second = jpegWithExif("tokyo.jpg", TIMED);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: store.storage });

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(
      offsetOptions(),
      `${SECOND_OFFSET} is not one of the offsets this editor offers, so a controlled <select> could not show it even if the first pick's fill were correct`,
    ).toContain(SECOND_OFFSET);

    /* ── THE ALLOW-CASE: a photo that carries only a zone supplies it ───── */
    await pickAndSettle(first, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.offset),
        "the zone-only photo's OffsetTimeOriginal never reached the control, so this render holds no photo's offset and every refusal below is about nothing",
      ).toBe(SECOND_OFFSET);
    });
    expect(
      shownValue(LABEL.occurredAt),
      "a photo that carries no DateTimeOriginal filled the wall clock",
    ).toBe("");
    expect(
      offsetMarkedAsGuess(),
      "the offset came from the photo and is marked as this machine's guess anyway",
    ).toBe(false);

    /* ── THE SECOND PHOTO REALLY LANDED ─────────────────────────────────── */
    await pickAndSettle(second, media);
    expect(rig.processed, "the second file never reached the pipeline").toHaveLength(2);
    expect(media.puts, "the second photo's derivatives never went up").toHaveLength(4);
    expect(media.containers(), "both photos went to one container").toHaveLength(2);
    await screen.findByRole("img", { name: alt(second) });

    /* ── THE REFUSAL ────────────────────────────────────────────────────── */
    expect(
      shownValue(LABEL.occurredAt),
      "the second photo's clock was accepted beside the FIRST photo's zone: Tokyo's five past seven on the Chathams' offset, which is 12h's composition reached by picking the two photos in the other order",
    ).toBe("");
    expect(
      shownValue(LABEL.offset),
      "the second photo moved the offset the first one supplied",
    ).toBe(SECOND_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "the offset is a photo's, not this machine's, and the form says it is a guess",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.offset),
      "the offset control credits the photo that supplied neither the offset it holds nor a clock the form kept",
    ).not.toMatch(alt(second));

    /* ── AND NOT A STRINGIFIED ABSENCE EITHER, in the one surface that can
       see one: the box reads `""` for both, the state does not. ─────────── */
    cleanup();

    expect(
      store.calls.set,
      "nothing was kept at all, so the draft cannot answer this: the picks armed no autosave window",
    ).not.toEqual([]);
    const flushed = store.calls.set.at(-1)!;
    expect(flushed.key).toBe(draftKeyFor(OWNER, NEW_SCOPE));
    const payload = parseDraft(flushed.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );
    expect(
      payload.occurred,
      "the `occurred` state holds the second photo's wall clock, or a stringified absence the control cannot show",
    ).toBe("");
    expect(
      payload.offset,
      "the `offset` state is not the one the first photo supplied",
    ).toBe(SECOND_OFFSET);
  });
});

/* ───── 12j. two photos, ONE file name — ruling T4-E's defect, reopened ──── */

describe("entry editor — two photos whose file names collide", () => {
  /**
   * THE GUARD THAT CLOSED 12h's DEFECT USES THE FILE NAME AS PHOTO IDENTITY,
   * AND THIS FILE SAYS TWO PARAGRAPHS ABOVE IT THAT A FILE NAME IS NOT ONE.
   *
   * `offerTimestamp`'s two guards read `offsetTo.name === name` and
   * `occurredTo.name === name`, where `name` is `file.name`. `PhotoSlot`'s own
   * docblock: *"`key` IS NOT THE FILE NAME. Two files picked from two
   * directories can share one."* `attach` computes a unique `key` on the line
   * after it reads the name, and the guards compare the name anyway. The file
   * input is `multiple`, with no deduplication on name.
   *
   * SO 12h's SEQUENCE WALKS STRAIGHT BACK THROUGH IT, and needs nothing exotic
   * to do so — two cameras, both calling their first photo `IMG_0001.jpg`:
   *
   *   1. A carries a clock and no zone. The clock fills, the offset is left as
   *      this machine's guess, and the mark and the note go on. 12c's state.
   *   2. B carries both. Its clock is refused, correctly — `occurredAuthor` is
   *      no longer `nobody`.
   *   3. B's ZONE is then ACCEPTED, because the guard asks whether the clock
   *      beside it came from a photo *with this name* and both files have this
   *      name: `"IMG_0001.jpg" === "IMG_0001.jpg"`.
   *   4. Which composes A's `07:05` with B's `+12:45` and, in the same motion,
   *      clears the mark — `creditTime` derives it from "a photo dated it and
   *      NOBODY offset it", and step 3 has just made the offset a photo's.
   *
   * That is ruling T4-E's defect exactly: an instant that happened at neither
   * place, with §11.5's warning removed by the act of composing it. 12h and 12i
   * both pass against it, because their fixtures are `tokyo.jpg` and
   * `chathams.jpg` — the guard is correct for every pair of names that differ
   * and degenerates on the pair that any two cameras produce.
   *
   * THE FIX IS THE `key` ALREADY COMPUTED: widen `TimeAuthor`'s `photo` variant
   * to carry it, compare on it, and keep `name` for the notes.
   * `CoordinateAuthor` needs no change — it uses `name` for display only and
   * never compares it, which is also why nothing in section 11 moves.
   *
   * THE NOTE IS ASSERTED THROUGH `GUESS_WORDING` HERE, NOT THROUGH `alt(file)`,
   * AND THAT IS THE POINT OF THE TEST RESTATED. Both files answer to the same
   * `alt`, so 12h's fence — "the note still names the photo the clock is
   * actually from" — cannot discriminate in this render at all: the sentence
   * naming the RIGHT file and the sentence naming the WRONG one are the same
   * string. What CAN be told apart is WHICH sentence is up, because the two
   * differ in kind: the guess note says the offset is *not from* the photo, and
   * `offsetSourceNote` says it *came from* it. 12c pins that `GUESS_WORDING`
   * does not match the control's permanent hint, in the same render and before
   * any pick, so a match here is that note and nothing else.
   *
   * `pickAndSettle` IS NOT USED FOR THE SECOND PICK, and could not be: it waits
   * on `findByRole("img", { name: alt(file) })`, which throws "found multiple
   * elements" on precisely the collision this test is about. The wait is spelled
   * out instead — two rows answering to one name, four derivatives, and two
   * containers.
   *
   * WHAT WOULD BREAK IT: today's code; comparing on the name after
   * lower-casing, trimming or stripping the extension, which is the same defect
   * with more steps; keying on the pick ORDER ("no photo has been attached
   * before"), which breaks 12b, where one photo supplies both halves.
   *
   * WHAT IT MUST NOT COST: 12b and 12h. One photo carrying both tags still
   * fills both — with a `key` comparison the clock's record names the very slot
   * being offered — and two DIFFERENTLY named photos still behave as they do
   * today.
   */
  it("refuses a second photo's offset when its file name is the first photo's", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const first = jpegWithExif(COLLIDING_NAME, TIMED);
    const second = jpegWithExif(COLLIDING_NAME, TIMED_WITH_OTHER_OFFSET);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    /* THE COLLISION IS THE WHOLE TEST. Two distinct names here and this is 12h,
       which passes today — the mutation would prove nothing. (The tags differ
       and the bytes differ: both are pinned by the control above, which is what
       stops the media path collapsing these two into one photo.) */
    expect(
      second.name,
      "the two fixtures do not share a file name: this is 12h with a fresh docblock, and the guard it exercises already holds",
    ).toBe(first.name);

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(
      offsetOptions(),
      `${SECOND_OFFSET} is not one of the offsets this editor offers, so the control could not show it even if the fill this test forbids did happen`,
    ).toContain(SECOND_OFFSET);

    /* ── THE FIRST PHOTO, AND EVERY ASSERTION BELOW RESTS ON IT ─────────── */
    await pickAndSettle(first, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the first photo's date never reached the wall clock, so nothing here is about a second photo standing beside it",
      ).not.toBe("");
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(
      offsetMarkedAsGuess(),
      "the first photo dated the form beside this machine's offset and nothing marks it: 'the mark survived' below cannot be told from 'there was never a mark'",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the marked control does not carry the guess note, so 'the warning still stands' below is not about a warning",
    ).toMatch(GUESS_WORDING);
    expect(
      describedTextOf(LABEL.offset),
      "the note names no photo at all",
    ).toMatch(alt(first));

    /* ── THE SECOND PHOTO REALLY LANDED — 11c's guard, spelled out because
       `pickAndSettle` cannot see two rows with one name. ────────────────── */
    pickPhoto(second);
    await waitFor(() =>
      expect(screen.getAllByRole("img", { name: alt(second) })).toHaveLength(2),
    );
    expect(rig.processed, "the second file never reached the pipeline").toHaveLength(2);
    await waitFor(() => expect(media.puts).toHaveLength(4));
    expect(
      media.containers(),
      "the two files went to ONE content-addressed container: the media path deduplicated them, so the second `attach` never ran and every refusal below is about nothing",
    ).toHaveLength(2);

    /* ── THE REFUSALS ───────────────────────────────────────────────────── */
    expect(
      wallClockShapes(PHOTO_WALL),
      `the wall clock shows ${JSON.stringify(shownValue(LABEL.occurredAt))}: the second photo replaced the first photo's clock`,
    ).toContain(shownValue(LABEL.occurredAt));
    expect(
      shownValue(LABEL.offset),
      "the second photo's zone was accepted beside the FIRST photo's clock, because the guard compares FILE NAMES and both files are called IMG_0001.jpg: the two halves now describe an instant that happened at neither place",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "accepting the second photo's zone cleared the mark on the first photo's clock: §11.5's composition, with the warning removed by the act of composing it",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the guess note is gone: the offset is credited to a photo instead of being warned about, and the two sentences differ in KIND, which is the one thing that can be told apart when both files answer to one name",
    ).toMatch(GUESS_WORDING);

    /* ── AND WHAT A STRANGER CAN FETCH IS ONE PLACE'S TIME, NOT TWO ─────── */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-two-cameras");
    setText(LABEL.headline, "Two cameras, one file name");
    setText(LABEL.articleBody, "Both of them called it IMG_0001.jpg.");
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
      occurred!.value,
      "the published timestamp is the first photo's wall clock on the second photo's offset: an instant that happened at neither place, and §11.5's failure exactly",
    ).not.toBe(`${PHOTO_WALL.slice(0, 16)}:00${SECOND_OFFSET}`);
    expect(
      occurred!.value.slice(-6),
      "the published offset is not the one the control holds",
    ).toBe(MACHINE_OFFSET);
    expect(
      occurred!.value.slice(0, 16),
      "the published wall clock is not the first photo's",
    ).toBe(PHOTO_WALL.slice(0, 16));
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
    expect(
      pod.wire(),
      "the second photo's zone is on the wire for an entry it did not date",
    ).not.toContain(SECOND_OFFSET);
    expect(
      pod.wire(),
      "the second photo's wall clock is on the wire",
    ).not.toContain(SECOND_WALL.slice(0, 16));
  });
});

/* ── 12j-bis. the same two cameras, picked the other way round ──────────── */

describe("entry editor — two photos whose file names collide, in the other order", () => {
  /**
   * 12j's MIRROR, AND THE ONLY THING STANDING IN FRONT OF THE WALL BRANCH'S
   * IDENTITY CHECK.
   *
   * Ruling T4-E closed its defect with a comparison on the SLOT KEY in both
   * branches of `offerTimestamp` — `offsetTo.key === key` on the wall clock and
   * `occurredTo.key === key` on the zone — after the first spelling used
   * `file.name`, which `PhotoSlot`'s own docblock says is not an identity:
   * *"two files picked from two directories can share one."* Only ONE of the
   * two comparisons was pinned. 12j drives a clock-only photo and then a
   * both-tags photo, so the branch that has to refuse there is the ZONE one;
   * revert the WALL branch to `.name === name` and the whole suite stays green.
   *
   * BECAUSE THE WALL BRANCH ONLY BITES IN THE MIRROR ORDER, AND 12i IS THAT
   * ORDER WITH TWO NAMES THAT DIFFER. `chathams.jpg` then `tokyo.jpg`: a name
   * comparison is already correct there, since the names are not equal and the
   * refusal happens either way. Nothing in this file paired the mirror order
   * with a name collision, so the wall branch's `key` was load-bearing and
   * unmeasured. This is that pair — `OFFSET_ONLY` then `TIMED`, both called
   * `IMG_0001.jpg`.
   *
   * WHAT THE NAME COMPARISON PRODUCES, AND WHY NOTHING WOULD WARN THE OWNER:
   *
   *   1. A carries a zone and no clock. The offset fills — that is the
   *      allow-case, asserted in this same render — and nothing is marked,
   *      because the offset is a photo's rather than this machine's.
   *   2. B carries a clock and no zone. Its clock is offered, `offsetTo` is a
   *      `photo`, and the guard asks whether that photo has THIS name: both
   *      files are `IMG_0001.jpg`, so `"IMG_0001.jpg" === "IMG_0001.jpg"` and
   *      the clock is accepted.
   *   3. Which composes B's `07:05` with A's `+12:45`, an instant that happened
   *      at neither place — and UNMARKED. `creditTime` derives the mark from
   *      "nobody offset it and a photo dated it", and step 1 already made the
   *      offset a photo's, so ruling T4-A's condition can never hold in this
   *      render. There is no surface on the form that warns about it, which is
   *      12i's argument for refusing rather than admitting and explaining.
   *
   * SO THE HARM IS ON THE WIRE, AND THAT IS WHERE IT IS ASSERTED. With the
   * clock refused there is no `dy:occurredAt` at all, and the entry is
   * published without one — `occurredAt` is optional in the schema and the
   * serialiser omits the triple. Under the name comparison the PUT carries
   * `2026-04-11T07:05:00+12:45`, which is the whole of §11.5's failure with the
   * warning removed by the act of composing it. The slug is read back off the
   * same body first: "no `dy:occurredAt`" is satisfied by an empty or
   * unparseable document, and asserting a status without its payload is how
   * this project shipped a zero-byte 404.
   *
   * THE NOTE CAN STILL DISCRIMINATE, THOUGH NOT ABOUT WHICH PHOTO. Both files
   * answer to the same `alt`, so 12j's paragraph applies: the sentence naming
   * the right file and the sentence naming the wrong one are the same string.
   * What can be told apart here is whether a "the time came from …" sentence
   * EXISTS — `creditTime` sets `occurredSource` from the clock's record, so
   * under the name comparison the wall clock announces a photo as its author
   * and under a `key` comparison it names nobody, because nobody filled it. The
   * hint is asserted not to name the file first, in the same render and before
   * any pick, so a match is that note and nothing else.
   *
   * `pickAndSettle` IS NOT USED FOR THE SECOND PICK, and could not be: it waits
   * on `findByRole("img", { name: alt(file) })`, which throws "found multiple
   * elements" on precisely the collision this test is about. 12j's spelled-out
   * wait is used instead — two rows answering to one name, four derivatives,
   * two containers.
   *
   * WHAT WOULD BREAK IT: reverting the wall branch to `offsetTo.name === name`;
   * comparing the name lower-cased, trimmed or without its extension, which is
   * the same defect with more steps; refusing the FIRST photo's zone as well,
   * which the allow-case catches, because "the clock stayed empty" must be a
   * refusal and not an absence.
   *
   * WHAT IT MUST NOT COST: 12b, where one photo carries both tags — the wall
   * branch runs first, so `offsetTo` is untouched by that photo at that line
   * and the comparison is not reached at all — and 12i, where the same two
   * halves arrive on two DIFFERENTLY named files and must behave exactly as
   * they do today.
   */
  it("refuses a second photo's clock when its file name is the first photo's", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const first = jpegWithExif(COLLIDING_NAME, OFFSET_ONLY);
    const second = jpegWithExif(COLLIDING_NAME, TIMED);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    /* THE COLLISION IS THE WHOLE TEST. Two distinct names here and this is 12i,
       which passes today — the mutation would prove nothing. (The tags differ
       and the SOURCE bytes differ: `fakePipeline` returns fixed derivative
       bytes for every file, so the content-addressed container can only come
       from the source, and the control above is what pins that.) */
    expect(
      second.name,
      "the two fixtures do not share a file name: this is 12i with a fresh docblock, and the guard it exercises already holds",
    ).toBe(first.name);

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(
      offsetOptions(),
      `${SECOND_OFFSET} is not one of the offsets this editor offers, so a controlled <select> could not show it even if the first pick's fill were correct`,
    ).toContain(SECOND_OFFSET);
    expect(
      describedTextOf(LABEL.occurredAt),
      "the wall clock's permanent hint already names the file, so 'no photo is credited with the clock' below would hold in every state",
    ).not.toMatch(alt(second));

    /* ── THE ALLOW-CASE: a photo that carries only a zone supplies it ───── */
    await pickAndSettle(first, media);
    await waitFor(() => {
      expect(
        shownValue(LABEL.offset),
        "the zone-only photo's OffsetTimeOriginal never reached the control, so this render holds no photo's offset and every refusal below is about nothing",
      ).toBe(SECOND_OFFSET);
    });
    expect(
      shownValue(LABEL.occurredAt),
      "a photo that carries no DateTimeOriginal filled the wall clock",
    ).toBe("");
    expect(
      offsetMarkedAsGuess(),
      "the offset came from the photo and is marked as this machine's guess anyway",
    ).toBe(false);

    /* ── THE SECOND PHOTO REALLY LANDED — 11c's guard, spelled out because
       `pickAndSettle` cannot see two rows with one name. ────────────────── */
    pickPhoto(second);
    await waitFor(() =>
      expect(screen.getAllByRole("img", { name: alt(second) })).toHaveLength(2),
    );
    expect(rig.processed, "the second file never reached the pipeline").toHaveLength(2);
    await waitFor(() => expect(media.puts).toHaveLength(4));
    expect(
      media.containers(),
      "the two files went to ONE content-addressed container: the media path deduplicated them, so the second `attach` never ran and every refusal below is about nothing",
    ).toHaveLength(2);

    /* ── THE REFUSALS ───────────────────────────────────────────────────── */
    expect(
      shownValue(LABEL.occurredAt),
      "the second photo's clock was accepted beside the FIRST photo's zone, because the wall branch compares FILE NAMES and both files are called IMG_0001.jpg: the two halves now describe an instant that happened at neither place",
    ).toBe("");
    expect(
      shownValue(LABEL.offset),
      "the second photo moved the offset the first one supplied",
    ).toBe(SECOND_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "the offset is a photo's, not this machine's, and the form says it is a guess",
    ).toBe(false);
    expect(
      describedTextOf(LABEL.occurredAt),
      "the wall clock credits a photo as the author of the time it is holding: nothing may fill it in this render, and under a name comparison this sentence is how the composed clock announces itself",
    ).not.toMatch(alt(second));
    expect(
      describedTextOf(LABEL.offset),
      "the guess note is up for an offset a photo supplied — and its absence is the point: T4-A's condition cannot hold here, so nothing on this form would warn about the composition a name comparison admits",
    ).not.toMatch(GUESS_WORDING);

    /* ── AND WHAT A STRANGER CAN FETCH IS NO TIME AT ALL, NOT A WRONG ONE ─ */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-two-cameras-reversed");
    setText(LABEL.headline, "Two cameras, the other way round");
    /* THE PROSE MAY NOT QUOTE EITHER HALF — 12k's measurement: `pod.wire()` is
       every byte that left the browser, so a fixture that plants the needle in
       the haystack is a test that can never pass. */
    setText(LABEL.articleBody, "The one that knew where it was came out of the bag first.");
    setText(LABEL.tags, "walking, morning");
    setChoice(LABEL.travelModeFrom, /train/i);
    setChoice(LABEL.status, /publish/i);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "nothing reached the Pod at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);
    expect(
      oneObject(quads, `${put!.url}#it`, DY.slug)?.value,
      "the PUT body is not the entry this test filled in, so 'no dy:occurredAt' below is satisfied by an empty or unparseable document",
    ).toBe("2026-04-11-two-cameras-reversed");
    expect(
      oneObject(quads, `${put!.url}#it`, DY.occurredAt),
      "a dy:occurredAt reached the Pod: the SECOND photo's wall clock on the FIRST photo's offset, an instant that happened at neither place — and unmarked, because the offset was already a photo's and T4-A cannot fire",
    ).toBeUndefined();
    expect(
      pod.wire(),
      "the second photo's wall clock is on the wire for an entry no photo dated",
    ).not.toContain(PHOTO_WALL.slice(0, 16));
    expect(
      pod.wire(),
      "the first photo's zone is on the wire: nothing in this model publishes an offset on its own, so it can only have arrived concatenated onto a wall clock — and the only wall clock in this render is the other photo's",
    ).not.toContain(SECOND_OFFSET);
    expect(outcomeText(), "the save announced nothing at all").toMatch(/saved/i);
  });
});

/* ──── 12k. an OffsetTimeOriginal that is not an offset at all (F4) ─────── */

describe("entry editor — a photo whose OffsetTimeOriginal is out of range", () => {
  /**
   * THE DEFECT IS THE ADVICE THE OWNER IS GIVEN, AND IT IS FALSE ON EVERY
   * RETRY.
   *
   * `lib/media/exif.ts` validates tag 0x9011 by SHAPE ALONE (`:38`, `:105`) and
   * the editor's `OFFSET_SHAPE` is the same regex, so `+99:99` — a value no
   * zone has and no camera should write, and one this project's own fixture
   * builder will happily put in a file — passes the whole chain:
   * `offerTimestamp` accepts it, `offsetOptions` unions it into the select, and
   * `toOffsetDateTime` concatenates it onto the wall clock the same photo
   * supplied.
   *
   * IT THEN FAILS CLOSED, WHICH IS THE GOOD HALF. Measured against this repo's
   * zod 4.5.4: `+99:99` FAIL, `+30:00` FAIL, `+23:59` PASS, `+05:15` PASS. So
   * `serialiseEntry`'s `Entry.safeParse` refuses the entry, `saveEntry` reports
   * `step: "entry"` with `recovery: "retry"`, and NOTHING reaches the Pod —
   * no half-written resource, no wrong instant published.
   *
   * WHAT THE OWNER GETS IS `announce`'s retry sentence: *"The entry did not
   * reach your Pod, and nothing there changed. Everything you typed is still on
   * this screen — try again."* Every word of that is true except the advice.
   * The identical request fails identically, for ever, and nothing on the form
   * points at the offset select quietly showing `+99:99` — which the union put
   * there, in a list of thirty-odd real zones, for a value that cannot be
   * saved. The owner's work is intact and unsaveable, and the screen is telling
   * them to press the button again.
   *
   * THE FIX IS A RANGE CHECK IN THE ZONE BRANCH — accept `zone` only when
   * `Math.abs(offsetMinutes(zone)) <= 840`, with `offsetMinutes` already
   * beside `OFFSET_SHAPE`. Deliberately not a tighter `OFFSET_SHAPE`: an entry
   * some other tool wrote can carry `+05:15`, and §1c's "renders a stored
   * offset the list does not contain" says the editor's job is to show such a
   * value and put it back unchanged. What may not happen is ACCEPTING one from
   * a photo.
   *
   * THE ALLOW-CASE IS IN THE SAME RENDER, AND THERE ARE TWO OF THEM. The
   * photo's DATE still fills the clock — a fix that refused the whole file
   * would be a different defect wearing this test's green — and the SAVE still
   * lands, which is the outcome the owner was owed.
   *
   * "STATUS WITHOUT BODY" IS WHY THE WIRE ASSERTION IS NOT ALONE. Today nothing
   * is PUT at all, so "`+99:99` is on no request" is satisfied vacuously by the
   * broken build; it means something only after `pod.entryPut()` is asserted to
   * exist. Both are here, in that order.
   *
   * WHAT WOULD BREAK IT: today's code; range-checking at SAVE time and
   * publishing some other offset, which the `slice(-6)` assertion catches
   * because it demands the one the control is holding; dropping the photo's
   * DATE along with its zone, which the wall-clock assertions catch; leaving
   * the mark off, which would be a clock a photo supplied beside this machine's
   * unmarked guess — §11.5's state with no warning.
   */
  it("refuses an impossible zone, keeps the photo's clock, and the save reaches the Pod", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const file = jpegWithExif("dashcam.jpg", OFFSET_OUT_OF_RANGE);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(
      offsetOptions(),
      `${OUT_OF_RANGE_OFFSET} is already one of the offsets this editor offers, so "it was not unioned into the list" cannot fail`,
    ).not.toContain(OUT_OF_RANGE_OFFSET);

    await pickAndSettle(file, media);

    /* ── THE ALLOW-CASE: the DATE half is honoured ──────────────────────── */
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo's date never reached the wall clock, so the refusal below cannot be told from an editor that dropped the whole file",
      ).not.toBe("");
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));

    /* ── THE REFUSAL ────────────────────────────────────────────────────── */
    expect(
      shownValue(LABEL.offset),
      "an OffsetTimeOriginal of +99:99 was accepted into the control: it is shape-valid and 6 039 minutes east of Greenwich, and it is what the timestamp will be built from",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetOptions(),
      "the impossible offset was unioned into the select, which now offers it beside the real zones as though it were one",
    ).not.toContain(OUT_OF_RANGE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "the photo dated the form and supplied no zone this editor can use, and the offset beside the clock is this machine's — unmarked",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the marked control does not carry the guess note",
    ).toMatch(GUESS_WORDING);

    /* ── AND THE SAVE LANDS, which is what the owner was told it would not ─ */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-dashcam");
    setText(LABEL.headline, "The clock was right, the zone was not");
    /* THE PROSE MAY NOT QUOTE THE OFFSET, and this is not fussiness: the first
       draft of this test wrote "Something in the camera wrote +99:99." and the
       wire assertion below went red on the entry's own `schema:articleBody`.
       `pod.wire()` is every byte that left the browser, which is what makes it
       worth asserting on — and what makes a fixture that plants the needle in
       the haystack a test that can never pass. */
    setText(LABEL.articleBody, "The camera wrote a zone that is not a zone.");
    setText(LABEL.tags, "walking, morning");
    setChoice(LABEL.travelModeFrom, /train/i);
    setChoice(LABEL.status, /publish/i);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(
      put,
      "nothing reached the Pod: the entry was refused by its own schema for an offset a photo put in the control, and the owner is told to try again — advice that stays false on every retry",
    ).toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(occurred, "no dy:occurredAt reached the Pod").toBeDefined();
    expect(
      occurred!.value.slice(-6),
      "the published offset is not the one the control holds",
    ).toBe(MACHINE_OFFSET);
    expect(
      occurred!.value.slice(0, 16),
      "the published wall clock is not the photo's",
    ).toBe(PHOTO_WALL.slice(0, 16));
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
    expect(
      pod.wire(),
      "the impossible offset is on the wire",
    ).not.toContain(OUT_OF_RANGE_OFFSET);

    /* AND WHAT THE OWNER IS TOLD IS TRUE — the payload beside the status, for
       the reason this project keeps re-learning. */
    expect(
      outcomeText(),
      "the owner is told the entry did not reach their Pod and to try again, which is false advice that stays false on every retry",
    ).not.toMatch(/did not reach|try again/i);
    expect(outcomeText(), "the save announced nothing at all").toMatch(/saved/i);
  });
});

/* ── 12l. an OffsetTimeOriginal whose MINUTES are out of range (F4, still
   reachable — closing item 4) ────────────────────────────────────────── */

describe("entry editor — a photo whose OffsetTimeOriginal has out-of-range minutes", () => {
  /**
   * F4 FENCED TOTAL MINUTES, NOT THE TWO DIGIT PAIRS SEPARATELY.
   *
   * `entry-editor.tsx`'s guard is `Math.abs(offsetMinutes(zone)) <= 840`.
   * `"+05:61"` composes to 361 — inside that fence — while `lib/media/exif.ts`
   * validates the tag by SHAPE ALONE, and two digits of `61` is shape-valid.
   * So this value clears every check the chain has before the Pod, exactly as
   * `+99:99` did before F4, and only `Entry.safeParse` refuses the timestamp
   * it is concatenated onto, at the very end of the chain, after Save.
   *
   * MODELLED ON 12k, ONE SUBSTITUTION ONLY: the fixture, the allow-case (the
   * photo's date still fills the clock) and the refusal shape (the control
   * does not hold the bad value, the save reaches the Pod with this machine's
   * offset, the owner is not told to retry) are all the same test 12k already
   * makes. What 12k cannot do is exercise this branch: `+99:99` is 6 039
   * minutes and is refused by the ±840 fence itself, so a fix that checked
   * only total minutes already makes 12k green. `+05:61` is the value the
   * guard's own docblock (entry-editor.tsx:~2035) names as the one to fear,
   * and this is that value.
   *
   * WHAT WOULD BREAK IT: today's code, which lacks a minutes-in-range check
   * on the zone conjunct; a fix that tightens `OFFSET_SHAPE` instead, which
   * 12k's docblock rules out because a stored `+05:15` must still render.
   */
  it("refuses an offset whose minutes are out of range, keeps the photo's clock, and the save reaches the Pod", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const file = jpegWithExif("dashcam.jpg", OFFSET_MINUTES_OUT_OF_RANGE);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    requireOffsetControl();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(
      offsetOptions(),
      `${MINUTES_OUT_OF_RANGE_OFFSET} is already one of the offsets this editor offers, so "it was not unioned into the list" cannot fail`,
    ).not.toContain(MINUTES_OUT_OF_RANGE_OFFSET);

    await pickAndSettle(file, media);

    /* ── THE ALLOW-CASE: the DATE half is honoured ──────────────────────── */
    await waitFor(() => {
      expect(
        shownValue(LABEL.occurredAt),
        "the photo's date never reached the wall clock, so the refusal below cannot be told from an editor that dropped the whole file",
      ).not.toBe("");
    });
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));

    /* ── THE REFUSAL ────────────────────────────────────────────────────── */
    expect(
      shownValue(LABEL.offset),
      "an OffsetTimeOriginal of +05:61 was accepted into the control: it is 361 minutes east of Greenwich, inside the ±840 fence that stopped +99:99, and it is what the timestamp will be built from",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetOptions(),
      "the out-of-range offset was unioned into the select, which now offers it beside the real zones as though it were one",
    ).not.toContain(MINUTES_OUT_OF_RANGE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "the photo dated the form and supplied no usable zone, and the offset beside the clock is this machine's — unmarked",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the marked control does not carry the guess note",
    ).toMatch(GUESS_WORDING);

    /* ── AND THE SAVE LANDS, which is what the owner was told it would not ─ */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-dashcam-minutes");
    setText(LABEL.headline, "The clock was right, the zone was not");
    /* THE PROSE MAY NOT QUOTE THE OFFSET — 12k's measurement applies here too:
       `pod.wire()` is every byte that left the browser. */
    setText(LABEL.articleBody, "The camera wrote a zone with minutes that do not exist.");
    setText(LABEL.tags, "walking, morning");
    setChoice(LABEL.travelModeFrom, /train/i);
    setChoice(LABEL.status, /publish/i);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(
      put,
      "nothing reached the Pod: the entry was refused by its own schema for an offset a photo put in the control, and the owner is told to try again — advice that stays false on every retry",
    ).toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(occurred, "no dy:occurredAt reached the Pod").toBeDefined();
    expect(
      occurred!.value.slice(-6),
      "the published offset is not the one the control holds",
    ).toBe(MACHINE_OFFSET);
    expect(
      occurred!.value.slice(0, 16),
      "the published wall clock is not the photo's",
    ).toBe(PHOTO_WALL.slice(0, 16));
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
    expect(
      pod.wire(),
      "the out-of-range offset is on the wire",
    ).not.toContain(MINUTES_OUT_OF_RANGE_OFFSET);

    /* AND WHAT THE OWNER IS TOLD IS TRUE — the payload beside the status. */
    expect(
      outcomeText(),
      "the owner is told the entry did not reach their Pod and to try again, which is false advice that stays false on every retry",
    ).not.toMatch(/did not reach|try again/i);
    expect(outcomeText(), "the save announced nothing at all").toMatch(/saved/i);
  });
});

/* ─── 12m. two photos in ONE pick, and the ref read across the await ─────── */

/**
 * BOTH FILES IN ONE `change` EVENT — what `multiple` delivers, and what
 * nothing else in this file does: `pickPhoto` sends a one-element list and
 * `pickAndSettle` awaits an `<img>` before the next pick. That await is a
 * render boundary, and it is exactly what the three cases below must not have.
 */
function pickBoth(files: readonly File[]) {
  const input = screen.getByLabelText(PHOTOS_LABEL);
  fireEvent.change(input, { target: { files } });
}

/**
 * `fakePipeline` WITH lib/media/pipeline.ts's QUEUE — `queue = result.catch(…)`
 * at pipeline.ts:87-88. The fake on its own lets two decodes overlap, an
 * interleaving production does not have, so a pass against it would be about
 * a schedule this app never runs. `order` makes the premise assertable.
 */
function serialisingPipeline() {
  const rig = fakePipeline();
  const order: string[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  const pipeline: Pipeline = {
    process(file: Blob): Promise<PipelineResult> {
      const result = queue.then(() => {
        order.push(file instanceof File ? file.name : "(not a File)");
        return rig.pipeline.process(file);
      });
      queue = result.catch(() => undefined);
      return result;
    },
    dispose: () => rig.pipeline.dispose(),
  };
  return { pipeline, order, processed: rig.processed };
}

/** Both uploads finished: two PUTs per photo, so four — and never a
 *  per-photo await, which is the whole point. */
async function settleBoth(media: ReturnType<typeof mediaFake>) {
  await waitFor(() => expect(media.puts).toHaveLength(4), { timeout: 5000 });
}

describe("entry editor — two photos picked at once", () => {
  /**
   * `offerTimestamp` seeds both halves from the REFS at entry-editor.tsx:1992
   * -1993, inside `attach`'s continuation — after a decode and two PUTs. The
   * picker starts every file at once (`for (const file of picked) void
   * attach(file)`, :3726), so both resume as microtasks with no render between.
   */

  /**
   * A reducer reading its own state from a hook's return value would see
   * `nobody` twice. MEASURED, by moving those two reads before the `await`:
   * this case went red with the box holding the SECOND photo's clock — last
   * writer wins, not first — and the case after it composed §11.5's instant.
   */

  /**
   * ALL THREE CASES ARE EXPECTED TO PASS TODAY, and this is the one place in
   * this repository where that is right: they exist to fail against a future
   * wrong implementation, and the run above is the proof that they can.
   */
  it("credits the clock to the first photo only, with no render between them", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = serialisingPipeline();
    const fake = fakeStudioSession();
    /* Two phones, two wall clocks, and neither of the second's tags is the
       first's — `TIMED_WITH_OTHER_OFFSET`'s own reason for existing. */
    const first = jpegWithExif("first.jpg", TIMED);
    const second = jpegWithExif("second.jpg", TIMED_WITH_OTHER_OFFSET);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    /* THE SETTINGS LAND BEFORE THE PICK, not during it. §7.6 arrives over MSW
       and its re-render would fall between the two continuations — which is
       the flush this case exists to deny, and would mask the defect. */
    requireOffsetControl();
    await awaitLiveCoordinateControls();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(shownValue(LABEL.offset), "the create's offset is not this machine's").toBe(
      MACHINE_OFFSET,
    );
    expect(
      offsetOptions(),
      `${SECOND_OFFSET} is not one of the offsets this editor offers, so the control could not show it even if the fill this test forbids did happen`,
    ).toContain(SECOND_OFFSET);

    pickBoth([first, second]);
    await settleBoth(media);
    await screen.findByRole("img", { name: alt(first) });
    await screen.findByRole("img", { name: alt(second) });

    /* ── THE PREMISE: BOTH LANDED, AND IN THE ORDER PRODUCTION GIVES ────── */
    expect(rig.processed, "one of the two files never reached the pipeline").toHaveLength(2);
    expect(media.containers(), "both photos went to one container").toHaveLength(2);
    expect(
      rig.order,
      "the decodes did not run first-then-second, so 'the first photo won' below would be a claim about a different schedule than the one lib/media/pipeline.ts produces",
    ).toEqual(["first.jpg", "second.jpg"]);

    /* ── THE FIRST WRITER WON, PER HALF ─────────────────────────────────── */
    expect(
      wallClockShapes(PHOTO_WALL),
      `the wall clock shows ${JSON.stringify(shownValue(LABEL.occurredAt))}: the second photo's continuation read a stale author and overwrote the first photo's clock, which only a ref read after photo 1 had written it can prevent`,
    ).toContain(shownValue(LABEL.occurredAt));
    expect(
      shownValue(LABEL.occurredAt),
      "the box holds the second photo's wall clock",
    ).not.toContain(SECOND_WALL.slice(11, 16));
    expect(
      shownValue(LABEL.offset),
      "the second photo's zone was accepted beside the FIRST photo's clock: two photos' halves composed into an instant that happened at neither place (§11.5), which is what the cross-half guard on `key` refuses",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "accepting a zone cleared the mark on the first photo's clock: the composition §11.5 warns about, with the warning removed by the act of composing it",
    ).toBe(true);

    /* ── AND THE CREDIT NAMES ONE PHOTO, which is the note the owner reads ─ */
    expect(
      describedTextOf(LABEL.offset),
      "the note stopped naming the photo whose clock is in the box",
    ).toMatch(alt(first));
    expect(
      describedTextOf(LABEL.offset),
      "the note credits the second photo, which supplied neither the clock in the box nor the offset beside it",
    ).not.toMatch(alt(second));

    /* ── AND WHAT A STRANGER CAN FETCH IS ONE PLACE'S TIME ──────────────── */
    setChoice(LABEL.trip, /Japan/i);
    setText(LABEL.slug, "2026-04-11-one-pick");
    setText(LABEL.headline, "Two cameras, one pick");
    setText(LABEL.articleBody, "Both files went in on the same click.");
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
      occurred!.value,
      "the published timestamp is the first photo's wall clock on the second photo's offset: the instant that happened at neither place, on the wire",
    ).not.toBe(`${PHOTO_WALL.slice(0, 16)}:00${SECOND_OFFSET}`);
    expect(
      occurred!.value.slice(0, 16),
      "the published wall clock is not the first photo's",
    ).toBe(PHOTO_WALL.slice(0, 16));
    expect(
      occurred!.value.slice(-6),
      "the published offset is not the one the control holds",
    ).toBe(MACHINE_OFFSET);
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
    expect(outcomeText(), "the save announced nothing at all").toMatch(/saved/i);
  });

  /**
   * THE COMPOSITE ITSELF, in the interleaving case 1 cannot reach. Case 1's
   * second photo carries BOTH tags, so a stale read makes it win both halves —
   * wrong, but coherent. A clock-only photo beside an offset-only one is the
   * shape §11.5 actually names, and only this pairing produces it.
   */

  /**
   * UNDER A STALE READ: photo 1's clock stands, photo 2's zone is accepted
   * because the snapshot still says `nobody` dated it, and `creditTime(nobody,
   * photo)` then clears the mark — the instant that happened at neither place,
   * with the warning removed by the act of composing it.
   */
  it("refuses an offset-only second photo beside the first photo's clock", async () => {
    const media = mediaFake();
    const rig = serialisingPipeline();
    const fake = fakeStudioSession();
    const timed = jpegWithExif("timed.jpg", TIMED);
    const zoned = jpegWithExif("zoned.jpg", OFFSET_ONLY);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    requireOffsetControl();
    await awaitLiveCoordinateControls();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(
      metadataOf(OFFSET_ONLY).dateTimeOriginal,
      "the offset-only fixture carries a date after all, so this is case 1 again rather than the composite",
    ).toBeUndefined();

    pickBoth([timed, zoned]);
    await settleBoth(media);
    await screen.findByRole("img", { name: alt(timed) });
    await screen.findByRole("img", { name: alt(zoned) });

    expect(rig.processed, "one of the two files never reached the pipeline").toHaveLength(2);
    expect(
      rig.order,
      "the clock-bearing photo did not decode first, so it was never the earlier offer this case needs it to be",
    ).toEqual(["timed.jpg", "zoned.jpg"]);

    /* THE ALLOW-CASE IS IN THE SAME RENDER: without it every refusal below
       also holds for an editor in which nothing filled at all. */
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));

    expect(
      shownValue(LABEL.offset),
      "the second photo's zone was accepted beside the first photo's clock: §11.5's instant that happened at neither place, composed inside one pick where no render separates the two offers",
    ).toBe(MACHINE_OFFSET);
    expect(
      offsetMarkedAsGuess(),
      "the composition cleared the mark on the first photo's clock: `creditTime(nobody, photo)` recomputes 'a photo dated it and nobody offset it' as false, so the warning is removed by the act of composing the thing it warns about",
    ).toBe(true);
    expect(
      describedTextOf(LABEL.offset),
      "the note stopped naming the photo whose clock is in the box",
    ).toMatch(alt(timed));
    expect(
      describedTextOf(LABEL.offset),
      "the note credits the offset-only photo, whose zone the form does not hold",
    ).not.toMatch(alt(zoned));
  });

  /**
   * THE CONTROL, AND IT IS NOT DECORATION. If the guard is "a photo has been
   * offered, so refuse" rather than "this half is answered, so refuse", this
   * case fails while the one above still passes — and without it `return state`,
   * refusing every offer, is a valid implementation of first-writer-wins.
   */

  /**
   * `PINNED_ONLY` AND NOT `jpegWithGps`: `EXIF_BASE` carries a
   * `dateTimeOriginal`, so a `jpegWithGps` first photo would own the clock and
   * this case would be measuring the refusal above a second time.
   */
  it("still fills from the second photo when the first carried no clock at all", async () => {
    const media = mediaFake();
    const rig = serialisingPipeline();
    const fake = fakeStudioSession();
    const clockless = jpegWithExif("clockless.jpg", PINNED_ONLY);
    const timed = jpegWithExif("timed.jpg", TIMED);
    await renderEditor(fake.session, { pipeline: rig.pipeline, storage: fakeStorage().storage });

    requireOffsetControl();
    await awaitLiveCoordinateControls();
    expect(shownValue(LABEL.occurredAt), "the wall clock was not empty to begin with").toBe("");
    expect(
      metadataOf(PINNED_ONLY).dateTimeOriginal,
      "the clockless fixture carries a date after all, so 'the first photo said nothing about time' is not what this case sets up",
    ).toBeUndefined();

    pickBoth([clockless, timed]);
    await settleBoth(media);
    await screen.findByRole("img", { name: alt(clockless) });
    await screen.findByRole("img", { name: alt(timed) });

    expect(rig.processed, "one of the two files never reached the pipeline").toHaveLength(2);
    expect(
      rig.order,
      "the clockless photo did not decode first, so it was never the earlier offer this case needs it to be",
    ).toEqual(["clockless.jpg", "timed.jpg"]);

    expect(
      shownValue(LABEL.occurredAt),
      "the clockless first photo blocked the second photo's clock: the guard asks whether a photo has been offered rather than whether this half is answered, and the owner is left typing a date two photos carried",
    ).not.toBe("");
    expect(wallClockShapes(PHOTO_WALL)).toContain(shownValue(LABEL.occurredAt));
    expect(
      describedTextOf(LABEL.offset),
      "the filled clock credits no photo, or credits the wrong one",
    ).toMatch(alt(timed));
  });
});

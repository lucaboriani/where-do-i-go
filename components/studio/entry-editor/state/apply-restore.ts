/**
 * The owner accepting a stored draft, as ONE transition rather than thirteen
 * setters and a credit call. That ordering hazard is the reducer's first
 * justification (spec §5); `restore()`'s docblocks in `../entry-editor.tsx`
 * argue every line below and are the normative reading of them.
 */

import { gridOf } from "@/lib/studio/place/place";
import { OFFSET_SHAPE } from "@/lib/studio/time/offsets";
import { withTimeCredit } from "./actions";
import type { EntryFormAction, EntryFormState, PhotoSlot } from "./actions";
import type { Photo } from "@/lib/pod/schema";

/** What a restored draft can still say about a photo whose file name is long
 *  gone: the caption if it has one, and its position otherwise. `Photo` has no
 *  file-name field on purpose — §7.3 describes the resource, not the pick. */
const restoredName = (photo: Photo, index: number) => photo.caption?.value ?? `Photo ${index + 1}`;

/**
 * THE PHOTOS COME BACK ALREADY UPLOADED, which is the whole reason the pick
 * is the upload: these are URLs on the Pod, so a draft restored in a new tab
 * a day later still has its pictures. `readDraft` has already put every one
 * of them through `Photo`, so a devtools-mangled photo was refused with the
 * rest of the payload rather than restored into a form that would save it.
 *
 * A DRAFT WRITTEN BEFORE THIS CONTROL EXISTED RESTORES AN EMPTY LIST, and
 * that is exactly right rather than a half-restore: no payload under the
 * current key can carry photos, because there was no way to attach one. It
 * is why the key stayed at `v2` — see lib/studio/drafts.ts.
 */
const restoredSlots = (photos: readonly Photo[]): PhotoSlot[] =>
  photos.map((photo, at) => ({
    key: `restored-${at}`,
    name: restoredName(photo, at),
    state: "ready",
    photo,
  }));

export function applyRestore(
  state: EntryFormState,
  action: Extract<EntryFormAction, { kind: "restore" }>,
): EntryFormState {
  const { draft, context } = action;
  /**
   * THE OFFSET GOES BACK ONLY IF THE DRAFT HAS ONE TO GIVE, and `""` is not
   * one. This is the load-bearing half of `Draft.offset` being
   * `.default("")` — see its docblock in lib/studio/drafts.ts.
   *
   * `""` ARRIVES FROM TWO PLACES AND MEANS THE SAME THING IN BOTH: a payload
   * written before this control existed (the schema's default fills the
   * absent key), and one somebody emptied by hand. Neither is an instruction,
   * because there is no "remove the offset" — §3 and §6 require
   * `dy:occurredAt` to carry one — so both mean "this draft has nothing to
   * say about the offset".
   *
   * WRITING `""` THROUGH IS THE FAILURE, and it is a blank control under a
   * banner that has just said the draft came back — measured, by making this
   * line unconditional and running section 8j: `shownValue` read `""`. The
   * save after it composes a timestamp out of a wall clock and nothing, which
   * §3 and §6 refuse on the next read.
   *
   * THE FALL-THROUGH IS THE CONTROL'S CURRENT VALUE, which is `?? placeName`'s
   * reasoning rather than `presetPrecision`'s, and the choice matters:
   *
   *   - "leave the control showing what it is showing" is the honest reading
   *     of a draft with no opinion, and on an untouched form that value IS
   *     `offsetOf(existing?.occurredAt) ?? offsetHere(…)` — the entry's own
   *     offset on an edit, this machine's on a create — because that is what
   *     the state was initialised with;
   *   - re-deriving the chain here would be a SECOND copy of it, two things
   *     that have to agree and say nothing when they stop, and it would
   *     discard an offset the owner had corrected before clicking Restore.
   *     Overwriting an explicit choice with a re-derived guess is the exact
   *     class of bug this control was added to remove.
   *
   * `presetPrecision` is not the model here because the precision case is
   * about a value that is UNUSABLE — what the control shows has to be what
   * `fuzzForPublication` is given (§9 step 3) — whereas this is a value that
   * is ABSENT, which is the place fields' case.
   *
   * THE SHAPE, NOT THE LIST, IS THE TEST. `+05:15` is not one of the offsets
   * `OFFSETS` offers and must still be restored; `banana` from a hand-edited
   * payload must not — not because it would reach `dy:occurredAt` (it would
   * reach the composer and fail the save: `serialiseEntry` re-validates with
   * `Entry.safeParse`, lib/pod/entry-model.ts, so a shape-invalid offset is
   * refused there, not written to the Pod), but because showing it in the
   * control would be indistinguishable from an offset this editor actually
   * offers. One expression covers `""` and that, which is what collapsing
   * absent into `""` bought.
   */
  const offsetGiven = OFFSET_SHAPE.test(draft.offset);
  /**
   * AND A RESTORED COORDINATE IS NOT A COORDINATE A PHOTO MAY REPLACE.
   *
   * `restore()` writes these boxes without a DOM event, so it comes through
   * neither `onChange` — the form's own note says so about `touched` — and
   * without this line the record would still read `nobody` over a form that
   * visibly holds a pair. Attach a photo and it takes the boxes: the exact
   * overwrite §11.3 forbids, reached by the one path that does not look like
   * typing.
   *
   * CREDITED TO THE OWNER, ALTHOUGH THE DRAFT CANNOT SAY WHETHER THEY TYPED
   * IT OR A PHOTO FILLED IT — because both answers are refusals and the third
   * is not available. `Draft` keeps `lat`/`long` as text and nothing about
   * where they came from, and adding a provenance field to the payload would
   * be a schema change to store something no reader needs: what the record
   * has to answer is "may auto-fill write here", and for a restored pair that
   * is no either way.
   *
   * AN EMPTY DRAFT IS NOT A RESTORED COORDINATE. `""`/`""` is a draft with no
   * coordinate in it — the common case, since most entries have none — and
   * marking that as the owner's would make Restore silently switch auto-fill
   * off for the rest of the session.
   */
  const pairGiven = draft.lat.trim() !== "" || draft.long.trim() !== "";

  const next: EntryFormState = {
    ...state,
    /**
     * ON AN EDIT, THE TRIP AND THE SLUG ARE NOT TEXT — they are where the
     * resource LIVES. §11 guardrail 7 makes `dy:slug` the filename, both
     * controls are disabled for that reason, and a restore that wrote through
     * them would put the form's idea of the address out of step with the
     * resource it is about to PUT.
     */
    // Mirrors the initial state: a trip that is no longer on offer leaves the
    // picker unchosen rather than setting a value the control cannot show.
    ...(context.addressFixed
      ? {}
      : {
          tripIri: context.tripIris.includes(draft.tripIri) ? draft.tripIri : "",
          slug: draft.slug,
        }),
    headline: draft.headline,
    story: draft.story,
    occurred: draft.occurred,
    offset: offsetGiven ? draft.offset : state.offset,
    tagsText: draft.tagsText,
    mode: draft.mode,
    status: draft.status,
    /**
     * The coordinate goes back AS IT WAS TYPED, which is what was kept — see
     * the note on `Draft.lat` in lib/studio/drafts.ts. It is put through the
     * fuzz on the save that follows, exactly as if it had just been typed: a
     * value that reached the Pod by way of `localStorage` without passing the
     * boundary would be the same leak by a longer route.
     */
    lat: draft.lat,
    long: draft.long,
    /**
     * WHAT THE CONTROL SHOWS HAS TO BE WHAT IS APPLIED (§9 step 3), so a
     * precision the select cannot show is refused rather than restored. Two
     * ways to get one: a draft kept while the settings were unreadable, which
     * holds `""`, and a draft from a build whose option list has moved on.
     * Restoring either would leave the number the owner can see and the number
     * `fuzzForPublication` is given disagreeing, which is the shape §9 calls a
     * lie in whichever direction is worse.
     */
    precision: gridOf(draft.precision) === null ? context.presetPrecision : draft.precision,
    /**
     * THE PLACE TEXT GOES BACK VERBATIM — EXCEPT WHERE THE PAYLOAD CANNOT SPEAK
     * FOR THE FIELD AT ALL, and that exception is the whole of it.
     *
     * `""` and absent are DIFFERENT INSTRUCTIONS here, which is why
     * lib/studio/drafts.ts makes these three `.optional()` rather than giving
     * them a default. An empty string is a box the owner emptied, and in
     * `placeTextOf` that is REMOVE; an absent field is a `v2` payload written
     * before these controls existed, which has no opinion about the place
     * because there was no control to form one with.
     *
     * WRITING `undefined` THROUGH AS `""` IS A SILENT DELETION FROM THE POD.
     * Restore such a draft onto an entry that already has a name and the boxes
     * go empty, and the next save removes `schema:name` and the whole
     * `<#address>` — the half-restore the version segment exists to prevent,
     * arrived at by the operator chosen to avoid a version bump. `?? placeName`
     * is therefore "leave the control showing whatever it is showing", which on
     * an edit is the stored value.
     *
     * IT IS ALSO WHAT KEEPS THE `placeName` STATE'S ARGUMENT TRUE. That note
     * says these controls need no `touchedPlaceText` flag because they are
     * seeded from the entry — and a restore is the one moment that stops being
     * true, since it writes the controls from something other than the entry.
     * Leaving an absent field alone is what closes that gap.
     */
    placeName: draft.placeName ?? state.placeName,
    locality: draft.locality ?? state.locality,
    country: draft.country ?? state.country,
    slots: restoredSlots(draft.photos),
    coordinateAuthor: pairGiven ? { kind: "owner" } : state.coordinateAuthor,
  };

  /**
   * AND A RESTORED TIMESTAMP IS NOT ONE A PHOTO MAY REPLACE — the coordinate's
   * credit further down, for its reason: `restore()` writes these controls
   * without a DOM event, so it comes through neither `onChange`, and without
   * this the records would still read `nobody` over a form that visibly holds
   * a date. Attach a photo and it takes both halves: the overwrite §11.3
   * forbids, reached by the one path that does not look like typing.
   *
   * EACH RECORD MIRRORS ITS OWN SETTER, which is why the two lines are not
   * spelled alike. `setOccurred` above writes UNCONDITIONALLY, so the record
   * has to say whatever the payload said — and `""` is a draft with no date
   * in it, the common case, which leaves the clock open rather than switching
   * auto-date off for the rest of the session. `setOffset` writes only when
   * the payload's offset has the shape, so when it has nothing to say the
   * control keeps its value and the record keeps its author.
   *
   * A RESTORED OFFSET IS THE OWNER'S ALTHOUGH THE PAYLOAD CANNOT SAY WHETHER
   * THEY CHOSE IT OR THIS MACHINE GUESSED IT — `Draft` keeps no provenance —
   * and the cost is recorded rather than hidden: a draft whose offset was an
   * unconfirmed guess comes back WITHOUT the mark. The other way round is
   * worse in the direction §11.3 cares about, a photo silently replacing an
   * offset the owner chose, corrected, and accepted back off the banner.
   *
   * AND WITHIN A SESSION THAT CLEARING IS A NO-OP, which is the fact that
   * settles it rather than merely excusing it (contributed by the review,
   * 2026-09-07). The draft read is one-shot, so the banner exists only from
   * mount; while it is up the whole form sits inside
   * `<fieldset disabled={offered !== null}>`, which includes the photo
   * picker — so no photo can have been attached yet, `offsetGuess` is
   * ALWAYS `false` when this runs, and there is no mark here to lose. The
   * loss is strictly cross-session, and cross-session no code change can
   * recover it: after a reload the editor cannot know the restored clock came
   * from a photo. A `Draft` provenance field is not one option among several,
   * it is the only one, and lib/studio/drafts.ts treats every field addition
   * as a deliberate versioning decision.
   */
  return withTimeCredit(
    next,
    draft.occurred.trim() === "" ? { kind: "nobody" } : { kind: "owner" },
    offsetGiven ? { kind: "owner" } : state.offsetAuthor,
  );
}

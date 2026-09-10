/**
 * The owner accepting a stored draft, as ONE transition rather than thirteen
 * setters and a credit call. That ordering hazard is the reducer's first
 * justification (spec §5); every line below is argued in `./notes.md`, under
 * the heading its own pointer names. ./notes.md#where-the-restore-argument-lives
 */

import { gridOf } from "@/lib/studio/place/place";
import { OFFSET_SHAPE } from "@/lib/time/offsets";
import { withTimeCredit } from "./actions";
import type { EntryFormAction, EntryFormState, PhotoSlot } from "./actions";
import type { Photo } from "@/lib/pod/schema";

/** What a restored draft can still say about a photo whose file name is long
 *  gone: the caption if it has one, and its position otherwise. `Photo` has no
 *  file-name field on purpose — §7.3 describes the resource, not the pick. */
const restoredName = (photo: Photo, index: number) => photo.caption?.value ?? `Photo ${index + 1}`;

/** THE PHOTOS COME BACK ALREADY UPLOADED, and a pre-photo draft restores an
 *  EMPTY list rather than half of one:
 *  ./notes.md#restored-photos-come-back-already-uploaded */
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
   * one — writing it through leaves a BLANK control under a banner that just
   * said the draft came back. THE SHAPE, NOT THE LIST, IS THE TEST.
   * ./notes.md#the-offset-goes-back-only-if-the-draft-has-one-to-give
   */
  const offsetGiven = OFFSET_SHAPE.test(draft.offset);
  /** AND A RESTORED COORDINATE IS NOT ONE A PHOTO MAY REPLACE — `restore()`
   *  writes the boxes through no `onChange`. AN EMPTY DRAFT IS NOT A RESTORED
   *  COORDINATE: ./notes.md#a-restored-coordinate-is-the-owners */
  const pairGiven = draft.lat.trim() !== "" || draft.long.trim() !== "";

  const next: EntryFormState = {
    ...state,
    /** ON AN EDIT, THE TRIP AND THE SLUG ARE NOT TEXT — they are where the
     *  resource LIVES (§11 guardrail 7), so a restore may not write through
     *  them: ./notes.md#the-trip-and-the-slug-are-the-address-not-text */
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
    /** The coordinate goes back AS IT WAS TYPED, and is fuzzed on the save that
     *  follows: ./notes.md#the-coordinate-goes-back-as-it-was-typed */
    lat: draft.lat,
    long: draft.long,
    /** WHAT THE CONTROL SHOWS HAS TO BE WHAT IS APPLIED (§9 step 3), so a
     *  precision the select cannot show is refused rather than restored:
     *  ./notes.md#a-precision-the-select-cannot-show-is-refused */
    precision: gridOf(draft.precision) === null ? context.presetPrecision : draft.precision,
    /** THE PLACE TEXT GOES BACK VERBATIM — EXCEPT WHERE THE PAYLOAD CANNOT SPEAK
     *  FOR THE FIELD AT ALL. `""` is REMOVE and absent is silence; writing
     *  `undefined` through as `""` deletes `<#address>` from the Pod:
     *  ./notes.md#the-place-text-goes-back-verbatim-except-where-absent */
    placeName: draft.placeName ?? state.placeName,
    locality: draft.locality ?? state.locality,
    country: draft.country ?? state.country,
    slots: restoredSlots(draft.photos),
    coordinateAuthor: pairGiven ? { kind: "owner" } : state.coordinateAuthor,
  };

  /** AND A RESTORED TIMESTAMP IS NOT ONE A PHOTO MAY REPLACE. EACH RECORD
   *  MIRRORS ITS OWN SETTER, which is why the two lines differ; the offset's
   *  lost mark is a no-op within a session:
   *  ./notes.md#a-restored-timestamp-is-not-one-a-photo-may-replace */
  return withTimeCredit(
    next,
    draft.occurred.trim() === "" ? { kind: "nobody" } : { kind: "owner" },
    offsetGiven ? { kind: "owner" } : state.offsetAuthor,
  );
}

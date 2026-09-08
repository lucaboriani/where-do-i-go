/**
 * A photo may fill a value nobody has supplied, and may never take one away —
 * §11.3 for the coordinate, §11.5 for the timestamp's two halves. The decision
 * is a branch in here and a caller cannot make it:
 * ./notes.md#guard-inside-the-transition
 */

import { offsetMinutes, wallClockOf } from "@/lib/studio/time/offsets";
import { withTimeCredit } from "./actions";
import type { EntryFormAction, EntryFormState } from "./actions";

/** The eastern end of `OFFSETS` and of the world, in minutes. */
const OFFSET_LIMIT_MINUTES = 840;

/**
 * §11.3, AND IT IS AN OFFER RATHER THAN AN ASSIGNMENT: a photo may fill a
 * coordinate nobody has supplied, and may never take one away.
 *
 * WHAT IT WRITES IS THE PHOTO'S OWN READING, AT FULL PRECISION, INTO THE
 * FORM. Not a rounded one, and not `place.geo`:
 *
 *   - THE FORM, because that is the only route to the Pod that goes through
 *     §9. `fuzzed()` runs at save time over whatever these two boxes hold, so
 *     a photo's GPS is snapped or dropped exactly as a typed one is, and
 *     nothing downstream needs to know which it was. Putting `metadata.gps`
 *     on the `Entry` instead would publish the exact spot a picture was
 *     taken — no render-time mitigation behind it, and no second chance after
 *     the PUT.
 *   - AT FULL PRECISION, because a value rounded on the way IN is a snap the
 *     owner did not choose, applied before the grid they did choose, and
 *     invisible afterwards: 45.5155 and 45.51 look equally deliberate in a
 *     number box. `String` rather than `toFixed`, so the digits the reader
 *     returned are the digits shown.
 */
/* THE §9 FAIL-CLOSED GATE IS NOT HERE, and its own argument is unchanged where
   it stayed: ./notes.md#what-stayed-outside-the-reducer-and-why */
export function applyPhotoCoordinate(
  state: EntryFormState,
  action: Extract<EntryFormAction, { kind: "photo-coordinate" }>,
): EntryFormState {
  /* FIRST WRITER WINS. `nobody` is the only answer that admits a fill — see
     `CoordinateAuthor` for why the other two are both refusals, and why this
     is one record for the pair rather than one per box. */
  if (state.coordinateAuthor.kind !== "nobody") return state;

  return {
    ...state,
    lat: action.lat,
    long: action.long,
    coordinateAuthor: { kind: "photo", name: action.name },
  };
}

/**
 * §11.5, AND IT IS THE SAME OFFER `offerCoordinate` MAKES, MADE TWICE: a
 * photo may fill a half nobody has supplied, and may never take one away.
 *
 * THE WALL CLOCK GOES IN UNSHIFTED, WHICH IS WHAT THE FIELD MEANS. §7.3:
 * `dy:occurredAt` "carries the local UTC offset of the place", so the value is
 * the time it was THERE and `toOffsetDateTime` copies it rather than
 * recomputing it — see its docblock, whose reasoning this fill depends on.
 * Routing the photo's `07:05` through a `Date` would rewrite five past seven
 * in Tokyo as whatever o'clock it is here, and for any photo taken on the far
 * side of this machine's midnight it would move the DATE, not merely the hour.
 *
 * TO THE MINUTE, THROUGH `wallClockOf`, WHICH IS THE ONE SPELLING OF "a
 * timestamp, as this control shows it". Keeping the photo's `:33` is legal end
 * to end — `LOCAL_DATETIME` accepts optional seconds and passes them through
 * — but a `datetime-local` with no `step` neither displays nor edits seconds,
 * so they would be a third of a minute the owner cannot see and the first
 * keystroke would silently drop. `toOffsetDateTime` supplies the `:00` §6
 * wants, exactly as it does for a hand-typed clock.
 *
 * NO §9 GATE HERE, AND THAT IS A DECISION RATHER THAN AN OMISSION.
 * `offerCoordinate` asks `coordinatesLive` because the fail-closed posture is
 * about publishing a POINT; an offset is not a coordinate and neither is a
 * wall clock. The offset control is deliberately not tied to that gate either
 * — see its own note in the form — because an owner whose privacy settings
 * cannot be read still gets to say what time of day it was.
 *
 * AND A HALF MAY ONLY JOIN THE OTHER HALF IT BELONGS WITH — ruling T4-E, and
 * the guard that closes the one reachable data defect this task shipped.
 * `offerCoordinate` needs no analogue: a photo either carries both GPS tags
 * or neither (lib/media/exif.ts sets `gps` only when both are present), so
 * `coordinateAuthor` is one record for a pair and a mixed coordinate cannot
 * be composed from two photos at all. The timestamp's two halves arrive
 * independently, and any day's walk produces the sequence:
 *
 *   1. `tokyo.jpg` — a clock and no zone. The clock fills, the offset is
 *      left as this machine's guess, and the mark and the note go on.
 *   2. `chathams.jpg` — a phone that writes both. Its clock is refused,
 *      correctly, because the first photo already supplied one.
 *   3. Its ZONE was then accepted, because the offset was still `nobody`'s —
 *      which composed Tokyo's `07:05` with the Chathams' `+12:45`, an instant
 *      that happened at NEITHER place, and cleared the mark in the same
 *      motion, because the mark reads "a photo dated it and nobody offset
 *      it". §11.5's stated failure, reached by two photos, with the warning
 *      removed by the act of composing it.
 *
 * T4-C IS NOT WHAT PERMITTED THAT, AND STANDS. It says the wall clock and the
 * offset are independent because the owner correcting WHEN beside a photo
 * supplying WHERE is coherent — one side is a competent authority who can see
 * both halves and fix either. Photo A's clock beside photo B's zone has no
 * authority anywhere in it: it is T3-A's "value that is nowhere", and neither
 * the value nor any warning about it survives. So each branch asks WHOSE the
 * other half is, not merely whether it is spoken for, and `{ kind: "photo" }`
 * carrying the slot's `key` is what makes that askable.
 *
 * `key`, AND NOT THE FILE NAME, WHICH IS HOW T4-E's OWN GUARD DEGENERATED FOR
 * A DAY (F1). It compared `file.name`, and `PhotoSlot`'s docblock — up where
 * the slot type is declared — says a name is not an identity: the picker is
 * `multiple` and deduplicates nothing. Two cameras both calling their first photo
 * `IMG_0001.jpg` is the ordinary case, not a contrived one, and it walked the
 * sequence above straight back through the guard: A's clock in, B's clock
 * refused, B's ZONE accepted because `"IMG_0001.jpg" === "IMG_0001.jpg"`, and
 * the mark cleared in the same motion. The guard passed both of its tests and
 * failed on the pair of names any two cameras produce. `key` is minted per
 * slot in `attach` and cannot collide, which makes the comparison ask the
 * question the ruling meant.
 *
 * BOTH BRANCHES, OR NEITHER. Guarding only the zone leaves the mirror — a
 * zone-only photo, then a clock-only one — exactly as it was, and the order
 * the owner picks two photos in is an accident. The same-`key` comparison is
 * what keeps ONE photo supplying both halves legal: by the zone branch the
 * clock's record already names the slot being offered, and the wall branch
 * sees an offset no photo has touched yet.
 *
 * BOTH TAGS ARE OPTIONAL AND NEITHER GUARD IS DECORATION. `readMetadata`
 * returns `{}` for a file it cannot read at all — a scan, a screenshot, a
 * camera whose clock was never set, which it rejects by sentinel — and that is
 * the case this meets most often. The obvious
 * `setOccurred(String(metadata.dateTimeOriginal))` writes the nine characters
 * `undefined` into the state; a `datetime-local` reads that back as empty, so
 * the box CANNOT show the defect and the autosaved draft is the only surface
 * that can.
 */
export function applyPhotoTimestamp(
  state: EntryFormState,
  action: Extract<EntryFormAction, { kind: "photo-timestamp" }>,
): EntryFormState {
  const { key, name, wall, offset } = action;
  /* FIRST WRITER WINS, PER HALF — `nobody` is the only answer that admits a
     fill, and `TimeAuthor` is where the other two are argued out, including
     why an edit's NON-empty box is not the question being asked here. */
  let occurredTo = state.occurredAuthor;
  let offsetTo = state.offsetAuthor;
  let occurred = state.occurred;
  let zone = state.offset;

  if (
    wall !== undefined &&
    occurredTo.kind === "nobody" &&
    /* …and not beside ANOTHER photo's zone (T4-E). `offsetTo` is untouched by
       this photo at this line, so a `photo` here is always an earlier one.
       On the slot's `key` and never on `name`, which two cameras share — F1,
       argued in the docblock. */
    (offsetTo.kind !== "photo" || offsetTo.key === key)
  ) {
    occurred = wallClockOf(wall);
    occurredTo = { kind: "photo", key, name };
  }

  if (
    offset !== undefined &&
    /* THE HALF EXIF USUALLY HAS NOTHING TO SAY ABOUT (§11.5), and when it does
       say something it is already `+09:00`-shaped: lib/media/exif.ts reads tag
       0x9011 and validates it against `/^[+-]\d{2}:\d{2}$/`, so what arrives
       here is an offset or nothing. It goes in AS READ — never through
       `offsetHere` or a `Date`, either of which answers with this machine's zone
       — and `offsetOptions` unions whatever the control holds into the list, so
       an offset the list does not carry renders instead of the select silently
       showing its first option.

       SHAPE-VALID IS NOT IN RANGE, AND `+99:99` IS WHAT THAT COSTS (F4). That
       regex is the WHOLE of exif.ts's validation, so a camera — or this
       project's own fixture builder — can put 6 039 minutes east of Greenwich
       into the control, `offsetOptions` unions it into the select beside thirty
       real zones, and `toOffsetDateTime` concatenates it onto the wall clock the
       same photo supplied. It then fails CLOSED, which is the good half:
       `serialiseEntry`'s `Entry.safeParse` refuses the timestamp and nothing
       reaches the Pod. The defect is the advice the owner is then given —
       `announce`'s "The entry did not reach your Pod … try again", which is
       false on the first retry and on every one after it, with nothing on the
       form pointing at a select quietly showing `+99:99`. So the range is
       checked HERE, on the way in, and NOT in `OFFSET_SHAPE`: that fence is
       deliberately wider, because an entry some other tool wrote may carry
       `+05:15` and this editor's job is to show such a value and put it back
       unchanged (§1c). What may not happen is ACCEPTING one from a photo. 840
       minutes is `+14:00`, the eastern end of `OFFSETS` and of the world.

       THE TOTAL-MINUTES FENCE ABOVE MISSES A SECOND WAY TO BE SHAPE-VALID AND
       IMPOSSIBLE, AND `+05:61` IS WHAT THAT COSTS (closing item 4, still F4).
       exif.ts's regex accepts any two digits in the minutes pair, so `61` is
       shape-valid, and `offsetMinutes` composes it as `5 * 60 + 61 = 361` —
       comfortably inside ±840, the same fence that stops `+99:99`. Nothing
       between here and the Pod catches it except `Entry.safeParse`'s
       `z.iso.datetime({ offset: true })`, at the very end of the chain, after
       Save — so `+05:61` fills the control, gets unioned into the select, and
       reproduces the exact "did not reach your Pod … try again" on every
       retry that the paragraph above exists to prevent. So the minutes digits
       are range-checked separately, right here, rather than by widening the
       total-minutes fence to catch them incidentally — `Number(zone.slice(4,
       6)) < 60` reads the same two characters `offsetMinutes` does, checked
       on their own before they are composed into it.

       THIS IS THE SAME LOOSE/STRICT SPLIT AS `+99:99`'S, ONE FIELD OVER, AND
       `OFFSET_SHAPE` STAYS AS WIDE AS IT WAS: loose for what this editor
       DISPLAYS — a stored `+05:15`, or for that matter a stored `+05:61` some
       other tool once wrote, must still render and round-trip unchanged
       (§1c) — strict for what it ACCEPTS FROM A PHOTO, which is this
       conjunct and only this conjunct. Tightening `OFFSET_SHAPE` instead
       would refuse to RENDER a value this editor is only obliged to show. */
    Math.abs(offsetMinutes(offset)) <= OFFSET_LIMIT_MINUTES &&
    Number(offset.slice(4, 6)) < 60 &&
    offsetTo.kind === "nobody" &&
    /* …and not beside ANOTHER photo's clock (T4-E, on `key` — F1). The wall
       branch has already run, so for a photo carrying both tags `occurredTo`
       names THIS slot and the comparison lets it through — which is what
       keeps 12b's one-photo case, and this guard, from being in each other's
       way. */
    (occurredTo.kind !== "photo" || occurredTo.key === key)
  ) {
    zone = offset;
    offsetTo = { kind: "photo", key, name };
  }

  /* UNCONDITIONAL, AND IDEMPOTENT WHEN NOTHING FILLED: the mark is derived
     from these two records in one place, so re-crediting them with what they
     already hold recomputes the same answer. What it must not do is leave a
     fill uncredited, which is why it is not inside either branch. */
  return withTimeCredit({ ...state, occurred, offset: zone }, occurredTo, offsetTo);
}

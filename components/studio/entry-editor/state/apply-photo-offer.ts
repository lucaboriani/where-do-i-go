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

/** §11.3, AND IT IS AN OFFER RATHER THAN AN ASSIGNMENT. What it writes is the
 *  photo's own reading, AT FULL PRECISION, INTO THE FORM — the only route to
 *  the Pod that goes through §9:
 *  ./notes.md#the-coordinate-offer-writes-the-form-at-full-precision */
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
 * §11.5, THE SAME OFFER MADE TWICE, and the wall clock goes in UNSHIFTED. A HALF
 * MAY ONLY JOIN THE OTHER HALF IT BELONGS WITH — T4-E, on the slot `key` and
 * NEVER on the file name (F1), in BOTH branches.
 * ./notes.md#the-timestamp-offer-and-the-two-photos-that-composed-nowhere
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
    /* THE HALF EXIF USUALLY HAS NOTHING TO SAY ABOUT (§11.5), and it goes in AS
       READ. THESE TWO CONJUNCTS ARE F4 AND ITS CLOSING ITEM: exif.ts checks the
       SHAPE only, so `+99:99` and `+05:61` both arrive shape-valid and both make
       `announce` give advice that is false on every retry. `OFFSET_SHAPE` stays
       wide — loose for what is DISPLAYED, strict for what is ACCEPTED FROM A
       PHOTO: ./notes.md#shape-valid-is-not-in-range-twice */
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

/**
 * A keystroke, and the credit that goes with it. Three of the fifteen fields
 * move a record; the other twelve move nothing, and the transition is the only
 * place either can happen. ./notes.md#guard-inside-the-transition
 */

import { withTimeCredit } from "./actions";
import type { EntryFormAction, EntryFormState } from "./actions";

type FieldEdit = Extract<EntryFormAction, { kind: "field" | "mode" | "status" }>;

export function applyFieldEdit(state: EntryFormState, action: FieldEdit): EntryFormState {
  if (action.kind === "mode") return { ...state, mode: action.value };
  if (action.kind === "status") return { ...state, status: action.value };

  const next = { ...state, [action.field]: action.value };
  switch (action.field) {
    /* THE KEYSTROKE IS WHAT MAKES THE PAIR THE OWNER'S, and it is
       recorded HERE rather than in the form's `onChange` above: that
       handler catches every control on the form, and this record is
       about these two. §11.3 in one line — from now on a photo may
       offer nothing, in either box (`CoordinateAuthor`). */

    /* Either box, and the same record: a latitude from the owner
       beside a longitude from a photo is a point that is nowhere, and
       §9 would fuzz and publish it as though it were real. */
    case "lat":
    case "long":
      return { ...next, coordinateAuthor: { kind: "owner" } };
    /* THE KEYSTROKE IS WHAT MAKES THE CLOCK THE OWNER'S, recorded
       here rather than in the form's own `onChange` for the reason the
       coordinate boxes give: that handler catches every control on the
       form, and this record is about this one. §11.3 in one line —
       from now on a photo may offer no wall clock.
       AND THE OFFSET'S RECORD PASSES THROUGH UNTOUCHED (T4-C): the
       owner correcting WHEN says nothing about the zone.
       WHICH IS ALSO WHY THIS KEYSTROKE TAKES THE CREDIT AND LEAVES
       THE WARNING — ruling T4-G, and the comment that used to be here
       was the argument against it: it claimed a typed-over clock
       leaves "the default every create opens with, which the
       permanent hint already covers". THAT EQUIVALENCE DOES NOT HOLD.
       On a create the owner types a clock from memory beside a guess
       they were never misled about; here `07:05` nudged to `07:06`
       leaves the clock substantially the photo's, and clearing the
       mark would leave §11.5's composition intact with the warning
       gone. "The time came from a.jpg" is what a keystroke makes
       uncheckable; "the offset is this machine's guess" is untouched
       by it and still true. `creditTime` keeps them apart. */
    case "occurred":
      return withTimeCredit(next, { kind: "owner" }, state.offsetAuthor);
    /* THE CHOICE IS WHAT ENDS THE GUESS (scenario 4), and it is one
       assignment rather than a second piece of state: the mark and the
       note both follow this record, so "the owner has chosen" and "the
       note has stopped being true" cannot come apart. The wall clock's
       record passes through untouched (T4-C). */
    case "offset":
      return withTimeCredit(next, state.occurredAuthor, { kind: "owner" });
    default:
      return next;
  }
}

/**
 * A thin switch over the three `apply-*` transitions and the two slot moves.
 * Every rule lives in the function the case names; nothing decides anything
 * here. ./notes.md#guard-inside-the-transition
 */

import { applyFieldEdit } from "./apply-field-edit";
import { applyPhotoCoordinate, applyPhotoTimestamp } from "./apply-photo-offer";
import { applyRestore } from "./apply-restore";
import type { EntryFormAction, EntryFormState } from "./actions";

export function entryFormReducer(state: EntryFormState, action: EntryFormAction): EntryFormState {
  switch (action.kind) {
    case "field":
    case "mode":
    case "status":
      return applyFieldEdit(state, action);
    case "photo-coordinate":
      return applyPhotoCoordinate(state, action);
    case "photo-timestamp":
      return applyPhotoTimestamp(state, action);
    case "restore":
      return applyRestore(state, action);
    /* A ROW IS APPENDED AND A ROW IS REPLACED, both as functions of the state
       the reducer is handed rather than of the list a render held:
       ./notes.md#three-deviations-from-the-plans-action-union-each-measured */
    case "slot-added":
      return { ...state, slots: [...state.slots, action.slot] };
    case "slot-settled":
      return {
        ...state,
        slots: state.slots.map((slot) => (slot.key === action.key ? action.slot : slot)),
      };
    default: {
      /* THE `never` BINDING IS THE POINT: a new action added to the union
         without a case here is a compile error, not a silent no-op. */
      const exhaustive: never = action;
      throw new Error(`unhandled action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

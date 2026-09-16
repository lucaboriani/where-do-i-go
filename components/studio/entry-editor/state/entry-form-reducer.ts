/**
 * A thin switch over the three `apply-*` transitions and the two slot moves.
 * Every rule lives in the function the case names; nothing decides anything
 * here. ./notes.md#guard-inside-the-transition
 */

import { applyFieldEdit } from "./apply-field-edit";
import { applyPhotoCoordinate, applyPhotoTimestamp } from "./apply-photo-offer";
import { applyRestore } from "./apply-restore";
import { sid } from "./actions";
import type { EntryFormAction, EntryFormState, SectionDraft } from "./actions";

/** Swap a section past its neighbour, a no-op at the ends. */
function moveSection(sections: SectionDraft[], id: string, dir: "up" | "down"): SectionDraft[] {
  const at = sections.findIndex((section) => section.id === id);
  const to = dir === "up" ? at - 1 : at + 1;
  if (at === -1 || to < 0 || to >= sections.length) return sections;
  const next = [...sections];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

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
    case "section-text":
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.id ? { ...section, text: action.value } : section,
        ),
      };
    case "section-added":
      return { ...state, sections: [...state.sections, { id: sid(), text: "", slots: [] }] };
    case "section-removed":
      return { ...state, sections: state.sections.filter((section) => section.id !== action.id) };
    case "section-moved":
      return { ...state, sections: moveSection(state.sections, action.id, action.dir) };
    /* A ROW IS APPENDED AND A ROW IS REPLACED within the section `sectionId`
       names, as functions of the state the reducer is handed rather than of a
       list a render held: ./notes.md#three-deviations-from-the-plans-action-union-each-measured */
    case "slot-added":
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.sectionId
            ? { ...section, slots: [...section.slots, action.slot] }
            : section,
        ),
      };
    case "slot-settled":
      return {
        ...state,
        sections: state.sections.map((section) =>
          section.id === action.sectionId
            ? {
                ...section,
                slots: section.slots.map((slot) => (slot.key === action.key ? action.slot : slot)),
              }
            : section,
        ),
      };
    default: {
      /* THE `never` BINDING IS THE POINT: a new action added to the union
         without a case here is a compile error, not a silent no-op. */
      const exhaustive: never = action;
      throw new Error(`unhandled action: ${JSON.stringify(exhaustive)}`);
    }
  }
}

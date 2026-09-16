# sections-field — notes

Stage 3a Task 2. Spec: `docs/superpowers/specs/2026-09-15-sectioned-entry-design.md`
§7 (the editor gains section authoring — add / remove / reorder, 0–2 photos
each, sort order derived from list position on save).

## Props only

Six props, all values or callbacks — no state, no effect, no `"use client"`
directive, for the reason every sibling field group gives
(`field/notes.md#why-it-is-its-own-component`): it inherits the client boundary
from `entry-editor.tsx`.

## The group name is 1-based and the ids are 0-based

`aria-label={`Section ${index + 1}`}` is what a person or a screen reader
counts by. The text/photo control ids stay `entry-section-${index}-…`,
0-based, matching Task 1's single-section scheme exactly so a card added later
never renumbers the ids of the ones before it.

## Reorder is up/down buttons, not drag

Decided with the maintainer 2026-09-16 (spec §11): simplest, no drag-and-drop
library, and keyboard/screen-reader accessible for free. `onMove` is a no-op at
either end — `moveSection` in `hooks/studio/use-entry-form.ts` handles that —
and the buttons are additionally `disabled` there, which is belt: a disabled
button both looks inert and cannot dispatch the click at all.

## What this test pins

Rendered directly with props, never through the editor's harness, for the
reason `field/notes.md#why-not-import-the-harness` gives. Two sections, one
carrying a ready photo slot:

1. **Each section's text control has a unique id and shows that section's own
   text** — `entry-section-0-text` / `entry-section-1-text`, never the same id
   twice.
2. **An edit reports the edited section's id, not the other one's.**
3. **Each section's photo picker and slot rows are scoped to that section's own
   `slots`** — the ready slot renders under its own card and nowhere else.
4. **`onPicked` carries the section's id alongside the files.**
5. **"Add section" invokes `onAdd`; Remove and the move buttons invoke
   `onRemove`/`onMove` with the right section's id** (and direction, for move).
6. **Move-up is disabled on the first card, move-down on the last — with the
   allow-case on each end's other direction asserted too**, so a blanket
   disable cannot pass by accident.

## The cap refusal is DISABLE, not hide

The plan (`docs/superpowers/plans/2026-09-16-sectioned-entry-stage-3a-studio-
editor.md`, Task 3) leaves open whether the refusal at the 2-photo cap is a
visible message or the picker simply going away. Chosen: DISABLE — the photo
rows and the picker's own hint stay in place, nothing shifts under the owner's
pointer, and "disabled" is already announced by every screen reader without
new copy to write or localise. Simplicity over cleverness (CLAUDE.md's own
first rule).

## Why `photo-fields` is reused rather than folded in

`photo-fields.tsx` already carries its own test for the four slot states and
the picker's own behaviour; folding that markup in here would either drop that
coverage or duplicate it. The only change needed was the hardcoded
`"entry-photos"` id becoming a prop, so each card can pass its own — see
`../photo-fields/notes.md#id-is-a-prop-now`.

# when-fields — notes

The second of Stage B's five field groups: `entry-when`, `entry-offset`, and the
three notes that say where their values came from. No state moved — the two
records live in `creditTime` and the four `useState`/`useRef` pairs behind it
stay in `entry-editor.tsx`, exactly as Task 5 requires.

## Props only

No `useState`, no `useRef`, no effect, and no `"use client"` directive — it
inherits the boundary from `entry-editor.tsx` for the reason
`field/notes.md` gives.

**Eight named props, not a spread.** The two callbacks are typed
`(value: string) => void`, so the editor can pass an inline arrow today and a
dispatcher after Task 6 without this file changing.

## What travelled, and what deliberately did not

Moved **verbatim**, docblocks included: `OCCURRED_SOURCE_ID`,
`OFFSET_SOURCE_ID`, `OFFSET_GUESS_ID` and the fifty-line docblock arguing why
there are three of them; `occurredSourceNote`, `offsetSourceNote`,
`offsetGuessNote`; and `occurredHelp`/`offsetHelp`, which stay closures over
props rather than becoming parameterised module functions, so their signatures
are unchanged.

The three ids and the two `*Help` builders travel **together**, and that is the
point of moving either: the builder names an element this group renders, so an
id shared between a note here and a builder in the editor would be one string
in two files. The editor imports nothing back — the dependency runs one way.

**Two handler-argument comments stayed behind**, with the handlers they argue
about. `creditTime` is still the editor's, so the nineteen-line ruling on why a
keystroke in the clock takes the credit and leaves the warning (T4-G) sits on
`typeOccurred` in `entry-editor.tsx`, and the five-line one about the choice
ending the guess sits on `chooseOffset`. Both were inside these controls'
`onChange` attributes before the split; they are now on named handlers in the
editor's body, which is what keeps the composition JSX one line per prop. Task 6
moves them again, with `creditTime`.

## Three bearings that went stale in the move

Recorded rather than repaired: an extraction commit whose diff contains
rewritten prose is one nobody can read as an extraction — `field/notes.md` set
that precedent on 2026-09-08 and this follows it.

1. The three-notes docblock opens with "`COORDINATE_SOURCE_ID`'s shape", and
   that constant moves to `fields/where-fields/` in the next commit. The name
   still resolves; "this file" no longer does.
2. The same docblock says "a `<section aria-label="Photos">` around the picker
   once cost this file six tests". The picker is `fields/photo-fields/`'s now.
3. `occurredHelp`'s docblock is written against `coordinateHelp` — "ONE FUNCTION
   PER CONTROL RATHER THAN `coordinateHelp`'s PARAMETERS" — which is in
   `where-fields` from the next commit onward.

## What this test pins

Rendered directly with props, never through the editor's harness, for
`field/notes.md#why-not-import-the-harness`'s reasons.

1. **Both controls are named and hold their values**, `datetime-local` and a
   `SELECT`, and the offsets are asserted as text **and** as `value` — the two
   must be the same string, which is the list's own docblock.
2. **Each half reports to its own callback and the other stays silent.** The one
   mistake this extraction can make is crossing the two wires, and it passes
   every value assertion.
3. **Each note is rendered exactly when something points at it**, asserted from
   both ends: the described text when it is there, and `getElementById` returning
   `null` plus a describedby of `["entry-when-hint"]` when it is not. A dangling
   IDREF computes to the empty string, so the helper proves every id resolves
   before reading any text.
4. **The guess mark is an attribute on the control, absent rather than "false".**
   Both cases, because "reads as correct markup while answering a question nobody
   asked" is the failure the `undefined` spelling exists for.
5. **The guess note in both wordings** — with the photo's name while the clock
   still credits it, and without it once the clock is the owner's (T4-G). Full
   string equality, because the two differ by a clause rather than by a keyword.
6. **The offset's describedby lists hint, then warning, then credit, in order.**
   `offsetHelp` lists all three rather than branching on the exclusion, and the
   order is what makes the hint heard as the control's purpose.

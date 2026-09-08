# hooks — notes

`use-entry-form.ts` is the first of the five, and the only one Task 6 wrote: it
owns the `useReducer` and hands the field groups values and callbacks. The other
four — save, draft, settings gate, photo pipeline — are Task 7's.

## the five seedings that are not obvious

`initialEntryFormState` is where every one of them now lives, and each is a
defect this project has already shipped or nearly shipped. The full arguments
travelled with the fields, verbatim, and are the docblocks in that function:

1. **The offset is the entry's own, else this machine's** — `offsetOf(existing)
   ?? offsetHere(wallClockNow())`, and `wallClockNow()` rather than `occurred`,
   because `offsetHere("")` is `+00:00` and not this machine's zone.
2. **The coordinate boxes are EMPTY on an edit**, deliberately: what is stored
   is the published pair, already snapped, and prefilling it makes every save
   re-snap it and the pin walk.
3. **The place text is SEEDED from the entry**, which is the opposite answer to
   the coordinate's and is what makes "untouched" and "emptied"
   distinguishable at all for text.
4. **`slots` is NOT seeded from `existing.photos`.** It would renumber their
   `sortOrder` on every save, and each seeded row would announce a settled
   `role="status"` at mount about a photo that has not changed.
5. **The three authors are seeded from the ENTRY, conditionally** — rulings
   T3-B and T4-B. `nobody` unconditionally lets a photo move, or from inside
   the home region delete, a pin an edit was loaded with; `owner`
   unconditionally switches auto-fill off for every edit ever made. What
   separates the two spellings is the allow-case, an edit of an entry that has
   no geometry and no `dy:occurredAt`.

## Two bearings the move made stale, recorded rather than repaired

The precedent is `field/notes.md#what-travelled-here-already-wrong`: prose
rewritten inside an extraction commit is what makes the extraction
unreviewable.

1. `coordinateAuthor`'s docblock and the two time authors' both carry a
   paragraph beginning "DECLARED HERE, ABOVE `attach`", which argues that
   `react-hooks/immutability` refuses a `.current` write inside a function
   closing over a `useRef` declared below it. **There is no ref any more** —
   the three are fields of `EntryFormState` — so the paragraph argues about a
   mechanism that no longer exists. `touched` and `nextSlotKey` are still refs
   and their version of it still holds.
2. The same docblocks say "A REF, AND READ AT THE MOMENT OF THE FILL RATHER
   THAN FROM A CLOSURE". The property survives; the mechanism is now that React
   folds queued actions in order, which is
   `../state/notes.md#guard-inside-the-transition`.

## Why the setters are fifteen names and not one `dispatch`

A group holding `dispatch` can invent a transition, and the point of `state/` is
that it cannot. `field(name)` builds thirteen of them from one line; `mode` and
`status` are spelled out because their values are not strings.

**`useMemo` with `[]`, and that is a requirement rather than an optimisation.**
The first spelling was plain arrows, re-created per render exactly as
`typeOccurred` and `chooseOffset` were, on the argument that none of the five
groups is memoised so a stable identity buys nothing. `npm run lint` disagreed,
and it was right: `EntryEditor`'s §7.6 effect calls `form.set.precision` when
the settings land, so `react-hooks/exhaustive-deps` demands `form.set` in its
dependency array — and an unstable `set` there re-runs the effect on every
render, which re-`setGate`s, which re-renders. A loop, at `--max-warnings 0`,
caught by the rule rather than by a test.

`dispatch` is stable by contract, so `[]` is the honest array; the fifteen
names are inside the factory for the same reason.

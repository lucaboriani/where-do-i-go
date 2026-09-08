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

---

# `use-settings-gate`

## the gate is read on mount and never again

§9 makes every coordinate write conditional on `privacy.ttl`, so a form that
took the input and refused it afterwards would have accepted a coordinate it was
never going to publish and said nothing until Save. The controls are dead or
live according to the answer, which means the answer has to arrive first — and
that is why this is a mount effect rather than a save-time read.

`gate` itself does not escape the hook. Every question the form used to ask of
it — is it live, what does the select offer, what does the note say, what is the
detail, what may be published — is answered by a named field of
`SettingsGateView`. That is what let `precisionOptions` come along: two of its
three sources are the gate's, and leaving it behind would have meant returning
`gate` for one `kind === "ready"` test in the editor's body.

`fuzzed` came for the same reason and is the one that matters: its first line is
`gate.kind !== "ready"`, so it cannot be anywhere `gate` is not.

## two bearings the move made stale, recorded rather than repaired

`field/notes.md#what-travelled-here-already-wrong` is the precedent.

1. `coordinateNote`'s and `precisionOptions`' docblocks both end by pointing at
   "the select below" / "see the select below". There is no select in this file
   — it went to `fields/where-fields/` in Task 5, and both bearings were already
   one file out of date before this move. Every name still resolves; neither
   file does.
2. The read effect's own docblock says "components/studio/studio-shell/studio-shell.tsx
   uses for `enumerateTrips`", which is still true, and "`restoreSession`'s for
   the same reason", which is still true. Left as found.

## what use-settings-gate is tested for

Eighteen cases, in four groups. What each group bites:

- **the three states** — `checking` holds the controls and says so *without
  saying what*, which is a rule about vocabulary: the wait and the answer must
  not share words, or the answer stops carrying information. `closed` carries
  its detail as a separate field, outside the sentence. And the fourth case is
  the one a lazy implementation fails: settings that parse but carry **no
  `home`** are `ready`, not `closed`. Collapsing those two strips the pin from
  every entry of everyone who never set a home region, silently and for ever.
- **one read, however many invocations** — StrictMode invokes the effect twice
  and `readPrivacySettings` must be called once. A `live` flag alone cancels the
  first invocation's promise and leaves the second awaiting nothing, so the gate
  never opens at all; holding the PROMISE is what makes both await one request.
  The second case pins the memo's key: an unrelated prop moving is not a re-read,
  a changed URL is.
- **what the precision control offers** — that §7.6's own 500 m *joins* the grid
  list rather than being rounded onto it, deduped, sorted, and that the value
  the form is holding joins it too so a restored draft renders the number it is
  about to publish at.
- **`fuzzed` fails closed** — `checking` publishes nothing, an unusable grid
  publishes nothing, a point inside the home region is a REMOVAL, and a snap
  reports `precisionMeters` from the RESULT rather than from the select.

## why this one mocks the read

The component suites serve `privacy.ttl` over MSW on purpose, and the harness
says why at length: §7.6's resource is owner-only and a mocked
`readPrivacySettings` would prove nothing about the request that goes over the
wire. Neither reason applies here. What is under test is this hook's own
decisions; the read is covered by `test/privacy-settings.test.ts`; and "how many
reads?" cannot be asked at all without holding the promise by hand.

## why the seed is built outside the render callback

`renderHook(() => useSettingsGate(seed()))` reads as a shorthand and is an
infinite loop. `seed()` builds a fresh `onDefaultPrecision`, the read effect
lists it in its dependency array, so every render re-runs the effect, which
re-`setGate`s, which re-renders. Measured on 2026-09-08: two cases written that
way timed out at 5 000 ms rather than failing on an assertion.

That is the same loop `#why-the-setters-are-fifteen-names-and-not-one-dispatch`
records from the other side, and it is why the seed's docblock says the callback
MUST be stable rather than merely SHOULD. The editor passes
`form.set.precision`, which is inside a `useMemo` with `[]`.

The hook could defend itself with a ref instead, and deliberately does not: the
dependency array is the one the effect had in `entry-editor.tsx`, and a move
that quietly changes what re-runs an effect is the defect class this stage's
ordering exists to prevent.

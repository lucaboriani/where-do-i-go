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

---

# `use-entry-draft`

## the scope follows the target and that was once argued backwards

The key a draft is written under is the shared `new` until a resource exists,
and the entry's own document URL from the moment one does. The hook takes it as
`entryUrl` — `target?.url` — rather than as `target`, so that nothing here
imports the save's types; `scope = entryUrl ?? NEW_DRAFT_SCOPE` is the whole
derivation and the argument for it is the docblock's, verbatim.

That argument is worth repeating because the comment used to say the opposite.
It claimed keying on `target` "would clear a key nothing was ever stored under
and leave the real draft behind", which on an EDIT is false: `target.url` starts
life as `documentUrlOf(initial.entry.iri)`, the expression the line used to be.
The one place the two derivations differ is the one that mattered — after a
successful CREATE, `target` moves and the scope has to move with it, or
everything typed afterwards is autosaved under the create key while carrying the
created entry's slug, and tomorrow's fresh create form offers it back for a
`If-None-Match: *` against a URL that now exists.

## the `touched` ref moved into the hook that reads it

Task 6 left it in the component with a note saying it was Task 7's. It is now
`useEntryDraft`'s, and the pipeline arms it through `markTouched()` rather than
by writing `.current` itself.

**That ordering is the reason, and it is a cycle avoided rather than a
preference.** `useEntryDraft` needs `text`, which needs the READY photos, which
come from the slots the pipeline settles; `usePhotoPipeline` needs whatever arms
the autosave. One of the two edges has to be a plain function call, and the ref
belongs to the effect that READS it — the autosave — not to the code that
happens to arm it. `attachedOf(slots)` is a pure helper the component spends, so
the draft hook is called first and hands `markTouched` down.

The ref's own docblock still says "DECLARED HERE, ABOVE `attach`, AND NOT DOWN
IN THE DRAFT SECTION WHERE THE REST OF ITS MACHINERY LIVES", and argues from
`react-hooks/immutability` refusing a `.current` write inside a function closing
over a `useRef` declared below it. **It travelled verbatim and it is now false
in both halves**: the ref IS in the draft section, and `attach` no longer writes
it. The rule it names is real and still holds — it is why `markTouched` and
`settleDraft` sit below the declaration in this file — but the conclusion it
draws is about a layout that no longer exists. Recorded rather than repaired,
on `field/notes.md#what-travelled-here-already-wrong`'s precedent.

## `markTouched` alone arms nothing

Measured while writing the test, and it changed how every debounce case is
written: `touched` is a GUARD the autosave effect reads when its dependencies
change, not a trigger. Calling `markTouched()` on its own arms no window at all,
because nothing re-runs the effect.

In the editor the pair always happens together — the `<form onChange>` handler
and the state update are one event, and a photo settling is a slot change and a
`markTouched()` in the same batch. So the test helper does both, and the first
five cases written with `markTouched()` alone failed for that reason rather than
for anything about the hook.

The one case that is deliberately the other way round is "writes nothing until
the form has been touched": there the form MOVES and the ref stays down, which
is an editor being read rather than typed into.

## why the autosave still depends on sixteen values

`text` is a fresh object on every render, so it cannot be the dependency: the
effect would re-run every render, restart the window, and never fire. The hook
therefore destructures `text` into its sixteen fields and lists those, which is
the dependency array the effect had in `entry-editor.tsx`, value for value.

The shorter spelling was tried on paper and declined. Memoising `text` on
`[form.values, attached]` gives one dependency, and reducer-state identity is
*almost* the same signal — but `applyPhotoTimestamp` returns a new object even
when both of its branches refuse, so a refused offer would restart a window
today's array leaves alone. It happens to be batched with a slot change every
time it can occur, which makes the two equivalent by an argument about
scheduling rather than by construction. The sixteen names need no argument.

## what use-entry-draft is tested for

Twenty cases. `draftTextOf` first, because it is the projection everything else
spends: the sixteen fields and *not* `slots`, the three credits or `offsetGuess`
— a slot holds no URL until it settles, and a `File` in a draft serialises to
`{}` without throwing.

Then the four things only this hook can be asked:

- **the debounce** — nothing before the window closes and exactly one write
  after it (either half alone passes against a broken implementation), the key
  it writes under on a create and on an edit, an offset on `savedAt`, that a
  refusal keeps trying on later windows, and that nobody signed in writes
  nothing.
- **the offer** — one look per editor, including under StrictMode, which is what
  the `draftRead` ref buys; that a discard is GONE from storage rather than
  hidden; and that a RESTORE clears the banner and leaves storage alone.
- **the settle** — the pending window cancelled first, so no timer writes the
  draft straight back; the old key cleared and not the new one; and what was
  typed WHILE the Pod was answering re-kept under the key this editor owns from
  here on, photos included.
- **the unmount flush** — the last window's typing kept, nothing written when no
  window was outstanding, and the flush reading `live.current` rather than the
  closure it mounted with.

---

# `use-photo-pipeline`

## what use-photo-pipeline is tested for

Seventeen cases. Two pure functions first, because `save()` and the draft both
spend them:

- **`photosFor`** — picking APPENDS and never replaces (an edit that rewrites
  the resource without the photos it arrived with destroys the binaries' only
  reference); a photo taken ONCE however many times it is picked, because the
  media path is content-addressed and a re-pick returns the same URL; and
  `sortOrder` seeded from **what the serialiser will write** rather than from
  `carried.length`. That last one is the case the obvious spelling gets wrong:
  `entry-model.ts` writes `photo.sortOrder ?? i + 1`, so one unnumbered carried
  photo is stored as `1` and `carried.length` is `1` too — a collision in the
  very case the fallback exists for.
- **`attachedOf`** — `ready` only, in pick order. It is the fence between a slot
  and a `Photo`, and it is what the component now spends in a one-line `useMemo`.

Then `attach`, which is worth testing as a sequence rather than as outcomes:

- **the order** — `decoding` → `uploading` → `ready`, and only then the two
  offers, asserted as one array so a reordering fails on the order rather than
  on a count. The coordinate goes in at FULL precision and as a string; the
  timestamp offer carries the slot `key` and the coordinate offer carries only
  the name, which is ruling T4-E's shape at the call site.
- **what it refuses** — a failed upload makes NO offer at all (a coordinate from
  a photo that is not on the entry has nothing on screen to explain it); a
  pipeline REJECTION becomes a `failed` slot rather than a slot decoding for
  ever; §9's gate shut refuses the coordinate and still offers the clock,
  because the two offers are independent; and a file with no GPS tag offers no
  coordinate rather than `String(undefined)`.
- **the worker** — nothing created until the first pick, ONE created however
  many files are picked, disposed on unmount, and an injected pipeline NEVER
  disposed. That last is the one with a cost attached: `dispose()` is not a
  cancel, so disposing a caller's instance breaks a photo it is still
  processing.

## the two unconditional `markTouched()` calls, verified rather than inherited

Task 6 made the arming in `offerCoordinate` and `offerTimestamp` unconditional
— they used to fire only when something actually filled — and argued that this
is unobservable because `move({ state: "ready" })` arms it one line earlier and
the pick's own `change` event armed it before that.

**Checked both ways on 2026-09-08, before the extraction.**

1. *Mechanism.* Both offers are called from `attach` and nowhere else, after
   `move({ …, state: "ready" })`, with no `await` between them — so `move`'s
   `if (next.state === "ready") markTouched()` has already run, in the same
   synchronous continuation, and no `settleDraft` can interleave.
2. *Measurement.* With both calls deleted, `npm test` is **1289 passed / 2 todo
   / 58 files** — identical to the run with them. No test observes them, which
   is what the docblocks already claimed.

They are kept because arming on a fill is the honest statement of what happened,
and because the mechanism that makes them redundant is one line in `move` that a
future edit could move. The redundancy is belt and braces, and it is now written
down as redundancy rather than as a load-bearing line.

---

# `use-entry-save`

## the save and the draft meet at the submit handler

`settle` is a PARAMETER of `save`, not an option of `useEntrySave`, and that is
a cycle broken rather than a style choice.

The draft's key follows `target`, which this hook owns, so `useEntryDraft` has
to be called after `useEntrySave`; and §10 step 1 completing is the one moment
the local copy stops being a backup and becomes a trap, so the save has to be
what settles it. Both edges cannot be hook arguments. The one that gives way is
the callback, because by the time the JSX is evaluated both hooks have run:

```tsx
onSubmit={() => void save(settleDraft)}
```

The alternative spellings were both worse. An `onSaved` option closing over a
`const` declared below it works — the arrow is only invoked later — and reads
like a temporal-dead-zone bug to everyone who meets it. Giving the draft hook
its own `scope` state would duplicate the entry URL in two places, and a
divergence between them is exactly the silent defect the `scope` docblock spends
twelve lines arguing against.

The parameter also makes the coupling testable: the hook's own suite passes a
spy and asserts that it is called with `(text, report.entryUrl)` when step 1
completed, and NOT called when step 1 itself failed.

## what use-entry-save is tested for

Twenty-two cases. The two pure functions first:

- **`preconditionFor`** — `{ create: true }`, `{ etag }`, and `null` for an
  existing resource whose server sent no ETag. There is no third option, and
  both wrong answers are silent.
- **`announce`** — SIX outcomes keyed on which STEP failed, never on `recovery`,
  which has four values and therefore collapses two pairs. The cases pin that
  the two `rebuildIndex` outcomes differ (readable versus listed) and that the
  two `retry` outcomes differ (nothing written versus everything written), and
  that a clean save says nothing about the public site — the wording trap that
  once let a hook which never read the revalidate body pass the test meant to
  catch it.

Then the hook, in three groups: what it refuses before sending anything (every
missing field named, and no ETag rather than a blind PUT); what it assembles
(the address from the container and the slug, ONE shared instant, `created`
invented only on a create and never given to an older entry, `datePublished`
only once published, the timestamp concatenated from the two controls, ruling
F-A's half-pair, the stored geometry carried through untouched, the photos
appended, the tags parsed, the creator carried); and what it remembers
afterwards (the settle, the target, the provenance that makes a second save an
update, and `saving` cleared in a `finally` even when `saveEntry` throws).

---

# what came back to `entry-editor.tsx`, and why it is still 195 lines

## the seventeen names came back together

Task 6 destructured `form.values` into seventeen consts "so that `save()`, the
draft text and the effects below read exactly as they did". All three of those
readers are now in hooks, and the only consumer left is the JSX, where each name
appears once or twice. Seventeen lines of re-binding for that is worse than
`values.slug` at the point of use, so the destructure is one line —
`const values = form.values` — and the field groups name where their values come
from.

It is also the change that took the component under its bound: 203 → 195, with
the 200 hard bound in `eslint.config.mjs` and `--max-warnings 0` on the lint
script. The exemption went out in the same commit, because at 195 it is an
UNUSED disable directive and ESLint fails the build for that.

## the offset option list is the form's own

`precisionOptions` went to `use-settings-gate` because two of its three sources
are the gate's. `offsetOptions` has exactly one source — `values.offset` — so it
belongs where that value lives, beside `sources`, which is the same shape of
derived read. Its whole docblock travelled with it, including the measurement
that gives the union its unconditional form: with the `add` deleted and an entry
stored at `+05:15`, the control showed `-12:00`, the FIRST option, because React
marks no option as selected when the value matches none and a single `<select>`
with nothing selected reports its first one.

## what the 195 are, and what they are not

Roughly 55 lines of composition — the props, the reducer, five hook calls,
`attached`, `text`, `restore` — and roughly 140 of JSX in one `return`.

**The plan's "~120 lines when the stage ends" was never reachable by moving
state**, and this is the number that says so: the four hooks took every
`useState`, every remaining `useRef`, every effect and every async function out
of the component, and the JSX alone is still 140 code lines. Task 5's own note
made the same discovery from the other side — the "~990 lines of JSX" in the
plan's summary was a RAW span, two thirds comment.

One block in there would qualify as a sixth presentational group by Task 5's own
argument: the **unsaved-draft banner**, about 32 code lines, which renders
`offered`, `savedAtText` and the two buttons and shares `HOLD_REASON_ID` with
the Save button exactly as `OCCURRED_SOURCE_ID` is shared in
`fields/when-fields/`. It is left where it is. Task 7's remit is four hooks, the
bound is met without it, and an extraction nobody asked for inside the commit
that removes the exemption is how a reviewable diff stops being reviewable.

## the file header's bearings, after four hooks

`entry-editor.tsx`'s own header docblock is 136 lines and still names, as
though they were in that file: `offerCoordinate`, `offerTimestamp`, `fuzzed()`,
`readPrivacySettings`, `saveEntry`, `coordinateAuthor`, `TimeAuthor`,
`COORDINATE_SOURCE_ID` and `OFFSET_GUESS_ID`. Every name resolves; not one of
the files does. The trail as of 2026-09-08:

| name | now in |
|---|---|
| `offerCoordinate` · `offerTimestamp` | `hooks/use-photo-pipeline.ts` |
| `fuzzed()` · `readPrivacySettings` | `hooks/use-settings-gate.ts` |
| `saveEntry`'s caller · `announce` | `hooks/use-entry-save.ts` |
| `coordinateAuthor` · `TimeAuthor` | `state/actions.ts` |
| `COORDINATE_SOURCE_ID` · `OFFSET_GUESS_ID` | `fields/where-fields/`, `fields/when-fields/` |

Recorded rather than repaired, on `field/notes.md#what-travelled-here-already-wrong`'s
precedent, and the header is one of the eleven blocks Stage C's comment sweep
owns. What it says about the DESIGN — the five ordering decisions, §9's
fail-closed posture, why a value that appeared without being typed has to name
where it came from — is all still true, and is the reason it was not shortened
here.

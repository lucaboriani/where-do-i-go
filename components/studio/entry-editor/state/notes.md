# state — notes

Twenty of the editor's twenty-seven `useState` values and three of its ten refs,
as one `useReducer`. The seven that stay are Task 7's. Spec §5 argues the shape;
this file records what the move had to decide.

## guard-inside-the-transition

**The first-writer-wins decision is a branch inside `applyPhotoTimestamp` and
`applyPhotoCoordinate`, and there is no way for a caller to make it.** That is
the whole property this directory was created to buy, and it is one line from
being lost.

`offerTimestamp` used to read `occurredAuthor.current` and `offsetAuthor.current`
synchronously, inside `attach`'s continuation — after a decode and two PUTs. The
picker is `multiple` and starts every file at once (`for (const file of picked)
void attach(file)`), so photo 2's continuation resumes as a microtask and React
batches updates across those. What made the refs correct is that photo 1 had
already assigned them before photo 2 read them, with **no re-render in between**.

A reducer keeps that only because React applies queued actions in order against
the accumulated state: photo 2's transition is handed the state photo 1's
transition returned, not the state either render closed over. So the equivalent
of the ref read is `state.occurredAuthor` **as the reducer receives it**.

The wrong spelling — the one this design exists to make unavailable — reads
`form.values.occurredAuthor` from the hook's return value, decides there, and
dispatches a plain set. Two photos in one pick then both see `nobody`, both
fill, and §11.5's instant that happened nowhere is republished by the commit
meant to make it harder. It is not catchable by inspection: every one-photo test
passes, and every two-photo test that awaits an `<img>` between the picks passes
too, because that await is a render boundary.

The three cases in `../entry-editor.autodate-edges.test.tsx` section 12m are what
catch it, and they are the only thing that does. They pick both files in one
`change` event and never await between them. Do not add an `await` to them, and
do not remove the pipeline wrapper that serialises the decodes.

## The cross-half guard is the same branch, one conjunct along

`(offsetTo.kind !== "photo" || offsetTo.key === key)` on the wall-clock branch,
and its mirror on the zone branch. Ruling T4-E, on the slot `key` and never on
the file name — two cameras both calling their first photo `IMG_0001.jpg` is the
ordinary case, and it walked straight back through the name-based spelling (F1).
`offerTimestamp`'s docblock in `entry-editor.tsx` argues both at length; the
pure tests in `apply-photo-offer.test.ts` are where they are now checkable in
milliseconds rather than through a jsdom render.

## What is derived, and what had to stay stored

`coordinateSource`, `occurredSource` and `offsetSource` are gone as state:
`sourceOf(author)` is `author.kind === "photo" ? author.name : null`, which is
exactly what the one writer assigned. That is what collapses each ref/state pair
into one value — and the pair was never a drift risk, because there was one
writer per pair and the file's own docblock says so.

`offsetGuess` could not follow them. It **latches**: `offsetTo.kind === "nobody"
&& (occurredTo.kind === "photo" || was)`, so a keystroke in the clock takes the
photo's name out of the sentence and leaves the warning standing (ruling T4-G).
A value that reads its own previous value is not a projection of the two
records, so it stays a field and `withTimeCredit` is the only thing that writes
it.

## Three deviations from the plan's action union, each measured

1. **No `coordinate-typed`.** `applyFieldEdit` credits the coordinate for a
   `lat` or a `long` edit, so a second action for the same keystroke would be a
   second writer of the same record — the thing this directory removes.
2. **`mode` and `status` are their own action kinds.** They are the two `Draft`
   fields whose values are not strings, and folding them into `{ field, value:
   string }` needs a cast at the one place the state's own types are checked.
3. **`slot-added` and `slot-settled`, not `slots`.** A wholesale
   `{ kind: "slots"; slots }` has to be built from the slots the *render* held,
   which is a read outside the transition of exactly the shape the section above
   forbids: two photos picked at once would each append to the same stale array
   and one would be lost. `applyRestore` still sets the list wholesale, because
   it is the one transition that replaces rather than appends.

## `actions.ts` holds the state as well as the actions

The plan's file table calls it "the action union". It also carries
`EntryFormState`, `CoordinateAuthor`, `TimeAuthor`, `PhotoSlot`, `sourceOf` and
`withTimeCredit` — the vocabulary all three `apply-*` files and the hook share.
Splitting the state type from the actions that transform it would have been two
files nobody imports separately.

## What stayed outside the reducer, and why

**The §9 fail-closed gate.** `offerCoordinate` still asks `coordinatesLive`
before it dispatches, because `gate` is Task 7's `use-settings-gate` state and
not the reducer's. Its own docblock's argument is unchanged and still literally
true: the gate is read from the render that started the pick, and a stale read
can only be `checking` where the truth is now `ready` — a refusal where a fill
was permissible, which is the direction §9 says to err in.

**`touched`, and the `filled` condition it lost.** The ref is Task 7's, so the
arming stays in `attach`'s continuation — but the caller can no longer know
whether a transition filled anything, so the two writes are now unconditional.
That is unobservable rather than merely cheap: `move({ state: "ready" })` runs
one line earlier and arms it, and the pick's own `change` event armed it before
that. Both docblocks already said the line was armed twice over by the time it
ran and that deleting it changed no test.

## Two bearings elsewhere that this move made stale

Recorded rather than repaired, on `field/notes.md`'s precedent.

1. `entry-editor.tsx`'s own file header ends "See `offerTimestamp`,
   `TimeAuthor` and `OFFSET_GUESS_ID`". `offerTimestamp` is still there;
   `TimeAuthor` is here and `OFFSET_GUESS_ID` went to `fields/when-fields/` in
   Task 5. Every name resolves, none of the files does.
2. `apply-photo-offer.ts`'s moved docblocks argue about `setOccurred`,
   `setOffset`, `setLat` and `setLong`, and about `PhotoSlot`'s docblock being
   "up where the slot type is declared" — which is now `actions.ts`, one file
   over rather than further down.

## `PhotoSlot` moved once more, and this is its last stop

Task 5 moved it to `fields/photo-fields/` because that group renders it. It is a
member of `EntryFormState`, so `state/actions.ts` would have had to import a
type from a presentational group; the dependency now runs the other way, which
is the direction every other value in this directory runs.

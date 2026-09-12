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

## Where the restore argument lives

`apply-restore.ts`'s file header said, until the Stage C comment sweep, that
"`restore()`'s docblocks in `../entry-editor.tsx` argue every line below and are
the normative reading of them". That was already one move out of date — the
prose came here with the transition in Task 6 — and the sweep moved it one hop
further, into the eight sections above. `entry-editor.tsx`'s `restore()` is now
a six-line dispatch, so the header points here instead.

## `PhotoSlot` moved once more, and this is its last stop

Task 5 moved it to `fields/photo-fields/` because that group renders it. It is a
member of `EntryFormState`, so `state/actions.ts` would have had to import a
type from a presentational group; the dependency now runs the other way, which
is the direction every other value in this directory runs.

---

# `actions.ts`

## what CoordinateAuthor decides, and what it does not

`CoordinateAuthor` is the record §11.3 turns on, and a different question from
`touchedCoordinate`. That flag (in `save()`) is `lat.trim() !== "" ||
long.trim() !== ""` and is HALF of what decides whether a coordinate is written
at all; the other half is pair-completeness — ruling F-A — which sits at the
composition beside it rather than inside it, because half a pair is not a point
and `Number("")` is `0`. An auto-filled coordinate should be written, so neither
of those must be given this record's meaning. This one decides whether auto-fill
MAY WRITE HERE, and the three answers are not reducible to two:

- **nobody** — nothing has supplied a coordinate: the boxes are empty, no photo
  has offered one, and the entry being edited, if there is one, has none either.
  Fill.
- **owner** — the owner typed, or accepted a restored draft that holds a
  coordinate, OR THE ENTRY ARRIVED WITH ONE. Never overwrite: a photo picked
  afterwards would silently replace a place they CHOSE with the place a camera
  happened to be, and §9 would then fuzz and publish it, so the only surface
  showing the substitution would be a public triple.
- **photo** — an earlier photo filled it. Never overwrite either, which is the
  direction §11.3 names explicitly: filling on every `ready` moves the entry to
  wherever the LAST picture was taken, a different place every time one is added
  on a day's walk, with the note updating politely as it goes.

**It is explicit rather than inferred from emptiness, in both directions** — and
the second direction was a live defect for a day (ruling T3-B) before it was
written down.

A box can be non-empty because the owner typed, because a photo filled it, or
because a draft was restored into it; the first two forbid a fill, and the value
alone tells none of them apart. **And a box can be empty and still forbid one**:
on an EDIT both boxes start empty by design —
`hooks/studio/notes.md#empty-coordinate-boxes-on-an-edit` — and `save()` reads empty
as "leave the stored coordinate alone". So on an edit emptiness does not mean
"there is no value"; it means "the value on the Pod stands", and filling it IS
an overwrite of something the owner has not touched, merely spelled as an offer.
The latitude's own hint promises exactly that: "Leave both boxes empty to keep
the coordinate this entry already has."

**What getting that wrong costs is published data, not a convenience.** The fill
flips `touchedCoordinate` to true, `fuzzed()` runs, and `placeFor` reads a `drop`
as a REMOVAL — so a photo taken inside the home region, which is the ordinary
case of attaching a picture from home to an entry you are correcting, takes the
entry's `#geo` off a world-readable resource and off the §7.4 index row the
public trip page renders its pin from. No message, no failed save, both boxes
exactly as they were. A photo taken elsewhere is the same shape one step less
destructive: the pin MOVES to wherever the picture was taken.

"Is it empty?" therefore cannot answer this question in either direction, which
is why the record is a value in its own right and is seeded from the entry
rather than from the form.

## two time records, not one

`TimeAuthor` asks `CoordinateAuthor`'s question — with its three answers and its
whole argument for asking it explicitly rather than reading it off an empty box
— twice.

**Two records, not one, and the symmetry with the coordinate is the trap**
(ruling T4-C). `coordinateAuthor` is deliberately one record for a pair, because
a latitude from the owner beside a longitude from a photo is a point that is
nowhere. A timestamp does not compose that way: a wall clock is "the time at the
place" and the offset is "the place's zone", so the owner correcting WHEN while
the photo supplies WHERE is coherent, and so is the reverse. Fusing them into
one flag would refuse a fill that is honest and buy nothing at all.

**Seeded from the entry, and that condition is ruling T4-B** — the defect
`coordinateAuthor` shipped with for a day (T3-B), on a field where it is worse
shaped. `occurred` and `offset` are NOT empty on an edit: both are seeded from
`existing.occurredAt`, so "nothing has been typed here" cannot mean "there is
nothing here". A record reading `nobody` on an edit lets a photo replace
`dy:occurredAt` — "when the moment happened", the single most load-bearing fact
on a travel diary entry — with the value it replaced visible on screen the whole
time. The coordinate's version of this at least hid behind an empty box.

**And it is not `initial === undefined ? nobody : owner`, which is the lazy
spelling the fix round measured**: it switches auto-date off for every edit ever
made, silently, while every refusal a test can make of these records still
passes. What separates the two is the ALLOW-CASE — an edit of an entry with no
`dy:occurredAt` at all (the field is `.optional()`), where there is nothing to
protect and the photo may still date it.

**`nobody` means one more thing on the offset than it does on the clock**, and
`offsetGuess` is what does something with it: the offset control always shows a
value, so an unauthored offset is not an absence — it is
`offsetHere(wallClockNow())`, this machine's guess, which is the state §11.5
says the owner must be able to see.

**And `photo` carries two things as of 2026-09-07** — ruling T4-E, and the
correction it needed the same day. A fill has to ask not only WHETHER the other
half is a photo's but WHOSE: photo A's clock beside photo B's zone is the one
composition in this task with no authority anywhere in it. T4-E asked that
question with the FILE NAME — and a file name is not an identity
(`#photoslot-is-a-state-machine-and-key-is-not-the-name`): the picker is
`multiple`, it deduplicates nothing, and two cameras both calling their first
photo `IMG_0001.jpg` walked back through the guard as one file. So the
comparison is on `key`, the per-editor slot identity `attach` mints and React
reconciles on, unique by construction; `name` stays for the NOTES, which are
§11.3's sentences and want the file the owner recognises. `CoordinateAuthor`
needs no `key` — it uses the name for display only and never compares it.

## PhotoSlot is a state machine, and key is not the name

One picked file, in the four states it passes through.

**A state machine rather than a `Photo | null` plus a flag**, because the owner
has to be able to tell three different waits apart from a failure — and because
only `ready` may be saved. Every slot the entry is allowed to reference carries
its `Photo`, so there is no branch anywhere in which a half-finished upload can
be serialised: the shape refuses it rather than a condition remembering to.

**`key` is not the file name.** Two files picked from two directories can share
one, and the same file can be picked twice while the first is still decoding; a
name-keyed list would then update the wrong row. React's reconciler needs a
stable identity here too, since a slot moves through three renders.

## withTimeCredit is the one writer

For the two records and all three surfaces — `creditCoordinate`'s deal, with
more to keep true: the mark reads BOTH records, so deriving it anywhere else
would be a second copy of the rule that says nothing when the two stop agreeing.

The two credits are the records, restated. `photo` means a file supplied this
half and is named for it (§11.3); `owner` and `nobody` both mean nothing on
screen may credit a photo for it.

The mark, in one line: the offset is a guess while NOBODY has supplied it and a
photo has supplied the clock beside it. Three halves, all load-bearing:

- `nobody` on the offset IS this machine's guess, so the mark is ruling T4-A's
  "the displayed offset is the machine's own" without interrogating the value.
  On an edit the entry's stored offset is seeded `owner`, so a photo that lacks
  the tag casts no doubt on it — badging confirmed data because a photo said
  nothing is §11.5's error with the sign flipped.
- `photo` on the wall clock is what makes this §11.5's composition rather than
  the ordinary default every create opens with. A photo that carried no time at
  all leaves the offset exactly as it was and has said nothing about it, so it
  marks nothing.
- `|| was` is ruling T4-G, and it is the whole of it. The clock's own `onChange`
  credits the owner, which used to clear the mark — so the owner nudging `07:05`
  to `07:06`, because they remember it was a minute later, left `07:06 +09:00`
  with §11.5's composition fully intact and the warning gone. A keystroke in the
  clock says nothing about who supplied the OFFSET, so the warning is still
  true; what it does say is that the note may no longer name the photo, and
  `occurredSource` handles that on its own line. Choosing an offset is what ends
  the mark, which is what scenario 3 says in words.

A caller that changes one record passes the other's current value, which is how
two independent records (T4-C) share one writer without becoming one flag.

---

# `apply-field-edit.ts`

## a keystroke in the clock takes the credit and leaves the warning

The keystroke is what makes the clock the owner's, and it is recorded in the
transition rather than in the form's own `onChange` for the reason the
coordinate boxes give: that handler catches every control on the form, and this
record is about this one. §11.3 in one line — from now on a photo may offer no
wall clock. And the offset's record passes through untouched (T4-C): the owner
correcting WHEN says nothing about the zone.

**Which is also why this keystroke takes the credit and leaves the warning** —
ruling T4-G, and the comment that used to be here was the argument against it.
It claimed a typed-over clock leaves "the default every create opens with, which
the permanent hint already covers". **That equivalence does not hold.** On a
create the owner types a clock from memory beside a guess they were never misled
about; here `07:05` nudged to `07:06` leaves the clock substantially the
photo's, and clearing the mark would leave §11.5's composition intact with the
warning gone. "The time came from a.jpg" is what a keystroke makes uncheckable;
"the offset is this machine's guess" is untouched by it and still true.
`withTimeCredit` keeps them apart.

The offset's own case is the mirror: the choice is what ends the guess (scenario
4), and it is one assignment rather than a second piece of state — the mark and
the note both follow this record, so "the owner has chosen" and "the note has
stopped being true" cannot come apart. The wall clock's record passes through
untouched (T4-C).

---

# `apply-photo-offer.ts`

## the coordinate offer writes the form, at full precision

§11.3, and it is an offer rather than an assignment: a photo may fill a
coordinate nobody has supplied, and may never take one away. What it writes is
the photo's own reading, at full precision, into the form — not a rounded one,
and not `place.geo`:

- **the form**, because that is the only route to the Pod that goes through §9.
  `fuzzed()` runs at save time over whatever the two boxes hold, so a photo's
  GPS is snapped or dropped exactly as a typed one is, and nothing downstream
  needs to know which it was. Putting `metadata.gps` on the `Entry` instead
  would publish the exact spot a picture was taken — no render-time mitigation
  behind it, and no second chance after the PUT.
- **at full precision**, because a value rounded on the way IN is a snap the
  owner did not choose, applied before the grid they did choose, and invisible
  afterwards: 45.5155 and 45.51 look equally deliberate in a number box.
  `String` rather than `toFixed`, so the digits the reader returned are the
  digits shown.

## the timestamp offer, and the two photos that composed nowhere

§11.5, and it is the same offer made twice: a photo may fill a half nobody has
supplied, and may never take one away.

**The wall clock goes in unshifted, which is what the field means.** §7.3:
`dy:occurredAt` "carries the local UTC offset of the place", so the value is the
time it was THERE and `toOffsetDateTime` copies it rather than recomputing it.
Routing the photo's `07:05` through a `Date` would rewrite five past seven in
Tokyo as whatever o'clock it is here, and for any photo taken on the far side of
this machine's midnight it would move the DATE, not merely the hour.

**To the minute, through `wallClockOf`**, which is the one spelling of "a
timestamp, as this control shows it". Keeping the photo's `:33` is legal end to
end — `LOCAL_DATETIME` accepts optional seconds and passes them through — but a
`datetime-local` with no `step` neither displays nor edits seconds, so they
would be a third of a minute the owner cannot see and the first keystroke would
silently drop. `toOffsetDateTime` supplies the `:00` §6 wants, exactly as it
does for a hand-typed clock.

**No §9 gate here, and that is a decision rather than an omission.**
`offerCoordinate` asks `coordinatesLive` because the fail-closed posture is
about publishing a POINT; an offset is not a coordinate and neither is a wall
clock. The offset control is deliberately not tied to that gate either, because
an owner whose privacy settings cannot be read still gets to say what time of
day it was.

**And a half may only join the other half it belongs with** — ruling T4-E, and
the guard that closes the one reachable data defect this task shipped.
`offerCoordinate` needs no analogue: a photo either carries both GPS tags or
neither (`lib/media/exif.ts` sets `gps` only when both are present), so
`coordinateAuthor` is one record for a pair and a mixed coordinate cannot be
composed from two photos at all. The timestamp's two halves arrive
independently, and any day's walk produces the sequence:

1. `tokyo.jpg` — a clock and no zone. The clock fills, the offset is left as
   this machine's guess, and the mark and the note go on.
2. `chathams.jpg` — a phone that writes both. Its clock is refused, correctly,
   because the first photo already supplied one.
3. Its ZONE was then accepted, because the offset was still `nobody`'s — which
   composed Tokyo's `07:05` with the Chathams' `+12:45`, an instant that
   happened at NEITHER place, and cleared the mark in the same motion, because
   the mark reads "a photo dated it and nobody offset it". §11.5's stated
   failure, reached by two photos, with the warning removed by the act of
   composing it.

**T4-C is not what permitted that, and stands.** It says the wall clock and the
offset are independent because the owner correcting WHEN beside a photo
supplying WHERE is coherent — one side is a competent authority who can see both
halves and fix either. Photo A's clock beside photo B's zone has no authority
anywhere in it: it is T3-A's "value that is nowhere", and neither the value nor
any warning about it survives. So each branch asks WHOSE the other half is, not
merely whether it is spoken for, and `{ kind: "photo" }` carrying the slot's
`key` is what makes that askable.

**`key`, and not the file name, which is how T4-E's own guard degenerated for a
day (F1).** It compared `file.name`, and a name is not an identity
(`#photoslot-is-a-state-machine-and-key-is-not-the-name`): the picker is
`multiple` and deduplicates nothing. Two cameras both calling their first photo
`IMG_0001.jpg` is the ordinary case, not a contrived one, and it walked the
sequence above straight back through the guard: A's clock in, B's clock refused,
B's ZONE accepted because `"IMG_0001.jpg" === "IMG_0001.jpg"`, and the mark
cleared in the same motion. The guard passed both of its tests and failed on the
pair of names any two cameras produce. `key` is minted per slot in `attach` and
cannot collide, which makes the comparison ask the question the ruling meant.

**Both branches, or neither.** Guarding only the zone leaves the mirror — a
zone-only photo, then a clock-only one — exactly as it was, and the order the
owner picks two photos in is an accident. The same-`key` comparison is what
keeps ONE photo supplying both halves legal: by the zone branch the clock's
record already names the slot being offered, and the wall branch sees an offset
no photo has touched yet.

**Both tags are optional and neither guard is decoration.** `readMetadata`
returns `{}` for a file it cannot read at all — a scan, a screenshot, a camera
whose clock was never set, which it rejects by sentinel — and that is the case
this meets most often. The obvious
`setOccurred(String(metadata.dateTimeOriginal))` writes the nine characters
`undefined` into the state; a `datetime-local` reads that back as empty, so the
box CANNOT show the defect and the autosaved draft is the only surface that can.

## shape-valid is not in range, twice

The offset half EXIF usually has nothing to say about (§11.5), and when it does
say something it is already `+09:00`-shaped: `lib/media/exif.ts` reads tag
0x9011 and validates it against `/^[+-]\d{2}:\d{2}$/`, so what arrives is an
offset or nothing. It goes in AS READ — never through `offsetHere` or a `Date`,
either of which answers with this machine's zone — and `offsetOptions` unions
whatever the control holds into the list, so an offset the list does not carry
renders instead of the select silently showing its first option.

**Shape-valid is not in range, and `+99:99` is what that costs (F4).** That
regex is the WHOLE of `exif.ts`'s validation, so a camera — or this project's
own fixture builder — can put 6 039 minutes east of Greenwich into the control,
`offsetOptions` unions it into the select beside thirty real zones, and
`toOffsetDateTime` concatenates it onto the wall clock the same photo supplied.
It then fails CLOSED, which is the good half: `serialiseEntry`'s
`Entry.safeParse` refuses the timestamp and nothing reaches the Pod. The defect
is the advice the owner is then given — `announce`'s "The entry did not reach
your Pod … try again", which is false on the first retry and on every one after
it, with nothing on the form pointing at a select quietly showing `+99:99`. So
the range is checked on the way IN, and not in `OFFSET_SHAPE`: that fence is
deliberately wider, because an entry some other tool wrote may carry `+05:15`
and this editor's job is to show such a value and put it back unchanged (§1c).
What may not happen is ACCEPTING one from a photo. 840 minutes is `+14:00`, the
eastern end of `OFFSETS` and of the world.

**The total-minutes fence misses a second way to be shape-valid and impossible,
and `+05:61` is what that costs** (closing item 4, still F4). `exif.ts`'s regex
accepts any two digits in the minutes pair, so `61` is shape-valid, and
`offsetMinutes` composes it as `5 * 60 + 61 = 361` — comfortably inside ±840,
the same fence that stops `+99:99`. Nothing between there and the Pod catches it
except `Entry.safeParse`'s `z.iso.datetime({ offset: true })`, at the very end
of the chain, after Save — so `+05:61` fills the control, gets unioned into the
select, and reproduces the exact "did not reach your Pod … try again" on every
retry that the paragraph above exists to prevent. So the minutes digits are
range-checked separately, rather than by widening the total-minutes fence to
catch them incidentally — `Number(zone.slice(4, 6)) < 60` reads the same two
characters `offsetMinutes` does, checked on their own before they are composed
into it.

**This is the same loose/strict split as `+99:99`'s, one field over, and
`OFFSET_SHAPE` stays as wide as it was**: loose for what this editor DISPLAYS —
a stored `+05:15`, or for that matter a stored `+05:61` some other tool once
wrote, must still render and round-trip unchanged (§1c) — strict for what it
ACCEPTS FROM A PHOTO, which is those two conjuncts and only those two.
Tightening `OFFSET_SHAPE` instead would refuse to RENDER a value this editor is
only obliged to show.

---

# `apply-restore.ts`

## restored photos come back already uploaded

Which is the whole reason the pick is the upload: these are URLs on the Pod, so
a draft restored in a new tab a day later still has its pictures. `readDraft`
has already put every one of them through `Photo`, so a devtools-mangled photo
was refused with the rest of the payload rather than restored into a form that
would save it.

**A draft written before this control existed restores an empty list**, and that
is exactly right rather than a half-restore: no payload under the current key
can carry photos, because there was no way to attach one. It is why the key
stayed at `v2` — see `lib/studio/drafts.ts`.

## the offset goes back only if the draft has one to give

And `""` is not one. This is the load-bearing half of `Draft.offset` being
`.default("")`.

**`""` arrives from two places and means the same thing in both**: a payload
written before this control existed (the schema's default fills the absent key),
and one somebody emptied by hand. Neither is an instruction, because there is no
"remove the offset" — §3 and §6 require `dy:occurredAt` to carry one — so both
mean "this draft has nothing to say about the offset".

**Writing `""` through is the failure**, and it is a blank control under a banner
that has just said the draft came back — measured, by making the line
unconditional and running section 8j: `shownValue` read `""`. The save after it
composes a timestamp out of a wall clock and nothing, which §3 and §6 refuse on
the next read.

**The fall-through is the control's current value**, which is `?? placeName`'s
reasoning rather than `presetPrecision`'s, and the choice matters:

- "leave the control showing what it is showing" is the honest reading of a
  draft with no opinion, and on an untouched form that value IS
  `offsetOf(existing?.occurredAt) ?? offsetHere(…)` — the entry's own offset on
  an edit, this machine's on a create — because that is what the state was
  initialised with;
- re-deriving the chain here would be a SECOND copy of it, two things that have
  to agree and say nothing when they stop, and it would discard an offset the
  owner had corrected before clicking Restore. Overwriting an explicit choice
  with a re-derived guess is the exact class of bug this control was added to
  remove.

`presetPrecision` is not the model here because the precision case is about a
value that is UNUSABLE — what the control shows has to be what
`fuzzForPublication` is given (§9 step 3) — whereas this is a value that is
ABSENT, which is the place fields' case.

**The shape, not the list, is the test.** `+05:15` is not one of the offsets
`OFFSETS` offers and must still be restored; `banana` from a hand-edited payload
must not — not because it would reach `dy:occurredAt` (it would reach the
composer and fail the save: `serialiseEntry` re-validates with
`Entry.safeParse`, so a shape-invalid offset is refused there, not written to
the Pod), but because showing it in the control would be indistinguishable from
an offset this editor actually offers. One expression covers `""` and that,
which is what collapsing absent into `""` bought.

## a restored coordinate is the owners

And therefore not a coordinate a photo may replace.

`restore()` writes these boxes without a DOM event, so it comes through neither
`onChange`, and without the credit the record would still read `nobody` over a
form that visibly holds a pair. Attach a photo and it takes the boxes: the exact
overwrite §11.3 forbids, reached by the one path that does not look like typing.

**Credited to the owner, although the draft cannot say whether they typed it or
a photo filled it** — because both answers are refusals and the third is not
available. `Draft` keeps `lat`/`long` as text and nothing about where they came
from, and adding a provenance field to the payload would be a schema change to
store something no reader needs: what the record has to answer is "may auto-fill
write here", and for a restored pair that is no either way.

**An empty draft is not a restored coordinate.** `""`/`""` is a draft with no
coordinate in it — the common case, since most entries have none — and marking
that as the owner's would make Restore silently switch auto-fill off for the
rest of the session.

## the trip and the slug are the address, not text

On an edit. §11 guardrail 7 makes `dy:slug` the filename, both controls are
disabled for that reason, and a restore that wrote through them would put the
form's idea of the address out of step with the resource it is about to PUT.

The `tripIri` line mirrors the initial state: a trip that is no longer on offer
leaves the picker unchosen rather than setting a value the control cannot show.

## the coordinate goes back as it was typed

Which is what was kept — see the note on `Draft.lat` in `lib/studio/drafts.ts`.
It is put through the fuzz on the save that follows, exactly as if it had just
been typed: a value that reached the Pod by way of `localStorage` without
passing the boundary would be the same leak by a longer route.

## a precision the select cannot show is refused

What the control shows has to be what is applied (§9 step 3), so such a
precision is refused rather than restored. Two ways to get one: a draft kept
while the settings were unreadable, which holds `""`, and a draft from a build
whose option list has moved on. Restoring either would leave the number the
owner can see and the number `fuzzForPublication` is given disagreeing, which is
the shape §9 calls a lie in whichever direction is worse.

## the place text goes back verbatim, except where absent

And that exception is the whole of it.

`""` and absent are **different instructions** here, which is why
`lib/studio/drafts.ts` makes these three `.optional()` rather than giving them a
default. An empty string is a box the owner emptied, and in `placeTextOf` that
is REMOVE; an absent field is a `v2` payload written before these controls
existed, which has no opinion about the place because there was no control to
form one with.

**Writing `undefined` through as `""` is a silent deletion from the Pod.**
Restore such a draft onto an entry that already has a name and the boxes go
empty, and the next save removes `schema:name` and the whole `<#address>` — the
half-restore the version segment exists to prevent, arrived at by the operator
chosen to avoid a version bump. `?? placeName` is therefore "leave the control
showing whatever it is showing", which on an edit is the stored value.

**It is also what keeps the place text's seeding argument true.**
`hooks/studio/notes.md#why-the-place-text-is-prefilled` says these controls need no
`touchedPlaceText` flag because they are seeded from the entry — and a restore
is the one moment that stops being true, since it writes the controls from
something other than the entry. Leaving an absent field alone is what closes
that gap.

## a restored timestamp is not one a photo may replace

The coordinate's credit, for its reason: `restore()` writes these controls
without a DOM event, so it comes through neither `onChange`, and without this
the records would still read `nobody` over a form that visibly holds a date.
Attach a photo and it takes both halves: the overwrite §11.3 forbids, reached by
the one path that does not look like typing.

**Each record mirrors its own setter**, which is why the two lines are not
spelled alike. The clock is written unconditionally, so the record has to say
whatever the payload said — and `""` is a draft with no date in it, the common
case, which leaves the clock open rather than switching auto-date off for the
rest of the session. The offset is written only when the payload's offset has
the shape, so when it has nothing to say the control keeps its value and the
record keeps its author.

**A restored offset is the owner's although the payload cannot say whether they
chose it or this machine guessed it** — `Draft` keeps no provenance — and the
cost is recorded rather than hidden: a draft whose offset was an unconfirmed
guess comes back WITHOUT the mark. The other way round is worse in the direction
§11.3 cares about, a photo silently replacing an offset the owner chose,
corrected, and accepted back off the banner.

**And within a session that clearing is a no-op**, which is the fact that
settles it rather than merely excusing it (contributed by the review,
2026-09-07). The draft read is one-shot, so the banner exists only from mount;
while it is up the whole form sits inside `<fieldset disabled={offered !==
null}>`, which includes the photo picker — so no photo can have been attached
yet, `offsetGuess` is ALWAYS `false` when this runs, and there is no mark here
to lose. The loss is strictly cross-session, and cross-session no code change
can recover it: after a reload the editor cannot know the restored clock came
from a photo. A `Draft` provenance field is not one option among several, it is
the only one, and `lib/studio/drafts.ts` treats every field addition as a
deliberate versioning decision.

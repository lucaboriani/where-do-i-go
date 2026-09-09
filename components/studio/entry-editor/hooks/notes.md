# hooks — notes

`use-entry-form.ts` is the first of the five, and the only one Task 6 wrote: it
owns the `useReducer` and hands the field groups values and callbacks. The other
four — save, draft, settings gate, photo pipeline — are Task 7's.

## the five seedings that are not obvious

`initialEntryFormState` is where every one of them now lives, and each is a
defect this project has already shipped or nearly shipped. Each is summarised
here and argued in full in the six sections after this one:

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

## the offset seeding is the old chain

§7.3: `dy:occurredAt` "carries the local UTC offset of the place", because
normalising to UTC destroys the fact that it was evening. Until this state
existed the offset was computed at save time as
`offsetOf(existing?.occurredAt) ?? offsetHere(wall)` — the entry's own, else
**the editing machine's** — so writing up a Japan trip from the sofa at home
stamped an evening in Tokyo `+02:00`, silently, and no control on the form could
correct it. The initial value is that same chain, unchanged: the behaviour has
not moved, the guess has become visible and correctable, and an edit that never
opens the control writes the timestamp back exactly as stored.

`wallClockNow()` rather than `occurred`, and the two are not interchangeable.
`occurred` is `""` on a create and `offsetHere("")` is `+00:00`, not this
machine's zone. The control has a value at MOUNT, when there may be no date on
the form at all, so the honest wall clock to ask about is the current instant.

One consequence, on the record: in a zone with DST a create defaults to today's
offset rather than the one in force on the date the owner then types. The old
code asked about the entry's own wall clock and so got that right by accident,
in the one case where its answer was defensible at all. A fair trade, because
the value is now on screen and one click from correct, where before it was
neither.

## empty coordinate boxes on an edit

`lat` and `long` open empty even for an entry that already has a pin.
Prefilling from `existing.place.geo` is the obvious spelling and is the bug:
what is stored there is the **published** pair, already snapped, and not
necessarily on the grid the settings name today. Putting it in the box makes it
indistinguishable from something the owner typed, so every save re-snaps it and
the pin walks. Measured on the §7.3 fixture — `snapToPrecision(35.6938,
139.7034, 500)` is 35.69423/139.70348, half a cell from where it started.

Empty therefore means "leave the coordinate alone", which is the same treatment
`created` and `datePublished` get and is said on the control's own hint. Typing
means "replace it", and typing something inside the home region means "remove
it" — see `save()`.

## why the place text is prefilled

`placeName`, `locality` and `country` are seeded from the entry, the opposite
answer to the coordinate's above, and the asymmetry is the whole of the
"untouched versus removed" logic for text.

A name has no transformation applied to it: what is on the Pod is exactly what
was typed, so showing it costs nothing and buys the two things the coordinate
has to buy with a separate `touchedCoordinate` flag. A box the owner never opens
still holds the stored value, so saving writes it back unchanged — untouched. A
box the owner **empties** holds `""`, which `save()` turns into `undefined` and
`placeFor` turns into a removal. Prefilling is therefore not a convenience here;
it is what makes the two instructions distinguishable at all. An editor that
left these empty on an edit would delete the place name of every entry whose
headline was corrected — silently, and only discoverable by reading the Pod.

"Seeded from the entry" stops being true at exactly one moment: `restore()`,
which writes these controls from a stored draft rather than from the entry. That
is where the missing flag would otherwise have been needed, and it is handled
there instead — a draft field that is ABSENT leaves the control alone, and only
an explicitly empty one empties it.

## slots is not seeded from the entry

`slots` holds the photos picked in this editor, and not the ones the entry
arrived with. Seeding it from `existing.photos` is the obvious spelling and is
wrong twice over: it would renumber their `sortOrder` from the list position on
every save, walking §7.3 data nobody touched — the coordinate's defect, spelled
for photos — and each seeded row would render a settled `role="status"` at
mount, so the editor would announce, to a screen reader, news about photos that
have not changed. What the entry arrived with is carried at save time instead,
by `photosFor`.

## the coordinate author, and ruling T3-B

`coordinateAuthor` records **who supplied the coordinate**; `CoordinateAuthor`
itself says what the three answers mean and why "is the box empty?" is not one
of them.

It is read at the moment of the fill rather than from a closure. A fill happens
in `attach`'s continuation, after two awaits — the decode and two PUTs — and the
handler that started it closed over the render BEFORE the pick, so a closure
would answer "who supplied the coordinate?" as of a moment that can be several
seconds old. The two things that can happen inside that window are exactly the
two this record exists to refuse: the owner typing while the photo uploads, and
a second photo settling. Reading a value written synchronously means the first
writer wins even when the two writers overlap.

**Seeded from the entry, and that condition is the whole of ruling T3-B.**
`nobody` unconditionally is the spelling this shipped with for a day, and it let
a photo move — or, from inside the home region, DELETE — a pin an edit was
loaded with. `CoordinateAuthor` has the mechanism; the short version is that on
an edit an empty box means "the stored pair stands", so there is a value to
protect even though the form holds none.

It is `existing?.place?.geo`, not `lat`/`long`, and not unconditional. Both
boxes are `""` on an edit by design, so seeding from them is the same defect
spelled differently. And an unconditional `{ kind: "owner" }` would switch
auto-fill off for EVERY edit, silently — including an entry that has no pin to
protect, which is the case with nothing to lose and the one place the fill is
still wanted on an edit. Every refusal a test can make of this record passes
under that lazy spelling; what catches it is the allow-case, an edit of an entry
with no geometry where the photo must still fill.

One paragraph that travelled with this record is kept for the record and is
false: "DECLARED HERE, ABOVE `attach`", arguing that
`react-hooks/immutability` refuses a `.current` write inside a function closing
over a `useRef` declared below it and reports the pre-existing writes rather
than the new declaration when you get it wrong. The rule is real and still
holds for `touched` and `nextSlotKey`; the ref it is about is gone. See the
bearings section below.

## the two time authors

`occurredAuthor` and `offsetAuthor` record who supplied the wall clock and who
supplied the offset. `TimeAuthor` says why they are two records rather than one,
and why they are seeded from the entry rather than from the boxes.

Both are read at the moment of the fill, for
`#the-coordinate-author-and-ruling-t3-b`'s reason: a fill happens in `attach`'s
continuation, after the decode and two PUTs, so a closure would answer "who
supplied this?" as of a moment that can be several seconds old — and the two
things that happen inside that window are exactly the two these records exist to
refuse, the owner typing while the photo uploads and a second photo settling.

The same stale "DECLARED HERE, ABOVE `attach`" paragraph travelled with these
two, arguing from the same `react-hooks/immutability` rule about a `useRef`
declared below its writer. Kept for the record; the ref is gone.

## offsetGuess is a record, not a comparison

Is the offset this machine's guess, standing beside a clock a photo supplied?
§11.5's state, and the one the owner must be able to see.

A boolean and not a name, as of ruling T4-G. It held the photo's name until
2026-09-07, which fused two facts with two lifetimes into one value: the name is
only checkable while the photo's clock is still in the box, and the warning is
true for as long as nobody has answered the offset. The name now comes from
`occurredSource` — so a keystroke in the clock takes the name out of the
sentence and leaves the warning standing.

It is a record, not a comparison, and that is not a detail: marking the offset
whenever it equals `offsetHere(wallClockNow())` would tell an owner who
deliberately chose the zone they are sitting in — for most entries the right
answer — that their own choice is a guess.

## Two bearings the move made stale, recorded rather than repaired

The precedent is `field/notes.md#what-travelled-here-already-wrong`: prose
rewritten inside an extraction commit is what makes the extraction
unreviewable.

1. `coordinateAuthor`'s note and the two time authors' both carry a
   paragraph beginning "DECLARED HERE, ABOVE `attach`", which argues that
   `react-hooks/immutability` refuses a `.current` write inside a function
   closing over a `useRef` declared below it. **There is no ref any more** —
   the three are fields of `EntryFormState` — so the paragraph argues about a
   mechanism that no longer exists. `touched` and `nextSlotKey` are still refs
   and their version of it still holds.
2. The same notes say "A REF, AND READ AT THE MOMENT OF THE FILL RATHER
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
2. The read effect's own note says "components/studio/studio-shell/studio-shell.tsx
   uses for `enumerateTrips`", which is still true, and "`restoreSession`'s for
   the same reason", which is still true. Left as found.

## the three states the controls distinguish

`SettingsGate` is what the §7.6 read left behind. `checking` and `closed` both
hold the controls, and they are separate anyway: one is a wait and the other is
an answer, and telling the owner "your privacy settings could not be read" while
the request is still in flight is a lie that resolves itself.

## the note has to be said out loud

§9: "an entry silently losing its map pin becomes a bug report, whereas 'you
have not set a home region yet' is a one-time setup step with an obvious fix."

`NO_SETTINGS_NOTE` covers the common case rather than the rare one.
`initialiseContainers()` creates `/travel/settings/` and deliberately writes no
document into it, so every fresh deployment reads a 404 here until the owner
sets a home region.

`CHECKING_NOTE` deliberately shares no vocabulary with it — the same rule as the
clean-save message: while the answer is still outstanding the owner must not be
told what it is.

## the read is memoised on the url, and never ambient

**On mount, not at save time**, and that is the fail-closed posture rather than
an optimisation. §9 makes every coordinate write conditional on this document,
so a form that took the input and refused it afterwards would have accepted a
coordinate it was never going to publish and said nothing until the owner
pressed Save. The controls are dead or live according to the answer, which means
the answer has to arrive first.

**Memoised on the URL, which is what makes it one read.** The App Router runs
the studio under StrictMode in development, so the effect is invoked twice; a
`live` flag alone would cancel the first invocation's promise and a ref that
merely said "already started" would leave the second with nothing to await, so
nothing would ever be set. Holding the PROMISE — the shape
`components/studio/studio-shell/studio-shell.tsx` uses for `enumerateTrips`, and
`restoreSession`'s for the same reason — makes both invocations await the same
request.

**`session.fetch`, never the ambient one.** §7.6 is owner-only: anonymously this
is a 401, and on ESS a 401 does not even distinguish private from missing.
Either way it lands in the `closed` branch, which is the right answer to both.

## one fact is not the other: unreadable versus no home

§7.6 and §9. A `Result` that is not ok is "the settings could not be read" and
closes the controls; settings that ARE ok but carry no `home` are "I have no
home to protect", which is a legitimate configuration where every coordinate is
still snapped and none is ever dropped. Collapsing the second into the first
strips the pin from every entry of everyone who never set a home region,
silently and for ever, and `fuzzForPublication` cannot catch it because it never
gets asked.

## the settings value joins the option list

`precisionOptions` offers the fixed grids, the owner's own default from §7.6, and
whatever the form is currently holding.

**The settings value joins the list; it is not mapped onto it.** §7.6's own
fixture is 500 m, which is none of the fixed grids, and rounding it either way is
wrong in a way the wire cannot show: coarser publishes a pin further from the
truth than the owner asked for while `dy:precisionMeters` reports the distance as
deliberate, and finer is simply a leak. `Set` because a default that happens to
equal a fixed grid must not appear twice.

The current value is in there too, so a draft restored from a build with a
different list still shows the number it is about to publish at. What the control
shows and what `fuzzForPublication` is given have to be the same number (§9 step
3).

## what fuzzed delegates, and the two guards in front of it

`fuzzed` answers what may be published for a coordinate the owner typed, or
`undefined` when nothing may be. §9 steps 1–3, and the whole of the decision is
delegated: it chooses no distance, checks no radius and rounds nothing.

**The two guards in front of `fuzzForPublication` are not redundant with it.**
It is total and fails closed on settings that do not parse, but it cannot see a
gate that never opened — `checking` and `closed` have no settings to hand it at
all — and it treats an unusable explicit precision as a drop rather than falling
back to the default, which is the same answer these reach more directly. Both
are fail-closed, so the worst either can do is publish nothing.

**Back to numbers, which `lib/pod/fuzz.ts` deliberately avoided returning.** Its
strings exist so that a naive float snap cannot publish `35.010000000000005`; the
values coming back have already been through `toFixed`, and `Number` → `String`
round-trips a short decimal to the same digits, which is what `decimalLexical`
will spend on it. `GeoPoint` is typed in numbers and both serialisers read it, so
this is where the two meet.

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
derivation, and the argument for it is the rest of this section.

That argument is worth repeating because the comment used to say the opposite.
It claimed keying on `target` "would clear a key nothing was ever stored under
and leave the real draft behind", which on an EDIT is false: `target.url` starts
life as `documentUrlOf(initial.entry.iri)`, the expression the line used to be.
The one place the two derivations differ is the one that mattered — after a
successful CREATE, `target` moves and the scope has to move with it, or
everything typed afterwards is autosaved under the create key while carrying the
created entry's slug, and tomorrow's fresh create form offers it back for a
`If-None-Match: *` against a URL that now exists. The owner is then told the
entry "changed elsewhere, or in another tab", which is not what happened and is
not something they can act on.

What the old comment was right about is that the SAVE must clear the key it had
been WRITING under rather than the one it is moving to. That is `settleDraft`'s
job — `#what-settledraft-gets-right`.

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

## the debounce is exported on purpose

`DRAFT_DEBOUNCE_MS` is how long after the last change the editor waits before
keeping a local copy. **A debounce, not an interval**: each change restarts the
window, so a minute of typing is one write rather than seventy.

It is exported because the studio is what ships this number, and a value that
lives only inside the closure is one nobody can change on purpose. The editor's
own suite drives the window and pins it against this export, so the two cannot
drift.

## photos compare by contentUrl, text compares field by field

`samePhotos` compares two photo lists **by `contentUrl` rather than by value**,
and the difference is not laziness. The URL is content-addressed —
`travel/media/<sha256(source)[0..16]>/` — so two entries with the same URL are
the same bytes, and nothing else about a photo can change without the owner
picking a different file. Order matters because `sortOrder` is the position, so
a reordering is a change.

`sameText` asks whether the sixteen fields moved between two snapshots, field by
field rather than by `JSON.stringify`, which would answer "different" for the
same sixteen values in a different key order. A false "different" is not
cosmetic: it is a local copy written back for text the Pod already holds, which
is exactly the resurrected draft the clear after a save exists to prevent.

Every field is in there for the same reason — they are what the form holds — and
four of them have a named cost if dropped:

- the three **coordinate** fields: a form whose only change was the latitude
  would be called "unchanged", dropping the one field on this screen nobody can
  retype from memory a day later;
- the three **place** fields, where the loss is the one §9 leans on — near home
  the coordinate is dropped and the NAME is all the entry has left to say where
  it was;
- the **photos**, where the consequence is worse than retyping: a photo attached
  while the Pod was answering is bytes already uploaded and about to be
  referenced by nothing at all;
- the **offset**, which is half of the timestamp: an offset corrected while the
  Pod was answering, dropped from this comparison, would leave the local copy
  holding the guess the owner had just replaced.

## storage access itself can throw

`browserStorage` wraps the *property read*, not a call. Some embedded browsers
and some third-party-storage settings raise a `SecurityError` on `localStorage`
before any method is reached, and an editor that fell over on that would be an
editor the owner cannot open at all. `null` simply means no local copy is kept;
nothing else about the form changes.

## what the touched ref guards

Has anybody actually typed? A ref, not state: it changes nothing on screen and
re-rendering for it would be noise.

The autosave effect is keyed on the form values, so it fires once on mount — and
without this guard the editor would store a copy of whatever it opened with.
Opening an entry to read it and navigating away would then leave an "Unsaved
draft" banner waiting next time, offering to restore exactly what is already on
the Pod; once that banner appears for entries nobody edited it stops meaning
anything and gets clicked away by reflex.

Its own docblock's "DECLARED HERE, ABOVE `attach`" paragraph is recorded, and
stale, at `#the-touched-ref-moved-into-the-hook-that-reads-it`. The measurement
behind it is worth keeping whatever the layout is: with the declaration left in
the draft section, `npm run lint` reported two errors and **neither was on the
new line** — it flagged the pre-existing `.current` writes in `settleDraft` and
in the form's `onChange`, both clean for the life of the file. Moving one line
up made all three legal again.

## one look per editor

`draftRead` is what makes the read one. The offer effect is a snapshot, not a
subscription: it asks storage what was left behind, offers it, and never asks
again. Without the ref the effect would run again whenever its dependencies
changed identity — a caller that builds `storage={{ getItem… }}` inline gets a
fresh object on every render — and each run would re-offer a banner the owner
had just discarded, which from the owner's side is a dismissal that does not
work. It is also what keeps the read out of StrictMode's second invocation.

## the live ref is refreshed after every render

`live` holds the form as it is right now, for the two paths that have to read it
from **outside** a render: the unmount flush, and the save's check for text
typed while the Pod was answering. Both run after later renders have happened,
and a closure made during a render holds that render's values for ever — which
is precisely the bug in each case: "flush whatever was on the form when the
editor mounted", and "assume the form still equals what was sent".

Refreshed in an effect with **no dependency array**, which is how "after every
render" is spelled. Writing to a ref during the render itself is the thing that
is not allowed; writing to one in an effect is ordinary.

## the draft read is a one-shot, not a subscription

On mount, in an effect, never during render: storage is a browser thing and
reading it while rendering would make the component's output depend on something
React cannot see. `readDraft` answers `null` for everything unusable rather than
throwing, so a value truncated by a tab killed mid-write cannot stop the editor
from opening.

That is also why this is not `useSyncExternalStore`, the shape
`react-hooks/set-state-in-effect` points at for external data. Its
`getSnapshot` is re-read on every render, so the banner would reappear the
instant the autosave wrote, offering to restore the very text the owner is in
the middle of typing. What is wanted is the draft **as it was when the editor
opened**, held until the owner answers it, and that is state.

## what goes into the autosave, and what is left out

Keyed on the form values, so every change restarts the window and the typing
coalesces into one write.

What goes in is the seventeen fields of `Draft` and nothing else — the sixteen
the form holds, plus the `savedAt` stamp. The ETag, the `dcterms:created` and
the `schema:datePublished` the component is holding right now are deliberately
absent: they come from the read that produced this state (§10), a draft outlives
that read by however long the browser was closed, and `lib/studio/drafts.ts`
strips them even if they are handed in.

## a refused write keeps trying

Deliberate rather than an oversight. A quota condition can clear — a tab closed,
a cache evicted — and switching the backup off for the rest of the session
because one write failed is worse than a cheap throw every 800 ms. The note
appears once and stays; the attempts continue. `settleDraft`'s refusal is the
same reasoning.

## the timer is cleared and the ref is not

The autosave's cleanup calls `clearTimeout` and leaves `pendingWrite.current`
alone, and that asymmetry is what the unmount flush reads.

React runs the cleanup on every dependency change — every keystroke — and the
body re-arms immediately afterwards, so a stale handle in the ref lives for the
width of one re-render and is then overwritten. On an **unmount** the body does
not re-run, and a ref that is still non-null means exactly one thing: a window
was scheduled and never fired. Nulling it in the cleanup would erase that
distinction, and the flush would have nothing left to test — an unmount would
look identical whether the last window had fired or not.

`pendingWrite.current = null` therefore belongs to the two places where a window
genuinely stops being outstanding: the timer firing, and `settleDraft`
cancelling it after the Pod took the text.

## the unmount flush

An unmount is not a reason to throw the last 800 ms away, and it is routine
rather than exotic: `components/studio/studio-shell/studio-shell.tsx` flips
`view.status` when the Solid session expires and stops rendering the editor, so
an expiring token would otherwise take the sentence in progress with it — the
loss `docs/decisions.md` §10 names as the whole reason this feature exists.

Not in the autosave's cleanup, which is where it looks as though it belongs:
React runs that cleanup on every dependency change, and the dependencies are the
form's own fields. Flushing there would write once per keystroke — the debounce
deleted, and the autosave turned into the thing it was deliberately written not
to be. So `[]`, and it reads `live.current` rather than its own closure, which
is from the first render and knows nothing typed since.

Three more decisions inside it:

- **Nothing outstanding means write nothing.** A null `pendingWrite` means the
  last window either fired or was cancelled by a save that succeeded; writing
  would resurrect a draft the Pod has already made redundant.
- **Deliberately not `pagehide`/`visibilitychange`.** Closing a tab does not
  unmount a React tree, so that half stays open by decision: a tab close costs
  at most one window of typing, and a listener that fires on every tab switch is
  a different feature with different failure modes.
- **It sets no state.** `writeDraft` can report a refusal and there is nowhere
  left to show it — the component is being destroyed and its `role="note"` line
  with it. What that line says is that the Pod save is unaffected, which remains
  true.

## what settleDraft gets right

The moment the Pod holds the text, the local copy stops being a backup and
becomes a trap: it is now older than the resource, and restoring it later
silently reverts an entry that was saved correctly. Three things follow.

**The pending window is cancelled first**, and that ordering is the whole point
of holding the timer in a ref. A save typically finishes well inside 800 ms, so
a debounce left running would fire just after the clear and write the draft
straight back — a draft resurrected from a timer, under the key the next mount
reads, offering to restore text the Pod already has.

**`scope` here is the key this editor has been writing under, not the one it is
about to own**, and on a create those differ. This runs inside the save, so
`scope` is the value the render that started the save closed over — `new` —
while `nextScope` is where the entry now lives. Clearing `nextScope` instead
would remove a key nothing was ever stored under and strand the create's draft
under `new` for ever, which is the offer a fresh create form would then get
tomorrow.

**What was typed while the Pod was answering survives.** `save()` snapshots the
form before it awaits, so `sent` is what actually reached the Pod; anything
typed during the round trip is in neither the Pod nor — once the clear lands —
storage, and with `touched` reset nothing would be armed again until the next
keystroke. Close the tab on that sentence and it never existed. So when the form
has moved on it is re-kept at once, under the key this editor owns from here on.

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

## picking appends, once each, and sortOrder is measured

`photosFor` returns the photos the entry will carry: the ones it arrived with,
then the ones picked in this editor, in pick order.

**Picking appends; it never replaces.** An edit that rewrites the resource
without the photos it arrived with destroys them silently — and for photos it
destroys the binaries' only reference too, since nothing else on the Pod points
at `travel/media/<hash>/`. Pick nothing and `carried` travels through exactly as
it arrived, which is the treatment `created`, `datePublished` and the place
already get.

**Once each, however many times it is picked.** The media path is
content-addressed, so re-picking a photo the entry already carries uploads
nothing new — `putGuarded` answers 412 and `uploadPhoto` reads that as reuse —
and returns the SAME `contentUrl`. Appending it blindly would write two
`#photo-N` fragments pointing at one binary: the same picture twice on the
public listing, and, with no removal control in this editor, nothing the owner
can do about it except abandon the edit. The `Set` covers both ways in, since
the same file picked twice in one session is the same defect on a create, where
there is nothing carried to compare against.

**`sortOrder` is the position at save time, not at pick time**, so a file the
pipeline refused leaves no gap in the sequence — and the carried photos keep the
numbers they were stored with, because renumbering them would rewrite §7.3 data
the owner never touched.

**Which number is free is not `carried.length`, and that is measured rather than
argued.** `lib/pod/entry-model.ts` writes `photo.sortOrder ?? i + 1` — a carried
photo with no number of its own is serialised with its one-based position, not
left unwritten — so a list of one unnumbered photo is written as `dy:sortOrder
1`, and `carried.length` is 1: the collision, in the very case the fallback
exists for. So the seed is what the serialiser will actually write, and the
sequence is one-based like every other `dy:sortOrder` in §7.3 (`#photo-1`
carries 1). The `0` seed is what makes a first photo on a create come out as 1
rather than 0.

## attachedOf is the fence between a slot and a photo

`ready` only, in pick order. This is what the draft keeps and what the save
carries, so the filter is the fence: a decoding slot has no `Photo` at all and a
failed one must not reach either, or the entry references a photo that 404s for
every reader.

## whoever creates the pipeline disposes it

`ownPipeline` holds the one this component created and nothing else ever goes in
it, which is what makes the unmount cleanup safe. `Pipeline.dispose()` is not a
cancel: it terminates the worker and rejects everything already pending, so
calling it on an instance a caller injected would break a photo that caller is
still processing. So an injected `pipeline` is returned as it is and never stored
here.

It is created lazily, on the first pick. A worker at mount costs a thread and a
chunk on every edit, and most edits touch no photo at all.

## disposal is not tidiness

The worker holds a decoded bitmap, which for a 50 MP photo is on the order of
200 MB, and an editor closed mid-decode would otherwise leak it for the life of
the tab.

**Unmount is the only correct caller today**, and `Pipeline.dispose()`'s own
docblock says why: a photo queued but not yet pending is not in the map to
reject, so its send still runs, re-spawns a worker, and can resolve after the
dispose returns. Harmless at unmount — the component is going away — and a
defect anywhere else. A cancel button needs a generation counter first.

`ownPipeline.current` is null under StrictMode's first cleanup unless a photo
was picked between the two effect invocations, so the double-invoke is a no-op
rather than a disposed pipeline the second mount inherits.

## the coordinate offer's two guards

§11.3's offer keeps two guards that are not the transition's. The whole argument
for the rest — the form and not `place.geo`, at full precision, and why the
refusal is one record for the pair — is `applyPhotoCoordinate`'s, in
`../state/apply-photo-offer.ts`. What is left here is the §9 gate, which reads
state that reducer does not hold, and the tag's own absence.

**`gps` is optional and the guard is not decoration.** `readMetadata` returns
`{}` for a file it cannot read at all — screenshots, scans, location services
off — which is the case this meets most often. The obvious
`setLat(String(metadata.gps?.lat))` writes the string "undefined" into a
`type="number"` box, which a browser then shows as empty: a coordinate silently
cleared by attaching a scan.

At full precision and as a string, because a value rounded on the way **in** is
a snap the owner did not choose.

## the gate is asked again for a photo, and fails closed

§9 fails closed, and a photo is not an exception to it. This is the same gate the
two boxes wear as `disabled={!coordinatesLive}`, asked by the one writer that
does not arrive as a keystroke.

**Without it the editor contradicts itself in one accessible description.** The
controls are dead and already say "This entry will be saved without a map pin:
your privacy settings could not be read", and the note would compose a second
sentence into that same description telling the owner to type in a box the
browser will not let them type in.

**And it is a mechanism, not only a contradiction.** `fuzzed()` returns
`undefined` for any gate that is not `ready`, and `placeFor` reads `undefined`
as a REMOVAL — so on an EDIT this fill would delete the entry's stored `#geo` by
the fail-closed branch, which was harmless before the picker existed only
because these boxes could not become non-empty. That is the sort of safety that
stops being safety without anything changing where it was written.

**The gate is read from the render that started the pick**, and unlike
`coordinateAuthor` that needs no ref: `gate` goes `checking` → `ready` or
`closed` exactly once, on mount, and never back. So a stale read can only be
`checking` where the truth is now `ready` — a refusal where a fill was
permissible, which is the direction §9 says to err in.

## the timestamp offer's refusals are the transition's

§11.5's offer is made twice and both of its refusals belong to
`applyPhotoTimestamp`, which carries the whole argument: first writer wins per
half, the cross-half guard on `key` and not on `name`, and the two ways an
offset can be shape-valid and impossible. This function reads the two tags and
says who is offering them.

## process, upload, then hold a Photo

Never the `File`. The order is the decision recorded at the top of the file: by
the time `attach` resolves the bytes are on the Pod and the component holds URLs
and JSON, which is what keeps the autosaved draft restorable. The source
`ArrayBuffer` is read in the component rather than in the worker because the
container path is `sha256(ORIGINAL)[0..16]` — the derivative's hash would defeat
the re-pick idempotence that makes a retry free.

**Nothing throws out of `attach`.** `uploadPhoto` reports its failures as a
`Result`, but the pipeline REJECTS (that is `createPipeline`'s contract), and an
unhandled rejection would leave a slot decoding for ever with nothing on screen
saying why.

## a settle must arm the autosave

A settle is a change to the form and has to arm the autosave like any other one.

The pick itself already set `touched` — the file input's `change` event bubbles
to the `<form>` handler — but a save can land between the pick and the settle
and put it back to `false`. `settleDraft` does that legitimately: at the moment
it runs, the Pod holds exactly what the form holds, because a slot still
`decoding` contributes nothing to `attached` and `sameText` is therefore true.

Then the photo settles. `attached` gains a `Photo`, the autosave effect re-runs
— and returns at `if (!touched.current)` having armed nothing. The row says "is
attached to this entry" and the binaries really are on the Pod, but the entry
resource does not reference them and nothing is in `localStorage` either. Close
the tab and the photo is orphaned and silently absent, with no surface anywhere
that says so.

Reachable by ordinary use, not by a race that needs help: Save is only
`disabled={saving}`, so picking a photo, typing the headline and pressing Save
before the decode finishes is a sequence the UI invites.

**`ready` only.** `uploading` and `failed` leave `attached` unchanged, so there
is nothing new to back up and arming on them would re-open the window over text
the Pod already has. The narrower race — a settle DURING the round trip — is
handled by `live.current.text` and `samePhotos` inside `save()`, and is not
this.

## the offers are made on ready, and not a line earlier

The metadata has been in hand since the decode, so filling from it before the
upload is spelled in one line fewer — and it offers the owner a coordinate for a
photo that is about to fail its PUT and be announced as not attached. A
coordinate from a photo that is not on the entry has nothing on screen to
explain it, and its note names a file the form no longer holds.

**The two offers are independent and both are made, in either order**: a photo
may carry GPS and no clock, a clock and no GPS, both or neither
(`lib/media/exif.ts` reads them from different IFDs and guards each separately),
and neither half may stand in for the other or clear it.

The `key` goes in beside the name because that is photo identity here and the
name is not — see `TimeAuthor`. `offerCoordinate` takes the name alone on
purpose: it displays it and never compares it.

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

## the language tag is a fixed default

Every human-readable literal is language-tagged (§6), and an entry being edited
keeps the tag it already had. `LANGUAGE` is a fixed default rather than a
control: there is one owner writing one diary, and a language picker is a
feature to add when someone needs it. An UNtagged literal is the thing §6 rules
out, so a default is the honest minimum.

## six outcomes, six things to say

`announce` keys on **which step failed**, never on `recovery` alone. `recovery`
has four values and §10 has six outcomes, so two pairs collide: a refused write
and a failed revalidation are both "retry" — and are opposite situations,
nothing written versus everything written — while an unverified ACL and a
refused index are both "rebuildIndex" but differ in whether the entry is
readable at all. Collapsing either pair sends the owner to the wrong recovery:
retyping work that is already on the Pod, or waiting out a cache that will never
refresh.

So the message says what completed and what did not, and `describe(error)`
carries the technical detail underneath rather than into the sentence. The four
`switch` arms keep their own one-line reasons in place: nothing reached the Pod
and a 412 is its own sentence; §10's published-but-unreadable; §10's "invisible,
not corrupt", where an owner who reads it as "your work went nowhere" retypes an
entry that is already there; and a cache that heals on its own.

`Announcement`'s two tones are the two ARIA roles that announce it — `status`
for news, `alert` for something needing a decision. Text dropped into a plain
`<div>` is text a screen-reader user never hears, and the result of a save
arrives long after focus has moved on.

## a clean save says nothing about the public site

Deliberately, and it is not a wording preference. The only difference between
this outcome and a failed revalidation is whether the reader is warned about
staleness, so the two messages must not share that vocabulary or the warning
stops carrying information.

Measured: with "and the public site has been refreshed" in the success message,
a hook that checked `res.ok` and never read the body — the exact bug §10 step 4
and the revalidate route's own docblock warn about — **passed** the test that
exists to catch it, because the success message it wrongly produced still
mentioned the public site.

## what a target is, and what a null etag means

`Target` is where the entry lives once it exists, plus the ETag of the state
this editor holds. `null` for the whole target means this editor has not written
it and was not handed one, i.e. a create. An `etag` of `null` on an existing
resource is the awkward case `SaveEntryReport.etag` documents: the write
happened, but the next update has nothing to condition on and must re-read
rather than invent one.

## the precondition has no third option

`If-None-Match: *` creates; `If-Match: <etag>` updates. Both wrong answers are
silent: reusing `{ create: true }` after a create is a guaranteed 412 on a
resource this editor just wrote, and reusing the ETag from before the last write
is a 412 the owner cannot act on, because the retry they try next fails
identically. A blind PUT is a bug (§10).

## the two timestamps that must not move

`provenance` holds `created` and `datePublished`, because after the first save
this component is the only thing that knows them.

`saveEntry` sets `created` on a create and carries forward whatever the caller
supplies — but on the SECOND save of an entry this editor just created, the
caller is this form, `initial` is still absent, and a form that supplies neither
leaves `created` undefined on an update. The serialiser then omits the triple
and the first save's value is gone: §7.3's distinction between "when the record
came into being" and "when it became public" destroyed on the second click,
silently and permanently. `datePublished` is the same bug in the other direction
— recomputed from the clock, it would creep forward on every save.

Measured with a throwaway probe before this state existed: the second PUT
carried no `dcterms:created` at all.

## one instant for the whole save

`stamp` is handed to `saveEntry` rather than left to its default, so that the
value this form remembers is the value that reaches the Pod. The default is a
`Z` normalised to `+00:00`; this carries the owner's own offset, like every
other timestamp §7.3 shows.

Two derivations hang off it, and each mirrors `saveEntry`'s own rule rather than
replacing it. `created` is invented only when creating — an older entry that has
none must not be given one now, which would claim the record came into being
today. `datePublished` is "when it became public", fixed at the first
publication and never recomputed; unpublishing does not clear it, because it is
a fact about the past.

## fuzzing happens here, and half a pair is nothing typed

§9 is applied before the `Entry` exists, so `saveEntry` is never handed a
precise coordinate and the only copy of one is in this component's state and in
the input the owner is looking at: "the studio applies fuzzing before the write
and discards the precise original."

**Three outcomes, and `undefined` means two different things**, which is why
`touchedCoordinate` is computed separately rather than inferred from a missing
geometry:

- **nothing typed** — the place travels through untouched, coordinates and all.
  They were snapped when they were stored and are not necessarily on today's
  grid, so re-snapping them would walk the pin on every save
  (`#empty-coordinate-boxes-on-an-edit`). One box of the pair counts as this.
- **snap** — the published pair replaces whatever was there.
- **drop** — the geometry is REMOVED. §9 step 2: not coarsened, and the place
  keeps its name — "it is the geometry that is absent, not the entry". On an
  edit that means deleting a `#geo` that is already on the Pod, which is the
  half an "add the new one" spelling silently skips.

The three text fields have the same three outcomes and are decided separately,
because a coordinate and a name are removed independently: §9's drop keeps the
name — "the entry is still written, with its place name if it has one" — and
clearing a name must leave the coordinate alone. Their "untouched" is carried by
the controls themselves rather than by a flag
(`#why-the-place-text-is-prefilled`).

**Fail closed on everything else.** A form that somehow holds a coordinate
without trustworthy settings — a restored draft, a control re-enabled by hand —
publishes none: `fuzzForPublication` refuses settings that do not parse, and the
two guards above it refuse a gate that never opened and a precision that is not
a positive integer of metres. Every one of those is a drop, and a drop still
saves the entry.

**"Typed" means "in the boxes", and that includes a pair a photo filled.** The
flag asks whether there is a coordinate to publish, and an auto-filled one is a
coordinate to publish: it is on the form, the owner can see it, it is credited
to the photo it came from, and it goes through `fuzzed()` like any other.
`coordinateAuthor` is the record that distinguishes the two and is deliberately
not consulted here — this decides WHETHER a coordinate is written, that record
decides whether AUTO-FILL may write into the form, and collapsing them would
either publish nothing for every photo-filled entry or re-fuzz a stored pair on
every save.

**And half a pair is "nothing typed" — ruling F-A, and the two directions do not
even land in the same ocean.** `Number("")` is `0`, so one typed latitude
composes `{ lat: 45.5155, long: 0 }`, which is finite and in range and which
`fuzzForPublication` therefore snaps and publishes. Measured through the real
function against §7.6's own settings: `{45.5155, 0} → 45.51486 / 0.00000` and
`{0, 9.2103} → 0.00000 / 9.20909`. Both publish; neither drops. Latitude only
lands at 0° east of the owner's own latitude — inland south-west France, a
plausible-looking pin on land, not open water. Longitude only lands in the Gulf
of Guinea, a few tens of km off Gabon — not the 700-odd km that belongs to
`{0, 0}` elsewhere in this codebase. The land pin is the worse of the two:
nothing distinguishes it on the map or in the data from a coordinate the owner
actually chose. Either way `dy:precisionMeters 500` stands beside it, describing
a pin the owner never typed as accurate to within half a kilometre. Ruling
T3-A's stated cost was that such an owner "must type the second, rather than
getting a silently wrong location" — which assumed they are forced to notice,
and nothing forces them: the outcome region says saved and nothing on the form
is red.

F-A makes a half pair behave as the absence it already is, which is what §9 does
everywhere else — an unreadable gate, an unusable grid and `insideHome` all drop
rather than approximate. It may NOT be spelled as the `drop` above: on an edit
that deletes the pin the entry already has, which is a removal the owner did not
ask for either. **Telling** them, rather than silently dropping, is the better
long-term answer; it belongs in `TODO.md` as an open item and is not that line.

## the untouched geometry is spelled as the stored one

"Nothing typed" is spelled as the geometry the entry already had, which
`placeFor` carries through unchanged. It is deliberately not spelled as
`undefined`: that is the DROP, and collapsing the two would delete a coordinate
from the Pod every time an entry was edited without retyping one.

The pair-completeness conjuncts are ruling F-A —
`#fuzzing-happens-here-and-half-a-pair-is-nothing-typed` — both boxes, or this
is the untouched case.

**`touchedCoordinate` is subsumed by them rather than load-bearing**, and that
is said out loud because this file has already carried one no-op defended by a
comment claiming otherwise (see `placeFor`). A whole pair is necessarily a
touched one, so the flag narrows nothing on that line. It stays because it names
the question the fuzzing note argues — "is there a coordinate to publish at
all" — and because folding the AND into its definition would give one name to
two different rules: "the owner has been in these boxes", which is what that
argument is about, and "what is in them is a point", which is the line. Ruling
F-A fences the flag for the first reason; the second is why it would still be
worth two names.

**The redundancy is conditional on `touchedCoordinate`'s current definition, not
a permanent property of the line**: it holds only because a whole pair (both
trims non-empty) always implies it under today's OR of the two trims. Any future
redefinition that is not implied by a whole pair — a third box added to the OR,
a debounce, anything that can be false while both boxes hold text — changes what
the conjunct does, and it would stop being a no-op the moment that happens.

The text argument beside it needs no such flag, which is the asymmetry
`#why-the-place-text-is-prefilled` explains rather than an omission: those three
controls ARE seeded from the entry, so a box nobody opened already holds the
stored value and writing it back is the untouched case. What `touchedCoordinate`
has to reconstruct, the form carries.

## what the entry carries through untouched

`dcterms:created` and the fields this form does not offer are carried through
from the entry being edited. §7.3: created "is when the record came into being
and datePublished is when it became public. They differ by however long the
draft sat." An edit that rewrites the resource without them destroys them
silently and permanently — the place and its (already fuzzed) coordinates, the
photos, the original creator.

## the timestamp is concatenated, never converted

`occurredAt` is what the two controls hold, joined by `toOffsetDateTime`. Either
half may have been typed or chosen by the owner, filled by a photo's EXIF
(`offerTimestamp`), or left exactly as the entry arrived: `offset` starts as the
entry's own on an edit, so an edit that never opened either control writes the
timestamp back as it was stored.

What that line must not become is a **third source** — §9 step 3's rule for the
precision, spelled for the timestamp: what the owner can see is what gets
published, which is also why a photo's EXIF is never read here.

## the photos, and why a failed slot reaches nothing

What the entry arrived with, then what was picked here — and only the `ready`
picks, since `attached` is the filter. A failed slot reaches neither the entry
nor the index row: an optimistic slot saved with a local preview URL would write
`schema:contentUrl <blob:…>` into a publicly readable resource, which 404s for
every reader while the entry reports itself saved.

Pick nothing and this is `existing.photos`, unchanged and renumbered by nothing
— see `photosFor`.

## a throw means unknown, not failed

`saveEntry` reports every failure it knows about as a value, so reaching the
`catch` means something threw where nothing is meant to — and the honest answer
is that what reached the Pod is unknown, not that the save failed.

Caught for the reason the shell catches its two verbs: an unhandled rejection
would leave the button disabled and the screen looking as though the click had
done nothing at all.

## step 1 is the whole test for the settle

Including the two §10 outcomes where a LATER step failed — an unverified ACL, a
refused index. The text is on the Pod in both, and keying the settle on "the
save reported no failure" would leave a stale draft behind in exactly the two
cases the owner is already being asked to do something about. When step 1 itself
failed the draft is kept, because then the form and this copy are the only ones
there are: §10's 412 tells the owner to reload, and the draft is what survives
the reload.

`text` is this render's snapshot of the sixteen fields — the same values the
entry was assembled from, because `save()` is synchronous up to the await — so
it is what reached the Pod. `settleDraft` compares it with what is on the form
now and keeps the difference.

**The order of the three lines is cosmetic rather than load-bearing**:
`settleDraft` clears `scope` as this render closed over it, so `setTarget`
cannot move the key out from under it whichever way round they go. It reads as
though it could, which is the only reason it is written this way round.

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
derived read. Its whole docblock now lives here, the measurement included: with
the `add` deleted and an entry stored at `+05:15`, the control showed `-12:00`,
the FIRST option, because React marks no option as selected when the value
matches none and a single `<select>` with nothing selected reports its first
one. So the failure mode is not the blank control everyone expects — it is an
offset the owner never chose, in a control that looks answered.

It is `precisionOptions`' shape exactly, `Set` included. Neither special-cases
the value it cannot offer; both union the held value into the list, and the
`Set` is what stops an offset that IS on the list appearing twice. That one
shape covers all three things this control has to do with `+05:15`: render it
rather than blanking, survive an edit that never touched it, and not duplicate
`+09:00`.

**The union is unconditional, and that is where it parts company with
`precisionOptions`**, which adds `gridOf(precision)` only when it is a usable
grid, because §9 step 3 refuses a precision the select cannot show and the value
is validated again at save time. Here what the control shows has to equal what
`toOffsetDateTime` concatenates for EVERY state it can be in, including one no
code path can produce. A shape check on that line would buy a tidier option
list at the price of a control disagreeing with the timestamp it is about to
write.

Sorted by minutes, because `OFFSETS` is already in order and the one value that
may not be on it has to land where a reader will look: `+05:15` belongs between
`+05:00` and `+05:30`, and appending it after `+14:00` looks like a bug in the
list. A string sort is not available — see `offsetMinutes`.

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

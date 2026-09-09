
## the-allow-half-is-a-wait

Section 12m's three cases each pair a refusal with an allow — "the second photo did not overwrite
the first" is satisfied by an editor in which nothing filled at all, so the allow half is what
makes the refusal mean something.

Two of those allow halves read the DOM **synchronously**, right after awaiting the two uploads
and both `<img>` elements. Neither of those awaits covers the state update that actually fills
the clock: `settleBoth` waits for four PUTs, and `findByRole` waits for a slot to render. The
fill is a separate `setOccurred` in the offer, and under load it can land after.

That is what failed twice, in full-suite runs only, on the composite case:

    expected [ '2026-04-11T07:05', …(2) ] to include ''

`''` is an empty clock box — the allow half asserted before the fill arrived. Both halves are
`waitFor` now.

**The refusals are deliberately NOT waits.** A `waitFor` around "the second photo's zone was
refused" would pass by timing out on a value that was never going to change, which is the
opposite of a proof. Only the allow half waits; the refusals read the settled DOM after it.

Not reproduced directly — fourteen runs, including under deliberate CPU contention, stayed green.
The fix follows from the failure message and the shape of the awaits, and is recorded as such
rather than as a confirmed repro.

---

# What the comment sweep moved here

Stage C's Task 6, 2026-09-09. Nineteen blocks over the six-line bound left
`entry-editor.tsx`; each section below is one of them, at the point its pointer
now names. The warnings a reader must not walk past are still inline, shouted,
with the evidence down here: the `title`-not-`aria-label` naming, the reason
being on the button rather than on the fieldset, `disabled={saving}` composing
with the hold rather than being replaced by it, and the save outcome's technical
detail staying outside the announced region.

## what the editor is not allowed to do

One form, and the §10 write sequence behind it. The same two rules the shell is
held to, for the same reasons:

1. It imports **no value** from `@inrupt/solid-client-authn-browser`. The
   session arrives as a prop, so every behaviour here is testable against a
   plain object, and the library stays inside the `ssr: false` boundary that
   `components/studio/studio-client/studio-client.tsx` draws.
2. It reads **no config and no env var**. `OWNER_WEBID`, `SITE_URL`,
   `SITE_NAME` and `POD_ROOT` are not `NEXT_PUBLIC_`, so `lib/config.ts` throws
   the moment it is reached in a browser. The trips it can write into arrive as
   props; the owner's WebID comes off the session.

**The write itself lives in `lib/pod/save-entry.ts`.** This file assembles an
`Entry`, picks the precondition, and turns the `{ completed, failed, recovery }`
report into something a human can act on. It reimplements none of the sequence —
in particular it never PUTs anything itself, so every write it causes carries a
precondition (§10).

## the coordinate controls, and the order of events that makes them safe

§9: "the studio applies fuzzing before the write and discards the precise
original", because "resources are publicly readable … anyone can fetch the raw
triple". So the fuzz happens in this component, before the `Entry` is built —
`saveEntry` never sees a precise coordinate, and nothing downstream could catch
one if it did, because by then the precise value exists only in this component's
state and in the input the owner is looking at.

Until 2026-09-06 this file had no coordinate input at all and said so at length:
fuzzing did not exist under `lib/`, so a latitude field would have put a true
coordinate on a world-readable resource — a privacy invariant broken rather than
a feature missing, and unfixable after the fact. `lib/pod/fuzz.ts` and
`readPrivacySettings` now exist, and this is their caller.

**Four rules, each of which is a different way to leak:**

1. What reaches `place.geo` is the `FuzzResult`, never the form state.
2. A `drop` means **no `geo` at all** — not a coarser one. §9 step 2 explains
   why at length: a hundred entries "fuzzed to 2 km" resolve to one cell whose
   centroid is the house, and each new entry sharpens it. The place name
   survives; it is the geometry that is absent, not the entry.
3. It **fails closed**. Settings that are absent, unreadable or schema-invalid
   leave the three controls dead with the reason on screen and associated,
   rather than live and refused at save time — `sameWebId`'s posture. Valid
   settings with NO home region are a different fact and stay live: §7.6 calls
   that "I have no home to protect", and reading it as a failure would silently
   strip the pin from every entry of everyone who never set one.
4. **An untouched coordinate is not re-fuzzed.** A stored pair was already
   snapped when it was written, and it is not necessarily on today's grid —
   `snapToPrecision(35.6938, 139.7034, 500)` is 35.69423/139.70348, not the §7.3
   fixture's own pair — so re-snapping on every save walks the pin. Leave both
   boxes empty and the place travels through untouched, exactly as `created` and
   `datePublished` do.

## photos, and why the pick is the upload

Until 2026-09-06 this file said photos were phase 3 because they need the
resize/EXIF pipeline. That pipeline now exists — `lib/media/pipeline.ts` for the
bytes, `lib/media/upload.ts` for the two PUTs — so the reason is gone. What
replaces it is the ordering decision, which is the part that is easy to undo by
accident:

- **A picked file is processed and uploaded immediately**, and this component
  then holds URLs and JSON — a `Photo` — rather than a `File` or a `Blob`.
  Holding the file until Save is the obvious spelling and it breaks the
  autosave: `localStorage` takes strings, a Blob serialises to `{}` without
  throwing, and the draft would report success while restoring a photo with no
  URL on it. The derivatives are content-addressed (§7.3), so a re-pick of the
  same photo is a 412 read as reuse rather than a second copy.
- **Only `ready` slots are saved.** A file the pipeline refused is announced and
  left out — of the entry, and of the draft. An optimistic slot carrying a local
  `blob:` preview into the entry would write a photo that 404s for every reader,
  on a resource that reports itself saved.
- **An existing entry's photos are carried, never replaced.** Picking a photo
  appends; picking none leaves `existing.photos` exactly as it arrived, the same
  rule the place, `created` and `datePublished` follow. The binaries have no
  other reference, so dropping the triple orphans the bytes.

## the EXIF clock reaches the timestamp through the form

A photo's EXIF `DateTimeOriginal` is still **not** wired to the photo's own
`schema:dateCreated`, and as of 2026-09-07 it **does** reach the entry's
timestamp — through the form, exactly as the GPS does.

§6 requires a UTC offset on every `xsd:dateTime`, and `lib/media/exif.ts` yields
an offset-less wall clock — EXIF has no zone and `OffsetTimeOriginal` is usually
absent (§11.5) — so inventing this machine's offset for a photo taken elsewhere
would stamp the wrong instant onto a permanent record. That argument still
forbids the direct write, and an existing `dateCreated` is carried through
untouched.

What it never forbade is the pair of **controls**: the wall clock lands in "When
it happened", the half EXIF does not carry is the offset select beside it, and
the owner is TOLD when that half is only this machine's guess instead of reading
`21:38 +02:00` in which both halves look like data (§11.5: "worse than not
auto-dating at all, because it looks right"). The three names that argument used
to point at are `offerTimestamp` in `hooks/use-photo-pipeline.ts`, `TimeAuthor`
in `state/actions.ts`, and `OFFSET_GUESS_ID` in `fields/when-fields/`.

## a photos GPS is wired to the form and to nothing else

As of 2026-09-07. This paragraph used to end "neither wire is stage 1's", which
was true of stage 1 and is now false of the coordinate half:
`derived.metadata.gps` fills the two coordinate boxes when nothing else has
(§11.3), and it fills nothing else.

- **It feeds the form, never the write path**, and that is the whole of the
  privacy argument. A photo's GPS arrives looking authoritative — it is a real
  reading, from a real receiver — and the tempting spelling puts it on
  `place.geo` directly, which publishes the exact spot a picture was taken.
  Landing it in the inputs instead means it reaches the Pod by the ONE route a
  typed coordinate does: `fuzzed()` at save time, §9 steps 1–4, snapped or
  dropped. There is no second path, and §9's guarantee is that there is not.
- **First writer wins, in every direction** (§11.3, and ruling T3-B for the last
  of them). Auto-fill only ever writes into a coordinate nobody has supplied:
  not one the owner typed, not one an earlier photo offered, and not one the
  entry being edited already has — an edit's boxes are empty by design, and what
  they mean when empty is "the pair on the Pod stands".
  `state/notes.md#what-coordinateauthor-decides-and-what-it-does-not`.
- **And it asks the same gate every other coordinate writer asks.** Settings
  that cannot be read leave the three controls dead (§9's fail-closed posture),
  and a photo does not get past that either —
  `hooks/notes.md#the-gate-is-asked-again-for-a-photo-and-fails-closed`.
- **And it says so on screen.** A value that appeared without being typed has to
  name where it came from, or the owner cannot tell it from something they did
  yesterday — `fields/where-fields/notes.md#one-provenance-note-for-the-pair`.

## plain controls on purpose

`TODO.md` keeps layout deliberately unstyled until phase 7, and native
`<select>`, `<input>` and `<textarea>` need no Radix on a screen of sixteen
controls. Every one of them has a real `<label>`.

## the trips own status is rendered

`EditorTrip.status` is `dy:status` of the **trip**, not of the entry, which is a
control on the form.

Optional because a caller that knows only where a trip is can still offer it,
and because the whole point of the marker is to say something extra about a
draft rather than to withhold a trip nobody labelled.

It is rendered, and that is why it is there. `listStudioTrips` carries it for one
stated reason — "a picker that shows a draft trip and a published trip
identically invites the one mistake that cannot be undone from the editor:
writing a PUBLISHED entry into a DRAFT trip yields a public entry whose trip is
not public". The marker is what makes that visible before the click rather than
after it.

## settingsUrl and podRoot are required props

`settingsUrl` is `/travel/settings/privacy.ttl` (§7.6), resolved by whoever
knows where the Pod is — `privacySettingsUrl(podRoot)` in `lib/pod/read.ts`. It
joins `indexUrl` and `entriesContainer` as a URL this component is **given**,
because this component reads no config: `POD_ROOT` is not `NEXT_PUBLIC_` and
`lib/config.ts` throws the moment it is reached in a browser.

**Required, and that is the point.** Optional would mean a shell that forgot to
pass it produced an editor that failed closed for ever — no error anywhere, no
test red anywhere, coordinates simply never published, which is
indistinguishable from a Pod with no `privacy.ttl` on it. Nothing renders a wire
nobody passed, so `tsc` is the only check that covers this one.

**A URL rather than the parsed settings**, because the read failing is the case
that matters (§9's fail-closed rule) and only a URL can 404. It is read over the
session's own fetch: the resource is owner-only, so an anonymous GET is a 401 on
a real Pod — and on ESS a 401 does not even distinguish private from missing
(§13).

`podRoot` is the Pod's storage root, which is where `travel/media/` hangs (§4:
media is ONE global container, outside any trip, so publishing never has to move
binaries or rewrite references). Required, and a prop, for exactly the reasons
`settingsUrl` is both. The shell already holds it, since `settingsUrl` is
derived from it. Optional would mean a shell that forgot it uploads photos to a
path built from `undefined`, and nothing renders a wire nobody passed, so `tsc`
is again the only check that covers the omission.

## the pipeline is injected, and ownership follows creation

The resize/EXIF pipeline is injected so that a test can supply output it knows
byte for byte. `undefined` is what ships: one is created lazily on the first
pick, because a worker at mount is a thread and a chunk spent on the majority of
edits, which touch no photo at all.

**Ownership follows creation, and that is the whole point of the seam.** An
injected pipeline is disposed by whoever injected it; the unmount cleanup only
ever disposes one the component created. `dispose()` is not a cancel — it
terminates the worker and rejects everything pending — so disposing a caller's
instance would break a photo it was still processing.
`hooks/notes.md#whoever-creates-the-pipeline-disposes-it`.

## storage is injected so the failure can be scripted

`storage` is where in-progress text is kept between visits. It defaults to the
browser's own `localStorage`, which is what actually ships.

Injected rather than reached for so that the failure that matters can be
scripted: Safari in private mode reports a zero quota and throws on the first
`setItem`, and no browser global can be made to do that on demand.

## the exemption went because the directive became unused

`EntryEditor` is 164 code lines against the 200 bound — 195 when the directive
went — which is why the `eslint-disable max-lines-per-function` that stood on it
until 2026-09-08 is gone: at 195 it was already an UNUSED directive and
`--max-warnings 0` refuses the build for that. Its own removal condition —
"Remove this line with the last field group" — was wrong, and Task 5 proved it:
after all five groups this function was still 633 lines.

## what the 164 are, and why they stay

Stage C's Task 7, 2026-09-09. **The banner was extracted and the rest stays**,
with the number measured after the extraction rather than predicted before it:
`check:structure` reports 164, over the 130 tendency and 36 under the 200 bound.

**What left.** `draft-banner/` — the unsaved-draft banner, `HOLD_REASON_ID` and
`savedAtText`, 31 code lines of the 195. It was the one block in here that
qualified as a sixth presentational group by Stage B's own Task 5 argument, and
Stage B left it out for timing rather than merit
(`hooks/notes.md#what-the-195-are-and-what-they-are-not`). The reason it was left
had expired; the merit had not.

**What the 164 are.** Roughly 55 lines of composition — the props, the reducer,
five hook calls, `attached`, `text`, `restore` — and roughly 110 of JSX in one
`return`. The composition is this component's whole job and cannot be moved
without moving the thing being composed. The JSX is the page's frame: an
`<h2>`, the banner's one condition, the `<form>` with its two handlers, the held
`<fieldset>` and the five groups inside it, the Save button, the storage note
and the outcome region.

**What was considered next, and declined.** Three candidates remain, and each
would move lines without moving responsibility:

1. **The outcome region** (~15 lines) reads `outcome.tone`, `outcome.text` and
   `outcome.detail`, which is the whole of `useEntrySave`'s answer. Extracting it
   buys 15 lines for a component whose only argument is one object, and the
   `role="status"` / `role="alert"` / detail-outside-the-region decision is the
   thing a reader most needs to find where the save's result is rendered.
2. **The `<form>` and its `<fieldset>`** cannot leave without the five groups and
   the Save button going with them, which is `EntryEditor` under another name and
   one more layer of prop forwarding — 40 props through a component that decides
   nothing.
3. **The storage note** (~7 lines) is one `<p>` behind one boolean. A folder,
   a barrel, a notes file and a test for that is bookkeeping, not structure.

The tendency is a tendency. 164 lines that each say something, in the one file
that composes this feature, reads better than 130 plus three components that
exist to be under 130.

## one place marks the form as touched

Rather than a line in each of sixteen handlers. React's `onChange` is delivered
to ancestors, so the `<form>`'s own handler catches every control on the form
including ones added later — and a field whose handler forgot the line would be
a field whose typing is silently not backed up.

`restore()` deliberately does **not** come through there: it sets state without
a DOM event, and what it puts on the form is what storage already holds.

The `onSubmit` handler prevents the default so that jsdom and the browser both
stay on this page and the save is this component's to run.

## held while a draft is offered

One storage slot, so only one of the two may hold the pen.

**The loss it prevents.** The banner and the autosave share a key. A draft
survives a crash; the next day the owner opens the studio, sees the banner,
decides to deal with it later and starts typing something else. 800 ms later the
autosave puts the near-empty new form at that key and the old text is gone from
storage — `offered` still holds it in memory, so Restore works for as long as
this tab lives, and a reload, a session expiry or a second crash loses the long
entry `docs/decisions.md` §10 names as the reason this feature exists. Restore
or Discard unlocks the form; the cost is one click.

**A `<fieldset disabled>`, not a guard in `onChange` or in the autosave
effect**, and the difference is what the owner is shown. A guard that refuses
the CHANGE leaves them typing into a form that silently drops the keystroke,
with nothing on screen saying anything is being withheld. A guard that refuses
only the WRITE is worse in the other direction: the text appears and nothing is
backing it up, which is the silent half of the same loss. The fieldset stops the
keystroke where a browser stops it, and says so through the controls' own
appearance and to a screen reader.

**The Save button is in there too** — the seventeenth control and the last one,
held by the same attribute for the same reason. It said "the ninth" from the day
the fieldset landed until 2026-09-07, by which point the picker, the three place
fields and the UTC offset had made it wrong by eight: sixteen `Field`s are the
fieldset's grid children now, and the button is what follows them.

**`grid gap-4` moved here from the form**, when there were eight fields and they
were the form's direct grid children; a wrapper around them is otherwise the
grid's only item, every field collapses into one cell and the gaps disappear.
`display: contents` would have kept the form as the grid, and is declined:
`fieldset` is the one element where browser support for it has historically
differed, and a plain grid box behaves the same everywhere. `min-w-0` because a
fieldset's UA `min-inline-size: min-content` is not among the things Tailwind's
preflight resets (checked in `node_modules/tailwindcss/preflight.css`, which
names no fieldset rule at all), and with `w-full` controls inside it that floor
can stop the textarea shrinking.

## the save button is the seventeenth control

Held with the other sixteen and by the same attribute. It carries no margin of
its own: the fieldset is the grid, so its row takes its gap from `gap-4` like
every field above it, and the `mt-4` it wore while it stood outside would now be
a second gap on top of that one. The wrapper `<div>` stays, bare — the grid
stretches its items, so a button promoted to a direct child of the fieldset
becomes a full-width bar.

**The loss it closes, which is why it moved.** The fields of the day shipped
held and this button did not, and that left exactly one click between an
unanswered banner and the text it was offering. On a CREATE the click is
harmless — the form behind the banner is empty and `save()`'s pre-flight guard
refuses it. On an EDIT it is not: the form is already full of the entry that was
opened, so the save writes it as it stands, `settleDraft` clears the key, and
the copy that survived the crash is deleted before the owner has read the
sentence offering it. One unprompted click, nothing typed, no way back — the
same loss the fieldset exists to prevent, reached by a shorter route.

**The hold is real rather than cosmetic, and that is the measurement** (jsdom
30.0.1, `@testing-library/react` 16.3.3, throwaway probe). Inside a `<fieldset
disabled>` an `<input>` still takes `fireEvent.change` and a `<button>` still
receives the click event — but jsdom refuses the button's ACTIVATION behaviour,
because "actually disabled" walks up to the fieldset. The probe measured 0
submissions held against 1 free. So from behind the banner this button
dispatches no `submit` at all, which is what lets section 8e assert the
consequence — nothing to the Pod, the draft still on disk — instead of an
attribute. The same measurement once read as the reason the button could not
live here: section 8c used to fill the held form with `fireEvent` and save,
which only passed because `fireEvent` ignores disabled state. It now clicks
Restore first, which is the path the owner actually has, and all six §10
scenarios still reach the Pod.

**`disabled={saving}` and `aria-busy={saving}` stay, and they compose with the
fieldset rather than being replaced by it.** Two different conditions on one
control: the fieldset says "answer the banner first", `saving` says "this one is
in flight". Respelling the hold as `disabled={offered !== null}` here would pass
every assertion about the banner and re-open the double submit this button has
been guarded against since it was written — 8g and the last test of 8e pin
`saving` at the one moment it is true. `aria-busy` in particular keeps meaning
`saving` and nothing else: a form waiting for a person to answer a banner is not
busy, and the fieldset must not become the thing that reports busy-ness.

## the reason is on the button, not on the fieldset

And it must not be tidied upward. It reads as though it belongs on the fieldset
— one element holds seventeen controls, so one element should carry the reason
once — and that spelling is heard by nobody. Measured (jsdom 30.0.1,
`dom-accessibility-api` 0.5.16; it is the ARIA computation rather than a jsdom
quirk):

```
<fieldset disabled aria-describedby="reason"><button>   ""
<fieldset disabled><button aria-describedby="reason">   "…"
```

A `<legend>` names a group; nothing propagates a group's DESCRIPTION to its
members. Moving the attribute up therefore deletes the explanation while leaving
markup that reads as if it were still there — the accessibility-shaped version
of a rule exercised at a path it does not cover.

**This button alone, not all seventeen.** The banner sits directly above the
sixteen fields and its own sentence is about them; Save is the one whose refusal
has a consequence the owner will go looking for. And one reason attached to
seventeen controls is that reason announced seventeen times to anyone reading
the form linearly.

**Conditional, both ways.** With no offer the element it would name is not
rendered, and a dangling IDREF computes to `""` — so the honest spelling is no
attribute at all. It would also be wrong if it did resolve: a description
carried permanently is a hold announced on every encounter with the button,
including the encounters where nothing is holding it.

**The test does not catch the unconditional spelling**, and that is written down
rather than assumed. Measured: with `aria-describedby={HOLD_REASON_ID}`
unconditional, 8e-bis still passes end to end, because with no offer the banner
is not rendered, the IDREF dangles and the description computes to `""` anyway.
The allow-case is structural, exactly as that docblock says. The condition is
kept because a live attribute pointing at nothing is a lie in the markup that
the next reader has to disprove.

## the storage note is a note, not a status or an alert

`role="note"` is neither `status` nor `alert` and must not become one. Those two
belong to the save, and a browser that will not keep a local copy has no bearing
on the Pod at all: the entry saves exactly as it would otherwise. An assertive
announcement would interrupt a screen reader mid-sentence to report something
that changed nothing.

It has to be said, though — quietly is not silently. The whole value of this
feature is the belief that the text is safe, and a backup that is not happening
while the owner believes it is is worse than no backup at all. Once it appears
it stays; the attempts behind it continue.

## the outcome region, and why the detail sits outside it

`status` for news, `alert` for something needing a decision: `alert` is
assertive and interrupts a screen reader mid-sentence, which a save that worked
has not earned.

**The technical detail is deliberately outside the announced region.** It is the
failure as `describe()` renders it — a URL and a status code — and an alert
should carry the sentence a person can act on, not read out a Pod URL character
by character. Keeping it out also keeps the six §10 outcomes distinguishable **by
their wording**: inside the region, a per-scenario URL would make any two
identically worded outcomes look different to a test reading that region, which
is exactly the distinction the editor's outcome suites exist to hold. Measured,
not supposed — with the detail inside, keying the message off `recovery` alone
still passed that test.

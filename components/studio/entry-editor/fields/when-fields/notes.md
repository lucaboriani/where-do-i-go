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

---

# What the comment sweep moved here

Stage C's Task 6. Each section is the block that stood at the point its pointer
now names; nothing was dropped, and the compression is in the wording only.

## three notes, one per claim

`COORDINATE_SOURCE_ID`'s shape and all of its reasons: `aria-describedby` from
the control itself and never an `aria-label` on a wrapper (a `<section
aria-label="Photos">` around the picker once cost six tests, because a named
wrapper shadows the control inside it), and each one **rendered exactly when
something points at it**, because an id naming an element that is not there
computes to the empty string — silently, with nothing on screen to show for it.

**Three, because there are three claims and they stop being true at three
different moments.** One element per claim is what makes each of them removable
on its own; a single sentence covering all three would have to outlive the
shortest-lived thing in it.

- `OCCURRED_SOURCE_ID` — "the time came from a.jpg". Dies at the first keystroke
  in the clock: §11.3's provenance rule (the owner is told a photo supplied a
  value, "so a wrong pin is attributable to the photo instead of to the editor")
  is what puts it there, and the coordinate's rule — "a note left standing
  beside a number the owner typed over is a claim they have no way to check" —
  is what takes it away.
- `OFFSET_SOURCE_ID` — "the offset came from a.jpg". §11.3 again, for the half a
  modern phone does write. Dies when the owner chooses an offset.
- `OFFSET_GUESS_ID` — "the offset beside this time is this machine's guess"
  (§11.5). Dies ONLY when the offset acquires an author, which is ruling T4-G: a
  keystroke in the CLOCK says nothing about who supplied the OFFSET, so the
  warning is still true after one and stays. It loses the photo's NAME at that
  keystroke, for `OCCURRED_SOURCE_ID`'s reason, and keeps saying the thing that
  is still checkable.

**Why §11.3's credit is not optional here**, recorded because this file argued
the other way for a day: the guess mark is `null` whenever the photo supplied
BOTH halves, so a camera reset to factory time publishes a wrong
`dy:occurredAt` — the most load-bearing fact on the entry — attributable to the
editor rather than to the file. §11.5 is silent about provenance because it does
not restate its parent, exactly as it does not restate "never overwrites";
reading that silence as a withdrawal would withdraw the no-overwrite rule with
it.

**And the sentences are one half of the guess; the `data-offset-unconfirmed`
attribute on the control is the other.** Wording alone cannot carry that state,
and this control is the proof: its PERMANENT hint already says the offset is
"not of wherever you are writing this", so a reader — or a test — fenced on
phrasing would find the same words in the confirmed cases as in the guessed one.
Every one of these is written by `withTimeCredit`, which is what stops them
drifting from each other or from the records.

## the guess note says which half the photo did not supply

Rather than only where the value came from: §11.5's whole argument is that
`21:38 +02:00` reads as data in both halves, so a note that credited the photo
without saying that would leave the owner unable to act on it.

**`null` is the state after the owner types in the clock, not a missing name.**
The claim "the offset is not from a.jpg" needs a.jpg's clock to still be in the
box to mean anything; the claim "the offset is this machine's guess" does not,
and it is the one that is still true (T4-G). So the name goes and the warning
stays, in one sentence that no longer promises something the owner cannot check.

## each control's hint comes first

Each help builder is that control's permanent hint plus whatever is currently
true about where its value came from — `coordinateHelp`'s shape, for its reason:
every half of it is silent when it is wrong. An id that names nothing computes
to the empty string, and an attribute left on permanently reads as correct
markup while announcing a reason that has stopped being true.

**The hint is always first**, so the credit or the warning is heard as an
addition to what the control is for rather than in place of it.

**One function per control rather than `coordinateHelp`'s parameters**: there
are two controls and each has its own set of things that can be true of it, and
the guess note belongs to the offset alone — the clock is not in doubt, it is
the thing the offset is in doubt BESIDE.

The guess and the credit are mutually exclusive by construction — the mark
requires the offset to be NOBODY's and the credit requires it to be a photo's —
but `offsetHelp` lists both rather than branching, because that exclusion lives
in `withTimeCredit` and a second copy of it here is a second thing to keep true.

## where the clock came from, while a photo is the answer

§11.3: "the owner is told a photo supplied a value, so a wrong pin is
attributable to the photo instead of to the editor" — and for this control the
wrong value is `dy:occurredAt` itself, which a camera reset to factory time
supplies with every confidence. The guess mark cannot carry this: it is `null`
exactly when the photo supplied BOTH halves, which is the case with nothing else
on the form to explain the date.

Rendered exactly when `occurredHelp()` names it, and the pair of them is decided
by one value for `COORDINATE_SOURCE_ID`'s reason.

## the offset control, and the four things it must not become

**It exists at all** because §7.3 says `dy:occurredAt` "carries the local UTC
offset of the place", and the clock above hands back a wall clock with no offset
in it — so without this control the offset was the entry's own or, failing that,
the zone of whatever machine the form happened to be open on. An evening in
Tokyo written up at home became `21:40+02:00`: the same instant, spelled as the
wrong time of day, which for a travel diary is most of the meaning.

**Inside the `<form>`, which is what arms the autosave.** React delivers
`onChange` to ancestors and the form's own handler is the one place `touched` is
set, so a "toolbar" spelling of this control beside the datetime input but
outside the form would move the state and arm nothing: the owner corrects
`+02:00` to `+09:00`, closes the tab, and gets `+02:00` back. That is a bug this
project has already shipped once, in the photo pipeline, for exactly this
reason.

**No `aria-label` here or on anything wrapping it**, and no
`<fieldset>`/`<legend>` pairing it with the clock. `getByLabelText` matches
`aria-label` on ANY element, this group has already lost six tests to a wrapper
that shadowed a real control, and a group named "When" would be a second thing
answering to the label above. The `<label>` inside `Field` is the only name
here.

**Held by the draft fieldset and by nothing else.** It is deliberately not tied
to `coordinatesLive`: the privacy settings decide whether a POINT may be
published, and an offset is not a coordinate. An owner whose settings cannot be
read still gets to say what time of day it was.

The option values are the offsets AS WRITTEN, because that string is what is
concatenated onto the wall clock and what the draft carries — one spelling, end
to end. The text is the same string: a list of place names would be a second
thing to keep true, and a wrong one is worse than none.

## the mark goes on the control, not on a wrapper or the note

Not on a wrapper, which is not what holds the value in doubt, and not on the
note, which is the sentence rather than the state. `undefined` rather than
`"false"` for `coordinateHelp`'s reason: an attribute left on permanently reads
as correct markup and answers a question nobody asked.
`#three-notes-one-per-claim` is why wording cannot carry this alone.

## why the offset above is not data, while that is true

§11.5, and the sentence half of it: a wall clock the photo supplied sits beside
a zone it did not, and "the owner sees 21:38 +02:00" is only a problem because
every part of that reads as a reading. The other half is
`data-offset-unconfirmed` on the control itself.

**And it is not a `role="alert"`**: a photo that works announces nothing, and a
persistent live region about the offset would leak into every save-outcome the
form reports.

Under the control and its own hint, named by `offsetHelp()`, and rendered
exactly when something points at it — `COORDINATE_SOURCE_ID`'s shape: a live
`aria-describedby` naming an element that is not there computes to the empty
string, and the owner is back to a date and a zone that appeared from nowhere.

The name in the sentence comes from the CLOCK's record, which is what makes it
lose the name at the first keystroke there while the warning stays — ruling
T4-G.

The credit below it is the other case: when the photo did carry the zone, who it
was (§11.3). Not a guess and not marked — the value is as trustworthy as the
clock beside it — but still a value that appeared without being typed, which is
the whole of `COORDINATE_SOURCE_ID`'s argument. Mutually exclusive with the
guess note by construction: that one requires the offset to be nobody's.

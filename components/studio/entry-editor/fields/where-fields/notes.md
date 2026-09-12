# where-fields — notes

The third of Stage B's five field groups, and the largest: the three place fields
§9's mitigation leans on, the coordinate pair, the grid it is published in, and
the four notes that explain the pair's two holds. No state moved.

## Props only

No `useState`, no `useRef`, no effect, and no `"use client"` directive — it
inherits the boundary from `entry-editor.tsx` for the reason `field/notes.md`
gives.

**Eighteen named props, not a spread**, which is what makes the two holds
readable as the two different things they are. `coordinatesLive` holds three
controls and `coordinateNote` says why; the editor's draft `<fieldset disabled>`
holds all six and says so in its own banner. The group knows about the first and
nothing about the second, and that separation is the §9 pin its test opens with.

`hasStoredCoordinate` replaces the `existing?.place?.geo === undefined` the
latitude hint used to read directly. **The condition is inverted and the two
branches swapped**, which is the one non-mechanical edit in this extraction; both
wordings have a case in the test file, so the swap is pinned rather than
asserted. `settingsDetail` replaces `gate.kind === "closed" && … gate.detail` for
the same reason — the gate is the editor's state, and a rendered string is what
this group needs.

**161 code lines, over the 130 tendency and under the 200 hard bound.** Reported
by `check:structure` and not a failure. Six controls, four conditional notes and
two `*Help` closures is what that is; splitting it further would separate the
coordinate boxes from the note both of them name.

## Task 7 measured the split, and 161 stays

Stage C's Task 7, 2026-09-09. Stage B's paragraph above answers the split it was
looking at — cutting the coordinate half apart from its notes. It does not answer
the one a reader would actually propose, which is the **hold boundary**: the
three place fields in one group, the three coordinate controls in another. That
is a real seam. `coordinatesLive` holds exactly one half, no IDREF crosses it,
and it is even the boundary the RDF takes — `#place` and `#address` carry the
words, `#geo` carries the point (`docs/data-model.md` §7.3).

**It was built as a probe and measured with the same ESLint rule
`check:structure` runs.** Three functions, `skipComments` and `skipBlankLines` as
configured:

| function | code lines |
|---|---|
| `PlaceTextFields` | 53 |
| `CoordinateFields` | 99 |
| `WhereFields`, now a wrapper | 47 |
| **total** | **199** |

**199 across three functions where there are 161 in one**, and the largest single
thing afterwards is still 99. The 38 added lines are all destructuring and prop
forwarding: eighteen names come apart into six and twelve, and the wrapper spells
all eighteen again to pass them on. Nothing moved except lines, which is the
failure mode this refactor is against — and the drift list would be shorter only
because 99 and 53 are both under 130, not because anything got easier to read.

**The test is the other half of the reason.** `where-fields.test.tsx` opens on
§9's asymmetry — "holds the three coordinate controls when the settings cannot be
read" asserts three controls disabled and three not, in one render, in one
component. That assertion is the mitigation: a place NAME needs no home region to
check against, so an owner whose settings cannot be read can still say where they
were. Split in two there is nothing to render that can hold it. It would have to
go up to the editor's harness, where the draft banner's own `<fieldset disabled>`
holds all six and confounds the very thing being pinned.

Six controls in the group that corresponds to one `schema:Place` reads better
than two groups and a pass-through.

## What travelled, and two handler comments that did not

Moved **verbatim**, docblocks included: `COORDINATE_NOTE_ID`,
`COORDINATE_SOURCE_ID`, `coordinateSourceNote`, and the `coordinateHelp` and
`coordinateSourceId` closures. The ids and the builder that composes them travel
together, for the reason `when-fields/notes.md` gives: split across two files
they would be one string kept true in two places.

`NO_SETTINGS_NOTE` and `CHECKING_NOTE` **stayed in the editor**, with the
`coordinateNote` derivation that chooses between them. The gate is the editor's
state and Task 7's `use-settings-gate` will own the choice; this group renders
whichever sentence it is handed.

`creditCoordinate` stayed too, so both coordinate-box handler comments stayed
with it — they are now on named `typeLatitude` and `typeLongitude` handlers in
the editor's body rather than inside a JSX attribute list, which is what keeps
the composition one line per prop.

## Bearings that went stale in the move

Recorded rather than repaired, per `field/notes.md`'s precedent.

1. `COORDINATE_NOTE_ID`'s docblock ends "Measured for the Save button's own hold,
   forty lines further down this file." The Save button stayed in
   `entry-editor.tsx`; the measurement is in the docblock on the button itself.
2. `COORDINATE_SOURCE_ID`'s docblock says "This file has the receipt for the
   wrapper spelling: a `<section aria-label="Photos">` around the picker made six
   tests fail." The picker is `fields/photo-fields/`'s from the next commit.
3. The three-controls docblock inside the JSX says the two holds compose "exactly
   as `saving` and the fieldset do on the Save button" — both of which are now in
   another file. The claim is still true; only the sightline is gone.

## What this test pins

Rendered directly with props, never through the editor's harness
(`field/notes.md#why-not-import-the-harness`).

1. **All six controls named, typed and holding their values**, `type="number"`
   on the two boxes included.
2. **§9's asymmetry, from both ends.** With `coordinatesLive: false` the three
   coordinate controls are disabled and the three place fields are not; with it
   true, none of the six is. A group that dimmed all six passes the first three
   assertions.
3. **Every edit reaches its own callback and each is called exactly once.** Six
   controls, six spies, and the count asserted — crossing two wires passes every
   value assertion on its own.
4. **The hold note is named by all three held controls**, and absent — element
   and IDREF both — when the settings answered.
5. **The provenance note is named by the two boxes and NOT by the precision
   select.** That is `coordinateHelp`'s "THE SOURCE NOTE IS PASSED IN RATHER THAN
   READ HERE" argument as an assertion: a helper that added it unconditionally
   would have the select announce where a coordinate came from.
6. **One note for the pair, not one per box** — asserted by count, which is the
   only way the "two sentences saying the same thing" failure shows up.
7. **The failure's technical detail is rendered and is outside the association.**
   Both halves: the text is on screen, and no held control's description contains
   the status code.
8. **Both latitude hints**, which is what makes the inverted condition safe.

---

# What the comment sweep moved here

Stage C's Task 6. Each section is the block that stood at the point its pointer
now names; nothing was dropped, and the compression is in the wording only.

## the holds association goes on each control

`COORDINATE_NOTE_ID` is one end of the association between the dead coordinate
controls and the sentence saying why, and it is a constant for
`HOLD_REASON_ID`'s reason: an `aria-describedby` naming an id nothing renders
computes to the empty string, with no error and nothing on screen to show for
it, and the control is back to announcing itself as unavailable and no reason.

It goes on each of the three controls and **not** on a fieldset around them.
That spelling reads better and is heard by nobody — a `<legend>` names a group
and nothing propagates a group's DESCRIPTION to its members. Measured for the
Save button's own hold, which is in `../../entry-editor.tsx`.

## one provenance note for the pair

`COORDINATE_SOURCE_ID` is the provenance note's end of the association — one
element for the PAIR, not one per box, and both boxes point at it.

**One, because the coordinate is one value.** A latitude and a longitude are two
halves of one point: `coordinateAuthor` records a single author for the pair (a
photo can never supply half a coordinate — `lib/media/exif.ts` sets `gps` only
when both tags are present — so mixing sources is something only the owner could
cause, and refusing both boxes is the cure), and two sentences saying the same
thing beside each other is noise for anyone hearing them read out one after the
other.

**`aria-describedby`, through `coordinateHelp`, and not an `aria-label` on a
wrapper.** The editor has the receipt for the wrapper spelling: a `<section
aria-label="Photos">` around the picker made six tests fail with "found multiple
elements", because a wrapper with a name shadows the control inside it. A
description adds no accessible name and cannot collide with any label on the
form.

**Not rendered when there is nothing to say**, for `COORDINATE_NOTE_ID`'s
reason: an id naming an element that is not there computes to the empty string,
silently, and an attribute left on permanently announces provenance for a number
the owner has since typed themselves.

## every half of coordinateHelp is silent when wrong

`coordinateHelp` builds the ids one coordinate control describes itself by: its
own hint, if it has one, the hold note while there is one, and — for the two
BOXES — the provenance note while a photo is credited with what they hold.

Built rather than written out because **every half is silent when wrong**. An id
that names nothing computes to the empty string, and an attribute left on
permanently reads as correct markup while announcing a reason that has stopped
being true. `undefined` rather than `""` for the same reason: no attribute at
all is the honest spelling of "nothing to say".

**The source note is passed in rather than read here**, because it belongs to
two of the three controls and not to the third: the precision select is about
the grid a point is published in, and a photo has no opinion about that. A
helper that added it unconditionally would have the select announce where a
coordinate came from, which is true of neither its value nor its effect.

`coordinateSourceId` is the same value that decides whether the note renders at
all, on purpose — that is what keeps `coordinateHelp` from pointing at an
element that is not there.

## the place text sits above the coordinate and is not held with it

Where the owner was, in words — the three fields §9's mitigation leans on, and
the reason they sit immediately above the coordinate: a place is one subject, and
the entry's answer to "where" is these four controls together.

**They are not held by `coordinatesLive`**, and that is the point of putting them
beside it rather than inside it. The coordinate controls go dead when the privacy
settings cannot be read, because there is no home region to check a point
against; a place NAME needs no such check — it is prose the owner chose,
published exactly as typed — so an editor that dimmed these three alongside the
coordinate would leave an owner with no settings unable to say anything at all
about where they were. They are inside the draft fieldset with everything else,
for the reason everything else is: one storage slot.

**No `aria-label` on this block or anything wrapping it**, and no
`<fieldset>`/`<legend>` grouping the four. `getByLabelText` matches `aria-label`
on ANY element, this group has already lost six tests to a wrapper that shadowed
a real control, and a legend reading "Place" would be a fifth thing for the
form's own queries to find. The `<label>` inside each `Field` is the only name
here.

The country box is **a code, not a name** (§7.3): `schema:addressCountry "JP"`,
written untagged, because `"JP"@en` is a different RDF term from `"JP"` and every
consumer filtering on the plain literal would stop matching. The hint is what
stops the owner typing "Japan" — nothing downstream can tell the two apart.

## two independent holds that compose

The three coordinate controls are inside the held fieldset with the others.
Nothing about them is special enough to stand outside it: one storage slot, so
an unanswered banner must not be typed past here either, and a latitude typed
behind the banner is a latitude the local copy is not keeping.

**They carry a second, independent hold** — `disabled={!coordinatesLive}` — and
the two COMPOSE rather than replace one another, exactly as `saving` and the
fieldset do on the Save button. The fieldset says "answer the banner first";
this says "there are no settings to publish a coordinate against". Respelling
either as the other passes every attribute assertion and reopens the case it was
not spelled for.

**No nested `<fieldset disabled>` around the three**, tempting as it is: it
would carry the `disabled` once, and it would carry the REASON nowhere. Nothing
propagates a group's description to its members — measured for the Save button's
hold, and the same measurement applies here — so the association has to be on
each control regardless, and a `<legend>` would add a fourth thing named
"coordinates" for the form's own queries to trip over.

## where the pair came from, while a photo is the answer

Under the two boxes and above the precision select, because that is what it is
about — one sentence for the pair, named by both boxes' `aria-describedby`
(`#one-provenance-note-for-the-pair` for why one and not two, and why not an
`aria-label` on a wrapper).

**Rendered exactly when something points at it**, which is
`coordinateSourceId`'s only other use: a live `aria-describedby` naming an
element that is not there computes to the empty string, silently, and the owner
is back to a number that appeared from nowhere.

The precision select's own note is §9 step 3: whatever it says,
`dy:precisionMeters` says the same and the pair beside it is that grid's. The
owner's own `dy:defaultPrecisionMeters` is preselected and is in the list
VERBATIM — `hooks/studio/notes.md#the-settings-value-joins-the-option-list` for
why it is not rounded onto the fixed grids in either direction. Its
`"Unavailable"` option is only ever reachable with the control dead: §7.6 has no
default and this app supplies none, so an empty value means the settings have
not answered or could not be read, and a controlled `<select>` whose value
matches no option renders blank — which reads as a list someone forgot to fill
in.

## why the three above are dead, on screen and associated

§9: "an entry silently losing its map pin becomes a bug report, whereas 'you
have not set a home region yet' is a one-time setup step with an obvious fix."

Rendered exactly when something points at it — a live `aria-describedby` naming
an element that is not there computes to the empty string, silently, and the
control is back to announcing itself as unavailable with no reason given.

The failure's technical detail is rendered **outside** the association, for the
same reason the save's detail is outside the announced region: the sentence
above is what a person can act on, and a screen reader should not read a Pod URL
out character by character to deliver it.

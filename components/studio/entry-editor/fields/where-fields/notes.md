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

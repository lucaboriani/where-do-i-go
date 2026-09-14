# e2e — notes

## The three mutation controls

`docs/superpowers/specs/2026-09-13-map-timeline-stage-4a-design.md:119-123` requires the browser
case to prove both the marker's class **and** the leg's feature state, and to prove the route half
without a pointer; §1 requires the other direction too, hovering a marker to light the row.
`e2e/trip-timeline.spec.ts` is three tests for those three reasons.

**The seed now carries a real second entry, and its entry resource.** The §7.4 fixture's
`entries.ttl` names `<#e-2026-03-31-nara>` in `dy:entry` but never describes it —
`lib/pod/read.ts` correctly drops an undescribed link (`lib/pod/read.test.ts`'s "skips a dy:entry
link the document does not describe"), so the seeded trip used to have exactly one placed entry
and zero legs (`lib/map/legs.ts`'s `buildLegs` starts at `placed.slice(1)`).
`scripts/seed-dev-pod.ts` now gives that second entry the fields it needs — `dy:slug`,
`dy:lat`/`dy:long`, `dy:precisionMeters`, `dy:sortOrder 2` — **in the seed, not in
`docs/data-model.md`**, which stays the normative, unmodified fixture `validate:fixtures` parses.
It also PUTs `entries/2026-03-31-nara.ttl`, the resource that index entry points at: without it
the build prerendered a "Not found" page for a slug the timeline links to. The file name is the
slug because `assertEntrySlug` rejects a mismatch. This is the same shape as the `2026-secret`
trip below it: real edits to the extracted fixture text before the `PUT`.

**Mutation control 1, measured 2026-09-13 — `promoteId`, and a false pass caught along the way.**
The first version of this assertion called `map.getFeatureState({ source: "trip-legs", id })`
directly and compared the result. Removing `promoteId: "toSlug"` from
`hooks/map/use-map-layers.ts`'s `trip-legs` source did **not** turn it red — `getFeatureState` is a
plain key-value store keyed by whatever id you pass it, set and read back regardless of whether
any real feature carries that id, so the assertion was proving the hook calls the API, not that
the API's effect reaches the painted geometry. Fixed by querying the actually-rendered feature
instead — `map.queryRenderedFeatures(undefined, { layers: ["trip-route-line"] })[0].state`, which
MapLibre computes from whatever id the renderer actually assigned. With `promoteId` removed this
returned `{}` (20 s timeout, doc'd below); restoring it returned `{ active: true }` immediately.

**Mutation control 2, measured 2026-09-13 — the route.** Making `useHighlightState` ignore its
`routeSlug` argument (returning the pointer-or-null base regardless) turned the second test red:
the marker never gained `ring-2` because nothing during a bare `page.goto` with no prior hover ever
raises a highlight. Restoring the route fallback returned it to green. This is what makes the test
a genuine isolation of the route path rather than a hover-then-navigate sequence that could pass
on stale pointer state alone.

**Mutation control 3, measured 2026-09-13 — the map → timeline direction.** Deleting the two
`element.addEventListener` lines in `hooks/map/use-map-markers.ts` turned the third test red at
`expect(naraRow).toHaveAttribute("data-active", "true")` (5 s timeout, the row never gained the
attribute); restoring them returned it to green in 1.6 s. This is the control that matters most
of the three, because the listener is the whole feature: the row's own styling is driven by
`activeSlug` alone and would keep passing the timeline → map test with no map listener anywhere.

## The map handle attached for e2e

See `components/public/trip-map/notes.md#the-map-handle-attached-for-e2e` — the `__map` property
`TripMap` stamps onto its own container node is what the first test above queries
`queryRenderedFeatures` through, and why it exists at all rather than reading the canvas.

## the eleven map-sheet controls

`e2e/map-sheet.spec.ts` is four cases, and every one of them passed the first time it was run —
which is what stage 4b's spec §11 says to distrust, since tasks 4–7 had already landed. Each
mutation below was applied on 2026-09-14, the spec run, the named case watched go red, and the
mutation reverted with `git checkout --`. The two that killed nothing on their first attempt are
recorded here as findings, because they are what made two of the cases real.

| # | Mutation | Case it kills | The failure |
|---|---|---|---|
| 1 | `app/globals.css`: `.trip-sheet { pointer-events: auto }` | 2 and 3 | `Expected "2026-03-31-nara" / Received undefined`; then `locator.click` times out, the sheet intercepting |
| 2 | `use-map-markers.ts`: delete `event.stopPropagation()` | 2 and 3 | both at the `data-active` line that follows the cursor leaving — `Expected: "true" / Received: ""`, `unexpected value "null"` |
| 3 | `map-sheet.tsx`: the ref on `.trip-sheet-spacer-peek` | 1 | `Expected: 240 / Received: 576` |
| 4 | `app/globals.css`: delete `scroll-margin-top` | 1 | `Expected: 64 / Received: 0` |
| 5 | `layout.tsx`: the map pane inside `<MapSheet>` | 4 (and 1, 3) | `contained: true`; 1 and 3 die on a canvas that intercepts the handle |
| 6 | `map-sheet.tsx`: the reveal effect keyed on `source === "pin"` | 2 | `Expected: >= 240 / Received: 0` |
| 7 | `use-map-markers.ts`: delete `map.on("click", deselect)` | 3 | `not.toHaveAttribute` → `Received: "true"` |
| 8 | `app/globals.css`: delete the desktop `.trip-sheet` block | 4 | `Expected: "static" / Received: "fixed"` |
| 9 | `app/globals.css`: delete `position: sticky` from the desktop pane | 4 | `Expected: "sticky" / Received: "fixed"` |
| 10 | `trip-map.tsx`: a `matchMedia` width branch keying the container | 4 | the canvas never comes back after the resize; the identity line times out |
| 11 | `map-sheet.tsx`: `cycle()` calls `unpin()` | 3 | `unexpected value "null"` at the re-assertion between the handle click and the map tap |

**Control 2 left case 2 green, and the case was the thing wrong.** With `stopPropagation` gone the
tap pins and the map's own click handler clears it in the same gesture — and the row stayed
`data-active` anyway, because Chrome's emulated `mouseenter` fires BEFORE `click`, so the hover
was holding the highlight up on its own. The case was asserting the pointer, not the pin. It now
moves the cursor off the marker first, which is the only state in which `data-active` can have
come from the pin.

**And the pin is not batched away, which is the other thing control 2 measures.** Re-run on
2026-09-14 against the final spec, it kills BOTH cases at that `data-active` line — case 2 after
its `>= 240` assertion has already **passed**. So the tap's `pin` and the map handler's `unpin` do
not collapse into a single commit: React renders the pin, the reveal effect runs on it and scrolls
the sheet, and only then does the unpin land. Worth knowing before reasoning about this pair from
the code — the failure a reader expects here is a sheet that never moved, and that is not what the
browser does.

**The mechanism, read from source rather than measured here** — the timing above is the
measurement; this is only the explanation for it. The marker's own handler and the map's are two
separate listener invocations of ONE DOM dispatch (`maplibre-gl` binds `click` on
`getCanvasContainer()` in `HandlerManager`, above the marker elements), and the HTML spec runs a
microtask checkpoint after each listener returns — which is where React's `scheduleMicrotask`
commits the pin. So the reveal effect runs between the two listeners, not after both.

**Control 6 then left it green too, for the opposite reason.** That `mouse.move` supplies the very
`mouseleave` the stage's defect needed to open the sheet late: keyed on the derived `source`, the
effect reads `"map"` on the tap that pinned and fires only once the pointer leaves. So the sheet
assertion runs FIRST, with the cursor still on the marker, and the row assertion after the move.
The order is the control — swap the two lines and control 6 passes again.

**Control 11 exists because case 3 had one positive assertion and one negative with a handle click
between them.** That is the shape this repository keeps finding: make the sheet's own cycle clear
the pin — plausible product behaviour, and no other case notices — and case 3 would have gone green
with map-background clearing entirely broken. It now re-asserts `data-active` AFTER the cycle and
before the tap, so the pin is proven live at the moment the tap happens; control 11 is the mutation
that would have slipped through and now does not, killing case 3 at that line and nothing else.

**Control 5 does not move either computed `position`, which the brief expected it to.** Nesting
the pane inside the sheet leaves `.trip-map-pane` matching the same class selector, so it is still
`sticky` and the sheet is still `static`; only `sheet.contains(pane)` sees it. That containment
assertion is case 4's real content and the positions are the decoration, not the other way round.

**One assertion in the file has no control: the canvas identity in case 1.** Nothing re-renders
while the sheet scrolls — `cycle()` sets no React state — so no edit short of adding a remount path
can make that `===` fail, and control 10 (which does add one) leaves case 1 green because the width
never changes there. It is kept because spec §11 asks for it by name, as a tripwire for a remount
path that does not exist today. Case 4's identity assertion is the one with teeth, and control 10
is why.

**What the desktop case cannot assert: that sticky actually sticks.** With the seeded trip the
document does not scroll at any desktop height — measured at 1280×800 and 1280×420, both
`scrollHeight === innerHeight`, because the sheet body's content is 284px and the map pane's
`100dvh` sets the grid row. So `position: sticky` is asserted as a computed value and the
`align-self: start` trap beside it in `app/globals.css` — a stretched grid item cannot stick — is
covered by no case here. The brief's `page.mouse.wheel(0, 400)` was dropped rather than kept as a
scroll that scrolls nothing.

## the strip of map is a detent not a pin

Spec §5 promises an 8dvh strip of map at full, and §5 leans on it: the background tap that clears a
pin needs something to land on. **That strip is there at the full DETENT and not after a pin.**
`targetForRow` aims at `rowTop − handleHeight`, which for the seeded trip's second entry is past
the end of the scroller, so the sheet rests at its maximum — measured `scrollTop` 640 of a 640
maximum, sheet body top rect 0, no map on screen at all. `document.elementFromPoint(20, 20)` there
returns `.trip-sheet-handle`, so a "tap the map" at that corner cycles the snap points instead.

The same holds whenever the revealed row is far enough down, which §2 already accepted for the
scroll position; what it did not say is that the affordance §5 names goes with it. So the third
case cycles the handle back to peek before tapping the corner, and asserts `elementFromPoint` is
the canvas before it clicks — otherwise a tap that lands on the sheet reports as a pin that would
not clear. Recorded, not fixed: no production code was changed for this task.

**And that wait is polled as the exact end, 640, not as `>= 240`.** The loose form flaked once in
five runs on a loaded machine, and the failure was `Expected: 0 / Received: 576` at the line AFTER
it: a `>= 240` poll is satisfied mid-flight by a smooth scroll, so `cycle()` then read a moving
`scrollTop`, saw a value below `full`, and cycled to full instead of peek. Polling the scroller's
maximum can only be satisfied once the scroll has stopped, which is what makes the handle click
deterministic. Case 2 keeps `>= 240` on purpose — there the assertion IS "it moved", and nothing
after it depends on where it came to rest.

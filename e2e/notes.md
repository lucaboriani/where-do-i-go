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

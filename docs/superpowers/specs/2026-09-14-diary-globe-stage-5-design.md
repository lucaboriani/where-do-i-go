# Phase 4 stage 5 — the all-trips globe

The second map surface. `/` stops being a list of slugs in a column and becomes the same shape the
trip page took in 4b: a map with the reading surface over it on a phone, beside it on a desktop.

Read §8 of `2026-09-09-map-and-timeline-design.md` first, and the whole of
`2026-09-14-map-sheet-stage-4b-design.md` — this stage reuses 4b's tree rather than inventing a
second one. Where this file contradicts either, this file is newer and wins.

## 1. What ships

- A globe on `/`, lazily mounted, one marker at each published trip's `center`.
- Clicking a marker flies the camera to that trip's `bbox`; hovering it highlights the trip's row,
  and hovering the row highlights the marker. Navigation stays in the list's links.
- The same responsive shell as the trip page: below `48rem` the map fills the viewport with the
  trip list in the sheet over it; at and above, a sticky map beside the scrolling list.
- A **second published trip in the dev seed**, without which none of the above is testable.
- **A measurement, and whatever it implies**: whether `/` → trip A → back → trip B remounts the
  `[slug]` layout, which is what decides if the stage-3 defect is reachable at last.
- `docs/decisions.md` **§33** — trip markers are GL circles, not the DOM markers §30 chose.

Out of scope and named so they are not smuggled in: clustering trips, a thumbnail on a trip marker,
any change to the trip page's own map, drafts appearing anywhere, and any `dy:` term. Phase 5's
publish flow is where the publication boundary changes, not here.

## 2. The tree, and why it is the page rather than a layout

```
app/(public)/page.tsx
└── TripHighlightProvider
    └── div.trip-shell
        ├── div.trip-map-pane   →  <Suspense><DiaryMap …/></Suspense>     ← sibling
        └── MapSheet            →  <TripList …/>                          ← sibling
```

4b put the shell in `app/(public)/trips/[slug]/layout.tsx` because one MapLibre instance had to
survive trip → entry navigation. **`/` has no child routes**, so there is nothing to survive and
the shell belongs in the page. The sibling rule still holds and for the same reason: no snap point
and no breakpoint may have a code path that unmounts the map.

`TripHighlightProvider` reads `useSelectedLayoutSegment()`, which is `null` on `/`. The route-driven
highlight is therefore simply absent here, and `activeSlug` is whatever the pointer or a pin says —
no special case, no second provider.

## 3. Nothing is renamed, and that is deliberate

`.trip-shell`, `.trip-map-pane`, `.trip-sheet*` and `hooks/trip/**` keep their names. On both
surfaces the thing held in the sheet and highlighted on the map **is a trip** — on `/` the list is
trips, in `[slug]` the timeline is a trip's entries and the highlight is keyed by entry slug within
one trip. The names describe the domain, not the route.

The alternative — renaming to `map-shell`/`map-pane`/`sheet` — would churn freshly merged CSS, four
`notes.md` anchors, and live e2e locators, in exchange for nothing a reader gets wrong. Recorded
here so a reviewer does not raise it as an oversight.

## 4. Trip markers are GL circles, not DOM markers — §33

Decision §30 made entry markers DOM elements built by hand, for two reasons that do not apply here:
they carry a photo thumbnail, and above fifty they cluster. A trip marker has no thumbnail to show,
and a diary with fifty published trips is not a problem this project has.

So the trips source is one GeoJSON source with `promoteId: "slug"` and a `circle` layer, and the
active trip is painted by `setFeatureState({ source, id: slug }, { active: true })` — the exact
mechanism 4a proved on legs, where the id had to be promoted before feature state had anything to
key on. Hover comes from `map.on("mouseenter"/"mouseleave", layer)` rather than per-element
listeners.

**What this costs, stated plainly**: two marker mechanisms now exist in one codebase, and a reader
must know which surface uses which. §33 records the rule — thumbnail or clustering means DOM, plain
points mean GL — so the next surface picks by criterion rather than by copying whichever file it
found first.

## 5. The projection, and the one call site

`lib/map/view.ts` gains `GLOBE_PROJECTION = { type: "globe" }` beside the existing mercator
`PROJECTION`, and `useMapInstance` gains an optional `projection` defaulting to the latter. **The
single `setProjection` call inside the `style.load` handler does not move** — it reads the option
instead of the constant. That is the whole of the change to a hook three surfaces now share.

§8's measurement stands and is not re-derived: `"globe"` is shorthand MapLibre 6 expands to
`["interpolate", ["linear"], ["zoom"], 11, "vertical-perspective", 12, "mercator"]`, so the globe
flattens between z11 and z12 rather than fighting a reader who zooms in. `"vertical-perspective"`
is the always-globe value and is **not** what this uses.

## 6. Data, and what it costs

Per published slug: `getTrip` for the name and status, `getTripIndex` for `center` and `bbox`.
Both are already `use cache` with `cacheTag`, so this is 2N cached reads — four today.
`publishedTripSlugs` already exists and is already the publication boundary, because trips have no
index resource acting as one.

A trip with no `center` is a trip with no marker. It still gets a row in the list, and the list is
the navigation, so an unplaced trip is never unreachable. A trip whose index fails to read is the
same case: the row stands, the marker is absent, and `describe(error)` never reaches the page for a
single trip's failure — losing one index must not lose the diary.

`lib/map/trips.ts` is the pure half, three functions, none of which touches a DOM or a map:
`buildTripPoints(trips)` → a `FeatureCollection<Point, { slug, name }>`; `centresBbox(trips)` → the
`Bbox` enclosing every placed trip's centre, or `undefined` when none is placed; and
`flyOptions(bbox)` → the same shape `fitOptions` returns but with `animate` true, because the
camera call in both cases is `fitBounds`. That is where this stage's coverage actually is.

## 7. The camera

On load, the globe fits `centresBbox` — the box enclosing every trip's centre, not any single
trip's own bbox, which would be a view of one trip. With one placed trip that box degenerates to a
point and `fitBounds` would zoom to its maximum, so `centresBbox` pads a degenerate box into a
sensible one. The pure function owns that and is tested for it.

Clicking a marker calls `map.fitBounds(...flyOptions(bbox))` for that trip — the same call the
initial fit makes, animated. **`prefers-reduced-motion: reduce` turns
the flight into a jump** — `animate: false`, not a shorter duration. The brief allows motion that
answers a user action and requires the query be respected; a fly-to is exactly that motion.

Nothing else moves the camera. Hover does not, the route does not, and there is no "reset" control.

## 8. The seed gains a second published trip

`scripts/seed-dev-pod.ts` seeds one published trip and one draft. A globe rendering a single marker
exercises nothing: no fly-to worth watching, no second feature state, no multi-trip camera fit.

So the seed gains a published trip far from Japan, with its own container, `trip.ttl`, index and a
couple of entries carrying real coordinates. **`2026-secret` stays a draft** — it is the fixture
that proves the publication boundary in phase 1 and 2 tests, and publishing it would delete that
coverage to save a few lines.

This is fixture data. No `dy:` term is added or changed, and the container layout is the one
`docs/data-model.md` already specifies.

## 9. The measurement this stage owes, before any fix

The stage-3 defect — marker identity, the cluster threshold and the fitted camera are all fixed by
whichever trip's data the map hooks saw first — has been recorded as "unreachable, closes in stage
5" through three stages. **Stage 5 must find out rather than inherit the claim.**

The question is narrow: does navigating `/` → `/trips/a` → back → `/trips/b` remount the `[slug]`
layout? If it does, the hooks are constructed fresh for trip B and nothing is stale, and the defect
stays unreachable — in which case **this stage records that and stops predicting a future stage will
close it**. If it does not, the defect is live, and the fix belongs in this stage with the failing
browser case that found it.

The measurement runs after the seed lands and before any hook is touched, in a real browser, with
the canvas node's identity as the evidence — the same `===` on a captured handle that 4b used.
**A fix written before this measurement would be a fix with no failing test, which is the thing
`CLAUDE.md` names.**

## 10. Testing

- **Pure, by vitest**: `buildTripPoints` including a trip with no `center` and a trip whose index
  failed; `flyOptions`; the all-centres fit including the single-trip degenerate case.
- **Components in jsdom** against the existing fake `maplibre-gl`: the source gets `promoteId`, the
  circle layer is added, a hover sets feature state, a click flies with the right bounds, and
  `prefers-reduced-motion` is read on the call rather than asserted through a class.
- **One browser case**, and it earns its place the way the others did: a real canvas on `/`, two
  markers, a click that moves the camera, and the cross-highlight in both directions. Plus the §9
  measurement, which is a browser case whether or not it becomes a regression test.
- **Every browser case gets a mutation control**, recorded in `e2e/notes.md`. Seven of 4a's checks
  and two of 4b's could not fail until a mutation said so.
- `size:public` weighs `/` — the most visited page in the app — so the landing route's budget line
  is the one to read this stage. The map chunk is lazy and is not weighed; a static import of
  `maplibre-gl` would be, and the fence already refuses it.

## 11. What no check here will see

- **The globe itself.** `size:public` is indifferent, jsdom has no WebGL, and the e2e asserts a
  canvas exists — not that a sphere was drawn. A projection silently falling back to mercator would
  pass everything. §8's expansion is read from the shipped source rather than observed.
- **iOS Safari**, still: Chromium only, as §26 records.
- **A fly-to that lands somewhere wrong.** The e2e can assert the camera moved and roughly where;
  "the reader sees the trip" is a judgment no assertion makes.
- **A trip whose `center` is present but wrong** — the data model does not constrain it against the
  entries' own coordinates, and nothing here adds that.

## 12. Open, and deliberately not decided here

- **Whether the landing globe and the trip map should ever share one instance.** They are different
  routes and different data; sharing would mean hoisting the map into the public root layout, which
  is a much larger change than this stage.
- **A trip marker's visual treatment beyond a circle** — phase 7 owns look and feel.
- **`dy:track`**, the namespace blocker, and the fifteen phase-3 follow-ups: untouched.

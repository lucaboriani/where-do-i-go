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
- **The stage-3 defect's claim, closed by argument rather than deferred a fourth time** — see §9.
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

`TripHighlightProvider` reads `useSelectedLayoutSegment()`, which is `null` on `/` — verified
against Next's own source, where the `__PAGE__` child segment is dropped and mapped to `null`. The
route-driven highlight is therefore simply absent here, and `activeSlug` is whatever the pointer or
a pin says — no special case, no second provider.

**The `<Suspense>` is real, not decorative**, and that constrains the page: `page.tsx` must not
await its reads itself, or the shell cannot flush before the Pod answers. It pushes them into an
async child exactly as `app/(public)/trips/[slug]/layout.tsx` does, and the boundary's fallback
reserves the map frame with the shared class.

**The diary's own title and description move into the sheet**, above the list, where the page's
`<main>` copy is today. The `!diary.ok` branch keeps the shell — an unreachable diary still renders
the map pane and puts `describe(error)` in the sheet, because the alternative is a page that throws
away a working map to show one line of text.

## 3. Nothing is renamed, and that is deliberate

`.trip-shell`, `.trip-map-pane`, `.trip-sheet*` and `hooks/trip/**` keep their names. On both
surfaces the thing held in the sheet and highlighted on the map **is a trip** — on `/` the list is
trips, in `[slug]` the timeline is a trip's entries and the highlight is keyed by entry slug within
one trip. The names describe the domain, not the route.

The alternative — renaming to `map-shell`/`map-pane`/`sheet` — would churn freshly merged CSS, four
`notes.md` anchors, and live e2e locators, in exchange for nothing a reader gets wrong. Recorded
here so a reviewer does not raise it as an oversight.

**One thing genuinely is wrong on `/` and it is copy, not a class name.** `MapSheet`'s handle is
labelled "Resize the entry list", which is false on a page listing trips. The label becomes a prop
with today's string as its default, so the trip page is untouched and `/` passes its own. Related
and deliberate: the sheet's initial-open effect keys on `source === "route"`, which never fires on
`/`, so the landing sheet always starts at peek — correct, because there is no entry whose prose
would otherwise be below the fold.

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
must know which surface uses which. §30's own words are "a cluster never touches a photo, so it
never needs the DOM" — clustering was always GL, and the DOM half was bought by the photo thumbnail
and the hand-walked `querySourceFeatures` loop that keeps marker elements in step with it. §33
records the criterion that follows: **a marker that carries a photo is DOM, a marker that is a plain
point is GL.** The next surface picks by that rather than by copying whichever file it found first.

## 5. The projection, and the one call site

`lib/map/view.ts` gains `GLOBE_PROJECTION = { type: "globe" }` beside the existing mercator
`PROJECTION`, and `useMapInstance` gains an optional `projection` defaulting to the latter. **The
single `setProjection` call inside the `style.load` handler does not move** — it reads the option
instead of the constant, and that call site is the ONLY reader of `PROJECTION` in the tree. The hook
has one caller today and two after this stage.

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

`lib/map/trips.ts` is the pure half, **two functions** — neither touches a DOM or a map:
`buildTripPoints(trips)` → a `FeatureCollection<Point, { slug, name }>`, and `flyOptions(bbox)` →
**the same object shape `fitOptions` returns**, with `animate` true. The second is destructured at
the call site the way `use-map-instance.ts` already destructures `fitOptions`
(`const { bounds, ...camera } = …; map.fitBounds(bounds, camera)`), because the camera call in both
cases is `fitBounds`. That is where this stage's coverage actually is.

**Corrected 2026-09-14, after the code shipped.** This section listed a third function,
`centresBbox(trips)`, for the initial fit §7 described. It was never written and the fit was
dropped — §7 has the measurement. `grep -r centresBbox` over `lib`, `hooks`, `components`, `app`
and `test` returns nothing.

**The impure half is one new hook in `hooks/map/`**, not a parameterisation of the existing ones.
`useMapLayers` takes `IndexEntry[]` and adds the legs source, the cluster layers and the route
casing; `useMapHighlight` hardwires `LEGS_SOURCE`. Bending either into serving trips as well would
put two unrelated shapes behind one signature to save a file. `hooks/map/use-map-trips.ts` owns the
trips source, its circle layer, the hover and click handlers and the camera — and because it lands
in an area that already exists, none of the three hand-typed lists a NEW `hooks/<area>` must join
needs touching.

## 7. The camera

**Corrected 2026-09-14: there is no initial fit.** The globe opens on MapLibre's own default
camera, constrained to the pane, and the first thing that moves it is a marker click. `DiaryMap`
passes no `bbox` to `useMapInstance` and makes no camera call at all — the camera is
`useMapTrips`'s, whole.

What this section used to specify was a load-time fit of `centresBbox`, the box enclosing every
placed trip's centre. A reviewer computed it before it was written: naive `Math.min`/`Math.max`
over longitudes has no antimeridian handling, so the seed's two centres (`134.8414` and
`-73.0119`) give a box **207.9° wide running the long way round via Africa** — 212.6° on the
plan's own fixture pair, which used the entry coordinates rather than the centres. The camera
would have centred on neither trip but on inland East Africa, around 33°E and −7°, which reads as
a broken map rather than an overview. A correct
version would have to choose the short way round and then wrap — real work, for a view no one had
asked for. It was dropped, `centresBbox` was never written, and passing a `bbox` to `useMapInstance`
as well would in any case have raced the click handler's own `fitBounds` on `style.load`.
`components/public/diary-map/notes.md` carries the same reasoning at the component.

Clicking a marker fits that trip's own `bbox` with `flyOptions`, animated — the only `fitBounds`
call on this surface. **`prefers-reduced-motion: reduce` turns the flight into a jump**, and
that is belt-and-braces rather than the mechanism: maplibre-gl 6.6.0 already zeroes the duration
when the query matches and the movement is not `essential`. The explicit `animate: false` exists so
a jsdom test can assert the decision rather than trust the library, and this says so instead of
claiming to be the only thing between the reader and a spin.

Nothing else moves the camera. Hover does not, the route does not, and there is no "reset" control.

**A click also pins**, through 4b's existing `pin`/`unpin`. That is what makes the phone case
coherent: the sheet already scrolls a pinned slug's `[data-slug]` row into view, so tapping a marker
reveals its row instead of highlighting one hidden behind the sheet. The list's rows therefore carry
`data-slug`, exactly as the timeline's do.

## 8. The seed gains a second published trip

`scripts/seed-dev-pod.ts` seeds one published trip and one draft. A globe rendering a single marker
exercises nothing: no fly-to worth watching, no second feature state, no multi-trip camera fit.

So the seed gains a published trip far from Japan, with its own container, `trip.ttl`, index and a
couple of entries carrying real coordinates. **`2026-secret` stays a draft** — not because a unit
test names it (none does; the publication-boundary tests carry their own fixtures) but because it is
the only draft in a running dev Pod, and it is what makes the not-found path something a person can
walk through in a browser.

This is fixture data. No `dy:` term is added or changed, and the container layout is the one
`docs/data-model.md` already specifies.

## 9. The stage-3 defect: closed by argument, because the measurement cannot answer it

The defect — marker identity, the cluster threshold and the fitted camera are all fixed by whichever
trip's data the map hooks saw first — has been recorded as "unreachable, closes in stage 5" through
three stages. The draft of this spec proposed measuring it by navigating `/` → trip A → back → trip
B. **That measurement cannot distinguish its two outcomes**, and the reason matters: the path goes
through `/`, which is outside the `[slug]` subtree, so the layout and its map are torn down whatever
Next does with sibling dynamic params. The result would read "remount" in both worlds.

The question the note at `components/public/trip-map/notes.md` actually poses is a **direct** trip A
→ trip B soft navigation, and the same note records that an injected `<a>` cannot fake one. §1 keeps
navigation in the list's links, which always route through `/`, so **this stage adds no such link
either**.

So the honest close is structural, not empirical: **no in-app link joins two trips, stage 5 does not
add one, and the three stale assumptions therefore remain unreachable.** They are real and they are
still in the tree — `useMapLayers` fixes `cluster` at `addSource` and afterwards only calls
`setData`; `useMapInstance` fits once from `style.load` against `latest.current`; `useMapMarkers`
skips a slug it already holds rather than updating it. `TODO.md` stops predicting a stage that will
close them and records instead what would have to exist first: a trip-to-trip link, which is a
product decision nobody has taken.

**No fix ships in this stage**, because a fix with no failing test is the thing `CLAUDE.md` names.

## 10. Testing

- **Pure, by vitest**: `buildTripPoints` including a trip with no `center` and a trip whose index
  failed; `flyOptions`; the all-centres fit including the single-trip degenerate case.
- **Components in jsdom against a fake `maplibre-gl`** — and note that **there is no shared fake to
  reuse**: `use-map-instance.test.ts` and `use-map-layers.test.ts` each declare a private `FakeMap`,
  `trip-map.test.tsx` mocks the four hooks rather than the library, and neither fake implements
  `setFeatureState` or the layer-scoped three-argument `on(event, layer, handler)`. Both are new
  surface this stage has to write. Asserted: the source gets `promoteId`, the circle layer is added,
  a hover sets feature state, a click fits the right bounds, and `prefers-reduced-motion` is read on
  the call rather than through a class name.
- **`DiaryMap` needs the same dev-only `__map` handle `TripMap` carries**, or the browser case
  cannot read the camera at all. It is free outside production, and the existing comment explains
  why.
- **One browser case**, and it earns its place the way the others did: a real canvas on `/`, two
  markers, a click that moves the camera, and the cross-highlight in both directions. Plus the §9
  measurement, which is a browser case whether or not it becomes a regression test.
- **Every browser case gets a mutation control**, recorded in `e2e/notes.md`. Seven of 4a's checks
  and two of 4b's could not fail until a mutation said so.
- **Two paths join the `test:e2e` gate list**: `app/(public)/page.tsx` and
  `scripts/seed-dev-pod.ts`. Neither is in any glob today. This stage fires the gate anyway through
  `components/public/**`, which is exactly why the hole would stay invisible — a later page-only or
  seed-only change is the one that would skip a run it needed. Same shape as the `hooks/trip/**`
  omission 4b closed, and it goes in `docs/testing-gates.md` with its reason.
- **`size:public` prints the WORST public route, not a line per route** — today that is the trip
  page at 182.0 kB of 190. `/` acquires substantially the same client tree this stage, so the number
  to predict is a landing route arriving near the trip page's, and the ceiling has about 8 kB of
  headroom. The map chunk itself is lazy and is not weighed; a static `maplibre-gl` import would be,
  and the fence already refuses it.

## 11. What no check here will see

- **The globe itself — narrowed on 2026-09-14, not closed.** `size:public` is indifferent and jsdom
  has no WebGL. A projection silently falling back to mercator is now caught:
  `e2e/diary-globe.spec.ts` pins a whole-world camera and asserts that the far-side trip's own
  coordinate paints nothing while the near one paints its circle, which mercator fails on the
  second half and a dead map on the first. That proves the TRANSFORM is spherical and **still not
  that a sphere was drawn** — a globe whose shader painted nothing would pass it. §8's expansion is
  read from the shipped source rather than observed.
  `e2e/notes.md#the-far-side-is-the-projection-assertion` carries the margins and the dependency.
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

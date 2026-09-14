# components/public/trip-map — notes

The three hooks moved to `hooks/map/` on 2026-09-12 and their four sections went with them,
unedited except for one cross-reference: `hooks/map/notes.md`.

## The no-observer fallback, and why it is not a hole

`IntersectionObserver` is absent in jsdom and in no browser this app targets.
The component falls back to activating immediately rather than to never
activating, because a map that never appears is a broken page while an eagerly
mounted one is only a wasted download — and in the one environment where the
fallback fires, the test environment, the library is a fake.

The fallback is what makes the component testable at all, so it is load-bearing
rather than defensive. What it must never become is the path a real browser
takes: if the observer branch stops running, the laziness the whole stage is
built on is gone with no test failing. `e2e/trip-map.spec.ts` is what watches
that, by asserting the canvas is absent before the scroll.

## The frame is reserved by the server, and the class is shared

`MAP_FRAME_CLASS` is declared in `lib/map/frame.ts` and has four importers:
this component, `DiaryMap`, and both server pages' Suspense fallbacks — it is
neither declared nor re-exported here, and moved out on 2026-09-14 because one
string imported from this `"use client"` module cost `/` 4 kB of eager chunk
(`lib/map/notes.md`, "The frame class is not in a client module"). A layout can
render the box before the index has been read, because the box's size does not
depend on the data — so the page reserves the map's space before any JavaScript
runs and nothing shifts when the instance arrives.

Two copies of that class string would drift, and the drift would be a layout
shift that no test asserts against. One declaration, four call sites.

## Navigating between trips, measured

2026-09-11, Playwright driving Chromium against `npm run dev` on
`localhost:3000`, with `**://*.openfreemap.org/**` aborted so no tile server
was involved. Instance identity tracked by stamping `dataset.probe` on the live
`canvas.maplibregl-canvas` node: a remount discards the div, MapLibre builds a
new canvas, and the stamp is gone.

**Corrected 2026-09-11** — this used to read "laziness holds: landing shows 0
canvases, scrolling to the bottom and back shows 1." That was elapsed
wall-clock time between two synchronous samples, not scroll-triggered
activation: task 6's request log shows the maplibre-gl chunk requested ~770ms
before either scroll call runs, and `e2e/trip-map.spec.ts`'s canvas case,
which never scrolls, gets a canvas in 1.4s. `MAP_FRAME_CLASS` sits at the top
of the layout with nothing above it, so the frame is already inside
`rootMargin: "200px"` on load — the observer path is correct but gates
nothing on this page as laid out today. The bundle benefit holds regardless:
the chunk is still absent from `size:public`'s prerendered-HTML chunk list.

trip → entry → back → entry, three router navigations: ONE instance
throughout. Canvas count stayed at 1 and the `dataset.probe` stamp survived
all three.

trip A → trip B was **not measured**, and the reason is itself measured, not
assumed. No in-app link joins two trips — on that date the home page linked
only `2026-japan`, and there is still no `/trips` index. An injected `<a>` cannot
substitute: `window.__navProbe` set before a click survives the real `<Link>`
navigation above, but is `null` after the injected `<a>`, because that is a
document load rather than a soft navigation and destroys everything regardless
of the layout. The only other seeded trip, `2026-secret`, is a draft that
renders not-found — no map frame at all
(`[role="region"][aria-label="Trip map"]` count 0) — so even a working link
would not exercise a trip-to-trip transition. Closing this needs a second
published trip in the seed plus an in-app link between two trips. The answer
is open, not guessed in either direction.

Three assumptions in the markers/layers hooks are trip-local, unreachable today for the same
reason: `useMapMarkers` keys a marker by `IndexEntry.slug`, unique within a trip and not proven
across two; `useMapLayers`'s `addAll` fixes `cluster` from the first trip's entry count and never
reconsiders it; `useMapInstance`'s `fitBounds` runs once, from the `style.load` handler, on
whichever trip supplied it first. A same-slug collision, entry-count swing across the threshold,
or camera left fitted to trip A's bbox on trip B's map are all consequences of one instance
surviving a transition that has never been exercised.

**Answered 2026-09-14, by argument rather than measurement.** Every route in this app reaches a
trip through `/`, which is outside the `[slug]` subtree and tears this layout and its map down, so
the navigation that would reach these three assumptions does not exist and stage 5's globe does not
add it — its markers fly the camera and its list links go to one trip at a time. The seed's second
published trip (`2025-patagonia`, 2026-09-14) removes the fixture half of the obstacle above and
leaves the structural half exactly where it was. The three stay real, stay in the tree, and stay
unreachable until someone adds a direct trip-to-trip link, which is a product decision nobody has
taken. `TODO.md`'s phase 4 stage 5 entry carries the full form.

## The map handle attached for e2e

`e2e/trip-timeline.spec.ts` needs to know whether `setFeatureState` actually landed on the
arriving leg's promoted id, and a GL line painted into the canvas is not queryable from the DOM
— `e2e/trip-map.spec.ts` says so about the route line for the same reason. Reading real pixels
back out was considered and rejected: dash pattern, anti-aliasing and exact screen position would
all have to be reverse-engineered.

So `TripMap` stamps the live `Map` instance onto its own container node as `__map`, once it
exists. Not `window`: the container is already the one DOM handle every trip-map spec locates
through (`page.getByRole("region", { name: "Trip map" })`), so this reuses that handle rather than
adding a second, wider one. Playwright's `locator.evaluate()` receives the real element and calls
real MapLibre methods on it — the same object the production hooks call `setFeatureState` on.

**Not `__map.getFeatureState(...)` though — that call proved nothing, measured 2026-09-13.**
`getFeatureState`/`setFeatureState` are a plain key-value store keyed by whatever id the caller
passes; reading it back only proves the hook called the API, not that the id it used matches any
feature MapLibre actually rendered. `e2e/notes.md`'s "the two mutation controls" has the false
pass this produced. The fix reads `__map.queryRenderedFeatures(undefined, { layers: [...] })` and
checks the returned feature's own `.state` — computed by the renderer from whichever id it really
assigned, which is what `promoteId: "toSlug"` is actually for.

**Development builds only, from 2026-09-13.** The stamp is behind
`process.env.NODE_ENV === "production"`, which costs the specs nothing:
`playwright.config.ts` starts the app with `npx next dev`, deliberately
(`e2e/notes.md`, and the StrictMode reason recorded in `playwright.config.ts`
itself), so the handle is present for every e2e run and absent from every
deploy. A live `Map` reachable from a public page's DOM is not a security
boundary anyone relies on, but it is an export nothing in production has a use
for.

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

`MAP_FRAME_CLASS` is exported and used twice: by the component, and by the
layout's Suspense fallback. The layout can render the box before the index has
been read, because the box's size does not depend on the data — so the page
reserves the map's space before any JavaScript runs and nothing shifts when the
instance arrives.

Two copies of that class string would drift, and the drift would be a layout
shift that no test asserts against. One export, two call sites.

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
assumed. No in-app link joins two trips — the home page links only
`2026-japan`, and there is no `/trips` index. An injected `<a>` cannot
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
surviving a transition that has never been exercised — stage 4 inherits closing this alongside
the trip-to-trip measurement above.

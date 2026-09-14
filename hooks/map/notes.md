# hooks/map — notes

Moved here from `components/public/trip-map/notes.md` on 2026-09-12 with the three hooks
themselves; `docs/code-structure.md` has why. What is still about the component — the
no-observer fallback, the reserved frame, the navigation measurements — stayed there.

## Why a bare dynamic import and not next/dynamic

§1 of the design measured that a chunk produced by `next/dynamic` with
`ssr: false` is invisible to `size:public`, because the check derives its chunk
list from prerendered HTML and a lazily loaded chunk is never named there. A
bare `await import()` has exactly the same property with less machinery, and
`components/studio/studio-client/studio-client.tsx` already uses this shape for
the auth library.

The trap both share: at module scope, Next prerenders the import onto the
server and into the eager chunk. For the auth library that is a correctness
bug; here it is 252.8 kB gzip against 190 kB of budget. The import stays inside
the effect, and `scripts/check-public-bundle.ts`'s positive control is what
notices if it ever moves.

## Why the effect depends on activation alone

`bbox` arrives from the server layout as a fresh object on every render, so an
effect listing it in its dependencies would destroy and rebuild the map on a
re-render that changed nothing. "One MapLibre instance, mounted once, never
remounted across navigation or drawer state" is an invariant in `CLAUDE.md`,
and this is the line that keeps it: the effect depends on `active` and the
container ref, and reads the rest from a ref updated each render.

A different trip is a different map. Whether that is even a remount is
answered in `components/public/trip-map/notes.md`, under "Navigating between
trips, measured", rather than assumed.

## What the hook test can and cannot see

jsdom has no WebGL and no `IntersectionObserver`. The hook test therefore runs
against a fake `maplibre-gl` and proves the lifecycle: one instance, the
attribution control added, `setProjection` reached only from `style.load`, the
bbox fitted without animation, teardown on unmount.

It cannot prove a canvas appears, that the style renders, or that the chunk is
fetched lazily by a real browser. Those are `e2e/trip-map.spec.ts`, which is
why that spec clears `CLAUDE.md`'s "never a slow duplicate of a fast test" bar.

Carried from that review: `use-map-instance.ts` reports `"loading"` forever if
`container.current` is null on the effect that flips `active`. `TripMap`
renders its div unconditionally on the first render, before either the
observer or its no-observer fallback can set `active`, so the ref is already
attached by the time this hook's effect sees `active: true` — the precondition
stays unreachable through this component, and is recorded here rather than
tested, per the deferred finding.

## Why styleLoaded is not isStyleLoaded()

Measured 2026-09-11, real Chromium against `e2e/trip-map.spec.ts`'s tile stubbing (TileJSON
fulfilled, every tile aborted): `style.load` fired at t=692ms; `useMapLayers`'s effect ran 4ms
later with `map.isStyleLoaded()` still `false`. It never became `true` in the run. The reason is
in `maplibre-gl`'s own source: `Style.loaded()` requires both `_loaded` (what drives the
`style.load` event) **and** every registered source's tiles to be loaded or errored — including
`openmaptiles`, the basemap vector source, whose tiles are the ones the stub aborts. A hook that
gates "has `style.load` already fired" on `isStyleLoaded()` therefore takes the "subscribe and
wait" branch even after the event has already happened, and `Evented.on`/`.once` in
`maplibre-gl-shared.mjs` never replay a past event to a listener added afterward — so the
subscription is permanent silence: no sources, no layers, no markers, ever, and no error either.

`useMapInstance` tracks `styleLoaded` itself instead, flipped by the same `style.load` handler it
registers synchronously at construction, with zero gap for the event to beat it. `useMapLayers`
takes `styleLoaded` as a dependency rather than reading `map.isStyleLoaded()`, so its effect
re-runs exactly when the flag flips, regardless of whether that happens before or after the
render on which `map` itself first appears.

## Why the legs source promotes toSlug

`buildLegs` (`lib/map/legs.ts`) gives each leg feature `properties: { mode, fromSlug, toSlug }`
and no `id` — GeoJSON features are anonymous unless a source says otherwise. `setFeatureState`
addresses features by id, so `LEGS_SOURCE` sets `promoteId: "toSlug"`, lifting that property into
the id MapLibre already tracks. A leg is identified by the entry it arrives at, matching the
"mode belongs to the arriving leg" rule the same file's comment already states.

## A highlight can land on nothing

`setFeatureState({ source, id }, ...)` on an id absent from the source's data does not throw and
does not warn — it is silently discarded. A slug that is stale, misspelled, or belongs to an
unplaced entry produces a page that behaves exactly as if the highlight had worked, with no
signal that it did not.

**One case fires on every trip, by design.** `buildLegs` (`lib/map/legs.ts`) builds its legs from
`placed.slice(1)` — a leg is the arrival at an entry, and the first entry is arrived at from
nowhere — so the first entry's slug is never a `toSlug` and never an id in `LEGS_SOURCE`.
Highlighting it therefore paints a marker and no leg, which is correct and is not a defect. It
does mean a browser test that only ever highlights the first entry would assert nothing about
feature state; `e2e/trip-timeline.spec.ts` hovers the second entry for that reason.
`useMapHighlight` cannot detect this case; it is recorded here rather than guarded against,
since guarding it would mean re-deriving the same slug set `buildLegs` already computed just
to check membership.

The same trap, same mechanism, on the other surface: `useMapTrips` keys its feature state on the
`slug` that `TRIPS_SOURCE` promotes, so a slug the trips source never carried — an unplaced trip,
or one `buildTripPoints` dropped — paints nothing and says nothing.

## Why activeSlug is a ref in the reconcile effect

`useMapMarkers`'s first effect builds every marker from `map.querySourceFeatures`, keyed only on
`[map]` — the same "one MapLibre instance, mounted once" invariant `use-map-instance.ts` protects.
Listing `activeSlug` there too would re-run it on every hover, which tears down and rebuilds every
marker rather than restyling one: expensive, and visible as a flash on the whole layer.

So a second effect, keyed on `[activeSlug]` alone, owns the class: it writes `active.current` for
the next marker the first effect creates, and toggles `MARKER_ACTIVE` on every live marker's
element. Task 5's mutation control is what checks this holds — adding `activeSlug` to the first
effect's deps and confirming the no-rebuild test goes red on marker count, then reverting.

## Why MARKER_ACTIVE is split before classList

`MARKER_ACTIVE` is `"ring-2 ring-accent-bright"`, two Tailwind classes as one string, matching how
`marker-element.ts`'s `BASE` is already composed. But `classList.add`/`classList.toggle` take one
token each and throw `InvalidCharacterError` on a token containing a space — confirmed against
jsdom 2026-09-13, not just spec text. `ACTIVE_CLASSES = MARKER_ACTIVE.split(" ")` is computed once
at module scope; both call sites spread or iterate it rather than passing the joined string.

## Why a marker click stops propagating

A `Marker`'s element is appended into the same canvas container maplibre attaches its own
`click` listener to, so a click on a marker bubbles to the map unless stopped. Without
`event.stopPropagation()` on the marker's listener, a tap would pin the entry and the map's own
`click` handler would unpin it in the same turn — select and clear, back to back, with nothing
in between to observe. The test that catches a missing `stopPropagation()` attaches its deselect
listener to an ancestor of the marker element in the document, exactly as maplibre does, rather
than to the map mock directly — a mock-only listener would never see the bubble at all.

## Why the trips source promotes slug

`buildTripPoints` (`lib/map/trips.ts`) gives each trip feature `properties: { slug, name }` and no
`id`, and `setFeatureState` addresses features by id — so `TRIPS_SOURCE` sets `promoteId: "slug"`,
exactly as `LEGS_SOURCE` sets `promoteId: "toSlug"` above and for the same reason. Leave it out and
`setFeatureState` is a silent no-op: no error, no warning, nothing painted. Nothing has ever shipped
that way — `git show fa57377` added the promotion and the `feature-state` paint in one commit — so
this is the failure mode, not an incident.

## Why the trip handlers are a ref

Same reason `useMapMarkers`'s are — see "Why activeSlug is a ref in the reconcile effect" — with a
different victim: a caller's fresh `{ onEnter, onLeave, onSelect }` literal in the effect's
dependencies would tear down and re-register the three layer listeners on every render.

`trips` is a dependency rather than a ref, deliberately: the bbox a click flies to is read from it,
and stale trips would fly to the wrong place. **The caller must therefore pass a stable array.**
`trips` is a dependency of the source effect too, so a fresh literal per render does not merely
re-register three listeners — it calls `setData` on every render, which re-parses the collection
and reloads the source's tiles. That is not the invisible cost an earlier draft of this paragraph
claimed, and the hook cannot make it so.

## The fly is a jump under reduced motion

maplibre-gl 6.6.0 already zeroes the duration of a camera movement when `prefers-reduced-motion:
reduce` matches and the movement is not flagged `essential`, so the explicit `animate` flag is
belt-and-braces rather than the mechanism. It is kept because it is the part a jsdom test can
assert: the decision is visible in the options object, where the library's own behaviour is not.

The call is `window.matchMedia?.(…)` for the same reason. jsdom implements no `matchMedia`, so the
optional call is what keeps the hook working un-stubbed; `use-map-trips.test.ts` stubs it for one
case and restores it in `beforeEach`, or the stub leaks into every case after.

## Why the background click asks what it hit

`map.on("click", TRIPS_LAYER, select)` is not a separate channel. maplibre 6.6.0 builds a
layer-scoped listener as a plain `click` listener on the map that queries the layer itself and
calls the caller's listener only on a hit — `maplibre-gl-dev.mjs`, `_createDelegatedListener`'s
final branch, registered through `on()` a few lines below. So a map-level `click` listener added
for the background fires for a click on a circle too, in the same turn and after it, and there is
no propagation to stop: the delegate is a sibling listener, not a parent node. Pin, then unpin.

This is the select-then-clear shape `useMapMarkers` hit in its DOM costume — see "Why a marker
click stops propagating" — but `event.stopPropagation()` is the wrong tool here, because nothing
is bubbling. The background handler instead asks the map what was under the pointer,
`queryRenderedFeatures(event.point, { layers: [TRIPS_LAYER] })`, and does nothing when the answer
is a trip. The fake in `use-map-trips.test.ts` models both halves — one `emit("click", …)` reaches
the layer list only on a hit and the map-level list always — or the guard would have nothing to
prove.

A missing layer is not a throw: `queryRenderedFeatures` fires an error event and returns `[]`, so
a click arriving before the layer exists would clear the pin rather than crash. It cannot arrive
then in practice — the source effect is declared before the listener effect and both gate on the
same `styleLoaded`.

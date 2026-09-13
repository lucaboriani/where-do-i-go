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

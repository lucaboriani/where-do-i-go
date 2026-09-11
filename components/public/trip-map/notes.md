# components/public/trip-map — notes

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
answered under the `[slug]` heading below rather than assumed.

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

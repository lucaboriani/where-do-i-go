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

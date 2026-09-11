# app/(public)/trips/[slug] — notes

## Why the map lives in the layout

Next preserves layout state across navigation: a layout does not rerender when
a child route changes, which is documented in the bundled docs at
`01-app/01-getting-started/03-layouts-and-pages.md`. That is the mechanism
behind `CLAUDE.md`'s "one MapLibre instance, mounted once, never remounted
across navigation" — not a discipline the components maintain, but a property
of where the component is mounted.

Put the same map in `page.tsx` and every navigation to an entry would tear down
a WebGL context and build a new one, with the tiles refetched and the camera
reset. The invariant would be violated by the file it lives in.

The layout does not await `params` on its shell path, for the reason
`page.tsx`'s own docblock gives: reading URL data outside a boundary blocks the
static shell, which is what makes a navigation feel slow. The frame is reserved
synchronously and the index read happens inside `<Suspense>`.

## The Suspense-child test, and why it needed no fallback route

`layout.test.tsx` renders `<Layout>` with a `params` promise that never
resolves, so `<MapForTrip>` never settles. The brief anticipated this might
warn or hang under this project's Testing Library setup; it did neither —
`npx vitest run` completed in under half a second with 2 passed and no console
output, so both cases assert exactly what the brief's sample asserts, with no
simplification needed.

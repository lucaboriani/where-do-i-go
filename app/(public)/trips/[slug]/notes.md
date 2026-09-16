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

The layout now also owns the shell: `.trip-map-pane` and `<MapSheet>` render as
SIBLINGS under `.trip-shell`, never one inside the other. That is what makes
the never-remounted rule structural rather than a discipline — a snap point or
a breakpoint can only ever affect the sheet's own subtree, so no code path
through `MapSheet` can reach the pane and unmount it. See
`components/public/map-sheet/notes.md` for the geometry the two siblings sit
in at each width; this file only owns why the pane is a sibling, not a child.

The layout does not await `params` on its shell path, for the reason
`page.tsx`'s own docblock gives: reading URL data outside a boundary blocks the
static shell, which is what makes a navigation feel slow. The frame is reserved
synchronously and the index read happens inside `<Suspense>`.

## Why the masthead catch-all needs instant false

`@masthead/default.tsx` only covers a hard reload — the bundled parallel-routes
guide's own modal example needed a catch-all to null a slot on client-side
`<Link>` navigation too, because `default.tsx` is a load-time fallback, not a
per-navigation one. But this catch-all matches no real params, so Next tries
to prerender its OWN static fallback shell, and that render passes through the
`[slug]` layout, which puts `TripHighlightProvider` (a Client Component
calling `useSelectedLayoutSegment()`) outside any `<Suspense>` — a hard build
failure under Cache Components' static-shell validation, not a warning.
Wrapping `TripHighlightProvider` itself in `<Suspense>` would touch a shared
component every real route already builds fine with; `instant = false` scopes
the exemption to the one leaf that is never real content.
`node_modules/next/dist/docs/.../route-segment-config/instant.md#disabling-static-shell-validation`.

## The Suspense-child test, and what it does and does not prove

`layout.test.tsx` renders `<Layout>` with a `params` promise that never
resolves, so `<MapForTrip>` never settles. It passes, but only under vitest's
**default** reporter, which hides stderr. `--reporter=verbose` shows two
messages on every run:

```
<MapForTrip> is an async Client Component. Only Server Components can be
async at the moment. This error is often caused by accidentally adding
'use client' to a module that was originally written for the server.
```

```
A component suspended inside an `act` scope, but the `act` call was not
awaited. When testing React components that depend on asynchronous data,
you must await the result:

await act(() => ...)
```

Both are expected and harmless: in real Next SSR, `MapForTrip` is a genuine
Server Component, so neither message can occur in production. They are an
artefact of Testing Library's client renderer driving an async component it
was never meant to run, which is unavoidable for a test that stays honest
about what a server-component test can assert (see the layout above). They
are not suppressed, and a future reader who only runs the default reporter
will not see them.

What the two cases actually prove: children render without the layout
awaiting `params`, and the fallback reserves the map frame before the index
is read. They do not prove `<MapForTrip>` itself resolves correctly, or
anything about its rendered output — that is `e2e` and the unit tests on
`TripMap`/`useMapInstance`.

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

## Why the masthead slot mirrors the entry route

`@masthead/default.tsx` only covers a hard reload. On a client-side `<Link>`
nav the slot needs a *matching* subpage, or Next keeps the slot's previously
active subpage — its documented behaviour: "changing the subpage within the
slot, while maintaining the other slot's active subpages, even if they don't
match the current URL"
(`node_modules/next/dist/docs/.../file-conventions/parallel-routes.md`). So a
trip → entry soft nav that finds no `@masthead` match for `[entry]` leaves the
trip banner mounted.

The bundled parallel-routes guide reaches for a `[...catchAll]` to null a slot
on soft nav (its modal example). That does **not** work here: measured on
2026-09-16, a soft nav to `[slug]/[entry]` never resolved the catch-all —
Next kept `@masthead/page.tsx` (the index banner) active and, because that
page reads URL data (`params`, `getTrip`) while wrongly pulled into the entry
route's tree, threw `instant-shell-url-data` at `TripMasthead`. The catch-all
is a different segment *shape* than the real `[entry]` route, and the router's
soft-nav tree diff would not match it.

The fix is an explicit `@masthead/[entry]/page.tsx` returning `null` that
mirrors the real `[slug]/[entry]` route segment one-for-one. An exact match
resolves on soft nav where the catch-all did not, so the *current* route's
masthead slot renders nothing on the entry route. Because the leaf matches the
same concrete params the children route prerenders (no unknown-param fallback
shell), it needs no `instant = false`: the static-shell validation the catch-all
tripped never fires. `[entry]` is the only real route deeper than the index, so
it supersedes the catch-all entirely; the catch-all was removed.

The `instant-shell-url-data` error is separate, and `instant = false` on the
leaf did **not** silence it (measured 2026-09-16). The masthead reads URL data
(`params` → `getTrip`); Cache Components validates that access per *segment*, and
the layout's `<Suspense>` around `{masthead}` does not count as this segment's
own boundary. `@masthead/page.tsx` therefore wraps `TripMasthead` in its own
`<Suspense fallback={null}>`, co-located with the read — the doc's first
suggested fix (`.../route-segment-config/instant.md`), and it clears the error.

### Why the e2e filters by visibility, and the banner can never reach count 0

The explicit `[entry]` slot stops a *visible* banner on the entry route, but the
previous route's masthead stays in the DOM, hidden with `display:none`. That is
not the slot: it is Cache Components preserving up to 3 routes with React
`<Activity>` for instant back-nav and state (the old timeline `<main>` lingers
the same way). `node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md`
— its "Testing" section is written for exactly this trap: a raw `.masthead`
locator matches hidden `<Activity>` content, so `e2e/trip-masthead.spec.ts`
asserts the banner is not *visible* (`.filter({ visible: true })`), not absent.
A raw count is never 0 after a soft nav; no slot config changes that, because it
is a router-cache property, not a routing one.

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

# studio-client — notes

Three files, not two: server page → this wrapper → the shell. Why, and why the
auth library is imported inside an effect. Moved out of the file header by Stage
C's comment sweep on 2026-09-09; the one-line warning stays inline.

## why this wrapper exists at all

Next 16 rejects `ssr: false` inside a server component outright — "`ssr: false`
is not allowed with `next/dynamic` in Server Components. Please move it into a
Client Component"
(`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`). So the studio
is three files, and the middle one is this.

## why the auth library is imported in an effect and not at module scope

This wrapper is a client component rendered by a server page, so Next prerenders
it: its module scope and its render function both run in node. Only the
`ssr: false` subtree is skipped.

A static `import { getDefaultSession } from "@inrupt/solid-client-authn-browser"`
here would therefore evaluate the auth library during the build — measured to
work on node 22, so it would not fail loudly; it would just quietly put the
browser session library on the server, which is the one place
`app/(studio)/studio/page.tsx` says it must never be. It would also land the
whole library in the chunk `/studio` loads eagerly, defeating the lazy boundary
this file exists to draw.

An `import()` inside an effect runs in the browser and nowhere else. The cost is
one extra render with no session, which is served as static HTML for `/studio`
and replaced on hydration; the shell's own `restoring` state follows it
immediately, so it is the same waiting screen twice, not a flash of the wrong
one.

`getDefaultSession()` is the library's module-level singleton, so the two
StrictMode invocations of the effect hand back the same object and the second
`setSession` is a no-op rather than a second session.

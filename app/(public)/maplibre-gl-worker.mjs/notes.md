# maplibre-gl-worker.mjs — notes

## why this route exists

Measured 2026-09-11: `maplibre-gl` 6.6.0 resolves its worker script from
`import.meta.url` at the point the library module itself is evaluated
(`node_modules/maplibre-gl/dist/maplibre-gl.mjs`'s own `wi()`), and falls back
to an **empty string** whenever that URL does not start with `http:`/`https:`.
Under Turbopack — `next dev` and `next build`/`next start` alike — the bundled
chunk's `import.meta.url` does not satisfy that check, so `getWorkerUrl()`
returns `""` and `new Worker("", { type: "module" })` tries to load the
*current page* as a module script. It fails silently: no thrown error, no
`error` event surfaced anywhere reachable from application code, just a
worker that never processes a single message.

Confirmed with a wrapped `window.Worker` in a real Chromium (Playwright),
against both `next dev` and `next build && next start`: `args[0]` was `""` in
both. Everything that depends on the worker — GeoJSON tiling (`use-map-layers`'s
sources) and real vector-tile PBF parsing (the basemap's non-background
layers) — never completes. Nothing before Task 7 caught it: stage 2's e2e
cases check only that a canvas paints and the attribution control renders
text, both of which happen from the `background` layer and style metadata
alone, needing no worker at all.

**The fix**: this route re-serves the exact installed worker file from the
app's own origin, and `use-map-instance.ts` calls `setWorkerUrl()` with its
path before constructing a `Map`. A same-origin, real `http(s)` URL is exactly
what `getWorkerUrl()`'s check wants; MapLibre never needs `import.meta.url` to
guess right once told explicitly.

Follows `client-id.jsonld/route.ts`'s precedent: a literal dotted folder name
as a route segment, serving a document generated from what the app already
has rather than a static file copied into `public/` at install time — that
alternative would drift from whatever `maplibre-gl` version `package.json`
actually resolves, silently, on the next `npm install`. Reading the installed
package directly ties the served bytes to the version actually running.

## Two ways to find that file that do not work here

`require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs")`, called directly
on the `.mjs` path, is not a plain runtime call in this route-handler
bundling context: Turbopack statically rewrites it to an internal placeholder
string (observed literally: `[project]/node_modules/maplibre-gl/dist/…`,
which does not exist on disk) rather than a real filesystem path.
`import.meta.resolve`, tried next, throws `TypeError: {import.meta}.resolve
is not a function` — not implemented in this runtime at all.

`join(process.cwd(), "node_modules/maplibre-gl/dist/…")` is what works,
because it is plain string and path arithmetic Turbopack has no
static-analysis hook for. The tradeoff: it depends on `node_modules` sitting
where `process.cwd()` says it does, which the next paragraph is about.

**Good news, measured on the actual build**: `next build` marks both this
route and its sibling `○` — prerendered to static output, same as
`client-id.jsonld`. The `readFileSync` runs once, at build time, on the
machine that ran `npm install`; nothing reads `node_modules` from inside a
deployed serverless function. **Still not verified on an actual Netlify
deploy** — same caveat as the OG-image question in `docs/phase-0-spike.md`
§7, and for the same reason: local success does not predict the serverless
runtime, and it is conceivable a host's build step diverges from
`next build`'s own static/dynamic classification.

**The path stays a literal in each route, on purpose.** A first pass shared
the `readFileSync(join(process.cwd(), relativePath), "utf8")` line too,
taking `relativePath` as a parameter of a helper in `../_lib/`. That
produced a real Turbopack build warning — absent before the refactor,
confirmed by reverting it and rebuilding — because Turbopack's file tracing
only follows a `path.join` call whose argument is a literal at the call
site; a parameter defeats it regardless of what literal a caller passes.
`../_lib/serve-package-file.ts`'s `javascriptResponse` now takes the
already-read source instead, and each route keeps its own literal
`readFileSync(join(process.cwd(), "node_modules/maplibre-gl/dist/…"))` line
— less deduplication than a single shared read, kept this way because the
warning is exactly the risk the "not yet verified on Netlify" paragraph
above is about, and this shape does not invite it.

## The URL is origin-root-relative

`use-map-instance.ts`'s `WORKER_URL` is `/maplibre-gl-worker.mjs`, not
prefixed by any `basePath`. No `basePath` is configured today, so this is
correct as written; a deployment that adds one would need this path built
from it, the same way any other root-relative asset reference would.

## The worker fetches its own dependency a second time

`/maplibre-gl-shared.mjs` is 489,575 bytes raw, and the worker thread fetches
it independently of the copy already inside the lazy `maplibre-gl` chunk the
main thread loads — two separate module graphs, MapLibre's own split-worker
design, not a bug here. It is real bytes over the wire and outside
`size:public`'s ceiling by construction: that check only ever weighs what a
prerendered page's HTML references directly, and a worker's own fetches are
invisible to it on principle, the same way a lazy `import()` is.

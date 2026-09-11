# maplibre-gl-worker.mjs — notes

## why this route exists

`maplibre-gl`'s own worker-URL detection is unusable under Turbopack, silently, in both `next dev`
and a production build — measured, and written up in full in `docs/decisions.md` §31, including
the three failed ways to read the file that led to the current one. Read that first; this file
covers only what §31 does not.

**The fix, in one sentence**: this route re-serves the installed worker file from the app's own
origin, `maplibre-gl-shared.mjs/route.ts` re-serves its one relative import the same way, and
`use-map-instance.ts` calls `setWorkerUrl()` with this route's path before constructing a `Map`.

**The trap, at the point of danger**: the path each route reads must stay a **literal** at the
`readFileSync(join(process.cwd(), …))` call site. Moving it behind a shared helper that takes the
path as a parameter defeats Turbopack's build-time file tracing — §31 has the measurement.

## The URL is origin-root-relative

`use-map-instance.ts`'s `WORKER_URL` is `/maplibre-gl-worker.mjs`, not prefixed by any `basePath`.
No `basePath` is configured today, so this is correct as written; a deployment that adds one would
need this path built from it, the same way any other root-relative asset reference would.

## The worker fetches its own dependency a second time

`/maplibre-gl-shared.mjs` is 489,575 bytes raw, and the worker thread fetches it independently of
the copy already inside the lazy `maplibre-gl` chunk the main thread loads — two separate module
graphs, MapLibre's own split-worker design, not a bug here. It is real bytes over the wire and
outside `size:public`'s ceiling by construction: that check only ever weighs what a prerendered
page's HTML references directly, and a worker's own fetches are invisible to it on principle, the
same way a lazy `import()` is.

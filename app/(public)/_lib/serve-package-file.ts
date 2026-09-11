/** Not `lib/map/`: that directory is reachable from client components, and
 *  this one imports `node:fs`. `_lib` is Next's own convention for a
 *  colocated, non-routable folder. ../maplibre-gl-worker.mjs/notes.md#why-this-route-exists */

// Takes the already-read source, not a path: a shared `readFileSync` taking
// the path as a parameter defeats Turbopack's file tracing, measured — see
// this route's own notes.md.
export function javascriptResponse(source: string): () => Promise<Response> {
  return async () => new Response(source, { headers: { "content-type": "text/javascript; charset=utf-8" } });
}

/** Not `lib/map/`, and takes the already-read source, not a path — both for
 *  reasons in `docs/decisions.md` §31. ../maplibre-gl-worker.mjs/notes.md#why-this-route-exists */
export function javascriptResponse(source: string): () => Promise<Response> {
  return async () => new Response(source, { headers: { "content-type": "text/javascript; charset=utf-8" } });
}

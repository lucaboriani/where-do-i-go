/** The worker script's own dependency, re-served alongside it: the worker
 *  module imports it by a path relative to wherever it was fetched from.
 *  ../maplibre-gl-worker.mjs/notes.md#why-this-route-exists */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Read once, at module load, not per request: the installed package is
// immutable while the server runs.
const SHARED_SOURCE = readFileSync(
  join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs"),
  "utf8",
);

export async function GET() {
  return new Response(SHARED_SOURCE, { headers: { "content-type": "text/javascript; charset=utf-8" } });
}

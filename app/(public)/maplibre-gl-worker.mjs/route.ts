/** maplibre-gl's own worker script, re-served from this origin so the browser
 *  can actually fetch it. ./notes.md#why-this-route-exists */
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Plain path arithmetic from process.cwd(), not require.resolve() or
// import.meta.resolve(): Turbopack's route-handler runtime rewrites the
// former into an internal placeholder that does not exist on disk, and does
// not implement the latter at all — both observed directly. See this
// route's own notes.md.
const WORKER_SOURCE = readFileSync(
  join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"),
  "utf8",
);

export async function GET() {
  return new Response(WORKER_SOURCE, { headers: { "content-type": "text/javascript; charset=utf-8" } });
}

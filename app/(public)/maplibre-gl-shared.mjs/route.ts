/** The worker script's own dependency, re-served alongside it: the worker
 *  module imports it by a path relative to wherever it was fetched from.
 *  ../maplibre-gl-worker.mjs/notes.md#why-this-route-exists */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { javascriptResponse } from "../_lib/serve-package-file";

const SHARED_SOURCE = readFileSync(
  join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs"),
  "utf8",
);

export const GET = javascriptResponse(SHARED_SOURCE);

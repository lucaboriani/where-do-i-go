/** maplibre-gl's own worker script, re-served from this origin so the
 *  browser can actually fetch it. ./notes.md#why-this-route-exists */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { javascriptResponse } from "../_lib/serve-package-file";

const WORKER_SOURCE = readFileSync(
  join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"),
  "utf8",
);

export const GET = javascriptResponse(WORKER_SOURCE);

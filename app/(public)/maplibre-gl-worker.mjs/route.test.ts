/**
 * Serves maplibre-gl's own worker script from the app's origin.
 * ./notes.md#why-this-route-exists
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /maplibre-gl-worker.mjs", () => {
  it("serves the installed maplibre-gl worker script byte for byte", async () => {
    const response = await GET();
    const path = join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
    expect(await response.text()).toBe(readFileSync(path, "utf8"));
  });

  it("serves it as a JavaScript module, not the default octet-stream", async () => {
    const response = await GET();
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });

  it("imports exactly the one sibling this app also serves, so a maplibre-gl bump cannot add a silent 404", async () => {
    const response = await GET();
    const source = await response.text();
    const relativeImports = [...source.matchAll(/from"(\.[^"]+)"/g)].map((m) => m[1]);
    expect(relativeImports).toEqual(["./maplibre-gl-shared.mjs"]);
  });
});

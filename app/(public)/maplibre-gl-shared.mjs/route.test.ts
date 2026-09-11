/**
 * The worker script's own dependency, re-served alongside it.
 * ../maplibre-gl-worker.mjs/notes.md#why-this-route-exists
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /maplibre-gl-shared.mjs", () => {
  it("serves the installed maplibre-gl shared chunk byte for byte", async () => {
    const response = await GET();
    const path = join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs");
    expect(await response.text()).toBe(readFileSync(path, "utf8"));
  });

  it("serves it as a JavaScript module, not the default octet-stream", async () => {
    const response = await GET();
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  });
});

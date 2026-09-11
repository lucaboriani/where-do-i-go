/**
 * The one thing no faster test can see: a real canvas with the OpenStreetMap
 * attribution, painted by MapLibre — jsdom has neither WebGL nor an encoder.
 * MAP_FRAME_CLASS sits above the fold, so no scroll here proves laziness;
 * that is proven in components/public/trip-map/notes.md instead, measured.
 */

import { expect, test } from "@playwright/test";

const TRIP = "/trips/2026-japan";

/** lib/map/style.ts's only source is `{ type: "vector", url: TILES_URL }`, a
 *  TileJSON reference MapLibre must fetch for `sources[].attribution` — so an
 *  outright abort leaves the attribution bar permanently empty, measured. */
const TILE_METADATA = "https://tiles.openfreemap.org/planet";

test.beforeEach(async ({ page }) => {
  // Serve the TileJSON locally so the control learns the real OSM notice
  // without reaching the network; abort every actual tile request under it,
  // since a spec that needs the internet is a spec people stop running.
  await page.route("**tiles.openfreemap.org/**", async (route) => {
    if (route.request().url() !== TILE_METADATA) return route.abort();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tilejson: "3.0.0",
        tiles: [`${TILE_METADATA}/{z}/{x}/{y}.pbf`],
        attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>',
      }),
    });
  });
});

test.describe("the trip map", () => {
  test("reserves its frame on the server, and mounts a real canvas in it", async ({ page }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: "Trip map" });
    await expect(frame).toBeVisible();
    await expect(frame.locator("canvas.maplibregl-canvas")).toBeVisible();
  });

  test("carries the OpenStreetMap attribution, which is never removed", async ({ page }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: "Trip map" });
    await expect(frame.locator("canvas.maplibregl-canvas")).toBeVisible();
    await expect(frame.getByText(/OpenStreetMap/i)).toBeVisible();
  });

  test("keeps one canvas across a navigation to an entry, because the map is in the layout", async ({
    page,
  }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: "Trip map" });
    await expect(frame.locator("canvas.maplibregl-canvas")).toBeVisible();

    // Scoped to an entry link: an unscoped getByRole("link").first() matches
    // site chrome, not an entry, and the URL assertion below would fail for
    // the wrong reason.
    const entryLink = page.getByRole("link", { name: /.+/ }).and(page.locator('[href^="/trips/2026-japan/"]'));
    await entryLink.first().click();
    await expect(page).toHaveURL(/\/trips\/2026-japan\/.+/);
    await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1);
  });
});

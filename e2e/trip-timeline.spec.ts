/**
 * The timeline and the map share one highlight, both ways: hovering a row
 * lights its marker and its arriving leg's real feature state, hovering a
 * marker lights the row, and the entry route lights the marker with no pointer
 * ever touching the page. Mutation controls in ./notes.md#the-three-mutation-controls
 */

import { expect, test } from "@playwright/test";

type MapLibreMap = import("maplibre-gl").Map;

const TRIP = "/trips/2026-japan";

test.describe("the timeline and the map highlight each other", () => {
  test("hovering a row marks its marker and its arriving leg's feature state", async ({ page }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: "Trip map" });
    // Scoped to the map frame: the timeline row now carries data-slug too
    // (components/public/trip-timeline), so an unscoped locator is ambiguous.
    const naraMarker = frame.locator('[data-slug="2026-03-31-nara"]');
    await expect(naraMarker).toBeVisible();
    await expect(naraMarker).not.toHaveClass(/ring-2/);

    // By href, not accessible name: scripts/seed-dev-pod.ts's slugs are
    // verified there; the seeded titles are not asserted anywhere.
    const naraRow = page.locator(`a[href="${TRIP}/2026-03-31-nara"]`);
    await naraRow.hover();
    await expect(naraMarker).toHaveClass(/ring-2/);

    // The RENDERED feature's own state, not a bare getFeatureState(id) call:
    // that store is keyed by whatever id you pass it regardless of promoteId,
    // so it cannot tell a correctly promoted id from a coincidence. Querying
    // the actually-painted line is what promoteId: "toSlug" is for.
    await expect
      .poll(() =>
        frame.evaluate((el) => {
          const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
          const layers = { layers: ["trip-route-line"] };
          const [feature] = map?.queryRenderedFeatures(undefined, layers) ?? [];
          return feature?.state;
        }),
      )
      .toEqual({ active: true });
  });

  test("hovering a marker marks its timeline row, which is the other direction", async ({
    page,
  }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: "Trip map" });
    // The row, located through the link it contains: the <li> carries no text
    // of its own and data-active is what the highlight actually sets.
    const naraRow = page.locator(`li:has(a[href="${TRIP}/2026-03-31-nara"])`);
    await expect(naraRow).not.toHaveAttribute("data-active", "true");

    // Scoped to the map frame — see the first test in this file.
    const naraMarker = frame.locator('[data-slug="2026-03-31-nara"]');
    await expect(naraMarker).toBeVisible();
    await naraMarker.hover();
    await expect(naraRow).toHaveAttribute("data-active", "true");
  });

  test("the entry route marks its marker with no pointer ever touching the page", async ({
    page,
  }) => {
    // A fresh navigation straight onto the route: useSelectedLayoutSegment
    // supplies the highlight before any hover or focus event could fire.
    await page.goto(`${TRIP}/2026-03-29-arrival`);
    const frame = page.getByRole("region", { name: "Trip map" });
    // Scoped to the map frame — see the first test in this file.
    await expect(frame.locator('[data-slug="2026-03-29-arrival"]')).toHaveClass(/ring-2/);
  });
});

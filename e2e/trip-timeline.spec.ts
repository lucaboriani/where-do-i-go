/**
 * The timeline and the map share one highlight: hovering a row lights its
 * marker; navigating to the entry's own route lights the same marker with no
 * pointer involved. Why there is no leg assertion, and the mutation-control
 * measurement: ./notes.md#one-entry-no-leg-and-the-mutation-control
 */

import { expect, test } from "@playwright/test";

test.describe("the timeline and the map highlight each other", () => {
  test("hovering a row marks its marker, and the route marks it with no pointer", async ({ page }) => {
    await page.goto("/trips/2026-japan");
    const marker = page.locator('[data-slug="2026-03-29-arrival"]');
    await expect(marker).toBeVisible();
    await expect(marker).not.toHaveClass(/ring-2/);

    // By href, not accessible name: scripts/seed-dev-pod.ts:92 is the only
    // verified slug, and the entry's seeded title is not.
    const row = page.locator('a[href="/trips/2026-japan/2026-03-29-arrival"]');
    await row.hover();
    await expect(marker).toHaveClass(/ring-2/);

    await row.click();
    await expect(page).toHaveURL(/2026-03-29-arrival$/);
    await page.mouse.move(0, 0);
    // The route, not the pointer, is holding this highlight now.
    await expect(page.locator('[data-slug="2026-03-29-arrival"]')).toHaveClass(/ring-2/);
  });
});

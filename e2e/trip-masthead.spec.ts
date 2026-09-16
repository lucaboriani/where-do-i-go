/**
 * The runtime half of the [slug] route's notes.md ("why the masthead slot
 * mirrors the entry route"): default.tsx covers only a hard reload, so an
 * explicit @masthead/[entry] segment nulls the trip banner on a soft <Link>
 * nav — Next's own parallel-routes resolution, which no unit test can see.
 */

import { expect, test } from "@playwright/test";

const TRIP = "/trips/2026-japan";

test.describe("the trip masthead is a slot, and the entry route nulls it", () => {
  test("a soft nav to an entry drops the trip masthead and shows the entry's own", async ({
    page,
  }) => {
    await page.goto(TRIP);
    const masthead = page.locator(".masthead");
    await expect(masthead).toBeVisible();
    await expect(masthead.locator("h1.display.trip-title")).toBeVisible();

    // A real in-app navigation: next/link's Link, not page.goto — the bug this
    // guards is specific to client-side routing, and a hard load would pass
    // through default.tsx and prove nothing about the soft-nav slot match.
    const naraLink = page.locator(`a[href="${TRIP}/2026-03-31-nara"]`);
    await naraLink.click();
    await expect(page).toHaveURL(`${TRIP}/2026-03-31-nara`);

    const entryMasthead = page.locator(".entry-masthead");
    await expect(entryMasthead.locator("h1.display.entry-title")).toHaveText(
      "Deer and temples in Nara",
    );
    // No VISIBLE trip banner; the previous route's masthead lingers hidden via
    // Activity, so filter by visibility (see the [slug] route's notes.md).
    await expect(masthead).toBeHidden();
    await expect(page.locator(".masthead").filter({ visible: true })).toHaveCount(0);
  });
});

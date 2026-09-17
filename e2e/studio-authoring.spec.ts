import { expect, test } from "@playwright/test";
import { E2E } from "./environment";
import { signInAsOwner } from "./sign-in";
import type { Page } from "@playwright/test";

/**
 * The acceptance flow: create a trip, add an entry, publish both, see the
 * entry on the public site — then unpublish the trip and see it gone. Proves
 * the write path, §5's publish guard, and the public/studio boundary as one
 * flow, which is what none of the fast unit suites can do on their own.
 */

/** The row a trip or an entry renders as, found by its own link's accessible
 *  name — mirrors e2e/diary-globe.spec.ts's own `rowFor`. */
const rowFor = (page: Page, name: string) =>
  page.locator("li").filter({ has: page.getByRole("link", { name, exact: true }) });

/** `getByLabel`, filtered to the one actually on screen. Next's client router
 *  cache keeps the trip editor's own hidden DOM mounted across the one soft
 *  nav into "New entry" (measured, not assumed), and its disabled "Slug"
 *  field then collides with the entry form's own. */
const field = (page: Page, label: string) => page.getByLabel(label).and(page.locator(":visible"));

test.describe("the studio authoring and publishing flow", () => {
  test.describe.configure({ timeout: 120_000 });

  test("create, publish, and unpublish a trip and its entry", async ({ page, request }) => {
    const runId = Date.now();
    const tripSlug = `e2e-authoring-${runId}`;
    const tripName = `E2E Authoring Trip ${runId}`;
    const entryHeadline = `E2E Authoring Entry ${runId}`;
    const entryStory = "Written by the studio-authoring acceptance flow.";
    const tripResourceUrl = `${E2E.podRoot}travel/trips/${tripSlug}/trip.ttl`;

    await signInAsOwner(page);

    /* ── create the trip ──────────────────────────────────────────────── */
    await page.getByRole("link", { name: "New trip" }).click();
    await field(page, "Name").fill(tripName);
    await field(page, "Slug").fill(tripSlug);
    await page.getByRole("button", { name: "Save trip" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved. The trip is on your Pod.");

    // A fresh trip is a draft, and a draft's container is private — the exact
    // boundary CLAUDE.md calls a "draft leaking into something public".
    const beforePublish = await request.get(tripResourceUrl);
    expect([401, 403, 404]).toContain(beforePublish.status());

    /* ── add an entry to it ───────────────────────────────────────────── */
    await page.goto("/studio");
    await page.getByRole("link", { name: tripName, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Edit trip" })).toBeVisible();
    await page.getByRole("link", { name: "New entry" }).click();
    await expect(page.getByRole("heading", { name: "New entry" })).toBeVisible();

    await field(page, "Trip").selectOption({ index: 1 });
    await field(page, "Slug").fill("first-entry");
    await field(page, "Headline").fill(entryHeadline);
    await field(page, "Story").fill(entryStory);
    await page.getByRole("button", { name: "Save entry" }).click();
    await expect(page.getByRole("status")).toHaveText(/^Saved as a draft\./);

    /* ── publish the trip, then the entry — §5 refuses the other order ───── */
    await page.goto("/studio");
    const tripRow = rowFor(page, tripName);
    await expect(tripRow.getByText("Draft")).toBeVisible();
    const publishTrip = tripRow.getByRole("button", { name: "Publish" });
    await publishTrip.click();
    await expect(publishTrip).toBeEnabled();
    await expect(tripRow.getByRole("alert")).toHaveCount(0);

    await page.goto(`/studio/trips/${tripSlug}`);
    const entryRow = rowFor(page, entryHeadline);
    await expect(entryRow.getByText("Draft")).toBeVisible();
    // Proves the ordering above actually mattered, not just that a button exists.
    await expect(entryRow.getByText(/not published yet/)).toHaveCount(0);
    const publishEntry = entryRow.getByRole("button", { name: "Publish" });
    await expect(publishEntry).toBeEnabled();
    await publishEntry.click();
    await expect(publishEntry).toBeEnabled();
    await expect(entryRow.getByRole("alert")).toHaveCount(0);

    /* ── the public, unauthenticated site now shows both ──────────────────── */
    const guest = await page.context().browser()!.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto("/");
    await expect(guestPage.getByRole("link", { name: tripName, exact: true })).toBeVisible();
    await guestPage.getByRole("link", { name: tripName, exact: true }).click();
    await expect(guestPage.getByRole("link", { name: entryHeadline, exact: true })).toBeVisible();
    await guestPage.getByRole("link", { name: entryHeadline, exact: true }).click();
    await expect(guestPage.getByRole("heading", { name: entryHeadline, level: 1 })).toBeVisible();
    await expect(guestPage.getByText(entryStory)).toBeVisible();

    const afterPublish = await request.get(tripResourceUrl);
    expect(afterPublish.status()).toBe(200);
    expect(await afterPublish.text()).toContain(tripName);

    /* ── unpublish the trip: the entry goes dark with it (§5's cascade) ───── */
    await page.goto("/studio");
    const publishedRow = rowFor(page, tripName);
    await expect(publishedRow.getByText("Published")).toBeVisible();
    const takeOffline = publishedRow.getByRole("button", { name: "Take offline" });
    await takeOffline.click();
    await expect(takeOffline).toBeEnabled();
    await expect(publishedRow.getByRole("alert")).toHaveCount(0);

    /* ── gone from the public site: the home list, and the Pod's own ACL ──── */
    await guestPage.goto("/");
    await expect(guestPage.getByRole("link", { name: tripName, exact: true })).toHaveCount(0);

    // proxy.ts fails open for up to 60s (its own comment), so the trip route's
    // HTTP status is not asserted here — its rendered content is, which the
    // page's own second-line-of-defence check (TripContent) still enforces.
    await guestPage.goto(`/trips/${tripSlug}`);
    await expect(guestPage.getByRole("heading", { name: "Not found" })).toBeVisible();
    await expect(guestPage.getByRole("link", { name: entryHeadline, exact: true })).toHaveCount(0);

    const afterUnpublish = await request.get(tripResourceUrl);
    expect([401, 403, 404]).toContain(afterUnpublish.status());

    await guest.close();
  });
});

/**
 * The sheet in a real browser: the snap positions spec §2 measured, the
 * pointer-events pass-through that no unit test can see, the pin that has to
 * MOVE the sheet, and one canvas across all of it. Mutation controls in
 * ./notes.md#the-ten-map-sheet-controls
 */

import { expect, test, type Page } from "@playwright/test";

const TRIP = "/trips/2026-japan";
const PHONE = { width: 390, height: 800 };
const DESKTOP = { width: 1280, height: 800 };
const HANDLE = /resize the entry list/i;
const NARA = "2026-03-31-nara";

/** Every marker locator goes through the map region: `data-slug` is on the
 *  timeline row too, so a page-level locator matches two elements. */
const mapRegion = (page: Page) => page.getByRole("region", { name: "Trip map" });

/** The canvas, never the container — a mounted map is not a map that drew. */
const canvasOf = (page: Page) => mapRegion(page).locator("canvas.maplibregl-canvas");

/** The row, by the link it contains, exactly as the other specs locate it. */
const rowFor = (page: Page, slug: string) => page.locator(`li:has(a[href="${TRIP}/${slug}"])`);

const scrollTop = (page: Page) => page.locator(".trip-sheet").evaluate((el) => el.scrollTop);

const bodyTop = (page: Page) =>
  page.locator(".trip-sheet-body").evaluate((el) => Math.round(el.getBoundingClientRect().top));

test.describe("the mobile sheet", () => {
  test.use({ viewport: PHONE });

  test("rests at the three snap points, and the canvas is the same node at each", async ({
    page,
  }) => {
    await page.goto(TRIP);
    const canvas = canvasOf(page);
    await expect(canvas).toBeVisible();
    const first = await canvas.elementHandle();

    expect(await scrollTop(page)).toBe(0);

    // half: 30dvh of 800, an exact detent because the spacers enforce it.
    const handle = page.getByRole("button", { name: HANDLE });
    await handle.click();
    await expect.poll(() => scrollTop(page)).toBe(240);

    // full is asserted as the BODY'S TOP RECT, not a scrollTop: with a timeline
    // longer than the viewport every position past it is a valid rest position,
    // so the scrollTop is a floor and the 8dvh strip is the thing promised.
    await handle.click();
    await expect.poll(() => bodyTop(page)).toBe(64);

    // The cycle closes: full → peek, which is the whole keyboard story.
    await handle.click();
    await expect.poll(() => scrollTop(page)).toBe(0);

    // One `===` against the handle captured at peek, not a count of canvases:
    // a remount anywhere in that sequence leaves a different node here.
    expect(await canvas.evaluate((el, was) => el === was, first)).toBe(true);
  });

  test("a marker is tappable through the sheet, and the tap pins its row and opens the sheet", async ({
    page,
  }) => {
    await page.goto(TRIP);
    const marker = mapRegion(page).locator(`[data-slug="${NARA}"]`);
    await expect(marker).toBeVisible();
    expect(await scrollTop(page)).toBe(0);

    // Spec §2 in the real page: what is on top at the marker's own centre. With
    // the scroller at pointer-events:auto this is the sheet, and every marker is
    // untappable with nothing thrown and nothing logged.
    const box = await marker.boundingBox();
    if (box === null) throw new Error("the marker has no box");
    const onTop = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("[data-slug]")?.getAttribute("data-slug"),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(onTop).toBe(NARA);

    await marker.click();

    // THE SHEET MOVES, which is the half of the pin no other test asserts, and
    // it moves ON THE TAP — asserted with the cursor STILL ON THE MARKER. That
    // ordering is the whole control: Chrome emits an emulated mouseenter before
    // click, so an effect keyed on the derived source reads "map" here and opens
    // the sheet only on a later mouseleave, which a move-first test would supply
    // for it. `targetForRow` floors the target at half.
    await expect.poll(() => scrollTop(page)).toBeGreaterThanOrEqual(240);

    // NOW off the marker: while the cursor sits on it the row is lit either way,
    // so only what survives the mouseleave is the pin.
    await page.mouse.move(5, 5);
    await expect(rowFor(page, NARA)).toHaveAttribute("data-active", "true");
  });

  test("a tap on the map itself clears the pin", async ({ page }) => {
    await page.goto(TRIP);
    const marker = mapRegion(page).locator(`[data-slug="${NARA}"]`);
    await expect(marker).toBeVisible();
    const row = rowFor(page, NARA);

    await marker.click();
    // Off the marker, so this is the pin and not the hover — see the case above.
    await page.mouse.move(5, 5);
    await expect(row).toHaveAttribute("data-active", "true");

    // Revealing a row near the end of a SHORT timeline lands the sheet at the
    // end of its scroll, where no strip of map is left to tap — so wait for
    // that scroll to settle and let the handle take it back to peek first.
    // ./notes.md#the-strip-of-map-is-a-detent-not-a-pin
    await expect.poll(() => scrollTop(page)).toBeGreaterThanOrEqual(240);
    await page.getByRole("button", { name: HANDLE }).click();
    await expect.poll(() => scrollTop(page)).toBe(0);

    // A corner the seeded markers are nowhere near — nara's 40px box measures
    // at (207,340). Asserted before the click so a tap that lands on the sheet
    // says so, rather than reporting a pin that would not clear.
    await expect
      .poll(() => page.evaluate(() => document.elementFromPoint(20, 20)?.tagName))
      .toBe("CANVAS");
    await page.mouse.click(20, 20);
    await expect(row).not.toHaveAttribute("data-active", "true");
  });
});

test("at desktop width the sheet is a column beside a sticky map, still one canvas", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await page.goto(TRIP);
  const canvas = canvasOf(page);
  await expect(canvas).toBeVisible();
  const first = await canvas.elementHandle();

  await page.setViewportSize(DESKTOP);
  await expect
    .poll(() => page.locator(".trip-sheet").evaluate((el) => getComputedStyle(el).position))
    .toBe("static");
  expect(await page.locator(".trip-map-pane").evaluate((el) => getComputedStyle(el).position)).toBe(
    "sticky",
  );

  // The map is a SIBLING of the sheet, not a child of it (spec §3) — the shape
  // that makes "one map, never remounted" structural. Both nodes are asserted
  // present in the same object, so a missing selector cannot read as `false`.
  expect(
    await page.evaluate(() => {
      const sheet = document.querySelector(".trip-sheet");
      const pane = document.querySelector(".trip-map-pane");
      return { sheet: sheet !== null, pane: pane !== null, contained: sheet?.contains(pane) };
    }),
  ).toEqual({ sheet: true, pane: true, contained: false });

  // The breakpoint is a media query and never a JS branch on width (spec §3):
  // the whole layout swaps and the canvas node survives it.
  expect(await canvas.evaluate((el, was) => el === was, first)).toBe(true);
});

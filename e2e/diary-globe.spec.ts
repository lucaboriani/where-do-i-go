/**
 * The diary globe in a real browser: a circle painted where each published trip
 * is, a click that flies the camera and pins the row, the background click that
 * lets it go, and the draft on neither surface. Mutation controls in
 * ./notes.md#the-seven-diary-globe-controls
 */

import { expect, test, type Page } from "@playwright/test";

type MapLibreMap = import("maplibre-gl").Map;

const JAPAN = "2026-japan";
const PATAGONIA = "2025-patagonia";
const DRAFT = "2026-secret";
const LAYER = "diary-trip-points";

/** Each trip's own dy:centerLat/dy:centerLong in scripts/seed-dev-pod.ts. The
 *  marker is asserted AT these, so a marker on the wrong trip is not a pass. */
const JAPAN_AT = [134.8414, 33.6526] as const;
const PATAGONIA_AT = [-73.0119, -49.9141] as const;

/** The centre of 2025-patagonia's own bbox, rounded: fitBounds lands on the
 *  box's centre whatever the symmetric padding does. */
const PATAGONIA_VIEW = { lng: -73, lat: -50 };

/** The map region, not the page. */
const mapRegion = (page: Page) => page.getByRole("region", { name: "Diary map" });

/** The canvas, never the container — a mounted map is not a map that drew. */
const canvasOf = (page: Page) => mapRegion(page).locator("canvas.maplibregl-canvas");

/** The row, by the link it contains, exactly as the other specs locate it. */
const rowFor = (page: Page, slug: string) => page.locator(`li:has(a[href="/trips/${slug}"])`);

type Point = { x: number; y: number };

/**
 * Where a coordinate lands in the viewport now, and what the map PAINTS there.
 * EVERY QUERY HERE IS A POINT QUERY, and not for style: under the globe the
 * whole-viewport form answers with the far side and omits what is on screen.
 * ./notes.md#the-whole-viewport-query-lies-on-a-globe
 */
const markerAt = (page: Page, lngLat: readonly [number, number]) =>
  mapRegion(page).evaluate(
    (el, { at, layer }) => {
      const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
      const box = el.getBoundingClientRect();
      const local = map?.project(at as [number, number]) ?? { x: 0, y: 0 };
      const point = { x: box.left + local.x, y: box.top + local.y };
      return {
        point,
        onTop: document.elementFromPoint(point.x, point.y)?.tagName,
        // [x, y], not { x, y }: maplibre's PointLike is a tuple or its own
        // Point class, and the object form type-errors while working at runtime.
        features: (
          map?.queryRenderedFeatures([local.x, local.y], { layers: [layer] }) ?? []
        ).map((feature) => ({
          slug: String(feature.properties?.slug),
          state: feature.state,
        })),
      };
    },
    { at: lngLat, layer: LAYER },
  );

const slugsAt = async (page: Page, lngLat: readonly [number, number]): Promise<string[]> =>
  (await markerAt(page, lngLat)).features.map((feature) => feature.slug);

/** What is on top at a viewport point, and how many trip features are under it.
 *  Both in one object so a missing map cannot read as "nothing there". */
const hitAt = (page: Page, point: Point) =>
  mapRegion(page).evaluate(
    (el, { at, layer }) => {
      const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
      const box = el.getBoundingClientRect();
      return {
        onTop: document.elementFromPoint(at.x, at.y)?.tagName,
        features: map?.queryRenderedFeatures([at.x - box.left, at.y - box.top], {
          layers: [layer],
        }).length,
      };
    },
    { at: point, layer: LAYER },
  );

/** Rounded, because the assertion is "it flew to that trip" and the last metre
 *  of an eased fit is not what is under test. */
const centre = (page: Page) =>
  mapRegion(page).evaluate((el) => {
    const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
    const at = map?.getCenter();
    return at === undefined ? null : { lng: Math.round(at.lng), lat: Math.round(at.lat) };
  });

/** A globe shows one hemisphere and these two trips are 208° apart, so no
 *  camera holds both. Spinning it is what a reader does by dragging; a drag
 *  under MapLibre's 3px tolerance is a pan, and this is not testing the pan. */
const spinTo = (page: Page, lngLat: readonly [number, number]) =>
  mapRegion(page).evaluate(
    (el, at) => {
      const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
      map?.jumpTo({ center: at as [number, number], zoom: 2 });
    },
    lngLat,
  );

/** A circle layer has no DOM node to click, so this is a real mouse click at
 *  the feature's own pixel — `map.fire("click")` would drive the handler while
 *  proving nothing about the canvas ever receiving one. Checked first: a click
 *  landing beside the circle, or on the sheet, must not read as a marker that
 *  does not pin. */
async function clickMarker(page: Page, lngLat: readonly [number, number], slug: string) {
  const marker = await markerAt(page, lngLat);
  expect({ onTop: marker.onTop, slugs: marker.features.map((f) => f.slug) }).toEqual({
    onTop: "CANVAS",
    slugs: [slug],
  });
  await page.mouse.click(marker.point.x, marker.point.y);
}

test.describe("the diary globe", () => {
  // The shell is width-dependent and these cases are about the map: at desktop
  // width the trip list is a column beside it rather than a sheet over it.
  test.use({ viewport: { width: 1280, height: 800 } });

  test("paints one marker at each published trip, a hemisphere apart", async ({ page }) => {
    await page.goto("/");
    await expect(canvasOf(page)).toBeVisible();

    // Exactly one feature at each trip's centre, not a count over the globe: a
    // second circle on the same coordinate is the shape a duplicated or
    // re-added source takes, and a bare count would call that two trips.
    await expect.poll(() => slugsAt(page, PATAGONIA_AT)).toEqual([PATAGONIA]);

    await spinTo(page, JAPAN_AT);
    await expect.poll(() => slugsAt(page, JAPAN_AT)).toEqual([JAPAN]);
  });

  test("clicking a marker flies the camera to that trip and pins its row", async ({ page }) => {
    await page.goto("/");
    await expect(canvasOf(page)).toBeVisible();
    await expect.poll(() => slugsAt(page, PATAGONIA_AT)).toEqual([PATAGONIA]);

    const before = await centre(page);
    expect(before).not.toEqual(PATAGONIA_VIEW);

    await clickMarker(page, PATAGONIA_AT, PATAGONIA);
    await expect.poll(() => centre(page)).toEqual(PATAGONIA_VIEW);

    // Off the marker first: while the cursor sits on it the row is lit by the
    // hover either way, so only what survives the mouseleave is the pin.
    await page.mouse.move(5, 5);
    await expect(rowFor(page, PATAGONIA)).toHaveAttribute("data-active", "true");
    await expect(rowFor(page, JAPAN)).not.toHaveAttribute("data-active", "true");
  });

  test("clicking the map background clears the pin a marker set", async ({ page }) => {
    await page.goto("/");
    await expect(canvasOf(page)).toBeVisible();
    await expect.poll(() => slugsAt(page, PATAGONIA_AT)).toEqual([PATAGONIA]);

    await clickMarker(page, PATAGONIA_AT, PATAGONIA);
    await page.mouse.move(5, 5);
    const row = rowFor(page, PATAGONIA);
    await expect(row).toHaveAttribute("data-active", "true");

    // The corner, asserted empty rather than assumed, and asserted to be the
    // canvas: a tap that landed on the sheet would report as a pin that will
    // not clear. Top-left, because the attribution control is bottom-right.
    const box = await canvasOf(page).boundingBox();
    if (box === null) throw new Error("the canvas has no box");
    const point = { x: box.x + 20, y: box.y + 20 };
    await expect.poll(() => hitAt(page, point)).toEqual({ onTop: "CANVAS", features: 0 });

    await page.mouse.click(point.x, point.y);
    await expect(row).not.toHaveAttribute("data-active", "true");
  });

  test("hovering a trip row marks its marker's own rendered feature state", async ({ page }) => {
    await page.goto("/");
    await expect(canvasOf(page)).toBeVisible();
    await expect.poll(() => slugsAt(page, PATAGONIA_AT)).toEqual([PATAGONIA]);

    // The PAINTED feature's state, not a bare getFeatureState(id): that store
    // answers for whatever id it is handed, promoted or not, so it cannot tell
    // a real id from a coincidence. ./notes.md#the-three-mutation-controls
    await page.locator(`a[href="/trips/${PATAGONIA}"]`).hover();
    await expect
      .poll(async () => (await markerAt(page, PATAGONIA_AT)).features.map((f) => f.state))
      .toEqual([{ active: true }]);
  });

  test("the draft trip reaches neither the list nor a link", async ({ page }) => {
    await page.goto("/");
    // The allow-case first, in the same test: an absence assertion on a page
    // that rendered nothing at all passes while proving nothing.
    await expect(page.locator(`a[href="/trips/${JAPAN}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/trips/${PATAGONIA}"]`)).toBeVisible();

    await expect(page.locator(`a[href="/trips/${DRAFT}"]`)).toHaveCount(0);
    // Its schema:name in the seed, for a leak that renders the trip without
    // linking it.
    await expect(page.getByText("Unpublished plans")).toHaveCount(0);
  });
});

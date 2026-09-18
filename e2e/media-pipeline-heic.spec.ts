import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  attach,
  collectUploads,
  control,
  dimensionsOf,
  exifOf,
  expectLiveCoordinateControls,
  expectOwnerStudio,
  LATITUDE,
  LONGITUDE,
  serveHomeRegion,
  WHEN,
} from "./media-pipeline-helpers";
import { signInAsOwner } from "./sign-in";

/**
 * HEIC in the real worker: no browser decodes it natively, so this is the
 * only place any of it can be proven — RED until pipeline.worker.ts grows a
 * HEIC branch. ./notes.md#the-three-heic-fixtures: how the fixtures were
 * built and what each one proves.
 */

test.describe("HEIC photos in the media pipeline", () => {
  test.describe.configure({ timeout: 120_000 });

  const fixture = (name: string): Buffer =>
    readFileSync(fileURLToPath(new URL(`../test/fixtures/heic/${name}`, import.meta.url)));

  test("decodes a plain HEIC into valid, resized, EXIF-stripped derivatives", async ({ page }) => {
    test.setTimeout(180_000);

    const heic = fixture("plain.heic");
    /** Real EXIF this fixture carries going in — the base sips converted from
     *  still has it, and it is what "stripped" below is measured against. */
    expect(exifOf(heic)?.exif?.DateTimeOriginal?.description).toBe("2026:03:20 13:49:21");

    await signInAsOwner(page);
    await expectOwnerStudio(page);

    const uploads = await collectUploads(page);
    await attach(page, "plain.heic", heic, { mimeType: "image/heic", timeout: 150_000 });

    const web = uploads.find((u) => /\/web\./.test(u.url));
    const thumb = uploads.find((u) => /\/thumb\./.test(u.url));
    expect(web, `no web derivative among ${uploads.map((u) => u.url).join(", ")}`).toBeDefined();
    expect(thumb, `no thumb derivative among ${uploads.map((u) => u.url).join(", ")}`).toBeDefined();
    if (!web || !thumb) return;

    /** 1800x1350 native (sips, checked before this spec was written) into the
     *  1600 and 400 boxes — both divide evenly, same shape as the JPEG suite. */
    expect(await dimensionsOf(page, web.body)).toEqual({ width: 1600, height: 1200 });
    expect(await dimensionsOf(page, thumb.body)).toEqual({ width: 400, height: 300 });

    for (const derivative of [web, thumb]) {
      const magic = derivative.body.subarray(0, 12);
      const isWebp =
        magic.subarray(0, 4).toString("ascii") === "RIFF" &&
        magic.subarray(8, 12).toString("ascii") === "WEBP";
      const isJpeg = magic[0] === 0xff && magic[1] === 0xd8;
      expect(
        isWebp || isJpeg,
        `${derivative.url} is neither WebP nor JPEG: ${[...magic].join(" ")}`,
      ).toBe(true);
      expect(
        exifOf(derivative.body)?.exif?.DateTimeOriginal?.description,
        `the capture time survived into ${derivative.url}`,
      ).toBeUndefined();
    }
  });

  /**
   * THE CASE THAT MATTERS MOST: `orientation-6.heic` is stored 320x240, pixels
   * genuinely un-rotated — only the Orientation tag says "rotate 90° CW". A
   * decode that skips rotation sizes every derivative off that landscape pair.
   * ./notes.md#the-three-heic-fixtures
   */
  test("rotates an orientation-6 HEIC upright before resizing", async ({ page }) => {
    const heic = fixture("orientation-6.heic");
    expect(exifOf(heic)?.exif?.Orientation?.value, "the fixture is not orientation 6").toBe(6);

    await signInAsOwner(page);
    await expectOwnerStudio(page);

    const uploads = await collectUploads(page);
    await attach(page, "orientation-6.heic", heic, { mimeType: "image/heic" });

    const web = uploads.find((u) => /\/web\./.test(u.url));
    expect(web, `no web derivative among ${uploads.map((u) => u.url).join(", ")}`).toBeDefined();
    if (!web) return;

    /** 240x320, PORTRAIT: width < height. A decode that ignored Orientation
     *  would size off the stored 320x240 instead — measured directly against
     *  libheif-js while building this fixture (./notes.md#the-three-heic-fixtures). */
    const dims = await dimensionsOf(page, web.body);
    expect(dims, `web derivative is ${dims.width}x${dims.height}, not upright`).toEqual({
      width: 240,
      height: 320,
    });
  });

  test("fills the coordinate and the wall clock from a HEIC's own EXIF", async ({ page }) => {
    const home = await serveHomeRegion(page);

    await signInAsOwner(page);
    await expectOwnerStudio(page);
    await expectLiveCoordinateControls(page, home);

    const heic = fixture("gps-datetime.heic");
    const tags = exifOf(heic);
    const readLat = tags?.gps?.Latitude;
    const readLong = tags?.gps?.Longitude;
    expect(readLat, "the fixture carries no GPS going in").toBeCloseTo(-33.8581, 3);
    expect(readLong, "the fixture carries no GPS going in").toBeCloseTo(151.21, 3);
    expect(tags?.exif?.DateTimeOriginal?.description).toBe("2026:05:12 09:15:33");
    expect(Math.abs(home.lat - readLat!), "the fixture sits inside the home region").toBeGreaterThan(
      1,
    );
    expect(Math.abs(home.long - readLong!)).toBeGreaterThan(1);

    for (const label of [LATITUDE, LONGITUDE, WHEN] as const) {
      await expect(control(page, label)).toHaveValue("");
    }

    await collectUploads(page);
    await attach(page, "gps-datetime.heic", heic, { mimeType: "image/heic" });

    await expect(
      control(page, LATITUDE),
      "the photo's latitude never reached the control: the real worker read no GPS out of the HEIC's own EXIF",
    ).not.toHaveValue("");
    expect(Number(await control(page, LATITUDE).inputValue())).toBeCloseTo(readLat!, 6);
    expect(Number(await control(page, LONGITUDE).inputValue())).toBeCloseTo(readLong!, 6);

    await expect(
      control(page, WHEN),
      "the photo's DateTimeOriginal never reached the control",
    ).not.toHaveValue("");
    const wall = "2026-05-12T09:15:33";
    expect([wall.slice(0, 16), wall, `${wall}.000`]).toContain(await control(page, WHEN).inputValue());
  });
});

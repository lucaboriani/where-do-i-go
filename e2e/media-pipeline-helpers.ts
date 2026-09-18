import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "@playwright/test";
import ExifReader from "exifreader";
import { E2E } from "./environment";
import type { Page } from "@playwright/test";
import type { ExpandedTags } from "exifreader";

/**
 * Shared by `media-pipeline.spec.ts` and `media-pipeline-heic.spec.ts`. NOT a
 * `.spec.ts` module, same as `./sign-in.ts`: importing one re-runs its
 * top-level `test.describe`, registering that whole suite again.
 */

export type Upload = { url: string; body: Buffer; contentType: string; ifNoneMatch: string };

/**
 * Every PUT into `travel/media/`, with its bytes.
 *
 * MEASURED, NOT ASSUMED: `postDataBuffer()` really does return the bytes of a
 * `Blob` request body under @playwright/test 1.62.1 and Chromium 1234 — probed
 * before this spec was written, because this is precisely what jsdom could not
 * do (Task 7 saw the nine bytes of "undefined") and the whole task rests on it.
 * `expect(uploads).toHaveLength(2)` would pass on an empty body, so the length
 * check is never the thing that proves the bytes arrived; the magic-byte and
 * dimension assertions are.
 *
 * FULFILLED RATHER THAN FORWARDED, for two reasons. The response is
 * deterministic — a real PUT would 201 on the first run and 412 on every run
 * after, since the path is content-addressed — and nothing is left behind in a
 * container whose ACL this test never sets. The CORS headers are not optional:
 * a fulfilled cross-origin response without them is rejected by the browser
 * before `putGuarded` ever sees a status.
 */
export async function collectUploads(page: Page): Promise<Upload[]> {
  const uploads: Upload[] = [];
  await page.route("**/travel/media/**", async (route) => {
    const request = route.request();
    if (request.method() !== "PUT") {
      await route.continue();
      return;
    }
    const headers = request.headers();
    uploads.push({
      url: request.url(),
      body: request.postDataBuffer() ?? Buffer.alloc(0),
      contentType: headers["content-type"] ?? "",
      ifNoneMatch: headers["if-none-match"] ?? "",
    });
    await route.fulfill({
      status: 201,
      headers: {
        etag: '"1"',
        "access-control-allow-origin": E2E.siteUrl,
        "access-control-allow-credentials": "true",
        "access-control-expose-headers": "etag",
      },
    });
  });
  return uploads;
}

/**
 * Pick a file and wait for its slot to settle.
 *
 * The wait is on the LIST ITEM rather than on the ready sentence, and that is
 * for the failure message: a slot that failed renders "<name> was not attached:
 * <reason>" into the same `<li>`, so Playwright prints the reason as the
 * received text instead of timing out on a locator that matched nothing.
 *
 * `mimeType` defaults to JPEG for every existing caller; the HEIC suite is the
 * first to pass its own.
 */
export async function attach(
  page: Page,
  name: string,
  bytes: Uint8Array,
  options: { timeout?: number; mimeType?: string } = {},
): Promise<void> {
  await visiblyLabelled(page, PHOTOS).setInputFiles({
    name,
    mimeType: options.mimeType ?? "image/jpeg",
    buffer: Buffer.from(bytes),
  });

  const slot = page.getByRole("listitem").filter({ hasText: name });
  await expect(slot).toContainText("is attached to this entry", {
    timeout: options.timeout ?? 60_000,
  });
  await expect(page.getByRole("img", { name })).toBeVisible();
}

/** The published trip both specs write entries into. Any owner-writable trip
 *  would do; a real seeded one avoids either file creating its own.
 *  scripts/seed-dev-pod.ts is the source of truth for the slug. */
export const SEEDED_TRIP = "2026-japan";

/**
 * Three assertions, because any ONE alone only covers part of what this
 * needs — a docblock claiming coverage it does not have is a documented
 * defect shape in this repository: it stops the next person looking.
 *
 * The `Signed in as …` line discriminates OWNER FROM NOT-OWNER and nothing
 * else — worth having, since it is what breaks when OWNER_WEBID loses its
 * `#me` — but it says nothing about the editor, which is why this also opens
 * `SEEDED_TRIP`'s own "New entry" route before checking for the control.
 *
 * THE HEADING GATES THE PHOTOS CHECK, AND THAT ORDER IS LOAD-BEARING. The
 * trip editor's own "Cover photo" field matches `PHOTOS` too (see
 * `visiblyLabelled`'s docblock), and on a slow/cold render the old page can
 * still be the CSS-`:visible` one for a moment after the click "finishes" —
 * measured 2026-09-18, where that window was wide enough for `attach()` to
 * set the file on the trip's cover input and then wait 150 s for a list item
 * that could never appear. Waiting for the entry editor's OWN heading first
 * closes that window rather than widening the attach timeout around it.
 */
export async function expectOwnerStudio(page: Page): Promise<void> {
  await expect(page.getByText(`Signed in as ${E2E.ownerWebId}.`)).toBeVisible();
  await page.locator(`a[href="/studio/trips/${SEEDED_TRIP}"]`).click();
  await page.getByRole("link", { name: "New entry" }).click();
  await expect(page.getByRole("heading", { name: "New entry" })).toBeVisible();
  await expect(
    visiblyLabelled(page, PHOTOS),
    `the owner studio rendered no editor after opening ${SEEDED_TRIP}'s new-entry route: ` +
      "the trip failed to load, its entries list failed, or the route itself changed.",
  ).toBeVisible();
}

/**
 * The exact bytes, as their own ArrayBuffer.
 *
 * A Buffer's `.buffer` is the shared pool it was allocated from, not its own
 * contents, and a Uint8Array's may be a window onto something larger. Slicing
 * is what makes ExifReader read this image and not some other request's bytes.
 */
export function bytesOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Tags, or `null` for bytes carrying no readable metadata at all — which is
 *  what a stripped derivative is, and which ExifReader signals by throwing. */
export function exifOf(bytes: Uint8Array): ExpandedTags | null {
  try {
    return ExifReader.load(bytesOf(bytes), { expanded: true });
  } catch {
    return null;
  }
}

/** Decoded in the browser rather than parsed here: the derivative may be WebP
 *  or JPEG (§6.1 leaves that to the encoder), and a hand-rolled header parser
 *  would be a second thing to get right for no gain. */
export async function dimensionsOf(
  page: Page,
  bytes: Buffer,
): Promise<{ width: number; height: number }> {
  return page.evaluate(async (numbers) => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(numbers)]));
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }, Array.from(bytes));
}

/** The same spelling as `PHOTOS_LABEL` in components/studio/entry-editor/entry-editor.test.tsx, which is
 *  the table an implementer changes when they reword the label. One constant,
 *  so the guard below and the pick above can never drift apart and leave the
 *  guard passing on a control the pick cannot find. */
export const PHOTOS = /photos?\b/i;

/**
 * The coordinate/wall-clock controls, spelled as `LABEL` in
 * components/studio/entry-editor/entry-editor.test.tsx spells them, for
 * `PHOTOS`'s reason: that object is the table an implementer edits when they
 * reword a label, and a second spelling here would go on matching nothing
 * while looking like an auto-fill that did not happen.
 *
 * PLAYWRIGHT'S STRICT MODE IS THE ANALOGUE OF SECTION 8b's "EXACTLY ONE MATCH"
 * CONTROL: `getByLabel` throws on two matches, so a `<section aria-label="…">`
 * wrapper that shadowed one of these fails here by name instead of quietly
 * resolving to the wrapper.
 */
export const LATITUDE = /latitude/i;
export const LONGITUDE = /longitude/i;
export const PRECISION = /precision/i;
export const WHEN = /when|occurred|date/i;

/** `getByLabel`, filtered to the one actually on screen. Next's client router
 *  cache keeps the trip editor's own hidden DOM mounted across the soft nav
 *  into "New entry" (measured, not assumed), and its own "Cover photo" and
 *  "Start"/"End date" fields then collide with `PHOTOS` and `WHEN`. */
export const visiblyLabelled = (page: Page, label: string | RegExp) =>
  page.getByLabel(label).and(page.locator(":visible"));

export const control = (page: Page, label: RegExp) => visiblyLabelled(page, label);

/**
 * §7.6, SERVED TO THE BROWSER, AND WHAT IT DECLARES.
 *
 * Faked at the HTTP layer for the reason every Pod fake in this repository is:
 * the seeded Pod writes no `privacy.ttl` (§7.6 says nothing in this codebase
 * ever does), and §9 fails closed with no such document — the coordinate
 * controls would stay `disabled` before a single photo is ever picked.
 *
 *   - EXTRACTED FROM docs/data-model.md AT RUNTIME, selected by CONTENT rather
 *     than by position. The §7 fixtures are normative, so a hand-copied home
 *     region would test a copy of the spec — and this one is read for its
 *     VALUES as well as its bytes, which makes that worse.
 *   - GET ONLY, EVERYTHING ELSE FORWARDED, with real CORS headers: without
 *     them the browser rejects the response before `readPrivacySettings` sees
 *     a status, and §9 fails closed on a `network` error that looks nothing
 *     like the truth.
 */
export async function serveHomeRegion(page: Page): Promise<{
  lat: number;
  long: number;
  precisionMeters: string;
}> {
  const doc = readFileSync(fileURLToPath(new URL("../docs/data-model.md", import.meta.url)), "utf8");
  const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)]
    .map((match) => match[1]!)
    .filter((block) => block.includes("dy:homeLat"));
  expect(
    blocks,
    "docs/data-model.md has no single Turtle block declaring dy:homeLat: §7.6 was renamed, removed, or is now quoted twice, and this test would otherwise serve the wrong fixture",
  ).toHaveLength(1);
  const turtle = blocks[0]!;

  await page.route("**/travel/settings/privacy.ttl", async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/turtle",
        etag: '"privacy-1"',
        "access-control-allow-origin": E2E.siteUrl,
        "access-control-allow-credentials": "true",
        "access-control-expose-headers": "etag",
      },
      body: turtle,
    });
  });

  return {
    lat: declaredNumber(turtle, "homeLat"),
    long: declaredNumber(turtle, "homeLong"),
    /** As a STRING, because it is compared with what a `<select>` holds and
     *  `500` is the value the option carries verbatim (§7.6 has no default for
     *  this, which is what makes it a witness that the read resolved). */
    precisionMeters: String(declaredNumber(turtle, "defaultPrecisionMeters")),
  };
}

/** One `dy:` term's literal out of §7.6, with the match asserted: a regex that
 *  stopped matching would otherwise yield `NaN`, and `NaN > 1` is `false` —
 *  the "outside the home region" check would fail for a reason that is not
 *  about the fixture at all. */
function declaredNumber(turtle: string, term: string): number {
  const found = new RegExp(`dy:${term}\\s+(-?[\\d.]+)\\s*[;.]`).exec(turtle);
  expect(found, `§7.6 declares no dy:${term} in a shape this test can read`).not.toBeNull();
  return Number(found![1]);
}

/**
 * THE COORDINATE CONTROLS ARE LIVE, AND THE SETTINGS ARE WHY — the e2e twin of
 * `awaitLiveCoordinateControls` in components/studio/entry-editor/entry-editor.test.tsx, and load-bearing
 * for the same reason: §9's fail-closed branch and a worker that read nothing
 * are the same empty box, so the gate has to be proved OPEN before a photo is
 * picked or every assertion after it is ambiguous.
 *
 * TWO CHECKS, AND THE SECOND CANNOT BE FAKED BY A PENDING STATE. `toBeEnabled`
 * alone also holds for a build that never gated the controls at all; the
 * precision select showing §7.6's own `dy:defaultPrecisionMeters` can only
 * happen after `readPrivacySettings` resolved against the served document,
 * because this app supplies no fallback for that value.
 */
export async function expectLiveCoordinateControls(
  page: Page,
  home: { precisionMeters: string },
): Promise<void> {
  for (const label of [LATITUDE, LONGITUDE] as const) {
    await expect(
      control(page, label),
      `the ${String(label)} control never became live: the §7.6 route did not match, or the read took §9's fail-closed branch — either way no photo can fill this box and nothing below is about EXIF`,
    ).toBeEnabled();
  }
  await expect(
    control(page, PRECISION),
    "the precision control is not showing §7.6's own dy:defaultPrecisionMeters: the settings had not landed when this test started",
  ).toHaveValue(home.precisionMeters);
}

export const containerOf = (url: string): string => url.slice(0, url.lastIndexOf("/") + 1);

import { expect, test } from "@playwright/test";
import ExifReader from "exifreader";
import { E2E } from "./environment";
import { signInAsOwner } from "./sign-in";
import { spliceExif } from "../test/fixtures/exif-jpeg";
import type { Page } from "@playwright/test";
import type { ExpandedTags } from "exifreader";

/**
 * The pixel half of the media pipeline, in a real browser.
 *
 * jsdom has no createImageBitmap, no OffscreenCanvas and no encoder, so
 * everything below is invisible to `npm test` by construction. Worse, Task 7
 * MEASURED that a jsdom `Blob` reaches MSW as the nine bytes of "undefined" —
 * so the vitest suite pins file names and content types and nothing about the
 * bytes. THE UPLOADED BYTES ARE CHECKED HERE AND NOWHERE ELSE IN THIS
 * REPOSITORY. This spec is gated by CLAUDE.md's path rule rather than by the
 * eight-command list: it touches components/studio/**, so `npm run test:e2e`
 * must pass.
 *
 * NO COMMITTED BINARIES. The photo is generated in the page as a gradient,
 * encoded to JPEG by the browser, then given real EXIF by splicing an APP1
 * segment in with test/fixtures/exif-jpeg.ts. What went in is therefore known
 * exactly, which is what gives "no GPS came out" its force — and the sanity
 * check in each test, that the fixture really carries what it claims BEFORE
 * the pipeline sees it, is what keeps that from being a guard that cannot fail.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THREE THINGS THE TASK BRIEF'S DRAFT ASSUMED THAT THE APP DOES NOT DO. Each is
 * a deviation from the brief, and each is written down rather than quietly
 * worked around.
 *
 *   1. THERE IS NO `/studio/entries/new` ROUTE. The editor is rendered by
 *      components/studio/studio-shell.tsx on the `owner` branch of `/studio`,
 *      and only once the trips enumeration has come back with at least one trip
 *      (§4: an entry lives inside a trip). `signInAsOwner` leaves the browser
 *      exactly there, so there is nothing to navigate to.
 *
 *   2. THE RENDERED `<img>` CARRIES NO `width`/`height` ATTRIBUTES. It is sized
 *      in CSS (`h-16 w-16 object-cover`) as a 64 px chip, so reading attributes
 *      off it would have read `null`, and `Number(null) > Number(null)` is
 *      `false` — the orientation test would have failed for a reason that has
 *      nothing to do with orientation. The stored dimensions are instead read
 *      by DECODING THE UPLOADED DERIVATIVE, which is strictly stronger: the
 *      element renders from component state, whereas these are the pixels the
 *      Pod received, and `schema:width`/`schema:height` come from the same
 *      `fitWithin` result the canvas was created at.
 *
 *   3. `Buffer.from(x).buffer` IS NOT `x`. Node hands small Buffers out of a
 *      shared 8 KB pool, so `.buffer` is the pool and `.byteOffset` is not
 *      zero; feeding it to ExifReader reads other requests' bytes. `bytesOf`
 *      below slices the exact range, which is why "no GPS survived" is a
 *      statement about this file rather than about whatever else was in the
 *      pool.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS SPEC MEASURABLY CANNOT CATCH, so nobody reads a green run as more
 * than it is. Both were established by applying the change and watching nothing
 * go red, on Chromium 1234 / @playwright/test 1.62.1, 2026-09-06.
 *
 *   - DELETING `imageOrientation: "from-image"` FROM THE WORKER. This Chromium
 *     applies EXIF orientation to `createImageBitmap` whatever the option says:
 *     a probe decoded the same orientation-6 JPEG as 2000x3000 with
 *     "from-image", with the option omitted, AND with "none". The option is
 *     still correct — the spec's default changed in 2021 and older engines
 *     predate it — but on this browser it is unobservable, so test 2 is pinning
 *     "targets follow the decoded bitmap" rather than "the option is present".
 *     Transposing the pair fed to `fitWithin`, which is the same defect reached
 *     another way, turns all three tests red.
 *
 *   - TRUSTING THE TYPE `convertToBlob` WAS ASKED FOR. `ENCODE_ORDER` asks for
 *     WebP first and this Chromium encodes WebP, so removing the
 *     `candidate.type === type` check changes nothing here. Forcing the
 *     condition the check exists for — asking for `image/avif`, which this
 *     Chromium answers with `image/png` — makes it bite: with the check intact
 *     the pipeline falls through to JPEG and test 1 stays green, and with it
 *     removed test 1 fails on a `web.png` whose first bytes are 137 80 78 71.
 */

test.describe("the media pipeline in a real browser", () => {
  /**
   * Longer than the config's 60 s, and only here. Each test drives a full OIDC
   * round trip, then Turbopack compiles the pipeline worker chunk on first use,
   * then a 6 MP bitmap is decoded and encoded three times. None of that is
   * flakiness to be papered over — it is work, and 60 s leaves no room for the
   * first-run compile.
   */
  test.describe.configure({ timeout: 120_000 });

  test("resizes, strips EXIF, and uploads two derivatives", async ({ page }) => {
    await signInAsOwner(page);
    await expectOwnerStudio(page);

    // 3000x2000 landscape, with GPS, a capture time and orientation 1.
    const plain = await makeJpeg(page, 3000, 2000);
    const withExif = spliceExif(plain, {
      orientation: 1,
      dateTimeOriginal: "2026:03:29 21:38:02",
      gps: {
        latRef: "N",
        lat: [
          [35, 1],
          [41, 1],
          [3768, 100],
        ],
        longRef: "E",
        long: [
          [139, 1],
          [42, 1],
          [1224, 100],
        ],
      },
    });

    /**
     * SANITY, AND IT IS LOAD-BEARING RATHER THAN DECORATION. Without it, "no
     * GPS came out" is satisfied by a fixture that never had any — a guard that
     * cannot fail, which is this repository's signature defect. It also pins
     * `spliceExif` itself: the APP1 segment has to survive being spliced in
     * front of a real JPEG's tables, not merely be well-formed on its own.
     */
    const before = exifOf(withExif);
    expect(before?.gps?.Latitude, "the fixture carries no GPS going in").toBeCloseTo(35.6938, 3);
    expect(before?.gps?.Longitude).toBeCloseTo(139.7034, 3);
    expect(before?.exif?.DateTimeOriginal?.description).toBe("2026:03:29 21:38:02");

    const uploads = await collectUploads(page);

    await attach(page, "shinjuku.jpg", withExif);

    expect(uploads.map((u) => u.url)).toHaveLength(2);
    const web = uploads.find((u) => /\/web\./.test(u.url));
    const thumb = uploads.find((u) => /\/thumb\./.test(u.url));
    expect(web, `no web derivative among ${uploads.map((u) => u.url).join(", ")}`).toBeDefined();
    expect(thumb, `no thumb derivative among ${uploads.map((u) => u.url).join(", ")}`).toBeDefined();
    if (!web || !thumb) return;

    /**
     * 1. THE ASSERTION THIS SPEC EXISTS FOR. §6.2: the re-encode IS the strip,
     *    because a canvas holds pixels and nothing else. A future "it is
     *    already small enough, pass the original through" shortcut reads as an
     *    optimisation and uploads the owner's GPS to a publicly readable
     *    container. Asserted on BOTH derivatives — a shortcut applied to one
     *    size and not the other is exactly the shape that would slip past a
     *    check on the web derivative alone.
     */
    for (const derivative of [web, thumb]) {
      const after = exifOf(derivative.body);
      expect(after?.gps?.Latitude, `GPS survived into ${derivative.url}`).toBeUndefined();
      expect(after?.gps?.Longitude, `GPS survived into ${derivative.url}`).toBeUndefined();
      expect(
        after?.exif?.DateTimeOriginal?.description,
        `the capture time survived into ${derivative.url}`,
      ).toBeUndefined();
    }

    /**
     * 2. §6.1: THE FILENAME AND THE CONTENT TYPE AGREE WITH THE ACTUAL BYTES.
     *    `OffscreenCanvas.convertToBlob` does not throw on a type it cannot
     *    encode — it silently answers PNG — so a pipeline that trusted what it
     *    asked for would store a PNG named `web.webp`, serve it as image/webp,
     *    and nothing would be red. The magic bytes are the only witness.
     */
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
      if (isWebp) {
        expect(derivative.url).toMatch(/\.webp$/);
        expect(derivative.contentType).toBe("image/webp");
      } else {
        expect(derivative.url).toMatch(/\.jpg$/);
        expect(derivative.contentType).toBe("image/jpeg");
      }
    }

    /**
     * §10, ON THE REAL WIRE. Every write carries a precondition; a blind PUT is
     * a bug. The unit suite pins that `putGuarded` sets the header, but only
     * here is the header seen on the request the Pod would actually have
     * received from the studio.
     */
    expect(web.ifNoneMatch).toBe("*");
    expect(thumb.ifNoneMatch).toBe("*");

    /** §7.3: one content-addressed container per photo, derived from the
     *  ORIGINAL bytes, so both derivatives are siblings. */
    expect(containerOf(thumb.url)).toBe(containerOf(web.url));

    /**
     * 3. IT WAS ACTUALLY RESIZED — 3000x2000 into the 1600 and 400 boxes, with
     *    the aspect ratio kept. Decoded rather than inferred from a byte count:
     *    a smaller file is also what a lower quality setting produces, and only
     *    the dimensions say the image was scaled.
     */
    expect(await dimensionsOf(page, web.body)).toEqual({ width: 1600, height: 1067 });
    expect(await dimensionsOf(page, thumb.body)).toEqual({ width: 400, height: 267 });
    expect(web.body.byteLength).toBeLessThan(withExif.byteLength);
    expect(thumb.body.byteLength).toBeLessThan(web.body.byteLength);
  });

  test("swaps the stored dimensions for an orientation-6 photo", async ({ page }) => {
    await signInAsOwner(page);
    await expectOwnerStudio(page);

    // Portrait shot by a phone held sideways: stored 3000x2000, displays
    // 2000x3000. Decoding with imageOrientation:"from-image" means the bitmap
    // arrives rotated and every target follows — §6.3.
    const plain = await makeJpeg(page, 3000, 2000);
    const rotated = spliceExif(plain, { orientation: 6 });

    /** The same guard as test 1's GPS check, for the same reason: an
     *  orientation tag that failed to splice in would make the whole test a
     *  landscape photo asserted to come out landscape. */
    expect(exifOf(rotated)?.exif?.Orientation?.value, "the fixture is not orientation 6").toBe(6);
    expect(await dimensionsOf(page, Buffer.from(plain))).toEqual({ width: 3000, height: 2000 });

    const uploads = await collectUploads(page);
    await attach(page, "portrait.jpg", rotated);

    const web = uploads.find((u) => /\/web\./.test(u.url));
    expect(web, `no web derivative among ${uploads.map((u) => u.url).join(", ")}`).toBeDefined();
    if (!web) return;

    /**
     * THE STORED DIMENSIONS, WHICH ARE WHAT `schema:width`/`schema:height` WILL
     * CARRY: `uploadPhoto` writes `web.width`/`web.height`, and those are the
     * `fitWithin` result the canvas was created at — so the decoded derivative
     * is the same pair, measured on the pixels instead of on component state.
     *
     * 1067x1600 and not 1600x1067: the source is STORED 3000x2000 and displays
     * 2000x3000, so a pipeline that computed its targets from the file's
     * recorded size rather than from the decoded bitmap would land on the
     * landscape pair and squash the photo.
     */
    expect(await dimensionsOf(page, web.body)).toEqual({ width: 1067, height: 1600 });
  });

  /**
   * THE CASE THE PASS-THROUGH SHORTCUT WOULD ACTUALLY REACH, and it is here
   * because the two tests above cannot reach it.
   *
   * §6.2's warning is about "it is already small enough, pass the original
   * through". That guard reads `bitmap.width <= longestEdge && bitmap.height <=
   * longestEdge` — which is FALSE for a 3000x2000 source at the 1600 box, so
   * adding the shortcut to lib/media/pipeline.worker.ts leaves both tests above
   * green. Measured, not reasoned about: applying it and running turned nothing
   * red until this test existed. A photo already inside the box is the only
   * input that takes that branch, and `fitWithin` never upscales, so it is also
   * the input where "resized" and "re-encoded" come apart — the derivative has
   * the source's own dimensions, and the ONLY witness that the pixels went
   * through a canvas at all is that the EXIF is gone.
   */
  test("strips EXIF from a photo that is already smaller than the target box", async ({ page }) => {
    await signInAsOwner(page);
    await expectOwnerStudio(page);

    // 800x600 — inside both the 1600 web box and, at the thumb stage, not.
    const plain = await makeJpeg(page, 800, 600);
    const withExif = spliceExif(plain, {
      orientation: 1,
      dateTimeOriginal: "2026:03:29 21:38:02",
      gps: {
        latRef: "S",
        lat: [
          [33, 1],
          [51, 1],
          [2916, 100],
        ],
        longRef: "E",
        long: [
          [151, 1],
          [12, 1],
          [3600, 100],
        ],
      },
    });

    /** The same load-bearing sanity check: southern and eastern this time, so a
     *  fixture builder that only ever produced N/E would be caught here. */
    const before = exifOf(withExif);
    expect(before?.gps?.Latitude, "the fixture carries no GPS going in").toBeCloseTo(-33.8581, 3);
    expect(before?.gps?.Longitude).toBeCloseTo(151.2100, 3);

    const uploads = await collectUploads(page);
    await attach(page, "bondi.jpg", withExif);

    const web = uploads.find((u) => /\/web\./.test(u.url));
    expect(web, `no web derivative among ${uploads.map((u) => u.url).join(", ")}`).toBeDefined();
    if (!web) return;

    /** NOT UPSCALED — the source's own dimensions, unchanged. That is what puts
     *  this test on the shortcut's branch rather than beside it. */
    expect(await dimensionsOf(page, web.body)).toEqual({ width: 800, height: 600 });

    /** AND THE METADATA IS STILL GONE. The bytes went through a canvas even
     *  though nothing needed scaling; that is the whole claim of §6.2. */
    const after = exifOf(web.body);
    expect(after?.gps?.Latitude, `GPS survived into ${web.url}`).toBeUndefined();
    expect(after?.gps?.Longitude, `GPS survived into ${web.url}`).toBeUndefined();
    expect(after?.exif?.DateTimeOriginal?.description).toBeUndefined();

    /** The original is 800x600 JPEG; the derivative is the same size re-encoded
     *  by a different codec, so a byte comparison says nothing. What does say
     *  something is that the ORIGINAL BYTES ARE NOT WHAT WAS UPLOADED. */
    expect(web.body.equals(Buffer.from(withExif)), "the original file was uploaded verbatim").toBe(
      false,
    );
  });
});

/* ───────────────────────────────────────────────────────────────── helpers ── */

/** A real, decodable JPEG at a real size, made in the browser. */
async function makeJpeg(page: Page, w: number, h: number): Promise<Uint8Array> {
  const numbers = await page.evaluate(
    async ([width, height]) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#1b3a5c");
      gradient.addColorStop(1, "#e8b04b");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    [w, h] as const,
  );
  return new Uint8Array(numbers);
}

type Upload = { url: string; body: Buffer; contentType: string; ifNoneMatch: string };

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
async function collectUploads(page: Page): Promise<Upload[]> {
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
 */
async function attach(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  /** The same spelling as `PHOTOS_LABEL` in test/entry-editor.test.tsx, which
   *  is the table an implementer changes when they reword the label. */
  await page.getByLabel(/photos?\b/i).setInputFiles({
    name,
    mimeType: "image/jpeg",
    buffer: Buffer.from(bytes),
  });

  const slot = page.getByRole("listitem").filter({ hasText: name });
  await expect(slot).toContainText("is attached to this entry", { timeout: 60_000 });
  await expect(page.getByRole("img", { name })).toBeVisible();
}

/**
 * The owner branch, named before the editor is touched.
 *
 * Without it, a Pod whose trips enumeration failed — or a WebID that lost its
 * `#me` and landed on the not-owner branch — would surface as a twenty-second
 * timeout on a file input, with nothing saying why there is no editor.
 */
async function expectOwnerStudio(page: Page): Promise<void> {
  await expect(page.getByText(`Signed in as ${E2E.ownerWebId}.`)).toBeVisible();
}

/**
 * The exact bytes, as their own ArrayBuffer.
 *
 * See note 3 in the header: a Buffer's `.buffer` is the shared pool it was
 * allocated from, not its own contents, and a Uint8Array's may be a window onto
 * something larger. Slicing is what makes ExifReader read this image.
 */
function bytesOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Tags, or `null` for bytes carrying no readable metadata at all — which is
 *  what a stripped derivative is, and which ExifReader signals by throwing. */
function exifOf(bytes: Uint8Array): ExpandedTags | null {
  try {
    return ExifReader.load(bytesOf(bytes), { expanded: true });
  } catch {
    return null;
  }
}

/** Decoded in the browser rather than parsed here: the derivative may be WebP
 *  or JPEG (§6.1 leaves that to the encoder), and a hand-rolled header parser
 *  would be a second thing to get right for no gain. */
async function dimensionsOf(
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

const containerOf = (url: string): string => url.slice(0, url.lastIndexOf("/") + 1);

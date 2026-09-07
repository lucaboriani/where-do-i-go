import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
 * AND ONE THING THE METADATA HALF NEEDS THAT THE SEEDED POD DOES NOT HAVE.
 *
 * Test 4 is about the READING rather than the pixels: real bytes → exifreader
 * in the real worker → `PipelineResult.metadata` → `offerCoordinate` /
 * `offerTimestamp` → the controls. Its coordinate half is gated on §7.6, and
 * the Pod these specs run against has no §7.6 document at all.
 * `scripts/seed-dev-pod.ts` takes FOUR of docs/data-model.md's seven Turtle
 * blocks — diary, trip, entry, index — and writes no `privacy.ttl`; §7.6 says
 * plainly that nothing in this codebase ever writes one.
 *
 * MEASURED 2026-09-07, NOT REASONED ABOUT: a GET of
 * `…/e2e/travel/settings/privacy.ttl` answers 404, so does its container, and
 * `.pod-data/e2e/travel/` holds no `settings` directory. §9 then fails closed —
 * which is correct, and is what a fresh deployment does — so the two boxes
 * render `disabled` and `offerCoordinate` returns at its first line. The
 * obvious spelling of test 4 would therefore have watched the fill not happen
 * for a reason with nothing to do with EXIF: this project's "the fixture cannot
 * reach the branch", which stage 1's Playwright leg already hit once.
 *
 * So the settings are served to the browser by `page.route`, out of §7.6's own
 * normative block extracted from docs/data-model.md at runtime — the same
 * source `npm run pod:seed` reads, never a hand-copy. It is a PRECONDITION
 * faked at the HTTP layer, which is the seam everything else in this repository
 * fakes at, and the subject of the test — what the worker read, and what the
 * editor did with it — runs for real either way.
 *
 * It also cannot pass vacuously. Before anything is picked, test 4 asserts the
 * coordinate controls are LIVE and that the precision select shows §7.6's own
 * `dy:defaultPrecisionMeters`, which can only be true once `readPrivacySettings`
 * has resolved against that document — this app supplies no fallback for it. A
 * glob that stopped matching fails there, saying so, instead of arriving at the
 * coordinate assertions looking like an auto-fill that did not happen.
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

  /**
   * THE METADATA HALF — §11.4 AND §11.5 THROUGH THE REAL WORKER, WHICH IS THE
   * ONE THING NO FAST TEST CAN DO.
   *
   * Every vitest test in stage 2 drives a FAKE pipeline: `metadata` is handed to
   * the editor as a plain object, because jsdom has no `createImageBitmap`, no
   * `OffscreenCanvas` and no encoder (see the header). So nothing in the fast
   * suite has ever shown that the real Web Worker reads real EXIF bytes, or that
   * what it read is what the real editor receives. This test pins that chain and
   * nothing else: real bytes → exifreader in `lib/media/pipeline.worker.ts` →
   * `PipelineResult.metadata` → `offerCoordinate` / `offerTimestamp` → the three
   * controls.
   *
   * ONE CASE FOR BOTH HALVES, AND THAT IS THE POINT RATHER THAN A SHORTCUT. The
   * same APP1 segment carries `GPSLatitude`/`GPSLongitude` and
   * `DateTimeOriginal`; one pick drives both fills; and the seam being pinned is
   * the same seam for both. Two tests here would be two OIDC round trips and two
   * worker compiles to prove one thing twice — which is the slow-duplicate rule
   * pointed the other way.
   *
   * WHAT IS DELIBERATELY NOT HERE, because test/entry-editor.test.tsx sections
   * 11 and 12 own it against the fake pipeline and re-driving it in a browser
   * would cost minutes and find nothing: that a photo never overwrites the
   * owner's value, that the first photo wins, that a second photo's zone is
   * refused beside the first photo's clock, the fuzzing at save, the provenance
   * notes, and the unconfirmed-offset mark. The logic lives there. What lives
   * here is that the values reaching those rules are a real reader's.
   *
   * THE PRECISE READING, NOT A FUZZED ONE, AND THAT IS NOT AN OVERSIGHT.
   * `fuzzForPublication` runs at SAVE (§9 step 3, `offerCoordinate`'s docblock),
   * because the save path is the only route to the Pod; the form holds what the
   * photo said, to the digit. So the controls are compared against the reading
   * itself. This case stops at the fill and never saves — see `serveHomeRegion`
   * for what a save here would and would not be able to assert.
   *
   * WRITTEN AFTER THE CODE IT PINS, SO THE PIN IS THE MUTATIONS RATHER THAN THE
   * GREEN RUN. Auto-fill already worked, so this passed the first time it ran,
   * which on its own is worth nothing. Both halves were then shown red
   * SEPARATELY, on 2026-09-07, by taking the worker's reading away from one
   * offer at a time in components/studio/entry-editor.tsx:
   *
   *   - `offerCoordinate(name, {})` — red at "the photo's latitude never
   *     reached the control", 44 polls of an `<input value="">`. Everything
   *     after it, the wall clock included, still passed.
   *   - `offerTimestamp(name, {})` — red at "the photo's DateTimeOriginal never
   *     reached the control", with both coordinate assertions passing on the
   *     way past.
   *
   * That is the pre-stage-2 state of `attach`, which read `derived.metadata` and
   * threw it away; the editor was restored byte-for-byte afterwards (sha256
   * 4b0240f2…59928). The two runs also say the halves are independent, which no
   * single mutation could: each failure left the other half filled.
   */
  test("fills the coordinate and the wall clock from a real photo's own EXIF", async ({ page }) => {
    /** §7.6 BEFORE THERE IS AN EDITOR TO READ IT: the read happens on mount, and
     *  a route installed after sign-in would race it. See the header for why it
     *  is served at all. */
    const home = await serveHomeRegion(page);

    await signInAsOwner(page);
    await expectOwnerStudio(page);

    /** THE PREMISE, AND IT IS THE LOAD-BEARING ONE. Without it a closed §9 gate
     *  and a broken reader are the same empty box. */
    await expectLiveCoordinateControls(page, home);

    /**
     * 1200x900, and smaller than every other fixture here on purpose: this case
     * asserts nothing about pixels, and the three tests above already pay for a
     * 6 MP decode. The EXIF is what matters, and the bitmap only has to be real
     * enough for the worker to get to the end.
     *
     * SHINJUKU AND A MORNING IN APRIL. The coordinate is test 1's DMS spelling —
     * test/media-exif.test.ts's fixture, and §7.3's own place. The capture time
     * is NOT test 1's: `:33` seconds are non-zero, so a control that keeps them
     * and one that truncates them are distinguishable rather than accidentally
     * equal, and `07:05` is far enough from midnight in either direction that a
     * wall clock routed through a `Date` moves the DATE and not merely the hour.
     */
    const EXIF_WHEN = "2026:04:11 07:05:33";
    const plain = await makeJpeg(page, 1200, 900);
    const withExif = spliceExif(plain, {
      orientation: 1,
      dateTimeOriginal: EXIF_WHEN,
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
     * THE SANITY CHECK THE OTHER THREE TESTS HAVE, DOING ONE MORE JOB HERE.
     * There it keeps "no GPS came out" from being satisfied by a fixture that
     * never had any; here it also PRODUCES THE EXPECTATION — `lib/media/exif.ts`
     * hands `tags.gps.Latitude` through verbatim (it does no DMS arithmetic of
     * its own), so this is the exact number the worker will send to the editor,
     * read by the same library from the same bytes.
     *
     * THE HARD-CODED PAIR IS WHAT STOPS THAT BEING A TAUTOLOGY. A reader that
     * returned nonsense would agree with itself all the way down; 35.6938 and
     * 139.7034 are Shinjuku, written out, and they fail here rather than
     * silently becoming the expectation.
     */
    const before = exifOf(withExif);
    const readLat = before?.gps?.Latitude;
    const readLong = before?.gps?.Longitude;
    expect(readLat, "the fixture carries no GPS going in").toBeCloseTo(35.6938, 3);
    expect(readLong, "the fixture carries no GPS going in").toBeCloseTo(139.7034, 3);
    expect(
      before?.exif?.DateTimeOriginal?.description,
      "the fixture carries no capture time going in: the APP1 segment did not survive being spliced in, and both halves of this test would be about a photo that says nothing",
    ).toBe(EXIF_WHEN);

    /**
     * AND IT IS NOWHERE NEAR THE HOME REGION THE SERVED SETTINGS DECLARE. §9
     * step 2 drops a coordinate inside `dy:homeRadiusMeters` altogether, so a
     * fixture at §7.6's Milan centre would make the save leg — if this case ever
     * grows one — assert an absence that a total auto-fill failure produces too.
     * A degree is ~111 km against a 3 km radius, so one degree in either axis is
     * proof of "outside" without any geodesy here. Checked rather than trusted,
     * because the fixture is read out of a document that can be edited.
     */
    expect(
      Math.abs(home.lat - readLat!),
      `the fixture's latitude is inside the home region §7.6 declares (${home.lat}): §9 would drop this point rather than snap it`,
    ).toBeGreaterThan(1);
    expect(
      Math.abs(home.long - readLong!),
      `the fixture's longitude is inside the home region §7.6 declares (${home.long})`,
    ).toBeGreaterThan(1);

    /**
     * §7.3's spelling of the same instant, by mechanical substitution — and the
     * substitution IS CHECKED, because a fixture edit built on a string replace
     * that failed to match passes silently on the unmodified string. `readMetadata`
     * turns `2026:04:11 07:05:33` into `2026-04-11T07:05:33`, and the editor's
     * `wallClockOf` then slices it to the minute for a `datetime-local`.
     */
    const wall = EXIF_WHEN.replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T");
    expect(
      wall,
      `the EXIF date was not rewritten into §7.3's shape: the substitution did not match, and this expectation is still ${JSON.stringify(EXIF_WHEN)}`,
    ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);

    /** Nothing in any of the three, so every "filled" below is a change rather
     *  than a coincidence — the editor starts a create with `lat`, `long` and
     *  `occurred` all `""`. */
    for (const [what, label] of [
      ["latitude", LATITUDE],
      ["longitude", LONGITUDE],
      ["wall clock", WHEN],
    ] as const) {
      await expect(
        control(page, label),
        `the ${what} control was not empty to begin with, so nothing below distinguishes a fill from a value that was already there`,
      ).toHaveValue("");
    }

    /** Fulfilled, not forwarded, and this case asserts nothing about it: it is
     *  what keeps `attach` deterministic. A real PUT would 201 on the first run
     *  and 412 on every run after, the path being content-addressed, and the
     *  slot would then render a failure instead of settling. */
    await collectUploads(page);

    await attach(page, "asakusa.jpg", withExif);

    /* ── THE COORDINATE (§11.4) ───────────────────────────────────────────── */

    await expect(
      control(page, LATITUDE),
      "the photo's latitude never reached the control: the real worker read no GPS out of real EXIF bytes, or `PipelineResult.metadata` did not carry it to `offerCoordinate`",
    ).not.toHaveValue("");

    /**
     * AS NUMBERS, NEVER AS TEXT — §11 guardrail 6's spirit for a decimal that is
     * not on a wire: `35.6938` and `35.69380000000001` are the same coordinate
     * and the lexical form is the implementer's. Six places is ~0.1 m, which no
     * rounding on the way IN and no 500 m snap can survive, so this
     * discriminates the precise reading from a fuzzed one.
     */
    expect(
      Number(await control(page, LATITUDE).inputValue()),
      "the latitude is not the photo's own reading: it was rounded, snapped or replaced between the worker and the control",
    ).toBeCloseTo(readLat!, 6);
    expect(
      Number(await control(page, LONGITUDE).inputValue()),
      "the longitude is not the photo's own reading",
    ).toBeCloseTo(readLong!, 6);

    /* ── AND THE WALL CLOCK (§11.5), FROM THE SAME PICK ───────────────────── */

    await expect(
      control(page, WHEN),
      "the photo's DateTimeOriginal never reached the control: the real worker read no capture time, or `offerTimestamp` was not given it",
    ).not.toHaveValue("");

    /**
     * THE SET OF HONEST SPELLINGS, as test/entry-editor.test.tsx's
     * `wallClockShapes` defines it: keeping the photo's seconds and truncating
     * them are both defensible and `LOCAL_DATETIME` accepts either. What is not
     * in the set is `""`, anything shifted by this machine's zone, and anything
     * carrying an offset — §7.3's field is the time it was THERE.
     */
    const shown = await control(page, WHEN).inputValue();
    expect(
      [wall.slice(0, 16), wall, `${wall}.000`],
      `the wall clock shows ${JSON.stringify(shown)}, which is not the photo's local time in any spelling this control can hold: a shifted clock, a shifted DATE, or a value that came from somewhere other than the photo`,
    ).toContain(shown);
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
  await page.getByLabel(PHOTOS).setInputFiles({
    name,
    mimeType: "image/jpeg",
    buffer: Buffer.from(bytes),
  });

  const slot = page.getByRole("listitem").filter({ hasText: name });
  await expect(slot).toContainText("is attached to this entry", { timeout: 60_000 });
  await expect(page.getByRole("img", { name })).toBeVisible();
}

/**
 * Two assertions, because ONE OF THEM ONLY COVERS HALF OF WHAT THIS USED TO
 * CLAIM — and a docblock claiming coverage it does not have is a documented
 * defect shape in this repository: it stops the next person looking.
 *
 * The `Signed in as …` line discriminates OWNER FROM NOT-OWNER and nothing
 * else. That is worth having — it is what breaks when OWNER_WEBID loses its
 * `#me`, since `sameWebId` compares fragments — but it says nothing about the
 * editor. In components/studio/studio-shell.tsx that line is a SIBLING
 * rendered ABOVE `<Writables>`, so a pending enumeration, a failed one and a
 * Pod with zero trips all render it and all render no editor.
 *
 * So the editor is asserted on its own account, and the message names the
 * three ways it can be absent. Otherwise each of them arrives as a bare
 * twenty-second timeout on `setInputFiles`, with nothing saying why there is
 * no control to set files on. Verified by pointing `PHOTOS` at a control that
 * does not exist: the run fails HERE, with this sentence, rather than eleven
 * lines later inside `attach`.
 */
async function expectOwnerStudio(page: Page): Promise<void> {
  await expect(page.getByText(`Signed in as ${E2E.ownerWebId}.`)).toBeVisible();
  await expect(
    page.getByLabel(PHOTOS),
    "the owner studio rendered no editor: the trips enumeration is still pending, or it " +
      "failed, or the Pod has no trips at all (§4 — an entry lives inside a trip). " +
      "`Signed in as …` above does not discriminate between the three.",
  ).toBeVisible();
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

/** The same spelling as `PHOTOS_LABEL` in test/entry-editor.test.tsx, which is
 *  the table an implementer changes when they reword the label. One constant,
 *  so the guard below and the pick above can never drift apart and leave the
 *  guard passing on a control the pick cannot find. */
const PHOTOS = /photos?\b/i;

/**
 * Test 4's three controls, spelled as `LABEL` in test/entry-editor.test.tsx
 * spells them, for `PHOTOS`'s reason: that object is the table an implementer
 * edits when they reword a label, and a second spelling here would go on
 * matching nothing while looking like an auto-fill that did not happen.
 *
 * PLAYWRIGHT'S STRICT MODE IS THE ANALOGUE OF SECTION 8b's "EXACTLY ONE MATCH"
 * CONTROL, and that is worth having rather than working around: `getByLabel`
 * throws on two matches, so a `<section aria-label="…">` wrapper that shadowed
 * one of these — the mistake that cost that file six tests — fails here by
 * name instead of quietly resolving to the wrapper.
 */
const LATITUDE = /latitude/i;
const LONGITUDE = /longitude/i;
const PRECISION = /precision/i;
const WHEN = /when|occurred|date/i;

const control = (page: Page, label: RegExp) => page.getByLabel(label);

/**
 * §7.6, SERVED TO THE BROWSER, AND WHAT IT DECLARES.
 *
 * The header says why this is faked at all and why faking it does not touch
 * what test 4 is about. Two mechanics are worth stating here:
 *
 *   - THE BLOCK IS EXTRACTED FROM docs/data-model.md AT RUNTIME, selected by
 *     CONTENT rather than by position. `scripts/seed-dev-pod.ts` takes the first
 *     four Turtle blocks by index; a fifth block added to §5 would silently
 *     shift an index and hand this a diary. The §7 fixtures are normative, so a
 *     hand-copied home region would test a copy of the spec — and this one is
 *     read for its VALUES as well as its bytes, which makes that worse.
 *
 *   - GET ONLY, EVERYTHING ELSE FORWARDED. `session.fetch` sends `Authorization`
 *     and `DPoP`, which makes this a preflighted cross-origin request; the real
 *     Community Solid Server answers the OPTIONS, exactly as it does for the
 *     media PUTs in `collectUploads`. The CORS headers on the fulfilled response
 *     are not optional either: without them the browser rejects it before
 *     `readPrivacySettings` sees a status, and §9 fails closed on a `network`
 *     error that looks nothing like the truth.
 *
 * HOME_REGION_NOTE, and it is the reason test 4 stops at the fill. Saving would
 * put the SNAPPED pair on the wire for a coordinate outside the region and no
 * geometry at all for one inside it (§9 steps 2-3) — both worth asserting, and
 * both already asserted in test/entry-editor.test.tsx sections 11e and 11f
 * against this same §7.6 document. Here it would add a second full save cycle
 * to the slowest test in the repository to re-prove them, and the value the
 * FILL puts in the controls — which is what this case exists for — is the
 * precise reading either way.
 */
async function serveHomeRegion(page: Page): Promise<{
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
 * `awaitLiveCoordinateControls` in test/entry-editor.test.tsx, and load-bearing
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
async function expectLiveCoordinateControls(
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

const containerOf = (url: string): string => url.slice(0, url.lastIndexOf("/") + 1);

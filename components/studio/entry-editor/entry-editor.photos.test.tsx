// @vitest-environment jsdom
/** The studio's entry editor: section 10 — the picker.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  BLUR,
  CREDENTIAL,
  DEBOUNCE,
  JAPAN,
  LABEL,
  NEW_SCOPE,
  OWNER,
  PHOTOS_LABEL,
  POD,
  clickSaveAndWait,
  datatypeOf,
  draftKeyFor,
  fakePipeline,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  indexRowOf,
  jpegFile,
  languageOf,
  mediaFake,
  objectsOf,
  oneObject,
  parseDraft,
  pickPhoto,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  saveButton,
  setText,
  specEntry,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { DY, SCHEMA, XSD } from "@/lib/vocab";
import { type Entry, Photo } from "@/lib/pod/schema";
import { mediaContainer, mediaHash } from "@/lib/media/upload";
import type { Pipeline } from "@/lib/media/pipeline";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 10. PHOTOS — THE PICKER (task 7).
 *
 * THE RED STEP. Nothing in components/studio/entry-editor/entry-editor.tsx answers to a
 * photo control today; line 61-64 of it still says photos are phase 3.
 *
 * WHAT IS FAKED, AND WHERE. Two new seams, and only two:
 *
 *   the pipeline   INJECTED as a `Pipeline` prop — `{ process, dispose }` from
 *                  lib/media/pipeline.ts. Not mocked as a module, and not the
 *                  real one: the real one spawns a Web Worker that calls
 *                  `createImageBitmap` and `OffscreenCanvas.convertToBlob`,
 *                  neither of which jsdom has. The prop defaults to a lazily
 *                  created real pipeline, which is what ships; every test here
 *                  passes a fake whose output is known byte for byte, so
 *                  "the derivative was uploaded" and "the ORIGINAL was
 *                  uploaded" are different assertions rather than two readings
 *                  of one opaque blob.
 *   the media PUTs MSW, at the HTTP layer, exactly like every other Pod write
 *                  in this file. `uploadPhoto` is NOT mocked: the precondition
 *                  (`If-None-Match: *`), the credential and the content type
 *                  are asserted on the real outgoing requests, because a spy on
 *                  `uploadPhoto` would pass against an editor that hand-rolled
 *                  a blind PUT of its own.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   `schema:dateCreated` ON A NEW PHOTO. §6 requires a UTC offset on every
 *   xsd:dateTime, and lib/media/exif.ts yields an offset-less wall clock —
 *   EXIF's DateTimeOriginal has no zone and OffsetTimeOriginal is usually
 *   absent (§11.5). Stage 1 therefore cannot produce a valid one, so no test
 *   below expects it. The absence is not asserted either: `Photo.safeParse` in
 *   the draft test refuses an offset-less one, which is the check that matters,
 *   and a stage-2 implementation that supplies a real offset must not go red
 *   for having done the right thing. Carrying an EXISTING one through is a
 *   different question and is scenario 4's.
 *
 *   THE EXIF GPS → COORDINATE WIRE. A photo's GPS goes through §9 steps 1-4
 *   like any other coordinate, and that is its own task. The fake pipeline runs
 *   the REAL `readMetadata` over the REAL fixture bytes so the seam is faithful
 *   when it arrives, but nothing below asserts on it.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * A pipeline that refuses the file, REJECTING rather than resolving an error
 * value — that is `createPipeline`'s own contract: it rejects with
 * `new Error(data.message)` when the worker reports `ok: false`.
 */
function failingPipeline(message: string): Pipeline {
  return {
    process: () => Promise.reject(new Error(message)),
    dispose() {},
  };
}

/** The reason the owner must be given. Distinctive on purpose: it comes from
 *  the FAKE, so finding it on screen asserts that the real reason travels,
 *  rather than asserting this file's idea of how a failure is worded. */
const DECODE_FAILURE = "the decoder could not read this file";

/** §7.3's own path shape, asserted rather than assumed: content-addressed,
 *  16 hex characters, and named from the BLOB's type (never from what was
 *  asked for — `convertToBlob` returns PNG when it cannot encode WebP). */
const MEDIA_PATH = /^\/travel\/media\/[0-9a-f]{16}\/(web|thumb)\.webp$/;

/* ─────────────────────────────────────────────── 10a. a photo that works ── */

describe("entry editor — a picked photo", () => {
  /**
   * UPLOAD ON PICK, and the assertion that says so is the `src`.
   *
   * An editor that held the File and uploaded at save time would also render an
   * `<img>` — from `URL.createObjectURL`, a `blob:` URL that dies with the page
   * and cannot be autosaved. So "shown as attached" is asserted as "shown FROM
   * THE POD": the element the owner sees points at the resource that now
   * exists, which is the only version of "attached" that survives a reload.
   */
  it("uploads a picked photo and shows it as attached", async () => {
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const source = jpegFile("beach.jpg");
    await renderEditor(fake.session, { pipeline: rig.pipeline });

    pickPhoto(source);

    const shown = await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    /* THE FILE REALLY WENT THROUGH THE PIPELINE, with all of its bytes. */
    expect(rig.processed, "the pipeline was not given the picked file").toEqual([source.size]);
    expect(source.size, "the JPEG fixture is empty, so nothing below is a real trace").
      toBeGreaterThan(0);

    /* BOTH DERIVATIVES, ONE CONTAINER, EACH WITH ITS PRECONDITION. */
    for (const put of media.puts) {
      const url = new URL(put.url);
      expect(url.origin).toBe(new URL(POD).origin);
      expect(url.pathname).toMatch(MEDIA_PATH);
      expect(put.headers["if-none-match"], `a blind PUT of ${url.pathname}`).toBe("*");
      expect(
        put.headers.authorization,
        `${url.pathname} was written without the session credential`,
      ).toBe(CREDENTIAL);
      expect(put.headers["content-type"], `${url.pathname} was typed from the request, not the blob`)
        .toMatch(/^image\/webp\b/);
    }
    expect(media.containers(), "the two derivatives went to different containers").toHaveLength(1);

    /**
     * WHAT WAS UPLOADED IS THE DERIVATIVE, NOT THE ORIGINAL — the media rules:
     * originals are never uploaded, and a photo's GPS leaves with them.
     *
     * PINNED ON THE NAMES AND THE CONTENT TYPES, not on the bytes, and the
     * reason is in `mediaFake`'s docblock: a Blob body is unreadable in this
     * environment. It is not a weaker claim than it looks. Both come from the
     * DERIVATIVE's blob — `extensionFor(web.blob.type)` and the mime handed to
     * `putGuarded` — so a picked JPEG that went up untouched would be
     * `image/jpeg` at `.../web.jpg`, and both assertions would fail. The
     * `rig.processed` check above is the other half: the file went through the
     * pipeline rather than around it.
     */
    expect(media.names(), "the derivatives are not named from the encoded blob").toEqual(
      new Set(["web.webp", "thumb.webp"]),
    );

    /* SHOWN FROM THE POD. */
    const src = shown.getAttribute("src") ?? "";
    expect(src, "the attached photo is shown from a local object URL, not from the Pod").not.
      toMatch(/^blob:/);
    expect(new URL(src, window.location.href).pathname).toMatch(MEDIA_PATH);

    /* STRUCTURALLY SETTLED, not worded. A settled photo is a `status`; a failed
       one is an `alert` (10b). Asserting the pair is what keeps either from
       being satisfied by a screen that announces everything the same way. */
    expect(screen.queryAllByRole("alert"), "a photo that worked raised an alert").toEqual([]);
    expect(
      screen.getAllByRole("status"),
      "nothing announced that the photo had settled",
    ).not.toHaveLength(0);
  });
});

/* ──────────────────────────────────────────── 10b. a photo that does not ── */

describe("entry editor — a photo that fails", () => {
  /**
   * ONE UNREADABLE FILE MUST NOT COST THE OWNER THE PROSE THEY JUST WROTE.
   *
   * Three claims, and the third is the one the brief left out. Without it this
   * test passes over a real defect: an editor that renders an optimistic slot
   * with a local preview URL, announces the failure, and then saves that slot
   * anyway writes `schema:contentUrl <blob:…>` into a public resource — a photo
   * that 404s for every reader, on an entry that reports itself saved.
   */
  it("keeps the entry saveable when a photo fails, and leaves it out of what is saved", async () => {
    const pod = podFake();
    const media = mediaFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { pipeline: failingPipeline(DECODE_FAILURE) });

    pickPhoto(jpegFile("broken.jpg"));

    /* ANNOUNCED, AS AN ALERT, CARRYING THE REASON THE PIPELINE GAVE. */
    const alerts = await screen.findAllByRole("alert");
    expect(
      alerts.map((a) => a.textContent ?? "").join(" "),
      "the failure was announced without saying why",
    ).toMatch(new RegExp(DECODE_FAILURE, "i"));

    /* NOTHING WAS UPLOADED: a photo the pipeline refused has no bytes to put. */
    expect(media.puts, "a photo that never decoded was uploaded anyway").toEqual([]);

    /* AND THE ENTRY IS STILL SAVEABLE. The form fills with the failure on
       screen, which is the state the owner is actually in. */
    fillNewEntry();
    expect(saveButton(), "one bad photo took the Save button with it").toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton());
    });
    // NOT `clickSaveAndWait`: it waits for `outcomeText()` to be non-empty and
    // the photo's own alert already made it so, so it would return before the
    // save had done anything. Wait for the request instead.
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    /* THE MUTATION HALF FIRST: this really is a save that happened, so the
       emptiness below is an absence and not a request that never went out. */
    expect(oneObject(quads, subject, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );

    expect(
      objectsOf(quads, subject, SCHEMA.image).map((t) => t.value),
      "a photo that failed reached the saved entry",
    ).toEqual([]);
    expect(put.body, "the failed file's name was written into the entry").not.toContain(
      "broken.jpg",
    );
    expect(put.body, "an optimistic local preview URL was saved as a photo").not.toContain("blob:");
  });
});

/* ──────────────────────────────────────────── 10c. what the draft holds ──── */

describe("entry editor — a photo in the autosaved draft", () => {
  /**
   * THE DECIDING ARGUMENT FOR UPLOAD-ON-PICK, stated as the invariant rather
   * than as bytes.
   *
   * `localStorage` takes strings. A `File` or a `Blob` in the draft object
   * serialises to `{}` — it does not throw, and it does not print
   * "[object Blob]" — so the draft is written, reports success, and restores a
   * photo with no URL on it. That is why the assertion is `Photo.safeParse`:
   * what came back out of storage has to be a photo this app could render.
   *
   * NOT FROZEN TO BYTES, AND NOT ON A FAKE CLOCK. `savedAt` moves with a real
   * debounce and comparing the stored string against a literal is how this
   * project has already written tests that race a timer. The storage is the
   * injected fake (section 8's), so nothing here touches the file-wide
   * `window.localStorage` and nothing can leak into the next test.
   */
  it("stores a usable photo in the autosaved draft, and no Blob", async () => {
    const media = mediaFake();
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: store.storage,
    });

    fillNewEntry();
    pickPhoto(jpegFile("beach.jpg"));
    await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    const key = draftKeyFor(OWNER, NEW_SCOPE);
    let raw = "";
    await waitFor(
      () => {
        const stored = store.items.get(key);
        expect(stored, "no draft was autosaved at all").toBeDefined();
        const held = JSON.parse(stored!) as { photos?: unknown[] };
        expect(held.photos, "the autosaved draft carries no photos").toHaveLength(1);
        raw = stored!;
      },
      { timeout: DEBOUNCE * 6, interval: 25 },
    );

    const draft = JSON.parse(raw) as { photos: unknown[] };
    const held = draft.photos[0] as Record<string, unknown>;

    /* A BLOB SERIALISES TO `{}`, so this is the assertion that catches it. */
    expect(
      typeof held.contentUrl,
      "the stored photo has no contentUrl — which is what a Blob serialises to",
    ).toBe("string");
    expect(new URL(String(held.contentUrl)).pathname).toMatch(MEDIA_PATH);

    /* USABLE, by the app's own definition of the word. */
    const parsed = Photo.safeParse(held);
    expect(
      parsed.success || JSON.stringify(parsed.error?.issues),
      "the stored photo does not round-trip into a Photo",
    ).toBe(true);

    /* ALL THREE DERIVATIVES AND THE DIMENSIONS, which the media rules require
       to be stored — the placeholder is a string precisely so it can ride in
       JSON and in Turtle rather than as bytes. */
    expect(new URL(String(held.thumbnailUrl)).pathname).toMatch(MEDIA_PATH);
    expect(held.width).toBe(1600);
    expect(held.height).toBe(1067);
    expect(held.encodingFormat).toBe("image/webp");
    expect(held.blurDataUrl).toBe(BLUR);

    /* AND NO BYTES ANYWHERE IN IT. */
    expect(raw, "a Blob was stringified into the draft").not.toContain("[object Blob]");
    expect(raw, "a local object URL was persisted; it dies with the page").not.toContain("blob:");
  });
});

/* ─────────────────────────────────── 10d. an edit that touches no photo ──── */

describe("entry editor — photos an edit did not touch", () => {
  /**
   * THE SAME RULE `created`, `datePublished` AND THE PLACE ALREADY FOLLOW: an
   * edit that rewrites the resource without them destroys them silently, and
   * for photos it destroys the binaries' only reference as well.
   *
   * AGAINST THE §7.3 FIXTURE, not a hand-built entry: the normative block is
   * the contract (§11 guardrail 6) and it carries exactly one photo with all
   * nine of its predicates populated, including a `schema:dateCreated` that
   * already has an offset on it. Carrying that through is a different question
   * from minting one, which stage 1 cannot do.
   */
  it("carries an existing entry's photos through an edit that does not touch them", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();

    // NON-VACUOUS: the fixture really does carry a photo to preserve. Without
    // this the assertions below are about an entry that never had one.
    expect(entry.photos, "the §7.3 fixture carries no photo to preserve").toHaveLength(1);
    const kept = entry.photos[0]!;
    expect(kept.dateCreated, "the fixture's photo carries no dateCreated").toBeDefined();

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
    });

    /**
     * THE ANCHOR. "an edit that does not touch photos" is only a claim about a
     * form that HAS a photo control; without this the test passes just as
     * happily on a build with no picker at all, which is exactly the shape of
     * vacuous pass this file keeps having to guard against.
     */
    expect(
      screen.queryAllByLabelText(PHOTOS_LABEL),
      "the editor has no photo control, so there is nothing to leave untouched",
    ).toHaveLength(1);

    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    // The mutation half: this is a save that changed something.
    expect(oneObject(quads, subject, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited",
    );

    const images = objectsOf(quads, subject, SCHEMA.image).map((t) => t.value);
    expect(images, "the edit dropped the photo the entry arrived with").toEqual([
      `${put.url}#photo-1`,
    ]);
    const node = images[0]!;

    // A fragment, never a blank node (§11 guardrail 2).
    expect(quads.every((q) => q.subject.termType !== "BlankNode")).toBe(true);
    expect(quads.every((q) => q.object.termType !== "BlankNode")).toBe(true);

    expect(oneObject(quads, node, SCHEMA.contentUrl)?.value).toBe(kept.contentUrl);
    expect(oneObject(quads, node, SCHEMA.thumbnailUrl)?.value).toBe(kept.thumbnailUrl);

    const caption = oneObject(quads, node, SCHEMA.caption);
    expect(caption?.value).toBe(kept.caption?.value);
    expect(languageOf(caption), "the caption lost its language tag").toBe(kept.caption?.language);

    for (const [predicate, expected] of [
      [SCHEMA.width, kept.width],
      [SCHEMA.height, kept.height],
      [DY.sortOrder, kept.sortOrder],
    ] as const) {
      const term = oneObject(quads, node, predicate);
      expect(Number(term?.value), predicate).toBe(expected);
      expect(datatypeOf(term), predicate).toBe(XSD.integer);
    }

    expect(oneObject(quads, node, SCHEMA.encodingFormat)?.value).toBe(kept.encodingFormat);
    expect(oneObject(quads, node, DY.blurDataUrl)?.value).toBe(kept.blurDataUrl);

    const dateCreated = oneObject(quads, node, SCHEMA.dateCreated);
    expect(dateCreated?.value).toBe(kept.dateCreated);
    expect(datatypeOf(dateCreated)).toBe(XSD.dateTime);
    expect(dateCreated?.value, "the photo's timestamp lost its offset").toMatch(
      /[+-]\d{2}:\d{2}$/,
    );

    /* AND THE DENORMALISED ROW KEEPS ITS THUMBNAIL. §7.4's index is what the
       public trip page renders from; an entry whose photo survived in the
       document but not in the row loses its picture on every listing. */
    const index = pod.indexPut()!;
    const { quads: rowQuads, row } = indexRowOf(index.body, JAPAN.indexUrl, put.url);
    expect(row, "the edited entry has no row in the index it was written to").toBeDefined();
    expect(oneObject(rowQuads, row!, DY.thumbnail)?.value).toBe(kept.thumbnailUrl);
  });
});

/* ─────────────────────────── 10e. a photo added to an entry that has one ── */

/**
 * THE PRODUCT OF THE TWO BRANCHES, WHICH NOTHING ABOVE RENDERS.
 *
 * 10a, 10b and 10c pick a photo and never pass `initial`, so what the entry
 * arrived with is always empty. 10d passes `initial` and never picks, so what
 * was attached here is always empty. Neither half therefore says anything about
 * an edit that does BOTH — and that is the half where photos are destroyed.
 *
 * MEASURED, NOT SUPPOSED: with `photosFor` replaced by "if nothing was picked,
 * keep what was carried; otherwise save what was picked", the whole suite is
 * 927 passed and 2 todo — no red anywhere. The saved entry is a whole-document
 * replace serialised from `entry.photos` (lib/pod/save-entry.ts), so a photo
 * left out of that array has its triples removed and its binary orphaned:
 * nothing else on the Pod references `travel/media/<hash>/`.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — a photo added to an entry that already has one", () => {
  it("keeps both, and numbers the new one after the one that was there", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const entry = await specEntry();

    // NON-VACUOUS, both halves: there is a photo to preserve, and it carries the
    // number the new one has to be placed after.
    expect(entry.photos, "the §7.3 fixture carries no photo to preserve").toHaveLength(1);
    const kept = entry.photos[0]!;
    expect(kept.sortOrder, "the fixture's photo carries no sortOrder").toBe(1);

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      pipeline: rig.pipeline,
    });

    pickPhoto(jpegFile("beach.jpg"));
    await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    // NOT `clickSaveAndWait`: the attached photo's own `role="status"` has
    // already made `outcomeText()` non-empty, so it would return before the save
    // had done anything. 10b's reasoning, and the same fix.
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    const images = objectsOf(quads, subject, SCHEMA.image).map((t) => t.value);
    expect(
      images,
      "the entry does not carry both photos: adding one destroyed the one it arrived with",
    ).toEqual([`${put.url}#photo-1`, `${put.url}#photo-2`]);

    /* THE CARRIED ONE, UNTOUCHED — the same URL and the same number. Renumbering
       it would rewrite §7.3 data the owner never touched. */
    const carried = images[0]!;
    expect(oneObject(quads, carried, SCHEMA.contentUrl)?.value).toBe(kept.contentUrl);
    expect(Number(oneObject(quads, carried, DY.sortOrder)?.value)).toBe(kept.sortOrder);

    /* AND THE NEW ONE, ON THE POD AND NUMBERED AFTER IT. */
    const added = images[1]!;
    const contentUrl = oneObject(quads, added, SCHEMA.contentUrl)?.value ?? "";
    expect(new URL(contentUrl).pathname, "the added photo is not a Pod media URL").toMatch(
      MEDIA_PATH,
    );
    expect(contentUrl, "both fragments point at the same binary").not.toBe(kept.contentUrl);
    const order = oneObject(quads, added, DY.sortOrder);
    expect(
      Number(order?.value),
      "the added photo did not take the next position after the carried one",
    ).toBe(2);
    expect(datatypeOf(order), "sortOrder is not an xsd:integer").toBe(XSD.integer);

    /* THE LISTING'S PICTURE DOES NOT MOVE. §7.4's row is denormalised from
       `photos[0]`, so appending must not swap the cover of an entry the owner
       only added a picture to. */
    const index = pod.indexPut()!;
    const { quads: rowQuads, row } = indexRowOf(index.body, JAPAN.indexUrl, put.url);
    expect(row, "the edited entry has no row in the index it was written to").toBeDefined();
    expect(oneObject(rowQuads, row!, DY.thumbnail)?.value).toBe(kept.thumbnailUrl);
  });

  /**
   * A PHOTO THE ENTRY ALREADY HAS, PICKED AGAIN.
   *
   * Not a hypothetical: the container is `sha256(source)[0..16]`, so the same
   * file always lands at the same URL and `uploadPhoto` reads the 412 as reuse.
   * The upload is therefore harmless and the APPEND is not — two `#photo-N`
   * fragments pointing at one binary render the same picture twice on every
   * public listing, and this editor has no way to remove one.
   *
   * The carried photo is put at the container the picked file really hashes to,
   * using the app's own `mediaHash`, so this cannot pass against an editor that
   * deduplicates on something else.
   */
  it("attaches a photo the entry already carries only once", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();

    const source = jpegFile("beach.jpg");
    const container = mediaContainer(POD, await mediaHash(await source.arrayBuffer()));
    expect(new URL(container).pathname, "the container is not §7.3's media shape").toMatch(
      /^\/travel\/media\/[0-9a-f]{16}\/$/,
    );

    const entry = await specEntry();
    const already: Entry = {
      ...entry,
      photos: [
        { ...entry.photos[0]!, contentUrl: `${container}web.webp`, thumbnailUrl: `${container}thumb.webp` },
      ],
    };

    await renderEditor(fake.session, {
      initial: { entry: already, etag: '"entry-7"' },
      pipeline: rig.pipeline,
    });

    pickPhoto(source);
    await screen.findByRole("img", { name: /beach\.jpg/i });
    // It really went up — this is a save-time deduplication, not a pick the
    // editor quietly ignored.
    await waitFor(() => expect(media.puts).toHaveLength(2));

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const images = objectsOf(quads, `${put.url}#it`, SCHEMA.image).map((t) => t.value);

    expect(images, "the same photo was attached twice").toEqual([`${put.url}#photo-1`]);
    expect(oneObject(quads, images[0]!, SCHEMA.contentUrl)?.value).toBe(`${container}web.webp`);
    // And the carried photo kept everything else it had.
    expect(oneObject(quads, images[0]!, SCHEMA.caption)?.value).toBe(already.photos[0]!.caption?.value);
  });

  /** The same defect on a CREATE, where there is nothing carried to compare
   *  against: one file, picked twice, is one photo. */
  it("attaches the same file picked twice only once", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { pipeline: rig.pipeline });

    pickPhoto(jpegFile("beach.jpg"));
    pickPhoto(jpegFile("beach.jpg"));
    await waitFor(() => expect(screen.getAllByRole("img", { name: /beach\.jpg/i })).toHaveLength(2));
    // Both picks really ran: two files through the pipeline, four PUTs to one
    // content-addressed container (a real Pod answers the second pair 412).
    expect(rig.processed).toHaveLength(2);
    await waitFor(() => expect(media.puts).toHaveLength(4));
    expect(media.containers(), "the same bytes went to two containers").toHaveLength(1);

    fillNewEntry();
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    expect(
      objectsOf(quads, `${put.url}#it`, SCHEMA.image).map((t) => t.value),
      "one file picked twice was written as two photos",
    ).toEqual([`${put.url}#photo-1`]);
  });

  /**
   * A CARRIED PHOTO WITH NO `dy:sortOrder` OF ITS OWN.
   *
   * `Photo.sortOrder` is optional — a Pod contains whatever was written to it,
   * including data from an older build — and lib/pod/entry-model.ts fills the
   * gap with the photo's ONE-BASED POSITION rather than leaving it unwritten.
   * So a single unnumbered carried photo is serialised as `dy:sortOrder 1`, and
   * the number a new photo may take is 2.
   *
   * WHAT THIS CATCHES, and it catches two different wrong answers: seeding the
   * search at `-1` gives the new photo 0, which sorts it in FRONT of a photo the
   * owner already had, and seeding it at `carried.length` gives 1 — a collision
   * with the very photo the fallback exists for.
   */
  it("numbers a new photo past a carried one that has no sortOrder", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();

    const entry = await specEntry();
    const unnumbered: Entry = {
      ...entry,
      photos: [{ ...entry.photos[0]!, sortOrder: undefined }],
    };
    expect(unnumbered.photos[0]!.sortOrder, "the carried photo still has a number").toBeUndefined();

    await renderEditor(fake.session, {
      initial: { entry: unnumbered, etag: '"entry-7"' },
      pipeline: rig.pipeline,
    });

    pickPhoto(jpegFile("beach.jpg"));
    await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const images = objectsOf(quads, `${put.url}#it`, SCHEMA.image).map((t) => t.value);
    expect(images).toHaveLength(2);

    // What the serialiser gave the carried photo, which is the number that is
    // taken. Asserted rather than assumed: it is the premise of the next line.
    const carried = Number(oneObject(quads, images[0]!, DY.sortOrder)?.value);
    expect(carried, "an unnumbered carried photo is no longer written as its position").toBe(1);

    const added = Number(oneObject(quads, images[1]!, DY.sortOrder)?.value);
    expect(added, "the added photo took a position the carried photo already occupies").not.toBe(
      carried,
    );
    expect(added, "the added photo did not take the next free position").toBe(2);
  });
});

/* ────────────────── 10f. a photo that settles AFTER the save has landed ──── */

/**
 * THE DEFECT, AND IT LOSES THE PHOTO ENTIRELY — from the entry AND from the
 * draft, with the screen saying the opposite.
 *
 * `settleDraft` sets `touched.current = false` when the Pod holds what the form
 * holds, which at that instant is true and legitimate: a slot still `decoding`
 * contributes nothing to `attached`, so `sameText` compares two empty photo
 * lists and agrees. The autosave effect then returns at `if (!touched.current)`,
 * and the ONLY thing that put it back to `true` was a DOM `change` event on the
 * `<form>`. A slot moving `uploading → ready` changes `attached` and re-runs the
 * effect — but arms nothing, so the window it opens is never opened at all.
 *
 * ORDINARY USE, NOT A CONTRIVED RACE. Save is `disabled={saving}` and nothing
 * else, so "pick a photo, type the headline, press Save" is a sequence the UI
 * invites while the decode is still running. A second later the row reads
 * "beach.jpg is attached to this entry", the derivatives really are on the Pod
 * — and the entry resource does not reference them and `localStorage` holds
 * nothing. Close the tab: the photo is orphaned and silently absent, and every
 * surface the owner can see said it was attached.
 *
 * NOT THE NARROWER RACE, which is already handled and must stay that way: a
 * settle DURING the round trip is caught by `live.current.text` and
 * `samePhotos` inside `save()`. This one lands strictly AFTER `settleDraft` has
 * run, which is the window those two cannot see.
 *
 * BOTH HALVES ARE ASSERTED, and the first is what stops the second being
 * vacuous: the entry PUT is read to show the photo genuinely did NOT reach the
 * Pod, and the store is read at that same moment to show the draft key really
 * is empty. Only then is the settle released.
 *
 * WHAT WOULD BREAK IT: deleting `if (next.state === "ready") touched.current =
 * true` from `attach`'s `move()`. Measured, not supposed — removing that line
 * turns the final assertion red with `[]` for the draft keys.
 */
describe("entry editor — a photo that settles after the save", () => {
  const CREATED_URL = `${JAPAN.entriesContainer}2026-04-02-kyoto.ttl`;
  const CREATED_KEY = draftKeyFor(OWNER, CREATED_URL);

  const pastTheWindow = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 400));
    });

  const draftKeys = (store: ReturnType<typeof fakeStorage>) =>
    [...store.items.keys()].filter((k) => k.startsWith("wig.draft."));

  /**
   * A pipeline held open at `process`, so the slot stays `decoding` for exactly
   * as long as this test wants it to. The output when it does resolve is the
   * real fake's, so the settle that follows is the ordinary one and not a
   * shape invented here.
   */
  function heldPipeline() {
    const inner = fakePipeline();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline: Pipeline = {
      async process(file: Blob) {
        await gate;
        return inner.pipeline.process(file);
      },
      dispose() {
        inner.pipeline.dispose();
      },
    };
    return { pipeline, release: () => release() };
  }

  it("keeps a photo that settles after the save, rather than losing it from both", async () => {
    const pod = podFake();
    const media = mediaFake();
    const store = fakeStorage();
    const held = heldPipeline();
    await renderEditor(fakeStudioSession().session, {
      storage: store.storage,
      pipeline: held.pipeline,
    });

    fillNewEntry();
    pickPhoto(jpegFile("beach.jpg"));

    // THE PREMISE: the slot is still working when Save is pressed, and the
    // control invites it. If a later change disables Save while a photo is in
    // flight, this line fails and the right response is to revisit this test
    // deliberately rather than to reach past the guard.
    expect(
      await screen.findByText(/Preparing beach\.jpg/i),
      "the photo settled before the save, so this test proves nothing",
    ).toBeInTheDocument();
    expect(
      saveButton(),
      "Save is disabled while a photo is in flight, so this scenario is unreachable",
    ).toBeEnabled();

    await clickSaveAndWait();

    /* ── half one: the photo is demonstrably NOT on the entry ─────────────── */
    const put = pod.entryPut();
    expect(put, "the entry was never written").toBeDefined();
    expect(
      quadsOf(put!.body, put!.url).filter((q) => q.predicate.value === SCHEMA.image),
      "the in-flight photo reached the entry, so the loss this test is about cannot happen",
    ).toEqual([]);

    /* ── …and the draft was settled, which is what disarms the autosave ───── */
    expect(
      draftKeys(store),
      "the save did not settle the draft, so `touched` was never reset and this test proves nothing",
    ).toEqual([]);
    expect(media.puts, "the derivatives went up before the gate opened").toEqual([]);

    /* ── half two: NOW the photo settles, and it must not vanish ──────────── */
    held.release();
    await screen.findByText(/beach\.jpg is attached to this entry/i);
    await waitFor(() => expect(media.puts).toHaveLength(2));

    await pastTheWindow();

    // THE DECISION. A settle is a change to the form and has to arm the
    // autosave window like any other one — under the key this editor owns now
    // that the entry exists, not stranded under `new`.
    expect(
      draftKeys(store),
      "the settled photo is in neither the entry nor the draft: close the tab and it is orphaned",
    ).toEqual([CREATED_KEY]);

    const kept = parseDraft(store.items.get(CREATED_KEY)!) as { photos?: unknown[] };
    expect(kept.photos, "the draft was written without the photo that settled").toHaveLength(1);
    const photo = kept.photos![0] as Record<string, unknown>;
    expect(
      Photo.safeParse(photo).success,
      "what was kept does not round-trip into a Photo",
    ).toBe(true);
    expect(new URL(String(photo.contentUrl)).pathname).toMatch(MEDIA_PATH);
  });
});

/**
 * Put image derivatives on the Pod and describe them as a `Photo`. STUDIO ONLY —
 * never imported by app/(public); enforced by no-restricted-imports.
 *
 * THE PATH IS CONTENT-ADDRESSED. `travel/media/<sha256(file)[0..16]>/`, so
 * re-picking one photo is idempotent and the same photo in two entries uploads
 * once. Derivable from the file, not guessable without it — which leaves §4's
 * trade-off exactly where §4 put it: a photo on an unpublished draft lives at a
 * publicly readable URL, and that is obscurity rather than access control.
 *
 * THE EXTENSION AND THE FORMAT COME FROM THE BLOB, NEVER FROM WHAT WAS ASKED
 * FOR. `OffscreenCanvas.convertToBlob` does not throw when it cannot encode the
 * requested type; it silently returns PNG. Deriving either from the request
 * would ship a PNG named web.webp, served as image/webp, with nothing red — so
 * a hardcoded "webp" anywhere in this file is a defect even where it looks
 * harmless.
 *
 * EVERY WRITE HERE GOES THROUGH `putGuarded`. Task 4 widened it to take a Blob
 * for exactly this reason: a second hand-rolled PUT for binaries is the blind
 * PUT the precondition exists to prevent (§10).
 */
import { extensionFor } from "./targets";
import { putGuarded } from "@/lib/pod/write";
import { err, ok, type Result } from "@/lib/pod/result";
import type { PodFetch } from "@/lib/pod/rdf";
import type { LangText, Photo } from "@/lib/pod/schema";

/**
 * 64 bits of SHA-256, lowercase hex.
 *
 * The §7.3 example's eight characters is an illustration, not a spec: 32 bits
 * reaches a birthday collision around 77,000 photos, and a collision here is
 * not a broken link — it is one photo silently served in place of another,
 * because the 412 branch below would read the clash as "already uploaded".
 */
export async function mediaHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** §4: media is one global container, outside any trip, so publishing never has
 *  to move binaries or rewrite references. Same `travel/media/` that
 *  lib/pod/access.ts builds from the Pod root — keep the two spellings in step. */
export function mediaContainer(podRoot: string, hash: string): string {
  const root = podRoot.endsWith("/") ? podRoot : `${podRoot}/`;
  return `${root}travel/media/${hash}/`;
}

type Derivative = { blob: Blob; width?: number; height?: number };

export type UploadPhotoOptions = {
  /** The visitor's own authenticated fetch, held only in their browser
   *  (invariant 4). Never defaulted to the ambient one. */
  fetch: PodFetch;
  podRoot: string;
  /** The ORIGINAL file bytes. Hashed for the path; never uploaded (§9). */
  source: ArrayBuffer;
  derivatives: { web: Derivative & { width: number; height: number }; thumb: Derivative };
  blurDataUrl?: string;
  caption?: LangText;
  sortOrder?: number;
};

/**
 * A 412 on a content-addressed path means the bytes already there ARE the bytes
 * we were about to write. That is reuse, not failure.
 *
 * THE CHECK IS EXACT ON PURPOSE, AND THAT EXACTNESS IS THE WHOLE GUARD. One
 * careless widening — `if (!written.ok) return ok(null)`, or a catch-all around
 * the call — turns "treat 412 as reuse" into "treat every failure as success",
 * and the caller then writes an entry pointing at photos that were never
 * uploaded. A 507 must stay a 507. The 507 test in test/media-upload.test.ts is
 * what holds this line; do not delete it alongside a refactor here.
 */
async function putDerivative(fetch: PodFetch, url: string, blob: Blob): Promise<Result<null>> {
  const written = await putGuarded(fetch, url, blob, { create: true }, blob.type);
  if (written.ok) return ok(null);
  if (written.error.kind === "http" && written.error.status === 412) return ok(null);
  return err(written.error);
}

export async function uploadPhoto(opts: UploadPhotoOptions): Promise<Result<Photo>> {
  const { web, thumb } = opts.derivatives;

  // Before any request: a type we cannot name would otherwise be written as
  // `web.undefined`, and the Pod would accept it.
  const webExt = extensionFor(web.blob.type);
  const thumbExt = extensionFor(thumb.blob.type);
  if (!webExt || !thumbExt) {
    return err({
      kind: "shape",
      url: opts.podRoot,
      issues: [
        `cannot name a file for media type "${web.blob.type}" / "${thumb.blob.type}" — ` +
          "the encoder returned something this app does not write",
      ],
    });
  }

  const container = mediaContainer(opts.podRoot, await mediaHash(opts.source));
  const contentUrl = `${container}web.${webExt}`;
  const thumbnailUrl = `${container}thumb.${thumbExt}`;

  /**
   * A BARE `Result`, NOT lib/pod/save-entry.ts's STEP REPORT — AND THAT
   * DIFFERENCE IS DELIBERATE, NOT AN OVERSIGHT. DO NOT "FIX" IT.
   *
   * There is a genuine partial-failure path here: web can be written and thumb
   * then fail, leaving `web.<ext>` on the Pod while this returns an error. In
   * §10's entry sequence that shape is exactly why `saveEntry` returns a report
   * naming the completed steps and a `recovery` action — an entry written but
   * unlisted is invisible rather than absent, and a caller that cannot tell
   * "nothing happened" from "half-written" cannot reach `rebuildIndex`.
   *
   * None of that applies here, for one reason: THE PATH IS CONTENT-ADDRESSED.
   * A retry with the same source bytes derives the same container, so the
   * already-written derivative answers `If-None-Match: *` with 412, which
   * `putDerivative` reads as reuse, and only the missing derivative is written.
   * The operation is idempotent, so "retry" IS the recovery action and there is
   * no orphan to clean up and no state a caller could act on differently. A
   * step report would be a second thing to keep in step for no decision it
   * enables — worse than none.
   *
   * That reasoning is load-bearing, so it is asserted rather than asserted-at:
   * test/media-upload.test.ts, "reports a thumb-only failure as the thumb's,
   * and heals on retry", drives web and thumb to different statuses because
   * every other failure test here answers one status to every PUT and so never
   * reaches this path at all. If that test ever goes red on its retry half,
   * this comment is wrong and the return type has to be revisited.
   *
   * The error is `putGuarded`'s, so it carries the failing derivative's URL and
   * the caller is never told "the upload failed" about a file that is present.
   */
  const wrote = await putDerivative(opts.fetch, contentUrl, web.blob);
  if (!wrote.ok) return err(wrote.error);
  const wroteThumb = await putDerivative(opts.fetch, thumbnailUrl, thumb.blob);
  if (!wroteThumb.ok) return err(wroteThumb.error);

  return ok({
    contentUrl,
    thumbnailUrl,
    width: web.width,
    height: web.height,
    encodingFormat: web.blob.type,
    ...(opts.blurDataUrl === undefined ? {} : { blurDataUrl: opts.blurDataUrl }),
    ...(opts.caption === undefined ? {} : { caption: opts.caption }),
    ...(opts.sortOrder === undefined ? {} : { sortOrder: opts.sortOrder }),
  });
}

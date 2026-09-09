/**
 * Put image derivatives on the Pod and describe them as a `Photo`. STUDIO ONLY.
 * The path is content-addressed and every write goes through `putGuarded`:
 * ./notes.md#content-addressed-paths-and-the-obscurity-they-trade-on
 */

// THE EXTENSION AND THE FORMAT COME FROM THE BLOB, NEVER FROM WHAT WAS ASKED
// FOR — a hardcoded "webp" anywhere in this file is a defect even where it
// looks harmless. ./notes.md#the-encoder-can-answer-a-different-type
import { extensionFor } from "./targets";
import { putGuarded } from "@/lib/pod/write";
import { err, ok, type Result } from "@/lib/pod/result";
import type { PodFetch } from "@/lib/pod/rdf";
import type { LangText, Photo } from "@/lib/pod/schema";

/** 64 bits of SHA-256, lowercase hex. §7.3's eight characters is an
 *  illustration and not a spec — a collision here serves one photo in place of
 *  another; see ./notes.md#sixteen-hex-characters-not-eight */
export async function mediaHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** §4: media is one global container, outside any trip. The same
 *  `travel/media/` that lib/pod/access.ts builds from the Pod root — keep the
 *  two spellings in step. */
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
 * A 412 on a content-addressed path is reuse, not failure. THE CHECK IS EXACT
 * ON PURPOSE, AND THAT EXACTNESS IS THE WHOLE GUARD: one careless widening
 * turns it into "every failure is success". A 507 must stay a 507.
 * See ./notes.md#412-is-reuse-and-nothing-else-is
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
   * A BARE `Result`, NOT lib/pod/save-entry.ts's STEP REPORT, AND THAT
   * DIFFERENCE IS DELIBERATE. Do not "fix" it: a content-addressed retry is
   * idempotent, so "retry" is the whole recovery action.
   * See ./notes.md#why-uploadphoto-returns-a-bare-result
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

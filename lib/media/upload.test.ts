import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import { mediaContainer, mediaHash, uploadPhoto } from "@/lib/media/upload";
import type { PodFetch } from "@/lib/pod/rdf";

/**
 * lib/media/upload.ts at the HTTP boundary, MSW rather than a stubbed fetch —
 * same reasoning as test/write-primitives.test.ts: the precondition rule is
 * about what goes on the wire.
 */
const POD = "https://pod.test.example/";

const blobOf = (bytes: number[], type: string) => new Blob([new Uint8Array(bytes)], { type });

const derivatives = () => ({
  web: { blob: blobOf([1, 2, 3], "image/webp"), width: 1600, height: 1067 },
  thumb: { blob: blobOf([4, 5], "image/webp") },
});

describe("mediaHash", () => {
  it("is 16 lowercase hex characters, and is stable for the same bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const a = await mediaHash(bytes);
    const b = await mediaHash(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
  });

  it("differs for different bytes", async () => {
    const a = await mediaHash(new Uint8Array([1, 2, 3, 4]).buffer);
    const b = await mediaHash(new Uint8Array([1, 2, 3, 5]).buffer);
    expect(a).not.toBe(b);
  });
});

describe("mediaContainer", () => {
  it("addresses the one global media container from §4", () => {
    expect(mediaContainer(POD, "6f2a1c8e6f2a1c8e")).toBe(
      `${POD}travel/media/6f2a1c8e6f2a1c8e/`,
    );
  });
});

describe("uploadPhoto", () => {
  it("PUTs both derivatives and returns a Photo pointing at them", async () => {
    const puts: string[] = [];
    server.use(
      http.put(`${POD}travel/media/*/*`, ({ request }) => {
        puts.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 201, headers: { etag: '"1"' } });
      }),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([9, 9, 9]).buffer,
      derivatives: derivatives(),
      blurDataUrl: "data:image/webp;base64,AAAA",
      sortOrder: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(puts).toHaveLength(2);
    expect(result.value.contentUrl).toMatch(/travel\/media\/[0-9a-f]{16}\/web\.webp$/);
    expect(result.value.thumbnailUrl).toMatch(/travel\/media\/[0-9a-f]{16}\/thumb\.webp$/);
    expect(result.value.width).toBe(1600);
    expect(result.value.height).toBe(1067);
    // §6.1: the format is the blob's ACTUAL type.
    expect(result.value.encodingFormat).toBe("image/webp");
    expect(result.value.blurDataUrl).toBe("data:image/webp;base64,AAAA");
  });

  it("names the file from the blob's ACTUAL type when the encoder fell back", async () => {
    // convertToBlob answers an unsupported request with PNG rather than an
    // error. If the extension came from what we ASKED for, this ships a PNG
    // called web.webp, served as image/webp, and nothing anywhere complains.
    server.use(
      http.put(`${POD}travel/media/*/*`, () => new HttpResponse(null, { status: 201 })),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([7]).buffer,
      derivatives: {
        web: { blob: blobOf([1], "image/png"), width: 800, height: 600 },
        thumb: { blob: blobOf([2], "image/png") },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentUrl).toMatch(/web\.png$/);
    expect(result.value.encodingFormat).toBe("image/png");
  });

  it("treats 412 as reuse, not failure — the same photo twice is one upload", async () => {
    // §7: the path is content-addressed, so If-None-Match: * on a re-upload
    // means "those exact bytes are already there". Reporting it as an error
    // would make re-picking a photo look broken while the Pod holds precisely
    // the right file.
    server.use(
      http.put(`${POD}travel/media/*/*`, () => new HttpResponse(null, { status: 412 })),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([1]).buffer,
      derivatives: derivatives(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentUrl).toMatch(/web\.webp$/);
  });

  it("fails on a real HTTP error rather than pretending the photo uploaded", async () => {
    server.use(
      http.put(`${POD}travel/media/*/*`, () => new HttpResponse(null, { status: 507 })),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([1]).buffer,
      derivatives: derivatives(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "http", status: 507 });
  });

  it("refuses a blob type it cannot name, instead of writing web.undefined", async () => {
    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([1]).buffer,
      derivatives: {
        web: { blob: blobOf([1], "image/avif"), width: 10, height: 10 },
        thumb: { blob: blobOf([2], "image/avif") },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("shape");
  });

  /**
   * THE HALF-WRITTEN CASE, WHICH EVERY OTHER FAILURE TEST HERE IS BLIND TO.
   *
   * The four failure-shaped tests above each drive ONE handler that answers the
   * same status to every PUT, so "both PUTs failed" and "only the second failed"
   * are indistinguishable to them: with 507 everywhere, the web PUT fails first
   * and the thumb is never attempted. This one answers differently per
   * derivative, which is the only way to reach the path where `web.<ext>` is on
   * the Pod and `thumb.<ext>` is not.
   *
   * It asserts BOTH halves of why a bare `Result` is the right return type here,
   * unlike lib/pod/save-entry.ts's step report:
   *
   *  1. the error names the derivative that actually failed, so the caller is
   *     not told "the upload failed" about a file that is sitting on the Pod;
   *  2. retrying with the same source bytes HEALS, because the path is content
   *     addressed — the second attempt gets 412-as-reuse on web and writes only
   *     the thumb. If this half ever goes red, the "no step report needed"
   *     reasoning collapses and the return type has to be revisited.
   */
  it("reports a thumb-only failure as the thumb's, and heals on retry", async () => {
    const source = new Uint8Array([4, 2]).buffer;
    const attempted: string[] = [];
    const isWeb = (request: Request) => new URL(request.url).pathname.endsWith("/web.webp");

    server.use(
      http.put(`${POD}travel/media/*/*`, ({ request }) => {
        attempted.push(new URL(request.url).pathname.split("/").pop()!);
        return new HttpResponse(null, { status: isWeb(request) ? 201 : 507 });
      }),
    );

    const first = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source,
      derivatives: derivatives(),
    });

    expect(first.ok).toBe(false);
    if (first.ok) return;
    // Not just "an error": the error has to identify the derivative, because
    // web.webp succeeded and is now on the Pod.
    expect(first.error).toMatchObject({
      kind: "http",
      status: 507,
      url: expect.stringMatching(/thumb\.webp$/),
    });
    // Both were attempted, in order — i.e. we really are on the partial path
    // and not failing at the first PUT the way the 507 test above does.
    expect(attempted).toEqual(["web.webp", "thumb.webp"]);

    // Retry, same bytes. web.webp exists now, so `If-None-Match: *` answers 412
    // — reuse — and only the thumb is written for real.
    server.resetHandlers();
    const retried: string[] = [];
    server.use(
      http.put(`${POD}travel/media/*/*`, ({ request }) => {
        retried.push(new URL(request.url).pathname.split("/").pop()!);
        return new HttpResponse(null, { status: isWeb(request) ? 412 : 201 });
      }),
    );

    const second = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source,
      derivatives: derivatives(),
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(retried).toEqual(["web.webp", "thumb.webp"]);
    // The same content-addressed URL as the failed attempt: no orphan, nothing
    // to clean up, and the entry can point at exactly this.
    expect(second.value.contentUrl).toBe(
      `${mediaContainer(POD, await mediaHash(source))}web.webp`,
    );
    expect(second.value.thumbnailUrl).toBe(
      `${mediaContainer(POD, await mediaHash(source))}thumb.webp`,
    );
  });
});

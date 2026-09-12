// @vitest-environment jsdom
/** One pick, four slot states, two offers and one worker: what `attach` does in
 *  order, what it refuses, and who disposes the pipeline.
 *  ./notes.md#what-use-photo-pipeline-is-tested-for */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ok } from "@/lib/pod/result";
import { attachedOf, photosFor, usePhotoPipeline } from "./use-photo-pipeline";
import type { PhotoPipelineSeed } from "./use-photo-pipeline";
import type { Pipeline, PipelineResult } from "@/lib/media/pipeline";
import type { Photo } from "@/lib/pod/schema";
import type { PhotoSlot } from "@/components/studio/entry-editor/state/actions";
import type { StudioSessionLike } from "@/lib/studio/session";

const upload = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn());
vi.mock("@/lib/media/upload", () => ({ uploadPhoto: upload }));
vi.mock("@/lib/media/pipeline", () => ({ createPipeline: create }));

afterEach(cleanup);

const POD = "https://pod.example/";
const session = { fetch: vi.fn(), info: { isLoggedIn: true, webId: "u" } } as unknown as
  StudioSessionLike;

const stored = (hash: string): Photo => ({
  contentUrl: `${POD}travel/media/${hash}/web.jpg`,
  sortOrder: 1,
});

/** What the worker hands back. `metadata` is the only part this hook reads. */
function derived(metadata: PipelineResult["metadata"] = {}): PipelineResult {
  const blob = new Blob(["x"], { type: "image/webp" });
  return {
    web: { blob, width: 1600, height: 1067 },
    thumb: { blob, width: 400, height: 267 },
    blurDataUrl: "data:image/webp;base64,AA",
    metadata,
  };
}

function fakePipeline(over: { result?: PipelineResult; throws?: Error } = {}) {
  const processed: Blob[] = [];
  let disposals = 0;
  const pipeline: Pipeline = {
    async process(file) {
      processed.push(file);
      if (over.throws !== undefined) throw over.throws;
      return over.result ?? derived();
    },
    dispose() {
      disposals += 1;
    },
  };
  return { pipeline, processed, disposals: () => disposals };
}

/** The four transitions a pick may dispatch, and nothing else — a group that
 *  held `dispatch` could invent one. */
function formSpy() {
  const calls: string[] = [];
  return {
    calls,
    slots: [] as PhotoSlot[],
    addSlot: vi.fn((slot: PhotoSlot) => {
      calls.push(`add:${slot.key}:${slot.state}`);
    }),
    settleSlot: vi.fn((key: string, slot: PhotoSlot) => {
      calls.push(`settle:${key}:${slot.state}`);
    }),
    offerCoordinate: vi.fn((name: string, lat: string, long: string) => {
      calls.push(`coordinate:${name}:${lat},${long}`);
    }),
    offerTimestamp: vi.fn((offer: { key: string; name: string }) => {
      calls.push(`timestamp:${offer.key}:${offer.name}`);
    }),
  };
}

function seed(over: Partial<PhotoPipelineSeed> = {}): PhotoPipelineSeed {
  return {
    session,
    podRoot: POD,
    pipeline: fakePipeline().pipeline,
    coordinatesLive: true,
    markTouched: vi.fn(),
    form: formSpy(),
    ...over,
  };
}

const jpeg = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });

/** Props built once, outside the render callback. */
function mount(over: Partial<PhotoPipelineSeed> = {}) {
  const props = seed(over);
  const rendered = renderHook(() => usePhotoPipeline(props), {});
  return { ...rendered, props };
}

beforeEach(() => {
  upload.mockReset();
  create.mockReset();
  upload.mockResolvedValue(ok(stored("aa")));
});

describe("photosFor", () => {
  it("APPENDS what was picked; it never replaces what the entry arrived with", () => {
    const carried = [{ contentUrl: `${POD}travel/media/old/web.jpg`, sortOrder: 1 }];
    expect(photosFor(carried, [stored("new")])).toHaveLength(2);
    expect(photosFor(carried, []), "pick nothing and the carried travel through").toEqual(carried);
  });

  it("takes a photo ONCE however many times it is picked", () => {
    // The media path is content-addressed, so a re-pick returns the SAME URL and
    // appending blindly writes two `#photo-N` fragments at one binary.
    expect(photosFor([], [stored("aa"), stored("aa")])).toHaveLength(1);
    expect(photosFor([stored("aa")], [stored("aa")])).toHaveLength(1);
  });

  it("seeds `sortOrder` from what the SERIALISER will write, not from the length", () => {
    // `entry-model.ts` writes `photo.sortOrder ?? i + 1`, so one unnumbered
    // carried photo is stored as 1 — and `carried.length` is 1 too: a collision
    // in the very case the fallback exists for.
    const unnumbered = [{ contentUrl: `${POD}travel/media/old/web.jpg` }];
    expect(photosFor(unnumbered, [stored("new")])[1].sortOrder).toBe(2);
    expect(photosFor([], [stored("a"), stored("b")]).map((p) => p.sortOrder)).toEqual([1, 2]);
  });

  it("leaves the carried numbers exactly as they were stored", () => {
    const carried = [{ contentUrl: `${POD}travel/media/old/web.jpg`, sortOrder: 7 }];
    const out = photosFor(carried, [stored("new")]);
    expect(out[0].sortOrder, "renumbering rewrites §7.3 data nobody touched").toBe(7);
    expect(out[1].sortOrder).toBe(8);
  });
});

describe("attachedOf", () => {
  it("is the fence: `ready` only, in pick order", () => {
    const slots: PhotoSlot[] = [
      { key: "photo-0", name: "a.jpg", state: "ready", photo: stored("a") },
      { key: "photo-1", name: "b.jpg", state: "decoding" },
      { key: "photo-2", name: "c.jpg", state: "failed", message: "no" },
      { key: "photo-3", name: "d.jpg", state: "ready", photo: stored("d") },
    ];
    expect(attachedOf(slots).map((p) => p.contentUrl)).toEqual([
      stored("a").contentUrl,
      stored("d").contentUrl,
    ]);
  });
});

describe("usePhotoPipeline — one photo, in order", () => {
  it("walks decoding → uploading → ready, then makes both offers", async () => {
    const form = formSpy();
    const markTouched = vi.fn();
    const { result } = mount({
      form,
      markTouched,
      pipeline: fakePipeline({
        result: derived({
          gps: { lat: 35.6938, long: 139.7034 },
          dateTimeOriginal: "2026:04:11 07:05:33",
          offsetTimeOriginal: "+09:00",
        }),
      }).pipeline,
    });
    await act(async () => {
      result.current.attachAll([jpeg("first.jpg")]);
    });
    expect(form.calls).toEqual([
      "add:photo-0:decoding",
      "settle:photo-0:uploading",
      "settle:photo-0:ready",
      "coordinate:first.jpg:35.6938,139.7034",
      "timestamp:photo-0:first.jpg",
    ]);
    expect(markTouched, "a settle and two fills are all changes to the form").toHaveBeenCalled();
  });

  it("offers the coordinate AT FULL PRECISION and as a string", async () => {
    const form = formSpy();
    const { result } = mount({
      form,
      pipeline: fakePipeline({ result: derived({ gps: { lat: 35.69381234, long: 139.7034 } }) })
        .pipeline,
    });
    await act(async () => {
      result.current.attachAll([jpeg("a.jpg")]);
    });
    expect(form.offerCoordinate).toHaveBeenCalledWith("a.jpg", "35.69381234", "139.7034");
  });

  it("hands the SLOT KEY to the timestamp offer and only the name to the coordinate", async () => {
    // Two cameras both call their first photo IMG_0001.jpg, so the cross-half
    // guard is on the key. The coordinate displays the name and never compares it.
    const form = formSpy();
    const { result } = mount({
      form,
      pipeline: fakePipeline({
        result: derived({ gps: { lat: 1, long: 2 }, dateTimeOriginal: "2026:04:11 07:05:33" }),
      }).pipeline,
    });
    await act(async () => {
      result.current.attachAll([jpeg("IMG_0001.jpg")]);
    });
    expect(form.offerTimestamp).toHaveBeenCalledWith({
      key: "photo-0",
      name: "IMG_0001.jpg",
      wall: "2026:04:11 07:05:33",
      offset: undefined,
    });
  });

  it("gives every slot its own key, and never the file name", async () => {
    const form = formSpy();
    const { result } = mount({ form });
    await act(async () => {
      result.current.attachAll([jpeg("same.jpg"), jpeg("same.jpg")]);
    });
    const added = form.addSlot.mock.calls.map(([slot]) => slot.key);
    expect(new Set(added).size, "two files of one name are two slots").toBe(2);
    expect(added).toEqual(["photo-0", "photo-1"]);
  });
});

describe("usePhotoPipeline — what it refuses", () => {
  it("makes NO offer at all when the upload failed", async () => {
    // A coordinate from a photo that is not on the entry has nothing on screen
    // to explain it, and its note names a file the form no longer holds.
    upload.mockResolvedValue({
      ok: false,
      error: { kind: "http", url: `${POD}travel/media/aa/web.jpg`, status: 507 },
    });
    const form = formSpy();
    const { result } = mount({
      form,
      pipeline: fakePipeline({ result: derived({ gps: { lat: 1, long: 2 } }) }).pipeline,
    });
    await act(async () => {
      result.current.attachAll([jpeg("a.jpg")]);
    });
    expect(form.calls).toEqual(["add:photo-0:decoding", "settle:photo-0:uploading", "settle:photo-0:failed"]);
    expect(form.settleSlot.mock.calls.at(-1)?.[1]).toMatchObject({
      state: "failed",
      message: expect.stringContaining("507"),
    });
  });

  it("catches a pipeline REJECTION rather than leaving a slot decoding for ever", async () => {
    const form = formSpy();
    const { result } = mount({
      form,
      pipeline: fakePipeline({ throws: new Error("the decoder gave up") }).pipeline,
    });
    await act(async () => {
      result.current.attachAll([jpeg("a.jpg")]);
    });
    expect(form.settleSlot).toHaveBeenCalledWith("photo-0", {
      key: "photo-0",
      name: "a.jpg",
      state: "failed",
      message: "the decoder gave up",
    });
  });

  it("refuses the coordinate when §9's gate is not open, and still offers the clock", async () => {
    const form = formSpy();
    const { result } = mount({
      form,
      coordinatesLive: false,
      pipeline: fakePipeline({
        result: derived({ gps: { lat: 1, long: 2 }, dateTimeOriginal: "2026:04:11 07:05:33" }),
      }).pipeline,
    });
    await act(async () => {
      result.current.attachAll([jpeg("a.jpg")]);
    });
    expect(form.offerCoordinate, "§9 fails closed, and a photo is not an exception").not
      .toHaveBeenCalled();
    expect(form.offerTimestamp, "the two offers are independent").toHaveBeenCalled();
  });

  it("offers nothing for a coordinate the file does not carry", async () => {
    // `readMetadata` answers `{}` for a screenshot or a scan, and
    // `String(undefined)` would write "undefined" into a number box.
    const form = formSpy();
    const { result } = mount({ form, pipeline: fakePipeline({ result: derived({}) }).pipeline });
    await act(async () => {
      result.current.attachAll([jpeg("scan.jpg")]);
    });
    expect(form.offerCoordinate).not.toHaveBeenCalled();
    expect(form.offerTimestamp, "still asked, with both tags absent").toHaveBeenCalledWith({
      key: "photo-0",
      name: "scan.jpg",
      wall: undefined,
      offset: undefined,
    });
  });
});

describe("usePhotoPipeline — the worker", () => {
  it("creates nothing until the first pick", () => {
    mount({ pipeline: undefined });
    expect(create, "a worker at mount is a thread and a chunk for nothing").not.toHaveBeenCalled();
  });

  it("creates ONE, however many files are picked, and disposes it on unmount", async () => {
    const own = fakePipeline();
    create.mockReturnValue(own.pipeline);
    const { result, unmount } = mount({ pipeline: undefined });
    await act(async () => {
      result.current.attachAll([jpeg("a.jpg"), jpeg("b.jpg")]);
    });
    expect(create).toHaveBeenCalledTimes(1);
    unmount();
    expect(own.disposals(), "a decoded bitmap is 200 MB for a 50 MP photo").toBe(1);
  });

  it("NEVER disposes a pipeline the caller injected", async () => {
    const theirs = fakePipeline();
    const { result, unmount } = mount({ pipeline: theirs.pipeline });
    await act(async () => {
      result.current.attachAll([jpeg("a.jpg")]);
    });
    unmount();
    // `dispose()` is not a cancel: it terminates the worker and rejects
    // everything pending, so disposing a caller's instance breaks a photo it is
    // still processing. Whoever creates, disposes.
    expect(theirs.disposals()).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it("uploads the ORIGINAL bytes' hash and the DERIVATIVES, never the metadata", async () => {
    const { result } = mount({
      pipeline: fakePipeline({ result: derived({ gps: { lat: 1, long: 2 } }) }).pipeline,
    });
    await act(async () => {
      result.current.attachAll([jpeg("a.jpg")]);
    });
    const call = upload.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(
      ["blurDataUrl", "derivatives", "fetch", "podRoot", "source"].sort(),
    );
    expect(call, "stripping means the derivatives are re-encoded without it").not.toHaveProperty(
      "metadata",
    );
  });
});

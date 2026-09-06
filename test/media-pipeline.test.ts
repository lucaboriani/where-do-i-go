import { describe, expect, it, vi } from "vitest";
import { createPipeline, type WorkerLike } from "@/lib/media/pipeline";

/**
 * lib/media/pipeline.ts — the MAIN-THREAD half. The worker's body cannot run
 * here (jsdom has no createImageBitmap, no OffscreenCanvas), and faking a
 * canvas to manufacture coverage would verify a different encoder than the one
 * that ships. The pixels are e2e/media-pipeline.spec.ts's job.
 *
 * What IS checkable here is the queueing contract, which is a real invariant:
 * one worker, one photo at a time, because three 50 MP decodes in flight is
 * how a phone's browser tab gets killed mid-edit.
 */
function fakeWorker() {
  const inFlight: number[] = [];
  let peak = 0;
  const worker = {
    posted: [] as unknown[],
    listener: null as ((e: { data: unknown }) => void) | null,
    terminated: false,
    addEventListener(_: string, fn: (e: { data: unknown }) => void) {
      this.listener = fn;
    },
    postMessage(message: unknown) {
      this.posted.push(message);
      const { id } = message as { id: number };
      inFlight.push(id);
      peak = Math.max(peak, inFlight.length);
      setTimeout(() => {
        inFlight.splice(inFlight.indexOf(id), 1);
        this.listener?.({
          data: {
            id,
            ok: true,
            result: {
              web: { blob: new Blob([], { type: "image/webp" }), width: 1600, height: 1200 },
              thumb: { blob: new Blob([], { type: "image/webp" }), width: 400, height: 300 },
              metadata: {},
            },
          },
        });
      }, 1);
    },
    terminate() {
      this.terminated = true;
    },
    peak: () => peak,
  };
  return worker as unknown as WorkerLike & { terminated: boolean; posted: unknown[]; peak: () => number };
}

describe("createPipeline", () => {
  it("processes one photo and resolves with the worker's result", async () => {
    const worker = fakeWorker();
    const pipeline = createPipeline(() => worker);
    const result = await pipeline.process(new Blob([new Uint8Array([1])]));
    expect(result.web.width).toBe(1600);
    expect(worker.posted).toHaveLength(1);
  });

  it("never has two photos in the worker at once", async () => {
    // The invariant, asserted by MEASURING concurrency rather than by reading
    // the implementation back: peak in-flight must be 1, however many are
    // queued.
    const worker = fakeWorker();
    const pipeline = createPipeline(() => worker);
    await Promise.all([
      pipeline.process(new Blob([new Uint8Array([1])])),
      pipeline.process(new Blob([new Uint8Array([2])])),
      pipeline.process(new Blob([new Uint8Array([3])])),
    ]);
    expect(worker.posted).toHaveLength(3);
    expect(worker.peak()).toBe(1);
  });

  it("rejects the right photo when the worker reports a failure", async () => {
    // Two statements, not one: casting an object literal at its own
    // expression breaks `this`-inference for that literal's methods, which
    // then resolve to `{}` and make `this.listener` a TS2339. Assign to a
    // plain const first, cast the identifier second — the same shape
    // fakeWorker() above already uses.
    const failing = {
      listener: null as ((e: { data: unknown }) => void) | null,
      addEventListener(_: string, fn: (e: { data: unknown }) => void) {
        this.listener = fn;
      },
      postMessage(message: unknown) {
        const { id } = message as { id: number };
        setTimeout(() => this.listener?.({ data: { id, ok: false, message: "cannot decode" } }), 1);
      },
      terminate() {},
    };
    const worker = failing as unknown as WorkerLike;

    const pipeline = createPipeline(() => worker);
    await expect(pipeline.process(new Blob([]))).rejects.toThrow("cannot decode");
  });

  it("terminates the worker on dispose", async () => {
    const worker = fakeWorker();
    const pipeline = createPipeline(() => worker);
    await pipeline.process(new Blob([new Uint8Array([1])]));
    pipeline.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("does not spawn a worker until the first photo", () => {
    // The editor mounts on every entry edit; most edits touch no photo. A
    // worker spawned at mount is a thread and a chunk download for nothing.
    const spawn = vi.fn(() => fakeWorker());
    createPipeline(spawn);
    expect(spawn).not.toHaveBeenCalled();
  });
});

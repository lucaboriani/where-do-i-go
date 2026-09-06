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

const okResult = () => ({
  web: { blob: new Blob([], { type: "image/webp" }), width: 1600, height: 1200 },
  thumb: { blob: new Blob([], { type: "image/webp" }), width: 400, height: 300 },
  metadata: {},
});

/**
 * Fails the ids named in `failing`, succeeds on the rest, and records the ids
 * it was actually SENT. The record is the point: a poisoned queue tail is
 * invisible from the returned promises alone, because the photo behind the
 * failure still rejects — with the WRONG message, having never been posted.
 */
function scriptedWorker(failing: number[]) {
  const worker = {
    postedIds: [] as number[],
    listener: null as ((e: { data: unknown }) => void) | null,
    terminated: false,
    addEventListener(_: string, fn: (e: { data: unknown }) => void) {
      this.listener = fn;
    },
    postMessage(message: unknown) {
      const { id } = message as { id: number };
      this.postedIds.push(id);
      setTimeout(() => {
        this.listener?.({
          data: failing.includes(id)
            ? { id, ok: false, message: `photo ${id} could not be decoded` }
            : { id, ok: true, result: okResult() },
        });
      }, 1);
    },
    terminate() {
      this.terminated = true;
    },
  };
  return worker as unknown as WorkerLike & { postedIds: number[]; terminated: boolean };
}

/**
 * Answers only when the test says so, which makes ORDERING observable:
 * "was this photo posted at all" is a different question from "did it
 * resolve", and only the first one can see a photo stuck behind a queue tail
 * that will never settle.
 */
function manualWorker() {
  const worker = {
    postedIds: [] as number[],
    listener: null as ((e: { data: unknown }) => void) | null,
    terminated: false,
    addEventListener(_: string, fn: (e: { data: unknown }) => void) {
      this.listener = fn;
    },
    postMessage(message: unknown) {
      this.postedIds.push((message as { id: number }).id);
    },
    respond(id: number) {
      this.listener?.({ data: { id, ok: true, result: okResult() } });
    },
    terminate() {
      this.terminated = true;
    },
  };
  return worker as unknown as WorkerLike & {
    postedIds: number[];
    terminated: boolean;
    respond: (id: number) => void;
  };
}

/** Drain every queued microtask, and the fakes' 1 ms timers with them. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

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
  it("a failed photo does not take the photo behind it down with it", async () => {
    // What `queue = result.catch(() => undefined)` buys. Without it photo 1's
    // rejection poisons the tail, and photo 2 is NEVER POSTED — it inherits
    // photo 1's rejection instead of being processed. Both photos end up
    // rejected either way, so asserting "the second one rejected" would pass
    // on the broken version; the assertion has to be on what reached the
    // worker.
    const worker = scriptedWorker([1]);
    const pipeline = createPipeline(() => worker);
    const first = pipeline.process(new Blob([new Uint8Array([1])]));
    const second = pipeline.process(new Blob([new Uint8Array([2])]));

    await expect(first).rejects.toThrow("photo 1 could not be decoded");
    await expect(second).resolves.toMatchObject({ web: { width: 1600 } });
    expect(worker.postedIds).toEqual([1, 2]);
  });

  it("is still usable after dispose, on a fresh worker", async () => {
    // The ruling, pinned: a disposed pipeline REUSES rather than throws.
    // dispose() is an effect cleanup in the studio editor and React
    // double-invokes effects under StrictMode in development, so a pipeline
    // that threw here would turn an ordinary dev remount into a crash.
    const workers: ReturnType<typeof fakeWorker>[] = [];
    const spawn = vi.fn(() => {
      const worker = fakeWorker();
      workers.push(worker);
      return worker;
    });
    const pipeline = createPipeline(spawn);
    await pipeline.process(new Blob([new Uint8Array([1])]));
    pipeline.dispose();

    const result = await pipeline.process(new Blob([new Uint8Array([2])]));
    expect(result.web.width).toBe(1600);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.posted).toHaveLength(1);
  });

  it("does not chain a photo processed after dispose behind the disposed queue", async () => {
    // The half of the reset that a test can see, and the exact shape a
    // StrictMode remount produces: process() schedules send() on a microtask,
    // so a cleanup firing in the same tick disposes BEFORE that photo ever
    // reaches `pending` — which means dispose() cannot reject it and its
    // promise stays open indefinitely. Without `queue = Promise.resolve()` the
    // next photo waits behind that orphan and is never posted at all.
    const workers: ReturnType<typeof manualWorker>[] = [];
    const spawn = vi.fn(() => {
      const worker = manualWorker();
      workers.push(worker);
      return worker;
    });
    const pipeline = createPipeline(spawn);

    const orphan = pipeline.process(new Blob([new Uint8Array([1])]));
    pipeline.dispose();
    const afterDispose = pipeline.process(new Blob([new Uint8Array([2])]));
    await settle();

    // Posted at all is the assertion. Resolving is only its consequence.
    expect(workers).toHaveLength(1);
    expect(workers[0]!.postedIds).toEqual([1, 2]);

    workers[0]!.respond(2);
    await expect(afterDispose).resolves.toMatchObject({ web: { width: 1600 } });
    workers[0]!.respond(1);
    await expect(orphan).resolves.toMatchObject({ web: { width: 1600 } });
  });
});

/**
 * The main-thread half of the media pipeline. STUDIO ONLY.
 *
 * ONE WORKER, ONE PHOTO AT A TIME. Not one worker per photo and not a pool:
 * decoding a 50 MP image costs on the order of 200 MB of bitmap, so three in
 * flight is how a phone's browser tab gets killed in the middle of an edit.
 *
 * THE AUTHENTICATED FETCH NEVER CROSSES THIS BOUNDARY. It is a closure over
 * the Inrupt session's token state and is not structured-cloneable, so uploads
 * happen out here, in lib/media/upload.ts. The worker owns bytes; the main
 * thread owns the network.
 */
import type { TransferableResult, WorkerRequest, WorkerResponse } from "./pipeline.worker";

export type PipelineResult = TransferableResult;

/** The slice of Worker this module uses, so a test can supply a fake. */
export type WorkerLike = {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
};

export type Pipeline = {
  process(file: Blob): Promise<PipelineResult>;
  dispose(): void;
};

const defaultSpawn = (): WorkerLike =>
  new Worker(new URL("./pipeline.worker.ts", import.meta.url), { type: "module" }) as WorkerLike;

export function createPipeline(spawn: () => WorkerLike = defaultSpawn): Pipeline {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  /** Resolvers by request id. One entry at a time, by construction. */
  const pending = new Map<
    number,
    { resolve: (r: PipelineResult) => void; reject: (e: Error) => void }
  >();
  /** The tail of the queue: each process() chains onto the previous one. */
  let queue: Promise<unknown> = Promise.resolve();

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    // Spawned lazily: the editor mounts on every entry edit and most edits
    // touch no photo, so a worker at mount is a thread and a chunk for nothing.
    worker = spawn();
    worker.addEventListener("message", (event) => {
      const data = event.data as WorkerResponse;
      const waiting = pending.get(data.id);
      if (!waiting) return;
      pending.delete(data.id);
      if (data.ok) waiting.resolve(data.result);
      else waiting.reject(new Error(data.message));
    });
    return worker;
  }

  function send(file: Blob): Promise<PipelineResult> {
    const id = nextId++;
    const active = ensureWorker();
    return new Promise<PipelineResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      active.postMessage({ id, file });
    });
  }

  return {
    process(file: Blob): Promise<PipelineResult> {
      // Chain onto the tail so exactly one photo is ever in the worker. The
      // `.catch` keeps one failed photo from poisoning the queue behind it.
      const result = queue.then(() => send(file));
      queue = result.catch(() => undefined);
      return result;
    },
    dispose(): void {
      worker?.terminate();
      worker = null;
      for (const waiting of pending.values()) waiting.reject(new Error("pipeline disposed"));
      pending.clear();
      // RESET THE TAIL, AND STAY USABLE. dispose() is an effect cleanup in the
      // studio editor, and React double-invokes effects under StrictMode in
      // development — so mount, dispose, mount again on the SAME memoised
      // instance is the dev default, not an edge case. Without this line a
      // photo processed after that remount chains onto the disposed
      // lifecycle's tail and waits on a worker that was terminated. Making
      // process() throw instead would turn a StrictMode remount into a crash,
      // which is worse than the bug it would report.
      queue = Promise.resolve();
    },
  };
}

/**
 * The main-thread half of the media pipeline. STUDIO ONLY. One worker, one
 * photo at a time, and THE AUTHENTICATED FETCH NEVER CROSSES INTO THE WORKER:
 * the worker owns bytes, the main thread owns the network.
 * See ./notes.md#one-worker-one-photo-and-no-session-in-it
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
  /**
   * Terminate, reject what is pending, reset the tail. IT IS NOT A CANCEL: a
   * photo queued but not yet past `pending` can RESOLVE AFTER THIS RETURNS.
   * Unmount cleanup is the only correct caller, and a second one needs a
   * generation counter first; see ./notes.md#dispose-is-not-a-cancel
   */
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
      // RESET THE TAIL, AND STAY USABLE: a StrictMode remount disposes and
      // re-mounts the SAME memoised instance, and without this line the next
      // photo waits on a terminated worker.
      // ./notes.md#resetting-the-queue-tail-and-strictmode
      queue = Promise.resolve();
    },
  };
}

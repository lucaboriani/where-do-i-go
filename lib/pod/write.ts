/**
 * Authenticated Pod writes. STUDIO ONLY — never imported by app/(public);
 * enforced by no-restricted-imports.
 *
 * Writes go browser → Pod directly. No server-side session, no service account,
 * no route handler proxying a write: a full compromise of the hosting still
 * cannot write a single entry.
 */
import { Parser } from "n3";
import { LDP } from "@/lib/vocab";
import { computeIndex, serialiseIndex } from "./index-model";
import { readEntry } from "./read";
import { err, ok, type Result } from "./result";
import type { PodFetch } from "./rdf";
import type { Entry } from "./schema";

/**
 * Every write carries a precondition: `If-None-Match: *` to create, `If-Match:
 * <etag>` to update. A blind PUT is how a phone tab left open for two days
 * silently reverts a week of edits (§10). Phase 0 confirmed both Community
 * Solid Server and Inrupt ESS honour these, including rejecting a stale ETag
 * with 412 — so there is no server for which this is merely advisory.
 */
export type Precondition = { create: true } | { etag: string };

export async function putGuarded(
  fetch: PodFetch,
  url: string,
  body: string,
  precondition: Precondition,
  contentType = "text/turtle",
): Promise<Result<{ etag: string | null }>> {
  const headers: Record<string, string> = { "content-type": contentType };
  if ("create" in precondition) headers["if-none-match"] = "*";
  else headers["if-match"] = precondition.etag;

  let res: Response;
  try {
    res = await fetch(url, { method: "PUT", headers, body });
  } catch (cause) {
    return err({ kind: "network", url, message: cause instanceof Error ? cause.message : String(cause) });
  }
  // 412 is the precondition doing its job: something changed underneath us.
  // Refetch and retry rather than forcing (§10).
  if (!res.ok) return err({ kind: "http", url, status: res.status });
  return ok({ etag: res.headers.get("etag") });
}

/** Enumerate a container via ldp:contains. Authenticated, because the studio
 *  must see drafts — and because phase 0 showed a container listing can be
 *  closed to anonymous readers to stop draft slugs leaking. */
export async function listContainer(fetch: PodFetch, containerUrl: string): Promise<Result<string[]>> {
  let res: Response;
  try {
    res = await fetch(containerUrl, { headers: { accept: "text/turtle" } });
  } catch (cause) {
    return err({ kind: "network", url: containerUrl, message: cause instanceof Error ? cause.message : String(cause) });
  }
  if (!res.ok) return err({ kind: "http", url: containerUrl, status: res.status });
  try {
    const quads = new Parser({ baseIRI: containerUrl }).parse(await res.text());
    return ok(quads.filter((q) => q.predicate.value === LDP.contains).map((q) => q.object.value));
  } catch (cause) {
    return err({ kind: "parse", url: containerUrl, message: cause instanceof Error ? cause.message : String(cause) });
  }
}

export type RebuildReport = {
  read: number;
  published: number;
  skipped: { url: string; reason: string }[];
  indexUrl: string;
};

/**
 * Regenerate a trip's index from the entries themselves.
 *
 * Built in phase 1 rather than when first needed, because it is the recovery
 * path for every partial-write failure in §10 — an entry that exists but is
 * unlisted is invisible, not corrupt, and this is what makes it visible again.
 * It is also the migration tool when dy:schemaVersion increments.
 *
 * Deliberately tolerant: one malformed entry is skipped and reported, never
 * fatal. A single bad resource must not make the whole trip unrecoverable.
 */
export async function rebuildIndex(opts: {
  fetch: PodFetch;
  tripIri: string;
  entriesContainer: string;
  indexUrl: string;
  now?: () => string;
}): Promise<Result<RebuildReport>> {
  const listed = await listContainer(opts.fetch, opts.entriesContainer);
  if (!listed.ok) return listed;

  const entries: Entry[] = [];
  const skipped: { url: string; reason: string }[] = [];

  // Concurrently, not in a loop. data-model.md §13 item 6 after phase 0: "200
  // sequential reads against a hosted Pod over real RTT … rebuildIndex must
  // read concurrently regardless." Phase 0 measured 0.6s at concurrency 12 vs
  // 1.1s serially on localhost, where RTT is zero — over a network the serial
  // version is 200 x RTT.
  const CONCURRENCY = 12;
  const urls = listed.value.filter((u) => u.endsWith(".ttl"));
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      urls.slice(i, i + CONCURRENCY).map(async (url) => [url, await readEntry(url, { fetch: opts.fetch })] as const),
    );
    for (const [url, r] of batch) {
      if (r.ok) entries.push(r.value);
      // One malformed entry is skipped and reported, never fatal: a single bad
      // resource must not make the whole trip unrecoverable.
      else skipped.push({ url, reason: r.error.kind });
    }
  }

  const computed = computeIndex(entries);
  const modified = (opts.now ?? (() => new Date().toISOString().replace("Z", "+00:00")))();
  const body = await serialiseIndex(opts.indexUrl, opts.tripIri, computed, modified);

  // Read the current index to obtain its ETag; absent means create.
  let etag: string | null = null;
  let exists = false;
  try {
    const head = await opts.fetch(opts.indexUrl, { method: "HEAD" });
    exists = head.ok;
    etag = head.headers.get("etag");
  } catch {
    exists = false;
  }

  const written = await putGuarded(
    opts.fetch,
    opts.indexUrl,
    body,
    exists && etag ? { etag } : { create: true },
  );
  if (!written.ok) return written;

  return ok({
    read: urls.length,
    published: computed.entryCount,
    skipped,
    indexUrl: opts.indexUrl,
  });
}

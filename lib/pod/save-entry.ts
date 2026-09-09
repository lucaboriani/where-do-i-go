/** The §10 write sequence. STUDIO ONLY. Its own module because access.ts
 *  already imports write.ts, and the return value is a REPORT rather than a
 *  `Result` — §10's three partial failures all recover through `rebuildIndex`.
 *  ./notes.md#why-saveentry-is-its-own-module-and-why-its-return-value-is-not-a-result */

// 1. PUT the entry         — `If-None-Match: *` to create, `If-Match` to update
// 2. set its ACL           — public-read if published, owner-only if draft
// 3. rewrite `entries.ttl` — insert the row, recompute the derived values
// 4. call the revalidation hook so the public site drops its cache
import { makePrivate, makePublic } from "./access";
import { documentUrlOf, serialiseEntry } from "./entry-model";
import {
  computeIndexFromRows,
  rowOfEntry,
  rowOfIndexEntry,
  serialiseIndex,
  type IndexRowInput,
} from "./index-model";
import { readTripIndexWithEtag } from "./read";
import { err, ok, type PodError, type Result } from "./result";
import { TAGS } from "./tags";
import { putGuarded, type Precondition } from "./write";
import type { PodFetch } from "./rdf";
import type { Entry } from "./schema";

/* --------------------------------------------------------------------- types */

export type SaveStep = "entry" | "access" | "index" | "revalidate";

/**
 * What the caller must do next: "none", "retry", "refetch" (a precondition
 * failed — re-read, and never retry without one), "rebuildIndex" (§10's single
 * recovery). ./notes.md#why-saveentry-is-its-own-module-and-why-its-return-value-is-not-a-result
 */
export type SaveRecovery = "none" | "retry" | "refetch" | "rebuildIndex";

export type SaveEntryReport = {
  entryUrl: string;
  /** Steps that completed, in §10 order. */
  completed: SaveStep[];
  /** Absent on full success. */
  failed?: { step: SaveStep; error: PodError };
  recovery: SaveRecovery;
  /** The entry's new ETag, for the caller's next edit. `null` when the server
   *  sent none — the write happened, but the next update has nothing to
   *  condition on and must re-read rather than invent one. */
  etag?: string | null;
};

export type SaveEntryOptions = {
  /** The visitor's own authenticated fetch, held only in their browser
   *  (invariant 4). Never defaulted to the ambient one: that is a silent
   *  downgrade to anonymous, which reads as "not found" on a hosted Pod. */
  fetch: PodFetch;
  entry: Entry;
  /** `{ create: true }` for a new entry; `{ etag }` from THE READ THAT PRODUCED
   *  THE EDITED STATE for an update. Never a blind PUT (§10). */
  precondition: Precondition;
  indexUrl: string;
  tripIri: string;
  tripSlug: string;
  /**
   * Step 4. Injected rather than calling `revalidateTag` directly: this runs in
   * the browser and `revalidateTag` is server-side, so the studio's real hook
   * posts to a route handler. A callback also keeps this module host-neutral
   * (invariant 7) and makes step 4 observable.
   */
  revalidate: (tags: string[]) => void | Promise<void>;
  /** The owner, when known. Only ever used as provenance and as the agent to
   *  keep in an ACL — never to decide authorisation, which is the Pod's job. */
  webId?: string;
  now?: () => string;
};

/* ------------------------------------------------------------------- helpers */

/** xsd:dateTime always carries a UTC offset (§6). `toISOString` ends in `Z`,
 *  which is a valid offset; the substitution keeps the lexical form uniform
 *  with everything else this app writes. */
const nowIso = () => new Date().toISOString().replace("Z", "+00:00");

/**
 * A failed write, classified. 412 is the precondition doing its job and the one
 * status where retrying the identical request is guaranteed to fail again.
 * ./notes.md#why-saveentry-is-its-own-module-and-why-its-return-value-is-not-a-result
 */
const recoveryForWrite = (error: PodError): SaveRecovery =>
  error.kind === "http" && error.status === 412 ? "refetch" : "retry";

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/* ------------------------------------------------------------------ the steps */

/**
 * `dcterms:created` is CARRIED FORWARD on an update and set on a create — the
 * whole reason the field exists on `Entry` (§7.3). Stamped once, before any
 * step, into a new object. ./notes.md#dctermscreated-is-carried-forward-and-stamped-once
 */
export function stampedEntry(opts: SaveEntryOptions, stamp: string): Entry {
  const creating = "create" in opts.precondition;
  return {
    ...opts.entry,
    created: opts.entry.created ?? (creating ? stamp : undefined),
    creator: opts.entry.creator ?? opts.webId,
    modified: stamp,
  };
}

/**
 * Step 1: PUT the entry under the precondition the caller was handed —
 * `If-None-Match: *` to create, `If-Match: <etag>` to update, never a blind PUT
 * (§10). A serialiser refusal — a slug that disagrees with its filename, say —
 * comes back before anything leaves the machine, so nothing is on the Pod.
 */
export async function putEntry(
  opts: SaveEntryOptions,
  entry: Entry,
  entryUrl: string,
): Promise<Result<{ etag: string | null }>> {
  const body = await serialiseEntry(entry);
  if (!body.ok) return err(body.error);
  return putGuarded(opts.fetch, entryUrl, body.value, opts.precondition);
}

/** Step 2: public-read if published, owner-only if draft. §5 pairs the ACL with
 *  `dy:status` and both come off this one field, through `lib/pod/access.ts` —
 *  the only module in the project that touches an ACL. */
export function setEntryAccess(opts: SaveEntryOptions, entry: Entry, entryUrl: string) {
  const accessOptions = { fetch: opts.fetch, webId: opts.webId };
  return entry.status === "published"
    ? makePublic(entryUrl, accessOptions)
    : makePrivate(entryUrl, accessOptions);
}

/**
 * Step 3: read `entries.ttl`, insert this entry's row, recompute the derived
 * values, write back with `If-Match`. Recomputed, never incremented, and A
 * DRAFT STILL GOES THROUGH HERE with its row removed rather than skipped.
 * ./notes.md#step-3-recomputes-and-a-draft-still-goes-through-it
 */
async function writeIndex(opts: SaveEntryOptions, entry: Entry, stamp: string): Promise<Result<null>> {
  const read = await readTripIndexWithEtag(opts.indexUrl, { fetch: opts.fetch });

  let rows: IndexRowInput[] = [];
  let precondition: Precondition = { create: true };

  if (read.ok) {
    rows = read.value.index.entries.map(rowOfIndexEntry);
    /**
     * No ETag means no safe update. The write is attempted as a create, the
     * server refuses it, and the existing index survives untouched. §10 allows
     * two preconditions and no third — `If-Match: *` would be a blind PUT
     * wearing one. Same rule as `rebuildIndex`.
     */
    precondition = read.value.etag ? { etag: read.value.etag } : { create: true };
  } else if (read.error.kind === "http" && read.error.status === 404) {
    // A trip's first entry: entries.ttl does not exist yet, so create it.
    // `If-None-Match: *` still guards the case where it appears meanwhile.
  } else {
    // Anything else — 403, a malformed index, a version this code cannot read
    // — is reported rather than papered over. Regenerating from scratch on that
    // basis is `rebuildIndex`'s job, invoked deliberately by the owner, not a
    // side effect of saving one entry.
    return err(read.error);
  }

  const others = rows.filter((r) => r.slug !== entry.slug && r.entryResource !== entry.iri);
  const next = entry.status === "published" ? [...others, rowOfEntry(entry)] : others;

  const body = await serialiseIndex(
    opts.indexUrl,
    opts.tripIri,
    computeIndexFromRows(next),
    // The same instant as the entry's dcterms:modified. §7.4: "all derived
    // values share one dcterms:modified".
    stamp,
  );

  const written = await putGuarded(opts.fetch, opts.indexUrl, body, precondition);
  return written.ok ? ok(null) : err(written.error);
}

/**
 * Step 4: the revalidation hook, so the public site drops its cache. A hook
 * that throws leaves the Pod consistent and only the cache stale.
 * ./notes.md#why-the-index-is-not-written-when-the-acl-step-fails
 */
export async function runRevalidation(
  opts: SaveEntryOptions,
  entry: Entry,
  entryUrl: string,
): Promise<Result<null>> {
  try {
    await opts.revalidate([TAGS.trip(opts.tripSlug), TAGS.entry(opts.tripSlug, entry.slug)]);
    return ok(null);
  } catch (cause) {
    const message = `revalidation hook failed: ${messageOf(cause)}`;
    return err({ kind: "network", url: entryUrl, message });
  }
}

/* -------------------------------------------------------------------- the run */

export async function saveEntry(opts: SaveEntryOptions): Promise<SaveEntryReport> {
  const stamp = (opts.now ?? nowIso)();
  const entryUrl = documentUrlOf(opts.entry.iri);
  const completed: SaveStep[] = [];
  const stamped = stampedEntry(opts, stamp);

  /** The report for a sequence that stopped, with whatever completed before it.
   *  `etag` is passed rather than captured: a step-1 failure has none, because
   *  nothing was written to have one. */
  const stoppedAt = (
    step: SaveStep, error: PodError, recovery: SaveRecovery, etag?: string | null,
  ): SaveEntryReport => ({ entryUrl, completed, failed: { step, error }, recovery, etag });

  /* -- step 1: the entry ---------------------------------------------------- */

  const put = await putEntry(opts, stamped, entryUrl);
  // Nothing reached the Pod, whether the serialiser refused or the PUT did, so
  // there is nothing to rebuild. 412 is the one status where the identical
  // request cannot succeed on a second attempt, and `recoveryForWrite` is what
  // tells it from the rest; a serialiser refusal is not an `http` error at all.
  if (!put.ok) return stoppedAt("entry", put.error, recoveryForWrite(put.error));
  completed.push("entry");
  const etag = put.value.etag;

  /* -- step 2: the ACL ------------------------------------------------------ */

  const access = await setEntryAccess(opts, stamped, entryUrl);
  /**
   * The entry IS on the Pod, so the report says so — §10's
   * "published-but-unreadable" — and the index is deliberately NOT written.
   * ./notes.md#why-the-index-is-not-written-when-the-acl-step-fails
   */
  if (!access.ok) return stoppedAt("access", access.error, "rebuildIndex", etag);
  completed.push("access");

  /* -- step 3: the index ---------------------------------------------------- */

  const index = await writeIndex(opts, stamped, stamp);
  // The entry exists and its access is right; only the index is behind.
  if (!index.ok) return stoppedAt("index", index.error, "rebuildIndex", etag);
  completed.push("index");

  /* -- step 4: revalidation ------------------------------------------------- */

  const revalidated = await runRevalidation(opts, stamped, entryUrl);
  // The Pod is consistent; only the public site's cache is stale, and that
  // heals on its own once the cache entry expires.
  if (!revalidated.ok) return stoppedAt("revalidate", revalidated.error, "retry", etag);
  completed.push("revalidate");

  return { entryUrl, completed, recovery: "none", etag };
}

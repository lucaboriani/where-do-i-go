/**
 * `saveTrip`: create/update a trip resource, ACL-at-creation (§5), every
 * write precondition-guarded (§10). STUDIO ONLY. Skips `ensurePodInitialised`
 * (./notes.md#savetrip-does-not-call-ensurepodinitialised); `reconcile` is the
 * convergent ACL step, routed around `rebuildIndex`.
 */
import { createContainer, makePublic, makePrivate, type AccessState } from "./access";
import { addTripToDiary, removeTripFromDiary } from "./diary";
import { documentUrlOf } from "./entry-model";
import { computeIndexFromRows, serialiseIndex } from "./index-model";
import { readTripIndex, tripIndexUrl, tripUrl } from "./read";
import { recoveryForWrite, type SaveRecovery } from "./save-entry";
import { serialiseTrip } from "./trip-model";
import { TAGS } from "./tags";
import { putGuarded, type Precondition } from "./write";
import { err, ok, type PodError, type Result } from "./result";
import type { PodFetch } from "./rdf";
import type { Status, Trip } from "./schema";

/* --------------------------------------------------------------------- types */

export type SaveTripStep = "container" | "trip" | "index" | "entriesContainer";

export type SaveTripReport = {
  tripUrl: string;
  /** Steps that completed, in order. */
  completed: SaveTripStep[];
  /** Absent on full success. */
  failed?: { step: SaveTripStep; error: PodError };
  recovery: SaveRecovery;
  etag?: string | null;
};

export type SaveTripOptions = {
  fetch: PodFetch;
  trip: Trip;
  podRoot: string;
  /** Absent means create; present means update, from the read that produced
   *  the edited state — never a blind PUT (§10). */
  etag?: string;
  webId?: string;
  now?: () => string;
  /** Step 4 on the edit path only (a create adds no diary row to invalidate).
   *  Optional so every caller predating Task 2.3 keeps compiling; absent means
   *  skip, exactly like `runRevalidation`'s hook in save-entry.ts. */
  revalidate?: (tags: string[]) => void | Promise<void>;
};

export type ReconcileOptions = {
  fetch: PodFetch;
  resource: string;
  status: Status;
  webId?: string;
};

/* ------------------------------------------------------------------- helpers */

/** xsd:dateTime always carries a UTC offset (§6), mirroring save-entry.ts. */
const nowIso = () => new Date().toISOString().replace("Z", "+00:00");

/**
 * §4 fixes these two segments. Mirrors `lib/studio/trips.ts`'s `container`/
 * `entriesContainer` derivation rather than importing it: `lib/studio` wraps
 * `lib/pod`, not the other way round, and neither segment is configurable.
 */
const tripContainerUrl = (podRoot: string, slug: string) =>
  new URL(`travel/trips/${encodeURIComponent(slug)}/`, podRoot).toString();
const entriesContainerUrl = (podRoot: string, slug: string) =>
  `${tripContainerUrl(podRoot, slug)}entries/`;

/**
 * `dcterms:created` carried forward on update and stamped on create;
 * `modified` always stamped — the same rule as `stampedEntry` in
 * save-entry.ts, for the same reason (§7.2).
 */
function stampedTrip(opts: SaveTripOptions, stamp: string, creating: boolean): Trip {
  return {
    ...opts.trip,
    created: opts.trip.created ?? (creating ? stamp : undefined),
    creator: opts.trip.creator ?? opts.webId,
    modified: stamp,
  };
}

/** Serialise, then PUT under the caller's precondition — a serialiser
 *  refusal (§11 guardrail 7's slug check) comes back before anything leaves
 *  the machine, exactly as `putEntry` does for entries. */
async function putTrip(
  fetch: PodFetch,
  trip: Trip,
  url: string,
  precondition: Precondition,
): Promise<Result<{ etag: string | null }>> {
  const body = await serialiseTrip(trip);
  if (!body.ok) return err(body.error);
  return putGuarded(fetch, url, body.value, precondition);
}

/** A HEAD ahead of the create branch's ACL write — see
 *  ./notes.md#a-create-pre-checks-the-trip-document-before-touching-the-container-acl.
 *  Mirrors `ensureContainer` in access.ts: any non-ok status reads as absent. */
async function tripAlreadyExists(fetch: PodFetch, url: string): Promise<Result<boolean>> {
  try {
    return ok((await fetch(url, { method: "HEAD" })).ok);
  } catch (cause) {
    return err({
      kind: "network",
      url,
      message: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/* -------------------------------------------------------------------- saveTrip */

export async function saveTrip(opts: SaveTripOptions): Promise<SaveTripReport> {
  const stamp = (opts.now ?? nowIso)();
  const url = tripUrl(opts.podRoot, opts.trip.slug);
  const creating = opts.etag === undefined;
  const stamped = stampedTrip(opts, stamp, creating);
  const completed: SaveTripStep[] = [];
  const accessOptions = { fetch: opts.fetch, webId: opts.webId };

  /** The report for a sequence that stopped, with whatever completed before
   *  it — mirrors `stoppedAt` in save-entry.ts. */
  const stoppedAt = (
    step: SaveTripStep,
    error: PodError,
    recovery: SaveRecovery,
    etag?: string | null,
  ): SaveTripReport => ({ tripUrl: url, completed, failed: { step, error }, recovery, etag });

  /* -- step "container": create-only, and BEFORE any document write --------- */

  if (creating) {
    // A collision's ACL side effect, not just its bytes: createContainer
    // rewrites an EXISTING container's access unconditionally (access.ts's
    // "existed" still runs setContainerAccess), so a slug already taken by a
    // trip of the other status must never reach it. If-None-Match: * on the
    // PUT below still catches the collision; this only guards the ACL call.
    const existing = await tripAlreadyExists(opts.fetch, url);
    if (!existing.ok) return stoppedAt("trip", existing.error, recoveryForWrite(existing.error));

    if (!existing.value) {
      const container = await createContainer(tripContainerUrl(opts.podRoot, stamped.slug), {
        ...accessOptions,
        publicChildren: stamped.status === "published",
      });
      if (!container.ok) return stoppedAt("container", container.error, "retry");
      completed.push("container");
    }
  }

  /* -- step "trip" ------------------------------------------------------------ */

  const precondition: Precondition = creating ? { create: true } : { etag: opts.etag as string };
  const put = await putTrip(opts.fetch, stamped, url, precondition);
  // A create's 412 IS "the slug is already taken" (surfaced by the caller
  // from the absence of an etag, not a distinct report field — see
  // save-trip.test.ts's own docblock); reused verbatim from save-entry.ts.
  if (!put.ok) return stoppedAt("trip", put.error, recoveryForWrite(put.error));
  completed.push("trip");
  const etag = put.value.etag;

  // An update stops here: entries.ttl and entries/ already exist, and
  // rewriting either on every edit is exactly the blind overwrite §10 bans.
  if (!creating) {
    if (opts.revalidate) {
      await runTripRevalidation({
        revalidate: opts.revalidate,
        kind: "edit",
        tripSlug: stamped.slug,
        tripUrl: url,
      });
    }
    return { tripUrl: url, completed, recovery: "none", etag };
  }

  /* -- step "index": an empty entries.ttl, create-only ------------------------ */

  const indexUrl = tripIndexUrl(opts.podRoot, stamped.slug);
  const indexBody = await serialiseIndex(indexUrl, stamped.iri, computeIndexFromRows([]), stamp);
  const indexPut = await putGuarded(opts.fetch, indexUrl, indexBody, { create: true });
  if (!indexPut.ok) {
    return stoppedAt("index", indexPut.error, recoveryForWrite(indexPut.error), etag);
  }
  completed.push("index");

  /* -- step "entriesContainer": closed listing, create-only -------------------- */

  const entries = await createContainer(entriesContainerUrl(opts.podRoot, stamped.slug), {
    ...accessOptions,
    publicChildren: true,
  });
  if (!entries.ok) return stoppedAt("entriesContainer", entries.error, "retry", etag);
  completed.push("entriesContainer");

  return { tripUrl: url, completed, recovery: "none", etag };
}

/* -------------------------------------------------------------------- reconcile */

/**
 * The convergent ACL step: force the resource's access to match `status`,
 * unconditionally — no read of the current ACL first, which is what
 * "convergent" means here and is exactly as idempotent as `makePublic`/
 * `makePrivate` already are.
 */
export async function reconcile(opts: ReconcileOptions): Promise<Result<AccessState>> {
  const accessOptions = { fetch: opts.fetch, webId: opts.webId };
  const publish = opts.status === "published";
  const result = publish
    ? await makePublic(opts.resource, accessOptions)
    : await makePrivate(opts.resource, accessOptions);
  if (!result.ok) return result;

  // `inherits` only means something for a container (access.ts's own
  // AccessState comment: "Containers only"). The call above already verified
  // the write, so this states the convergence target directly for the one
  // resource kind the field applies to.
  const inherits = opts.resource.endsWith("/") ? publish : result.value.inherits;
  return ok({ ...result.value, inherits });
}

/* ------------------------------------------------------ publish / unpublish */

export type PublishStep = "trip" | "acl" | "diary";

export type PublishTripReport = {
  tripUrl: string;
  completed: PublishStep[];
  failed?: { step: PublishStep; error: PodError };
  recovery: string;
  etag?: string | null;
};

export type PublishTripOptions = {
  fetch: PodFetch;
  trip: Trip;
  podRoot: string;
  /** Always required — publish/unpublish are updates to an existing trip.ttl,
   *  never a create (§10: never a blind PUT). */
  etag: string;
  webId?: string;
  now?: () => string;
  /** Step 4: the diary row just changed, so this fires on full success only —
   *  optional, and skipped when absent, exactly like `SaveTripOptions`. */
  revalidate?: (tags: string[]) => void | Promise<void>;
};

/**
 * A per-resource ACL OVERRIDES the container default (§20), so flipping the
 * container alone leaves each entry's own public-read ACL exactly as it was —
 * a bytes leak. Reads entries.ttl, never writes it: only the listed entries'
 * OWN ACLs are reconciled, so a later republish restores the same set.
 */
async function reconcileIndexedEntries(
  opts: PublishTripOptions,
  status: Status,
): Promise<Result<null>> {
  const index = await readTripIndex(tripIndexUrl(opts.podRoot, opts.trip.slug), { fetch: opts.fetch });
  if (!index.ok) return index;

  const accessOptions = { fetch: opts.fetch, webId: opts.webId };
  const setAccess = status === "published" ? makePublic : makePrivate;
  for (const row of index.value.entries) {
    const result = await setAccess(documentUrlOf(row.entryResource), accessOptions);
    if (!result.ok) return result;
  }
  return ok(null);
}

/**
 * §5's transaction: flip `dy:status`, reconcile the trip's CONTAINER ACL, and
 * add/remove the diary row — all three, in order. A step that fails reports
 * what already completed; a retry converges, since every step is idempotent.
 */
async function publishStatus(opts: PublishTripOptions, status: Status): Promise<PublishTripReport> {
  const stamp = (opts.now ?? nowIso)();
  const url = tripUrl(opts.podRoot, opts.trip.slug);
  const completed: PublishStep[] = [];
  const stamped: Trip = { ...opts.trip, status, modified: stamp };

  const stoppedAt = (
    step: PublishStep,
    error: PodError,
    recovery: string,
    etag?: string | null,
  ): PublishTripReport => ({ tripUrl: url, completed, failed: { step, error }, recovery, etag });

  const put = await putTrip(opts.fetch, stamped, url, { etag: opts.etag });
  if (!put.ok) return stoppedAt("trip", put.error, recoveryForWrite(put.error));
  completed.push("trip");
  const etag = put.value.etag;

  const acl = await reconcile({
    fetch: opts.fetch,
    resource: tripContainerUrl(opts.podRoot, stamped.slug),
    status,
    webId: opts.webId,
  });
  if (!acl.ok) return stoppedAt("acl", acl.error, recoveryForWrite(acl.error), etag);

  const entries = await reconcileIndexedEntries(opts, status);
  if (!entries.ok) return stoppedAt("acl", entries.error, recoveryForWrite(entries.error), etag);
  completed.push("acl");

  const diary =
    status === "published"
      ? await addTripToDiary({
          fetch: opts.fetch,
          podRoot: opts.podRoot,
          trip: { iri: stamped.iri, status },
        })
      : await removeTripFromDiary({ fetch: opts.fetch, podRoot: opts.podRoot, tripIri: stamped.iri });
  // The trip and its container ACL already changed — reported, not swallowed
  // into a bare failure (§10's partial-failure design, applied to trips).
  if (!diary.ok) return stoppedAt("diary", diary.error, "retry", etag);
  completed.push("diary");

  if (opts.revalidate) {
    await runTripRevalidation({
      revalidate: opts.revalidate,
      kind: status === "published" ? "publish" : "unpublish",
      tripSlug: stamped.slug,
      tripUrl: url,
    });
  }

  return { tripUrl: url, completed, recovery: "none", etag };
}

export const publishTrip = (opts: PublishTripOptions) => publishStatus(opts, "published");
export const unpublishTrip = (opts: PublishTripOptions) => publishStatus(opts, "draft");

/* ------------------------------------------------------------- revalidation */

export type TripRevalidationKind = "publish" | "unpublish" | "edit";

export type RunTripRevalidationOptions = {
  revalidate: (tags: string[]) => void | Promise<void>;
  kind: TripRevalidationKind;
  tripSlug: string;
  tripUrl: string;
};

/**
 * Step 4 for trips, mirroring `runRevalidation` in save-entry.ts: publish and
 * unpublish both change the diary's OWN list, so `TAGS.diary`; a plain edit
 * changes only this trip's own resource, so `TAGS.trip(slug)` alone — stamping
 * the diary on every edit would drop every trip's cache on every unrelated save.
 */
export async function runTripRevalidation(
  opts: RunTripRevalidationOptions,
): Promise<Result<null>> {
  const tags = opts.kind === "edit" ? [TAGS.trip(opts.tripSlug)] : [TAGS.diary];
  try {
    await opts.revalidate(tags);
    return ok(null);
  } catch (cause) {
    const message = `revalidation hook failed: ${cause instanceof Error ? cause.message : String(cause)}`;
    return err({ kind: "network", url: opts.tripUrl, message });
  }
}

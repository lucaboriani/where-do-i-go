import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { SCHEMA_VERSION } from "@/lib/vocab";
import { readTripIndex, tripIndexUrl, tripUrl } from "@/lib/pod/read";
import { server, servePod } from "@/test/msw";
import type { AccessState } from "@/lib/pod/access";
import type { SaveRecovery } from "@/lib/pod/save-entry";
import type { PodFetch } from "@/lib/pod/rdf";
import type { PodError, Result } from "@/lib/pod/result";
import type { Status, Trip } from "@/lib/pod/schema";

/**
 * Task 1.5 — `saveTrip`: create/update, ACL-AT-CREATION, and preconditions on
 * every write. `lib/pod/save-trip.ts` DOES NOT EXIST YET; this pins the RED
 * step.
 *
 * WHY `lib/pod/access.ts` IS MOCKED AS A MODULE, not driven through MSW: the
 * same reasoning as `save-entry.test.ts` and `bootstrap.test.ts` — a fake
 * convincing enough to drive the real ACL negotiation would encode
 * @inrupt/solid-client's request sequence, not this module's behaviour. What
 * this file asserts instead is the POLICY `saveTrip` asks for (container
 * public-read children matching `trip.status`), which is exactly what §5
 * pins: "publishing a trip is two operations — flip dy:status, and relax
 * that resource's ACL. Both must succeed, so treat it as one transaction."
 *
 * A SHARED `sequence` LOG spans BOTH the mocked access.ts calls and the real
 * HTTP requests recorded through MSW, because the one ordering fact this task
 * exists to pin — the container's ACL is created BEFORE `trip.ttl` is PUT —
 * crosses that boundary. Either alone would be unable to show it.
 *
 * INTERFACE ASSUMPTIONS THIS FILE PINS, for the implementer to honour (none of
 * this is written down verbatim in task-1-brief.md, which sketches
 * `saveTrip(opts)` and `reconcile(resource, status)` only in prose):
 *
 *   - `SaveTripOptions` = `{ fetch, trip, podRoot, etag?, webId?, now? }`.
 *     `etag` ABSENT means create (mirrors the brief's own wording); present
 *     means update. Unlike `saveEntry`'s `Precondition` union, there is no
 *     third state to guess at.
 *   - `SaveTripReport` mirrors `SaveEntryReport`'s shape (`completed` steps,
 *     `failed`, `recovery`, `etag`), and REUSES `SaveRecovery` from
 *     `save-entry.ts` verbatim — no new "slug taken" enum value. A create
 *     whose `trip.ttl` PUT 412s is reported exactly like a stale update (a
 *     `recovery: "refetch"`, same as `recoveryForWrite` in save-entry.ts); the
 *     two are told apart by whether the CALLER passed an `etag`, not by a
 *     distinct field. Reusing `recoveryForWrite` outright is the natural
 *     implementation and satisfies this without new code.
 *   - Steps are named `"container" | "trip" | "index" | "entriesContainer"`.
 *     An UPDATE never reaches "container": that step is create-only, so
 *     re-creating an already-published trip's container on every edit is not
 *     exercised or required.
 *   - `reconcile(opts: { fetch, resource, status, webId? })` is a single
 *     options object, matching this codebase's convention for multi-field
 *     calls (`saveEntry(opts)`) rather than the brief's shorthand
 *     `reconcile(resource, status)`. It CONVERGES unconditionally — calls
 *     `makePublic`/`makePrivate` from the passed-in `status` alone, without
 *     first reading the current ACL — which is what "convergent" means in
 *     the Task 1.5 commit message, and is exactly as idempotent as
 *     `makePublic`/`makePrivate` already are.
 */

/* -------------------------------------------------- mock: lib/pod/access.ts */

const { sequence, containerCalls, accessCalls, accessOutcome } = vi.hoisted(() => ({
  sequence: [] as string[],
  containerCalls: [] as { url: string; publicChildren?: boolean }[],
  accessCalls: [] as { op: string; url: string }[],
  accessOutcome: { containerFailure: null as { kind: string } | null },
}));

vi.mock("@/lib/pod/access", () => {
  const containerState = (url: string, publicChildren: boolean | undefined): AccessState => ({
    url,
    read: false,
    append: false,
    write: false,
    inherits: publicChildren ?? true,
    inheritsVerifiedBy: "rules",
    verifiedBy: "rules",
  });
  const docState = (url: string, read: boolean): AccessState => ({
    url,
    read,
    append: false,
    write: false,
    inherits: false,
    inheritsVerifiedBy: "notApplicable",
    verifiedBy: "rules",
  });

  return {
    createContainer: async (url: string, opts: { publicChildren?: boolean }) => {
      sequence.push(`container ${url}`);
      containerCalls.push({ url, publicChildren: opts?.publicChildren });
      if (accessOutcome.containerFailure) {
        return { ok: false as const, error: accessOutcome.containerFailure };
      }
      return { ok: true as const, value: containerState(url, opts?.publicChildren) };
    },
    makePublic: async (url: string) => {
      sequence.push(`makePublic ${url}`);
      accessCalls.push({ op: "makePublic", url });
      return { ok: true as const, value: docState(url, true) };
    },
    makePrivate: async (url: string) => {
      sequence.push(`makePrivate ${url}`);
      accessCalls.push({ op: "makePrivate", url });
      return { ok: true as const, value: docState(url, false) };
    },
  };
});

afterEach(() => {
  sequence.length = 0;
  containerCalls.length = 0;
  accessCalls.length = 0;
  accessOutcome.containerFailure = null;
});

/* ------------------------------------------------------------------ fixture */

const POD = "https://me.solidcommunity.net";
const POD_ROOT = `${POD}/`;
const SLUG = "2026-japan";
const TRIPS_CONTAINER = `${POD_ROOT}travel/trips/`;
const TRIP_CONTAINER = `${TRIPS_CONTAINER}${SLUG}/`;
const ENTRIES_CONTAINER = `${TRIP_CONTAINER}entries/`;
const TRIP_URL = tripUrl(POD_ROOT, SLUG);
const TRIP_INDEX_URL = tripIndexUrl(POD_ROOT, SLUG);
const WEBID = `${POD}/profile/card#me`;
const NOW = "2026-04-20T18:02:11+02:00";

/** Deliberately minimal: this file is about orchestration and preconditions,
 *  not RDF fidelity — `trip-model.test.ts` already pins `serialiseTrip`
 *  against the §7.2 fixture. The slug matches `TRIP_URL`'s container segment,
 *  or `serialiseTrip`'s own `assertSlug` refusal would fail every test here
 *  for an unrelated reason. */
const baseTrip = (status: Status = "published"): Trip => ({
  iri: `${TRIP_URL}#it`,
  slug: SLUG,
  status,
  schemaVersion: SCHEMA_VERSION,
  name: { value: "Japan, spring", language: "en" },
  tags: [],
});

/* ------------------------------------------------------------------ the fake Pod */

type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };
type PodScript = { failTripPut?: number };

function podFake(script: PodScript = {}) {
  const requests: Recorded[] = [];

  const record = async (request: Request): Promise<Recorded> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const entry = { method: request.method, url: request.url, headers, body: await request.text() };
    requests.push(entry);
    sequence.push(`${entry.method} ${entry.url}`);
    return entry;
  };

  server.use(
    http.put(TRIP_URL, async ({ request }) => {
      await record(request);
      return script.failTripPut
        ? new HttpResponse("conflict or precondition failed", { status: script.failTripPut })
        : new HttpResponse(null, { status: 205, headers: { etag: '"trip-v1"' } });
    }),
    http.put(TRIP_INDEX_URL, async ({ request }) => {
      await record(request);
      return new HttpResponse(null, { status: 205, headers: { etag: '"idx-1"' } });
    }),
  );

  return {
    requests,
    of: (method: string, url: string) => requests.filter((r) => r.method === method && r.url === url),
  };
}

function recordingFetch(calls: string[]): PodFetch {
  return (input, init) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return globalThis.fetch(input, init);
  };
}

/* ------------------------------------------------------------------ loaders */

type SaveTripStep = "container" | "trip" | "index" | "entriesContainer";
type SaveTripReport = {
  tripUrl: string;
  completed: SaveTripStep[];
  failed?: { step: SaveTripStep; error: PodError };
  recovery: SaveRecovery;
  etag?: string | null;
};
type SaveTripOptions = {
  fetch: PodFetch;
  trip: Trip;
  podRoot: string;
  /** Absent means create; present means update, from the read that produced
   *  the edited state — never a blind PUT (§10). */
  etag?: string;
  webId?: string;
  now?: () => string;
};

const loadSave = async () =>
  (await import("@/lib/pod/save-trip")).saveTrip as (opts: SaveTripOptions) => Promise<SaveTripReport>;

type ReconcileOptions = { fetch: PodFetch; resource: string; status: Status; webId?: string };
const loadReconcile = async () =>
  (await import("@/lib/pod/save-trip")).reconcile as (
    opts: ReconcileOptions,
  ) => Promise<Result<AccessState>>;

/* ============================================================== saveTrip */

describe("saveTrip — create, ACL-at-creation", () => {
  it("creates a draft with an owner-only container, trip.ttl, empty entries.ttl, and an entries/ container", async () => {
    const saveTrip = await loadSave();
    const pod = podFake();
    const calls: string[] = [];

    const report = await saveTrip({
      fetch: recordingFetch(calls),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed).toBeUndefined();
    expect(calls.length).toBeGreaterThan(0);

    // The trip's own container: owner-only, because the trip is a draft.
    // trip.ttl and entries.ttl carry no ACL of their own, so this container's
    // default is what makes — or does not make — them publicly reachable.
    const tripContainer = containerCalls.find((c) => c.url === TRIP_CONTAINER);
    expect(tripContainer?.publicChildren).toBe(false);

    // entries/ is created too. Its OWN listing being closed is access.ts's
    // guarantee (asserted in access.test.ts / the CSS integration suite,
    // where the ACL engine is real); what saveTrip must do is route its
    // creation through createContainer at all, which an implementation that
    // forgot the container entirely would fail here.
    expect(containerCalls.find((c) => c.url === ENTRIES_CONTAINER)).toBeDefined();

    const tripPut = pod.of("PUT", TRIP_URL)[0];
    expect(tripPut).toBeDefined();
    expect(tripPut.headers["if-none-match"]).toBe("*");
    expect(tripPut.headers["if-match"]).toBeUndefined();

    const indexPut = pod.of("PUT", TRIP_INDEX_URL)[0];
    expect(indexPut).toBeDefined();
    expect(indexPut.headers["if-none-match"]).toBe("*");

    // Empty, not absent: a trip with no entries yet still needs entries.ttl to
    // exist, or the first saveEntry's index read has nothing to condition on.
    servePod({ [TRIP_INDEX_URL]: indexPut.body });
    const index = await readTripIndex(TRIP_INDEX_URL);
    expect(index.ok).toBe(true);
    if (index.ok) expect(index.value.entries).toEqual([]);
  });

  it("creates a published trip with a public-read container", async () => {
    const saveTrip = await loadSave();
    podFake();

    const report = await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed).toBeUndefined();
    expect(containerCalls.find((c) => c.url === TRIP_CONTAINER)?.publicChildren).toBe(true);
  });

  it("sets the container's ACL BEFORE PUTting trip.ttl — ACL-at-creation, not after", async () => {
    const saveTrip = await loadSave();
    podFake();

    await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      webId: WEBID,
      now: () => NOW,
    });

    const containerIndex = sequence.indexOf(`container ${TRIP_CONTAINER}`);
    const tripPutIndex = sequence.indexOf(`PUT ${TRIP_URL}`);
    expect(containerIndex).toBeGreaterThanOrEqual(0);
    expect(tripPutIndex).toBeGreaterThan(containerIndex);
  });

  it("a create conflict on trip.ttl (the slug is already taken) is reported, not silently retried", async () => {
    const saveTrip = await loadSave();
    const pod = podFake({ failTripPut: 412 });

    const report = await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"), // no etag: this is a create
      podRoot: POD_ROOT,
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed?.step).toBe("trip");
    expect(report.failed?.error).toEqual({ kind: "http", url: TRIP_URL, status: 412 });
    // Reused from save-entry.ts's recoveryForWrite: 412 always means "refetch
    // and look at what is actually there" — for a create, that IS "someone
    // already has this slug", surfaced by the caller from the fact that no
    // etag was supplied, not by a distinct report field.
    expect(report.recovery).toBe("refetch");

    // The container was still created — ACL-at-creation happens regardless of
    // whether the document write that follows succeeds.
    expect(containerCalls.find((c) => c.url === TRIP_CONTAINER)).toBeDefined();
    // But nothing downstream of the conflicting write ran.
    expect(pod.of("PUT", TRIP_INDEX_URL)).toEqual([]);
  });
});

describe("saveTrip — update, never a blind PUT", () => {
  it("a stale etag is reported as a 412 with recovery: refetch, and writes nothing else", async () => {
    const saveTrip = await loadSave();
    const pod = podFake({ failTripPut: 412 });

    const report = await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      etag: '"stale"',
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed?.step).toBe("trip");
    expect(report.failed?.error).toEqual({ kind: "http", url: TRIP_URL, status: 412 });
    expect(report.recovery).toBe("refetch");

    // An update must not (re)create the trip's containers — they exist
    // already, and recreating them is exactly the kind of blind write §10
    // forbids.
    expect(containerCalls).toEqual([]);
    expect(pod.of("PUT", TRIP_INDEX_URL)).toEqual([]);
  });

  it("sends If-Match with the caller's etag, and no If-None-Match", async () => {
    const saveTrip = await loadSave();
    const pod = podFake();

    await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      etag: '"trip-v0"',
      webId: WEBID,
      now: () => NOW,
    });

    const put = pod.of("PUT", TRIP_URL)[0];
    expect(put).toBeDefined();
    expect(put.headers["if-match"]).toBe('"trip-v0"');
    expect(put.headers["if-none-match"]).toBeUndefined();
    // No container write on an update at all.
    expect(containerCalls).toEqual([]);
  });
});

/* ================================================================ reconcile */

describe("reconcile — convergent ACL, routed around rebuildIndex", () => {
  it("flips an owner-only container to public-read when status is published", async () => {
    const reconcile = await loadReconcile();

    const r = await reconcile({
      fetch: recordingFetch([]),
      resource: TRIP_CONTAINER,
      status: "published",
      webId: WEBID,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(accessCalls).toEqual([{ op: "makePublic", url: TRIP_CONTAINER }]);
    expect(r.value.inherits).toBe(true);
  });

  it("flips a public container to owner-only when status is draft, through makePrivate", async () => {
    const reconcile = await loadReconcile();

    await reconcile({ fetch: recordingFetch([]), resource: TRIP_CONTAINER, status: "draft", webId: WEBID });

    expect(accessCalls).toEqual([{ op: "makePrivate", url: TRIP_CONTAINER }]);
  });
});

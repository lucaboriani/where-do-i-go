import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { DY, DY_CLASS, RDF, SCHEMA_VERSION, XSD } from "@/lib/vocab";
import { computeIndexFromRows, serialiseIndex } from "@/lib/pod/index-model";
import { diaryUrl, readTrip, readTripIndex, tripIndexUrl, tripUrl } from "@/lib/pod/read";
import { TAGS } from "@/lib/pod/tags";
import { triples } from "@/test/graph";
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

/* --------------------------------------------------------- Task 2.2 fixture */

/** §7.1's diary root. A second, already-published trip lives here throughout
 *  the publish/unpublish tests below, so add/remove is provably TARGETED
 *  rather than a rebuild from nothing. */
const DIARY_URL = diaryUrl(POD_ROOT);
const OTHER_TRIP_IRI = `${POD_ROOT}travel/trips/2025-patagonia/trip.ttl#it`;

/** Fix round 1 (finding C1): entry documents this trip's entries.ttl lists,
 *  for the ACL-reconciliation tests below. */
const ENTRY_ONE_URL = `${ENTRIES_CONTAINER}2026-03-29-arrival.ttl`;
const ENTRY_TWO_URL = `${ENTRIES_CONTAINER}2026-03-31-nara.ttl`;

/** entries.ttl for a given row set, through the real (pure) serialiser rather
 *  than hand-written Turtle — so a shape drift in the index model fails here
 *  too, not just in index-model.test.ts. */
const indexTtl = (rows: { entryResource: string; slug: string }[]) =>
  serialiseIndex(
    TRIP_INDEX_URL,
    `${TRIP_URL}#it`,
    computeIndexFromRows(rows.map((r) => ({ ...r, title: { value: r.slug, language: "en" } }))),
    NOW,
  );

/** Full IRIs throughout — no `@prefix` block needed, and nothing here is a
 *  blank node. Mirrors lib/studio/diary.test.ts's fixture of the same shape. */
const diaryTtl = (tripIris: string[]) => `
<#it>
    <${RDF.type}> <${DY_CLASS.Diary}> ;
    <${DY.schemaVersion}> "${SCHEMA_VERSION}"^^<${XSD.integer}> ;
    ${tripIris.map((iri) => `<${DY.trip}> <${iri}>`).join(" ;\n    ")} .
`;

/** Before/after triple diff — graph isomorphism, never bytes (§11 guardrail 6). */
function diaryDiff(beforeTtl: string, afterTtl: string) {
  const before = triples(beforeTtl, DIARY_URL);
  const after = triples(afterTtl, DIARY_URL);
  return {
    added: [...after].filter((t) => !before.has(t)),
    removed: [...before].filter((t) => !after.has(t)),
  };
}

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
/** `existingTrip` scripts the pre-check's HEAD: a create against a slug that
 *  already has a trip there (fix round 1 — task-1b-report.md). Absent/false
 *  is every existing test's world: nothing at that slug yet. */

/** Task 2.2 additions: `diaryTrips` seeds diary.ttl's rows for the
 *  publish/unpublish tests; `failDiaryPutOnce` fails only the FIRST PUT to
 *  diary.ttl, so a retry test can script "fails, then converges". */
type PodScript = {
  failTripPut?: number;
  existingTrip?: boolean;
  diaryTrips?: string[];
  diaryEtag?: string;
  failDiaryPutOnce?: number;
  /** Fix round 1 (finding C1): entries.ttl's rows, for the per-entry ACL
   *  reconciliation tests. Defaults to none, so every test predating this fix
   *  reads an empty index and reconciles nothing extra. */
  entries?: { entryResource: string; slug: string }[];
};

function podFake(script: PodScript = {}) {
  const requests: Recorded[] = [];
  const diaryTrips = script.diaryTrips ?? [OTHER_TRIP_IRI];
  const diaryEtag = script.diaryEtag ?? '"diary-v1"';
  const entries = script.entries ?? [];
  let diaryPutCalls = 0;

  const record = async (request: Request): Promise<Recorded> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const entry = { method: request.method, url: request.url, headers, body: await request.text() };
    requests.push(entry);
    sequence.push(`${entry.method} ${entry.url}`);
    return entry;
  };

  server.use(
    http.head(TRIP_URL, async ({ request }) => {
      await record(request);
      return script.existingTrip
        ? new HttpResponse(null, { status: 200, headers: { etag: '"existing"' } })
        : new HttpResponse(null, { status: 404 });
    }),
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
    http.get(TRIP_INDEX_URL, async ({ request }) => {
      await record(request);
      return HttpResponse.text(await indexTtl(entries), {
        headers: { "content-type": "text/turtle", etag: '"idx-1"' },
      });
    }),
    http.get(DIARY_URL, async ({ request }) => {
      await record(request);
      return HttpResponse.text(diaryTtl(diaryTrips), {
        headers: { "content-type": "text/turtle", etag: diaryEtag },
      });
    }),
    http.put(DIARY_URL, async ({ request }) => {
      await record(request);
      diaryPutCalls += 1;
      if (script.failDiaryPutOnce && diaryPutCalls === 1) {
        return new HttpResponse("conflict or precondition failed", {
          status: script.failDiaryPutOnce,
        });
      }
      return new HttpResponse(null, { status: 205, headers: { etag: '"diary-v2"' } });
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
  revalidate?: (tags: string[]) => void | Promise<void>;
};

const loadSave = async () =>
  (await import("@/lib/pod/save-trip")).saveTrip as (opts: SaveTripOptions) => Promise<SaveTripReport>;

type ReconcileOptions = { fetch: PodFetch; resource: string; status: Status; webId?: string };
const loadReconcile = async () =>
  (await import("@/lib/pod/save-trip")).reconcile as (
    opts: ReconcileOptions,
  ) => Promise<Result<AccessState>>;

/* --------------------------------------------------- Task 2.2 loaders/types */

/**
 * `publishTrip`/`unpublishTrip` DO NOT EXIST YET — Task 2.2's red step.
 * task-2-brief.md sketches the three effects in prose, not a shape; the
 * types below are what this file pins the implementer to instead.
 */

/** Three steps, named `"trip" | "acl" | "diary"`, run in that order: PUT
 *  trip.ttl with dy:status flipped (If-Match); the trip's CONTAINER (not the
 *  document — §5's default is what governs trip.ttl/entries.ttl) through
 *  `reconcile`; the diary row added or removed. */
type PublishStep = "trip" | "acl" | "diary";

/** Mirrors `SaveTripReport`'s shape. `recovery` is typed as a bare `string`
 *  rather than one literal: the only behaviour pinned here is that a PARTIAL
 *  success reports something other than `"none"` — the exact vocabulary
 *  (reusing `"retry"`, or a new `"reconcile"`) is the implementer's call. */
type PublishTripReport = {
  tripUrl: string;
  completed: PublishStep[];
  failed?: { step: PublishStep; error: PodError };
  recovery: string;
  etag?: string | null;
};

/** One options object, `{ fetch, trip, podRoot, etag, webId?, now? }`.
 *  `etag` is REQUIRED, unlike `saveTrip`'s optional one — publish/unpublish
 *  are always updates to an existing trip.ttl, never a create. */
type PublishTripOptions = {
  fetch: PodFetch;
  trip: Trip;
  podRoot: string;
  /** From the read that produced the edited state — never a blind PUT (§10).
   *  Always required: publish/unpublish never create a trip. */
  etag: string;
  webId?: string;
  now?: () => string;
  revalidate?: (tags: string[]) => void | Promise<void>;
};

const loadPublish = async () =>
  (await import("@/lib/pod/save-trip")).publishTrip as (
    opts: PublishTripOptions,
  ) => Promise<PublishTripReport>;
const loadUnpublish = async () =>
  (await import("@/lib/pod/save-trip")).unpublishTrip as (
    opts: PublishTripOptions,
  ) => Promise<PublishTripReport>;

/* ------------------------------------------------------- Task 2.3 loader */

/** `runTripRevalidation` DOES NOT EXIST YET — Task 2.3's red step. Pinned as
 *  ONE options object (this codebase's `saveEntry(opts)` convention),
 *  mirroring `runRevalidation(opts, entry, entryUrl)`: `kind` is the one input
 *  `publishStatus` has (publish/unpublish/edit); `tripUrl` only feeds the
 *  network-error's `url` field, unasserted on the happy path. */
type TripRevalidationKind = "publish" | "unpublish" | "edit";
type RunTripRevalidationOptions = {
  revalidate: (tags: string[]) => void | Promise<void>;
  kind: TripRevalidationKind;
  tripSlug: string;
  tripUrl: string;
};

const loadRunTripRevalidation = async () =>
  (await import("@/lib/pod/save-trip")).runTripRevalidation as (
    opts: RunTripRevalidationOptions,
  ) => Promise<Result<null>>;

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

  it("a create colliding with an existing trip of the OTHER status never touches the container ACL", async () => {
    const saveTrip = await loadSave();
    // The slug already belongs to a trip — an existing DRAFT, say — so a
    // colliding "published" create must not flip its container to public-read
    // on the way to discovering the collision. Scripted exactly like a real
    // Pod's own If-None-Match: * 412 on the trip.ttl PUT (failTripPut), which
    // stays the authoritative signal; existingTrip only removes the ACL call
    // that used to run unconditionally before it (fix round 1).
    const pod = podFake({ existingTrip: true, failTripPut: 412 });

    const report = await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"), // no etag: this is a create
      podRoot: POD_ROOT,
      webId: WEBID,
      now: () => NOW,
    });

    // createContainer never ran, so the pre-existing (draft) trip's ACL was
    // never rewritten to public-read — the defect this test pins.
    expect(containerCalls).toEqual([]);

    expect(pod.of("HEAD", TRIP_URL).length).toBeGreaterThan(0);
    expect(report.failed?.step).toBe("trip");
    expect(report.failed?.error).toEqual({ kind: "http", url: TRIP_URL, status: 412 });
    expect(report.recovery).toBe("refetch");
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

/* ======================================================= Task 2.2: publish */

describe("publishTrip — status, container ACL, and the diary row are one transaction", () => {
  it("flips dy:status to Published, makes the container public-read, AND adds the diary row", async () => {
    const publishTrip = await loadPublish();
    const pod = podFake({ diaryTrips: [OTHER_TRIP_IRI] });

    const report = await publishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      etag: '"trip-v3"',
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed).toBeUndefined();
    expect(report.completed).toEqual(["trip", "acl", "diary"]);

    /* 1. the status flip, over If-Match — never a blind PUT (§10). */
    const tripPut = pod.of("PUT", TRIP_URL)[0];
    expect(tripPut).toBeDefined();
    expect(tripPut.headers["if-match"]).toBe('"trip-v3"');
    servePod({ [TRIP_URL]: tripPut.body });
    const backTrip = await readTrip(TRIP_URL);
    expect(backTrip.ok).toBe(true);
    if (backTrip.ok) expect(backTrip.value.status).toBe("published");

    /* 2. the CONTAINER's ACL — §5: the container default is what actually
       governs trip.ttl/entries.ttl, so this is the resource that must flip,
       not the document. Through lib/pod/access.ts and nowhere else. */
    expect(accessCalls).toEqual(
      expect.arrayContaining([{ op: "makePublic", url: TRIP_CONTAINER }]),
    );

    /* 3. the diary row. */
    const diaryPut = pod.of("PUT", DIARY_URL)[0];
    expect(diaryPut).toBeDefined();
    expect(diaryPut.headers["if-match"]).toBe('"diary-v1"');
    const diff = diaryDiff(diaryTtl([OTHER_TRIP_IRI]), diaryPut.body);
    expect(diff.removed).toEqual([]);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0]).toContain(DY.trip);
    expect(diff.added[0]).toContain(`${TRIP_URL}#it`);
  });
});

/* ===================================================== Task 2.2: unpublish */

describe("unpublishTrip — status, container ACL, and the diary row, THE CRITICAL CASE", () => {
  it("flips dy:status to Draft, makes the container owner-only, AND removes the diary row", async () => {
    /** Finding #2: a status change not paired with the container-ACL
     *  reconcile leaves bytes public after the owner believes the trip is
     *  private again — this fails if EITHER the ACL flip or the diary
     *  removal is missing. */
    const unpublishTrip = await loadUnpublish();
    const pod = podFake({ diaryTrips: [`${TRIP_URL}#it`, OTHER_TRIP_IRI] });

    const report = await unpublishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      etag: '"trip-v4"',
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed).toBeUndefined();
    expect(report.completed).toEqual(["trip", "acl", "diary"]);

    /* 1. the status flip. */
    const tripPut = pod.of("PUT", TRIP_URL)[0];
    expect(tripPut).toBeDefined();
    expect(tripPut.headers["if-match"]).toBe('"trip-v4"');
    servePod({ [TRIP_URL]: tripPut.body });
    const backTrip = await readTrip(TRIP_URL);
    expect(backTrip.ok).toBe(true);
    if (backTrip.ok) expect(backTrip.value.status).toBe("draft");

    /* 2. THE CONTAINER ACL — the assertion this whole test exists for. */
    expect(accessCalls).toEqual(
      expect.arrayContaining([{ op: "makePrivate", url: TRIP_CONTAINER }]),
    );

    /* 3. the diary row, removed — and the OTHER trip's row is untouched. */
    const diaryPut = pod.of("PUT", DIARY_URL)[0];
    expect(diaryPut).toBeDefined();
    const diff = diaryDiff(diaryTtl([`${TRIP_URL}#it`, OTHER_TRIP_IRI]), diaryPut.body);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0]).toContain(DY.trip);
    expect(diff.removed[0]).toContain(`${TRIP_URL}#it`);
    expect(diaryPut.body).toContain(OTHER_TRIP_IRI);
  });
});

/* ============================================ Task 2.2: partial-failure mode */

describe("publishTrip — the partial-failure mode §10 designs for, applied to trips", () => {
  it("a diary write that fails AFTER the ACL flip reports the partial state, and a retry converges", async () => {
    const publishTrip = await loadPublish();
    const pod = podFake({ diaryTrips: [OTHER_TRIP_IRI], failDiaryPutOnce: 412 });

    const first = await publishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      etag: '"trip-v3"',
      webId: WEBID,
      now: () => NOW,
    });

    // The trip and its container ACL are BOTH already changed — this is not
    // "nothing happened", and the report must say so rather than collapsing
    // into a bare failure.
    expect(first.completed).toEqual(["trip", "acl"]);
    expect(first.failed?.step).toBe("diary");
    expect(first.failed?.error).toEqual({ kind: "http", url: DIARY_URL, status: 412 });
    // Some repair is owed — the one property this file pins on the recovery
    // value; see the interface note above loadPublish for why the literal
    // itself is left to the implementer.
    expect(first.recovery).not.toBe("none");
    expect(pod.of("PUT", DIARY_URL)).toHaveLength(1);

    // A retry: the trip is already published and its container already public
    // (both idempotent to repeat), and this time the diary write goes
    // through — the whole operation converges to "trip.ttl says Published,
    // the container is public, and the diary lists it".
    const retry = await publishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      etag: first.etag ?? '"trip-v3"',
      webId: WEBID,
      now: () => NOW,
    });

    expect(retry.failed).toBeUndefined();
    expect(retry.completed).toEqual(["trip", "acl", "diary"]);
    expect(pod.of("PUT", DIARY_URL)).toHaveLength(2);
  });
});

/* ==================================== Fix round 1 (finding C1): §20's ACL */

/**
 * A per-resource ACL OVERRIDES the container default (decision 20), so
 * flipping the trip's CONTAINER alone leaves each entry's OWN public-read ACL
 * intact — a bytes leak the strict/guarded requirement forbids. entries.ttl
 * itself is never rewritten; only the listed entries' ACLs are reconciled.
 */
describe("unpublishTrip — also reconciles each indexed entry's own ACL (§20)", () => {
  it("calls makePrivate for every entry entries.ttl lists, not just the container", async () => {
    const unpublishTrip = await loadUnpublish();
    const pod = podFake({
      diaryTrips: [`${TRIP_URL}#it`, OTHER_TRIP_IRI],
      entries: [
        { entryResource: `${ENTRY_ONE_URL}#it`, slug: "2026-03-29-arrival" },
        { entryResource: `${ENTRY_TWO_URL}#it`, slug: "2026-03-31-nara" },
      ],
    });

    const report = await unpublishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      etag: '"trip-v4"',
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed).toBeUndefined();
    expect(accessCalls).toEqual(
      expect.arrayContaining([
        { op: "makePrivate", url: TRIP_CONTAINER },
        { op: "makePrivate", url: ENTRY_ONE_URL },
        { op: "makePrivate", url: ENTRY_TWO_URL },
      ]),
    );

    // entries.ttl itself is untouched — only the ACLs move, so a republish
    // finds the same rows and can restore the same set.
    expect(pod.of("PUT", TRIP_INDEX_URL)).toEqual([]);
  });
});

describe("publishTrip — also restores each indexed entry's own ACL (§20)", () => {
  it("calls makePublic for the entry entries.ttl already lists, restoring it", async () => {
    const publishTrip = await loadPublish();
    podFake({
      diaryTrips: [OTHER_TRIP_IRI],
      entries: [{ entryResource: `${ENTRY_ONE_URL}#it`, slug: "2026-03-29-arrival" }],
    });

    const report = await publishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      etag: '"trip-v3"',
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed).toBeUndefined();
    expect(accessCalls).toEqual(
      expect.arrayContaining([
        { op: "makePublic", url: TRIP_CONTAINER },
        { op: "makePublic", url: ENTRY_ONE_URL },
      ]),
    );
  });
});

/* ============================================ Task 2.3: trip revalidation */

/** The home page, sitemap and RSS read `diary.ttl` (§7.1), so publish/unpublish
 *  — which add/remove a trip's diary ROW — must invalidate `TAGS.diary`, not
 *  `TAGS.trip(slug)`. A plain EDIT changes no row, so it only needs to drop
 *  the trip's OWN entry, `TAGS.trip(slug)`. `revalidatePublicSite` is
 *  tag-agnostic, so this layer DECIDES the tags (mirrors `runRevalidation`). */
describe("runTripRevalidation — the tags a publish/unpublish/edit stamps (Task 2.3)", () => {
  it("stamps TAGS.diary on publish — the diary's list changed", async () => {
    const runTripRevalidation = await loadRunTripRevalidation();
    const tags: string[][] = [];

    const result = await runTripRevalidation({
      revalidate: (t) => void tags.push(t),
      kind: "publish",
      tripSlug: SLUG,
      tripUrl: TRIP_URL,
    });

    expect(result.ok).toBe(true);
    expect(tags).toEqual([[TAGS.diary]]);
  });

  it("stamps TAGS.diary on unpublish too — the diary's list changed the other way", async () => {
    const runTripRevalidation = await loadRunTripRevalidation();
    const tags: string[][] = [];

    const result = await runTripRevalidation({
      revalidate: (t) => void tags.push(t),
      kind: "unpublish",
      tripSlug: SLUG,
      tripUrl: TRIP_URL,
    });

    expect(result.ok).toBe(true);
    expect(tags).toEqual([[TAGS.diary]]);
  });

  it("stamps TAGS.trip(slug) on an edit, and NOT TAGS.diary — the diary's list did not change", async () => {
    const runTripRevalidation = await loadRunTripRevalidation();
    const tags: string[][] = [];

    const result = await runTripRevalidation({
      revalidate: (t) => void tags.push(t),
      kind: "edit",
      tripSlug: SLUG,
      tripUrl: TRIP_URL,
    });

    expect(result.ok).toBe(true);
    expect(tags).toEqual([[TAGS.trip(SLUG)]]);
    // The negative half: an edit stamping the diary too would drop every
    // trip's cache on every save of any one of them — the imprecision
    // TAGS.trip(slug) exists to avoid.
    expect(tags.flat()).not.toContain(TAGS.diary);
  });

  it("reports a throwing hook as a network error, mirroring save-entry's runRevalidation", async () => {
    const runTripRevalidation = await loadRunTripRevalidation();

    const bad = await runTripRevalidation({
      revalidate: () => {
        throw new Error("route handler said no");
      },
      kind: "publish",
      tripSlug: SLUG,
      tripUrl: TRIP_URL,
    });

    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("network");
  });
});

/* ============================== Task 2.3: wired into the actual call sites */

/** `runTripRevalidation` existing is not enough — a caller that forgets to
 *  invoke it would leave the tests above green forever. These assert
 *  `publishTrip`/`unpublishTrip`/`saveTrip`'s edit path actually call the
 *  injected hook, with the right tags, and that a create calls it not at all. */
describe("publishTrip/unpublishTrip — the revalidate hook, wired (Task 2.3)", () => {
  it("publishTrip stamps TAGS.diary through the injected hook on success", async () => {
    const publishTrip = await loadPublish();
    podFake({ diaryTrips: [OTHER_TRIP_IRI] });
    const tags: string[][] = [];

    const report = await publishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      etag: '"trip-v3"',
      webId: WEBID,
      now: () => NOW,
      revalidate: (t) => void tags.push(t),
    });

    expect(report.failed).toBeUndefined();
    expect(tags).toEqual([[TAGS.diary]]);
    expect(report.completed).toEqual(["trip", "acl", "diary", "revalidate"]);
  });

  it("unpublishTrip stamps TAGS.diary through the injected hook on success", async () => {
    const unpublishTrip = await loadUnpublish();
    podFake({ diaryTrips: [`${TRIP_URL}#it`, OTHER_TRIP_IRI] });
    const tags: string[][] = [];

    const report = await unpublishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      etag: '"trip-v4"',
      webId: WEBID,
      now: () => NOW,
      revalidate: (t) => void tags.push(t),
    });

    expect(report.failed).toBeUndefined();
    expect(tags).toEqual([[TAGS.diary]]);
    expect(report.completed).toEqual(["trip", "acl", "diary", "revalidate"]);
  });

  it("D1 fix: a THROWING revalidate hook on publishTrip is surfaced, not swallowed", async () => {
    // The Pod writes (trip/acl/diary) already happened — this must read as a
    // partial success, exactly like save-entry.ts's own "revalidate" step,
    // never as `report.failed` undefined with the cache silently stale.
    const publishTrip = await loadPublish();
    podFake({ diaryTrips: [OTHER_TRIP_IRI] });

    const report = await publishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      etag: '"trip-v3"',
      webId: WEBID,
      now: () => NOW,
      revalidate: () => {
        throw new Error("route handler said no");
      },
    });

    expect(report.completed).toEqual(["trip", "acl", "diary"]);
    expect(report.failed?.step).toBe("revalidate");
    expect(report.failed?.error.kind).toBe("network");
    expect(report.recovery).toBe("retry");
  });

  it("publishTrip with no revalidate hook still succeeds — the field is optional", async () => {
    const publishTrip = await loadPublish();
    podFake({ diaryTrips: [OTHER_TRIP_IRI] });

    const report = await publishTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      etag: '"trip-v3"',
      webId: WEBID,
      now: () => NOW,
    });

    expect(report.failed).toBeUndefined();
  });
});

describe("saveTrip — the revalidate hook on the edit (update) path (Task 2.3)", () => {
  it("an update stamps TAGS.trip(slug), not TAGS.diary — no diary row changed", async () => {
    const saveTrip = await loadSave();
    podFake();
    const tags: string[][] = [];

    const report = await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("published"),
      podRoot: POD_ROOT,
      etag: '"trip-v0"',
      webId: WEBID,
      now: () => NOW,
      revalidate: (t) => void tags.push(t),
    });

    expect(report.failed).toBeUndefined();
    expect(tags).toEqual([[TAGS.trip(SLUG)]]);
    expect(report.completed).toEqual(["trip", "revalidate"]);
  });

  it("a create — even of a draft — calls the hook zero times", async () => {
    const saveTrip = await loadSave();
    podFake();
    const tags: string[][] = [];

    const report = await saveTrip({
      fetch: recordingFetch([]),
      trip: baseTrip("draft"),
      podRoot: POD_ROOT,
      webId: WEBID,
      now: () => NOW,
      revalidate: (t) => void tags.push(t),
    });

    expect(report.failed).toBeUndefined();
    expect(tags).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { DY, DY_CLASS, RDF, SCHEMA_VERSION, XSD } from "@/lib/vocab";
import { diaryUrl, readDiary } from "@/lib/pod/read";
import { triples } from "@/test/graph";
import { server, servePod } from "@/test/msw";
import type { PodFetch } from "@/lib/pod/rdf";
import type { Result } from "@/lib/pod/result";
import type { Diary, Status } from "@/lib/pod/schema";

/**
 * Task 2.1 — `lib/pod/diary.ts`: `readDiaryWithEtag`, `addTripToDiary`,
 * `removeTripFromDiary`. In `lib/pod`, not `lib/studio` (index writes already
 * live there), loaded through dynamic `import()` so a missing export fails
 * each test on its own terms — the same shape `save-entry.test.ts` uses.
 */

/** §7.1: a diary entry is a BARE `dy:trip <…/trip.ttl#it>` triple on `<#it>` —
 *  `readDiary` reads it via `v.all(DY.trip)`. No denormalised row, so
 *  add/remove touch exactly that one triple and nothing else in the graph. */

/** `readDiaryWithEtag(podRoot, opts?: { fetch?: PodFetch })` →
 *  `Result<{ diary: Diary; etag: string | null }>`, mirroring
 *  `readTripIndexWithEtag` in lib/pod/read.ts. `addTripToDiary({ fetch,
 *  podRoot, trip: { iri, status } })` → `Result<null>`, PUBLISHED-ONLY: a
 *  draft is a no-op that touches the Pod not at all. */

/** `removeTripFromDiary({ fetch, podRoot, tripIri })` → `Result<null>`,
 *  unconditional. Both writers read-modify-write `diary.ttl`: GET for the
 *  body and ETag, then PUT under `If-Match` — never a blind PUT (§10),
 *  mirroring `writeIndex` in lib/pod/save-entry.ts. */

const POD = "https://me.solidcommunity.net";
const POD_ROOT = `${POD}/`;
const DIARY_URL = diaryUrl(POD_ROOT);
const PUBLISHED_TRIP_IRI = `${POD_ROOT}travel/trips/2026-japan/trip.ttl#it`;
const OTHER_TRIP_IRI = `${POD_ROOT}travel/trips/2025-patagonia/trip.ttl#it`;
const DRAFT_TRIP_IRI = `${POD_ROOT}travel/trips/2026-unfinished/trip.ttl#it`;

/** A minimal, valid `dy:Diary` with the given trip rows — full IRIs throughout
 *  so no `@prefix` block is needed and nothing here is a blank node. */
const diaryTtl = (tripIris: string[]) => `
<#it>
    <${RDF.type}> <${DY_CLASS.Diary}> ;
    <${DY.schemaVersion}> "${SCHEMA_VERSION}"^^<${XSD.integer}> ;
    ${tripIris.map((iri) => `<${DY.trip}> <${iri}>`).join(" ;\n    ")} .
`;

/* ------------------------------------------------------------------ the fake Pod */

type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };
type PodScript = { trips?: string[]; etag?: string; failPut?: number };

function podFake(script: PodScript = {}) {
  const requests: Recorded[] = [];
  const trips = script.trips ?? [OTHER_TRIP_IRI];
  const etag = script.etag ?? '"diary-v1"';

  const record = async (request: Request): Promise<Recorded> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const entry = { method: request.method, url: request.url, headers, body: await request.text() };
    requests.push(entry);
    return entry;
  };

  server.use(
    http.get(DIARY_URL, async ({ request }) => {
      await record(request);
      return HttpResponse.text(diaryTtl(trips), {
        headers: { "content-type": "text/turtle", etag },
      });
    }),
    http.put(DIARY_URL, async ({ request }) => {
      await record(request);
      return script.failPut
        ? new HttpResponse("conflict or precondition failed", { status: script.failPut })
        : new HttpResponse(null, { status: 205, headers: { etag: '"diary-v2"' } });
    }),
  );

  return {
    requests,
    of: (method: string, url: string) =>
      requests.filter((r) => r.method === method && r.url === url),
  };
}

/** Records what the implementation actually called, then delegates to the real
 *  (MSW-patched) fetch — same shape as save-entry.test.ts's recordingFetch. */
function recordingFetch(calls: string[]): PodFetch {
  return (input, init) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return globalThis.fetch(input, init);
  };
}

/** A before/after triple diff, using the graph-isomorphism helper rather than
 *  a byte comparison (§11 guardrail 6). Also the negative-test guard CLAUDE.md
 *  asks for: if the implementation never touches the graph, `added` and
 *  `removed` are both empty and every assertion on them fails loudly, rather
 *  than a string-replace fixture that silently no-ops. */
function diff(beforeTtl: string, afterTtl: string) {
  const before = triples(beforeTtl, DIARY_URL);
  const after = triples(afterTtl, DIARY_URL);
  return {
    added: [...after].filter((t) => !before.has(t)),
    removed: [...before].filter((t) => !after.has(t)),
  };
}

/** Loaded dynamically — see the module docblock above. */
const loadDiary = () => import("@/lib/pod/diary");

const loadReadDiaryWithEtag = async () =>
  (await loadDiary()).readDiaryWithEtag as (
    podRoot: string,
    opts?: { fetch?: PodFetch },
  ) => Promise<Result<{ diary: Diary; etag: string | null }>>;

/* =============================================================== the tests */

describe("readDiaryWithEtag", () => {
  it("reads the diary and its ETag, through the caller's own fetch", async () => {
    const readDiaryWithEtag = await loadReadDiaryWithEtag();
    podFake({ trips: [PUBLISHED_TRIP_IRI, OTHER_TRIP_IRI], etag: '"diary-v7"' });
    const calls: string[] = [];

    const r = await readDiaryWithEtag(POD_ROOT, { fetch: recordingFetch(calls) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.diary.trips).toEqual(
      expect.arrayContaining([PUBLISHED_TRIP_IRI, OTHER_TRIP_IRI]),
    );
    expect(r.value.etag).toBe('"diary-v7"');
    // The caller's fetch is the only fetch (invariant 4) — an implementation
    // reaching for the ambient one leaves this empty.
    expect(calls).toContain(DIARY_URL);
  });
});

describe("addTripToDiary — published-only maintenance", () => {
  it("adds a published trip's bare dy:trip triple via a read-modify-write carrying If-Match", async () => {
    const { addTripToDiary } = await loadDiary();
    const pod = podFake({ trips: [OTHER_TRIP_IRI], etag: '"diary-v3"' });

    const r = await addTripToDiary({
      fetch: recordingFetch([]),
      podRoot: POD_ROOT,
      trip: { iri: PUBLISHED_TRIP_IRI, status: "published" as Status },
    });

    expect(r.ok).toBe(true);
    const put = pod.of("PUT", DIARY_URL)[0];
    expect(put).toBeDefined();
    // Never a blind PUT (§10): the etag from THIS read-modify-write's own GET.
    expect(put.headers["if-match"]).toBe('"diary-v3"');

    const d = diff(diaryTtl([OTHER_TRIP_IRI]), put.body);
    expect(d.removed).toEqual([]);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]).toContain(DY.trip);
    expect(d.added[0]).toContain(PUBLISHED_TRIP_IRI);
  });

  it("adding a published trip row then reading diary.ttl yields the trip", async () => {
    const { addTripToDiary } = await loadDiary();
    const pod = podFake({ trips: [OTHER_TRIP_IRI] });

    const added = await addTripToDiary({
      fetch: recordingFetch([]),
      podRoot: POD_ROOT,
      trip: { iri: PUBLISHED_TRIP_IRI, status: "published" as Status },
    });
    expect(added.ok).toBe(true);

    const put = pod.of("PUT", DIARY_URL)[0];
    expect(put).toBeDefined();
    servePod({ [DIARY_URL]: put.body });
    const read = await readDiary(DIARY_URL);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.trips).toEqual(expect.arrayContaining([PUBLISHED_TRIP_IRI, OTHER_TRIP_IRI]));
  });

  it("is a no-op for a draft trip — the Pod is not touched at all", async () => {
    // §5/§7.1: only published trips may appear in diary.ttl. A draft that
    // reached the Pod even transiently, then got removed on a later publish,
    // would still have been visible to a reader racing the two writes.
    const { addTripToDiary } = await loadDiary();
    const pod = podFake({ trips: [OTHER_TRIP_IRI] });

    const r = await addTripToDiary({
      fetch: recordingFetch([]),
      podRoot: POD_ROOT,
      trip: { iri: DRAFT_TRIP_IRI, status: "draft" as Status },
    });

    expect(r.ok).toBe(true);
    // Not "no PUT" alone — NO REQUEST AT ALL, not even the read half of the
    // read-modify-write. A version that GETs and then decides not to PUT would
    // pass a weaker assertion here and still be doing needless Pod traffic.
    expect(pod.requests).toEqual([]);
  });
});

describe("removeTripFromDiary", () => {
  it("removes exactly the one dy:trip triple for that trip, via If-Match", async () => {
    const { removeTripFromDiary } = await loadDiary();
    const pod = podFake({ trips: [PUBLISHED_TRIP_IRI, OTHER_TRIP_IRI], etag: '"diary-v5"' });

    const r = await removeTripFromDiary({
      fetch: recordingFetch([]),
      podRoot: POD_ROOT,
      tripIri: PUBLISHED_TRIP_IRI,
    });

    expect(r.ok).toBe(true);
    const put = pod.of("PUT", DIARY_URL)[0];
    expect(put).toBeDefined();
    expect(put.headers["if-match"]).toBe('"diary-v5"');

    const d = diff(diaryTtl([PUBLISHED_TRIP_IRI, OTHER_TRIP_IRI]), put.body);
    expect(d.added).toEqual([]);
    expect(d.removed).toHaveLength(1);
    expect(d.removed[0]).toContain(DY.trip);
    expect(d.removed[0]).toContain(PUBLISHED_TRIP_IRI);
    // The OTHER trip's row is untouched — this is a targeted removal, not a
    // rebuild from nothing.
    expect(put.body).toContain(OTHER_TRIP_IRI);

    servePod({ [DIARY_URL]: put.body });
    const read = await readDiary(DIARY_URL);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.trips).not.toContain(PUBLISHED_TRIP_IRI);
      expect(read.value.trips).toContain(OTHER_TRIP_IRI);
    }
  });
});

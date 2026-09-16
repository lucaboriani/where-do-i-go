import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { SCHEMA_VERSION } from "@/lib/vocab";
import { diaryUrl, readDiary } from "@/lib/pod/read";
import { server } from "@/test/msw";
import type { AccessState } from "@/lib/pod/access";
import type { PodFetch } from "@/lib/pod/rdf";
import type { PodError, Result } from "@/lib/pod/result";

/**
 * Task 1.4 — first-run bootstrap. `lib/pod/bootstrap.ts` DOES NOT EXIST YET;
 * this file pins the failing (RED) step of the TDD loop for it.
 *
 * `lib/pod/access.ts` is mocked as a MODULE, exactly as save-entry.test.ts
 * mocks it: driving the real four-container ACL negotiation through MSW would
 * encode @inrupt/solid-client 3.0.0's request sequence rather than this
 * module's behaviour (access.ts's own docblock, and access.test.ts's rationale
 * for the same choice). What the mock proves instead is the POLICY bootstrap
 * asks for — public-read children for travel/, travel/trips/, travel/media/,
 * and owner-only for travel/settings/ — captured from whichever entry point
 * (`createContainer` per container, or the existing `initialiseContainers`)
 * the implementation calls; access.ts's own suite and the CSS integration
 * test are what prove the ACL that policy produces actually holds.
 *
 * diary.ttl is NOT mocked: it is plain `fetch` through `putGuarded`, so MSW is
 * the seam that matters there, and the body bootstrap writes is read back
 * through the real, unmocked `readDiary` — this is what proves the authored
 * Turtle is actually valid per the schema, not merely "some string was PUT".
 *
 * RULING: bootstrap authors NO `privacy.ttl`. `docs/data-model.md` §4/§9 say
 * first run creates `/travel/settings/` and writes **no documents** into it —
 * a default `privacy.ttl` would choose a home region and a precision on the
 * owner's behalf, and §5's objection to that is not narrowly about the home
 * region. `readPrivacySettings` fails closed (read.ts) and the studio editor
 * is designed for `privacy.ttl` absent, so the tests that asserted an
 * authored `privacy.ttl` here have been cut back to match the normative doc.
 */

const POD = "https://me.solidcommunity.net";
const POD_ROOT = `${POD}/`;
const WEBID = `${POD}/profile/card#me`;
const DIARY_URL = diaryUrl(POD_ROOT);

/* -------------------------------------------------- mock: lib/pod/access.ts */

const { containerCalls } = vi.hoisted(() => ({
  containerCalls: [] as { url: string; publicChildren?: boolean }[],
}));

vi.mock("@/lib/pod/access", () => {
  /** access.ts's own §4 layout (CONTAINERS), reproduced here only as the shape
   *  `initialiseContainers` returns — not asserted as ACL truth, which is
   *  access.ts's job, not this mock's. */
  const FOUR = (root: string) => [
    { segment: "travel/", publicChildren: true },
    { segment: "travel/trips/", publicChildren: true },
    { segment: "travel/media/", publicChildren: true },
    { segment: "travel/settings/", publicChildren: false },
  ].map(({ segment, publicChildren }) => ({
    url: new URL(segment, root).toString(),
    publicChildren,
  }));

  const state = (url: string, publicChildren: boolean | undefined): AccessState => ({
    url,
    read: false,
    append: false,
    write: false,
    inherits: publicChildren ?? true,
    inheritsVerifiedBy: "rules",
    verifiedBy: "rules",
  });

  return {
    createContainer: async (url: string, opts: { publicChildren?: boolean }) => {
      containerCalls.push({ url, publicChildren: opts?.publicChildren });
      return { ok: true as const, value: state(url, opts?.publicChildren) };
    },
    initialiseContainers: async (opts: { podRoot: string }) => {
      const root = opts.podRoot.endsWith("/") ? opts.podRoot : `${opts.podRoot}/`;
      const containers = FOUR(root);
      containerCalls.push(...containers);
      return {
        ok: true as const,
        value: { podRoot: root, containers: containers.map((c) => state(c.url, c.publicChildren)) },
      };
    },
  };
});

afterEach(() => {
  containerCalls.length = 0;
});

/* ------------------------------------------------------------------ helpers */

type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };

/**
 * A document that starts absent and can be created exactly once. HEAD, GET
 * and PUT all consult the SAME piece of state, so this is agnostic between
 * "HEAD first, skip if present" and "blind PUT, swallow the 412" — either
 * strategy converges to the same observable behaviour here, which is the
 * point: this file pins behaviour, not a particular implementation route.
 */
function fakeDocument(url: string, requests: Recorded[]) {
  let current: { body: string; etag: string } | undefined;

  const record = async (request: Request): Promise<Recorded> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const entry = { method: request.method, url: request.url, headers, body: await request.text() };
    requests.push(entry);
    return entry;
  };

  server.use(
    http.head(url, async ({ request }) => {
      await record(request);
      return current
        ? new HttpResponse(null, { status: 200, headers: { etag: current.etag } })
        : new HttpResponse(null, { status: 404 });
    }),
    http.get(url, async ({ request }) => {
      await record(request);
      return current
        ? HttpResponse.text(current.body, { headers: { "content-type": "text/turtle", etag: current.etag } })
        : new HttpResponse(null, { status: 404 });
    }),
    http.put(url, async ({ request }) => {
      const entry = await record(request);
      // A create precondition against an already-written document — the
      // second run's case, and the one this whole file is checking is swallowed
      // rather than surfaced as a failure.
      if (entry.headers["if-none-match"] === "*" && current) {
        return new HttpResponse("already exists", { status: 412 });
      }
      current = { body: entry.body, etag: `"${requests.length}"` };
      return new HttpResponse(null, { status: 205, headers: { etag: current.etag } });
    }),
  );

  return { body: () => current?.body };
}

function podFake() {
  const requests: Recorded[] = [];
  const diary = fakeDocument(DIARY_URL, requests);
  return {
    diaryBody: diary.body,
    of: (method: string, url: string) =>
      requests.filter((r) => r.method === method && r.url === url),
  };
}

/** Dynamic import, as save-entry.test.ts does: a static import of a missing
 *  export is an ESM link error that kills the whole file before a single test
 *  runs, rather than failing each test on its own terms. */
type EnsurePodInitialisedOptions = {
  fetch: PodFetch;
  podRoot: string;
  webId: string;
  now?: () => string;
};
const loadEnsure = async () =>
  (await import("@/lib/pod/bootstrap")).ensurePodInitialised as (
    opts: EnsurePodInitialisedOptions,
  ) => Promise<Result<void>>;

/* ===================================================== ensurePodInitialised */

describe("ensurePodInitialised — first run on a blank Pod", () => {
  it("requests public-read children for travel/, trips/ and media/, and owner-only for settings/", async () => {
    const ensurePodInitialised = await loadEnsure();
    podFake();

    const r = await ensurePodInitialised({ fetch: globalThis.fetch, podRoot: POD_ROOT, webId: WEBID });
    expect(r.ok).toBe(true);

    // §4's four containers, all requested — through createContainer directly
    // or through the existing initialiseContainers, either is fine; what
    // matters is the POLICY asked for, captured by the mock either way.
    const at = (segment: string) => containerCalls.find((c) => c.url === new URL(segment, POD_ROOT).toString());
    expect(at("travel/")?.publicChildren).toBe(true);
    expect(at("travel/trips/")?.publicChildren).toBe(true);
    expect(at("travel/media/")?.publicChildren).toBe(true);
    // THE ONE THAT MATTERS MOST: a wrong default here publishes the owner's
    // home coordinates the moment privacy.ttl exists (§4, §9).
    expect(at("travel/settings/")?.publicChildren).toBe(false);
  });

  it("authors a diary.ttl that readDiary accepts: dy:Diary, schemaVersion 2, zero trips", async () => {
    const ensurePodInitialised = await loadEnsure();
    const pod = podFake();

    const r = await ensurePodInitialised({ fetch: globalThis.fetch, podRoot: POD_ROOT, webId: WEBID });
    expect(r.ok).toBe(true);

    const body = pod.diaryBody();
    expect(body).toBeTruthy();

    // Read back through the REAL, unmocked reader — this is what proves the
    // authored Turtle validates against the schema, not merely "a PUT happened".
    const diary = await readDiary(DIARY_URL, { fetch: globalThis.fetch });
    expect(diary.ok).toBe(true);
    if (!diary.ok) return;
    expect(diary.value.schemaVersion).toBe(SCHEMA_VERSION);
    expect(diary.value.trips).toEqual([]);
    // <title>, per the brief's own list of what a fresh diary.ttl carries — not
    // pinned to any particular wording, only that one was actually written.
    expect(diary.value.title?.value.length ?? 0).toBeGreaterThan(0);
  });

  it("carried If-None-Match: * on the document it created", async () => {
    const ensurePodInitialised = await loadEnsure();
    const pod = podFake();

    await ensurePodInitialised({ fetch: globalThis.fetch, podRoot: POD_ROOT, webId: WEBID });

    expect(pod.of("PUT", DIARY_URL)[0]?.headers["if-none-match"]).toBe("*");
  });

  it("is idempotent: a second run neither errors nor overwrites diary.ttl", async () => {
    const ensurePodInitialised = await loadEnsure();
    const pod = podFake();
    const opts = { fetch: globalThis.fetch, podRoot: POD_ROOT, webId: WEBID };

    const first = await ensurePodInitialised(opts);
    expect(first.ok).toBe(true);
    const diaryAfterFirst = pod.diaryBody();
    expect(diaryAfterFirst).toBeTruthy();

    // A create precondition against a document that now exists is exactly the
    // 412 §10 designs for; the brief's own words are "swallowed as already
    // there" and that is what this asserts — ok, and byte-identical.
    const second = await ensurePodInitialised(opts);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      const error: PodError = second.error;
      throw new Error(`second run should not fail: ${error.kind}`);
    }

    expect(pod.diaryBody()).toBe(diaryAfterFirst);

    // And the resource still reads exactly as it did — not merely "a body
    // exists", but the same PARSED value, both times.
    const diaryTwice = await readDiary(DIARY_URL, { fetch: globalThis.fetch });
    expect(diaryTwice.ok && diaryTwice.value.trips).toEqual([]);
  });
});

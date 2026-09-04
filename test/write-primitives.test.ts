import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import { server } from "./msw";
import { graphEquals, triples } from "./graph";
import { LDP, NS } from "@/lib/vocab";
import {
  listContainer,
  putGuarded,
  rebuildIndex,
  type Precondition,
} from "@/lib/pod/write";
import { readTripIndex } from "@/lib/pod/read";
import { describe as renderError } from "@/lib/pod/result";
import type { PodFetch } from "@/lib/pod/rdf";

/**
 * lib/pod/write.ts, at the HTTP boundary.
 *
 * THE SEAM IS MSW, NOT A STUB. `putGuarded` takes a `PodFetch`, so it would be
 * easy to hand it a `vi.fn()` and assert "the helper was called with the right
 * options" — which asserts that the test's idea of the call matches the test's
 * idea of the call. CLAUDE.md's precondition rule is about what goes ON THE
 * WIRE: "every write carries a precondition: `If-None-Match: *` to create,
 * `If-Match: <etag>` to update. A blind PUT is a bug." So the assertions below
 * read the headers off the `Request` object MSW hands the resolver, after
 * `fetch` has built it.
 *
 * THE FAKE POD ACCEPTS A BLIND PUT, DELIBERATELY. A fake that answered 428 to
 * an unconditioned write would make every test in this file fail the moment the
 * precondition was removed — but for the fake's reason, not for ours, and it
 * would hide which assertion was actually load-bearing. Real Pods accept blind
 * PUTs; that is the entire problem. So the fake behaves like one and the
 * evidence lives in explicit header assertions, plus one sweep over every
 * request the suite made.
 *
 * Entry bodies come from the §7 fixtures in docs/data-model.md, read at
 * runtime. Those blocks are normative — a hand-copied entry would test a copy
 * of the spec.
 */

const doc = readFileSync("docs/data-model.md", "utf8");
const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);
const ENTRY = blocks[2];

const POD = "https://pod.test.example/";
const TRIP_DIR = `${POD}travel/trips/2026-japan/`;
const ENTRIES = `${TRIP_DIR}entries/`;
const INDEX_URL = `${TRIP_DIR}entries.ttl`;
const TRIP_IRI = `${TRIP_DIR}trip.ttl#it`;
const DOC_URL = `${POD}travel/notes.ttl`;

/**
 * String-replace a fixture, and FAIL IF THE ANCHOR DID NOT MATCH.
 *
 * A negative test built by `fixture.replace(anchor, bad)` passes against the
 * unmodified fixture when the anchor drifts — it reports green while asserting
 * that valid data is valid. This project has been bitten by exactly that, so
 * every edit below goes through here.
 */
function mutate(source: string, from: string, to: string): string {
  // `out !== source` is the wrong check: a replacement that happens to be
  // identical to the anchor is legitimate (re-slugging to the fixture's own
  // slug) and would trip it. Presence of the anchor is what actually matters.
  if (!source.includes(from)) {
    throw new Error(`fixture anchor did not match, so nothing was changed: ${from}`);
  }
  return source.replaceAll(from, to);
}

/** A §7.3 entry, re-slugged (and optionally demoted to a draft, or moved). */
function entryFixture(
  slug: string,
  opts: { draft?: boolean; occurredAt?: string; lat?: string; long?: string } = {},
): string {
  let t = mutate(ENTRY, '"2026-03-29-arrival"', `"${slug}"`);
  t = mutate(t, '"First night in Shinjuku"', `"${slug} headline"`);
  if (opts.draft) t = mutate(t, "dy:status            dy:Published", "dy:status            dy:Draft");
  if (opts.occurredAt) t = mutate(t, '"2026-03-29T21:40:00+09:00"', `"${opts.occurredAt}"`);
  if (opts.lat) t = mutate(t, "35.6938", opts.lat);
  if (opts.long) t = mutate(t, "139.7034", opts.long);
  return t;
}

/** An LDP container listing, with RELATIVE member IRIs — phase 0: "container
 *  listings use relative IRIs", which is why n3 needs a baseIRI here. */
function containerTurtle(members: readonly string[]): string {
  return `@prefix ldp: <${NS.ldp}> .
@prefix dcterms: <${NS.dcterms}> .

<>
    a ldp:BasicContainer, ldp:Container ;
    dcterms:modified "2026-09-04T10:00:00+00:00" ;
    ldp:contains ${members.map((m) => `<${m}>`).join(", ")} .
`;
}

type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };

type PodOptions = {
  /** URLs that answer with this status instead of their stored body. */
  fail?: Record<string, number>;
  /** Serve no ETag at all — the server that makes a safe update impossible. */
  noEtag?: boolean;
  /** Called on every GET of a stored resource; used to observe concurrency. */
  onGet?: (url: string) => Promise<void> | void;
};

/**
 * An in-memory Pod served over MSW. Enforces `If-None-Match: *` and
 * `If-Match: <etag>` the way CSS 7.2.0 does — 412 on a failed precondition —
 * and, like a real server, accepts a PUT that carries neither.
 *
 * Handlers are scoped to this one origin. No catch-all: a request to anything
 * else still hits test/setup.ts's network guard and fails the test.
 */
function fakePod(initial: Record<string, string> = {}, options: PodOptions = {}) {
  const store = new Map<string, { body: string; etag: string }>();
  const requests: Recorded[] = [];
  let version = 0;
  const nextEtag = () => `"v${++version}"`;

  for (const [url, body] of Object.entries(initial)) store.set(url, { body, etag: nextEtag() });

  const record = async (request: Request) => {
    requests.push({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers),
      body: request.method === "PUT" ? await request.clone().text() : "",
    });
  };

  const etagHeaders = (etag: string): Record<string, string> =>
    options.noEtag
      ? { "content-type": "text/turtle" }
      : { "content-type": "text/turtle", etag };

  server.use(
    http.get(`${POD}*`, async ({ request }) => {
      await record(request);
      const failure = options.fail?.[request.url];
      if (failure !== undefined) return new HttpResponse("nope", { status: failure });
      const held = store.get(request.url);
      if (!held) return new HttpResponse(null, { status: 404 });
      await options.onGet?.(request.url);
      return HttpResponse.text(held.body, { headers: etagHeaders(held.etag) });
    }),
    http.head(`${POD}*`, async ({ request }) => {
      await record(request);
      const failure = options.fail?.[request.url];
      if (failure !== undefined) return new HttpResponse(null, { status: failure });
      const held = store.get(request.url);
      if (!held) return new HttpResponse(null, { status: 404 });
      return new HttpResponse(null, { headers: etagHeaders(held.etag) });
    }),
    http.put(`${POD}*`, async ({ request }) => {
      await record(request);
      const failure = options.fail?.[request.url];
      if (failure !== undefined) return new HttpResponse(null, { status: failure });

      const held = store.get(request.url);
      const ifNoneMatch = request.headers.get("if-none-match");
      const ifMatch = request.headers.get("if-match");

      if (ifNoneMatch === "*" && held) return new HttpResponse(null, { status: 412 });
      if (ifMatch !== null && (!held || held.etag !== ifMatch)) {
        return new HttpResponse(null, { status: 412 });
      }

      const etag = nextEtag();
      store.set(request.url, { body: await request.text(), etag });
      // 205 on update, not 200: a caller that checked `status === 201` rather
      // than `res.ok` would pass against a fake that always answers 201.
      return new HttpResponse(null, {
        status: held ? 205 : 201,
        headers: options.noEtag ? undefined : { etag },
      });
    }),
  );

  return {
    requests,
    put: (url: string) => requests.filter((r) => r.method === "PUT" && r.url === url),
    body: (url: string) => store.get(url)?.body,
    has: (url: string) => store.has(url),
    seed: (url: string, body: string) => store.set(url, { body, etag: nextEtag() }),
    etagOf: (url: string) => store.get(url)?.etag,
  };
}

/** MSW patches globalThis.fetch, so this IS the HTTP layer. */
const podFetch: PodFetch = (...args) => globalThis.fetch(...args);

const TURTLE = `@prefix dcterms: <${NS.dcterms}> .\n<#it> dcterms:title "note" .\n`;

/* ------------------------------------------------------------- putGuarded */

describe("putGuarded — the precondition is the point", () => {
  /**
   * Both branches of `Precondition`, in one list, so neither can be the one
   * that quietly has no test. Typed as Precondition so the union itself is
   * exercised rather than an inferred object literal.
   */
  const PRECONDITIONS: [label: string, precondition: Precondition, header: string, value: string][] = [
    ["create", { create: true }, "if-none-match", "*"],
    ["update", { etag: '"v1"' }, "if-match", '"v1"'],
  ];

  it.each(PRECONDITIONS)(
    "%s puts exactly one precondition header on the wire, and not the other",
    async (_label, precondition, header, value) => {
      const pod = fakePod();
      const r = await putGuarded(podFetch, DOC_URL, TURTLE, precondition);

      const [sent] = pod.put(DOC_URL);
      expect(sent).toBeDefined();
      expect(sent.headers[header]).toBe(value);

      // The other one must be ABSENT. `If-Match: *` alongside `If-None-Match: *`
      // is a contradiction no server can satisfy; `If-Match` on a create is a
      // blind overwrite wearing a precondition (lib/pod/access.ts says so in as
      // many words).
      const other = header === "if-match" ? "if-none-match" : "if-match";
      expect(sent.headers[other]).toBeUndefined();

      // And the create actually landed. The update did not — nothing was there
      // to match "v1" — which is the 412 case, asserted on its own below.
      expect(r.ok).toBe("create" in precondition);
    },
  );

  it("never sends an unconditioned PUT, whatever else is asked of it", async () => {
    // The sweep. Every shape a caller reaches today: both preconditions, a
    // custom content type, and the container-creation Link header. Not one of
    // them may reach the server naked, and none may carry both conditions —
    // `If-Match` and `If-None-Match` together is a request no server can
    // satisfy coherently (RFC 9110 evaluates If-Match first, so the caller's
    // header would win over the precondition).
    const pod = fakePod();
    await putGuarded(podFetch, DOC_URL, TURTLE, { create: true });
    await putGuarded(podFetch, `${POD}travel/a.ttl`, "{}", { etag: '"x"' }, "application/json");
    await putGuarded(podFetch, `${POD}travel/b/`, "", { create: true }, "text/turtle", {
      link: `<${LDP.BasicContainer}>; rel="type"`,
    });

    const puts = pod.requests.filter((r) => r.method === "PUT");
    expect(puts).toHaveLength(3);
    for (const put of puts) {
      const conditions = [put.headers["if-none-match"], put.headers["if-match"]].filter(
        (h) => h !== undefined,
      );
      expect(conditions).toHaveLength(1);
    }
  });

  it("overrides an extraHeaders precondition of the same name with the real one", async () => {
    // The precondition argument is the contract; extraHeaders is a convenience.
    // A caller that passes `if-none-match` in extraHeaders must not be able to
    // downgrade a create into a conditional-on-a-stale-ETag write.
    const pod = fakePod();
    await putGuarded(podFetch, `${POD}travel/c.ttl`, TURTLE, { create: true }, "text/turtle", {
      "if-none-match": '"stale"',
    });
    await putGuarded(podFetch, `${POD}travel/d.ttl`, TURTLE, { etag: '"real"' }, "text/turtle", {
      "if-match": '"stale"',
    });

    expect(pod.put(`${POD}travel/c.ttl`)[0].headers["if-none-match"]).toBe("*");
    expect(pod.put(`${POD}travel/d.ttl`)[0].headers["if-match"]).toBe('"real"');
  });

  /**
   * REPORTED, NOT FIXED. `putGuarded` builds its headers as
   * `{ ...extraHeaders, "content-type": ct }` and then assigns the precondition
   * key. That defends the SAME lowercase key (pinned above) and nothing else:
   *
   *   - extraHeaders `{ "if-match": "\"x\"" }` with `{ create: true }` puts BOTH
   *     conditions on the wire. RFC 9110 §13.2.2 evaluates If-Match first, so
   *     the caller's header decides and `If-None-Match: *` never applies.
   *   - extraHeaders `{ "If-None-Match": "\"x\"" }` — capitalised — is a
   *     distinct object key, and the Headers constructor COMBINES rather than
   *     replaces: measured as `"x", *`, which is not valid If-None-Match syntax.
   *
   * No call site does either (access.ts passes only `link`), so this is a
   * latent hole rather than a live defect, and closing it is a change to
   * lib/pod/write.ts that this backfill is not authorised to make.
   */
  it.todo("rejects a precondition header supplied through extraHeaders — not implemented");

  it("sends the body unchanged, as a graph, with text/turtle by default", async () => {
    const pod = fakePod();
    await putGuarded(podFetch, DOC_URL, TURTLE, { create: true });

    const [sent] = pod.put(DOC_URL);
    expect(sent.headers["content-type"]).toBe("text/turtle");
    // Byte comparison is banned (§11) and would be wrong here anyway: what
    // matters is that nothing re-serialised or dropped a triple in transit.
    const diff = graphEquals(TURTLE, sent.body, DOC_URL);
    expect(diff).toEqual({ equal: true, missing: [], extra: [] });
  });

  it("passes an explicit content type and extra headers through", async () => {
    // lib/pod/access.ts's ensureContainer is the real caller: creating a
    // container is a guarded PUT with `Link: <ldp:BasicContainer>; rel="type"`.
    const pod = fakePod();
    const r = await putGuarded(podFetch, `${POD}travel/`, "", { create: true }, "text/turtle", {
      link: `<${LDP.BasicContainer}>; rel="type"`,
    });

    expect(r.ok).toBe(true);
    const [sent] = pod.put(`${POD}travel/`);
    expect(sent.headers.link).toBe(`<${LDP.BasicContainer}>; rel="type"`);
    expect(sent.headers["if-none-match"]).toBe("*");
  });

  it("returns the new ETag, so the caller can chain the next update", async () => {
    const pod = fakePod();
    const created = await putGuarded(podFetch, DOC_URL, TURTLE, { create: true });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.etag).toBe(pod.etagOf(DOC_URL));
    expect(created.value.etag).not.toBeNull();

    // The whole loop: the ETag the create returned is the one the update needs.
    const updated = await putGuarded(podFetch, DOC_URL, TURTLE, { etag: created.value.etag! });
    expect(updated.ok).toBe(true);
    expect(pod.put(DOC_URL)[1].headers["if-match"]).toBe(created.value.etag);
  });

  it("reports a concurrent modification as http 412, which is what makes it retryable", async () => {
    // §10: "Fails on concurrent modification; refetch and retry." A caller
    // cannot retry what it cannot distinguish from a 403 or a 404, so the
    // status has to survive into the error.
    const pod = fakePod({ [DOC_URL]: TURTLE });
    const r = await putGuarded(podFetch, DOC_URL, TURTLE, { etag: '"gone-stale"' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: DOC_URL, status: 412 });
    expect(renderError(r.error)).toContain("412");

    // And the stale write did NOT land. A 412 the caller ignores is survivable;
    // a 412 the server reports while storing the body is not.
    expect(pod.body(DOC_URL)).toBe(TURTLE);
  });

  it("reports a create over an existing resource as 412 too", async () => {
    const pod = fakePod({ [DOC_URL]: "@prefix x: <urn:x:> .\n" });
    const r = await putGuarded(podFetch, DOC_URL, TURTLE, { create: true });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("http");
    if (r.error.kind !== "http") return;
    expect(r.error.status).toBe(412);
    // Untouched: `If-None-Match: *` is what stops a create clobbering an edit.
    expect(pod.body(DOC_URL)).not.toBe(TURTLE);
  });

  it("does not report success on a 403, and does report success on a 205", async () => {
    // Both halves, because "!res.ok" and "status === 201" agree on the happy
    // path and disagree on an update, which is the path that matters.
    const pod = fakePod({ [DOC_URL]: TURTLE }, { fail: { [`${POD}travel/locked.ttl`]: 403 } });

    const refused = await putGuarded(podFetch, `${POD}travel/locked.ttl`, TURTLE, { create: true });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error).toEqual({ kind: "http", url: `${POD}travel/locked.ttl`, status: 403 });

    const updated = await putGuarded(podFetch, DOC_URL, "@prefix y: <urn:y:> .\n", {
      etag: pod.etagOf(DOC_URL)!,
    });
    expect(updated.ok).toBe(true);
  });

  it("reports an unreachable Pod as a network error carrying the cause", async () => {
    const failing: PodFetch = async () => {
      throw new TypeError("fetch failed");
    };
    const r = await putGuarded(failing, DOC_URL, TURTLE, { create: true });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("network");
    if (r.error.kind !== "network") return;
    expect(r.error.url).toBe(DOC_URL);
    expect(r.error.message).toContain("fetch failed");
    expect(renderError(r.error)).toContain("fetch failed");
  });

  it("returns a value rather than throwing, on both failure paths", async () => {
    // §11 guardrail 2. A studio that has to try/catch a write cannot render a
    // retry affordance, and the 412 path exists precisely to be retried.
    const rejecting: PodFetch = () => Promise.reject(new Error("boom"));
    await expect(putGuarded(rejecting, DOC_URL, TURTLE, { create: true })).resolves.toMatchObject({
      ok: false,
    });

    fakePod({ [DOC_URL]: TURTLE });
    await expect(
      putGuarded(podFetch, DOC_URL, TURTLE, { etag: '"stale"' }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("returns ok with a null ETag rather than inventing one", async () => {
    // A server that stores the write but sends no ETag back. The write DID
    // happen, so this is not an error — but the caller has nothing to chain
    // with, and a fabricated ETag would turn the next update into a blind PUT.
    fakePod({}, { noEtag: true });
    const r = await putGuarded(podFetch, DOC_URL, TURTLE, { create: true });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.etag).toBeNull();
  });
});

/* ----------------------------------------------------------- listContainer */

describe("listContainer", () => {
  it("resolves relative member IRIs against the container, per phase 0", async () => {
    // Phase 0: "always pass baseIRI — container listings use relative IRIs."
    // Without one, n3 either throws or yields terms that resolve nowhere; the
    // absolute URLs below are the whole reason rebuildIndex can fetch them.
    fakePod({ [ENTRIES]: containerTurtle(["a.ttl", "b.ttl", "sub/"]) });
    const r = await listContainer(podFetch, ENTRIES);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([`${ENTRIES}a.ttl`, `${ENTRIES}b.ttl`, `${ENTRIES}sub/`]);
    // Not a relative fragment left anywhere: every member is absolute.
    for (const member of r.value) expect(member.startsWith(POD)).toBe(true);
  });

  it("returns every member, so the array-returning parse() is really being used", async () => {
    // Phase 0's n3 trap: `parser.parse(str, callback)` "did not populate
    // results synchronously and silently yielded zero quads". A count of 0 is
    // indistinguishable from an empty container unless the container is not
    // empty, so this one has twelve members on purpose.
    const members = Array.from({ length: 12 }, (_, i) => `e-${i}.ttl`);
    fakePod({ [ENTRIES]: containerTurtle(members) });
    const r = await listContainer(podFetch, ENTRIES);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(12);
  });

  it("returns only ldp:contains, not every object in the listing", async () => {
    // A CSS listing carries rdf:type, dcterms:modified, posix:size and the
    // container's own description. A reader that took every object would hand
    // rebuildIndex a list of datatypes to fetch.
    fakePod({ [ENTRIES]: containerTurtle(["a.ttl"]) });
    const r = await listContainer(podFetch, ENTRIES);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual([`${ENTRIES}a.ttl`]);
    expect(r.value).not.toContain(LDP.BasicContainer);
  });

  it("returns an empty list for an empty container, not an error", async () => {
    fakePod({ [ENTRIES]: `@prefix ldp: <${NS.ldp}> .\n<> a ldp:BasicContainer .\n` });
    const r = await listContainer(podFetch, ENTRIES);

    expect(r).toEqual({ ok: true, value: [] });
  });

  it("asks for Turtle, through the fetch it was handed and no other", async () => {
    const pod = fakePod({ [ENTRIES]: containerTurtle(["a.ttl"]) });
    const injected = vi.fn(podFetch);
    await listContainer(injected, ENTRIES);

    // The studio's authenticated fetch is the only way drafts are visible at
    // all; reaching for the ambient one silently lists the public view.
    expect(injected).toHaveBeenCalledTimes(1);
    expect(pod.requests[0].headers.accept).toBe("text/turtle");
  });

  it.each([
    ["a closed container", 403],
    ["a container that is not there", 404],
  ])("reports %s as a structured http error", async (_label, status) => {
    fakePod({}, { fail: { [ENTRIES]: status } });
    const r = await listContainer(podFetch, ENTRIES);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: ENTRIES, status });
  });

  it("reports malformed Turtle as a parse error, with the reason", async () => {
    fakePod({ [ENTRIES]: "@prefix ldp: <not a valid iri" });
    const r = await listContainer(podFetch, ENTRIES);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("parse");
    if (r.error.kind !== "parse") return;
    expect(r.error.url).toBe(ENTRIES);
    expect(r.error.message.length).toBeGreaterThan(0);
    expect(renderError(r.error)).toContain(r.error.message);
  });

  it("reports an unreachable Pod as a network error, not a throw", async () => {
    const failing: PodFetch = async () => {
      throw new TypeError("connect ECONNREFUSED");
    };
    const r = await listContainer(failing, ENTRIES);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("network");
    if (r.error.kind !== "network") return;
    expect(r.error.message).toContain("ECONNREFUSED");
  });
});

/* ------------------------------------------------------------ rebuildIndex */

/** The §10 recovery scenario: two published entries and a draft, in a container
 *  that also holds an ACL and a photo. */
function recoveryPod(extra: Record<string, string> = {}, options: PodOptions = {}) {
  const published = {
    [`${ENTRIES}2026-03-29-arrival.ttl`]: entryFixture("2026-03-29-arrival"),
    [`${ENTRIES}2026-03-31-nara.ttl`]: entryFixture("2026-03-31-nara", {
      occurredAt: "2026-03-31T11:05:00+09:00",
      lat: "34.6851",
      long: "135.8048",
    }),
  };
  const draft = {
    [`${ENTRIES}2026-04-02-secret.ttl`]: entryFixture("2026-04-02-secret", {
      draft: true,
      occurredAt: "2026-04-02T09:00:00+09:00",
    }),
  };
  return fakePod(
    {
      [ENTRIES]: containerTurtle([
        "2026-03-29-arrival.ttl",
        "2026-03-31-nara.ttl",
        "2026-04-02-secret.ttl",
        "2026-03-29-arrival.ttl.acl",
        "cover.jpg",
      ]),
      [`${ENTRIES}2026-03-29-arrival.ttl.acl`]: "# not an entry\n",
      ...published,
      ...draft,
      ...extra,
    },
    options,
  );
}

const rebuild = (options: Partial<Parameters<typeof rebuildIndex>[0]> = {}) =>
  rebuildIndex({
    fetch: podFetch,
    tripIri: TRIP_IRI,
    entriesContainer: ENTRIES,
    indexUrl: INDEX_URL,
    now: () => "2026-09-04T10:30:00+00:00",
    ...options,
  });

/** Read back what was actually written, through the real public read path.
 *  Asserting on the report alone cannot tell a rebuild from a no-op. */
async function readBack(body: string | undefined) {
  expect(body).toBeDefined();
  // Blank nodes are banned outright (§6); triples() throws if one appears.
  expect(triples(body!, INDEX_URL).size).toBeGreaterThan(0);
  fakePod({ [INDEX_URL]: body! });
  const r = await readTripIndex(INDEX_URL);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(renderError(r.error));
  return r.value;
}

describe("rebuildIndex — the recovery path for every §10 partial failure", () => {
  it("keeps published entries and leaves the draft out of the index entirely", async () => {
    const pod = recoveryPod();
    const r = await rebuild();

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const index = await readBack(pod.body(INDEX_URL));
    const slugs = index.entries.map((e) => e.slug);
    expect(slugs).toEqual(["2026-03-29-arrival", "2026-03-31-nara"]);
    expect(slugs).not.toContain("2026-04-02-secret");
    expect(index.entryCount).toBe(2);

    // The draft's title must not be in the resource at ALL — not merely absent
    // from the row list. The index is what the public site reads (§4).
    expect(pod.body(INDEX_URL)).not.toContain("2026-04-02-secret");

    // The report must agree with what landed, or "published: 2" is a claim
    // about a rebuild that did not happen.
    expect(r.value.published).toBe(index.entries.length);
    expect(r.value.indexUrl).toBe(INDEX_URL);
  });

  it("reads only the .ttl members, never the ACL or the photo", async () => {
    const pod = recoveryPod();
    await rebuild();

    const fetched = pod.requests.filter((q) => q.method === "GET").map((q) => q.url);
    expect(fetched).toContain(`${ENTRIES}2026-03-29-arrival.ttl`);
    expect(fetched).not.toContain(`${ENTRIES}2026-03-29-arrival.ttl.acl`);
    expect(fetched).not.toContain(`${ENTRIES}cover.jpg`);
  });

  it("orders and renumbers the rebuilt rows, and derives the bbox from the points", async () => {
    const pod = recoveryPod();
    await rebuild();
    const index = await readBack(pod.body(INDEX_URL));

    expect(index.entries.map((e) => e.sortOrder)).toEqual([1, 2]);
    // Nara is south and west of Shinjuku; the draft's point must not widen it.
    expect(index.bbox).toEqual({ west: 135.8048, south: 34.6851, east: 139.7034, north: 35.6938 });
  });

  it("writes a dcterms:modified the read path accepts — xsd:dateTime with an offset", async () => {
    const pod = recoveryPod();
    // No `now`, so the module's own clock is used. §6: xsd:dateTime always
    // carries a UTC offset, and readTripIndex rejects one that does not.
    await rebuild({ now: undefined });
    const index = await readBack(pod.body(INDEX_URL));

    expect(index.modified).toBeDefined();
    expect(index.modified).toMatch(/([+-]\d{2}:\d{2}|Z)$/);
  });

  it("skips one unreadable entry and reports it, rather than losing the trip", async () => {
    // §10: "one malformed entry is skipped and reported, never fatal." The
    // failure this guards is the opposite of a silent drop — an unreadable
    // entry that takes the other thirteen down with it.
    const pod = recoveryPod({}, { fail: { [`${ENTRIES}2026-03-31-nara.ttl`]: 500 } });
    const r = await rebuild();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.skipped).toEqual([{ url: `${ENTRIES}2026-03-31-nara.ttl`, reason: "http" }]);

    const index = await readBack(pod.body(INDEX_URL));
    expect(index.entries.map((e) => e.slug)).toEqual(["2026-03-29-arrival"]);
    expect(r.value.published).toBe(1);

    // `read` counts what it ATTEMPTED, including the one that failed. Reporting
    // the entries it managed to read instead would say "read 2, published 1,
    // skipped 1" about a container holding three — the arithmetic no longer adds
    // up and the owner cannot tell whether anything was missed. The all-succeed
    // case cannot catch this: there, the two numbers are equal.
    expect(r.value.read).toBe(3);
    expect(r.value.read).toBe(r.value.published + r.value.skipped.length + 1); // +1 draft
  });

  it("classifies a malformed entry by the reason it failed, not as a blanket skip", async () => {
    const pod = recoveryPod({ [`${ENTRIES}2026-03-31-nara.ttl`]: "@prefix broken" });
    const r = await rebuild();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // "parse", not "http": the studio's recovery UI tells the owner whether the
    // resource is broken or the server refused it, and those need different acts.
    expect(r.value.skipped).toEqual([{ url: `${ENTRIES}2026-03-31-nara.ttl`, reason: "parse" }]);
    expect(pod.body(INDEX_URL)).toBeDefined();
  });

  it("skips an entry from a schema version it does not understand, and says so", async () => {
    // The migration case: rebuildIndex is also how a newer app reads a Pod
    // written by an older one (§10). A version it cannot read is skipped by
    // name, not silently dropped.
    const pod = recoveryPod({
      [`${ENTRIES}2026-03-31-nara.ttl`]: mutate(
        entryFixture("2026-03-31-nara"),
        "dy:schemaVersion     1",
        "dy:schemaVersion     99",
      ),
    });
    const r = await rebuild();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.skipped).toEqual([
      { url: `${ENTRIES}2026-03-31-nara.ttl`, reason: "schemaVersion" },
    ]);
    const index = await readBack(pod.body(INDEX_URL));
    expect(index.entries).toHaveLength(1);
  });

  it("reports what it read and what it published, and they are different numbers", async () => {
    const pod = recoveryPod();
    const r = await rebuild();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // read counts the .ttl members it attempted; published counts what reached
    // the index. Collapsing the two hides exactly the draft/entry gap the report
    // exists to surface.
    expect(r.value).toEqual({
      read: 3,
      published: 2,
      skipped: [],
      indexUrl: INDEX_URL,
    });
    expect(pod.put(INDEX_URL)).toHaveLength(1);
  });

  it("creates the index with If-None-Match when there is none", async () => {
    // The §10 failure "step 1 succeeded, step 3 failed" with the index never
    // written at all: the recovery must create, not update.
    const pod = recoveryPod();
    const r = await rebuild();

    expect(r.ok).toBe(true);
    const [sent] = pod.put(INDEX_URL);
    expect(sent.headers["if-none-match"]).toBe("*");
    expect(sent.headers["if-match"]).toBeUndefined();
  });

  it("updates an existing index with If-Match carrying the ETag it just read", async () => {
    const pod = recoveryPod({ [INDEX_URL]: "@prefix x: <urn:x:> .\n<#it> x:stale true .\n" });
    const before = pod.etagOf(INDEX_URL);
    const r = await rebuild();

    expect(r.ok).toBe(true);
    const [sent] = pod.put(INDEX_URL);
    expect(sent.headers["if-match"]).toBe(before);
    expect(sent.headers["if-none-match"]).toBeUndefined();

    // And the stale index really was replaced, not merged into.
    expect(pod.body(INDEX_URL)).not.toContain("stale");
  });

  it("refuses to overwrite an index whose ETag the server will not give it", async () => {
    // A server that serves the index but no ETag leaves no safe update. §10
    // allows two preconditions and no third; `If-Match: *` would be a blind PUT
    // wearing one. So the write is attempted as a create, the server refuses,
    // and the existing index survives untouched.
    const pod = fakePod(
      {
        [ENTRIES]: containerTurtle(["2026-03-29-arrival.ttl"]),
        [`${ENTRIES}2026-03-29-arrival.ttl`]: entryFixture("2026-03-29-arrival"),
        [INDEX_URL]: "@prefix x: <urn:x:> .\n<#it> x:precious true .\n",
      },
      { noEtag: true },
    );
    const r = await rebuild();

    const [sent] = pod.put(INDEX_URL);
    expect(sent.headers["if-none-match"]).toBe("*");
    expect(sent.headers["if-match"]).toBeUndefined();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: INDEX_URL, status: 412 });
    expect(pod.body(INDEX_URL)).toContain("precious");
  });

  it("reports failure when the index write is rejected, never a success with nothing written", async () => {
    // This project's signature failure: a recovery path that returns ok having
    // rebuilt nothing. The owner is told the trip is fixed and it is not.
    const pod = recoveryPod({}, { fail: { [INDEX_URL]: 409 } });
    const r = await rebuild();

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: INDEX_URL, status: 409 });
    expect(pod.body(INDEX_URL)).toBeUndefined();
  });

  it("propagates a failed enumeration and writes nothing at all", async () => {
    // A 403 on the container means the rebuild has no idea what exists.
    // Regenerating "from scratch" on that basis writes an EMPTY index over a
    // good one — the recovery destroying what it came to fix.
    const pod = fakePod(
      { [INDEX_URL]: "@prefix x: <urn:x:> .\n<#it> x:precious true .\n" },
      { fail: { [ENTRIES]: 403 } },
    );
    const r = await rebuild();

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toEqual({ kind: "http", url: ENTRIES, status: 403 });
    expect(pod.requests.filter((q) => q.method === "PUT")).toHaveLength(0);
    expect(pod.body(INDEX_URL)).toContain("precious");
  });

  it("writes an empty index for a trip whose every entry is a draft", async () => {
    // Not an error: an all-draft trip legitimately has an empty public index,
    // and refusing would leave a stale index listing entries since unpublished.
    const pod = fakePod({
      [ENTRIES]: containerTurtle(["2026-04-02-secret.ttl"]),
      [`${ENTRIES}2026-04-02-secret.ttl`]: entryFixture("2026-04-02-secret", { draft: true }),
    });
    const r = await rebuild();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ read: 1, published: 0, skipped: [] });

    const index = await readBack(pod.body(INDEX_URL));
    expect(index.entries).toEqual([]);
    expect(index.entryCount).toBe(0);
    expect(index.bbox).toBeUndefined();
  });

  it("reads the entries concurrently, and bounded", async () => {
    // docs/data-model.md §13 item 6: "200 sequential reads against a hosted Pod
    // over real RTT … rebuildIndex must read concurrently regardless." Serial
    // is 200 x RTT, and unbounded is a self-inflicted denial of service against
    // the owner's Pod. Both halves, without pinning the constant.
    const slugs = Array.from({ length: 24 }, (_, i) => `2026-04-${String(i + 1).padStart(2, "0")}-day`);
    let inFlight = 0;
    let peak = 0;

    const pod = fakePod(
      {
        [ENTRIES]: containerTurtle(slugs.map((s) => `${s}.ttl`)),
        ...Object.fromEntries(slugs.map((s) => [`${ENTRIES}${s}.ttl`, entryFixture(s)])),
      },
      {
        onGet: async (url) => {
          if (!url.endsWith(".ttl") || url === INDEX_URL) return;
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight -= 1;
        },
      },
    );

    const r = await rebuild();
    expect(r.ok).toBe(true);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThan(slugs.length);
    expect(pod.body(INDEX_URL)).toBeDefined();
  });

  /**
   * NOT IMPLEMENTED, and left visible rather than quietly absent.
   *
   * docs/data-model.md §10 defines the operation as: "enumerate entries/ via
   * ldp:contains, read each entry, keep those with dy:status dy:Published,
   * regenerate entries.ttl from scratch, AND VERIFY EACH KEPT ENTRY'S ACL
   * MATCHES ITS STATUS." lib/pod/write.ts does the first four and not the last.
   *
   * It is the fourth clause that recovers §10's third failure mode — "step 1
   * succeeding with step 2 failing leaves a published-but-unreadable entry,
   * which the public site simply cannot see." Today's rebuild lists that entry
   * in the index and the public page 404s on it, so the recovery makes the
   * symptom worse: an advertised link to a resource the reader cannot fetch.
   *
   * A green test asserting the current behaviour would enshrine the gap; a red
   * one would leave the suite failing for something nobody has asked for yet.
   * So: todo, reported, not fixed.
   */
  it.todo("verifies each kept entry's ACL matches its status (§10) — not implemented");
});

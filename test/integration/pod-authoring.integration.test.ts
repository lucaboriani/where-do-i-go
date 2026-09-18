import { beforeAll, describe, expect, it } from "vitest";
import { Parser } from "n3";
import { LDP, SCHEMA, SCHEMA_VERSION } from "@/lib/vocab";
import { createContainer, makePrivate, makePublic } from "@/lib/pod/access";
import { ensurePodInitialised } from "@/lib/pod/bootstrap";
import { diaryUrl, readDiary, tripIndexUrl, tripUrl } from "@/lib/pod/read";
import { describe as renderError } from "@/lib/pod/result";
import { saveEntry } from "@/lib/pod/save-entry";
import { publishTrip, saveTrip, unpublishTrip } from "@/lib/pod/save-trip";
import type { Entry, Trip } from "@/lib/pod/schema";

/** Task 2.4 — the ACL-privacy proof, against a real Community Solid Server.
 *  THE CRITICAL CASE (§20): unpublish must reconcile each indexed entry's OWN
 *  ACL, not just the container's, or a published entry stays public — only a
 *  real server can prove that (phase 0, decision 4). Skips, not passes, with
 *  no Pod on :3001; self-provisions a fresh account, like the other two. */

const BASE = process.env.TEST_POD ?? "http://localhost:3001";

async function json(url: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `CSS-Account-Token ${token}`;
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.json() as Promise<Record<string, never>>;
}

let podUp = false;
let POD = "";
let webId = "";
let ownerFetch: typeof globalThis.fetch = globalThis.fetch;

beforeAll(async () => {
  try {
    podUp = (await fetch(`${BASE}/.account/`)).ok;
  } catch {
    podUp = false;
  }
  if (!podUp) return;

  const acct = await json(`${BASE}/.account/account/`, {});
  const token = acct.authorization as unknown as string;
  const controls = (await json(`${BASE}/.account/`, undefined, token)).controls as unknown as {
    password: { create: string };
    account: { pod: string; clientCredentials: string };
  };
  const name = `authoring-${Date.now()}`;
  await json(controls.password.create, { email: `${name}@localhost.test`, password: "throwaway" }, token);
  const pod = (await json(controls.account.pod, { name }, token)) as unknown as { pod: string };
  POD = pod.pod;
  webId = `${POD}profile/card#me`;

  const cc = (await json(controls.account.clientCredentials, { name, webId }, token)) as unknown as {
    id: string;
    secret: string;
  };
  const { Session } = await import("@inrupt/solid-client-authn-node");
  const session = new Session();
  await session.login({ clientId: cc.id, clientSecret: cc.secret, oidcIssuer: BASE });
  ownerFetch = session.fetch;
}, 60_000);

/* ------------------------------------------------------------------- fixture */

const SLUG = "2026-integration";
const NOW = "2026-04-20T18:02:11+02:00";

const baseTrip = (): Trip => ({
  iri: `${tripUrl(POD, SLUG)}#it`,
  slug: SLUG,
  status: "draft",
  schemaVersion: SCHEMA_VERSION,
  name: { value: "Integration trip", language: "en" },
  tags: [],
});

const PUBLISHED_HEADLINE = "A published entry, readable by anyone";
const publishedEntrySlug = "2026-05-01-published";
const publishedEntryUrl = () => `${tripUrl(POD, SLUG).replace(/trip\.ttl$/, "")}entries/${publishedEntrySlug}.ttl`;

const publishedEntry = (): Entry => ({
  iri: `${publishedEntryUrl()}#it`,
  slug: publishedEntrySlug,
  status: "published",
  schemaVersion: SCHEMA_VERSION,
  headline: { value: PUBLISHED_HEADLINE, language: "en" },
  sections: [],
  tags: [],
});

const DRAFT_HEADLINE = "A draft entry, never for the public";
const draftEntrySlug = "2026-05-02-draft";
const draftEntryUrl = () => `${tripUrl(POD, SLUG).replace(/trip\.ttl$/, "")}entries/${draftEntrySlug}.ttl`;

const draftEntry = (): Entry => ({
  iri: `${draftEntryUrl()}#it`,
  slug: draftEntrySlug,
  status: "draft",
  schemaVersion: SCHEMA_VERSION,
  headline: { value: DRAFT_HEADLINE, language: "en" },
  sections: [],
  tags: [],
});

const entriesContainerUrl = () => `${tripUrl(POD, SLUG).replace(/trip\.ttl$/, "")}entries/`;

/** A logged-out reader. No session, no Solid library — the public path exactly. */
const anon = (url: string) => fetch(url, { headers: { accept: "text/turtle" } });

/** A resource's CURRENT etag, via a fresh authenticated read — never the etag
 *  off a write response. Measured against CSS 7.2.0: a PUT's 201/205 carries
 *  no ETag header at all (only GET/HEAD does), so `report.etag` is `null`
 *  here on every call — documented, correct behaviour, and why every write
 *  below re-reads rather than chaining a prior write's own response. */
async function currentEtag(url: string): Promise<string> {
  const res = await ownerFetch(url, { method: "HEAD" });
  expect(res.status).toBe(200);
  const etag = res.headers.get("etag");
  if (!etag) throw new Error(`${url} answered 200 with no ETag — cannot condition the next write on it`);
  return etag;
}

const objectOf = (body: string, baseIRI: string, predicate: string) =>
  new Parser({ baseIRI }).parse(body).find((q) => q.predicate.value === predicate)?.object.value;

/** 200 AND the payload. A status asserted without its body is how a zero-byte
 *  404 shipped once already (CLAUDE.md, "half a check"). */
async function expectPublicTriple(url: string, predicate: string, value: string) {
  const res = await anon(url);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body.length).toBeGreaterThan(0);
  expect(objectOf(body, url, predicate)).toBe(value);
}

/** Denied AND leaking nothing — the real HTTP status, not merely "not in a
 *  list" (task-2-brief.md). */
async function expectDenied(url: string, mustNotContain: string[]) {
  const res = await anon(url);
  expect([401, 403]).toContain(res.status);
  const body = await res.text();
  for (const secret of mustNotContain) expect(body).not.toContain(secret);
}

/* ------------------------------------------------------------------ the tests */

describe("ensurePodInitialised on a fresh container", () => {
  it("yields a readDiary-valid dy:Diary", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const init = await ensurePodInitialised({ fetch: ownerFetch, podRoot: POD, webId, now: () => NOW });
    expect(init.ok, init.ok ? "" : renderError(init.error)).toBe(true);

    const diary = await readDiary(diaryUrl(POD));
    expect(diary.ok, diary.ok ? "" : renderError(diary.error)).toBe(true);
    if (!diary.ok) return;
    expect(diary.value.schemaVersion).toBe(SCHEMA_VERSION);
    // Fresh pod, nothing published yet — the published-only boundary (§7.1)
    // starts empty, not populated with a placeholder row.
    expect(diary.value.trips).toEqual([]);
  }, 30_000);
});

describe("saveTrip -> saveEntry -> publishTrip: a published entry becomes public", () => {
  let ranFirstStep = false;

  it("creates a draft trip, adds a published entry, and publishing makes it public and lists it in the diary", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const created = await saveTrip({ fetch: ownerFetch, trip: baseTrip(), podRoot: POD, webId, now: () => NOW });
    expect(created.failed, created.failed && renderError(created.failed.error)).toBeUndefined();

    // Not passing tripStatus: Task 2.2's guard is threaded by its callers in
    // Stage 3/4 (task-2-brief.md, Task 2.5), so this integration proof is
    // about the ACL mechanics rather than the guard, which save-entry.test.ts
    // already covers against a mocked Pod.
    const entrySaved = await saveEntry({
      fetch: ownerFetch,
      entry: publishedEntry(),
      precondition: { create: true },
      indexUrl: tripIndexUrl(POD, SLUG),
      tripIri: baseTrip().iri,
      tripSlug: SLUG,
      revalidate: () => {},
      webId,
      now: () => NOW,
    });
    expect(entrySaved.failed, entrySaved.failed && renderError(entrySaved.failed.error)).toBeUndefined();

    // The etag from THE READ THAT PRODUCED THE EDITED STATE (§10) — never off
    // a write response: measured against this server, a PUT's 201/205 carries
    // no ETag at all (see `currentEtag`'s own doc).
    const publishEtag = await currentEtag(tripUrl(POD, SLUG));
    const published = await publishTrip({
      fetch: ownerFetch,
      trip: { ...baseTrip(), status: "draft" },
      podRoot: POD,
      etag: publishEtag,
      webId,
      now: () => NOW,
    });
    expect(published.failed, published.failed && renderError(published.failed.error)).toBeUndefined();
    expect(published.completed).toEqual(["trip", "acl", "diary"]);
    ranFirstStep = true;

    // The evidence that counts: an anonymous reader, not the owner's session.
    await expectPublicTriple(publishedEntryUrl(), SCHEMA.headline, PUBLISHED_HEADLINE);

    const diary = await readDiary(diaryUrl(POD));
    expect(diary.ok, diary.ok ? "" : renderError(diary.error)).toBe(true);
    if (diary.ok) expect(diary.value.trips).toContain(baseTrip().iri);
  }, 60_000);

  it("unpublishTrip denies the SAME unauthenticated read — the §20 reconciliation, proven against a real server", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);
    if (!ranFirstStep) ctx.skip("the publish step above did not complete");

    // The premise: the entry really is public right now, established by the
    // test above rather than assumed here.
    await expectPublicTriple(publishedEntryUrl(), SCHEMA.headline, PUBLISHED_HEADLINE);

    const unpublished = await unpublishTrip({
      fetch: ownerFetch,
      trip: { ...baseTrip(), status: "published" },
      podRoot: POD,
      etag: await currentEtag(tripUrl(POD, SLUG)),
      webId,
      now: () => NOW,
    });
    expect(unpublished.failed, unpublished.failed && renderError(unpublished.failed.error)).toBeUndefined();
    expect(unpublished.completed).toEqual(["trip", "acl", "diary"]);

    // THE CRITICAL CASE: flipping only the container ACL would leave this
    // entry's OWN prior public-read ACL in place (§20) — a bytes leak that
    // reads as a success everywhere except here.
    await expectDenied(publishedEntryUrl(), [PUBLISHED_HEADLINE]);

    const diary = await readDiary(diaryUrl(POD));
    expect(diary.ok, diary.ok ? "" : renderError(diary.error)).toBe(true);
    if (diary.ok) expect(diary.value.trips).not.toContain(baseTrip().iri);
  }, 60_000);
});

describe("makePublic observes the just-written ACL through a browser-shaped cache", () => {
  /* task-5b root cause, modelled at the HTTP layer: CSS serves an `.acl` GET
   * with Last-Modified and no Cache-Control, so a browser heuristically caches
   * it and a PUT does not reliably evict it — the verify read then sees the
   * pre-write ACL. Node's fetch has none, so it is invisible unless modelled.
   * Honours `cache: "no-store"` (the fix) and never evicts on PUT (the browser
   * behaviour that causes it). */
  function browserishAclCache(inner: typeof globalThis.fetch): typeof globalThis.fetch {
    const store = new Map<string, Response>();
    return async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init?.method ?? "GET").toUpperCase();
      const cacheable = method === "GET" && url.endsWith(".acl") && init?.cache !== "no-store";
      if (cacheable && store.has(url)) return store.get(url)!.clone();
      const res = await inner(input, init);
      if (cacheable && res.ok) store.set(url, res.clone());
      return res;
    };
  }

  const containerUrl = () => `${POD}travel/trips/2026-cachefix/`;

  it("reports success rather than a stale acl:default read=false, and the write really took", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const init = await ensurePodInitialised({ fetch: ownerFetch, podRoot: POD, webId, now: () => NOW });
    expect(init.ok, init.ok ? "" : renderError(init.error)).toBe(true);

    // Create as a draft: its .acl carries acl:default read=false. Every read of
    // that .acl in the publish below is served from the browser-shaped cache.
    const cached = browserishAclCache(ownerFetch);
    const made = await createContainer(containerUrl(), { fetch: cached, webId, publicChildren: false });
    expect(made.ok, made.ok ? "" : renderError(made.error)).toBe(true);

    // Publish: resolve/readAcl re-read the draft .acl (default read=false) and
    // repopulate the cache, the PUT sets read=true, and the verify read must see
    // read=true — reachable through this cache only by bypassing it. Before the
    // fix this failed accessUnverified "acl:default read=false".
    const pub = await makePublic(containerUrl(), { fetch: cached, webId });
    expect(pub.ok, pub.ok ? "" : renderError(pub.error)).toBe(true);
    if (!pub.ok) return;
    expect(pub.value).toMatchObject({ inherits: true, read: false });

    // The evidence that counts (phase 0): a real anonymous read of a child. The
    // write was correct all along — only the verify read had lagged.
    const child = `${containerUrl()}trip.ttl`;
    await ownerFetch(child, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body: `<#it> <${SCHEMA.headline}> "cachefix"@en .\n`,
    });
    await expectPublicTriple(child, SCHEMA.headline, "cachefix");
  }, 60_000);
});

describe("setDocumentPublicRead observes the just-written access through a browser-shaped cache", () => {
  /* Finding 2 (task-5b): the document verify is a read-back too, and CSS serves a
   * regular resource with the SAME heuristically-cacheable shape as `.acl`
   * (Last-Modified, no Cache-Control) — measured. This cache serves a HEAD from a
   * stored read (RFC 9111 §4.3.5), honours `cache: "no-store"` (the fix) and never
   * evicts on PUT. getResourceInfo HEADs the resource, so without the bypass the
   * verify reads a stale WAC-Allow. */
  function browserishResourceCache(inner: typeof globalThis.fetch): typeof globalThis.fetch {
    const store = new Map<string, Response>();
    return async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (
        init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")
      ).toUpperCase();
      const cacheable = (method === "GET" || method === "HEAD") && !url.endsWith(".acl") && init?.cache !== "no-store";
      if (cacheable && store.has(url)) return store.get(url)!.clone();
      const res = await inner(input, init);
      if (cacheable && res.ok && res.headers.has("last-modified") && !res.headers.has("cache-control")) {
        store.set(url, res.clone());
      }
      return res;
    };
  }

  const docUrl = () => `${POD}travel/cachefix-doc.ttl`;

  it("reports read=true rather than a stale WAC-Allow read=false, and the doc is really public", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const init = await ensurePodInitialised({ fetch: ownerFetch, podRoot: POD, webId, now: () => NOW });
    expect(init.ok, init.ok ? "" : renderError(init.error)).toBe(true);

    await ownerFetch(docUrl(), {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body: `<#it> <${SCHEMA.headline}> "doc-cachefix"@en .\n`,
    });
    const priv = await makePrivate(docUrl(), { fetch: ownerFetch });
    expect(priv.ok, priv.ok ? "" : renderError(priv.error)).toBe(true);

    // Prime the cache with the private WAC-Allow, then publish through it — the
    // verify HEAD would be served that stale read=false without the bypass.
    const cached = browserishResourceCache(ownerFetch);
    await cached(docUrl(), { method: "HEAD" });
    const pub = await makePublic(docUrl(), { fetch: cached });
    expect(pub.ok, pub.ok ? "" : renderError(pub.error)).toBe(true);
    if (!pub.ok) return;
    expect(pub.value).toMatchObject({ read: true, inheritsVerifiedBy: "notApplicable" });

    // The evidence that counts (phase 0): a real anonymous read of the doc.
    await expectPublicTriple(docUrl(), SCHEMA.headline, "doc-cachefix");
  }, 60_000);
});

describe("a draft entry inside a published trip", () => {
  it("re-publishes the trip and adds a draft entry alongside the published one", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // ensurePodInitialised is idempotent (§5) — re-running it here is a no-op
    // on the containers and diary.ttl this suite's first describe already
    // created, and it keeps this describe runnable on its own rather than
    // reaching across describes for state that may not have run.
    const current = await ensurePodInitialised({ fetch: ownerFetch, podRoot: POD, webId, now: () => NOW });
    expect(current.ok, current.ok ? "" : renderError(current.error)).toBe(true);

    const republished = await publishTrip({
      fetch: ownerFetch,
      trip: { ...baseTrip(), status: "draft" },
      podRoot: POD,
      etag: await currentEtag(tripUrl(POD, SLUG)),
      webId,
      now: () => NOW,
    });
    expect(republished.failed, republished.failed && renderError(republished.failed.error)).toBeUndefined();

    // The published entry is public again too — publishTrip restores each
    // indexed entry's own ACL (save-trip.test.ts's own coverage of this,
    // reproduced here against the real server).
    await expectPublicTriple(publishedEntryUrl(), SCHEMA.headline, PUBLISHED_HEADLINE);

    const draftSaved = await saveEntry({
      fetch: ownerFetch,
      entry: draftEntry(),
      precondition: { create: true },
      indexUrl: tripIndexUrl(POD, SLUG),
      tripIri: baseTrip().iri,
      tripSlug: SLUG,
      revalidate: () => {},
      webId,
      now: () => NOW,
    });
    expect(draftSaved.failed, draftSaved.failed && renderError(draftSaved.failed.error)).toBeUndefined();
  }, 60_000);

  it("is denied to an unauthenticated reader even though the trip is published", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // The allow-case first: the trip really is public right now, or "denied"
    // below would be true for the uninteresting reason that everything is.
    await expectPublicTriple(publishedEntryUrl(), SCHEMA.headline, PUBLISHED_HEADLINE);

    await expectDenied(draftEntryUrl(), [DRAFT_HEADLINE]);
  }, 30_000);

  it("does not let an unauthenticated container GET enumerate the draft's slug — the LISTING itself is closed (§20)", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    /** Measured, not assumed: a public container grants `acl:default` but
     *  never `acl:accessTo` on itself (access.ts; pod-access.integration
     *  .test.ts's "keeps children readable while closing the listing") — so
     *  "does not enumerate the draft's slug" is a DENIED container GET, not a
     *  200 whose `ldp:contains` happens to omit one entry. */
    await expectDenied(entriesContainerUrl(), [draftEntrySlug, DRAFT_HEADLINE]);

    // The allow-case for THIS invariant specifically: the listing being
    // closed must not also break direct reads of the published sibling by its
    // own URL, re-asserted here so this test does not depend on the previous
    // one having run to be meaningful.
    await expectPublicTriple(publishedEntryUrl(), SCHEMA.headline, PUBLISHED_HEADLINE);

    // And the OTHER allow-case: the owner's own session still enumerates —
    // "closed" must mean closed to the public, not to the studio that has to
    // list drafts to edit them.
    const owned = await ownerFetch(entriesContainerUrl(), { headers: { accept: "text/turtle" } });
    expect(owned.status).toBe(200);
    const contained = new Parser({ baseIRI: entriesContainerUrl() })
      .parse(await owned.text())
      .filter((q) => q.predicate.value === LDP.contains)
      .map((q) => q.object.value);
    expect(contained).toEqual(expect.arrayContaining([publishedEntryUrl(), draftEntryUrl()]));
  }, 30_000);
});

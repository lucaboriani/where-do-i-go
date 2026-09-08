import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Parser } from "n3";
import { DY, LDP, NS, SCHEMA } from "@/lib/vocab";
import {
  applyContainerRules,
  createContainer,
  getAccess,
  initialiseContainers,
  makePrivate,
  makePublic,
  putAcl,
  resolveContainerAcl,
} from "@/lib/pod/access";
import type { InitReport } from "@/lib/pod/access";
import { readPrivacySettings } from "@/lib/pod/read";
import { putGuarded } from "@/lib/pod/write";
import { mediaContainer, mediaHash, uploadPhoto } from "@/lib/media/upload";
import { describe as renderError, type Result } from "@/lib/pod/result";
import { graphEquals } from "@/test/graph";

/**
 * lib/pod/access.ts against a real Community Solid Server 7.2.0 — the WAC half
 * of what phase 0 tested.
 *
 * WHY THIS FILE EXISTS AT ALL. A 2xx on an ACL write proves nothing
 * (docs/phase-0-spike.md); the only evidence that counts is a read that fails
 * from a logged-out context. Nothing mocked can produce that evidence, because
 * the thing under test is the server's access-control engine reacting to what
 * we wrote. So every assertion about access here is made with the plain,
 * unauthenticated global `fetch` — no session, no Solid library — and paired
 * with the owner's fetch, so a rule that denies everyone cannot pass.
 *
 * MECHANISM COVERAGE, HONESTLY. This runs against WAC only. Phase 0 verified
 * the container-listing fix (public `acl:default` without `acl:accessTo`) on
 * CSS and could not verify an ACP equivalent — ACP has no split of that shape
 * (docs/decisions.md §20). So the "listing is closed" assertions below are
 * evidence for WAC and for nothing else; on a hosted ACP Pod, assume draft
 * slugs are discoverable until someone proves otherwise. The implementation
 * must still not branch on mechanism (§19): `rel="acl"` does not mean WAC, and
 * this suite passing on CSS is not permission to detect a server type.
 *
 * Skips — as skips, not passes — when no Pod is running. Start one with
 * `npm run pod:dev`.
 */

const BASE = process.env.TEST_POD ?? "http://localhost:3001";

/** The §7 Turtle blocks are normative; a hand-copied fixture would test a copy
 *  of the spec instead of the spec (docs/data-model.md §1). */
const doc = readFileSync("docs/data-model.md", "utf8");
const [, TRIP, ENTRY, , , , PRIVACY] = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map(
  (m) => m[1],
);

/**
 * The owner's home latitude, out of the §7.6 fixture. Used as the leak marker
 * below, and it satisfies the rule the other markers in this file follow: it
 * shares no substring with any URL it will be fetched from, so a "did not leak"
 * assertion cannot be satisfied by the request path echoed back in an error
 * envelope — the false positive phase 0 had to correct.
 */
const HOME_LAT = "45.4655";

/**
 * A negative fixture built by string replacement passes on the UNMODIFIED
 * fixture if an anchor stops matching. Throwing on a missing anchor makes the
 * edit's failure loud instead of turning this file green for the wrong reason.
 *
 * The shape check is not defensive noise. Passing a FLAT array — `[from, to]`
 * instead of `[[from, to]]` — type-checks against nothing at the call site once
 * the argument is inferred, and then destructuring a string yields its first two
 * CHARACTERS: `from = "d"`, `to = "y"`. `acc.includes("d")` is true, so the
 * anchor guard is satisfied, and the fixture is corrupted one character at a
 * time. That happened while writing this file: `@prefix xsd:` silently became
 * `@prefix xsy:`. It surfaced as a parse error, but an edit landing in a literal
 * instead would have surfaced as nothing at all.
 */
function mutate(source: string, edits: [from: string, to: string][]): string {
  return edits.reduce((acc, edit) => {
    if (!Array.isArray(edit) || edit.length !== 2) {
      throw new Error(`fixture edit must be a [from, to] pair, got: ${JSON.stringify(edit)}`);
    }
    const [from, to] = edit;
    // A one- or two-character anchor is never a deliberate fixture edit; it is
    // the destructured-string mistake above.
    if (from.length < 4) throw new Error(`fixture anchor is too short to be deliberate: ${JSON.stringify(from)}`);
    if (!acc.includes(from)) throw new Error(`fixture anchor not found, edit would be silent: ${from}`);
    const next = acc.replace(from, to);
    if (next === acc) throw new Error(`fixture edit changed nothing: ${from} -> ${to}`);
    return next;
  }, source);
}

/** Deliberately shares no substring with the draft's URL: phase 0 once reported
 *  a content leak that was really the request path echoed in the error
 *  envelope. Assert on something that can only come from the body. */
const DRAFT_HEADLINE = "Not for publication: the ryokan bill";

const DRAFT = mutate(ENTRY, [
  ['schema:headline      "First night in Shinjuku"@en', `schema:headline      "${DRAFT_HEADLINE}"@en`],
  ['dy:slug              "2026-03-29-arrival"', 'dy:slug              "2026-04-02-kanazawa"'],
  ["dy:status            dy:Published", "dy:status            dy:Draft"],
]);

/** A second entry, for a trip the fixture tree does not otherwise contain.
 *  Its headline shares no substring with any URL it will be fetched from, so a
 *  leak assertion cannot be satisfied by the request path echoed in an error
 *  envelope — the false positive phase 0 had to correct. */
const KOREA_HEADLINE = "Bukchon in the rain";

/** For the private container. Its headline is not a substring of its URL. */
const PRIVATE_HEADLINE = "The receipt from the ryokan";

const PRIVATE_ENTRY = mutate(ENTRY, [
  ['schema:headline      "First night in Shinjuku"@en', `schema:headline      "${PRIVATE_HEADLINE}"@en`],
  ['dy:slug              "2026-03-29-arrival"', 'dy:slug              "receipt"'],
]);

const KOREA_ENTRY = mutate(ENTRY, [
  ['schema:headline      "First night in Shinjuku"@en', `schema:headline      "${KOREA_HEADLINE}"@en`],
  ['dy:slug              "2026-03-29-arrival"', 'dy:slug              "2026-05-01-seoul"'],
]);

let podUp = false;
let POD = "";
let webId = "";
let ownerFetch: typeof globalThis.fetch = globalThis.fetch;
let firstRun: Result<InitReport>;

const u = {
  travel: () => `${POD}travel/`,
  trips: () => `${POD}travel/trips/`,
  media: () => `${POD}travel/media/`,
  tripContainer: () => `${POD}travel/trips/2026-japan/`,
  tripDoc: () => `${POD}travel/trips/2026-japan/trip.ttl`,
  entries: () => `${POD}travel/trips/2026-japan/entries/`,
  published: () => `${POD}travel/trips/2026-japan/entries/2026-03-29-arrival.ttl`,
  draft: () => `${POD}travel/trips/2026-japan/entries/2026-04-02-kanazawa.ttl`,
  settings: () => `${POD}travel/settings/`,
  privacy: () => `${POD}travel/settings/privacy.ttl`,
  scoped: () => `${POD}scoped/`,
};

/* ------------------------------------------------------------- pod provisioning */

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

/** Setup writes assert themselves. A fixture that silently failed to land
 *  makes every assertion below fail — or worse, pass — for a reason that is not
 *  the code under test. */
async function written(res: Response, url: string) {
  if (!res.ok) {
    throw new Error(
      `setup could not write ${url}: HTTP ${res.status}. ` +
        `The assertions below would be about the fixture, not about lib/pod/access.ts.`,
    );
  }
  return res;
}

const putAsOwner = async (url: string, body: string) =>
  written(
    await ownerFetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body,
    }),
    url,
  );

/**
 * A container created by a bare PUT, with no ACL of its own.
 *
 * THIS IS NOT WHAT PRODUCTION DOES, DELIBERATELY. No code in this project
 * creates a container this way any more — `createContainer` does creation and
 * access as one operation, precisely because this shape leaks: `acl:default`
 * inherits recursively, so a container below `travel/trips/` with no ACL of its
 * own is covered by the parent's default rule AS A RESOURCE, which makes its
 * LISTING public.
 *
 * It is kept, under a name that says so, because it is the negative control the
 * suite needs in two places:
 *
 *   - "makePublic ... keeps children readable while closing the listing" has to
 *     start from a container that IS enumerable, or the call under test is
 *     asserting a state it did not produce;
 *   - "createContainer ... the same container created by a raw PUT" measures the
 *     two shapes side by side at the same depth, which is the only way to show
 *     the closure comes from createContainer and not from an ancestor.
 *
 * It is also a real state a Pod can be in: a container made by another tool, or
 * by this project before the fix. makePublic has to be able to repair one.
 */
const createContainerWithNoAclOfItsOwn = async (url: string) =>
  written(
    await ownerFetch(url, {
      method: "PUT",
      headers: {
        "content-type": "text/turtle",
        "if-none-match": "*",
        link: `<${NS.ldp}BasicContainer>; rel="type"`,
      },
    }),
    url,
  );

/* ------------------------------------------------------------------- assertions */

/** A logged-out reader. No session, no Solid library — the public path exactly. */
const anon = (url: string) => fetch(url, { headers: { accept: "text/turtle" } });

const objectOf = (body: string, baseIRI: string, predicate: string) =>
  new Parser({ baseIRI }).parse(body).find((q) => q.predicate.value === predicate)?.object.value;

/** 200 AND the payload. A status asserted without its body is how a zero-byte
 *  404 shipped once already. */
async function expectPublicTriple(url: string, predicate: string, value: string) {
  const res = await anon(url);
  expect(res.status).toBe(200);
  const body = await res.text();
  expect(body.length).toBeGreaterThan(0);
  expect(objectOf(body, url, predicate)).toBe(value);
}

/* --------------------------------------------------- observing the request log */

/**
 * The precondition and the ACP refusal are both claims about REQUESTS — "the
 * If-Match came from the GET that was edited", "no write reached the
 * authorization host". Neither is visible in a return value, so these tests
 * wrap the owner's fetch and read the traffic.
 *
 * This is still the HTTP layer, not a stubbed library function: the requests
 * are the real ones @inrupt/solid-client makes, answered by the real server.
 */
type FetchInput = RequestInfo | URL;

const urlOf = (input: FetchInput) =>
  typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

const methodOf = (input: FetchInput, init?: RequestInit) =>
  (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();

/** Headers may arrive as a Headers, a plain object or on a Request. */
function headerOf(input: FetchInput, init: RequestInit | undefined, name: string): string | null {
  try {
    if (init?.headers) {
      const found = new Headers(init.headers).get(name);
      if (found !== null) return found;
    }
  } catch {
    /* an unparseable header set is not what is under test here */
  }
  if (typeof input === "object" && "headers" in input && input.headers instanceof Headers) {
    return input.headers.get(name);
  }
  return null;
}

type Recorded = {
  method: string;
  url: string;
  ifMatch: string | null;
  ifNoneMatch: string | null;
  status: number;
  etag: string | null;
};

const MUTATIONS = ["PUT", "PATCH", "POST", "DELETE"];

function recording(inner: typeof globalThis.fetch) {
  const log: Recorded[] = [];
  const wrapped: typeof globalThis.fetch = async (input, init) => {
    const res = await inner(input, init);
    log.push({
      method: methodOf(input, init),
      url: urlOf(input),
      ifMatch: headerOf(input, init, "if-match"),
      ifNoneMatch: headerOf(input, init, "if-none-match"),
      status: res.status,
      etag: res.headers.get("etag"),
    });
    return res;
  };
  return { fetch: wrapped, log };
}

/** A readable form for a failure message: methods and paths, Pod root elided. */
const summarise = (log: Recorded[]) => log.map((r) => `${r.method} ${r.url.replace(POD, "")}`).join(", ");

/**
 * Re-wrap a Response, PRESERVING `response.url`.
 *
 * Without this @inrupt/solid-client resolves every relative IRI in an ACL body
 * against "" and the parse fails for a reason that has nothing to do with the
 * thing under test. It cost the phase-2 spike two false failures.
 */
function reshape(res: Response, body: BodyInit | null, headers: Headers) {
  const out = new Response(body, { status: res.status, statusText: res.statusText, headers });
  Object.defineProperty(out, "url", { value: res.url });
  return out;
}

/** Denied AND leaking nothing. Both halves, for the same reason. */
async function expectDenied(url: string, mustNotContain: string[]) {
  const res = await anon(url);
  expect([401, 403]).toContain(res.status);
  const body = await res.text();
  for (const secret of mustNotContain) expect(body).not.toContain(secret);
}

/* ------------------------------------------------------------------------ setup */

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
  const name = `access-${Date.now()}`;
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

  // First run of the thing under test. Its result is asserted below; the rest of
  // the setup is what a deployer does immediately afterwards.
  firstRun = await initialiseContainers({ fetch: ownerFetch, podRoot: POD, webId });

  // Containers the studio creates later, deeper than anything initialisation
  // touched — this is where inheritance either works or the diary is unreadable.
  await createContainerWithNoAclOfItsOwn(u.tripContainer());
  await createContainerWithNoAclOfItsOwn(u.entries());
  await putAsOwner(u.tripDoc(), TRIP);
  await putAsOwner(u.published(), ENTRY);
  await putAsOwner(u.draft(), DRAFT);

  // §7.6, into the container initialiseContainers just created. Written by the
  // OWNER, into a container whose grandparent grants the public a read that
  // reaches everything else below it — which is exactly the condition under
  // which this document must still not be readable.
  await putAsOwner(u.privacy(), PRIVACY);

  // A sub-tree whose caller can WRITE but cannot CONTROL: public read+write,
  // no control, so an anonymous caller can create containers (2xx) and can
  // never set access. That is the shape of a deployer whose credentials lack
  // Control, and the only way to reproduce "the write succeeded and the access
  // did not take" against a server that otherwise does what it is told.
  await createContainerWithNoAclOfItsOwn(u.scoped());
  await putAsOwner(
    `${u.scoped()}.acl`,
    `@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n@prefix foaf: <${NS.foaf}>.\n` +
      `<#public> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Append, acl:Write.\n` +
      `<#owner> a acl:Authorization; acl:agent <${webId}>; acl:accessTo <./>; acl:default <./>; acl:mode acl:Read, acl:Write, acl:Control.\n`,
  );
}, 120_000);

/* ------------------------------------------------------------------------ tests */

describe("initialiseContainers", () => {
  it("creates the §4 containers and says so", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    expect(firstRun.ok, firstRun.ok ? "" : renderError(firstRun.error)).toBe(true);

    for (const container of [u.travel(), u.trips(), u.media()]) {
      const res = await ownerFetch(container, { headers: { accept: "text/turtle" } });
      expect(res.status).toBe(200);
      // Parsed, not merely non-empty: a container that answers 200 with a body
      // the RDF stack cannot read is not a container the studio can enumerate.
      const quads = new Parser({ baseIRI: container }).parse(await res.text());
      expect(quads.length).toBeGreaterThan(0);
    }
  }, 30_000);

  it("grants public read that INHERITS to resources created afterwards", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // The failure this pins: the CSS default grants acl:accessTo on the root
    // with no acl:default, and universalAccess.setPublicAccess documents that
    // "if the Resource is a Container, the configured Access will not apply to
    // contained Resources". A deployer who assumes it cascades ships a diary
    // whose every page is 401 — and the initialisation call that caused it
    // returned 2xx. trip.ttl is two containers below anything initialisation
    // created, so inheritance is the only way this can be readable.
    await expectPublicTriple(u.tripDoc(), DY.slug, "2026-japan");
    await expectPublicTriple(u.published(), SCHEMA.headline, "First night in Shinjuku");
  }, 30_000);

  it("does not leave the containers it created publicly enumerable", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // Draft content is protected by its own ACL on both WAC and ACP; draft
    // EXISTENCE and SLUG are not, because a publicly readable container can be
    // enumerated and ldp:contains names every resource in it. Slugs come from
    // titles (docs/decisions.md §20).
    //
    // "2026-japan" cannot appear in the responses below by accident: it is not
    // in either requested URL, so this is not the URL-echo false positive that
    // phase 0 had to correct.
    await expectDenied(u.travel(), ["2026-japan"]);
    await expectDenied(u.trips(), ["2026-japan"]);

    // The allow-case, which is what makes the rule useful rather than merely
    // restrictive: the authenticated studio still enumerates, or it can never
    // list drafts (§4, "the studio enumerates entries/ directly").
    const res = await ownerFetch(u.trips(), { headers: { accept: "text/turtle" } });
    expect(res.status).toBe(200);
    const contained = new Parser({ baseIRI: u.trips() })
      .parse(await res.text())
      .filter((q) => q.predicate.value === LDP.contains)
      .map((q) => q.object.value);
    expect(contained).toContain(u.tripContainer());
  }, 30_000);

  it("never grants the public write", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // "Public read, owner-only write" is the defining constraint of the project
    // (§5). Read access granted one mode too wide is not a smaller bug.
    const target = `${u.travel()}pwned.ttl`;
    const attempt = await fetch(target, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body: `<#it> <${DY.slug}> "pwned" .\n`,
    });
    expect([401, 403]).toContain(attempt.status);

    // Assert the mutation did not happen, not merely that the status looked
    // unhappy: a 401 on a request the server nevertheless applied is a thing.
    const check = await ownerFetch(target, { headers: { accept: "text/turtle" } });
    expect(check.status).toBe(404);
  }, 30_000);

  it("is idempotent: re-running changes neither content nor access", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // Status AND body, both times. If a re-run revoked the public read, `after`
    // would be an error page rather than Turtle, and comparing two unparseable
    // bodies is not the question this test asks.
    const beforeRes = await anon(u.tripDoc());
    expect(beforeRes.status).toBe(200);
    const before = await beforeRes.text();

    const second = await initialiseContainers({ fetch: ownerFetch, podRoot: POD, webId });
    // §5: "idempotent and safe to re-run". The first-run flow is what a
    // deployer retries after any failure, so a second run that reports an
    // error because the containers already exist — 412 from `If-None-Match: *`
    // — makes the recovery path indistinguishable from the failure it recovers.
    expect(second.ok, second.ok ? "" : renderError(second.error)).toBe(true);

    const afterRes = await anon(u.tripDoc());
    expect(afterRes.status).toBe(200);
    const after = await afterRes.text();
    // Triple sets, never bytes: Turtle has no canonical form (§11 guardrail 6).
    const comparison = graphEquals(before, after, u.tripDoc());
    expect(comparison).toMatchObject({ equal: true, missing: [], extra: [] });

    // Access was not reset in EITHER direction: the listing this run closed is
    // still closed, and the public read it granted still reaches two containers
    // down. Only asserting the denial would pass just as happily on a Pod the
    // re-run had locked down entirely.
    //
    // Whether a re-run reopens access that was DELIBERATELY TIGHTENED is a
    // different question and it cannot be asked here, because nothing has been
    // tightened at this point in the file. It is asked in "re-running
    // initialiseContainers after access has been tightened" below, which
    // explains why this distinction cost a red test.
    await expectDenied(u.travel(), ["2026-japan"]);
    await expectPublicTriple(u.published(), SCHEMA.headline, "First night in Shinjuku");
  }, 60_000);
});

describe("makePublic on a container created after first run", () => {
  it("keeps children readable while closing the listing", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // Per-trip entries/ containers are created by the studio, long after
    // initialisation, and they are exactly where drafts live. If makePublic on
    // a container means "make the listing public too", every draft slug in the
    // diary is enumerable — the leak decisions.md §20 records. So the contract
    // is: read that reaches the children, no enumeration of the container.
    // Verified on WAC; the ACP equivalent is untested (see the file header).

    // THE PREMISE, asserted rather than assumed — the makePrivate sibling below
    // does this and this test did not. entries/ was created with no ACL of its
    // own, so trips/'s public `acl:default` reaches it AS A RESOURCE and its
    // listing is open right now: §20's leak, live, one container deeper than
    // anything initialisation touched.
    //
    // Without this, "the listing is closed afterwards" would pass just as
    // happily on a container that was never enumerable in the first place, and
    // the call under test would be free to do nothing at all.
    //
    // "2026-04-02-kanazawa" is the DRAFT's slug and it is not in the requested
    // URL, so it can only have come from ldp:contains.
    const leakingBefore = await anon(u.entries());
    expect(leakingBefore.status).toBe(200);
    expect(await leakingBefore.text()).toContain("2026-04-02-kanazawa");

    const granted = await makePublic(u.entries(), { fetch: ownerFetch });
    expect(granted.ok, granted.ok ? "" : renderError(granted.error)).toBe(true);

    await expectPublicTriple(u.published(), SCHEMA.headline, "First night in Shinjuku");
    await expectDenied(u.entries(), ["2026-04-02-kanazawa"]);

    const res = await ownerFetch(u.entries(), { headers: { accept: "text/turtle" } });
    expect(res.status).toBe(200);
    const contained = new Parser({ baseIRI: u.entries() })
      .parse(await res.text())
      .filter((q) => q.predicate.value === LDP.contains)
      .map((q) => q.object.value);
    expect(contained).toEqual(expect.arrayContaining([u.published(), u.draft()]));
  }, 30_000);
});

describe("makePrivate", () => {
  it("takes a draft out of public reach, and the owner keeps it", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // The premise, asserted rather than assumed: inside a public-read container
    // the draft IS readable by anyone until something makes it private. Without
    // this, the assertion below could pass because the resource was never
    // reachable at all.
    await expectPublicTriple(u.draft(), SCHEMA.headline, DRAFT_HEADLINE);

    const r = await makePrivate(u.draft(), { fetch: ownerFetch });
    expect(r.ok, r.ok ? "" : renderError(r.error)).toBe(true);

    // The only evidence that counts (phase 0, decision 4 on both mechanisms).
    await expectDenied(u.draft(), [DRAFT_HEADLINE]);

    // The published sibling is untouched, and the owner still has the draft.
    await expectPublicTriple(u.published(), SCHEMA.headline, "First night in Shinjuku");
    const asOwner = await ownerFetch(u.draft(), { headers: { accept: "text/turtle" } });
    expect(asOwner.status).toBe(200);
    expect(objectOf(await asOwner.text(), u.draft(), SCHEMA.headline)).toBe(DRAFT_HEADLINE);
  }, 30_000);
});

describe("getAccess", () => {
  it("reports what a logged-out reader actually gets", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // Cross-checked against a real anonymous fetch in the same test, because
    // "what we wrote" and "what the server enforces" are different questions
    // and the studio's publish indicator answers only the second one usefully.
    const published = await getAccess(u.published(), { fetch: ownerFetch });
    expect(published.ok, published.ok ? "" : renderError(published.error)).toBe(true);
    if (!published.ok) return;
    expect(published.value).toMatchObject({ read: true, write: false });
    expect((await anon(u.published())).status).toBe(200);

    const draft = await getAccess(u.draft(), { fetch: ownerFetch });
    expect(draft.ok, draft.ok ? "" : renderError(draft.error)).toBe(true);
    if (!draft.ok) return;
    expect(draft.value).toMatchObject({ read: false, write: false });
    expect([401, 403]).toContain((await anon(u.draft())).status);
  }, 30_000);
});

describe("re-running initialiseContainers after access has been tightened", () => {
  it("does not reopen a draft that was made private", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    /**
     * WHY THIS IS A SEPARATE TEST AND NOT A LINE IN "is idempotent".
     *
     * It was a line in "is idempotent", and it could not hold there. Vitest
     * runs describes in declaration order, so at that point nothing had made
     * the draft private, and the draft was public by exactly the inheritance
     * from trips/ that "grants public read that INHERITS" requires two tests
     * earlier. Measured against CSS 7.2.0: there, the draft and its published
     * sibling both answer anonymous 200 and neither carries a per-resource ACL
     * — identical access — so the file was demanding 200 and 401 of the same
     * kind of resource with no access-changing call in between. No
     * implementation could satisfy both, and the one under review was right to
     * refuse to chase it.
     *
     * The intent was always the assertion below, and it is a real invariant:
     * the first-run flow is what a deployer retries after any failure, and a
     * retry that reopened every unpublished entry would be a data leak reported
     * as a success. Concretely it guards against an initialiseContainers that
     * walks the tree, or that rewrites a child's own ACL rather than only the
     * §4 containers' own.
     */

    // The premise is established HERE rather than inherited from the describe
    // above having run — depending on execution order across describes is the
    // mistake being corrected, not a pattern to repeat. makePrivate is
    // idempotent, so calling it again is free; asserting its effect first means
    // a re-run that changes nothing cannot pass this test by default.
    const tightened = await makePrivate(u.draft(), { fetch: ownerFetch });
    expect(tightened.ok, tightened.ok ? "" : renderError(tightened.error)).toBe(true);
    await expectDenied(u.draft(), [DRAFT_HEADLINE]);

    const again = await initialiseContainers({ fetch: ownerFetch, podRoot: POD, webId });
    expect(again.ok, again.ok ? "" : renderError(again.error)).toBe(true);

    // The whole point of the test: the tightening survived the re-run.
    await expectDenied(u.draft(), [DRAFT_HEADLINE]);

    // The allow-case, without which "still denied" would also pass on a Pod the
    // re-run had bricked: the published sibling in the same container is still
    // readable by anyone, and the owner still has the draft. A first-run flow
    // that achieves privacy by breaking the diary is not idempotent either.
    await expectPublicTriple(u.published(), SCHEMA.headline, "First night in Shinjuku");
    const asOwner = await ownerFetch(u.draft(), { headers: { accept: "text/turtle" } });
    expect(asOwner.status).toBe(200);
    expect(objectOf(await asOwner.text(), u.draft(), SCHEMA.headline)).toBe(DRAFT_HEADLINE);
  }, 60_000);
});

/**
 * RENAMED. This was called "when the writes succeed but the access does not take
 * effect", which is not what it reproduces: the caller here cannot read the
 * control document at all, so the module refuses before writing one. The 2xx-
 * shaped false success the old name described is reproduced in the describe
 * after this one, where an ACL write is accepted and silently discarded.
 *
 * What this one is really about is still worth a test — it is the deployer whose
 * credentials can write content but hold no Control, which is a common shape on
 * a shared Pod and the one place a "container created!" message is most tempting
 * and most wrong.
 */
describe("a caller that can write content but holds no Control", () => {
  it("refuses to report a container it could not secure", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // Fixture premise, asserted so the test cannot pass because nothing worked:
    // this caller CAN write (a 2xx is genuinely available to it) and CANNOT
    // read or write access (no Control). Phase 0's warning made reproducible.
    const canWrite = await fetch(`${u.scoped()}probe.ttl`, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-none-match": "*" },
      body: `<#it> <${DY.slug}> "probe" .\n`,
    });
    expect([200, 201, 204, 205]).toContain(canWrite.status);
    const cannotControl = await fetch(`${u.scoped()}.acl`, { headers: { accept: "text/turtle" } });
    expect([401, 403]).toContain(cannotControl.status);

    const r = await initialiseContainers({
      fetch: globalThis.fetch,
      podRoot: u.scoped(),
      webId,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(renderError(r.error).length).toBeGreaterThan(0);
    expect(r.error.url.startsWith(u.scoped())).toBe(true);

    /**
     * AND THE KIND — the assertion the test was named for and did not make.
     *
     * "not ok" passed here on any failure at all, including the ones that would
     * mean something different: a `network` would mean the Pod was unreachable
     * and the fixture above never ran; an `http` 404 would mean the container
     * was never created, i.e. the "writes succeed" half of the premise had
     * quietly stopped holding. The container creation DOES succeed here, so the
     * only honest answer is `accessUnverified`: written, and not confirmed.
     */
    expect(r.error.kind).toBe("accessUnverified");
    if (r.error.kind !== "accessUnverified") return;
    expect(r.error.expected.length).toBeGreaterThan(0);
    expect(r.error.found.length).toBeGreaterThan(0);

    // The half of the premise the old test asserted at a DIFFERENT path than the
    // one it exercised: the container itself really was created, so this is a
    // refusal after a successful write and not a failure to write.
    const created = await ownerFetch(`${u.scoped()}travel/`, { headers: { accept: "text/turtle" } });
    expect(created.status).toBe(200);
  }, 60_000);
});

describe("when the ACL write is accepted and takes no effect", () => {
  /**
   * The 2xx-shaped false success, reproduced against a real server.
   *
   * Phase 0: "a 200 write response proves nothing — the only evidence that
   * counts is the failed read". Here the ACL PUT is intercepted and answered
   * `201 Created` without ever reaching the server, so every status the module
   * sees is a success and nothing whatsoever has changed. An implementation that
   * trusts the status reports a secured container; this one has to read the
   * access back and notice it is not there.
   */
  it("reports accessUnverified rather than the success every status code implies", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const container = `${u.trips()}swallowed/`;
    const acl = `${container}.acl`;
    const child = `${container}trip.ttl`;
    await createContainerWithNoAclOfItsOwn(container);
    await putAsOwner(child, TRIP);

    // Premise: there is no control document here yet, so "it is still absent
    // afterwards" below means the write vanished rather than that it was a
    // no-op on something already correct.
    expect((await ownerFetch(acl, { headers: { accept: "text/turtle" } })).status).toBe(404);

    let swallowed = 0;
    const swallowing: typeof globalThis.fetch = async (input, init) => {
      if (MUTATIONS.includes(methodOf(input, init)) && urlOf(input) === acl) {
        swallowed += 1;
        return new Response(null, { status: 201, headers: { etag: '"pretend"' } });
      }
      return ownerFetch(input, init);
    };

    const r = await makePublic(container, { fetch: swallowing, webId });

    // The premise, both halves. A write WAS made and WAS accepted...
    expect(swallowed).toBeGreaterThan(0);
    // ...and it took no effect: the server still has no control document.
    expect((await ownerFetch(acl, { headers: { accept: "text/turtle" } })).status).toBe(404);

    expect(r.ok, r.ok ? `reported success: ${JSON.stringify(r.value)}` : "").toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("accessUnverified");
    expect(r.error.url).toBe(container);

    /**
     * THE ALLOW-CASE. The same call, on the same container, with a fetch that
     * does not swallow — it succeeds, and the container really is secured.
     *
     * Without it, "reports an error" is also what a makePublic that can never
     * configure anything would do, and the failure above would not be
     * attributable to the discarded write.
     */
    const honest = await makePublic(container, { fetch: ownerFetch, webId });
    expect(honest.ok, honest.ok ? "" : renderError(honest.error)).toBe(true);
    expect((await ownerFetch(acl, { headers: { accept: "text/turtle" } })).status).toBe(200);
    await expectDenied(container, ["trip.ttl"]);
    await expectPublicTriple(child, DY.slug, "2026-japan");
  }, 60_000);
});

/* ============================================================== createContainer */

describe("createContainer", () => {
  /**
   * The operation that creates a container AND sets its access as one step.
   *
   * It exists because the two halves cannot safely be separate: `acl:default`
   * inherits recursively, so a container created below `travel/trips/` with no
   * ACL of its own is covered by the parent's default rule as a resource in its
   * own right — which makes its LISTING public. Measured on CSS 7.2.0: an
   * anonymous `GET /travel/trips/2026-japan/` returned 200 with `ldp:contains`
   * naming every child. That is §20's leak one level down, on every trip and
   * entries container the studio will create, with slugs derived from titles.
   *
   * All of these are self-contained: each names its own containers, so none of
   * them depends on another describe having run first.
   */
  const KOREA = () => `${u.trips()}2026-korea/`;
  const KOREA_ENTRIES = () => `${KOREA()}entries/`;
  const KOREA_DOC = () => `${KOREA_ENTRIES()}2026-05-01-seoul.ttl`;

  it("closes the listing at creation time, without cutting off the children", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const trip = await createContainer(KOREA(), { fetch: ownerFetch, webId });
    expect(trip.ok, trip.ok ? "" : renderError(trip.error)).toBe(true);
    const entries = await createContainer(KOREA_ENTRIES(), { fetch: ownerFetch, webId });
    expect(entries.ok, entries.ok ? "" : renderError(entries.error)).toBe(true);
    await putAsOwner(KOREA_DOC(), KOREA_ENTRY);

    // 1. Denied to a logged-out reader, at BOTH levels, and leaking neither the
    //    child container's name nor the entry slug. "entries" is not a substring
    //    of the trip container's URL and "2026-05-01-seoul" is not a substring
    //    of the entries container's URL, so neither can be an echoed path.
    await expectDenied(KOREA(), ["entries"]);
    await expectDenied(KOREA_ENTRIES(), ["2026-05-01-seoul"]);

    // 2. And the diary still works: the entry two containers down is readable by
    //    anyone. Only asserting the denial would pass just as happily on a
    //    container that had been locked shut altogether.
    await expectPublicTriple(KOREA_DOC(), SCHEMA.headline, KOREA_HEADLINE);

    // 3. The authenticated studio still enumerates, or it can never list drafts.
    const listed = await ownerFetch(KOREA(), { headers: { accept: "text/turtle" } });
    expect(listed.status).toBe(200);
    const contained = new Parser({ baseIRI: KOREA() })
      .parse(await listed.text())
      .filter((q) => q.predicate.value === LDP.contains)
      .map((q) => q.object.value);
    expect(contained).toContain(KOREA_ENTRIES());

    // 4. The reported state, cross-checked against 1-3 rather than trusted.
    if (!trip.ok) return;
    expect(trip.value).toMatchObject({
      url: KOREA(),
      read: false,
      append: false,
      write: false,
      inherits: true,
      inheritsVerifiedBy: "rules",
    });
  }, 60_000);

  it("is the difference: the same container created by a raw PUT is enumerable", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    /**
     * The negative control, at the same depth and in the same parent as the test
     * above. Without it, "the listing is closed" could be true because of
     * something an ancestor did, and createContainer could be a no-op.
     */
    const leaky = `${u.trips()}leaky-control/`;
    const child = `${leaky}trip.ttl`;
    await createContainerWithNoAclOfItsOwn(leaky);
    await putAsOwner(child, TRIP);

    // The leak, live. "trip.ttl" is not in the requested URL.
    const leaked = await anon(leaky);
    expect(leaked.status).toBe(200);
    expect(await leaked.text()).toContain("trip.ttl");

    // The same container, through createContainer — which finds it already there
    // and sets the access anyway. That is also the idempotence case: §5 asks for
    // a first-run flow "safe to re-run", and this is the flow a deployer retries.
    const repaired = await createContainer(leaky, { fetch: ownerFetch, webId });
    expect(repaired.ok, repaired.ok ? "" : renderError(repaired.error)).toBe(true);

    await expectDenied(leaky, ["trip.ttl"]);
    // ...and the child that was readable a moment ago still is.
    await expectPublicTriple(child, DY.slug, "2026-japan");

    // Twice more, to make "idempotent" mean what it says rather than "works once".
    const again = await createContainer(leaky, { fetch: ownerFetch, webId });
    expect(again.ok, again.ok ? "" : renderError(again.error)).toBe(true);
    await expectDenied(leaky, ["trip.ttl"]);
    await expectPublicTriple(child, DY.slug, "2026-japan");
  }, 60_000);

  it("keeps the children private too when asked, and says so", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // §4's `/travel/media-private/`: a container whose CHILDREN are not public
    // either. This is the other value of publicChildren and the only thing that
    // makes `inherits` a measurement rather than a constant.
    const priv = `${u.travel()}media-private/`;
    const secret = `${priv}receipt.ttl`;

    const made = await createContainer(priv, { fetch: ownerFetch, webId, publicChildren: false });
    expect(made.ok, made.ok ? "" : renderError(made.error)).toBe(true);
    await putAsOwner(secret, PRIVATE_ENTRY);

    // The child is NOT readable — even though its grandparent travel/ grants a
    // public default that reaches everything else below it. Denied AND leaking
    // nothing: the headline can only have come from the body.
    await expectDenied(secret, [PRIVATE_HEADLINE]);
    const asOwner = await ownerFetch(secret, { headers: { accept: "text/turtle" } });
    expect(asOwner.status).toBe(200);
    expect(objectOf(await asOwner.text(), secret, SCHEMA.headline)).toBe(PRIVATE_HEADLINE);

    if (!made.ok) return;
    expect(made.value).toMatchObject({ url: priv, read: false, inherits: false, inheritsVerifiedBy: "rules" });

    // The allow-case for publicChildren, in the same run: a sibling under the
    // same grandparent, created with the default, IS readable. Without it, a
    // createContainer that denied everything would satisfy the assertions above.
    await expectPublicTriple(u.published(), SCHEMA.headline, "First night in Shinjuku");
  }, 60_000);

  it("refuses a URL with no trailing slash, and creates nothing at either spelling", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const noSlash = `${u.trips()}forgot-the-slash`;
    const r = await createContainer(noSlash, { fetch: ownerFetch, webId });

    expect(r.ok, r.ok ? `created something at ${noSlash}` : "").toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("accessUnverified");
    // The URL the caller passed, unmodified. A silently normalised one would
    // create a container the caller's other references do not point at.
    expect(r.error.url).toBe(noSlash);

    // And nothing exists at either spelling — asserted at the server, not just
    // from the absence of a request.
    expect((await ownerFetch(noSlash, { headers: { accept: "text/turtle" } })).status).toBe(404);
    expect((await ownerFetch(`${noSlash}/`, { headers: { accept: "text/turtle" } })).status).toBe(404);
  }, 30_000);
});

/* ========================================================== the evidence model */

describe("the evidence model: verifiedBy, inherits, inheritsVerifiedBy", () => {
  /**
   * These three fields are the module's account of HOW it knows what it reports,
   * and they had no coverage at all — an implementation that hard-coded every one
   * of them passed the entire suite. They are not decoration: the studio renders
   * "public" from them, and phase 0's whole finding is that a 2xx is not evidence.
   *
   * So each assertion below pairs the reported field with the thing it claims to
   * be about, and each field is exercised at BOTH of its values, because a
   * constant satisfies one of them whichever constant it is.
   */

  it("reports the §4 containers it secured, and each report matches the server", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    expect(firstRun.ok, firstRun.ok ? "" : renderError(firstRun.error)).toBe(true);
    if (!firstRun.ok) return;

    expect(firstRun.value.podRoot).toBe(POD);
    // The §4 layout, in order — not merely "some containers".
    expect(firstRun.value.containers.map((c) => c.url)).toEqual([
      u.travel(),
      u.trips(),
      u.media(),
      u.settings(),
    ]);

    // `inherits` now takes BOTH of its values inside initialiseContainers' own
    // report: three containers carry public read down to their children, and
    // travel/settings/ carries none (§4, §7.6). Until revision 4 every container
    // here was `inherits: true`, so a hard-coded `true` satisfied this test.
    expect(Object.fromEntries(firstRun.value.containers.map((c) => [c.url, c.inherits]))).toEqual({
      [u.travel()]: true,
      [u.trips()]: true,
      [u.media()]: true,
      [u.settings()]: false,
    });

    for (const container of firstRun.value.containers) {
      expect(container).toMatchObject({
        read: false,
        append: false,
        write: false,
        inheritsVerifiedBy: "rules",
      });
      // Never "server": no HTTP header answers "what would an anonymous request
      // to a CHILD of this container get?", so there is no server evidence for
      // inheritance to have.
      expect(container.inheritsVerifiedBy).not.toBe("server");
      expect(["server", "rules"]).toContain(container.verifiedBy);

      // `read: false` is a claim about a logged-out reader. Check it as one.
      const asAnon = await anon(container.url);
      expect([401, 403]).toContain(asAnon.status);
    }

    // And `inherits: true` on trips/ is a claim about what is below it.
    await expectPublicTriple(u.tripDoc(), DY.slug, "2026-japan");
  }, 60_000);

  it("labels the server's own evaluation 'server', and degrades to 'rules' without it", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // Premise: this server really does send WAC-Allow. If it stopped, "server"
    // would be unreachable and the first half of this test would be untestable
    // rather than false — worth knowing which.
    const probe = await ownerFetch(u.published(), { headers: { accept: "text/turtle" } });
    expect(probe.headers.get("wac-allow")).toBeTruthy();

    const strong = await getAccess(u.published(), { fetch: ownerFetch });
    expect(strong.ok, strong.ok ? "" : renderError(strong.error)).toBe(true);
    if (!strong.ok) return;
    expect(strong.value).toMatchObject({ read: true, write: false, verifiedBy: "server" });

    // The same question of the same server, with its own evaluation withheld.
    // The module must fall back to the stored rules and SAY that it did.
    let strippedFrom = 0;
    const withoutWacAllow: typeof globalThis.fetch = async (input, init) => {
      const res = await ownerFetch(input, init);
      if (!res.headers.has("wac-allow")) return res;
      strippedFrom += 1;
      const headers = new Headers(res.headers);
      headers.delete("wac-allow");
      return reshape(res, res.body === null ? null : await res.arrayBuffer(), headers);
    };

    const weak = await getAccess(u.published(), { fetch: withoutWacAllow });
    // The mutation must have happened, or this is the unmodified case again
    // wearing a different name — the way a fixture edit that stops matching
    // turns a negative test green.
    expect(strippedFrom).toBeGreaterThan(0);
    expect(weak.ok, weak.ok ? "" : renderError(weak.error)).toBe(true);
    if (!weak.ok) return;
    expect(weak.value.verifiedBy).toBe("rules");

    // THE POINT: the label changed and the ANSWER did not. A hard-coded
    // verifiedBy fails one of these two whichever value it is hard-coded to,
    // and a module that confused "no header" with "not public" would report
    // read: false here — which is how a published trip gets shown as private.
    expect(weak.value.read).toBe(strong.value.read);
    expect(weak.value.read).toBe(true);
    expect((await anon(u.published())).status).toBe(200);

    // And the other answer, so "rules" is not simply "always says read: true".
    // u.draft() was made private earlier in this file; asserted, not assumed.
    await expectDenied(u.draft(), [DRAFT_HEADLINE]);
    const weakPrivate = await getAccess(u.draft(), { fetch: withoutWacAllow });
    expect(weakPrivate.ok, weakPrivate.ok ? "" : renderError(weakPrivate.error)).toBe(true);
    if (!weakPrivate.ok) return;
    expect(weakPrivate.value).toMatchObject({ read: false, verifiedBy: "rules" });
  }, 60_000);

  it("reports `inherits` as what a logged-out reader actually gets", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // Two containers, created the same way in the same run, differing only in
    // publicChildren — each reported `inherits` checked against a real
    // anonymous GET of a real child.
    const open = `${u.trips()}evidence-open/`;
    const shut = `${u.trips()}evidence-shut/`;
    const openChild = `${open}trip.ttl`;
    const shutChild = `${shut}trip.ttl`;

    const a = await createContainer(open, { fetch: ownerFetch, webId });
    const b = await createContainer(shut, { fetch: ownerFetch, webId, publicChildren: false });
    expect(a.ok, a.ok ? "" : renderError(a.error)).toBe(true);
    expect(b.ok, b.ok ? "" : renderError(b.error)).toBe(true);
    if (!a.ok || !b.ok) return;

    await putAsOwner(openChild, TRIP);
    await putAsOwner(shutChild, TRIP);

    // Both values occur in one run, so no constant satisfies the pair.
    expect(a.value.inherits).toBe(true);
    expect(b.value.inherits).toBe(false);

    // And each is what the server enforces.
    expect((await anon(openChild)).status).toBe(200);
    expect([401, 403]).toContain((await anon(shutChild)).status);

    // A container's inheritance is only ever the rules we wrote, read back.
    expect(a.value.inheritsVerifiedBy).toBe("rules");
    expect(b.value.inheritsVerifiedBy).toBe("rules");
    expect(a.value.inheritsVerifiedBy).not.toBe("server");
    expect(b.value.inheritsVerifiedBy).not.toBe("server");

    // A DOCUMENT has no children, so the third value appears here and nowhere
    // else. `inherits: false` on a document means "not applicable", which is
    // why the companion field has to be read alongside it.
    const asDocument = await makePublic(openChild, { fetch: ownerFetch });
    expect(asDocument.ok, asDocument.ok ? "" : renderError(asDocument.error)).toBe(true);
    if (!asDocument.ok) return;
    expect(asDocument.value.inheritsVerifiedBy).toBe("notApplicable");
    expect(asDocument.value.inherits).toBe(false);
    expect(asDocument.value.read).toBe(true);
    expect((await anon(openChild)).status).toBe(200);
  }, 60_000);
});

/* ============================================ the precondition on the .acl PUT */

describe("the precondition on the control document", () => {
  /**
   * §10: every write carries a precondition, `If-Match: <etag>` to update. The
   * control document is a resource, so this applies to it too — and the failure
   * mode it prevents is specific: two studio tabs, makePublic racing
   * makePrivate, and the loser's ACL silently overwriting the winner's.
   *
   * The claim under test is not visible in a return value. It is about the
   * REQUESTS: which ETag was sent, where it came from, and — for the refusal
   * case — that no request was sent at all.
   */
  const target = () => `${u.trips()}precondition/`;
  const aclOf = (container: string) => `${container}.acl`;

  it("sends the ETag of the GET whose body it edited, and never If-Match: *", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const made = await createContainer(target(), { fetch: ownerFetch, webId });
    expect(made.ok, made.ok ? "" : renderError(made.error)).toBe(true);

    const rec = recording(ownerFetch);
    const again = await makePublic(target(), { fetch: rec.fetch, webId });
    expect(again.ok, again.ok ? "" : renderError(again.error)).toBe(true);

    const log = rec.log.filter((r) => r.url === aclOf(target()));
    const puts = log.filter((r) => r.method === "PUT");
    expect(puts.length, `PUTs to the control document: ${summarise(log)}`).toBe(1);
    expect(puts[0].ifMatch).not.toBeNull();
    expect(puts[0].ifMatch).not.toBe("*");

    // The GET IMMEDIATELY BEFORE the PUT — the one whose body was edited. Not
    // the last GET in the log: that one is the read-back verification, and
    // comparing against it fails on a correct implementation.
    const putIndex = log.findIndex((r) => r.method === "PUT");
    const sourceGet = [...log.slice(0, putIndex)].reverse().find((r) => r.method === "GET");
    expect(sourceGet, `no GET before the PUT: ${summarise(log)}`).toBeDefined();
    expect(sourceGet?.etag).toBeTruthy();
    expect(puts[0].ifMatch).toBe(sourceGet?.etag);

    // No HEAD anywhere on the control document. An ETag taken from a separate
    // HEAD says nothing about the body being edited: a change landing in between
    // would satisfy If-Match and be overwritten, which is the precondition
    // present in the headers and absent in effect.
    expect(log.some((r) => r.method === "HEAD"), summarise(log)).toBe(false);
    expect(rec.log.filter((r) => r.ifMatch === "*")).toEqual([]);
  }, 60_000);

  it("loses the race when something else writes between the read and the write", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const container = `${u.trips()}race/`;
    const made = await createContainer(container, { fetch: ownerFetch, webId });
    expect(made.ok, made.ok ? "" : renderError(made.error)).toBe(true);
    const acl = aclOf(container);

    /**
     * "The other tab", writing after EVERY read of the control document rather
     * than after a particular one. Counting round trips would encode
     * @inrupt/solid-client 3.0.0's internals: if the count changed on an upgrade
     * the injection would land in the wrong window and this test would go green
     * having reproduced nothing.
     */
    let outOfBandEdits = 0;
    const racing: typeof globalThis.fetch = async (input, init) => {
      const res = await ownerFetch(input, init);
      if (methodOf(input, init) !== "GET" || urlOf(input) !== acl || !res.ok) return res;
      const etag = res.headers.get("etag");
      if (!etag) return res;
      const edit = await ownerFetch(acl, {
        method: "PUT",
        headers: { "content-type": "text/turtle", "if-match": etag },
        // A Turtle comment: the ETag moves, the authorisations do not, so a
        // failure here is about the precondition and not about a broken ACL.
        body: `${await res.clone().text()}\n# an edit from the other tab\n`,
      });
      if (edit.ok) outOfBandEdits += 1;
      return res;
    };

    const lost = await makePublic(container, { fetch: racing, webId });

    // The mutation must actually have happened. An injection that silently
    // stopped matching would leave a clean run reporting success, and this test
    // would pass having asserted nothing — the exact way a string-replaced
    // negative fixture goes green on the unmodified original.
    expect(outOfBandEdits).toBeGreaterThan(0);

    expect(lost.ok, lost.ok ? `overwrote a concurrent edit: ${JSON.stringify(lost.value)}` : "").toBe(false);
    if (lost.ok) return;
    expect(lost.error.kind).toBe("http");
    if (lost.error.kind !== "http") return;
    expect(lost.error.status).toBe(412);
    // It names the CONTAINER, not `{container}.acl`. The caller never asked
    // about a control document, and on another server it is somewhere else
    // entirely — an error naming one is unactionable.
    expect(lost.error.url).toBe(container);

    // The allow-case: without the interference the same call succeeds, so the
    // 412 is attributable to the race and not to a container that cannot be
    // configured at all.
    const uncontested = await makePublic(container, { fetch: ownerFetch, webId });
    expect(uncontested.ok, uncontested.ok ? "" : renderError(uncontested.error)).toBe(true);
  }, 60_000);

  it("refuses when the server returns no ETag, rather than degrading to If-Match: *", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const container = `${u.trips()}no-etag/`;
    const made = await createContainer(container, { fetch: ownerFetch, webId });
    expect(made.ok, made.ok ? "" : renderError(made.error)).toBe(true);
    const acl = aclOf(container);

    const before = await ownerFetch(acl, { headers: { accept: "text/turtle" } });
    expect(before.status).toBe(200);
    const beforeBody = await before.text();

    let etagsStripped = 0;
    const etagless = recording(async (input, init) => {
      const res = await ownerFetch(input, init);
      if (methodOf(input, init) !== "GET" || urlOf(input) !== acl || !res.headers.has("etag")) return res;
      etagsStripped += 1;
      const headers = new Headers(res.headers);
      headers.delete("etag");
      return reshape(res, await res.text(), headers);
    });

    const refused = await makePublic(container, { fetch: etagless.fetch, webId });

    // The mutation happened, so this is not the unmodified case in disguise.
    expect(etagsStripped).toBeGreaterThan(0);

    expect(refused.ok, refused.ok ? `wrote without a usable precondition: ${JSON.stringify(refused.value)}` : "")
      .toBe(false);
    if (refused.ok) return;
    expect(refused.error.kind).toBe("accessUnverified");
    expect(refused.error.url).toBe(container);

    /**
     * NO PUT AT ALL — the assertion that matters.
     *
     * `If-Match: *` here would be a blind PUT wearing a precondition: it
     * succeeds against whatever happens to be there, which is the overwrite §10
     * forbids. Refusing costs the caller a retry; degrading costs an edit. So it
     * is not enough that the error kind is right — nothing may have been
     * written, by any method, with any precondition.
     */
    expect(etagless.log.filter((r) => MUTATIONS.includes(r.method)), summarise(etagless.log)).toEqual([]);
    expect(etagless.log.filter((r) => r.ifMatch !== null)).toEqual([]);

    // And the control document on the server is untouched, as a graph — triple
    // sets, never bytes (§11 guardrail 6).
    const after = await ownerFetch(acl, { headers: { accept: "text/turtle" } });
    expect(after.status).toBe(200);
    expect(graphEquals(beforeBody, await after.text(), acl)).toMatchObject({ equal: true, missing: [], extra: [] });

    // The allow-case, again on the same container: with ETags present it works.
    const withEtag = await makePublic(container, { fetch: ownerFetch, webId });
    expect(withEtag.ok, withEtag.ok ? "" : renderError(withEtag.error)).toBe(true);
  }, 60_000);
});

/* ============================================ the container write, per step */

describe("the container write, step by step", () => {
  /**
   * Resolve, apply, PUT. Each step is tested for a branch the sequence cannot
   * reach — every production caller passes a webId, and none writes a create
   * precondition over an existing ACL. Both need a real ACL, which is why they
   * are here and not in `lib/pod/access.test.ts`.
   */
  it("applyContainerRules refuses an ACL where only an agent CLASS keeps Control", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    /**
     * Control held by `foaf:Agent` and no named agent. The owner reads it back
     * because the owner is an agent too, so the step gets a real WAC ACL to
     * refuse. Its own scratch container: this leaves anonymous Control standing
     * on it, which is the state the guard exists to refuse to write.
     */
    const container = `${u.trips()}class-control/`;
    await createContainerWithNoAclOfItsOwn(container);
    await putAsOwner(
      `${container}.acl`,
      `@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n@prefix foaf: <${NS.foaf}>.\n` +
        `<#everyone> a acl:Authorization; acl:agentClass foaf:Agent; acl:accessTo <./>; ` +
        `acl:default <./>; acl:mode acl:Read, acl:Control.\n`,
    );

    const resolved = await resolveContainerAcl(ownerFetch, container);
    expect(resolved.ok, resolved.ok ? "" : renderError(resolved.error)).toBe(true);
    if (!resolved.ok) return;
    // The precondition came off the same GET as the body, and it is an ETag:
    // this container has an ACL of its own, so there is nothing to create.
    expect(resolved.value.aclUrl).toBe(`${container}.acl`);
    expect(resolved.value.precondition).toMatchObject({ etag: expect.stringMatching(/./) });

    const ruled = applyContainerRules(container, resolved.value.acl, undefined, true);
    expect(ruled.ok, ruled.ok ? "wrote an ACL nobody named can repair" : "").toBe(false);
    if (ruled.ok) return;
    expect(ruled.error.kind).toBe("accessUnverified");
    if (ruled.error.kind !== "accessUnverified") return;
    expect(ruled.error.url).toBe(container);
    expect(ruled.error.expected).toContain("agent keeping Control");

    // The allow-case, on the same ACL: naming the owner is what the refusal
    // asks for, and it is what every caller in this project already does. So
    // the guard is about a missing webId and not about this fixture.
    const named = applyContainerRules(container, resolved.value.acl, webId, true);
    expect(named.ok, named.ok ? "" : renderError(named.error)).toBe(true);
  }, 60_000);

  it("putAcl reports a 412 about the container, never about its control document", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const container = `${u.trips()}put-acl/`;
    const made = await createContainer(container, { fetch: ownerFetch, webId });
    expect(made.ok, made.ok ? "" : renderError(made.error)).toBe(true);

    const resolved = await resolveContainerAcl(ownerFetch, container);
    expect(resolved.ok, resolved.ok ? "" : renderError(resolved.error)).toBe(true);
    if (!resolved.ok) return;
    const ruled = applyContainerRules(container, resolved.value.acl, webId, true);
    expect(ruled.ok, ruled.ok ? "" : renderError(ruled.error)).toBe(true);
    if (!ruled.ok) return;

    // A create precondition over an ACL that is already there. The sequence
    // never does this — it is the fallback branch's precondition, spent on the
    // resource branch's ACL — and it is the cheapest way to make the write fail
    // at the server rather than in the body.
    const rec = recording(ownerFetch);
    const clash = await putAcl(rec.fetch, container, resolved.value.aclUrl, ruled.value, { create: true });

    expect(clash.ok, clash.ok ? "If-None-Match: * overwrote an existing ACL" : "").toBe(false);
    if (clash.ok) return;
    expect(clash.error.kind).toBe("http");
    if (clash.error.kind !== "http") return;
    expect(clash.error.status).toBe(412);
    // The container, not `{container}.acl`: the caller never asked about a
    // control document and on another server it is somewhere else entirely.
    expect(clash.error.url).toBe(container);

    const puts = rec.log.filter((r) => r.method === "PUT");
    expect(puts.length, summarise(rec.log)).toBe(1);
    expect(puts[0].url).toBe(`${container}.acl`);
    expect(puts[0].ifNoneMatch).toBe("*");
    expect(puts[0].ifMatch).toBeNull();

    // The allow-case: the same body under the ETag the resolve step returned
    // lands. So the 412 is attributable to the precondition and not to an ACL
    // the server would refuse whatever it was written under.
    const under = await putAcl(ownerFetch, container, resolved.value.aclUrl, ruled.value, resolved.value.precondition);
    expect(under.ok, under.ok ? "" : renderError(under.error)).toBe(true);
  }, 60_000);
});

/* ================================================== an ACP control resource */

describe("a control resource that is ACP, not WAC", () => {
  /**
   * THIS IS A FAKE, AND IT IS NOT EVIDENCE ABOUT INRUPT ESS.
   *
   * What it emulates, at the fetch layer, is the shape phase 0 measured on ESS:
   * the server advertises `rel="acl"` pointing at a SEPARATE authorization host,
   * and the resource there is an ACP Access Control Resource — so sniffing the
   * link relation reports "WAC" for an ACP server (decisions.md §19). The
   * emulation rewrites every `rel="acl"` link to a host that answers
   * `Link: <...acp#AccessControlResource>; rel="type"`.
   *
   * It reproduces the one property the refusal turns on: a rel="acl" link that
   * is not a WAC ACL. It does NOT reproduce ESS — not its ACP vocabulary, not
   * its status codes, not its authorization semantics. A green run here means
   * "the module refuses a control resource it cannot parse as WAC rules"; it
   * does not mean anything has been verified against a hosted Pod, and it is not
   * permission to say ACP is covered. docs/decisions.md §20 still records the
   * container shape as UNVERIFIED ON ACP.
   *
   * The reason the refusal matters: the container path writes a WAC ACL
   * document. Writing one over an ACP control resource would either be rejected
   * or, worse, accepted and ignored — a diary reported as secured and readable
   * by nobody, or a draft reported as private and readable by everybody.
   */
  const AUTHZ = `${BASE}/.acp-emulated-authorization-host`;

  /**
   * The ACP namespace, DERIVED from lib/vocab.ts rather than written out.
   *
   * §11 guardrail 1 bans raw vocabulary IRIs outside lib/vocab.ts and the lint
   * rule enforces it. Adding `acp:` to vocab.ts would be the wrong fix: vocab.ts
   * is the project's data model, checked against docs/data-model.md in both
   * directions, and ACP appears nowhere in it — this is a foreign vocabulary
   * that exists only inside this emulation.
   */
  const ACP = NS.solid.replace("terms#", "acp#");

  it("refuses it, and sends no write of any kind to the authorization host", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const container = `${u.trips()}acp-emulated/`;
    const made = await createContainer(container, { fetch: ownerFetch, webId });
    expect(made.ok, made.ok ? "" : renderError(made.error)).toBe(true);

    const acl = `${container}.acl`;
    const before = await ownerFetch(acl, { headers: { accept: "text/turtle" } });
    expect(before.status).toBe(200);
    const beforeBody = await before.text();

    const essLike = recording(async (input, init) => {
      const url = urlOf(input);
      if (url.startsWith(AUTHZ)) {
        return new Response(`<${AUTHZ}> a <${ACP}AccessControlResource> .\n`, {
          status: 200,
          headers: {
            "content-type": "text/turtle",
            link: `<${ACP}AccessControlResource>; rel="type"`,
            etag: '"acr"',
          },
        });
      }
      const res = await ownerFetch(input, init);
      const link = res.headers.get("link");
      if (!link || !link.includes('rel="acl"')) return res;
      const headers = new Headers(res.headers);
      const kept = link
        .split(", <")
        .map((part, i) => (i === 0 ? part : `<${part}`))
        .filter((part) => !part.includes('rel="acl"'));
      headers.set("link", [...kept, `<${AUTHZ}?for=${encodeURIComponent(url)}>; rel="acl"`].join(", "));
      return reshape(res, res.body === null ? null : await res.arrayBuffer(), headers);
    });

    const refused = await makePublic(container, { fetch: essLike.fetch, webId });

    // The emulation took effect: the module DID follow the rewritten rel="acl"
    // to the authorization host. Without this the test would pass on a run where
    // the rewrite silently stopped matching and no ACP was involved at all.
    const toAuthz = essLike.log.filter((r) => r.url.startsWith(AUTHZ));
    expect(toAuthz.length, summarise(essLike.log)).toBeGreaterThan(0);

    expect(refused.ok, refused.ok ? `reported success on an ACR: ${JSON.stringify(refused.value)}` : "").toBe(false);
    if (refused.ok) return;
    expect(refused.error.kind).toBe("accessUnverified");
    expect(refused.error.url).toBe(container);

    /**
     * THE ASSERTION THAT MATTERS — not the error kind, which a module could
     * return after having already written. No PUT, PATCH, POST or DELETE
     * reached the authorization host.
     */
    expect(
      toAuthz.filter((r) => MUTATIONS.includes(r.method)),
      `writes to the authorization host: ${summarise(toAuthz)}`,
    ).toEqual([]);
    // And nothing was written anywhere on this run, ACR or not.
    expect(essLike.log.filter((r) => MUTATIONS.includes(r.method)), summarise(essLike.log)).toEqual([]);

    // The real control document is untouched, as a graph.
    const after = await ownerFetch(acl, { headers: { accept: "text/turtle" } });
    expect(after.status).toBe(200);
    expect(graphEquals(beforeBody, await after.text(), acl)).toMatchObject({ equal: true, missing: [], extra: [] });

    /**
     * THE ALLOW-CASE. The same call, on the same container, with the unmodified
     * fetch — it succeeds. A refusal that fired on everything would be useless,
     * and without this the failure above is not attributable to the ACR.
     */
    const onWac = await makePublic(container, { fetch: ownerFetch, webId });
    expect(onWac.ok, onWac.ok ? "" : renderError(onWac.error)).toBe(true);
  }, 60_000);
});


/* ============================================ the privacy settings container */

/**
 * `/travel/settings/` and `privacy.ttl` (§7.6), against the real server.
 *
 * THIS IS THE ONE PLACE IN THE PROJECT WHERE A MISTAKE IS NOT A MISSING PAGE.
 * Everything else under `travel/` is meant to be world-readable, so an ACL that
 * came out too permissive is invisible — the diary works, and the failure looks
 * like success. Here the same mistake publishes the owner's home coordinates,
 * on a 201, to a URL anyone can guess from the layout in §4.
 *
 * `acl:default` inherits recursively, so a container created below `travel/`
 * with no ACL of its own is covered by the parent's public default — that is
 * measured, in this very file, on `travel/trips/2026-japan/`. Which means the
 * safe state here is not the default state, and the only evidence that the
 * write took is an anonymous GET that fails. A 2xx proves nothing (phase 0).
 */
describe("the privacy settings container", () => {
  it("denies a logged-out reader the settings document, and leaks no coordinate", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // The request that matters: no session, no Solid library, exactly what the
    // public path does. Denied AND leaking nothing — "45.4655" appears in
    // neither requested URL, so it can only have come from the body.
    await expectDenied(u.privacy(), [HOME_LAT]);

    // ...and the container listing too, or the resource's existence and name
    // are public even where its content is not (§4, decisions.md §20).
    await expectDenied(u.settings(), ["privacy"]);
  }, 30_000);

  it("still lets the OWNER read it back — a rule that denies everyone is useless", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const res = await ownerFetch(u.privacy(), { headers: { accept: "text/turtle" } });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    // The status with its body. An HTTP code asserted alone is how a zero-byte
    // 404 shipped in this project once already.
    expect(objectOf(body, u.privacy(), DY.homeLat)).toBe(HOME_LAT);

    // Byte-for-byte comparison would be permanently red — Turtle has no
    // canonical form (§11). Compare the graph.
    const round = graphEquals(PRIVACY, body, u.privacy());
    expect(round.equal, `missing ${round.missing.join(" | ")} extra ${round.extra.join(" | ")}`).toBe(
      true,
    );
  }, 30_000);

  it("readPrivacySettings sees it as the owner and fails closed as anyone else", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // BOTH CONTEXTS, because only one of them is evidence. The owner's read
    // proves the resource is intact and the parser agrees with §7.6; the
    // anonymous read is the only thing that proves the restriction, and it is
    // the exact call the fuzzing layer will make with the wrong fetch.
    const asOwner = await readPrivacySettings(u.privacy(), { fetch: ownerFetch });
    expect(asOwner.ok, asOwner.ok ? "" : renderError(asOwner.error)).toBe(true);
    if (!asOwner.ok) return;
    expect(asOwner.value.home).toEqual({ lat: 45.4655, long: 9.1866, radiusMeters: 3000 });
    expect(asOwner.value.defaultPrecisionMeters).toBe(500);

    const asAnon = await readPrivacySettings(u.privacy());
    expect(asAnon.ok, asAnon.ok ? "an anonymous caller read the home coordinates" : "").toBe(false);
    if (asAnon.ok) return;
    // A structured error, never an empty settings object — §9's fail-closed
    // rule is only worth as much as this distinction. `home: undefined` here
    // would mean "no home region to protect" and would publish the coordinate.
    expect(asAnon.error.kind).toBe("http");
    if (asAnon.error.kind !== "http") return;
    expect([401, 403]).toContain(asAnon.error.status);
  }, 30_000);

  it("closes only this container — the diary beside it is still public", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // The allow-case, in the same run and under the same grandparent. Without
    // it, an initialisation that denied the public everything would satisfy
    // every assertion above while shipping a diary nobody can read.
    await expectPublicTriple(u.tripDoc(), DY.slug, "2026-japan");
    await expectPublicTriple(u.published(), SCHEMA.headline, "First night in Shinjuku");
  }, 30_000);

  it("re-running initialisation does not reopen it", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // §5 wants a first-run flow "idempotent and safe to re-run", because this
    // is the flow a deployer retries after any failure. A second run that
    // widened access on the one owner-only container would be the worst
    // possible time to find out.
    const again = await initialiseContainers({ fetch: ownerFetch, podRoot: POD, webId });
    expect(again.ok, again.ok ? "" : renderError(again.error)).toBe(true);
    if (!again.ok) return;
    expect(again.value.containers.map((c) => c.url)).toContain(u.settings());
    expect(again.value.containers.find((c) => c.url === u.settings())?.inherits).toBe(false);

    // Asserted at the server, not from the return value.
    await expectDenied(u.privacy(), [HOME_LAT]);
    const stillOwners = await ownerFetch(u.privacy(), { headers: { accept: "text/turtle" } });
    expect(stillOwners.status).toBe(200);
  }, 60_000);

  it("makePrivate repairs a settings container that was created the leaky way", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // The state a Pod reaches when the settings document is written by another
    // tool, or by a version of this app that predates revision 4: a container
    // with no ACL of its own, inheriting travel/'s public default. Proven leaky
    // FIRST, so the repair is measured against a real leak rather than against
    // an assumption.
    const leaky = `${u.travel()}settings-legacy/`;
    const exposed = `${leaky}privacy.ttl`;
    await createContainerWithNoAclOfItsOwn(leaky);
    await putAsOwner(exposed, PRIVACY);

    const before = await anon(exposed);
    expect(before.status, "premise: the leaky shape really does expose it").toBe(200);
    expect(await before.text()).toContain(HOME_LAT);

    const repaired = await makePrivate(leaky, { fetch: ownerFetch, webId });
    expect(repaired.ok, repaired.ok ? "" : renderError(repaired.error)).toBe(true);
    if (!repaired.ok) return;
    expect(repaired.value.inherits).toBe(false);

    await expectDenied(exposed, [HOME_LAT]);
    expect((await ownerFetch(exposed, { headers: { accept: "text/turtle" } })).status).toBe(200);
  }, 60_000);
});

/* ============================================ a binary derivative on a real Pod */

/**
 * THE MEDIA PUT, AGAINST A REAL SERVER — the one thing the media pipeline had
 * never done anywhere in this repository.
 *
 * Every other test of the upload path fakes the Pod: MSW at the HTTP layer in
 * test/media-upload.test.ts and components/studio/entry-editor/entry-editor.test.tsx, and a Playwright
 * `route.fulfill({ status: 201 })` in e2e/media-pipeline.spec.ts. Meanwhile
 * scripts/seed-dev-pod.ts creates `travel/`, `travel/trips/` and the trip tree
 * and NOT `travel/media/`, so `.pod-data/e2e/travel/` has no media container at
 * all. The branch's headline claim — "upload the two derivatives to
 * `/travel/media/`" — was therefore a claim about mocks, and the two things it
 * rests on had never been measured against Community Solid Server:
 *
 *   1. `travel/media/<hash>/` IS CREATED BY NOTHING. `initialiseContainers`
 *      makes `travel/media/`; the per-hash container below it is only ever
 *      NAMED, by `mediaContainer()`. Does a real server create it on the way,
 *      or refuse a PUT whose parent is absent?
 *   2. `uploadPhoto` reads 412 as "the bytes already there ARE the bytes we
 *      were about to write" — reuse, not failure. That reading is sound only
 *      if a real server answers a repeated `If-None-Match: *` with exactly 412.
 *
 * Both are answered below by what was sent and what came back. The derivatives
 * are read as a LOGGED-OUT reader wherever the question is "can a visitor see
 * this photo", because that is the only context whose answer is evidence
 * (phase 0): a 201 proves the write and says nothing about access.
 *
 * WHAT THESE BYTES ARE NOT. They are not an image. jsdom has no
 * `createImageBitmap`, no `OffscreenCanvas` and no encoder, so no test outside
 * Playwright can produce a real WebP — and pixels are not what is under test
 * here. What makes this a media test is the binary body, the `image/webp`
 * content type and the content-addressed path.
 */
describe("a binary derivative through putGuarded", () => {
  /** A RIFF/WEBP header over four arbitrary bytes. Distinguishable from `other`
   *  below, which is what makes "the stored resource was not overwritten" an
   *  assertion rather than a tautology. */
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const other = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 9, 9, 9, 0x57, 0x45, 0x42, 0x50]);
  const webp = (b: Uint8Array<ArrayBuffer>) => new Blob([b], { type: "image/webp" });

  /** Each test names its own hash, so none depends on another having run —
   *  16 hex characters, the width `mediaHash` actually produces. */
  const ARRIVES = "deadbeefdeadbeef";
  const REPEATS = "feedfacefeedface";
  const UNSEEN = "0123456789abcdef";

  it("creates the per-hash container on the way, and the derivative reaches a logged-out reader", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const container = mediaContainer(POD, ARRIVES);
    const target = `${container}web.webp`;

    // The path is the studio's, built by the shipped function rather than by
    // hand: a test that spelled the URL itself would pass while `uploadPhoto`
    // wrote somewhere else entirely.
    expect(container).toBe(`${u.media()}${ARRIVES}/`);

    // THE PREMISE, at the server. `travel/media/` exists because
    // initialiseContainers ran in beforeAll; the container below it does not,
    // because nothing in this project creates it. Without this the assertion
    // that follows would pass on a container something else had made.
    expect((await ownerFetch(container, { headers: { accept: "text/turtle" } })).status).toBe(404);
    expect((await ownerFetch(target, { headers: { accept: "image/webp" } })).status).toBe(404);

    const written = await putGuarded(ownerFetch, target, webp(bytes), { create: true }, "image/webp");
    expect(written.ok, written.ok ? "" : renderError(written.error)).toBe(true);

    /**
     * WHAT CSS 7.2.0 ACTUALLY DID: 201 Created, having made the missing
     * intermediate container itself. Recorded here rather than assumed,
     * because the other plausible answer — 404 or 409 on an absent parent — is
     * real server behaviour elsewhere and would mean `uploadPhoto` needs a
     * `createContainer` call it does not make. If this line ever goes red on
     * another server, that is the finding and not a flaky test.
     */
    const listed = await ownerFetch(container, { headers: { accept: "text/turtle" } });
    expect(listed.status).toBe(200);
    const contained = new Parser({ baseIRI: container })
      .parse(await listed.text())
      .filter((q) => q.predicate.value === LDP.contains)
      .map((q) => q.object.value);
    expect(contained).toContain(target);

    // The bytes, to a reader with no session and no Solid library — the public
    // path exactly. Status AND body AND content type: a status asserted alone
    // is how a zero-byte 404 shipped in this project once already.
    const publicRead = await fetch(target);
    expect(publicRead.status).toBe(200);
    expect(publicRead.headers.get("content-type")).toContain("image/webp");
    expect([...new Uint8Array(await publicRead.arrayBuffer())]).toEqual([...bytes]);

    // `travel/media/` is still not enumerable, so a hash cannot be discovered
    // without the file it was derived from — §4's obscurity trade-off left
    // where §4 put it. ARRIVES is not a substring of the requested URL, so this
    // cannot be satisfied by a request path echoed in an error envelope.
    await expectDenied(u.media(), [ARRIVES]);

    /**
     * AND THE PART THAT IS NOT TIDY, SAID PLAINLY. The container CSS created on
     * our behalf has no ACL of its own, so it is covered by `travel/media/`'s
     * public `acl:default` AS A RESOURCE and its listing is open — the §20
     * shape, one level down. Asserted rather than glossed, because it is what
     * the server does and the next reader should not have to rediscover it.
     *
     * It is not a leak in this one place: everything inside is a published
     * derivative that is world-readable anyway, and the container's name is
     * unreachable without the source file. It would stop being harmless the day
     * anything private is written under `travel/media/<hash>/`.
     */
    const anonListing = await anon(container);
    expect(anonListing.status).toBe(200);
    expect(await anonListing.text()).toContain("web.webp");
  }, 60_000);

  it("answers the second, identical PUT with 412 — the branch uploadPhoto is built on", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    const target = `${mediaContainer(POD, REPEATS)}web.webp`;

    const first = await putGuarded(ownerFetch, target, webp(bytes), { create: true }, "image/webp");
    expect(first.ok, first.ok ? "" : renderError(first.error)).toBe(true);

    // The exact request a re-pick of the same photo produces: same
    // content-addressed path, same bytes, same `If-None-Match: *`.
    const again = await putGuarded(ownerFetch, target, webp(bytes), { create: true }, "image/webp");
    expect(again.ok, again.ok ? "the second create-PUT succeeded, so nothing was already there" : "").toBe(false);
    if (again.ok) return;
    // 412 SPECIFICALLY. `uploadPhoto`'s reuse branch matches on this number and
    // on nothing else; a 409 or a 400 here would mean its premise is wrong and
    // a re-picked photo surfaces to the owner as a failed upload.
    expect(again.error.kind).toBe("http");
    if (again.error.kind !== "http") return;
    expect(again.error.status).toBe(412);
    expect(again.error.url).toBe(target);

    // It is a refusal, not a courtesy: DIFFERENT bytes to the same path are
    // refused the same way and the stored resource is untouched. Without this,
    // "412" would be compatible with a server that had already overwritten.
    const clobber = await putGuarded(ownerFetch, target, webp(other), { create: true }, "image/webp");
    expect(clobber.ok, clobber.ok ? "different bytes overwrote a content-addressed derivative" : "").toBe(false);
    if (clobber.ok) return;
    expect(clobber.error.kind).toBe("http");
    if (clobber.error.kind !== "http") return;
    expect(clobber.error.status).toBe(412);

    const stored = await fetch(target);
    expect(stored.status).toBe(200);
    expect([...new Uint8Array(await stored.arrayBuffer())]).toEqual([...bytes]);
  }, 60_000);

  it("uploadPhoto puts both derivatives on the Pod, and a re-pick rewrites neither", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    // The whole function, against the real server — the sentence this describe
    // exists to make true. `source` stands in for the original file: hashed for
    // the path, never uploaded (§9).
    const source = await webp(bytes).arrayBuffer();
    const derivatives = {
      web: { blob: webp(bytes), width: 1600, height: 1200 },
      thumb: { blob: webp(other) },
    };

    const first = await uploadPhoto({ fetch: ownerFetch, podRoot: POD, source, derivatives });
    expect(first.ok, first.ok ? "" : renderError(first.error)).toBe(true);
    if (!first.ok) return;

    const container = mediaContainer(POD, await mediaHash(source));
    expect(first.value.contentUrl).toBe(`${container}web.webp`);
    expect(first.value.thumbnailUrl).toBe(`${container}thumb.webp`);
    expect(first.value.encodingFormat).toBe("image/webp");

    // Both derivatives, to a logged-out reader, with their own bytes — so the
    // thumb is not the web image under a second name.
    const web = await fetch(first.value.contentUrl);
    expect(web.status).toBe(200);
    expect([...new Uint8Array(await web.arrayBuffer())]).toEqual([...bytes]);
    const thumb = await fetch(`${container}thumb.webp`);
    expect(thumb.status).toBe(200);
    expect([...new Uint8Array(await thumb.arrayBuffer())]).toEqual([...other]);

    // THE RE-PICK. Same file, so the same address, so both PUTs are refused —
    // and `uploadPhoto` reports success anyway, because on a content-addressed
    // path a 412 means the bytes are already there. The request log is how that
    // is distinguished from a second upload that quietly overwrote.
    const rec = recording(ownerFetch);
    const second = await uploadPhoto({ fetch: rec.fetch, podRoot: POD, source, derivatives });
    expect(second.ok, second.ok ? "" : renderError(second.error)).toBe(true);
    if (!second.ok) return;
    expect(second.value).toEqual(first.value);

    const puts = rec.log.filter((r) => r.method === "PUT");
    expect(puts.map((r) => r.url), summarise(rec.log)).toEqual([
      first.value.contentUrl,
      first.value.thumbnailUrl,
    ]);
    expect(puts.map((r) => r.status), summarise(rec.log)).toEqual([412, 412]);
    // Every one of them carried the create precondition. A blind PUT here would
    // have succeeded and overwritten, and this test would still be green on the
    // assertions above.
    expect(puts.map((r) => r.ifNoneMatch)).toEqual(["*", "*"]);
    expect(puts.filter((r) => r.ifMatch !== null)).toEqual([]);
  }, 60_000);

  it("accepts the PUT even where travel/media/ was never provisioned — and the public cannot read it", async (ctx) => {
    if (!podUp) ctx.skip(`no Pod on ${BASE} — start one with \`npm run pod:dev\``);

    /**
     * THE OTHER HALF OF QUESTION 1, AND THE UNCOMFORTABLE ANSWER.
     *
     * `initialiseContainers` has no UI call site — it is reachable from tests
     * and from nothing a deployer clicks. So the state where `travel/media/`
     * does not exist at all is not hypothetical; it is what a Pod looks like
     * until someone runs the first-run flow by hand.
     *
     * What CSS 7.2.0 does with a media PUT in that state is accept it: 201, all
     * three missing containers created. The upload therefore SUCCEEDS, the
     * studio shows a photo, the entry is saved pointing at it — and a visitor
     * gets 401, because the containers CSS invented carry no ACL and the pod
     * root's default grant is `acl:accessTo <./>` with no `acl:default`.
     *
     * That is the project's own rule biting in the direction it always warns
     * about: a 2xx on a write proves the write and says nothing whatsoever
     * about who can read it. Recorded here rather than in a comment, so that a
     * future first-run flow with a real call site can be checked against it.
     */
    const unprovisioned = `${POD}unprovisioned-root/`;
    const target = `${mediaContainer(unprovisioned, UNSEEN)}web.webp`;

    // Premise: nothing exists on this branch of the tree.
    expect((await ownerFetch(unprovisioned, { headers: { accept: "text/turtle" } })).status).toBe(404);

    const written = await putGuarded(ownerFetch, target, webp(bytes), { create: true }, "image/webp");
    expect(written.ok, written.ok ? "" : renderError(written.error)).toBe(true);

    // The owner has it...
    const asOwner = await ownerFetch(target, { headers: { accept: "image/webp" } });
    expect(asOwner.status).toBe(200);
    expect([...new Uint8Array(await asOwner.arrayBuffer())]).toEqual([...bytes]);

    // ...and a logged-out reader does not. This is the assertion that matters:
    // the write succeeded and the photo is invisible.
    const publicRead = await fetch(target);
    expect([401, 403]).toContain(publicRead.status);

    // The allow-case, in the same run: the identically-shaped path under the
    // PROVISIONED root is public. So the denial above is attributable to the
    // missing first-run flow and not to something that broke media generally.
    const provisioned = `${mediaContainer(POD, UNSEEN)}web.webp`;
    const ok2 = await putGuarded(ownerFetch, provisioned, webp(bytes), { create: true }, "image/webp");
    expect(ok2.ok, ok2.ok ? "" : renderError(ok2.error)).toBe(true);
    expect((await fetch(provisioned)).status).toBe(200);
  }, 60_000);
});

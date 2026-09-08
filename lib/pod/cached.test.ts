import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import { http, HttpResponse } from "msw";
import { graphEquals, triples } from "@/test/graph";
import { server, servePod } from "@/test/msw";

/**
 * `getOwnerProfile` — the cached read layer's entry for the owner's WebID.
 *
 * WHY IT HAS TO EXIST AT ALL. `readOwnerProfile` works perfectly well on its
 * own (test/owner-profile.test.ts pins it), so the temptation is to call it
 * straight from `app/(studio)/studio/page.tsx`. decisions.md §22 is why not:
 * Cache Components is on, and an uncached data access outside a Suspense
 * boundary blocks prerendering. `/studio` builds as `○ (Static)` today. A bare
 * `readOwnerProfile` in the page would silently demote it, and nothing in the
 * test suite would notice — only the route table in `next build` would, and
 * only if someone read it.
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. `"use cache"` is a compiler directive
 * with no runtime meaning outside the Next build, so no vitest test can observe
 * caching. The route table in `next build` remains the only real check on the
 * prerender invariant. What is honestly testable is the wiring around it, and
 * that is what this file does:
 *
 *   1. it reads the OWNER'S WEBID — not POD_ROOT, not a hardcoded URL. Observed
 *      at the HTTP seam, because on ESS those are different hosts (§7.5) and
 *      confusing them is the mistake that actually happens.
 *   2. it hands the `Result` back UNCHANGED, errors included — the cached layer
 *      must not collapse a structured error into a throw, a null, or a generic.
 *   3. it is tagged, with a tag no other tag can collide with.
 *
 * THE ONE MOCK, AND WHY. `next/cache`'s real `cacheTag` throws outside a Next
 * build — verbatim: "`cacheTag()` is only available with the `cacheComponents`
 * config" — so lib/pod/cached.ts is simply not callable under vitest without
 * neutralising it. That is why this module had no tests before this file. The
 * mock is scoped to that one Next primitive; the Pod itself stays faked at the
 * HTTP layer through MSW, exactly as everywhere else. Nothing in lib/pod is
 * stubbed, so the delegation assertions below are observations, not arrangements.
 */

/* ------------------------------------------------- the one mock: next/cache */

/** Recorded rather than discarded: it is the only evidence that the new read is
 *  tagged at all. `vi.hoisted` because `vi.mock` is hoisted above imports. */
const { cacheTagCalls } = vi.hoisted(() => ({ cacheTagCalls: [] as string[] }));

vi.mock("next/cache", () => ({
  cacheTag: (...tags: string[]) => {
    cacheTagCalls.push(...tags);
  },
  // Not used today. Present so that an implementation reaching for either one
  // fails on its own assertion rather than on an ESM link error that kills the
  // whole file before a single test runs.
  cacheLife: () => {},
  revalidateTag: () => {},
}));

/* ----------------------------------------------------------------- fixtures */

/** §7.5's WebID document, read out of docs/data-model.md at runtime. Those
 *  blocks are normative (§11): a hand-copied fixture tests a copy of the spec.
 *  Same extraction and same block indices as test/read.test.ts. */
const blocks = [
  ...readFileSync("docs/data-model.md", "utf8").matchAll(/```turtle\n([\s\S]*?)```/g),
].map((m) => m[1]);
const DIARY_TTL = blocks[0];
const PROFILE_TTL = blocks[4];

/**
 * Identity host and storage host are deliberately DIFFERENT, and neither is
 * localhost.
 *
 * §7.5: "on ESS identity and storage are different hosts entirely". If they
 * shared an origin, an implementation that read `config.podRoot` instead of
 * `config.ownerWebId` could pass by coincidence.
 *
 * Both are under `.test`, which RFC 6761 reserves and guarantees will never
 * resolve. That is not decoration: test/setup.ts's onUnhandledRequest only
 * PRINTS on an unhandled request — measured while writing this file, a request
 * with no handler reached the real internet and came back 200 — and it lets
 * localhost through on purpose for the integration tests, which is exactly
 * where .env.local points both of these variables. A fixture host that can
 * resolve is a fixture host that can answer.
 */
const IDENTITY = "https://id.owner.test";
const WEBID = `${IDENTITY}/luca/card#me`;
/** What must actually be requested: the WebID with its fragment stripped. */
const WEBID_DOC = `${IDENTITY}/luca/card`;
const POD_ROOT = "https://storage.owner.test/2f9c1a/";

/**
 * Guarded string replacement. A negative test built by `.replace` passes the
 * *unmodified* fixture if the anchor drifts, which is how a green test verifies
 * nothing. Two guards, both throwing at module load so a stale anchor is loud:
 * the anchor must be present, and the edit must change the GRAPH, not the bytes.
 */
function mutate(source: string, from: string, to: string): string {
  if (!source.includes(from)) {
    throw new Error(`fixture anchor not found in docs/data-model.md §7.5: ${JSON.stringify(from)}`);
  }
  const out = source.replace(from, to);
  if (graphEquals(source, out, WEBID_DOC).equal) {
    throw new Error(`mutation left the graph unchanged: ${JSON.stringify(from)}`);
  }
  return out;
}

const NO_ISSUER = mutate(PROFILE_TTL, "    solid:oidcIssuer <https://login.inrupt.com> ;\n", "");

/* ------------------------------------------------------------------ harness */

/**
 * Loaded through a dynamic `import()` reached via the namespace, never a static
 * named import: a static import of an export that does not exist yet is an ESM
 * *link* error, which kills the file with a SyntaxError before any test runs
 * and reads like a broken test rather than a missing implementation. Reached
 * this way, each test below fails on its own terms. Same shape as
 * test/owner-profile.test.ts.
 */
const load = () => import("@/lib/pod/cached");

/** Every URL fetched during a test. `getOwnerProfile()` takes no options, so
 *  the caller-injected fetch that test/owner-profile.test.ts uses is not
 *  available here — the global is the only seam, and MSW has already patched
 *  it, so spying calls through to the fake Pod rather than replacing it. */
let fetchSpy: MockInstance<typeof globalThis.fetch>;
const requested = () =>
  fetchSpy.mock.calls.map(([input]) =>
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );

beforeEach(() => {
  // config reads process.env lazily through getters, so stubbing here is
  // enough. Vitest does not load .env.local, so nothing else supplies these.
  vi.stubEnv("OWNER_WEBID", WEBID);
  vi.stubEnv("POD_ROOT", POD_ROOT);
  cacheTagCalls.length = 0;
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
  vi.unstubAllEnvs();
});

/* ------------------------------------------------------------- the controls */

/**
 * These two pass from the start, deliberately. They are what stops the red
 * tests below from being vacuous: without them, "getOwnerProfile did not
 * request POD_ROOT" could be true simply because nothing in this harness can
 * reach POD_ROOT, and "cacheTag was called with the owner tag" could be true of
 * a recorder that was never wired up.
 */
describe("harness controls (expected green — they are what makes the rest mean something)", () => {
  it("POD_ROOT is reachable in this harness, so 'it did not fetch POD_ROOT' is an observation", async () => {
    const { getDiary } = await load();
    const diaryUrl = `${POD_ROOT}travel/diary.ttl`;
    servePod({ [diaryUrl]: DIARY_TTL });

    const r = await getDiary();

    expect(r.ok).toBe(true);
    expect(requested()).toEqual([diaryUrl]);
  });

  it("the cacheTag recorder is live, so an empty recording means 'not tagged'", async () => {
    const { getDiary, TAGS } = await load();
    servePod({ [`${POD_ROOT}travel/diary.ttl`]: DIARY_TTL });

    await getDiary();

    expect(cacheTagCalls).toEqual([TAGS.diary]);
  });

  it("the §7.5 fixture is well-formed and blank-node free", () => {
    // §11 guardrail 4, and the premise of comparing graphs as sets at all:
    // triples() throws on a blank-node label.
    expect(() => triples(PROFILE_TTL, WEBID_DOC)).not.toThrow();
  });
});

/* ------------------------------------------------------- 1. the WebID, not the Pod root */

describe("getOwnerProfile reads the owner's WebID", () => {
  it("requests the WebID document, fragment stripped, and nothing else", async () => {
    const { getOwnerProfile } = await load();
    servePod({ [WEBID_DOC]: PROFILE_TTL });

    const r = await getOwnerProfile();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.oidcIssuer).toBe("https://login.inrupt.com");
    // Exactly one request, to exactly the WebID document. This is the assertion
    // that fails if the implementation reaches for config.podRoot, for a
    // hardcoded URL, or for the WebID with its fragment left on.
    expect(requested()).toEqual([WEBID_DOC]);
  });

  it("does not touch POD_ROOT — the WebID and the Pod root are different things (§7.5)", async () => {
    const { getOwnerProfile } = await load();
    servePod({ [WEBID_DOC]: PROFILE_TTL });

    await getOwnerProfile();

    // Stated separately from the toEqual above so the diagnostic names the
    // mistake. The control test proved this host is reachable here.
    expect(requested().some((u) => u.startsWith(POD_ROOT))).toBe(false);
    expect(requested().every((u) => u.startsWith(IDENTITY))).toBe(true);
  });

  it("takes storage from pim:storage in the document, not from POD_ROOT", async () => {
    // The fixture's `pim:storage </>` resolves against the WebID document, so
    // the storage it reports is the identity host root — which is NOT the
    // POD_ROOT env var. An implementation that "helpfully" filled this field in
    // from config would return POD_ROOT here and pass every other test.
    const { getOwnerProfile } = await load();
    servePod({ [WEBID_DOC]: PROFILE_TTL });

    const r = await getOwnerProfile();

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.storage).toBe(`${IDENTITY}/`);
    expect(r.value.storage).not.toBe(POD_ROOT);
  });
});

/* --------------------------------------------- 2. the Result comes back unchanged */

describe("getOwnerProfile passes the Result through, errors included", () => {
  it("returns a structured http error as a VALUE when the document is missing", async () => {
    const { getOwnerProfile } = await load();
    servePod({ [WEBID_DOC]: 404 });

    const call = getOwnerProfile();
    // The invariant, stated before the shape: a read returns a typed value or a
    // structured error, never a throw (§11). An `await` that rejects here is
    // the failure, so assert on the promise rather than on what follows it.
    await expect(call).resolves.toBeDefined();
    const r = await call;

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The whole error object, not just its kind. A status asserted without its
    // payload is how a zero-byte 404 shipped here once; the same reasoning
    // applies to an error object asserted without its fields. `url` must be the
    // document actually requested, not the raw WebID.
    expect(r.error).toEqual({ kind: "http", url: WEBID_DOC, status: 404 });
  });

  it("does not flatten a shape error into a generic one", async () => {
    // The cached layer sits between the read and the page. If it rewrote errors
    // — or swallowed them into null, or into `ok: true` with an empty value —
    // the studio would report "could not load" for a profile that is merely
    // missing its issuer, and nobody could tell the two apart.
    const { getOwnerProfile } = await load();
    servePod({ [WEBID_DOC]: NO_ISSUER });

    const r = await getOwnerProfile();

    expect(r).not.toBeNull();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("shape");
    if (r.error.kind !== "shape") return;
    expect(r.error.url).toBe(WEBID_DOC);
    // It must still name the field. An error that says only "no" is a boolean
    // with extra steps.
    expect(r.error.issues.join(" ")).toContain("oidcIssuer");
  });

  it("returns a network error as a value when the identity host is unreachable", async () => {
    const { getOwnerProfile } = await load();
    // An EXPLICIT transport failure, not merely an absent handler. Measured
    // while writing this file: test/setup.ts's onUnhandledRequest only PRINTS —
    // an unhandled request is passed through to the real internet and can
    // return 200 (verified against a live host). So "no handler" is not a way
    // to simulate an unreachable server, and every URL here is under the
    // reserved .test TLD as a second line of defence.
    server.use(http.get(WEBID_DOC, () => HttpResponse.error()));
    const call = getOwnerProfile();

    await expect(call).resolves.toBeDefined();
    const r = await call;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("network");
    if (r.error.kind !== "network") return;
    expect(r.error.url).toBe(WEBID_DOC);
    expect(typeof r.error.message).toBe("string");
    expect(r.error.message.length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- 3. the tag */

describe("getOwnerProfile is tagged", () => {
  it("tags the read with TAGS.ownerProfile, and with nothing else", async () => {
    const { getOwnerProfile, TAGS } = await load();
    servePod({ [WEBID_DOC]: PROFILE_TTL });

    await getOwnerProfile();

    // Exactly one tag: a second tag would mean revalidating something else
    // invalidates this, which is the coarseness TAGS' own comment warns about
    // going too far in the other direction.
    expect(cacheTagCalls).toEqual([TAGS.ownerProfile]);
    expect(cacheTagCalls).not.toContain(TAGS.diary);
  });
});

describe("TAGS.ownerProfile", () => {
  it("exists and is a non-empty string", async () => {
    const { TAGS } = await load();
    expect(typeof TAGS.ownerProfile).toBe("string");
    expect(TAGS.ownerProfile.length).toBeGreaterThan(0);
  });

  it("collides with no other tag, for any slug", async () => {
    const { TAGS } = await load();

    // Direct comparison against the one other flat tag.
    expect(TAGS.ownerProfile).not.toBe(TAGS.diary);

    // The parameterised tags are an infinite family, so comparing a handful of
    // slugs proves little. What settles it is that they are namespaced: every
    // trip tag begins "trip:" and every entry tag "entry:", so a tag beginning
    // with neither cannot be produced by any slug at all.
    const slugs = ["2026-japan", "ownerProfile", "owner-profile", "profile", "diary", ""];
    for (const slug of slugs) {
      expect(TAGS.trip(slug).startsWith("trip:")).toBe(true);
      expect(TAGS.entry(slug, "x").startsWith("entry:")).toBe(true);
      expect(TAGS.ownerProfile).not.toBe(TAGS.trip(slug));
      expect(TAGS.ownerProfile).not.toBe(TAGS.entry(slug, "x"));
    }
    expect(TAGS.ownerProfile.startsWith("trip:")).toBe(false);
    expect(TAGS.ownerProfile.startsWith("entry:")).toBe(false);

    // Control: the existing tags really are distinct from each other, so the
    // comparisons above are capable of failing.
    expect(TAGS.diary).not.toBe(TAGS.trip("diary"));
    expect(TAGS.trip("a")).not.toBe(TAGS.entry("a", "b"));
  });
});

/* ------------------------------------- 4. the directive, which only source can show */

/**
 * A source-text check, and openly so.
 *
 * `"use cache"` is a compiler directive: under vitest it is an inert string
 * expression, and the mock above means `cacheTag` no longer throws when it is
 * missing. So there is no runtime observation to make — a function in this file
 * without the directive behaves identically here and demotes `/studio` from
 * `○ (Static)` in the real build. Reading the source is the only check
 * available short of `next build`, which is where the invariant is really
 * enforced.
 */
describe("the 'use cache' directive in lib/pod/cached.ts", () => {
  const SOURCE = readFileSync("lib/pod/cached.ts", "utf8");

  /** Source of one top-level exported function, from its signature to the next
   *  top-level `export`. Crude, but the file is flat and it is checked below. */
  function bodyOf(name: string): string | undefined {
    const start = SOURCE.indexOf(`export async function ${name}(`);
    if (start === -1) return undefined;
    const next = SOURCE.indexOf("\nexport ", start + 1);
    return SOURCE.slice(start, next === -1 ? undefined : next);
  }

  /** Every top-level exported async function in the file. */
  const names = [...SOURCE.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);

  it("the extractor works, so the scan below cannot pass on an empty set", async () => {
    // Control. A regex that matched nothing would make "every tagged function
    // carries the directive" vacuously true.
    for (const name of ["getDiary", "getTrip", "getTripIndex", "getEntry", "publishedTripSlugs"]) {
      expect(names, `${name} should be found by the scan`).toContain(name);
      expect(bodyOf(name)).toContain("cacheTag(");
      expect(bodyOf(name)).toContain('"use cache"');
    }
  });

  it("every function that calls cacheTag also carries the directive", async () => {
    const tagged = names.filter((n) => bodyOf(n)?.includes("cacheTag("));
    expect(tagged.length).toBeGreaterThanOrEqual(5);
    for (const name of tagged) {
      expect(bodyOf(name), `${name} calls cacheTag without "use cache"`).toContain('"use cache"');
    }
  });

  it("getOwnerProfile is one of them", async () => {
    // The point of putting this function in the cached layer at all: an
    // uncached Pod read from the studio page blocks prerendering (§22).
    expect(names).toContain("getOwnerProfile");
    expect(bodyOf("getOwnerProfile")).toContain('"use cache"');
    expect(bodyOf("getOwnerProfile")).toContain("cacheTag(");
  });
});

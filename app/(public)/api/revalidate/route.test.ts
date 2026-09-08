import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { ESLint } from "eslint";
import { assertEntrySlug, assertSlug, tripUrl } from "@/lib/pod/read";
import { TAGS } from "@/lib/pod/tags";

/**
 * §10 step 4 — the revalidation hook route.
 *
 * "Call the revalidation hook so the public site drops its cache" is the last
 * step of the §10 write sequence. `lib/pod/save-entry.ts` already performs it,
 * through an injected `revalidate(tags)` callback, because it runs in the
 * BROWSER and `revalidateTag` is server-side. This file specifies the thing on
 * the other end of that callback: a route handler the studio posts tags to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE IT LIVES, AND WHY:  app/(public)/api/revalidate/route.ts  →  /api/revalidate
 *
 * Not in `(studio)`, even though the studio is its only legitimate caller. Three
 * reasons, and the first is the one that matters:
 *
 *  1. `app/(public)/**` is the path the eslint import fence is scoped to. Put
 *     the route there and it cannot import the Solid auth library, Radix, or
 *     lib/studio — none of which server-side, unauthenticated, no-session code
 *     has any business touching (invariants 3 and 4). Put it under `(studio)`
 *     and it is fenced for none of that. The fence is a constraint we WANT.
 *  2. `app/(public)/` already holds route handlers — `rss.xml`, `client-id.jsonld`
 *     — so this is the established home for "server code that is not a page".
 *  3. A route handler emits no HTML and contributes nothing to
 *     `.next/static/chunks`, so the public bundle budget is unaffected. The
 *     group name is about the fence, not about who calls it.
 *
 * The location is pinned by a test below, with a lint control showing that the
 * identical file at `app/api/revalidate/route.ts` is fenced by nothing at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS UNAUTHENTICATED, ON PURPOSE.
 *
 * `.env.example` currently declares a `REVALIDATE_SECRET`. That idea is dropped
 * here and the tests below require the declaration to go with it. The studio
 * runs in the visitor's browser with no server session (invariant 4), so any
 * secret it could send is a secret shipped to every visitor. A secret in the
 * client bundle is security theatre; documenting it as a secret is worse than
 * documenting the endpoint as open, because the next person believes it.
 *
 * What keeps that proportionate is the blast radius, and the blast radius is
 * what this file spends most of its assertions on:
 *
 *  - `revalidateTag` only drops cache. It is idempotent and destroys nothing.
 *  - the public routes already carry a 15-minute time-based revalidate
 *    (`○ / 15m 1y` in the route table), so the best an abuser achieves is
 *    forcing a refetch the timer performs anyway.
 *  - the ALLOWLIST keeps it that small. Without it the endpoint is a
 *    "revalidate any tag I name" primitive, which is a different thing: it
 *    turns "refetch this trip" into "invalidate everything".
 *  - the LIMITER bounds how often. It is in-memory and therefore per-process,
 *    which is a real limitation and is pinned as such rather than papered over.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE MOCK, AND WHY. `next/cache`'s real `revalidateTag` is only meaningful
 * inside a Next request or build; outside one it throws. That single Next
 * primitive is mocked and recorded, exactly as test/cached-owner-profile.test.ts
 * mocks `cacheTag`. Nothing in `lib/pod` is stubbed, and MSW is untouched — the
 * route makes no network request, so there is no HTTP seam to fake here.
 *
 * WHAT THIS FILE CANNOT PROVE, stated up front:
 *
 *  - That an unhandled verb returns 405. Next's dispatcher does that, from the
 *    absence of the export; calling an exported function cannot observe it.
 *    What is testable is that the export is absent, and that is what is tested.
 *  - That `revalidateTag` really invalidates anything. That is Next's, and only
 *    `next build` plus a live request can show it.
 *  - That the limiter's honesty comment is TRUE. Only that the claim is present.
 */

/* ══════════════════════════════════════════════ the one mock: next/cache ══ */

/**
 * Recorded, not discarded: which tags reached `revalidateTag` — and which did
 * not — is the entire blast-radius invariant. `vi.hoisted` because `vi.mock` is
 * hoisted above the imports.
 */
const { revalidateTagCalls, revalidatePathCalls } = vi.hoisted(() => ({
  revalidateTagCalls: [] as unknown[][],
  revalidatePathCalls: [] as unknown[][],
}));

vi.mock("next/cache", () => ({
  revalidateTag: (...args: unknown[]) => {
    revalidateTagCalls.push(args);
  },
  /**
   * Recorded so it can be asserted NEVER to have been called. `revalidatePath`
   * is a much bigger hammer than the design calls for — it invalidates whole
   * pages rather than the tagged reads — and reaching for it would quietly
   * widen the blast radius the allowlist exists to keep narrow.
   */
  revalidatePath: (...args: unknown[]) => {
    revalidatePathCalls.push(args);
  },
  // Not used by this route. Present so that an implementation reaching for one
  // of them fails on its own assertion rather than on an ESM link error that
  // kills the whole file before a single test runs.
  cacheTag: () => {},
  cacheLife: () => {},
  updateTag: () => {},
  refresh: () => {},
}));

/* ═══════════════════════════════════════════════════════ the route module ══ */

const ROUTE_PATH = "app/(public)/api/revalidate/route.ts";
const ROUTE_SPECIFIER = "@/app/(public)/api/revalidate/route";

/**
 * COMPILE time. `typeof import(…)` is a TYPE — erased before vite's
 * import-analysis ever sees this file — so `tsc --noEmit` reporting "Cannot
 * find module '@/app/(public)/api/revalidate/route'" IS the correct red state,
 * not a broken test. Once the module exists, every call below is checked
 * against its REAL signature rather than against a guess declared here.
 */
type RouteModule = typeof import("@/app/(public)/api/revalidate/route");

/**
 * RUNTIME. A static import of a module that does not exist is a resolution
 * error that kills the whole FILE — `(0 test)`, taking the harness controls
 * with it — and a literal dynamic import fails identically, because
 * import-analysis resolves those statically too. Only a specifier vite cannot
 * read at build time defers the failure to the test that needs it. Same device
 * as components/studio/studio-shell/studio-shell.test.tsx, and checked in both directions by a control.
 */
const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

async function loadRoute(): Promise<RouteModule> {
  const mod = (await importModule(ROUTE_SPECIFIER).catch((cause: unknown) => {
    throw new Error(
      `${ROUTE_PATH} does not exist yet — this is the red step of the TDD loop, not a broken test.`,
      { cause },
    );
  })) as RouteModule;
  if (typeof mod.POST !== "function") {
    throw new Error(`${ROUTE_PATH} exists but exports no POST function — still the red step.`);
  }
  return mod;
}

function routeSource(): string {
  if (!existsSync(ROUTE_PATH)) {
    throw new Error(
      `${ROUTE_PATH} does not exist yet — this is the red step of the TDD loop, not a broken test.`,
    );
  }
  return readFileSync(ROUTE_PATH, "utf8");
}

/* ══════════════════════════════════════════════════════════════ the clock ══ */

/**
 * Fake timers for the WHOLE FILE, installed once and advanced between tests
 * rather than reinstalled.
 *
 * The limiter is in-memory, so its state outlives a test. `vi.resetModules()`
 * below gives a fresh module — and therefore a fresh limiter — for the ordinary
 * case where that state is module-scoped. It does NOT help if the
 * implementation parks the state on `globalThis` to survive HMR, which is a
 * perfectly reasonable thing to do. Advancing the clock past any legal window
 * before each test clears the budget either way, so no test can be poisoned by
 * the one before it.
 *
 * Installed once, and advanced rather than reset, because `performance.now()`
 * restarts at zero on each `useFakeTimers()` — time going backwards between
 * tests is exactly the poison this is meant to avoid. `performance` is in
 * `toFake` for the same reason: it is not faked by default, and a limiter
 * reading it instead of `Date.now()` would otherwise see a frozen clock.
 * Measured, both of them, before this file was written.
 */
const CLOCK_STEP_MS = 2 * 60 * 60 * 1000; // 2h — larger than any window the sanity bounds allow

beforeAll(() => {
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  vi.setSystemTime(new Date("2026-09-04T00:00:00.000Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(CLOCK_STEP_MS);
  vi.resetModules();
  revalidateTagCalls.length = 0;
  revalidatePathCalls.length = 0;
  // The route validates slugs against the Pod's URL shape, and `config.podRoot`
  // throws when POD_ROOT is unset. Vitest does not load .env.local.
  vi.stubEnv("POD_ROOT", "https://storage.owner.test/2f9c1a/");
  vi.stubEnv("OWNER_WEBID", "https://id.owner.test/luca/card#me");
});

/* ═══════════════════════════════════════════════════════════════ requests ══ */

const ENDPOINT = "https://diary.example/api/revalidate";

/** The raw call, so a test can assert the promise RESOLVES. A route handler
 *  that throws is a 500, and "malformed input is a 400, not a 500" is one of
 *  the things being pinned. */
async function call(body: BodyInit | null, headers: Record<string, string> = {}): Promise<Response> {
  const { POST } = await loadRoute();
  const request = new Request(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  return POST(request);
}

const postTags = (tags: unknown, headers: Record<string, string> = {}) =>
  call(JSON.stringify({ tags }), headers);

/**
 * Status AND body, always together.
 *
 * CLAUDE.md names the half-check this exists to prevent: "an HTTP status
 * asserted without its body — that shipped a zero-byte 404". A response that
 * says 200 and carries nothing tells the studio nothing about whether its save
 * is visible.
 */
async function payload(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  expect(text.length, `the ${res.status} response had an empty body`).toBeGreaterThan(0);
  expect(
    res.headers.get("content-type") ?? "",
    `the ${res.status} response is not JSON`,
  ).toContain("application/json");
  return JSON.parse(text) as Record<string, unknown>;
}

/** The tags that actually reached `revalidateTag`, in order. */
const revalidated = () => revalidateTagCalls.map((args) => args[0]);

/* ══════════════════════════════════════════════ deriving the valid shapes ══ */

/**
 * Every valid example is BUILT BY `TAGS`, never typed out. A literal `"trip:x"`
 * in this file would keep passing after someone renamed the prefix in
 * `lib/pod/tags.ts`, and a revalidation tag that does not match the tag the
 * read was stamped with fails silently — the public site simply keeps serving
 * the old page. That is the failure this whole indirection exists to prevent,
 * and tags.ts's own header says so.
 */
const SLUG = "2026-japan";
const ENTRY = "day-1-narita";

const VALID = {
  diary: TAGS.diary,
  ownerProfile: TAGS.ownerProfile,
  trip: TAGS.trip(SLUG),
  entry: TAGS.entry(SLUG, ENTRY),
};

/**
 * The slug rule is READ.TS'S slug rule, reused rather than reinvented.
 *
 * `assertSlug` and `assertEntrySlug` encode the §4 invariant that the container
 * segment IS the slug (and, for an entry, the filename). Feeding a slug back
 * through the URL builder and asking those functions whether it survives is the
 * same question as "could a read ever have stamped this tag?" — and a tag no
 * read could stamp is a tag with nothing to invalidate.
 *
 * Derived, not tabulated, so the endpoint and the read layer cannot drift: if
 * `assertSlug` changes, the expectations below change with it.
 */
const POD_ROOT = "https://storage.owner.test/2f9c1a/";

/** The URL `lib/pod/cached.ts` builds for `getEntry`. Entries have no exported
 *  URL builder; this mirrors the one place that constructs it. */
const entryResourceUrl = (slug: string, entry: string) =>
  new URL(
    `travel/trips/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entry)}.ttl`,
    POD_ROOT,
  ).toString();

const tripSlugOk = (slug: string) => assertSlug(tripUrl(POD_ROOT, slug), slug).ok;
const entrySlugOk = (slug: string, entry: string) =>
  assertEntrySlug(entryResourceUrl(slug, entry), entry).ok;

/**
 * Next's documented ceiling: "Tags are case-sensitive and must not exceed 256
 * characters. A tag that exceeds the limit is never assigned to cached data, so
 * revalidating it does nothing."
 * — node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md
 *
 * So an over-long tag is not merely useless, it is outside the primitive's
 * contract. Cited rather than invented; both sides of the boundary are tested.
 */
const MAX_TAG_LENGTH = 256;

/* ══════════════════════════════════════════════════════════ eslint helper ══ */

/** Discovers eslint.config.mjs from cwd, exactly as test/guardrails.test.ts does,
 *  so these cases lint against the real config and not a copy of it. */
const eslint = new ESLint({ cwd: process.cwd() });
async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
  return (result?.messages ?? []).map((m) => m.ruleId);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 0. Harness controls.
 *
 * Expected GREEN from the first run, deliberately. They are what stops
 * everything below from being vacuous: "revalidateTag was not called" must mean
 * the route declined, not that the recorder was never wired; "this slug is
 * rejected" must mean the endpoint rejected it, not that the derivation says
 * everything is invalid.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("harness controls (expected green — they are what makes the rest mean something)", () => {
  it("the revalidateTag recorder is live, so an empty recording means 'not called'", async () => {
    const cache = (await importModule("next/cache")) as {
      revalidateTag: (tag: string, profile: unknown) => void;
      revalidatePath: (path: string) => void;
    };

    cache.revalidateTag("control-tag", { expire: 0 });
    cache.revalidatePath("/control");

    expect(revalidateTagCalls).toEqual([["control-tag", { expire: 0 }]]);
    expect(revalidatePathCalls).toEqual([["/control"]]);
    revalidateTagCalls.length = 0;
    revalidatePathCalls.length = 0;
  });

  it("the dynamic loader resolves the @/ alias — including a route group — and rejects what is absent", async () => {
    // A path containing `(public)` really does resolve through the alias, so a
    // rejection below means the route is missing and not that the parentheses
    // defeated the resolver.
    const known = (await importModule("@/app/(public)/sitemap")) as { default?: unknown };
    expect(typeof known.default).toBe("function");

    await expect(importModule("@/app/(public)/api/definitely-not-here/route")).rejects.toThrow();
  });

  it("the slug derivation discriminates, so 'rejected' is an observation", () => {
    // Both directions. A derivation that answered `false` to everything would
    // make every reject case below pass for the wrong reason.
    expect(tripSlugOk("2026-japan")).toBe(true);
    expect(tripSlugOk("a/b")).toBe(false);
    expect(tripSlugOk("..")).toBe(false);
    expect(tripSlugOk("")).toBe(false);
    expect(entrySlugOk("2026-japan", "day-1")).toBe(true);
    expect(entrySlugOk("2026-japan", "day 1")).toBe(false);
  });

  it("the four valid shapes are four distinct strings", () => {
    const all = Object.values(VALID);
    expect(new Set(all).size).toBe(4);
    for (const tag of all) expect(tag.length).toBeGreaterThan(0);
  });

  /**
   * The fence, at the route's path and at the path it might drift to.
   *
   * Both halves pass today — the rule already scopes to `app/(public)/**`. They
   * are here because they are the argument for the location assertion in
   * section 1: the second half shows the identical file one directory up is
   * fenced by nothing, so "where the route lives" is a security property and
   * not a filing preference.
   */
  it("the public import fence covers the route's path, and does not cover app/api/", async () => {
    const violation =
      `import { login } from "@inrupt/solid-client-authn-browser";\n` +
      `export async function POST() { return Response.json({ login: String(login) }); }\n`;

    expect(await lint(ROUTE_PATH, violation)).toContain("no-restricted-imports");
    expect(await lint("app/api/revalidate/route.ts", violation)).not.toContain(
      "no-restricted-imports",
    );
  });

  /** The allow-case. A fence that rejects everything a route needs is not a
   *  fence, it is a wall — and these three imports are exactly what the
   *  implementation is expected to reach for. */
  it("and the fence still allows next/cache, lib/pod/tags and lib/pod/read there", async () => {
    const legitimate =
      `import { revalidateTag } from "next/cache";\n` +
      `import { TAGS } from "@/lib/pod/tags";\n` +
      `import { assertSlug, tripUrl } from "@/lib/pod/read";\n` +
      `export async function POST() {\n` +
      `  return Response.json({ ok: [String(revalidateTag), TAGS.diary, String(assertSlug), String(tripUrl)] });\n` +
      `}\n`;

    expect(await lint(ROUTE_PATH, legitimate)).not.toContain("no-restricted-imports");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Where the route lives.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the route's location", () => {
  it("is app/(public)/api/revalidate/route.ts, inside the import fence", () => {
    expect(
      existsSync(ROUTE_PATH),
      `${ROUTE_PATH} is missing. See the header: (public) is where the eslint import fence ` +
        `applies, and the control above shows app/api/revalidate/route.ts is fenced by nothing.`,
    ).toBe(true);
  });

  it("and not outside the group, where nothing would fence it", () => {
    expect(existsSync("app/api/revalidate/route.ts")).toBe(false);
    expect(existsSync("app/(studio)/api/revalidate/route.ts")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The method surface.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("POST only", () => {
  it("exports POST", async () => {
    const mod = await loadRoute();
    expect(typeof mod.POST).toBe("function");
  });

  /**
   * A GET must not revalidate — and the way to guarantee that is for there to
   * be no GET at all. Next answers an unhandled verb with 405 from the absence
   * of the export; that dispatch is the framework's and cannot be observed by
   * calling an exported function, so the absence is what is asserted here. Said
   * plainly rather than dressed up as a 405 test.
   *
   * It matters beyond tidiness: a GET endpoint that mutates cache state is
   * reachable from a bare <img src>, a link preview, or a crawler.
   */
  it.each(["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])(
    "exports no %s, so Next answers that verb with 405 and nothing is revalidated",
    async (verb) => {
      const mod = (await loadRoute()) as unknown as Record<string, unknown>;
      expect(mod[verb]).toBeUndefined();
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Unauthenticated, and honest about it.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the endpoint is unauthenticated on purpose", () => {
  it("accepts a request carrying no credentials of any kind", async () => {
    // No Authorization header, no cookie, no bearer token, no secret in the
    // body. This is the whole design: the studio has no server session to
    // authenticate with (invariant 4), and a secret it could send would ship to
    // every visitor in the client bundle.
    const res = await postTags([VALID.diary]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 1, rejected: [] });
  });

  it("and .env.example no longer describes a REVALIDATE_SECRET", () => {
    // Documenting a secret that cannot be kept is worse than documenting the
    // endpoint as open: the next person reads it and believes the endpoint is
    // protected. If the variable stays, this fails — which is the point.
    const env = readFileSync(".env.example", "utf8");
    expect(env).not.toMatch(/^\s*REVALIDATE_SECRET\s*=/m);
    expect(env.toLowerCase()).not.toContain("shared secret");
  });

  it("and the route reads no secret from the environment", () => {
    const source = routeSource();
    expect(source).not.toMatch(/process\.env\.\w*(SECRET|TOKEN|PASSWORD)\w*/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. What it does, and what it says it did.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("a successful revalidation", () => {
  /**
   * The success body is CLOSED on purpose — `toEqual`, not `toMatchObject`.
   * The studio branches on it: `saveEntry` treats step 4 as failed if the hook
   * throws, and the hook can only know to throw by reading this. A body whose
   * keys grow over time is a body the caller cannot validate.
   */
  it("returns a count and an empty rejected list", async () => {
    const res = await postTags([VALID.trip]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 1, rejected: [] });
  });

  it("calls revalidateTag once per tag, with the tag it was given", async () => {
    const res = await postTags([VALID.diary, VALID.ownerProfile, VALID.trip, VALID.entry]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 4, rejected: [] });
    expect(revalidated()).toEqual([VALID.diary, VALID.ownerProfile, VALID.trip, VALID.entry]);
  });

  /**
   * THE SECOND ARGUMENT IS REQUIRED, AND WHICH ONE IT IS MATTERS.
   *
   * `revalidateTag(tag: string, profile: string | CacheLifeConfig)` in
   * next@16.3.4 — the one-argument form is deprecated and does not typecheck.
   *
   * `{ expire: 0 }` rather than the docs' generally-recommended `"max"`,
   * because of who calls this and why. `"max"` means stale-while-revalidate: the
   * NEXT visitor is served the old page and the refresh happens behind them. The
   * next visitor after a save is almost always the owner, clicking through from
   * the studio to look at what they just published — and with `"max"` they see a
   * trip page that still does not list the new entry, then have to reload. The
   * cost of `{ expire: 0 }` is one blocking Pod round trip for one visitor. For
   * a personal travel diary that is the right trade, and read-your-own-write on
   * the public page is the entire reason step 4 exists.
   *
   * (`updateTag`, which the docs point at for immediate expiry, is Server
   * Actions only and cannot be called from a route handler.)
   */
  it("passes an explicit cache-life profile of { expire: 0 }, not the deprecated one-argument form", async () => {
    await postTags([VALID.trip]);

    expect(revalidateTagCalls).toHaveLength(1);
    expect(revalidateTagCalls[0]).toEqual([VALID.trip, { expire: 0 }]);
  });

  it("never calls revalidatePath — the tags are the interface", async () => {
    await postTags([VALID.diary, VALID.ownerProfile, VALID.trip, VALID.entry]);

    expect(revalidatePathCalls).toEqual([]);
  });

  /**
   * The pair `lib/pod/save-entry.ts` actually produces at step 4:
   *
   *   await opts.revalidate([TAGS.trip(opts.tripSlug), TAGS.entry(opts.tripSlug, stamped.slug)]);
   *
   * Two tags, one request. This is the one case that must never be rejected,
   * because rejecting it means every save silently leaves the public site
   * stale. Honest limit: this asserts the SHAPE save-entry produces, built the
   * same way from `TAGS`; it does not run `saveEntry`, which needs a whole fake
   * Pod and is covered by test/entry-write.test.ts.
   */
  it("accepts the exact tag pair save-entry.ts step 4 sends", async () => {
    const res = await postTags([TAGS.trip(SLUG), TAGS.entry(SLUG, ENTRY)]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 2, rejected: [] });
    expect(revalidated()).toEqual([TAGS.trip(SLUG), TAGS.entry(SLUG, ENTRY)]);
  });

  it("treats an empty list as a well-formed no-op, not an error", async () => {
    const res = await postTags([]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 0, rejected: [] });
    expect(revalidateTagCalls).toEqual([]);
  });

  it("de-duplicates, so the count is the number of tags actually revalidated", async () => {
    const res = await postTags([VALID.trip, VALID.trip, VALID.diary, VALID.trip]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 2, rejected: [] });
    // Once each. A count that double-counted would tell the studio it did more
    // work than it did, and repeated calls are pointless work in the handler.
    expect(revalidated()).toEqual([VALID.trip, VALID.diary]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. The allowlist.
 *
 * The blast-radius rule: this endpoint revalidates the four tag shapes the read
 * layer stamps, and nothing else. Anything else is reported as rejected and
 * never reaches `revalidateTag`.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("the allowlist rejects what the read layer never stamps", () => {
  /**
   * Tags that no `TAGS` call can produce. Each is a plausible thing an abuser
   * or a confused caller would send, and none of them is a cache tag this app
   * assigns to anything.
   */
  const NOT_PRODUCIBLE = [
    "*",
    "",
    " ",
    "trip",
    "trip:",
    "entry",
    "entry:2026-japan",
    "DIARY",
    "Diary",
    "diary ",
    " diary",
    "owner-profile-x",
    "x-owner-profile",
    "_N_T_/layout",
    "__NEXT_PRIVATE",
    "trip:2026-japan;diary",
  ];

  it.each(NOT_PRODUCIBLE)("rejects %j without calling revalidateTag", async (tag) => {
    const res = await postTags([tag]);

    // 200, not 400: the request was understood and answered honestly. What
    // happened to each tag is a per-item outcome, and it is in the body — which
    // is the point of returning a body at all.
    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 0, rejected: [tag] });
    expect(revalidateTagCalls).toEqual([]);
  });

  it("reports a mix honestly: the valid ones run, the invalid ones are named", async () => {
    const res = await postTags([VALID.trip, "*", VALID.diary, "trip:", "everything"]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({
      revalidated: 2,
      rejected: ["*", "trip:", "everything"],
    });
    // The half that matters: an invalid tag must not reach the primitive.
    expect(revalidated()).toEqual([VALID.trip, VALID.diary]);
  });

  it("de-duplicates the rejected list too", async () => {
    const res = await postTags(["*", "*", "everything", "*"]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 0, rejected: ["*", "everything"] });
  });

  /* ------------------------------------------------------- slugs, derived */

  /**
   * Trip slugs, with the verdict COMPUTED from `assertSlug` rather than written
   * down. The instruction was to reuse what read.ts already enforces; deriving
   * it means the two cannot drift, and it means this table keeps testing the
   * right thing if the slug rule is ever tightened.
   *
   * The list is measured, not guessed: `encodeURIComponent` leaves
   * `!'()*-._~` alone, so `a.b`, `a~b` and `a..b` survive the round trip while
   * `café`, `a b`, `a/b`, `a#b` and `..` do not.
   */
  const TRIP_SLUGS = [
    "2026-japan",
    "a",
    "A-Z_09",
    "a.b",
    "a~b",
    "a..b",
    "café",
    "日本",
    "a b",
    "a/b",
    "a#b",
    "a?b",
    "..",
    ".",
    "",
    "%2e%2e",
    "a\\b",
  ];

  it("the trip-slug table exercises both verdicts", () => {
    // Control. A table that had drifted to all-accept or all-reject would make
    // every case below pass while proving nothing.
    const verdicts = TRIP_SLUGS.map(tripSlugOk);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it.each(TRIP_SLUGS)("trip tag for slug %j matches assertSlug's verdict", async (slug) => {
    const tag = TAGS.trip(slug);
    const expected = tripSlugOk(slug);

    const res = await postTags([tag]);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual(
      expected ? { revalidated: 1, rejected: [] } : { revalidated: 0, rejected: [tag] },
    );
    expect(revalidated()).toEqual(expected ? [tag] : []);
  });

  const ENTRY_PAIRS: [string, string][] = [
    ["2026-japan", "day-1"],
    ["2026-japan", "a.b"],
    ["2026-japan", "b/c"],
    ["2026-japan", "day 1"],
    ["2026-japan", "café"],
    ["a/b", "c"],
    ["", "day-1"],
    ["..", "day-1"],
  ];

  it("the entry-pair table exercises both verdicts", () => {
    const verdicts = ENTRY_PAIRS.map(([s, e]) => tripSlugOk(s) && entrySlugOk(s, e));
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it.each(ENTRY_PAIRS)(
    "entry tag for (%j, %j) matches read.ts's verdict on both halves",
    async (slug, entry) => {
      const tag = TAGS.entry(slug, entry);
      const expected = tripSlugOk(slug) && entrySlugOk(slug, entry);

      const res = await postTags([tag]);

      expect(res.status).toBe(200);
      expect(await payload(res)).toEqual(
        expected ? { revalidated: 1, rejected: [] } : { revalidated: 0, rejected: [tag] },
      );
    },
  );

  /**
   * `entry:a/b/c` is ambiguous — `TAGS.entry("a", "b/c")` and
   * `TAGS.entry("a/b", "c")` both produce it. Rejected either way, because
   * neither reading survives the round trip, so the parse of an entry tag stays
   * unambiguous: exactly one `/` after the prefix.
   */
  it("rejects an entry tag with two slashes, which no single (slug, entry) pair owns", async () => {
    expect(TAGS.entry("a", "b/c")).toBe(TAGS.entry("a/b", "c"));

    const res = await postTags([TAGS.entry("a", "b/c")]);

    expect(await payload(res)).toEqual({ revalidated: 0, rejected: [TAGS.entry("a", "b/c")] });
  });

  /* ------------------------------------------------------ Next's own limit */

  it("accepts a tag of exactly 256 characters", async () => {
    const tag = TAGS.trip("x".repeat(MAX_TAG_LENGTH - TAGS.trip("").length));
    expect(tag).toHaveLength(MAX_TAG_LENGTH);

    const res = await postTags([tag]);

    expect(await payload(res)).toEqual({ revalidated: 1, rejected: [] });
  });

  it("rejects a tag of 257, which Next never assigns to cached data anyway", async () => {
    const tag = TAGS.trip("x".repeat(MAX_TAG_LENGTH + 1 - TAGS.trip("").length));
    expect(tag).toHaveLength(MAX_TAG_LENGTH + 1);

    const res = await postTags([tag]);

    expect(await payload(res)).toEqual({ revalidated: 0, rejected: [tag] });
    expect(revalidateTagCalls).toEqual([]);
  });

  /* --------------------------------------- derived from TAGS, not hardcoded */

  /**
   * THE ANTI-DRIFT TEST, and it is a real runtime observation rather than a
   * source-text check.
   *
   * `lib/pod/tags.ts` is replaced with one that spells the same four shapes
   * differently. An implementation that derives its allowlist from `TAGS` moves
   * with it; one carrying a hardcoded `/^trip:/` regex does not.
   *
   * It cannot pass by accident in either direction: if the mock fails to apply,
   * the new spellings are rejected and the old ones accepted, which is the
   * exact inverse of what is asserted. A silent no-op flips the result rather
   * than hiding inside a green tick.
   */
  it("derives the shapes from TAGS — respelling tags.ts moves the allowlist with it", async () => {
    vi.doMock("@/lib/pod/tags", () => ({
      TAGS: {
        diary: "chronicle",
        ownerProfile: "keeper",
        trip: (slug: string) => `voyage:${slug}`,
        entry: (slug: string, entry: string) => `leg:${slug}/${entry}`,
      },
    }));
    vi.resetModules();

    try {
      const res = await postTags([
        `voyage:${SLUG}`,
        "chronicle",
        `leg:${SLUG}/${ENTRY}`,
        "keeper",
        // The REAL spellings, which the respelled tags.ts no longer produces.
        TAGS.trip(SLUG),
        TAGS.diary,
      ]);

      expect(res.status).toBe(200);
      expect(await payload(res)).toEqual({
        revalidated: 4,
        rejected: [TAGS.trip(SLUG), TAGS.diary],
      });
      expect(revalidated()).toEqual([
        `voyage:${SLUG}`,
        "chronicle",
        `leg:${SLUG}/${ENTRY}`,
        "keeper",
      ]);
    } finally {
      vi.doUnmock("@/lib/pod/tags");
      vi.resetModules();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5b. Where reusing read.ts's rule gives an answer worth saying out loud.
 *
 * These are pinned, not swept up, because an undefined corner is how a hole
 * ships. Each is accepted by the rule the endpoint was told to reuse, and each
 * is harmless for the same reason: `revalidateTag` does no pattern matching, so
 * a tag nothing was stamped with invalidates nothing. Flagged for review — if
 * any of them should instead be rejected, that is a change to the SLUG rule in
 * read.ts, not a second rule bolted on here.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("corners the reused slug rule leaves open", () => {
  it("accepts trip:* — encodeURIComponent leaves '*' alone, and revalidateTag does not glob", async () => {
    // The verdict is read.ts's, shown rather than asserted from memory.
    expect(tripSlugOk("*")).toBe(true);

    const res = await postTags([TAGS.trip("*")]);

    expect(await payload(res)).toEqual({ revalidated: 1, rejected: [] });
    // Harmless: it is one opaque string, matching no tag any read stamped.
    expect(revalidated()).toEqual(["trip:*"]);
  });

  it("accepts an empty entry slug, because assertEntrySlug does", async () => {
    // `entries/.ttl` → filename ".ttl" → strip → "" → equal. Weaker than
    // assertSlug, which rejects an empty trip slug outright.
    expect(entrySlugOk(SLUG, "")).toBe(true);
    expect(tripSlugOk("")).toBe(false);

    const res = await postTags([TAGS.entry(SLUG, "")]);

    expect(await payload(res)).toEqual({ revalidated: 1, rejected: [] });
  });

  it("accepts '..' as an entry slug for the same reason, and it addresses nothing", async () => {
    expect(entrySlugOk(SLUG, "..")).toBe(true);

    const res = await postTags([TAGS.entry(SLUG, "..")]);

    expect(await payload(res)).toEqual({ revalidated: 1, rejected: [] });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. Malformed input is a 400, never a 500 and never a throw.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("a malformed request", () => {
  /** Every 400 must carry a body that says something. A bare status is the
   *  zero-byte-404 failure again. */
  async function expectBadRequest(res: Response) {
    expect(res.status).toBe(400);
    const body = await payload(res);
    expect(typeof body.error, `400 body: ${JSON.stringify(body)}`).toBe("string");
    expect(String(body.error).length).toBeGreaterThan(0);
    expect(revalidateTagCalls).toEqual([]);
    return body;
  }

  it("rejects a body that is not JSON at all", async () => {
    const promise = call("this is not json");

    // Resolves, rather than throwing. A handler that lets `request.json()`
    // reject produces a 500 in production and an unhandled rejection here —
    // both of which are the endpoint blaming itself for the caller's mistake.
    await expect(promise).resolves.toBeInstanceOf(Response);
    await expectBadRequest(await promise);
  });

  it("rejects an empty body", async () => {
    const promise = call(null);

    await expect(promise).resolves.toBeInstanceOf(Response);
    await expectBadRequest(await promise);
  });

  it.each([
    ["an array", "[]"],
    ["a string", '"diary"'],
    ["a number", "7"],
    ["null", "null"],
    ["true", "true"],
  ])("rejects valid JSON that is %s rather than an object", async (_label, body) => {
    await expectBadRequest(await call(body));
  });

  it("rejects an object with no tags property", async () => {
    await expectBadRequest(await call(JSON.stringify({ tag: "diary" })));
  });

  it.each([
    ["a string", "diary"],
    ["an object", { 0: "diary" }],
    ["a number", 1],
    ["null", null],
  ])("rejects tags that is %s rather than an array", async (_label, tags) => {
    await expectBadRequest(await postTags(tags));
  });

  it.each([
    ["a number", [1]],
    ["null", [null]],
    ["an object", [{ tag: "diary" }]],
    ["a nested array", [["diary"]]],
    ["a valid tag beside a number", ["diary", 2]],
  ])("rejects a tags array containing %s", async (_label, tags) => {
    // A non-string element is a type violation in the request, not a tag to
    // report as rejected — `rejected` is a list of strings, and coercing
    // `[object Object]` into it would be an invented tag nobody sent.
    await expectBadRequest(await postTags(tags));
  });

  it("rejects more tags in one request than the limit allows", async () => {
    const { LIMITS } = await loadRoute();
    // All of them individually VALID, so the 400 can only be about the count.
    // Without a cap, one request is an unbounded number of revalidateTag calls
    // and the per-request limiter below bounds nothing that matters.
    const tags = Array.from({ length: LIMITS.tagsPerRequest + 1 }, (_unused, i) =>
      TAGS.trip(`trip-${i}`),
    );

    await expectBadRequest(await postTags(tags));
  });

  it("but accepts exactly the limit", async () => {
    const { LIMITS } = await loadRoute();
    const tags = Array.from({ length: LIMITS.tagsPerRequest }, (_unused, i) =>
      TAGS.trip(`trip-${i}`),
    );

    const res = await postTags(tags);

    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: LIMITS.tagsPerRequest, rejected: [] });
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. The limiter.
 *
 * In memory, therefore per-process, therefore per-instance on a serverless
 * deploy. Invariant 1 leaves no alternative — the Pod is the only datastore, so
 * there is no KV, no Redis and no database to hold a shared counter — and that
 * limitation is pinned as a fact rather than wished away.
 * ═══════════════════════════════════════════════════════════════════════ */

describe("rate limiting", () => {
  it("exposes its parameters, and they are actually limits", async () => {
    const { LIMITS } = await loadRoute();

    // Exported so the tests derive from them instead of hardcoding a number
    // that drifts — the same reason the tag shapes come from TAGS.
    expect(Number.isInteger(LIMITS.requestsPerWindow)).toBe(true);
    expect(LIMITS.requestsPerWindow).toBeGreaterThanOrEqual(1);
    // An "Infinity" or "1e9" budget is not a limiter; the upper bounds are what
    // stop this whole section from passing against a limiter that never fires.
    expect(LIMITS.requestsPerWindow).toBeLessThanOrEqual(1000);

    expect(Number.isInteger(LIMITS.windowMs)).toBe(true);
    expect(LIMITS.windowMs).toBeGreaterThanOrEqual(1_000);
    expect(LIMITS.windowMs).toBeLessThanOrEqual(60 * 60 * 1000);

    expect(Number.isInteger(LIMITS.tagsPerRequest)).toBe(true);
    // save-entry.ts step 4 sends TWO tags in one call. A cap of 1 breaks every
    // save.
    expect(LIMITS.tagsPerRequest).toBeGreaterThanOrEqual(2);
    expect(LIMITS.tagsPerRequest).toBeLessThanOrEqual(100);
  });

  it("allows a full window of requests before it says no", async () => {
    // The allow-case, first. A limiter that rejects everything would satisfy
    // the 429 test below and be completely useless.
    const { LIMITS } = await loadRoute();

    for (let i = 0; i < LIMITS.requestsPerWindow; i++) {
      const res = await postTags([VALID.diary]);
      expect(res.status, `request ${i + 1} of ${LIMITS.requestsPerWindow} was limited`).toBe(200);
    }

    expect(revalidateTagCalls).toHaveLength(LIMITS.requestsPerWindow);
  });

  it("then answers 429, with a body and a Retry-After, and revalidates nothing", async () => {
    const { LIMITS } = await loadRoute();
    for (let i = 0; i < LIMITS.requestsPerWindow; i++) await postTags([VALID.diary]);
    revalidateTagCalls.length = 0;

    const res = await postTags([VALID.diary]);

    expect(res.status).toBe(429);
    const body = await payload(res);
    expect(typeof body.error).toBe("string");
    expect(String(body.error).length).toBeGreaterThan(0);

    // The standard place to say "come back later". A 429 without it leaves a
    // caller guessing, and the studio's retry would be a guess too.
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).toMatch(/^\d+$/);
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(Math.ceil(LIMITS.windowMs / 1000));

    expect(revalidateTagCalls).toEqual([]);
  });

  it("lets the budget refill once the window has passed", async () => {
    const { LIMITS } = await loadRoute();
    for (let i = 0; i < LIMITS.requestsPerWindow; i++) await postTags([VALID.diary]);
    expect((await postTags([VALID.diary])).status).toBe(429);

    vi.advanceTimersByTime(LIMITS.windowMs + 1_000);

    // Not a permanent lockout. The window is a window.
    const res = await postTags([VALID.diary]);
    expect(res.status).toBe(200);
    expect(await payload(res)).toEqual({ revalidated: 1, rejected: [] });
  });

  /**
   * THE BUDGET IS NOT KEYED ON ANYTHING THE CALLER CONTROLS.
   *
   * The obvious implementation is a bucket per client IP, and behind a proxy
   * the only IP available is `x-forwarded-for` — which the client sets. A
   * limiter keyed on a header the attacker chooses is bypassed by changing the
   * header, i.e. it is not a limiter, it is a comment that looks like one. This
   * project has spent a lot of effort removing guardrails that lie.
   *
   * A single process-wide budget is spoof-proof, and its cost is bounded by the
   * same reasoning that makes the endpoint open at all: an abuser holding the
   * budget down means the owner's save does not invalidate immediately, and the
   * 15-minute timer publishes it anyway. Losing minutes of freshness beats an
   * endpoint that pretends to be limited.
   *
   * A finer per-IP bucket UNDERNEATH a process-wide cap still passes this.
   */
  it("cannot be reset by rotating x-forwarded-for", async () => {
    const { LIMITS } = await loadRoute();
    const ip = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

    for (let i = 0; i < LIMITS.requestsPerWindow; i++) {
      const res = await postTags([VALID.diary], { "x-forwarded-for": ip(i) });
      expect(res.status, `request ${i + 1} from ${ip(i)} was limited early`).toBe(200);
    }

    const spoofed = await postTags([VALID.diary], {
      "x-forwarded-for": "203.0.113.7",
      "x-real-ip": "203.0.113.7",
      forwarded: "for=203.0.113.7",
    });

    expect(spoofed.status).toBe(429);
  });

  /**
   * A DOCUMENTATION CHECK, and openly so.
   *
   * It verifies that the claim is PRESENT, not that it is true — no test can
   * check the latter. It is here because the limitation is real and easy to
   * forget: on a serverless deploy each instance has its own counter, so the
   * effective global rate is the limit times the number of warm instances, and
   * a restart resets it. Someone reading `LIMITS.requestsPerWindow` without
   * that sentence nearby will believe the endpoint is rate-limited in a way it
   * is not. The matcher is loose on wording and strict on both ideas appearing.
   */
  it("says in the source what the in-memory limiter does not protect against", () => {
    const source = routeSource();
    expect(source, "the source should say the limiter is in memory").toMatch(/in[- ]memory/i);
    expect(
      source,
      "the source should say that makes it per-process / per-instance",
    ).toMatch(/per[- ](process|instance)/i);
  });
});

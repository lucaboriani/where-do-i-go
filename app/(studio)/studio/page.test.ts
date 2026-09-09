/**
 * `app/(studio)/studio/page.tsx` — the thin server component, and the one prop
 * it has to grow for the studio to be able to list anything.
 *
 * WHY THIS FILE EXISTS AT ALL. The page has never had a test. It was thin
 * enough not to need one: read four values, hand them down. It is no longer,
 * because `POD_ROOT` is the fifth and it is the one value the browser cannot
 * obtain for itself — not `NEXT_PUBLIC_`, and `lib/config.ts`'s `required()`
 * throws the moment it is reached on the client. Everything below the page runs
 * inside `ssr: false`, so if the page does not pass it, nothing can.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INSTRUMENT, AND WHY IT IS NOT A SOURCE SCAN.
 *
 * The brief allowed a source-level scan on the grounds that there is no
 * precedent for testing this page. There turned out to be a better instrument,
 * measured before it was relied on: an async server component is a function
 * that returns a React element, and calling it directly gives back an element
 * whose `type` and `props` can be read. So this file asserts what the page
 * ACTUALLY passes, at the value level, rather than what its source looks like —
 * which means a page that computed the right prop and forgot to spread it fails
 * here, and one that renamed `podRoot` at the call site fails here too.
 *
 * A scan would also have been blind to the one assertion below that carries the
 * most weight: that the value passed is `config.podRoot`, NORMALISED, and not
 * `process.env.POD_ROOT`. Those two are the same string on a well-formed
 * deployment and differ by a trailing slash on a real one, and every URL join
 * in `lib/studio/trips.ts` depends on the slash being there.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE MOCK, AND WHY. `next/cache`'s real `cacheTag` throws outside a Next
 * build — verbatim: "`cacheTag()` is only available with the `cacheComponents`
 * config" — so `lib/pod/cached.ts`, which `getOwnerProfile` lives in, is simply
 * not callable under vitest without neutralising it. Identical to the mock in
 * test/cached-owner-profile.test.ts, and scoped to that one Next primitive: the
 * Pod itself stays faked at the HTTP layer through MSW, so the WebID really is
 * read over the wire and the issuer below really is parsed out of §7.5's
 * fixture.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import StudioClient from "@/components/studio/studio-client";

/* ------------------------------------------------- the one mock: next/cache */

vi.mock("next/cache", () => ({
  cacheTag: () => {},
  cacheLife: () => {},
  revalidateTag: () => {},
}));

/* ----------------------------------------------------------------- fixtures */

/** §7.5's WebID document, read out of docs/data-model.md at runtime. Those
 *  blocks are normative (§11), so a hand-copied fixture would test a copy of
 *  the spec. Same extraction and the same block index as
 *  test/cached-owner-profile.test.ts. */
const blocks = [
  ...readFileSync("docs/data-model.md", "utf8").matchAll(/```turtle\n([\s\S]*?)```/g),
].map((m) => m[1]);
const PROFILE_TTL = blocks[4];

/**
 * Identity host and storage host are deliberately DIFFERENT, and neither is
 * localhost. §7.5: "on ESS identity and storage are different hosts entirely" —
 * if they shared an origin, a page that passed `config.ownerWebId` where
 * `config.podRoot` belongs could pass by coincidence. Both are under `.test`,
 * which RFC 6761 guarantees will never resolve, so a fixture host cannot answer
 * for real.
 */
const IDENTITY = "https://id.owner.test";
const WEBID = `${IDENTITY}/luca/card#me`;
/** What must actually be requested: the WebID with its fragment stripped. */
const WEBID_DOC = `${IDENTITY}/luca/card`;
/** The issuer §7.5's fixture declares. Asserted rather than assumed, so a
 *  fixture drift shows up as a fixture failure and not as a wiring one. */
const ISSUER = "https://login.inrupt.com";

const POD_ROOT = "https://storage.owner.test/2f9c1a/";
const SITE_URL = "https://diary.example";
const SITE_NAME = "Luca's travel diary";

/** The page is an async function component: calling it returns the element it
 *  would render. Loaded through the module namespace so the parenthesised route
 *  group in the path is resolved by the same `@/` alias the app uses. */
async function renderPage() {
  const mod = (await import("@/app/(studio)/studio/page")) as {
    default: () => Promise<{ type: unknown; props: Record<string, unknown> }>;
  };
  return mod.default();
}

function serveProfile(body: string | number = PROFILE_TTL) {
  server.use(
    http.get(WEBID_DOC, () =>
      typeof body === "number"
        ? new HttpResponse(`status ${body}`, { status: body })
        : HttpResponse.text(body, { headers: { "content-type": "text/turtle" } }),
    ),
  );
}

function stubDeployment(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {
    POD_ROOT,
    OWNER_WEBID: WEBID,
    SITE_URL,
    SITE_NAME,
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ==========================================================================
 * The controls. Both would, if wrong, turn every assertion below into a green
 * statement about nothing.
 * ======================================================================== */

describe("what this file stands on", () => {
  it("the §7.5 fixture really carries the issuer this file expects", () => {
    expect(PROFILE_TTL).toContain("solid:oidcIssuer");
    expect(PROFILE_TTL).toContain(ISSUER);
  });

  it("the page really is reachable and really returns an element", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage();

    // Not a source scan and not a snapshot: an object with a component `type`
    // and a props bag is what every assertion below reads.
    expect(element).toBeTruthy();
    expect(typeof element.props).toBe("object");
  });
});

/* ==========================================================================
 * The wiring.
 * ======================================================================== */

describe("app/(studio)/studio/page.tsx", () => {
  /**
   * THE PROP THIS STEP IS ABOUT.
   *
   * `podRoot` reaches the client shell, because nothing below this file can
   * read it: `components/studio/studio-client/studio-client.tsx` is `ssr: false` and
   * `lib/config.ts` throws in a browser. Without it the studio can enumerate
   * nothing and the owner sees the "no trips" note on a Pod full of trips,
   * which is the state the app is in today.
   */
  it("hands podRoot down to the client shell", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage();

    // It is the client wrapper, by identity rather than by name: a page that
    // rendered the shell directly would put the Solid session library on the
    // server, which is the one place it must never be.
    expect(element.type).toBe(StudioClient);
    expect(element.props.podRoot).toBe(POD_ROOT);
  });

  /**
   * THE VALUE IS `config.podRoot`, NOT `process.env.POD_ROOT`.
   *
   * `config` appends the trailing slash and nothing else does. Every URL in
   * `lib/studio/trips.ts` is built with `new URL("travel/trips/", podRoot)`, and
   * without the slash that resolves against the PARENT — `.../travel/trips/`
   * becomes a sibling of the storage root rather than a child of it, which is a
   * 404 the owner cannot diagnose.
   *
   * A well-formed .env makes these two identical, which is exactly why this
   * case sets a malformed one: it is the only assertion here that can tell
   * `config.podRoot` and `process.env.POD_ROOT` apart.
   */
  it("passes the normalised root, so a POD_ROOT without a trailing slash still joins", async () => {
    const unslashed = "https://storage.owner.test/2f9c1a";
    stubDeployment({ POD_ROOT: unslashed });
    serveProfile();

    const element = await renderPage();

    // The mutation really is a mutation: if these were equal the case would be
    // asserting that a slash-terminated value stays slash-terminated.
    expect(unslashed).not.toBe(POD_ROOT);
    expect(element.props.podRoot).toBe(POD_ROOT);
    expect(String(element.props.podRoot).endsWith("/")).toBe(true);
    // And the join it exists for actually works.
    expect(new URL("travel/trips/", String(element.props.podRoot)).toString()).toBe(
      `${POD_ROOT}travel/trips/`,
    );
  });

  /**
   * THE POD ROOT IS NOT THE WEBID, and on ESS they are different hosts
   * entirely (§7.5). The four existing props are asserted alongside it because
   * adding a fifth is exactly when one of the other four gets dropped or
   * shuffled — and because `ownerWebId` is the value most likely to be passed
   * twice under two names.
   *
   * The key set is asserted exactly, in the style of the `login()` argument
   * assertion in components/studio/studio-shell/studio-shell.test.tsx: an extra prop here is a value
   * crossing the server/client boundary that nobody decided to send.
   */
  it("passes exactly the five values the browser cannot read for itself", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage();

    expect(element.props).toStrictEqual({
      ownerWebId: WEBID,
      // §7.5: the issuer comes out of the owner's WebID document, not an env
      // var. Read over MSW, so this also says the page still performs the read.
      oidcIssuer: ISSUER,
      siteUrl: SITE_URL,
      siteName: SITE_NAME,
      podRoot: POD_ROOT,
    });
    expect(element.props.podRoot).not.toBe(element.props.ownerWebId);
    expect(String(element.props.podRoot).startsWith(IDENTITY)).toBe(false);
  });

  /**
   * IT READS CONFIG SERVER-SIDE, WHICH IS THE HALF THAT IS EASY TO LOSE.
   *
   * The counterpart is already pinned: components/studio/studio-shell/studio-shell.test.tsx's source
   * section asserts the shell imports no `lib/config` and touches no
   * `process.env`, and test/studio-trips.test.ts asserts the same of
   * `lib/studio/trips.ts`. Neither of those says anyone reads it at all. This
   * does: with `POD_ROOT` absent, `config.podRoot`'s `required()` throws, so a
   * page that got the value from anywhere else — a literal, a `NEXT_PUBLIC_`
   * twin, an optional read with a fallback — would quietly succeed here.
   *
   * The message is asserted as well as the throw. `required()` names the
   * variable and points at .env.example, and that string is the whole reason a
   * missing var is a five-second fix rather than a debugging session.
   */
  it("fails loudly when POD_ROOT is absent, because it is config that supplies it", async () => {
    stubDeployment({ POD_ROOT: "" });
    serveProfile();

    await expect(renderPage()).rejects.toThrow(/POD_ROOT is not set/);
  });

  /**
   * The existing diagnostic branch, unchanged: no issuer, no sign-in, so the
   * page says what could not be read instead of inventing a plausible provider
   * and failing at the redirect on someone else's error page.
   *
   * A REGRESSION PIN, green from its first run and deliberately so — it claims
   * no new behaviour. It is here because this is the branch a fifth prop breaks
   * silently: it renders no `StudioClient` at all, so nothing about `podRoot`
   * shows up in it, and a page that started reading config before checking the
   * profile would turn a readable diagnostic into an unhandled throw.
   */
  it("still renders the diagnostic, and no client shell, when the WebID cannot be read", async () => {
    stubDeployment();
    serveProfile(404);

    const element = await renderPage();

    expect(element.type).not.toBe(StudioClient);
    // Status alone is not the assertion — the body is. A zero-byte diagnostic
    // shipped in this project once because only the status was checked.
    const text = JSON.stringify(element);
    expect(text).toContain("The studio cannot open");
    expect(text).toContain(WEBID);
    expect(text).toContain("404");
  });
});

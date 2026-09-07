// @vitest-environment jsdom
/**
 * The studio client shell — components/studio/studio-shell.tsx.
 *
 * THE THREE-FILE SHAPE, and why this file tests the middle one directly.
 * Next 16 rejects `ssr: false` inside a server component outright ("`ssr: false`
 * is not allowed with `next/dynamic` in Server Components"), so the studio is:
 *
 *   app/(studio)/studio/page.tsx        server. Reads config + getOwnerProfile(),
 *                                       renders the wrapper with props.
 *   components/studio/studio-client.tsx "use client". Holds the
 *                                       dynamic(() => import("./studio-shell"),
 *                                       { ssr: false }).
 *   components/studio/studio-shell.tsx  "use client". The real shell. THIS FILE.
 *
 * Tested directly rather than through the wrapper, because a test that rendered
 * the wrapper would be a test of next/dynamic.
 *
 * NOTHING IS MOCKED. The session arrives by injection as a plain object with a
 * real node EventEmitter, exactly as in test/session.test.ts — a test that mocks
 * @inrupt/solid-client-authn-browser tests the library's idea of a session. The
 * shell's behaviour is observed where it is observable: what is on the screen,
 * and what reached `login` / `logout` on the injected session.
 *
 * THE CONFIG THIS FILE NEEDED, all three of them the project's known "green run
 * that verified nothing" failure mode:
 *
 *   1. vitest.config.ts `include` was `**\/*.test.ts` only, so this file — the
 *      repo's first .tsx test — was silently never collected. `test/vitest-
 *      collection.test.ts` now fails if that regresses, because an uncollected
 *      test file reports nothing at all rather than reporting red.
 *   2. `environment` is "node" for the other 280 tests and stays that way; the
 *      docblock above switches this file alone to jsdom. Pinned by the first
 *      test below, which fails in a node environment.
 *   3. test/setup.ts did not load @testing-library/jest-dom. Pinned by the
 *      second test below, positive AND negative, so a no-op matcher cannot pass.
 */

import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { StrictMode } from "react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EVENTS } from "@inrupt/solid-client-authn-browser";
import { resetSessionRestore, type StudioSessionLike } from "@/lib/studio/session";

/* ==========================================================================
 * 0. The environment controls.
 *
 * These two do not test the shell. They test that this file is running the way
 * it claims to, and they are first because every assertion below is worthless
 * if either is wrong. A .tsx file that is not collected, or one collected into
 * a node environment, is how this suite would acquire a decorative component
 * test.
 * ======================================================================== */

describe("the test environment this file declares", () => {
  it("is jsdom, not the node default the other 280 tests use", () => {
    // Fails with "document is not defined" if the @vitest-environment docblock
    // at the top of this file stops being honoured.
    expect(typeof document).toBe("object");
    expect(typeof window).toBe("object");
    expect(window.navigator.userAgent).toMatch(/jsdom/i);
  });

  it("has the jest-dom matchers loaded, and they discriminate", () => {
    const attached = document.createElement("div");
    attached.textContent = "attached";
    document.body.append(attached);
    const detached = document.createElement("div");

    // Positive AND negative. The positive alone passes against a matcher that
    // returns { pass: true } unconditionally — which is what an unloaded
    // matcher shim, or a hand-rolled stand-in, would look like.
    expect(attached).toBeInTheDocument();
    expect(detached).not.toBeInTheDocument();

    attached.remove();
  });

  /**
   * The loader control, and it earns its place.
   *
   * Section 2 below reaches the component through a dynamic import whose
   * specifier vite cannot analyse — that is what keeps a missing component from
   * killing this whole file. The cost of that trick is a second explanation for
   * every failure: "the component is missing" and "the loader never resolves
   * anything" look identical from the outside. Both directions are pinned here,
   * against a module that certainly exists and one that certainly does not.
   */
  it("the dynamic loader resolves the @/ alias, and rejects what is absent", async () => {
    const known = (await importModule("@/lib/studio/session")) as {
      resetSessionRestore?: unknown;
    };
    expect(typeof known.resetSessionRestore).toBe("function");

    await expect(importModule("@/components/studio/definitely-not-here")).rejects.toThrow();
  });
});

/* ==========================================================================
 * 1. Fixtures.
 * ======================================================================== */

const OWNER = "https://alice.example/profile/card#me";
const VISITOR = "https://bob.example/profile/card#me";
const ISSUER = "https://login.example";
/** Deliberately NOT jsdom's own origin (http://localhost:3000). A shell that
 *  rebuilt the login URLs from window.location.origin would produce that one,
 *  and the sign-in assertions below would catch it. */
const SITE = "https://diary.example";
const SITE_NAME = "Luca's travel diary";
/**
 * The Pod root, a prop for the same reason the four values above are: POD_ROOT
 * is not `NEXT_PUBLIC_` and lib/config.ts throws the moment it is reached in a
 * browser.
 *
 * Nothing in THIS file ever reaches it. `renderShell` below always supplies
 * `trips`, and a supplied list means the shell offers exactly those and
 * enumerates nothing — so every case here stays what it was, a test of the
 * shell's RENDERING given its trips, with no Pod in it. Where the trips come
 * from is test/studio-trip-loading.test.tsx's subject, and it is the file that
 * pins that seam in both directions.
 */
const POD = "https://pod.test.example/";

/**
 * The two event names, tied to the library's own literals by their annotations.
 * `typeof EVENTS.SESSION_EXPIRED` is the string literal type "sessionExpired",
 * so an upgrade that renames the constant fails to COMPILE here rather than
 * leaving this file emitting an event nothing listens for — which would make
 * the headline test below pass while the studio never noticed an expiry.
 *
 * `import type` is erased: no library code is loaded and nothing is stubbed.
 */
const SESSION_EXPIRED: typeof EVENTS.SESSION_EXPIRED = "sessionExpired";
const LOGOUT: typeof EVENTS.LOGOUT = "logout";

type FakeInfo = { isLoggedIn: boolean; webId?: string };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * A fake Solid session. A THIRD one rather than a widened copy of the two in
 * test/session.test.ts, for the reason given there: those two are the fixture
 * 30 passing tests stand on. This one differs in one way it needs to — the
 * restore can be GATED, so `restoring` is an observable state rather than a
 * frame that has already gone by the time render() returns.
 *
 * `events` is a real node EventEmitter, not `{ on, off }`. Measured with tsc in
 * test/session.test.ts: ISessionEventListener extends EventEmitter and its
 * methods return `this`, so a hand-rolled stand-in is rejected. The annotation
 * on `asSessionLike` below is what enforces that here.
 *
 * `logout` mirrors the real one (@inrupt/solid-client-authn-browser@5.0.0,
 * dist/index.mjs): it sets info.isLoggedIn = false and THEN emits LOGOUT.
 * `handleIncomingRedirect` mutates `info` only once it settles — the phase-0
 * StrictMode finding in object form.
 */
function fakeStudioSession(initial: FakeInfo = { isLoggedIn: false }, gate?: Promise<void>) {
  const events = new EventEmitter();
  const info: FakeInfo = { isLoggedIn: false };
  /** `unknown` so nothing here imports a VALUE from @inrupt, and so a call with
   *  no argument is recorded as `undefined` rather than vanishing. */
  const restores: unknown[] = [];
  const logins: unknown[] = [];
  const logouts: unknown[] = [];

  const session = {
    info,
    events,
    /**
     * The session's authenticated fetch, which StudioSessionLike models because
     * the entry editor needs one to hand `saveEntry`.
     *
     * IT IS CALLED, ONCE PER OWNER RENDER, and it was not always. Every case
     * here supplies `trips`, so the SHELL still enumerates nothing — but the
     * entry editor inside it reads §7.6's privacy settings on mount, through
     * this fetch, and that is the editor's request rather than the shell's.
     *
     * Throwing is still the point. The read is a `Result` that fails closed, so
     * the editor renders with its coordinate controls dead and every case in
     * this file goes on testing what it tested; and a request to anything ELSE
     * is a shell that started listing, which the enumeration at the end of
     * section 4 catches BY URL rather than by count.
     *
     * The listing path is test/studio-trip-loading.test.tsx's, and its fake
     * session's fetch works.
     */
    fetch: (async (input: RequestInfo | URL) => {
      throw new Error(`nothing in this file may reach a host: ${String(input)}`);
    }) as typeof globalThis.fetch,
    async handleIncomingRedirect(options?: unknown): Promise<unknown> {
      restores.push(options);
      await (gate ?? Promise.resolve());
      Object.assign(info, initial);
      return info;
    },
    async login(options?: unknown): Promise<void> {
      logins.push(options);
      // The real one navigates the browser away; nothing after it runs.
    },
    async logout(options?: unknown): Promise<void> {
      logouts.push(options);
      info.isLoggedIn = false;
      events.emit(LOGOUT);
    },
  };
  // Compile-time check that a plain object is still enough — i.e. that the
  // shell's session prop stayed injectable and did not grow a member only the
  // real library can supply.
  const asSessionLike: StudioSessionLike = session;
  return { session: asSessionLike, info, events, restores, logins, logouts };
}

/* ==========================================================================
 * 2. Loading the component under test.
 *
 * At RUNTIME through a dynamic import with a non-literal specifier, and at
 * COMPILE time through a type-only reference. Both halves are deliberate.
 *
 * Runtime: a static import of a module that does not exist is a resolution
 * error that kills the whole FILE — measured, not assumed: vite:import-analysis
 * reported "Failed to resolve import … Does the file exist?" and the file ran
 * `(0 test)`, taking the two environment controls above with it. A literal
 * dynamic import fails the same way, because import-analysis resolves those
 * statically too. Only a specifier vite cannot read at build time defers the
 * failure to the one test that needs the component, which is what keeps the
 * environment controls reporting. `importModule` below is checked in both
 * directions by a control test, so a failure here means the component is
 * missing and not that the loader is broken.
 *
 * Compile time: `typeof import(…)` is a TYPE, erased before import-analysis
 * ever sees the file, and `tsc --noEmit` reporting "Cannot find module
 * '@/components/studio/studio-shell'" IS the correct red state. It is not a
 * locally-declared props type on purpose — once the component exists, tsc
 * checks the six props below against its REAL signature at every call site
 * here, which a local guess would have replaced with the test's own opinion.
 * ======================================================================== */

type ShellModule = typeof import("@/components/studio/studio-shell");

/** Opaque to vite:import-analysis by construction: the specifier is a
 *  parameter. `@vite-ignore` only silences the warning that says so. */
const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

async function loadShell() {
  const mod = (await importModule("@/components/studio/studio-shell").catch((cause: unknown) => {
    throw new Error(
      "components/studio/studio-shell.tsx does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as ShellModule;
  const Shell = mod.default;
  if (typeof Shell !== "function") {
    throw new Error(
      "components/studio/studio-shell.tsx exists but default-exports no component — still the red step.",
    );
  }
  return Shell;
}

/**
 * Always under StrictMode. Not extra rigour: the App Router runs the studio
 * under StrictMode in development, effects are invoked twice there, and
 * phase 0 found the session restore returning a DIFFERENT answer on each of the
 * two invocations (docs/phase-0-spike.md, question 2). A shell tested outside
 * StrictMode is tested in a mode it never runs in.
 *
 * The five values are props because none of them can be read in a browser:
 * OWNER_WEBID, SITE_URL, SITE_NAME and POD_ROOT are not NEXT_PUBLIC_, and
 * lib/config.ts throws when the var is absent. `oidcIssuer` comes from the
 * owner's WebID document via getOwnerProfile() on the server (§7.5) — there is
 * deliberately no OIDC_ISSUER env var.
 */
/**
 * The trips prop, DERIVED FROM THE SHELL'S OWN SIGNATURE rather than declared
 * here. Same reason the props above are not a local type: a hand-written
 * `{ iri, slug, name, indexUrl, entriesContainer }` would compile forever
 * against a component whose EditorTrip had gained or renamed a member, and this
 * file would go on testing its own idea of the prop. `ComponentProps` makes
 * tsc check the fixture below against whatever the shell actually accepts.
 */
type ShellProps = ComponentProps<ShellModule["default"]>;
type ShellTrip = NonNullable<ShellProps["trips"]>[number];

/** One writable trip, on the owner's own Pod. §4's layout, resolved server-side
 *  in real life — this component reads no config, so it arrives as a prop. */
const TRIP: ShellTrip = {
  iri: "https://alice.example/travel/trips/2026-japan/trip.ttl#it",
  slug: "2026-japan",
  name: "Japan, spring 2026",
  indexUrl: "https://alice.example/travel/trips/2026-japan/entries.ttl",
  entriesContainer: "https://alice.example/travel/trips/2026-japan/entries/",
};

async function renderShell(
  session: StudioSessionLike,
  props: {
    ownerWebId?: string;
    oidcIssuer?: string;
    siteUrl?: string;
    siteName?: string;
    podRoot?: string;
    trips?: ShellTrip[];
  } = {},
) {
  const Shell = await loadShell();
  return render(
    <StrictMode>
      <Shell
        session={session}
        ownerWebId={props.ownerWebId ?? OWNER}
        oidcIssuer={props.oidcIssuer ?? ISSUER}
        siteUrl={props.siteUrl ?? SITE}
        siteName={props.siteName ?? SITE_NAME}
        podRoot={props.podRoot ?? POD}
        /* DEFAULTED TO [], never left undefined, and that is the load-bearing
           half of this line. An absent `trips` is what makes the shell go and
           enumerate the Pod; every case in this file is about what it RENDERS,
           not about where the list came from, and none of them serves a Pod. So
           they hand it an empty list and stay off the network — which is also
           what keeps "makes no network request of its own" below a true
           statement rather than an accident of the fake session's fetch
           throwing. */
        trips={props.trips ?? []}
      />
    </StrictMode>,
  );
}

/* --------------------------------------------------------------------------
 * The rendered contract, in three accessible queries.
 *
 * queryAllBy*, not queryBy*, so an absence assertion can never fail for the
 * wrong reason (queryBy throws on multiple matches, which would read as the
 * rule being violated when it is the markup being nested).
 *
 * "The owner UI" is a sign-out control and nothing more at this increment: the
 * editor does not exist yet. What matters is that it is something the other
 * three states do NOT have. Tighten this when the editor lands.
 * ------------------------------------------------------------------------ */
const signInControl = () => screen.queryAllByRole("button", { name: /sign in/i });
const signOutControl = () => screen.queryAllByRole("button", { name: /sign out/i });
/** The courtesy message's contract phrase — "…this diary belongs to Y". */
const courtesyMessage = () => screen.queryAllByText(/belongs to/i);
/**
 * THE EDITOR, in two independent accessible queries.
 *
 * Two rather than one because each covers the other's blind spot: a form whose
 * fields lost their labels still has a submit button, and a heading with no
 * form under it still reads as an editor to a query looking for text. Neither
 * matches anything the other three states render — "Sign in" and "Sign out" do
 * not contain "save", and no other screen has a headline field.
 */
const editorHeadlineField = () => screen.queryAllByLabelText(/headline|title/i);
const editorSaveControl = () => screen.queryAllByRole("button", { name: /save/i });

beforeEach(() => {
  // The restore memo is MODULE-level and outlives a test file. Without this the
  // first case to run decides the answer every later case gets, and the file
  // passes or fails on case order. resetSessionRestore is documented in
  // lib/studio/session.ts as exactly this seam.
  resetSessionRestore();
});

afterEach(() => {
  // Manual, not automatic: @testing-library/react registers its auto-cleanup
  // only when `afterEach` is a global, and this project runs vitest without
  // `globals: true`. Without it, every render stacks up in document.body and
  // the queries above start matching the previous test's markup.
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ==========================================================================
 * 3. The four states.
 * ======================================================================== */

describe("studio shell — restoring", () => {
  /**
   * `restoring` is a state, never a result.
   *
   * A shell that renders "signed out" while the restore is in flight flashes a
   * sign-in button over a signed-in studio on every single mount — and phase 0
   * measured that flight taking a network round-trip (`prompt=none`), so it is
   * not a frame nobody sees.
   *
   * THE NEGATIVE ASSERTIONS CANNOT PASS VACUOUSLY, because the same container
   * and the same three queries produce the owner UI once the gate is released.
   * A shell that renders nothing at all fails the second half.
   */
  it("renders neither the sign-in control nor the owner UI until the restore settles", async () => {
    const gate = deferred();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER }, gate.promise);

    await renderShell(fake.session);
    // Flush anything already scheduled, so this is "still restoring" rather
    // than "has not started".
    await act(async () => {
      await Promise.resolve();
    });

    expect(fake.restores.length).toBeGreaterThan(0);
    expect(signInControl()).toHaveLength(0);
    expect(signOutControl()).toHaveLength(0);
    expect(courtesyMessage()).toHaveLength(0);

    // Release, and the owner UI arrives through those same queries.
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    expect(signInControl()).toHaveLength(0);
  });

  /**
   * The restore goes through the memoised restoreSession, not straight to
   * session.handleIncomingRedirect. Under StrictMode the effect runs twice, and
   * two restores is two `prompt=none` round-trips whose answers phase 0 found
   * disagreeing with each other.
   */
  it("restores exactly once despite StrictMode invoking the effect twice", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    await renderShell(fake.session);
    await waitFor(() => expect(signOutControl()).toHaveLength(1));

    expect(fake.restores).toHaveLength(1);
  });
});

describe("studio shell — owner", () => {
  it("renders the studio UI and no sign-in control", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    await renderShell(fake.session);

    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    expect(signInControl()).toHaveLength(0);
    // The owner is the owner. Nobody is told whose diary this is.
    expect(courtesyMessage()).toHaveLength(0);
  });

  /**
   * The owner verdict is an IRI comparison, not a string comparison — the shell
   * must route through sameWebId/studioState rather than `===`. A host spelled
   * with a capital by the identity provider must not lock the owner out of
   * their own diary.
   */
  it("still recognises the owner when the provider spells the host differently", async () => {
    const fake = fakeStudioSession({
      isLoggedIn: true,
      webId: "https://Alice.Example:443/profile/card#me",
    });

    await renderShell(fake.session, { ownerWebId: OWNER });

    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    expect(courtesyMessage()).toHaveLength(0);
  });

  /**
   * THE PROP CONTRACT, ASSERTED AT RUNTIME rather than only by reading the
   * source. lib/config.ts's `required()` throws when the var is absent, which
   * in a browser it always is for a non-NEXT_PUBLIC_ var. Emptying them here
   * reproduces the browser: a shell that reaches for `config.ownerWebId`
   * anywhere on either path below throws "OWNER_WEBID is not set" and the
   * render fails.
   *
   * BOTH PATHS, because a config read on a branch this test does not take is
   * invisible to it — measured, not supposed: a probe stub that imported config
   * and read only `config.siteName` on the SIGNED-OUT path passed an
   * owner-only version of this test. Even both paths cannot catch that one,
   * since `siteName` and `siteUrl` have defaults and never throw. THAT is what
   * the source check in section 5 is for, and why the pair exists rather than
   * either alone.
   */
  it("renders with OWNER_WEBID and POD_ROOT unset, because it reads neither", async () => {
    vi.stubEnv("OWNER_WEBID", "");
    vi.stubEnv("POD_ROOT", "");
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("SITE_NAME", "");

    const owner = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    const { unmount } = await renderShell(owner.session);
    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    unmount();

    resetSessionRestore();
    const anonymous = fakeStudioSession();
    await renderShell(anonymous.session);
    await waitFor(() => expect(signInControl()).toHaveLength(1));
  });
});

/* --------------------------------------------------------------------------
 * The `trips` prop, and the branch that renders the editor at all.
 *
 * `trips` is optional and defaults to `[]`, and until now NO TEST PASSED ANY —
 * so the owner case was only ever exercised on the empty side, and the branch
 * that mounts the editor was unreached by the whole suite. An untested branch
 * that renders a form is not a small gap: it is the entire write path's front
 * door.
 *
 * Both sides are covered here, and the third test is the one that matters for
 * invariant 5's neighbours: the editor must not appear for a visitor who is not
 * the owner, whatever props the server component happened to hand down.
 * ------------------------------------------------------------------------ */
describe("studio shell — the trips it can write into", () => {
  it("renders the editor for the owner when there is somewhere to write", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    await renderShell(fake.session, { trips: [TRIP] });

    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    expect(editorHeadlineField()).toHaveLength(1);
    expect(editorSaveControl()).toHaveLength(1);
    // The trip is offered by NAME — the owner picks a trip, not an IRI.
    expect(screen.getAllByRole("option", { name: TRIP.name })).toHaveLength(1);
    // And nothing about there being nowhere to write.
    expect(screen.queryAllByText(/no trips/i)).toHaveLength(0);
  });

  /**
   * The other side. A studio with no trips is a real state, not a broken one:
   * entries live inside a trip (§4) and creating a trip is not in this phase.
   * The owner must be told that, not shown a form whose every save has nowhere
   * to go — and must NOT be shown the not-owner courtesy message, which is why
   * the empty-state wording avoids "belongs to".
   */
  it("explains itself, rather than rendering a form with nowhere to save to, when there are none", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    const { container } = await renderShell(fake.session, { trips: [] });

    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    expect(editorHeadlineField()).toHaveLength(0);
    expect(editorSaveControl()).toHaveLength(0);
    // Something is said about trips — a blank panel would leave the owner with
    // no idea why the editor is missing.
    expect(container.textContent ?? "").toMatch(/trip/i);
    expect(courtesyMessage()).toHaveLength(0);
  });

  /**
   * THE BOUNDARY. `trips` comes from the server component, which resolves it
   * before it knows who is at the keyboard; the editor is owner-only, and the
   * verdict — not the prop — decides.
   *
   * Invariant 5 still says the Pod is what enforces this, so a leak here is not
   * a security hole. It is worse in a quieter way: a visitor handed a form that
   * writes to someone else's Pod gets a 401 they cannot act on, having typed a
   * whole entry into it first.
   *
   * THE ALLOW-CASE IS THE THIRD RENDER, through the same queries and the same
   * trips — without it, a shell that had simply stopped rendering the editor at
   * all would pass this.
   */
  it("renders the editor for nobody but the owner, whatever trips it is handed", async () => {
    const visitor = fakeStudioSession({ isLoggedIn: true, webId: VISITOR });
    const first = await renderShell(visitor.session, { ownerWebId: OWNER, trips: [TRIP] });
    await waitFor(() => expect(courtesyMessage().length).toBeGreaterThan(0));
    expect(editorHeadlineField()).toHaveLength(0);
    expect(editorSaveControl()).toHaveLength(0);
    first.unmount();

    cleanup();
    resetSessionRestore();
    const anonymous = fakeStudioSession();
    const second = await renderShell(anonymous.session, { trips: [TRIP] });
    await waitFor(() => expect(signInControl()).toHaveLength(1));
    expect(editorHeadlineField()).toHaveLength(0);
    expect(editorSaveControl()).toHaveLength(0);
    second.unmount();

    cleanup();
    resetSessionRestore();
    const owner = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    await renderShell(owner.session, { trips: [TRIP] });
    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    expect(editorHeadlineField()).toHaveLength(1);
    expect(editorSaveControl()).toHaveLength(1);
  });
});

describe("studio shell — not the owner", () => {
  /**
   * A courtesy message, and it must name BOTH WebIDs: "signed in as X; this
   * diary belongs to Y". Naming only one leaves a visitor who is signed in with
   * the wrong one of their several WebIDs — routine on Solid — with no way to
   * see which.
   */
  it("names both the visitor's WebID and the owner's", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: VISITOR });

    const { container } = await renderShell(fake.session, { ownerWebId: OWNER });

    await waitFor(() => expect(courtesyMessage().length).toBeGreaterThan(0));
    const text = container.textContent ?? "";
    expect(text).toContain(VISITOR);
    expect(text).toContain(OWNER);
    // And a way out. A visitor signed in with the wrong one of their WebIDs
    // must not be stranded on this screen with nothing to click; whether the
    // shell offers "sign out" or "sign in as someone else" is its choice.
    expect([...signOutControl(), ...signInControl()].length).toBeGreaterThan(0);
  });

  /**
   * INVARIANT 5, in the one place a user can read it. The owner check is UX; the
   * Pod is what enforces authorisation. Wording that says "permission denied" or
   * "unauthorised" tells the visitor this check is the thing protecting the
   * diary, which is false — and false in the direction that makes a future
   * reader treat the guard as a boundary and build on it.
   *
   * Non-vacuous because the presence of the message is asserted first: this
   * cannot pass by rendering nothing.
   */
  it("does not word the message as though the check were the protection", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: VISITOR });

    const { container } = await renderShell(fake.session, { ownerWebId: OWNER });

    await waitFor(() => expect(courtesyMessage().length).toBeGreaterThan(0));
    expect(container.textContent ?? "").not.toMatch(
      /\b(denied|forbidden|unauthori[sz]ed|permission|not allowed|blocked|403)\b/i,
    );
  });

  /**
   * A mistyped OWNER_WEBID must make NOBODY the owner — sameWebId fails closed —
   * and the shell must render that verdict rather than crashing or defaulting to
   * the studio.
   */
  it("shows the courtesy message, not the studio, when the configured owner WebID is unparseable", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    await renderShell(fake.session, { ownerWebId: "not a webid" });

    await waitFor(() => expect(courtesyMessage().length).toBeGreaterThan(0));
  });
});

describe("studio shell — signed out", () => {
  it("offers a sign-in control and no studio UI", async () => {
    const fake = fakeStudioSession();

    await renderShell(fake.session);

    await waitFor(() => expect(signInControl()).toHaveLength(1));
    expect(signOutControl()).toHaveLength(0);
    expect(courtesyMessage()).toHaveLength(0);
  });

  /**
   * THE ARGUMENTS ARE THE BEHAVIOUR, and `clientId` is the one that fails
   * silently: phase 0 found that when the identity provider cannot use the
   * client ID document, login falls back to DYNAMIC CLIENT REGISTRATION. The
   * flow still completes, nothing errors, and the consent screen shows a bare
   * UUID instead of the app's name. Nothing but this assertion would notice.
   *
   * toStrictEqual, not toMatchObject: an extra key is as much a bug as a missing
   * one — a stray `clientSecret` or `handleRedirect` changes how the library
   * authenticates.
   *
   * SITE is https://diary.example while jsdom's origin is http://localhost:3000,
   * so a shell that rebuilt these from window.location.origin fails here. That
   * is the drift the client ID document cannot survive: the identity provider
   * fetches the client_id URL it is given.
   */
  it("signs in with exactly the arguments the identity provider needs, clientId included", async () => {
    const fake = fakeStudioSession();

    await renderShell(fake.session);
    await waitFor(() => expect(signInControl()).toHaveLength(1));
    expect(fake.logins).toHaveLength(0);

    fireEvent.click(signInControl()[0]);

    await waitFor(() => expect(fake.logins).toHaveLength(1));
    expect(fake.logins[0]).toStrictEqual({
      oidcIssuer: ISSUER,
      redirectUrl: `${SITE}/studio`,
      clientId: `${SITE}/client-id.jsonld`,
      clientName: SITE_NAME,
    });
    // Signing in is not restoring: a click that also re-ran the restore would
    // burn the memo on the way out of the page.
    expect(fake.restores).toHaveLength(1);
  });

  /**
   * The shell hands `siteUrl` to signIn and does not build the two URLs itself.
   * signIn normalises a trailing slash; a shell that interpolated
   * `${siteUrl}/studio` inline would produce a doubled slash — a URL that is not
   * the client ID document, so the provider drops to dynamic registration.
   * Silent again.
   */
  it("passes the site URL through rather than interpolating it itself", async () => {
    const fake = fakeStudioSession();

    await renderShell(fake.session, { siteUrl: `${SITE}/` });
    await waitFor(() => expect(signInControl()).toHaveLength(1));

    fireEvent.click(signInControl()[0]);

    await waitFor(() => expect(fake.logins).toHaveLength(1));
    expect(fake.logins[0]).toStrictEqual({
      oidcIssuer: ISSUER,
      redirectUrl: `${SITE}/studio`,
      clientId: `${SITE}/client-id.jsonld`,
      clientName: SITE_NAME,
    });
  });
});

/* ==========================================================================
 * 4. THE HEADLINE CASE, and the listener that must not leak.
 * ======================================================================== */

describe("studio shell — the session lapsing mid-edit", () => {
  /**
   * THE BUG THIS WHOLE INCREMENT EXISTS FOR.
   *
   * Verified in @inrupt/solid-client-authn-browser@5.0.0 (dist/index.mjs:1205):
   * Session's constructor registers
   *
   *     this.events.on(EVENTS.SESSION_EXPIRED, () => this.internalLogout(false));
   *
   * and `false` is emitSignal — so AN EXPIRY NEVER EMITS LOGOUT. A shell
   * subscribed to LOGOUT alone catches a deliberate sign-out and nothing else,
   * and goes on rendering the studio over a lapsed session while every write
   * 401s: the app offering to save when it cannot.
   *
   * BOTH HALVES ARE ASSERTED. "The studio is gone" alone passes a shell that
   * unmounted itself or threw; the sign-in control coming back is what says it
   * reached `signed-out` rather than nothing.
   */
  it("flips out of the studio when the session expires", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    await renderShell(fake.session);
    await waitFor(() => expect(signOutControl()).toHaveLength(1));

    act(() => {
      fake.events.emit(SESSION_EXPIRED);
    });

    expect(signOutControl()).toHaveLength(0);
    await waitFor(() => expect(signInControl()).toHaveLength(1));

    // THE TRAP, SPELLED OUT. internalLogout sets info.isLoggedIn = false only
    // AFTER an await, and our listener runs synchronously inside the same emit —
    // so at this instant the real session's `info` still claims a live session,
    // exactly as the fake's does. A shell that consulted session.info on expiry
    // would have reported the owner as still signed in, which is the bug rather
    // than the fix. Trust the event.
    expect(fake.info.isLoggedIn).toBe(true);
  });

  /** The other half of the same subscription: a deliberate sign-out, which is
   *  the event an expiry does NOT emit. */
  it("signs out through signOut and returns to the sign-in control", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    await renderShell(fake.session);
    await waitFor(() => expect(signOutControl()).toHaveLength(1));

    fireEvent.click(signOutControl()[0]);

    await waitFor(() => expect(fake.logouts).toHaveLength(1));
    // The discriminator is mandatory and the two arms are not interchangeable:
    // "idp" signs the owner out of their identity provider across every Solid
    // app they use, and redirects to a postLogoutUrl that must already appear in
    // post_logout_redirect_uris.
    expect(fake.logouts[0]).toStrictEqual({ logoutType: "app" });
    await waitFor(() => expect(signInControl()).toHaveLength(1));
  });

  /**
   * A leaked listener is a real bug under StrictMode: the second mount
   * subscribes again, the first never detaches, and every later event fires into
   * a callback closing over unmounted state.
   *
   * THREE ASSERTIONS, because each covers the others' blind spot. Empty before
   * mount rules out a fixture that started dirty. Exactly ONE while mounted is
   * the StrictMode leak check — a shell whose effect does not clean up leaves
   * two. Empty after unmount is the unsubscribe.
   */
  it("leaves no listener on the session after unmount", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    expect(fake.events.eventNames()).toEqual([]);
    const { unmount } = await renderShell(fake.session);
    await waitFor(() => expect(signOutControl()).toHaveLength(1));

    expect(fake.events.listenerCount(SESSION_EXPIRED)).toBe(1);
    expect(fake.events.listenerCount(LOGOUT)).toBe(1);

    unmount();

    expect(fake.events.eventNames()).toEqual([]);
  });

  /**
   * A SHELL THAT HAS BEEN HANDED ITS TRIPS DOES NOT GO AND LIST THEM AGAIN —
   * not through the ambient fetch, and not through the session's either.
   *
   * NARROWED TWICE, and the second narrowing is the interesting one.
   *
   * It began as "makes no network request of its own", which was true of a
   * shell that could not fetch at all. When the listing landed
   * (test/studio-trip-loading.test.tsx) that became a claim about a path this
   * file never takes, so it was narrowed to "when it is handed its trips".
   *
   * Then the coordinate gate landed and the claim stopped being true for a
   * second reason: the SUBTREE is not silent. The entry editor reads §7.6's
   * privacy settings on mount, through the session's fetch, before anything is
   * typed — §9's fail-closed posture, and the reason section 1 of
   * test/entry-editor.test.tsx can wait for the latitude control to become
   * enabled with no interaction in front of it. That request is the editor's,
   * not the shell's.
   *
   * SO THE SUBJECT IS THE SHELL'S OWN TRAFFIC, and the way to state it without
   * blunting it is to ENUMERATE what was asked for rather than to count it: the
   * one URL below is the editor's, and any other — the trips container, a
   * `trip.ttl`, the public diary — fails this. A `toHaveLength(1)` or a filter
   * on "not the settings URL" would let a re-listing through the moment it
   * replaced that request rather than adding to it.
   *
   * Both fetches are gathered, because only one of them is the ambient one and
   * the ambient spy alone would miss the whole listing. test/setup.ts already
   * fails an unhandled request, but that only covers a URL no handler serves.
   */
  it("does not re-list the trips it was handed", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    /** Throws whatever it is asked for: nothing in this file may reach a host,
     *  and the editor's read is a `Result` that fails closed rather than a
     *  rejection anyone has to handle here. Recorded either way, which is what
     *  makes the enumeration below an observation rather than the absence of an
     *  exception. */
    const sessionFetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      throw new Error(`nothing in this file may reach a host: ${String(input)}`);
    });
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    Object.defineProperty(fake.session, "fetch", { value: sessionFetch, configurable: true });

    await renderShell(fake.session, { trips: [TRIP] });
    await waitFor(() => expect(signOutControl()).toHaveLength(1));

    // The ambient one is never right in the studio: it carries no credential,
    // and on a hosted Pod an anonymous read of an owner-only resource is a 401
    // that does not distinguish private from missing (invariant 4).
    expect(fetchSpy).not.toHaveBeenCalled();
    // `signOutControl()` is a DOM node produced in the shell's own COMMIT
    // phase; the read below belongs to a CHILD's passive effect
    // (entry-editor.tsx's settings read), which React is free to run after
    // that commit rather than synchronously with it. Waiting on the fetch
    // itself, not just the shell's own paint, closes that scheduling gap
    // rather than racing it under load.
    await waitFor(() => expect(sessionFetch).toHaveBeenCalled());
    const asked = [...fetchSpy.mock.calls, ...sessionFetch.mock.calls].map(([input]) =>
      String(input),
    );
    // §4's layout, spelled out rather than derived from `privacySettingsUrl`:
    // deriving it from the function the shell calls would assert that the shell
    // agrees with itself.
    expect(asked).toEqual([`${POD}travel/settings/privacy.ttl`]);
    // Non-vacuous: the owner UI really did render, so this is not "nothing
    // happened at all".
    expect(editorSaveControl()).toHaveLength(1);
  });
});

/* ==========================================================================
 * 5. What only the source can show.
 *
 * Same justification as the "use cache" checks in test/cached-owner-profile.test.ts:
 * `"use client"` is a compiler directive and an inert string expression under
 * vitest, and an import that is never EXERCISED on a tested path leaves no
 * runtime trace. The runtime prop test above covers the case where config is
 * read; this covers the case where it is merely imported, which is enough to
 * break the browser bundle.
 * ======================================================================== */

describe("components/studio/studio-shell.tsx, as source", () => {
  const PATH = "components/studio/studio-shell.tsx";

  function source(): string {
    try {
      return readFileSync(PATH, "utf8");
    } catch (cause) {
      throw new Error(
        `${PATH} does not exist yet — this is the red step of the TDD loop, not a broken test.`,
        { cause },
      );
    }
  }

  /** Comments stripped, so a comment EXPLAINING why config is not read here
   *  cannot fail the checks below. */
  function code(): string {
    return source()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  /** Every module specifier, from both `import x from "y"` and `import "y"`. */
  function specifiers(text: string): string[] {
    return [...text.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2],
    );
  }

  /** Specifiers of `import type …` statements only — those are erased at
   *  compile time and put nothing in a bundle. */
  function typeOnlySpecifiers(text: string): string[] {
    return [...text.matchAll(/\bimport\s+type\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
  }

  it("the scanners work, so the bans below cannot pass on an empty set", () => {
    // Control 1: the comment stripper does not eat the code.
    expect(code()).toContain("use client");
    // Control 2: the specifier scan finds the import the shell must have. If it
    // returned [] — a regex that stopped matching, a file that moved — every
    // "does not import X" assertion below would be vacuously true.
    expect(specifiers(code())).toContain("@/lib/studio/session");
    // Control 3: the type-only classifier discriminates, proved on two literals
    // rather than on whatever the file happens to contain today.
    const sample = `import type { A } from "erased";\nimport { B } from "kept";\n`;
    expect(typeOnlySpecifiers(sample)).toEqual(["erased"]);
    expect(specifiers(sample)).toEqual(["erased", "kept"]);
  });

  it('carries the "use client" directive, before any import', () => {
    const text = code();
    const directive = text.search(/["']use client["']/);
    const firstImport = text.search(/^\s*import\b/m);
    expect(directive).toBeGreaterThanOrEqual(0);
    expect(firstImport).toBeGreaterThanOrEqual(0);
    // A directive after an import is not a directive; Next would not treat this
    // as a client component and the shell would be server-rendered — with a
    // session that only exists in the browser.
    expect(directive).toBeLessThan(firstImport);
  });

  it("does not import lib/config, which throws in a browser", () => {
    // OWNER_WEBID, SITE_URL and SITE_NAME are not NEXT_PUBLIC_. config's
    // `required()` throws on an absent var, and in the browser they are all
    // absent. The five values arrive as props; there is no other way.
    const imported = specifiers(code());
    expect(imported.filter((s) => /(^|\/)lib\/config$/.test(s))).toEqual([]);
    expect(imported.filter((s) => s.includes("lib/config"))).toEqual([]);
  });

  it("reads no environment variable directly either", () => {
    // The same rule one step lower down: process.env.SITE_URL is `undefined` in
    // a browser bundle unless it is NEXT_PUBLIC_, and an undefined interpolated
    // into clientId is the silent dynamic-registration fallback again.
    expect(code()).not.toMatch(/\bprocess\s*\.\s*env\b/);
  });

  it("imports no VALUE from the Solid auth library — the session is injected", () => {
    // The shell must stay a plain component that takes a session. The library
    // enters at components/studio/studio-client.tsx, which is also where
    // `ssr: false` lives. A value import here would construct a session at
    // module scope and make this file untestable without an OIDC round-trip.
    // `import type` is exempt: it is erased, and lib/studio/session.ts relies on
    // exactly that.
    const text = code();
    const erased = new Set(typeOnlySpecifiers(text));
    const values = specifiers(text).filter((s) => !erased.has(s));
    expect(values.filter((s) => s.startsWith("@inrupt/solid-client-authn-browser"))).toEqual([]);
  });
});

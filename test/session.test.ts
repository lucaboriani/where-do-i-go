import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EVENTS } from "@inrupt/solid-client-authn-browser";
import { config } from "@/lib/config";
import { GET as clientIdDocument } from "@/app/(public)/client-id.jsonld/route";
import {
  resetSessionRestore,
  restoreSession,
  sameWebId,
  studioState,
  type SessionState,
  type SolidSessionLike,
  type StudioSessionLike,
  type StudioState,
} from "@/lib/studio/session";

/**
 * The studio's session and owner check.
 *
 * WHY THERE IS NO MOCK OF @inrupt/solid-client-authn-browser HERE. A test that
 * mocks the library tests the library's idea of a session. `restoreSession`
 * takes the session object by injection precisely so the interesting behaviour
 * — the once-per-page-load memo — can be asserted against a plain object with
 * no browser, no redirect and no OIDC round-trip. The library stays at the edge
 * of lib/studio/session.ts, above everything tested here.
 *
 * MSW is still doing work: test/setup.ts fails any unhandled real request, so
 * an implementation that reaches for the network from any of these paths cannot
 * pass by accident.
 */

// ---------------------------------------------------------------- sameWebId

/**
 * WebID comparison decides whether the visitor is the owner. It is the one
 * place where being too lax hands the studio UI to a stranger and being too
 * strict locks the owner out of their own diary.
 *
 * IRI equality (RFC 3986 §6): scheme and host are case-insensitive, the default
 * port for the scheme is elidable, and everything else — path, query, fragment
 * — is compared character by character. Each row names the production change
 * that would make it fail, so a failure points at a cause rather than at a
 * typo in a fixture.
 */
const WEBID_CASES: Array<{ a: string; b: string; match: boolean; breaks: string }> = [
  {
    a: "https://alice.example/profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: true,
    breaks: "the baseline; fails if normalisation mangles a well-formed WebID",
  },
  {
    a: "https://Alice.Example/profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: true,
    breaks: "fails on a plain `a === b`; hosts are case-insensitive",
  },
  {
    a: "HTTPS://alice.example/profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: true,
    breaks: "fails if only the host is lower-cased and the scheme is left alone",
  },
  {
    a: "https://alice.example:443/profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: true,
    breaks: "fails without real URL parsing; :443 is the elidable default for https",
  },
  {
    a: "https://alice.example:8443/profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks: "fails if ports are stripped wholesale, e.g. replace(/:\\d+/, '')",
  },
  {
    a: "https://alice.example/profile/card#me",
    b: "https://alice.example/profile/card#i",
    match: false,
    breaks:
      "fails if the fragment is dropped or compared as origin+path; one profile document can describe two agents, and the fragment is the whole difference between the owner and someone else",
  },
  {
    a: "https://alice.example/profile/card#ME",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks: "fragments are case-sensitive; fails if the IRI is lower-cased past the authority",
  },
  {
    a: "https://alice.example/Profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks: "fails on `a.toLowerCase() === b.toLowerCase()`, the tempting one-liner; paths are case-sensitive",
  },
  {
    a: "http://alice.example/profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks: "fails if only host and path are compared; these are different origins, not two spellings of one",
  },
  {
    a: "https://alice.example/profile/card/#me",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks: "fails if trailing slashes are trimmed; /card/ and /card are different resources",
  },
  {
    a: "https://evil@alice.example/profile/card#me",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks:
      "fails on `origin + pathname + hash` as the normal form: URL.origin drops the userinfo, so https://evil@alice.example/... would normalise to the owner's WebID exactly. URL.href keeps it, which is why the shipped implementation is right — this row is what stops the shortcut being reintroduced",
  },
  {
    a: "https://alice.example/profile/card?x=1#me",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks:
      "fails on any normal form built from origin + pathname + hash, which silently discards the query. RFC 3986 §6 compares the query character by character; ?x=1 addresses a different resource",
  },
  {
    a: "not a webid",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks: "fails with a TypeError if new URL() is called unguarded; a mistyped OWNER_WEBID must not crash the studio",
  },
  {
    a: "",
    b: "https://alice.example/profile/card#me",
    match: false,
    breaks: "an unset OWNER_WEBID arrives here as the empty string",
  },
  {
    a: "not a webid",
    b: "not a webid",
    match: false,
    breaks:
      "fails on a `catch { return a === b }` fallback; two identical unparseable values must not make someone the owner — the check fails closed",
  },
];

describe("sameWebId", () => {
  it.each(WEBID_CASES)("$a vs $b -> $match ($breaks)", ({ a, b, match }) => {
    expect(() => sameWebId(a, b)).not.toThrow();
    expect(sameWebId(a, b)).toBe(match);
    // Symmetry, free of charge: an implementation that normalises only its
    // first argument passes half of the table above and fails here.
    expect(sameWebId(b, a)).toBe(match);
  });
});

// -------------------------------------------------------------- studioState

const OWNER = "https://alice.example/profile/card#me";
const OTHER = "https://bob.example/profile/card#me";

describe("studioState", () => {
  it("passes restoring through, carrying no WebID", () => {
    const state: StudioState = studioState({ status: "restoring" }, OWNER);
    expect(state).toEqual({ status: "restoring" });
  });

  it("passes signed-out through, carrying no WebID", () => {
    const state: StudioState = studioState({ status: "signed-out" }, OWNER);
    expect(state).toEqual({ status: "signed-out" });
  });

  it("reports the owner as owner", () => {
    const session: SessionState = { status: "signed-in", webId: OWNER };
    expect(studioState(session, OWNER)).toEqual({ status: "owner", webId: OWNER });
  });

  /**
   * The case that matters. The UI has to render "signed in as X, this diary
   * belongs to Y", so not-owner must carry BOTH WebIDs. A test asserting only
   * `status === "not-owner"` would pass an implementation that dropped one of
   * them — which is exactly the message.
   */
  it("reports a non-owner with both WebIDs, session first and configured owner second", () => {
    const session: SessionState = { status: "signed-in", webId: OTHER };
    const state = studioState(session, OWNER);

    expect(state).toEqual({ status: "not-owner", webId: OTHER, owner: OWNER });
    if (state.status !== "not-owner") return;

    // Spelled out, because toEqual on a wrong-but-symmetric object is easy to
    // misread: `owner` is the CONFIGURED owner, not an echo of the session.
    expect(state.webId).toBe(OTHER);
    expect(state.owner).toBe(OWNER);
    expect(state.owner).not.toBe(state.webId);
  });

  /**
   * Proves studioState routes through sameWebId rather than ===. The owner
   * signing in through a host their provider spells with a capital must not be
   * told the diary belongs to someone else.
   */
  it("treats a WebID differing from the configured owner only by host case as the owner", () => {
    const session: SessionState = { status: "signed-in", webId: "https://ALICE.example/profile/card#me" };
    expect(studioState(session, OWNER).status).toBe("owner");
  });

  /** The complement, so the fix for the case above cannot be "normalise harder". */
  it("does not treat a different fragment in the owner's own document as the owner", () => {
    const session: SessionState = { status: "signed-in", webId: "https://alice.example/profile/card#i" };
    const state = studioState(session, OWNER);
    expect(state).toEqual({
      status: "not-owner",
      webId: "https://alice.example/profile/card#i",
      owner: OWNER,
    });
  });

  /** Misconfiguration fails closed: an unset OWNER_WEBID makes nobody the owner. */
  it("makes nobody the owner when the configured owner WebID is empty", () => {
    const session: SessionState = { status: "signed-in", webId: OTHER };
    expect(studioState(session, "").status).toBe("not-owner");
  });
});

// ------------------------------------------------------------ restoreSession

type FakeInfo = { isLoggedIn: boolean; webId?: string };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * A fake Solid session, shaped like the real one in the way that matters:
 * `info` starts as `{ isLoggedIn: false }` and is mutated in place only once
 * handleIncomingRedirect settles. That is the phase-0 finding in object form
 * (docs/phase-0-spike.md, "What the App Router requires for the redirect"):
 * under React 19 StrictMode the effect ran twice and the FIRST invocation
 * returned isLoggedIn: false while the second returned true.
 *
 * It is a plain object. If it stops satisfying SolidSessionLike, that type has
 * grown a member only the real library can supply, and the seam has moved.
 */
function fakeSession(options: { outcome: FakeInfo | "reject"; gate?: Promise<void> }) {
  let calls = 0;
  /**
   * Every argument handleIncomingRedirect was called with, in order. The
   * parameter is typed `unknown` rather than the library's options interface so
   * that nothing here imports from @inrupt: `unknown` is a supertype of it, so
   * the method stays assignable to SolidSessionLike, and a call passing NO
   * argument records `undefined` — distinguishable from one passing `{}`.
   */
  const argv: unknown[] = [];
  const session = {
    info: { isLoggedIn: false } as FakeInfo,
    async handleIncomingRedirect(redirectOptions?: unknown): Promise<FakeInfo | undefined> {
      calls += 1;
      argv.push(redirectOptions);
      await (options.gate ?? Promise.resolve());
      if (options.outcome === "reject") {
        throw new Error("no matching client id for the stored session");
      }
      Object.assign(session.info, options.outcome);
      return session.info;
    },
  };
  // Compile-time check that the fake is enough, with no @inrupt import.
  const asSessionLike: SolidSessionLike = session;
  return { session: asSessionLike, raw: session, calls: () => calls, argv: () => argv };
}

/**
 * `restoring` is the state BEFORE the promise settles. It is never a resolved
 * value — an implementation that resolves with it leaves the studio showing a
 * spinner for ever. Asserted in every case below rather than in a test of its
 * own, which would assert nothing on its own.
 */
function settled(state: SessionState): SessionState {
  expect(state.status).not.toBe("restoring");
  return state;
}

describe("restoreSession", () => {
  beforeEach(() => {
    // The memo is module-level and outlives a test. Without this, case order
    // decides the result.
    resetSessionRestore();
  });

  /**
   * THE STRICTMODE CASE. Two concurrent calls, one call through, and — the part
   * that encodes the bug — both callers get the POST-resolution answer. An
   * implementation that calls handleIncomingRedirect twice fails on the count;
   * one that hands the second caller the pre-resolution `isLoggedIn: false`
   * fails on the value.
   */
  it("calls handleIncomingRedirect once for concurrent callers and resolves both to the settled answer", async () => {
    const gate = deferred();
    const webId = OWNER;
    const { session, raw, calls } = fakeSession({
      outcome: { isLoggedIn: true, webId },
      gate: gate.promise,
    });

    const first = restoreSession(session);
    const second = restoreSession(session);

    // Synchronously, before anything settles: the memo has to be installed on
    // the way in. An implementation that installs it after its first await has
    // already called through twice by now.
    expect(calls()).toBe(1);
    // And this is what the second StrictMode invocation would have read.
    expect(raw.info.isLoggedIn).toBe(false);

    gate.resolve();
    const [a, b] = await Promise.all([first, second]);

    expect(settled(a)).toEqual({ status: "signed-in", webId });
    expect(settled(b)).toEqual({ status: "signed-in", webId });
    expect(calls()).toBe(1);

    // "however many times it is called" includes after it has settled.
    expect(settled(await restoreSession(session))).toEqual({ status: "signed-in", webId });
    expect(calls()).toBe(1);
  });

  /**
   * THE FLAG IS THE RESTORE, so it is asserted rather than assumed.
   *
   * `restorePreviousSession: true` is not a detail of the call — it is the
   * feature. docs/phase-0-spike.md, "What the App Router requires for the
   * redirect": on CSS the flag is what issued `/.oidc/auth?…&prompt=none`, the
   * silent re-authentication round-trip. Drop it and `handleIncomingRedirect`
   * still resolves, still reports `isLoggedIn: false` on a plain reload, and
   * every test above still passes — while a returning owner is signed out on
   * every reload. That is "session restore across reload", the deliverable
   * TODO.md phase 2 names: without this assertion the module's whole reason to
   * exist could be deleted with nothing going red.
   */
  it("asks handleIncomingRedirect to restore the previous session", async () => {
    const { session, argv } = fakeSession({ outcome: { isLoggedIn: true, webId: OWNER } });

    expect(settled(await restoreSession(session))).toEqual({ status: "signed-in", webId: OWNER });

    // Exactly one call, and its argument is inspected — a bare
    // handleIncomingRedirect() records `undefined` here and fails below.
    expect(argv()).toHaveLength(1);
    expect(argv()[0]).toMatchObject({ restorePreviousSession: true });
  });

  it("resolves signed-out when there is no stored session", async () => {
    const { session, calls } = fakeSession({ outcome: { isLoggedIn: false } });

    expect(settled(await restoreSession(session))).toEqual({ status: "signed-out" });
    expect(calls()).toBe(1);
  });

  /**
   * isLoggedIn without a WebID is not a signed-in session as far as this app is
   * concerned: every caller downstream feeds that WebID to sameWebId, and
   * `{ status: "signed-in", webId: undefined }` would silently make the owner
   * check compare against nothing.
   */
  it("resolves signed-out when the session claims to be logged in but has no WebID", async () => {
    const { session } = fakeSession({ outcome: { isLoggedIn: true } });

    expect(settled(await restoreSession(session))).toEqual({ status: "signed-out" });
  });

  /**
   * A rejection is a value, not a throw — and it must not be memoised. A memo
   * holding a rejected promise makes the studio permanently unusable until a
   * hard reload, which is the worst possible response to one flaky round-trip.
   */
  it("resolves signed-out when handleIncomingRedirect rejects, and does not memoise the failure", async () => {
    const failing = fakeSession({ outcome: "reject" });

    let thrown: unknown;
    let state: SessionState | undefined;
    try {
      state = await restoreSession(failing.session);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(settled(state as SessionState)).toEqual({ status: "signed-out" });
    expect(failing.calls()).toBe(1);

    // Still a resolved value on a repeat call, not a re-thrown rejection.
    expect(settled(await restoreSession(failing.session))).toEqual({ status: "signed-out" });

    // THE ASSERTION THAT MAKES THIS TEST ABOUT MEMOISATION. The status above
    // proves nothing on its own: a memo holding the failed attempt answers
    // `signed-out` too, because the .catch already converted the rejection into
    // that value — so the repeat call reads the memo and returns the identical
    // object without touching the session. The call count is the only visible
    // difference between "retried and failed again" and "never retried".
    //
    // Kept because of what a kept memo costs. restorePreviousSession issues a
    // network `prompt=none` round-trip (docs/phase-0-spike.md), which is exactly
    // the request Safari ITP interferes with. One flaky attempt, and a memoised
    // failure leaves the studio signed-out and unrecoverable until a HARD
    // RELOAD — no retry, no re-login, nothing the owner can click. The next
    // caller must be free to try again.
    expect(failing.calls()).toBe(2);

    // And the module is not poisoned: after the documented reset, a working
    // session reaches signed-in.
    resetSessionRestore();
    const working = fakeSession({ outcome: { isLoggedIn: true, webId: OWNER } });
    expect(settled(await restoreSession(working.session))).toEqual({ status: "signed-in", webId: OWNER });
    expect(working.calls()).toBe(1);
  });
});

/* ==========================================================================
 * THE STUDIO SHELL INCREMENT — the red step.
 *
 * lib/studio/session.ts does not export subscribeSessionState, signIn or
 * signOut yet. Everything from here down fails until it does.
 *
 * HOW THE MISSING EXPORTS ARE REACHED. Through a dynamic import() and the
 * namespace, never a static named import: a static named import of an export
 * that does not exist is an ESM *link* error, which kills the whole file with a
 * SyntaxError before a single test runs — including the 27 above that already
 * pass — and reads like a broken test file rather than a missing
 * implementation. Same shape as test/owner-profile.test.ts and
 * test/read.test.ts. It is the SAME module instance the static import at the
 * top loaded, which is what lets the memo tests below observe one memo.
 *
 * THE ONE @inrupt IMPORT, AND WHY IT IS NOT A MOCK. `import type { EVENTS }` is
 * erased at compile time — no library code is loaded, nothing is stubbed, and
 * the session still arrives by injection as a plain object. It exists so the
 * event names below are tied to the library's own string literals by the type
 * checker: a listener registered for the wrong event name is silently dead, and
 * a test that hardcodes the same wrong name on both sides passes while the
 * studio never notices an expiry. See the annotations on SESSION_EXPIRED and
 * LOGOUT.
 * ======================================================================== */

const sessionModule = () => import("@/lib/studio/session");

/**
 * Turns "undefined is not a function" into a sentence that names what is
 * missing, so the red step reads as a missing implementation rather than a
 * broken test. Deliberately not a cast: the property access itself is a tsc
 * error until the export exists, which is the correct red state for the type
 * checker too, and once it exists tsc checks the real signature at every call.
 */
function mustExport<T>(value: T, name: string): T {
  if (typeof value !== "function") {
    throw new Error(
      `lib/studio/session.ts does not export ${name}() yet — this is the red step of the TDD loop, not a broken test.`,
    );
  }
  return value;
}

const loadSubscribe = async () =>
  mustExport((await sessionModule()).subscribeSessionState, "subscribeSessionState");
const loadSignIn = async () => mustExport((await sessionModule()).signIn, "signIn");
const loadSignOut = async () => mustExport((await sessionModule()).signOut, "signOut");

/**
 * The two event names, pinned to the library's literals by their annotations.
 * `typeof EVENTS.SESSION_EXPIRED` is the string literal type "sessionExpired"
 * (constant.d.ts declares EVENTS with `readonly` members), so if an upgrade
 * renames the constant or changes its value, these lines stop compiling instead
 * of leaving a listener attached to an event nothing emits.
 */
const SESSION_EXPIRED: typeof EVENTS.SESSION_EXPIRED = "sessionExpired";
const LOGOUT: typeof EVENTS.LOGOUT = "logout";

/**
 * The fake grown to the three members SolidSessionLike gains: `events`, `login`
 * and `logout`.
 *
 * A SECOND FAKE RATHER THAN A WIDER FIRST ONE. The fakeSession above is what
 * the 27 passing tests are built on; growing it to serve these would put their
 * fixture at risk for no gain. This one differs in exactly two ways it needs
 * to: the restore outcome is settable (so a second restore can answer
 * differently, which is how a stale memo becomes visible), and there is no
 * gate — the StrictMode timing is already pinned above and is not what is under
 * test here.
 *
 * `events` IS A REAL EventEmitter, from node:events. Not a convenience: the
 * library's ISessionEventListener extends the very same EventEmitter, and a
 * hand-rolled `{ on, off }` object is NOT assignable to it — the interface's
 * methods return `this`, so a structural stand-in must supply addListener,
 * once, removeListener, emit and nine more. Measured with tsc, not assumed. So
 * whichever way SolidSessionLike derives `events` from the library's types, a
 * real EventEmitter satisfies it and a plain object does not.
 *
 * `logout` MIRRORS THE LIBRARY, verified against the installed
 * @inrupt/solid-client-authn-browser@5.0.0 (dist/index.mjs): `logout` is
 * `internalLogout(true, options)`, which awaits the client logout, then sets
 * `info.isLoggedIn = false`, then emits EVENTS.LOGOUT.
 */
function fakeStudioSession(initial: FakeInfo = { isLoggedIn: false }) {
  const events = new EventEmitter();
  const info: FakeInfo = { ...initial };
  let outcome: FakeInfo = { ...initial };
  /** Arguments of every call, in order. `unknown` so nothing here imports a
   *  value from @inrupt, and so a call with NO argument records `undefined`. */
  const restores: unknown[] = [];
  const logins: unknown[] = [];
  const logouts: unknown[] = [];

  const session = {
    info,
    events,
    /** Modelled by StudioSessionLike since the entry editor landed, and never
     *  called from this module: `signIn`, `signOut` and `subscribeSessionState`
     *  touch the network only through the library. A throwing stand-in says so
     *  out loud rather than letting a stray request pass unnoticed. */
    fetch: (async () => {
      throw new Error("lib/studio/session.ts must not fetch: it makes no request of its own");
    }) as typeof globalThis.fetch,
    async handleIncomingRedirect(options?: unknown): Promise<unknown> {
      restores.push(options);
      Object.assign(info, outcome);
      return info;
    },
    async login(options?: unknown): Promise<void> {
      logins.push(options);
      // The real one redirects the browser away; nothing after it runs.
    },
    async logout(options?: unknown): Promise<void> {
      logouts.push(options);
      info.isLoggedIn = false;
      events.emit(LOGOUT);
    },
  };
  // Compile-time check that the fake is enough. It is annotated with the STUDIO
  // half, and the restore-only fake above with the narrow half, so the two
  // annotations together are what pin the split: widen either interface and one
  // of them stops compiling. This one also proves StudioSessionLike stayed
  // structural — satisfiable without importing a value from @inrupt.
  const asSessionLike: StudioSessionLike = session;
  return {
    session: asSessionLike,
    info,
    events,
    restores,
    logins,
    logouts,
    /** What the NEXT handleIncomingRedirect will report. */
    setOutcome(next: FakeInfo) {
      outcome = next;
    },
  };
}

// -------------------------------------------------- subscribeSessionState

/**
 * THE GAP THAT MATTERS MOST. Without a SESSION_EXPIRED subscription the studio
 * goes on rendering `owner` after the session has lapsed, while every write
 * 401s — the studio telling the owner they can save when they cannot.
 *
 * Verified in @inrupt/solid-client-authn-browser@5.0.0 (dist/index.mjs), and
 * both facts are load-bearing for the tests below:
 *
 *   1. Session's constructor registers `events.on(EVENTS.SESSION_EXPIRED, () =>
 *      this.internalLogout(false))`. `false` is emitSignal — so an expiry does
 *      NOT emit LOGOUT. Subscribing to LOGOUT alone catches nothing here.
 *   2. internalLogout sets `info.isLoggedIn = false` only AFTER awaiting
 *      `clientAuthentication.logout(...)`. Our listener is registered later than
 *      Session's own and runs synchronously in the same emit, so when it runs
 *      `session.info` still says isLoggedIn: true. An implementation that reads
 *      `info` on expiry reports the owner as still signed in — which is the bug,
 *      not the fix. Hence the fake leaves `info` untouched on expiry and the
 *      tests demand signed-out anyway: trust the event, not info.
 */
describe("subscribeSessionState", () => {
  beforeEach(() => {
    resetSessionRestore();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    { event: SESSION_EXPIRED, why: "the token lapses; no logout is emitted" },
    { event: LOGOUT, why: "signed out elsewhere in the app" },
  ])("drives the state to signed-out on $event ($why)", async ({ event }) => {
    const subscribeSessionState = await loadSubscribe();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    const onChange = vi.fn();

    const unsubscribe = subscribeSessionState(fake.session, onChange);
    fake.events.emit(event);

    expect(onChange).toHaveBeenCalledTimes(1);
    // The whole state object, not just its status: a signed-out state carrying
    // a leftover webId is what a UI would happily go on rendering.
    expect(onChange).toHaveBeenCalledWith({ status: "signed-out" });

    // The trap, spelled out. `info` still claims a live session at this point —
    // exactly as it does in the real library — so an implementation that
    // consulted it here would have reported signed-in.
    expect(fake.info.isLoggedIn).toBe(true);

    unsubscribe();
  });

  /**
   * The same thing said in the terms the studio actually renders: the owner
   * verdict. The "before" assertion is what stops the "after" being vacuous.
   */
  it("stops the studio reporting owner once the session has expired", async () => {
    const subscribeSessionState = await loadSubscribe();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    let state: SessionState = await restoreSession(fake.session);
    expect(studioState(state, OWNER)).toEqual({ status: "owner", webId: OWNER });

    const unsubscribe = subscribeSessionState(fake.session, (next: SessionState) => {
      state = next;
    });
    fake.events.emit(SESSION_EXPIRED);

    expect(studioState(state, OWNER)).toEqual({ status: "signed-out" });
    unsubscribe();
  });

  /**
   * A leaked listener is a real bug in a component that mounts twice under
   * StrictMode: the second mount subscribes again, the first never detaches,
   * and every later event fires into a callback closing over unmounted state.
   *
   * Both halves are asserted, because either alone is weak. "onChange was not
   * called" passes an implementation that merely sets a flag and leaves the
   * listener attached for ever; "no listeners remain" passes one that removed
   * them at subscribe time and never worked at all — which is why the emitter
   * is checked to be non-empty WHILE subscribed.
   */
  it("returns an unsubscribe that really detaches every listener it added", async () => {
    const subscribeSessionState = await loadSubscribe();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    const onChange = vi.fn();

    expect(fake.events.eventNames()).toEqual([]);
    const unsubscribe = subscribeSessionState(fake.session, onChange);
    expect(fake.events.eventNames().length).toBeGreaterThan(0);
    expect(fake.events.listenerCount(SESSION_EXPIRED)).toBe(1);

    unsubscribe();

    expect(fake.events.eventNames()).toEqual([]);
    fake.events.emit(SESSION_EXPIRED);
    fake.events.emit(LOGOUT);
    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * StrictMode again, from the other side: two subscriptions coexist for a
   * moment, and unsubscribing one must not silence the other. This is the test
   * that fails on `events.removeAllListeners()`, the tempting one-liner —
   * which would also tear down the listener Session's own constructor
   * registered for SESSION_EXPIRED, i.e. break the library's internal logout.
   *
   * Unsubscribing twice is included because React can call a cleanup more than
   * once; it must be inert, not throw and not remove someone else's listener.
   */
  it("unsubscribing one subscriber leaves another's listeners attached", async () => {
    const subscribeSessionState = await loadSubscribe();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = subscribeSessionState(fake.session, first);
    subscribeSessionState(fake.session, second);

    unsubscribeFirst();
    expect(() => unsubscribeFirst()).not.toThrow();

    fake.events.emit(SESSION_EXPIRED);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ status: "signed-out" });
  });

  /**
   * Subscribing is registration and nothing else.
   *
   * NO SYNTHETIC INITIAL STATE, deliberately: the caller already holds a state
   * from restoreSession, and a subscription that announced `signed-out` on
   * mount would clobber a perfectly good `owner` verdict — the sign-in button
   * flashing over a signed-in studio on every mount.
   *
   * NO NETWORK, and asserted rather than left to MSW. test/setup.ts fails an
   * unhandled request, which makes this partly free, but a spy on fetch says
   * what is meant and would still catch a request to a URL some handler
   * happened to cover.
   */
  it("subscribing synthesises no state and touches neither the session nor the network", async () => {
    const subscribeSessionState = await loadSubscribe();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    const seen: SessionState[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const unsubscribe = subscribeSessionState(fake.session, (state: SessionState) =>
      seen.push(state),
    );

    expect(seen).toEqual([]);
    expect(fake.restores).toEqual([]);
    expect(fake.logins).toEqual([]);
    expect(fake.logouts).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();

    unsubscribe();
  });

  /**
   * THE MEMO HAS TO GO WITH IT, and it belongs here rather than in the caller:
   * `restore` is module-private, and the only public way to clear it is
   * resetSessionRestore, which is documented as a TEST SEAM. Making a component
   * call a test seam to fix a production bug would be the wrong shape.
   *
   * What it costs to skip: restoreSession is memoised once per page load, so
   * after an expiry the memo still holds a promise resolving `signed-in`. Every
   * later caller — a remount, a route change back into the studio — reads the
   * stale answer and the studio is signed-in for ever, or until a hard reload.
   *
   * The call count is the only visible difference between "asked again" and
   * "served the memo", which is why the fake's outcome is changed first: a memo
   * that was never cleared answers signed-in, and one that was answers
   * signed-out. Both assertions are needed — the count alone would pass an
   * implementation that re-restored and then ignored the result.
   */
  it.each([
    { event: SESSION_EXPIRED, why: "expiry" },
    { event: LOGOUT, why: "a logout elsewhere" },
  ])("clears the once-per-page-load memo on $event ($why)", async ({ event }) => {
    const subscribeSessionState = await loadSubscribe();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    expect(await restoreSession(fake.session)).toEqual({ status: "signed-in", webId: OWNER });
    expect(fake.restores).toHaveLength(1);

    const unsubscribe = subscribeSessionState(fake.session, () => {});
    fake.setOutcome({ isLoggedIn: false });
    fake.events.emit(event);

    expect(await restoreSession(fake.session)).toEqual({ status: "signed-out" });
    expect(fake.restores).toHaveLength(2);

    unsubscribe();
  });
});

// ------------------------------------------------------------------- signIn

/**
 * `login()` redirects the browser away, so there is exactly one observable
 * thing about it and it is the argument object.
 *
 * WHY THAT IS WORTH A TEST AT ALL. Phase 0 found that when the identity
 * provider cannot use the client ID document, login falls back to DYNAMIC
 * CLIENT REGISTRATION: the flow still works, and the consent screen shows a
 * bare UUID instead of the app's name. A dropped or drifted `clientId`
 * therefore degrades silently rather than failing — nothing goes red, and the
 * only symptom is on a screen no test looks at.
 *
 * The values cannot be recomputed in the browser: SITE_URL and SITE_NAME are
 * not NEXT_PUBLIC_, and `lib/config.ts` throws if reached there. They arrive as
 * props from the thin server component, which is why signIn takes them.
 * `window.location.origin` is not a substitute — it drifts from the document
 * the identity provider actually fetches the moment the app is reachable on two
 * hostnames.
 */
const ISSUER = "https://login.example";
const SITE = "https://diary.example";
const SITE_NAME = "Luca's travel diary";

describe("signIn", () => {
  beforeEach(() => {
    resetSessionRestore();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("calls login once, with exactly the arguments the identity provider needs", async () => {
    const signIn = await loadSignIn();
    const fake = fakeStudioSession();

    await signIn(fake.session, { oidcIssuer: ISSUER, siteUrl: SITE, siteName: SITE_NAME });

    expect(fake.logins).toHaveLength(1);
    // toStrictEqual, not toMatchObject: an extra key is as much a bug as a
    // missing one here — `clientSecret` or `handleRedirect` slipping in changes
    // how the library authenticates, and `toMatchObject` would not notice.
    expect(fake.logins[0]).toStrictEqual({
      oidcIssuer: ISSUER,
      redirectUrl: `${SITE}/studio`,
      clientId: `${SITE}/client-id.jsonld`,
      // Passed even though the client ID document also carries it: it is what
      // the consent screen shows in the dynamic-registration fallback, where
      // the alternative is a bare UUID.
      clientName: SITE_NAME,
    });
    // Signing in is not restoring. A signIn that also called
    // handleIncomingRedirect would burn the memo on the way out of the page.
    expect(fake.restores).toEqual([]);
  });

  /**
   * THE DRIFT CHECK, and the reason this step was deferred until now.
   *
   * The two ends are built in different files from the same env var:
   * app/(public)/client-id.jsonld/route.ts publishes the document the identity
   * provider fetches, and signIn sends what the browser claims to be. If they
   * disagree the IdP fails with an opaque error, or silently falls back to
   * dynamic registration. So the document is generated here — for real, through
   * the route handler — and compared, rather than a URL being hand-copied into
   * the expectation on both sides.
   *
   * Status AND body: a route that 500s (SITE_URL unset) or returns nothing
   * would otherwise satisfy an `undefined === undefined` comparison below. Each
   * field is checked to be a non-empty string of the expected shape first.
   */
  it("sends exactly the clientId, redirectUrl and clientName that client-id.jsonld publishes", async () => {
    const signIn = await loadSignIn();
    vi.stubEnv("SITE_URL", SITE);
    vi.stubEnv("SITE_NAME", SITE_NAME);

    const response = await clientIdDocument();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("ld+json");
    const document = (await response.json()) as {
      client_id?: string;
      client_name?: string;
      redirect_uris?: string[];
    };
    expect(document.client_id).toBe(`${SITE}/client-id.jsonld`);
    expect(document.client_name).toBe(SITE_NAME);
    expect(document.redirect_uris).toEqual([`${SITE}/studio`]);

    const fake = fakeStudioSession();
    // Exactly what the thin server component can pass down, read the same way
    // it reads it — so a change to lib/config.ts is caught here too.
    await signIn(fake.session, {
      oidcIssuer: ISSUER,
      siteUrl: config.siteUrl,
      siteName: config.siteName,
    });

    const args = fake.logins[0] as { clientId?: string; clientName?: string; redirectUrl?: string };
    expect(args.clientId).toBe(document.client_id);
    expect(args.clientName).toBe(document.client_name);
    expect(document.redirect_uris).toContain(args.redirectUrl);
  });

  /**
   * SITE_URL with a trailing slash is the normal way a human pastes an origin,
   * and .env.example does not say not to. Unnormalised it yields
   * `https://diary.example//client-id.jsonld` — a URL that is not the client ID
   * document, so the IdP cannot match it and drops to dynamic registration.
   * Silent again.
   *
   * The project already treats a trailing slash as expected input: both
   * app/(public)/sitemap.ts and app/(public)/rss.xml/route.ts strip it with
   * `config.siteUrl.replace(/\/$/, "")`.
   */
  it("normalises a trailing slash on the site URL", async () => {
    const signIn = await loadSignIn();
    const fake = fakeStudioSession();

    await signIn(fake.session, {
      oidcIssuer: ISSUER,
      siteUrl: `${SITE}/`,
      siteName: SITE_NAME,
    });

    expect(fake.logins[0]).toStrictEqual({
      oidcIssuer: ISSUER,
      redirectUrl: `${SITE}/studio`,
      clientId: `${SITE}/client-id.jsonld`,
      clientName: SITE_NAME,
    });
  });
});

/**
 * The other end of the same invariant, and the only test here that fails
 * against code that already ships rather than against a missing export.
 *
 * app/(public)/client-id.jsonld/route.ts interpolates `process.env.SITE_URL`
 * directly — it is the one consumer of the site URL that neither goes through
 * `config.siteUrl` nor strips a trailing slash, unlike sitemap.ts and
 * rss.xml/route.ts which both do. With `SITE_URL=https://diary.example/` it
 * publishes `https://diary.example//client-id.jsonld` and a redirect URI of
 * `https://diary.example//studio`, and the login round-trip breaks in the way
 * that shows a bare UUID on the consent screen.
 *
 * Deliberately does not dictate the fix: reading config.siteUrl and stripping
 * there fixes sitemap and rss's duplication at the same time.
 */
describe("the client ID document the login arguments have to match", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("survives a SITE_URL with a trailing slash", async () => {
    vi.stubEnv("SITE_URL", `${SITE}/`);
    vi.stubEnv("SITE_NAME", SITE_NAME);

    const response = await clientIdDocument();
    expect(response.status).toBe(200);
    const document = (await response.json()) as {
      client_id?: string;
      redirect_uris?: string[];
      post_logout_redirect_uris?: string[];
    };

    expect(document.client_id).toBe(`${SITE}/client-id.jsonld`);
    expect(document.redirect_uris).toEqual([`${SITE}/studio`]);
    expect(document.post_logout_redirect_uris).toEqual([`${SITE}/`]);
  });
});

// ------------------------------------------------------------------ signOut

describe("signOut", () => {
  beforeEach(() => {
    resetSessionRestore();
  });

  /**
   * `logoutType` is a mandatory discriminator, and the two arms are not
   * interchangeable. `app` clears the session in this browser. `idp` signs the
   * owner out of their identity provider entirely — every Solid app they use —
   * and redirects away to do it, to a postLogoutUrl that must already be listed
   * in `post_logout_redirect_uris`, which today names only `${SITE_URL}/`.
   *
   * A bare `logout()` records `undefined` here and fails, which is the point:
   * the discriminator cannot be left to the library's default because there
   * isn't one.
   */
  it("asks for an app logout, never an idp logout", async () => {
    const signOut = await loadSignOut();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    await signOut(fake.session);

    expect(fake.logouts).toHaveLength(1);
    expect(fake.logouts[0]).toStrictEqual({ logoutType: "app" });
  });

  /**
   * Signing out and then finding yourself signed in is the memo bug with the
   * clearest symptom: the shell remounts, restoreSession serves the memoised
   * `signed-in`, and the studio comes back as owner over a session that no
   * longer exists.
   */
  it("clears the memo, so a later restore cannot resurrect the signed-in answer", async () => {
    const signOut = await loadSignOut();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    expect(await restoreSession(fake.session)).toEqual({ status: "signed-in", webId: OWNER });
    expect(fake.restores).toHaveLength(1);

    fake.setOutcome({ isLoggedIn: false });
    await signOut(fake.session);

    expect(await restoreSession(fake.session)).toEqual({ status: "signed-out" });
    expect(fake.restores).toHaveLength(2);
  });

  /**
   * The two halves composed, through the library's real mechanism: signOut does
   * not report anything itself — `logout()` emits LOGOUT (internalLogout(true)),
   * and the subscription is what tells the UI. This is the test that fails if
   * signOut is wired up but nothing listens, i.e. the button works and the
   * screen does not change.
   */
  it("reaches a subscriber, because app logout emits the LOGOUT the subscription listens for", async () => {
    const signOut = await loadSignOut();
    const subscribeSessionState = await loadSubscribe();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    const onChange = vi.fn();

    const unsubscribe = subscribeSessionState(fake.session, onChange);
    await signOut(fake.session);

    expect(onChange).toHaveBeenCalledWith({ status: "signed-out" });
    unsubscribe();
  });
});

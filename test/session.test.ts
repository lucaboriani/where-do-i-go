import { beforeEach, describe, expect, it } from "vitest";
import {
  resetSessionRestore,
  restoreSession,
  sameWebId,
  studioState,
  type SessionState,
  type SolidSessionLike,
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

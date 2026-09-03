/**
 * The studio's session: restoring it once per page load, and deciding whether
 * the visitor is the owner.
 *
 * STUDIO-ONLY. This module is the seam where @inrupt/solid-client-authn-browser
 * enters the app, so a public route that imports it drags the auth library into
 * the public bundle indirectly. eslint.config.mjs fences `lib/studio` off from
 * `app/(public)/**` and `components/public/**` next to lib/pod/write and
 * lib/pod/access (CLAUDE.md, the public/studio boundary; invariant 3).
 *
 * WHAT THIS IS NOT. Invariant 5: the owner check below is UX. It decides what
 * the studio renders — never what the Pod permits. Assume a client that skips
 * it entirely; every authorisation decision that matters is the Pod's, and this
 * module never sees a credential it could leak to a server (invariant 4: there
 * is no server-side session anywhere in this system).
 *
 * Only types are imported from the auth library here. `import type` erases, so
 * nothing in this file puts the library in a bundle; the real Session arrives
 * by injection from the studio shell, which is also what lets the interesting
 * behaviour below be tested against a plain object.
 */

import type { IHandleIncomingRedirectOptions, ISessionInfo } from "@inrupt/solid-client-authn-browser";

/**
 * The narrowest structural shape of a Solid session this module needs.
 *
 * Both halves are DERIVED from the library's own types rather than retyped, so
 * they cannot drift from `Session` on an upgrade:
 *
 *   - `info` is a Pick of ISessionInfo. Session declares `readonly info:
 *     ISessionInfo`, which is assignable to a two-property subset of itself;
 *     asking for the whole of ISessionInfo instead would demand `sessionId`,
 *     which only the real library can produce, and would push every test of
 *     this module through an OIDC round-trip.
 *   - `handleIncomingRedirect` takes the library's own options interface and
 *     returns `Promise<unknown>`. The real one returns
 *     `Promise<ISessionInfo | undefined>` and accepts `string |
 *     IHandleIncomingRedirectOptions`, both of which satisfy this. The return
 *     value is deliberately unknown: this module reads `session.info` and never
 *     the resolved value (see restoreSession).
 */
export interface SolidSessionLike {
  readonly info: Pick<ISessionInfo, "isLoggedIn" | "webId">;
  handleIncomingRedirect(options?: IHandleIncomingRedirectOptions): Promise<unknown>;
}

/** Where the session restore has got to. `restoring` is a state, never a result. */
export type SessionState =
  | { status: "restoring" }
  | { status: "signed-out" }
  | { status: "signed-in"; webId: string };

/** The session state plus the owner verdict, which is what the studio renders. */
export type StudioState =
  | { status: "restoring" }
  | { status: "signed-out" }
  | { status: "owner"; webId: string }
  /** Both WebIDs, so the UI can say "signed in as X; this diary belongs to Y". */
  | { status: "not-owner"; webId: string; owner: string };

const SIGNED_OUT: SessionState = { status: "signed-out" };

/**
 * IRI equality for two WebIDs, per RFC 3986 §6: scheme and host are
 * case-insensitive, the default port for the scheme is elidable, and path,
 * query and fragment are compared character by character.
 *
 * Parsing is done by `URL`, not by string surgery, because every hand-rolled
 * shortcut is wrong in a way that matters here. `a.toLowerCase() === b`
 * case-folds the path and fragment, and one profile document can describe two
 * agents — `#me` and `#i` are different people. Stripping `:\d+` makes :8443
 * equal to the default port, i.e. a different origin's WebID becomes the
 * owner's.
 *
 * FAILS CLOSED. Anything unparseable on either side is `false`, including two
 * identical unparseable strings: an unset or mistyped OWNER_WEBID must make
 * nobody the owner rather than making everybody who mistypes it the same way
 * the owner. `URL` throws on bad input, so the guard is the whole point.
 */
export function sameWebId(a: string, b: string): boolean {
  const left = normaliseIri(a);
  const right = normaliseIri(b);
  if (left === undefined || right === undefined) return false;
  return left === right;
}

/** `URL.href` is the RFC 3986 normal form: scheme and host lower-cased, the
 *  default port dropped, everything after the authority left alone. */
function normaliseIri(value: string): string | undefined {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

/**
 * The owner verdict. Routes through sameWebId rather than `===` so the owner
 * is not locked out by a provider that spells their host with a capital, and
 * carries the configured owner WebID into `not-owner` so the UI can name it.
 */
export function studioState(session: SessionState, ownerWebId: string): StudioState {
  switch (session.status) {
    case "restoring":
      return { status: "restoring" };
    case "signed-out":
      return { status: "signed-out" };
    case "signed-in":
      return sameWebId(session.webId, ownerWebId)
        ? { status: "owner", webId: session.webId }
        : { status: "not-owner", webId: session.webId, owner: ownerWebId };
  }
}

/**
 * Module-level memo. One restore per page load, shared by every caller.
 *
 * `null` means "not started, or the last attempt failed": a failure is never
 * left in here (see below).
 */
let restore: Promise<SessionState> | null = null;

/**
 * Restore the session once, however many times this is called.
 *
 * THE MEMO IS THE POINT, and it is installed SYNCHRONOUSLY — before any await —
 * because the thing it defends against is synchronous. docs/phase-0-spike.md,
 * "What the App Router requires for the redirect (question 2)": under React 19
 * StrictMode the effect is invoked twice, and the FIRST invocation returned
 * `isLoggedIn: false` while the second returned `true`. Two round-trips, and
 * whichever caller reads the session first concludes the user is signed out. A
 * memo installed after an await is not a memo: both invocations are already
 * past the guard by then.
 *
 * `session.info` is therefore read AFTER the await, never before. Reading it
 * before is that phase-0 bug written out in code.
 *
 * A REJECTION IS A VALUE. `restorePreviousSession: true` is not a local
 * restore — phase 0 found it issues `/.oidc/auth?…&prompt=none`, a silent
 * re-authentication that depends on the Pod being reachable and on cookie
 * behaviour Safari ITP interferes with. One flaky round-trip must not throw at
 * a React effect, and must not be memoised either: a rejected (or permanently
 * failed) promise in `restore` would make the studio unusable until a hard
 * reload. So the failure clears the memo and resolves `signed-out`, leaving the
 * next call free to try again.
 *
 * The `.catch` is attached while the memoised promise is being built, so the
 * rejection is handled before anything can observe it as unhandled.
 */
export function restoreSession(session: SolidSessionLike): Promise<SessionState> {
  if (restore !== null) return restore;

  const attempt: Promise<SessionState> = readRestoredSession(session).catch(() => {
    // Only clear the memo if it is still this attempt: a resetSessionRestore()
    // or a later call in between must not have its promise discarded.
    if (restore === attempt) restore = null;
    return SIGNED_OUT;
  });

  restore = attempt;
  return attempt;
}

/**
 * Split out so that `restoreSession` itself is not `async`: the call to
 * handleIncomingRedirect has to happen on the synchronous path, and an async
 * function called here runs to its first await synchronously while turning a
 * synchronous throw into a rejection the catch above can handle.
 */
async function readRestoredSession(session: SolidSessionLike): Promise<SessionState> {
  await session.handleIncomingRedirect({ restorePreviousSession: true });

  // AFTER the await. See the note above.
  const { isLoggedIn, webId } = session.info;
  if (!isLoggedIn) return SIGNED_OUT;
  // isLoggedIn without a WebID is not signed in as far as this app is
  // concerned: the WebID is what sameWebId compares, and an undefined one
  // would make the owner check compare against nothing.
  if (typeof webId !== "string" || webId === "") return SIGNED_OUT;
  return { status: "signed-in", webId };
}

/**
 * Clear the memo. A TEST SEAM, and documented as one so it is not mistaken for
 * a logout — it drops this module's record of the restore and touches neither
 * the session nor the Pod.
 *
 * A module-level memo outlives a test file: without a reset, the first case to
 * run decides the answer every later case gets, and the suite passes or fails
 * on case order. The memo is deliberately module-level rather than
 * per-session — "once per page load" is the guarantee, and a WeakMap keyed by
 * session object would restore twice if the shell ever constructed two.
 */
export function resetSessionRestore(): void {
  restore = null;
}

/**
 * The studio's session: restoring it once per page load, deciding whether the
 * visitor is the owner, signing in and out, and keeping the restore memo in
 * step with the session it describes.
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

import type {
  EVENTS,
  IHandleIncomingRedirectOptions,
  ISessionInfo,
  Session,
} from "@inrupt/solid-client-authn-browser";

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
 *
 * TWO SEAMS, SO TWO INTERFACES. Restoring a session needs `info` and
 * `handleIncomingRedirect` and nothing else — test/session.test.ts pins that by
 * asserting a two-member plain object still satisfies this type. Signing in and
 * out, and subscribing to expiry, need three more members.
 *
 * One interface with three OPTIONAL members was tried first and rejected. It
 * typechecks, but it forces every studio call site to test for `undefined` and
 * throw a TypeError that a real `Session` can never trigger — three unreachable
 * arms in the auth seam, uncoverable by any test, whose error strings were
 * reduced to saying "this was given the restore half where the studio half is
 * needed". That is the type checker's sentence to pronounce, not a runtime
 * string's. `StudioSessionLike extends SolidSessionLike` says it at compile
 * time, at the call site, naming the missing member.
 */
export interface SolidSessionLike {
  readonly info: Pick<ISessionInfo, "isLoggedIn" | "webId">;
  handleIncomingRedirect(options?: IHandleIncomingRedirectOptions): Promise<unknown>;
}

/**
 * The studio half: what `signIn`, `signOut` and `subscribeSessionState` need on
 * top of a restorable session — plus the authenticated `fetch` every Pod write
 * goes through.
 *
 * All four are indexed straight off `Session` rather than retyped, for the same
 * reason `info` is a Pick: hand-writing `login(options: { oidcIssuer,
 * redirectUrl, clientId, clientName })` would compile happily against a library
 * that had renamed one of them.
 *
 * `fetch` IS THE CREDENTIAL, and it is the reason it is on this interface at
 * all. `saveEntry` takes `fetch: PodFetch` and its docblock forbids the
 * fallback — "Never defaulted to the ambient one: that is a silent downgrade to
 * anonymous, which reads as 'not found' on a hosted Pod" — so the studio needs
 * something typed to hand it, and this is the only object in the browser that
 * has one. `Session["fetch"]` is `typeof fetch` today; writing that out by hand
 * would compile against a library that changed the signature, and the failure
 * would be a 401 at runtime rather than a red build. Nothing here ever leaves
 * the browser (invariant 4).
 *
 * WHY `events` IS THE LIBRARY'S TYPE AND NOT `{ on, off }`. Measured with tsc,
 * not assumed: `Session["events"]` is `ISessionEventListener`, which extends
 * node's `EventEmitter`, and its methods return `this` — so a hand-rolled
 * `{ on, off }` stand-in is rejected with "missing addListener, once,
 * removeListener, emit, and 9 more". A real `EventEmitter` satisfies it, which
 * is exactly what the studio fake in test/session.test.ts supplies. The seam
 * therefore stays testable without the library while still being the library's
 * own contract.
 */
export interface StudioSessionLike extends SolidSessionLike {
  login: Session["login"];
  logout: Session["logout"];
  fetch: Session["fetch"];
  readonly events: Session["events"];
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
  clearRestore();
}

/**
 * The same thing, module-private and without the "test seam" label.
 *
 * `restore` is private, so a component that needed the memo dropped — after an
 * expiry, after a sign-out — could only reach it through resetSessionRestore,
 * i.e. by calling a documented test seam to fix a production bug. Clearing
 * belongs in this module, next to the code that knows when the memo has gone
 * stale; the seam stays what it says it is.
 */
function clearRestore(): void {
  restore = null;
}

/* ==========================================================================
 * The studio shell's three verbs.
 *
 * subscribeSessionState / signIn / signOut, rather than names mirroring the
 * library's on / login / logout, because each of them does something the
 * library does not: they keep the once-per-page-load memo above in step with
 * the session it describes.
 * ========================================================================== */

/**
 * The two events that mean "not signed in any more", pinned to the library's
 * own string literals by their annotations.
 *
 * `typeof EVENTS.SESSION_EXPIRED` is the literal type "sessionExpired"
 * (constant.d.ts declares EVENTS with `readonly` members), so an upgrade that
 * renames a constant or changes its value fails to COMPILE here. Without the
 * annotation a drifted name is silently dead on both sides: the listener is
 * registered for an event nothing ever emits, no error is raised anywhere, and
 * the studio simply stops noticing that the session has gone.
 */
const SESSION_EXPIRED: typeof EVENTS.SESSION_EXPIRED = "sessionExpired";
const LOGOUT: typeof EVENTS.LOGOUT = "logout";

/**
 * Watch the session for the two ways it can stop being signed in, and clear the
 * memo when either happens. Returns the unsubscribe.
 *
 * BOTH EVENTS, AND SESSION_EXPIRED IS THE ONE THAT MATTERS. Verified in the
 * installed @inrupt/solid-client-authn-browser@5.0.0 (dist/index.mjs:1205):
 * Session's constructor registers
 *
 *     this.events.on(EVENTS.SESSION_EXPIRED, () => this.internalLogout(false));
 *
 * and that `false` is `emitSignal` — internalLogout only emits EVENTS.LOGOUT
 * when it is true. **An expiry therefore never emits LOGOUT.** A subscription
 * to LOGOUT alone catches a deliberate sign-out and nothing else, and the
 * studio goes on rendering `owner` over a lapsed session while every write
 * 401s: the app telling the owner they can save when they cannot.
 *
 * THE STATE COMES FROM THE EVENT, NEVER FROM `session.info`. Same source,
 * internalLogout:
 *
 *     await this.clientAuthentication.logout(this.info.sessionId, options);
 *     this.info.isLoggedIn = false;
 *     if (emitSignal) { this.events.emit(EVENTS.LOGOUT); }
 *
 * `info.isLoggedIn` is set only AFTER an await. Our listener is registered
 * later than Session's own and runs synchronously inside the same `emit`, so
 * when it runs `session.info` still says `isLoggedIn: true`. Reading it here
 * would report the owner as signed in at the exact moment they stopped being —
 * which is the bug this function exists to fix, not a shortcut past it.
 *
 * NO SYNTHETIC INITIAL STATE. Subscribing is registration and nothing else: the
 * caller already holds a state from restoreSession, and announcing `signed-out`
 * on mount would clobber a perfectly good `owner` verdict — the sign-in button
 * flashing over a signed-in studio every time the shell mounts.
 */
export function subscribeSessionState(
  session: StudioSessionLike,
  onChange: (state: SessionState) => void,
): () => void {
  const events = session.events;

  const signedOut = () => {
    // The memo goes with the state, and it goes FIRST. restoreSession is
    // memoised once per page load, so after an expiry it still holds a promise
    // resolving `signed-in`; every later caller — a remount, a route change
    // back into the studio — would read that stale answer and the studio would
    // be signed in for ever, or until a hard reload. Clearing before onChange
    // means a caller that re-restores from inside its own state update gets a
    // fresh answer rather than the one being invalidated.
    clearRestore();
    onChange(SIGNED_OUT);
  };

  events.on(SESSION_EXPIRED, signedOut);
  events.on(LOGOUT, signedOut);

  // Only the listeners this call added, by reference. `removeAllListeners()`
  // would be shorter and would also tear down the SESSION_EXPIRED listener
  // Session's own constructor registered — breaking the library's internal
  // logout — as well as any second subscriber, which under StrictMode
  // coexists with this one for a moment.
  return () => {
    events.off(SESSION_EXPIRED, signedOut);
    events.off(LOGOUT, signedOut);
  };
}

/** What the thin server component hands down: the values a browser cannot
 *  recompute, because SITE_URL and SITE_NAME are not NEXT_PUBLIC_ and
 *  lib/config.ts throws if it is reached from the client. */
export interface SignInOptions {
  /** The visitor's identity provider, e.g. https://login.inrupt.com. */
  oidcIssuer: string;
  /** The site's public origin. A trailing slash is normalised away here. */
  siteUrl: string;
  /** Shown on the consent screen in the dynamic-registration fallback. */
  siteName: string;
}

/**
 * Start the login redirect. This function does not return in a browser: the
 * library navigates away, and the page is replaced.
 *
 * THE ARGUMENTS ARE THE WHOLE BEHAVIOUR, and `clientId` is the one that fails
 * silently. Phase 0 found that when the identity provider cannot use the client
 * ID document, login falls back to DYNAMIC CLIENT REGISTRATION: the flow still
 * completes, nothing errors, and the consent screen shows a bare UUID instead
 * of the app's name. A dropped or drifted clientId therefore degrades on a
 * screen no test looks at.
 *
 * ONE DERIVATION SITE. `${siteUrl}/studio` and `${siteUrl}/client-id.jsonld`
 * are built here and nowhere else, from the same origin, so the pair the
 * browser claims cannot drift from the pair app/(public)/client-id.jsonld/route.ts
 * publishes — the two ends of the login round-trip are built in different
 * files, and if they disagree the IdP either fails opaquely or falls back.
 * `window.location.origin` is not a substitute: it drifts from the document the
 * IdP actually fetches the moment the app is reachable on two hostnames.
 *
 * The trailing slash is stripped because `SITE_URL=https://diary.example/` is
 * the normal way a human pastes an origin and .env.example does not say not to.
 * Unnormalised it yields `https://diary.example//client-id.jsonld`, which is not
 * the client ID document — dynamic registration again. config.siteUrl now
 * normalises the same way at the source; this is the belt to that pair of
 * braces, because signIn is handed a plain string by its caller.
 *
 * THE MEMO IS DELIBERATELY LEFT ALONE, unlike signOut. login() ends this page:
 * the browser navigates to the IdP and comes back to a fresh module instance
 * with an empty memo. Clearing it here would be behaviour no caller can observe
 * and no test can kill.
 */
export async function signIn(session: StudioSessionLike, options: SignInOptions): Promise<void> {
  const origin = options.siteUrl.replace(/\/+$/, "");
  await session.login({
    oidcIssuer: options.oidcIssuer,
    redirectUrl: `${origin}/studio`,
    clientId: `${origin}/client-id.jsonld`,
    clientName: options.siteName,
  });
}

/**
 * Sign out in this browser, and drop the memo with the session.
 *
 * `logoutType: "app"` is not a default that could be left off — `ILogoutOptions`
 * is a discriminated union with no default arm, so the discriminator is
 * mandatory. It is also not interchangeable with the other one: `idp` signs the
 * owner out of their identity provider entirely, across every Solid app they
 * use, and redirects away to do it — to a `postLogoutUrl` that must already
 * appear in `post_logout_redirect_uris`, which today names only `${SITE_URL}/`.
 *
 * SIGNOUT REPORTS NOTHING ITSELF. `logout()` is `internalLogout(true, options)`,
 * and the `true` is what emits EVENTS.LOGOUT; the subscription above is what
 * tells the UI. That split is deliberate — the studio must react to a sign-out
 * that happened in another tab or another component exactly as it reacts to
 * this one.
 *
 * The memo is cleared in a `finally`, AFTER the await, on purpose. After,
 * because a restoreSession racing the in-flight logout would otherwise memoise
 * `signed-in` — `info.isLoggedIn` is still true until logout resolves — and a
 * clear placed before the call would not catch it. In a `finally`, because a
 * logout that throws leaves the session in an unknown state, and the safe
 * answer to "unknown" is to make the next caller ask again rather than to serve
 * a remembered `signed-in`.
 */
export async function signOut(session: StudioSessionLike): Promise<void> {
  try {
    await session.logout({ logoutType: "app" });
  } finally {
    clearRestore();
  }
}

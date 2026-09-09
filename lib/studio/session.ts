/**
 * The studio's session: one restore per page load, the owner verdict, signing
 * in and out. STUDIO-ONLY, and the owner check is UX rather than security
 * (invariant 5). Only types are imported, so nothing here bundles the library.
 * ./notes.md#the-session-seam-and-what-it-does-not-decide
 */

import type {
  EVENTS,
  IHandleIncomingRedirectOptions,
  ISessionInfo,
  Session,
} from "@inrupt/solid-client-authn-browser";

/**
 * The restore half: the narrowest shape this module needs, both members derived
 * from the library's own types rather than retyped so they cannot drift on an
 * upgrade. Two seams, so two interfaces, and not one with optional members:
 * ./notes.md#two-seams-so-two-interfaces
 */
export interface SolidSessionLike {
  readonly info: Pick<ISessionInfo, "isLoggedIn" | "webId">;
  handleIncomingRedirect(options?: IHandleIncomingRedirectOptions): Promise<unknown>;
}

/**
 * The studio half: what signIn, signOut and subscribeSessionState need on top of
 * a restorable session, all four indexed straight off `Session`. `fetch` IS THE
 * CREDENTIAL and never leaves the browser (invariant 4);
 * ./notes.md#fetch-is-the-credential
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
 * IRI equality for two WebIDs, per RFC 3986 §6, parsed by `URL` and never by
 * string surgery. FAILS CLOSED: anything unparseable on either side is `false`,
 * including two identical unparseable strings, so a mistyped OWNER_WEBID makes
 * nobody the owner. ./notes.md#comparing-two-webids-and-failing-closed
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

/** The owner verdict. Through sameWebId rather than `===`, and carrying the
 *  configured owner WebID into `not-owner` so the UI can name it. */
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
 * Restore the session once per page load. THE MEMO IS INSTALLED SYNCHRONOUSLY,
 * BEFORE ANY AWAIT, because the thing it defends against is synchronous —
 * phase-0 question 2. ./notes.md#the-memo-is-installed-synchronously-and-phase-0-is-why
 */
export function restoreSession(session: SolidSessionLike): Promise<SessionState> {
  if (restore !== null) return restore;

  const attempt: Promise<SessionState> = readRestoredSession(session).catch(() => {
    // A rejection is a VALUE, and only this attempt's memo is cleared — a
    // resetSessionRestore() in between must keep its own promise.
    // ./notes.md#a-rejection-is-a-value
    if (restore === attempt) restore = null;
    return SIGNED_OUT;
  });

  restore = attempt;
  return attempt;
}

/** Split out so that `restoreSession` itself is not `async` — the call to
 *  handleIncomingRedirect must happen on the synchronous path;
 *  see ./notes.md#the-memo-is-installed-synchronously-and-phase-0-is-why */
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
 * Clear the memo. A TEST SEAM, and labelled as one so it is not mistaken for a
 * logout: it touches neither the session nor the Pod.
 * ./notes.md#the-test-seam-and-its-module-private-twin
 */
export function resetSessionRestore(): void {
  clearRestore();
}

/** The same thing, module-private and without the "test seam" label, so that
 *  production callers never reach for the seam;
 *  see ./notes.md#the-test-seam-and-its-module-private-twin */
function clearRestore(): void {
  restore = null;
}

/* The studio shell's three verbs. subscribeSessionState / signIn / signOut
 * rather than the library's on / login / logout, because each also keeps the
 * once-per-page-load memo above in step with the session it describes. */

/**
 * The two events that mean "not signed in any more". The annotations pin them
 * to the library's own literals, so a renamed constant fails to COMPILE rather
 * than going silently dead on both sides.
 * ./notes.md#the-event-names-are-pinned-to-the-librarys-own-literals
 */
const SESSION_EXPIRED: typeof EVENTS.SESSION_EXPIRED = "sessionExpired";
const LOGOUT: typeof EVENTS.LOGOUT = "logout";

/**
 * Watch for the two ways a session stops being signed in, clear the memo, and
 * return the unsubscribe. BOTH EVENTS, and THE STATE COMES FROM THE EVENT AND
 * NEVER FROM `session.info`, which says `isLoggedIn: true` when this runs.
 * ./notes.md#the-expiry-listener-reads-the-event-not-the-session
 */
export function subscribeSessionState(
  session: StudioSessionLike,
  onChange: (state: SessionState) => void,
): () => void {
  const events = session.events;

  const signedOut = () => {
    // The memo goes with the state, and it goes FIRST: it still holds a
    // `signed-in` promise, and a caller that re-restores from inside its own
    // state update must not read the answer being invalidated.
    // ./notes.md#the-expiry-listener-reads-the-event-not-the-session
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
 * Start the login redirect; in a browser this does not return. A dropped
 * `clientId` degrades silently to dynamic client registration, and both URLs
 * are derived here and nowhere else.
 * ./notes.md#signin-one-derivation-site-and-the-fallback-that-looks-like-success
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
 * Sign out in this browser, and drop the memo with the session. `logoutType:
 * "app"` is mandatory and not interchangeable with `idp`; the memo is cleared
 * in a `finally`, AFTER the await, on purpose.
 * ./notes.md#signout-the-logout-type-and-why-the-clear-is-in-a-finally
 */
export async function signOut(session: StudioSessionLike): Promise<void> {
  try {
    await session.logout({ logoutType: "app" });
  } finally {
    clearRestore();
  }
}

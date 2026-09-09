# lib/studio — notes

Prose that outgrew a docblock, and findings recorded rather than acted on.
Section numbers are `docs/data-model.md`; decision numbers are
`docs/decisions.md`. Both stay the normative sources.

Everything here is studio-only. `eslint.config.mjs` fences `lib/studio` off
from `app/(public)/**` and `components/public/**` beside `lib/pod/write.ts` and
`lib/pod/access.ts`, and `size:public` is the real check.

## session.ts

### The session seam, and what it does not decide

This module is where `@inrupt/solid-client-authn-browser` enters the app, so a
public route importing it would drag the auth library into the public bundle
indirectly — hence the fence (invariant 3).

**The owner check is UX.** Invariant 5: it decides what the studio renders and
never what the Pod permits. Assume a client that skips it entirely. Every
authorisation decision that matters is the Pod's, and this module never sees a
credential it could hand to a server — there is no server-side session anywhere
in this system (invariant 4).

Only types are imported from the auth library. `import type` erases, so nothing
in this file puts the library in a bundle; the real `Session` arrives by
injection from the studio shell, which is also what lets the interesting
behaviour be tested against a plain object.

### Two seams, so two interfaces

`SolidSessionLike` and `StudioSessionLike` are both derived from the library's
own types rather than retyped, so they cannot drift from `Session` on an
upgrade:

- `info` is a `Pick` of `ISessionInfo`. `Session` declares
  `readonly info: ISessionInfo`, which is assignable to a two-property subset
  of itself; asking for the whole of `ISessionInfo` would demand `sessionId`,
  which only the real library can produce, and would push every test of this
  module through an OIDC round trip.
- `handleIncomingRedirect` takes the library's own options interface and returns
  `Promise<unknown>`. The real one returns `Promise<ISessionInfo | undefined>`
  and accepts `string | IHandleIncomingRedirectOptions`, both of which satisfy
  this. The return value is deliberately `unknown`: this module reads
  `session.info` and never the resolved value.
- `login`, `logout`, `fetch` and `events` are indexed straight off `Session`
  for the same reason. Hand-writing `login(options: { oidcIssuer, redirectUrl,
  clientId, clientName })` would compile happily against a library that had
  renamed one of them.

Restoring needs `info` and `handleIncomingRedirect` and nothing else —
`lib/studio/session.test.ts` pins that by asserting that a two-member plain
object still satisfies the type. Signing in and out, and subscribing to expiry,
need three more members.

**One interface with three optional members was tried first and rejected.** It
typechecks, but it forces every studio call site to test for `undefined` and
throw a `TypeError` a real `Session` can never trigger — three unreachable arms
in the auth seam, uncoverable by any test, whose error strings were reduced to
saying "this was given the restore half where the studio half is needed". That
is the type checker's sentence to pronounce, not a runtime string's.
`StudioSessionLike extends SolidSessionLike` says it at compile time, at the
call site, naming the missing member.

### fetch is the credential

`fetch` is on `StudioSessionLike` because `saveEntry` takes `fetch: PodFetch`
and forbids the fallback — defaulting to the ambient one is a silent downgrade
to anonymous, which reads as "not found" on a hosted Pod. The studio needs
something typed to hand it, and the session is the only object in the browser
that has one. Nothing here ever leaves the browser (invariant 4).

`Session["fetch"]` is `typeof fetch` today. Writing that out by hand would
compile against a library that changed the signature, and the failure would be
a 401 at runtime rather than a red build.

**Why `events` is the library's type and not `{ on, off }`.** Measured with
tsc, not assumed: `Session["events"]` is `ISessionEventListener`, which extends
node's `EventEmitter`, and its methods return `this` — so a hand-rolled
`{ on, off }` stand-in is rejected with "missing addListener, once,
removeListener, emit, and 9 more". A real `EventEmitter` satisfies it, which is
what the studio fake in `lib/studio/session.test.ts` supplies. The seam stays
testable without the library while still being the library's own contract.

### Comparing two WebIDs, and failing closed

`sameWebId` is IRI equality per RFC 3986 §6: scheme and host are
case-insensitive, the default port for the scheme is elidable, and path, query
and fragment are compared character by character. `URL.href` is that normal
form, which is why parsing is done by `URL` rather than by string surgery.

Every hand-rolled shortcut is wrong in a way that matters here.
`a.toLowerCase() === b` case-folds the path and fragment, and one profile
document can describe two agents — `#me` and `#i` are different people.
Stripping `:\d+` makes `:8443` equal to the default port, so a different
origin's WebID becomes the owner's.

**It fails closed.** Anything unparseable on either side is `false`, including
two identical unparseable strings: an unset or mistyped `OWNER_WEBID` must make
nobody the owner rather than making everybody who mistypes it the same way the
owner. `URL` throws on bad input, so the guard is the whole point.

`studioState` routes through `sameWebId` rather than `===`, so the owner is not
locked out by a provider that spells their host with a capital, and it carries
the configured owner WebID into `not-owner` so the UI can name it.

### The memo is installed synchronously, and phase 0 is why

`restoreSession` memoises at module level: one restore per page load, shared by
every caller. `null` means "not started, or the last attempt failed" — a
failure is never left in there.

**The memo is installed before any await, because the thing it defends against
is synchronous.** `docs/phase-0-spike.md`, "What the App Router requires for the
redirect (question 2)": under React 19 StrictMode the effect is invoked twice,
and the *first* invocation returned `isLoggedIn: false` while the second
returned `true`. Two round trips, and whichever caller reads the session first
concludes the visitor is signed out. A memo installed after an await is not a
memo — both invocations are already past the guard by then.

`session.info` is therefore read *after* the await, never before. Reading it
before is that phase-0 bug written out in code. `readRestoredSession` is split
out so that `restoreSession` itself is not `async`: the call to
`handleIncomingRedirect` has to happen on the synchronous path, and an async
function called there runs to its first await synchronously while turning a
synchronous throw into a rejection the `catch` can handle.

`isLoggedIn` without a WebID is not signed in as far as this app is concerned.
The WebID is what `sameWebId` compares, and an undefined one would make the
owner check compare against nothing.

### A rejection is a value

`restorePreviousSession: true` is not a local restore. Phase 0 found it issues
`/.oidc/auth?…&prompt=none`, a silent re-authentication that depends on the Pod
being reachable and on cookie behaviour Safari ITP interferes with.

One flaky round trip must not throw at a React effect, and must not be memoised
either: a rejected or permanently failed promise in `restore` would make the
studio unusable until a hard reload. So the failure clears the memo and
resolves `signed-out`, leaving the next call free to try again. The `.catch` is
attached while the memoised promise is being built, so the rejection is handled
before anything can observe it as unhandled. The memo is only cleared if it is
still that attempt — a `resetSessionRestore()` or a later call in between must
not have its promise discarded.

### The test seam, and its module-private twin

`resetSessionRestore` is labelled a test seam so it is not mistaken for a
logout: it drops this module's record of the restore and touches neither the
session nor the Pod. A module-level memo outlives a test file, so without a
reset the first case to run decides the answer every later case gets, and the
suite passes or fails on case order.

The memo is deliberately module-level rather than per-session. "Once per page
load" is the guarantee, and a `WeakMap` keyed by the session object would
restore twice if the shell ever constructed two.

`clearRestore` is the same thing without the label. `restore` is private, so a
component that needed the memo dropped — after an expiry, after a sign-out —
could otherwise only reach it by calling a documented test seam to fix a
production bug. Clearing belongs in this module, next to the code that knows
when the memo has gone stale.

### The expiry listener reads the event, not the session

**Both events, and `SESSION_EXPIRED` is the one that matters.** Verified in the
installed `@inrupt/solid-client-authn-browser@5.0.0` (`dist/index.mjs:1205`):
`Session`'s constructor registers

    this.events.on(EVENTS.SESSION_EXPIRED, () => this.internalLogout(false));

and that `false` is `emitSignal` — `internalLogout` only emits `EVENTS.LOGOUT`
when it is true. **An expiry therefore never emits `LOGOUT`.** A subscription to
`LOGOUT` alone catches a deliberate sign-out and nothing else, and the studio
goes on rendering `owner` over a lapsed session while every write 401s: the app
telling the owner they can save when they cannot.

**The state comes from the event, never from `session.info`.** Same source,
`internalLogout`:

    await this.clientAuthentication.logout(this.info.sessionId, options);
    this.info.isLoggedIn = false;
    if (emitSignal) { this.events.emit(EVENTS.LOGOUT); }

`info.isLoggedIn` is set only after an await. Our listener is registered later
than `Session`'s own and runs synchronously inside the same `emit`, so when it
runs `session.info` still says `isLoggedIn: true`. Reading it there would report
the owner as signed in at the exact moment they stopped being — the bug this
function exists to fix, not a shortcut past it.

**The memo goes with the state, and it goes first.** `restoreSession` is
memoised once per page load, so after an expiry it still holds a promise
resolving `signed-in`; every later caller — a remount, a route change back into
the studio — would read that stale answer and the studio would be signed in for
ever, or until a hard reload. Clearing before `onChange` means a caller that
re-restores from inside its own state update gets a fresh answer rather than the
one being invalidated.

**No synthetic initial state.** Subscribing is registration and nothing else:
the caller already holds a state from `restoreSession`, and announcing
`signed-out` on mount would clobber a perfectly good `owner` verdict — the
sign-in button flashing over a signed-in studio every time the shell mounts.

The unsubscribe removes only the listeners this call added, by reference.
`removeAllListeners()` would be shorter and would also tear down the
`SESSION_EXPIRED` listener `Session`'s own constructor registered, breaking the
library's internal logout, as well as any second subscriber — which under
StrictMode coexists with this one for a moment.

### The event names are pinned to the library's own literals

`typeof EVENTS.SESSION_EXPIRED` is the literal type `"sessionExpired"`
(`constant.d.ts` declares `EVENTS` with `readonly` members), so an upgrade that
renames a constant or changes its value fails to *compile* here.

Without the annotation a drifted name is silently dead on both sides: the
listener is registered for an event nothing ever emits, no error is raised
anywhere, and the studio simply stops noticing that the session has gone.

### signIn: one derivation site, and the fallback that looks like success

The arguments are the whole behaviour, and `clientId` is the one that fails
silently. Phase 0 found that when the identity provider cannot use the client ID
document, login falls back to **dynamic client registration**: the flow still
completes, nothing errors, and the consent screen shows a bare UUID instead of
the app's name. A dropped or drifted `clientId` therefore degrades on a screen
no test looks at.

`${siteUrl}/studio` and `${siteUrl}/client-id.jsonld` are built here and nowhere
else, from the same origin, so the pair the browser claims cannot drift from the
pair `app/(public)/client-id.jsonld/route.ts` publishes. The two ends of the
login round trip are built in different files, and if they disagree the IdP
either fails opaquely or falls back. `window.location.origin` is not a
substitute: it drifts from the document the IdP actually fetches the moment the
app is reachable on two hostnames.

The trailing slash is stripped because `SITE_URL=https://diary.example/` is the
normal way a human pastes an origin and `.env.example` does not say not to.
Unnormalised it yields `https://diary.example//client-id.jsonld`, which is not
the client ID document — dynamic registration again. `config.siteUrl` normalises
the same way at the source; this is the belt to that pair of braces, because
`signIn` is handed a plain string by its caller.

**The memo is deliberately left alone here, unlike in `signOut`.** `login()` ends
this page: the browser navigates to the IdP and comes back to a fresh module
instance with an empty memo. Clearing it would be behaviour no caller can
observe and no test can kill.

### signOut: the logout type, and why the clear is in a finally

`logoutType: "app"` is not a default that could be left off — `ILogoutOptions`
is a discriminated union with no default arm, so the discriminator is mandatory.
It is also not interchangeable with the other one: `idp` signs the owner out of
their identity provider entirely, across every Solid app they use, and redirects
away to do it, to a `postLogoutUrl` that must already appear in
`post_logout_redirect_uris` — which today names only `${SITE_URL}/`.

**`signOut` reports nothing itself.** `logout()` is `internalLogout(true,
options)`, and the `true` is what emits `EVENTS.LOGOUT`; the subscription is what
tells the UI. That split is deliberate: the studio must react to a sign-out that
happened in another tab or another component exactly as it reacts to this one.

The memo is cleared in a `finally`, *after* the await, on purpose. After,
because a `restoreSession` racing the in-flight logout would otherwise memoise
`signed-in` — `info.isLoggedIn` is still true until logout resolves — and a
clear placed before the call would not catch it. In a `finally`, because a logout
that throws leaves the session in an unknown state, and the safe answer to
"unknown" is to make the next caller ask again rather than to serve a remembered
`signed-in`.

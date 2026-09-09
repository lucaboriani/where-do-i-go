# studio-shell — notes

The one component that owns the session state, and the four things the owner may
be shown instead of the editor. Prose that outgrew a docblock, moved here by
Stage C's comment sweep on 2026-09-09; the rules a reader must not walk past are
still shouted inline.

## what the shell is not allowed to do

Both are load-bearing rather than stylistic:

1. It imports **no value** from `@inrupt/solid-client-authn-browser`. The
   session arrives as a prop, which is what lets every behaviour be tested
   against a plain object instead of an OIDC round-trip, and what keeps the
   library inside the `ssr: false` boundary that
   `components/studio/studio-client/studio-client.tsx` draws.
2. It reads **no config and no env var**. `OWNER_WEBID`, `SITE_URL` and
   `SITE_NAME` are not `NEXT_PUBLIC_`, so `lib/config.ts` throws the moment it
   is reached in a browser; `oidcIssuer` has no env var at all by design
   (`docs/data-model.md` §7.5 — it comes out of the owner's WebID document).
   All five values are props, handed down by the thin server component at
   `app/(studio)/studio/page.tsx`.

**The behaviour all lives in `lib/studio/session.ts`.** This file composes those
five functions and renders the verdict; it deliberately reimplements none of
them. In particular it never compares WebIDs with `===` (`studioState` routes
through `sameWebId`, which compares IRIs and fails closed) and never reads
`session.info` on an expiry (the event is the truth; `info.isLoggedIn` is still
`true` at that instant).

**Invariant 5.** The owner verdict decides what is rendered and nothing else.
The Pod enforces authorisation, so the `not-owner` message is a courtesy — "you
are signed in as X; this diary belongs to Y" — and must not be worded as though
this check were the protection.

**The one request this component makes** is the trips listing, and it is made
only on the `owner` branch. An authenticated enumeration fired for a visitor who
is not the owner is a request that will 403 on a real Pod, and firing it says
the studio asked a question it had no business asking. That is not invariant 5
being relied on for protection — the Pod still decides — it is simply not
asking.

## podRoot needs its trailing slash

`config.podRoot` is the only thing that normalises the slash, and every URL in
`lib/studio/trips.ts` is built with `new URL("travel/trips/", podRoot)` —
without it that resolves against the PARENT and 404s.

A prop for the same reason the four values above are: `POD_ROOT` is not
`NEXT_PUBLIC_`, so `lib/config.ts` throws the moment it is reached in a browser,
and this component runs in the browser.

## trips is a test seam, and supplied means supplied

`trips` is the list the owner can write an entry into, and it is labelled a test
seam so that nobody later "cleans up" a prop they cannot find a caller for:
**production passes nothing.** The studio is mounted with `ssr: false`, so
nothing upstream of this component holds an authenticated fetch and no server
component can resolve the list. It is injected for exactly the reason the
session is — twenty cases in `studio-shell.test.tsx` are about what this
component RENDERS given its trips, and none of them wants a Pod in it.

**Supplied means supplied**: offer exactly these and ask the Pod nothing.
**Absent means ask the Pod.** So `[]` and `undefined` are NOT interchangeable,
and a `trips = []` default in the destructuring — which is what used to be here
— would silently make every caller the first case and the enumeration dead code.

## pending is a state, never a result

`ListingState` records where the enumeration has got to.

`pending` is a state, never a result — the same rule `restoring` is held to one
level up, and for the same reason. "No trips to write into yet" asserts that the
owner's Pod has no trips, and that is false while the request is still in
flight; rendering it there tells the owner something untrue about their own data.

`failed` is likewise not `ready` with an empty list. `listStudioTrips` keeps
"your Pod has none" and "your Pod would not answer" apart deliberately, and
flattening them here would send an owner whose container is closed or absent off
to write a first trip, which is the one thing that will not help.

## enumerate only for the owner, and only when nobody handed us a list

Two booleans rather than `view` itself, and that is load-bearing: `studioState`
returns a **fresh object** on every render, so a listing keyed on it would
re-enter on its own result — not a doubled request but an unbounded one.
Everything in the effect's dependency list is either a primitive or the injected
session, which the shell already treats as stable.

## the in-flight listing is memoised by the root it was started for

The same defence `restoreSession` documents, one level up and for the same
reason: StrictMode invokes an effect twice, with the cleanup in between, so the
naive shape starts two enumerations and throws the first one's result away.
Sharing the promise means the second invocation attaches a second `.then` to the
first request rather than making a second one — a `return` on the second
invocation would instead abandon the only result there is, because the cleanup
has already set the first `live` to false.

**The ref is deliberately not cleared on cleanup.** A real unmount discards the
whole fiber and the next mount gets a fresh one; clearing it here would only
re-open the StrictMode hole above.

## the signed-in-as line is load-bearing

The owner UI is the sign-out control and the editor. The `Signed in as …` line
is load-bearing beyond courtesy — `e2e/solid-login.spec.ts` asserts on it as the
thing that distinguishes this branch from `not-owner` after a real login round
trip, and its argument is that the absence of the not-owner wording alone would
be a weak assertion.

**Invariant 5 still applies** to everything below it. Rendering the editor is
not permission to write: the session's own fetch carries the credential, and the
Pod is what accepts or refuses every request it makes.

## four things, and the whole point is that they stay four

A lazier `Writables` renders the editor when there is a list and the "no trips"
note otherwise, which silently says "your Pod has no trips" to an owner whose
request is still in flight, whose container is closed, and whose container is
not there at all. Three different problems, three different next actions, one
apology.

## the empty-Pod note only when the Pod really is empty

With a skip in hand the note would be false in the same way as rendering it
mid-request: there IS a trip up there, it just could not be read, and `Skipped`
above has already said so by name.

The wording avoids the phrase "belongs to" on purpose: that is the not-owner
courtesy message's contract phrase, and `studio-shell.test.tsx` queries it to
prove the owner is never shown it.

## the trips the studio could not read, by name

`listStudioTrips` skips one unreadable member rather than failing the lot —
`rebuildIndex`'s rule, "a single bad resource must not make the whole trip
unrecoverable". The other half of that bargain is `Skipped`: a trip the studio
cannot read is a trip the owner cannot write into, and saying nothing leaves
them wondering where it went. A count would not do it — the owner needs to know
WHICH one to go and look at.

It renders nothing at all when nothing was skipped. A permanent "0 trips could
not be read" is noise, and noise is how a real skip goes unnoticed.

## settingsUrlFor is total, and the empty string is the fail-closed answer

§7.6's owner-only resource, from the root this shell was handed.

**Total, for the reason `enumerateTrips` catches:** `privacySettingsUrl` builds
`new URL("travel/settings/privacy.ttl", podRoot)`, and a malformed `POD_ROOT`
makes that throw synchronously. Thrown from a render rather than from an effect,
it would take the whole studio down — a blank screen where the trips listing is
already prepared to say what went wrong.

The empty string is a URL that can only fail to read, and failing to read is
§9's fail-closed answer: the coordinate controls stay dead and say so, while
everything else on the form still works. A configuration that reaches here is
already showing the owner a failed enumeration.

## the enumeration is a value rather than a throw

`listStudioTrips` promises to return a `Result` and never to reject, so
`enumerateTrips`' catch is not defensive padding around a working function: it
is reachable, because `tripsContainerUrl` builds `new URL("travel/trips/",
podRoot)` and a malformed `POD_ROOT` makes that throw synchronously — turned
into a rejection by the `async` keyword. An unhandled rejection in a React
effect is a studio that renders "Looking for the trips…" for ever with the
reason only in the console.

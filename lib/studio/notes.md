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

## drafts.ts

### Why there is a local draft store at all

`docs/decisions.md` §10 is the whole justification: offline is deferred, and "in
the meantime the studio autosaves in-progress text to `localStorage`, because
losing a long entry in a hostel is what kills the habit."

This module is the storage half. The editor is the wiring, and the two are
tested separately — `lib/studio/drafts.test.ts` here, and the
`entry-editor.draft-autosave`, `draft-banner` and `draft-fields` suites there.

### The storage is injected, and nothing here throws

**The storage is injected, never reached for.** `localStorage` is a global that
throws on *access*, not on use, in some embedded browsers and with third-party
storage blocked. A module that reaches for it cannot be loaded in a node test
environment and cannot be given a storage whose failures are scripted. The
editor supplies the browser's own; every test supplies a fake.

**Nothing here throws, ever.** That is the headline invariant and it is not
defensiveness for its own sake: `readDraft` is called from the editor's mount
effect, so anything it threw would take the editor down on first render and turn
"we kept a backup of your text" into "you cannot open the editor at all".
Corrupt JSON, a payload from a build whose shape has moved on, a hand-edited
field, and a `getItem`/`setItem`/`removeItem` that throws are all absorbed:
`readDraft` answers `null`, `writeDraft` answers `false`.

`StorageLike` is deliberately narrower than the DOM's `Storage`, which also
demands `length`, `key()` and `clear()`. A fake implementing those would be a
fake with behaviour nobody wanted, and `clear()` in particular is a method this
module must never be able to call: one editor emptying the whole store would
take every other draft, and every other person's draft, with it. `clearDraft`
removes one key for the same reason.

A `removeItem` that throws means storage is disabled at the browser level. There
is nothing to report and nothing to do — the caller is discarding a draft, and a
draft that cannot be removed cannot have been stored either.

### Why writeDraft returns a boolean rather than a Result

`PodError` is the Pod's error vocabulary. None of its kinds describes a browser
refusing to keep a local copy, and inventing one would put a browser concern
into the vocabulary every Pod read and write shares.

### What may never be persisted

The ETag, `dcterms:created` and `schema:datePublished`. All three come from the
read that produced the editor's state (§10), and a draft outlives that read by
however long the browser was closed.

A restored ETag would condition the next write on a version the Pod replaced
long ago — a blind PUT wearing a helpful hat, and at worst, if the resource has
cycled back to a matching tag, an overwrite of an edit made elsewhere. A
restored `created` would overwrite §7.3's "when the record came into being" with
whenever the draft happened to be saved.

The schema is the fence: **seventeen fields**, and the parse output is what
reaches storage. It said thirteen from the day it was written until 2026-09-07,
by which point `photos`, the three place fields and `offset` had made it four
short — so when a field is added, this number is part of the change.

### The key has three parts, and the version segment has been tested three times

`wig.draft.v2.<webId>.<scope>`. Three parts, three collisions they prevent. The
**version**: a shape that has moved on gets a new number and the old payloads
become invisible rather than half-restorable. The **webId**: one machine with
two accounts must not hand the second person the first person's unfinished text.
The **scope**: the entry being created and the entry being edited are different
drafts, and so are two different entries. `DraftAddress` is an object rather
than two positional strings so that a webId/scope swap is a type error at the
call site instead of a key that looks plausible and matches nothing.

**`v1` → `v2` on 2026-09-06, which is the version segment doing its job** and not
a rename. The draft was nine fields; `lat`, `long` and `precision` made it
twelve. A v1 payload is a perfectly valid JSON object under the schema — unknown
keys are stripped, missing ones are not invented — so without the bump it would
restore nine controls and leave three showing whatever the editor's own defaults
left there, under a banner that had just told the owner their draft came back. A
coordinate the owner did not type, next to text they recognise, is worse than no
offer at all: invisible is the correct outcome for a payload whose shape has
moved on.

**`photos` arrived on 2026-09-06 and the key deliberately did not move**, which
is the same test applied and answered the other way. The hazard a bump exists
for is the half-restore. That cannot arise here, because no `v2` payload can
contain a photo — the editor had no photo control when `v2` payloads were
written. Such a draft restores an empty photo list, which is not a default
standing in for something lost; it is the truth about that draft. Hence the `[]`
default. Bumping would have thrown away real unsaved prose in exchange for
nothing.

**`placeName`, `locality` and `country` arrived on 2026-09-06 and the key did not
move either**, and here the answer required a third option rather than a yes or
a no. No `v2` payload can carry a place name, so a bump would throw away real
unsaved prose for nothing — but unlike `photos`, an absent place field cannot
safely be given a default, because in the editor `""` means REMOVE and would
delete the place of the entry being edited. The three are therefore
`.optional()`, which keeps "absent" distinguishable from "emptied" all the way
to the editor's restore. This is the one field group where the version segment
is not the only fence.

**`offset` arrived on 2026-09-07 and the key did not move for it either** — the
third time the version test is answered "no", and the second of the two ways of
answering it. No `v2` payload can carry an offset, because there was no control
to choose one with, so the half-restore cannot arise: such a draft restores
`""`, which is not a default standing in for something lost but "this draft has
nothing to say about the offset". `.default("")` rather than the place fields'
`.optional()`, for the reason below.

### The schema is not strict, and the fields are loose on purpose

**Not `.strict()`, and that is load-bearing rather than an oversight: unknown
keys are stripped.** A payload written by a slightly different build, or one a
curious owner edited in devtools, still restores its seventeen legitimate fields
instead of being thrown away. The stripping is also what guarantees that an
`etag` handed in by a caller spreading the editor's state can neither be written
nor read back, since the parse output is what reaches storage and what leaves
it.

The looseness of the individual fields is deliberate too. `story`, `tagsText`
and `mode` may all be empty strings: an empty travel mode is the editor's "Not
recorded" option, and a half-written entry with no story yet is the exact state
this whole feature exists for. `tripIri` may be empty because the trip picker
starts unchosen and the owner may type a headline first. A schema that demanded
a URL there would refuse to back up the most common draft there is.

`status` and `mode` reuse the app's own vocabularies rather than restating them,
so a value this editor could not put in its controls — a status from a future
build, a mode someone typed into devtools — is refused rather than restored into
a control that cannot show it.

### The offset is the owner's answer now, and empty means "no answer"

Since 2026-09-07 the offset is a form value rather than a derived one. §7.3:
`dy:occurredAt` "carries the local UTC offset of the place", because normalising
to UTC "destroys the fact that it was evening, which for a travel diary is most
of the meaning". Until the editor grew a control for it, that offset was the
entry's own or, failing that, **the editing machine's**: writing up a Japan trip
from home stamped an evening in Tokyo `+02:00`, silently, with nothing on the
form that could correct it.

It is now an answer, which is what makes it something the local copy has to
keep. A restored draft that dropped it would hand the owner back the very guess
the control exists to replace, under a banner that has just told them their
draft came back.

**Not checked against the editor's list, deliberately.** The fence is the
editor's own thirty-eight offsets and the shape check in its restore; this
module's job is to hand back what the form was holding. A schema that refused
`+05:15` — which another tool can perfectly well have written, and which the
editor is required to render rather than silently replace — would throw away the
whole payload, prose included, and losing a long entry is the exact failure §10
of `docs/decisions.md` says this store exists to prevent.

### default("") for the offset, optional() for the place text

Both keep a pre-control payload readable, so both avoid a version bump. What
separates them is whether `""` and absent are different *instructions*.

For place text they are. `""` there means REMOVE THIS, and it is the only way a
name already on a world-readable resource comes off it, so collapsing it into
"absent" would either delete a place nobody touched or make removal impossible.

**There is no "remove the offset" instruction.** §3 and §6 require
`dy:occurredAt` to carry one and refuse it without on read *and* on write, so
`""` cannot mean "the owner wants none" — it can only mean "this draft has
nothing to say about the offset, use the fallback chain". Absent and `""` are
therefore the same instruction, collapsing them is lossless rather than lossy,
and the editor's restore gets one case to handle instead of two.

**The consequence is on the editor's side and is load-bearing there:** `""` must
never be written *into* the control. It shows as a blank `<select>` — measured —
and the save after it composes a timestamp out of a wall clock and nothing,
refused on the next read, which is a worse outcome than the guess this control
replaced. `components/studio/entry-editor/state/apply-restore.ts` falls through
to the same chain a fresh form uses instead.

**Cost if this is ever wrong**, recorded so it is findable: should a later build
make an offset genuinely optional on an entry, this collapse hides the
difference and the field needs revisiting.

Measured with `safeParse` on zod 4.5.4 rather than reasoned about, because this
docblock originally recommended the operator that collapses the difference it
was trying to keep:

    `.default("")`  absent → `{}` becomes `""`;  `""` → `""`   COLLAPSED
    `.optional()`   absent → key absent;         `""` → `""`   PRESERVED

So with `.default("")` on the place fields, restoring a draft written before
those controls existed onto an entry that *has* a place name would feed `""`
into three controls and the next save would delete `schema:name` and the whole
`<#address>`. That is precisely the half-restore the version segment exists to
prevent, reached by the operator chosen to avoid a version bump.

**The `photos` precedent does not transfer**, which is what made it look safe. A
restored empty photo list is harmless because `photosFor` re-carries
`existing.photos` at save time, so the form state is not the last word. Place
text has no such carry-through: the form state *is* the answer, and an empty box
is an instruction rather than an absence of one. A bare required `z.string()` is
the other horn and is also wrong — it refuses the whole older payload, losing
the unsaved prose the key was left at `v2` to protect. `.optional()` takes
neither: the older payload restores its prose, and the editor's restore leaves a
control alone when the field is absent rather than emptying it.

### The coordinate is kept as typed

The coordinate as typed, not as it would be published, and strings for the same
reason every other field is one: this is what the form holds, and an
`<input type="number">` hands back a string.

§9's "the studio discards the precise original" is about the **Pod** — its own
first line gives the threat model, "resources are publicly readable… anyone can
fetch the raw triple". `localStorage` is not a resource, never leaves the
browser that typed into it, and is the same trust boundary as the React state
and the input element still showing the value. Discarding it here would close no
hole and would close the feature: a coordinate is the one thing on this form
nobody can retype from memory a day later, which is exactly the loss
`docs/decisions.md` §10 says autosave exists for.

Persisting the *snapped* pair instead was considered and is worse: a restored
form would show a coordinate the owner never typed, cannot refine and cannot
tell from one they did, frozen against settings that may since have changed.
Re-fuzzing it on save would be idempotent and therefore invisible.

**Empty is the common case.** A half-written entry with no coordinate yet is the
draft this feature exists for, so a schema demanding a number there would refuse
to back up the most ordinary draft there is.

### The three place fields are what §9 leans on

§9 step 2 drops the coordinate entirely inside the home radius rather than
coarsening it, and its stated mitigation is that "the entry is still written,
with its place name if it has one". These three are where that name is held
between keystrokes, so a draft that dropped them would hand the owner back a
placeless entry after exactly the crash this feature exists for.

Strings, exactly as the form holds them, and `country` is a **code** rather than
prose — `lib/pod/entry-model.ts` writes `schema:addressCountry` untagged for
that reason. Nothing here is language-tagged: a tag is a fact about the triple,
decided at save time from the entry's own language, and putting one in the draft
would freeze it against a build that changes it.

### The photo list is what the Pod already holds

The only field here that is not a string off a form control, because by the time
a photo is in this list it is not a file any more.

The editor uploads on pick and then holds a `Photo`: URLs, dimensions, a media
type and a `data:` placeholder, all of which survive `JSON.stringify`. A `File`
or a `Blob` would serialise to `{}` — it does not throw and it does not print
`[object Blob]` — so the write would report success and the restore would hand
back a photo with no URL on it. That failure is the reason the pick is the
upload, so this field is where it is caught: `Photo` requires `contentUrl` to be
a URL, and a draft that lost its bytes is refused rather than restored.

Reusing the app's own `Photo` rather than restating it, exactly as `status` and
`mode` reuse theirs, and with the same consequence: a photo hand-edited in
devtools takes the whole payload down rather than being restored into a form
that would then write it to the Pod. Losing one draft is recoverable; a mangled
`schema:contentUrl` on a public resource is not.

### savedAt became optional against this argument

Optional since 2026-09-07, at the maintainer's explicit instruction, given after
being shown that the docblock argued against it and choosing the change anyway.
Recorded rather than tidied away so the next reader knows it was a decision and
not an oversight.

**§6 still applies to a value that is present.** The change makes the *field*
optional, not the offset it carries: `z.iso.datetime({ offset: true })` is
unchanged, so a `savedAt` that exists is refused exactly as before if it lacks
one. What is new is that the field may be absent altogether.

Why absent is tolerated: the caller stamps this, the module holds no clock, and
`.optional()` — not `.default(...)`, for the reason the offset gives for the
same choice — is the only honest spelling of "no caller stamped one". Inventing
a value would be a lie about when the owner's text was kept. Such a payload
comes from a build other than this one, or a hand edit; nothing this editor
writes omits it, since `nowWithOffset()` stamps it at every write site.

What the banner does about it: `readDraft` still hands the payload back rather
than refusing it — a draft is not discarded for lacking a label on it — and the
editor omits the `<time dateTime>` element entirely when this is absent, rather
than rendering one with no instant to point at or inventing one to fill it. The
offer to restore, and the Restore and Discard buttons, are unaffected: the
timestamp is a nicety on the banner, not a condition of it.

### Validated before it is stored

`writeDraft` parses before it writes, so a draft this module would refuse to
read back is never written. Storing it instead would be silent in the worst way:
the write reports success, the banner never appears on the next visit, and the
owner believes there is a backup that cannot be restored.

`false` means the browser refused. Safari in private mode reports a zero quota
rather than declining storage outright, so the failure arrives at write time and
not at feature-detection time. The editor turns that into one quiet line saying
it is not keeping a local copy, which is something the owner can act on; an
exception out of a debounced timer is not.

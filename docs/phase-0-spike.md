# Phase 0 — spike

Seven platform assumptions the architecture depends on and that have not been verified
against a real Pod or a real deploy. Answer them before any feature work.

**Rules for this phase**

- Work on a throwaway branch. The spike's only output is knowledge.
- **Delete the code when done.** It carries every shortcut taken while exploring, and it will
  otherwise become the foundation of the app.
- Record each answer in the Results table at the bottom of this file, and update
  `docs/data-model.md` §13 to match.
- Verify by observing, not by reading a 200 response. Several of these fail silently.

---

## 1. Unauthenticated public read from the server

**Why it matters.** The entire public path assumes this. If it fails, the architecture changes
before anything else does.

**Test.** Hand-write a minimal `trip.ttl` into the Pod using the provider's own web
interface — no code. Then fetch it from a Next.js server component with plain `fetch`, no
Solid library involved. Parse it. Render one field.

**Pass.** The triple renders in server-side HTML, with `view-source` confirming it is not
client-hydrated.

**If it fails.** Check whether the resource is genuinely public and whether the Pod sets
usable CORS headers for a server-side (originless) request. If public read cannot be done
server-side, the public site must become client-rendered, which loses SEO and OG images.

---

## 2. Browser login and authenticated write

**Test.** Solid-OIDC login from the browser, write one triple, read it back. Include the
static client ID document in this test — serve `client-id.jsonld` from the app origin rather
than relying on dynamic client registration.

**Pass.** The consent screen shows the app's real name, the write succeeds, and the session
survives a page reload.

**Record.** Whether session restoration works after reload without a redirect round-trip, and
what the redirect handling requires in the App Router.

---

## 3. Per-resource ACL that differs from its container default

**Why it matters.** This is load-bearing. Decision 4 in `docs/decisions.md` — no drafts
container — depends entirely on it.

**Test.** Inside a public-read container, set one resource to owner-only. Then, from a
logged-out context (a private window or `curl` with no credentials), attempt to read it.

**Pass.** The logged-out fetch returns 401 or 404. **A 200 write response proves nothing** —
the only evidence that counts is the failed read.

**If it fails.** Drafts need a separate private container after all, and the publish flow
becomes a container move with IRI rewriting. Reopen decision 4 and update the data model
before writing any studio code.

**Also record.** Which mechanism the server uses — Web Access Control with `.acl` resources,
or Access Control Policies — and confirm the four-method interface in `docs/data-model.md` §5
covers it.

---

## 4. Writing to the profile-linked type index

**Test.** Read the WebID profile, follow `solid:publicTypeIndex`, and append a
`solid:TypeRegistration` for `dy:Trip` to that document.

**Pass.** The registration persists and other registrations in the document are untouched.

**If it fails.** The Pod container root becomes configuration rather than discovery. A small
change, but it touches the setup flow and the README.

---

## 5. Preconditions and binaries

**Test.** Upload a JPEG. Then, on both the JPEG and an RDF resource:

- create with `If-None-Match: *` and confirm a second attempt fails
- update with a valid `If-Match` and confirm it succeeds
- update with a **stale** `If-Match` and confirm it is rejected

**Pass.** All three behave as specified. The stale-ETag case is the one that matters.

**If it fails.** Concurrent-write protection is unavailable and §10 of the data model needs
rethinking. Note it prominently — it changes what "safe to edit from two devices" means.

---

## 6. Container enumeration at scale

**Test.** Create around 200 small resources in one container and enumerate via `ldp:contains`.
Time it.

**Pass.** Usable response time for `rebuildIndex`, which is the only operation that needs it.

**Record.** Whether the server paginates, and at what point enumeration becomes slow.

---

## 7. OG image generation on the deploy target

**Why it matters.** The only novel runtime path in the stack. Every share image depends on it.

**Test.** Generate one `next/og` image containing an embedded SVG polyline, on a Netlify
deploy preview — not locally. Local success does not predict the serverless runtime.

**Pass.** The image renders on the preview URL with the route line visible.

**If it fails.** Fall back to composing over a trip photo, or pre-generate images at publish
time and store them in the Pod.

---

## Also worth noting while you are in there

**Storage quota.** Whatever the provider states, and what happens on exceeding it. This
decides whether original-resolution photos are uploaded at all
(`docs/data-model.md` §9).

**Response times.** Rough latency for a single resource fetch, since it sets the floor for
page render.

---

## Results

Answered 2026-09-02 against **two servers**: local Community Solid Server 7.2.0 (WAC) and a
hosted **Inrupt PodSpaces** Pod (ESS, ACP). Six of seven questions have a verdict on at least
one server. Question 7 was not attempted.

| # | Question | CSS 7.2.0 (WAC) | Inrupt ESS (ACP) |
|---|---|---|---|
| 1 | Unauthenticated server-side read | **PASS** | **PASS** |
| 2 | Browser login and write | **PASS** | **PARTIAL** — see below |
| 3 | Per-resource ACL override | **PASS** | **PASS** |
| 4 | Type index write | **PASS, not as §7.5 describes** | **FAIL as specified** |
| 5 | Preconditions, RDF and binary | **PASS** | **PASS** (RDF; binary not retested) |
| 6 | Container enumeration at ~200 | **PASS** | **not run** |
| 7 | `next/og` on Netlify preview | **UNVERIFIED** | **UNVERIFIED** |

**Pods tested:** Community Solid Server 7.2.0 (`@css:config/file.json`, local, Node 20.20.0);
Inrupt PodSpaces (Developer Preview), storage on `storage.inrupt.com`, identity on
`id.inrupt.com`, OIDC issuer `https://login.inrupt.com`.
**Access control mechanisms:** CSS = **WAC** (sibling `.acl` resources). ESS = **ACP**
(see the detection trap below).
**Date:** 2026-09-02

### Decision 4 is now cleared on both mechanisms

Question 3 passed on WAC *and* ACP. On ESS, inside a container granted public read, a
resource left owner-only produced:

```
ANON GET draft      -> 401   denied
ANON GET published  -> 200   still readable
OWNER GET draft     -> 200   owner retains access
```

The 401 body is `application/problem+json` echoing only the request path; **none of the
resource content appears in it.** (An earlier run of this spike reported a leak here — that was
a faulty test asserting `body.includes("draft")`, which matched the URL in the error envelope,
not content. Corrected.)

Access was granted through `universalAccess.setPublicAccess` from `@inrupt/solid-client`, which
is exactly the §5 "abstract the mechanism" design. It worked unchanged against both servers.
That is the strongest evidence so far that the four-method interface in §5 is viable.

### The mechanism-detection trap

**`rel="acl"` does not mean WAC.** ESS advertises

```
link: <https://authorization.inrupt.com/{id}>; rel="acl"
```

on every resource — a separate authorization *host*, not a sibling `.acl` document. Fetching
that resource authenticated returns `text/turtle` containing **both** `acp#` and
`auth/acl#` vocabularies, because ACP policies reuse `acl:Read` / `acl:Write` as mode IRIs.

So sniffing the link relation — the obvious implementation — reports "WAC" for an ACP server.
Any code that branches on mechanism must fetch the control resource and inspect its vocabulary,
or better, not branch at all and go through `universalAccess`.

### Question 1 holds on ESS, but the first response looks alarming

An unauthenticated request to a non-public ESS resource returns

```
HTTP/2 401
www-authenticate: UMA as_uri="https://uma.inrupt.com", ticket="…", Bearer, DPoP
```

ESS fronts authorization with **UMA**, which at first glance threatens architecture invariant 3
(the public path uses plain `fetch` with no Solid library). It does not. Once a resource is
genuinely public, a bare `curl` — no library, no token, no UMA negotiation — returns **200**
and the triples. UMA is the challenge for *protected* resources only.

Also worth knowing: ESS returns **401, not 404, for resources that do not exist** when the
caller is anonymous, so an anonymous 401 cannot distinguish "private" from "absent".

### Question 4 fails on ESS as written

§7.5 says registrations are appended to the profile-linked type index. On ESS:

- The WebID profile at `https://id.inrupt.com/zpr` **is not a Pod resource** — it is served by
  the identity provider, and `PATCH` returns **405 Method Not Allowed**. It cannot be modified
  to add `solid:publicTypeIndex`.
- It declares no `solid:publicTypeIndex` (same as CSS), but unlike CSS there is no way for the
  app to add one to that document.
- The writable profile is `{POD}extendedProfile`, linked from the WebID by `rdfs:seeAlso` and
  `foaf:isPrimaryTopicOf`. The WebID also carries `pim:storage` pointing at the Pod root, which
  is how the app should discover storage.

So on ESS, type-index discovery has to hang off `extendedProfile`, and §7.5 needs rewriting to
follow `rdfs:seeAlso` rather than assuming a writable WebID document. This is the "container
root becomes configuration rather than discovery" fallback the question anticipated, and it is
now the actual situation on a hosted provider.

### Question 2 is only partly answerable from localhost

Login, consent and authenticated writes all work against ESS. Two things could not be tested,
for the same underlying reason:

**A static `client-id.jsonld` must be fetchable by the identity provider, and `localhost:3002`
is not reachable from the internet.** Every login therefore fell back to **dynamic client
registration**, which registers a *new* client each time. Consequences observed:

- The consent screen showed a bare UUID (`017ab2fa-…`) instead of the application name. The
  "consent screen shows the app's real name" criterion passed on CSS with a static client ID
  and **cannot be reproduced on a hosted provider from localhost**.
- `restorePreviousSession: true` **did not restore the session** across a page reload on ESS,
  where it did on CSS. The most likely cause is that the restored session refers to a client id
  that no longer matches after re-registration. Not isolated — treat as "unexplained on ESS,
  worked on CSS", not as a property of ESS.

The practical consequence for phase 2: the real login flow cannot be validated locally against a
hosted Pod. It needs a deployed origin serving `client-id.jsonld`. Budget for that before
building the studio, not after.

### The draft-listing leak, on both servers

Confirmed again on ESS: with the container publicly readable, an anonymous
`GET` of the container returns **200** and an `ldp:contains` list naming `draft.ttl`. Draft
*content* is protected on both servers; draft *existence and slug* are not. §4's
"structurally impossible" wording remains too strong.

**The mitigation is verified on WAC only.** On CSS, granting the public `acl:default` without
`acl:accessTo` closes the listing while keeping children readable:

```
ANON GET entries/          -> 401   listing closed
ANON GET published entry   -> 200   still readable
ANON GET draft entry       -> 401   still denied
OWNER GET entries/         -> 200   studio can still enumerate
```

ACP has no `accessTo`/`default` split of this shape, so **the equivalent fix on ESS is
untested**. Until it is, assume draft slugs are visible to anyone who enumerates the container
on a hosted Pod.

### Preconditions

Identical verdicts on both servers — create with `If-None-Match: *` rejected on repeat (412),
valid `If-Match` accepted, **stale `If-Match` rejected (412)**. §10's write protocol is sound on
both. Note the ETag *shapes* differ: CSS returns `"<ms-timestamp>-<content-type>"`, ESS returns
what looks like a content hash. Never parse an ETag; treat it as opaque.

Binary-resource preconditions were verified on CSS only; not retested on ESS.

### What the App Router requires for the redirect (question 2)

- `handleIncomingRedirect` must run in a client component. Under React 19 StrictMode the effect
  is invoked twice, and the **first invocation returned `isLoggedIn: false`** while the second
  returned `true`. Code that acts on the first result concludes the user is signed out.
- On CSS, `restorePreviousSession: true` issued `/.oidc/auth?…&prompt=none` — a silent
  re-authentication round-trip, not a local restore. It therefore depends on the Pod being
  reachable and on redirect/cookie behaviour, which is what Safari ITP interferes with. On ESS
  with dynamic registration it did not restore at all.

### Also worth noting

- **Latency.** CSS on localhost: median 3 ms per resource (no-network floor only). ESS was not
  benchmarked; question 6 was not run against it, so `rebuildIndex` cost on a hosted Pod
  remains unmeasured — and it is the number that actually matters, since 200 sequential reads
  over real RTT dominate everything measured locally.
- **Storage quota.** Still unmeasured. PodSpaces is Developer Preview and explicitly not for
  production or personal data, so its quota would not be representative anyway. §9's originals
  question stays open.
- **Node version.** `@inrupt/solid-client-authn-core@5.0.0` declares `^22.0.0 || ^24.0.0` and
  `@inrupt/solid-client@3.0.0` declares `^20.0.0 || ^22.0.0`; within 22.x, `jsdom@30.0.1`
  (`^22.22.2`) sets the floor. Both `docs/versions.md` and `TODO.md` have been corrected to
  Node 22.23.2.
- **`create-next-app@16.3.4` installed TypeScript 5.9.3**, not 7.x. Already inside
  `typescript-eslint@8.69.0`'s `>=4.8.4 <6.1.0`. `TODO.md` has been corrected; the pin to 6.0.3
  survives as a deliberate move up rather than a rescue.
- **`n3@2.7.2` parsing trap.** `parser.parse(str, callback)` did not populate results
  synchronously and silently yielded zero quads, producing a wrong measurement before it was
  caught. Use the array-returning `parser.parse(str)`, and always pass `baseIRI` — container
  listings use relative IRIs.
- **Verified as documented:** bundled Next docs exist (452 markdown files under
  `node_modules/next/dist/docs/`); `.next/dev/lock` carries pid/port/appUrl;
  `logging.browserToTerminal` forwards browser console output; `--no-agents-md` suppresses the
  generated agent files, and the first `next dev` then created `AGENTS.md` with the managed
  block plus a `CLAUDE.md` containing exactly `@AGENTS.md`, matching decision 16.

### Cleanup

All hosted testing was confined to `{POD}wig-spike-DELETEME/`. It and its three resources were
deleted (204 each); an authenticated re-read returned 404. Nothing else on the Pod was touched.

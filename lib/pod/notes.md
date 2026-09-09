# lib/pod — notes

Prose that outgrew a docblock, and findings recorded rather than acted on.
Section numbers are `docs/data-model.md`; decision numbers are
`docs/decisions.md`. Both stay the normative sources.

## An unreadable ACL looks exactly like no ACL

`resolveContainerAcl`'s three answers come from `hasResourceAcl` and
`hasFallbackAcl`, and the first of those cannot distinguish "this container has
no ACL of its own" from "its ACL could not be fetched just now".
`internal_fetchResourceAcl` in `@inrupt/solid-client` 3.0.0
(`dist/acl/acl.internal.mjs`) catches everything that is not an `AclIsAcrError`
and returns `null`, with its own comment giving the reason: a Solid server sends
a `rel="acl"` link whether or not the document behind it exists, so a failed
fetch is the ordinary case. A 403 or a 500 on `{container}.acl` therefore
arrives here as `resourceAcl: null` — indistinguishable from absence.

**What that costs is a diagnosis, not a write.** The branch that follows takes
the ancestor's rules and a `create: true` precondition, so the PUT goes out as
`If-None-Match: *` and the server answers 412 against the ACL that is really
there. Nothing is overwritten: §10's precondition is doing exactly the job it
exists for, and this is a good illustration of why a blind PUT is banned even
where the code "knows" the resource is absent. But the report a deployer reads
is `http 412` about the container, which describes a race rather than the
transient failure that actually happened, and a retry may well succeed.

Left alone deliberately, on 2026-09-08, during a refactor whose rule is that
behaviour does not change. Fixing it means distinguishing the two cases before
choosing a precondition — a HEAD of the control document, or catching the 412
and re-reading — and either is a behaviour change with its own test.

## Why the container path is not a mechanism branch

Recorded here because the split of `setContainerAccess` into three steps invites
the question a fourth time. Decision 19 is settled: **access control goes
through one interface and never branches on mechanism.** The steps divide the
write sequence — which ACL to edit and under which precondition, what the rules
are, and the PUT — and the only branch in the module is on the resource kind,
document versus container, which is a property of LDP rather than of a server.

The trap that makes it a decision rather than a preference: ESS advertises
`Link: <https://authorization.inrupt.com/{id}>; rel="acl"`, a separate
authorization host and not a sibling `.acl`, and that resource carries both
`acp#` and `auth/acl#` vocabulary because ACP reuses `acl:` mode IRIs. Sniffing
the link relation reports "WAC" for an ACP server. `hasAccessibleAcl` is that
sniff — it is `typeof aclUrl === "string"` — which is why it appears in
`resolveContainerAcl` only as the type guard the library needs for `aclUrl` to
be a string, and never as evidence on its own.

## A 2xx write proves the write, not the access rule

`accessUnverified` is a `PodError` kind of its own and deliberately distinct
from `http`: the request may well have returned 2xx. "A 200 write response
proves nothing — the only evidence that counts is the failed read"
(`docs/phase-0-spike.md`, question 3), so `lib/pod/access.ts` reads the
resulting access back and reports this when what came back is not what it asked
for, or when the server says nothing it can act on.

It is also the honest answer to "is this public?" when access could not be
determined. Collapsing that into `read: false` tells the owner their entry is
private on no evidence at all, and the owner acts on what is shown.

## One set of literal formatters

§6 fixes the datatypes: `xsd:date`, `xsd:dateTime` with a UTC offset,
`xsd:decimal` for coordinates and never float, `xsd:integer` for counts and
distances, and a language tag on every human-readable literal.

`lib/pod/literals.ts` is the only implementation of them on purpose. A second
copy of those four lines in a second serialiser is how one of them ends up
writing `1e-7` while the other does not — `index-model.ts` and `entry-model.ts`
both write coordinates, and they must write them identically.

`text()` falls back to the deployment's default language rather than to no tag
at all, because an untagged literal is a *different* RDF term from a tagged one:
writing one now means the value can never be matched against a tagged one later.

## Why the cache tags are not in cached.ts, where they used to live

`cached.ts` imports `next/cache` and carries `"use cache"` functions, both of
which are server-only. `saveEntry` runs in the **browser** — writes go browser →
Pod directly (invariant 4) — and step 4 of §10 hands these tags to a
revalidation hook that posts them to a route handler.

Importing `cached.ts` to reach the tag strings would drag `next/cache` into the
studio bundle. Hardcoding `trip:${slug}` in the writer instead would let the two
spellings drift, and a revalidation tag that does not match the tag the read was
stamped with fails silently — the public site simply keeps serving the old page.

`cached.ts` re-exports `TAGS`, so `import { TAGS } from "@/lib/pod/cached"` keeps
working and there is still one definition. The tags are kept coarse on purpose:
the Pod cannot tell us what changed, so precision here would be a guess.
`ownerProfile` is flat, with nothing to parameterise by — there is one owner, and
the issuer changes approximately never. `trip:` and `entry:` own their prefixes,
so a tag carrying neither cannot be produced by any slug.

## rebuildIndex is the recovery path, and it is deliberately tolerant

Built in phase 1 rather than when first needed, because it is the recovery path
for every partial-write failure in §10: an entry that exists but is unlisted is
invisible rather than corrupt, and this is what makes it visible again. It is
also the migration tool when `dy:schemaVersion` increments.

One malformed entry is skipped and reported, never fatal. A single bad resource
must not make the whole trip unrecoverable.

## Why the read layer is cached rather than streamed

`docs/decisions.md` §22: Cache Components is on, so uncached data access outside
a Suspense boundary blocks prerendering — and every public page reads from the
Pod, so this is the main render path rather than an edge case.

The choice is `use cache` plus `cacheTag`, invalidated by the studio's
revalidation hook calling `revalidateTag` after each save. The alternative,
Suspense around every Pod read, streams instead of caching and puts a Pod round
trip on every view, giving up the edge-cached public site the whole architecture
is arranged around.

`getOwnerProfile` is cached for that reason rather than because the studio needs
it fast: `/studio` prerenders as `○ (Static)`, and a bare `readOwnerProfile` in
the page is an uncached data access outside a Suspense boundary, which silently
demotes it. Only the route table would show that.

## One deliberate exception to "a typed value or a structured error, never a throw"

The getters `lib/pod/cached.ts` reads — `config.podRoot`, `config.ownerWebId` —
throw when their env var is unset, so a misconfigured deployment makes these
functions reject rather than return a `PodError`.

That is intended, not an oversight to tidy away. A missing `POD_ROOT` is a
deployment fault rather than a runtime condition to render a fallback for, and
`lib/config.ts` says as much in the error itself: "the site reads its content
from a Solid Pod and cannot start without knowing which one". With Cache
Components on these run at build time, so the throw fails the **build**, which
is where a missing env var should fail. Catching it would instead produce a site
that deploys green and serves an error fallback on every page.

So: structured errors are for what the Pod does — 404, a bad shape, an
unreachable host. A throw there means the deployment is wrong.

`allTripSlugs` throws for a second, unrelated reason, and is for
`generateStaticParams` only. That function must return at least one param — an
empty array raises `empty-generate-static-params` — and `dynamicParams` is
unsupported, so a deployer whose Pod has no trips yet would get a failed build
rather than an empty site, which is a terrible first run for "fork it and
deploy". It fails loudly, with the fix in the message, rather than shipping a
placeholder trip that would appear on a real site.

`publishedTripSlugs` is the render-path twin and returns a `Result`, because
`result.ts` opens with "a thrown exception is not a structured error … failures
are values, not control flow" and `proxy.ts` deliberately fails open on exactly
this condition: a Pod that is briefly unreachable must render the same fallback
the home page already has, not a 500 from an error boundary.

Entries are knowable at build time because the index exists precisely to list
them (§7.4), so `allEntryParams` needs no container enumeration and no
authentication. An entry published after the build is served the App Shell and
upgraded in the background by `partialPrefetching`, so publishing never needs a
redeploy.

## privacy.ttl is not the type index, and its URL is normalised

`privacySettingsUrl` is **not** `{storage}settings/publicTypeIndex.ttl`. Same
segment name, different container, opposite access requirement: the type index
lives at the Pod root and must be publicly readable (§7.5), this one lives under
`travel/` and must never be. Revision 2 of the data model already moved the type
index out of `/travel/settings/` once, and §4 says do not merge them.

**This one normalises the root and the others in the file do not, deliberately.**
`new URL("travel/…", "https://host/pod")` — a root with no trailing slash —
resolves against the *parent* of `pod`, so on a multi-pod server (CSS hosts
every account under one origin) it addresses a stranger's storage. For
`diaryUrl` that is a 404. For this resource it is a read of, and eventually a
write to, someone else's home coordinates. `config.podRoot` appends the slash so
nothing in the app reaches here without one; this is the belt to that pair of
braces, at the one URL where being wrong is not merely a missing page.

## One request returns the index and its ETag

§10 step 3 is "read `entries.ttl`, insert the index entry, recompute … write
back with `If-Match`", and the ETag that makes that safe is the one from the
read that produced the state being edited.

Splitting it into a HEAD for the ETag and a GET for the body opens a window in
which the two disagree: HEAD first and the write fails with 412 for no reason,
GET first and a concurrent change is silently overwritten by a precondition that
has already been satisfied. So one request returns both. `readTripIndex` is that
function with the ETag dropped rather than a second copy of the extraction —
there is one parser for this resource.

## readPrivacySettings against readOwnerProfile: five differences, all deliberate

Each is something a later "make these consistent" pass would get exactly
backwards. Each is pinned by a case in `lib/pod/read.privacy-settings.test.ts`.

1. **The subject is `<#it>`.** `readOwnerProfile` uses the whole WebID, fragment
   included, because a WebID *is* a fragment IRI naming a person and the
   fragment is not ours to choose. `privacy.ttl` is our own resource, so §6
   applies unchanged: every subject is a fragment, never a bare document URL,
   never a blank node.
2. **`dy:schemaVersion` is checked.** `readOwnerProfile` deliberately skips it —
   the WebID document is not ours and will never carry our version. This
   resource is ours, so §11 applies in full, and it matters more here than
   elsewhere: a settings document written by a later version of this app could
   mean something different by the same four predicates, and acting on a misread
   home radius is not a rendering glitch.
3. **Datatypes are enforced** — `xsd:decimal` for the coordinate pair, never
   float, and `xsd:integer` for the two distances (§6). `readOwnerProfile` reads
   only IRIs and enforces nothing. Without this a `"3000"^^xsd:string` radius
   reads back as the number 3000 with nothing complaining.
4. **It needs an authenticated fetch.** `readOwnerProfile` is unauthenticated by
   design; this resource is owner-only, so a caller without a session gets 401 —
   and on ESS an anonymous 401 does not even distinguish private from missing
   (§13). Both arrive as a structured `http` error, which is the right answer
   either way.
5. **There are no defaults, anywhere.** This is §9's fail-closed contract, and
   it is the whole reason the function exists rather than a config lookup.
   Absent, unreadable, wrong version, half-written home region — all of them are
   errors, and every caller publishes *no* coordinate on any error. An absent
   `dy:homeRadiusMeters` read as zero is a home region of no area, i.e. no
   protection, reported as success.

**No `rdf:type` gate**, which it shares with `readOwnerProfile` but for a
different reason. There is no class for this resource: §3's four privacy terms
are the four that were agreed with the owner, and a class would be a fifth
(CLAUDE.md, "ask before doing"). §7.6 records that, and records that adding one
later is purely additive. `dy:schemaVersion` plus the shape is the gate — which
is what it would have to be regardless, since a type triple never protected
against a document that parses and means something else.

**All three home fields or none**, and that is decided in the function rather
than in the schema, because Zod cannot tell "absent" from "absent" once the
object has been built. None of them present is a legitimate setting — "I have no
home to protect" — and fuzzing still applies to every coordinate; it just never
drops one. *Any* of them present commits to a home region, so a missing sibling
is a shape error naming the field rather than a silent downgrade to no
protection at all.

**On the common case, which is an error.** A Pod that has never had a
`privacy.ttl` returns 404, and `initialiseContainers()` creates the container but
deliberately writes no document into it (§5). So every fresh deployment fails
this read until the owner sets a home region, and §9 makes that mean "no
coordinates are published". That is intended. It is also something the studio has
to *say*: an entry silently losing its map pin becomes a bug report, whereas "you
have not set a home region yet" is a one-time setup step with an obvious fix.

## readOwnerProfile: three things unlike every other read here

The studio's server component calls it to discover `solid:oidcIssuer` and hand
it to the client shell, because `session.login()` takes `oidcIssuer` as a
mandatory option and there is deliberately no `OIDC_ISSUER` env var: the WebID
document is the one place that reliably carries it.

Each of the three looks like an omission, each is load-bearing, and each is
pinned by a case in `lib/pod/read.owner-profile.test.ts`. Do not tidy them away.

1. The subject is the **whole WebID**, fragment included — `viewOf(quads, webId)`
   rather than `itOf(url)`. A WebID is a fragment IRI: the document fetched is
   the WebID with its fragment stripped, and the subject described inside it is
   the WebID in full. The fragment is not always `#me` (CSS and ESS both allow
   any), and it is never our `#it` convention — a profile may well carry an
   unrelated `<#it>` subject, and reading that hands `login()` the wrong identity
   provider.
2. **No `dy:schemaVersion` check**, though CLAUDE.md requires one on every
   top-level read. That rule is about *our* resources. The WebID document is not
   ours — on ESS the identity provider serves it and answers `PATCH` with 405 —
   so it will never carry our version, and a version gate here would reject every
   real Pod. A profile declaring a version we would otherwise refuse is still
   read straight past.
3. **No `rdf:type` gate.** §7.5 types the subject `foaf:Agent`, but nothing here
   depends on it and plenty of real profiles omit it. What matters is the issuer,
   and its absence is caught by the schema.

## The blur budget is restated in the schema rather than imported

`BLUR_BUDGET_BYTES` in `lib/media/targets.ts` is the source of the §6.4 number
and the two must stay in step. It is not imported into `lib/pod/schema.ts`
because that module is studio-only and fenced from `app/(public)` by
`no-restricted-imports`, while the schema is read by public pages: an import
would pull the media graph into the public bundle to fetch one integer, undoing
the fence rather than respecting it. A duplicated constant with a comment is the
cheaper mistake.

## Over budget discards the placeholder; it does not reject the photo

The §6.4 budget is checked on **read** as well as on write. `withinBlurBudget`
runs in the worker, which only ever governs what *this* app writes, and the
literal rides inside the entry's Turtle, which is world-readable and fetched on
every public page view, multiplied by photo count. So the side that matters most
is the one where an oversized value *arrives*: an older version of this app,
another tool, or a foreign writer — §11's premise for validating at all.

**That asymmetry is the entire point of the field, and it was learned the hard
way.** For one day this was a `.max()` and a `.refine()`, both fatal. A single
over-budget literal from a foreign writer then failed `Photo`, which failed
`Entry`, which made `readEntry` return `shape` — so the public entry page lost
its headline, body, place and every photo, and the next `rebuildIndex` dropped
the entry from the trip index because it could not read it. A guard that turns a
cosmetic problem into a missing page is worse than the problem it guards
against. §3 says the budget "drops it", and dropping is what this does: the
entry renders with no placeholder and everything else intact.

**Bytes, not characters**, hence the `TextEncoder`: the budget is a wire size. A
`.max()` would not be a cheaper spelling of the same check. Measured against the
installed zod 4.5.4 rather than recalled — `z.string().max(n)` counts *code
points*, not UTF-16 units, so `"\u{1F600}".repeat(3)` has `.length` 6 and passes
`.max(3)`, and 1200 characters of four-byte codepoints is 4800 bytes sailing
under a character bound of 1200. `test/guardrails.test.ts` straddles the
boundary in ASCII and in multi-byte codepoints for that reason.

`serialiseEntry` validates with the same schema on the way *out*, so an
over-budget placeholder is dropped there too rather than failing the save —
still "drops it", and still meaning the Pod never receives one. Nothing this app
produces reaches that path anyway: the worker's `withinBlurBudget` omits the
placeholder before it is ever a `Photo`.

## created and datePublished are not redundant

§7.3 says so in as many words: "created is when the record came into being and
datePublished is when it became public. They differ by however long the draft
sat."

Both were missing from `Entry` until 2026-09-04, so `readEntry` dropped them and
the first read-modify-write in the studio would have destroyed both, permanently
and silently. `readTrip` has always read `created`, so it was an inconsistency
rather than a policy.

Both are optional, for the reason every other optional field here is: a Pod
contains whatever was written to it, including data from an older version of
this app. Requiring `created` would make every entry written before that change
unreadable — including by `rebuildIndex`, which is the one tool that could
repair them — and nothing rendered depends on either value. `saveEntry` sets
`created` on a create and carries it forward on an update, so entries this app
writes always have one.

## PrivacySettings is the one strict schema, and fails closed

Every other schema in `lib/pod/schema.ts` is lenient about optional fields and
strict about the ones the pages depend on, because a Pod contains whatever was
written to it and refusing to render an otherwise valid entry helps nobody. The
trade is the other way round for this resource: nothing renders from it, and
what depends on it is whether a coordinate reaches a world-readable document.

§9 says the read fails closed — "no readable settings means no coordinate is
published at all" — and a fail-closed contract is only worth as much as this
schema's refusal to fill anything in. Two consequences, both load-bearing:

- `defaultPrecisionMeters` is **required**. A default here would be a distance
  this project picked for someone else's front door.
- `home` is all three values or none. A `.optional()` on any one of them turns a
  half-written document into "no home region", which publishes coordinates from
  the owner's doorstep while returning `ok` — the exact failure §7.6 spells out.

`.positive()` on both distances for the same reason: a radius of 0 m is a circle
of no area, indistinguishable in effect from the absent value, and a grid of 0 m
snaps a coordinate to itself while announcing `dy:precisionMeters 0`, i.e. "this
point is exact". That is also the sentence
`lib/studio/place/notes.md#no-exact-option-and-what-it-would-take` has to
overturn if an exact option is ever wanted.

## OwnerProfile validates a document that is not ours

Read unauthenticated so the studio can discover *where to log in* before any
session exists (§7.5). Deliberately unlike every other schema here: on ESS the
identity provider serves this document and answers `PATCH` with 405, so it
carries no `dy:` terms and none of §6's house rules apply to it. Validate what
we depend on and tolerate the rest.

The issuer is required. `session.login()` takes `oidcIssuer` as a mandatory
option and there is deliberately no `OIDC_ISSUER` env var, so an absent issuer
is a failed read rather than an `undefined` discovered at redirect time.

## The serialisers are pure, and they do not fuzz

`entry-model.ts` and `index-model.ts` do no fetching, no writing and hold no
clock. `saveEntry` stamps the timestamps and hands the result in, which keeps
each serialiser a total mapping from a value to a Turtle document and makes the
round-trip test — serialise, read back with the real reader, compare the whole
object — worth what it looks like it is worth.

Byte-level formatting is not normative (§11): compare these graphs by triple
set, because Turtle has no canonical form and a byte assertion would be
permanently red on the next n3 release.

**What `entry-model.ts` deliberately does not do is fuzz coordinates.** §9
requires fuzzing *before* the write — "the Pod stores only the coordinate you
are willing to publish" — and that happens in `lib/pod/fuzz.ts`, called by the
editor before the `Entry` reaches the serialiser. Whatever coordinate the
serialiser is handed is the coordinate that reaches the Pod, unrounded and
unshifted, so fuzzing is unambiguously the caller's job and no test here can be
misread as evidence that a coordinate was fuzzed. A serialiser that quietly
rounded would also make `dy:precisionMeters` a lie in the other direction,
describing a precision the value no longer has.

That paragraph read "it is phase 3 work that does not exist yet" until
2026-09-06, having outlived commit `fc9fcc5`, which landed the module. A comment
arguing for a state that no longer holds is worse than no comment: the next
reader concludes nothing fuzzes, and either duplicates it in the serialiser —
the double-fuzz the paragraph exists to prevent — or ships the raw coordinate on
the assumption that someone downstream will handle it.

`index-model.ts` is the part that has to be exactly right, because
`rebuildIndex` is three things at once: the recovery path when a multi-step
write half-failed, the migration tool when `dy:schemaVersion` increments, and
how a new deployer imports data written by an older version of the app (§10).

## documentUrlOf is a string operation on purpose

`<doc.ttl#it>` → `<doc.ttl>` by regex rather than `new URL(iri)`. This is the
URL that gets PUT and that appears in every error report, so it must be exactly
what the caller named rather than a normalised variant of it — and it must not
throw on a value that turns out not to be a URL at all. The schema check that
follows is what rejects that case, with a structured error.

## Which photo literals are plain, and which are tagged

`schema:encodingFormat` is a code rather than prose, so it is plain, like the
slug and the country code. §7.3 spells it `"image/webp"` with no tag, and a
tagged literal would be a different RDF term from the one the fixture shows. It
is written from the type the encoded blob *actually* has and never from the type
that was requested, because `convertToBlob` answers an unsupported request with
PNG rather than an error — that is the uploader's job, and the serialiser writes
whatever it is handed.

`dy:blurDataUrl` is also plain and deliberately **not** language-tagged. §6 asks
for a language tag on human-readable literals; base64 is not human-readable in
any language, and tagging it would assert that it is prose in some tongue.

`dy:originalUrl` is deliberately never written: phase 3 decided against
uploading originals, and §3 records the term as reserved rather than live. If a
fourth photo predicate is ever added and left unwritten, say so here —
`lib/pod/entry-model.test.ts` asserts that *nothing* in §7.3 is missing, so a
silent omission turns the suite red rather than vanishing.

## The locality carries the entry's own language

Not the deployment's. Every write happens in the browser (invariant 4), where
`config.defaultLanguage` is always `SITE_LANGUAGE`'s fallback because
`SITE_LANGUAGE` is not `NEXT_PUBLIC_`. It is passed through `text()` rather than
spelled as a bare `literal()`, so an entry with no language of its own still
falls back to the deployment default instead of publishing an untagged literal —
the same fallback `placeQuads`' `schema:name` relies on.

## fragment and sortOrder are recomputed, never carried

Both are derived from the whole row set every time, which is what stops an
incremental update from leaving `dy:sortOrder` describing an order the set no
longer has. That is why `IndexRowInput` omits them.

`computeIndexFromRows` is the single implementation of "what the derived values
are" — ordering, numbering, count, bbox, centre. `computeIndex` is that function
fed from entries; `saveEntry` feeds it the surviving rows plus the one it is
inserting. Both go through it, and that is the difference between recomputing
the derived values and incrementing them.

`rowOfIndexEntry` reads a row already in the index back as an input, through the
validated `IndexEntry` model rather than out of the raw triples, which is what
§11 guardrail 2 asks for: a row this version cannot understand fails the read
loudly instead of being dropped on the next save. `rowOfEntry` applies no status
check, because the caller decides what reaches the index — `saveEntry` also has
to *remove* a row.

## Only published entries reach the index, and what that does not cover

This is what makes the publication boundary hold: the public site reads the
index and therefore cannot leak a draft title, even by accident, because the
data is not there (§4).

Note the narrower guarantee phase 0 established — draft *slugs* can still be
enumerated from a publicly readable container. That is a container-ACL problem
rather than an index problem, and `initialiseContainers` owns it.

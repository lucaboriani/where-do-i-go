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

## fuzz.ts is the last place a precise coordinate exists

§9: "The Pod stores only the coordinate you are willing to publish. The studio
applies fuzzing before the write and discards the precise original.
`dy:precisionMeters` then honestly describes what was stored."

Every entry resource is world-readable (`docs/decisions.md` §5), so there is no
render-time mitigation behind this module and no second chance after the PUT:
what these functions return is what a stranger can `curl`.

Pure — no fetch, no clock, no randomness. The settings arrive as a value
`readPrivacySettings` produced (§7.6), and determinism is a privacy property
here rather than a testing convenience: a jitter redrawn per write lets an
observer average several publications of one place back to the true point.

**Studio-only by intent.** Nothing in `app/(public)` has a reason to fuzz — the
public path reads what was already fuzzed. It is deliberately *not* in the
`no-restricted-imports` group with `write.ts` and `access.ts`, because it holds
no credentials and imports no auth library, so an accidental public import would
be a pointless dependency rather than a leak.

`DropReason`'s four values are all fail-closed outcomes: §9 says nothing is
published unless everything checks out.

## The snapped coordinate is a pair of strings

Strings, not numbers, and that is the datatype rule rather than a style choice.
A naive float snap yields `35.010000000000005`: `xsd:decimal` has no exponent
form and no business carrying 15 digits, and those digits are a precision leak
dressed as a rounding artefact.

Returning numbers would hand the decision to whichever serialiser is
downstream. Returning strings makes it this module's problem, which is where it
belongs.

`dy:precisionMeters` is `xsd:integer` and `GeoPoint` already says
`.int().positive()`, so a fractional grid is refused rather than rounded on the
owner's behalf: it could not be written back honestly.

## The two grid steps, and why each divides its circle

**Latitude.** 180° divided into a whole number of cells, and an *even* one so
that ±90 are grid points rather than something just past them. Measured, not
assumed: with an arbitrary step of `precisionMeters / M_PER_DEG_LAT`, a 50 m
grid puts `round(90 / step) * step` at 90.000055, `Math.abs(lat) <= 90` fails,
and the published latitude is not a latitude. Forcing `n` even makes 90 exactly
`(n / 2) * step`, so the pole is a cell centre and the arithmetic never leaves
the sphere. `Math.max(1, …)` keeps a step of at most 90° for an absurdly coarse
precision. It is a pure function of `precisionMeters`, because a degree of
latitude is the same length everywhere; only longitude varies.

**Longitude.** A cell must be `precisionMeters` across in *metres* —
`dy:precisionMeters` is written alongside the coordinate and read as a claim
about metres, so a fixed-degree grid would make that triple a lie at every
latitude but one, 0.34× the claimed width at 70°N. Hence the `cos φ`.

It must *also* divide 360°, which scaling by `cos φ` alone does not give you.
Measured: with an arbitrary step, `snapToPrecision(12, -180, 20000)` returns
179.95, and re-snapping that returns 179.87 — the grid has a seam at the
antimeridian, so it is not a grid, and the "snap twice, get the same answer"
property that makes averaging attacks useless is gone. Choosing `n` first and
deriving the step from it puts the last cell exactly against the first.

**The polar collapse falls out of the same expression, with no special case.**
At 90° the ideal step is 7.3e13 degrees, `360 / ideal` rounds to 0, and
`Math.max(1, …)` makes `n = 1`: one cell covering the whole parallel, which is
the right answer because longitude carries no location at the pole.
`Math.cos(rad(90))` is 6.1e-17 rather than 0 in IEEE 754, so nothing divides by
zero — and if it ever did, `ideal` would be `Infinity`, `360 / Infinity` would
be 0, and `n` would still be 1.

## How many decimals to spend

Derived from the latitude step, which is a pure function of the precision, so
both axes share a count and it is the same everywhere on the globe.

`toFixed(7)` for everything would satisfy `xsd:decimal` and still be wrong: it
dresses a 20 km cell as a centimetre measurement in every triple it writes. Two
decimals finer than the step is enough to place a cell centre without inventing
precision — the quantum lands between step/1000 and step/100, which also keeps
the snap idempotent through its own string form: a value re-parsed from the
published text is within step/200 of the centre it came from, and rounds back to
the same cell.

Capped at 7 (~1 cm of latitude, matching `lib/pod/literals.ts`) and floored at
1, because `xsd:decimal` here always carries a decimal point.

`wrapLongitude` spells the shared meridian `-180` rather than `180`, so one cell
has one spelling.

## Negative zero, and the mechanism it is not

`(-0).toFixed(4)` is `"0.0000"`, because `toFixed` prepends a sign only when
`x < 0` and `-0` is not. The reachable path is a value whose *magnitude* falls
below the emitted quantum, which does keep its sign: `(-0.00045).toFixed(2)` is
`"-0.00"`.

`decimalPlaces` makes that unreachable by keeping the quantum two orders finer
than the cell — measured: deleting both halves of the guard in `formatDecimal`
leaves all 121 tests green — so the guard is defence in depth rather than the
thing keeping them green.

It stays because the property it defends is absolute: the zero cell has one
spelling, or two points inside it publish differently and the cell has leaked
the sign of the input it existed to erase. **Anything that widens the quantum
makes this reachable again.**

## snapToPrecision: the centre, the order of operations, and the throw

**Rounded to the cell centre, not the corner.** `Math.round(x / step) * step`
puts every published value on a grid node and moves the true point by at most
half a cell on each axis — half a cell diagonal in total. A `Math.floor` would
snap to the corner of the cell the point fell in and displace by up to a *full*
diagonal, twice as far, for nothing: the centre halves the error for free. It
also matters at the origin, where a floor would publish the four points around
null island as four different values in four quadrants.

Three ordering details, each measured:

- The latitude is clamped only against the last ulp. `(n / 2) * (180 / n)` is 90
  in exact arithmetic and may be 90.000000000000014 in floating point, and "a
  published latitude is a latitude" is worth holding on the number as well as on
  the string `toFixed` would have rounded.
- The longitude step is computed from the **snapped** latitude, not the input,
  and that is what makes the whole function idempotent: re-snapping the published
  value computes the same cosine, hence the same longitude step, hence the same
  cell.
- Quantise **before** wrapping. `n * step` for the cell at the antimeridian is
  exactly 180 in decimal but may arrive as 179.99999999999997, which wrapping
  leaves alone and which then publishes as `"180.000"` — re-snapping that
  crosses to `"-180.000"` and idempotence is lost on one cell out of thousands.
  Rounding to what is actually emitted first removes the ambiguity.

**The primitive throws.** Its contract is "give me a real coordinate", and a
plausible-looking string returned for `NaN` is how garbage reaches the Pod
wearing an `xsd:decimal` datatype. `fuzzForPublication` is the total boundary
that turns each of those into a drop.

## isInsideHome is geometry, and a zero radius is legal there

Great-circle distance, which handles the antimeridian for free because `cos Δλ`
is periodic — which is why nothing here subtracts degrees. At 70°N a degree of
longitude is 38.0 km rather than 111.2 km, so a distance that scales degrees by
one constant reports the owner's own street as somewhere else.

**Inclusive at the radius**: `distance <= radiusMeters`. When in doubt the
coordinate is dropped, which is the only direction of error this module can
afford.

**A zero radius is legal here and illegal in settings, deliberately.** §7.6: "A
stored `dy:homeRadiusMeters` of 0 is rejected on read … What a fuzzing
implementation should compute for a zero radius is a separate question, and it
stays with that module." This is that answer: `isInsideHome` is geometry, where
a degenerate circle is still a circle and the home point is 0 m from itself, and
`fuzzForPublication` is policy, where §9 pins a zero radius as invalid settings.
The radius is not required to be an integer here for the same reason — §7.6's
datatype is enforced by the schema on the way in, not by the geometry.

## fuzzForPublication is the total boundary, and it fails closed

**Inside the home radius the coordinate is dropped, not coarsened.** Coarsening
maps every entry near home onto one grid cell, and the centroid of that cell is
the owner's home to within the cell size: a hundred entries "fuzzed to 2 km"
resolve to a single point that is the house, and each new entry sharpens it.
Publishing nothing publishes nothing; publishing a coarse value publishes it
*repeatedly*, and the repetition is what makes it precise. The tempting shortcut
— "20 km is coarse enough" — is the same bug at a larger radius, so the
precision argument never buys an exemption.

**It fails closed**, the same posture as `sameWebId` and with a higher stake: a
fail-open bug here publishes a precise home coordinate to a world-readable
resource, which is the worst outcome available to this codebase. Settings that
are absent, unreadable or failing their schema mean nothing is published,
however far from home the point is. An explicit precision the module cannot
honour fails closed too rather than falling back to the default: a caller
passing `NaN` has a bug, and publishing at 500 m would hide it behind a
coordinate that looks deliberate.

**Two cases that look alike and are not**, and the distinction is load-bearing:
valid settings with *no* home region are a legitimate configuration meaning "I
have no home to protect" (§7.6), and every coordinate is still fuzzed — it is
just never dropped. Reading that as invalid would silently strip every pin from
the diary of anyone who has not set a home region.

**One definition of "trustworthy settings", not two.** The gate is the same
`PrivacySettings` schema `readPrivacySettings` validates against, so a
half-written home region, a zero radius or a missing
`dy:defaultPrecisionMeters` is rejected here for exactly the reason it was
rejected there. The `dy:schemaVersion` gate deliberately stays with the read
(§7.6: later terms are purely additive), so this does not re-check it and cannot
start dropping coordinates the day the resource gains a predicate.

**Total by construction rather than by catching.** The two primitives throw only
on input their own preconditions reject, and every one of those preconditions
has been checked by the time they are called. There is no `try` here, so a
genuine internal bug surfaces as a failure instead of being laundered into a
drop — and a throw would still be fail-closed, since a caller that throws writes
nothing.

## Why saveEntry is its own module, and why its return value is not a Result

`lib/pod/access.ts` imports `putGuarded` from `./write`, so a `saveEntry` in
`write.ts` that called `makePublic` would close an import cycle between the two.
This module sits above both and imports from each. That is a consequence of the
existing dependency direction rather than a filing preference.

**The return value is a report, not a `Result`.** §10 names three partial
failures and they are requirements rather than edge cases: an entry written but
unlisted, an ACL set but unlisted, an entry published but unreadable. "All three
recover through the same operation: `rebuildIndex`."

`{ ok: false, error }` collapses "nothing happened" into "the entry is on the
Pod but invisible", and a caller that cannot tell those apart cannot reach the
documented recovery at all — it would offer `rebuildIndex` for a write the Pod
refused outright, and offer a retry for a Pod left half-written.

So the report is always returned, always says which steps completed, and always
says what the caller should do next. `recovery` is the actionable field:
`rebuildIndex` exactly when something was left behind on the Pod.

The four `SaveRecovery` values:

- `none` — nothing to do; the sequence finished.
- `retry` — nothing was written, so the same call again is safe.
- `refetch` — a precondition failed, so something changed underneath us.
  Re-read the resource and re-apply the edit: retrying with the same stale ETag
  fails identically, and retrying *without* one is the blind PUT the
  precondition exists to prevent.
- `rebuildIndex` — the Pod holds a resource the index does not describe, or one
  whose access could not be confirmed. §10's single recovery.

412 is the one status where retrying the identical request is guaranteed to fail
again, which is why `recoveryForWrite` singles it out. Everything else — 507,
500, a dropped connection — may well succeed on a second attempt.

## dcterms:created is carried forward, and stamped once

This is the whole reason the field exists on `Entry`. An edit that rewrites the
resource without it destroys the difference between when the record came into
being and when it became public (§7.3) — silently, permanently, on the first
save after publication. A caller-supplied value wins on a create too, so
importing an entry with its real creation date works.

It belongs to no single step: steps 1, 3 and 4 all read the stamped entry, so it
happens once, before any of them, and `stampedEntry` returns a new object rather
than touching the caller's.

## Step 3 recomputes, and a draft still goes through it

Recomputed, never incremented. The §7.4 fixture declares `dy:entryCount 14`
while carrying one row, which is exactly what an increment-and-copy
implementation leaves behind: derived data describing a set it no longer
describes.

**A draft still goes through this step, and its row is removed rather than
skipped.** Unpublishing is "flip `dy:status`" (§5), and if the step were skipped
for drafts the row of an entry just unpublished would stay in the index — the
public site would keep listing its title, which is the one thing §7.4 says the
index boundary exists to prevent.

## Why the index is not written when the ACL step fails

The entry *is* on the Pod, so the report must say so — this is §10's
"published-but-unreadable". The index is deliberately not written: a row
pointing at a resource whose access could not be confirmed advertises a link the
public may not be able to follow, and `rebuildIndex` "verifies each kept entry's
ACL matches its status", which is precisely the check that just failed to
complete.

Step 4's hook is the mirror image. A hook that throws leaves the Pod consistent
and only the cache stale, which heals on its own when the entry expires. It is
reported as a network error against `entryUrl`, because that is what a failing
hook is — a POST to a route handler that did not land — and because that is the
resource whose new state is not visible yet.

## access.ts is the only module that touches access control

Five operations are the interface: `makePublic`, `makePrivate`, `getAccess`,
`createContainer`, `initialiseContainers`. The first four are §5's interface;
`createContainer` is there because a container created without an ACL of its own
is publicly enumerable. `no-restricted-imports` bans the ACL primitives
everywhere else.

The container write's three steps and the document write's apply half are also
exported, for their own tests and for nothing else. That does not widen the
fence: an `AclDataset` is inert without the primitives above, which stay banned
outside this file, so no caller elsewhere can do anything with one.

Per phase 0, `initialiseContainers` must also set inheritance explicitly — a
Pod root's public read does not cascade — close the container listing where the
server allows it, or draft slugs leak via `ldp:contains` even though draft
content is protected, and verify the resulting access rather than assuming the
writes took effect.

## Document versus container is the only branch, and never the server

There is one branch in this file and it is on the **resource kind**. A document
and a container need different things said about them — §5: "Containers carry
the default; individual draft resources override it" — and that is a property of
LDP, true on WAC and ACP alike.

- **Documents go through `universalAccess`.** Phase 0 granted public read
  through it on both CSS and ESS with identical calling code
  (`docs/decisions.md` §19), so it is the mechanism-agnostic path and is used
  wherever it can express what we mean.
- **Containers need `acl:default` *without* `acl:accessTo`.** `universalAccess`
  cannot express that: `setPublicAccess` documents that "if the Resource is a
  Container, the configured Access will not apply to contained Resources", so on
  its own it produces a diary whose pages are all 401 — while returning 2xx. The
  split shape is the fix `docs/decisions.md` §20 records as **verified on WAC**
  and explicitly **unverified on ACP** ("ACP has no accessTo/default split of
  this shape").

**The container path refuses rather than guesses.** Writing that shape means
writing a WAC ACL document, so it runs only on positive evidence that the target
*is* a WAC ACL: `hasResourceAcl` or `hasFallbackAcl`, both of which mean the
library fetched an ACL document and parsed `acl:` rules out of it.
`hasAccessibleAcl` is not that evidence and is never used as it — see
`#why-the-container-path-is-not-a-mechanism-branch` above. On ESS the library
raises `AclIsAcrError` internally, reports neither a resource nor a fallback
ACL, and this module returns `accessUnverified`. That is a refusal, not a
mechanism branch: the same code path, the same question asked of every server,
and no server is identified.

It does not fall back to a wider grant either. The fallback would silently
reopen the container listing that §20 exists to close, and it would be untested
code claiming a guarantee nobody has measured.

`createAclFromFallbackAcl` copies the ancestor's `acl:default` rules onto the
resource, which is what keeps the owner's Control when the parent's default
stops applying.

## Two kinds of evidence, and neither is proof of enforcement

Every method verifies the **result** rather than the status code, and the two
kinds of evidence are not equal:

- `"server"` — the `WAC-Allow` header, i.e. the server's own evaluation of what
  an unauthenticated request would get. This is the strong one.
- `"rules"` — the stored authorisations, read back from the server after the
  write. Proves the write persisted as written; does not prove the server
  enforces it.

**Neither is proof.** `"server"` is the server's answer to a question asked over
an authenticated connection, and `"rules"` is only what is stored. The single
thing that proves a restriction is a request from the context that should be
denied — which this module cannot make, because the caller's fetch is the only
fetch it has (invariant 4). Do not render either value as a guarantee to the
owner. That evidence lives in
`test/integration/pod-access.integration.test.ts`, against a real Community
Solid Server.

`inheritsVerifiedBy` is deliberately a different field from `verifiedBy`,
because it can never be as strong. `"rules"` means the `acl:default` triple this
module wrote, read back: no server header answers "what would an anonymous
request to a *child* of this container get?", so there is no `"server"` value
available and the type says so. The evidence that inheritance actually reaches a
child is an anonymous GET of that child, in the integration suite.
`"notApplicable"` is a document, which has no children.

## The §4 containers, and why travel/settings/ is created at first run

Media is one global container, outside any trip, so that publishing never has to
move binaries.

**`travel/settings/` is the one with `publicChildren: false`, and that flag is
the whole point of it being in the list rather than created on demand later.**
It holds `privacy.ttl` — the owner's home coordinates and fuzzing radius (§7.6)
— and `acl:default` inherits recursively, so a container created below `travel/`
with no ACL of its own is covered by the parent's public default. That is not a
hypothesis: it is measured in this repository, on `travel/trips/2026-japan/`,
where an anonymous GET returned 200 and listed the children.

So the safe state for this container is *not* the state it arrives in, and the
failure mode is silent — the write returns 201, the studio works, and the home
coordinates are readable at a URL anyone can guess from §4. Creating it at first
run is what makes the safe shape structural rather than remembered by whoever
writes the settings-editing UI.

Verified rather than reasoned: before this entry existed, the integration
suite's anonymous GET of `travel/settings/privacy.ttl` returned **200 with the
home latitude in the body**, and `readPrivacySettings` with a plain
unauthenticated fetch returned `ok` carrying the full home region. Both are 401
now. See `test/integration/pod-access.integration.test.ts`, "the privacy
settings container".

## Report the URL the caller asked about, not the URL that failed

A `FetchError`'s `response.url` is empty for a synthesised `Response`, and an
inner failure on `{root}.acl` while initialising `{root}scoped/travel/` names a
resource the caller never mentioned. Both make the error unactionable.

## ensureContainer is idempotent, and still carries a precondition

§5 asks for a first-run flow that is "safe to re-run", and this is the flow a
deployer retries after any failure. The create still carries
`If-None-Match: *`: a 412 then means "someone else got there first", which is
the success case here rather than a failure — and it is why this is not a blind
PUT even though it may run twice.

It is private on purpose. A container created through `ensureContainer` alone
has no ACL of its own and is therefore publicly enumerable, which is what
`createContainer` exists to prevent.

## createContainer is one operation because the halves cannot be separate

`acl:default` inherits recursively, so a container created below
`travel/trips/` with no ACL of its own is covered by the parent's default rule —
including as a resource in its own right, which makes its **listing** public.

Measured against CSS 7.2.0 on a Pod initialised by this module: an anonymous
`GET /travel/trips/2026-japan/` returned 200 with
`WAC-Allow: user="read",public="read"` and a body containing
`ldp:contains <entries/>, <trip.ttl>`. That is §20's leak one level down — every
studio-created trip and entries container, enumerable, with slugs derived from
titles.

So no code in this project creates a container any other way. Phase 2's entry-
and trip-creation paths call this. The rule is structural rather than
remembered, which is the only kind that survives a phase boundary.

## readAcl keeps the ETag of the same response

The point is the pairing. An ETag taken from a later HEAD says nothing about the
body this module is editing: a change landing in between — two studio tabs,
`makePublic` racing `makePrivate` — would satisfy `If-Match` and be overwritten.
One GET, one ETag, one body, and §10's precondition means what it says.

`internal_accessTo` is what makes a `SolidDataset` an `AclDataset`: the resource
these rules govern. It is set to the server's own source IRI for that resource,
which is exactly what `@inrupt/solid-client` does when it fetches an ACL itself
(`acl.internal.ts`, `internal_fetchResourceAcl`).

## An ACL with no Control rule is refused

On WAC an ACL with no Control rule cannot be repaired through the API that wrote
it, so this is one of the few unrecoverable mistakes available here. The
question is asked of the document about to be written rather than of the server:
a network failure or a 403 cannot masquerade as "nobody has Control" the way a
swallowed read once did.

Control held only by an agent *class* or a group does not count. This project's
model is one owner plus the public (§5), and a shared Pod needs this thought
about rather than assumed. The cost of being wrong is a refusal the caller can
fix by passing `webId`, which the two callers that create containers already do.

## makePrivate on a container cannot go through universalAccess

`publicInherit: false` is the same container shape with the public grant
removed, and that is what `makePrivate` on a container has to do.
`universalAccess` would clear the resource rule and leave the `acl:default` rule
standing, i.e. report success while every child stayed public. Verified in a
spike against CSS 7.2.0: after `setPublicAccess(doc, { read: false })` the
resulting ACL still contained
`acl:agentClass foaf:Agent; acl:mode acl:Read; acl:default …`.

On a container, `makePublic` means "read that reaches the children, without
leaving the container enumerable" — anything else publishes every draft slug in
it via `ldp:contains`, and slugs come from titles (`docs/decisions.md` §20). So
the public default is read and the public resource rule is nothing: the children
are readable, the listing closes, and the authenticated studio still enumerates.

## getAccess prefers the server's evaluation, and errors rather than saying false

It prefers `WAC-Allow` over our reading of the rules, because the studio's
publish indicator is only useful if it answers the second question — what is
enforced — rather than the first.

It returns an error, never `read: false`, when neither can be established. "Not
public" and "could not tell" are different facts, and the owner acts on what is
shown.

## initialiseContainers creates no content, and privacy.ttl least of all

Idempotent and safe to re-run, because this is the flow a deployer retries after
any failure: a second run reporting "already exists" would make the recovery
path indistinguishable from the failure it recovers from.

It does **not** create `diary.ttl` or any other content. Content is a write, and
writes carry the `dy:` namespace, which is still `example.org` (CLAUDE.md,
"Blocked until decided").

That applies to `travel/settings/privacy.ttl` too, and there for a second reason
on top of the namespace: a default settings document would mean choosing a home
region on the owner's behalf, and every possible choice is wrong. So a fresh Pod
gets the container and no document, `readPrivacySettings` returns a structured
404, and §9's fail-closed rule means entries are written with no coordinate
until the owner sets one. The studio has to say so.

A Pod root without its trailing slash resolves `travel/` against the parent,
which is why the root is normalised before anything is built from it.

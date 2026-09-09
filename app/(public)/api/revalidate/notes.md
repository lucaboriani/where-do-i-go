# api/revalidate — notes

POST `/api/revalidate` is the studio's cache-invalidation hook (§10, step 4).
The Pod cannot notify the site when its content changes, so invalidation is an
explicit push: `lib/pod/save-entry.ts` finishes a write by calling an injected
`revalidate(tags)` callback — it runs in the **browser**, and `revalidateTag` is
server-side — and this route is the thing on the other end of that callback.

Prose moved here by Stage C's comment sweep on 2026-09-09. The rules a reader
must not walk past are still shouted at their own sites.

## why it lives under app/(public)

When the studio is its only caller. `app/(public)/**` is the path
`eslint.config.mjs` scopes its import fence to. Filed here, this route cannot
import the Solid auth library, Radix, `lib/studio` or `lib/pod/write` — none of
which server-side, session-less code has any business touching (invariants 3 and
4). Filed under `(studio)`, it would be fenced by nothing at all. The group name
is about the fence, not about who calls it. A route handler emits no HTML, so
the public bundle budget is unaffected either way.

## it is unauthenticated, on purpose

There is no secret, and there was one in `.env.example` until this file replaced
it.

The studio runs in the visitor's browser with no server session (invariant 4),
so any credential it could send here would be shipped to every visitor in the
client bundle. That is not a secret, it is a decoration — and documenting it as
a secret is worse than documenting the endpoint as open, because the next person
reads it and believes the endpoint is protected.

What makes that proportionate is the blast radius, which is small and is kept
small by two mechanisms rather than by a token:

- `revalidateTag` only drops cache. It is idempotent and destroys nothing.
- the public routes already carry a 15-minute time-based revalidate, so the most
  an abuser achieves is forcing a refetch the timer performs anyway.
- the **allowlist** bounds *what*. Without it this is a "revalidate any tag I
  name" primitive, which is a different and much larger thing.
- the **limiter** bounds *how often*, with the honest caveats below.

POST only, and no other verb is exported. Next answers an unhandled method with
405 from the absence of the export, and a cache-mutating endpoint that answered
GET would be reachable from a bare `<img src>`, a link preview or a crawler.

## the limits are exported so nobody retypes them

`LIMITS` is exported so callers and tests derive from these numbers instead of
copying them, the same reason the tag shapes are derived from `TAGS`.

`tagsPerRequest` has a floor set by the caller that matters: step 4 of the write
sequence sends two tags in one call — the trip and the entry — so a cap of 1
would break every save. Twenty leaves room for a batch without letting one
request become an unbounded number of `revalidateTag` calls.

## 256 characters is Next's own ceiling

"Tags are case-sensitive and must not exceed 256 characters. A tag that exceeds
the limit is never assigned to cached data, so revalidating it does nothing." —
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md`

So an over-long tag is not merely useless, it is outside the primitive's
contract, and passing one on would be this endpoint reporting work it did not do.

## what the limiter does and does not protect against

A single fixed-window counter, held **in memory**, and therefore **per-process**
— per-instance on a serverless deploy. Invariant 1 leaves no alternative: the
Pod is the only datastore, so there is no KV, no Redis and no database to hold a
shared counter, and putting one in the stack is a decision this project has
already declined.

**What it does protect against.** One caller, or a small script, hammering this
endpoint from one place at a rate that would turn every request into Pod round
trips on the next page view. Within one process, that is bounded to
`requestsPerWindow` per `windowMs`.

**What it does not**, stated plainly because a guardrail that overstates itself
is worse than none:

- It is not shared between instances. On a serverless or multi-instance deploy
  the effective global rate is this limit MULTIPLIED BY the number of warm
  instances, and requests are distributed by the platform, not by us. Nothing
  here can observe that.
- It does not survive a restart, a redeploy or a cold start. Each new process
  begins with a full budget, so a caller who can cause instances to spawn is not
  limited in any meaningful sense.
- It is not a distributed-flood defence and it is not a security boundary. It
  bounds accidental and casual abuse. Anything beyond that belongs in front of
  the app, at the CDN or the host.
- It does not distinguish the owner from an abuser — see the bucket key below.

**The bucket is not keyed on anything the caller controls.** The obvious design
is one bucket per client IP, and behind a proxy the only IP available is
`x-forwarded-for`, which the client sets. A limiter keyed on a header the caller
chooses is bypassed by changing the header — it is a comment that looks like a
limiter. So this is one process-wide budget, which cannot be spoofed, at the cost
of being shared: an abuser holding it down delays the owner's invalidation until
the window rolls, and the 15-minute timer publishes the change anyway. Losing
minutes of freshness beats an endpoint that pretends to be limited.

`now < budget.windowStartedAt` covers a clock that stepped backwards; treating
it as a new window is the fail-open choice, and the alternative is a lockout
that lasts until the clock catches up.

## the allowlist is derived from TAGS, never retyped

A hardcoded `/^trip:/` would keep accepting the old spelling after someone
renamed the prefix in `tags.ts`, and a revalidation tag that does not match the
tag the read was stamped with fails silently: the public site simply keeps
serving the old page. So the shapes are recovered from `TAGS` itself by
rendering it with a probe, and the slug rules are `assertSlug` and
`assertEntrySlug` — the same functions the read layer enforces. "Could a read
ever have stamped this tag?" is exactly the question worth asking, and a tag no
read could stamp has nothing to invalidate.

The probe technique assumes `TAGS` interpolates its arguments verbatim, which is
what a template literal does. If a future `TAGS` encoded them, the probe would
not be found and the shape resolves to `null` — which rejects every tag of that
shape. Fail-closed, loudly in the tests, rather than quietly open.

The probes are NUL-delimited and escaped rather than literal: a probe only has
to be a string no real prefix or separator could contain. Neither leaves the
module and neither reaches a response.

## every way the body could split into two arguments

`entry:a/b/c` is ambiguous — `TAGS.entry("a", "b/c")` and `TAGS.entry("a/b",
"c")` produce the identical string — so there is no single parse to pick. Every
candidate is tried and each is round-tripped through `TAGS` and the slug rules;
the tag is accepted only if one of them survives. Neither reading of
`entry:a/b/c` does, because a `/` inside either half is percent-encoded by the
URL builders and no longer matches the slug it came from, so the ambiguous case
is rejected without a rule of its own.

## the entry slug rule mirrors the one place that builds the URL

`read.ts`'s rule for an entry slug is that it must match the FILENAME. Entries
are files rather than containers and have no exported URL builder, so
`entrySlugOk` mirrors `getEntry` in `lib/pod/cached.ts`. Keep the two in step;
the slug RULE is imported, only the path it is applied to is repeated.

## expire 0 rather than max

The second argument to `revalidateTag` is required — the one-argument form is
deprecated in next@16.3.4 — and which one it is matters here. `"max"` is
stale-while-revalidate: the next visitor is served the old page while the
refresh happens behind them. The next visitor after a save is almost always the
owner, clicking through from the studio to look at what they just published, and
with `"max"` they see a trip page that still does not list the new entry. The
cost of `{ expire: 0 }` is one blocking Pod round trip for one visitor;
read-your-own-write on the public page is the whole reason step 4 exists.

`updateTag`, which the docs point at for immediate expiry, is Server Actions
only and cannot be called from a route handler.

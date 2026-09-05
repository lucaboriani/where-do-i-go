/**
 * POST /api/revalidate — the studio's cache-invalidation hook (§10, step 4).
 *
 * The Pod cannot notify the site when its content changes, so invalidation is
 * an explicit push. `lib/pod/save-entry.ts` finishes a write by calling an
 * injected `revalidate(tags)` callback — it runs in the BROWSER, and
 * `revalidateTag` is server-side — and this is the thing on the other end of
 * that callback.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LIVES UNDER app/(public)/, when the studio is its only caller.
 *
 * `app/(public)/**` is the path `eslint.config.mjs` scopes its import fence to.
 * Filed here, this route cannot import the Solid auth library, Radix, lib/studio
 * or lib/pod/write — none of which server-side, session-less code has any
 * business touching (invariants 3 and 4). Filed under `(studio)`, it would be
 * fenced by nothing at all. The group name is about the fence, not about who
 * calls it. A route handler emits no HTML, so the public bundle budget is
 * unaffected either way.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT IS UNAUTHENTICATED, ON PURPOSE. There is no secret, and there was one in
 * `.env.example` until this file replaced it.
 *
 * The studio runs in the visitor's browser with no server session (invariant 4),
 * so any credential it could send here would be shipped to every visitor in the
 * client bundle. That is not a secret, it is a decoration — and documenting it
 * as a secret is worse than documenting the endpoint as open, because the next
 * person reads it and believes the endpoint is protected.
 *
 * What makes that proportionate is the blast radius, which is small and is kept
 * small by the two mechanisms below rather than by a token:
 *
 *   - `revalidateTag` only drops cache. It is idempotent and destroys nothing.
 *   - the public routes already carry a 15-minute time-based revalidate, so the
 *     most an abuser achieves is forcing a refetch the timer performs anyway.
 *   - the ALLOWLIST bounds *what*. Without it this is a "revalidate any tag I
 *     name" primitive, which is a different and much larger thing.
 *   - the LIMITER bounds *how often*, with the honest caveats stated on it.
 *
 * POST only, and no other verb is exported. Next answers an unhandled method
 * with 405 from the absence of the export, and a cache-mutating endpoint that
 * answered GET would be reachable from a bare <img src>, a link preview or a
 * crawler.
 */
import { revalidateTag } from "next/cache";
import { config } from "@/lib/config";
import { assertEntrySlug, assertSlug, tripUrl } from "@/lib/pod/read";
import { TAGS } from "@/lib/pod/tags";

/* ═════════════════════════════════════════════════════════════════ limits ══ */

/**
 * Exported so callers and tests derive from these numbers instead of copying
 * them, the same reason the tag shapes are derived from `TAGS`.
 *
 * `tagsPerRequest` has a floor set by the caller that matters: step 4 of the
 * write sequence sends two tags in one call — the trip and the entry — so a cap
 * of 1 would break every save. Twenty leaves room for a batch without letting
 * one request become an unbounded number of `revalidateTag` calls.
 */
export const LIMITS: {
  readonly requestsPerWindow: number;
  readonly windowMs: number;
  readonly tagsPerRequest: number;
} = {
  requestsPerWindow: 30,
  windowMs: 60_000,
  tagsPerRequest: 20,
};

/**
 * Next's own ceiling: "Tags are case-sensitive and must not exceed 256
 * characters. A tag that exceeds the limit is never assigned to cached data, so
 * revalidating it does nothing."
 * — node_modules/next/dist/docs/01-app/03-api-reference/04-functions/revalidateTag.md
 *
 * So an over-long tag is not merely useless, it is outside the primitive's
 * contract, and passing one on would be this endpoint reporting work it did not
 * do.
 */
const MAX_TAG_LENGTH = 256;

/* ════════════════════════════════════════════════════════════ the limiter ══ */

/**
 * A single fixed-window counter, held IN MEMORY, and therefore PER-PROCESS —
 * per-instance on a serverless deploy. Invariant 1 leaves no alternative: the
 * Pod is the only datastore, so there is no KV, no Redis and no database to
 * hold a shared counter, and putting one in the stack is a decision this
 * project has already declined.
 *
 * WHAT IT DOES PROTECT AGAINST. One caller, or a small script, hammering this
 * endpoint from one place at a rate that would turn every request into Pod
 * round trips on the next page view. Within one process, that is bounded to
 * `requestsPerWindow` per `windowMs`.
 *
 * WHAT IT DOES NOT, stated plainly because a guardrail that overstates itself
 * is worse than none:
 *
 *   - It is not shared between instances. On a serverless or multi-instance
 *     deploy the effective global rate is this limit MULTIPLIED BY the number
 *     of warm instances, and requests are distributed by the platform, not by
 *     us. Nothing here can observe that.
 *   - It does not survive a restart, a redeploy or a cold start. Each new
 *     process begins with a full budget, so a caller who can cause instances to
 *     spawn is not limited in any meaningful sense.
 *   - It is not a distributed-flood defence and it is not a security boundary.
 *     It bounds accidental and casual abuse. Anything beyond that belongs in
 *     front of the app, at the CDN or the host.
 *   - It does not distinguish the owner from an abuser — see the note on the
 *     bucket key below.
 *
 * THE BUCKET IS NOT KEYED ON ANYTHING THE CALLER CONTROLS. The obvious design
 * is one bucket per client IP, and behind a proxy the only IP available is
 * `x-forwarded-for`, which the client sets. A limiter keyed on a header the
 * caller chooses is bypassed by changing the header — it is a comment that
 * looks like a limiter. So this is one process-wide budget, which cannot be
 * spoofed, at the cost of being shared: an abuser holding it down delays the
 * owner's invalidation until the window rolls, and the 15-minute timer
 * publishes the change anyway. Losing minutes of freshness beats an endpoint
 * that pretends to be limited.
 */
const budget = { windowStartedAt: 0, used: 0 };

type BudgetVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

function spend(now: number): BudgetVerdict {
  // `now < windowStartedAt` covers a clock that stepped backwards; treating it
  // as a new window is the fail-open choice, and the alternative is a lockout
  // that lasts until the clock catches up.
  if (now - budget.windowStartedAt >= LIMITS.windowMs || now < budget.windowStartedAt) {
    budget.windowStartedAt = now;
    budget.used = 0;
  }
  if (budget.used >= LIMITS.requestsPerWindow) {
    const msLeft = budget.windowStartedAt + LIMITS.windowMs - now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(msLeft / 1000)) };
  }
  budget.used += 1;
  return { ok: true };
}

/* ══════════════════════════════════════════════════════════ the allowlist ══ */

/**
 * The allowlist is DERIVED from `lib/pod/tags.ts` and `lib/pod/read.ts`, never
 * retyped here.
 *
 * A hardcoded `/^trip:/` would keep accepting the old spelling after someone
 * renamed the prefix in `tags.ts`, and a revalidation tag that does not match
 * the tag the read was stamped with fails silently: the public site simply
 * keeps serving the old page. So the shapes are recovered from `TAGS` itself by
 * rendering it with a probe, and the slug rules are `assertSlug` and
 * `assertEntrySlug` — the same functions the read layer enforces. "Could a read
 * ever have stamped this tag?" is exactly the question worth asking, and a tag
 * no read could stamp has nothing to invalidate.
 *
 * The probe technique assumes `TAGS` interpolates its arguments verbatim, which
 * is what a template literal does. If a future `TAGS` encoded them, the probe
 * would not be found and the shape resolves to `null` — which rejects every tag
 * of that shape. Fail-closed, loudly in the tests, rather than quietly open.
 */
/* NUL-delimited, escaped rather than literal: the probe only has to be a
 * string no real prefix or separator could contain. It never leaves this
 * module and never reaches a response. */
const SLUG_PROBE = "\u0000slug\u0000";
const ENTRY_PROBE = "\u0000entry\u0000";

/** `prefix + <argument> + suffix`, recovered from one rendered example. */
type Shape1 = { prefix: string; suffix: string };
/** `prefix + <first> + middle + <second> + suffix`. */
type Shape2 = Shape1 & { middle: string };

function shapeOf1(render: (a: string) => string, probe: string): Shape1 | null {
  const rendered = render(probe);
  const at = rendered.indexOf(probe);
  // Absent, or present twice — in either case the recovery is not a bijection
  // and guessing would be worse than declining.
  if (at < 0 || rendered.indexOf(probe, at + probe.length) !== -1) return null;
  return { prefix: rendered.slice(0, at), suffix: rendered.slice(at + probe.length) };
}

function shapeOf2(render: (a: string, b: string) => string, a: string, b: string): Shape2 | null {
  const rendered = render(a, b);
  const first = rendered.indexOf(a);
  if (first < 0 || rendered.indexOf(a, first + a.length) !== -1) return null;
  const second = rendered.indexOf(b, first + a.length);
  if (second < 0 || rendered.indexOf(b, second + b.length) !== -1) return null;
  return {
    prefix: rendered.slice(0, first),
    middle: rendered.slice(first + a.length, second),
    suffix: rendered.slice(second + b.length),
  };
}

const TRIP_SHAPE = shapeOf1((slug) => TAGS.trip(slug), SLUG_PROBE);
const ENTRY_SHAPE = shapeOf2((slug, entry) => TAGS.entry(slug, entry), SLUG_PROBE, ENTRY_PROBE);

/** The tag with its fixed prefix and suffix removed, or null if it has neither. */
function body(tag: string, shape: Shape1): string | null {
  if (tag.length < shape.prefix.length + shape.suffix.length) return null;
  if (!tag.startsWith(shape.prefix) || !tag.endsWith(shape.suffix)) return null;
  return tag.slice(shape.prefix.length, tag.length - shape.suffix.length);
}

/**
 * Every way the body could split into two arguments.
 *
 * `entry:a/b/c` is ambiguous — `TAGS.entry("a", "b/c")` and
 * `TAGS.entry("a/b", "c")` produce the identical string — so there is no single
 * parse to pick. Every candidate is tried and each is round-tripped through
 * `TAGS` and the slug rules; the tag is accepted only if one of them survives.
 * Neither reading of `entry:a/b/c` does, because a `/` inside either half is
 * percent-encoded by the URL builders and no longer matches the slug it came
 * from, so the ambiguous case is rejected without a rule of its own.
 */
function* splits(text: string, middle: string): Generator<[string, string]> {
  if (middle === "") {
    for (let i = 0; i <= text.length; i++) yield [text.slice(0, i), text.slice(i)];
    return;
  }
  for (let i = text.indexOf(middle); i !== -1; i = text.indexOf(middle, i + 1)) {
    yield [text.slice(0, i), text.slice(i + middle.length)];
  }
}

/** read.ts's rule for a trip slug: the container segment IS the slug (§4). */
function tripSlugOk(podRoot: string, slug: string): boolean {
  try {
    return assertSlug(tripUrl(podRoot, slug), slug).ok;
  } catch {
    return false;
  }
}

/**
 * read.ts's rule for an entry slug: it must match the FILENAME.
 *
 * Entries are files rather than containers and have no exported URL builder, so
 * this mirrors the one place that constructs the URL — `getEntry` in
 * `lib/pod/cached.ts`. Keep the two in step; the slug RULE is imported, only the
 * path it is applied to is repeated.
 */
function entrySlugOk(podRoot: string, slug: string, entry: string): boolean {
  try {
    const url = new URL(
      `travel/trips/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entry)}.ttl`,
      podRoot,
    ).toString();
    return assertEntrySlug(url, entry).ok;
  } catch {
    return false;
  }
}

/** Could any read in this app have stamped this tag? */
function stampable(tag: string, podRoot: string): boolean {
  if (tag.length > MAX_TAG_LENGTH) return false;
  if (tag === TAGS.diary || tag === TAGS.ownerProfile) return true;

  if (TRIP_SHAPE) {
    const slug = body(tag, TRIP_SHAPE);
    if (slug !== null && TAGS.trip(slug) === tag && tripSlugOk(podRoot, slug)) return true;
  }

  if (ENTRY_SHAPE) {
    const rest = body(tag, ENTRY_SHAPE);
    if (rest !== null) {
      for (const [slug, entry] of splits(rest, ENTRY_SHAPE.middle)) {
        if (TAGS.entry(slug, entry) !== tag) continue;
        if (tripSlugOk(podRoot, slug) && entrySlugOk(podRoot, slug, entry)) return true;
      }
    }
  }

  return false;
}

/* ═══════════════════════════════════════════════════════════ the request ══ */

type Parsed = { ok: true; tags: string[] } | { ok: false; error: string };

/**
 * Malformed input is the CALLER's mistake, so it is a 400 with a body that says
 * what was wrong — never a throw, which Next would turn into a 500 and which
 * would be the endpoint blaming itself.
 */
async function parse(request: Request): Promise<Parsed> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: 'Body must be JSON of the form { "tags": string[] }.' };
  }

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'Body must be a JSON object with a "tags" array.' };
  }

  const tags: unknown = (payload as { tags?: unknown }).tags;
  if (!Array.isArray(tags)) {
    return { ok: false, error: '"tags" must be an array of strings.' };
  }
  if (tags.length > LIMITS.tagsPerRequest) {
    return {
      ok: false,
      error: `"tags" has ${tags.length} entries; at most ${LIMITS.tagsPerRequest} are accepted in one request.`,
    };
  }
  // A non-string element is a type violation in the request, not a tag to
  // report as rejected: `rejected` is a list of strings, and coercing
  // `[object Object]` into it would name a tag nobody sent.
  const offender = tags.findIndex((tag) => typeof tag !== "string");
  if (offender !== -1) {
    return { ok: false, error: `"tags"[${offender}] is not a string; every tag must be a string.` };
  }

  return { ok: true, tags: tags as string[] };
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/**
 * The success body is CLOSED — `{ revalidated, rejected }` and nothing else.
 * The studio branches on it: `saveEntry` treats step 4 as failed if the hook
 * throws, and the hook can only know to throw by reading this.
 */
export async function POST(request: Request): Promise<Response> {
  const verdict = spend(Date.now());
  if (!verdict.ok) {
    return json(
      429,
      {
        error: `Too many revalidation requests: at most ${LIMITS.requestsPerWindow} every ${Math.round(
          LIMITS.windowMs / 1000,
        )}s. Retry in ${verdict.retryAfterSeconds}s.`,
      },
      // The standard place to say "come back later". A 429 without it leaves
      // the caller's retry to guesswork.
      { "retry-after": String(verdict.retryAfterSeconds) },
    );
  }

  const parsed = await parse(request);
  if (!parsed.ok) return json(400, { error: parsed.error });

  const podRoot = config.podRoot;
  const seen = new Set<string>();
  const rejected: string[] = [];
  let revalidated = 0;

  for (const tag of parsed.tags) {
    // De-duplicated, so the count is the number of tags actually revalidated
    // and repeated work never reaches the primitive.
    if (seen.has(tag)) continue;
    seen.add(tag);

    if (!stampable(tag, podRoot)) {
      rejected.push(tag);
      continue;
    }

    /**
     * `{ expire: 0 }` rather than the docs' generally-recommended `"max"`.
     *
     * The second argument is required — the one-argument form is deprecated in
     * next@16.3.4 — and which one it is matters here. `"max"` is
     * stale-while-revalidate: the next visitor is served the old page while the
     * refresh happens behind them. The next visitor after a save is almost
     * always the owner, clicking through from the studio to look at what they
     * just published, and with `"max"` they see a trip page that still does not
     * list the new entry. The cost of `{ expire: 0 }` is one blocking Pod round
     * trip for one visitor; read-your-own-write on the public page is the whole
     * reason step 4 exists.
     *
     * (`updateTag`, which the docs point at for immediate expiry, is Server
     * Actions only and cannot be called from a route handler.)
     */
    revalidateTag(tag, { expire: 0 });
    revalidated += 1;
  }

  return json(200, { revalidated, rejected });
}

/**
 * POST /api/revalidate — §10 step 4. UNAUTHENTICATED ON PURPOSE: a browser with
 * no server session can hold no secret, so the ALLOWLIST and the LIMITER bound it
 * instead. POST ONLY — a cache-mutating GET is reachable from a bare <img src>.
 * ./notes.md#why-it-lives-under-apppublic
 */
import { revalidateTag } from "next/cache";
import { config } from "@/lib/config";
import { assertEntrySlug, assertSlug, tripUrl } from "@/lib/pod/read";
import { TAGS } from "@/lib/pod/tags";

/* ═════════════════════════════════════════════════════════════════ limits ══ */

/** Exported so callers and tests derive from these numbers instead of copying
 *  them. `tagsPerRequest` has a FLOOR OF 2 — step 4 sends the trip and the
 *  entry in one call: ./notes.md#the-limits-are-exported-so-nobody-retypes-them */
export const LIMITS: {
  readonly requestsPerWindow: number;
  readonly windowMs: number;
  readonly tagsPerRequest: number;
} = {
  requestsPerWindow: 30,
  windowMs: 60_000,
  tagsPerRequest: 20,
};

/** Next's own ceiling: a tag over 256 characters "is never assigned to cached
 *  data, so revalidating it does nothing" — so passing one on would be this
 *  endpoint reporting work it did not do:
 *  ./notes.md#256-characters-is-nexts-own-ceiling */
const MAX_TAG_LENGTH = 256;

/* ════════════════════════════════════════════════════════════ the limiter ══ */

/**
 * A fixed-window counter, IN MEMORY and PER-PROCESS. NOT A SECURITY BOUNDARY.
 * THE BUCKET IS NOT KEYED ON ANYTHING THE CALLER CONTROLS: one keyed on
 * `x-forwarded-for` is bypassed by setting the header.
 * ./notes.md#what-the-limiter-does-and-does-not-protect-against
 */
const budget = { windowStartedAt: 0, used: 0 };

type BudgetVerdict = { ok: true } | { ok: false; retryAfterSeconds: number };

function spend(now: number): BudgetVerdict {
  // A clock that stepped backwards is treated as a new window — the fail-open
  // choice: ./notes.md#what-the-limiter-does-and-does-not-protect-against
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
 * THE ALLOWLIST IS DERIVED FROM `TAGS` AND `read.ts`, NEVER RETYPED: a hardcoded
 * `/^trip:/` outlives a rename, and a tag that does not match what the read
 * stamped fails SILENTLY. An encoding `TAGS` resolves the shape to `null`.
 * ./notes.md#the-allowlist-is-derived-from-tags-never-retyped
 */
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

/** Every way the body could split into two arguments: `entry:a/b/c` has no
 *  single parse, so every candidate is round-tripped through `TAGS` and the slug
 *  rules and the tag is accepted only if one survives:
 *  ./notes.md#every-way-the-body-could-split-into-two-arguments */
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

/** read.ts's rule for an entry slug: it must match the FILENAME. This mirrors
 *  `getEntry` in `lib/pod/cached.ts` — KEEP THE TWO IN STEP:
 *  ./notes.md#the-entry-slug-rule-mirrors-the-one-place-that-builds-the-url */
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

    /** `{ expire: 0 }` rather than the docs' `"max"`, which is
     *  stale-while-revalidate and would show the owner a trip page that still
     *  does not list what they just published:
     *  ./notes.md#expire-0-rather-than-max */
    revalidateTag(tag, { expire: 0 });
    revalidated += 1;
  }

  return json(200, { revalidated, rejected });
}

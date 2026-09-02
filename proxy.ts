import { NextResponse, type NextRequest } from "next/server";
import { DY } from "@/lib/vocab";

/**
 * Return a real 404 for trips that do not exist.
 *
 * Why here and not in the page: under Partial Prerendering the static shell is
 * flushed before the dynamic part resolves, so a `notFound()` inside the page
 * lands after the status line is committed and produces 200 carrying 404
 * content. Verified by measurement, not assumed — and `export const instant =
 * false` does not help (it governs instant-navigation validation), nor does
 * `force-dynamic` (a no-op now: every page is dynamic by default).
 *
 * Middleware runs before rendering, so it is the one place left that can set
 * the status. A soft 404 matters here because this site server-renders
 * specifically for SEO and share previews (decisions.md §2).
 *
 * No Node APIs: Netlify does not support them here (decisions.md §13).
 *
 * The docs warn that proxy code may be deployed to a CDN and should not rely on
 * shared modules or globals — so treat the module-scope cache below as a
 * best-effort optimisation that may simply never hit, not as a guarantee. The
 * correctness of this file does not depend on it.
 */

const TTL_MS = 60_000;
/** Best-effort only; see the note above about CDN deployment. */
let cache: { slugs: Set<string>; at: number } | null = null;

async function knownSlugs(): Promise<Set<string> | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.slugs;

  const root = process.env.POD_ROOT;
  if (!root) return null;

  try {
    const res = await fetch(new URL("travel/diary.ttl", root), {
      headers: { accept: "text/turtle" },
    });
    if (!res.ok) return null;
    const body = await res.text();

    // A regex, not a full parser: middleware must stay small, and this reads one
    // predicate from one resource. lib/pod/read.ts remains the only validated
    // reader — nothing downstream trusts what is extracted here.
    const slugs = new Set<string>();
    const dyTrip = DY.trip.split("#").pop();
    for (const m of body.matchAll(/<([^>]*trips\/([^/>]+)\/trip\.ttl)(?:#it)?>/g)) {
      slugs.add(m[2]);
    }
    if (!body.includes(dyTrip ?? "trip")) return null; // not the document we expected
    cache = { slugs, at: Date.now() };
    return slugs;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const match = /^\/trips\/([^/]+)/.exec(request.nextUrl.pathname);
  if (!match) return NextResponse.next();

  const slugs = await knownSlugs();
  // Fail OPEN. If the Pod is unreachable or the diary is unreadable, serving a
  // page is far better than 404-ing real content over a transient hiccup.
  if (!slugs) return NextResponse.next();

  if (slugs.has(match[1])) return NextResponse.next();

  // Rewrite rather than returning a bare 404: a status with an empty body is
  // worse than the stock page it replaces. The rewrite renders the app's own
  // not-found UI while keeping the 404 status.
  return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
}

export const config = { matcher: "/trips/:path*" };

import { NextResponse, type NextRequest } from "next/server";
import { DY } from "@/lib/vocab";

/** A real 404 for trips that do not exist. Under PPR the shell is flushed
 *  before the dynamic part resolves, so `notFound()` in the page yields a 200
 *  carrying 404 content - measured. ./notes.md#why-the-middleware-returns-the-404 */

const TTL_MS = 60_000;
/** Best-effort only, never a guarantee: ./notes.md#the-module-scope-cache-is-best-effort-only */
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

    // A regex, not a parser: middleware stays small, and lib/pod/read.ts remains
    // the only validated reader. The guard below tests for something that can
    // actually be absent - the old one could never fail:
    // ./notes.md#why-a-regex-and-not-a-parser-and-the-guard-that-could-never-fail
    if (!body.includes(DY.trip) && !/\bdy:trip\b/.test(body)) return null;

    const slugs = new Set<string>();
    for (const m of body.matchAll(/<([^>]*trips\/([^/>]+)\/trip\.ttl)(?:#it)?>/g)) {
      slugs.add(m[2]);
    }
    // Never cache an empty set: failing open beats 404-ing real content.
    if (slugs.size === 0) return null;
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

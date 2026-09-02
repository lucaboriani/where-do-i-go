/**
 * The cached read layer.
 *
 * decisions.md §22: Cache Components is on, so uncached data access outside a
 * Suspense boundary blocks prerendering — and every public page reads from the
 * Pod, so this is the main render path, not an edge case.
 *
 * The choice made here is `use cache` + cacheTag, invalidated by the studio's
 * revalidation hook calling revalidateTag after each save. The alternative,
 * Suspense around every Pod read, streams instead of caching and puts a Pod
 * round-trip on every view — giving up the edge-cached public site the whole
 * architecture is arranged around.
 */
import { cacheTag } from "next/cache";
import { config } from "@/lib/config";
import { diaryUrl, readDiary, readEntry, readTrip, readTripIndex, tripIndexUrl, tripUrl } from "./read";
import type { Result } from "./result";
import type { Diary, Entry, Trip, TripIndex } from "./schema";

/** Tags the studio revalidates. Keep them coarse: the Pod cannot tell us what
 *  changed, so precision here would be a guess. */
export const TAGS = {
  diary: "diary",
  trip: (slug: string) => `trip:${slug}`,
  entry: (slug: string, entry: string) => `entry:${slug}/${entry}`,
};

export async function getDiary(): Promise<Result<Diary>> {
  "use cache";
  cacheTag(TAGS.diary);
  return readDiary(diaryUrl(config.podRoot));
}

export async function getTrip(slug: string): Promise<Result<Trip>> {
  "use cache";
  cacheTag(TAGS.trip(slug));
  return readTrip(tripUrl(config.podRoot, slug));
}

export async function getTripIndex(slug: string): Promise<Result<TripIndex>> {
  "use cache";
  cacheTag(TAGS.trip(slug));
  return readTripIndex(tripIndexUrl(config.podRoot, slug));
}

export async function getEntry(slug: string, entrySlug: string): Promise<Result<Entry>> {
  "use cache";
  cacheTag(TAGS.entry(slug, entrySlug));
  return readEntry(
    new URL(
      `travel/trips/${encodeURIComponent(slug)}/entries/${encodeURIComponent(entrySlug)}.ttl`,
      config.podRoot,
    ).toString(),
  );
}

/**
 * Every (trip, entry) pair for prerendering.
 *
 * Entries are knowable at build time because the index exists precisely to list
 * them (§7.4) — so this needs no container enumeration and no authentication.
 * An entry published after the build is served the App Shell and upgraded in
 * the background by partialPrefetching, so publishing never needs a redeploy.
 */
export async function allEntryParams(): Promise<{ slug: string; entry: string }[]> {
  const slugs = await allTripSlugs();
  const pairs: { slug: string; entry: string }[] = [];
  for (const slug of slugs) {
    const index = await getTripIndex(slug);
    if (!index.ok) continue; // a trip without a readable index simply prerenders none
    for (const e of index.value.entries) pairs.push({ slug, entry: e.slug });
  }
  return pairs;
}

/**
 * Published trip slugs, as a Result.
 *
 * This is what the render path uses. `result.ts` opens with "a thrown exception
 * is not a structured error … failures are values, not control flow", and
 * proxy.ts deliberately fails open on exactly this condition — so a Pod that is
 * briefly unreachable must render the same fallback the home page already has,
 * not a 500 from an error boundary.
 */
export async function publishedTripSlugs(): Promise<Result<string[]>> {
  "use cache";
  cacheTag(TAGS.diary);
  const diary = await getDiary();
  if (!diary.ok) return diary;

  const candidates = diary.value.trips
    .map((iri) => iri.match(/trips\/([^/]+)\//)?.[1])
    .filter((s): s is string => Boolean(s));

  // diary.ttl lists every trip, draft or not — unlike entries, there is no
  // index acting as a publication boundary for trips. So filter here, or a
  // draft is linked from the home page and advertised in the sitemap and feed.
  const checked = await Promise.all(
    candidates.map(async (slug) => [slug, await getTrip(slug)] as const),
  );
  return {
    ok: true,
    value: checked
      .filter(([, trip]) => trip.ok && trip.value.status === "published")
      .map(([slug]) => slug),
  };
}

/**
 * Trip slugs for prerendering. THROWS on purpose — use only from
 * generateStaticParams, never from a render path.
 *
 * generateStaticParams must return at least one param — an empty array raises
 * `empty-generate-static-params` — and dynamicParams is unsupported. So a
 * deployer whose Pod has no trips yet would get a failed build rather than an
 * empty site, which is a terrible first run for "fork it and deploy".
 *
 * We fail, but loudly and with the fix in the message, rather than shipping a
 * placeholder trip that would appear on a real site.
 */
export async function allTripSlugs(): Promise<string[]> {
  const result = await publishedTripSlugs();
  if (!result.ok) {
    throw new Error(
      `Cannot read the diary at ${diaryUrl(config.podRoot)} — ${result.error.kind}. ` +
        `The build reads your Pod to know which trips to prerender. Check POD_ROOT, ` +
        `and that /travel/diary.ttl exists and is publicly readable.`,
    );
  }
  const slugs = result.value;
  if (slugs.length === 0) {
    throw new Error(
      `Your diary at ${diaryUrl(config.podRoot)} lists no published trips, so there is nothing ` +
        `to prerender and the build cannot continue. Create and publish one trip, then redeploy.`,
    );
  }
  return slugs;
}

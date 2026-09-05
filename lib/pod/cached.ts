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
 *
 * ONE DELIBERATE EXCEPTION TO "A TYPED VALUE OR A STRUCTURED ERROR, NEVER A
 * THROW". The getters these functions read — `config.podRoot`,
 * `config.ownerWebId` — throw when their env var is unset, so a misconfigured
 * deployment makes them reject rather than return a `PodError`.
 *
 * That is the intended behaviour, not an oversight to tidy away. A missing
 * POD_ROOT is a deployment fault, not a runtime condition to render a fallback
 * for: `lib/config.ts` says as much in the error itself — "the site reads its
 * content from a Solid Pod and cannot start without knowing which one". With
 * Cache Components on, these run at build time, so the throw fails the BUILD,
 * which is where a missing env var should fail. Catching it here would instead
 * produce a site that deploys green and serves an error fallback on every page.
 *
 * So: structured errors are for what the Pod does — 404, a bad shape, an
 * unreachable host. A throw here means the deployment is wrong.
 */
import { cacheTag } from "next/cache";
import { config } from "@/lib/config";
import {
  diaryUrl,
  readDiary,
  readEntry,
  readOwnerProfile,
  readTrip,
  readTripIndex,
  tripIndexUrl,
  tripUrl,
} from "./read";
import { TAGS } from "./tags";
import type { Result } from "./result";
import type { Diary, Entry, OwnerProfile, Trip, TripIndex } from "./schema";

/**
 * Re-exported, not defined here. The tags moved to `./tags` because `saveEntry`
 * needs them in the browser and this module is server-only — it imports
 * `next/cache` and carries `"use cache"` functions. One definition, reachable
 * from both sides, and every existing `import { TAGS } from "@/lib/pod/cached"`
 * keeps working.
 */
export { TAGS };

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
 * The owner's WebID profile (§7.5) — issuer, storage, extended profile.
 *
 * Cached for the reason at the top of this file rather than because the studio
 * needs it fast: `/studio` prerenders as `○ (Static)`, and a bare
 * `readOwnerProfile` in the page is an uncached data access outside a Suspense
 * boundary, which silently demotes it. Only the route table would show it.
 *
 * Reads `config.ownerWebId`, never `config.podRoot`. They are different things
 * — on ESS identity and storage are different hosts entirely — and where the
 * Pod is comes from `pim:storage` inside the document, not from configuration.
 *
 * `config.ownerWebId` throws when OWNER_WEBID is unset, which sits oddly beside
 * "never a throw" — see the note on that at the top of this file. Deliberate,
 * and the same for `getDiary` through `config.podRoot`.
 */
export async function getOwnerProfile(): Promise<Result<OwnerProfile>> {
  "use cache";
  cacheTag(TAGS.ownerProfile);
  return readOwnerProfile(config.ownerWebId);
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

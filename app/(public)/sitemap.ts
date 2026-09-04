import type { MetadataRoute } from "next";
import { config } from "@/lib/config";
import { getTrip, getTripIndex, publishedTripSlugs } from "@/lib/pod/cached";

/**
 * Only published content reaches here, for free: the index lists published
 * entries and nothing else, so a draft cannot be advertised even by accident.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // config.siteUrl is normalised at the source: it never ends with a slash,
  // so the strip this line used to carry has moved to lib/config.ts.
  const base = config.siteUrl;
  // A sitemap that 500s is worse than a short one: fall back to just the home
  // page rather than throwing out of the render path.
  const published = await publishedTripSlugs();
  const slugs = published.ok ? published.value : [];

  const entries: MetadataRoute.Sitemap = [{ url: `${base}/`, changeFrequency: "weekly" }];

  for (const slug of slugs) {
    const [trip, index] = await Promise.all([getTrip(slug), getTripIndex(slug)]);
    entries.push({
      url: `${base}/trips/${slug}`,
      lastModified: trip.ok ? trip.value.modified : undefined,
    });
    if (!index.ok) continue;
    for (const e of index.value.entries) {
      entries.push({
        url: `${base}/trips/${slug}/${e.slug}`,
        lastModified: index.value.modified,
      });
    }
  }
  return entries;
}

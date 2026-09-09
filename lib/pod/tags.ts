/**
 * The cache tags the public read layer stamps and the studio invalidates. NOT
 * in cached.ts, where they used to live: that file imports `next/cache`, and
 * `saveEntry` runs in the browser. cached.ts re-exports these.
 * ./notes.md#why-the-cache-tags-are-not-in-cachedts-where-they-used-to-live
 */

/** Tags the studio revalidates. Keep them coarse: the Pod cannot tell us what
 *  changed, so precision here would be a guess. */
export const TAGS = {
  diary: "diary",
  trip: (slug: string) => `trip:${slug}`,
  entry: (slug: string, entry: string) => `entry:${slug}/${entry}`,
  /** Flat, with nothing to parameterise by: there is one owner, and the issuer
   *  changes approximately never. `trip:` and `entry:` own their prefixes, so a
   *  tag carrying neither cannot be produced by any slug. */
  ownerProfile: "owner-profile",
};

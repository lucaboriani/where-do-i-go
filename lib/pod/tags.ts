/**
 * The cache tags the public read layer stamps and the studio invalidates.
 *
 * WHY THIS IS NOT IN lib/pod/cached.ts, WHERE IT USED TO LIVE. `cached.ts`
 * imports `next/cache` and carries `"use cache"` functions, both of which are
 * server-only. `saveEntry` runs in the BROWSER — writes go browser → Pod
 * directly (invariant 4) — and step 4 of §10 hands these tags to a revalidation
 * hook that posts them to a route handler. Importing `cached.ts` to reach the
 * tag strings would drag `next/cache` into the studio bundle; hardcoding
 * `trip:${slug}` in the writer instead would let the two spellings drift, and a
 * revalidation tag that does not match the tag the read was stamped with fails
 * silently — the public site simply keeps serving the old page.
 *
 * `cached.ts` re-exports this, so `import { TAGS } from "@/lib/pod/cached"`
 * keeps working and there is still one definition.
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

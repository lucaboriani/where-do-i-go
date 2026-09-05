/**
 * Step 4 of §10, from the browser: tell this app's own server to drop the cache
 * entries the save just invalidated.
 *
 * STUDIO-ONLY, and it lives in lib/studio rather than lib/pod because it talks
 * to the app, not to the Pod. `saveEntry` takes it as an injected callback —
 * `revalidateTag` is server-side and the write sequence runs in the browser —
 * so this is the thing on the other end of that injection, and the route on the
 * other end of this POST is app/(public)/api/revalidate/route.ts.
 *
 * IT DELIBERATELY DOES NOT USE THE SESSION'S FETCH. The route is
 * unauthenticated by design and says so at length: "any credential it could
 * send here would be shipped to every visitor in the client bundle". Invariant
 * 4 is that no Pod credential is ever held server-side, and posting a DPoP
 * token to our own route handler is the first step towards holding one. The
 * ambient `fetch` is the correct one here and the only place in the studio
 * where that is true.
 *
 * IT READS THE BODY, NOT THE STATUS. This is the whole reason the function
 * exists rather than being three lines inlined at the call site. The route
 * answers `200 { revalidated: 0, rejected: [...] }` when it rejects every tag
 * it was given — a tag no read in this app could have stamped invalidates
 * nothing — and its own docblock spells out the consequence: "the studio
 * branches on it: saveEntry treats step 4 as failed if the hook throws, and the
 * hook can only know to throw by reading this." A hook that checks `res.ok` and
 * stops reports a clean save while the public site keeps serving the old page.
 *
 * A THROW IS THE PROTOCOL. `saveEntry` catches it and reports step 4 as failed,
 * which is a partial success: the Pod is consistent and only the public cache
 * is behind, so the message the owner sees says "saved, the public site may be
 * a few minutes behind" rather than anything about losing work.
 */
import * as z from "zod";

/** Same-origin and relative on purpose: the route is served by whatever origin
 *  the studio was loaded from, so there is nothing to configure and nothing
 *  that can drift from it. */
export const REVALIDATE_PATH = "/api/revalidate";

/**
 * The route's success body, which it documents as CLOSED — `{ revalidated,
 * rejected }` and nothing else.
 *
 * Parsed rather than trusted: a body that does not match this shape is a route
 * that changed under us, and the honest reading of "I cannot tell what
 * happened" is the same as the reading of "nothing happened" — warn the owner
 * that the public site may be stale. Silently treating it as success is the
 * failure this module exists to prevent.
 */
const RevalidationReport = z.object({
  revalidated: z.number().int().nonnegative(),
  rejected: z.array(z.string()),
});

export async function revalidatePublicSite(tags: string[]): Promise<void> {
  const res = await fetch(REVALIDATE_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tags }),
  });

  if (!res.ok) {
    throw new Error(`${REVALIDATE_PATH} answered HTTP ${res.status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`${REVALIDATE_PATH} answered ${res.status} with a body that is not JSON`);
  }

  const report = RevalidationReport.safeParse(body);
  if (!report.success) {
    throw new Error(
      `${REVALIDATE_PATH} answered ${res.status} with a body this app does not recognise`,
    );
  }

  if (report.data.rejected.length > 0) {
    throw new Error(
      `${REVALIDATE_PATH} rejected ${report.data.rejected.length} of ${tags.length} tags: ` +
        report.data.rejected.join(", "),
    );
  }

  /**
   * Counted against the DISTINCT tags asked for, because the route
   * de-duplicates before it counts. Fewer revalidated than asked for, with
   * nothing rejected, is a shape neither side should be able to produce — so it
   * is reported rather than rounded up to success.
   */
  const asked = new Set(tags).size;
  if (report.data.revalidated < asked) {
    throw new Error(
      `${REVALIDATE_PATH} revalidated ${report.data.revalidated} of ${asked} tags`,
    );
  }
}

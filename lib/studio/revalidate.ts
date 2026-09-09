/**
 * Step 4 of §10, from the browser: tell this app's own server to drop the cache
 * entries the save just invalidated. STUDIO-ONLY, and it deliberately uses the
 * AMBIENT fetch — the route is unauthenticated by design (invariant 4).
 * ./notes.md#step-4-of-10-from-the-browser
 */

// IT READS THE BODY, NOT THE STATUS, which is why this is a function rather
// than three lines at the call site: the route answers 200 with
// `{ revalidated: 0, rejected: [...] }`. A THROW IS THE PROTOCOL — saveEntry
// reports step 4 as failed. ./notes.md#it-reads-the-body-not-the-status
import * as z from "zod";

/** Same-origin and relative on purpose: the route is served by whatever origin
 *  the studio was loaded from, so there is nothing to configure and nothing
 *  that can drift from it. */
export const REVALIDATE_PATH = "/api/revalidate";

/**
 * The route's success body, which it documents as CLOSED. Parsed rather than
 * trusted: "I cannot tell what happened" reads the same as "nothing happened".
 * ./notes.md#it-reads-the-body-not-the-status
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

  /* Counted against the DISTINCT tags asked for, because the route
   * de-duplicates before counting; fewer than asked for with nothing rejected
   * is reported rather than rounded up.
   * ./notes.md#it-reads-the-body-not-the-status */
  const asked = new Set(tags).size;
  if (report.data.revalidated < asked) {
    throw new Error(
      `${REVALIDATE_PATH} revalidated ${report.data.revalidated} of ${asked} tags`,
    );
  }
}

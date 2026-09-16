/**
 * §5's publish/unpublish in one place: a trip is never guarded; an entry is
 * guarded on its trip's own status, `undefined` reading exactly like a draft.
 * ./notes.md#why-undefined-fails-closed
 */

import { useState } from "react";
import { describe } from "@/lib/pod/result";
import { publishTrip, unpublishTrip } from "@/lib/pod/save-trip";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import type { Status, Trip } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

/** The one thing that differs between a trip and an entry: a trip is always
 *  writable, an entry needs `write` injected — Stage 4's editor supplies it. */
export type PublishTarget =
  | { kind: "trip"; trip: Trip; podRoot: string; etag: string }
  | {
      kind: "entry";
      tripStatus: Status | undefined;
      write: (next: Status) => Promise<{ ok: boolean; error?: string }>;
    };

export interface PublishSeed {
  session: StudioSessionLike;
  target: PublishTarget;
}

export interface Publish {
  pending: boolean;
  error: string | null;
  canPublish: boolean;
  reason: string | null;
  publish: () => Promise<void>;
  unpublish: () => Promise<void>;
}

const ENTRY_GUARD_REASON =
  "This entry's trip is not published yet, so the entry cannot be published either.";

export function usePublish({ session, target }: PublishSeed): Publish {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canPublish = target.kind === "trip" ? true : target.tripStatus === "published";
  const reason = canPublish ? null : ENTRY_GUARD_REASON;

  /** The trip path: never guarded, always through publishTrip/unpublishTrip. */
  async function runTrip(status: Status): Promise<void> {
    if (target.kind !== "trip") return;
    setPending(true);
    setError(null);
    const run = status === "published" ? publishTrip : unpublishTrip;
    const report = await run({
      fetch: session.fetch,
      trip: target.trip,
      podRoot: target.podRoot,
      etag: target.etag,
      webId: session.info.webId,
      revalidate: revalidatePublicSite,
    });
    setPending(false);
    if (report.failed) setError(describe(report.failed.error));
  }

  /** The entry path: `publish("published")` is refused unless the trip is
   *  already published; `unpublish` carries none of that guard (§5). */
  async function runEntry(status: Status): Promise<void> {
    if (target.kind !== "entry") return;
    if (status === "published" && !canPublish) return;
    setPending(true);
    setError(null);
    const result = await target.write(status);
    setPending(false);
    if (!result.ok) setError(result.error ?? "The write did not succeed.");
  }

  const publish = () => (target.kind === "trip" ? runTrip("published") : runEntry("published"));
  const unpublish = () => (target.kind === "trip" ? runTrip("draft") : runEntry("draft"));

  return { pending, error, canPublish, reason, publish, unpublish };
}

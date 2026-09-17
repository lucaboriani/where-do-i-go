"use client";

/**
 * A trip's entries (Task 4.1): every entry's status, edit and publish
 * affordances, and "New entry". STUDIO-ONLY. Mirrors `trips-list.tsx`'s own
 * two-phase load. ./notes.md#the-two-phase-load-mirrors-trips-list
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { entryUrl, readEntryWithEtag, tripIndexUrl, tripUrl } from "@/lib/pod/read";
import { describe as describePodError } from "@/lib/pod/result";
import { saveEntry } from "@/lib/pod/save-entry";
import { revalidatePublicSite } from "@/lib/studio/revalidate";
import { usePublish } from "@/hooks/studio/use-publish";
import { useStudioEntries } from "@/hooks/studio/use-studio-entries";
import type { StudioEntry } from "@/hooks/studio/use-studio-entries";
import type { Entry, Status } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

export interface EntriesListProps {
  session: StudioSessionLike;
  podRoot: string;
  tripSlug: string;
  /** The caller's `Trip.status`, not read here — see ./notes.md#tripstatus-is-a-prop-not-a-second-read. */
  tripStatus: Status | undefined;
}

/** What a row needs to publish: the full entry and the ETag it was read at.
 *  `null` means no ETag header at all — never coerced into a precondition.
 *  ./notes.md#a-null-etag-blocks-publishing-here-too */
type FullEntry = { entry: Entry; etag: string | null };

export default function EntriesList({ session, podRoot, tripSlug, tripStatus }: EntriesListProps) {
  const listing = useStudioEntries({ session, podRoot, tripSlug });
  const [full, setFull] = useState<Map<string, FullEntry> | null>(null);

  // Phase 2: each entry's full document + ETag, which publishing needs and
  // the summary list does not carry. ./notes.md#the-two-phase-load-mirrors-trips-list
  useEffect(() => {
    if (listing.status !== "ready") return;
    let live = true;
    Promise.all(
      listing.entries.map(async (row) => {
        const url = entryUrl(podRoot, tripSlug, row.slug);
        return [row.slug, await readEntryWithEtag(url, { fetch: session.fetch })] as const;
      }),
    ).then((reads) => {
      if (!live) return;
      const map = new Map<string, FullEntry>();
      for (const [slug, read] of reads) {
        if (read.ok) map.set(slug, { entry: read.value.entry, etag: read.value.etag });
      }
      setFull(map);
    });
    return () => {
      live = false;
    };
    // `listing` is a fresh object each render; its own status is what this
    // effect depends on, alongside the trip and the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.status, podRoot, tripSlug, session]);

  if (listing.status === "pending") {
    return <p className="text-muted-foreground">{"Looking for this trip's entries…"}</p>;
  }
  if (listing.status === "failed") {
    return (
      <p role="alert">
        {"This trip's entries could not be read. "}
        {describePodError(listing.error)}
      </p>
    );
  }
  if (full === null) {
    return <p className="text-muted-foreground">{"Looking for this trip's entries…"}</p>;
  }

  return (
    <section>
      <p className="mb-4">
        <Link href={`/studio/trips/${tripSlug}/new-entry`}>{"New entry"}</Link>
      </p>
      {listing.entries.length === 0 && <p className="text-muted-foreground">{"No entries yet."}</p>}
      <ul>
        {listing.entries.map((row) => (
          <EntryRow
            key={row.slug}
            row={row}
            full={full.get(row.slug)}
            session={session}
            podRoot={podRoot}
            tripSlug={tripSlug}
            tripStatus={tripStatus}
          />
        ))}
      </ul>
    </section>
  );
}

function EntryRow({
  row,
  full,
  session,
  podRoot,
  tripSlug,
  tripStatus,
}: {
  row: StudioEntry;
  full: FullEntry | undefined;
  session: StudioSessionLike;
  podRoot: string;
  tripSlug: string;
  tripStatus: Status | undefined;
}) {
  return (
    <li className="border-b border-hairline py-3">
      <p>
        <Link href={`/studio/trips/${tripSlug}/${row.slug}`}>{row.title}</Link>
        {" — "}
        {/* "Private", not "Draft": a headline can contain "draft" too.
            ./notes.md#the-status-word-is-published-or-private-never-draft */}
        <span>{row.status === "published" ? "Published" : "Private"}</span>
      </p>
      {full !== undefined &&
        (full.etag === null ? (
          <p className="mt-1 text-muted-foreground">
            {"This entry's version could not be confirmed. Reload to publish."}
          </p>
        ) : (
          <PublishEntryAction
            session={session}
            podRoot={podRoot}
            tripSlug={tripSlug}
            tripStatus={tripStatus}
            full={{ entry: full.entry, etag: full.etag }}
          />
        ))}
    </li>
  );
}

/** The one control that goes through `usePublish`'s entry target — its own
 *  `write`, since `save-entry.ts` has no `publishEntry`/`unpublishEntry` pair
 *  the way trips do. ./notes.md#the-write-callback-is-saveentry-not-a-new-pair */
function PublishEntryAction({
  session,
  podRoot,
  tripSlug,
  tripStatus,
  full,
}: {
  session: StudioSessionLike;
  podRoot: string;
  tripSlug: string;
  tripStatus: Status | undefined;
  full: { entry: Entry; etag: string };
}) {
  const isPublished = full.entry.status === "published";

  async function write(next: Status): Promise<{ ok: boolean; error?: string }> {
    const report = await saveEntry({
      fetch: session.fetch,
      entry: { ...full.entry, status: next },
      precondition: { etag: full.etag },
      indexUrl: tripIndexUrl(podRoot, tripSlug),
      tripIri: `${tripUrl(podRoot, tripSlug)}#it`,
      tripSlug,
      revalidate: revalidatePublicSite,
      webId: session.info.webId,
      tripStatus,
    });
    return report.failed
      ? { ok: false, error: describePodError(report.failed.error) }
      : { ok: true };
  }

  const { pending, error, canPublish, reason, publish, unpublish } = usePublish({
    session,
    target: { kind: "entry", tripStatus, write },
  });
  const disabled = pending || (!isPublished && !canPublish);

  return (
    <p className="mt-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => void (isPublished ? unpublish() : publish())}
        className="cursor-pointer border border-hairline bg-surface px-2 py-1 hover:bg-hairline"
      >
        {isPublished ? "Take offline" : "Publish"}
      </button>
      {!isPublished && reason !== null && (
        <span className="ml-2 text-muted-foreground">{reason}</span>
      )}
      {error !== null && <span role="alert">{` ${error}`}</span>}
    </p>
  );
}

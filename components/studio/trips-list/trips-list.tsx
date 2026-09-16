"use client";

/**
 * The studio's home (Task 3.2): every trip on the Pod, its status, its entry
 * count, and per-trip publish/edit affordances. STUDIO-ONLY.
 * ./notes.md#the-two-phase-load-and-why-it-is-not-one
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { readTripWithEtag, tripUrl } from "@/lib/pod/read";
import { describe as describePodError } from "@/lib/pod/result";
import { usePublish } from "@/hooks/studio/use-publish";
import { useStudioTrips } from "@/hooks/studio/use-studio-trips";
import type { StudioTripRow } from "@/hooks/studio/use-studio-trips";
import type { Trip } from "@/lib/pod/schema";
import type { StudioTripListing } from "@/lib/studio/trips";
import type { StudioSessionLike } from "@/lib/studio/session";

export interface TripsListProps {
  session: StudioSessionLike;
  podRoot: string;
}

/** What a row needs to publish: the full trip (not the list summary) and the
 *  ETag it was read at — see ./notes.md#the-two-phase-load-and-why-it-is-not-one. */
type FullTrip = { trip: Trip; etag: string };

export default function TripsList({ session, podRoot }: TripsListProps) {
  const listing = useStudioTrips({ session, podRoot });
  const [full, setFull] = useState<Map<string, FullTrip> | null>(null);

  // Phase 2: each trip's full document + current ETag, which publishing
  // needs and the summary list does not carry.
  // ./notes.md#the-two-phase-load-and-why-it-is-not-one
  useEffect(() => {
    // Not reset to null on a non-ready listing: every branch that reads
    // `full` is itself gated on `listing.status === "ready"`, so stale data
    // here is simply never rendered.
    if (listing.status !== "ready") return;
    let live = true;
    Promise.all(
      listing.trips.map(async (row) => {
        const read = await readTripWithEtag(tripUrl(podRoot, row.slug), { fetch: session.fetch });
        return [row.slug, read] as const;
      }),
    ).then((entries) => {
      if (!live) return;
      const map = new Map<string, FullTrip>();
      for (const [slug, read] of entries) {
        if (read.ok) map.set(slug, { trip: read.value.trip, etag: read.value.etag ?? "" });
      }
      setFull(map);
    });
    return () => {
      live = false;
    };
    // `listing` is a fresh object each render; its own trips/status are what
    // this effect actually depends on, alongside the session and root.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.status, podRoot, session]);

  if (listing.status === "pending") {
    return <p className="text-muted-foreground">{"Looking for your trips…"}</p>;
  }
  if (listing.status === "failed") {
    return (
      <p role="alert">
        {"Your trips could not be read. "}
        {describePodError(listing.error)}
      </p>
    );
  }
  if (full === null) {
    return <p className="text-muted-foreground">{"Looking for your trips…"}</p>;
  }

  return (
    <section>
      <p className="mb-4">
        <Link href="/studio/trips/new">{"New trip"}</Link>
      </p>
      <Skipped skipped={listing.skipped} />
      <ul>
        {listing.trips.map((row) => (
          <TripRow
            key={row.slug}
            row={row}
            full={full.get(row.slug)}
            session={session}
            podRoot={podRoot}
          />
        ))}
      </ul>
    </section>
  );
}

function TripRow({
  row,
  full,
  session,
  podRoot,
}: {
  row: StudioTripRow;
  full: FullTrip | undefined;
  session: StudioSessionLike;
  podRoot: string;
}) {
  return (
    <li className="border-b border-hairline py-3">
      <p>
        <Link href={`/studio/trips/${row.slug}`}>{row.name}</Link>
        {" — "}
        <span>{row.status === "published" ? "Published" : "Draft"}</span>
        {" — "}
        <span>{`${row.entryCount} ${row.entryCount === 1 ? "entry" : "entries"}`}</span>
      </p>
      {full !== undefined && <PublishAction session={session} podRoot={podRoot} full={full} />}
    </li>
  );
}

/** The one control that goes through `usePublish` — the wiring this stage
 *  exists to prove, not a fresh call to `publishTrip` of its own. */
function PublishAction({
  session,
  podRoot,
  full,
}: {
  session: StudioSessionLike;
  podRoot: string;
  full: FullTrip;
}) {
  const isPublished = full.trip.status === "published";
  const { pending, error, publish, unpublish } = usePublish({
    session,
    target: { kind: "trip", trip: full.trip, podRoot, etag: full.etag },
  });

  return (
    <p className="mt-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void (isPublished ? unpublish() : publish())}
        className="cursor-pointer border border-hairline bg-surface px-2 py-1 hover:bg-hairline"
      >
        {isPublished ? "Take offline" : "Publish"}
      </button>
      {error !== null && <span role="alert">{` ${error}`}</span>}
    </p>
  );
}

/** Mirrors `studio-shell.tsx`'s own `Skipped` — a trip the studio could not
 *  read is one the owner cannot write into, and silence leaves them
 *  wondering where it went. */
function Skipped({ skipped }: { skipped: StudioTripListing["skipped"] }) {
  if (skipped.length === 0) return null;
  return (
    <section className="mt-4 border border-hairline p-4">
      <h2 className="text-lg">{"Some trips could not be read"}</h2>
      <ul className="mt-2">
        {skipped.map((skip) => (
          <li key={skip.url} className="text-muted-foreground">
            {`${skip.url} — ${skip.reason}`}
          </li>
        ))}
      </ul>
    </section>
  );
}

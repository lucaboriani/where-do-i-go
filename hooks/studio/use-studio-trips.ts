/**
 * The trips-list load path: bootstrap the Pod once (finding #3), then list,
 * then each trip's own entry count. A structured state, never a throw.
 * ./notes.md#ensurepodinitialised-runs-from-here-once
 */

import { useEffect, useRef, useState } from "react";
import { ensurePodInitialised } from "@/lib/pod/bootstrap";
import { readTripIndex } from "@/lib/pod/read";
import { listStudioTrips } from "@/lib/studio/trips";
import type { PodError } from "@/lib/pod/result";
import type { StudioTrip, StudioTripListing } from "@/lib/studio/trips";
import type { StudioSessionLike } from "@/lib/studio/session";

export type StudioTripRow = StudioTrip & { entryCount: number };

export type StudioTripsState =
  | { status: "pending" }
  | { status: "ready"; trips: StudioTripRow[]; skipped: StudioTripListing["skipped"] }
  | { status: "failed"; error: PodError };

export interface StudioTripsSeed {
  session: StudioSessionLike;
  podRoot: string;
}

/** One read per trip (§7.4); a trip whose own index cannot be read still
 *  lists, with entryCount 0 — see ./notes.md#entrycount-is-published-only-and-that-is-a-known-gap. */
async function countedTrip(
  fetch: StudioSessionLike["fetch"],
  trip: StudioTrip,
): Promise<StudioTripRow> {
  const index = await readTripIndex(trip.indexUrl, { fetch });
  return { ...trip, entryCount: index.ok ? (index.value.entryCount ?? 0) : 0 };
}

/** The whole load, as a value: bootstrap, list, then each trip's own count. */
async function loadStudioTrips(seed: StudioTripsSeed): Promise<StudioTripsState> {
  const { session, podRoot } = seed;
  const webId = session.info.webId;
  if (webId === undefined) {
    return {
      status: "failed",
      error: { kind: "network", url: podRoot, message: "no signed-in WebID" },
    };
  }

  const bootstrap = await ensurePodInitialised({ fetch: session.fetch, podRoot, webId });
  if (!bootstrap.ok) return { status: "failed", error: bootstrap.error };

  const listing = await listStudioTrips({ fetch: session.fetch, podRoot });
  if (!listing.ok) return { status: "failed", error: listing.error };

  const trips = await Promise.all(
    listing.value.trips.map((trip) => countedTrip(session.fetch, trip)),
  );
  return { status: "ready", trips, skipped: listing.value.skipped };
}

export function useStudioTrips({ session, podRoot }: StudioTripsSeed): StudioTripsState {
  const [state, setState] = useState<StudioTripsState>({ status: "pending" });
  /** Memoised by podRoot, mirroring `studio-shell.tsx`'s `started` ref: the
   *  cleanup between StrictMode's two invocations must not clear it. */
  const started = useRef<{ key: string; result: Promise<StudioTripsState> } | null>(null);

  useEffect(() => {
    let live = true;
    if (started.current?.key !== podRoot) {
      started.current = { key: podRoot, result: loadStudioTrips({ session, podRoot }) };
    }
    void started.current.result.then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [session, podRoot]);

  return state;
}

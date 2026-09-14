import { Suspense } from "react";
import DiaryMap from "@/components/public/diary-map";
import MapSheet from "@/components/public/map-sheet";
import TripHighlightProvider from "@/components/public/trip-highlight";
import TripList, { type TripListItem } from "@/components/public/trip-list";
import { config } from "@/lib/config";
import { MAP_FRAME_CLASS } from "@/lib/map/frame";
import { getDiary, getTrip, getTripIndex, publishedTripSlugs } from "@/lib/pod/cached";
import { describe as describeError } from "@/lib/pod/result";
import type { TripPoint } from "@/lib/map/trips";

/** The shell is the page, not a layout: `/` has no child routes for one map to
 *  survive. The pane stays a SIBLING of the sheet at every width, and the page
 *  awaits nothing itself — a read here would hold the shell until the Pod
 *  answered, which is what Next's instant-navigation validation flags. */
export default function Home() {
  return (
    <TripHighlightProvider>
      <div className="trip-shell">
        <div className="trip-map-pane">
          <Suspense fallback={<div aria-hidden className={MAP_FRAME_CLASS} />}>
            <DiaryGlobe />
          </Suspense>
        </div>
        <MapSheet label="Resize the trip list">
          <main className="mx-auto max-w-2xl p-8">
            <Suspense fallback={<DiarySkeleton />}>
              <DiaryContent />
            </Suspense>
          </main>
        </MapSheet>
      </div>
    </TripHighlightProvider>
  );
}

// Both are exported for page.test.tsx: React's client renderer rejects an async
// function component reached through JSX, so the resolved paths are tested by
// calling them directly. Same reason the trip layout exports MapForTrip.

/** One array per server render, so `useMapTrips`'s effect dependency is stable
 *  across the client's re-renders — a fresh literal would setData on each one. */
export async function DiaryGlobe() {
  return <DiaryMap trips={await readTrips()} styleUrl={config.mapStyleUrl} />;
}

/** The diary's own copy and its trips. Reads the same two cached resources the
 *  globe does, and is served from the cache rather than fetching twice. */
export async function DiaryContent() {
  const [diary, trips] = await Promise.all([getDiary(), readTrips()]);
  return (
    <>
      {diary.ok ? (
        <>
          <h1 className="text-2xl">{diary.value.title?.value ?? "Travel diary"}</h1>
          {diary.value.description && (
            <p className="mt-2 text-muted-foreground">{diary.value.description.value}</p>
          )}
        </>
      ) : (
        <>
          <h1 className="text-2xl">{"This diary is unavailable"}</h1>
          <p className="mt-2 text-muted-foreground">{describeError(diary.error)}</p>
        </>
      )}
      {trips.length === 0 ? (
        // Only when the diary itself read. publishedTripSlugs reads the diary
        // and returns the SAME error, so an unreachable diary would otherwise
        // say it is unavailable AND that it has published nothing.
        diary.ok && <p className="mt-8 text-muted-foreground">{"No trips published yet."}</p>
      ) : (
        <TripList trips={trips} />
      )}
    </>
  );
}

/** Shaped like the real content so the sheet does not jump when it arrives. */
function DiarySkeleton() {
  return (
    <div aria-hidden className="animate-pulse">
      <div className="h-8 w-2/3 rounded-sm bg-surface" />
      <div className="mt-2 h-4 w-full rounded-sm bg-surface" />
      <div className="mt-8 space-y-3">
        <div className="h-4 w-1/2 rounded-sm bg-surface" />
        <div className="h-4 w-2/5 rounded-sm bg-surface" />
      </div>
    </div>
  );
}

/** A row and a marker are the same object: the list reads slug, name and dates,
 *  the globe reads slug, name and centre. */
type DiaryTrip = TripListItem & TripPoint;

async function readTrips(): Promise<DiaryTrip[]> {
  // publishedTripSlugs is the publication boundary: trips have no index acting
  // as one the way entries do.
  const published = await publishedTripSlugs();
  if (!published.ok) return [];
  const rows = await Promise.all(published.value.map(readTrip));
  return rows.filter((row) => row !== null);
}

async function readTrip(slug: string): Promise<DiaryTrip | null> {
  const [trip, index] = await Promise.all([getTrip(slug), getTripIndex(slug)]);
  // A trip that will not read has nothing to show; a trip whose INDEX will not
  // read keeps its row and loses only its marker, because the list is the
  // navigation. Losing one index must not lose the diary.
  if (!trip.ok) return null;
  return {
    slug,
    name: trip.value.name.value,
    // Verbatim: the schema types these as xsd:date strings, so no parsing and
    // no formatting crosses into the client.
    startDate: trip.value.startDate,
    endDate: trip.value.endDate,
    center: index.ok ? index.value.center : undefined,
    bbox: index.ok ? index.value.bbox : undefined,
  };
}

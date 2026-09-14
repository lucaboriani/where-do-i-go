import { Suspense } from "react";
import MapSheet from "@/components/public/map-sheet";
import TripHighlightProvider from "@/components/public/trip-highlight";
import TripMap from "@/components/public/trip-map";
import { MAP_FRAME_CLASS } from "@/lib/map/frame";
import { config } from "@/lib/config";
import { getTripIndex } from "@/lib/pod/cached";

/** The layout, not the page, keeps ONE map alive across trip → entry → entry,
 *  and the shell keeps it a SIBLING of the sheet at every width.
 *  ./notes.md#why-the-map-lives-in-the-layout */
export default function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  return (
    <TripHighlightProvider>
      <div className="trip-shell">
        <div className="trip-map-pane">
          <Suspense fallback={<div aria-hidden className={MAP_FRAME_CLASS} />}>
            <MapForTrip params={params} />
          </Suspense>
        </div>
        <MapSheet>{children}</MapSheet>
      </div>
    </TripHighlightProvider>
  );
}

// Exported for layout.test.tsx: React's client renderer rejects an async
// function component reached through JSX, so the resolved path is tested by
// calling this directly rather than by rendering <MapForTrip />.
export async function MapForTrip({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = await getTripIndex(slug);
  // A trip whose index will not read still gets a map, just an unfitted one.
  // Losing the index must not lose the page — the same rule page.tsx follows.
  return (
    <TripMap
      bbox={index.ok ? index.value.bbox : undefined}
      styleUrl={config.mapStyleUrl}
      entries={index.ok ? index.value.entries : undefined}
    />
  );
}

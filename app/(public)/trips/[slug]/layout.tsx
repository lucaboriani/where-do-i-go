import { Suspense } from "react";
import TripMap, { MAP_FRAME_CLASS } from "@/components/public/trip-map";
import { config } from "@/lib/config";
import { getTripIndex } from "@/lib/pod/cached";

/** The layout, not the page, is what keeps ONE map alive across trip → entry →
 *  entry: Next preserves layout state on navigation. ./notes.md#why-the-map-lives-in-the-layout */
export default function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  return (
    <>
      <Suspense fallback={<div aria-hidden className={MAP_FRAME_CLASS} />}>
        <MapForTrip params={params} />
      </Suspense>
      {children}
    </>
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

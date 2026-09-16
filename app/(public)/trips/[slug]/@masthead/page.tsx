import { Suspense } from "react";
import { getTrip } from "@/lib/pod/cached";

// Exported for page.test.tsx: React's client renderer rejects an async
// function component reached through JSX — same reason TripContent,
// EntryContent and DiaryContent are exported.
export async function TripMasthead({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const trip = await getTrip(slug);

  // Both slots render for every request (Next's own parallel-routes guide:
  // "Authorize inside each slot's page"). TripContent owns the 404 for a
  // missing/draft trip; this guard only stops the NAME leaking into the
  // banner before that 404 lands — no known-slugs check here, so a Pod
  // hiccup just means no banner, never a slot-level 404 of its own.
  if (!trip.ok || trip.value.status !== "published") return null;

  return (
    <div className="masthead">
      <div className="wrap">
        <h1 className="display trip-title">{trip.value.name.value}</h1>
        <p className="data-lg">
          {[trip.value.startDate, trip.value.endDate].filter(Boolean).join(" – ")}
        </p>
        {trip.value.description && (
          <p className="mt-4 max-w-prose text-muted-foreground">
            {trip.value.description.value}
          </p>
        )}
      </div>
    </div>
  );
}

// The Suspense boundary sits in the segment, not just the layout: instant
// validation checks this slot's own shell, and params/getTrip must stream
// behind a boundary here. ../notes.md#why-the-masthead-slot-mirrors-the-entry-route
export default function MastheadPage(props: { params: Promise<{ slug: string }> }) {
  return (
    <Suspense fallback={null}>
      <TripMasthead params={props.params} />
    </Suspense>
  );
}

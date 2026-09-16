import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allTripSlugs, getTrip, getTripIndex, publishedTripSlugs } from "@/lib/pod/cached";
import { describe } from "@/lib/pod/result";
import { SiteFooter } from "@/components/public/site-footer";
import TripTimeline from "@/components/public/trip-timeline";
import { config } from "@/lib/config";

export async function generateStaticParams() {
  return (await allTripSlugs()).map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const trip = await getTrip(slug);
  // A draft's name must not reach <title> or the OG tags. generateMetadata runs
  // even when the page body renders not-found, so without this check the draft
  // title leaks into the served HTML and into link previews.
  if (!trip.ok || trip.value.status !== "published") return { title: "Not found" };
  return {
    title: trip.value.name.value,
    description: trip.value.description?.value,
  };
}

/** The page itself does NOT await params: reading URL data here would block the
 *  static shell, which is what makes a navigation feel slow and is what Next's
 *  instant-navigation validation flags. The promise is passed down and awaited
 *  inside <Suspense>, so the shell is served instantly. */
export default function TripPage(props: { params: Promise<{ slug: string }> }) {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <Suspense fallback={<TripSkeleton />}>
        <TripContent params={props.params} />
      </Suspense>
    </main>
  );
}

/** Shaped like the real content so the page does not jump when it arrives.
 *  The name/dates block is the @masthead slot's own fallback now, not this
 *  one's — this only shapes the timeline TripContent still owns. */
function TripSkeleton() {
  return (
    <div aria-hidden className="animate-pulse space-y-3">
      <div className="h-4 w-1/2 rounded-sm bg-surface" />
      <div className="h-4 w-2/5 rounded-sm bg-surface" />
    </div>
  );
}

// Exported for page.test.tsx: React's client renderer rejects an async
// function component reached through JSX, so the resolved path is tested by
// calling it directly — same reason EntryContent and DiaryContent are exported.
export async function TripContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Second line of defence only. proxy.ts is what sets the 404 status, because
  // under Partial Prerendering the shell is flushed before this code runs and a
  // notFound() here arrives too late to change the status (decisions.md §24).
  // This still matters: when the proxy fails open — a deliberate choice, so a
  // Pod hiccup never 404s real content — this renders the right body.
  const known = await publishedTripSlugs();
  if (known.ok && !known.value.includes(slug)) notFound();

  const [trip, index] = await Promise.all([getTrip(slug), getTripIndex(slug)]);

  // A missing trip must be a 404, not a 200 carrying an error message.
  // Servers disagree on which status "absent" is: CSS answers 404, while Inrupt
  // ESS answers 401 to anonymous callers precisely so it does not reveal
  // whether a resource exists (docs/phase-0-spike.md). Treat both as absent.
  if (!trip.ok && trip.error.kind === "http" && [401, 403, 404].includes(trip.error.status)) {
    notFound();
  }

  // A draft trip that happens to be readable is still not published.
  if (trip.ok && trip.value.status !== "published") notFound();

  // The name, dates and description live in the @masthead slot now
  // (layout.tsx renders it above .trip-shell); this only describes a failed
  // trip read, which is not that slot's concern.
  return (
    <>
      {!trip.ok && <p className="text-muted-foreground">{describe(trip.error)}</p>}

      {index.ok ? (
        <TripTimeline slug={slug} entries={index.value.entries} />
      ) : (
        // The index is one resource. Losing it must not lose the trip page.
        <p className="mt-8 text-muted-foreground">{describe(index.error)}</p>
      )}

      <SiteFooter siteName={config.siteName} />
    </>
  );
}

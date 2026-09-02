import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { allTripSlugs, getTrip, getTripIndex } from "@/lib/pod/cached";
import { describe } from "@/lib/pod/result";

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

export default async function TripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Reject an unknown slug against the cached trip list BEFORE touching
  // anything dynamic. Under Partial Prerendering the shell is flushed before
  // the dynamic part resolves, so a notFound() further down arrives after the
  // status line is committed and yields 200 carrying 404 content — a soft 404,
  // which is exactly what a site that server-renders for SEO cannot afford.
  // allTripSlugs is already cached and tagged, so this costs no extra fetch.
  if (!(await allTripSlugs()).includes(slug)) notFound();

  const [trip, index] = await Promise.all([getTrip(slug), getTripIndex(slug)]);

  // A missing trip must be a 404, not a 200 carrying an error message.
  // Servers disagree on which status "absent" is: CSS answers 404, while Inrupt
  // ESS answers 401 to anonymous callers precisely so it does not reveal
  // whether a resource exists (docs/phase-0-spike.md). Treat both as absent.
  if (!trip.ok && trip.error.kind === "http" && [401, 403, 404].includes(trip.error.status)) {
    notFound();
  }

  // A draft trip that happens to be readable is still not published. The entry
  // page has always enforced this; the trip page did not, which left the
  // boundary depending on an ACL rather than on the data.
  if (trip.ok && trip.value.status !== "published") notFound();

  return (
    <main className="mx-auto max-w-2xl p-8">
      {trip.ok ? (
        <>
          <h1 className="text-2xl">{trip.value.name.value}</h1>
          {trip.value.description && (
            <p className="mt-2 text-muted-foreground">{trip.value.description.value}</p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {[trip.value.startDate, trip.value.endDate].filter(Boolean).join(" – ")}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">{describe(trip.error)}</p>
      )}

      {index.ok ? (
        <ol className="mt-8 space-y-3">
          {index.value.entries.map((e) => (
            <li key={e.iri}>
              <Link className="text-accent-bright underline" href={`/trips/${slug}/${e.slug}`}>
                {e.title.value}
              </Link>
              {e.occurredAt && (
                <span className="ml-2 text-sm text-muted-foreground">
                  {e.occurredAt.slice(0, 10)}
                </span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        // The index is one resource. Losing it must not lose the trip page.
        <p className="mt-8 text-muted-foreground">{describe(index.error)}</p>
      )}
    </main>
  );
}

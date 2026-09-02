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
  if (!trip.ok) return { title: slug };
  return {
    title: trip.value.name.value,
    description: trip.value.description?.value,
  };
}

export default async function TripPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [trip, index] = await Promise.all([getTrip(slug), getTripIndex(slug)]);

  // A missing trip must be a 404, not a 200 carrying an error message.
  // Servers disagree on which status "absent" is: CSS answers 404, while Inrupt
  // ESS answers 401 to anonymous callers precisely so it does not reveal
  // whether a resource exists (docs/phase-0-spike.md). Treat both as absent.
  if (!trip.ok && trip.error.kind === "http" && [401, 403, 404].includes(trip.error.status)) {
    notFound();
  }

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

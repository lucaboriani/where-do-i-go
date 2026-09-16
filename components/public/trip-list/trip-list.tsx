import Link from "next/link";
import TripRow from "./trip-row";

export type TripListItem = { slug: string; name: string; startDate?: string; endDate?: string };

/** Unnumbered, unlike the per-trip timeline: a filtered grid of trips is a
 *  set, not a sequence. docs/design-brief.md §5. */
export default function TripList({ trips }: { trips: TripListItem[] }) {
  return (
    <ul className="mt-8 space-y-1">
      {trips.map((trip) => {
        // The link renders HERE, on the server: a <Link> inside the client row
        // shipped a second copy of next/link, measured at 3.4 kB gzip.
        // ./notes.md#the-link-renders-on-the-server
        const dates = [trip.startDate, trip.endDate].filter(Boolean).join(" – ");
        return (
          <TripRow key={trip.slug} slug={trip.slug}>
            <Link className="row-title" href={`/trips/${trip.slug}`}>
              {trip.name}
            </Link>
            {dates !== "" && <span className="data ml-2">{dates}</span>}
          </TripRow>
        );
      })}
    </ul>
  );
}

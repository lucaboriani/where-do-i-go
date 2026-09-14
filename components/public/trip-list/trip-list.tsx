import Link from "next/link";
import TripRow from "./trip-row";

export type TripListItem = { slug: string; name: string; startDate?: string; endDate?: string };

/** Numbering is sanctioned here for the same reason the timeline numbers its
 *  entries: a diary's trips are a sequence. docs/design-brief.md */
export default function TripList({ trips }: { trips: TripListItem[] }) {
  return (
    <ol className="mt-8 list-inside list-decimal space-y-1">
      {trips.map((trip) => {
        // The link renders HERE, on the server: a <Link> inside the client row
        // shipped a second copy of next/link, measured at 3.4 kB gzip.
        // ./notes.md#the-link-renders-on-the-server
        const dates = [trip.startDate, trip.endDate].filter(Boolean).join(" – ");
        return (
          <TripRow key={trip.slug} slug={trip.slug}>
            <Link className="text-accent-bright underline" href={`/trips/${trip.slug}`}>
              {trip.name}
            </Link>
            {dates !== "" && (
              <span className="ml-2 font-mono text-sm text-muted-foreground">{dates}</span>
            )}
          </TripRow>
        );
      })}
    </ol>
  );
}

import Link from "next/link";
import { orderEntries } from "@/lib/map/legs";
import { wallClockOf } from "@/lib/time/offsets";
import { precisionLabel } from "@/lib/place/precision";
import type { IndexEntry } from "@/lib/pod/schema";
import TimelineRow from "./timeline-row";

/** Numbering is sanctioned here specifically — entries within a trip are a
 *  sequence. docs/design-brief.md, and preflight removes the marker unless the
 *  list re-enables it. */
export default function TripTimeline({ slug, entries }: { slug: string; entries: IndexEntry[] }) {
  return (
    <ol className="mt-8 list-inside list-decimal space-y-1">
      {orderEntries(entries).map((entry) => {
        // The link and the time are rendered HERE, on the server: a <Link> inside
        // the client row shipped a second copy of next/link, measured at 3.4 kB
        // gzip in the trip page's own chunk. ./notes.md#why-the-row-takes-children
        const wall = wallClockOf(entry.occurredAt);
        return (
          <TimelineRow key={entry.iri} slug={entry.slug}>
            {entry.thumbnail !== undefined && (
              /* eslint-disable-next-line @next/next/no-img-element --
                 next/image wants images.remotePatterns for an arbitrary Pod
                 origin and ships a client component for a 40px square; the map
                 marker builds the same <img> by hand. Remove when the Pod origin
                 becomes a configured host. */
              <img
                src={entry.thumbnail}
                alt=""
                role="presentation"
                loading="lazy"
                width={40}
                height={40}
                className="mr-2 inline-block size-10 rounded-sm bg-surface object-cover align-middle"
              />
            )}
            <Link className="text-accent-bright underline" href={`/trips/${slug}/${entry.slug}`}>
              {entry.title.value}
            </Link>
            {wall !== "" && (
              <time
                dateTime={entry.occurredAt}
                className="ml-2 font-mono text-sm text-muted-foreground"
              >
                <span>{wall.slice(0, 10)}</span> <span>{wall.slice(11, 16)}</span>
              </time>
            )}
            {entry.travelModeFrom !== undefined && (
              <span className="ml-2 font-mono text-xs uppercase text-muted-foreground">
                {entry.travelModeFrom}
              </span>
            )}
            {entry.precisionMeters !== undefined && (
              <span className="ml-2 font-mono text-xs text-muted-foreground">
                {precisionLabel(entry.precisionMeters)}
              </span>
            )}
          </TimelineRow>
        );
      })}
    </ol>
  );
}

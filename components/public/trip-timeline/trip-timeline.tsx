import Link from "next/link";
import { orderEntries } from "@/lib/map/legs";
import { wallClockOf } from "@/lib/time/offsets";
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
            <Link className="row-title" href={`/trips/${slug}/${entry.slug}`}>
              {entry.title.value}
            </Link>
            {wall !== "" && (
              <time dateTime={entry.occurredAt} className="data ml-2">
                <span>{wall.slice(0, 10)}</span> <span>{wall.slice(11, 16)}</span>
              </time>
            )}
            {entry.lat !== undefined && entry.long !== undefined && (
              <span
                className={
                  entry.precisionMeters === undefined ? "ml-2 precision exact" : "ml-2 precision"
                }
              >
                {formatCoordinate(entry.lat, entry.long, entry.precisionMeters)}
              </span>
            )}
            {entry.travelModeFrom !== undefined && (
              <span className="label ml-2">{entry.travelModeFrom}</span>
            )}
          </TimelineRow>
        );
      })}
    </ol>
  );
}

/** Fewer decimals when fuzzed, more when exact — the same rule EntryContent's
 *  MetaRow applies, so an exact reading never implies precision a fuzzed one
 *  does not. docs/design-brief.md. */
function formatCoordinate(lat: number, long: number, precisionMeters?: number): string {
  const decimals = precisionMeters === undefined ? 4 : 2;
  const latAbs = Math.abs(lat).toFixed(decimals);
  const longAbs = Math.abs(long).toFixed(decimals);
  return `${latAbs}°${lat < 0 ? "S" : "N"} ${longAbs}°${long < 0 ? "W" : "E"}`;
}

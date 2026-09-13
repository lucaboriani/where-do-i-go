import { orderEntries } from "@/lib/map/legs";
import type { IndexEntry } from "@/lib/pod/schema";
import TimelineRow from "./timeline-row";

/** Numbering is sanctioned here specifically — entries within a trip are a
 *  sequence. docs/design-brief.md. */
export default function TripTimeline({ slug, entries }: { slug: string; entries: IndexEntry[] }) {
  return (
    <ol className="mt-8 space-y-1">
      {orderEntries(entries).map((entry) => (
        <TimelineRow key={entry.iri} href={`/trips/${slug}/${entry.slug}`} entry={entry} />
      ))}
    </ol>
  );
}

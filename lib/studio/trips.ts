/**
 * The trips the studio may write an entry into, read by ENUMERATING the trips
 * container and never by reading the public diary (§4). STUDIO-ONLY, and two
 * rules hold it: ./notes.md#two-rules-this-module-is-held-to
 * ./notes.md#why-the-studio-enumerates-instead-of-reading-the-diary
 */

import { documentUrlOf } from "@/lib/pod/entry-model";
import { readTrip } from "@/lib/pod/read";
import { ok, type Result } from "@/lib/pod/result";
import { listContainer } from "@/lib/pod/write";
import type { PodFetch } from "@/lib/pod/rdf";
import type { Status, Trip } from "@/lib/pod/schema";

/* ─────────────────────────────────────────────────────────────────── shape ── */

/**
 * One trip the owner may write into. Structurally a superset of `EditorTrip`
 * and deliberately not an import of it.
 * ./notes.md#studiotrip-is-a-structural-superset-not-an-import
 */
export interface StudioTrip {
  /** `<…/trip.ttl#it>` — the fragment IRI `dy:trip` points at, never the
   *  document URL. */
  iri: string;
  slug: string;
  /**
   * THE ONE PLACE THE LANGUAGE TAG STOPS, and a decision rather than an
   * oversight: an `<option>` label, in a document that declares its language,
   * that nothing serialises back to the Pod (§6).
   * ./notes.md#the-one-place-the-language-tag-stops
   */
  name: string;
  /** `<…/entries.ttl>` — a DOCUMENT URL with no fragment. `saveEntry` hands
   *  this to `readTripIndexWithEtag` and then to `putGuarded`; the
   *  `<entries.ttl#it>` written in the trip would address nothing. */
  indexUrl: string;
  /** `<…/entries/>`, where the entry resource goes. Trailing slash: in LDP a
   *  container without one is a different resource, and CSS redirects. */
  entriesContainer: string;
  /**
   * `dy:status`, which `EditorTrip` has no room for today. Carried because a
   * published entry in a draft trip is the one mistake the editor cannot undo.
   * ./notes.md#studiotrip-is-a-structural-superset-not-an-import
   */
  status: Status;
}

export type StudioTripListing = {
  trips: StudioTrip[];
  /** `reason` is the `PodError.kind`, exactly as `RebuildReport` records it —
   *  that is what makes the report actionable rather than a count. */
  skipped: { url: string; reason: string }[];
};

/* ─────────────────────────────────────────────────────────────────── layout ─ */

/** §4 fixes all four of these. They are not configurable and never have been. */
const TRIPS_CONTAINER = "travel/trips/";
const TRIP_DOCUMENT = "trip.ttl";
const INDEX_DOCUMENT = "entries.ttl";
const ENTRIES_CONTAINER = "entries/";

export const tripsContainerUrl = (podRoot: string): string =>
  new URL(TRIPS_CONTAINER, podRoot).toString();

/**
 * Phase 0, applied in `rebuildIndex` and recorded in §13 item 6: reads go
 * concurrently, because the serial version costs n × RTT on the one screen the
 * owner waits at before writing anything.
 */
const CONCURRENCY = 12;

/* ───────────────────────────────────────────────────────────────── ordering ─ */

/** Codepoint order, descending. Deliberately not `localeCompare`: the point of
 *  sorting at all is that the list does not move between page loads, and a
 *  locale-sensitive collation makes that a property of the machine. */
const descending = (a: string, b: string): number => (a < b ? 1 : a > b ? -1 : 0);

/**
 * §6: "parse order carries no meaning and must never be relied on." Newest
 * first, with the slug breaking ties so the order is total.
 * ./notes.md#the-ordering-is-explicit-and-locale-independent
 */
const newestFirst = (a: Trip, b: Trip): number =>
  descending(a.startDate ?? "", b.startDate ?? "") || descending(a.slug, b.slug);

/* ───────────────────────────────────────────────────────────────────── read ─ */

function studioTrip(container: string, trip: Trip): StudioTrip {
  return {
    iri: trip.iri,
    slug: trip.slug,
    name: trip.name.value,
    // `dy:index` when the trip declares one — the Pod's own statement about
    // where its index is — and §4's fixed filename when it does not. The
    // predicate has always been optional in the schema, and a Pod holds
    // whatever was written to it, including by an older version of this app.
    // Refusing a trip over a derivable filename would cost the owner the editor
    // for that trip and gain nothing.
    indexUrl: trip.index ? documentUrlOf(trip.index) : `${container}${INDEX_DOCUMENT}`,
    // No predicate names this container; §4 does, and it is the same fact that
    // makes /trips/[slug] resolvable without a lookup.
    entriesContainer: `${container}${ENTRIES_CONTAINER}`,
    status: trip.status,
  };
}

/**
 * Every trip in the Pod, drafts included. "No trips yet" and "your Pod would
 * not answer" are deliberately different values, and one unreadable trip is
 * skipped and reported rather than fatal.
 * ./notes.md#empty-is-not-the-same-as-unreadable
 */
export async function listStudioTrips(opts: {
  /** The session's authenticated fetch. Required. See rule 1 above. */
  fetch: PodFetch;
  /** The Pod root, as a parameter. See rule 2 above. */
  podRoot: string;
}): Promise<Result<StudioTripListing>> {
  const container = tripsContainerUrl(opts.podRoot);

  const listed = await listContainer(opts.fetch, container);
  // Structured, and passed through unflattened: the caller renders different
  // words for 403 (an access problem) than for 404 (no container, so first-run
  // setup never ran) than for a network failure.
  if (!listed.ok) return listed;

  /**
   * A trip is a CHILD CONTAINER, and both halves of that matter: `<>` also ends
   * in "/", and a `.ttl` filter reads `trip.ttl` instead. A member that is not
   * a trip is FILTERED, not reported.
   * ./notes.md#a-trip-is-a-child-container-and-both-halves-of-that-matter
   */
  const members = listed.value.filter(
    (member) => member !== container && member.startsWith(container) && member.endsWith("/"),
  );

  const found: { container: string; trip: Trip }[] = [];
  const skipped: { url: string; reason: string }[] = [];

  for (let i = 0; i < members.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      members.slice(i, i + CONCURRENCY).map(async (member) => {
        const url = `${member}${TRIP_DOCUMENT}`;
        return [member, url, await readTrip(url, { fetch: opts.fetch })] as const;
      }),
    );
    for (const [member, url, read] of batch) {
      if (read.ok) found.push({ container: member, trip: read.value });
      else skipped.push({ url, reason: read.error.kind });
    }
  }

  found.sort((a, b) => newestFirst(a.trip, b.trip));

  return ok({ trips: found.map((f) => studioTrip(f.container, f.trip)), skipped });
}

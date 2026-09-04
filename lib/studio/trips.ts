/**
 * The trips the studio may write an entry into, read out of the Pod by
 * ENUMERATING the trips container — not by reading the public diary.
 *
 * STUDIO-ONLY. It lives in lib/studio rather than lib/pod because it is one
 * half of §4's two-source split rather than a general read: the public site has
 * no business enumerating anything. eslint.config.mjs fences the directory off
 * from app/(public)/** and components/public/**, and test/studio-trips.test.ts
 * pins that this module is inside the fence rather than beside it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT `readDiary()`. docs/data-model.md §4, "The index is the publication
 * boundary", gives each side exactly one source of truth:
 *
 *   > The **public site** reads `entries.ttl` and can therefore never leak a
 *   > draft title […] The **studio** is authenticated and enumerates `entries/`
 *   > directly via `ldp:contains`, so it sees drafts and published entries
 *   > alike.
 *
 * The same split one level up. `travel/diary.ttl` is the public trip list, so a
 * studio built on it would list PUBLISHED trips only, and the owner could never
 * add an entry to a draft trip — which is most of what a draft trip is for. So
 * this path never fetches the diary at all, and a test asserts the absence of
 * that request rather than merely the presence of the draft.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT COMPOSES, IT DOES NOT REIMPLEMENT.
 *
 *   - `listContainer` does the enumeration. It parses with a baseIRI, which is
 *     what makes a container's relative member IRIs resolve (phase 0: "container
 *     listings use relative IRIs"). A second hand-rolled listing here would be a
 *     second place to forget that.
 *   - `readTrip` does the reading, so every trip on this list has been through
 *     the same schemaVersion check, datatype checks and slug assertion as one
 *     read by the public site.
 *   - `rebuildIndex` is the model for the rest: bounded concurrency, and one
 *     unreadable member reported rather than fatal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RULES IT IS HELD TO, both load-bearing rather than stylistic:
 *
 *   1. THE FETCH IS INJECTED AND NEVER DEFAULTED. It is the session's
 *      authenticated one, the same rule `saveEntry` states. Falling back to the
 *      ambient `fetch` does not fail loudly: against a Pod whose trips container
 *      IS publicly readable it returns a list that silently omits every draft,
 *      which looks exactly like success. Nothing is imported from
 *      @inrupt/solid-client-authn-browser here — not even to reach a session —
 *      so there is no second way to obtain a credential.
 *   2. IT READS NO CONFIG AND NO ENV VAR. POD_ROOT is not `NEXT_PUBLIC_`, so
 *      lib/config.ts throws the moment it is reached in a browser, and this
 *      module runs in the browser. The root arrives as a parameter, handed down
 *      as a prop by the thin server component exactly as `ownerWebId`,
 *      `oidcIssuer`, `siteUrl` and `siteName` already are.
 */

import { documentUrlOf } from "@/lib/pod/entry-model";
import { readTrip } from "@/lib/pod/read";
import { ok, type Result } from "@/lib/pod/result";
import { listContainer } from "@/lib/pod/write";
import type { PodFetch } from "@/lib/pod/rdf";
import type { Status, Trip } from "@/lib/pod/schema";

/* ─────────────────────────────────────────────────────────────────── shape ── */

/**
 * One trip the owner may write into.
 *
 * Structurally a superset of `EditorTrip`, the prop type
 * components/studio/entry-editor.tsx publishes — deliberately NOT an import of
 * it, because a lib/ module importing a type from a component is backwards
 * layering. The editor only cares that the object fits, and `tsc` checks that
 * it does at the call site.
 */
export interface StudioTrip {
  /** `<…/trip.ttl#it>` — the fragment IRI `dy:trip` points at, never the
   *  document URL. */
  iri: string;
  slug: string;
  /**
   * THE ONE PLACE THE LANGUAGE TAG STOPS, and it is a decision rather than an
   * oversight.
   *
   * §6 language-tags every human-readable literal, and `Trip.name` off
   * `readTrip` honours that: it is `{ value, language }`. This field is a plain
   * string, so the tag is discarded here.
   *
   * Acceptable because of what this value is FOR: the label of an `<option>` in
   * the owner's trip picker, rendered inside a document that already declares
   * its language, chosen by the one person who wrote the name in the first
   * place. Nothing downstream serialises it back to the Pod — the editor writes
   * `dy:trip <iri>`, never a name — so no untagged literal can reach a Pod
   * through this path, which is the failure §6 exists to prevent.
   *
   * The tag would start mattering the moment a trip carried its name in more
   * than one language, or the moment this list drove anything but a label. Then
   * this becomes `LangText` and the picker picks a tag; it is not that today,
   * and carrying a tag nothing reads would be its own kind of lie.
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
   * `dy:status`, which `EditorTrip` has no room for today.
   *
   * Carried because this list exists precisely to contain drafts, and a picker
   * that shows a draft trip and a published trip identically invites the one
   * mistake that cannot be undone from the editor: writing a PUBLISHED entry
   * into a DRAFT trip yields a public entry whose trip is not public. Surfacing
   * it is the next increment's job; making the fact available is this one's.
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
 * §6: "parse order carries no meaning and must never be relied on." Without an
 * explicit order the owner's trip picker reshuffles whenever the server
 * serialises its container differently, which is a bug that only ever shows up
 * as a mis-click.
 *
 * Newest first: the trip being written into is almost always the current one.
 * `xsd:date` is lexicographically ordered, so a string compare is a date
 * compare, and an absent `dy:startDate` sorts to the end under descending order
 * without a special case. The slug breaks ties — a total order, so the result
 * cannot depend on the sort being stable either.
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
 * Every trip in the Pod, drafts included.
 *
 * "No trips yet" and "your Pod would not answer" are deliberately different
 * values. An empty container is `ok` with an empty list — a new deployer has
 * written nothing, and the studio's "no trips" note is written for exactly that
 * person. A failed enumeration (403, 404, unreachable) is a structured error,
 * because telling that owner to write their first trip when the truth is that
 * their Pod is misconfigured sends them somewhere no amount of writing helps.
 *
 * One unreadable trip is skipped and reported, never fatal — `rebuildIndex`'s
 * rule verbatim: "a single bad resource must not make the whole trip
 * unrecoverable". Here it is the whole editor at stake.
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
   * A trip is a CHILD CONTAINER, and both halves of that matter.
   *
   *   - `<>` in a container listing resolves to the container itself, and it
   *     ends in "/" exactly as a trip does, so a bare "keep the containers"
   *     filter walks straight into `travel/trips/trip.ttl`.
   *   - `notes.ttl` is the mirror image: the filter `rebuildIndex` uses keeps
   *     `.ttl` members, which one level up reads the stray file and skips every
   *     real trip.
   *
   * A member that is not a trip is FILTERED, not reported. Reporting it would
   * make `skipped` noisy on every real Pod, and noise is how an actually
   * skipped trip goes unnoticed.
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

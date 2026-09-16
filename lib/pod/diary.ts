/**
 * `diary.ttl` maintenance — the published-only publication boundary (§7.1). A
 * diary entry is a BARE `dy:trip <…/trip.ttl#it>` triple on `<#it>`; add/remove
 * touch exactly that one triple via read-modify-write, `If-Match` (§10).
 * STUDIO ONLY: imported by `save-trip.ts`'s `publishTrip`/`unpublishTrip`.
 */
import { DataFactory, Writer, type Quad } from "n3";
import { DCTERMS, DY, DY_CLASS, NS, RDF } from "@/lib/vocab";
import { diaryUrl, readDiaryWithEtag as readDiaryAt } from "./read";
import { dt, int, text } from "./literals";
import { err, ok, type Result } from "./result";
import { putGuarded, type Precondition } from "./write";
import type { PodFetch } from "./rdf";
import type { Diary, Status } from "./schema";

const { namedNode, quad } = DataFactory;

/** The diary, plus its ETag, keyed off the Pod root rather than the resource
 *  URL — the shape `publishTrip`/`unpublishTrip` call with, mirroring
 *  `readTripIndexWithEtag` one level up. */
export async function readDiaryWithEtag(
  podRoot: string,
  opts?: { fetch?: PodFetch },
): Promise<Result<{ diary: Diary; etag: string | null }>> {
  return readDiaryAt(diaryUrl(podRoot), { fetch: opts?.fetch });
}

/** Round-trips every field `readDiary` produces, so add/remove never drops
 *  title, description or creator on their way back to the Pod. Byte-level
 *  formatting is not normative (§11) — compare by triple set, never bytes. */
function serialiseDiary(diary: Diary): Promise<string> {
  const it = namedNode(diary.iri);
  const quads: Quad[] = [
    quad(it, namedNode(RDF.type), namedNode(DY_CLASS.Diary)),
    quad(it, namedNode(DY.schemaVersion), int(diary.schemaVersion)),
    ...(diary.title ? [quad(it, namedNode(DCTERMS.title), text(diary.title))] : []),
    ...(diary.description ? [quad(it, namedNode(DCTERMS.description), text(diary.description))] : []),
    ...(diary.creator ? [quad(it, namedNode(DCTERMS.creator), namedNode(diary.creator))] : []),
    ...(diary.modified ? [quad(it, namedNode(DCTERMS.modified), dt(diary.modified))] : []),
    ...diary.trips.map((iri) => quad(it, namedNode(DY.trip), namedNode(iri))),
  ];

  const writer = new Writer({ prefixes: { xsd: NS.xsd, dcterms: NS.dcterms, dy: NS.dy } });
  writer.addQuads(quads);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

/** Read, apply `updateTrips`, write back under `If-Match` — never a blind PUT
 *  (§10). Shared by add and remove; the only difference is the trip list. */
async function mutateDiary(
  fetch: PodFetch,
  podRoot: string,
  updateTrips: (diary: Diary) => string[],
): Promise<Result<null>> {
  const url = diaryUrl(podRoot);
  const read = await readDiaryAt(url, { fetch });
  if (!read.ok) return read;

  const { diary, etag } = read.value;
  const body = await serialiseDiary({ ...diary, trips: updateTrips(diary) });
  const precondition: Precondition = etag ? { etag } : { create: true };
  const written = await putGuarded(fetch, url, body, precondition);
  return written.ok ? ok(null) : err(written.error);
}

export type AddTripToDiaryOptions = {
  fetch: PodFetch;
  podRoot: string;
  trip: { iri: string; status: Status };
};

/**
 * PUBLISHED-ONLY: a draft trip is a no-op that touches the Pod not at all —
 * not even the read half of the read-modify-write — so a draft can never be
 * visible to a reader racing a later publish (§5/§7.1).
 */
export async function addTripToDiary(opts: AddTripToDiaryOptions): Promise<Result<null>> {
  if (opts.trip.status !== "published") return ok(null);
  return mutateDiary(opts.fetch, opts.podRoot, (diary) =>
    diary.trips.includes(opts.trip.iri) ? diary.trips : [...diary.trips, opts.trip.iri],
  );
}

export type RemoveTripFromDiaryOptions = { fetch: PodFetch; podRoot: string; tripIri: string };

/** Unconditional — an unpublish always removes the row, whatever the trip's
 *  prior status. */
export async function removeTripFromDiary(opts: RemoveTripFromDiaryOptions): Promise<Result<null>> {
  return mutateDiary(opts.fetch, opts.podRoot, (diary) =>
    diary.trips.filter((iri) => iri !== opts.tripIri),
  );
}

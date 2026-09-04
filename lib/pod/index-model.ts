/**
 * The trip index, computed and serialised.
 *
 * Pure: no fetching, no writing. This is the part that has to be exactly right,
 * because `rebuildIndex` is three things at once — the recovery path when a
 * multi-step write half-failed, the migration tool when dy:schemaVersion
 * increments, and how a new deployer imports data written by an older version
 * of the app (§10).
 */
import { DataFactory, Writer } from "n3";
import {
  DCTERMS, DY, DY_CLASS, NS, RDF, SCHEMA_VERSION, TRAVEL_MODE,
} from "@/lib/vocab";
import { dec, dt, int, text } from "./literals";
import type { Entry, IndexEntry } from "./schema";

const { namedNode, literal, quad } = DataFactory;

export type IndexRow = {
  fragment: string;
  entryResource: string;
  title: { value: string; language?: string };
  slug: string;
  occurredAt?: string;
  lat?: number;
  long?: number;
  precisionMeters?: number;
  thumbnail?: string;
  travelModeFrom?: keyof typeof TRAVEL_MODE;
  sortOrder: number;
};

export type ComputedIndex = {
  rows: IndexRow[];
  entryCount: number;
  bbox?: { west: number; south: number; east: number; north: number };
  center?: { lat: number; long: number };
};

/**
 * A row before the two derived fields are assigned.
 *
 * `fragment` and `sortOrder` are NOT inputs: both are recomputed from the whole
 * set every time, which is what stops an incremental update from leaving
 * `dy:sortOrder` describing an order the set no longer has.
 */
export type IndexRowInput = Omit<IndexRow, "fragment" | "sortOrder">;

/** The row an entry contributes. No status check here — the caller decides what
 *  reaches the index, because `saveEntry` also has to REMOVE the row for an
 *  entry it has just unpublished, which is not something a filter can express. */
export function rowOfEntry(entry: Entry): IndexRowInput {
  return {
    entryResource: entry.iri,
    title: entry.headline,
    slug: entry.slug,
    occurredAt: entry.occurredAt,
    lat: entry.place?.geo?.lat,
    long: entry.place?.geo?.long,
    precisionMeters: entry.place?.geo?.precisionMeters,
    travelModeFrom: entry.travelModeFrom,
    thumbnail: entry.photos[0]?.thumbnailUrl,
  };
}

/**
 * A row already in the index, back as an input.
 *
 * `saveEntry` reads `entries.ttl` and writes it back with one row inserted; the
 * rows it did not touch have to survive that round trip. Reading them through
 * the validated `IndexEntry` model rather than out of the raw triples is what
 * §11 guardrail 2 asks for, and it means a row this version cannot understand
 * fails the read loudly instead of being dropped on the next save.
 */
export function rowOfIndexEntry(row: IndexEntry): IndexRowInput {
  return {
    entryResource: row.entryResource,
    title: row.title,
    slug: row.slug,
    occurredAt: row.occurredAt,
    lat: row.lat,
    long: row.long,
    precisionMeters: row.precisionMeters,
    travelModeFrom: row.travelModeFrom,
    thumbnail: row.thumbnail,
  };
}

/**
 * Only published entries reach the index. This is what makes the boundary hold:
 * the public site reads the index and therefore cannot leak a draft title, even
 * by accident, because the data is not there (§4).
 *
 * Note the narrower guarantee phase 0 established — draft *slugs* can still be
 * enumerated from a publicly readable container. That is a container-ACL
 * problem, not an index problem, and `initialiseContainers` owns it.
 */
export function computeIndex(entries: readonly Entry[]): ComputedIndex {
  return computeIndexFromRows(entries.filter((e) => e.status === "published").map(rowOfEntry));
}

/**
 * The derived half of the index — ordering, numbering, count, bbox, centre —
 * computed from the row set and nothing else.
 *
 * `computeIndex` above is this function fed from entries; `saveEntry` feeds it
 * the surviving rows plus the one it is inserting. Both go through here so
 * there is exactly one implementation of "what the derived values are", which
 * is the difference between recomputing them and incrementing them.
 */
export function computeIndexFromRows(inputs: readonly IndexRowInput[]): ComputedIndex {
  const rows: IndexRow[] = [...inputs]
    // Sort on the INSTANT, not the text. dy:occurredAt carries the local offset
    // of the place (§7.3), so lexical order is not chronological order and a
    // trip that crosses a time zone — the normal case here — would be ordered
    // wrongly. Values are Zod-validated ISO-with-offset, so Date.parse is total.
    // Entries without a timestamp sort first and keep input order; dy:sortOrder
    // then makes the result explicit so parse order is never relied on (§6).
    .sort(
      (a, b) =>
        (a.occurredAt ? Date.parse(a.occurredAt) : -Infinity) -
        (b.occurredAt ? Date.parse(b.occurredAt) : -Infinity),
    )
    // Both derived fields are assigned here and nowhere else. The fragment is
    // regenerated from the slug rather than carried over from whatever was in
    // the index, so a row's identity in the document always follows its slug.
    .map((row, i) => ({ ...row, fragment: `e-${row.slug}`, sortOrder: i + 1 }));

  const points = rows.filter(
    (r): r is IndexRow & { lat: number; long: number } => r.lat !== undefined && r.long !== undefined,
  );

  const bbox = points.length
    ? {
        west: Math.min(...points.map((p) => p.long)),
        south: Math.min(...points.map((p) => p.lat)),
        east: Math.max(...points.map((p) => p.long)),
        north: Math.max(...points.map((p) => p.lat)),
      }
    : undefined;

  return {
    rows,
    entryCount: rows.length,
    bbox,
    // Centre of the bounding box, not a mean of points: the map fits to bounds,
    // and a mean would drag the view toward wherever entries cluster.
    center: bbox
      ? { lat: (bbox.north + bbox.south) / 2, long: (bbox.east + bbox.west) / 2 }
      : undefined,
  };
}

/** Serialise to Turtle. Byte-level formatting is not normative (§11) — compare
 *  these graphs by triple set, never by bytes. */
export async function serialiseIndex(
  indexUrl: string,
  tripIri: string,
  computed: ComputedIndex,
  modified: string,
): Promise<string> {
  const it = namedNode(`${indexUrl}#it`);
  const quads = [
    quad(it, namedNode(RDF.type), namedNode(DY_CLASS.TripIndex)),
    quad(it, namedNode(DY.indexOf), namedNode(tripIri)),
    quad(it, namedNode(DY.schemaVersion), int(SCHEMA_VERSION)),
    quad(it, namedNode(DCTERMS.modified), dt(modified)),
    quad(it, namedNode(DY.entryCount), int(computed.entryCount)),
  ];

  if (computed.bbox) {
    quads.push(
      quad(it, namedNode(DY.bboxWest), dec(computed.bbox.west)),
      quad(it, namedNode(DY.bboxSouth), dec(computed.bbox.south)),
      quad(it, namedNode(DY.bboxEast), dec(computed.bbox.east)),
      quad(it, namedNode(DY.bboxNorth), dec(computed.bbox.north)),
    );
  }
  if (computed.center) {
    quads.push(
      quad(it, namedNode(DY.centerLat), dec(computed.center.lat)),
      quad(it, namedNode(DY.centerLong), dec(computed.center.long)),
    );
  }

  for (const row of computed.rows) {
    const node = namedNode(`${indexUrl}#${row.fragment}`);
    quads.push(
      quad(it, namedNode(DY.entry), node),
      quad(node, namedNode(RDF.type), namedNode(DY_CLASS.IndexEntry)),
      quad(node, namedNode(DY.entryResource), namedNode(row.entryResource)),
      quad(node, namedNode(DCTERMS.title), text(row.title)),
      quad(node, namedNode(DY.slug), literal(row.slug)),
      quad(node, namedNode(DY.sortOrder), int(row.sortOrder)),
    );
    if (row.occurredAt) quads.push(quad(node, namedNode(DY.occurredAt), dt(row.occurredAt)));
    if (row.lat !== undefined) quads.push(quad(node, namedNode(DY.lat), dec(row.lat)));
    if (row.long !== undefined) quads.push(quad(node, namedNode(DY.long), dec(row.long)));
    if (row.precisionMeters !== undefined) {
      quads.push(quad(node, namedNode(DY.precisionMeters), int(row.precisionMeters)));
    }
    if (row.thumbnail) quads.push(quad(node, namedNode(DY.thumbnail), namedNode(row.thumbnail)));
    if (row.travelModeFrom) {
      quads.push(quad(node, namedNode(DY.travelModeFrom), namedNode(TRAVEL_MODE[row.travelModeFrom])));
    }
  }

  const writer = new Writer({
    prefixes: { xsd: NS.xsd, dcterms: NS.dcterms, dy: NS.dy },
  });
  writer.addQuads(quads);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

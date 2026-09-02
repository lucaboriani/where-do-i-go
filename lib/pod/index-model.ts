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
  DCTERMS, DY, DY_CLASS, NS, RDF, SCHEMA_VERSION, TRAVEL_MODE, XSD,
} from "@/lib/vocab";
import { config } from "@/lib/config";
import type { Entry } from "./schema";

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
 * Only published entries reach the index. This is what makes the boundary hold:
 * the public site reads the index and therefore cannot leak a draft title, even
 * by accident, because the data is not there (§4).
 *
 * Note the narrower guarantee phase 0 established — draft *slugs* can still be
 * enumerated from a publicly readable container. That is a container-ACL
 * problem, not an index problem, and `initialiseContainers` owns it.
 */
export function computeIndex(entries: readonly Entry[]): ComputedIndex {
  const published = entries.filter((e) => e.status === "published");

  const rows: IndexRow[] = published
    .map((e, i) => ({
      fragment: `e-${e.slug}`,
      entryResource: e.iri,
      title: e.headline,
      slug: e.slug,
      occurredAt: e.occurredAt,
      lat: e.place?.geo?.lat,
      long: e.place?.geo?.long,
      precisionMeters: e.place?.geo?.precisionMeters,
      travelModeFrom: e.travelModeFrom,
      thumbnail: e.photos[0]?.thumbnailUrl,
      sortOrder: i + 1,
    }))
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
    .map((row, i) => ({ ...row, sortOrder: i + 1 }));

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

/** xsd:decimal has no exponent form. String(1e-7) is "1e-7", which is reachable
 *  through the computed centre when a bbox straddles the equator or prime
 *  meridian narrowly, so format explicitly. */
const decimalLexical = (n: number): string => {
  if (Number.isInteger(n)) return n.toFixed(1);
  const s = String(n);
  if (!/e/i.test(s)) return s;
  // 7 decimal places is ~1cm of latitude; coordinates here are fuzzed anyway.
  return n.toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0");
};
const dec = (n: number) => literal(decimalLexical(n), namedNode(XSD.decimal));
const int = (n: number) => literal(String(n), namedNode(XSD.integer));
const dt = (s: string) => literal(s, namedNode(XSD.dateTime));

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
      quad(node, namedNode(DCTERMS.title), literal(row.title.value, row.title.language ?? config.defaultLanguage)),
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

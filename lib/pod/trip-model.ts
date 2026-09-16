/**
 * The trip resource, serialised — the inverse of `readTrip`, and pure: no
 * fetching, no writing, no clock. `schema:tripOrigin`/`dy:track` are deferred
 * to a later task (task-1-brief.md Task 1.3); this only writes `<#it>`.
 * ./notes.md#the-serialisers-are-pure-and-they-do-not-fuzz
 */
import { DataFactory, Writer, type NamedNode, type Quad } from "n3";
import { DCTERMS, DY, DY_CLASS, NS, RDF, SCHEMA, SCHEMA_VERSION, STATUS } from "@/lib/vocab";
import { date, dt, int, text } from "./literals";
import { documentUrlOf } from "./entry-model";
import { assertSlug } from "./read";
import { err, ok, type Result } from "./result";
import { Trip } from "./schema";

const { namedNode, literal, quad } = DataFactory;

/** Only published trips are `dy:Published`; mirrors `entry-model.ts`'s
 *  `statusIri` — §5 pairs the status with the ACL. */
const statusIri = (status: Trip["status"]) =>
  status === "published" ? STATUS.Published : STATUS.Draft;

/** `<trip.ttl>` → `<entries.ttl#it>`, the trip's own entry index (§7.4). Derived
 *  from the document rather than trusting `trip.index`, so the value is always
 *  well-formed regardless of what the caller populated. */
const indexIriOf = (doc: string) => `${doc.replace(/trip\.ttl$/, "entries.ttl")}#it`;

/** §7.2's `<#it>` — everything but the deferred `schema:tripOrigin`/`dy:track`. */
export function itQuads(it: NamedNode, doc: string, t: Trip): Quad[] {
  const quads: Quad[] = [
    quad(it, namedNode(RDF.type), namedNode(SCHEMA.TouristTrip)),
    quad(it, namedNode(RDF.type), namedNode(DY_CLASS.Trip)),
    quad(it, namedNode(SCHEMA.name), text(t.name)),
    quad(it, namedNode(DY.schemaVersion), int(SCHEMA_VERSION)),
    // A slug is an identifier, not prose — untagged, like the entry slug.
    quad(it, namedNode(DY.slug), literal(t.slug)),
    quad(it, namedNode(DY.status), namedNode(statusIri(t.status))),
    quad(it, namedNode(DY.index), namedNode(indexIriOf(doc))),
  ];

  if (t.description) quads.push(quad(it, namedNode(SCHEMA.description), text(t.description)));
  if (t.startDate) quads.push(quad(it, namedNode(DY.startDate), date(t.startDate)));
  if (t.endDate) quads.push(quad(it, namedNode(DY.endDate), date(t.endDate)));
  if (t.coverImage) quads.push(quad(it, namedNode(DY.coverImage), namedNode(t.coverImage)));
  // Provenance, exactly as `entry-model.ts` carries it forward.
  if (t.created) quads.push(quad(it, namedNode(DCTERMS.created), dt(t.created)));
  if (t.modified) quads.push(quad(it, namedNode(DCTERMS.modified), dt(t.modified)));
  if (t.creator) quads.push(quad(it, namedNode(DCTERMS.creator), namedNode(t.creator)));
  // A tag is a code, not prose: untagged, like the entry tag loop.
  for (const tag of t.tags) quads.push(quad(it, namedNode(DY.tag), literal(tag)));
  return quads;
}

export async function serialiseTrip(trip: Trip): Promise<Result<string>> {
  // Validate on the way OUT as well as the way in — the caller is the studio's
  // form state, typed but assembled from user input (mirrors `serialiseEntry`).
  const parsed = Trip.safeParse(trip);
  if (!parsed.success) {
    return err({
      kind: "shape",
      url: documentUrlOf(trip?.iri ?? ""),
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    });
  }
  const t = parsed.data;
  const doc = documentUrlOf(t.iri);

  /**
   * §11 guardrail 7's invariant on the write side, via the CONTAINER-segment
   * check (`assertSlug`) rather than `assertEntrySlug`, which parses a
   * filename and would compare against "trip" for every trip.ttl.
   */
  const slug = assertSlug(doc, t.slug);
  if (!slug.ok) return slug;

  const it = namedNode(`${doc}#it`);
  const quads = itQuads(it, doc, t);

  const writer = new Writer({
    prefixes: { xsd: NS.xsd, schema: NS.schema, dcterms: NS.dcterms, geo: NS.geo, dy: NS.dy },
  });
  writer.addQuads(quads);
  const turtle = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  return ok(turtle);
}

/**
 * The entry resource, serialised — the inverse of `readEntry`, and pure: no
 * fetching, no writing, no clock. IT DELIBERATELY DOES NOT FUZZ COORDINATES;
 * §9 requires that before the write, in `lib/pod/fuzz.ts`.
 * ./notes.md#the-serialisers-are-pure-and-they-do-not-fuzz
 */
import { DataFactory, Writer, type NamedNode, type Quad } from "n3";
import {
  DCTERMS, DY, DY_CLASS, GEO, NS, RDF, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE,
} from "@/lib/vocab";
import { dec, dt, int, text } from "./literals";
import { assertEntrySlug } from "./read";
import { err, ok, type Result } from "./result";
import { Entry, type GeoPoint } from "./schema";

const { namedNode, literal, quad } = DataFactory;

/**
 * `<doc.ttl#it>` → `<doc.ttl>`. A string operation rather than `new URL(iri)`
 * on purpose: this is the URL that gets PUT and appears in every error report.
 * ./notes.md#documenturlof-is-a-string-operation-on-purpose
 */
export const documentUrlOf = (iri: string) => iri.replace(/#.*$/, "");

/** Only published entries are `dy:Published`; §5 pairs the status with the ACL,
 *  and `saveEntry` sets both from this same field. */
const statusIri = (status: Entry["status"]) =>
  status === "published" ? STATUS.Published : STATUS.Draft;

/** A place as `Entry` holds it. Spelled from `Entry` rather than imported from
 *  `lib/studio/place`, which sits ABOVE this module and imports it. */
type EntryPlace = NonNullable<Entry["place"]>;

/** Builds the document's fragment subjects. Passed down rather than rebuilt per
 *  clause, so `#place` here and `#place` there are the same term by construction. */
type Frag = (name: string) => NamedNode;

/**
 * §7.3's five subjects, one exported helper each — `<#it>`, `<#place>`,
 * `<#address>`, `<#geo>`, `<#photo-n>`. The boundary is the fixture's and not
 * convenience's, so a clause that changes in §7.3 changes in one function here.
 */
export function itQuads(it: NamedNode, e: Entry): Quad[] {
  const quads: Quad[] = [
    // Both classes: schema:BlogPosting is the interop surface Google reads,
    // dy:Entry is what this app's reader gates on.
    quad(it, namedNode(RDF.type), namedNode(SCHEMA.BlogPosting)),
    quad(it, namedNode(RDF.type), namedNode(DY_CLASS.Entry)),
    quad(it, namedNode(SCHEMA.headline), text(e.headline)),
    // Written, not echoed from the entry: this is the version THIS code
    // produces. §11 guardrail 3 — without it the read-side version gate rejects
    // everything the app writes.
    quad(it, namedNode(DY.schemaVersion), int(SCHEMA_VERSION)),
    // A slug is an identifier, not prose. Tagging it would make it a different
    // RDF term from the one §7.3 shows.
    quad(it, namedNode(DY.slug), literal(e.slug)),
    quad(it, namedNode(DY.status), namedNode(statusIri(e.status))),
  ];

  if (e.articleBody) quads.push(quad(it, namedNode(SCHEMA.articleBody), text(e.articleBody)));
  if (e.datePublished) quads.push(quad(it, namedNode(SCHEMA.datePublished), dt(e.datePublished)));
  if (e.trip) quads.push(quad(it, namedNode(DY.trip), namedNode(e.trip)));
  if (e.occurredAt) quads.push(quad(it, namedNode(DY.occurredAt), dt(e.occurredAt)));
  if (e.travelModeFrom) {
    quads.push(quad(it, namedNode(DY.travelModeFrom), namedNode(TRAVEL_MODE[e.travelModeFrom])));
  }
  // Provenance. `created` is NOT redundant with `datePublished` (§7.3): they
  // differ by however long the draft sat, and an edit that drops it destroys
  // that difference permanently.
  if (e.created) quads.push(quad(it, namedNode(DCTERMS.created), dt(e.created)));
  if (e.modified) quads.push(quad(it, namedNode(DCTERMS.modified), dt(e.modified)));
  if (e.creator) quads.push(quad(it, namedNode(DCTERMS.creator), namedNode(e.creator)));
  // A tag is a code, not prose: untagged, like the slug.
  for (const tag of e.tags) quads.push(quad(it, namedNode(DY.tag), literal(tag)));
  return quads;
}

/** §7.3 `<#place>`. The two sub-subjects below it are conditional on there
 *  being something to say, so an emptied place is a typed node and no more. */
export function placeQuads(frag: Frag, it: NamedNode, place: EntryPlace, language?: string): Quad[] {
  const node = frag("place");
  const quads: Quad[] = [
    quad(it, namedNode(SCHEMA.contentLocation), node),
    quad(node, namedNode(RDF.type), namedNode(SCHEMA.Place)),
  ];
  if (place.name) quads.push(quad(node, namedNode(SCHEMA.name), text(place.name)));

  if (place.locality !== undefined || place.country !== undefined) {
    quads.push(...addressQuads(frag, node, place, language));
  }

  if (place.geo) quads.push(...geoQuads(frag, node, place.geo));
  return quads;
}

/** §7.3 `<#address>` — a locality in the entry's own language, and a country
 *  CODE, which is untagged for the same reason the slug is. */
export function addressQuads(
  frag: Frag,
  place: NamedNode,
  fields: Pick<EntryPlace, "locality" | "country">,
  language?: string,
): Quad[] {
  const address = frag("address");
  const quads: Quad[] = [
    quad(place, namedNode(SCHEMA.address), address),
    quad(address, namedNode(RDF.type), namedNode(SCHEMA.PostalAddress)),
  ];
  if (fields.locality !== undefined) {
    // The entry's own language, not the deployment's, and through `text()` so
    // an entry with no language still falls back rather than publishing an
    // untagged literal. ./notes.md#the-locality-carries-the-entrys-own-language
    quads.push(
      quad(
        address,
        namedNode(SCHEMA.addressLocality),
        text({ value: fields.locality, language }),
      ),
    );
  }
  // A country CODE, not a country name — untagged for the same reason the
  // slug is. "JP"@en would be a different term from "JP".
  if (fields.country !== undefined) {
    quads.push(quad(address, namedNode(SCHEMA.addressCountry), literal(fields.country)));
  }
  return quads;
}

/** §7.3 `<#geo>` — coordinates as xsd:decimal, never float (§6), and handed
 *  through unaltered: §9 fuzzing happened before this module saw them. */
export function geoQuads(frag: Frag, place: NamedNode, point: GeoPoint): Quad[] {
  const geo = frag("geo");
  const { lat, long, precisionMeters } = point;
  const quads: Quad[] = [
    quad(place, namedNode(SCHEMA.geo), geo),
    quad(geo, namedNode(RDF.type), namedNode(SCHEMA.GeoCoordinates)),
    quad(geo, namedNode(SCHEMA.latitude), dec(lat)),
    quad(geo, namedNode(SCHEMA.longitude), dec(long)),
    // Mirrored into geo: because extra triples are nearly free and any
    // generic Linked Data tool understands WGS84 (§7.3).
    quad(geo, namedNode(GEO.lat), dec(lat)),
    quad(geo, namedNode(GEO.long), dec(long)),
  ];
  if (precisionMeters !== undefined) {
    quads.push(quad(geo, namedNode(DY.precisionMeters), int(precisionMeters)));
  }
  return quads;
}

/** §7.3 `<#photo-n>` — one schema:ImageObject per photo, numbered from 1. */
export function photoQuads(frag: Frag, it: NamedNode, photos: Entry["photos"]): Quad[] {
  const quads: Quad[] = [];
  photos.forEach((photo, i) => {
    const node = frag(`photo-${i + 1}`);
    quads.push(
      quad(it, namedNode(SCHEMA.image), node),
      quad(node, namedNode(RDF.type), namedNode(SCHEMA.ImageObject)),
      quad(node, namedNode(SCHEMA.contentUrl), namedNode(photo.contentUrl)),
      // Ordering is always explicit (§6): parse order carries no meaning, so a
      // photo that arrived without one gets its position, not nothing.
      quad(node, namedNode(DY.sortOrder), int(photo.sortOrder ?? i + 1)),
    );
    if (photo.thumbnailUrl) {
      quads.push(quad(node, namedNode(SCHEMA.thumbnailUrl), namedNode(photo.thumbnailUrl)));
    }
    if (photo.caption) quads.push(quad(node, namedNode(SCHEMA.caption), text(photo.caption)));
    if (photo.width !== undefined) quads.push(quad(node, namedNode(SCHEMA.width), int(photo.width)));
    if (photo.height !== undefined) {
      quads.push(quad(node, namedNode(SCHEMA.height), int(photo.height)));
    }
    /**
     * A media type is a code, not prose — plain, like the slug and the country
     * code above (§7.3). Written from the type the blob ACTUALLY has.
     * ./notes.md#which-photo-literals-are-plain-and-which-are-tagged
     */
    if (photo.encodingFormat) {
      quads.push(quad(node, namedNode(SCHEMA.encodingFormat), literal(photo.encodingFormat)));
    }
    if (photo.dateCreated) {
      quads.push(quad(node, namedNode(SCHEMA.dateCreated), dt(photo.dateCreated)));
    }
    /**
     * Also a plain literal, and NOT language-tagged: base64 is not
     * human-readable in any language. `dy:originalUrl` is deliberately never
     * written; say so here if a fourth photo predicate joins it.
     * ./notes.md#which-photo-literals-are-plain-and-which-are-tagged
     */
    if (photo.blurDataUrl) {
      quads.push(quad(node, namedNode(DY.blurDataUrl), literal(photo.blurDataUrl)));
    }
  });
  return quads;
}

export async function serialiseEntry(entry: Entry): Promise<Result<string>> {
  // Validate on the way OUT as well as the way in. This is the last point
  // before a resource becomes permanent in someone's Pod, and the caller is the
  // studio's form state — typed, but assembled from user input.
  const parsed = Entry.safeParse(entry);
  if (!parsed.success) {
    return err({
      kind: "shape",
      url: documentUrlOf(entry?.iri ?? ""),
      issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    });
  }
  const e = parsed.data;
  const doc = documentUrlOf(e.iri);

  /**
   * §11 guardrail 7 asks for the slug invariant on write as well as on read.
   * Writing the mismatch instead produces a resource that `readEntry` then
   * refuses: an entry intact in the Pod and dead on every link built from it.
   * Refusing here is what stops it reaching the Pod at all.
   */
  const slug = assertEntrySlug(doc, e.slug);
  if (!slug.ok) return slug;

  // Fragments, never blank nodes (§6). Every subject in the document is one of
  // these, and every clause helper above builds its own through this.
  const frag = (name: string) => namedNode(`${doc}#${name}`);
  const it = frag("it");

  const quads: Quad[] = [
    ...itQuads(it, e),
    ...(e.place ? placeQuads(frag, it, e.place, e.headline.language) : []),
    ...photoQuads(frag, it, e.photos),
  ];

  const writer = new Writer({
    prefixes: { xsd: NS.xsd, schema: NS.schema, dcterms: NS.dcterms, geo: NS.geo, dy: NS.dy },
  });
  writer.addQuads(quads);
  const turtle = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  return ok(turtle);
}

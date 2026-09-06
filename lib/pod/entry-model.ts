/**
 * The entry resource, serialised. The inverse of `readEntry`.
 *
 * Pure: no fetching, no writing, no clock. `saveEntry` stamps the timestamps
 * and hands the result here, which keeps this function a total mapping from an
 * `Entry` to a Turtle document and makes the round-trip test — serialise, read
 * back with the real reader, compare the whole object — worth what it looks
 * like it is worth.
 *
 * Byte-level formatting is not normative (§11). Compare these graphs by triple
 * set; Turtle has no canonical form and a byte assertion would be permanently
 * red on the next n3 release.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: fuzz coordinates. §9 requires fuzzing
 * BEFORE the write — "the Pod stores only the coordinate you are willing to
 * publish" — and that happens in `lib/pod/fuzz.ts`, called by
 * `components/studio/entry-editor.tsx` before the `Entry` reaches this
 * function. Whatever coordinate this function is handed is the coordinate that
 * reaches the Pod, unrounded and unshifted, so that fuzzing is unambiguously
 * the caller's job and no test here can be misread as evidence that a
 * coordinate was fuzzed. A serialiser that quietly rounded would also make
 * `dy:precisionMeters` a lie in the other direction, describing a precision the
 * value no longer has.
 *
 * That paragraph read "it is phase 3 work that does not exist yet" until
 * 2026-09-06, having outlived commit fc9fcc5, which landed the module. A
 * comment arguing for a state that no longer holds is worse than no comment:
 * the next reader concludes nothing fuzzes, and either duplicates it here — the
 * double-fuzz the paragraph exists to prevent — or ships the raw coordinate on
 * the assumption that someone downstream will handle it.
 */
import { DataFactory, Writer, type Quad } from "n3";
import {
  DCTERMS, DY, DY_CLASS, GEO, NS, RDF, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE,
} from "@/lib/vocab";
import { dec, dt, int, text } from "./literals";
import { assertEntrySlug } from "./read";
import { err, ok, type Result } from "./result";
import { Entry } from "./schema";

const { namedNode, literal, quad } = DataFactory;

/**
 * `<doc.ttl#it>` → `<doc.ttl>`.
 *
 * A string operation rather than `new URL(iri)` on purpose: this is the URL
 * that gets PUT and that appears in every error report, so it must be exactly
 * what the caller named, not a normalised variant of it — and it must not throw
 * on a value that turns out not to be a URL at all. The schema check below is
 * what rejects that case, with a structured error.
 */
export const documentUrlOf = (iri: string) => iri.replace(/#.*$/, "");

/** Only published entries are `dy:Published`; §5 pairs the status with the ACL,
 *  and `saveEntry` sets both from this same field. */
const statusIri = (status: Entry["status"]) =>
  status === "published" ? STATUS.Published : STATUS.Draft;

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

  // Fragments, never blank nodes (§6). Every subject below is one of these.
  const frag = (name: string) => namedNode(`${doc}#${name}`);
  const it = frag("it");

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

  if (e.place) {
    const place = frag("place");
    quads.push(
      quad(it, namedNode(SCHEMA.contentLocation), place),
      quad(place, namedNode(RDF.type), namedNode(SCHEMA.Place)),
    );
    if (e.place.name) quads.push(quad(place, namedNode(SCHEMA.name), text(e.place.name)));

    if (e.place.locality !== undefined || e.place.country !== undefined) {
      const address = frag("address");
      quads.push(
        quad(place, namedNode(SCHEMA.address), address),
        quad(address, namedNode(RDF.type), namedNode(SCHEMA.PostalAddress)),
      );
      if (e.place.locality !== undefined) {
        quads.push(quad(address, namedNode(SCHEMA.addressLocality), text({ value: e.place.locality })));
      }
      // A country CODE, not a country name — untagged for the same reason the
      // slug is. "JP"@en would be a different term from "JP".
      if (e.place.country !== undefined) {
        quads.push(quad(address, namedNode(SCHEMA.addressCountry), literal(e.place.country)));
      }
    }

    if (e.place.geo) {
      const geo = frag("geo");
      const { lat, long, precisionMeters } = e.place.geo;
      quads.push(
        quad(place, namedNode(SCHEMA.geo), geo),
        quad(geo, namedNode(RDF.type), namedNode(SCHEMA.GeoCoordinates)),
        quad(geo, namedNode(SCHEMA.latitude), dec(lat)),
        quad(geo, namedNode(SCHEMA.longitude), dec(long)),
        // Mirrored into geo: because extra triples are nearly free and any
        // generic Linked Data tool understands WGS84 (§7.3).
        quad(geo, namedNode(GEO.lat), dec(lat)),
        quad(geo, namedNode(GEO.long), dec(long)),
      );
      if (precisionMeters !== undefined) {
        quads.push(quad(geo, namedNode(DY.precisionMeters), int(precisionMeters)));
      }
    }
  }

  e.photos.forEach((photo, i) => {
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
     * code above. §7.3 spells it `"image/webp"` with no tag, and a tagged
     * literal would be a different RDF term from the one the fixture shows.
     *
     * It is written from the type the encoded blob ACTUALLY has, never from the
     * type that was requested: `convertToBlob` answers an unsupported request
     * with PNG rather than an error (§7.3 notes). That is the uploader's job;
     * this function writes whatever it is handed.
     */
    if (photo.encodingFormat) {
      quads.push(quad(node, namedNode(SCHEMA.encodingFormat), literal(photo.encodingFormat)));
    }
    if (photo.dateCreated) {
      quads.push(quad(node, namedNode(SCHEMA.dateCreated), dt(photo.dateCreated)));
    }
    /**
     * Also a plain literal, and NOT language-tagged. §6 asks for a language tag
     * on human-readable literals; base64 is not human-readable in any language,
     * and tagging it would assert that it is prose in some tongue.
     *
     * dy:originalUrl is deliberately never written: phase 3 decided against
     * uploading originals, and §3 records the term as reserved rather than
     * live. If a fourth photo predicate is ever added and left unwritten, say
     * so here — test/entry-write.test.ts asserts that NOTHING in §7.3 is
     * missing, so a silent omission turns the suite red rather than vanishing.
     */
    if (photo.blurDataUrl) {
      quads.push(quad(node, namedNode(DY.blurDataUrl), literal(photo.blurDataUrl)));
    }
  });

  const writer = new Writer({
    prefixes: { xsd: NS.xsd, schema: NS.schema, dcterms: NS.dcterms, geo: NS.geo, dy: NS.dy },
  });
  writer.addQuads(quads);
  const turtle = await new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
  return ok(turtle);
}

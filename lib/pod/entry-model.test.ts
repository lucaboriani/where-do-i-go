import { describe, expect, it } from "vitest";
import { DataFactory, Writer, type Quad } from "n3";
import {
  DCTERMS, DY, DY_CLASS, GEO, NS, RDF, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE, XSD,
} from "@/lib/vocab";
import { addressQuads, geoQuads, itQuads, photoQuads, placeQuads } from "@/lib/pod/entry-model";
import { graphEquals, triples } from "@/test/graph";
import type { Entry } from "@/lib/pod/schema";

/**
 * The §7.3 clauses, one per subject, tested where the whole-document test in
 * `save-entry.test.ts` cannot look: at what a clause LEAVES OUT, at the
 * fallbacks, and at the datatype of each term in isolation. That file keeps the
 * round trip and the fixture comparison; this one keeps the clause boundaries.
 */
const { literal, namedNode, quad } = DataFactory;

const DOC = "https://me.solidcommunity.net/travel/trips/2026-japan/entries/2026-03-29-arrival.ttl";
const MEDIA = "https://me.solidcommunity.net/travel/media/6f2a1c8e";
const frag = (name: string) => namedNode(`${DOC}#${name}`);
const IT = frag("it");

const entry = (over: Partial<Entry> = {}): Entry => ({
  iri: `${DOC}#it`,
  slug: "2026-03-29-arrival",
  status: "published",
  schemaVersion: SCHEMA_VERSION,
  headline: { value: "First night in Shinjuku", language: "en" },
  photos: [],
  tags: [],
  ...over,
});

async function turtleOf(quads: Quad[]): Promise<string> {
  const writer = new Writer({
    prefixes: { xsd: NS.xsd, schema: NS.schema, dcterms: NS.dcterms, geo: NS.geo, dy: NS.dy },
  });
  writer.addQuads(quads);
  return new Promise<string>((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

/**
 * Graph isomorphism, never bytes (§11 guardrail 6). The expected side is built
 * with explicit `literal()` calls rather than through `lib/pod/literals.ts`, so
 * a wrong datatype in that module cannot move both sides of the comparison
 * together and pass.
 */
async function expectGraph(actual: Quad[], expected: Quad[]) {
  const { missing, extra } = graphEquals(await turtleOf(expected), await turtleOf(actual), DOC);
  expect({ missing, extra }).toEqual({ missing: [], extra: [] });
}

/** Predicates actually written, read off the parsed graph — so an omission test
 *  asserts the absence of a TERM and not the absence of a substring. */
async function predicatesOf(quads: Quad[]): Promise<string[]> {
  const set = triples(await turtleOf(quads), DOC);
  return [...set].map((t) => t.split(" ")[1].slice(2));
}

/* =============================================================== §7.3 <#it> */

describe("itQuads — §7.3 <#it>, the entry itself", () => {
  it("writes dy:schemaVersion from THIS code, never echoing the entry's", async () => {
    // §11 guardrail 3, and the direction matters: the read-side version gate
    // rejects anything this serialiser did not stamp with its own constant, so
    // echoing a foreign 99 back out would write a resource the app cannot read.
    const written = await turtleOf(itQuads(IT, entry({ schemaVersion: 99 })));
    const set = [...triples(written, DOC)];
    const version = set.filter((t) => t.includes(`N|${DY.schemaVersion} `));
    expect(version).toEqual([
      `N|${IT.value} N|${DY.schemaVersion} L|${SCHEMA_VERSION}|${XSD.integer}|`,
    ]);
  });

  it("carries both classes, and dy:status as an IRI from the vocabulary", async () => {
    // Both classes on purpose: schema:BlogPosting is the interop surface, and
    // dy:Entry is what this app's reader gates on. A draft is dy:Draft, which
    // §5 pairs with the ACL — so writing the wrong IRI here publishes a draft.
    const typeOrStatus = (q: Quad) =>
      q.predicate.value === RDF.type || q.predicate.value === DY.status;
    await expectGraph(itQuads(IT, entry({ status: "draft" })).filter(typeOrStatus), [
      quad(IT, namedNode(RDF.type), namedNode(SCHEMA.BlogPosting)),
      quad(IT, namedNode(RDF.type), namedNode(DY_CLASS.Entry)),
      quad(IT, namedNode(DY.status), namedNode(STATUS.Draft)),
    ]);
    const published = itQuads(IT, entry()).filter((q) => q.predicate.value === DY.status);
    expect(published.map((q) => q.object.value)).toEqual([STATUS.Published]);
  });

  it("leaves an absent optional out entirely rather than writing an empty term", async () => {
    const written = await predicatesOf(itQuads(IT, entry()));
    for (const absent of [
      SCHEMA.articleBody, SCHEMA.datePublished, DY.trip, DY.occurredAt, DY.travelModeFrom,
      DCTERMS.created, DCTERMS.modified, DCTERMS.creator, DY.tag,
    ])
      expect(written, `${absent} was written for an entry that has no value for it`)
        .not.toContain(absent);
  });

  it("tags the headline and the body, and leaves the slug and every tag plain", async () => {
    const full = itQuads(
      IT,
      entry({ articleBody: { value: "Landed at 17:20.", language: "en" }, tags: ["food", "trains"] }),
    );
    const set = [...triples(await turtleOf(full), DOC)];
    expect(set).toContain(`N|${IT.value} N|${DY.slug} L|2026-03-29-arrival|${XSD.string}|`);
    expect(set).toContain(`N|${IT.value} N|${DY.tag} L|food|${XSD.string}|`);
    expect(set).toContain(`N|${IT.value} N|${DY.tag} L|trains|${XSD.string}|`);
    expect(set).toContain(`N|${IT.value} N|${SCHEMA.headline} L|First night in Shinjuku|${NS.rdf}langString|en`);
    expect(set).toContain(`N|${IT.value} N|${SCHEMA.articleBody} L|Landed at 17:20.|${NS.rdf}langString|en`);
  });

  it("writes every instant as xsd:dateTime, keeping the offset it was handed", async () => {
    const stamped = entry({
      occurredAt: "2026-03-29T21:40:00+09:00",
      datePublished: "2026-03-30T08:15:00+09:00",
      created: "2026-03-29T22:03:44+09:00",
      modified: "2026-03-30T08:15:00+09:00",
      travelModeFrom: "Flight",
    });
    const set = [...triples(await turtleOf(itQuads(IT, stamped)), DOC)];
    expect(set).toContain(`N|${IT.value} N|${DY.occurredAt} L|2026-03-29T21:40:00+09:00|${XSD.dateTime}|`);
    expect(set).toContain(`N|${IT.value} N|${DCTERMS.created} L|2026-03-29T22:03:44+09:00|${XSD.dateTime}|`);
    expect(set).toContain(`N|${IT.value} N|${DY.travelModeFrom} N|${TRAVEL_MODE.Flight}`);
  });
});

/* ============================================================ §7.3 <#place> */

describe("placeQuads — §7.3 <#place>, and what hangs off it", () => {
  it("hangs <#place> off <#it> and types it", async () => {
    await expectGraph(placeQuads(frag, IT, { name: { value: "Shinjuku, Tokyo", language: "en" } }, "en"), [
      quad(IT, namedNode(SCHEMA.contentLocation), frag("place")),
      quad(frag("place"), namedNode(RDF.type), namedNode(SCHEMA.Place)),
      quad(frag("place"), namedNode(SCHEMA.name), literal("Shinjuku, Tokyo", "en")),
    ]);
  });

  it("emits no <#address> subject at all when there is neither locality nor country", async () => {
    const written = await turtleOf(placeQuads(frag, IT, { name: { value: "x", language: "en" } }, "en"));
    expect([...triples(written, DOC)].filter((t) => t.includes("#address"))).toEqual([]);
  });

  it("emits no <#geo> subject at all when the place has no coordinate", async () => {
    const written = await turtleOf(placeQuads(frag, IT, { locality: "Tokyo" }, "en"));
    expect([...triples(written, DOC)].filter((t) => t.includes("#geo"))).toEqual([]);
  });

  it("emits <#place> with nothing but its type when the place is empty of content", async () => {
    // `lib/studio/place/place.ts` returns `undefined` for an emptied place
    // rather than an object of `undefined`s, so this shape is unreachable from
    // the editor. Pinned anyway: it is what a foreign or older writer produces.
    await expectGraph(placeQuads(frag, IT, {}, "en"), [
      quad(IT, namedNode(SCHEMA.contentLocation), frag("place")),
      quad(frag("place"), namedNode(RDF.type), namedNode(SCHEMA.Place)),
    ]);
  });
});

/* ========================================================== §7.3 <#address> */

describe("addressQuads — §7.3 <#address>", () => {
  it("tags the locality with the language it is handed, not the deployment's", async () => {
    await expectGraph(addressQuads(frag, frag("place"), { locality: "東京" }, "ja"), [
      quad(frag("place"), namedNode(SCHEMA.address), frag("address")),
      quad(frag("address"), namedNode(RDF.type), namedNode(SCHEMA.PostalAddress)),
      quad(frag("address"), namedNode(SCHEMA.addressLocality), literal("東京", "ja")),
    ]);
  });

  it("leaves the country CODE plain — \"JP\"@en is a different term from \"JP\"", async () => {
    await expectGraph(addressQuads(frag, frag("place"), { country: "JP" }, "en"), [
      quad(frag("place"), namedNode(SCHEMA.address), frag("address")),
      quad(frag("address"), namedNode(RDF.type), namedNode(SCHEMA.PostalAddress)),
      quad(frag("address"), namedNode(SCHEMA.addressCountry), literal("JP")),
    ]);
  });
});

/* ============================================================== §7.3 <#geo> */

describe("geoQuads — §7.3 <#geo>", () => {
  it("writes xsd:decimal, never xsd:float, and mirrors both terms into geo:", async () => {
    await expectGraph(geoQuads(frag, frag("place"), { lat: 35.6938, long: 139.7034, precisionMeters: 500 }), [
      quad(frag("place"), namedNode(SCHEMA.geo), frag("geo")),
      quad(frag("geo"), namedNode(RDF.type), namedNode(SCHEMA.GeoCoordinates)),
      quad(frag("geo"), namedNode(SCHEMA.latitude), literal("35.6938", namedNode(XSD.decimal))),
      quad(frag("geo"), namedNode(SCHEMA.longitude), literal("139.7034", namedNode(XSD.decimal))),
      quad(frag("geo"), namedNode(GEO.lat), literal("35.6938", namedNode(XSD.decimal))),
      quad(frag("geo"), namedNode(GEO.long), literal("139.7034", namedNode(XSD.decimal))),
      quad(frag("geo"), namedNode(DY.precisionMeters), literal("500", namedNode(XSD.integer))),
    ]);
  });

  it("passes the coordinate through unaltered — §9 fuzzing happened before this", async () => {
    // A serialiser that rounded would make dy:precisionMeters a lie in the
    // other direction, describing a precision the value no longer has.
    const set = [...triples(await turtleOf(geoQuads(frag, frag("place"), { lat: 35.69381234, long: -0.0000002 })), DOC)];
    expect(set).toContain(`N|${DOC}#geo N|${SCHEMA.latitude} L|35.69381234|${XSD.decimal}|`);
    expect(set.join("\n")).not.toMatch(/\de[+-]?\d/i);
  });

  it("omits dy:precisionMeters when the point carries none", async () => {
    const written = await predicatesOf(geoQuads(frag, frag("place"), { lat: 1, long: 2 }));
    expect(written).not.toContain(DY.precisionMeters);
  });
});

/* =========================================================== §7.3 <#photo-n> */

describe("photoQuads — §7.3 <#photo-n>", () => {
  it("numbers the fragments from 1, one ImageObject hung off <#it> each", async () => {
    const written = await predicatesOf(
      photoQuads(frag, IT, [{ contentUrl: `${MEDIA}/a.webp` }, { contentUrl: `${MEDIA}/b.webp` }]),
    );
    expect(written.filter((p) => p === SCHEMA.image)).toHaveLength(2);
    const set = [...triples(await turtleOf(photoQuads(frag, IT, [{ contentUrl: `${MEDIA}/a.webp` }])), DOC)];
    expect(set).toContain(`N|${IT.value} N|${SCHEMA.image} N|${DOC}#photo-1`);
    expect(set).toContain(`N|${DOC}#photo-1 N|${RDF.type} N|${SCHEMA.ImageObject}`);
  });

  it("falls back to the array position when a photo carries no sortOrder", async () => {
    // §6: ordering is always explicit, because parse order carries no meaning.
    const set = [...triples(
      await turtleOf(photoQuads(frag, IT, [
        { contentUrl: `${MEDIA}/a.webp` },
        { contentUrl: `${MEDIA}/b.webp`, sortOrder: 7 },
      ])),
      DOC,
    )];
    expect(set).toContain(`N|${DOC}#photo-1 N|${DY.sortOrder} L|1|${XSD.integer}|`);
    expect(set).toContain(`N|${DOC}#photo-2 N|${DY.sortOrder} L|7|${XSD.integer}|`);
  });

  it("writes the whole §7.3 photo clause, caption tagged and the rest plain", async () => {
    const blur = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
    await expectGraph(
      photoQuads(frag, IT, [{
        contentUrl: `${MEDIA}/web.webp`,
        thumbnailUrl: `${MEDIA}/thumb.webp`,
        caption: { value: "Counter seating, no menu.", language: "en" },
        width: 1600,
        height: 1067,
        encodingFormat: "image/webp",
        dateCreated: "2026-03-29T21:38:02+09:00",
        blurDataUrl: blur,
        sortOrder: 1,
      }]),
      [
        quad(IT, namedNode(SCHEMA.image), frag("photo-1")),
        quad(frag("photo-1"), namedNode(RDF.type), namedNode(SCHEMA.ImageObject)),
        quad(frag("photo-1"), namedNode(SCHEMA.contentUrl), namedNode(`${MEDIA}/web.webp`)),
        quad(frag("photo-1"), namedNode(SCHEMA.thumbnailUrl), namedNode(`${MEDIA}/thumb.webp`)),
        quad(frag("photo-1"), namedNode(SCHEMA.caption), literal("Counter seating, no menu.", "en")),
        quad(frag("photo-1"), namedNode(SCHEMA.width), literal("1600", namedNode(XSD.integer))),
        quad(frag("photo-1"), namedNode(SCHEMA.height), literal("1067", namedNode(XSD.integer))),
        quad(frag("photo-1"), namedNode(SCHEMA.encodingFormat), literal("image/webp")),
        quad(frag("photo-1"), namedNode(SCHEMA.dateCreated), literal("2026-03-29T21:38:02+09:00", namedNode(XSD.dateTime))),
        quad(frag("photo-1"), namedNode(DY.blurDataUrl), literal(blur)),
        quad(frag("photo-1"), namedNode(DY.sortOrder), literal("1", namedNode(XSD.integer))),
      ],
    );
  });

  it("emits nothing at all for an entry with no photos", async () => {
    expect(photoQuads(frag, IT, [])).toEqual([]);
  });
});

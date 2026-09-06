/**
 * Every IRI in this project, as a named constant.
 *
 * This is the highest-value rule in docs/data-model.md §11: no predicate string
 * literals anywhere else in the codebase, or you end up with three spellings of
 * the same property scattered across your Pod. Enforced by the
 * `no-restricted-syntax` rule in eslint.config.mjs, which exempts this file.
 *
 * Generated from docs/data-model.md §3. A CI check asserts this file and that
 * document agree in both directions — see scripts/check-vocab.ts.
 */

/* --------------------------------------------------------------------------
 * Namespaces
 *
 * `https://schema.org/` is https on purpose: http://schema.org/Person and
 * https://schema.org/Person are different IRIs and will never match (§2 rule 3).
 * ------------------------------------------------------------------------ */

export const NS = {
  xsd: "http://www.w3.org/2001/XMLSchema#",
  schema: "https://schema.org/",
  dcterms: "http://purl.org/dc/terms/",
  geo: "http://www.w3.org/2003/01/geo/wgs84_pos#",
  ldp: "http://www.w3.org/ns/ldp#",
  solid: "http://www.w3.org/ns/solid/terms#",
  pim: "http://www.w3.org/ns/pim/space#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  foaf: "http://xmlns.com/foaf/0.1/",

  /**
   * BLOCKED: still example.org. This is a permanent identifier baked into every
   * triple, hardcoded and never read from an environment variable — if each
   * deployer used their own namespace, two diaries could not be read by the
   * same code and the interoperability premise collapses (§2 rule 4).
   *
   * Nothing may be written to a live Pod until the real project domain replaces
   * this. Local Community Solid Server data is disposable; spike there freely.
   */
  dy: "https://example.org/ns/traveldiary#",
} as const;

const dy = (term: string) => `${NS.dy}${term}` as const;
const schema = (term: string) => `${NS.schema}${term}` as const;
const dcterms = (term: string) => `${NS.dcterms}${term}` as const;
const geo = (term: string) => `${NS.geo}${term}` as const;
const solid = (term: string) => `${NS.solid}${term}` as const;

/* -------------------------------------------------------------------------- */
/* Classes (§3)                                                               */
/* -------------------------------------------------------------------------- */

export const DY_CLASS = {
  Diary: dy("Diary"),
  Trip: dy("Trip"),
  Entry: dy("Entry"),
  TripIndex: dy("TripIndex"),
  IndexEntry: dy("IndexEntry"),
  PublicationStatus: dy("PublicationStatus"),
  TravelMode: dy("TravelMode"),
} as const;

/* -------------------------------------------------------------------------- */
/* Individuals (§3)                                                           */
/*                                                                            */
/* IRIs rather than string literals so a typo produces an unresolvable term    */
/* rather than a silently distinct value.                                      */
/* -------------------------------------------------------------------------- */

export const STATUS = {
  Draft: dy("Draft"),
  Published: dy("Published"),
} as const;

export const TRAVEL_MODE = {
  Flight: dy("Flight"),
  Train: dy("Train"),
  Bus: dy("Bus"),
  Car: dy("Car"),
  Boat: dy("Boat"),
  Bike: dy("Bike"),
  Walk: dy("Walk"),
  Other: dy("Other"),
} as const;

/* -------------------------------------------------------------------------- */
/* Properties (§3)                                                            */
/* -------------------------------------------------------------------------- */

export const DY = {
  // Structure and identity
  slug: dy("slug"),
  status: dy("status"),
  schemaVersion: dy("schemaVersion"),
  trip: dy("trip"),
  index: dy("index"),
  indexOf: dy("indexOf"),
  entry: dy("entry"),
  entryResource: dy("entryResource"),

  // Time and place
  startDate: dy("startDate"),
  endDate: dy("endDate"),
  occurredAt: dy("occurredAt"),
  travelModeFrom: dy("travelModeFrom"),
  precisionMeters: dy("precisionMeters"),

  // Index read model — flat by design (§7.4)
  lat: dy("lat"),
  long: dy("long"),
  thumbnail: dy("thumbnail"),
  sortOrder: dy("sortOrder"),
  bboxWest: dy("bboxWest"),
  bboxSouth: dy("bboxSouth"),
  bboxEast: dy("bboxEast"),
  bboxNorth: dy("bboxNorth"),
  centerLat: dy("centerLat"),
  centerLong: dy("centerLong"),
  entryCount: dy("entryCount"),

  // Media and misc
  coverImage: dy("coverImage"),
  originalUrl: dy("originalUrl"),
  track: dy("track"),
  tag: dy("tag"),

  /* ------------------------------------------------------------------------
   * Privacy settings (§3, §7.6). The ONLY dy: terms in this file that are never
   * publicly readable — they live in one owner-only resource, because the home
   * region is the thing being protected and publishing its centre and radius
   * would hand a reader the answer the fuzzing exists to withhold.
   *
   * `homeLong`, matching `long` and `centerLong` above. It was `homeLon` until
   * 2026-09-06 — deliberately, and this comment used to say so — and the rename
   * happened for the reason the old note gave: a predicate is permanent the
   * moment anything writes one, and nothing had. There is no writer for
   * `privacy.ttl` in this codebase, `initialiseContainers()` deliberately
   * creates the container empty, and `dy:` is still example.org so no live Pod
   * holds one. §3 and §14 record the decision, which was the owner's.
   *
   * That window is closed now. All four of these are fixed.
   * --------------------------------------------------------------------- */

  /** xsd:decimal, never float — the home centre, stored at FULL precision.
   *  The one coordinate in this project that is not fuzzed before the write,
   *  because this resource is not published and a fuzzed centre would fuzz the
   *  boundary rather than the thing inside it (§7.6). */
  homeLat: dy("homeLat"),
  homeLong: dy("homeLong"),
  /** xsd:integer. Inside this radius §9 drops the coordinate ENTIRELY rather
   *  than coarsening it, so an absent value must never be read as zero: that
   *  is a home region of no area, i.e. no protection, reported as success. */
  homeRadiusMeters: dy("homeRadiusMeters"),
  /** xsd:integer. The grid a coordinate outside the home region is snapped to,
   *  and the value written to dy:precisionMeters alongside the result. Required
   *  — there is deliberately no built-in default (§7.6). */
  defaultPrecisionMeters: dy("defaultPrecisionMeters"),
} as const;

/* -------------------------------------------------------------------------- */
/* Borrowed vocabularies                                                      */
/*                                                                            */
/* schema.org only where the property is genuinely in the type's domain, since */
/* Google validates structured data (§2 rule 1). dcterms for provenance: DCMI  */
/* terms assert no rdfs:domain, so they are safe on custom classes.            */
/* -------------------------------------------------------------------------- */

export const SCHEMA = {
  TouristTrip: schema("TouristTrip"),
  BlogPosting: schema("BlogPosting"),
  Place: schema("Place"),
  GeoCoordinates: schema("GeoCoordinates"),
  PostalAddress: schema("PostalAddress"),
  ImageObject: schema("ImageObject"),

  name: schema("name"),
  description: schema("description"),
  headline: schema("headline"),
  articleBody: schema("articleBody"),
  datePublished: schema("datePublished"),
  tripOrigin: schema("tripOrigin"),
  contentLocation: schema("contentLocation"),
  image: schema("image"),
  address: schema("address"),
  geo: schema("geo"),
  latitude: schema("latitude"),
  longitude: schema("longitude"),
  addressLocality: schema("addressLocality"),
  addressCountry: schema("addressCountry"),
  contentUrl: schema("contentUrl"),
  thumbnailUrl: schema("thumbnailUrl"),
  caption: schema("caption"),
  width: schema("width"),
  height: schema("height"),
  encodingFormat: schema("encodingFormat"),
  dateCreated: schema("dateCreated"),
} as const;

export const DCTERMS = {
  title: dcterms("title"),
  description: dcterms("description"),
  creator: dcterms("creator"),
  created: dcterms("created"),
  modified: dcterms("modified"),
} as const;

/** Coordinates are mirrored into geo: because extra triples are nearly free and
 *  any generic Linked Data tool understands WGS84. schema: is what code reads. */
export const GEO = {
  lat: geo("lat"),
  long: geo("long"),
} as const;

/** §2 says `rdf:` is never *declared* in the Turtle, because the `a` keyword
 *  covers rdf:type. Reading types back out still needs the IRI, so it lives
 *  here like every other one. */
export const RDF = {
  type: `${NS.rdf}type`,
} as const;

export const LDP = {
  contains: `${NS.ldp}contains`,
  BasicContainer: `${NS.ldp}BasicContainer`,
} as const;

export const SOLID = {
  publicTypeIndex: solid("publicTypeIndex"),
  TypeRegistration: solid("TypeRegistration"),
  forClass: solid("forClass"),
  instance: solid("instance"),
  instanceContainer: solid("instanceContainer"),
} as const;

/** The Solid-OIDC client identifier document context. An IRI like any other,
 *  so it lives here rather than inline in the route that serves it. */
export const OIDC_CONTEXT = "https://www.w3.org/ns/solid/oidc-context.jsonld";

/** Discovery on a hosted Pod: the WebID may not be writable and may not live in
 *  the Pod at all, so storage comes from pim:storage and the writable profile
 *  from rdfs:seeAlso (§7.5, rewritten after phase 0). */
export const PROFILE = {
  storage: `${NS.pim}storage`,
  seeAlso: `${NS.rdfs}seeAlso`,
  oidcIssuer: solid("oidcIssuer"),
} as const;

/* -------------------------------------------------------------------------- */
/* Datatypes — always explicit, always the same (§6)                          */
/* -------------------------------------------------------------------------- */

export const XSD = {
  /** Trip extent. */
  date: `${NS.xsd}date`,
  /** Instants. A UTC offset is required; normalising to UTC destroys the fact
   *  that it was evening, which for a travel diary is most of the meaning. */
  dateTime: `${NS.xsd}dateTime`,
  /** Coordinates. Never xsd:float. */
  decimal: `${NS.xsd}decimal`,
  /** Counts and distances. */
  integer: `${NS.xsd}integer`,
  string: `${NS.xsd}string`,
} as const;

/** Bumped when the shape of a top-level resource changes. Checked on every
 *  read of a top-level resource, entries included (§11). */
export const SCHEMA_VERSION = 1;

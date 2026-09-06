/**
 * Zod schemas for everything read from a Pod.
 *
 * A Pod contains whatever was written to it, including data from an older
 * version of this app and, in principle, from someone else's (§11). So these
 * validate rather than assume — and they are deliberately lenient about
 * *optional* fields and strict about the ones the pages depend on.
 */
import * as z from "zod";

export const Status = z.enum(["draft", "published"]);
export type Status = z.infer<typeof Status>;

export const TravelMode = z.enum([
  "Flight", "Train", "Bus", "Car", "Boat", "Bike", "Walk", "Other",
]);
export type TravelMode = z.infer<typeof TravelMode>;

/** Language-tagged human text. The tag is required on write; on read a missing
 *  one is tolerated rather than fatal, because refusing to render an otherwise
 *  valid entry over a missing @en helps nobody. */
export const LangText = z.object({
  value: z.string().min(1),
  language: z.string().optional(),
});
export type LangText = z.infer<typeof LangText>;

export const GeoPoint = z.object({
  lat: z.number().min(-90).max(90),
  long: z.number().min(-180).max(180),
  /** Drives rendering: a small value gets a pin, a large one a soft circle. */
  precisionMeters: z.number().int().positive().optional(),
});
export type GeoPoint = z.infer<typeof GeoPoint>;

export const Place = z.object({
  name: LangText.optional(),
  locality: z.string().optional(),
  country: z.string().optional(),
  geo: GeoPoint.optional(),
});

export const Photo = z.object({
  contentUrl: z.url(),
  thumbnailUrl: z.url().optional(),
  caption: LangText.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
  /** The blob's ACTUAL media type, e.g. "image/webp" (§6.1). */
  encodingFormat: z.string().optional(),
  /** From EXIF DateTimeOriginal. Offset required, like every other timestamp. */
  dateCreated: z.iso.datetime({ offset: true }).optional(),
  /** A `data:` URI placeholder, budgeted by lib/media/targets.ts. */
  blurDataUrl: z.string().optional(),
});
export type Photo = z.infer<typeof Photo>;

export const Trip = z.object({
  iri: z.url(),
  slug: z.string().min(1),
  status: Status,
  schemaVersion: z.number().int(),
  name: LangText,
  description: LangText.optional(),
  /** xsd:date, not dateTime — a travel diary wants dates (§7.2). */
  startDate: z.iso.date().optional(),
  endDate: z.iso.date().optional(),
  index: z.url().optional(),
  coverImage: z.url().optional(),
  track: z.url().optional(),
  tags: z.array(z.string()),
  origin: Place.optional(),
  created: z.iso.datetime({ offset: true }).optional(),
  modified: z.iso.datetime({ offset: true }).optional(),
});
export type Trip = z.infer<typeof Trip>;

export const Entry = z.object({
  iri: z.url(),
  slug: z.string().min(1),
  status: Status,
  schemaVersion: z.number().int(),
  headline: LangText,
  articleBody: LangText.optional(),
  trip: z.url().optional(),
  /** Carries the local UTC offset of the place, deliberately (§7.3). */
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  datePublished: z.iso.datetime({ offset: true }).optional(),
  travelModeFrom: TravelMode.optional(),
  place: Place.optional(),
  photos: z.array(Photo),
  tags: z.array(z.string()),
  /**
   * NOT redundant with `datePublished`, and §7.3 says so in as many words:
   * "created is when the record came into being and datePublished is when it
   * became public. They differ by however long the draft sat."
   *
   * These two were missing from this schema until 2026-09-04, so `readEntry`
   * dropped them and the first read-modify-write in the studio would have
   * destroyed both, permanently and silently. `readTrip` has always read
   * `created`, so it was an inconsistency rather than a policy.
   *
   * OPTIONAL, both of them, for the same reason every other field here is:
   * "a Pod contains whatever was written to it, including data from an older
   * version of this app". Requiring `created` would make every entry written
   * before this change unreadable — including by `rebuildIndex`, which is the
   * one tool that could repair them — and nothing rendered depends on either
   * value. `saveEntry` sets `created` on a create and carries it forward on an
   * update, so entries this app writes always have one.
   */
  created: z.iso.datetime({ offset: true }).optional(),
  creator: z.url().optional(),
  modified: z.iso.datetime({ offset: true }).optional(),
});
export type Entry = z.infer<typeof Entry>;

/** One row of the denormalised read model. Flat by design (§7.4): this is a
 *  private read model with no interop obligations, and a #geo fragment per
 *  point would roughly double the one resource fetched on every page view. */
export const IndexEntry = z.object({
  iri: z.url(),
  entryResource: z.url(),
  title: LangText,
  slug: z.string().min(1),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  lat: z.number().min(-90).max(90).optional(),
  long: z.number().min(-180).max(180).optional(),
  precisionMeters: z.number().int().positive().optional(),
  thumbnail: z.url().optional(),
  travelModeFrom: TravelMode.optional(),
  sortOrder: z.number().int(),
});
export type IndexEntry = z.infer<typeof IndexEntry>;

export const TripIndex = z.object({
  iri: z.url(),
  indexOf: z.url().optional(),
  schemaVersion: z.number().int(),
  entryCount: z.number().int().nonnegative().optional(),
  bbox: z
    .object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() })
    .optional(),
  center: z.object({ lat: z.number(), long: z.number() }).optional(),
  entries: z.array(IndexEntry),
  modified: z.iso.datetime({ offset: true }).optional(),
});
export type TripIndex = z.infer<typeof TripIndex>;

export const Diary = z.object({
  iri: z.url(),
  schemaVersion: z.number().int(),
  title: LangText.optional(),
  description: LangText.optional(),
  creator: z.url().optional(),
  trips: z.array(z.url()),
  modified: z.iso.datetime({ offset: true }).optional(),
});
export type Diary = z.infer<typeof Diary>;

/**
 * The owner's privacy settings (§7.6) — home region and default precision.
 *
 * THE ONLY SCHEMA HERE THAT IS DELIBERATELY STRICT. Every other one in this
 * file is "lenient about optional fields and strict about the ones the pages
 * depend on", because a Pod contains whatever was written to it and refusing to
 * render an otherwise valid entry helps nobody. The trade is the other way
 * round for this resource: nothing renders from it, and what depends on it is
 * whether a coordinate reaches a world-readable document.
 *
 * §9 says the read fails closed — "no readable settings means no coordinate is
 * published at all" — and a fail-closed contract is only worth as much as this
 * schema's refusal to fill anything in. Two consequences, both load-bearing:
 *
 *   - `defaultPrecisionMeters` is REQUIRED. A default here would be a distance
 *     this project picked for someone else's front door.
 *   - `home` is all three values or none. A `.optional()` on any one of them
 *     turns a half-written document into "no home region", which publishes
 *     coordinates from the owner's doorstep while returning ok — the exact
 *     failure §7.6 spells out.
 *
 * `.positive()` on both distances for the same reason: a radius of 0 m is a
 * circle of no area, which is indistinguishable in effect from the absent value
 * above, and a grid of 0 m snaps a coordinate to itself while announcing
 * `dy:precisionMeters 0`, i.e. "this point is exact".
 */
export const HomeRegion = z.object({
  /** Stored at FULL precision, unlike every other coordinate in this project.
   *  The resource is not published, and a fuzzed centre would fuzz the boundary
   *  rather than the thing inside it (§7.6). */
  lat: z.number().min(-90).max(90),
  long: z.number().min(-180).max(180),
  radiusMeters: z.number().int().positive(),
});
export type HomeRegion = z.infer<typeof HomeRegion>;

export const PrivacySettings = z.object({
  iri: z.url(),
  schemaVersion: z.number().int(),
  /** Absent means "I have no home to protect", which is a legitimate setting
   *  and is NOT the same fact as "the settings could not be read". The latter
   *  never reaches this schema — it is a PodError. */
  home: HomeRegion.optional(),
  defaultPrecisionMeters: z.number().int().positive(),
  modified: z.iso.datetime({ offset: true }).optional(),
});
export type PrivacySettings = z.infer<typeof PrivacySettings>;

/**
 * The owner's WebID profile — read unauthenticated so the studio can discover
 * *where to log in* before any session exists (§7.5).
 *
 * Deliberately unlike every other schema here: this document is not ours. On
 * ESS the identity provider serves it and answers `PATCH` with 405, so it
 * carries no `dy:` terms and none of §6's house rules apply to it. Validate
 * what we depend on, tolerate the rest.
 */
export const OwnerProfile = z.object({
  /** Required. `session.login()` takes `oidcIssuer` as a mandatory option and
   *  there is deliberately no OIDC_ISSUER env var (§7.5), so an absent issuer
   *  is a failed read rather than an undefined discovered at redirect time. */
  oidcIssuer: z.url(),
  /** §7.5: the Pod root comes from `pim:storage` — never from the WebID's
   *  origin, because on ESS identity and storage are different hosts. Optional:
   *  a profile can still say where to log in without saying where it stores. */
  storage: z.url().optional(),
  /** The extended profile, which unlike the WebID document does live in the
   *  Pod and is writable. Optional — CSS profiles routinely omit it. */
  seeAlso: z.url().optional(),
});
export type OwnerProfile = z.infer<typeof OwnerProfile>;

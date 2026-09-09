/**
 * Zod schemas for everything read from a Pod. A Pod contains whatever was
 * written to it, including data from an older version of this app and, in
 * principle, from someone else's (§11) — so these validate rather than assume,
 * leniently about optional fields and strictly about what the pages depend on.
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

/**
 * The §6.4 blur budget, RESTATED HERE RATHER THAN IMPORTED: `lib/media` is
 * studio-only and fenced from `app/(public)`, and this file is read by public
 * pages. Keep the two in step.
 * ./notes.md#the-blur-budget-is-restated-in-the-schema-rather-than-imported
 */
const BLUR_BUDGET_BYTES = 1200;

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
  /**
   * A `data:` URI placeholder, with §6.4's budget checked on READ too, in BYTES
   * rather than characters. OVER BUDGET DISCARDS THE PLACEHOLDER; IT DOES NOT
   * REJECT THE PHOTO — for one day it did, and lost a page.
   * ./notes.md#over-budget-discards-the-placeholder-it-does-not-reject-the-photo
   */
  blurDataUrl: z
    .string()
    .transform((value) =>
      new TextEncoder().encode(value).length <= BLUR_BUDGET_BYTES ? value : undefined,
    )
    .optional(),
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
   * NOT redundant with `datePublished` (§7.3), and both were missing until
   * 2026-09-04 — the first read-modify-write would have destroyed them.
   * Optional, like every other field here.
   * ./notes.md#created-and-datepublished-are-not-redundant
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
 * The owner's privacy settings (§7.6) — home region and default precision. THE
 * ONLY SCHEMA HERE THAT IS DELIBERATELY STRICT, because §9's fail-closed
 * contract is worth only as much as this schema's refusal to fill anything in.
 * ./notes.md#privacysettings-is-the-one-strict-schema-and-fails-closed
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
 * *where to log in* before any session exists (§7.5). This document is not
 * ours, so validate what we depend on and tolerate the rest.
 * ./notes.md#ownerprofile-validates-a-document-that-is-not-ours
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

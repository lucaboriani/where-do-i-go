/**
 * Coordinate fuzzing, applied BEFORE the write (§9). THIS MODULE IS THE LAST
 * PLACE A PRECISE COORDINATE EXISTS — no render-time mitigation behind it, no
 * second chance after the PUT: what it returns is what a stranger can `curl`.
 * ./notes.md#fuzzts-is-the-last-place-a-precise-coordinate-exists
 */
import { GeoPoint, PrivacySettings, type HomeRegion } from "./schema";

/* -------------------------------------------------------------------------- */
/* The sphere                                                                 */
/* -------------------------------------------------------------------------- */

/** Spherical earth, the radius every haversine implementation converges on. */
const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;
/** 111 194.93 m. One degree of latitude, the same at every latitude. */
const M_PER_DEG_LAT = EARTH_RADIUS_M * rad(1);

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * STRINGS, not numbers, and that is the datatype rule rather than a style
 * choice: a naive float snap yields `35.010000000000005`, and those digits are
 * a precision leak dressed as a rounding artefact.
 * ./notes.md#the-snapped-coordinate-is-a-pair-of-strings
 */
export type SnappedCoordinate = { lat: string; long: string };

/** Why a coordinate was not published. Every one of these is a fail-closed
 *  outcome: §9 says nothing is published unless everything checks out. */
export type DropReason = "insideHome" | "invalidSettings" | "invalidPoint" | "invalidPrecision";

export type FuzzResult =
  | { kind: "snap"; lat: string; long: string; precisionMeters: number }
  | { kind: "drop"; reason: DropReason };

/** The minimum a point has to be for the geometry below. `lib/pod/schema.ts`
 *  spells the field `long` on both `GeoPoint` and `HomeRegion`, so everything
 *  crossing this module's surface is `{ lat, long }`. */
type Coordinate = { lat: number; long: number };

/* -------------------------------------------------------------------------- */
/* Input rules                                                                */
/* -------------------------------------------------------------------------- */

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isLatitude = (v: unknown): v is number => isFiniteNumber(v) && v >= -90 && v <= 90;
const isLongitude = (v: unknown): v is number => isFiniteNumber(v) && v >= -180 && v <= 180;

/** `dy:precisionMeters` is `xsd:integer` and `GeoPoint` already says
 *  `.int().positive()`. A fractional grid cannot be written back honestly, so
 *  it is refused rather than rounded on the owner's behalf. */
const isPositiveInteger = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0;

/* -------------------------------------------------------------------------- */
/* The grid                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The latitude step: 180° divided into a whole number of cells, and an EVEN one
 * so that ±90 are grid points rather than something just past them. Measured —
 * an arbitrary step publishes a latitude of 90.000055.
 * ./notes.md#the-two-grid-steps-and-why-each-divides-its-circle
 */
function latitudeStep(precisionMeters: number): number {
  const ideal = precisionMeters / M_PER_DEG_LAT;
  const n = 2 * Math.max(1, Math.round(90 / ideal));
  return 180 / n;
}

/**
 * The longitude step, at a given latitude. Scaled by `cos φ` so a cell is
 * `precisionMeters` across in METRES, and IT MUST ALSO DIVIDE 360° or the grid
 * has a seam at the antimeridian. The polar collapse falls out of the same
 * expression. ./notes.md#the-two-grid-steps-and-why-each-divides-its-circle
 */
function longitudeStep(precisionMeters: number, atLatitude: number): number {
  const ideal = precisionMeters / (M_PER_DEG_LAT * Math.cos(rad(atLatitude)));
  const n = Math.max(1, Math.round(360 / ideal));
  return 360 / n;
}

/**
 * How many decimals to spend, derived from the latitude step so both axes share
 * a count. `toFixed(7)` for everything would satisfy `xsd:decimal` and still
 * dress a 20 km cell as a centimetre measurement.
 * ./notes.md#how-many-decimals-to-spend
 */
function decimalPlaces(stepDegrees: number): number {
  return Math.min(7, Math.max(1, Math.ceil(-Math.log10(stepDegrees)) + 2));
}

/** Longitude back into [-180, 180]. 180 and -180 are the same meridian; this
 *  spells it -180 so one cell has one spelling. */
function wrapLongitude(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/**
 * The lexical form actually written. NEGATIVE ZERO IS THE TRAP, and not through
 * the mechanism it looks like — the guard is defence in depth today, and
 * ANYTHING THAT WIDENS THE QUANTUM MAKES IT REACHABLE AGAIN.
 * ./notes.md#negative-zero-and-the-mechanism-it-is-not
 */
function formatDecimal(value: number, places: number): string {
  const text = (value === 0 ? 0 : value).toFixed(places);
  return text.startsWith("-") && Number(text) === 0 ? text.slice(1) : text;
}

/* -------------------------------------------------------------------------- */
/* snapToPrecision                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Snap a coordinate to a deterministic grid and return the `xsd:decimal`
 * lexical forms. ROUNDED TO THE CELL CENTRE, and THE PRIMITIVE THROWS.
 * ./notes.md#snaptoprecision-the-centre-the-order-of-operations-and-the-throw
 * @throws RangeError off the sphere, non-finite, or a non-positive-integer grid.
 */
export function snapToPrecision(
  lat: number,
  long: number,
  precisionMeters: number,
): SnappedCoordinate {
  if (!isLatitude(lat)) {
    throw new RangeError(`latitude must be a finite number in [-90, 90], got ${String(lat)}`);
  }
  if (!isLongitude(long)) {
    throw new RangeError(`longitude must be a finite number in [-180, 180], got ${String(long)}`);
  }
  if (!isPositiveInteger(precisionMeters)) {
    throw new RangeError(
      `precisionMeters must be a positive integer (dy:precisionMeters is xsd:integer), got ${String(precisionMeters)}`,
    );
  }

  const latStep = latitudeStep(precisionMeters);
  const places = decimalPlaces(latStep);

  // Clamped only against the last ulp: (n / 2) * (180 / n) is 90 in exact
  // arithmetic and may be 90.000000000000014 in floating point. The invariant
  // "a published latitude is a latitude" is worth holding on the number as well
  // as on the string that `toFixed` would have rounded for us.
  const snappedLat = Math.min(90, Math.max(-90, Math.round(lat / latStep) * latStep));

  // From the SNAPPED latitude, not the input, and that is what makes the whole
  // function idempotent: re-snapping the published value computes the same
  // cosine, hence the same longitude step, hence the same cell.
  const longStep = longitudeStep(precisionMeters, snappedLat);
  const snappedLong = Math.round(long / longStep) * longStep;

  // Quantise BEFORE wrapping. `n * step` for the cell at the antimeridian is
  // exactly 180 in decimal but may arrive as 179.99999999999997, which wrapping
  // leaves alone and which then publishes as "180.000" — re-snapping that
  // crosses to "-180.000" and idempotence is lost on one cell out of thousands.
  // Rounding to what is actually emitted first removes the ambiguity.
  const publishedLong = wrapLongitude(Number(snappedLong.toFixed(places)));

  return {
    lat: formatDecimal(snappedLat, places),
    long: formatDecimal(publishedLong, places),
  };
}

/* -------------------------------------------------------------------------- */
/* isInsideHome                                                               */
/* -------------------------------------------------------------------------- */

/** Great-circle distance, which handles the antimeridian for free — which is
 *  why nothing here subtracts degrees.
 *  ./notes.md#isinsidehome-is-geometry-and-a-zero-radius-is-legal-there */
function metresApart(a: Coordinate, b: Coordinate): number {
  const dPhi = rad(b.lat - a.lat);
  const dLambda = rad(b.long - a.long);
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Is this point inside the owner's home region? INCLUSIVE at the radius. A zero
 * radius is legal here and illegal in settings (§7.6): this is geometry.
 * ./notes.md#isinsidehome-is-geometry-and-a-zero-radius-is-legal-there
 * @throws RangeError on a point or a home region it cannot measure.
 */
export function isInsideHome(point: Coordinate, home: HomeRegion): boolean {
  if (!point || !isLatitude(point.lat) || !isLongitude(point.long)) {
    throw new RangeError(`point must be { lat, long } on the sphere, got ${JSON.stringify(point)}`);
  }
  if (!home || !isLatitude(home.lat) || !isLongitude(home.long)) {
    throw new RangeError(`home must be { lat, long } on the sphere, got ${JSON.stringify(home)}`);
  }
  if (!isFiniteNumber(home.radiusMeters) || home.radiusMeters < 0) {
    throw new RangeError(`home radius must be a finite, non-negative number`);
  }

  return metresApart(point, home) <= home.radiusMeters;
}

/* -------------------------------------------------------------------------- */
/* fuzzForPublication                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The boundary: what may be written next to an entry. Total — it never throws.
 * INSIDE THE HOME RADIUS THE COORDINATE IS DROPPED, NOT COARSENED, and IT FAILS
 * CLOSED. ./notes.md#fuzzforpublication-is-the-total-boundary-and-it-fails-closed
 */
export function fuzzForPublication(
  point: GeoPoint,
  settings: PrivacySettings,
  precisionMeters?: number,
): FuzzResult {
  const trusted = PrivacySettings.safeParse(settings);
  if (!trusted.success) return { kind: "drop", reason: "invalidSettings" };

  const parsed = GeoPoint.safeParse(point);
  if (!parsed.success) return { kind: "drop", reason: "invalidPoint" };
  const { lat, long } = parsed.data;

  // An explicit precision the module cannot honour fails closed rather than
  // falling back to the default: a caller passing NaN has a bug, and publishing
  // at 500 m would hide it behind a coordinate that looks deliberate.
  const precision =
    precisionMeters === undefined ? trusted.data.defaultPrecisionMeters : precisionMeters;
  if (!isPositiveInteger(precision)) return { kind: "drop", reason: "invalidPrecision" };

  const { home } = trusted.data;
  if (home && isInsideHome({ lat, long }, home)) return { kind: "drop", reason: "insideHome" };

  const snapped = snapToPrecision(lat, long, precision);
  return { kind: "snap", lat: snapped.lat, long: snapped.long, precisionMeters: precision };
}

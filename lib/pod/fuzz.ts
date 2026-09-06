/**
 * Coordinate fuzzing, applied BEFORE the write (docs/data-model.md §9).
 *
 * "The Pod stores only the coordinate you are willing to publish. The studio
 * applies fuzzing before the write and discards the precise original.
 * `dy:precisionMeters` then honestly describes what was stored."
 *
 * Every entry resource is world-readable (decisions.md §5), so this module is
 * the last place a precise coordinate exists. There is no render-time
 * mitigation behind it and no second chance after the PUT: what these functions
 * return is what a stranger can `curl`.
 *
 * Pure. No fetch, no clock, no randomness — the settings arrive as a value that
 * `readPrivacySettings` (§7.6) produced, and determinism is a privacy property
 * here rather than a testing convenience: a jitter redrawn per write lets an
 * observer average several publications of one place back to the true point.
 *
 * STUDIO-ONLY BY INTENT. Nothing in `app/(public)` has a reason to fuzz — the
 * public path reads what was already fuzzed. It is not in the
 * `no-restricted-imports` group with `write.ts` and `access.ts` because it
 * holds no credentials and imports no auth library, so an accidental public
 * import would be a pointless dependency rather than a leak.
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
 * choice. A naive float snap yields `35.010000000000005`: `xsd:decimal` has no
 * exponent form and no business carrying 15 digits, and those digits are a
 * precision leak dressed as a rounding artefact. Returning numbers would hand
 * the decision to whichever serialiser is downstream; returning strings makes
 * it this module's problem, which is where it belongs.
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
 * The latitude step: 180° divided into a whole number of cells, and an EVEN
 * one so that ±90 are grid points rather than something just past them.
 *
 * Measured, not assumed. With an arbitrary step of `precisionMeters /
 * M_PER_DEG_LAT`, a 50 m grid puts `round(90 / step) * step` at 90.000055 —
 * `Math.abs(lat) <= 90` fails and the published latitude is not a latitude.
 * Forcing `n` even makes 90 exactly `(n / 2) * step`, so the pole is a cell
 * centre and the arithmetic never leaves the sphere. `Math.max(1, …)` keeps a
 * step of at most 90° for an absurdly coarse precision.
 *
 * A pure function of `precisionMeters`: a degree of latitude is the same length
 * everywhere, so this step must not vary with latitude. Only longitude does.
 */
function latitudeStep(precisionMeters: number): number {
  const ideal = precisionMeters / M_PER_DEG_LAT;
  const n = 2 * Math.max(1, Math.round(90 / ideal));
  return 180 / n;
}

/**
 * The longitude step, at a given latitude. A cell must be `precisionMeters`
 * across in METRES — `dy:precisionMeters` is written alongside the coordinate
 * and read as a claim about metres, so a fixed-degree grid would make that
 * triple a lie at every latitude but one (0.34× the claimed width at 70°N).
 * Hence the `cos φ`.
 *
 * IT MUST ALSO DIVIDE 360°, which scaling by `cos φ` alone does not give you.
 * Measured: with an arbitrary step, `snapToPrecision(12, -180, 20000)` returns
 * 179.95, and re-snapping that returns 179.87 — the grid has a seam at the
 * antimeridian, so it is not a grid, and the "snap twice, get the same answer"
 * property that makes averaging attacks useless is gone. Choosing `n` first and
 * deriving the step from it puts the last cell exactly against the first.
 *
 * THE POLAR COLLAPSE FALLS OUT OF THE SAME EXPRESSION, with no special case.
 * At 90° the ideal step is 7.3e13 degrees, `360 / ideal` rounds to 0, and
 * `Math.max(1, …)` makes `n = 1`: one cell covering the whole parallel, which
 * is the right answer because longitude carries no location at the pole.
 * `Math.cos(rad(90))` is 6.1e-17 rather than 0 in IEEE 754, so nothing divides
 * by zero — and if it ever did, `ideal` would be `Infinity`, `360 / Infinity`
 * would be 0, and `n` would still be 1.
 */
function longitudeStep(precisionMeters: number, atLatitude: number): number {
  const ideal = precisionMeters / (M_PER_DEG_LAT * Math.cos(rad(atLatitude)));
  const n = Math.max(1, Math.round(360 / ideal));
  return 360 / n;
}

/**
 * How many decimals to spend. Derived from the latitude step, which is a pure
 * function of the precision, so both axes share a count and it is the same
 * everywhere on the globe.
 *
 * `toFixed(7)` for everything would satisfy `xsd:decimal` and still be wrong:
 * it dresses a 20 km cell as a centimetre measurement in every triple it
 * writes. Two decimals finer than the step is enough to place a cell centre
 * without inventing precision — the quantum lands between step/1000 and
 * step/100, which also keeps the snap idempotent through its own string form:
 * a value re-parsed from the published text is within step/200 of the centre it
 * came from, and rounds back to the same cell.
 *
 * Capped at 7 (~1 cm of latitude, matching `lib/pod/literals.ts`) and floored
 * at 1, because `xsd:decimal` here always carries a decimal point.
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
 * The lexical form actually written.
 *
 * NEGATIVE ZERO IS THE TRAP, and not through the mechanism it looks like:
 * `(-0).toFixed(4)` is `"0.0000"`, because `toFixed` prepends a sign only when
 * `x < 0` and `-0` is not. The reachable path is a value whose MAGNITUDE falls
 * below the emitted quantum, which does keep its sign — `(-0.00045).toFixed(2)`
 * is `"-0.00"`. `decimalPlaces` makes that unreachable here by keeping the
 * quantum two orders finer than the cell — measured: deleting both halves of
 * this guard leaves all 121 tests green — so it is defence in depth rather than
 * the thing keeping them green. It stays because the property it defends is
 * absolute: the zero cell has one spelling, or two points inside it publish
 * differently and the cell has leaked the sign of the input it existed to
 * erase. Anything that widens the quantum makes this reachable again.
 */
function formatDecimal(value: number, places: number): string {
  const text = (value === 0 ? 0 : value).toFixed(places);
  return text.startsWith("-") && Number(text) === 0 ? text.slice(1) : text;
}

/* -------------------------------------------------------------------------- */
/* snapToPrecision                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Snap a coordinate to a deterministic grid of `precisionMeters` and return the
 * `xsd:decimal` lexical forms to write.
 *
 * ROUNDED TO THE CELL CENTRE, NOT THE CORNER. `Math.round(x / step) * step`
 * puts every published value on a grid node and moves the true point by at most
 * half a cell on each axis — half a cell diagonal in total. A `Math.floor`
 * would snap to the corner of the cell the point fell in and displace by up to
 * a FULL diagonal, twice as far, for nothing: the centre halves the error for
 * free. It also matters at the origin, where a floor would publish the four
 * points around null island as four different values in four quadrants.
 *
 * THE PRIMITIVE THROWS. Its contract is "give me a real coordinate", and a
 * plausible-looking string returned for `NaN` is how garbage reaches the Pod
 * wearing an `xsd:decimal` datatype. `fuzzForPublication` is the total boundary
 * that turns each of these into a drop.
 *
 * @throws RangeError on a coordinate off the sphere, a non-finite value, or a
 * precision that is not a positive integer.
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

/** Great-circle distance. Handles the antimeridian for free — `cos Δλ` is
 *  periodic — which is why nothing here subtracts degrees. At 70°N a degree of
 *  longitude is 38.0 km, not 111.2 km, so a distance that scales degrees by one
 *  constant reports the owner's own street as somewhere else. */
function metresApart(a: Coordinate, b: Coordinate): number {
  const dPhi = rad(b.lat - a.lat);
  const dLambda = rad(b.long - a.long);
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Is this point inside the owner's home region? **Inclusive at the radius**:
 * `distance <= radiusMeters`. When in doubt the coordinate is dropped, which is
 * the only direction of error this module can afford.
 *
 * A ZERO RADIUS IS LEGAL HERE AND ILLEGAL IN SETTINGS, deliberately. §7.6: "A
 * stored `dy:homeRadiusMeters` of 0 is rejected on read … What a fuzzing
 * implementation should compute for a zero radius is a separate question, and
 * it stays with that module." This is that answer — this function is geometry,
 * where a degenerate circle is still a circle and the home point is 0 m from
 * itself; `fuzzForPublication` is policy, and §9 pins a zero radius as invalid
 * settings there.
 *
 * The radius is not required to be an integer here for the same reason: §7.6's
 * datatype is enforced by the schema on the way in, not by the geometry.
 *
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
 * The boundary: what may be written next to an entry, given the owner's
 * settings. **Total — it never throws**, and a drop carries no digits at all.
 *
 * INSIDE THE HOME RADIUS THE COORDINATE IS DROPPED, NOT COARSENED. Coarsening
 * maps every entry near home onto one grid cell, and the centroid of that cell
 * is the owner's home to within the cell size: a hundred entries "fuzzed to
 * 2 km" resolve to a single point that is the house, and each new entry
 * sharpens it. Publishing nothing publishes nothing; publishing a coarse value
 * publishes it *repeatedly*, and the repetition is what makes it precise. The
 * tempting shortcut — "20 km is coarse enough" — is the same bug at a larger
 * radius, so the precision argument never buys an exemption.
 *
 * IT FAILS CLOSED, same posture as `sameWebId` and with a higher stake: a
 * fail-open bug here publishes a precise home coordinate to a world-readable
 * resource, which is the worst outcome available to this codebase. Settings
 * that are absent, unreadable or fail their schema mean nothing is published,
 * however far from home the point is.
 *
 * TWO CASES THAT LOOK ALIKE AND ARE NOT, and the distinction is load-bearing:
 * valid settings with NO home region are a legitimate configuration meaning "I
 * have no home to protect" (§7.6), and every coordinate is still fuzzed — it is
 * just never dropped. Reading that as invalid would silently strip every pin
 * from the diary of anyone who has not set a home region.
 *
 * ONE DEFINITION OF "TRUSTWORTHY SETTINGS", NOT TWO. The gate is the same
 * `PrivacySettings` schema `readPrivacySettings` validates against, so a
 * half-written home region, a zero radius or a missing
 * `dy:defaultPrecisionMeters` is rejected here for exactly the reason it was
 * rejected there. The `dy:schemaVersion` gate deliberately stays with the read
 * (§7.6: later terms are purely additive), so this does not re-check it and
 * cannot start dropping coordinates the day the resource gains a predicate.
 *
 * TOTAL BY CONSTRUCTION rather than by catching: the two functions above throw
 * only on input their own preconditions reject, and every one of those
 * preconditions has been checked by the time they are called. No `try` here, so
 * a genuine internal bug surfaces as a failure instead of being laundered into
 * a drop — and a throw would still be fail-closed, since a caller that throws
 * writes nothing.
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

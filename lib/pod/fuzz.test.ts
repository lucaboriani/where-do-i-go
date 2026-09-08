/**
 * lib/pod/fuzz.ts — coordinate fuzzing before the write. docs/data-model.md §9.
 *
 * "The Pod stores only the coordinate you are willing to publish. The studio
 * applies fuzzing before the write and discards the precise original.
 * `dy:precisionMeters` then honestly describes what was stored."
 *
 * Every entry resource is world-readable (decisions.md §5), so this module is
 * the last place a precise coordinate exists. There is no render-time
 * mitigation behind it and no second chance after the PUT: what these functions
 * return is what a stranger can `curl`. That is why the tests are shaped the
 * way they are —
 *
 *   • every "this is dropped" has a "this is published" beside it, because a
 *     fuzzer that drops everything would otherwise pass the whole file;
 *   • every "this is published" is checked for WHAT it published, because a
 *     fuzzer that publishes the true coordinate passes any test that only
 *     asserts a value came back.
 *
 * THE SETTINGS ARE A VALUE, not a fetch. `readPrivacySettings` (§7.6) produces
 * `Result<PrivacySettings>` and test/privacy-settings.test.ts owns that read,
 * including the §7.6 fixture and the schemaVersion gate. This module receives
 * only the parsed value, so: no MSW, no Pod, no clock, no randomness, default
 * `node` environment.
 *
 * FIELD NAMES FOLLOW THE CODE, NOT THE PROSE. `lib/pod/schema.ts` spells the
 * parsed coordinate `long` on both `GeoPoint` and `HomeRegion`, and since
 * 2026-09-06 so does the predicate: `dy:homeLon` was renamed to `dy:homeLong`
 * to match `dy:long` and `dy:centerLong`, which was still possible because
 * nothing had ever written a `privacy.ttl` (§3's naming decisions, §14, and the
 * note in lib/vocab.ts). So `{ lat, long }` is the spelling everywhere on this
 * module's surface, with no exception left anywhere in the project — which is
 * why the `lon` row in the hostile-input table below is about a plausible typo
 * rather than about one of our own predicates.
 */
import { describe, expect, it } from "vitest";
import { fuzzForPublication, isInsideHome, snapToPrecision } from "@/lib/pod/fuzz";

/* ═══════════════════════════════════════════════════════════════════════════
 * Reference geometry, used to MEASURE what the module produced. None of it is
 * the thing under test; it exists so the assertions can be stated in metres,
 * which is the unit the privacy claim is made in.
 * ═════════════════════════════════════════════════════════════════════════ */

/** Spherical earth, the radius every haversine implementation converges on. */
const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;
/** 111 194.93 m. One degree of latitude, the same at every latitude. */
const M_PER_DEG_LAT = EARTH_RADIUS_M * rad(1);

type Point = { lat: number; long: number };

/** Great-circle distance. Handles the antimeridian for free — cos(Δλ) is
 *  periodic — which is why the displacement assertions use it rather than
 *  subtracting degrees. */
function metresApart(a: Point, b: Point): number {
  const dPhi = rad(b.lat - a.lat);
  const dLambda = rad(b.long - a.long);
  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Longitude back into [-180, 180]. Used to CONSTRUCT inputs near the
 *  antimeridian — a test that nudges 179.99° east and hands 180.01° to the
 *  module is testing its own arithmetic, not the module's. */
const wrapLong = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180;

/** A point due north (south, for a negative distance). Chosen over an east-west
 *  offset in the fixtures because the north-south distance is Δlat ×
 *  M_PER_DEG_LAT exactly, with no longitude convergence to argue about. */
const northOf = (p: Point, metres: number): Point => ({
  lat: p.lat + metres / M_PER_DEG_LAT,
  long: p.long,
});

/**
 * HOW SQUARE IS SQUARE ENOUGH. A cell must be `precisionMeters` across in
 * METRES, but an implementation is free to round the grid step to a tidy
 * decimal so the output stays short — so this is a band, not an equality. 1.5×
 * either way admits any sane rounding of the step, including to a power of ten,
 * and still rejects the bug it exists for: a grid of fixed DEGREES, whose cell
 * at 70°N is 0.34× the width it claims.
 */
const CELL_TOLERANCE = 1.5;

/**
 * HOW FAR THE PUBLISHED POINT MAY SIT FROM THE TRUE ONE. Half a cell diagonal,
 * given the band above: 0.5 × √2 × 1.5 = 1.06. Rounded to 1.2 for arithmetic
 * comfort — and note what it excludes. Snapping to the cell CORNER (a floor
 * rather than a round) displaces by up to a full diagonal, 2.1×, so this bound
 * is what pins "nearest cell centre" rather than "the cell this fell in". The
 * centre halves the error for free; the corner is not worth a metre of it.
 */
const DISPLACEMENT_TOLERANCE = 1.2;

const snapPoint = (p: Point, precision: number) => snapToPrecision(p.lat, p.long, precision);
const parse = (s: { lat: string; long: string }): Point => ({
  lat: Number(s.lat),
  long: Number(s.long),
});
/** Digits after the decimal point, which is the thing §6 constrains. */
const fractionDigits = (s: string) => (s.split(".")[1] ?? "").length;

/**
 * The step of the grid, measured from the module's own output rather than
 * recomputed from a formula — a formula here would be a second implementation
 * agreeing with the first about the wrong thing.
 *
 * Walks one axis in small increments and collects the distinct snapped values;
 * on a regular grid those form an arithmetic progression whose common
 * difference IS the step. The probe increment is sized from CELL_TOLERANCE (the
 * widest cell allowed), not from the answer, so nothing here assumes what it
 * measures.
 */
function measureStepDegrees(axis: "lat" | "long", at: Point, precision: number): number {
  const cos = axis === "long" ? Math.cos(rad(at.lat)) : 1;
  const widestAllowed = (CELL_TOLERANCE * precision) / (M_PER_DEG_LAT * cos);
  const probe = widestAllowed / 60;
  const distinct: number[] = [];
  for (let i = 0; i < 6000 && distinct.length < 5; i++) {
    const d = i * probe;
    const here =
      axis === "long" ? { lat: at.lat, long: at.long + d } : { lat: at.lat + d, long: at.long };
    const value = Number(snapPoint(here, precision)[axis]);
    if (distinct.length === 0 || value !== distinct[distinct.length - 1]) distinct.push(value);
  }
  expect(
    distinct.length,
    `walking ${axis} at ${at.lat}°,${at.long}° with precision ${precision} m never produced 5 ` +
      `distinct cells within ${(6000 * probe).toFixed(4)}° — the grid is far coarser than ` +
      `${CELL_TOLERANCE}× ${precision} m, or it is not a grid`,
  ).toBe(5);

  const diffs = distinct.slice(1).map((v, i) => v - distinct[i]);
  for (const diff of diffs) {
    expect(
      Math.abs(diff - diffs[0]) / diffs[0],
      `the ${axis} cells are not all the same width: ${JSON.stringify(diffs)}`,
    ).toBeLessThan(0.25);
  }
  return diffs.reduce((a, b) => a + b, 0) / diffs.length;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * The point table. Every entry is here because it breaks something plausible:
 * a sign, a wrap, or a division by a cosine on its way to zero.
 * ═════════════════════════════════════════════════════════════════════════ */

const POINTS: [name: string, point: Point][] = [
  ["Tokyo — north and east, the ordinary case", { lat: 35.6938, long: 139.7034 }],
  ["Sydney — southern hemisphere", { lat: -33.8688, long: 151.2093 }],
  ["New York — western hemisphere", { lat: 40.7128, long: -74.006 }],
  ["Buenos Aires — both negative", { lat: -34.6037, long: -58.3816 }],
  ["the equator and the prime meridian", { lat: 0, long: 0 }],
  [
    "just south-west of null island, where the snapped value is -0",
    { lat: -0.0004, long: -0.0004 },
  ],
  ["just east of the antimeridian", { lat: -16.5, long: 179.995 }],
  ["just west of the antimeridian", { lat: -16.5, long: -179.995 }],
  ["exactly +180", { lat: 12, long: 180 }],
  ["exactly -180", { lat: 12, long: -180 }],
  ["Svalbard — 78°N", { lat: 78.2232, long: 15.6469 }],
  ["70°N, where a degree of longitude is 38 km", { lat: 70, long: 25 }],
  ["a whisker off the north pole, where cos φ → 0", { lat: 89.99999, long: 12.3 }],
  ["the north pole itself", { lat: 90, long: 0 }],
  ["the south pole itself", { lat: -90, long: 135.5 }],
];

/** Coarsest first. The order is load-bearing in the decimal-places test. */
const PRECISIONS = [20000, 5000, 1000, 500, 200, 50];

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. snapToPrecision is a DETERMINISTIC GRID
 *
 * The design chooses a grid over a random offset for a stated reason: an offset
 * redrawn per write lets an observer average several publications of the same
 * place back to the true point. Determinism is what makes that impossible, and
 * idempotence is determinism you can assert without a second process.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("snapToPrecision: a deterministic grid, not a random offset", () => {
  it.each(POINTS)("%s: snap(snap(x)) === snap(x), at every precision", (_name, point) => {
    for (const precision of PRECISIONS) {
      const once = snapPoint(point, precision);
      const twice = snapToPrecision(Number(once.lat), Number(once.long), precision);
      expect(twice, `${JSON.stringify(point)} @ ${precision} m is not a fixed point`).toEqual(once);
    }
  });

  it("gives the same answer on the hundredth call as on the first", () => {
    // A random offset passes idempotence if it is drawn per CELL. It does not
    // pass this.
    const first = snapPoint({ lat: 35.6938, long: 139.7034 }, 500);
    for (let i = 0; i < 100; i++) {
      expect(snapPoint({ lat: 35.6938, long: 139.7034 }, 500)).toEqual(first);
    }
  });

  it("publishes two nearby points identically — that is what a cell IS", () => {
    // The privacy claim in one assertion: two coordinates a quarter of a cell
    // apart are indistinguishable once published. Measured from the snapped
    // value, which sits at the centre of its own cell, so a quarter-cell nudge
    // cannot cross a boundary.
    for (const [name, point] of POINTS) {
      if (Math.abs(point.lat) > 85) continue; // longitude has no width here; §4 covers the poles
      for (const precision of PRECISIONS) {
        const cell = parse(snapPoint(point, precision));
        const nudgeLat = precision / 4 / M_PER_DEG_LAT;
        const nudgeLong = precision / 4 / (M_PER_DEG_LAT * Math.cos(rad(cell.lat)));
        for (const [dLat, dLong] of [
          [nudgeLat, 0],
          [-nudgeLat, 0],
          [0, nudgeLong],
          [0, -nudgeLong],
        ]) {
          const nudged = snapToPrecision(cell.lat + dLat, wrapLong(cell.long + dLong), precision);
          expect(
            nudged,
            `${name} @ ${precision} m: a ${precision / 4} m nudge changed the published value, ` +
              `so the cell is smaller than it claims, or the snap is to a corner not a centre`,
          ).toEqual(snapPoint({ lat: cell.lat, long: wrapLong(cell.long) }, precision));
        }
      }
    }
  });

  it("does NOT publish two distant points identically — the control for the above", () => {
    // Without this, `snapToPrecision = () => ({ lat: "0.0", long: "0.0" })`
    // passes every determinism test in this block.
    for (const [name, point] of POINTS) {
      if (Math.abs(point.lat) > 85) continue;
      for (const precision of PRECISIONS) {
        const here = snapPoint(point, precision);
        const away = snapPoint(northOf(point, 3 * precision), precision);
        expect(
          away.lat,
          `${name} @ ${precision} m: 3 cells north published the same latitude`,
        ).not.toBe(here.lat);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. THE CELL IS SQUARE IN METRES, so the longitude step divides by cos φ
 *
 * A grid of fixed degrees is ~111 km wide at the equator and metres wide near
 * the pole. `dy:precisionMeters` is written alongside the coordinate and is
 * read as a claim about metres, so a fixed-degree grid makes that triple a lie
 * at every latitude but one.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("snapToPrecision: cells are square in metres, not in degrees", () => {
  const LATITUDES = [0, 45, 70];

  it("uses a WIDER longitude step the further from the equator", () => {
    // The direct refutation of a fixed-degree grid: cos 0° / cos 45° / cos 70°
    // is 1 / 1.41 / 2.92, so each step must be at least a fifth wider than the
    // one below it. A fixed-degree grid returns three equal numbers.
    const steps = LATITUDES.map((lat) => measureStepDegrees("long", { lat, long: 12.3456 }, 500));
    expect(
      steps[1] / steps[0],
      `longitude step at 45°N is ${steps[1]}°, at the equator ${steps[0]}° — cos φ not applied`,
    ).toBeGreaterThan(1.2);
    expect(
      steps[2] / steps[1],
      `longitude step at 70°N is ${steps[2]}°, at 45°N ${steps[1]}° — cos φ not applied`,
    ).toBeGreaterThan(1.2);
  });

  it("uses the SAME latitude step at every latitude", () => {
    // The other half, and it fails if cos φ is applied to both axes: a degree
    // of latitude is the same length everywhere.
    const steps = LATITUDES.map((lat) => measureStepDegrees("lat", { lat, long: 12.3456 }, 500));
    for (const step of steps) {
      expect(
        Math.abs(step - steps[0]) / steps[0],
        `latitude steps differ across latitude: ${JSON.stringify(steps)}`,
      ).toBeLessThan(0.05);
    }
  });

  it.each(LATITUDES)("at %s°N a cell really is precisionMeters across, both axes", (lat) => {
    for (const precision of [200, 500, 5000]) {
      const at = { lat, long: 12.3456 };
      const latMetres = measureStepDegrees("lat", at, precision) * M_PER_DEG_LAT;
      const longMetres =
        measureStepDegrees("long", at, precision) * M_PER_DEG_LAT * Math.cos(rad(lat));
      for (const [axis, metres] of [
        ["latitude", latMetres],
        ["longitude", longMetres],
      ] as const) {
        const message = `${axis} cell at ${lat}°N is ${metres.toFixed(0)} m wide but claims ${precision} m`;
        expect(metres, message).toBeGreaterThan(precision / CELL_TOLERANCE);
        expect(metres, message).toBeLessThan(precision * CELL_TOLERANCE);
      }
    }
  });

  it("never moves a point further than half a cell", () => {
    // Ties the grid back to the promise made to the owner: "500 m" means the
    // pin is within 500 m of the truth. Measured with a great circle, so the
    // antimeridial and polar rows are included rather than excused.
    for (const [name, point] of POINTS) {
      for (const precision of PRECISIONS) {
        const moved = metresApart(point, parse(snapPoint(point, precision)));
        expect(
          moved,
          `${name} @ ${precision} m moved ${moved.toFixed(0)} m — more than ` +
            `${DISPLACEMENT_TOLERANCE}× the precision it claims`,
        ).toBeLessThan(DISPLACEMENT_TOLERANCE * precision);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. THE VALUES ARE STRINGS, because CLAUDE.md mandates xsd:decimal
 *
 * A naive float snap yields 35.010000000000005: a wrong datatype (xsd:decimal
 * has no exponent form and no business carrying 15 digits) AND a precision leak
 * dressed as a rounding artefact. Returning numbers hands that decision to
 * whichever serialiser is downstream; returning strings makes it this module's
 * problem, which is where it belongs — `lib/pod/entry-model.ts` writes
 * whatever it is given.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("snapToPrecision: xsd:decimal lexical form, never a float artefact", () => {
  /** No exponent, a decimal point always present, at most 7 fraction digits —
   *  7 is ~1 cm of latitude, and the coarsest thing this module emits is a
   *  20 km cell. `lib/pod/literals.ts` uses the same ceiling. */
  const DECIMAL = /^-?(0|[1-9]\d*)\.\d{1,7}$/;

  it.each(POINTS)("%s: both values are decimal strings at every precision", (name, point) => {
    for (const precision of PRECISIONS) {
      const snapped = snapPoint(point, precision);
      expect(Object.keys(snapped).sort(), `${name}: unexpected shape`).toEqual(["lat", "long"]);
      for (const [axis, value] of Object.entries(snapped)) {
        expect(typeof value, `${name} @ ${precision} m: ${axis} is not a string`).toBe("string");
        expect(
          value,
          `${name} @ ${precision} m: ${axis} is "${value}" — not an xsd:decimal this project ` +
            `will write. A raw float snap lands here with 14 fraction digits.`,
        ).toMatch(DECIMAL);
        expect(value, `${name} @ ${precision} m: ${axis} carries an exponent`).not.toMatch(/e/i);
        // Reachable whenever the emitted quantum is coarser than the cell:
        // (-0.00045).toFixed(2) is "-0.00", which matches DECIMAL above and is
        // still a coordinate spelling a sign it does not have.
        expect(
          Object.is(Number(value), -0),
          `${name} @ ${precision} m: ${axis} is negative zero ("${value}"). The zero cell has ` +
            `one spelling, or two points in it publish differently.`,
        ).toBe(false);
      }
    }
  });

  it("gives the zero cell exactly one spelling, in all four quadrants", () => {
    /**
     * All four are inside the cell at the origin, so all four must publish as
     * the same string: a cell that spells its own sign has leaked the sign of
     * the input it existed to erase.
     *
     * MEASURED, because the obvious mechanism turns out not to be one:
     * `(-0).toFixed(4)` is "0.0000", not "-0.0000" — toFixed prepends a sign
     * only when `x < 0`, and -0 is not. The reachable path is a value whose
     * MAGNITUDE falls below the emitted quantum, which does keep its sign:
     * `(-0.00045).toFixed(2)` is "-0.00". That is caught by the negative-zero
     * arm of the sweep above; this case pins the rule the sweep enforces.
     */
    const quadrants = [
      [0.0004, 0.0004],
      [-0.0004, 0.0004],
      [0.0004, -0.0004],
      [-0.0004, -0.0004],
    ];
    const published = quadrants.map(([lat, long]) => snapToPrecision(lat, long, 500));
    for (const [i, value] of published.entries()) {
      expect(value, `quadrant ${JSON.stringify(quadrants[i])} publishes differently`).toEqual(
        published[0],
      );
      expect(Object.is(Number(value.lat), 0), `lat "${value.lat}" is a signed zero`).toBe(true);
      expect(Object.is(Number(value.long), 0), `long "${value.long}" is a signed zero`).toBe(true);
    }
  });

  it("spends fewer decimals on a 20 km cell than on a 50 m one", () => {
    // The count has to follow the precision. `toFixed(7)` everywhere passes the
    // regex above and is still wrong: it dresses a 20 km cell as a centimetre
    // measurement in every triple it writes. Compared as a maximum over the
    // whole table, so one value trimming a trailing zero cannot decide it.
    const widest = (precision: number) =>
      Math.max(
        ...POINTS.flatMap(([, point]) => {
          const s = snapPoint(point, precision);
          return [fractionDigits(s.lat), fractionDigits(s.long)];
        }),
      );
    const byPrecision = PRECISIONS.map((p) => [p, widest(p)] as const);
    const table = JSON.stringify(byPrecision);

    expect(widest(20000), `a 20 km grid should not need 5 decimals: ${table}`).toBeLessThanOrEqual(
      4,
    );
    expect(
      widest(20000) + 2,
      `20 km and 50 m grids emit near-identical decimal counts: ${table}`,
    ).toBeLessThanOrEqual(widest(50));
    // And monotone in between, coarsest first.
    for (let i = 1; i < byPrecision.length; i++) {
      expect(
        byPrecision[i][1],
        `precision ${byPrecision[i][0]} m emits fewer decimals than the coarser ` +
          `${byPrecision[i - 1][0]} m: ${table}`,
      ).toBeGreaterThanOrEqual(byPrecision[i - 1][1]);
    }
  });

  it("survives the round trip through a number that the call site forces", () => {
    // `GeoPoint` in lib/pod/schema.ts types lat and long as `number`, so the
    // string CANNOT reach the Pod without being parsed back — and that is only
    // safe because it is short. This is the assertion that keeps it short:
    // re-serialising the parsed value must not reintroduce what the string
    // form exists to prevent.
    for (const [name, point] of POINTS) {
      for (const precision of PRECISIONS) {
        const snapped = snapPoint(point, precision);
        for (const value of [snapped.lat, snapped.long]) {
          const roundTripped = String(Number(value));
          expect(
            roundTripped,
            `${name} @ ${precision} m: "${value}" → "${roundTripped}"`,
          ).not.toMatch(/e/i);
          expect(
            fractionDigits(roundTripped),
            `${name} @ ${precision} m: "${value}" parses and re-prints as "${roundTripped}"`,
          ).toBeLessThanOrEqual(7);
        }
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. THE EDGES OF THE SPHERE
 *
 * ±180 and ±90 are ordinary coordinates that arithmetic turns into invalid
 * ones. A snapped longitude of 180.05 is not a longitude; a latitude of 91 is
 * not a latitude; and at the pole the longitude step divides by a cosine that
 * is 6.1e-17 rather than 0, so nothing throws and the grid quietly becomes
 * 73 trillion degrees wide.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("snapToPrecision: the antimeridian and the poles", () => {
  it.each(POINTS)("%s: stays on the sphere at every precision", (name, point) => {
    for (const precision of PRECISIONS) {
      const { lat, long } = parse(snapPoint(point, precision));
      expect(Number.isFinite(lat), `${name} @ ${precision} m: latitude is ${lat}`).toBe(true);
      expect(Number.isFinite(long), `${name} @ ${precision} m: longitude is ${long}`).toBe(true);
      expect(
        Math.abs(lat),
        `${name} @ ${precision} m: latitude ${lat} is off the sphere`,
      ).toBeLessThanOrEqual(90);
      expect(
        Math.abs(long),
        `${name} @ ${precision} m: longitude ${long} is off the sphere`,
      ).toBeLessThanOrEqual(180);
    }
  });

  it("wraps across the antimeridian rather than jumping hemisphere", () => {
    // 179.995 in a 20 km cell rounds to a multiple past 180. Both -179.x and
    // 180 are defensible answers; 179.9 is not, and neither is 0. The
    // displacement test above says the answer is the RIGHT one; this says the
    // pair either side of the line land in the same place, which a subtraction
    // without wraparound never does.
    const east = parse(snapToPrecision(0, 179.999, 20000));
    const west = parse(snapToPrecision(0, -179.999, 20000));
    expect(
      metresApart(east, west),
      `179.999° published as ${east.long}° and -179.999° as ${west.long}° — 222 m apart in truth`,
    ).toBeLessThan(2 * DISPLACEMENT_TOLERANCE * 20000);
  });

  it("collapses every longitude to one cell at the pole", () => {
    // The decision, pinned: at the pole longitude carries no location, so the
    // whole parallel is a single cell and the published longitude is zero.
    // Anything else publishes a bearing the owner never had, and dividing by
    // cos 90° publishes 73 trillion degrees.
    for (const lat of [90, -90]) {
      const published = [0, 12.3, -170, 179.9].map((long) => snapToPrecision(lat, long, 500));
      for (const p of published) {
        expect(p, `at ${lat}° every longitude must publish alike`).toEqual(published[0]);
        expect(
          Object.is(Number(p.long), 0),
          `at ${lat}° the published longitude is "${p.long}", not a positive zero`,
        ).toBe(true);
      }
      expect(Math.abs(Number(published[0].lat))).toBeLessThanOrEqual(90);
    }
  });

  it("the control: at 78°N longitude still varies", () => {
    // Without this, "collapse everything above 60°N to longitude 0" passes the
    // test above, and Svalbard publishes as the pole.
    const a = snapToPrecision(78.2232, 15.6469, 500);
    const b = snapToPrecision(78.2232, 16.6469, 500);
    expect(a.long).not.toBe(b.long);
    expect(Number(a.long)).toBeGreaterThan(15);
    expect(Number(a.long)).toBeLessThan(16.5);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. INVALID INPUT IS REFUSED, LOUDLY
 *
 * snapToPrecision is the primitive, and its contract is "give me a real
 * coordinate". A plausible-looking string returned for NaN is how garbage
 * reaches the Pod wearing an xsd:decimal datatype. It throws.
 *
 * fuzzForPublication is the boundary, and it is total: §8 pins that it turns
 * every one of these into a drop rather than propagating the throw.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("snapToPrecision: input it will not accept", () => {
  const REJECTED: [name: string, lat: number, long: number, precision: number][] = [
    ["latitude past the north pole", 90.000001, 12, 500],
    ["latitude past the south pole", -90.5, 12, 500],
    ["longitude past +180", 12, 180.5, 500],
    ["longitude past -180", 12, -180.000001, 500],
    ["NaN latitude", Number.NaN, 12, 500],
    ["NaN longitude", 12, Number.NaN, 500],
    ["infinite latitude", Number.POSITIVE_INFINITY, 12, 500],
    ["infinite longitude", 12, Number.NEGATIVE_INFINITY, 500],
    ["zero precision", 35, 139, 0],
    ["negative precision", 35, 139, -500],
    ["NaN precision", 35, 139, Number.NaN],
    ["infinite precision", 35, 139, Number.POSITIVE_INFINITY],
    // dy:precisionMeters is xsd:integer, and lib/pod/schema.ts already says
    // .int().positive() on GeoPoint. A fractional grid cannot be written back
    // honestly, so it is refused rather than rounded on the owner's behalf.
    ["fractional precision", 35, 139, 500.5],
  ];

  it.each(REJECTED)("%s: throws a RangeError", (_name, lat, long, precision) => {
    expect(() => snapToPrecision(lat, long, precision)).toThrow(RangeError);
  });

  it("the control: the extremes themselves are valid and are NOT refused", () => {
    // A guard of `Math.abs(lat) >= 90` rejects the poles, which are places.
    // Without this the table above is satisfied by a function that throws at
    // every call.
    for (const [lat, long] of [
      [90, 180],
      [-90, -180],
      [0, 0],
      [90, 0],
    ]) {
      expect(
        () => snapToPrecision(lat, long, 1),
        `${lat}, ${long} is a real coordinate`,
      ).not.toThrow();
    }
    expect(() => snapToPrecision(35, 139, 1)).not.toThrow();
    expect(() => snapToPrecision(35, 139, 1_000_000)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. isInsideHome — haversine, and inclusive at the boundary
 *
 * The second argument is `HomeRegion` (lib/pod/schema.ts): { lat, long,
 * radiusMeters }.
 * ═════════════════════════════════════════════════════════════════════════ */

/** §7.6's own fixture values. Milan. */
const HOME = { lat: 45.4655, long: 9.1866, radiusMeters: 3000 };
const HOME_POINT: Point = { lat: HOME.lat, long: HOME.long };
const TOKYO: Point = { lat: 35.6938, long: 139.7034 };

describe("isInsideHome", () => {
  it("says yes near home and no far from it", () => {
    // The pair. Either assertion alone is satisfied by a constant.
    expect(isInsideHome(northOf(HOME_POINT, 300), HOME)).toBe(true);
    expect(isInsideHome(northOf(HOME_POINT, 9000), HOME)).toBe(false);
    expect(isInsideHome(TOKYO, HOME)).toBe(false);
  });

  it("puts the boundary at exactly radiusMeters, on the INSIDE", () => {
    /**
     * The decision: `distance <= radiusMeters`. When in doubt the coordinate is
     * dropped, which is the only direction of error this module can afford.
     *
     * PINNED AT ZERO, the one distance every haversine agrees on to the bit: a
     * point AT the home coordinate is 0 m away, and `0 <= 0`. Any other "exact"
     * boundary point would depend on whether the implementation divides by
     * 6 371 000 or 6 378 137 and would be measuring that instead.
     *
     * A zero radius is legal HERE and illegal in settings, and that split is
     * deliberate. §7.6: "A stored dy:homeRadiusMeters of 0 is rejected on read
     * … What a fuzzing implementation should compute for a zero radius is a
     * separate question, and it stays with that module." This is that answer —
     * `isInsideHome` is geometry, where a degenerate circle is a circle;
     * `fuzzForPublication` is policy, and §9 pins it as invalid there.
     */
    const zeroRadius = { ...HOME, radiusMeters: 0 };
    expect(isInsideHome(HOME_POINT, zeroRadius), "the home point is inside its own radius").toBe(
      true,
    );
    expect(isInsideHome(northOf(HOME_POINT, 1), zeroRadius), "a metre away is not").toBe(false);

    // And the approach to a real boundary from both sides, ±1% — loose enough
    // to accept either earth radius, tight enough that a factor-of-two error in
    // the distance cannot hide in it.
    expect(isInsideHome(northOf(HOME_POINT, 0.99 * HOME.radiusMeters), HOME)).toBe(true);
    expect(isInsideHome(northOf(HOME_POINT, 1.01 * HOME.radiusMeters), HOME)).toBe(false);
    expect(isInsideHome(northOf(HOME_POINT, -0.99 * HOME.radiusMeters), HOME)).toBe(true);
    expect(isInsideHome(northOf(HOME_POINT, -1.01 * HOME.radiusMeters), HOME)).toBe(false);
  });

  it("measures a great circle, not a difference of degrees", () => {
    /**
     * At 70°N a degree of longitude is 38.0 km, not 111.2 km — so a distance
     * that subtracts degrees and scales by one constant computes 44.5 km for a
     * 0.4° offset and reports the owner's own street as somewhere else.
     *
     * 0.4° east of (70, 25) is 15 212 m by great circle; 1.0° east is 38 030 m.
     */
    const arctic = { lat: 70, long: 25, radiusMeters: 20000 };
    expect(
      isInsideHome({ lat: 70, long: 25.4 }, arctic),
      "15.2 km east at 70°N is inside a 20 km radius; only a degree-based distance disagrees",
    ).toBe(true);
    expect(isInsideHome({ lat: 70, long: 26 }, arctic), "38 km east is outside").toBe(false);
    // The control on the other axis, where degrees and metres agree.
    expect(isInsideHome(northOf({ lat: 70, long: 25 }, 15000), arctic)).toBe(true);
    expect(isInsideHome(northOf({ lat: 70, long: 25 }, 38000), arctic)).toBe(false);
  });

  it("does not think the antimeridian is 40 000 km wide", () => {
    // 179.9°E to 179.9°W is 22.2 km apart. A Δλ of 359.8° is what a subtraction
    // without wraparound produces, and a home on Fiji then covers nothing.
    const fiji = { lat: 0, long: 179.9, radiusMeters: 30000 };
    expect(isInsideHome({ lat: 0, long: -179.9 }, fiji)).toBe(true);
    expect(isInsideHome({ lat: 0, long: -179.4 }, fiji)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. fuzzForPublication — INSIDE THE HOME RADIUS, THE COORDINATE IS DROPPED
 *
 * Not coarsened. Coarsening pins every home entry inside one known cell, and a
 * handful of them identify it: the centroid of the cluster is where the owner
 * sleeps. §9's premise is that a public resource holds only what may be
 * published, and "the owner's home, to 5 km" may not be.
 *
 * The settings are `PrivacySettings` (§7.6): the home region is OPTIONAL and
 * absent means "I have no home to protect", which is a legitimate setting and a
 * different fact from "the settings could not be read".
 * ═════════════════════════════════════════════════════════════════════════ */

const SETTINGS = {
  iri: "https://me.solidcommunity.net/travel/settings/privacy.ttl#it",
  schemaVersion: 1,
  home: HOME,
  defaultPrecisionMeters: 500,
  modified: "2026-09-06T11:20:04+02:00",
};

/** The hostile tables below are deliberately ill-typed: their subject is what
 *  happens when the value handed over is not the shape the types promise. */
const asSettings = (v: unknown) => v as Parameters<typeof fuzzForPublication>[1];
const asPoint = (v: unknown) => v as Parameters<typeof fuzzForPublication>[0];

function snapped(result: ReturnType<typeof fuzzForPublication>) {
  if (result.kind !== "snap") throw new Error(`expected a snap, got ${JSON.stringify(result)}`);
  return result;
}

describe("fuzzForPublication: the home region", () => {
  it("drops the coordinate entirely inside the radius, carrying nothing of it", () => {
    const result = fuzzForPublication(northOf(HOME_POINT, 200), SETTINGS);
    expect(result).toEqual({ kind: "drop", reason: "insideHome" });
    // Exactly: no coarsened value tucked into a field the caller might forward.
    // A drop result contains no digits at all, so this cannot be satisfied by a
    // coordinate rounded until it looks harmless.
    expect(
      JSON.stringify(result),
      "the drop result carries a number — the only safe amount of the home coordinate is none",
    ).not.toMatch(/\d/);
  });

  it("publishes the same trip's other entries — the allow-case", () => {
    // Beside every drop. Without it a fuzzer that returns { kind: "drop" }
    // unconditionally passes this whole file, and the diary silently loses
    // every pin it has.
    const result = snapped(fuzzForPublication(TOKYO, SETTINGS));
    expect(result).toEqual({
      kind: "snap",
      ...snapToPrecision(TOKYO.lat, TOKYO.long, 500),
      precisionMeters: 500,
    });
  });

  it("switches from published to dropped across the radius, 200 m apart", () => {
    // The two sit either side of one boundary with identical settings, so this
    // fails if the radius is ignored in EITHER direction.
    expect(fuzzForPublication(northOf(HOME_POINT, 2900), SETTINGS)).toEqual({
      kind: "drop",
      reason: "insideHome",
    });
    expect(snapped(fuzzForPublication(northOf(HOME_POINT, 3100), SETTINGS)).kind).toBe("snap");
  });

  it("still drops the home when the requested precision is coarser than the region", () => {
    // The tempting shortcut: "20 km is coarse enough, publish it." It is not —
    // it publishes the fact that the owner was home, in a cell that repeats
    // across every home entry in the diary.
    for (const precision of [500, 5000, 20000]) {
      expect(fuzzForPublication(HOME_POINT, SETTINGS, precision)).toEqual({
        kind: "drop",
        reason: "insideHome",
      });
    }
  });

  it("with NO home region, fuzzes every coordinate and drops none", () => {
    /**
     * §7.6, verbatim: "Omitting all three home values is a legitimate
     * configuration and means 'I have no home to protect': fuzzing still
     * applies to every coordinate, it just never drops one."
     *
     * The pair below is the one §7.6 warns about specifically — an absent home
     * region and a zero radius are NOT the same fact, and a reader that
     * conflates them "publishes coordinates from the owner's doorstep while
     * reporting success".
     */
    const noHome = { ...SETTINGS, home: undefined };
    // The very coordinate that IS home under the other settings.
    const result = snapped(fuzzForPublication(HOME_POINT, asSettings(noHome)));
    expect(result).toEqual({
      kind: "snap",
      ...snapToPrecision(HOME.lat, HOME.long, 500),
      precisionMeters: 500,
    });
    // Still fuzzed, though: "no home to protect" is not "publish exactly".
    expect(result.lat).not.toBe(String(HOME.lat));
    expect(result.long).not.toBe(String(HOME.long));
    expect(metresApart(HOME_POINT, parse(result))).toBeGreaterThan(0);
    // And the deny-case beside it, from the identical point.
    expect(fuzzForPublication(HOME_POINT, SETTINGS)).toEqual({
      kind: "drop",
      reason: "insideHome",
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. fuzzForPublication FAILS CLOSED
 *
 * Same posture as `sameWebId`, which fails closed so that a mistyped
 * OWNER_WEBID makes nobody the owner rather than everybody. The stake here is
 * higher: a fail-OPEN bug publishes a precise home coordinate to a world-
 * readable resource, which is the worst outcome available to this codebase.
 *
 * §9: settings absent, unreadable, or failing their schema → nothing is
 * published. `readPrivacySettings` returns those as a PodError rather than a
 * value, so a caller reaching here with a broken one has already gone wrong —
 * which is exactly when a second gate is worth having.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("fuzzForPublication: settings it cannot trust", () => {
  const BROKEN: [name: string, settings: unknown][] = [
    ["absent settings", undefined],
    ["null settings", null],
    ["an empty object", {}],
    ["settings that are a string", "homeLat=45"],
    ["settings that are an array", []],
    ["the Result wrapper, unwrapped by mistake", { ok: true, value: SETTINGS }],
    // §7.6: the three home values are accepted "all together or not at all".
    // The reader enforces it; this is the second gate, because a half-written
    // home read as "no home" publishes from the owner's doorstep.
    ["a home with no radius", { ...SETTINGS, home: { lat: HOME.lat, long: HOME.long } }],
    ["a home with no latitude", { ...SETTINGS, home: { long: HOME.long, radiusMeters: 3000 } }],
    ["a home with no longitude", { ...SETTINGS, home: { lat: HOME.lat, radiusMeters: 3000 } }],
    ["a home that is null", { ...SETTINGS, home: null }],
    ["a home that is not an object", { ...SETTINGS, home: 3000 }],
    ["a NaN home latitude", { ...SETTINGS, home: { ...HOME, lat: Number.NaN } }],
    ["a home latitude off the sphere", { ...SETTINGS, home: { ...HOME, lat: 91 } }],
    ["a home longitude off the sphere", { ...SETTINGS, home: { ...HOME, long: -180.5 } }],
    ["a home coordinate left as a string", { ...SETTINGS, home: { ...HOME, lat: "45.4655" } }],
    // §7.6 rejects a stored zero radius outright: "No deliberate configuration
    // produces it … it means a partial or corrupted write, and §9's fail-closed
    // rule is the right answer to that."
    ["a zero radius", { ...SETTINGS, home: { ...HOME, radiusMeters: 0 } }],
    ["a negative radius", { ...SETTINGS, home: { ...HOME, radiusMeters: -1 } }],
    ["a NaN radius", { ...SETTINGS, home: { ...HOME, radiusMeters: Number.NaN } }],
    ["an infinite radius", { ...SETTINGS, home: { ...HOME, radiusMeters: Infinity } }],
    ["a fractional radius", { ...SETTINGS, home: { ...HOME, radiusMeters: 3000.5 } }],
    // §7.6: required outright, "because a fallback is a distance this project
    // would be choosing for someone else's front door".
    ["a missing defaultPrecisionMeters", { ...SETTINGS, defaultPrecisionMeters: undefined }],
    ["a zero defaultPrecisionMeters", { ...SETTINGS, defaultPrecisionMeters: 0 }],
    ["a negative defaultPrecisionMeters", { ...SETTINGS, defaultPrecisionMeters: -500 }],
    ["a fractional defaultPrecisionMeters", { ...SETTINGS, defaultPrecisionMeters: 500.5 }],
    ["a NaN defaultPrecisionMeters", { ...SETTINGS, defaultPrecisionMeters: Number.NaN }],
    ["a defaultPrecisionMeters left as a string", { ...SETTINGS, defaultPrecisionMeters: "500" }],
    // One definition of "trustworthy settings", not two: this is the value
    // readPrivacySettings returns, or it is not published.
    ["a missing iri", { ...SETTINGS, iri: undefined }],
    ["a missing schemaVersion", { ...SETTINGS, schemaVersion: undefined }],
  ];

  it.each(BROKEN)("%s: nothing is published, at any distance from home", (name, settings) => {
    // The mutation really happened. This repository has shipped a negative test
    // whose fixture edit silently did not apply, and every row above is a
    // spread whose override is a no-op if a field name drifts.
    expect(settings, `${name} is indistinguishable from valid settings`).not.toEqual(SETTINGS);

    // TOKYO is 9 700 km from home. A fuzzer that consults the settings only to
    // locate the home region would happily publish it.
    const result = fuzzForPublication(asPoint(TOKYO), asSettings(settings));
    expect(result).toEqual({ kind: "drop", reason: "invalidSettings" });
    expect(JSON.stringify(result), `${name}: a coordinate survived the drop`).not.toMatch(/\d/);
  });

  it("the control: the same settings unmutated DO publish", () => {
    // Without this the table above is satisfied by a function that never
    // publishes anything, and "fails closed" is indistinguishable from "is
    // broken".
    expect(snapped(fuzzForPublication(TOKYO, SETTINGS)).kind).toBe("snap");
  });

  it("tolerates a field it does not know, rather than failing closed on it", () => {
    // Forward compatibility, and why it is worth a test: privacy.ttl gaining a
    // predicate in schemaVersion 2 must not silently strip every coordinate
    // from a diary written by an older build. §7.6 says adding terms is
    // "purely additive and nothing here moves".
    const extended = { ...SETTINGS, fuzzPhotosToo: true, somethingLater: "hello" };
    expect(snapped(fuzzForPublication(TOKYO, asSettings(extended))).precisionMeters).toBe(500);
  });

  it("drops a point it cannot read, and never throws on one", () => {
    const HOSTILE_POINTS: [name: string, point: unknown][] = [
      ["undefined", undefined],
      ["null", null],
      ["an empty object", {}],
      ["a NaN latitude", { lat: Number.NaN, long: 139.7 }],
      ["a NaN longitude", { lat: 35.7, long: Number.NaN }],
      ["an infinite latitude", { lat: Infinity, long: 139.7 }],
      ["a latitude off the sphere", { lat: 91, long: 139.7 }],
      ["a longitude off the sphere", { lat: 35.7, long: 181 }],
      ["coordinates left as strings", { lat: "35.7", long: "139.7" }],
      ["the schema.org field names", { latitude: 35.7, longitude: 139.7 }],
      // `lon`, not `long` — the one-character near-miss, and still a real one
      // even though NOTHING in this project spells a coordinate that way any
      // more: `dy:homeLon` became `dy:homeLong` on 2026-09-06 (§3, §14). What
      // this row guards is a call site typing the spelling half the ecosystem
      // uses — plenty of geocoders and weather APIs hand back `{ lat, lon }` —
      // whose longitude then arrives here as `undefined`. A fuzzer that read it
      // positionally, or that filled a missing longitude with 0, would publish
      // a point on the Gulf of Guinea meridian and call it the owner's evening.
      ["lon instead of long", { lat: 35.7, lon: 139.7 }],
    ];
    for (const [name, point] of HOSTILE_POINTS) {
      let result: ReturnType<typeof fuzzForPublication> | undefined;
      expect(() => {
        result = fuzzForPublication(asPoint(point), SETTINGS);
      }, `${name} threw — the boundary is total, the primitive is what throws`).not.toThrow();
      expect(result, `${name} was published`).toEqual({ kind: "drop", reason: "invalidPoint" });
    }
  });

  it("drops when the caller asks for a precision it cannot honour", () => {
    // Fails closed rather than falling back to the default: a caller passing
    // NaN has a bug, and publishing at 500 m hides it behind a coordinate that
    // looks deliberate.
    for (const precision of [0, -1, Number.NaN, Infinity, 500.5]) {
      expect(fuzzForPublication(TOKYO, SETTINGS, precision)).toEqual({
        kind: "drop",
        reason: "invalidPrecision",
      });
    }
    // The allow-case: a precision it CAN honour.
    expect(snapped(fuzzForPublication(TOKYO, SETTINGS, 1)).precisionMeters).toBe(1);
  });

  it("never throws, whatever it is handed", () => {
    const soup = [undefined, null, {}, [], "", 0, Number.NaN, { lat: 1 }, { long: 1 }, HOME];
    for (const point of soup) {
      for (const settings of soup) {
        expect(() => fuzzForPublication(asPoint(point), asSettings(settings))).not.toThrow();
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. THE PRECISION ACTUALLY USED
 *
 * The result reports a precision, and that number is written to the Pod as
 * dy:precisionMeters next to the coordinate, where it is read as a claim about
 * how far the pin may be from the truth. If the reported number is not the one
 * applied, the triple is a lie in whichever direction is worse.
 * ═════════════════════════════════════════════════════════════════════════ */

describe("fuzzForPublication: the precision it reports is the precision it applied", () => {
  it("defaults to defaultPrecisionMeters when the caller does not ask", () => {
    const result = snapped(fuzzForPublication(TOKYO, SETTINGS));
    expect(result.precisionMeters).toBe(SETTINGS.defaultPrecisionMeters);
    expect({ lat: result.lat, long: result.long }).toEqual(
      snapToPrecision(TOKYO.lat, TOKYO.long, SETTINGS.defaultPrecisionMeters),
    );
  });

  it("uses an explicit precision over the default, and says so", () => {
    const result = snapped(fuzzForPublication(TOKYO, SETTINGS, 20000));
    expect(result.precisionMeters).toBe(20000);
    expect({ lat: result.lat, long: result.long }).toEqual(
      snapToPrecision(TOKYO.lat, TOKYO.long, 20000),
    );
  });

  it("really applies it: 20 km and 500 m do not publish the same cell", () => {
    // The control for the two above, which a fuzzForPublication that echoes
    // `precisionMeters` back while always snapping at the default would pass.
    const coarse = snapped(fuzzForPublication(TOKYO, SETTINGS, 20000));
    const fine = snapped(fuzzForPublication(TOKYO, SETTINGS, 500));
    expect({ lat: coarse.lat, long: coarse.long }).not.toEqual({
      lat: fine.lat,
      long: fine.long,
    });
    // Coarser means further from the truth, and 20 km of it is visible.
    expect(metresApart(TOKYO, parse(coarse))).toBeGreaterThan(metresApart(TOKYO, parse(fine)));
  });

  it("reports an integer, because dy:precisionMeters is an xsd:integer", () => {
    for (const precision of [50, 500, 20000]) {
      const result = snapped(fuzzForPublication(TOKYO, SETTINGS, precision));
      expect(Number.isInteger(result.precisionMeters)).toBe(true);
      expect(result.precisionMeters).toBe(precision);
    }
  });

  it("hands back strings, so the caller cannot re-float what was just fixed", () => {
    const result = snapped(fuzzForPublication(TOKYO, SETTINGS));
    expect(Object.keys(result).sort()).toEqual(["kind", "lat", "long", "precisionMeters"]);
    expect(typeof result.lat).toBe("string");
    expect(typeof result.long).toBe("string");
    expect(result.lat).toMatch(/^-?(0|[1-9]\d*)\.\d{1,7}$/);
    expect(result.long).toMatch(/^-?(0|[1-9]\d*)\.\d{1,7}$/);
  });
});

import type { FeatureCollection, Point } from "geojson";
import { fitOptions, type Bbox } from "./view";

export type TripPoint = {
  slug: string;
  name: string;
  center?: { lat: number; long: number };
  bbox?: Bbox;
};

type Placed = TripPoint & { center: { lat: number; long: number } };

const isPlaced = (trip: TripPoint): trip is Placed => trip.center !== undefined;

/** A degree either side of a lone centre: fitBounds on a zero-width box zooms
 *  to its maximum, which on a globe is a view of one street. */
const LONE_PAD = 1;

export function buildTripPoints(
  trips: TripPoint[],
): FeatureCollection<Point, { slug: string; name: string }> {
  return {
    type: "FeatureCollection",
    features: trips.filter(isPlaced).map((trip) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [trip.center.long, trip.center.lat] },
      properties: { slug: trip.slug, name: trip.name },
    })),
  };
}

export function centresBbox(trips: TripPoint[]): Bbox | undefined {
  const placed = trips.filter(isPlaced);
  if (placed.length === 0) return undefined;
  const longs = placed.map((trip) => trip.center.long);
  const lats = placed.map((trip) => trip.center.lat);
  const pad = placed.length === 1 ? LONE_PAD : 0;
  return {
    west: Math.min(...longs) - pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...longs) + pad,
    north: Math.max(...lats) + pad,
  };
}

/** The same object `fitOptions` returns, animated: both are destructured into
 *  `map.fitBounds(bounds, camera)` at the call site. Staying pure means it does
 *  NOT read prefers-reduced-motion — the hook overrides the flag. */
export function flyOptions(bbox: Bbox) {
  return { ...fitOptions(bbox), animate: true as const };
}

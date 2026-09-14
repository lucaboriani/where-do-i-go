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

/** The same object `fitOptions` returns, animated: both are destructured into
 *  `map.fitBounds(bounds, camera)` at the call site. Staying pure means it does
 *  NOT read prefers-reduced-motion — the hook overrides the flag. */
export function flyOptions(bbox: Bbox) {
  return { ...fitOptions(bbox), animate: true as const };
}

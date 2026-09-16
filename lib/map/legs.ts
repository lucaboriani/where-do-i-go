import type { FeatureCollection, LineString, Position } from "geojson";
import { hasCoordinate } from "@/lib/map/points";
import type { IndexEntry, TravelMode } from "@/lib/pod/schema";

export type LegProps = { mode: TravelMode | "Unknown"; fromSlug: string; toSlug: string };

const D2R = Math.PI / 180;

// Great-circle interpolation. On the globe this is the path actually travelled;
// on the trip map it reads as a journey, not a vector. See ./notes.md#the-leg-is-an-arc-not-a-vector
export function arcCoordinates(from: Position, to: Position, segments = 24): Position[] {
  const [lon1, lat1] = [from[0] * D2R, from[1] * D2R];
  const [lon2, lat2] = [to[0] * D2R, to[1] * D2R];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (d === 0) return [from, to];
  const out: Position[] = [from];
  // i=0 and i=segments push the literal endpoints: the atan2/sqrt unwind of
  // the slerp loses a bit or two at the poles of f, and the map wants an arc
  // that starts and ends exactly on its markers, not a float apart from them.
  for (let i = 1; i < segments; i++) {
    const f = i / segments;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    out.push([Math.atan2(y, x) / D2R, Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R]);
  }
  out.push(to);
  return out;
}

export function orderEntries(entries: IndexEntry[]): IndexEntry[] {
  return [...entries].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.occurredAt ?? "").localeCompare(b.occurredAt ?? ""),
  );
}

export function buildLegs(entries: IndexEntry[]): FeatureCollection<LineString, LegProps> {
  const placed = orderEntries(entries).filter(hasCoordinate);
  return {
    type: "FeatureCollection",
    features: placed.slice(1).map((to, i) => {
      const from = placed[i];
      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: arcCoordinates([from.long, from.lat], [to.long, to.lat]),
        },
        // The mode belongs to the arriving leg, not the departing one (§6).
        properties: { mode: to.travelModeFrom ?? "Unknown", fromSlug: from.slug, toSlug: to.slug },
      };
    }),
  };
}

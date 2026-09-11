import type { FeatureCollection, LineString } from "geojson";
import { hasCoordinate } from "@/lib/map/points";
import type { IndexEntry, TravelMode } from "@/lib/pod/schema";

export type LegProps = { mode: TravelMode | "Unknown"; fromSlug: string; toSlug: string };

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
          coordinates: [
            [from.long, from.lat],
            [to.long, to.lat],
          ],
        },
        // The mode belongs to the arriving leg, not the departing one (§6).
        properties: { mode: to.travelModeFrom ?? "Unknown", fromSlug: from.slug, toSlug: to.slug },
      };
    }),
  };
}

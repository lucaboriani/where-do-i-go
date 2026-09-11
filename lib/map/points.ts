import type { FeatureCollection, Point } from "geojson";
import type { IndexEntry } from "@/lib/pod/schema";

export type PointProps = {
  slug: string;
  title: string;
  thumbnail?: string;
  precisionMeters?: number;
  sortOrder: number;
};

type Placed = IndexEntry & { lat: number; long: number };

export function hasCoordinate(entry: IndexEntry): entry is Placed {
  return entry.lat !== undefined && entry.long !== undefined;
}

export function buildPoints(entries: IndexEntry[]): FeatureCollection<Point, PointProps> {
  return {
    type: "FeatureCollection",
    features: entries.filter(hasCoordinate).map((entry) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [entry.long, entry.lat] },
      properties: {
        slug: entry.slug,
        title: entry.title.value,
        ...(entry.thumbnail === undefined ? {} : { thumbnail: entry.thumbnail }),
        ...(entry.precisionMeters === undefined ? {} : { precisionMeters: entry.precisionMeters }),
        sortOrder: entry.sortOrder,
      },
    })),
  };
}

"use client";

import { useEffect } from "react";
import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { buildLegs } from "@/lib/map/legs";
import { buildPoints } from "@/lib/map/points";
import { MAP_COLORS } from "@/lib/map/tokens";
import { ROUTE_WIDTH, ROUTE_WIDTH_ACTIVE, shouldCluster } from "@/lib/map/view";
import type { IndexEntry } from "@/lib/pod/schema";

type MapLibreMap = import("maplibre-gl").Map;
type GeoJSONSource = import("maplibre-gl").GeoJSONSource;

export const POINTS_SOURCE = "trip-points";
export const LEGS_SOURCE = "trip-legs";

export const LAYERS = {
  line: "trip-route-line",
  clusters: "trip-clusters",
  clusterCount: "trip-cluster-count",
} as const;

export function useMapLayers(
  map: MapLibreMap | null,
  entries: IndexEntry[],
  styleLoaded: boolean,
): void {
  useEffect(() => {
    // NOT map.isStyleLoaded(): styleLoaded is useMapInstance's own tracking of
    // the style.load event, which can fire while isStyleLoaded() still waits
    // on source tiles — ./notes.md#why-styleloaded-is-not-isstyleloaded.
    if (map === null || !styleLoaded) return;

    const points = buildPoints(entries);
    const legs = buildLegs(entries);
    const pointsSource = map.getSource<GeoJSONSource>(POINTS_SOURCE);
    if (pointsSource === undefined) {
      addAll(map, points, legs, shouldCluster(points.features.length));
      return;
    }
    // Data in place, never a re-add: re-adding would flash the route away.
    pointsSource.setData(points);
    map.getSource<GeoJSONSource>(LEGS_SOURCE)?.setData(legs);
  }, [map, entries, styleLoaded]);
}

function addAll(
  map: MapLibreMap,
  points: ReturnType<typeof buildPoints>,
  legs: ReturnType<typeof buildLegs>,
  cluster: boolean,
): void {
  // promoteId, or setFeatureState has no id to key on: the leg features carry
  // only properties. ./notes.md#why-the-legs-source-promotes-toslug
  // lineMetrics, or line-gradient/line-progress below have nothing to key on.
  map.addSource(LEGS_SOURCE, {
    type: "geojson",
    data: legs,
    promoteId: "toSlug",
    lineMetrics: true,
  } satisfies GeoJSONSourceSpecification);
  map.addSource(POINTS_SOURCE, {
    type: "geojson",
    data: points,
    cluster,
    clusterRadius: 60,
  } satisfies GeoJSONSourceSpecification);

  map.addLayer({
    id: LAYERS.line,
    type: "line",
    source: LEGS_SOURCE,
    paint: {
      // Origin fade is baked into the gradient ALPHA (8-digit hex 40/99/F2 ≈
      // 0.25/0.60/0.95), NOT a separate line-opacity: line-progress is honored
      // only inside line-gradient. ./notes.md#why-the-fade-is-in-the-gradient-alpha
      "line-gradient": [
        "interpolate",
        ["linear"],
        ["line-progress"],
        0,
        ["to-color", `${MAP_COLORS.accent}40`],
        0.5,
        ["to-color", `${MAP_COLORS.accent}99`],
        1,
        ["to-color", `${MAP_COLORS.accentBright}F2`],
      ],
      "line-width": [
        "case",
        ["boolean", ["feature-state", "active"], false],
        ROUTE_WIDTH_ACTIVE,
        ROUTE_WIDTH,
      ],
    },
  } satisfies LayerSpecification);
  map.addLayer({
    id: LAYERS.clusters,
    type: "circle",
    source: POINTS_SOURCE,
    filter: ["has", "point_count"],
    paint: { "circle-color": MAP_COLORS.accentDeep, "circle-radius": 18 },
  } satisfies LayerSpecification);
  map.addLayer({
    id: LAYERS.clusterCount,
    type: "symbol",
    source: POINTS_SOURCE,
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
  } satisfies LayerSpecification);
}

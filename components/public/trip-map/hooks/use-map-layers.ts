"use client";

import { useEffect } from "react";
import type { GeoJSONSourceSpecification, LayerSpecification } from "@maplibre/maplibre-gl-style-spec";
import { DASH_BY_MODE } from "@/lib/map/dashes";
import { buildLegs } from "@/lib/map/legs";
import { buildPoints } from "@/lib/map/points";
import { MAP_COLORS } from "@/lib/map/tokens";
import { CASING_EXTRA, ROUTE_WIDTH, shouldCluster } from "@/lib/map/view";
import type { IndexEntry } from "@/lib/pod/schema";

type MapLibreMap = import("maplibre-gl").Map;
type GeoJSONSource = import("maplibre-gl").GeoJSONSource;

export const POINTS_SOURCE = "trip-points";
export const LEGS_SOURCE = "trip-legs";

export const LAYERS = {
  casing: "trip-route-casing",
  line: "trip-route-line",
  clusters: "trip-clusters",
  clusterCount: "trip-cluster-count",
} as const;

export function useMapLayers(map: MapLibreMap | null, entries: IndexEntry[]): void {
  useEffect(() => {
    if (map === null) return;
    const activeMap = map;

    const points = buildPoints(entries);
    const legs = buildLegs(entries);

    function apply(): void {
      const pointsSource = activeMap.getSource<GeoJSONSource>(POINTS_SOURCE);
      if (pointsSource === undefined) {
        addAll(activeMap, points, legs, shouldCluster(points.features.length));
        return;
      }
      // Data in place, never a re-add: re-adding would flash the route away.
      pointsSource.setData(points);
      activeMap.getSource<GeoJSONSource>(LEGS_SOURCE)?.setData(legs);
    }

    if (activeMap.isStyleLoaded()) {
      apply();
      return;
    }

    // The map can exist before its style loads; apply() must also fire on that event, not just here.
    activeMap.on("style.load", apply);
    return () => {
      activeMap.off("style.load", apply);
    };
  }, [map, entries]);
}

function addAll(
  map: MapLibreMap,
  points: ReturnType<typeof buildPoints>,
  legs: ReturnType<typeof buildLegs>,
  cluster: boolean,
): void {
  map.addSource(LEGS_SOURCE, { type: "geojson", data: legs } satisfies GeoJSONSourceSpecification);
  map.addSource(POINTS_SOURCE, {
    type: "geojson",
    data: points,
    cluster,
    clusterRadius: 60,
  } satisfies GeoJSONSourceSpecification);

  map.addLayer({
    id: LAYERS.casing,
    type: "line",
    source: LEGS_SOURCE,
    paint: { "line-color": MAP_COLORS.accentDeep, "line-width": ROUTE_WIDTH + CASING_EXTRA },
  } satisfies LayerSpecification);
  map.addLayer({
    id: LAYERS.line,
    type: "line",
    source: LEGS_SOURCE,
    paint: { "line-color": MAP_COLORS.accent, "line-width": ROUTE_WIDTH, "line-dasharray": DASH_BY_MODE },
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

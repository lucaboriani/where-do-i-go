"use client";

import { useEffect, useRef } from "react";
import { buildMarkerElement } from "@/lib/map/marker-element";
import type { PointProps } from "@/lib/map/points";
import { POINTS_SOURCE } from "./use-map-layers";

type MapLibreMap = import("maplibre-gl").Map;
type MapLibreMarker = import("maplibre-gl").Marker;
type LeafProps = PointProps & { point_count?: number };

export function useMapMarkers(map: MapLibreMap | null): void {
  const markers = useRef(new Map<string, MapLibreMarker>());

  useEffect(() => {
    if (map === null) return;
    const live = markers.current;
    let cancelled = false;
    let handler: (() => void) | null = null;

    void import("maplibre-gl").then(({ Marker }) => {
      if (cancelled) return;
      // sourcedata and moveend fire far more often than the leaf set changes, so
      // this reconciles by slug rather than rebuilding.
      handler = () => {
        const seen = new Set<string>();
        for (const feature of map.querySourceFeatures(POINTS_SOURCE)) {
          const props = feature.properties as LeafProps;
          if (props.point_count !== undefined) continue;
          seen.add(props.slug);
          if (live.has(props.slug)) continue;
          if (feature.geometry.type !== "Point") continue;
          // GeoJSON's Position is number[], not the tuple setLngLat wants.
          const [lng, lat] = feature.geometry.coordinates;
          live.set(
            props.slug,
            new Marker({ element: buildMarkerElement(props) }).setLngLat([lng, lat]).addTo(map),
          );
        }
        for (const [slug, marker] of live) {
          if (seen.has(slug)) continue;
          marker.remove();
          live.delete(slug);
        }
      };
      map.on("moveend", handler);
      map.on("sourcedata", handler);
      handler();
    });

    return () => {
      cancelled = true;
      if (handler !== null) {
        map.off("moveend", handler);
        map.off("sourcedata", handler);
      }
      for (const marker of live.values()) marker.remove();
      live.clear();
    };
  }, [map]);
}

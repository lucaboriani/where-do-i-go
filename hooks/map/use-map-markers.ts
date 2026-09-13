"use client";

import { useEffect, useRef } from "react";
import { buildMarkerElement, MARKER_ACTIVE } from "@/lib/map/marker-element";
import type { PointProps } from "@/lib/map/points";
import { POINTS_SOURCE } from "./use-map-layers";

type MapLibreMap = import("maplibre-gl").Map;
type MapLibreMarker = import("maplibre-gl").Marker;
type LeafProps = PointProps & { point_count?: number };

// classList rejects one token containing a space; MARKER_ACTIVE is two
// classes as one string. ./notes.md#why-marker_active-is-split-before-classlist
const ACTIVE_CLASSES = MARKER_ACTIVE.split(" ");

export function useMapMarkers(map: MapLibreMap | null, activeSlug: string | null = null): void {
  const markers = useRef(new Map<string, MapLibreMarker>());
  const active = useRef(activeSlug);

  // Deps are [map] ONLY: adding activeSlug tears down and recreates every
  // marker on every hover. ./notes.md#why-activeslug-is-a-ref-in-the-reconcile-effect
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
          const element = buildMarkerElement(props);
          if (active.current === props.slug) element.classList.add(...ACTIVE_CLASSES);
          live.set(props.slug, new Marker({ element }).setLngLat([lng, lat]).addTo(map));
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

  useEffect(() => {
    active.current = activeSlug;
    for (const [slug, marker] of markers.current) {
      const isActive = slug === activeSlug;
      for (const cls of ACTIVE_CLASSES) marker.getElement().classList.toggle(cls, isActive);
    }
  }, [activeSlug]);
}

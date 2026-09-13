"use client";

import { useEffect, useRef } from "react";
import { LEGS_SOURCE } from "./use-map-layers";

type MapLibreMap = import("maplibre-gl").Map;

/** setFeatureState on an unknown id is a silent no-op, so a highlight landing
 *  on nothing looks identical to one that worked. ./notes.md#a-highlight-can-land-on-nothing */
export function useMapHighlight(
  map: MapLibreMap | null,
  activeSlug: string | null,
  styleLoaded: boolean,
): void {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    // Same gate as useMapLayers, same reason: ./notes.md#why-styleloaded-is-not-isstyleloaded
    if (map === null || !styleLoaded) return;
    if (previous.current !== null) {
      map.removeFeatureState({ source: LEGS_SOURCE, id: previous.current });
    }
    if (activeSlug !== null) {
      map.setFeatureState({ source: LEGS_SOURCE, id: activeSlug }, { active: true });
    }
    previous.current = activeSlug;
  }, [map, activeSlug, styleLoaded]);
}

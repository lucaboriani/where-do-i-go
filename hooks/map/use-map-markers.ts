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

export type MarkerHandlers = {
  onEnter?: (slug: string) => void;
  onLeave?: () => void;
  onSelect?: (slug: string) => void;
  onDeselect?: () => void;
};

export function useMapMarkers(
  map: MapLibreMap | null,
  activeSlug: string | null = null,
  handlers: MarkerHandlers = {},
): void {
  const markers = useRef(new Map<string, MapLibreMarker>());
  const active = useRef(activeSlug);
  // A ref, not a dependency: a caller's fresh object literal would otherwise
  // rebuild every marker on every render.
  const hooks = useRef(handlers);
  useEffect(() => {
    hooks.current = handlers;
  });

  // Deps are [map] ONLY: adding activeSlug tears down and recreates every
  // marker on every hover. ./notes.md#why-activeslug-is-a-ref-in-the-reconcile-effect
  useEffect(() => {
    if (map === null) return;
    const live = markers.current;
    let cancelled = false;
    let handler: (() => void) | null = null;

    // Markers are DOM overlays INSIDE the canvas container maplibre listens
    // on, so the marker handler below stops propagation; without that, a tap
    // would select and this would immediately clear it.
    // ./notes.md#why-a-marker-click-stops-propagating
    const deselect = () => hooks.current.onDeselect?.();
    map.on("click", deselect);

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
          // mouseenter/mouseleave, not pointer*: hover only, and neither
          // bubbles, so the marker's own <img> cannot raise a second time.
          element.addEventListener("mouseenter", () => hooks.current.onEnter?.(props.slug));
          element.addEventListener("mouseleave", () => hooks.current.onLeave?.());
          element.addEventListener("click", (event) => {
            event.stopPropagation();
            hooks.current.onSelect?.(props.slug);
          });
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
      map.off("click", deselect);
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

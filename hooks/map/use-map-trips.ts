"use client";

import { useEffect, useRef } from "react";
import type {
  GeoJSONSourceSpecification,
  LayerSpecification,
} from "@maplibre/maplibre-gl-style-spec";
import { MAP_COLORS } from "@/lib/map/tokens";
import { buildTripPoints, flyOptions, type TripPoint } from "@/lib/map/trips";

type MapLibreMap = import("maplibre-gl").Map;
type GeoJSONSource = import("maplibre-gl").GeoJSONSource;
type MapLayerMouseEvent = import("maplibre-gl").MapLayerMouseEvent;
type MapMouseEvent = import("maplibre-gl").MapMouseEvent;

export const TRIPS_SOURCE = "diary-trips";
export const TRIPS_LAYER = "diary-trip-points";

export type TripHandlers = {
  onEnter?: (slug: string) => void;
  onLeave?: () => void;
  onSelect?: (slug: string) => void;
  onDeselect?: () => void;
};

export function useMapTrips(
  map: MapLibreMap | null,
  trips: TripPoint[],
  styleLoaded: boolean,
  activeSlug: string | null = null,
  handlers: TripHandlers = {},
): void {
  // A ref, not a dependency: a caller's fresh object literal would otherwise
  // re-register the three listeners on every render. ./notes.md#why-the-trip-handlers-are-a-ref
  const hooks = useRef(handlers);
  useEffect(() => {
    hooks.current = handlers;
  });

  useEffect(() => {
    // NOT map.isStyleLoaded(), which also waits on tiles:
    // ./notes.md#why-styleloaded-is-not-isstyleloaded
    if (map === null || !styleLoaded) return;
    const points = buildTripPoints(trips);
    const source = map.getSource<GeoJSONSource>(TRIPS_SOURCE);
    // Data in place on a later change; the source is never re-added.
    if (source === undefined) addTrips(map, points);
    else source.setData(points);
  }, [map, trips, styleLoaded]);

  useEffect(() => {
    if (map === null || !styleLoaded) return;
    const enter = (event: MapLayerMouseEvent) => {
      const slug = slugOf(event);
      if (slug !== undefined) hooks.current.onEnter?.(slug);
    };
    const leave = () => hooks.current.onLeave?.();
    const select = (event: MapLayerMouseEvent) => {
      const slug = slugOf(event);
      if (slug === undefined) return;
      hooks.current.onSelect?.(slug);
      flyTo(map, trips.find((trip) => trip.slug === slug)?.bbox);
    };
    // `select` above fires for this same click, with nothing to stop between
    // them: ./notes.md#why-the-background-click-asks-what-it-hit
    const background = (event: MapMouseEvent) => {
      if (map.queryRenderedFeatures(event.point, { layers: [TRIPS_LAYER] }).length > 0) return;
      hooks.current.onDeselect?.();
    };
    map.on("mouseenter", TRIPS_LAYER, enter);
    map.on("mouseleave", TRIPS_LAYER, leave);
    map.on("click", TRIPS_LAYER, select);
    map.on("click", background);
    return () => {
      map.off("mouseenter", TRIPS_LAYER, enter);
      map.off("mouseleave", TRIPS_LAYER, leave);
      map.off("click", TRIPS_LAYER, select);
      map.off("click", background);
    };
  }, [map, trips, styleLoaded]);

  const previous = useRef<string | null>(null);
  useEffect(() => {
    // setFeatureState on an unknown id is a silent no-op — the same trap
    // ./notes.md#a-highlight-can-land-on-nothing records for the legs.
    if (map === null || !styleLoaded) return;
    if (previous.current !== null) {
      map.removeFeatureState({ source: TRIPS_SOURCE, id: previous.current });
    }
    if (activeSlug !== null) {
      map.setFeatureState({ source: TRIPS_SOURCE, id: activeSlug }, { active: true });
    }
    previous.current = activeSlug;
  }, [map, activeSlug, styleLoaded]);
}

function slugOf(event: MapLayerMouseEvent): string | undefined {
  const slug = event.features?.[0]?.properties.slug;
  return typeof slug === "string" ? slug : undefined;
}

function flyTo(map: MapLibreMap, bbox: TripPoint["bbox"]): void {
  if (bbox === undefined) return;
  const { bounds, ...camera } = flyOptions(bbox);
  // maplibre already zeroes a non-essential duration under the query; this is
  // belt-and-braces AND what the jsdom case can assert.
  // ./notes.md#the-fly-is-a-jump-under-reduced-motion
  const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  map.fitBounds(bounds, { ...camera, animate });
}

/** The load camera is maplibre's own default fitted to the pane — no style here
 *  sets `center` or `zoom`. Only a click moves it. */
function addTrips(map: MapLibreMap, points: ReturnType<typeof buildTripPoints>): void {
  // promoteId, or setFeatureState has no id to key on: the features carry a
  // slug property and no id. ./notes.md#why-the-trips-source-promotes-slug
  map.addSource(TRIPS_SOURCE, {
    type: "geojson",
    data: points,
    promoteId: "slug",
  } satisfies GeoJSONSourceSpecification);
  map.addLayer({
    id: TRIPS_LAYER,
    type: "circle",
    source: TRIPS_SOURCE,
    paint: {
      "circle-radius": 6,
      "circle-color": [
        "case",
        ["boolean", ["feature-state", "active"], false],
        MAP_COLORS.accentBright,
        MAP_COLORS.accent,
      ],
      "circle-stroke-width": 1,
      "circle-stroke-color": MAP_COLORS.accentDeep,
    },
  } satisfies LayerSpecification);
}

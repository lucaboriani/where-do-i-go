"use client";

// Outside the lazy chunk on purpose, exactly as trip-map does it.
// ../trip-map/notes.md#the-frame-is-reserved-by-the-server-and-the-class-is-shared
import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import { MAP_FRAME_CLASS } from "@/components/public/trip-map";
import { useMapInstance } from "@/hooks/map/use-map-instance";
import { useMapTrips } from "@/hooks/map/use-map-trips";
import { useTripHighlight } from "@/hooks/trip/highlight-context";
import { GLOBE_PROJECTION } from "@/lib/map/view";
import type { TripPoint } from "@/lib/map/trips";

type MapLibreMap = import("maplibre-gl").Map;

// A stable identity, not an inline `= []` default: useMapTrips takes `trips`
// as an effect dependency, so a fresh array per render would call setData —
// a worker re-parse and a tile reload — on every re-render.
const NO_TRIPS: TripPoint[] = [];

export default function DiaryMap({
  trips = NO_TRIPS,
  styleUrl,
}: {
  trips?: TripPoint[];
  styleUrl?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  // ../trip-map/notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
  const [active, setActive] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = container.current;
    if (node === null || active) return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((record) => record.isIntersecting)) setActive(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);

  const { activeSlug, raise, clear, pin, unpin } = useTripHighlight();
  // No bbox: ./notes.md#the-camera-belongs-to-the-trips-hook-not-the-instance
  const { map, styleLoaded } = useMapInstance({
    container,
    active,
    styleUrl,
    projection: GLOBE_PROJECTION,
  });
  // A fresh handlers object is safe: useMapTrips holds it in a ref.
  useMapTrips(map, trips, styleLoaded, activeSlug, {
    onEnter: (slug) => raise(slug, "map"),
    onLeave: clear,
    onSelect: pin,
    onDeselect: unpin,
  });

  // e2e-only handle, and free outside production.
  // ../trip-map/notes.md#the-map-handle-attached-for-e2e
  useEffect(() => {
    const node = container.current;
    if (process.env.NODE_ENV === "production" || node === null || map === null) return;
    (node as HTMLDivElement & { __map?: MapLibreMap }).__map = map;
  }, [map]);

  return <div ref={container} role="region" aria-label="Diary map" className={MAP_FRAME_CLASS} />;
}

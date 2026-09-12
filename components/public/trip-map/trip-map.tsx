"use client";

// Outside the lazy chunk on purpose; see ./notes.md#the-frame-is-reserved-by-the-server-and-the-class-is-shared
import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import { type Bbox } from "@/lib/map/view";
import type { IndexEntry } from "@/lib/pod/schema";
import { useMapInstance } from "@/hooks/map/use-map-instance";
import { useMapLayers } from "@/hooks/map/use-map-layers";
import { useMapMarkers } from "@/hooks/map/use-map-markers";

// Shared with the layout's Suspense fallback: ./notes.md#the-frame-is-reserved-by-the-server-and-the-class-is-shared
export const MAP_FRAME_CLASS = "h-96 w-full bg-surface";

// A stable identity, not an inline `= []` default: the latter allocates a
// fresh array every render, which would re-run useMapLayers's effect on
// every TripMap re-render rather than only on a genuine entries change.
const NO_ENTRIES: IndexEntry[] = [];

export default function TripMap({
  bbox,
  styleUrl,
  entries = NO_ENTRIES,
}: {
  bbox?: Bbox;
  styleUrl?: string;
  entries?: IndexEntry[];
}) {
  const container = useRef<HTMLDivElement>(null);
  // ./notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
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

  const { map, styleLoaded } = useMapInstance({ container, active, bbox, styleUrl });
  useMapLayers(map, entries, styleLoaded);
  useMapMarkers(map);

  return <div ref={container} role="region" aria-label="Trip map" className={MAP_FRAME_CLASS} />;
}

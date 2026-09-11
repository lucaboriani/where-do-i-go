"use client";

// Outside the lazy chunk on purpose; see ./notes.md#the-frame-is-reserved-by-the-server-and-the-class-is-shared
import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import { useMapInstance, type Bbox } from "./hooks/use-map-instance";

// Shared with the layout's Suspense fallback: ./notes.md#the-frame-is-reserved-by-the-server-and-the-class-is-shared
export const MAP_FRAME_CLASS = "h-96 w-full bg-surface";

export default function TripMap({ bbox, styleUrl }: { bbox?: Bbox; styleUrl?: string }) {
  const container = useRef<HTMLDivElement>(null);
  // No observer here means never scrolled into view, so activate at once.
  // ./notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
  const [active, setActive] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = container.current;
    if (node === null || active) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setActive(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);

  useMapInstance({ container, active, bbox, styleUrl });

  return <div ref={container} role="region" aria-label="Trip map" className={MAP_FRAME_CLASS} />;
}

"use client";

/**
 * THE IMPORT MUST STAY INSIDE THE EFFECT — at module scope Next prerenders
 * maplibre-gl into the eager chunk, which is 252.8 kB against a 190 kB budget.
 * Same trap, same shape as studio-client.tsx's auth import.
 * ../notes.md#why-a-bare-dynamic-import-and-not-nextdynamic
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { buildBasemapStyle } from "@/lib/map/style";

export type Bbox = { west: number; south: number; east: number; north: number };
export type MapStatus = "idle" | "loading" | "ready" | "failed";

export type MapInstanceOptions = {
  container: RefObject<HTMLDivElement | null>;
  active: boolean;
  bbox?: Bbox;
  styleUrl?: string;
};

export function useMapInstance({ container, active, bbox, styleUrl }: MapInstanceOptions): MapStatus {
  const [outcome, setOutcome] = useState<"pending" | "ready" | "failed">("pending");
  const map = useRef<import("maplibre-gl").Map | null>(null);

  // Ref, not effect deps: see ../notes.md#why-the-effect-depends-on-activation-alone
  const latest = useRef({ bbox, styleUrl });
  useEffect(() => {
    latest.current = { bbox, styleUrl };
  });

  useEffect(() => {
    if (!active || map.current !== null) return;
    const node = container.current;
    if (node === null) return;

    let live = true;

    void import("maplibre-gl")
      .then(({ Map, AttributionControl }) => {
        if (!live) return;
        const { bbox: bounds, styleUrl: url } = latest.current;
        const instance = new Map({
          container: node,
          style: url ?? buildBasemapStyle(),
          attributionControl: false,
        });
        // Never conditional: OpenStreetMap requires it and CLAUDE.md forbids removing it.
        instance.addControl(new AttributionControl({ compact: true }));
        instance.on("style.load", () => {
          instance.setProjection({ type: "mercator" });
          if (bounds !== undefined) {
            instance.fitBounds(
              [
                [bounds.west, bounds.south],
                [bounds.east, bounds.north],
              ],
              { padding: 32, animate: false },
            );
          }
        });
        instance.once("load", () => setOutcome("ready"));
        map.current = instance;
      })
      .catch(() => {
        if (live) setOutcome("failed");
      });

    return () => {
      live = false;
    };
  }, [active, container]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  if (!active) return "idle";
  return outcome === "pending" ? "loading" : outcome;
}

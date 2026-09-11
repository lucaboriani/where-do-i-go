"use client";

/**
 * THE IMPORT MUST STAY INSIDE THE EFFECT — at module scope Next prerenders
 * maplibre-gl into the eager chunk, which is 252.8 kB against a 190 kB budget.
 * Same trap, same shape as studio-client.tsx's auth import.
 * ../notes.md#why-a-bare-dynamic-import-and-not-nextdynamic
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { buildBasemapStyle } from "@/lib/map/style";
import { fitOptions, PROJECTION, type Bbox } from "@/lib/map/view";

type MapLibreMap = import("maplibre-gl").Map;

export type MapStatus = "idle" | "loading" | "ready" | "failed";

export type MapInstanceOptions = {
  container: RefObject<HTMLDivElement | null>;
  active: boolean;
  bbox?: Bbox;
  styleUrl?: string;
};

export function useMapInstance({
  container,
  active,
  bbox,
  styleUrl,
}: MapInstanceOptions): { status: MapStatus; map: MapLibreMap | null } {
  const [outcome, setOutcome] = useState<"pending" | "ready" | "failed">("pending");
  const [instance, setInstance] = useState<MapLibreMap | null>(null);
  const map = useRef<MapLibreMap | null>(null);

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
          instance.setProjection(PROJECTION);
          if (bounds !== undefined) {
            const { bounds: box, ...camera } = fitOptions(bounds);
            instance.fitBounds(box, camera);
          }
        });
        instance.once("load", () => setOutcome("ready"));
        map.current = instance;
        setInstance(instance);
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
      setInstance(null);
    },
    [],
  );

  return { status: !active ? "idle" : outcome === "pending" ? "loading" : outcome, map: instance };
}

import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import { TravelMode } from "@/lib/pod/schema";

/** Dash lengths are in line-widths, not pixels, so they hold as the line scales. */
export const MODE_DASHES: Record<TravelMode | "Unknown", number[]> = {
  Flight: [1, 2],
  Train: [4, 1.5],
  Bus: [3, 2],
  Car: [1, 0],
  Boat: [2, 2, 0.5, 2],
  Bike: [2, 1],
  Walk: [0.5, 1.5],
  Other: [3, 3],
  Unknown: [3, 3],
};

export const DASH_BY_MODE: ExpressionSpecification = [
  "match",
  ["get", "mode"],
  ...TravelMode.options.flatMap((mode) => [mode, ["literal", MODE_DASHES[mode]]] as const),
  ["literal", MODE_DASHES.Unknown],
] as unknown as ExpressionSpecification;

import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { TravelMode } from "@/lib/pod/schema";
// TRAVEL_MODE's keys, not TravelMode.options: the latter is a zod value
// import, which pulls all of zod into this public chunk. ./notes.md#why-dashests-reads-mode-names-from-vocabts-not-schemats
import { TRAVEL_MODE } from "@/lib/vocab";

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

const MODES = Object.keys(TRAVEL_MODE) as TravelMode[];

export const DASH_BY_MODE = [
  "match",
  ["get", "mode"],
  ...MODES.flatMap((mode) => [mode, ["literal", MODE_DASHES[mode]]] as const),
  ["literal", MODE_DASHES.Unknown],
] as unknown as ExpressionSpecification;

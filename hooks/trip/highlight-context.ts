"use client";

import { createContext, useContext } from "react";

export type HighlightSource = "map" | "timeline" | "pin" | "route";

export type Highlight = {
  activeSlug: string | null;
  source: HighlightSource | null;
};

export type HighlightValue = Highlight & {
  /** The raw pin slot, unranked: a consumer that must not react to a hover
   *  reads this rather than deriving it. ./notes.md#why-a-pin-is-a-second-slot-not-a-third-source */
  pinnedSlug: string | null;
  raise: (slug: string, source: "map" | "timeline") => void;
  clear: () => void;
  pin: (slug: string) => void;
  unpin: () => void;
};

export const TripHighlightContext = createContext<HighlightValue | null>(null);

/** Returns an inert value outside a provider rather than throwing: an entry page
 *  rendered on its own must not crash. ./notes.md#why-the-context-has-an-inert-default */
const INERT: HighlightValue = {
  activeSlug: null,
  source: null,
  pinnedSlug: null,
  raise: () => {},
  clear: () => {},
  pin: () => {},
  unpin: () => {},
};

export function useTripHighlight(): HighlightValue {
  return useContext(TripHighlightContext) ?? INERT;
}

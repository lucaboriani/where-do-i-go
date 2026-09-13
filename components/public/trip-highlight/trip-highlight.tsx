"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { TripHighlightContext } from "@/hooks/trip/highlight-context";
import { useHighlightState } from "@/hooks/trip/use-highlight-state";

// null on the trip route itself, the entry slug on /trips/[slug]/[entry].
// see ./notes.md#why-plain-context-is-enough
export default function TripHighlightProvider({ children }: { children: React.ReactNode }) {
  const value = useHighlightState(useSelectedLayoutSegment());
  return <TripHighlightContext value={value}>{children}</TripHighlightContext>;
}

"use client";

import { useCallback, useMemo, useState } from "react";
import type { Highlight, HighlightValue } from "./highlight-context";

/** A pointer highlight outranks the route's while it lasts; clearing falls back
 *  to the route rather than to nothing. ./notes.md#why-clearing-falls-back-to-the-route */
export function useHighlightState(routeSlug: string | null): HighlightValue {
  const [pointer, setPointer] = useState<Highlight | null>(null);

  const raise = useCallback((slug: string, source: "map" | "timeline") => {
    setPointer({ activeSlug: slug, source });
  }, []);
  const clear = useCallback(() => setPointer(null), []);

  return useMemo(() => {
    const base: Highlight =
      pointer ?? (routeSlug === null ? { activeSlug: null, source: null } : { activeSlug: routeSlug, source: "route" });
    return { ...base, raise, clear };
  }, [pointer, routeSlug, raise, clear]);
}

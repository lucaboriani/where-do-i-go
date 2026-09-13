"use client";

import { useCallback, useMemo, useState } from "react";
import type { Highlight, HighlightValue } from "./highlight-context";

/** A pointer highlight outranks the route's while it lasts; clearing falls back
 *  to the route rather than to nothing. ./notes.md#why-clearing-falls-back-to-the-route */
export function useHighlightState(routeSlug: string | null): HighlightValue {
  const [pointer, setPointer] = useState<Highlight | null>(null);
  const [seenRoute, setSeenRoute] = useState(routeSlug);

  const raise = useCallback((slug: string, source: "map" | "timeline") => {
    setPointer({ activeSlug: slug, source });
  }, []);
  const clear = useCallback(() => setPointer(null), []);

  // Adjusted during render, not in an effect: the element that raised the
  // pointer may be gone, and Chrome sends no focusout for a removed focused
  // element. ./notes.md#a-navigation-drops-the-pointer
  if (seenRoute !== routeSlug) {
    setSeenRoute(routeSlug);
    setPointer(null);
  }

  return useMemo(() => {
    const base: Highlight =
      pointer ??
      (routeSlug === null
        ? { activeSlug: null, source: null }
        : { activeSlug: routeSlug, source: "route" });
    return { ...base, raise, clear };
  }, [pointer, routeSlug, raise, clear]);
}

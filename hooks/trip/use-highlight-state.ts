"use client";

import { useCallback, useMemo, useState } from "react";
import type { Highlight, HighlightValue } from "./highlight-context";

/** A pointer highlight outranks the route's while it lasts; clearing falls back
 *  to the route rather than to nothing. ./notes.md#why-clearing-falls-back-to-the-route */
export function useHighlightState(routeSlug: string | null): HighlightValue {
  const [pointer, setPointer] = useState<Highlight | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [seenRoute, setSeenRoute] = useState(routeSlug);

  const raise = useCallback((slug: string, source: "map" | "timeline") => {
    setPointer({ activeSlug: slug, source });
  }, []);
  const clear = useCallback(() => setPointer(null), []);
  const pin = useCallback((slug: string) => setPinned(slug), []);
  const unpin = useCallback(() => setPinned(null), []);

  // Adjusted during render, not in an effect: the element that raised the
  // pointer may be gone, and Chrome sends no focusout for a removed focused
  // element. ./notes.md#a-navigation-drops-the-pointer
  if (seenRoute !== routeSlug) {
    setSeenRoute(routeSlug);
    setPointer(null);
    setPinned(null);
  }

  return useMemo(() => {
    const base: Highlight = pointer ?? pinnedOrRoute(pinned, routeSlug);
    return { ...base, pinnedSlug: pinned, raise, clear, pin, unpin };
  }, [pointer, pinned, routeSlug, raise, clear, pin, unpin]);
}

function pinnedOrRoute(pinned: string | null, routeSlug: string | null): Highlight {
  if (pinned !== null) return { activeSlug: pinned, source: "pin" };
  if (routeSlug !== null) return { activeSlug: routeSlug, source: "route" };
  return { activeSlug: null, source: null };
}

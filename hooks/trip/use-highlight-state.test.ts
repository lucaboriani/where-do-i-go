// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHighlightState } from "./use-highlight-state";

describe("useHighlightState", () => {
  it("starts with no highlight when there is no route slug", () => {
    const { result } = renderHook(() => useHighlightState(null));
    expect(result.current.activeSlug).toBeNull();
    expect(result.current.source).toBeNull();
  });

  it("raises a pointer highlight and records which side raised it", () => {
    const { result } = renderHook(() => useHighlightState(null));
    act(() => result.current.raise("arrival", "timeline"));
    expect(result.current).toMatchObject({ activeSlug: "arrival", source: "timeline" });
  });

  it("clears back to the route slug rather than to nothing", () => {
    const { result } = renderHook(() => useHighlightState("kyoto"));
    act(() => result.current.raise("arrival", "map"));
    expect(result.current.activeSlug).toBe("arrival");
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ activeSlug: "kyoto", source: "route" });
  });

  it("drops a raised pointer when the route moves out from under it", () => {
    // The real sequence: tab to a row's link, press Enter. onFocus raised the
    // pointer, the <li> is then removed by the navigation, and Chrome fires no
    // focusout for a removed focused element — so nothing ever calls clear().
    const { result, rerender } = renderHook(({ slug }) => useHighlightState(slug), {
      initialProps: { slug: null as string | null },
    });
    act(() => result.current.raise("osaka", "timeline"));
    rerender({ slug: "osaka" });
    expect(result.current).toMatchObject({ activeSlug: "osaka", source: "route" });
    // Back to the trip: with the pointer still held this shows a highlight that
    // no pointer and no route can account for.
    rerender({ slug: null });
    expect(result.current).toMatchObject({ activeSlug: null, source: null });
  });

  it("a pin outranks the route and outlives the hover that ended", () => {
    const { result } = renderHook(() => useHighlightState("arrival"));

    act(() => result.current.pin("nara"));
    expect(result.current).toMatchObject({ activeSlug: "nara", source: "pin" });

    act(() => result.current.raise("osaka", "map"));
    expect(result.current).toMatchObject({ activeSlug: "osaka", source: "map" });

    // The hover ends and the PIN is what is left, not the route: this is the
    // whole point of the second slot.
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ activeSlug: "nara", source: "pin" });

    act(() => result.current.unpin());
    expect(result.current).toMatchObject({ activeSlug: "arrival", source: "route" });
  });

  it("a route change drops the pin as well as the pointer", () => {
    const { result, rerender } = renderHook(({ route }) => useHighlightState(route), {
      initialProps: { route: "arrival" as string | null },
    });

    act(() => result.current.pin("nara"));
    rerender({ route: "osaka" });

    expect(result.current).toMatchObject({ activeSlug: "osaka", source: "route" });
  });
});

// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMapHighlight } from "./use-map-highlight";
import { LEGS_SOURCE } from "./use-map-layers";

function fakeMap() {
  return {
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    getSource: vi.fn(() => ({})),
  };
}

describe("useMapHighlight", () => {
  it("sets active state on the leg arriving at the slug", () => {
    const map = fakeMap();
    renderHook(() => useMapHighlight(map as never, "kyoto", true));
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: LEGS_SOURCE, id: "kyoto" },
      { active: true },
    );
  });

  it("clears the previous leg before setting the next", () => {
    const map = fakeMap();
    const { rerender } = renderHook(({ slug }) => useMapHighlight(map as never, slug, true), {
      initialProps: { slug: "kyoto" as string | null },
    });
    rerender({ slug: "osaka" });
    expect(map.removeFeatureState).toHaveBeenCalledWith({ source: LEGS_SOURCE, id: "kyoto" });
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: LEGS_SOURCE, id: "osaka" },
      { active: true },
    );
  });

  it("does nothing at all before the style has loaded", () => {
    const map = fakeMap();
    renderHook(() => useMapHighlight(map as never, "kyoto", false));
    expect(map.setFeatureState).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRIPS_LAYER, TRIPS_SOURCE, useMapTrips } from "./use-map-trips";
import type { TripPoint } from "@/lib/map/trips";

// Stateful and returned by identity, as use-map-layers.test.ts's is: a fresh
// mock per getSource call would let a re-add pass for an in-place update.
class FakeSource {
  data: { features: { properties: { slug: string } }[] } | null = null;
  setData(next: { features: { properties: { slug: string } }[] }) {
    this.data = next;
  }
}

// No shared fake exists in this repository — use-map-instance.test.ts and
// use-map-layers.test.ts each declare their own. This one needs two things
// neither has: setFeatureState, and the three-argument layer-scoped on().
class FakeMap {
  sources = new Map<string, Record<string, unknown>>();
  live = new Map<string, FakeSource>();
  layers: Record<string, unknown>[] = [];
  states: { id: string; state: Record<string, unknown> }[] = [];
  removed: string[] = [];
  fitted: [unknown, Record<string, unknown>][] = [];
  handlers = new Map<string, ((event: unknown) => void)[]>();
  // Cumulative, unlike `handlers`: a listener removed and re-added leaves the
  // live list at one, so only this can see a rebuild.
  registrations: string[] = [];

  addSource(id: string, spec: Record<string, unknown>) {
    this.sources.set(id, spec);
    this.live.set(id, new FakeSource());
  }
  getSource(id: string) {
    return this.live.get(id);
  }
  addLayer(spec: Record<string, unknown>) {
    this.layers.push(spec);
  }
  setFeatureState(target: { id: string }, state: Record<string, unknown>) {
    this.states.push({ id: target.id, state });
  }
  removeFeatureState(target: { id: string }) {
    this.removed.push(target.id);
  }
  fitBounds(bounds: unknown, camera: Record<string, unknown>) {
    this.fitted.push([bounds, camera]);
  }
  // Layer-scoped: on(event, layer, handler). The two-argument form is not used
  // by this hook, so the fake does not pretend to support it.
  on(event: string, _layer: string, handler: (event: unknown) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    this.registrations.push(event);
    return this;
  }
  // Really removes it, so an emit after unmount proves the cleanup rather
  // than only counting calls.
  off(event: string, _layer: string, handler: (event: unknown) => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((one) => one !== handler));
    return this;
  }
  emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

const japan: TripPoint = {
  slug: "2026-japan",
  name: "Japan, spring",
  center: { lat: 35.6938, long: 139.7034 },
  bbox: { west: 135, south: 34, east: 140, north: 36 },
};
const patagonia: TripPoint = {
  slug: "2025-patagonia",
  name: "Patagonia, autumn",
  center: { lat: -49.3315, long: -72.886 },
  bbox: { west: -73.5, south: -50, east: -72, north: -49 },
};
const feature = (slug: string) => ({ features: [{ properties: { slug } }] });

let map: FakeMap;
// jsdom ships no matchMedia; the reduced-motion case stubs it, and without
// this restore the stub leaks into every case after it.
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  map = new FakeMap();
  window.matchMedia = realMatchMedia;
});

describe("useMapTrips", () => {
  it("does nothing until the style has loaded", () => {
    renderHook(() => useMapTrips(map as never, [japan], false, null, {}));
    expect(map.sources.size).toBe(0);
  });

  it("promotes the slug, or the highlight would key on nothing", () => {
    renderHook(() => useMapTrips(map as never, [japan, patagonia], true, null, {}));

    expect(map.sources.get(TRIPS_SOURCE)?.promoteId).toBe("slug");
    expect(map.layers.map((layer) => layer.id)).toContain(TRIPS_LAYER);
  });

  it("updates data in place on a changed trips array instead of re-adding", () => {
    const { rerender } = renderHook(
      ({ list }: { list: TripPoint[] }) => useMapTrips(map as never, list, true, null, {}),
      { initialProps: { list: [japan] } },
    );
    const before = map.getSource(TRIPS_SOURCE);

    rerender({ list: [japan, patagonia] });

    expect(map.getSource(TRIPS_SOURCE)).toBe(before);
    expect(map.layers).toHaveLength(1);
    expect(before?.data?.features.map((one) => one.properties.slug)).toEqual([
      "2026-japan",
      "2025-patagonia",
    ]);
  });

  it("paints the active trip and clears the one before it", () => {
    const { rerender } = renderHook(
      ({ slug }: { slug: string | null }) =>
        useMapTrips(map as never, [japan, patagonia], true, slug, {}),
      { initialProps: { slug: null as string | null } },
    );

    rerender({ slug: "2026-japan" });
    expect(map.states.at(-1)).toEqual({ id: "2026-japan", state: { active: true } });

    rerender({ slug: "2025-patagonia" });
    expect(map.removed).toContain("2026-japan");
  });

  it("reports hover and selection by slug, and flies to the selected trip", () => {
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    const onSelect = vi.fn();
    renderHook(() =>
      useMapTrips(map as never, [japan, patagonia], true, null, { onEnter, onLeave, onSelect }),
    );

    map.emit("mouseenter", feature("2025-patagonia"));
    expect(onEnter).toHaveBeenCalledWith("2025-patagonia");
    map.emit("mouseleave", {});
    expect(onLeave).toHaveBeenCalled();

    map.emit("click", feature("2025-patagonia"));
    expect(onSelect).toHaveBeenCalledWith("2025-patagonia");
    // The only fit there is: the fly to that trip's OWN bbox, animated.
    expect(map.fitted).toHaveLength(1);
    expect(map.fitted[0][1].animate).toBe(true);
    expect(map.fitted[0][0]).toEqual([
      [-73.5, -50],
      [-72, -49],
    ]);
  });

  it("jumps instead of flying when the reader asked for less motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    renderHook(() => useMapTrips(map as never, [japan, patagonia], true, null, {}));

    map.emit("click", feature("2025-patagonia"));

    expect(map.fitted[0][1].animate).toBe(false);
  });

  it("does not rebuild when the handlers object is a fresh literal", () => {
    // `trips` is hoisted so only the handlers literal is fresh per render;
    // an inline array would re-run the effect on its own.
    const only = [japan];
    const { rerender } = renderHook(() =>
      useMapTrips(map as never, only, true, null, { onEnter: vi.fn() }),
    );

    rerender();
    expect(map.layers).toHaveLength(1);
    expect(map.registrations.filter((event) => event === "click")).toHaveLength(1);
  });

  it("leaves no listener behind on unmount", () => {
    const onSelect = vi.fn();
    const { unmount } = renderHook(() =>
      useMapTrips(map as never, [japan, patagonia], true, null, { onSelect }),
    );

    unmount();
    map.emit("click", feature("2025-patagonia"));

    expect(onSelect).not.toHaveBeenCalled();
  });
});

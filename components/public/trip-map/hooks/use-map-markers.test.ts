// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMapMarkers } from "./use-map-markers";

const markers: FakeMarker[] = [];

class FakeMarker {
  element: HTMLElement | null = null;
  lngLat: unknown = null;
  removed = 0;
  constructor(readonly options: { element?: HTMLElement }) {
    this.element = options.element ?? null;
    markers.push(this);
  }
  setLngLat(value: unknown) {
    this.lngLat = value;
    return this;
  }
  addTo() {
    return this;
  }
  remove() {
    this.removed += 1;
  }
}

vi.mock("maplibre-gl", () => ({ Marker: FakeMarker }));

type Feature = { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } };

class FakeMap {
  features: Feature[] = [];
  readonly handlers = new Map<string, (() => void)[]>();
  querySourceFeatures() {
    return this.features;
  }
  on(event: string, handler: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  off(event: string, handler: () => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
    return this;
  }
  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }
}

function leaf(slug: string): Feature {
  return { properties: { slug, title: slug, sortOrder: 1 }, geometry: { coordinates: [1, 2] } };
}

let map: FakeMap;
beforeEach(() => {
  markers.length = 0;
  map = new FakeMap();
});

describe("useMapMarkers", () => {
  it("does nothing without a map, rather than throwing", () => {
    expect(() => renderHook(() => useMapMarkers(null))).not.toThrow();
    expect(markers).toHaveLength(0);
  });

  it("adds one marker per leaf", async () => {
    map.features = [leaf("a"), leaf("b")];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(2));
  });

  it("ignores a cluster feature, which the GL layer draws instead", async () => {
    map.features = [leaf("a"), { properties: { point_count: 7 }, geometry: { coordinates: [0, 0] } }];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(1));
  });

  it("does not add a second marker for a slug it already has", async () => {
    map.features = [leaf("a")];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(1));
    map.emit("moveend");
    map.emit("sourcedata");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markers).toHaveLength(1);
  });

  it("removes a marker whose leaf has gone", async () => {
    map.features = [leaf("a"), leaf("b")];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(2));
    map.features = [leaf("a")];
    map.emit("moveend");
    await waitFor(() => expect(markers.filter((m) => m.removed > 0)).toHaveLength(1));
  });

  it("removes every marker on unmount, so a navigation does not leak them", async () => {
    map.features = [leaf("a"), leaf("b")];
    const { unmount } = renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(2));
    unmount();
    expect(markers.every((m) => m.removed === 1)).toBe(true);
  });

  it("stops listening on unmount", async () => {
    map.features = [leaf("a")];
    const { unmount } = renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(1));
    unmount();
    expect(map.handlers.get("moveend") ?? []).toHaveLength(0);
  });
});

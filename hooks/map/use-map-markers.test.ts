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
  getElement() {
    return this.element as HTMLElement;
  }
}

vi.mock("maplibre-gl", () => ({ Marker: FakeMarker }));

type Feature = { properties: Record<string, unknown>; geometry: { type: string; coordinates: [number, number] } };

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
  return {
    properties: { slug, title: slug, sortOrder: 1 },
    geometry: { type: "Point", coordinates: [1, 2] },
  };
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
    map.features = [
      leaf("a"),
      { properties: { point_count: 7 }, geometry: { type: "Point", coordinates: [0, 0] } },
    ];
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

  it("marks the active marker's element without rebuilding any marker", async () => {
    map.features = [leaf("kyoto"), leaf("osaka")];
    const { rerender } = renderHook(({ slug }) => useMapMarkers(map as never, slug), {
      initialProps: { slug: null as string | null },
    });
    await waitFor(() => expect(markers).toHaveLength(2));
    const created = markers.length;
    rerender({ slug: "kyoto" });
    // waitFor rather than a bare read: it lets a wrongly-rebuilt marker's async
    // creation finish before the count below can be compared.
    await waitFor(() => {
      const kyoto = markers.findLast((m) => m.element?.dataset.slug === "kyoto")?.element;
      expect(kyoto?.className).toContain("ring-2");
      expect(kyoto?.className).toContain("ring-accent-bright");
    });
    const osaka = markers.findLast((m) => m.element?.dataset.slug === "osaka")?.element;
    expect(osaka?.className).not.toContain("ring-2");
    // The reconcile effect must NOT re-run: rebuilding every marker on every
    // hover is the failure this case exists to catch.
    expect(markers.length).toBe(created);
  });

  it("marks a marker created while a slug is already active", async () => {
    renderHook(() => useMapMarkers(map as never, "kyoto"));
    await waitFor(() => expect(map.handlers.get("sourcedata") ?? []).not.toHaveLength(0));
    map.features = [leaf("kyoto")];
    map.emit("sourcedata");
    await waitFor(() => expect(markers).toHaveLength(1));
    expect(markers[0].element?.className).toContain("ring-2");
  });

  it("raises its own slug when the pointer enters the marker element", async () => {
    map.features = [leaf("kyoto"), leaf("osaka")];
    const onEnter = vi.fn();
    renderHook(() => useMapMarkers(map as never, null, { onEnter, onLeave: vi.fn() }));
    await waitFor(() => expect(markers).toHaveLength(2));
    const osaka = markers.find((m) => m.element?.dataset.slug === "osaka")?.element;
    osaka?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(onEnter).toHaveBeenCalledWith("osaka");
  });

  it("clears when the pointer leaves the marker element", async () => {
    map.features = [leaf("kyoto")];
    const onLeave = vi.fn();
    renderHook(() => useMapMarkers(map as never, null, { onEnter: vi.fn(), onLeave }));
    await waitFor(() => expect(markers).toHaveLength(1));
    markers[0].element?.dispatchEvent(new MouseEvent("mouseleave"));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it("calls the latest callbacks without rebuilding a single marker", async () => {
    map.features = [leaf("kyoto")];
    const first = vi.fn();
    const second = vi.fn();
    // An inline arrow from the caller is the normal case, so a new identity on
    // every render must reach the listener through a ref, not through the
    // reconcile effect's deps — rebuilding markers on hover is the failure.
    const { rerender } = renderHook(
      ({ onEnter }) => useMapMarkers(map as never, null, { onEnter }),
      { initialProps: { onEnter: first } },
    );
    await waitFor(() => expect(markers).toHaveLength(1));
    rerender({ onEnter: second });
    // Flushes the reconcile effect's dynamic import: a wrongly-rebuilt marker
    // tears down and re-creates asynchronously, so a bare read after rerender
    // would still see the pre-rebuild count. See the sibling case above.
    await new Promise((resolve) => setTimeout(resolve, 0));
    markers[0].element?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(second).toHaveBeenCalledWith("kyoto");
    expect(first).not.toHaveBeenCalled();
    expect(markers).toHaveLength(1);
    expect(markers[0].removed).toBe(0);
  });

  it("a marker click selects, and does NOT reach a click handler on the map's container", async () => {
    // maplibre appends markers INTO the canvas container it listens on, so a
    // click that bubbles would select and immediately deselect.
    const container = document.createElement("div");
    document.body.append(container);
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    container.addEventListener("click", () => onDeselect());

    map.features = [leaf("nara")];
    renderHook(() => useMapMarkers(map as never, null, { onSelect, onDeselect }));
    await waitFor(() => expect(markers).toHaveLength(1));

    const element = markers[0].getElement();
    container.append(element);
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith("nara");
    expect(onDeselect).not.toHaveBeenCalled();
  });

  it("a click on the map itself deselects", async () => {
    const onDeselect = vi.fn();
    map.features = [leaf("nara")];
    renderHook(() => useMapMarkers(map as never, null, { onDeselect }));
    await waitFor(() => expect(markers).toHaveLength(1));

    map.emit("click");
    expect(onDeselect).toHaveBeenCalledTimes(1);
  });

  it("a fresh handlers object does not rebuild the markers", async () => {
    map.features = [leaf("nara")];
    const { rerender } = renderHook(
      ({ onSelect }) => useMapMarkers(map as never, null, { onSelect }),
      { initialProps: { onSelect: vi.fn() } },
    );
    await waitFor(() => expect(markers).toHaveLength(1));

    rerender({ onSelect: vi.fn() });
    expect(markers).toHaveLength(1);
    expect(markers[0].removed).toBe(0);
  });
});

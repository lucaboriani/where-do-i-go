// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LAYERS, LEGS_SOURCE, POINTS_SOURCE, useMapLayers } from "./use-map-layers";
import { MAP_COLORS } from "@/lib/map/tokens";
import type { IndexEntry } from "@/lib/pod/schema";

class FakeSource {
  data: unknown = null;
  setData(next: unknown) {
    this.data = next;
  }
}

class FakeMap {
  readonly sources = new Map<string, FakeSource>();
  readonly added: string[] = [];
  readonly sourceOptions: Record<string, Record<string, unknown>> = {};
  // Full spec per layer, alongside `added`: the id-only list can't back a
  // paint assertion, and existing cases still read `added`.
  readonly layerSpecs: Record<string, Record<string, unknown>> = {};
  addSource(id: string, options: Record<string, unknown>) {
    this.sources.set(id, new FakeSource());
    this.sourceOptions[id] = options;
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(layer: { id: string } & Record<string, unknown>) {
    this.added.push(layer.id);
    this.layerSpecs[layer.id] = layer;
  }
}

function entry(slug: string, over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    iri: `https://pod.example/e#${slug}`,
    entryResource: `https://pod.example/${slug}.ttl`,
    title: { value: slug, language: "en" },
    slug,
    lat: 1,
    long: 1,
    sortOrder: 1,
    ...over,
  };
}

let map: FakeMap;
beforeEach(() => {
  map = new FakeMap();
});

describe("useMapLayers", () => {
  it("does nothing at all without a map, rather than throwing", () => {
    expect(() => renderHook(() => useMapLayers(null, [entry("a")], true))).not.toThrow();
  });

  it("adds both sources and all four layers once the map is there", () => {
    renderHook(() => useMapLayers(map as never, [entry("a"), entry("b", { sortOrder: 2 })], true));
    expect([...map.sources.keys()].sort()).toEqual([LEGS_SOURCE, POINTS_SOURCE].sort());
    expect(map.added).toEqual([LAYERS.casing, LAYERS.line, LAYERS.clusters, LAYERS.clusterCount]);
  });

  it("draws the casing before the line, because insertion order is paint order", () => {
    renderHook(() => useMapLayers(map as never, [entry("a")], true));
    expect(map.added.indexOf(LAYERS.casing)).toBeLessThan(map.added.indexOf(LAYERS.line));
  });

  it("updates data in place on a rerender instead of re-adding the source", () => {
    const { rerender } = renderHook(({ e }: { e: IndexEntry[] }) => useMapLayers(map as never, e, true), {
      initialProps: { e: [entry("a")] },
    });
    const before = map.getSource(POINTS_SOURCE);
    rerender({ e: [entry("a"), entry("b", { sortOrder: 2 })] });
    expect(map.getSource(POINTS_SOURCE)).toBe(before);
    expect(map.added).toHaveLength(4);
  });

  it("clusters only above the threshold", () => {
    const many = Array.from({ length: 51 }, (_, i) => entry(`e${i}`, { sortOrder: i }));
    renderHook(() => useMapLayers(map as never, many, true));
    expect(map.sourceOptions[POINTS_SOURCE].cluster).toBe(true);
  });

  it("does not cluster a small trip", () => {
    renderHook(() => useMapLayers(map as never, [entry("a")], true));
    expect(map.sourceOptions[POINTS_SOURCE].cluster).toBe(false);
  });

  it("waits for styleLoaded rather than adding sources to a map whose style is not ready", () => {
    renderHook(() => useMapLayers(map as never, [entry("a")], false));
    expect(map.sources.size).toBe(0);
  });

  it("adds the sources once styleLoaded flips true, rather than never", () => {
    // NOT map.isStyleLoaded(): useMapInstance is the one source of truth for
    // this now — ./notes.md#why-styleloaded-is-not-isstyleloaded.
    const { rerender } = renderHook(
      ({ loaded }: { loaded: boolean }) => useMapLayers(map as never, [entry("a")], loaded),
      { initialProps: { loaded: false } },
    );
    expect(map.sources.size).toBe(0);
    rerender({ loaded: true });
    expect([...map.sources.keys()].sort()).toEqual([LEGS_SOURCE, POINTS_SOURCE].sort());
  });

  it("promotes toSlug to the feature id, or setFeatureState has nothing to key on", () => {
    renderHook(() => useMapLayers(map as never, [entry("a"), entry("b", { sortOrder: 2 })], true));
    expect(map.sourceOptions[LEGS_SOURCE].promoteId).toBe("toSlug");
  });

  it("paints the active leg with the bright accent, keyed on feature state", () => {
    renderHook(() => useMapLayers(map as never, [entry("a"), entry("b", { sortOrder: 2 })], true));
    const paint = map.layerSpecs[LAYERS.line].paint as Record<string, unknown>;
    expect(paint["line-color"]).toEqual([
      "case",
      ["boolean", ["feature-state", "active"], false],
      MAP_COLORS.accentBright,
      MAP_COLORS.accent,
    ]);
  });
});

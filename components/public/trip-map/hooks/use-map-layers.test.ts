// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LAYERS, LEGS_SOURCE, POINTS_SOURCE, useMapLayers } from "./use-map-layers";
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
  readonly handlers = new Map<string, (() => void)[]>();
  loaded = true;
  isStyleLoaded() {
    return this.loaded;
  }
  addSource(id: string, options: Record<string, unknown>) {
    this.sources.set(id, new FakeSource());
    this.sourceOptions[id] = options;
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(layer: { id: string }) {
    this.added.push(layer.id);
  }
  getLayer(id: string) {
    return this.added.includes(id) ? { id } : undefined;
  }
  on(event: string, handler: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  off(event: string, handler: () => void) {
    this.handlers.set(
      event,
      (this.handlers.get(event) ?? []).filter((h) => h !== handler),
    );
    return this;
  }
  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
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
    expect(() => renderHook(() => useMapLayers(null, [entry("a")]))).not.toThrow();
  });

  it("adds both sources and all four layers once the map is there", () => {
    renderHook(() => useMapLayers(map as never, [entry("a"), entry("b", { sortOrder: 2 })]));
    expect([...map.sources.keys()].sort()).toEqual([LEGS_SOURCE, POINTS_SOURCE].sort());
    expect(map.added).toEqual([LAYERS.casing, LAYERS.line, LAYERS.clusters, LAYERS.clusterCount]);
  });

  it("draws the casing before the line, because insertion order is paint order", () => {
    renderHook(() => useMapLayers(map as never, [entry("a")]));
    expect(map.added.indexOf(LAYERS.casing)).toBeLessThan(map.added.indexOf(LAYERS.line));
  });

  it("updates data in place on a rerender instead of re-adding the source", () => {
    const { rerender } = renderHook(({ e }: { e: IndexEntry[] }) => useMapLayers(map as never, e), {
      initialProps: { e: [entry("a")] },
    });
    const before = map.getSource(POINTS_SOURCE);
    rerender({ e: [entry("a"), entry("b", { sortOrder: 2 })] });
    expect(map.getSource(POINTS_SOURCE)).toBe(before);
    expect(map.added).toHaveLength(4);
  });

  it("clusters only above the threshold", () => {
    const many = Array.from({ length: 51 }, (_, i) => entry(`e${i}`, { sortOrder: i }));
    renderHook(() => useMapLayers(map as never, many));
    expect(map.sourceOptions[POINTS_SOURCE].cluster).toBe(true);
  });

  it("does not cluster a small trip", () => {
    renderHook(() => useMapLayers(map as never, [entry("a")]));
    expect(map.sourceOptions[POINTS_SOURCE].cluster).toBe(false);
  });

  it("waits for the style rather than adding sources to a map that has none", () => {
    map.loaded = false;
    renderHook(() => useMapLayers(map as never, [entry("a")]));
    expect(map.sources.size).toBe(0);
  });

  it("adds the sources once the style finishes loading, rather than never", () => {
    map.loaded = false;
    renderHook(() => useMapLayers(map as never, [entry("a")]));
    expect(map.sources.size).toBe(0);
    map.loaded = true;
    map.emit("style.load");
    expect([...map.sources.keys()].sort()).toEqual([LEGS_SOURCE, POINTS_SOURCE].sort());
  });
});

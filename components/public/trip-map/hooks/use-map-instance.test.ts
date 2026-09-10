// @vitest-environment jsdom
/**
 * A fake maplibre-gl stands in for the real one — jsdom has no WebGL.
 * ./../notes.md#what-the-hook-test-can-and-cannot-see
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: FakeMap[] = [];

class FakeMap {
  readonly handlers = new Map<string, (() => void)[]>();
  readonly controls: unknown[] = [];
  readonly projections: unknown[] = [];
  readonly fitted: unknown[] = [];
  removed = 0;
  constructor(readonly options: Record<string, unknown>) {
    created.push(this);
  }
  on(event: string, handler: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  once(event: string, handler: () => void) {
    return this.on(event, handler);
  }
  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }
  addControl(control: unknown) {
    this.controls.push(control);
    return this;
  }
  setProjection(projection: unknown) {
    this.projections.push(projection);
    return this;
  }
  fitBounds(bounds: unknown, options: unknown) {
    this.fitted.push({ bounds, options });
    return this;
  }
  remove() {
    this.removed += 1;
  }
}

class FakeAttributionControl {
  constructor(readonly options: unknown) {}
}

vi.mock("maplibre-gl", () => ({ Map: FakeMap, AttributionControl: FakeAttributionControl }));

const BBOX = { west: 129.87, south: 31.59, east: 141.02, north: 35.71 };

function harness(overrides: Partial<Parameters<typeof useMapInstance>[0]> = {}) {
  const node = document.createElement("div");
  document.body.append(node);
  return { container: { current: node }, active: true, bbox: BBOX, ...overrides };
}

let useMapInstance: typeof import("./use-map-instance").useMapInstance;

beforeEach(async () => {
  created.length = 0;
  ({ useMapInstance } = await import("./use-map-instance"));
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("useMapInstance", () => {
  it("creates nothing at all while inactive, which is the whole point of lazy", async () => {
    const opts = harness({ active: false });
    const { result } = renderHook(() => useMapInstance(opts));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(created).toHaveLength(0);
    expect(result.current).toBe("idle");
  });

  it("creates exactly one map when it becomes active", async () => {
    const opts = harness();
    renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
  });

  it("adds the attribution control unconditionally, because removing it is never allowed", async () => {
    const opts = harness();
    renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].controls.filter((c) => c instanceof FakeAttributionControl)).toHaveLength(1);
  });

  it("calls setProjection only from the style.load handler, never before it", async () => {
    const opts = harness();
    renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    // NOT `toHaveLength(0)` on a map that never loaded — that would pass against
    // a hook with no setProjection at all. Prove the call exists, then prove
    // nothing called it early.
    expect(created[0].projections).toHaveLength(0);
    created[0].emit("style.load");
    expect(created[0].projections).toEqual([{ type: "mercator" }]);
  });

  it("fits the bbox it was given, without animating, so the first paint is the trip", async () => {
    const opts = harness();
    renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].emit("style.load");
    expect(created[0].fitted).toEqual([
      {
        bounds: [
          [BBOX.west, BBOX.south],
          [BBOX.east, BBOX.north],
        ],
        options: { padding: 32, animate: false },
      },
    ]);
  });

  it("skips fitBounds when the index has no bbox, rather than fitting a null island", async () => {
    const opts = harness({ bbox: undefined });
    renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].emit("style.load");
    expect(created[0].fitted).toHaveLength(0);
  });

  it("reports ready only once the map says load, not when the import resolves", async () => {
    const opts = harness();
    const { result } = renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(result.current).toBe("loading");
    created[0].emit("load");
    await waitFor(() => expect(result.current).toBe("ready"));
  });

  it("does not rebuild the map when the bbox object identity changes", async () => {
    // created.length alone can't tell a real second effect run from a no-op:
    // map.current's own guard hides it. A read count on container.current
    // can't be hidden that way, since the guard runs before that read.
    // ./../notes.md#why-the-effect-depends-on-activation-alone
    const node = document.createElement("div");
    document.body.append(node);
    let reads = 0;
    const container = {
      get current() {
        reads += 1;
        return node;
      },
    };
    const { rerender } = renderHook(
      (props: { bbox: typeof BBOX }) => useMapInstance({ container, active: true, bbox: props.bbox }),
      { initialProps: { bbox: { ...BBOX } } },
    );
    rerender({ bbox: { ...BBOX } });
    await waitFor(() => expect(created).toHaveLength(1));
    expect(reads).toBe(1);
    expect(created[0].removed).toBe(0);
  });

  it("destroys the instance on unmount, so a navigation away does not leak a WebGL context", async () => {
    const opts = harness();
    const { unmount } = renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    unmount();
    expect(created[0].removed).toBe(1);
  });

  it("passes the deployer's style URL straight through when one is set", async () => {
    const opts = harness({ styleUrl: "https://tiles.example/styles/mine" });
    renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].options.style).toBe("https://tiles.example/styles/mine");
  });

  it("builds the in-repo style when no URL is set, which is what unset means", async () => {
    const opts = harness();
    renderHook(() => useMapInstance(opts));
    await waitFor(() => expect(created).toHaveLength(1));
    const style = created[0].options.style as { layers: unknown[] };
    expect(Array.isArray(style.layers)).toBe(true);
    expect(style.layers).toHaveLength(17);
  });
});

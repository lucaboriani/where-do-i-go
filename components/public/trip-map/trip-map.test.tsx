// @vitest-environment jsdom
/**
 * Lazy activation and the reserved frame. jsdom has no IntersectionObserver,
 * so this file installs one — which is also why the component carries a
 * fallback. ./notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HighlightValue } from "@/hooks/trip/highlight-context";
import type { IndexEntry } from "@/lib/pod/schema";
import { MAP_FRAME_CLASS } from "@/lib/map/frame";
import TripMap from "./trip-map";

const instances: { active: boolean }[] = [];
// A sentinel, not null: proves the hooks receive THIS map instance, not just
// some value.
const SENTINEL_MAP = { sentinel: true };

vi.mock("@/hooks/map/use-map-instance", () => ({
  useMapInstance: (options: { active: boolean }) => {
    instances.push({ active: options.active });
    return { status: options.active ? "loading" : "idle", map: SENTINEL_MAP, styleLoaded: false };
  },
}));

const layerCalls: { map: unknown; entries: unknown; styleLoaded: unknown }[] = [];
vi.mock("@/hooks/map/use-map-layers", () => ({
  useMapLayers: (map: unknown, entries: unknown, styleLoaded: unknown) => {
    layerCalls.push({ map, entries, styleLoaded });
  },
}));

type MarkerCall = {
  map: unknown;
  activeSlug: unknown;
  onEnter?: (slug: string) => void;
  onLeave?: () => void;
  onSelect?: (slug: string) => void;
  onDeselect?: () => void;
};
const markerCalls: MarkerCall[] = [];
vi.mock("@/hooks/map/use-map-markers", () => ({
  useMapMarkers: (map: unknown, activeSlug: unknown, handlers?: Omit<MarkerCall, "map" | "activeSlug">) => {
    markerCalls.push({ map, activeSlug, ...handlers });
  },
}));

const highlightCalls: { map: unknown; activeSlug: unknown; styleLoaded: unknown }[] = [];
vi.mock("@/hooks/map/use-map-highlight", () => ({
  useMapHighlight: (map: unknown, activeSlug: unknown, styleLoaded: unknown) => {
    highlightCalls.push({ map, activeSlug, styleLoaded });
  },
}));

// A mutable module-level value: each test sets it before render rather than
// standing up a real TripHighlightProvider, which needs next/navigation's
// router context for no benefit here — only the value threaded through matters.
// Typed as the real HighlightValue, so a change to the context's shape fails
// tsc here rather than drifting invisibly.
let tripHighlight: HighlightValue = inertMock();

function inertMock(): HighlightValue {
  return {
    activeSlug: null,
    source: null,
    pinnedSlug: null,
    raise: vi.fn(),
    clear: vi.fn(),
    pin: vi.fn(),
    unpin: vi.fn(),
  };
}

vi.mock("@/hooks/trip/highlight-context", () => ({
  useTripHighlight: () => tripHighlight,
}));

function entry(over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    iri: "https://pod.example/travel/trips/t/entries.ttl#e1",
    entryResource: "https://pod.example/travel/trips/t/e1.ttl",
    title: { value: "Arrival", language: "en" },
    slug: "arrival",
    lat: 35.68,
    long: 139.76,
    sortOrder: 1,
    ...over,
  };
}

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;
const observers: { callback: ObserverCallback; disconnected: boolean }[] = [];

function installObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(readonly callback: ObserverCallback) {
        observers.push({ callback, disconnected: false });
      }
      observe() {}
      disconnect() {
        const mine = observers.find((o) => o.callback === this.callback);
        if (mine) mine.disconnected = true;
      }
    },
  );
}

beforeEach(() => {
  instances.length = 0;
  observers.length = 0;
  layerCalls.length = 0;
  markerCalls.length = 0;
  highlightCalls.length = 0;
  tripHighlight = inertMock();
});

afterEach(() => {
  // No `globals: true` here, so RTL's auto-cleanup never registers itself;
  // without this, renders stack up in document.body across cases.
  cleanup();
  vi.unstubAllGlobals();
});

describe("TripMap", () => {
  it("reserves the frame before any script runs, so nothing shifts when the map arrives", () => {
    installObserver();
    const { container } = render(<TripMap />);
    const frame = container.querySelector(`.${MAP_FRAME_CLASS.split(" ")[0]}`);
    expect(frame).not.toBeNull();
  });

  it("does not activate the instance until the frame intersects", () => {
    installObserver();
    render(<TripMap />);
    expect(instances.at(-1)?.active).toBe(false);
  });

  it("activates once the frame intersects, which is the lazy mount", async () => {
    installObserver();
    render(<TripMap />);
    observers[0].callback([{ isIntersecting: true }]);
    await waitFor(() => expect(instances.at(-1)?.active).toBe(true));
  });

  it("stops observing once it has activated, because there is nothing left to wait for", async () => {
    installObserver();
    render(<TripMap />);
    observers[0].callback([{ isIntersecting: true }]);
    await waitFor(() => expect(observers[0].disconnected).toBe(true));
  });

  it("activates immediately where there is no IntersectionObserver, rather than never", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<TripMap />);
    expect(instances.at(-1)?.active).toBe(true);
  });

  it("names the map for a screen reader, because a bare div is not a region", () => {
    installObserver();
    render(<TripMap />);
    expect(screen.getByRole("region", { name: /map/i })).toBeInTheDocument();
  });

  it("passes entries and styleLoaded through to the layers hook, and the map to both hooks", () => {
    installObserver();
    const entries = [entry()];
    render(<TripMap entries={entries} />);
    expect(layerCalls.at(-1)?.entries).toBe(entries);
    expect(layerCalls.at(-1)?.styleLoaded).toBe(false);
    expect(layerCalls.at(-1)?.map).toBe(SENTINEL_MAP);
    expect(markerCalls.at(-1)?.map).toBe(SENTINEL_MAP);
  });

  it('gives the markers hook a hover pair that raises with source "map" and clears', () => {
    installObserver();
    render(<TripMap />);
    markerCalls.at(-1)?.onEnter?.("osaka");
    expect(tripHighlight.raise).toHaveBeenCalledWith("osaka", "map");
    markerCalls.at(-1)?.onLeave?.();
    expect(tripHighlight.clear).toHaveBeenCalledTimes(1);
  });

  it("gives the markers hook a select pair that pins and unpins", () => {
    installObserver();
    render(<TripMap />);
    markerCalls.at(-1)?.onSelect?.("osaka");
    expect(tripHighlight.pin).toHaveBeenCalledWith("osaka");
    markerCalls.at(-1)?.onDeselect?.();
    expect(tripHighlight.unpin).toHaveBeenCalledTimes(1);
  });

  it("threads the trip highlight's activeSlug into the markers hook and the legs-highlight hook", () => {
    installObserver();
    tripHighlight = { ...tripHighlight, activeSlug: "kyoto" };
    render(<TripMap />);
    expect(markerCalls.at(-1)?.activeSlug).toBe("kyoto");
    expect(highlightCalls.at(-1)?.map).toBe(SENTINEL_MAP);
    expect(highlightCalls.at(-1)?.activeSlug).toBe("kyoto");
    expect(highlightCalls.at(-1)?.styleLoaded).toBe(false);
  });

  it("renders the same markup with and without entries, because the server has neither", () => {
    installObserver();
    const { container: a } = render(<TripMap />);
    const { container: b } = render(<TripMap entries={[entry()]} />);
    expect(a.innerHTML).toBe(b.innerHTML);
  });
});

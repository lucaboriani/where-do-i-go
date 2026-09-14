// @vitest-environment jsdom
/**
 * The globe island. jsdom has no IntersectionObserver, so this file installs
 * one where activation is what is under test — which is also why the component
 * carries a fallback. ../trip-map/notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAP_FRAME_CLASS } from "@/components/public/trip-map";
import type { MapInstanceOptions } from "@/hooks/map/use-map-instance";
import type { HighlightValue } from "@/hooks/trip/highlight-context";
import type { TripPoint } from "@/lib/map/trips";
import DiaryMap from "./diary-map";

const useMapInstance = vi.fn((options: MapInstanceOptions) => ({
  map: null,
  styleLoaded: false,
  status: options.active ? "loading" : "idle",
}));
const useMapTrips = vi.fn();
vi.mock("@/hooks/map/use-map-instance", () => ({
  useMapInstance: (o: MapInstanceOptions) => useMapInstance(o),
}));
vi.mock("@/hooks/map/use-map-trips", () => ({
  useMapTrips: (...args: unknown[]) => useMapTrips(...args),
}));

// A mutable module-level value rather than a real provider, exactly as the
// sibling's test does it: only the value threaded through matters here.
let tripHighlight: HighlightValue = inertMock();
vi.mock("@/hooks/trip/highlight-context", () => ({
  useTripHighlight: () => tripHighlight,
}));

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

function options(): MapInstanceOptions {
  const last = useMapInstance.mock.calls.at(-1);
  if (last === undefined) throw new Error("useMapInstance was never called");
  return last[0];
}
const tripsArgs = () => useMapTrips.mock.calls.at(-1) as unknown[];
const handlers = () =>
  tripsArgs()?.[4] as {
    onEnter?: (slug: string) => void;
    onLeave?: () => void;
    onSelect?: (slug: string) => void;
  };

const trips: TripPoint[] = [
  { slug: "2026-japan", name: "Japan, spring", center: { lat: 35.6938, long: 139.7034 } },
];

beforeEach(() => {
  observers.length = 0;
  useMapInstance.mockClear();
  useMapTrips.mockClear();
  tripHighlight = inertMock();
});

afterEach(() => {
  // No `globals: true` here, so RTL's auto-cleanup never registers itself.
  cleanup();
  vi.unstubAllGlobals();
});

describe("DiaryMap", () => {
  it("renders a labelled region, so the browser case has something to find", () => {
    render(<DiaryMap trips={trips} />);
    expect(screen.getByRole("region", { name: /diary map/i })).toBeInTheDocument();
  });

  it("asks for the globe, not the flat default", () => {
    render(<DiaryMap trips={trips} />);
    expect(useMapInstance).toHaveBeenCalledWith(
      expect.objectContaining({ projection: { type: "globe" } }),
    );
  });

  it("hands the trips straight to the trips hook", () => {
    render(<DiaryMap trips={trips} />);
    expect(useMapTrips).toHaveBeenCalledWith(null, trips, false, null, expect.any(Object));
  });

  it("passes no bbox, because the camera is the trips hook's", () => {
    render(<DiaryMap trips={trips} />);
    expect(Object.hasOwn(options(), "bbox")).toBe(false);
  });

  it("wears the shared frame class rather than a second copy of it", () => {
    const { container } = render(<DiaryMap trips={trips} />);
    expect(container.firstElementChild?.className).toBe(MAP_FRAME_CLASS);
  });

  it("does not activate the instance until the frame intersects", () => {
    installObserver();
    render(<DiaryMap trips={trips} />);
    expect(options().active).toBe(false);
  });

  it("activates once the frame intersects, which is the lazy mount", async () => {
    installObserver();
    render(<DiaryMap trips={trips} />);
    observers[0].callback([{ isIntersecting: true }]);
    await waitFor(() => expect(options().active).toBe(true));
  });

  it("stops observing once it has activated, because there is nothing left to wait for", async () => {
    installObserver();
    render(<DiaryMap trips={trips} />);
    observers[0].callback([{ isIntersecting: true }]);
    await waitFor(() => expect(observers[0].disconnected).toBe(true));
  });

  it("activates immediately where there is no IntersectionObserver, rather than never", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<DiaryMap trips={trips} />);
    expect(options().active).toBe(true);
  });

  it('gives the trips hook a hover pair that raises with source "map" and clears', () => {
    render(<DiaryMap trips={trips} />);
    handlers().onEnter?.("2026-japan");
    expect(tripHighlight.raise).toHaveBeenCalledWith("2026-japan", "map");
    handlers().onLeave?.();
    expect(tripHighlight.clear).toHaveBeenCalledTimes(1);
  });

  it("pins on select, which is what the sheet reveals a row for", () => {
    render(<DiaryMap trips={trips} />);
    handlers().onSelect?.("2026-japan");
    expect(tripHighlight.pin).toHaveBeenCalledWith("2026-japan");
  });

  it("threads the highlight's activeSlug into the trips hook", () => {
    tripHighlight = { ...tripHighlight, activeSlug: "2026-japan" };
    render(<DiaryMap trips={trips} />);
    expect(tripsArgs()[3]).toBe("2026-japan");
  });

  it("keeps ONE empty-trips identity across renders, or the source re-parses every time", () => {
    const { rerender } = render(<DiaryMap />);
    const first = tripsArgs()[1];
    rerender(<DiaryMap />);
    expect(tripsArgs()[1]).toBe(first);
  });
});

// @vitest-environment jsdom
/**
 * Lazy activation and the reserved frame. jsdom has no IntersectionObserver,
 * so this file installs one — which is also why the component carries a
 * fallback. ./notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripMap, { MAP_FRAME_CLASS } from "./trip-map";

const instances: { active: boolean }[] = [];

vi.mock("./hooks/use-map-instance", () => ({
  useMapInstance: (options: { active: boolean }) => {
    instances.push({ active: options.active });
    return options.active ? "loading" : "idle";
  },
}));

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
});

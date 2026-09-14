// @vitest-environment jsdom
// components/public/map-sheet/map-sheet.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripHighlightContext, type HighlightValue } from "@/hooks/trip/highlight-context";
import MapSheet from "./map-sheet";

afterEach(cleanup);

// jsdom implements neither matchMedia nor scrollTo, and layout is all zeroes.
// Each is stubbed to the SMALLEST thing that makes the assertion meaningful.
const scrollTo = vi.fn();
beforeEach(() => {
  scrollTo.mockClear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
  Element.prototype.scrollTo = scrollTo as never;
});

const highlight = (over: Partial<HighlightValue>): HighlightValue => ({
  activeSlug: null,
  pinnedSlug: null,
  source: null,
  raise: () => {},
  clear: () => {},
  pin: () => {},
  unpin: () => {},
  ...over,
});

// The mount effect has already run by the time render() returns, so the
// shared-link case has to stub the PROTOTYPE: there is no instance to spy on
// yet. Restored after every test.
const nativeOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
afterEach(() => {
  if (nativeOffsetTop) Object.defineProperty(HTMLElement.prototype, "offsetTop", nativeOffsetTop);
});

function offsetsBeforeRender({ half, body }: { half: number; body: number }) {
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.classList.contains("trip-sheet-spacer-half")) return half;
      if (this.classList.contains("trip-sheet-body")) return body;
      return 0;
    },
  });
}

function offsets(container: HTMLElement, { half, body }: { half: number; body: number }) {
  const spacer = container.querySelector(".trip-sheet-spacer-half") as HTMLElement;
  const sheetBody = container.querySelector(".trip-sheet-body") as HTMLElement;
  vi.spyOn(spacer, "offsetTop", "get").mockReturnValue(half);
  vi.spyOn(sheetBody, "offsetTop", "get").mockReturnValue(body);
}

describe("MapSheet", () => {
  it("renders its children, which arrive as server output", () => {
    render(
      <MapSheet>
        <p>the timeline</p>
      </MapSheet>,
    );
    expect(screen.getByText("the timeline")).toBeTruthy();
  });

  it("the handle cycles to the next snap point", () => {
    const { container } = render(<MapSheet>x</MapSheet>);
    offsets(container, { half: 240, body: 640 });

    fireEvent.click(screen.getByRole("button", { name: /entry list/i }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: "smooth" });
  });

  it("honours prefers-reduced-motion on the same call", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    const { container } = render(<MapSheet>x</MapSheet>);
    offsets(container, { half: 240, body: 640 });

    fireEvent.click(screen.getByRole("button", { name: /entry list/i }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: "auto" });
  });

  it("subtracts the strip the body's scroll-margin reserves, rather than a number of its own", () => {
    const { container } = render(<MapSheet>x</MapSheet>);
    offsets(container, { half: 240, body: 640 });
    const sheetBody = container.querySelector(".trip-sheet-body") as HTMLElement;
    sheetBody.style.scrollMarginTop = "64px";
    const scroller = container.querySelector(".trip-sheet") as HTMLElement;
    vi.spyOn(scroller, "scrollTop", "get").mockReturnValue(240);

    fireEvent.click(screen.getByRole("button", { name: /entry list/i }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 576, behavior: "smooth" });
  });

  it("a pin reveals its row, never closing the sheet to do it", () => {
    const row = () => <li data-slug="nara">Nara</li>;
    const { container, rerender } = render(
      <TripHighlightContext value={highlight({})}>
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );

    // Stubbed AFTER the first render, so the effect below runs against geometry
    // rather than against jsdom's zeroes.
    offsets(container, { half: 240, body: 640 });
    const li = container.querySelector('[data-slug="nara"]') as HTMLElement;
    Object.defineProperty(li, "offsetTop", { get: () => 1400, configurable: true });
    const handle = container.querySelector(".trip-sheet-handle") as HTMLElement;
    Object.defineProperty(handle, "offsetHeight", { get: () => 32, configurable: true });

    rerender(
      <TripHighlightContext
        value={highlight({ activeSlug: "nara", pinnedSlug: "nara", source: "pin" })}
      >
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );

    // 1400 minus the handle's own 32px, so a reveal that forgot the handle and
    // parked the row underneath it fails here. The half floor is snap.test.ts's.
    expect(scrollTo).toHaveBeenCalledWith({ top: 1368, behavior: "smooth" });
  });

  it("a fresh load on an entry route opens the sheet, once, without animating", () => {
    // The shared-link path: someone opens /trips/japan/nara directly and the
    // entry's prose must not be below the fold.
    offsetsBeforeRender({ half: 240, body: 640 });
    render(
      <TripHighlightContext value={highlight({ activeSlug: "nara", source: "route" })}>
        <MapSheet>
          <li data-slug="nara">Nara</li>
        </MapSheet>
      </TripHighlightContext>,
    );

    // full, not half and not peek: half is 240 here precisely so that a mount
    // opening the sheet to the wrong snap point cannot match.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 640, behavior: "auto" });
  });

  it("a route highlight arriving after mount does NOT move the sheet", () => {
    const { rerender } = render(
      <TripHighlightContext value={highlight({})}>
        <MapSheet>
          <li data-slug="nara">Nara</li>
        </MapSheet>
      </TripHighlightContext>,
    );
    expect(scrollTo).not.toHaveBeenCalled();

    rerender(
      <TripHighlightContext value={highlight({ activeSlug: "nara", source: "route" })}>
        <MapSheet>
          <li data-slug="nara">Nara</li>
        </MapSheet>
      </TripHighlightContext>,
    );

    // Only a pin moves a sheet the reader has already placed.
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("a hover that comes and goes while a pin is live leaves the sheet alone", () => {
    const row = () => (
      <>
        <li data-slug="nara">Nara</li>
        <li data-slug="osaka">Osaka</li>
      </>
    );
    const pinned = highlight({ activeSlug: "nara", pinnedSlug: "nara", source: "pin" });
    const { container, rerender } = render(
      <TripHighlightContext value={highlight({})}>
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );
    offsets(container, { half: 240, body: 640 });
    const li = container.querySelector('[data-slug="nara"]') as HTMLElement;
    Object.defineProperty(li, "offsetTop", { get: () => 1400, configurable: true });

    rerender(
      <TripHighlightContext value={pinned}>
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );
    // A hover outranks the pin while it lasts, so activeSlug and source both
    // move and then both move back. The PIN never changed.
    rerender(
      <TripHighlightContext
        value={highlight({ activeSlug: "osaka", pinnedSlug: "nara", source: "map" })}
      >
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );
    rerender(
      <TripHighlightContext value={pinned}>
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );

    // Once for the pin, and nothing for the hover: on touch the drag that
    // starts on a row would otherwise snap the sheet back mid-gesture.
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("opens on a pin that arrives under a hover, which is what a tap actually sends", () => {
    // Chrome emulates mouseenter BEFORE click, so the marker raises a "map"
    // highlight first and source is never "pin" on the render that pins.
    const row = () => (
      <>
        <li data-slug="nara">Nara</li>
        <li data-slug="osaka">Osaka</li>
      </>
    );
    const { container, rerender } = render(
      <TripHighlightContext value={highlight({})}>
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );
    offsets(container, { half: 240, body: 640 });
    const li = container.querySelector('[data-slug="nara"]') as HTMLElement;
    Object.defineProperty(li, "offsetTop", { get: () => 1400, configurable: true });

    rerender(
      <TripHighlightContext
        value={highlight({ activeSlug: "osaka", pinnedSlug: "nara", source: "map" })}
      >
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );

    // The row the reader TAPPED, not the one the emulated pointer is over.
    expect(scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: "smooth" });
  });
});

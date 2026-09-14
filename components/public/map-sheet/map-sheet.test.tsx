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
  source: null,
  raise: () => {},
  clear: () => {},
  pin: () => {},
  unpin: () => {},
  ...over,
});

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

    rerender(
      <TripHighlightContext value={highlight({ activeSlug: "nara", source: "pin" })}>
        <MapSheet>{row()}</MapSheet>
      </TripHighlightContext>,
    );

    // The exact number, not expect.any(Number): the handle is 0px tall in jsdom,
    // so targetForRow(1400, 0, ...) is 1400 and a broken targetForRow cannot pass.
    expect(scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: "smooth" });
  });

  it("a fresh load on an entry route opens the sheet, once, without animating", () => {
    // The shared-link path: someone opens /trips/japan/nara directly and the
    // entry's prose must not be below the fold.
    render(
      <TripHighlightContext value={highlight({ activeSlug: "nara", source: "route" })}>
        <MapSheet>
          <li data-slug="nara">Nara</li>
        </MapSheet>
      </TripHighlightContext>,
    );

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "auto" });
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
});

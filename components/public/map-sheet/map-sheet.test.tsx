// @vitest-environment jsdom
// components/public/map-sheet/map-sheet.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
});

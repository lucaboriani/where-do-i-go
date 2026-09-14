// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripHighlightContext, type HighlightValue } from "@/hooks/trip/highlight-context";
import TripRow from "./trip-row";

afterEach(cleanup);

const value = (over: Partial<HighlightValue>): HighlightValue => ({
  activeSlug: null,
  pinnedSlug: null,
  source: null,
  raise: () => {},
  clear: () => {},
  pin: () => {},
  unpin: () => {},
  ...over,
});

describe("TripRow", () => {
  it("carries its slug, so the sheet can reveal it", () => {
    render(
      <TripHighlightContext value={value({})}>
        <TripRow slug="2026-japan">body</TripRow>
      </TripHighlightContext>,
    );
    expect(screen.getByText("body").closest("li")?.dataset.slug).toBe("2026-japan");
  });

  it("raises on pointer enter and clears on leave", () => {
    const raise = vi.fn();
    const clear = vi.fn();
    render(
      <TripHighlightContext value={value({ raise, clear })}>
        <TripRow slug="2026-japan">body</TripRow>
      </TripHighlightContext>,
    );
    const row = screen.getByText("body").closest("li")!;

    fireEvent.pointerEnter(row);
    expect(raise).toHaveBeenCalledWith("2026-japan", "timeline");

    fireEvent.pointerLeave(row);
    expect(clear).toHaveBeenCalled();
  });

  it("marks itself active when the highlight names it", () => {
    render(
      <TripHighlightContext value={value({ activeSlug: "2026-japan" })}>
        <TripRow slug="2026-japan">body</TripRow>
      </TripHighlightContext>,
    );
    expect(screen.getByText("body").closest("li")?.dataset.active).toBe("true");
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TimelineRow from "./timeline-row";
import { useTripHighlight } from "@/hooks/trip/highlight-context";
import type { IndexEntry } from "@/lib/pod/schema";

// Mocked rather than wrapped in a real provider: the assertions are about
// TimelineRow's own wiring (which slug/source it raises, when it clears),
// not about useHighlightState's pointer-vs-route precedence — that belongs
// to hooks/trip/use-highlight-state.test.ts.
vi.mock("@/hooks/trip/highlight-context", () => ({ useTripHighlight: vi.fn() }));

afterEach(cleanup);

const entry: IndexEntry = {
  iri: "https://pod.example/t/i#it",
  entryResource: "https://pod.example/t/e",
  title: { value: "Arrival", language: "en" },
  slug: "arrival",
  sortOrder: 1,
};

function setup(activeSlug: string | null) {
  const raise = vi.fn();
  const clear = vi.fn();
  vi.mocked(useTripHighlight).mockReturnValue({ activeSlug, source: null, raise, clear });
  // Rendered inside a <ul> so the row keeps its listitem role and valid HTML.
  render(
    <ul>
      <TimelineRow href="/trips/japan/arrival" entry={entry} />
    </ul>,
  );
  return { raise, clear };
}

describe("TimelineRow", () => {
  it("raises this row's slug and source \"timeline\" on pointer-enter", () => {
    const { raise } = setup(null);
    fireEvent.pointerEnter(screen.getByRole("listitem"));
    expect(raise).toHaveBeenCalledWith("arrival", "timeline");
  });

  it("raises this row's slug and source \"timeline\" on focus", () => {
    const { raise } = setup(null);
    fireEvent.focus(screen.getByRole("listitem"));
    expect(raise).toHaveBeenCalledWith("arrival", "timeline");
  });

  it("clears on pointer-leave", () => {
    const { clear } = setup(null);
    fireEvent.pointerLeave(screen.getByRole("listitem"));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("clears on blur", () => {
    const { clear } = setup(null);
    fireEvent.blur(screen.getByRole("listitem"));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("marks data-active when this row's slug is the active one", () => {
    setup("arrival");
    expect(screen.getByRole("listitem")).toHaveAttribute("data-active", "true");
  });

  it("carries no data-active when a different slug is active", () => {
    setup("someone-else");
    expect(screen.getByRole("listitem")).not.toHaveAttribute("data-active");
  });
});

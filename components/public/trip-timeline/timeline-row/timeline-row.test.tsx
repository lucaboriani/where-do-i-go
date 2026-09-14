// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Link from "next/link";
import TimelineRow from "./timeline-row";
import { useTripHighlight } from "@/hooks/trip/highlight-context";

// Mocked rather than wrapped in a real provider: the assertions are about
// TimelineRow's own wiring (which slug/source it raises, when it clears),
// not about useHighlightState's pointer-vs-route precedence — that belongs
// to hooks/trip/use-highlight-state.test.ts.
vi.mock("@/hooks/trip/highlight-context", () => ({ useTripHighlight: vi.fn() }));

afterEach(cleanup);

function setup(activeSlug: string | null, slug = "arrival") {
  const raise = vi.fn();
  const clear = vi.fn();
  const pin = vi.fn();
  const unpin = vi.fn();
  vi.mocked(useTripHighlight).mockReturnValue({
    activeSlug,
    source: null,
    pinnedSlug: null,
    raise,
    clear,
    pin,
    unpin,
  });
  // The link and the time arrive as children now, rendered by the server
  // component — so the row is given one here rather than rendering its own.
  render(
    <ul>
      <TimelineRow slug={slug}>
        <Link href={`/trips/japan/${slug}`}>Arrival</Link>
      </TimelineRow>
    </ul>,
  );
  return { raise, clear, pin, unpin };
}

describe("TimelineRow", () => {
  it('raises this row\'s slug and source "timeline" on pointer-enter', () => {
    const { raise } = setup(null);
    fireEvent.pointerEnter(screen.getByRole("listitem"));
    expect(raise).toHaveBeenCalledWith("arrival", "timeline");
  });

  // On the LINK, not the row: the row has no tabIndex and never receives focus
  // in production. Firing at the li would assert a path nothing reaches.
  it('raises this row\'s slug and source "timeline" when its link takes focus', () => {
    const { raise } = setup(null);
    fireEvent.focus(screen.getByRole("link"));
    expect(raise).toHaveBeenCalledWith("arrival", "timeline");
  });

  it("clears on pointer-leave", () => {
    const { clear } = setup(null);
    fireEvent.pointerLeave(screen.getByRole("listitem"));
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it("clears when its link loses focus", () => {
    const { clear } = setup(null);
    fireEvent.blur(screen.getByRole("link"));
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

  it("renders whatever children it is handed, which is where the link lives now", () => {
    setup(null);
    expect(screen.getByRole("listitem")).toContainElement(screen.getByRole("link"));
  });

  // Through setup(), not a bare render(): the module-wide vi.mock returns
  // undefined until a case sets it, so a lone render() here would only work on
  // whatever the previous case happened to leave behind.
  it("carries its slug in the DOM, so the sheet can find the row to reveal", () => {
    setup(null, "nara");
    expect(screen.getByRole("listitem")).toHaveAttribute("data-slug", "nara");
  });
});

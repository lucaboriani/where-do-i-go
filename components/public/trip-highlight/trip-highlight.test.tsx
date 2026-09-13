// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripHighlightProvider from "./trip-highlight";
import { useTripHighlight } from "@/hooks/trip/highlight-context";

const segment = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => segment.value }));

function Probe() {
  const { activeSlug, source } = useTripHighlight();
  return <span data-testid="probe">{`${activeSlug ?? "-"}:${source ?? "-"}`}</span>;
}

// No `globals: true`, so RTL's auto-cleanup never registers itself; without
// this, renders stack up in document.body across cases.
afterEach(cleanup);

describe("TripHighlightProvider", () => {
  it("publishes the route segment as a route-sourced highlight", () => {
    segment.value = "kyoto";
    render(
      <TripHighlightProvider>
        <Probe />
      </TripHighlightProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("kyoto:route");
  });

  it("publishes nothing on the trip route itself", () => {
    segment.value = null;
    render(
      <TripHighlightProvider>
        <Probe />
      </TripHighlightProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("-:-");
  });

  it("keeps a non-consuming child's identity on raise, so it skips a render while the consumer takes one", () => {
    segment.value = null;
    const counted = vi.fn();
    const consumed = vi.fn();
    function Counted() {
      counted();
      return null;
    }
    function Consumer() {
      consumed();
      const { activeSlug, raise } = useTripHighlight();
      return (
        <button type="button" onClick={() => raise("kyoto", "timeline")}>
          {activeSlug ?? "none"}
        </button>
      );
    }
    render(
      <TripHighlightProvider>
        <Counted />
        <Consumer />
      </TripHighlightProvider>,
    );
    const countedBefore = counted.mock.calls.length;
    const consumedBefore = consumed.mock.calls.length;

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByRole("button")).toHaveTextContent("kyoto");
    expect(consumed.mock.calls.length).toBeGreaterThan(consumedBefore);
    expect(counted.mock.calls.length).toBe(countedBefore);
  });
});

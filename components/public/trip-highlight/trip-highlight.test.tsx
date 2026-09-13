// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripHighlightProvider from "./trip-highlight";
import TripTimeline from "@/components/public/trip-timeline";
import { useTripHighlight } from "@/hooks/trip/highlight-context";
import type { IndexEntry } from "@/lib/pod/schema";

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

// Two REAL rows under ONE REAL provider. Everything else either mocks
// useTripHighlight (timeline-row.test.tsx) or stubs TripMap (layout.test.tsx),
// and the pointer that outlived its own <li> got through that gap.
describe("a whole timeline under one provider", () => {
  const entry = (over: Partial<IndexEntry>): IndexEntry => ({
    iri: "https://pod.example/t/i#a",
    entryResource: "https://pod.example/t/a",
    title: { value: "Arrival", language: "en" },
    slug: "arrival",
    sortOrder: 1,
    ...over,
  });

  const nara = entry({
    iri: "https://pod.example/t/i#b",
    title: { value: "Nara", language: "en" },
    slug: "nara",
    sortOrder: 2,
  });

  // A function, not one element: React bails out of re-rendering a component
  // handed the identical element, so a shared constant would never re-read the
  // mocked segment. That bailout is what ./notes.md#why-plain-context-is-enough
  // relies on elsewhere.
  const tree = () => (
    <TripHighlightProvider>
      <TripTimeline slug="japan" entries={[entry({}), nara]} />
    </TripHighlightProvider>
  );

  it("marks only the row under the pointer, and flips both when it moves", () => {
    segment.value = null;
    render(tree());
    const [arrival, second] = screen.getAllByRole("listitem");

    fireEvent.pointerEnter(arrival);
    expect(arrival).toHaveAttribute("data-active", "true");
    expect(second).not.toHaveAttribute("data-active");

    fireEvent.pointerEnter(second);
    expect(second).toHaveAttribute("data-active", "true");
    expect(arrival).not.toHaveAttribute("data-active");

    fireEvent.pointerLeave(second);
    expect(second).not.toHaveAttribute("data-active");
    expect(arrival).not.toHaveAttribute("data-active");
  });

  it("hands the highlight to the route when the segment moves under a raised pointer", () => {
    segment.value = null;
    const { rerender } = render(tree());
    fireEvent.pointerEnter(screen.getAllByRole("listitem")[0]);

    // The navigation the pointer never sees: the <li> that raised it is gone in
    // the real DOM, and no focusout or pointerleave ever arrives.
    segment.value = "nara";
    rerender(tree());

    const [arrival, second] = screen.getAllByRole("listitem");
    expect(second).toHaveAttribute("data-active", "true");
    expect(arrival).not.toHaveAttribute("data-active");
  });
});

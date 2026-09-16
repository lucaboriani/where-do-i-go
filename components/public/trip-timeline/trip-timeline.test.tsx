// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import TripTimeline from "./trip-timeline";
import type { IndexEntry } from "@/lib/pod/schema";

// No `globals: true`, so RTL's auto-cleanup never registers itself; without
// this, renders stack up in document.body across cases.
afterEach(cleanup);

// Pinned the way lib/time/offsets.test.ts pins it for this same arithmetic:
// unpinned, a runner set to Asia/Tokyo would pass the +09:00 case below for
// the wrong reason.
const REAL_TZ = process.env.TZ;
process.env.TZ = "Australia/Lord_Howe";
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

const entry = (over: Partial<IndexEntry>): IndexEntry => ({
  iri: "https://pod.example/t/i#it",
  entryResource: "https://pod.example/t/e",
  title: { value: "Arrival", language: "en" },
  slug: "arrival",
  sortOrder: 1,
  ...over,
});

describe("TripTimeline", () => {
  it("renders the stored wall clock, never the reader's zone", () => {
    // +09:00 is deliberately not the machine's offset. A Date round-trip would
    // render 05:30 here in UTC; the wall clock is what happened.
    render(
      <TripTimeline slug="japan" entries={[entry({ occurredAt: "2026-03-29T14:30:00+09:00" })]} />,
    );
    expect(screen.getByText("14:30")).toBeInTheDocument();
    expect(screen.getByText(/2026-03-29/)).toBeInTheDocument();
  });

  it("renders a row with no date rather than inventing one", () => {
    // NOT queryByRole("time"): <time> has no implicit ARIA role, so that query
    // returns null whether or not a date rendered — a check that cannot fail.
    const { container } = render(
      <TripTimeline slug="japan" entries={[entry({ occurredAt: undefined })]} />,
    );
    expect(screen.getByRole("link", { name: "Arrival" })).toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
  });

  it("orders by sortOrder, not by array order", () => {
    render(
      <TripTimeline
        slug="japan"
        entries={[
          entry({ slug: "second", title: { value: "Second", language: "en" }, sortOrder: 2 }),
          entry({ slug: "first", title: { value: "First", language: "en" }, sortOrder: 1 }),
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["First", "Second"]);
  });

  it("links each row to the entry route", () => {
    render(<TripTimeline slug="japan" entries={[entry({})]} />);
    expect(screen.getByRole("link", { name: "Arrival" })).toHaveAttribute(
      "href",
      "/trips/japan/arrival",
    );
  });

  it("renders the thumbnail, the travel mode and the precision when the index carries them", () => {
    // Nara, fuzzed — same coordinates as the "circle shape" case below.
    const { container } = render(
      <TripTimeline
        slug="japan"
        entries={[
          entry({
            slug: "nara",
            thumbnail: "https://pod.example/t/e1/thumb.jpg",
            travelModeFrom: "Train",
            lat: 34.6851,
            long: 135.805,
            precisionMeters: 500,
          }),
        ]}
      />,
    );

    const thumb = screen.getByRole("presentation");
    expect(thumb.getAttribute("src")).toBe("https://pod.example/t/e1/thumb.jpg");
    expect(thumb.getAttribute("loading")).toBe("lazy");
    expect(screen.getByText(/train/i)).toBeTruthy();
    // The formatted coordinate, not the "~500 m" radius label — the shape
    // class carries the fuzz now, per the two precision cases below.
    const precision = container.querySelector(".precision");
    expect(precision).not.toBeNull();
    expect(precision).not.toHaveClass("exact");
    expect(precision?.textContent).toBe("34.69°N 135.81°E");
  });

  it("renders none of the three when the index carries none of them", () => {
    render(<TripTimeline slug="japan" entries={[entry({ slug: "nara" })]} />);

    expect(screen.queryByRole("presentation")).toBeNull();
    expect(screen.queryByText(/~/)).toBeNull();
    // Text AND child count: with no occurredAt the row is the link and nothing
    // else, and an unconditional <span>{entry.travelModeFrom}</span> renders an
    // EMPTY span that only the count catches. Mutation-checked, see the report.
    expect(screen.getByRole("listitem").textContent).toBe("Arrival");
    expect(screen.getByRole("listitem").children).toHaveLength(1);
  });

  it("sets the entry date in mono data type", () => {
    render(
      <TripTimeline slug="japan" entries={[entry({ occurredAt: "2026-03-29T21:40:00+09:00" })]} />,
    );
    // Split across two <span> children (date, time); <time> is the stable
    // anchor regardless of how the wall clock text is broken up.
    const date = screen.getByText(/2026-03-29/);
    expect(date.closest("time")).toHaveClass("data");
  });

  it("renders travel mode as a mono label", () => {
    render(<TripTimeline slug="japan" entries={[entry({ travelModeFrom: "Train" })]} />);
    expect(screen.getByText("Train")).toHaveClass("label");
  });

  it("marks an exact coordinate with the square shape", () => {
    // Coordinates from .mockups/trip.html's Shinjuku row — an exact reading,
    // no precisionMeters.
    const { container } = render(
      <TripTimeline
        slug="japan"
        entries={[entry({ slug: "shinjuku", lat: 35.6938, long: 139.7034 })]}
      />,
    );
    const el = container.querySelector(".precision");
    expect(el).not.toBeNull();
    expect(el).toHaveClass("exact");
  });

  it("marks a fuzzed coordinate with the circle shape, not exact", () => {
    // Coordinates from .mockups/trip.html's Nara row — fuzzed, so
    // precisionMeters is set.
    const { container } = render(
      <TripTimeline
        slug="japan"
        entries={[entry({ slug: "nara", lat: 34.6851, long: 135.805, precisionMeters: 500 })]}
      />,
    );
    const el = container.querySelector(".precision");
    expect(el).not.toBeNull();
    expect(el).not.toHaveClass("exact");
  });

  it("keeps entries as a numbered sequence, not an unordered list", () => {
    // A trip's entries ARE a sequence (spec §3 / Global Constraints) — this
    // must stay true across the restyle, unlike the diary's trip list.
    const { container } = render(<TripTimeline slug="japan" entries={[entry({})]} />);
    expect(container.querySelector("ol")).toHaveClass("list-decimal");
  });
});

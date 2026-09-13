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
});

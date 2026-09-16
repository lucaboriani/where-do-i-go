// @vitest-environment jsdom
/**
 * Phase 7 task 4: `@masthead` renders the trip name/dates/description above
 * `.trip-shell`. Calls exported `TripMasthead` directly, not
 * `<TripMastheadPage>` — same reason as TripContent, see page.tsx.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrip } from "@/lib/pod/cached";
import { ok } from "@/lib/pod/result";
import type { Trip } from "@/lib/pod/schema";
import { TripMasthead } from "./page";

vi.mock("@/lib/pod/cached", () => ({
  getTrip: vi.fn(),
}));

afterEach(cleanup);

const SLUG = "2026-japan";

// Values verbatim from docs/data-model.md §7.2's normative Trip fixture.
const aTrip = (over: Partial<Trip> = {}): Trip => ({
  iri: "https://pod.example/travel/trips/2026-japan/trip.ttl#it",
  slug: SLUG,
  status: "published",
  schemaVersion: 2,
  name: { value: "Japan, spring", language: "en" },
  description: { value: "Three weeks from Tokyo to Kyushu, mostly by train.", language: "en" },
  startDate: "2026-03-28",
  endDate: "2026-04-17",
  tags: [],
  ...over,
});

beforeEach(() => {
  vi.mocked(getTrip).mockResolvedValue(ok(aTrip()));
});

describe("TripMasthead", () => {
  it("sets the trip name in the display cut, tagged as the trip title", async () => {
    render(await TripMasthead({ params: Promise.resolve({ slug: SLUG }) }));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveClass("display");
    expect(h1).toHaveClass("trip-title");
  });

  it("renders the trip's date range in mono", async () => {
    render(await TripMasthead({ params: Promise.resolve({ slug: SLUG }) }));
    // The current TripContent markup joins both dates into one text node
    // ("start – end"); the masthead is expected to keep that shape.
    expect(screen.getByText(/2026-03-28/)).toHaveClass("data-lg");
  });
});

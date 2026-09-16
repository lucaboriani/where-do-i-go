// @vitest-environment jsdom
/**
 * The trip page's restyle (phase 7 task 4): the trip name is a display
 * heading and the trip dates render in mono, not the plain text-2xl/text-sm
 * treatment. Calls the exported async `TripContent` directly, never
 * `<TripPage>` — see page.tsx's own comment on the export.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrip, getTripIndex, publishedTripSlugs } from "@/lib/pod/cached";
import { ok } from "@/lib/pod/result";
import type { Trip, TripIndex } from "@/lib/pod/schema";
import { TripContent } from "./page";

vi.mock("@/lib/pod/cached", () => ({
  getTrip: vi.fn(),
  getTripIndex: vi.fn(),
  publishedTripSlugs: vi.fn(),
}));

// No `globals: true`, so RTL's auto-cleanup never registers itself.
afterEach(cleanup);

const SLUG = "2026-japan";

// Values verbatim from docs/data-model.md §7.2's normative Trip fixture, not
// invented — the point is testing against the read model, not a guess.
const aTrip = (over: Partial<Trip> = {}): Trip => ({
  iri: "https://pod.example/travel/trips/2026-japan/trip.ttl#it",
  slug: SLUG,
  status: "published",
  schemaVersion: 2,
  name: { value: "Japan, spring", language: "en" },
  startDate: "2026-03-28",
  endDate: "2026-04-17",
  tags: [],
  ...over,
});

const anIndex = (over: Partial<TripIndex> = {}): TripIndex => ({
  iri: "https://pod.example/travel/trips/2026-japan/entries.ttl",
  schemaVersion: 2,
  entries: [],
  ...over,
});

beforeEach(() => {
  vi.mocked(publishedTripSlugs).mockResolvedValue(ok([SLUG]));
  vi.mocked(getTrip).mockResolvedValue(ok(aTrip()));
  vi.mocked(getTripIndex).mockResolvedValue(ok(anIndex()));
});

describe("TripContent", () => {
  it("sets the trip name in the display cut", async () => {
    render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("display");
  });

  it("renders the trip's date range in mono", async () => {
    render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    // The current markup joins both dates into one text node ("start – end"),
    // so a text match on the start date finds the whole range.
    const dates = screen.getByText(/2026-03-28/);
    expect(dates).toHaveClass("data-lg");
  });
});

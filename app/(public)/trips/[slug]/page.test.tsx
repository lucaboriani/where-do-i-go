// @vitest-environment jsdom
/**
 * Phase 7 task 4: TripContent owns the timeline column and footer; the
 * masthead moved to the `@masthead` slot — see its own page.test.tsx.
 * Calls exported `TripContent` directly, not `<TripPage>` — see page.tsx.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrip, getTripIndex, publishedTripSlugs } from "@/lib/pod/cached";
import { ok } from "@/lib/pod/result";
import type { IndexEntry, Trip, TripIndex } from "@/lib/pod/schema";
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

const anEntry = (over: Partial<IndexEntry> = {}): IndexEntry => ({
  iri: "https://pod.example/travel/trips/2026-japan/entries.ttl#e1",
  entryResource: "https://pod.example/travel/trips/2026-japan/e1.ttl",
  title: { value: "First night in Shinjuku", language: "en" },
  slug: "shinjuku",
  sortOrder: 1,
  ...over,
});

const anIndex = (over: Partial<TripIndex> = {}): TripIndex => ({
  iri: "https://pod.example/travel/trips/2026-japan/entries.ttl",
  schemaVersion: 2,
  entries: [anEntry()],
  ...over,
});

beforeEach(() => {
  vi.mocked(publishedTripSlugs).mockResolvedValue(ok([SLUG]));
  vi.mocked(getTrip).mockResolvedValue(ok(aTrip()));
  vi.mocked(getTripIndex).mockResolvedValue(ok(anIndex()));
});

describe("TripContent", () => {
  it("no longer renders the trip name — it moved to the @masthead slot", async () => {
    render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("still renders the timeline", async () => {
    render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    expect(screen.getByRole("link", { name: "First night in Shinjuku" })).toBeInTheDocument();
  });

  it("renders the site footer at the end of the column", async () => {
    render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    expect(screen.getByRole("contentinfo")).toHaveClass("status-line");
  });
});

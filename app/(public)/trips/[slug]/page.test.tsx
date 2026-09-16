// @vitest-environment jsdom
/**
 * Phase 7 task 4 + final-review FIX 1: TripContent owns the timeline, the
 * footer, and a mobile-only trip title (the `@masthead` slot is hidden <48rem).
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
  it("renders a mobile-only trip title in the sheet, since the masthead is hidden <48rem", async () => {
    const { container } = render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).toHaveClass("display", "trip-title");
    expect(h1).toHaveTextContent("Japan, spring");
    // jsdom can't evaluate the <48rem media query; assert the wrapper class
    // that hides this copy at desktop instead.
    expect(container.querySelector(".trip-title-mobile")).toContainElement(h1);
  });

  it("does not leak a draft trip's title on mobile — it 404s before rendering", async () => {
    vi.mocked(getTrip).mockResolvedValue(ok(aTrip({ status: "draft" })));
    await expect(TripContent({ params: Promise.resolve({ slug: SLUG }) })).rejects.toThrow();
  });

  it("still renders the timeline", async () => {
    render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    expect(screen.getByRole("link", { name: "First night in Shinjuku" })).toBeInTheDocument();
  });

  it("renders the site footer at the end of the column, as a status line", async () => {
    // NOT getByRole("contentinfo"): in production this <footer> sits inside
    // <main>, so it maps to generic, not the landmark. Assert the element and
    // its tagline, which hold regardless of nesting.
    const { container } = render(await TripContent({ params: Promise.resolve({ slug: SLUG }) }));
    const footer = container.querySelector("footer.status-line");
    expect(footer).not.toBeNull();
    expect(footer).toHaveTextContent(/solid pod/i);
  });
});

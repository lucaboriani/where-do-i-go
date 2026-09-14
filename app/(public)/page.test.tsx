// @vitest-environment jsdom
/**
 * The diary page's shell path: it flushes before the Pod answers, the map pane
 * stays a sibling of the sheet, and one trip's failure never costs the diary
 * its list.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDiary, getTrip, getTripIndex, publishedTripSlugs } from "@/lib/pod/cached";
import { err, ok } from "@/lib/pod/result";
import type { TripPoint } from "@/lib/map/trips";
import type { Diary, Trip, TripIndex } from "@/lib/pod/schema";
import Home, { DiaryContent, DiaryGlobe } from "./page";

vi.mock("@/lib/pod/cached", () => ({
  getDiary: vi.fn(),
  publishedTripSlugs: vi.fn(),
  getTrip: vi.fn(),
  getTripIndex: vi.fn(),
}));

vi.mock("@/components/public/diary-map", () => ({
  default: () => <div data-testid="diary-map" />,
}));

vi.mock("@/components/public/trip-map", () => ({
  default: () => <div data-testid="trip-map" />,
  MAP_FRAME_CLASS: "size-full bg-surface",
}));

// null on `/`, which the provider's own test already records for a page segment.
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => null }));

// No `globals: true`, so RTL's auto-cleanup never registers itself.
afterEach(cleanup);

const POD = "https://pod.example/travel/";

const diary = (over: Partial<Diary> = {}): Diary => ({
  iri: `${POD}diary.ttl#it`,
  schemaVersion: 1,
  title: { value: "Where I go", language: "en" },
  trips: [],
  ...over,
});

const aTrip = (slug: string, over: Partial<Trip> = {}): Trip => ({
  iri: `${POD}trips/${slug}/trip.ttl#it`,
  slug,
  status: "published",
  schemaVersion: 1,
  name: { value: slug, language: "en" },
  tags: [],
  ...over,
});

const anIndex = (slug: string, over: Partial<TripIndex> = {}): TripIndex => ({
  iri: `${POD}trips/${slug}/entries.ttl`,
  schemaVersion: 1,
  entries: [],
  ...over,
});

const gone = (url: string) => err({ kind: "http" as const, url, status: 500 });

/** Never resolves: a page that awaited its own reads would hang on this, and
 *  the two shell cases are exactly the ones that must not. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

// Defaults every case narrows. An unset mock resolves to undefined, and the
// async children would then reject inside an already-committed render.
beforeEach(() => {
  vi.mocked(getDiary).mockResolvedValue(ok(diary()));
  vi.mocked(publishedTripSlugs).mockResolvedValue(ok([]));
  vi.mocked(getTrip).mockResolvedValue(gone(`${POD}trip.ttl`));
  vi.mocked(getTripIndex).mockResolvedValue(gone(`${POD}entries.ttl`));
});

describe("the diary page", () => {
  it("puts the map BESIDE the sheet, never inside it", () => {
    vi.mocked(getDiary).mockReturnValue(pending());
    vi.mocked(publishedTripSlugs).mockReturnValue(pending());

    const { container } = render(<Home />);
    const pane = container.querySelector(".trip-map-pane");
    const sheet = container.querySelector(".trip-sheet");

    expect(pane).not.toBeNull();
    expect(sheet).not.toBeNull();
    // If the pane is ever inside the sheet, a snap point acquires a code path
    // that can unmount the map. There is no other way to state this in a test.
    expect(sheet?.contains(pane as Node)).toBe(false);
  });

  it("reserves the map frame and the sheet's shape before the Pod answers", () => {
    vi.mocked(getDiary).mockReturnValue(pending());
    vi.mocked(publishedTripSlugs).mockReturnValue(pending());

    const { container } = render(<Home />);
    expect(container.querySelector(".trip-map-pane [aria-hidden]")).not.toBeNull();
    expect(container.querySelector(".trip-sheet .animate-pulse")).not.toBeNull();
  });

  it("keeps the shell when the diary cannot be read", async () => {
    vi.mocked(getDiary).mockResolvedValue(gone(`${POD}diary.ttl`));

    const { container } = render(await DiaryContent());

    // An unreachable diary still gets a map: throwing the surface away to show
    // one line of text is the worse failure.
    expect(container.textContent).toContain("unavailable");
  });

  it("says so when the diary has published nothing, rather than showing an empty list", async () => {
    const { container } = render(await DiaryContent());

    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).toContain("No trips published yet");
  });

  it("drops a trip that will not read and keeps one whose index will not", async () => {
    vi.mocked(publishedTripSlugs).mockResolvedValue(ok(["japan", "peru", "ghost"]));
    vi.mocked(getTrip).mockImplementation(async (slug) =>
      slug === "ghost" ? gone(`${POD}trips/ghost/trip.ttl`) : ok(aTrip(slug)),
    );
    vi.mocked(getTripIndex).mockImplementation(async (slug) =>
      slug === "peru"
        ? gone(`${POD}trips/peru/entries.ttl`)
        : ok(anIndex(slug, { center: { lat: 35.69, long: 139.7 } })),
    );

    render(await DiaryContent());
    expect(screen.getByRole("link", { name: "japan" })).toBeInTheDocument();
    // Losing one index must not lose the diary: the row stands, the marker goes.
    expect(screen.getByRole("link", { name: "peru" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ghost" })).toBeNull();

    const trips = (await DiaryGlobe()).props.trips as TripPoint[];
    expect(trips.map((trip) => [trip.slug, trip.center?.lat])).toEqual([
      ["japan", 35.69],
      ["peru", undefined],
    ]);
  });
});

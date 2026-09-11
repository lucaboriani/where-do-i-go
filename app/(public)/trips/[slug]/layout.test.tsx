// @vitest-environment jsdom
/**
 * The layout's shell path: the frame is reserved without awaiting params, and
 * the map sits above children rather than inside a page. ./notes.md#why-the-map-lives-in-the-layout
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok } from "@/lib/pod/result";
import type { IndexEntry } from "@/lib/pod/schema";
import Layout, { MapForTrip } from "./layout";
import { getTripIndex } from "@/lib/pod/cached";

vi.mock("@/components/public/trip-map", () => ({
  default: () => <div data-testid="trip-map" />,
  MAP_FRAME_CLASS: "h-96 w-full bg-surface",
}));

vi.mock("@/lib/pod/cached", () => ({
  getTripIndex: vi.fn(),
}));

const params = new Promise<{ slug: string }>(() => {
  // Never resolves: a layout that awaited this would hang, which is the point.
});

describe("the trip layout", () => {
  it("renders children immediately, without waiting on params", () => {
    render(<Layout params={params}>{<p>{"entry body"}</p>}</Layout>);
    expect(screen.getByText("entry body")).toBeInTheDocument();
  });

  it("reserves the map frame on the shell path, before the index has been read", () => {
    const { container } = render(<Layout params={params}>{null}</Layout>);
    expect(container.querySelector(".h-96")).not.toBeNull();
  });

  it("passes the index's entries to TripMap on the resolved path", async () => {
    const entries: IndexEntry[] = [
      {
        iri: "https://pod.example/travel/trips/t/entries.ttl#e1",
        entryResource: "https://pod.example/travel/trips/t/e1.ttl",
        title: { value: "Arrival", language: "en" },
        slug: "arrival",
        sortOrder: 1,
      },
    ];
    vi.mocked(getTripIndex).mockResolvedValue(
      ok({ iri: "https://pod.example/travel/trips/t/entries.ttl", schemaVersion: 1, entries }),
    );

    // Calling the async component directly, not through <MapForTrip />: React's
    // client renderer rejects async function components outright.
    const element = await MapForTrip({ params: Promise.resolve({ slug: "t" }) });
    expect(element.props.entries).toBe(entries);
  });
});

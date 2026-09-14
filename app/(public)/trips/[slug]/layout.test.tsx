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

// The constant is NOT mocked: it lives in lib/map/frame.ts precisely so a
// server page can reach it without this client module. ../../../../lib/map/notes.md#the-frame-class-is-not-in-a-client-module
vi.mock("@/components/public/trip-map", () => ({
  default: () => <div data-testid="trip-map" />,
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
    expect(container.querySelector(".trip-map-pane [aria-hidden]")).not.toBeNull();
  });

  it("puts the map BESIDE the sheet, never inside it — the never-remounted invariant as a shape", () => {
    const { container } = render(<Layout params={params}>{<p>{"entry body"}</p>}</Layout>);
    const pane = container.querySelector(".trip-map-pane");
    const sheet = container.querySelector(".trip-sheet");

    expect(pane).not.toBeNull();
    expect(sheet).not.toBeNull();
    // If the pane is ever inside the sheet, a snap point acquires a code path
    // that can unmount the map. There is no other way to state this in a test.
    expect(sheet?.contains(pane as Node)).toBe(false);
    expect(sheet?.textContent).toContain("entry body");
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

    // Not <MapForTrip /> — see layout.tsx's own comment on the export.
    const element = await MapForTrip({ params: Promise.resolve({ slug: "t" }) });
    expect(element.props.entries).toBe(entries);
  });
});

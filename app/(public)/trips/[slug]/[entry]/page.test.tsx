// @vitest-environment jsdom
/**
 * The sectioned render: masthead, mono meta row, section prose, in order.
 * Calls the exported async `EntryContent` directly, never `<EntryPage>` —
 * see page.tsx's own comment on the export.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { allEntryParams, getEntry } from "@/lib/pod/cached";
import { ok } from "@/lib/pod/result";
import type { Entry, Section } from "@/lib/pod/schema";
import { EntryContent } from "./page";

vi.mock("@/lib/pod/cached", () => ({
  getEntry: vi.fn(),
  allEntryParams: vi.fn(),
}));

// No `globals: true`, so RTL's auto-cleanup never registers itself.
afterEach(cleanup);

const PARAMS = { slug: "patagonia", entry: "under-fitz-roy" };

const anEntry = (over: Partial<Entry> = {}): Entry => ({
  iri: "https://pod.example/travel/trips/patagonia/entries/under-fitz-roy.ttl#it",
  slug: PARAMS.entry,
  status: "published",
  schemaVersion: 2,
  headline: { value: "Under Fitz Roy", language: "en" },
  sections: [],
  tags: [],
  ...over,
});

const twoSections: Section[] = [
  { sortOrder: 1, text: { value: "the lead", language: "en" }, photos: [] },
  { sortOrder: 2, text: { value: "second", language: "en" }, photos: [] },
];

/** Wires the two cached reads EntryContent makes and calls it directly,
 *  awaiting the returned element before RTL renders it (see file docblock). */
async function renderEntry(over: Partial<Entry> = {}) {
  vi.mocked(getEntry).mockResolvedValue(ok(anEntry(over)));
  vi.mocked(allEntryParams).mockResolvedValue([PARAMS]);
  return render(await EntryContent({ params: Promise.resolve(PARAMS) }));
}

describe("EntryContent", () => {
  it("sets the headline in the display cut", async () => {
    await renderEntry();
    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("display");
  });

  it("renders the arrival time in mono", async () => {
    const { container } = await renderEntry({ occurredAt: "2025-03-09T18:20:00-03:00" });
    // NOT a text match on the formatted date: the meta row is free to split
    // date/time/offset across nodes. The <time datetime> element is the one
    // stable anchor regardless of how its text is broken up.
    const time = container.querySelector("time[datetime]");
    expect(time).not.toBeNull();
    expect(time).toHaveClass("data");
  });

  it("marks a fuzzed coordinate as a soft circle, not exact", async () => {
    const { container } = await renderEntry({
      place: {
        name: { value: "El Chaltén", language: "en" },
        geo: { lat: -49.33, long: -72.89, precisionMeters: 500 },
      },
    });
    const el = container.querySelector(".precision");
    expect(el).not.toBeNull();
    expect(el).not.toHaveClass("exact");
  });

  it("renders each section's text as prose, in order, with no stray articleBody text", async () => {
    await renderEntry({ sections: twoSections });
    const proses = screen.getAllByText(/the lead|second/);
    expect(proses.map((p) => p.textContent)).toEqual(["the lead", "second"]);
    // articleBody no longer exists on Entry at all (Stage 3b removed it);
    // nothing should stringify an undefined value in its place.
    expect(screen.queryByText("undefined")).toBeNull();
  });

  it("renders the site footer as a contentinfo landmark", async () => {
    await renderEntry();
    expect(screen.getByRole("contentinfo")).toHaveClass("status-line");
  });
});

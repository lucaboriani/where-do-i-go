// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TripList from "./trip-list";

// No `globals: true`, so RTL's auto-cleanup never registers itself; without
// this, renders stack up in document.body across cases.
afterEach(cleanup);

describe("TripList", () => {
  it("links each trip by slug and shows its name", () => {
    render(<TripList trips={[{ slug: "2026-japan", name: "Japan, spring" }]} />);

    const link = screen.getByRole("link", { name: "Japan, spring" });
    expect(link.getAttribute("href")).toBe("/trips/2026-japan");
  });

  it("renders the dates when they are there and nothing when they are not", () => {
    const { rerender, container } = render(
      <TripList trips={[{ slug: "a", name: "A", startDate: "2026-03-29", endDate: "2026-04-12" }]} />,
    );
    expect(screen.getByText(/2026-03-29/)).toBeTruthy();

    rerender(<TripList trips={[{ slug: "a", name: "A" }]} />);
    // The whole row is the link: no empty date element left behind.
    expect(container.querySelector("li")?.children).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EntrySection } from "./entry-section";

afterEach(cleanup);

const photo = (over = {}) => ({
  contentUrl: "https://pod/m/a/web.webp",
  width: 1600,
  height: 1067,
  caption: { value: "the massif from the road", language: "en" },
  ...over,
});

describe("EntrySection", () => {
  it("renders the section's text as prose", () => {
    const { container } = render(
      <EntrySection section={{ sortOrder: 1, text: { value: "a paragraph", language: "en" }, photos: [] }} />,
    );
    const prose = container.querySelector(".prose");
    expect(prose).not.toBeNull();
    expect(screen.getByText("a paragraph")).toBeInTheDocument();
    expect(prose?.contains(screen.getByText("a paragraph"))).toBe(true);
  });

  it("renders a one-photo section as a figure with a mono caption", () => {
    // jsdom gives <figure> no implicit ARIA role, so getByRole("figure") is
    // not usable here — query the DOM directly, per the task brief.
    const { container } = render(<EntrySection section={{ sortOrder: 1, photos: [photo()] }} />);
    const fig = container.querySelector("figure");
    expect(fig).not.toBeNull();
    expect(fig?.querySelector("img")).not.toBeNull();
    expect(screen.getByText("the massif from the road")).toHaveClass("caption");
    expect(fig?.querySelector(".pair")).toBeNull();
  });

  it("renders a two-photo section as a pair", () => {
    const { container } = render(
      <EntrySection
        section={{
          sortOrder: 1,
          photos: [photo(), photo({ contentUrl: "https://pod/m/b/web.webp" })],
        }}
      />,
    );
    const fig = container.querySelector("figure");
    expect(fig?.querySelector(".pair")).not.toBeNull();
    expect(container.querySelectorAll(".pair img")).toHaveLength(2);
  });

  it("gives the image an alt from its caption", () => {
    const { container } = render(<EntrySection section={{ sortOrder: 1, photos: [photo()] }} />);
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("alt", "the massif from the road");
  });
});

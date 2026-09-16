// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EntrySection } from "./entry-section";

afterEach(cleanup);

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
});

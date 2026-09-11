// @vitest-environment jsdom
/**
 * The layout's shell path: the frame is reserved without awaiting params, and
 * the map sits above children rather than inside a page. ./notes.md#why-the-map-lives-in-the-layout
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Layout from "./layout";

vi.mock("@/components/public/trip-map", () => ({
  default: () => <div data-testid="trip-map" />,
  MAP_FRAME_CLASS: "h-96 w-full bg-surface",
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
});

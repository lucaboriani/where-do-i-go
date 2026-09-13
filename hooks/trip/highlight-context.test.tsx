// @vitest-environment jsdom
/**
 * The inert default, which every component rendered outside a provider gets.
 * ./notes.md#why-the-context-has-an-inert-default
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTripHighlight } from "./highlight-context";

afterEach(cleanup);

function Probe() {
  const { activeSlug, source, raise, clear } = useTripHighlight();
  return (
    <button
      type="button"
      onClick={() => {
        raise("kyoto", "timeline");
        clear();
      }}
    >
      {`${activeSlug ?? "-"}:${source ?? "-"}`}
    </button>
  );
}

describe("useTripHighlight with no provider above it", () => {
  it("returns an inert highlight rather than throwing", () => {
    render(<Probe />);
    expect(screen.getByRole("button")).toHaveTextContent("-:-");
  });

  it("takes raise and clear as no-ops, which is what a standalone entry page relies on", () => {
    render(<Probe />);
    expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();
    expect(screen.getByRole("button")).toHaveTextContent("-:-");
  });
});

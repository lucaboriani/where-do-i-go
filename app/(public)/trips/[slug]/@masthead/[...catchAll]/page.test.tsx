// @vitest-environment jsdom
/**
 * Matches every route deeper than the trip index (the entry route,
 * chiefly), on soft nav too — unlike default.tsx, hard-reload only.
 * Must render nothing, same as default.tsx.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import CatchAll from "./page";

afterEach(cleanup);

describe("the @masthead slot's catch-all", () => {
  it("renders nothing", () => {
    const { container } = render(<CatchAll />);
    expect(container).toBeEmptyDOMElement();
  });
});

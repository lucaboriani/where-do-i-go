// @vitest-environment jsdom
/**
 * The @masthead slot's default: routes under [slug] with no matching page
 * in this slot fall back here (a slot always needs one, so a future
 * sibling route never inherits a stale masthead); it must render nothing.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Default from "./default";

afterEach(cleanup);

describe("the @masthead slot's default", () => {
  it("renders nothing", () => {
    const { container } = render(<Default />);
    expect(container).toBeEmptyDOMElement();
  });
});

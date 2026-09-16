// @vitest-environment jsdom
/**
 * The @masthead slot's default: any route under [slug] that has no matching
 * page in this parallel slot (there is only one today, but a slot ALWAYS
 * needs a default so a future sibling route does not inherit a stale trip
 * masthead) falls back to this file, which must render nothing.
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

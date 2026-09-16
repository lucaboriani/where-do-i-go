// @vitest-environment jsdom
/**
 * The @masthead slot on the entry route: nothing. This explicit [entry]
 * segment mirrors the real [slug]/[entry] route so a soft nav nulls the
 * slot (a [...catchAll] does not resolve on soft nav); it must render nothing.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import EntryMasthead from "./page";

afterEach(cleanup);

describe("the @masthead slot's [entry] segment", () => {
  it("renders nothing", () => {
    const { container } = render(<EntryMasthead />);
    expect(container).toBeEmptyDOMElement();
  });
});

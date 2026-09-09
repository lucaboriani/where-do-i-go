// @vitest-environment jsdom
/**
 * The when group alone: two controls and the three notes that say where their
 * values came from. What each case bites: ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import WhenFields from "./when-fields";
import type { WhenFieldsProps } from "./when-fields";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

const CLOCK = "When it happened";
const OFFSET = "UTC offset";
const HINT =
  "Kept with the offset of the place it happened in, so it always reads as that time of day.";

function props(over: Partial<WhenFieldsProps> = {}): WhenFieldsProps {
  return {
    occurred: "",
    onOccurredChange: vi.fn(),
    occurredSource: null,
    offset: "+00:00",
    onOffsetChange: vi.fn(),
    offsetOptions: ["+00:00", "+02:00", "+09:00"],
    offsetGuess: false,
    offsetSource: null,
    ...over,
  };
}

/** The harness's idea, four lines: resolve every IDREF and prove it exists
 *  BEFORE reading text, or a dangling association reads as "no note". */
function describedTextOf(el: Element): string {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");
  for (const id of ids)
    expect(document.getElementById(id), `nothing renders "${id}"`).not.toBeNull();
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The ids in the order the control names them, which is what the notes' own
 *  docblock argues about — the hint first, then whatever is currently true. */
const describedIdsOf = (el: Element) =>
  (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");

describe("the when group renders the timestamp's two halves", () => {
  it("names both controls and holds the values it was given", () => {
    render(<WhenFields {...props({ occurred: "2026-03-29T21:40", offset: "+09:00" })} />);

    const clock = screen.getByLabelText(CLOCK) as HTMLInputElement;
    expect(clock.type).toBe("datetime-local");
    expect(clock.value).toBe("2026-03-29T21:40");
    const offset = screen.getByLabelText(OFFSET) as HTMLSelectElement;
    expect(offset.tagName).toBe("SELECT");
    expect(offset.value).toBe("+09:00");
  });

  it("offers the offsets it was given, as written, in that order", () => {
    // The value IS the string concatenated onto the wall clock, and the text is
    // the same string: a list of place names would be a second thing to keep true.
    render(<WhenFields {...props()} />);

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "+00:00",
      "+02:00",
      "+09:00",
    ]);
    expect(screen.getAllByRole("option").map((o) => (o as HTMLOptionElement).value)).toEqual([
      "+00:00",
      "+02:00",
      "+09:00",
    ]);
  });

  it("reports each half to its own callback, and tells the other nothing", () => {
    const wired = props();
    render(<WhenFields {...wired} />);

    fireEvent.change(screen.getByLabelText(CLOCK), { target: { value: "2026-03-29T21:40" } });
    expect(wired.onOccurredChange).toHaveBeenCalledWith("2026-03-29T21:40");
    expect(wired.onOffsetChange).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(OFFSET), { target: { value: "+09:00" } });
    expect(wired.onOffsetChange).toHaveBeenCalledWith("+09:00");
    expect(wired.onOccurredChange).toHaveBeenCalledTimes(1);
  });
});

describe("the when group says where a value came from, while that is true", () => {
  it("credits the photo for the clock, and the clock announces the credit", () => {
    render(<WhenFields {...props({ occurredSource: "a.jpg" })} />);

    expect(describedTextOf(screen.getByLabelText(CLOCK))).toBe(
      `${HINT} The time came from a.jpg. Type in the box to replace it.`,
    );
  });

  it("renders no clock note at all when nobody is credited", () => {
    // Rendered exactly when something points at it: an id naming an element
    // that is not there computes to "", silently, and the credit vanishes.
    render(<WhenFields {...props()} />);

    expect(document.getElementById("entry-when-source")).toBeNull();
    expect(describedIdsOf(screen.getByLabelText(CLOCK))).toEqual(["entry-when-hint"]);
  });

  it("credits the photo for the offset, in the offset's own wording", () => {
    render(<WhenFields {...props({ offsetSource: "a.jpg" })} />);

    expect(document.getElementById("entry-offset-source")?.textContent).toBe(
      "The offset came from a.jpg. Choose another to replace it.",
    );
    expect(describedIdsOf(screen.getByLabelText(OFFSET))).toEqual([
      "entry-offset-hint",
      "entry-offset-source",
    ]);
  });
});

describe("the when group marks an offset nobody has confirmed", () => {
  it("carries the mark on the control that holds the value in doubt", () => {
    render(<WhenFields {...props({ offsetGuess: true })} />);

    expect(screen.getByLabelText(OFFSET)).toHaveAttribute("data-offset-unconfirmed", "true");
  });

  it("leaves the attribute off entirely when the offset is not a guess", () => {
    // `undefined`, not "false": an attribute left on permanently reads as
    // correct markup and answers a question nobody asked.
    render(<WhenFields {...props()} />);

    expect(screen.getByLabelText(OFFSET)).not.toHaveAttribute("data-offset-unconfirmed");
    expect(document.getElementById("entry-offset-guess")).toBeNull();
  });

  it("names the photo in the warning while the clock still credits it", () => {
    render(<WhenFields {...props({ offsetGuess: true, occurredSource: "a.jpg" })} />);

    expect(document.getElementById("entry-offset-guess")?.textContent).toBe(
      "The offset is not from a.jpg — the photo carries no time zone of its own, so this is " +
        "this machine's guess. Choose the offset of the place it happened in.",
    );
  });

  it("keeps the warning and loses the name once the clock is the owner's", () => {
    // Ruling T4-G: a keystroke in the clock says nothing about who supplied the
    // offset, so the warning is still true after one and stays.
    render(<WhenFields {...props({ offsetGuess: true, occurredSource: null })} />);

    expect(document.getElementById("entry-offset-guess")?.textContent).toBe(
      "The offset is this machine's guess for the time above, not the time zone of the place " +
        "it happened in. Choose that offset if it was somewhere else.",
    );
  });

  it("lists the hint first, then the warning, then the credit", () => {
    // Both are listed rather than branched, because the exclusion lives in
    // `creditTime` and a second copy here is a second thing to keep true.
    render(<WhenFields {...props({ offsetGuess: true, offsetSource: "a.jpg" })} />);

    expect(describedIdsOf(screen.getByLabelText(OFFSET))).toEqual([
      "entry-offset-hint",
      "entry-offset-guess",
      "entry-offset-source",
    ]);
  });
});

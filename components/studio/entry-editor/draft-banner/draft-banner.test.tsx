// @vitest-environment jsdom
/**
 * The unsaved-draft banner alone: how it names itself, the stamp it shows, and
 * the two answers it offers. What each case bites: ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DraftBanner, { HOLD_REASON_ID } from "./draft-banner";
import type { DraftBannerProps } from "./draft-banner";
import type { Draft } from "@/lib/studio/drafts";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

/** A stored draft with every field the schema requires. Only `savedAt` is read
 *  by this component; the rest are here because `Draft` demands them. */
function draft(over: Partial<Draft> = {}): Draft {
  return {
    tripIri: "https://pod.example/travel/trips/kyoto.ttl#it",
    slug: "arrival",
    headline: "Arrival",
    story: "",
    occurred: "2026-04-02T19:00",
    offset: "+09:00",
    tagsText: "",
    mode: "",
    status: "draft",
    lat: "",
    long: "",
    precision: "1000",
    placeName: "",
    locality: "",
    country: "",
    photos: [],
    savedAt: "2026-04-02T19:00:00+09:00",
    ...over,
  };
}

function props(over: Partial<DraftBannerProps> = {}): DraftBannerProps {
  return {
    offered: draft(),
    onRestore: vi.fn(),
    onDiscard: vi.fn(),
    ...over,
  };
}

const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the draft banner names itself so it can be found, and not so it shadows a control", () => {
  it("is a region named by title, and that name is absent from the label query", () => {
    render(<DraftBanner {...props()} />);

    const region = screen.getByRole("region", { name: "Unsaved draft" });
    // `role` is explicit: a bare `<section>` named only by `title` is not given
    // the region role, so it would be unfindable as the landmark it is.
    expect(region.tagName).toBe("SECTION");
    expect(region.getAttribute("title")).toBe("Unsaved draft");
    // The measured half: every ARIA naming mechanism lands in `getByLabelText`
    // on ANY element, and the editor's Status select already answers to these
    // words. `title` does not, which is why it is the one used.
    expect(region.getAttribute("aria-label")).toBeNull();
    expect(region.getAttribute("aria-labelledby")).toBeNull();
    expect(screen.queryAllByLabelText("Unsaved draft")).toHaveLength(0);
  });
});

describe("the draft banner shows the moment it was stamped", () => {
  it("renders the wall clock as it was stamped, never shifted, beside the full instant", () => {
    const { container } = render(
      <DraftBanner {...props({ offered: draft({ savedAt: "2026-04-02T19:00:00+09:00" }) })} />,
    );

    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.textContent).toBe("2026-04-02 at 19:00");
    // Offset and all: the machine-readable instant is what the offset
    // requirement on `savedAt` exists for.
    expect(time?.getAttribute("dateTime")).toBe("2026-04-02T19:00:00+09:00");
    expect(textOf(screen.getByRole("region", { name: "Unsaved draft" }))).toContain(
      "This browser kept what you were writing here, from 2026-04-02 at 19:00.",
    );
  });

  it("still appears when the stamp is absent, with the whole clause gone and the sentence whole", () => {
    // Ruling 2.5-A. A payload written by another build or hand-edited in
    // devtools has no `savedAt`, and must not crash the banner that offers it.
    const bare = draft();
    delete (bare as { savedAt?: string }).savedAt;

    const { container } = render(<DraftBanner {...props({ offered: bare })} />);

    const region = screen.getByRole("region", { name: "Unsaved draft" });
    expect(container.querySelector("time")).toBeNull();
    expect(textOf(region)).toContain(
      "This browser kept what you were writing here. Nothing on this form has been changed.",
    );
    // Not a comma trailing into nothing, which is what conditioning only the
    // `<time>` tag would leave behind.
    expect(textOf(region)).not.toContain("here,");
  });
});

describe("the draft banner says why the form below is held", () => {
  it("carries the hold sentence on the exported id, so both ends of the association agree", () => {
    render(<DraftBanner {...props()} />);

    const said = document.getElementById(HOLD_REASON_ID);
    expect(said, `nothing renders "${HOLD_REASON_ID}"`).not.toBeNull();
    // An `aria-describedby` naming an id nothing renders computes to the empty
    // string, silently. The Save button spends this same export.
    expect(textOf(said as Element)).toBe(
      "Restore it or discard it to carry on: while it is waiting, the form below is held and " +
        "cannot be saved, so that one storage slot is not written by two hands.",
    );
  });
});

describe("the draft banner offers two answers, and reports each to its own callback", () => {
  it("reports a restore, and tells the discard nothing", () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(<DraftBanner {...props({ onRestore, onDiscard })} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("reports a discard, and tells the restore nothing", () => {
    const onRestore = vi.fn();
    const onDiscard = vi.fn();
    render(<DraftBanner {...props({ onRestore, onDiscard })} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("offers neither answer as a submit, so neither can save the form it is holding", () => {
    render(<DraftBanner {...props()} />);

    for (const name of ["Restore", "Discard"])
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).type).toBe("button");
  });
});

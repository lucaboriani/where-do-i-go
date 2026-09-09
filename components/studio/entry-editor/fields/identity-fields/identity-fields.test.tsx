// @vitest-environment jsdom
/**
 * The identity group alone, against its props rather than through the editor's
 * sixteen controls. What each case bites: ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import IdentityFields from "./identity-fields";
import type { IdentityFieldsProps } from "./identity-fields";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

const POD = "https://me.solidcommunity.net";
const trip = (slug: string, name: string, status?: "draft" | "published") => ({
  iri: `${POD}/travel/trips/${slug}/trip.ttl#it`,
  slug,
  name,
  indexUrl: `${POD}/travel/trips/${slug}/entries.ttl`,
  entriesContainer: `${POD}/travel/trips/${slug}/entries/`,
  status,
});
const JAPAN = trip("2026-japan", "Japan, spring 2026");
const PERU = trip("2027-peru", "Peru, 2027", "draft");

/** Every callback a spy, so a case asserting one field can assert the silence
 *  of the other three — a group wired to the wrong setter passes otherwise. */
function props(over: Partial<IdentityFieldsProps> = {}): IdentityFieldsProps {
  return {
    trips: [JAPAN, PERU],
    tripIri: "",
    onTripChange: vi.fn(),
    addressFixed: false,
    slug: "",
    onSlugChange: vi.fn(),
    headline: "",
    onHeadlineChange: vi.fn(),
    story: "",
    onStoryChange: vi.fn(),
    ...over,
  };
}

/** The harness's idea, four lines: resolve every IDREF and prove it exists
 *  BEFORE reading text, or a dangling association reads as "no hint". */
function describedTextOf(el: Element): string {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");
  for (const id of ids)
    expect(document.getElementById(id), `nothing renders "${id}"`).not.toBeNull();
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
}

describe("the identity group renders the four controls that name an entry", () => {
  it("names each one, and the label query resolves to the control itself", () => {
    render(
      <IdentityFields
        {...props({ tripIri: PERU.iri, slug: "arrival", headline: "Arrival", story: "It rained." })}
      />,
    );

    const trip = screen.getByLabelText("Trip") as HTMLSelectElement;
    expect(trip.tagName).toBe("SELECT");
    expect(trip.value).toBe(PERU.iri);
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe("arrival");
    expect((screen.getByLabelText("Headline") as HTMLInputElement).value).toBe("Arrival");
    const story = screen.getByLabelText("Story") as HTMLTextAreaElement;
    expect(story.tagName).toBe("TEXTAREA");
    expect(story.value).toBe("It rained.");
  });

  it("offers 'Choose a trip' plus one option per trip, in the order given", () => {
    render(<IdentityFields {...props()} />);

    expect(
      screen.getAllByRole("option").map((option) => option.textContent),
    ).toEqual(["Choose a trip", "Japan, spring 2026", "Peru, 2027 (draft)"]);
  });

  it("marks a draft trip in the option's own text, which is the only channel", () => {
    // An <option> carries no styling a screen reader announces and none a
    // colour-blind reader can rely on, so the marker has to be in the name.
    render(<IdentityFields {...props()} />);

    expect(screen.getByRole("option", { name: "Peru, 2027 (draft)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Japan, spring 2026" })).toBeInTheDocument();
  });
});

describe("the identity group reports every edit to the callback for that field", () => {
  it("reports the chosen trip by iri, and tells no other field", () => {
    const wired = props();
    render(<IdentityFields {...wired} />);

    fireEvent.change(screen.getByLabelText("Trip"), { target: { value: PERU.iri } });

    expect(wired.onTripChange).toHaveBeenCalledWith(PERU.iri);
    expect(wired.onSlugChange).not.toHaveBeenCalled();
    expect(wired.onHeadlineChange).not.toHaveBeenCalled();
    expect(wired.onStoryChange).not.toHaveBeenCalled();
  });

  it("reports the slug, the headline and the story each to their own callback", () => {
    const wired = props();
    render(<IdentityFields {...wired} />);

    fireEvent.change(screen.getByLabelText("Slug"), { target: { value: "2026-03-29-arrival" } });
    fireEvent.change(screen.getByLabelText("Headline"), { target: { value: "Arrival" } });
    fireEvent.change(screen.getByLabelText("Story"), { target: { value: "It rained." } });

    expect(wired.onSlugChange).toHaveBeenCalledWith("2026-03-29-arrival");
    expect(wired.onHeadlineChange).toHaveBeenCalledWith("Arrival");
    expect(wired.onStoryChange).toHaveBeenCalledWith("It rained.");
    expect(wired.onTripChange).not.toHaveBeenCalled();
  });
});

describe("the identity group holds the address once it is fixed", () => {
  it("holds the trip and the slug, and leaves the headline and the story live", () => {
    // §10: the entry's URL is built from the trip and the slug, so an edit may
    // not move it. The other two are prose and stay editable for ever.
    render(<IdentityFields {...props({ addressFixed: true })} />);

    expect(screen.getByLabelText("Trip")).toBeDisabled();
    expect(screen.getByLabelText("Slug")).toBeDisabled();
    expect(screen.getByLabelText("Headline")).not.toBeDisabled();
    expect(screen.getByLabelText("Story")).not.toBeDisabled();
  });

  it("leaves all four live on a create", () => {
    render(<IdentityFields {...props()} />);

    for (const label of ["Trip", "Slug", "Headline", "Story"])
      expect(screen.getByLabelText(label)).not.toBeDisabled();
  });
});

describe("the identity group's one hint is reachable", () => {
  it("says the slug becomes the address and is fixed once saved", () => {
    render(<IdentityFields {...props()} />);

    expect(describedTextOf(screen.getByLabelText("Slug"))).toBe(
      "Becomes the entry's address, and is fixed once it is saved.",
    );
  });

  it("gives the other three no description at all", () => {
    render(<IdentityFields {...props()} />);

    for (const label of ["Trip", "Headline", "Story"])
      expect(screen.getByLabelText(label)).not.toHaveAttribute("aria-describedby");
  });
});

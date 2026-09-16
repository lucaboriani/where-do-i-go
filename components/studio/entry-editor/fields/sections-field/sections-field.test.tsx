// @vitest-environment jsdom

/**
 * The section list alone, against its props rather than through the editor's
 * reducer: an ordered list of section cards, each with its own text control,
 * its own photo picker + slot rows, and remove / move-up / move-down; plus one
 * "Add section" control for the list. ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import SectionsField from "./sections-field";
import type { SectionsFieldProps } from "./sections-field";
import type { SectionDraft } from "../../state/actions";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

const MEDIA = "https://me.solidcommunity.net/travel/media";

/** Two sections, one with a ready photo — so "scoped to that section's slots"
 *  has something to fail on: a slot rendered under the wrong card, or under
 *  both, both pass a test that never puts a photo anywhere. */
const TWO_SECTIONS: SectionDraft[] = [
  { id: "s-morning", text: "Morning in Kyoto", slots: [] },
  {
    id: "s-afternoon",
    text: "Afternoon in Nara",
    slots: [
      {
        key: "k-deer",
        name: "deer.jpg",
        state: "ready",
        photo: { contentUrl: `${MEDIA}/abc/web.webp`, thumbnailUrl: `${MEDIA}/abc/thumb.webp` },
      },
    ],
  },
];

function props(over: Partial<SectionsFieldProps> = {}): SectionsFieldProps {
  return {
    sections: TWO_SECTIONS,
    onTextChange: vi.fn(),
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    onPicked: vi.fn(),
    ...over,
  };
}

/**
 * One card per section, found by its own accessible group name — "Section 1",
 * "Section 2" — rather than by a test id: the group itself is a real a11y
 * grouping of the controls a screen reader should hear as belonging together,
 * exactly as `<Field>`'s `<label>` is for one control.
 */
function sectionCard(n: 1 | 2): HTMLElement {
  return screen.getByRole("group", { name: `Section ${n}` });
}

describe("the section list renders one card per section, each independently addressable", () => {
  it("gives each section its own text control, with a unique id, showing that section's text", () => {
    render(<SectionsField {...props()} />);

    const first = within(sectionCard(1)).getByLabelText(/story/i);
    const second = within(sectionCard(2)).getByLabelText(/story/i);

    expect((first as HTMLTextAreaElement).value).toBe("Morning in Kyoto");
    expect((second as HTMLTextAreaElement).value).toBe("Afternoon in Nara");

    // THE COLLISION THIS PINS: the single-section editor hardcoded
    // `entry-section-0-text`; a second card reusing that id is two elements a
    // `<label htmlFor>` cannot tell apart, and `getByLabelText` above would
    // already have failed with "multiple elements" before this assertion ran.
    expect(first.id).toBe("entry-section-0-text");
    expect(second.id).toBe("entry-section-1-text");
    expect(first.id).not.toBe(second.id);
  });

  it("reports an edit to onTextChange with that section's id, not the other one's", () => {
    const wired = props();
    render(<SectionsField {...wired} />);

    fireEvent.change(within(sectionCard(2)).getByLabelText(/story/i), {
      target: { value: "Afternoon in Nara, revised" },
    });

    expect(wired.onTextChange).toHaveBeenCalledWith("s-afternoon", "Afternoon in Nara, revised");
    expect(wired.onTextChange).not.toHaveBeenCalledWith("s-morning", expect.anything());
  });

  it("gives each section its own photo picker, with slot rows scoped to that section's slots", () => {
    render(<SectionsField {...props()} />);

    const morning = within(sectionCard(1));
    const afternoon = within(sectionCard(2));

    // Both cards have a picker, and the two do not collide on `getByLabelText`.
    expect(morning.getByLabelText(/photos/i)).toBeInTheDocument();
    expect(afternoon.getByLabelText(/photos/i)).toBeInTheDocument();
    expect(morning.getByLabelText(/photos/i).id).not.toBe(afternoon.getByLabelText(/photos/i).id);

    // THE SCOPING ITSELF: the ready slot belongs to "Afternoon" and must render
    // there and nowhere else — a component that pooled every section's slots
    // under section 1 (today's single-section behaviour) fails this.
    expect(morning.queryByRole("img")).toBeNull();
    expect(morning.queryByText(/deer\.jpg/)).toBeNull();
    expect(afternoon.getByRole("img", { name: "deer.jpg" })).toHaveAttribute(
      "src",
      `${MEDIA}/abc/thumb.webp`,
    );
    expect(afternoon.getByText(/deer\.jpg is attached to this entry\./)).toBeInTheDocument();
  });

  it("calls onPicked with that section's id and the files picked into it", () => {
    const wired = props();
    render(<SectionsField {...wired} />);
    const file = new File([new Uint8Array([1, 2, 3])], "torii.jpg", { type: "image/jpeg" });

    fireEvent.change(within(sectionCard(1)).getByLabelText(/photos/i), {
      target: { files: [file] },
    });

    expect(wired.onPicked).toHaveBeenCalledWith("s-morning", [file]);
  });
});

describe("the section list disables a section's picker once it holds 2 photos", () => {
  // DISABLE, not hide, at the cap — the plan left it open.
  // ./notes.md#the-cap-refusal-is-disable-not-hide
  const ready = (key: string) => ({
    key,
    name: `${key}.jpg`,
    state: "ready" as const,
    photo: { contentUrl: `${MEDIA}/${key}/web.webp` },
  });

  it("disables the picker once a section already holds 2 photos", () => {
    const atCap: SectionDraft[] = [{ id: "s-full", text: "", slots: [ready("a"), ready("b")] }];
    render(<SectionsField {...props({ sections: atCap })} />);

    expect(within(sectionCard(1)).getByLabelText(/photos/i)).toBeDisabled();
  });

  it("keeps the picker enabled below the cap — the allow-case", () => {
    // Without this, a component that disabled every picker unconditionally
    // would pass the test above for the wrong reason.
    const oneReady: SectionDraft[] = [{ id: "s-partial", text: "", slots: [ready("a")] }];
    render(<SectionsField {...props({ sections: oneReady })} />);

    expect(within(sectionCard(1)).getByLabelText(/photos/i)).not.toBeDisabled();
  });

  it("does not count a FAILED pick toward the cap: a freed place stays enabled", () => {
    const oneFailed: SectionDraft[] = [
      {
        id: "s-mixed",
        text: "",
        slots: [ready("a"), { key: "b", name: "b.jpg", state: "failed", message: "too large" }],
      },
    ];
    render(<SectionsField {...props({ sections: oneFailed })} />);

    expect(within(sectionCard(1)).getByLabelText(/photos/i)).not.toBeDisabled();
  });
});

describe("the section list's add / remove / reorder controls", () => {
  it('an "Add section" control invokes onAdd', () => {
    const wired = props();
    render(<SectionsField {...wired} />);

    fireEvent.click(screen.getByRole("button", { name: /add section/i }));

    expect(wired.onAdd).toHaveBeenCalledTimes(1);
  });

  it("each section's Remove control invokes onRemove with that section's id", () => {
    const wired = props();
    render(<SectionsField {...wired} />);

    fireEvent.click(within(sectionCard(2)).getByRole("button", { name: /remove/i }));

    expect(wired.onRemove).toHaveBeenCalledWith("s-afternoon");
    expect(wired.onRemove).not.toHaveBeenCalledWith("s-morning");
  });

  it("each section's move controls invoke onMove with that section's id and direction", () => {
    const wired = props();
    render(<SectionsField {...wired} />);

    fireEvent.click(within(sectionCard(1)).getByRole("button", { name: /move.*down/i }));
    fireEvent.click(within(sectionCard(2)).getByRole("button", { name: /move.*up/i }));

    expect(wired.onMove).toHaveBeenCalledWith("s-morning", "down");
    expect(wired.onMove).toHaveBeenCalledWith("s-afternoon", "up");
  });

  it("disables the first section's move-up and the last section's move-down", () => {
    render(<SectionsField {...props()} />);

    expect(within(sectionCard(1)).getByRole("button", { name: /move.*up/i })).toBeDisabled();
    expect(within(sectionCard(2)).getByRole("button", { name: /move.*down/i })).toBeDisabled();

    // THE ALLOW-CASE: the two ends' OTHER direction stays live, so this is a
    // rule about position and not a blanket disable that would pass the two
    // assertions above for the wrong reason.
    expect(within(sectionCard(1)).getByRole("button", { name: /move.*down/i })).not.toBeDisabled();
    expect(within(sectionCard(2)).getByRole("button", { name: /move.*up/i })).not.toBeDisabled();
  });
});

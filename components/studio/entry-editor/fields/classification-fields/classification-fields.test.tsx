// @vitest-environment jsdom
/**
 * The classification group alone: tags, the leg that arrived, and the one
 * control §7.4's publication boundary follows from. ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ClassificationFields from "./classification-fields";
import type { ClassificationFieldsProps } from "./classification-fields";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

const LABEL = { tags: "Tags", mode: "Travel mode you arrived by", status: "Status" } as const;

function props(over: Partial<ClassificationFieldsProps> = {}): ClassificationFieldsProps {
  return {
    tagsText: "",
    onTagsTextChange: vi.fn(),
    mode: "",
    onModeChange: vi.fn(),
    status: "draft",
    onStatusChange: vi.fn(),
    ...over,
  };
}

describe("the classification group renders three controls", () => {
  it("names each one and holds the values it was given", () => {
    render(
      <ClassificationFields {...props({ tagsText: "kyoto, rain", mode: "Train", status: "published" })} />,
    );

    const tags = screen.getByLabelText(LABEL.tags) as HTMLInputElement;
    expect(tags.type).toBe("text");
    expect(tags.value).toBe("kyoto, rain");
    expect((screen.getByLabelText(LABEL.mode) as HTMLSelectElement).value).toBe("Train");
    expect((screen.getByLabelText(LABEL.status) as HTMLSelectElement).value).toBe("published");
  });

  it("says the tags are separated by commas, since `dy:tag` is a token", () => {
    render(<ClassificationFields {...props()} />);

    expect(screen.getByLabelText(LABEL.tags)).toHaveAttribute(
      "aria-describedby",
      "entry-tags-hint",
    );
    expect(document.getElementById("entry-tags-hint")?.textContent).toBe("Separated by commas.");
  });

  it("reports the tag text exactly as typed, splitting nothing", () => {
    // §3: `dy:tag` is a token, not prose, and the parse is the editor's — this
    // control carries the owner's own spacing until then.
    const wired = props();
    render(<ClassificationFields {...wired} />);

    fireEvent.change(screen.getByLabelText(LABEL.tags), { target: { value: "kyoto,  rain , " } });

    expect(wired.onTagsTextChange).toHaveBeenCalledWith("kyoto,  rain , ");
  });
});

describe("the classification group's travel mode", () => {
  it("offers 'Not recorded' first, then every mode the schema allows", () => {
    render(<ClassificationFields {...props()} />);

    const options = screen.getAllByLabelText(LABEL.mode)[0] as HTMLSelectElement;
    expect([...options.options].map((o) => o.textContent)).toEqual([
      "Not recorded",
      "Flight",
      "Train",
      "Bus",
      "Car",
      "Boat",
      "Bike",
      "Walk",
      "Other",
    ]);
  });

  it("reports a chosen mode as the parsed term", () => {
    const wired = props();
    render(<ClassificationFields {...wired} />);

    fireEvent.change(screen.getByLabelText(LABEL.mode), { target: { value: "Boat" } });

    expect(wired.onModeChange).toHaveBeenCalledWith("Boat");
  });

  it("reports 'Not recorded' as the empty string rather than refusing it", () => {
    // The one control whose failed parse has a value to fall back to: an owner
    // who chose a mode and changed their mind must be able to unset it.
    const wired = props({ mode: "Boat" });
    render(<ClassificationFields {...wired} />);

    fireEvent.change(screen.getByLabelText(LABEL.mode), { target: { value: "" } });

    expect(wired.onModeChange).toHaveBeenCalledWith("");
  });
});

describe("the classification group's status", () => {
  it("labels the two terms in words and carries them as the schema's values", () => {
    render(<ClassificationFields {...props()} />);

    const select = screen.getByLabelText(LABEL.status) as HTMLSelectElement;
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([
      ["draft", "Draft"],
      ["published", "Published"],
    ]);
  });

  it("reports a chosen status as the parsed term", () => {
    const wired = props();
    render(<ClassificationFields {...wired} />);

    fireEvent.change(screen.getByLabelText(LABEL.status), { target: { value: "published" } });

    expect(wired.onStatusChange).toHaveBeenCalledWith("published");
  });

  it("reports NOTHING for a value the schema refuses, unlike the mode above", () => {
    // A <select> whose value matches no option reads back as "", which
    // `Status.safeParse` refuses — and there is no empty status to fall back to,
    // so the guard drops it rather than unpublishing an entry.
    const wired = props({ status: "published" });
    render(<ClassificationFields {...wired} />);

    fireEvent.change(screen.getByLabelText(LABEL.status), { target: { value: "teleported" } });

    expect(wired.onStatusChange).not.toHaveBeenCalled();
  });
});

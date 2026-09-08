// @vitest-environment jsdom
/**
 * `<Field>` alone, which it has never been tested as, and which all five of
 * Stage B's field groups are about to consume. What is pinned, and the one case
 * that is about something NOT added: ./notes.md#what-this-test-pins
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import Field, { BUTTON, CONTROL } from "./field";

/** Manual: @testing-library/react registers auto-cleanup only when `afterEach`
 *  is a global, and this project runs vitest without `globals: true`. */
afterEach(cleanup);

/**
 * What a control announces, with every id it names proved to RESOLVE first — a
 * dangling IDREF computes to "" and the failure would otherwise read "no note".
 * The harness's `describedTextOf`, by element rather than by label, and not
 * imported from it: ./notes.md#why-not-import-the-harness
 */
function describedTextOf(el: Element): string {
  const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");
  for (const id of ids)
    expect(
      document.getElementById(id),
      `the control points aria-describedby at "${id}", which nothing renders`,
    ).not.toBeNull();
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("<Field> names its control", () => {
  it("associates the label with the control by id, so a label query finds the control", () => {
    render(
      <Field id="entry-headline" label="Headline">
        <input id="entry-headline" name="entry-headline" className={CONTROL} />
      </Field>,
    );

    const control = screen.getByLabelText("Headline");
    expect(control.tagName).toBe("INPUT");
    expect(control.id).toBe("entry-headline");
  });

  it("puts the name on the control alone: no wrapper answers to it", () => {
    // `getByLabelText` matches `aria-label` on ANY element, and the editor has
    // already lost tests to a wrapper that shadowed a real control — the reason
    // `entry-offset`'s docblock forbids one anywhere around it.
    render(
      <Field id="entry-story" label="Story">
        <textarea id="entry-story" className={CONTROL} />
      </Field>,
    );

    expect(screen.getAllByLabelText("Story")).toHaveLength(1);
  });
});

describe("<Field>'s hint is reachable through aria-describedby", () => {
  it("renders the hint at `${id}-hint`, which is the id the control names", () => {
    render(
      <Field
        id="entry-slug"
        label="Slug"
        hint="Becomes the entry's address, and is fixed once it is saved."
      >
        <input id="entry-slug" className={CONTROL} aria-describedby="entry-slug-hint" />
      </Field>,
    );

    expect(describedTextOf(screen.getByLabelText("Slug"))).toBe(
      "Becomes the entry's address, and is fixed once it is saved.",
    );
  });

  it("describes nothing by itself: a control that names no id announces none", () => {
    // The asymmetry is the design — every control names its own ids, which is
    // what makes the composition case below possible: ./notes.md#what-this-test-pins
    render(
      <Field id="entry-tags" label="Tags" hint="Comma separated.">
        <input id="entry-tags" className={CONTROL} />
      </Field>,
    );

    expect(screen.getByLabelText("Tags")).not.toHaveAttribute("aria-describedby");
    expect(describedTextOf(screen.getByLabelText("Tags"))).toBe("");
  });

  it("renders no hint element when given none, and a control naming one fails loudly", () => {
    render(
      <Field id="entry-mode" label="How you travelled">
        <select id="entry-mode" className={CONTROL} aria-describedby="entry-mode-hint" />
      </Field>,
    );

    expect(document.getElementById("entry-mode-hint")).toBeNull();
    // Non-vacuity for the helper: an id nothing renders has to fail as itself
    // rather than read as an empty description. Matched on the HELPER's own
    // wording — a bare /entry-mode-hint/ also matches the DOM dump in a
    // getByLabelText failure, so it would pass on a broken association.
    expect(() => describedTextOf(screen.getByLabelText("How you travelled"))).toThrow(
      /points aria-describedby at "entry-mode-hint"/,
    );
  });

  it("composes with a second described id rather than being replaced by it", () => {
    // The source note is a SIBLING of the Field in the editor, not a child, so
    // it is one here too: a Field that required the described element to be
    // inside it would fail on this fixture and on nothing else.
    render(
      <>
        <Field
          id="entry-when"
          label="When it happened"
          hint="Kept with the offset of the place it happened in."
        >
          <input
            id="entry-when"
            type="datetime-local"
            className={CONTROL}
            aria-describedby="entry-when-hint entry-when-source"
          />
        </Field>
        <p id="entry-when-source">The date and time are this photo&apos;s.</p>
      </>,
    );

    // Exact equality over BOTH texts, in order. Two `toContain` calls would
    // accept a hint that had been dropped, renamed or overwritten by the note.
    expect(describedTextOf(screen.getByLabelText("When it happened"))).toBe(
      "Kept with the offset of the place it happened in. The date and time are this photo's.",
    );
  });

  it("gives the hint no live-region role, so the save outcome stays the only status", () => {
    // TODO.md defers `role="status"` on the auto-fill note because it would
    // make `getByRole("status")` ambiguous with the save outcome; on Field's
    // hint it would be that collision on every control.
    render(
      <>
        <Field id="entry-place-name" label="Place" hint="Kept even when the coordinate is not.">
          <input id="entry-place-name" className={CONTROL} aria-describedby="entry-place-name-hint" />
        </Field>
        <p role="status">Saved.</p>
        <button type="button" className={BUTTON}>
          Save entry
        </button>
      </>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });
});

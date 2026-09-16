// @vitest-environment jsdom
/** The studio's entry editor: the multi-section UI (Stage 3a, Task 2) — every
 *  other `entry-editor.*.test.tsx` file drives one section; this is the one
 *  that adds a second. Shared rig: ./entry-editor.harness. */

import {
  clickSaveAndWait,
  datatypeOf,
  fakeStudioSession,
  fillNewEntry,
  languageOf,
  objectsOf,
  oneObject,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { DY, SCHEMA, XSD } from "@/lib/vocab";
import type { Quad } from "n3";

registerEditorLifecycle();

/** One section card, found by its own accessible group name — the same
 *  convention `sections-field.test.tsx` pins directly against the component;
 *  here it is exercised through the whole editor instead. */
function sectionCard(n: 1 | 2): HTMLElement {
  return screen.getByRole("group", { name: `Section ${n}` });
}

/**
 * A section's prose and position, read the way §7 requires — by
 * `dy:sortOrder`, never by the position `schema:hasPart`'s objects happen to
 * come back in (§6: "RDF collections here are sets"). The right document
 * order with the wrong `sortOrder` must still fail here.
 */
function sectionRows(quads: Quad[], url: string) {
  const subject = `${url}#it`;
  const nodes = objectsOf(quads, subject, SCHEMA.hasPart).map((t) => t.value);
  return nodes
    .map((node) => ({
      node,
      text: oneObject(quads, node, SCHEMA.text),
      sortOrder: oneObject(quads, node, DY.sortOrder),
    }))
    .sort((a, b) => Number(a.sortOrder?.value) - Number(b.sortOrder?.value));
}

describe("entry editor — a second section", () => {
  it("writes both sections to the Pod, in dy:sortOrder, each language-tagged", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    // Section 1: filled through the shared helper, which is what every other
    // suite already exercises against a single-section form.
    fillNewEntry({ slug: "2026-04-03-nara" });

    // A SECOND CARD, ADDED BY THE OWNER MID-EDIT — the behaviour this file
    // exists for. Nothing above this line is new.
    fireEvent.click(screen.getByRole("button", { name: /add section/i }));
    const second = within(sectionCard(2));
    fireEvent.change(second.getByLabelText(/story/i), {
      target: { value: "The cemetery, quiet in the rain." },
    });

    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const rows = sectionRows(quads, put.url);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.text?.value)).toEqual([
      "Two hours of drizzle and nobody else on the path.",
      "The cemetery, quiet in the rain.",
    ]);
    expect(rows.map((r) => Number(r.sortOrder?.value))).toEqual([1, 2]);
    for (const row of rows) {
      expect(datatypeOf(row.sortOrder), row.node).toBe(XSD.integer);
      expect(languageOf(row.text), row.node).not.toBe("");
    }
  });
});

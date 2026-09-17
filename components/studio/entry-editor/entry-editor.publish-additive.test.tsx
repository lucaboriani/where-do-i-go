// @vitest-environment jsdom
/** Task 4.2's regression pin: `tripStatus` must be ADDITIVE. Every existing
 *  file calls `renderEditor` without it; this one drives autosave, the draft
 *  banner and a section field through that same unmodified call shape. */

import {
  ARRIVAL_URL,
  LABEL,
  OWNER,
  draftKeyFor,
  fakeStorage,
  fakeStudioSession,
  registerEditorLifecycle,
  renderEditor,
  seededDraft,
  specEntry,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

/** Real timers throughout: `vi.useFakeTimers` replaces the same `setTimeout`
 *  `waitFor` polls on, so a frozen clock hangs every `waitFor` below instead
 *  of failing it. The 800ms debounce is awaited at real speed instead. */
const AUTOSAVE_WAIT = { timeout: 2000 };

registerEditorLifecycle();

describe("entry editor — publish-control additions do not disturb existing behaviour", () => {
  it("still offers, restores and autosaves a draft on an EDIT mounted without tripStatus", async () => {
    const entry = await specEntry();
    const seeded = JSON.stringify(seededDraft({ headline: "Restored via the seeded draft" }));
    const store = fakeStorage({ [draftKeyFor(OWNER, ARRIVAL_URL)]: seeded });

    // No `tripStatus` prop at all — the exact call shape every pre-4.2 test
    // uses, and the one this test exists to prove stays live.
    await renderEditor(fakeStudioSession().session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    // 1. THE DRAFT BANNER still appears.
    const banner = await screen.findByRole("region", { name: /draft/i });
    expect(within(banner).getByRole("button", { name: "Restore" })).toBeInTheDocument();

    // 2. RESTORE still fills the form — a section field this time, since that
    //    is what Task 4.2's brief names alongside autosave and the banner.
    fireEvent.click(within(banner).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: /draft/i })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText(LABEL.headline)).toHaveValue("Restored via the seeded draft");

    // 3. AUTOSAVE still fires after the restore, coalesced by the same
    //    debounce as every other file that asserts this — at real speed, per
    //    the module docblock above.
    store.calls.set.length = 0;
    fireEvent.change(screen.getByLabelText(LABEL.headline), {
      target: { value: "Restored, then edited further" },
    });
    await waitFor(() => expect(store.calls.set).toHaveLength(1), AUTOSAVE_WAIT);

    cleanup();
  });

  it("treats an omitted tripStatus as fail-closed rather than throwing, on an already-published entry", async () => {
    const entry = await specEntry();
    expect(entry.status).toBe("published");

    // No `tripStatus`: the same "undefined reads exactly like a draft" rule
    // `hooks/studio/use-publish.ts` already documents for every OTHER caller.
    // The point of this case is that mounting does not throw and the control,
    // if rendered, is not left in an enabled state nobody guarded.
    await renderEditor(fakeStudioSession().session, { initial: { entry, etag: '"entry-7"' } });

    await waitFor(() => expect(screen.getByLabelText(LABEL.headline)).toBeInTheDocument());
    // `initial` alone decides the control exists (the design decision this
    // file's docblock states); an omitted `tripStatus` must not be read as
    // "hide the control" — that would be indistinguishable from a throw an
    // error boundary swallowed. Unpublishing carries no guard (§5), so the
    // control must render enabled, not merely render.
    const takeOffline = screen.getByRole("button", { name: /take offline/i });
    expect(takeOffline).not.toBeDisabled();
    // Only one of the pair ever shows for an already-published entry.
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull();
  });
});

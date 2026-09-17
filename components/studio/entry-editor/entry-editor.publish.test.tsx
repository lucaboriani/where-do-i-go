// @vitest-environment jsdom
/** Task 4.2 — the editor's own publish control, mirroring `entries-list.tsx`'s
 *  (4.1) through the same `usePublish` guard. New prop `tripStatus?: Status`,
 *  GIVEN like `EntriesListProps.tripStatus`. `initial` gates its existence. */

import {
  ARRIVAL_URL,
  LABEL,
  POD,
  SETTINGS_URL,
  TRIPS,
  fakeStudioSession,
  loadEditor,
  podFake,
  registerEditorLifecycle,
  specEntry,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DY, STATUS } from "@/lib/vocab";
import { triples } from "@/test/graph";
import type { Entry, Status } from "@/lib/pod/schema";

registerEditorLifecycle();

async function renderForPublish(opts: {
  initial?: { entry: Entry; etag: string | null };
  tripStatus?: Status;
}) {
  const Editor = await loadEditor();
  const fake = fakeStudioSession();
  render(
    <Editor
      session={fake.session}
      trips={TRIPS}
      initial={opts.initial}
      tripStatus={opts.tripStatus}
      settingsUrl={SETTINGS_URL}
      podRoot={POD}
    />,
  );
  return fake;
}

describe("entry editor — the publish control", () => {
  it("shows no publish control before the entry has ever reached the Pod (CREATE mode)", async () => {
    await renderForPublish({ tripStatus: "published" });

    await waitFor(() => expect(screen.getByLabelText(LABEL.headline)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /publish|take offline/i })).not.toBeInTheDocument();
  });

  it("disables the publish control, with a reason, when the entry's trip is a draft", async () => {
    const entry: Entry = { ...(await specEntry()), status: "draft" };
    podFake();

    await renderForPublish({ initial: { entry, etag: '"entry-7"' }, tripStatus: "draft" });

    const button = await screen.findByRole("button", { name: /^publish$/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/not published yet/i)).toBeInTheDocument();
  });

  it("enables the publish control when the entry's trip is published, and reaches the Pod on click", async () => {
    const entry: Entry = { ...(await specEntry()), status: "draft" };
    const pod = podFake();

    await renderForPublish({ initial: { entry, etag: '"entry-7"' }, tripStatus: "published" });

    const button = await screen.findByRole("button", { name: /^publish$/i });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => expect(pod.entryPut()).toBeDefined());
    const put = pod.entryPut()!;
    // The precondition (§10 hard rule): a targeted status flip is still a
    // conditional write, never a blind PUT. `"v1"` is the FRESH read's own
    // ETag (specEntry()'s own GET handler), not the mount-time `"entry-7"` —
    // fix round 1, Finding #1: ./notes.md#the-publish-control-reads-existing-not-the-live-draft
    expect(put.headers["if-match"]).toBe('"v1"');
    // The mutation, by graph rather than by bytes: the body really does carry
    // dy:status dy:Published, not the unmodified fixture re-sent.
    const expected = [
      ...triples(`<${ARRIVAL_URL}#it> <${DY.status}> <${STATUS.Published}> .`, put.url),
    ][0];
    expect(triples(put.body, put.url).has(expected)).toBe(true);
  });

  it("offers Take offline, unguarded, for an already-published entry regardless of trip status", async () => {
    const entry = await specEntry();
    expect(entry.status).toBe("published");
    const pod = podFake();

    await renderForPublish({ initial: { entry, etag: '"entry-7"' }, tripStatus: "draft" });

    const button = await screen.findByRole("button", { name: /take offline/i });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    await waitFor(() => expect(pod.entryPut()).toBeDefined());
    const put = pod.entryPut()!;
    const expected = [
      ...triples(`<${ARRIVAL_URL}#it> <${DY.status}> <${STATUS.Draft}> .`, put.url),
    ][0];
    expect(triples(put.body, put.url).has(expected)).toBe(true);
  });
});

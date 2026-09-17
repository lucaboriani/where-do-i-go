// @vitest-environment jsdom
/** Fix round 1, Finding #1: `write()` paired a mount-time `existing` body
 *  with a LIVE `target.etag`; a Save in between moved the ETag without
 *  moving the body, so Publish silently reverted the save. Pins the fix:
 *  re-read before writing. */

import {
  ARRIVAL_URL,
  ENTRY_TTL,
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
import { http, HttpResponse } from "msw";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { server } from "@/test/msw";
import { DY, SCHEMA, STATUS } from "@/lib/vocab";
import { triples } from "@/test/graph";
import type { Entry } from "@/lib/pod/schema";

registerEditorLifecycle();

const ORIGINAL_HEADLINE = "First night in Shinjuku";
const EDITED_HEADLINE = "First night in Shinjuku, updated after landing";

/** The Pod's own state after the Save below — real Turtle, not a guess, and
 *  guarded against the anchor drifting silently (the shape every mutated
 *  fixture in this repository is held to). */
function savedEntryTtl(): string {
  const anchor = `schema:headline      "${ORIGINAL_HEADLINE}"@en ;`;
  if (!ENTRY_TTL.includes(anchor)) throw new Error("§7.3 headline anchor not found");
  return ENTRY_TTL.replace(anchor, `schema:headline      "${EDITED_HEADLINE}"@en ;`);
}

describe("entry editor — publish sends the saved body, not the mount snapshot", () => {
  it("re-reads before publishing, so an edit saved after mount is not reverted", async () => {
    const entry: Entry = { ...(await specEntry()), status: "draft" };
    const pod = podFake({ entryEtag: '"entry-8"' });
    const Editor = await loadEditor();
    const fake = fakeStudioSession();

    render(
      <Editor
        session={fake.session}
        trips={TRIPS}
        initial={{ entry, etag: '"entry-7"' }}
        tripStatus="published"
        settingsUrl={SETTINGS_URL}
        podRoot={POD}
      />,
    );

    // Open "A", edit to "B", Save — the Pod's own copy moves to the new
    // headline at a NEW ETag, while `existing` inside the editor does not.
    await waitFor(() => expect(screen.getByLabelText(LABEL.headline)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(LABEL.headline), {
      target: { value: EDITED_HEADLINE },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save entry" }));
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    // What the fix reads before writing: the Pod's OWN current document, at
    // the ETag the Save above just produced. Registered NOW, not earlier —
    // the point is that this is what a re-read at CLICK TIME would see.
    server.use(
      http.get(ARRIVAL_URL, () =>
        HttpResponse.text(savedEntryTtl(), {
          headers: { "content-type": "text/turtle", etag: '"entry-8"' },
        }),
      ),
    );

    fireEvent.click(await screen.findByRole("button", { name: /^publish$/i }));

    await waitFor(() => {
      const puts = pod.requests.filter((r) => r.method === "PUT" && r.url === ARRIVAL_URL);
      expect(puts).toHaveLength(2);
    });
    const publishPut = pod.requests.filter(
      (r) => r.method === "PUT" && r.url === ARRIVAL_URL,
    )[1];

    // The precondition is the FRESH read's ETag, never the mount-time one.
    expect(publishPut.headers["if-match"]).toBe('"entry-8"');

    // The published body carries the SAVED headline, not the mount snapshot —
    // by graph membership, never by bytes.
    const graph = triples(publishPut.body, publishPut.url);
    const carriesEdit = [
      ...triples(`<${ARRIVAL_URL}#it> <${SCHEMA.headline}> "${EDITED_HEADLINE}"@en .`, publishPut.url),
    ][0];
    const carriesStale = [
      ...triples(`<${ARRIVAL_URL}#it> <${SCHEMA.headline}> "${ORIGINAL_HEADLINE}"@en .`, publishPut.url),
    ][0];
    expect(graph.has(carriesEdit), "the publish reverted to the mount-time headline").toBe(true);
    expect(graph.has(carriesStale), "the publish sent the mount-time headline as well").toBe(false);

    const publishedStatus = [
      ...triples(`<${ARRIVAL_URL}#it> <${DY.status}> <${STATUS.Published}> .`, publishPut.url),
    ][0];
    expect(graph.has(publishedStatus)).toBe(true);
  });
});

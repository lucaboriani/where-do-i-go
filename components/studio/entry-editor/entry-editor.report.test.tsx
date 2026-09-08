// @vitest-environment jsdom
/** The studio's entry editor: sections 7-7d — the partial-failure report.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  ENTRY_TTL,
  JAPAN,
  LABEL,
  OWNER,
  type PodScript,
  REVALIDATE_URL,
  type Recorded,
  SCENARIOS,
  SETTINGS_URL,
  SPEC_CREATED,
  accessCalls,
  accessOutcome,
  clickSaveAndWait,
  datatypeOf,
  fakeStudioSession,
  fillNewEntry,
  oneObject,
  outcomeText,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  saveButton,
  setChoice,
  setText,
  specEntry,
} from "./entry-editor.harness";
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { DCTERMS, DY, SCHEMA, XSD } from "@/lib/vocab";
import { TAGS } from "@/lib/pod/tags";
import { server } from "@/test/msw";
import type { Entry } from "@/lib/pod/schema";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 7. THE PARTIAL-FAILURE REPORT. The point of this UI.
 *
 * §10 names three outcomes where the entry reaches the Pod and the save is
 * still incomplete, and `saveEntry` returns { completed, failed, recovery }
 * precisely so a human can be told which. "Saved" / "Failed" throws that away
 * and makes the documented recovery unreachable.
 * ════════════════════════════════════════════════════════════════════════ */

/** Every scenario is produced by driving the REAL saveEntry against a scripted
 *  Pod. Returns what the owner was told. */
async function saveUnder(script: PodScript, accessFails = false): Promise<string> {
  if (accessFails) {
    accessOutcome.failure = {
      kind: "accessUnverified",
      url: `${JAPAN.entriesContainer}2026-04-02-kyoto.ttl`,
      expected: "public read",
      found: "unknown",
    };
  }
  const pod = podFake(script);
  const fake = fakeStudioSession();
  await renderEditor(fake.session);
  /**
   * NOTHING IS BEING OFFERED, so what follows really is a save of what
   * `fillNewEntry` typed into a live form.
   *
   * THE LEAK THIS CATCHES, which is not hypothetical — it was live in the test
   * below until this line was added. This helper takes the DEFAULT storage,
   * which under jsdom is one `window.localStorage` for the whole FILE, and the
   * editor's unmount flush (8f) writes any pending window out when `cleanup()`
   * runs. A caller that loops over the scenarios therefore hands the next
   * iteration a banner made of the last one's typing unless it clears storage
   * between them. With that banner up the eight controls are held (8e), so
   * `fillNewEntry` is filling a form a real browser would refuse every
   * keystroke of — and `fireEvent` does not model that, so the loop stays green
   * while testing a screen nobody can produce.
   *
   * WHAT WOULD BREAK IT: dropping the `window.localStorage.clear()` from the
   * six-outcomes loop, or from the file's `afterEach`.
   */
  expect(
    screen.queryAllByRole("region", { name: /draft/i }),
    "a draft leaked in from an earlier scenario, so this form is held behind a banner",
  ).toEqual([]);
  fillNewEntry();
  await clickSaveAndWait();
  void pod;
  return outcomeText();
}

/**
 * THE SCENARIO TABLE, PROVED AGAINST THE REAL saveEntry.
 *
 * A control, and it earns its place: every message assertion below is "for THIS
 * §10 outcome, say THAT". If a script did not produce the outcome it is
 * labelled with — a handler path that never matched, a status the sequence
 * treats differently than I assumed — those assertions would be checking the
 * wrong message and the file would look like coverage while pinning nothing.
 *
 * So each script is driven through the real `saveEntry` here, with no component
 * anywhere, and the `{completed, recovery}` it yields is pinned. This one PASSES
 * on the red run, deliberately: it is about the fixture, not the editor.
 *
 * The `revalidate` callback below is a deliberately minimal stand-in for the
 * real hook — POST the tags, throw unless the body says they were revalidated.
 * It is here to make step 4 fail on cue, not as a specification of the hook;
 * what the hook must do is asserted through the editor, in the two tests at the
 * end of this section.
 */
describe("control — the scripts really do produce the six §10 outcomes", () => {
  const OUTCOMES: Record<keyof typeof SCENARIOS, { completed: string[]; recovery: string }> = {
    success: { completed: ["entry", "access", "index", "revalidate"], recovery: "none" },
    entryRefused: { completed: [], recovery: "retry" },
    concurrent: { completed: [], recovery: "refetch" },
    aclUnverified: { completed: ["entry"], recovery: "rebuildIndex" },
    indexRefused: { completed: ["entry", "access"], recovery: "rebuildIndex" },
    revalidateDown: { completed: ["entry", "access", "index"], recovery: "retry" },
  };

  it.each(Object.keys(OUTCOMES) as (keyof typeof SCENARIOS)[])(
    "%s",
    async (name) => {
      const slug = "2026-04-02-kyoto";
      const entryUrl = `${JAPAN.entriesContainer}${slug}.ttl`;
      if (name === "aclUnverified") {
        accessOutcome.failure = {
          kind: "accessUnverified",
          url: entryUrl,
          expected: "public read",
          found: "unknown",
        };
      }

      const pod = podFake(SCENARIOS[name]);
      const fake = fakeStudioSession();
      const spec = await specEntry();
      const entry: Entry = { ...spec, iri: `${entryUrl}#it`, slug, photos: [], place: undefined };

      const { saveEntry } = await import("@/lib/pod/save-entry");
      const report = await saveEntry({
        fetch: fake.session.fetch,
        entry,
        precondition: { create: true },
        indexUrl: JAPAN.indexUrl,
        tripIri: JAPAN.iri,
        tripSlug: JAPAN.slug,
        webId: OWNER,
        revalidate: async (tags) => {
          const res = await globalThis.fetch(REVALIDATE_URL, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tags }),
          });
          if (!res.ok) throw new Error(`revalidation returned ${res.status}`);
          const seen = (await res.json()) as { revalidated?: number; rejected?: string[] };
          if ((seen.rejected?.length ?? 0) > 0 || (seen.revalidated ?? 0) === 0) {
            throw new Error(`revalidation rejected ${JSON.stringify(seen.rejected ?? [])}`);
          }
        },
      });

      expect({ completed: report.completed, recovery: report.recovery }).toEqual(OUTCOMES[name]);
      // The script reached the wire at all — an outcome produced by a handler
      // that never matched would be an outcome about nothing.
      expect(pod.requests.length).toBeGreaterThan(0);
    },
  );
});

describe("entry editor — surfacing the §10 report", () => {
  /**
   * THE HEADLINE ASSERTION. Six outcomes, six different things to say. A UI
   * that renders "Saved" or "Failed" collapses them and this fails on the first
   * duplicate — no wording is prescribed, only that the owner can tell the
   * outcomes apart.
   *
   * Note the two pairs that share a `recovery` value and must still differ:
   * `entryRefused` and `revalidateDown` are both "retry", and `aclUnverified`
   * and `indexRefused` are both "rebuildIndex". Anything keyed on `recovery`
   * alone fails here, which is what "completed is reflected" means in practice.
   *
   * SIX MOUNTS IN ONE TEST, SO THIS LOOP DOES ITS OWN `afterEach`. The file's
   * `afterEach` clears `window.localStorage` between TESTS, and nothing was
   * doing it between ITERATIONS: `saveUnder` takes the default storage, the two
   * scenarios that fail leave a debounce window outstanding, and the unmount
   * flush (8f) writes it out when `cleanup()` runs. Measured before this line
   * existed: from the third scenario on, every iteration mounted with an
   * "Unsaved draft" banner up and filled a form 8e holds — six outcomes
   * compared on a screen a real browser cannot produce. `fireEvent` ignores
   * disabled state, so it stayed green. `saveUnder` now refuses to run behind a
   * banner, which is what turns this from a comment into a check.
   */
  it("says six different things for the six outcomes §10 distinguishes", async () => {
    const said: Record<string, string> = {};
    for (const [name, script] of Object.entries(SCENARIOS)) {
      said[name] = await saveUnder(script, name === "aclUnverified");
      cleanup();
      // AFTER `cleanup()`, never before: the unmount is what flushes the
      // pending window, so clearing first would clear the store and then have
      // the draft written straight back into it.
      window.localStorage.clear();
      accessCalls.length = 0;
      accessOutcome.failure = null;
      server.resetHandlers();
    }

    for (const [name, text] of Object.entries(said)) {
      expect(text, `${name} announced nothing at all`).not.toBe("");
    }
    const unique = new Set(Object.values(said));
    expect(
      unique.size,
      `these outcomes share wording:\n${JSON.stringify(said, null, 2)}`,
    ).toBe(Object.keys(SCENARIOS).length);
  });

  /**
   * `role="alert"` is assertive: it interrupts a screen reader mid-sentence.
   * A save that worked is `role="status"` news. The pairing matters — the
   * refused-write test below asserts the opposite — so between them an editor
   * that puts everything in one role, or announces nothing, fails.
   */
  it("a full success says so politely, and raises no alert", async () => {
    const text = await saveUnder(SCENARIOS.success);
    expect(text).toMatch(/saved|published/i);
    expect(screen.queryAllByRole("alert")).toEqual([]);
    expect(screen.queryAllByRole("status").length).toBeGreaterThan(0);
  });

  /**
   * `recovery: "retry"` with nothing completed. Nothing reached the Pod, so the
   * owner must not be told it was saved, and "try again" is honest advice here
   * in a way it is not for a 412.
   */
  it("a refused write does not claim anything was saved", async () => {
    const text = await saveUnder(SCENARIOS.entryRefused);
    expect(text).not.toMatch(/\b(is|was|has been) (now )?(saved|published|written)\b/i);
    expect(text).toMatch(/again|retry/i);
    await waitFor(() => expect(screen.queryAllByRole("alert").length).toBeGreaterThan(0));
  });

  /**
   * `recovery: "refetch"` — a 412. Something changed underneath us. §10: "Fails
   * on concurrent modification; refetch and retry." Retrying with the same
   * stale ETag fails identically, so telling the owner to "try again" is wrong
   * advice, and this is the one outcome where the draft in the form is the only
   * remaining copy of their work.
   */
  it("a concurrent edit says the draft is stale, and does not discard what was typed", async () => {
    const text = await saveUnder(SCENARIOS.concurrent);

    expect(text).toMatch(/chang|elsewhere|another|newer|out of date|stale|reload|refresh/i);
    // What is on the screen is the only copy. Losing it is worse than the 412.
    expect((screen.getByLabelText(LABEL.headline) as HTMLInputElement).value).toBe(
      "Rain on the Philosopher's Path",
    );
    expect((screen.getByLabelText(LABEL.articleBody) as HTMLTextAreaElement).value).toBe(
      "Two hours of drizzle and nobody else on the path.",
    );
  });

  /**
   * `recovery: "rebuildIndex"` with `completed: ["entry", "access"]`.
   *
   * §10: "Step 1 succeeding and step 3 failing leaves an entry that exists but
   * is unlisted: invisible, not corrupt." The entry IS on the Pod. A message
   * that reads as "your work was lost" sends the owner to retype it, which
   * either collides on the precondition or overwrites the copy that is already
   * there.
   */
  it("an unlisted entry is reported as saved-but-unlisted, never as lost", async () => {
    const text = await saveUnder(SCENARIOS.indexRefused);

    expect(text).toMatch(/saved|written|on (your|the) Pod/i);
    expect(text).toMatch(/list|index|appear|visible/i);
    expect(text).not.toMatch(/\b(lost|discarded|nothing was (saved|written)|not saved)\b/i);
  });

  /**
   * The other `rebuildIndex`, with `completed: ["entry"]` — the ACL step is the
   * one that failed. §10's "published-but-unreadable". The distinction from the
   * case above is exactly what `completed` is for: this one must not claim the
   * entry is visible, and the one above must not claim its access is in doubt.
   */
  it("an unverified ACL is reported as a visibility problem, not an index one", async () => {
    const text = await saveUnder(SCENARIOS.aclUnverified, true);

    expect(text).toMatch(/saved|written|on (your|the) Pod/i);
    expect(text).toMatch(/access|visib|readable|permission/i);
    expect(text).not.toMatch(/\b(lost|discarded|nothing was (saved|written))\b/i);
  });

  /**
   * `recovery: "retry"` with everything completed but step 4. The Pod is
   * consistent; only the public site's cache is behind, and it heals on its own
   * when the 15-minute timer rolls. Reporting this as a failed save is the
   * single most misleading thing this UI could do — it is the same `recovery`
   * value as the refused write, and the opposite situation.
   */
  it("a failed revalidation is reported as saved, with the public site possibly stale", async () => {
    const text = await saveUnder(SCENARIOS.revalidateDown);

    expect(text).toMatch(/saved|published|written/i);
    expect(text).toMatch(/public|site|cache|stale|visitor|may take/i);
    expect(text).not.toMatch(/\b(lost|discarded|nothing was (saved|written)|not saved)\b/i);
  });

  /**
   * STATUS WITHOUT BODY. `/api/revalidate` answers 200 and reports in the body
   * which tags it actually revalidated; its own docblock says "the studio
   * branches on it: saveEntry treats step 4 as failed if the hook throws, and
   * the hook can only know to throw by reading this."
   *
   * A hook that checks `res.ok` and stops sees a 200 here and reports a clean
   * save while the public site keeps serving the old page — a zero-byte 404 in
   * a different costume, and this project has shipped one of those before.
   */
  it("treats a 200 that revalidated nothing as a stale public site, not a clean save", async () => {
    const rejectedBoth = {
      status: 200,
      body: { revalidated: 0, rejected: [TAGS.trip(JAPAN.slug), TAGS.entry(JAPAN.slug, "2026-04-02-kyoto")] },
    };
    const text = await saveUnder({ revalidate: rejectedBoth });

    expect(text).toMatch(/public|site|cache|stale|visitor|may take/i);
    // Still saved — the entry is on the Pod, only the cache is behind.
    expect(text).toMatch(/saved|published|written/i);
  });

  /** The allow-case for the test above: a 200 that DID revalidate is a clean
   *  save, so the check cannot be "always warn". */
  it("treats a 200 that revalidated the tags as a clean save", async () => {
    const text = await saveUnder({
      revalidate: { status: 200, body: { revalidated: 2, rejected: [] } },
    });
    expect(text).not.toMatch(/stale|may be out of date/i);
    expect(text).toMatch(/saved|published/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7b. THE TWO TIMESTAMPS THAT MUST NOT MOVE.
 *
 * A DATA-LOSS BUG THAT WAS FOUND BY PROBING, NOT BY THIS SUITE, and shipped
 * fixed with nothing pinning the fix.
 *
 * `saveEntry` invents `dcterms:created` only when CREATING —
 * `opts.entry.created ?? (creating ? stamp : undefined)`. On the SECOND save of
 * an entry this editor just created, the editor's `initial` prop is still
 * absent, so an editor that derived `created` from `initial` alone supplied
 * none, the serialiser omitted the triple, and §7.3's distinction between "when
 * the record came into being" and "when it became public" was destroyed on the
 * second click — silently, permanently, and only on the second click, which is
 * why the three "second save" tests in section 2 (all about preconditions) walk
 * straight past it. `schema:datePublished` is the same bug in the other
 * direction: recomputed from the clock, it creeps forward on every save.
 *
 * Probe output before the fix: `expected undefined to be
 * '2026-09-04T15:57:52.156+00:00'`.
 *
 * THE CLOCK IS FAKED, AND THAT IS THE LOAD-BEARING PART OF THESE TWO TESTS.
 * `nowWithOffset()` has second granularity and two saves driven by a test land
 * in the same second, so a RECOMPUTED `datePublished` would come out byte-equal
 * to a carried-forward one and both tests would pass against the bug they exist
 * to catch. `toFake: ["Date"]` moves the clock and nothing else — setTimeout,
 * setInterval and queueMicrotask stay real, so `waitFor`, React's scheduler and
 * MSW are untouched. The control is inside each test rather than beside it:
 * `dcterms:modified` MUST come out as two different literals, which is only
 * true if the clock really moved between the saves.
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — provenance across two saves", () => {
  /** Two instants seven and a half minutes apart, in UTC. */
  const FIRST = new Date("2026-04-02T10:00:00.000Z");
  const SECOND = new Date("2026-04-02T10:07:31.000Z");
  /** The same two, as the editor must spell them: Asia/Tokyo, fixed at the top
   *  of this file, so a bare `Z` or a dropped offset fails here. */
  const FIRST_STAMP = "2026-04-02T19:00:00+09:00";
  const SECOND_STAMP = "2026-04-02T19:07:31+09:00";

  /** The entry PUTs, in order — the index PUTs are to `entries.ttl`. */
  const entryPutsOf = (pod: ReturnType<typeof podFake>) =>
    pod.puts().filter((r) => !r.url.endsWith("entries.ttl"));

  const parsed = (put: Recorded) => ({
    quads: quadsOf(put.body, put.url),
    subject: `${put.url}#it`,
  });

  /**
   * THE CREATE PATH, where the bug lived: `initial` is absent for the whole
   * session, so after the first save the editor is the only thing that knows
   * what it stamped.
   */
  it("carries created and datePublished into the second save of an entry it just created", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIRST);

    const pod = podFake({ entryEtag: '"entry-created-1"' });
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry({ headline: "Rain on the Philosopher's Path" });
    await clickSaveAndWait();

    vi.setSystemTime(SECOND);
    setText(LABEL.headline, "Rain on the Philosopher's Path, second pass");
    await clickSaveAndWait();

    const puts = entryPutsOf(pod);
    expect(puts).toHaveLength(2);
    const [one, two] = puts.map(parsed);

    /**
     * THE MUTATION HALF. The two bodies must really differ, or an editor that
     * re-PUT the first one unchanged — saving nothing on the second click —
     * would satisfy every assertion below by doing the wrong thing perfectly.
     */
    expect(oneObject(one.quads, one.subject, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );
    expect(oneObject(two.quads, two.subject, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path, second pass",
    );

    /**
     * THE CONTROL. If the fake clock were not reaching the editor, these two
     * would be equal and the pin below would hold vacuously — a recomputed
     * timestamp and a carried-forward one are indistinguishable inside one
     * second.
     */
    expect(oneObject(one.quads, one.subject, DCTERMS.modified)?.value).toBe(FIRST_STAMP);
    expect(oneObject(two.quads, two.subject, DCTERMS.modified)?.value).toBe(SECOND_STAMP);

    // THE PIN: both timestamps are the FIRST save's, on both PUTs, as
    // xsd:dateTime literals carrying a real offset.
    for (const [n, put] of [one, two].entries()) {
      const created = oneObject(put.quads, put.subject, DCTERMS.created);
      expect(created?.value, `dcterms:created on PUT ${n + 1}`).toBe(FIRST_STAMP);
      expect(datatypeOf(created)).toBe(XSD.dateTime);

      const published = oneObject(put.quads, put.subject, SCHEMA.datePublished);
      expect(published?.value, `schema:datePublished on PUT ${n + 1}`).toBe(FIRST_STAMP);
      expect(datatypeOf(published)).toBe(XSD.dateTime);
    }
  });

  /**
   * THE EDIT PATH, where `initial` IS present. The two fields come off the
   * entry that was read rather than off the clock, and must survive two saves
   * in one session exactly as they arrived — the §7.3 fixture's own values,
   * not this file's typing.
   */
  it("carries created and datePublished through two saves of an entry it opened for editing", async () => {
    const entry = await specEntry();
    expect(entry.created).toBe(SPEC_CREATED);
    // Straight out of the normative block, so this compares against the
    // specification rather than against a constant copied from it.
    const specPublished = entry.datePublished;
    expect(specPublished).toBeDefined();
    expect(ENTRY_TTL).toContain(specPublished!);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIRST);

    const pod = podFake({ entryEtag: '"entry-8"' });
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });

    setText(LABEL.headline, "First night in Shinjuku, first pass");
    await clickSaveAndWait();

    vi.setSystemTime(SECOND);
    setText(LABEL.headline, "First night in Shinjuku, second pass");
    await clickSaveAndWait();

    const puts = entryPutsOf(pod);
    expect(puts).toHaveLength(2);
    const [one, two] = puts.map(parsed);

    // The mutation half again: two different edits, both of which reached the Pod.
    expect(oneObject(one.quads, one.subject, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, first pass",
    );
    expect(oneObject(two.quads, two.subject, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, second pass",
    );

    // The control: the clock moved, so a recomputed timestamp could not hide.
    expect(oneObject(one.quads, one.subject, DCTERMS.modified)?.value).toBe(FIRST_STAMP);
    expect(oneObject(two.quads, two.subject, DCTERMS.modified)?.value).toBe(SECOND_STAMP);

    for (const [n, put] of [one, two].entries()) {
      const created = oneObject(put.quads, put.subject, DCTERMS.created);
      expect(created?.value, `dcterms:created on PUT ${n + 1}`).toBe(SPEC_CREATED);
      expect(datatypeOf(created)).toBe(XSD.dateTime);

      const published = oneObject(put.quads, put.subject, SCHEMA.datePublished);
      expect(published?.value, `schema:datePublished on PUT ${n + 1}`).toBe(specPublished);
      expect(datatypeOf(published)).toBe(XSD.dateTime);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7c. THE PRE-FLIGHT GUARD, and the catch around the save.
 *
 * Two branches the implementer flagged as untested. Both are about the editor
 * staying usable: one refuses to start a save that cannot succeed, the other
 * makes sure an unexpected throw does not leave the button disabled forever.
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — the pre-flight guard", () => {
  /**
   * The three fields §10 cannot proceed without: no trip means no container and
   * no index, and `dy:slug` IS the filename (§11 guardrail 7), so an empty one
   * addresses `.ttl` in the container itself.
   *
   * Each case carries how the owner must be told AND how to satisfy it, so the
   * allow-case lives inside the same test. A guard that refused everything
   * would pass the first half of each of these and fail the second.
   */
  const REQUIRED = [
    { field: "trip", named: /trip/i, supply: () => setChoice(LABEL.trip, /japan/i) },
    { field: "slug", named: /slug|address|file/i, supply: () => setText(LABEL.slug, "2026-04-02-kyoto") },
    {
      field: "headline",
      named: /headline|title/i,
      supply: () => setText(LABEL.headline, "Rain on the Philosopher's Path"),
    },
  ] as const;

  /** Everything a save needs except one thing, which is left at its empty
   *  initial value. */
  function fillExcept(omitted: string) {
    if (omitted !== "trip") setChoice(LABEL.trip, /japan/i);
    if (omitted !== "slug") setText(LABEL.slug, "2026-04-02-kyoto");
    if (omitted !== "headline") setText(LABEL.headline, "Rain on the Philosopher's Path");
    setText(LABEL.articleBody, "Two hours of drizzle and nobody else on the path.");
    setText(LABEL.occurredAt, "2026-04-02T16:20");
    setChoice(LABEL.status, /publish/i);
  }

  it.each(REQUIRED)(
    "without $field: sends nothing, names it, and saves once it is supplied",
    async ({ field, named, supply }) => {
      const pod = podFake();
      const fake = fakeStudioSession();
      await renderEditor(fake.session);

      fillExcept(field);
      await clickSaveAndWait();

      // NOTHING left the machine: no entry PUT, no index GET, no revalidation
      // POST, and no ACL call either.
      //
      // The mount read of §7.6 is not part of "the save sent nothing" — it
      // happened before the form was touched — so it is excluded BY NAME and
      // then counted, rather than swallowed by a laxer assertion. The count is
      // also what makes the empty list above non-vacuous: the fake demonstrably
      // records what reaches it.
      expect(pod.saveTraffic()).toEqual([]);
      expect(pod.of("GET", SETTINGS_URL), "the §7.6 read is not once per save").toHaveLength(1);
      expect(accessCalls).toEqual([]);

      // And the owner is told WHICH field, not merely that something is wrong.
      const refusal = outcomeText();
      expect(refusal).toMatch(named);
      for (const other of REQUIRED.filter((r) => r.field !== field)) {
        expect(refusal, `named ${other.field}, which was supplied`).not.toMatch(other.named);
      }

      // THE ALLOW-CASE. A guard keyed on something other than this field would
      // still refuse here.
      supply();
      await clickSaveAndWait();

      const put = pod.entryPut();
      expect(put).toBeDefined();
      // AND THE FILTER USED ABOVE HIDES ONLY THE MOUNT READ. The same
      // `saveTraffic()` that was empty before the field was supplied carries
      // this PUT — by identity, so a helper that started dropping everything
      // would fail here rather than making the refusal assertion vacuous.
      expect(pod.saveTraffic(), "saveTraffic() filters out the save's own traffic").toContain(put);
      const quads = quadsOf(put!.body, put!.url);
      expect(oneObject(quads, `${put!.url}#it`, SCHEMA.headline)?.value).toBe(
        "Rain on the Philosopher's Path",
      );
    },
  );

  /**
   * Whitespace is absence. A headline of three spaces is not a headline, and a
   * slug of three spaces would address `%20%20%20.ttl` — a resource whose name
   * no one can type and whose `dy:slug` breaks guardrail 7 immediately.
   *
   * The allow-case proves the trim reaches the wire rather than merely gating
   * the button: padded values must arrive trimmed, at a trimmed URL.
   */
  it("treats whitespace as absent, and writes the trimmed values once they are real", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    setChoice(LABEL.trip, /japan/i);
    setText(LABEL.slug, "   ");
    setText(LABEL.headline, "  ");
    setText(LABEL.occurredAt, "2026-04-02T16:20");
    await clickSaveAndWait();

    // The save sent nothing — the §7.6 mount read excluded by name and counted
    // beside it, for the reason `saveTraffic` gives.
    expect(pod.saveTraffic()).toEqual([]);
    expect(pod.of("GET", SETTINGS_URL), "the §7.6 read is not once per save").toHaveLength(1);
    expect(outcomeText()).toMatch(/slug|address|file/i);
    expect(outcomeText()).toMatch(/headline|title/i);

    setText(LABEL.slug, "  2026-04-02-kyoto  ");
    setText(LABEL.headline, "  Rain on the Philosopher's Path  ");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put).toBeDefined();
    // The filter hides only the mount read: this PUT is in `saveTraffic()`,
    // which is what keeps the empty assertion above a real one.
    expect(pod.saveTraffic(), "saveTraffic() filters out the save's own traffic").toContain(put);
    expect(put!.url).toBe(`${JAPAN.entriesContainer}2026-04-02-kyoto.ttl`);
    const quads = quadsOf(put!.body, put!.url);
    const subject = `${put!.url}#it`;
    // §11 guardrail 7 both ways: the literal and the path segment agree.
    expect(oneObject(quads, subject, DY.slug)?.value).toBe("2026-04-02-kyoto");
    expect(oneObject(quads, subject, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );
  });
});

describe("entry editor — when something throws where nothing should", () => {
  /**
   * §10 IS A VALUE PROTOCOL: `saveEntry` reports every failure it knows about
   * as a `{completed, failed, recovery}` report and never throws. So reaching
   * the editor's `catch` means something threw where nothing is meant to —
   * @inrupt/solid-client under lib/pod/access.ts is the realistic candidate,
   * which is why the access fake is what throws here.
   *
   * THE FAILURE WORTH PINNING IS NOT THE MESSAGE. An unhandled rejection out of
   * `void save()` leaves `saving` true forever: the button stays disabled, the
   * screen looks as though the click did nothing, and the owner's only route
   * out is a reload that discards everything they typed. So the assertion is
   * that THE CONTROL RECOVERS — and, because "not disabled" can be true of a
   * button that no longer does anything, that a second click really reaches the
   * Pod.
   */
  it("recovers the save control, and says what it does not know", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    accessOutcome.throws = new Error("makePublic exploded where it promised a Result");

    fillNewEntry({ headline: "Rain on the Philosopher's Path" });
    await clickSaveAndWait();

    // Something reached the Pod before the throw, so the honest message cannot
    // claim the save failed cleanly — nor that it succeeded.
    expect(accessCalls.length).toBeGreaterThan(0);
    const said = outcomeText();
    expect(said).not.toBe("");
    expect(screen.queryAllByRole("alert").length).toBeGreaterThan(0);
    expect(said).not.toMatch(/\b(is|was|has been) (now )?(saved|published|written)\b/i);

    // THE POINT.
    const button = saveButton();
    expect(button).not.toBeDisabled();
    expect(button.getAttribute("aria-busy")).not.toBe("true");

    // And it is a live control, not merely an enabled one.
    accessOutcome.throws = null;
    setText(LABEL.headline, "Rain on the Philosopher's Path, retried");
    await clickSaveAndWait();

    const entryPuts = pod.puts().filter((r) => !r.url.endsWith("entries.ttl"));
    expect(entryPuts).toHaveLength(2);
    const quads = quadsOf(entryPuts[1].body, entryPuts[1].url);
    expect(oneObject(quads, `${entryPuts[1].url}#it`, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path, retried",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7d. THE STALE-CACHE DISTINCTION, PINNED ON SOMETHING THAT CANNOT BE REWORDED.
 *
 * The two tests in section 7 that catch a revalidation hook checking `res.ok`
 * and never reading the body assert on WORDING:
 * `/public|site|cache|stale|visitor|may take/`. Measured, and the reason the
 * success message is worded as it is: with "and the public site has been
 * refreshed" as the clean-save sentence, the `res.ok`-only hook PASSED that
 * test, because the wrong message it produced still mentioned the public site.
 *
 * A test whose verdict depends on the implementation's choice of nouns is one
 * rewording away from a false pass, and the comment in entry-editor.tsx that
 * keeps the wording apart is not something a linter can enforce. This pins the
 * same distinction on the structure instead: a clean save is `role="status"`,
 * news; a stale public site is `role="alert"`, something to act on. Both
 * directions in one test, so it cannot degenerate into "always warn".
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — stale cache versus clean save, by role", () => {
  it("raises an alert for a 200 that revalidated nothing, and only a status for one that did", async () => {
    const rejectedBoth = {
      status: 200,
      body: {
        revalidated: 0,
        rejected: [TAGS.trip(JAPAN.slug), TAGS.entry(JAPAN.slug, "2026-04-02-kyoto")],
      },
    };

    const stale = await saveUnder({ revalidate: rejectedBoth });
    expect(stale, "the stale-cache save announced nothing at all").not.toBe("");
    expect(screen.queryAllByRole("alert")).toHaveLength(1);
    expect(screen.queryAllByRole("status")).toHaveLength(0);

    cleanup();
    accessCalls.length = 0;
    server.resetHandlers();

    // THE ALLOW-CASE, through the same helper and the same queries.
    const clean = await saveUnder({
      revalidate: { status: 200, body: { revalidated: 2, rejected: [] } },
    });
    expect(clean, "the clean save announced nothing at all").not.toBe("");
    expect(screen.queryAllByRole("status")).toHaveLength(1);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });
});

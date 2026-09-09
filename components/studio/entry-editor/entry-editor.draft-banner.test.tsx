// @vitest-environment jsdom
/** The studio's entry editor: section 8, next four describes — the banner's accessible description, the held Save button, unmount, and the key after a create.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  ARRIVAL_URL,
  DEBOUNCE,
  DRAFT_FIELDS,
  FIRST,
  FIRST_STAMP,
  JAPAN,
  LABEL,
  NEW_SCOPE,
  OWNER,
  clickSaveAndWait,
  draftKeyFor,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  oneObject,
  outcomeText,
  parseDraft,
  placeNodeOf,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  saveButton,
  seededDraft,
  setText,
  specEntry,
  tick,
  typeAsUser,
  withFakeTimers,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SCHEMA } from "@/lib/vocab";

registerEditorLifecycle();

/* ──────────── 8e-bis. the hold says why, and says it where it is heard ── */

/**
 * A CONTROL HELD INDEFINITELY MUST SAY WHY, AND SAY IT PROGRAMMATICALLY.
 *
 * WHAT 8e ESTABLISHED AND WHAT IT LEFT OUT. The nine controls are held while an
 * offer is outstanding, a click on the held Save button reaches neither the Pod
 * nor the draft, and both directions are pinned. What none of that says is how
 * anybody is meant to find out WHY. The banner explains the DRAFT — "This
 * browser kept what you were writing here … Nothing on this form has been
 * changed" — and says nothing whatever about the Save button; the button
 * carries no `aria-describedby` and no explanation of any kind. Arrow onto it
 * in a screen reader and the whole announcement is "Save entry, button,
 * unavailable". Unavailable for what reason, and undone how, is not on offer.
 *
 * AND NOTHING LOOKS HELD EITHER, WHICH IS WHY THIS IS A DEFECT RATHER THAN
 * POLISH. Measured in a real browser against the local Community Solid Server —
 * a real login, a draft seeded into `localStorage`, a reload, `getComputedStyle`
 * on the controls the banner is holding:
 *
 *     headline (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 -0.66 -2.15)  opacity 1
 *     story    (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 -0.66 -2.15)  opacity 1
 *     save     (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 -0.66 -2.15)  opacity 1
 *     restore  (free)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 -0.66 -2.15)  opacity 1
 *
 * Held and free are byte-identical. `bg-surface` beats the UA's disabled
 * background and Tailwind's preflight sets `color: inherit`, so on this fixed
 * dark palette nothing greys out at all: nine controls that look perfectly
 * editable while silently swallowing every keystroke.
 *
 * THE PIXELS ARE NOT TESTED HERE, DELIBERATELY AND ON THE RECORD. The visual
 * half is `disabled:` variants on CONTROL and BUTTON, and the only assertion a
 * jsdom test could make about them is `toHaveClass("disabled:opacity-…")`,
 * which restates the string the component already contains: jsdom computes no
 * cascade, so it would pass against a variant that resolves to nothing, against
 * a token that does not exist in `@theme`, and against a rule a later Tailwind
 * outranks. That is CLAUDE.md's "if a test genuinely cannot be written before
 * the implementation, say so" rather than a gap nobody noticed. What IS
 * testable — and is the half a Tailwind upgrade cannot silently take away — is
 * the programmatic explanation, which is what this section pins.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE SUBJECT IS THE SAVE BUTTON, NOT THE FIELDSET, AND THAT IS A MEASUREMENT.
 *
 * The hold is IMPLEMENTED on the `<fieldset disabled>`, so the fieldset looks
 * like the honest subject: one element, one reason, stated once. It is not, and
 * the control below is what settles it (jsdom 30.0.1, @testing-library/jest-dom
 * 7.0.1, dom-accessibility-api 0.5.16):
 *
 *     <fieldset disabled aria-describedby="reason"><button>…      description ""
 *     <fieldset disabled><button aria-describedby="reason">…      description "…"
 *
 * A description on the fieldset computes to NOTHING at the control inside it —
 * a `<legend>` names the group, and no mechanism propagates a group's
 * DESCRIPTION down to its members. So a rule satisfied by describing the
 * fieldset would be satisfied by markup nobody ever hears: this project's
 * "a rule tested at the wrong path" failure, in accessibility form. The
 * explanation has to live where the user meets the hold, which is the control.
 *
 * WHY THE BUTTON ALONE AND NOT ALL NINE. Two reasons, and neither forbids an
 * implementer describing more:
 *
 *   1. The banner sits immediately above the eight fields and its own sentence
 *      is about them — it kept your text, the form has not been changed. It
 *      says nothing that accounts for Save being refused, and Save is the one
 *      whose refusal has a consequence the owner will chase.
 *   2. One sentence attached to nine controls is that sentence announced nine
 *      times to anyone reading the form linearly. A rule that mandated it would
 *      be mandating noise.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THE PIN ACTUALLY REQUIRES, so nobody has to guess at it:
 *
 *   - while an offer is outstanding, the Save button has a NON-EMPTY accessible
 *     description;
 *   - it comes from an `aria-describedby` ASSOCIATION, not from `title` — a
 *     tooltip is not shown on keyboard focus, not shown on touch, and not
 *     announced by every screen reader, and it would satisfy a bare "has a
 *     description" check (measured in the control: `title` computes to a
 *     description);
 *   - every id it names RESOLVES. A dangling IDREF computes to "" and is the
 *     silent way this feature breaks — pinned separately so the failure says
 *     "points at an id nothing has" rather than "no description";
 *   - and at least one of those elements is INSIDE THE BANNER. That is the
 *     difference between an association and a coincidence: a second copy of the
 *     sentence, parked next to the button, is a text that can drift from the
 *     banner it paraphrases, and the copy the user hears is the one nobody
 *     edits. Pointing into the banner also makes the allow-case structural —
 *     the description cannot outlive the offer, because the element it names
 *     goes away with it.
 *
 * WHAT WOULD BREAK IT: today's implementation, which has no association at all,
 * fails the first assertion of the pin. A `title` fails the second. A hard-coded
 * `aria-describedby` pointing at an id that is not rendered fails the third. A
 * duplicate sentence outside the banner fails the fourth. An explanation left
 * on the button after Restore fails the mutation half, and an explanation
 * present on a form with no offer at all fails the allow-case — which is what
 * stops "always describe the button" from being a way through.
 * ────────────────────────────────────────────────────────────────────────── */

describe("control — where an accessible description is heard, and where it is not", () => {
  /**
   * NOT A TEST OF THE EDITOR, and it passes on its first run, which for a
   * control is the right outcome — section 0 works the same way. It measures
   * the computation every assertion in 8e-bis rests on, against a static tree
   * with no component in it, so that "the held button has no description" below
   * is a fact about the button rather than about a matcher that resolves
   * nothing for anybody.
   */
  it("resolves an association on the control, and resolves nothing from the fieldset", () => {
    render(
      <div>
        <section role="region" title="Unsaved draft">
          <p id="probe-reason">{"Answer this first."}</p>
        </section>
        <fieldset disabled aria-describedby="probe-reason">
          <button type="button">{"described by its fieldset"}</button>
        </fieldset>
        <fieldset disabled>
          <button type="button" aria-describedby="probe-reason">
            {"described by itself"}
          </button>
        </fieldset>
        <fieldset disabled>
          <button type="button" aria-describedby="probe-nothing">
            {"pointing at nothing"}
          </button>
        </fieldset>
        <fieldset disabled>
          <button type="button" title="a tooltip">
            {"described by a tooltip"}
          </button>
        </fieldset>
      </div>,
    );
    const button = (name: RegExp) => screen.getByRole("button", { name });

    // The matcher works at all — without this every "no description" result
    // below is indistinguishable from a matcher that never finds one.
    expect(button(/described by itself/)).toHaveAccessibleDescription("Answer this first.");

    // THE REASON THE SUBJECT IS THE BUTTON. The hold is on the fieldset and the
    // reason on the fieldset is heard by nobody at the control.
    expect(
      button(/described by its fieldset/),
      "a description on the fieldset now reaches the control inside it: the subject choice in this section's docblock needs revisiting",
    ).toHaveAccessibleDescription("");

    // The two ways a description can be present and worthless.
    expect(button(/pointing at nothing/)).toHaveAccessibleDescription("");
    expect(
      button(/described by a tooltip/),
      "a title would satisfy a bare has-a-description check, which is why the pin asks for the association",
    ).toHaveAccessibleDescription("a tooltip");

    // And the hold itself really is in force in this tree, so the measurements
    // above are about disabled controls rather than live ones.
    expect(button(/described by itself/)).toBeDisabled();
  });
});

describe("entry editor — the held Save button says why it is held", () => {
  /** The §7.3 entry's own key: an EDIT scopes its draft on the document URL. */
  const EDIT_KEY = draftKeyFor(OWNER, ARRIVAL_URL);
  const editDraft = () =>
    JSON.stringify(
      seededDraft({
        headline: "Arrival, rewritten on the train",
        story: "The version the browser kept when the tab died.",
      }),
    );

  /** The ids an element points its description at, in order. Spelled out rather
   *  than inferred from the computed string: what has to be true is that the
   *  description is an ASSOCIATION with the banner, and the computed string
   *  alone cannot tell an association from a duplicate sentence. */
  const describedByIds = (el: Element): string[] =>
    (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");

  /**
   * ON AN EDIT, for 8e's reason: on a CREATE the form behind the banner is
   * empty and the hold costs nothing, while on an EDIT it stands between the
   * owner and an entry that is already loaded. The hold is also on real timers
   * here — nothing below touches the debounce.
   */
  it("names the banner as the reason it cannot be pressed, and explains nothing when there is nothing to answer", async () => {
    const entry = await specEntry();
    const fake = fakeStudioSession();

    /* THE ALLOW-CASE FIRST: no offer, so no hold, so nothing to explain. A rule
       that only ever demanded a description would be satisfied by a button that
       carries one permanently — announced on every encounter, for a hold that
       is not in force. */
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });
    expect(screen.queryAllByRole("region", { name: /draft/i })).toEqual([]);
    expect(saveButton(), "premise: nothing is outstanding, so nothing is held").toBeEnabled();
    expect(
      saveButton(),
      "the Save button explains a hold that is not in force: this description is announced every time anyone meets the button",
    ).not.toHaveAccessibleDescription();
    cleanup();

    /* THE PIN. */
    const store = fakeStorage({ [EDIT_KEY]: editDraft() });
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    // The offer is real and it is this editor's own key that produced it —
    // without both, everything below is about a screen with no banner on it,
    // which an editor that explains nothing would pass.
    const banner = screen.getByRole("region", { name: /draft/i });
    expect(store.calls.get, "the editor never looked for a draft at this key").toContain(EDIT_KEY);
    expect(
      saveButton(),
      "premise: 8e says this button is held while an offer is outstanding",
    ).toBeDisabled();

    // 1. THERE IS AN EXPLANATION AT ALL, and it is computed at the button.
    expect(
      saveButton(),
      'the held Save button has no accessible description: a screen reader announces "Save entry, button, unavailable" and no reason at all',
    ).toHaveAccessibleDescription();

    // 2. IT IS AN ASSOCIATION. A `title` computes to a description too (see the
    //    control above) and is the wrong mechanism for this.
    const ids = describedByIds(saveButton());
    expect(
      ids,
      "the held Save button has a description but no aria-describedby: a title is not shown on keyboard focus, not shown on touch, and not announced everywhere",
    ).not.toEqual([]);

    // 3. EVERY ID RESOLVES. A dangling IDREF computes to "" and is how this
    //    feature breaks without anything on screen changing.
    const dangling = ids.filter((id) => document.getElementById(id) === null);
    expect(dangling, "the Save button's description points at ids nothing in the document has").toEqual(
      [],
    );

    // 4. AND IT NAMES THE BANNER, which is the whole point: the reason has to be
    //    the offer the owner is being asked to answer, not a second copy of its
    //    sentence that can drift from it.
    const named = ids.map((id) => document.getElementById(id)!);
    expect(
      named.some((el) => banner.contains(el)),
      "the Save button is described, but by something outside the unsaved-draft banner: the banner explaining the draft somewhere on the page is not the same as the button naming it as the reason",
    ).toBe(true);

    /* THE MUTATION HALF: answer the banner and the explanation goes with it.
       An implementation that describes the button unconditionally passes
       everything above and fails here, and so does one whose reason text
       outlives the offer it is about. */
    fireEvent.click(within(banner).getByRole("button", { name: "Restore" }));

    expect(saveButton(), "Restore did not give the Save button back").toBeEnabled();
    expect(
      saveButton(),
      "the Save button still explains a hold the owner has just answered",
    ).not.toHaveAccessibleDescription();
  });
});

/* ──────────────────────────── 8f. the editor that goes away mid-sentence ── */

/**
 * AN UNMOUNT IS NOT A REASON TO THROW THE TYPING AWAY.
 *
 * THE DEFECT. The write effect's cleanup calls `clearTimeout(handle)`
 * unconditionally, so an unmount with a window in flight loses up to 800ms of
 * typing. That is routine rather than exotic: `components/studio/studio-shell/studio-shell.tsx`
 * flips `view.status` on session expiry and stops rendering the editor, so an
 * expiring Solid token takes the last sentence with it.
 *
 * ON UNMOUNT, AND NOT ON EVERY CLEANUP — the distinction is the whole
 * difficulty, and it is already pinned by the other half of the pair. React
 * runs that same cleanup on every dependency change, which here is every
 * keystroke, so an implementation that flushes unconditionally turns the
 * debounce into a write per keystroke and 8a's "restarts the window on every
 * change, and coalesces the typing into one write" goes red. Neither test is
 * complete without the other; do not relax one to satisfy the other.
 *
 * WHAT WOULD BREAK IT: restoring the unconditional `clearTimeout` in the
 * effect's cleanup.
 */
describe("entry editor — an editor that goes away mid-sentence", () => {
  it("flushes the pending window on unmount instead of dropping it", async () => {
    await withFakeTimers(FIRST);
    const store = fakeStorage();
    await renderEditor(fakeStudioSession().session, { storage: store.storage });

    setText(LABEL.headline, "Rain on the Philosopher's Path");
    setText(LABEL.articleBody, "Two hours of drizzle and nobody else on the path.");

    /**
     * ONE MILLISECOND SHORT, AND THE CLOCK IS FAKE, so this cannot pass by the
     * window having elapsed on its own — the shape that races. Under
     * `vi.useFakeTimers` time moves only when this test moves it, and the
     * assertion right here is the proof that it has not.
     */
    tick(DEBOUNCE - 1);
    expect(
      store.calls.set,
      "the window elapsed before the unmount, so this test would prove nothing",
    ).toEqual([]);

    // The session expires, or the shell stops rendering the editor, or the
    // owner navigates. React unmounts, and the typing must not go with it.
    cleanup();

    expect(store.calls.set, "the last window of typing was dropped on unmount").toHaveLength(1);
    const [written] = store.calls.set;
    expect(written.key).toBe(draftKeyFor(OWNER, NEW_SCOPE));

    const payload = parseDraft(written.value);
    // The mutation half: what was flushed is what was being typed, not an empty
    // form flushed for the sake of flushing something.
    expect(payload.headline).toBe("Rain on the Philosopher's Path");
    expect(payload.story).toBe("Two hours of drizzle and nobody else on the path.");
    // Nine fields and an offset, exactly as a debounced write would have left
    // them (§6): a flush that took a different path to storage must not produce
    // a payload `readDraft` would refuse.
    expect(Object.keys(payload).sort()).toEqual(DRAFT_FIELDS);
    expect(payload.savedAt).toBe(FIRST_STAMP);

    // A FLUSH, NOT A RESURRECTION. Nothing may fire afterwards from a timer the
    // unmount left running — the component is gone and its `setStorageRefused`
    // with it.
    tick(DEBOUNCE * 3);
    expect(store.calls.set, "a timer fired after the component had unmounted").toHaveLength(1);
  });
});

/* ─────────────────────── 8g. the key the editor owns, once a create lands ── */

/**
 * AFTER A CREATE SUCCEEDS THE EDITOR IS EDITING, AND ITS DRAFT KEY HAS TO SAY SO.
 *
 * THE DEFECT. `target` is set the moment step 1 completes, but `scope` stays
 * `new`, so everything typed afterwards is autosaved under the create key while
 * carrying the created entry's slug. Close the tab; open a fresh create form
 * tomorrow; the banner offers it; Restore fills the slug and the trip — the
 * address is not fixed on a fresh mount — and Save sends `If-None-Match: *` to
 * a URL that now exists. §10's 412 then tells the owner the entry "changed
 * elsewhere, or in another tab", which is not what happened and not something
 * they can act on.
 *
 * THE COMPONENT'S OWN DOCBLOCK OVERSTATES THE DANGER OF THE FIX, and the next
 * reader should not inherit a justification that is not true. It says keying on
 * `target` "would clear a key nothing was ever stored under and leave the real
 * draft behind". On an EDIT that is false: `target.url` IS
 * `documentUrlOf(initial.entry.iri)`, the two derivations agree, and 8a's
 * "keys an edit on the entry document URL" pins that key from the other side.
 * The only place they diverge is after a create — which is this defect, not an
 * argument against fixing it. What IS true, and is asserted below, is that the
 * save must clear the key it had been WRITING under, not the one it is about to
 * move to.
 *
 * WHAT WOULD BREAK IT: leaving `scope` derived from `initial` alone (today);
 * or moving the scope but letting `forgetDraft` clear the new key, which
 * strands the create's draft under `new`.
 */
describe("entry editor — the draft key after a create succeeds", () => {
  const NEW_KEY = draftKeyFor(OWNER, NEW_SCOPE);
  const CREATED_SLUG = "2026-04-02-kyoto";
  const CREATED_URL = `${JAPAN.entriesContainer}${CREATED_SLUG}.ttl`;
  const CREATED_KEY = draftKeyFor(OWNER, CREATED_URL);

  /** Long enough for a debounced write to have happened, on the real clock.
   *  8c waits the same way and for the same reason: this section needs `waitFor`
   *  and MSW, so fake timers are not available to it. */
  const pastTheWindow = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 400));
    });

  /** Every draft key currently in the store, so an orphan under a stale key is
   *  a failure of the whole assertion rather than something a targeted lookup
   *  could miss. */
  const draftKeys = (store: ReturnType<typeof fakeStorage>) =>
    [...store.items.keys()].filter((k) => k.startsWith("wig.draft."));

  it("moves the scope onto the entry it just created, and strands nothing under `new`", async () => {
    const pod = podFake();
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    fillNewEntry();
    await clickSaveAndWait();

    // The create really happened, at the address the key below is derived from.
    expect(pod.entryPut()?.url, "no entry was created, so there is no scope to move").toBe(
      CREATED_URL,
    );
    // AND THE SAVE CLEARED THE KEY IT HAD BEEN WRITING UNDER, which is still
    // `new` at that moment: the scope moves after the create, not before it.
    expect(store.calls.remove, "the create's own draft key was never cleared").toContain(NEW_KEY);
    expect(store.items.has(NEW_KEY)).toBe(false);

    // The owner keeps writing. This is an edit of a resource that exists now.
    expect(
      typeAsUser(LABEL.articleBody, "Two hours of drizzle, and then the rain stopped."),
      "the story field is not writable after a create",
    ).toBe(true);
    await pastTheWindow();

    expect(
      draftKeys(store),
      "the editor is still autosaving under `new` after the entry was created",
    ).toEqual([CREATED_KEY]);
    expect(parseDraft(store.items.get(CREATED_KEY)!).story).toBe(
      "Two hours of drizzle, and then the rain stopped.",
    );

    /* THE HARM ITSELF, end to end: tomorrow's create form must be clean. */
    cleanup();
    await renderEditor(fake.session, { storage: store.storage });
    expect(screen.getAllByLabelText(LABEL.headline), "the fresh form did not render").toHaveLength(
      1,
    );
    expect(
      screen.queryAllByRole("region", { name: /draft/i }),
      "a fresh create form was offered the text of an entry that already exists",
    ).toEqual([]);

    /**
     * AND THE BANNER IS NOT SIMPLY BROKEN. Without this the assertion above
     * passes against an editor that offers nothing, ever — the vacuous shape.
     * Same storage, same mount, one legitimate create draft put back by hand.
     */
    cleanup();
    store.items.set(NEW_KEY, JSON.stringify(seededDraft()));
    await renderEditor(fake.session, { storage: store.storage });
    expect(screen.getAllByRole("region", { name: /draft/i })).toHaveLength(1);
  });

  /**
   * THE KEYSTROKES MADE WHILE THE POD WAS ANSWERING.
   *
   * THE DEFECT. `save()` snapshots the form before awaiting; `forgetDraft()`
   * then clears the key and sets `touched.current = false` on the assumption
   * that the form equals what was written. Anything typed during the round trip
   * is at that point in neither the Pod nor the draft, and nothing is armed
   * again until the next keystroke. Close the tab on that sentence and it never
   * existed.
   *
   * BOTH HALVES ARE ASSERTED, and the first is what makes the second mean
   * something: the entry PUT is inspected to show the in-flight text really did
   * NOT reach the Pod. Without it, "the text is in storage" would also hold for
   * a save that had quietly included it.
   *
   * THE PREMISE, stated out loud because a later change could invalidate it:
   * the form is writable during a save. 8e holds the form while an OFFER is
   * outstanding and for no other reason. If someone later holds it during the
   * round trip as well, `typeAsUser` returns `false`, this test fails on that
   * line, and the right response is to revisit this test deliberately rather
   * than to quietly swap the helper for a bare `fireEvent`.
   *
   * WHAT WOULD BREAK IT: clearing the draft unconditionally on a completed
   * step 1, as today.
   */
  it("keeps what was typed while the save was in flight", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pod = podFake({ hold: held });
    const store = fakeStorage();
    await renderEditor(fakeStudioSession().session, { storage: store.storage });

    const SAVED_STORY = "Two hours of drizzle and nobody else on the path.";
    const IN_FLIGHT = `${SAVED_STORY} And then it stopped, somewhere near Ginkaku-ji.`;

    fillNewEntry();
    await act(async () => {
      fireEvent.click(saveButton());
    });

    // The round trip is open: the Pod has the request and has not answered.
    await waitFor(() => expect(pod.entryPut(), "the entry PUT never went out").toBeDefined());
    // While it is, the save control says so — the existing `disabled={saving}`
    // and `aria-busy` contract, asserted at the one moment it is true. A
    // `<fieldset disabled>` added for 8e must not have swallowed either.
    expect(saveButton()).toBeDisabled();
    expect(saveButton().getAttribute("aria-busy")).toBe("true");

    // The owner writes one more sentence while waiting.
    expect(
      typeAsUser(LABEL.articleBody, IN_FLIGHT),
      "the form was not writable during the save, so this test's premise no longer holds",
    ).toBe(true);

    release();
    await waitFor(() => expect(outcomeText()).not.toBe(""));

    // IT NEVER REACHED THE POD: what was written is the snapshot taken before
    // the await, which is exactly why the local copy has to survive.
    const put = pod.entryPut()!;
    const body = oneObject(quadsOf(put.body, put.url), `${put.url}#it`, SCHEMA.articleBody)?.value;
    expect(body, "the in-flight text reached the Pod, so this test proves nothing").toBe(
      SAVED_STORY,
    );

    // SO IT HAS TO BE IN STORAGE — and under the key this editor owns now that
    // the entry exists, not stranded under `new`. See the test above.
    await pastTheWindow();
    expect(
      draftKeys(store),
      "the text typed during the save is in neither the Pod nor storage",
    ).toEqual([CREATED_KEY]);
    expect(parseDraft(store.items.get(CREATED_KEY)!).story).toBe(IN_FLIGHT);
  });

  /**
   * THE SAME LOSS, ON THE THREE FIELDS THE STORY TEST CANNOT SEE — ONE CASE
   * EACH, WHICH IS THE WHOLE REASON THIS IS PARAMETERISED.
   *
   * `settleDraft` clears the local copy the moment the Pod has the text, and
   * re-keeps it only when `sameText` says the form has moved on since the
   * snapshot the save sent. `sameText` compares field by field, so a field it
   * omits is a field whose in-flight edit is in NEITHER the Pod nor storage:
   * the save reports success, the draft is cleared, and the sentence typed
   * while the spinner was up never existed.
   *
   * The place text is where that is worst rather than merely annoying. §9 drops
   * the coordinate inside the home radius, so near home these three are the
   * ONLY thing the entry says about where it was — and a place name is exactly
   * the kind of thing an owner types while waiting, having just remembered it.
   * `sameText`'s own docblock leans on that: "So are the three place fields, and
   * there the loss is the one §9 leans on."
   *
   * ONE FIELD PER CASE, AND EACH CASE TOUCHES NOTHING ELSE, because that is
   * what makes each comparison pinned SEPARATELY. A single test that typed all
   * three would go green with two of the three comparisons deleted — the one
   * survivor would report "different" and the draft would be re-kept for a
   * field the assertion was not about. That is precisely how this pin was
   * unpinned for `locality` and `country`: the re-reviewer deleted both
   * comparisons from `sameText` and the suite stayed green, while the docblock
   * went on claiming all three.
   *
   * WHAT WOULD BREAK IT: dropping any ONE of `a.placeName === b.placeName`,
   * `a.locality === b.locality` or `a.country === b.country` from `sameText` —
   * each takes exactly one case below with it, and nothing else in this file
   * notices.
   *
   * THE WAIT ON `precision` IS LOAD-BEARING IN EVERY CASE. §7.6's settings
   * arrive over the network and set `precision` from `""` to the owner's preset,
   * so without it that happens DURING the flight and `sameText` differs on
   * `precision` as well — the draft is then re-kept for a reason that has
   * nothing to do with the field under test. Measured rather than reasoned
   * about: with the three place comparisons deleted, the differing fields at
   * settle time were `["precision", "placeName"]` and every assertion below
   * still passed. It is one wait in one place here for the same reason the cases
   * are parameterised: three copies of it are three chances to lose one.
   */
  const IN_FLIGHT_PLACE = [
    ["place name", LABEL.placeName, "placeName", "Gion, Kyoto"],
    ["town or city", LABEL.locality, "locality", "Kyoto"],
    ["country", LABEL.country, "country", "JP"],
  ] as const;

  it.each(IN_FLIGHT_PLACE)(
    "keeps a %s typed while the save was in flight",
    async (what, label, field, IN_FLIGHT) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      const pod = podFake({ hold: held });
      const store = fakeStorage();
      await renderEditor(fakeStudioSession().session, { storage: store.storage });

      /* THE SETTINGS MUST LAND BEFORE THE SNAPSHOT IS TAKEN — see the docblock
         above; this line is the difference between a real pin and a vacuous
         one, and it has already been the difference once. */
      await waitFor(() => expect(screen.getByLabelText(LABEL.precision)).toBeEnabled());

      fillNewEntry();
      await act(async () => {
        fireEvent.click(saveButton());
      });
      await waitFor(() => expect(pod.entryPut(), "the entry PUT never went out").toBeDefined());

      expect(
        typeAsUser(label, IN_FLIGHT),
        "the form was not writable during the save, so this test's premise no longer holds",
      ).toBe(true);

      release();
      await waitFor(() => expect(outcomeText()).not.toBe(""));

      // It never reached the Pod: the save sent the snapshot taken before the
      // await, and that snapshot said nothing about the place at all — no
      // `<#place>`, so no name, no locality and no country either.
      const put = pod.entryPut()!;
      expect(
        placeNodeOf(quadsOf(put.body, put.url), put.url),
        `the in-flight ${what} reached the Pod, so this case proves nothing`,
      ).toBeUndefined();

      // So it has to be in storage, under the key this editor owns now.
      await pastTheWindow();
      expect(
        draftKeys(store),
        `the ${what} typed during the save is in neither the Pod nor storage`,
      ).toEqual([CREATED_KEY]);
      expect(
        parseDraft(store.items.get(CREATED_KEY)!)[field],
        `the draft was re-kept but the ${what} is not in it`,
      ).toBe(IN_FLIGHT);
    },
  );
});

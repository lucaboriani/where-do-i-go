// @vitest-environment jsdom
/** The studio's entry editor: section 8, first five describes — the local draft's autosave, banner, clearing, quota and hold.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  ARRIVAL_URL,
  DEBOUNCE,
  DRAFT_FIELDS,
  type EditorModule,
  FIRST,
  FIRST_STAMP,
  JAPAN,
  LABEL,
  NEW_SCOPE,
  OWNER,
  PERU,
  SCENARIOS,
  SECOND,
  SECOND_STAMP,
  SETTINGS_URL,
  SPEC_CREATED,
  accessOutcome,
  clickSaveAndWait,
  draftKeyFor,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  importModule,
  oneObject,
  outcomeText,
  parseDraft,
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
import { describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DCTERMS, SCHEMA } from "@/lib/vocab";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 8. THE LOCAL DRAFT — `localStorage` autosave of in-progress text.
 *
 * `docs/decisions.md` §10, which is also the whole justification: offline is
 * deferred, and "in the meantime the studio autosaves in-progress text to
 * localStorage, because losing a long entry in a hostel is what kills the
 * habit." TODO.md carries it as the last open item of phase 2.
 *
 * THE MODULE IS lib/studio/drafts.ts AND IT IS TESTED SEPARATELY, in
 * test/drafts.test.ts: the key scheme, the Zod parse, and the promise that
 * nothing it does ever throws. THIS section is about the WIRING — what the
 * editor writes, when it writes it, what it offers on mount, and the two
 * moments a draft must disappear.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS FAKED HERE, AND WHY IT IS NOT THE MODULE.
 *
 *   the storage    A plain object, injected through the new `storage` prop. Not
 *                  a mock of lib/studio/drafts.ts: the key scheme, the schema
 *                  and the debounce all run for real, and what this file
 *                  observes is what the editor asked the BROWSER to store. A
 *                  spy on `writeDraft` would pass against an editor that
 *                  persisted an ETag, because the ETag would be inside the
 *                  argument nobody looked at.
 *   the key        Spelled out again below rather than imported. If the editor
 *                  and the module ever disagree about it, both files fail —
 *                  which is the point; a shared helper would agree with itself
 *                  while the owner's draft went missing.
 *   the clock      `vi.setSystemTime`, for the reason section 7b gives at
 *                  length: two test-driven writes land in the same second, so
 *                  `savedAt` asserted against an uncontrolled clock is an
 *                  assertion that cannot fail.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CONTRACT THIS SECTION ASSERTS, since it is being designed here:
 *
 *   - a new optional prop `storage?: StorageLike`, defaulting to `localStorage`
 *   - an exported `DRAFT_DEBOUNCE_MS`
 *   - on mount, and only in an effect: read the draft for this editor's key. If
 *     there is one, render a `region` landmark named "Unsaved draft" —
 *     deliberately distinct from the `status`/`alert` the save outcome already
 *     owns — containing a `<time dateTime={savedAt}>` and two buttons,
 *     `Restore` and `Discard`. The form is untouched until one of them is
 *     clicked.
 *
 *     WHAT SHIPS IS `<section role="region" title="Unsaved draft">`, AND THE
 *     NAME COMES FROM `title` RATHER THAN FROM `aria-label` ON PURPOSE. This
 *     docblock said `aria-label` while the component said `title` for one
 *     review cycle, which is the wrong way round: the component is right and
 *     the reason is measured (see the comment above the banner in
 *     components/studio/entry-editor/entry-editor.tsx). @testing-library matches
 *     `aria-label` on ANY element, not only on form controls, and this screen
 *     already has a control whose label matches the same words — the Status
 *     select, since `LABEL.status` is /status|publish|draft/i. An `aria-label`
 *     here therefore makes `getByLabelText(LABEL.status)` ambiguous, and every
 *     helper that fills the form while the banner is up dies on "found multiple
 *     elements" instead of on anything real. `role="region"` is explicit for
 *     the other half: a bare `<section>` named only by `title` is not given the
 *     region role, so it would be unfindable as the landmark it is.
 *   - if `setItem` fails, one quiet `role="note"` line under the form. It is
 *     NOT `status` and NOT `alert`: those two are the save's, and a Pod save is
 *     completely unaffected by a browser that will not keep a local copy.
 * ════════════════════════════════════════════════════════════════════════ */

/** A second person signing in on the same browser. */
const SOMEONE_ELSE = "https://borrowed-laptop.example/profile/card#me";

/** Safari private mode, on the very first setItem: it reports a zero quota
 *  rather than refusing storage outright, so the failure arrives at write time
 *  and not at feature-detection time. */
const QUOTA = new DOMException("The quota has been exceeded.", "QuotaExceededError");

/* ───────────────────────────────────────────────────── 8a. when it writes ── */

describe("entry editor — the autosave debounce", () => {
  it("exports the interval this section drives", async () => {
    // Not a restatement of a constant: the editor is what the studio ships, and
    // a debounce that lives only in this file's head is one nobody can change
    // on purpose.
    const mod = (await importModule("@/components/studio/entry-editor")) as EditorModule;
    expect(mod.DRAFT_DEBOUNCE_MS).toBe(DEBOUNCE);
  });

  /**
   * BOTH HALVES, and they are why this test is worth having.
   *
   * "Eventually written" passes with the debounce deleted — a write per
   * keystroke satisfies it — and "not written immediately" passes if the
   * autosave is broken entirely. Only the pair says anything.
   */
  it("writes nothing before the interval elapses, and exactly one draft after it", async () => {
    await withFakeTimers(FIRST);
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    fillNewEntry();

    // FIRST HALF: one millisecond short.
    tick(DEBOUNCE - 1);
    expect(store.calls.set, "a draft was stored before the debounce elapsed").toEqual([]);

    // SECOND HALF: the millisecond that completes it.
    tick(1);
    expect(store.calls.set).toHaveLength(1);

    const [written] = store.calls.set;
    expect(written.key).toBe(draftKeyFor(OWNER, NEW_SCOPE));
    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort()).toEqual(DRAFT_FIELDS);
    expect(payload.headline).toBe("Rain on the Philosopher's Path");
    expect(payload.story).toBe("Two hours of drizzle and nobody else on the path.");
    expect(payload.tripIri).toBe(JAPAN.iri);
    expect(payload.slug).toBe("2026-04-02-kyoto");
    expect(payload.occurred).toBe("2026-04-02T16:20");
    expect(payload.tagsText).toBe("walking, rain");
    expect(payload.mode).toBe("Train");
    expect(payload.status).toBe("published");
  });

  /**
   * A debounce, not a throttle and not an interval: each keystroke restarts the
   * window. Typing for a minute must leave one write, not seventy — and an
   * implementation on `setInterval(800)` would fire at 800ms here, which is the
   * one thing this test is shaped to catch.
   */
  it("restarts the window on every change, and coalesces the typing into one write", async () => {
    await withFakeTimers(FIRST);
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    setText(LABEL.headline, "Rain");
    tick(500);
    setText(LABEL.headline, "Rain on the");
    tick(500);
    // 1000ms since the first change, 500 since the last: an interval or a
    // throttle has fired by now, a debounce has not.
    expect(store.calls.set, "the window did not restart on the second change").toEqual([]);

    tick(301);
    expect(store.calls.set).toHaveLength(1);
    expect(parseDraft(store.calls.set[0].value).headline).toBe("Rain on the");
  });

  /**
   * `savedAt` IS THE MOMENT OF THE WRITE, and this test is only capable of
   * failing because the clock is controlled: `nowWithOffset()` has second
   * granularity, so two writes driven by a test land on the same string and a
   * `savedAt` frozen at mount would be indistinguishable from a correct one.
   * The two stamps below are seven and a half minutes apart by construction.
   */
  it("stamps savedAt with an offset, and moves it on the next write", async () => {
    await withFakeTimers(FIRST);
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    setText(LABEL.headline, "Rain on the Philosopher's Path");
    tick(DEBOUNCE);
    expect(store.calls.set).toHaveLength(1);
    expect(parseDraft(store.calls.set[0].value).savedAt).toBe(FIRST_STAMP);

    vi.setSystemTime(SECOND);
    setText(LABEL.headline, "Rain on the Philosopher's Path, later");
    tick(DEBOUNCE);
    expect(store.calls.set).toHaveLength(2);
    const second = parseDraft(store.calls.set[1].value);

    expect(second.savedAt).toBe(SECOND_STAMP);
    // §6, and here it is what the banner's <time datetime> is built from: an
    // offsetless local time is not an instant, and the banner would tell the
    // owner the wrong hour.
    expect(String(second.savedAt)).toMatch(/[+-]\d{2}:\d{2}$/);
    expect(String(second.savedAt)).not.toMatch(/Z$/);
    // The mutation half: the second write really is the later text.
    expect(second.headline).toBe("Rain on the Philosopher's Path, later");
  });

  /**
   * AN UNTOUCHED FORM IS NOT A DRAFT.
   *
   * A `useEffect` keyed on the form values fires once on mount, so the naive
   * implementation stores a copy of whatever the editor opened with. Opening an
   * entry, reading it and navigating away would then leave an "Unsaved draft"
   * banner waiting next time, offering to restore exactly what is already on
   * the Pod — and once the banner appears for entries nobody edited, it stops
   * meaning anything and gets clicked away by reflex.
   *
   * Both modes, because they fail differently: a create would store nine empty
   * strings, an edit a duplicate of the resource.
   */
  it("stores nothing at all while nobody has typed", async () => {
    await withFakeTimers(FIRST);
    const fake = fakeStudioSession();

    const onCreate = fakeStorage();
    await renderEditor(fake.session, { storage: onCreate.storage });
    tick(DEBOUNCE * 5);
    expect(onCreate.calls.set, "an untouched create form stored a draft").toEqual([]);
    cleanup();

    vi.useRealTimers();
    const entry = await specEntry();
    await withFakeTimers(FIRST);

    const onEdit = fakeStorage();
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: onEdit.storage,
    });
    tick(DEBOUNCE * 5);
    expect(onEdit.calls.set, "an untouched edit form stored a draft").toEqual([]);

    // THE ALLOW-CASE, through the same storage and the same clock: one change
    // and it does store. Otherwise this passes against an editor that never
    // autosaves anything.
    setText(LABEL.headline, "First night in Shinjuku, being edited");
    tick(DEBOUNCE);
    expect(onEdit.calls.set).toHaveLength(1);
  });

  /**
   * THE SCOPE, AT THE WRITE END. An edit's draft is keyed on the entry document
   * URL — no fragment, the same string `documentUrlOf` produces — so it cannot
   * collide with the create form's, and two entries cannot collide with each
   * other.
   *
   * AND WHAT MUST NOT BE IN IT. This editor is holding an ETag, a
   * `dcterms:created` and a `schema:datePublished` at this moment; §10 says the
   * precondition is the ETag "from the read that produced this state", and a
   * draft outlives that read by however long the browser was closed. Restoring
   * one would be a blind PUT wearing a helpful hat.
   */
  it("keys an edit on the entry document URL, and persists no ETag or provenance", async () => {
    const entry = await specEntry();
    await withFakeTimers(FIRST);
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    setText(LABEL.headline, "First night in Shinjuku, revisited");
    tick(DEBOUNCE);

    expect(store.calls.set).toHaveLength(1);
    const [written] = store.calls.set;
    expect(written.key).toBe(draftKeyFor(OWNER, ARRIVAL_URL));
    expect(written.key).not.toBe(draftKeyFor(OWNER, NEW_SCOPE));

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort()).toEqual(DRAFT_FIELDS);
    // Named individually as well as by the set above, so the failure says which.
    for (const forbidden of ["etag", "created", "datePublished"]) {
      expect(Object.keys(payload), `${forbidden} was persisted`).not.toContain(forbidden);
    }
    // And the whole serialised value, in case one arrives under another name.
    expect(written.value).not.toContain("entry-7");
    expect(written.value).not.toContain(SPEC_CREATED);
    // The mutation half: this really is the edited text.
    expect(payload.headline).toBe("First night in Shinjuku, revisited");
  });

  /**
   * THE DEFAULT, which is what actually ships. Every other test in this section
   * injects a storage; if the prop had no default, or defaulted to something
   * inert, they would all still pass and the studio would autosave nothing.
   */
  it("defaults to the browser's own localStorage when nothing is injected", async () => {
    await withFakeTimers(FIRST);
    window.localStorage.clear();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    setText(LABEL.headline, "Rain on the Philosopher's Path");
    tick(DEBOUNCE);

    const raw = window.localStorage.getItem(draftKeyFor(OWNER, NEW_SCOPE));
    expect(raw, "nothing reached the browser's own localStorage").not.toBeNull();
    expect(parseDraft(raw!).headline).toBe("Rain on the Philosopher's Path");
  });
});

/* ─────────────────────────────────────────────────── 8b. what it offers ──── */

describe("entry editor — the unsaved-draft banner", () => {
  /**
   * QUERIED STRUCTURALLY, NOT BY ITS PROSE. The banner is the only `region` on
   * this screen — the save outcome owns `status` and `alert` — so the role plus
   * a loose name is the whole query. A test that matched a regex against some
   * sentence would be one rewording away from a false pass, which is a failure
   * this repository has already had (see section 7d).
   *
   * WHAT SHIPS IS `<section role="region" title="Unsaved draft">`, NOT
   * `aria-label`, and the difference is not cosmetic. `queryAllByLabelText`
   * matches `aria-label` on ANY element, so naming the banner that way puts it
   * in the results for `LABEL.status` — /status|publish|draft/i, which "Unsaved
   * draft" matches — alongside the real Status select. Section 8c then fails
   * with "found multiple elements" while filling the form: the wrong test, the
   * wrong control, and a message nobody would trace back to this attribute.
   *
   * THAT CRYPTIC COLLISION WAS, UNTIL THE TEST BELOW, THE ONLY THING PINNING
   * THE SPELLING — an indirect pin whose failure names neither the banner nor
   * the attribute. `title` also looks like the tidy-up an unwary reader would
   * "correct" to `aria-label`. So it is pinned directly now, at the place the
   * mistake gets made; leave both halves in place.
   */
  const banner = () => screen.getByRole("region", { name: /draft/i });
  const noBanner = () => screen.queryAllByRole("region", { name: /draft/i });

  /**
   * THE DIRECT PIN the docblock above promises, and the reason it exists is
   * that the alternative is a failure in another section naming another
   * control. Two halves, both needed: the banner IS named — a region nobody can
   * name is not a landmark — and it is named by the ONE mechanism that does not
   * land in `getByLabelText`.
   */
  it("takes its name from title, so it cannot shadow the Status control", async () => {
    const store = fakeStorage({
      [draftKeyFor(OWNER, NEW_SCOPE)]: JSON.stringify(seededDraft()),
    });
    await renderEditor(fakeStudioSession().session, { storage: store.storage });

    // It really is up. Without this the rest is a set of assertions about a
    // screen with no banner on it, all of which an editor rendering none passes.
    const region = banner();
    // `?? ""` so a missing attribute reports as an empty name that does not
    // match, rather than as "toMatch expects a string, but got object".
    expect(
      region.getAttribute("title") ?? "",
      "the region is not named by `title`",
    ).toMatch(/draft/i);
    expect(region.getAttribute("aria-label"), "the banner is named by aria-label").toBeNull();
    expect(region.getAttribute("aria-labelledby")).toBeNull();

    // THE BEHAVIOUR THAT BREAKS, which is the half worth having. `LABEL.status`
    // is /status|publish|draft/i and "Unsaved draft" matches it, so an ARIA
    // name here puts the banner in these results next to the real control.
    const named = screen.getAllByLabelText(LABEL.status);
    expect(named, "the banner is shadowing the Status control").toHaveLength(1);
    expect(named[0].tagName).toBe("SELECT");

    /**
     * AND NOT ONLY THE STATUS CONTROL. Every label this file queries by still
     * resolves to exactly one element with the banner up, which is the property
     * the eight `getByLabelText` calls inside `fillNewEntry` used to stand in
     * for — each of them throws on an ambiguous match, so filling the form was
     * an indirect way of asserting this eight times over.
     *
     * THAT CALL IS GONE FROM HERE ON PURPOSE. Since the fieldset landed (8e)
     * the eight controls are disabled while an offer is outstanding, so a real
     * browser delivers none of those keystrokes; `fireEvent` sets the values
     * anyway, and the comment that used to be on this line — "the form is still
     * fillable with the banner up" — described something nobody can do. The
     * loop below asserts what the call was actually for, at the one moment the
     * collision can happen, and says so directly.
     *
     * WHAT WOULD BREAK IT: spelling the banner's name `aria-label` or
     * `aria-labelledby` instead of `title`.
     */
    for (const [what, label] of Object.entries(LABEL)) {
      expect(
        screen.getAllByLabelText(label),
        `the banner is shadowing the ${what} control`,
      ).toHaveLength(1);
    }
  });

  it("offers a stored draft on mount, and changes nothing on the form until told to", async () => {
    const draft = seededDraft();
    const store = fakeStorage({
      [draftKeyFor(OWNER, NEW_SCOPE)]: JSON.stringify(draft),
    });
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    const region = banner();
    // WHEN it was saved, machine-readable. A human-readable string alone is not
    // enough: `<time>` without `datetime` is prose.
    const when = region.querySelector("time");
    expect(when, "the banner carries no <time>").not.toBeNull();
    expect(when!.getAttribute("datetime")).toBe(draft.savedAt);

    // Two ways out, both explicit. An exact accessible name, because "Restore"
    // and "Discard" are what the design says and a button whose name a test
    // cannot pin is a button a screen-reader user cannot find either.
    within(region).getByRole("button", { name: "Restore" });
    within(region).getByRole("button", { name: "Discard" });

    // THE POINT: nothing has been restored yet. An editor that filled the form
    // on mount would silently overwrite whatever the owner opened it with.
    expect((screen.getByLabelText(LABEL.headline) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(LABEL.articleBody) as HTMLTextAreaElement).value).toBe("");
    expect((screen.getByLabelText(LABEL.slug) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(LABEL.trip) as HTMLSelectElement).value).toBe("");
    // And it did look in the right place.
    expect(store.calls.get).toContain(draftKeyFor(OWNER, NEW_SCOPE));
  });

  /**
   * Three renders, one query. The two negatives are the interesting ones — a
   * corrupt value must not take the editor down with it, which is the whole
   * reason lib/studio/drafts.ts promises never to throw — and the positive at
   * the end is what stops "no banner, ever" passing all three.
   */
  it("offers nothing when there is no draft, or when the stored one is unusable", async () => {
    const key = draftKeyFor(OWNER, NEW_SCOPE);
    const fake = fakeStudioSession();

    await renderEditor(fake.session, { storage: fakeStorage().storage });
    expect(noBanner()).toEqual([]);
    expect(screen.getAllByLabelText(LABEL.headline)).toHaveLength(1);
    cleanup();

    // A tab killed mid-write.
    await renderEditor(fake.session, { storage: fakeStorage({ [key]: "{{{" }).storage });
    expect(noBanner()).toEqual([]);
    expect(screen.getAllByLabelText(LABEL.headline), "the editor did not render").toHaveLength(1);
    cleanup();

    // Valid JSON, wrong shape — a payload from a build whose form has moved on.
    const wrongShape = JSON.stringify({ ...seededDraft(), status: "archived" });
    await renderEditor(fake.session, { storage: fakeStorage({ [key]: wrongShape }).storage });
    expect(noBanner()).toEqual([]);
    expect(screen.getAllByLabelText(LABEL.headline)).toHaveLength(1);
    cleanup();

    // Storage disabled at the browser level: even reading throws.
    const hostile = fakeStorage({ [key]: JSON.stringify(seededDraft()) });
    hostile.fail.get = new DOMException("The operation is insecure.", "SecurityError");
    await renderEditor(fake.session, { storage: hostile.storage });
    expect(noBanner()).toEqual([]);
    expect(screen.getAllByLabelText(LABEL.headline)).toHaveLength(1);
    cleanup();

    // THE ALLOW-CASE, same query: a good draft IS offered.
    const good = fakeStorage({ [key]: JSON.stringify(seededDraft()) });
    await renderEditor(fake.session, { storage: good.storage });
    expect(screen.getAllByRole("region", { name: /draft/i })).toHaveLength(1);
  });

  /** One machine, two accounts. The text of an unfinished entry is not
   *  something to hand to whoever signs in next. */
  it("does not offer one person's draft to another", async () => {
    const store = fakeStorage({
      [draftKeyFor(SOMEONE_ELSE, NEW_SCOPE)]: JSON.stringify(
        seededDraft({ headline: "not yours to read" }),
      ),
    });

    await renderEditor(fakeStudioSession(OWNER).session, { storage: store.storage });
    expect(noBanner()).toEqual([]);
    cleanup();

    // THE ALLOW-CASE: the same storage, the same draft, the person it belongs to.
    await renderEditor(fakeStudioSession(SOMEONE_ELSE).session, { storage: store.storage });
    expect(screen.getAllByRole("region", { name: /draft/i })).toHaveLength(1);
  });

  it("Restore fills the form and dismisses the banner", async () => {
    const draft = seededDraft();
    const store = fakeStorage({ [draftKeyFor(OWNER, NEW_SCOPE)]: JSON.stringify(draft) });
    await renderEditor(fakeStudioSession().session, { storage: store.storage });

    fireEvent.click(within(banner()).getByRole("button", { name: "Restore" }));

    expect((screen.getByLabelText(LABEL.headline) as HTMLInputElement).value).toBe(draft.headline);
    expect((screen.getByLabelText(LABEL.articleBody) as HTMLTextAreaElement).value).toBe(draft.story);
    expect((screen.getByLabelText(LABEL.occurredAt) as HTMLInputElement).value).toBe(draft.occurred);
    expect((screen.getByLabelText(LABEL.tags) as HTMLInputElement).value).toBe(draft.tagsText);
    expect((screen.getByLabelText(LABEL.travelModeFrom) as HTMLSelectElement).value).toBe(draft.mode);
    expect((screen.getByLabelText(LABEL.status) as HTMLSelectElement).value).toBe(draft.status);
    // On a CREATE the address is still the owner's to choose, so it is restored
    // too — the edit case below is the one where it must not be.
    expect((screen.getByLabelText(LABEL.slug) as HTMLInputElement).value).toBe(draft.slug);
    expect((screen.getByLabelText(LABEL.trip) as HTMLSelectElement).value).toBe(draft.tripIri);

    // Restored once. Leaving the banner up invites a second click that would
    // overwrite whatever the owner typed after the first.
    expect(noBanner()).toEqual([]);
  });

  /**
   * ON AN EDIT, THE ADDRESS IS NOT TEXT. The trip and the slug are where the
   * resource LIVES: §11 guardrail 7 makes `dy:slug` the filename, and this
   * editor writes rather than moves. Both controls are disabled in edit mode
   * for exactly that reason, and a Restore that wrote through them would put
   * the form's idea of the address out of step with the resource it is about to
   * PUT.
   */
  it("Restore leaves the trip and the slug alone once the address is fixed", async () => {
    const entry = await specEntry();
    const draft = seededDraft({
      tripIri: PERU.iri,
      slug: "an-entirely-different-address",
      headline: "restored text",
      story: "restored story",
    });
    const store = fakeStorage({ [draftKeyFor(OWNER, ARRIVAL_URL)]: JSON.stringify(draft) });

    await renderEditor(fakeStudioSession().session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    fireEvent.click(within(banner()).getByRole("button", { name: "Restore" }));

    // THE PIN.
    expect((screen.getByLabelText(LABEL.slug) as HTMLInputElement).value).toBe("2026-03-29-arrival");
    expect((screen.getByLabelText(LABEL.trip) as HTMLSelectElement).value).toBe(JAPAN.iri);

    // THE MUTATION HALF: a Restore that did nothing at all would satisfy the
    // two lines above perfectly.
    expect((screen.getByLabelText(LABEL.headline) as HTMLInputElement).value).toBe("restored text");
    expect((screen.getByLabelText(LABEL.articleBody) as HTMLTextAreaElement).value).toBe(
      "restored story",
    );
  });

  /**
   * A RESTORED DRAFT MUST NOT RESURRECT A PRECONDITION.
   *
   * The payload seeded here carries an `etag`, a `created` and a
   * `datePublished` — the shape a future version of this feature would produce
   * if someone widened the schema, and the shape devtools produces today. The
   * module strips what it does not know (test/drafts.test.ts pins that), so the
   * banner still appears; what must not happen is any of the three reaching the
   * wire.
   *
   * `If-Match` is asserted on the request that really went out. A stale one is
   * a 412 the owner cannot act on at best, and at worst — if the resource has
   * cycled back to a matching tag — an overwrite of an edit made elsewhere.
   */
  it("a restored draft does not change the precondition or the provenance", async () => {
    const pod = podFake();
    const entry = await specEntry();
    const hostile = JSON.stringify({
      ...seededDraft({ headline: "restored text", slug: "2026-03-29-arrival", tripIri: JAPAN.iri }),
      etag: '"stale-99"',
      created: "2020-01-01T00:00:00+09:00",
      datePublished: "2020-01-01T00:00:00+09:00",
    });
    const store = fakeStorage({ [draftKeyFor(OWNER, ARRIVAL_URL)]: hostile });

    await renderEditor(fakeStudioSession().session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    fireEvent.click(within(banner()).getByRole("button", { name: "Restore" }));
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put).toBeDefined();
    expect(put!.url).toBe(ARRIVAL_URL);
    // THE PIN: the ETag is still the one from the read that produced this state.
    expect(put!.headers["if-match"]).toBe('"entry-7"');
    expect(put!.headers["if-none-match"]).toBeUndefined();

    const quads = quadsOf(put!.body, put!.url);
    const subject = `${put!.url}#it`;
    expect(oneObject(quads, subject, DCTERMS.created)?.value).toBe(SPEC_CREATED);
    expect(oneObject(quads, subject, SCHEMA.datePublished)?.value).toBe(entry.datePublished);
    // The mutation half: the restore really did reach the wire.
    expect(oneObject(quads, subject, SCHEMA.headline)?.value).toBe("restored text");
  });

  /**
   * Discard is the owner saying "that is not what I want" — so the draft has to
   * be GONE, not merely hidden. A banner dismissed without clearing storage
   * comes back on the next mount, and the second time it is clicked away
   * without being read.
   */
  it("Discard clears the stored draft, dismisses the banner, and leaves the form as it was", async () => {
    const key = draftKeyFor(OWNER, NEW_SCOPE);
    const store = fakeStorage({ [key]: JSON.stringify(seededDraft()) });
    await renderEditor(fakeStudioSession().session, { storage: store.storage });

    setText(LABEL.headline, "what the owner is actually writing");
    fireEvent.click(within(banner()).getByRole("button", { name: "Discard" }));

    expect(store.calls.remove).toContain(key);
    expect(store.items.has(key)).toBe(false);
    expect(noBanner()).toEqual([]);
    // The form is untouched: Discard throws away the STORED draft, not the text
    // on the screen.
    expect((screen.getByLabelText(LABEL.headline) as HTMLInputElement).value).toBe(
      "what the owner is actually writing",
    );
  });
});

/* ──────────────────────────────────────── 8c. when the draft must disappear ── */

/**
 * THE MOMENT THE POD HOLDS THE TEXT, the local copy stops being a backup and
 * becomes a trap: it is now older than the resource, and restoring it later
 * silently reverts an entry that was saved correctly.
 *
 * §10 makes that moment `report.completed.includes("entry")` and nothing else.
 * Two of its six outcomes complete step 1 and then fail — an unverified ACL, a
 * refused index — and in both the entry IS on the Pod. Keying the clear on "the
 * save reported no failure" would leave a stale draft behind in exactly the two
 * cases the owner is already being asked to do something about.
 *
 * The two where nothing was written are the mirror image, and they matter more:
 * §10's refused write and its 412 both leave the form as the only copy of the
 * owner's work, and section 7 already pins that the text stays on the screen.
 * The draft is the copy that survives the reload the 412 message asks for.
 */
describe("entry editor — clearing the draft after a save", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * WHAT THE RESTORED DRAFT SAYS, and it is deliberately not what
   * `fillNewEntry` types. The two used to be identical, which meant the entry
   * PUT looked the same whether the text came from the draft or from the form
   * — so "the save that cleared the draft was a save OF the draft" was
   * unassertable. These two strings make it assertable.
   */
  const RESTORED_HEADLINE = "Rain on the Philosopher's Path, kept overnight";
  const RESTORED_STORY = "Two hours of drizzle, and this is the copy that survived the crash.";

  /**
   * Runs a scenario from section 7 against a form filled BY RESTORING the draft
   * that is already in storage.
   *
   * IT CLICKS RESTORE, AND THAT IS THE WHOLE DIFFERENCE FROM WHAT THIS HELPER
   * USED TO DO. It used to leave the banner up and call `fillNewEntry()` — but
   * since the fieldset landed (8e) the eight controls are disabled while an
   * offer is outstanding, so that was eight keystrokes a real browser refuses,
   * green only because `fireEvent` ignores disabled state. Restore is the path
   * that actually reaches "a save clears the draft": it leaves the stored draft
   * exactly where it is — `restore()` touches state, never storage — and fills
   * the form from it, so everything below still measures what a save does to a
   * draft that is still on disk.
   *
   * THE RESTORED TEXT SATISFIES THE PRE-FLIGHT GUARD by construction — a trip
   * that is on offer, a slug, a headline — which is what keeps all six §10
   * scenarios reaching the Pod rather than dying in `save()`'s own guard. The
   * assertions immediately after the click are there so that a Restore which
   * quietly stopped filling any of the three fails HERE, naming the field,
   * instead of six scenarios later as "the entry needs a trip".
   *
   * AND IT TYPES ONE MORE THING AFTERWARDS, into a field nothing below pins.
   * That is not decoration: `restore()` sets state without a DOM event, so
   * `touched` stays false and NO autosave window is armed. The resurrection
   * test at the end of this section would then be asserting that a timer which
   * never existed did not fire — the vacuous shape. One keystroke on the
   * unlocked form arms a real window, and `typeAsUser` returning `true` is also
   * the proof that Restore unlocked the fieldset.
   */
  async function saveWithADraft(name: keyof typeof SCENARIOS) {
    const seeded = JSON.stringify(
      seededDraft({ headline: RESTORED_HEADLINE, story: RESTORED_STORY }),
    );
    const store = fakeStorage({ [KEY]: seeded });
    if (name === "aclUnverified") {
      accessOutcome.failure = {
        kind: "accessUnverified",
        url: `${JAPAN.entriesContainer}2026-04-02-kyoto.ttl`,
        expected: "public read",
        found: "unknown",
      };
    }
    const pod = podFake(SCENARIOS[name]);
    await renderEditor(fakeStudioSession().session, { storage: store.storage });

    // Non-vacuous by construction: the draft is demonstrably there immediately
    // before the save, so "it is gone afterwards" cannot pass by never having
    // existed.
    expect(store.items.get(KEY)).toBe(seeded);
    /**
     * AND THE EDITOR KNOWS ABOUT IT. Without this line the "kept" half of this
     * pair passes against an editor with no autosave at all — a draft nothing
     * reads is trivially a draft nothing deletes — which is precisely the
     * "green run that verified nothing" this repository is careful about. It is
     * also a real assertion after the fact: a draft kept under a key the editor
     * never looks at is not the surviving copy of anything.
     */
    expect(store.calls.get, "the editor never looked for a draft at this key").toContain(KEY);

    // The banner is up, and the form behind it is held (8e) — so the owner's
    // only way to a filled form is the one the owner actually has.
    const offer = screen.getByRole("region", { name: /draft/i });
    expect(screen.getByLabelText(LABEL.headline), "the form was not held").toBeDisabled();
    fireEvent.click(within(offer).getByRole("button", { name: "Restore" }));
    expect(
      screen.queryAllByRole("region", { name: /draft/i }),
      "Restore left the banner up",
    ).toEqual([]);

    // THE THREE THE PRE-FLIGHT GUARD ASKS FOR, plus the story, so a Restore
    // that filled nothing fails here rather than as a refusal six scenarios on.
    expect((screen.getByLabelText(LABEL.trip) as HTMLSelectElement).value).toBe(JAPAN.iri);
    expect((screen.getByLabelText(LABEL.slug) as HTMLInputElement).value).toBe("2026-04-02-kyoto");
    expect((screen.getByLabelText(LABEL.headline) as HTMLInputElement).value).toBe(
      RESTORED_HEADLINE,
    );
    expect((screen.getByLabelText(LABEL.articleBody) as HTMLTextAreaElement).value).toBe(
      RESTORED_STORY,
    );

    // One keystroke on the now-unlocked form: it arms the window the
    // resurrection test needs, and `true` is the proof the fieldset let go.
    // `tagsText` deliberately — nothing below pins it, so whichever copy of the
    // draft is at the key when a FAILED save's assertions run, seeded or
    // rewritten by that window, every field they do pin reads the same.
    expect(
      typeAsUser(LABEL.tags, "walking, rain, restored"),
      "the form is still held after Restore, so this scenario cannot be typed into",
    ).toBe(true);

    await clickSaveAndWait();

    /**
     * WHAT WENT TO THE POD IS THE RESTORED TEXT. Every scenario reaches the
     * entry PUT — the failing two are refused BY the Pod, after the request was
     * recorded — so this holds for all six, and it is what makes the rest of
     * this section a statement about a save OF the offered draft rather than of
     * whatever a helper happened to type.
     */
    const put = pod.entryPut();
    expect(put, "no entry PUT went out, so no scenario here says anything").toBeDefined();
    expect(
      oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, SCHEMA.headline)?.value,
      "the entry PUT does not carry the restored text",
    ).toBe(RESTORED_HEADLINE);

    return { store, pod, seeded };
  }

  it.each(["success", "aclUnverified", "indexRefused", "revalidateDown"] as const)(
    "%s: the entry reached the Pod, so the local draft is cleared",
    async (name) => {
      const { store, pod } = await saveWithADraft(name);
      // The entry PUT really happened — otherwise this asserts nothing about
      // "completed includes entry".
      expect(pod.entryPut()).toBeDefined();
      expect(store.calls.remove, "the draft was never cleared").toContain(KEY);
      expect(store.items.has(KEY)).toBe(false);
    },
  );

  /**
   * KEPT AND STILL USABLE — NOT FROZEN, AND THE DIFFERENCE IS THE WHOLE COMMENT.
   *
   * This pair used to assert `toBe(seeded)`: byte identity with the payload
   * `saveWithADraft` seeded. That over-specified, and it raced. The editor
   * deliberately does NOT cancel the pending autosave when a save FAILS — after
   * a refused write the form holds the newest copy of the owner's work, and
   * freezing the backup at whatever it was before a failed attempt is exactly
   * the wrong behaviour — so the keystroke `saveWithADraft` makes after Restore
   * leaves a live 800ms window running through the save (it was
   * `fillNewEntry()` that did this before Restore replaced it; the window is
   * the reason that keystroke is still there). This `describe` uses real
   * timers, on purpose (see
   * section 8a: `waitFor` and MSW need them), and the round trip is tens of
   * milliseconds today only because `lib/pod/save-entry.ts` and
   * `lib/pod/write.ts` have no backoff. Slow the box down — a loaded CI runner,
   * coverage instrumentation — and the timer wins, rewrites the key with a
   * payload identical to the seed but for `savedAt`, and byte identity goes red
   * for the one thing this test does not mean.
   *
   * So the invariant is stated as what it is: THE DRAFT SURVIVED A FAILED SAVE,
   * and what survived is restorable. `savedAt` is free to have moved on; every
   * other field is the owner's work and must still be there. An editor that
   * cleared the key, emptied it, or left something `readDraft` would refuse
   * fails all the same — which is the property `toBe(seeded)` was standing in
   * for, without the race.
   */
  it.each(["entryRefused", "concurrent"] as const)(
    "%s: nothing reached the Pod, so the draft is the only copy and is kept",
    async (name) => {
      const { store } = await saveWithADraft(name);

      // The strongest half, and unchanged: nothing asked storage to drop it.
      expect(store.calls.remove, "the draft was discarded after a failed save").not.toContain(KEY);

      // And the key still holds a draft, not a tombstone. Both shapes of "gone"
      // are caught HERE rather than downstream: `undefined` is a clear, `""` is
      // an implementation that emptied the key instead of removing it, and
      // neither reaches `calls.remove` in the second case.
      const kept = store.items.get(KEY);
      expect(kept ?? "", "the key holds no draft after a failed save").not.toBe("");

      // Parsed through an assertion rather than bare, so a truncated value
      // fails as "not readable" instead of as a SyntaxError pointing at this
      // file's JSON helper. Same shape test/drafts.test.ts uses on readDraft.
      let payload: Record<string, unknown> = {};
      expect(() => {
        payload = parseDraft(kept!);
      }, "what is left at the key is not readable JSON").not.toThrow();

      // RESTORABLE, field by field. `Object.keys` against DRAFT_FIELDS is what
      // catches a half-written payload — nine fields, no more (a tenth is how
      // the ETag gets in) and no fewer.
      expect(Object.keys(payload).sort(), "what is left is not a restorable draft").toEqual(
        DRAFT_FIELDS,
      );
      expect(payload.headline, "the owner's text is not in the surviving draft").toBe(
        RESTORED_HEADLINE,
      );
      expect(payload.story).toBe(RESTORED_STORY);
      expect(payload.slug).toBe("2026-04-02-kyoto");
      expect(payload.tripIri).toBe(JAPAN.iri);
      // The one field allowed to have moved: whichever copy is at the key, the
      // seeded one or one the live window wrote, it carries an offset (§6).
      expect(payload.savedAt).toMatch(/[+-]\d{2}:\d{2}$/);
    },
  );

  /**
   * THE RESURRECTED DRAFT, ON THE CREATE PATH.
   *
   * A save finishes well inside 800ms, so the window `saveWithADraft()` armed
   * is still running when the save clears the draft. If nothing cancelled it,
   * that timer would fire a moment later and write the draft straight back —
   * under the key the next mount reads, offering to restore text the Pod
   * already has, which is the trap this whole section exists to avoid.
   *
   * WHAT ACTUALLY DOES THE CANCELLING HERE IS NOT `settleDraft`, AND THIS
   * DOCBLOCK USED TO CLAIM OTHERWISE. It said this test was what finally
   * covered `settleDraft`'s `clearTimeout`, and that "deleting the
   * `clearTimeout` from `forgetDraft` left all six of them green" — implying
   * this seventh one goes red. It does not. Measured: delete that block and
   * this test still passes, because a CREATE moves `target` from `null` to the
   * created entry, which moves `scope`, which is a dependency of the autosave
   * effect. React runs that effect's own cleanup on the dependency change and
   * clears the handle for free; the body then re-arms nothing, because
   * `settleDraft` has already set `touched.current = false`. Two mechanisms
   * overlap on this path and only one of them is this test's subject.
   *
   * So what this test pins is the OUTCOME on the create path — no write after
   * the save, whichever mechanism delivered it. The `clearTimeout` in
   * `settleDraft` is the only thing standing between a failed cancel and a
   * resurrected draft on an EDIT, where no dependency moves and React's
   * cleanup never runs, and that is the test immediately below. Neither is a
   * substitute for the other.
   *
   * SO THIS ONE WAITS, on the real clock, and that is deliberate rather than
   * lazy. Section 8a avoids real waits because "not yet written" is a race; the
   * assertion here is the opposite — nothing was written AFTER a window that
   * has demonstrably elapsed — and waiting longer than the window is what turns
   * that from a race into a fact. It costs about a second, once, and fake
   * timers are not available here: this section needs `waitFor` and MSW, which
   * is why 8c runs on real ones.
   *
   * COUNTED FROM THE END OF THE SAVE rather than from zero, because the count
   * at that point is itself racy — on a slow box the window can elapse DURING
   * the round trip, which is a legitimate write and not a resurrection. What
   * must be true either way is that nothing was written afterwards.
   */
  it("does not let the pending window write the draft back after the save cleared it", async () => {
    const { store } = await saveWithADraft("success");
    expect(store.items.has(KEY), "the save did not clear the draft").toBe(false);
    const bySaveEnd = store.calls.set.length;

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 400));
    });

    expect(
      store.calls.set.length,
      "the debounce wrote a draft after the save had cleared it",
    ).toBe(bySaveEnd);
    expect(store.items.has(KEY), "the draft came back from a timer nobody cancelled").toBe(false);
  });

  /**
   * THE SAME INVARIANT ON AN EDIT, WHICH IS THE PATH WHERE `settleDraft`'s
   * `clearTimeout` IS THE ONLY THING HOLDING IT UP.
   *
   * On a create, `setTarget` moves `scope` from `new` to the created entry's
   * URL. `scope` is a dependency of the autosave effect, so React runs that
   * effect's cleanup on the change and cancels the pending window itself —
   * which is why the test above stays green with `settleDraft`'s cancel
   * deleted. On an EDIT `target.url` is already the entry's URL and
   * `report.entryUrl` is the same string, so NOTHING in the dependency array
   * moves: the effect never re-runs, no cleanup fires, and the timer armed by
   * the last keystroke before Save survives the save untouched. The three
   * lines in `settleDraft` are all that stand between it and a draft written
   * back over an entry the Pod has just accepted.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * ITS REDNESS WAS ESTABLISHED BY MUTATION, NOT BY THE TDD RED STEP, AND THE
   * NEXT READER HAS NO OTHER WAY TO KNOW THAT. The behaviour was already
   * correct when this test was written — it is a coverage hole being closed,
   * not a defect being fixed — so it passed on its first run, which this
   * repository otherwise treats as a reason to distrust a test. What earns it
   * instead is the mutation, run on 2026-09-05 and recorded here so it can be
   * repeated:
   *
   *   in `settleDraft`, components/studio/entry-editor/entry-editor.tsx, delete
   *
   *       if (pendingWrite.current !== null) {
   *         clearTimeout(pendingWrite.current);
   *         pendingWrite.current = null;
   *       }
   *
   * With that gone this test fails on both of its final assertions — one more
   * `setItem` after the save, and the key back in the store — while the
   * create-path test above and the other 115 in this file stay green. That
   * asymmetry is the whole point of having both.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * WHY IT CANNOT PASS VACUOUSLY, since "nothing happened" is the assertion:
   *
   *   - THE AUTOSAVE IS PROVED LIVE FIRST, at this key, in this mode. The
   *     first phase types and waits out a full window, and a real write has to
   *     appear under the EDIT key before anything else is asserted. Without it
   *     every line below would hold for an editor that autosaves nothing.
   *   - THE PREMISE IS PINNED. The entry PUT must go to the same URL the key
   *     is derived from, carrying `If-Match` — if a future change made an edit
   *     write somewhere else, `scope` would move, React's cleanup would do the
   *     cancelling, and this test would silently become a second copy of the
   *     create-path one.
   *   - A WINDOW IS DEMONSTRABLY ARMED WHEN SAVE IS CLICKED. The second
   *     keystroke is delivered (`typeAsUser` returns `true`, so no fieldset
   *     swallowed it) and the click follows immediately, with no await in
   *     between that could let 800ms elapse first.
   *   - THE SAVE DEMONSTRABLY REACHED `settleDraft`: the key is present
   *     immediately before the click and gone immediately after, and the
   *     removal is recorded against that exact key.
   *
   * AND IT WAITS LONGER THAN THE WINDOW, not exactly it — same reasoning as
   * the test above. "Nothing was written" is a fact only after the window it
   * would have been written in has demonstrably elapsed.
   *
   * COUNTED FROM THE END OF THE SAVE, also as above: on a slow box the window
   * can legitimately elapse mid-round-trip, and that write is not a
   * resurrection. What must hold either way is that nothing followed the save.
   *
   * ASSERTED INSIDE THE TEST BODY, BEFORE UNMOUNT, and that is load-bearing:
   * `afterEach`'s `cleanup()` triggers the 8f unmount flush, which writes
   * whenever a window is still outstanding. Anything deferred to after the
   * body would be measuring the flush instead.
   */
  it("cancels the pending window on an EDIT, where no effect dependency moves", async () => {
    const EDIT_KEY = draftKeyFor(OWNER, ARRIVAL_URL);
    const FIRST_PASS = "Two hours of drizzle, typed before the save.";
    const SECOND_PASS = `${FIRST_PASS} And a sentence that arms the window Save has to cancel.`;

    const pod = podFake();
    const entry = await specEntry();
    const store = fakeStorage();
    await renderEditor(fakeStudioSession().session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    /* ── the autosave is live, in EDIT mode, under the EDIT key ───────────── */
    expect(
      typeAsUser(LABEL.articleBody, FIRST_PASS),
      "the story field is not writable on an edit form, so nothing below arms a window",
    ).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 400));
    });
    expect(
      store.calls.set.map((c) => c.key),
      "no draft was autosaved on an edit form, so this test could not detect a resurrection",
    ).toEqual([EDIT_KEY]);
    expect(parseDraft(store.items.get(EDIT_KEY)!).story).toBe(FIRST_PASS);

    /* ── one more keystroke, then Save with no await in between ───────────── */
    expect(
      typeAsUser(LABEL.articleBody, SECOND_PASS),
      "the second keystroke was refused, so no window is in flight across the save",
    ).toBe(true);
    // Non-vacuous by construction: the key demonstrably holds a draft at the
    // moment the save starts, so "it is gone afterwards" cannot pass by never
    // having been there.
    expect(store.items.has(EDIT_KEY)).toBe(true);
    await clickSaveAndWait();

    /* ── the premise: this really was an edit of the resource the key names ─ */
    const put = pod.entryPut();
    expect(put, "no entry PUT went out, so no save happened to cancel anything").toBeDefined();
    expect(
      put!.url,
      "the edit wrote somewhere other than the resource its draft key names, so `scope` moved " +
        "and React's own cleanup — not `settleDraft` — is what this test would be measuring",
    ).toBe(ARRIVAL_URL);
    expect(put!.headers["if-match"], "this was not an edit").toBe('"entry-7"');
    expect(put!.headers["if-none-match"]).toBeUndefined();
    // The story the Pod took is the second pass — so the form and the resource
    // agree, and `settleDraft` has no legitimate reason to write anything back.
    expect(
      oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, SCHEMA.articleBody)?.value,
    ).toBe(SECOND_PASS);

    /* ── the save reached settleDraft and cleared the key it was writing to ─ */
    expect(store.calls.remove, "the edit's own draft key was never cleared").toContain(EDIT_KEY);
    expect(store.items.has(EDIT_KEY), "the save did not clear the draft").toBe(false);

    /* ── and nothing comes back afterwards ────────────────────────────────── */
    const bySaveEnd = store.calls.set.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 400));
    });

    expect(
      store.calls.set.length,
      "the window armed before the save wrote the draft back after it — on an edit nothing " +
        "else cancels that timer, so `settleDraft` did not",
    ).toBe(bySaveEnd);
    expect(
      store.items.has(EDIT_KEY),
      "the draft came back from a timer nobody cancelled",
    ).toBe(false);
    // Every draft key, not just the one: a resurrection under a scope that
    // moved when it should not have is the same harm by another name.
    expect(
      [...store.items.keys()].filter((k) => k.startsWith("wig.draft.")),
      "a draft was resurrected under some other key",
    ).toEqual([]);
  });
});

/* ────────────────────────────────── 8d. when the browser will not cooperate ── */

describe("entry editor — a browser that will not keep a local copy", () => {
  /**
   * Safari in private mode, and any browser with storage disabled. The owner
   * has to be told, because the whole value of this feature is the belief that
   * the text is safe — a silent failure is worse than no feature at all.
   *
   * `role="note"` is the hook, and it is deliberately neither `status` nor
   * `alert`: those two belong to the save, this is ancillary to the form, and
   * an assertive announcement would interrupt a screen reader mid-sentence to
   * report something that does not affect the Pod at all. Both directions are
   * in one test, so it cannot degenerate into a line that is always there.
   */
  it("says so, once, and says nothing at all when storage works", async () => {
    await withFakeTimers(FIRST);
    const broken = fakeStorage();
    broken.fail.set = QUOTA;
    await renderEditor(fakeStudioSession().session, { storage: broken.storage });

    setText(LABEL.headline, "Rain");
    tick(DEBOUNCE);

    // It really tried: a note rendered without an attempted write would be a
    // permanent warning about nothing.
    expect(broken.calls.set.length).toBeGreaterThan(0);

    const notes = screen.getAllByRole("note");
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent?.trim()).not.toBe("");
    // Quiet: the Pod save is completely unaffected by this.
    expect(screen.queryAllByRole("alert")).toEqual([]);
    expect(screen.queryAllByRole("status")).toEqual([]);

    // SET ONCE, DO NOT THRASH. Two more windows, two more failed writes, still
    // one line.
    setText(LABEL.headline, "Rain on");
    tick(DEBOUNCE);
    setText(LABEL.headline, "Rain on the");
    tick(DEBOUNCE);
    expect(broken.calls.set.length).toBeGreaterThan(1);
    expect(screen.getAllByRole("note")).toHaveLength(1);

    cleanup();

    // THE ALLOW-CASE, same clock, same interaction, same query.
    const working = fakeStorage();
    await renderEditor(fakeStudioSession().session, { storage: working.storage });
    setText(LABEL.headline, "Rain");
    tick(DEBOUNCE);
    expect(working.calls.set).toHaveLength(1);
    expect(screen.queryAllByRole("note")).toEqual([]);
  });
});

/* ─────────────────────────────── 8e. the form is held until the banner is answered ── */

/**
 * The eight controls the form is made of, named so a failure says which one.
 *
 * NINE THINGS CAN BE INTERACTED WITH, AND THE NINTH — THE SAVE BUTTON — IS HELD
 * TOO, but it is not in this list because `typeAsUser` above drives text into a
 * labelled control and a button takes a click. Its hold is pinned by its own
 * pair of tests at the end of 8e, where the consequence of a click is what is
 * asserted rather than an attribute alone.
 *
 * This note used to read "deliberately not in this list — see the note in 8g",
 * meaning the Save button was deliberately NOT held. That was true of the
 * implementation and is no longer the decision: an unanswered banner over an
 * EDIT form met a live Save button, and one unprompted click wrote the entry as
 * it stood and settled the draft — the same silent loss the fieldset exists to
 * prevent, reached in one click.
 */
const FORM_CONTROLS: [string, RegExp][] = [
  ["trip", LABEL.trip],
  ["slug", LABEL.slug],
  ["headline", LABEL.headline],
  ["story", LABEL.articleBody],
  ["when it happened", LABEL.occurredAt],
  ["tags", LABEL.tags],
  ["travel mode", LABEL.travelModeFrom],
  ["status", LABEL.status],
];

/**
 * ONE STORAGE SLOT, SO ONLY ONE OF THE TWO MAY HOLD THE PEN.
 *
 * THE DEFECT. The banner and the autosave share a key. A draft survives a
 * crash; the next day the owner opens the studio, sees the banner, decides to
 * deal with it later, and starts typing something else. 800ms later the
 * autosave puts the near-empty new form at that key and the old text is gone
 * from storage. `offered` still holds it in memory, so Restore works for as
 * long as this tab lives — and a reload, a session expiry or a second crash
 * loses it, which is the exact scenario `docs/decisions.md` §10 names as the
 * reason this feature exists at all.
 *
 * THE DECISION, ALREADY TAKEN. While an offer is outstanding the eight controls
 * are disabled, via `<fieldset disabled>`. Restore or Discard unlocks them. One
 * slot, no race, and the banner cannot promise what it will not deliver. The
 * owner cannot type past the banner; that is the accepted cost and it is one
 * click.
 *
 * AND THE SAVE BUTTON WITH THEM — a second decision, taken after the first
 * shipped and found a hole. The eight controls were held and the button was
 * not, so with the banner still up the owner could press Save: on a CREATE the
 * pre-flight guard refuses an empty form and nothing is lost, but on an EDIT
 * the form is already full of the entry, so the save writes it as it stands,
 * `settleDraft` clears the key, and the offer is gone. One unprompted click and
 * the copy that survived the crash is deleted — the same loss the fieldset
 * exists to prevent, by a shorter route. The last two tests in this section pin
 * it, and they are the red step of that decision.
 *
 * HOW it is held is the implementer's: inside the fieldset, or
 * `disabled={saving || offered !== null}` where it stands. Nothing below reads
 * the spelling — `toBeDisabled()` walks up to a fieldset and reads a `disabled`
 * attribute alike — and the two conditions must COMPOSE rather than replace one
 * another, which is what the mid-flight half of the last test is for.
 *
 * WHAT WOULD BREAK EACH HALF, since an assertion nobody can break is not one:
 * deleting the `disabled` prop from the fieldset breaks the lock half; wiring
 * it to something other than `offered !== null` breaks the unlock half; keeping
 * the fieldset but dropping the `offered` guard from the autosave effect leaves
 * the storage assertion intact only because the DOM refuses the keystroke,
 * which is the point — the hold IS the fix. For the Save button: leaving it
 * outside the fieldset with `disabled={saving}` alone — today's code — breaks
 * the two tests at the end; replacing `saving` with `offered !== null` rather
 * than adding to it breaks the mid-flight half of the last one.
 */
describe("entry editor — the form is held until the banner is answered", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * BOTH DIRECTIONS IN ONE TEST, deliberately. "Everything is disabled" is a
   * rule that would be satisfied by a form permanently locked, which is useless
   * and would take the studio with it; "everything is enabled" is satisfied by
   * doing nothing at all. Only the pair says anything, and only the pair can be
   * red for the right reason.
   */
  it("locks the eight controls while a draft is offered, and holds nothing when there is nothing to answer", async () => {
    await withFakeTimers(FIRST);
    const fake = fakeStudioSession();

    /* THE ALLOW-CASE FIRST: no draft, so nothing to answer, so nothing held. */
    const live = fakeStorage();
    await renderEditor(fake.session, { storage: live.storage });
    expect(screen.queryAllByRole("region", { name: /draft/i })).toEqual([]);
    for (const [what, label] of FORM_CONTROLS) {
      expect(
        screen.getByLabelText(label),
        `the ${what} control is held although no draft was offered`,
      ).toBeEnabled();
    }
    // And it really is a live form: the keystroke lands, and it reaches storage.
    expect(typeAsUser(LABEL.headline, "Rain on the Philosopher's Path")).toBe(true);
    tick(DEBOUNCE);
    expect(live.calls.set, "an unheld form did not autosave").toHaveLength(1);
    cleanup();

    /* THE PIN: the same form, with an offer outstanding. */
    const seeded = JSON.stringify(seededDraft());
    const store = fakeStorage({ [KEY]: seeded });
    await renderEditor(fake.session, { storage: store.storage });

    // The banner is up. Without this, everything below is a set of assertions
    // about a screen with no banner on it.
    expect(screen.getAllByRole("region", { name: /draft/i })).toHaveLength(1);

    for (const [what, label] of FORM_CONTROLS) {
      expect(
        screen.getByLabelText(label),
        `the ${what} control is still live while a draft is offered`,
      ).toBeDisabled();
    }

    // THE CONSEQUENCE, which is the thing that actually loses text: a keystroke
    // the browser would refuse cannot reach storage, so the offered draft is
    // still there to be restored after a reload.
    expect(
      typeAsUser(LABEL.headline, "something else, started while the banner was up"),
      "the browser would have delivered this keystroke to a held control",
    ).toBe(false);
    expect(typeAsUser(LABEL.articleBody, "and a different story")).toBe(false);
    tick(DEBOUNCE * 2);

    expect(store.calls.set, "the autosave wrote while an offer was outstanding").toEqual([]);
    expect(
      store.items.get(KEY),
      "the offered draft was overwritten by the form behind the banner",
    ).toBe(seeded);
  });

  /**
   * THE TWO WAYS OUT, and both must unlock — a banner whose buttons leave the
   * form dead is worse than no banner. Each half ends with a keystroke that has
   * to land AND has to reach storage, so "unlocked" is asserted as the
   * behaviour rather than as an attribute.
   */
  it("Restore unlocks the form, and so does Discard", async () => {
    await withFakeTimers(FIRST);
    const fake = fakeStudioSession();

    /* RESTORE. */
    const restored = fakeStorage({ [KEY]: JSON.stringify(seededDraft()) });
    await renderEditor(fake.session, { storage: restored.storage });
    // The lock was really on, so "enabled afterwards" is a change of state and
    // not the absence of a feature.
    expect(screen.getByLabelText(LABEL.headline)).toBeDisabled();

    fireEvent.click(
      within(screen.getByRole("region", { name: /draft/i })).getByRole("button", {
        name: "Restore",
      }),
    );

    for (const [what, label] of FORM_CONTROLS) {
      expect(screen.getByLabelText(label), `the ${what} control is still held after Restore`)
        .toBeEnabled();
    }
    expect(typeAsUser(LABEL.headline, "Rain on the Philosopher's Path, continued")).toBe(true);
    tick(DEBOUNCE);
    expect(restored.calls.set, "the form is unlocked but no longer autosaves").toHaveLength(1);
    expect(parseDraft(restored.calls.set[0].value).headline).toBe(
      "Rain on the Philosopher's Path, continued",
    );
    cleanup();

    /* DISCARD. */
    const discarded = fakeStorage({ [KEY]: JSON.stringify(seededDraft()) });
    await renderEditor(fake.session, { storage: discarded.storage });
    expect(screen.getByLabelText(LABEL.headline)).toBeDisabled();

    fireEvent.click(
      within(screen.getByRole("region", { name: /draft/i })).getByRole("button", {
        name: "Discard",
      }),
    );

    for (const [what, label] of FORM_CONTROLS) {
      expect(screen.getByLabelText(label), `the ${what} control is still held after Discard`)
        .toBeEnabled();
    }
    expect(typeAsUser(LABEL.headline, "starting again from nothing")).toBe(true);
    tick(DEBOUNCE);
    expect(discarded.calls.set).toHaveLength(1);
    expect(parseDraft(discarded.calls.set[0].value).headline).toBe("starting again from nothing");
  });

  /* ── the ninth control: the Save button ──────────────────────────────────
   *
   * THE HOLE THE FIRST EIGHT LEFT, and it is one click wide.
   *
   * The two tests below are on an EDIT, and that is the whole point rather than
   * a convenience. On a CREATE the form behind the banner is empty, so a save
   * dies in `save()`'s own pre-flight guard — "This entry needs a trip, a slug,
   * a headline" — and nothing is lost. On an EDIT the form is already full of
   * the entry that was opened, so the same click writes it, `settleDraft`
   * clears the key, and the draft that survived the crash is gone without the
   * owner ever having read the banner. That asymmetry is why a create-shaped
   * test of this would report green against the very defect being fixed.
   *
   * THESE TWO RUN ON REAL TIMERS. Every other test in 8e fakes them, and
   * cannot: these reach the Pod, and MSW and `waitFor` need a clock that moves
   * (section 8a). So `withFakeTimers` is deliberately not called here.
   * ──────────────────────────────────────────────────────────────────────── */

  /** The draft of the §7.3 entry, keyed the way an EDIT keys it: on the entry's
   *  own document URL, not on `new`. */
  const EDIT_KEY = draftKeyFor(OWNER, ARRIVAL_URL);
  const KEPT_HEADLINE = "Arrival, rewritten on the train";
  const KEPT_STORY = "The version the browser kept when the tab died.";
  const editDraft = () =>
    JSON.stringify(seededDraft({ headline: KEPT_HEADLINE, story: KEPT_STORY }));

  /** Longer than a debounce window, on the real clock: what is asserted after it
   *  is that nothing happened, and a wait shorter than the window would make
   *  that a race rather than a fact. 8c and 8g wait the same way. */
  const pastTheWindow = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 400));
    });

  /**
   * THE PIN, IN BOTH DIRECTIONS. "The Save button is disabled" alone is
   * satisfied by a studio nobody can save from, so the allow-case — the same
   * screen with nothing outstanding — is in the same test and must be live.
   *
   * WHAT WOULD BREAK IT: the hold half fails against today's implementation,
   * where the button sits outside the `<fieldset disabled>` carrying
   * `disabled={saving}` alone. The allow half fails against a button held on
   * something other than the offer — `disabled` unconditionally, or wired to
   * `store !== null`.
   */
  it("holds the Save button while a draft is offered, and leaves it live when there is nothing to answer", async () => {
    const entry = await specEntry();
    const fake = fakeStudioSession();

    /* THE ALLOW-CASE: the same edit form, no draft, nothing to answer. */
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });
    expect(screen.queryAllByRole("region", { name: /draft/i })).toEqual([]);
    expect(saveButton(), "the Save button is held although no draft was offered").toBeEnabled();
    cleanup();

    /* THE PIN: the same form, with an offer outstanding. */
    const store = fakeStorage({ [EDIT_KEY]: editDraft() });
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    // The banner really is up, and it is this editor's own key that produced it
    // — without both lines the assertion below is about a screen with no offer
    // on it, which an editor that never holds anything passes.
    expect(screen.getAllByRole("region", { name: /draft/i })).toHaveLength(1);
    expect(store.calls.get, "the editor never looked for a draft at this key").toContain(EDIT_KEY);

    expect(
      saveButton(),
      "the Save button is live while a draft is offered: one click writes the entry and settles the draft",
    ).toBeDisabled();
  });

  /**
   * AND THE CONSEQUENCE, WHICH IS THE HALF THAT MATTERS. A disabled attribute
   * is a claim about the DOM; what has to be true is that the click does
   * nothing — no request to the Pod, and the offer still outstanding.
   *
   * THE MUTATION HALF IS AT THE END, and it is what stops this being a test
   * that would pass against an editor that cannot save at all: after Restore
   * the same button, clicked the same way, does reach the Pod AND does settle
   * the draft. So the "nothing was removed" assertion above it is about a
   * mechanism that demonstrably fires — it just must not fire from behind a
   * banner.
   *
   * WHAT WOULD BREAK IT: today's implementation, where the click submits the
   * form and the save runs; equally, a hold implemented by swallowing the
   * submit while leaving the button enabled, which would satisfy the "no
   * request" half and fail `toBeDisabled()` — a button a browser will activate
   * and a handler that silently declines is worse than either.
   */
  it("a click on the held Save button reaches neither the Pod nor the draft", async () => {
    const pod = podFake();
    const entry = await specEntry();
    const store = fakeStorage({ [EDIT_KEY]: editDraft() });

    await renderEditor(fakeStudioSession().session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });
    expect(screen.getAllByRole("region", { name: /draft/i })).toHaveLength(1);
    expect(store.items.get(EDIT_KEY), "the draft is not where this test seeded it").toBe(
      editDraft(),
    );

    expect(saveButton()).toBeDisabled();
    await act(async () => {
      fireEvent.click(saveButton());
    });
    // Longer than a save takes and longer than a debounce window, so "nothing
    // went out" is a fact rather than a snapshot taken too early.
    await pastTheWindow();

    expect(
      pod.entryPut(),
      "a click on the held Save button wrote the entry to the Pod",
    ).toBeUndefined();
    // Everything the CLICK sent, which is nothing. The §7.6 read the editor
    // makes on mount happened before the button was touched and is excluded by
    // name, then counted — see `saveTraffic`. `pastTheWindow()` above means
    // that read has long since settled, so the count is not a race.
    expect(pod.saveTraffic(), "the held Save button reached the Pod at all").toEqual([]);
    expect(
      pod.of("GET", SETTINGS_URL),
      "the held Save button re-read the privacy settings",
    ).toHaveLength(1);
    expect(
      store.calls.remove,
      "the click settled the draft: the copy that survived the crash is gone, unread",
    ).not.toContain(EDIT_KEY);
    expect(store.items.get(EDIT_KEY), "the offered draft was overwritten").toBe(editDraft());
    expect(
      screen.getAllByRole("region", { name: /draft/i }),
      "the banner went away without the owner answering it",
    ).toHaveLength(1);
    // Nothing was announced, so no save ran at all — not a save that ran and
    // was refused, which would leave a sentence in `status` or `alert`.
    expect(outcomeText(), "a save ran from behind the banner").toBe("");
    expect(saveButton().getAttribute("aria-busy")).not.toBe("true");

    /* THE MUTATION HALF: answer the banner and the same click does everything
       the assertions above say it must not do yet. */
    fireEvent.click(
      within(screen.getByRole("region", { name: /draft/i })).getByRole("button", {
        name: "Restore",
      }),
    );
    expect(saveButton(), "Restore did not give the Save button back").toBeEnabled();
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the Save button does not work even after Restore").toBeDefined();
    // The filter hides only the mount read: this PUT is in `saveTraffic()`, so
    // the empty assertion above is about a click that sent nothing rather than
    // about a helper that reports nothing.
    expect(pod.saveTraffic(), "saveTraffic() filters out the save's own traffic").toContain(put);
    expect(put!.url).toBe(ARRIVAL_URL);
    // The restored text is what went out, so this really was a save of the
    // draft the banner was offering.
    expect(
      oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, SCHEMA.headline)?.value,
    ).toBe(KEPT_HEADLINE);
    // AND THE SETTLE HAPPENS HERE, once the owner has chosen — which is what
    // makes "not settled" above an assertion about something real.
    expect(store.calls.remove, "a save that the owner asked for did not settle the draft").toContain(
      EDIT_KEY,
    );
  });

  /**
   * DISCARD GIVES IT BACK TOO, AND `saving` STILL OWNS IT MID-FLIGHT.
   *
   * Two conditions on one control, and they must COMPOSE. An implementation
   * that replaced `disabled={saving}` with `disabled={offered !== null}` would
   * pass everything above and re-open the double-submit this button has been
   * guarded against since it was written: the mid-flight half below is what
   * catches that, at the one moment `saving` is true.
   *
   * WHAT WOULD BREAK IT: leaving the button held after Discard breaks the first
   * half; dropping `saving` from the condition, or dropping `aria-busy`, breaks
   * the second; leaving it disabled after the round trip finishes breaks the
   * third, which is the state a second edit starts from.
   */
  it("Discard gives the Save button back, and a save in flight still holds it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pod = podFake({ hold: held });
    const entry = await specEntry();
    const store = fakeStorage({ [EDIT_KEY]: editDraft() });

    await renderEditor(fakeStudioSession().session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    // Held, so "live afterwards" is a change of state rather than the absence
    // of a feature.
    expect(saveButton()).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole("region", { name: /draft/i })).getByRole("button", {
        name: "Discard",
      }),
    );
    expect(saveButton(), "Discard left the Save button held").toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton());
    });
    // The round trip is open: the Pod has the request and has not answered.
    await waitFor(() => expect(pod.entryPut(), "the entry PUT never went out").toBeDefined());

    // THE EXISTING CONTRACT, at the one moment it is true. Whatever holds the
    // button while a draft is offered must not have replaced this.
    expect(saveButton(), "the Save button is live during a save").toBeDisabled();
    expect(saveButton().getAttribute("aria-busy")).toBe("true");

    release();
    await waitFor(() => expect(outcomeText()).not.toBe(""));

    // And back, because the next edit starts here.
    expect(saveButton(), "the Save button stayed held after the save finished").toBeEnabled();
    expect(saveButton().getAttribute("aria-busy")).not.toBe("true");
  });
});

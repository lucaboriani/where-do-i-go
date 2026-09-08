// @vitest-environment jsdom
/** The studio's entry editor: section 8, last four describes — the coordinate, place, offset and savedAt halves of a draft.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  ARRIVAL_URL,
  DEBOUNCE,
  DRAFT_FIELDS,
  FIRST,
  LABEL,
  NEW_SCOPE,
  OWNER,
  SNAP_500,
  SPEC_COUNTRY,
  SPEC_LOCALITY,
  SPEC_PLACE_NAME,
  type StoredDraft,
  TYPED,
  addressNodeOf,
  clickSaveAndWait,
  coordinateControls,
  datatypeOf,
  draftKeyFor,
  emptyLiteralsIn,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  geoNodeOf,
  legacyDraftKeyFor,
  objectsOf,
  offsetPattern,
  oneObject,
  parseDraft,
  placeNodeOf,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  requireCoordinateControls,
  requireOffsetControl,
  requirePlaceControls,
  seededDraft,
  setChoice,
  setText,
  shownValue,
  specEntry,
  tick,
  typeAsUser,
  typeCoordinate,
  withFakeTimers,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DY, SCHEMA, XSD } from "@/lib/vocab";
import type { Entry } from "@/lib/pod/schema";

registerEditorLifecycle();

/* ─────────────────────────────── 8h. the coordinate in a local draft ──────
 *
 * THE DECISION, TAKEN HERE AND STATED SO IT CAN BE ARGUED WITH: **the draft
 * keeps the coordinate the owner TYPED, not the one that would be published.**
 *
 * §9 says the studio "discards the precise original", and it is worth being
 * precise about what that sentence is protecting. Its own first line gives the
 * threat model: "Resources are publicly readable… anyone can fetch the raw
 * triple." `localStorage` is not a resource, is not readable by anyone else,
 * and never leaves the browser the owner typed into — it is the same trust
 * boundary as the React state the value is already sitting in, and as the input
 * element still showing it. Discarding it there would not close a hole; it
 * would close the feature: the field is the one thing in this form an owner
 * cannot retype from memory a day later, which is exactly what
 * `docs/decisions.md` §10 says autosave exists for.
 *
 * THE ALTERNATIVE WAS CONSIDERED AND IS WORSE, and not by a little. Persisting
 * the SNAPPED pair means a restored form shows a coordinate the owner did not
 * type, cannot refine, and cannot tell apart from one they did — and it freezes
 * a decision made under settings that may since have changed, since the snap is
 * a function of `dy:defaultPrecisionMeters` and of a home region that moves
 * when the owner moves house. Re-fuzzing it on save would then be idempotent
 * and therefore invisible, which is the wrong kind of harmless: nothing would
 * ever go wrong loudly.
 *
 * WHAT MAKES IT TESTABLE RATHER THAN A PREFERENCE: the two choices differ in
 * exactly one observable, the bytes at the key, so the first test below reads
 * them. Nothing else in the file can tell them apart — a save from a restored
 * draft publishes the same triple either way, because snapping a snapped value
 * returns it unchanged.
 *
 * AND THE FENCE AROUND IT IS UNMOVED. The three fields that may never be
 * persisted are still the ETag, `dcterms:created` and `schema:datePublished`
 * (lib/studio/drafts.ts), and `DRAFT_FIELDS` is what enforces it: seventeen,
 * no more.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — the coordinate in a local draft", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * FLUSHED BY THE UNMOUNT rather than by advancing a clock, which is 8f's
   * mechanism ("flushes the pending window on unmount instead of dropping it")
   * and is what lets this run on REAL timers. It has to: the settings arrive
   * over the network, `typeCoordinate` waits for them, and section 8's fake
   * clock does not fake microtasks but does stop everything that waits on a
   * timer. A test that faked time here would type into a control that was still
   * disabled and assert against whatever the pending state left behind.
   *
   * WHAT WOULD BREAK IT: writing `fuzzForPublication`'s output into the draft
   * instead of the form state; dropping the coordinate from the payload
   * altogether; persisting it under a field name `readDraft` strips.
   */
  it("keeps what was typed, not what would be published", async () => {
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    // The coordinate FIRST, because it is the one that has to wait for the
    // settings: everything after it is synchronous, so the debounce window that
    // opens here is still open when the unmount flushes it.
    await typeCoordinate(TYPED);
    fillNewEntry();
    cleanup();

    expect(store.calls.set, "nothing was kept at all").not.toEqual([]);
    const written = store.calls.set.at(-1)!;
    expect(written.key).toBe(KEY);

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );

    // THE DECISION.
    expect(payload.lat, "the draft does not hold the latitude the owner typed").toBe(TYPED.lat);
    expect(payload.long).toBe(TYPED.long);
    expect(payload.precision, "the precision the form was showing was not kept").toBe("500");

    // …and the other choice, spelled out so that switching to it fails here
    // rather than silently: the published pair is not what is on disk.
    expect(written.value, "the draft holds the SNAPPED pair, not the typed one").not.toContain(
      String(SNAP_500.lat),
    );
    expect(written.value).not.toContain(String(SNAP_500.long));

    // The fence: none of the three that may never be persisted.
    for (const forbidden of ["etag", "created", "datePublished"]) {
      expect(Object.keys(payload), forbidden).not.toContain(forbidden);
    }
  });

  /**
   * THE VERSION SEGMENT, DOING THE ONE THING IT IS THERE FOR.
   *
   * A `v1` payload is nine fields; the form is now twelve. Restoring it would
   * fill nine controls and leave three in whatever state the editor's own
   * defaults left them — a coordinate field the owner never typed into, sitting
   * next to text they recognise, on a form whose banner has just told them
   * their draft was restored. `lib/studio/drafts.ts`: "a future shape can be
   * given v2 and this one's payloads become invisible rather than
   * half-restorable."
   *
   * THE ALLOW-CASE IS THE SAME BYTES AT THE CURRENT KEY, which is what stops
   * this passing for an editor that offers nothing at all — the failure mode
   * that would take the whole feature with it and look like a clean pass.
   *
   * WHAT WOULD BREAK IT: leaving `draftKey` at `v1`; reading both keys "to be
   * kind"; migrating a v1 payload forward, which is the same half-restore in a
   * politer coat.
   */
  it("does not offer a draft left behind under the previous key version", async () => {
    const fake = fakeStudioSession();
    // Deliberately a payload that is perfectly valid under the CURRENT shape,
    // so the only thing making it invisible is the key it is under.
    const payload = JSON.stringify(seededDraft({ lat: TYPED.lat, long: TYPED.long }));

    const stale = fakeStorage({ [legacyDraftKeyFor(OWNER, NEW_SCOPE)]: payload });
    await renderEditor(fake.session, { storage: stale.storage });

    expect(
      screen.queryAllByRole("region", { name: /draft/i }),
      "a draft written by the previous build was offered: nine fields into a twelve-field form",
    ).toEqual([]);
    // And it looked in the right place, so this is a key that moved rather than
    // an editor that stopped reading drafts.
    expect(stale.calls.get, "the editor never looked for a draft at all").toContain(KEY);
    expect(stale.calls.get).not.toContain(legacyDraftKeyFor(OWNER, NEW_SCOPE));
    cleanup();

    /* THE ALLOW-CASE. */
    const current = fakeStorage({ [KEY]: payload });
    await renderEditor(fake.session, { storage: current.storage });
    expect(
      screen.getAllByRole("region", { name: /draft/i }),
      "the same bytes under the current key were not offered either: this editor offers nothing",
    ).toHaveLength(1);
  });

  /**
   * THE ROUND TRIP, END TO END: what was typed comes back into the control as
   * typed, and what leaves for the Pod is still the snapped pair. The first
   * half is the observable difference the decision above turns on; the second
   * is the guarantee that keeping the precise value locally costs nothing at
   * the wire.
   *
   * WHAT WOULD BREAK IT: restoring into the wrong control, or not at all;
   * restoring the value but not putting it through the fuzz on the save that
   * follows — which is the shape that would put a typed coordinate on a
   * world-readable resource by way of `localStorage`.
   */
  it("Restore puts the typed coordinate back, and the save still publishes the snapped one", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const store = fakeStorage({
      [KEY]: JSON.stringify(seededDraft({ lat: TYPED.lat, long: TYPED.long, precision: "500" })),
    });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "no draft was offered: the editor is reading a key this file no longer writes (v1 rather than v2), or is not reading one at all",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requireCoordinateControls();
    await waitFor(() => expect(screen.getByLabelText(LABEL.latitude)).toBeEnabled());
    expect(
      (screen.getByLabelText(LABEL.latitude) as HTMLInputElement).value,
      "Restore did not put the kept latitude back into the control",
    ).toBe(TYPED.lat);
    expect((screen.getByLabelText(LABEL.longitude) as HTMLInputElement).value).toBe(TYPED.long);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);
    const geo = geoNodeOf(quads, put!.url);
    expect(geo, "a restored coordinate published nothing").toBeDefined();
    expect(Number(oneObject(quads, geo!, SCHEMA.latitude)?.value)).toBe(SNAP_500.lat);
    expect(Number(oneObject(quads, geo!, SCHEMA.longitude)?.value)).toBe(SNAP_500.long);
    expect(
      pod.wire(),
      "the coordinate went from localStorage to the Pod without passing through the fuzz",
    ).not.toContain(TYPED.lat);
    expect(pod.wire()).not.toContain(TYPED.long);
  });

  /**
   * 8e's hold, extended to the three controls that were not there when it was
   * written. Same defect, same fix: one storage slot, so only one of the banner
   * and the autosave may hold the pen, and the owner cannot type past an
   * unanswered offer.
   *
   * THE DISCARD AT THE END IS NOT DECORATION. Under an unreadable settings
   * document these three controls are disabled too (section 1), so "disabled
   * while a banner is up" is a state this editor can reach for a completely
   * different reason — including "the settings read has not come back yet".
   * Answering the banner and watching them come alive is what makes the hold
   * attributable to the banner.
   *
   * WHAT WOULD BREAK IT: leaving the coordinate controls outside the
   * `<fieldset disabled>`; wiring their `disabled` to the settings alone.
   */
  it("holds the coordinate controls while a draft is offered, and holds nothing when there is nothing to answer", async () => {
    const fake = fakeStudioSession();

    /* THE ALLOW-CASE: no draft, so nothing to answer, so nothing held. */
    const live = fakeStorage();
    await renderEditor(fake.session, { storage: live.storage });
    expect(screen.queryAllByRole("region", { name: /draft/i })).toEqual([]);
    requireCoordinateControls();
    await waitFor(() => expect(screen.getByLabelText(LABEL.latitude)).toBeEnabled());
    for (const [what, control] of coordinateControls()) {
      expect(control, `the ${what} control is held although no draft was offered`).toBeEnabled();
    }
    expect(typeAsUser(LABEL.latitude, TYPED.lat)).toBe(true);
    cleanup();

    /* THE PIN. */
    const seeded = JSON.stringify(seededDraft());
    const store = fakeStorage({ [KEY]: seeded });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "no draft was offered, so there is no hold to observe: the editor is reading a key this file no longer writes (v1 rather than v2)",
    ).toHaveLength(1);
    const banner = offered[0];
    for (const [what, control] of coordinateControls()) {
      expect(control, `the ${what} control is still live while a draft is offered`).toBeDisabled();
    }
    expect(
      typeAsUser(LABEL.latitude, "35.9"),
      "the browser would have refused this keystroke",
    ).toBe(false);
    expect(
      store.items.get(KEY),
      "the offered draft was overwritten by the form behind the banner",
    ).toBe(seeded);

    /* AND THE HOLD WAS THE BANNER'S. */
    fireEvent.click(within(banner).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByLabelText(LABEL.latitude)).toBeEnabled());
    for (const [what, control] of coordinateControls()) {
      expect(control, `the ${what} control is still held after Discard`).toBeEnabled();
    }
    expect(typeAsUser(LABEL.latitude, TYPED.lat)).toBe(true);
  });
});

/* ─────────────────────────────────────── 8i. the place fields in a draft ──
 *
 * Three more strings off three more form controls, kept for the same reason
 * the other nine are (`docs/decisions.md` §10: "losing a long entry in a hostel
 * is what kills the habit") — and the version segment is deliberately NOT
 * moved for them, which is the second time that test is answered "no".
 *
 * THE BAR `lib/studio/drafts.ts` SETS FOR A BUMP is the HALF-RESTORE: a field
 * the payload cannot carry, showing whatever the editor's own default left in
 * it, under a banner that has just told the owner their draft came back. That
 * is what `v1` → `v2` was for — nine fields into a twelve-field form, with a
 * coordinate the owner never typed sitting next to text they recognise. It
 * cannot arise here: no existing `v2` payload can contain a place name,
 * because there was no control to type one into, so such a draft restores
 * three empty boxes — the truth about that draft, not a default standing in
 * for something lost. Bumping would throw away real unsaved prose in exchange
 * for nothing, exactly as it would have done for `photos`. The half of this
 * pinned in the store itself is in test/drafts.test.ts §7.
 *
 * WHAT THIS TEST ASSERTS IS THE INVARIANT — a USABLE draft — rather than the
 * bytes: the fields are kept, they come back into the controls, and a save
 * made from the restored form puts the same place on the Pod. Bytes alone
 * would pass for a draft that stored three strings nothing ever read back.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — the place fields in a local draft", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * FLUSHED BY THE UNMOUNT rather than by advancing a clock — 8f's mechanism,
   * and the same reason 8h uses it: this test reaches the network on the
   * restore half, and a faked timer stops everything that waits on one.
   *
   * WHAT WOULD BREAK IT: keeping the three fields in React state and leaving
   * them out of the payload; persisting them under names `readDraft` strips
   * (unknown keys are stripped silently, so this is a failure with no error);
   * restoring them into the wrong control, or not at all; restoring them into
   * the form but leaving them out of the save that follows, which would show
   * the owner a place name and publish an entry without one.
   */
  it("keeps the three place fields, and a restored draft still names its place", async () => {
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "Gion, Kyoto");
    setText(LABEL.locality, "Kyoto");
    setText(LABEL.country, "JP");
    cleanup();

    expect(store.calls.set, "nothing was kept at all").not.toEqual([]);
    const written = store.calls.set.at(-1)!;
    expect(written.key).toBe(KEY);

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );
    expect(payload.placeName, "the draft does not hold the place name that was typed").toBe(
      "Gion, Kyoto",
    );
    expect(payload.locality).toBe("Kyoto");
    expect(payload.country).toBe("JP");

    // The fence is unmoved: none of the three that may never be persisted.
    for (const forbidden of ["etag", "created", "datePublished"]) {
      expect(Object.keys(payload), forbidden).not.toContain(forbidden);
    }

    /* AND IT IS USABLE — the bytes the editor itself wrote, offered back to a
       fresh editor, restored, and saved. */
    const pod = podFake();
    const seeded = fakeStorage({ [KEY]: written.value });
    await renderEditor(fake.session, { storage: seeded.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "the draft this editor had just written was not offered back to it",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requirePlaceControls();
    expect(shownValue(LABEL.placeName), "Restore did not put the place name back").toBe(
      "Gion, Kyoto",
    );
    expect(shownValue(LABEL.locality)).toBe("Kyoto");
    expect(shownValue(LABEL.country)).toBe("JP");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(place, "a restored draft published no place at all").toBeDefined();
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe("Gion, Kyoto");

    const address = addressNodeOf(quads, put!.url);
    expect(address, "a restored draft published no address").toBeDefined();
    expect(oneObject(quads, address!, SCHEMA.addressLocality)?.value).toBe("Kyoto");
    expect(oneObject(quads, address!, SCHEMA.addressCountry)?.value).toBe("JP");
  });

  /**
   * THE HALF-RESTORE THE VERSION SEGMENT EXISTS TO PREVENT, REACHED WITHOUT
   * MOVING THE VERSION SEGMENT — and the reason these three fields are
   * `.optional()` rather than `.default("")`.
   *
   * A `v2` payload written before the place controls existed carries no place
   * fields at all. Give them a default and `readDraft` hands back `""` for each
   * — which in this editor is not "nothing typed", it is REMOVE, the only way a
   * name already on the Pod can be taken off it. Restore such a draft onto an
   * entry that HAS a place and the three boxes go empty, and the next save
   * deletes `schema:name` and the whole `<#address>` from a world-readable
   * resource. The owner asked for their unsaved text back and lost data they
   * never touched, with no error anywhere.
   *
   * THE `photos` PRECEDENT DOES NOT TRANSFER, which is what made the default
   * look safe: a restored empty photo list is harmless because `photosFor`
   * re-carries `existing.photos` at save time. Place text has no carry-through
   * — the form state IS the answer — so an absent field has to stay absent all
   * the way to `restore()`, which leaves the control showing what it was
   * showing.
   *
   * WHAT WOULD BREAK IT: `.default("")` on the three in lib/studio/drafts.ts;
   * `setPlaceName(draft.placeName)` without the `??` in `restore()`; bumping
   * the key to `v3`, which passes this by making the draft invisible and loses
   * the prose the key was left at `v2` to protect — so the restore is asserted
   * to have HAPPENED before the place is asserted to have survived it.
   */
  it("does not empty a stored place when the restored draft predates the controls", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    expect(entry.place?.name?.value, "the §7.3 fixture no longer names a place").toBe(
      SPEC_PLACE_NAME,
    );

    /* Exactly the shape a build before these controls wrote: every other field
       of the current draft, and no place fields at all. */
    const RESTORED_HEADLINE = "Rain on the Philosopher's Path";
    const before = seededDraft({ headline: RESTORED_HEADLINE }) as Partial<StoredDraft>;
    delete before.placeName;
    delete before.locality;
    delete before.country;
    for (const field of ["placeName", "locality", "country"]) {
      expect(Object.keys(before), field).not.toContain(field);
    }

    const store = fakeStorage({
      [draftKeyFor(OWNER, ARRIVAL_URL)]: JSON.stringify(before),
    });
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft written before the place controls was not offered at all: the key moved, or the payload is now refused",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED. Without this the assertions below would hold
    // just as well for a build that offered nothing and restored nothing.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(RESTORED_HEADLINE);

    requirePlaceControls();
    expect(
      shownValue(LABEL.placeName),
      "a draft with no opinion about the place emptied the box that had one",
    ).toBe(SPEC_PLACE_NAME);
    expect(shownValue(LABEL.locality)).toBe(SPEC_LOCALITY);
    expect(shownValue(LABEL.country)).toBe(SPEC_COUNTRY);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(
      place,
      "restoring a draft that predates these controls deleted the entry's place from the Pod",
    ).toBeDefined();
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe(SPEC_PLACE_NAME);

    const address = addressNodeOf(quads, put!.url);
    expect(address, "the whole <#address> went with it").toBeDefined();
    expect(oneObject(quads, address!, SCHEMA.addressLocality)?.value).toBe(SPEC_LOCALITY);
    expect(oneObject(quads, address!, SCHEMA.addressCountry)?.value).toBe(SPEC_COUNTRY);
  });

  /**
   * THE OTHER SIDE OF THE SAME OPERATOR, AND THE ONE A RETRACTION DEPENDS ON.
   *
   * The test above pins ABSENT: a `v2` payload that predates these controls has
   * no opinion about the place, so `restore()` leaves the boxes showing the
   * stored value. This one pins `""`, which is a DIFFERENT INSTRUCTION — a box
   * the owner deliberately emptied, which `placeTextOf` reads as REMOVE and
   * which is the only way a name already on a world-readable resource can be
   * taken off it.
   *
   * BOTH SIDES ARE NEEDED BECAUSE THE OPERATOR HAS TWO OF THEM AND EACH SIDE
   * FAILS ALONE. `draft.placeName ?? placeName` keeps them apart. `||` does not:
   * it treats `""` as falsy and falls through to the current state, so an owner
   * who emptied the three boxes, walked away before the save, and then clicked
   * Restore gets the entry's STORED place handed back to them — the retraction
   * silently reverted, on a resource anyone can fetch, with the banner having
   * just said the draft came back. The absent test cannot see that: an absent
   * key reaches the same branch under both operators. Measured by the
   * re-reviewer, not reasoned about — `??` → `||` produced an identical failure
   * set until this test existed.
   *
   * THE PREMISE IS GUARDED, because it is the whole difference between the two
   * tests and it is one `delete` away from being the other one. `seededDraft`
   * already defaults the three to `""`, so a test that merely relied on that
   * default would still be testing the `""` side the day the default moved to
   * absent — silently, and it would pass. So the three keys are asserted PRESENT
   * and asserted EMPTY before anything is restored.
   *
   * TWO SURFACES, ASSERTED SEPARATELY, BECAUSE THEY FAIL INDEPENDENTLY: the
   * control shows `""` after Restore, and the save that follows actually takes
   * `schema:name` and the whole `<#address>` off the Pod. An editor that emptied
   * the boxes and then wrote a hidden copy of `existing.place` back would pass
   * the first and lose the owner's removal at the second.
   *
   * AND THE GEOMETRY IT NEVER TOUCHED SURVIVES — 1b's rule, seen through a
   * restore this time. `placeFor` removes the four fields independently, so the
   * `<#place>` node is still there for the coordinate to hang off; a `<#place>`
   * that vanished with its name would take a coordinate the owner never asked to
   * remove with it.
   */
  it("restores three boxes the owner emptied, and the save takes the place off the Pod", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    expect(entry.place?.name?.value, "the §7.3 fixture no longer names a place").toBe(
      SPEC_PLACE_NAME,
    );
    expect(entry.place?.locality, "the §7.3 fixture no longer carries a locality").toBe(
      SPEC_LOCALITY,
    );
    expect(entry.place?.country, "the §7.3 fixture no longer carries a country").toBe(SPEC_COUNTRY);
    const stored = entry.place?.geo;
    expect(stored, "the §7.3 fixture carries no coordinate for this test to preserve").toBeDefined();

    /* A draft the owner emptied the place out of: the three fields PRESENT and
       EMPTY, which is what makes this the `""` side rather than the one above. */
    const RESTORED_HEADLINE = "Rain on the Philosopher's Path";
    const emptied = seededDraft({
      headline: RESTORED_HEADLINE,
      placeName: "",
      locality: "",
      country: "",
    });
    for (const field of ["placeName", "locality", "country"] as const) {
      expect(
        Object.keys(emptied),
        `${field} is absent from this payload, so this test is the other test`,
      ).toContain(field);
      expect(emptied[field], `${field} is not the empty string, so nothing is being retracted`).toBe(
        "",
      );
    }

    const store = fakeStorage({
      [draftKeyFor(OWNER, ARRIVAL_URL)]: JSON.stringify(emptied),
    });
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "the emptied draft was not offered at all: the key moved, or the payload is now refused",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED, on a field neither operator touches — so
    // "the boxes are empty" below cannot be satisfied by a build that offered
    // the draft and restored nothing from it.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(RESTORED_HEADLINE);

    /* SURFACE ONE: what the owner is looking at. Under `||` all three of these
       show the stored value instead. */
    requirePlaceControls();
    expect(
      shownValue(LABEL.placeName),
      "the box the owner emptied came back holding the stored name: their removal was reverted",
    ).toBe("");
    expect(shownValue(LABEL.locality), "the emptied locality came back").toBe("");
    expect(shownValue(LABEL.country), "the emptied country came back").toBe("");

    await clickSaveAndWait();

    /* SURFACE TWO: what the Pod is left holding, which is the consequence. */
    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(
      place,
      "the retraction took the whole place with it, coordinate and all",
    ).toBeDefined();
    expect(
      objectsOf(quads, place!, SCHEMA.name),
      "the name the owner emptied is still on the Pod: an emptied box was restored as the stored value",
    ).toEqual([]);
    expect(
      objectsOf(quads, place!, SCHEMA.address),
      "the address the owner emptied is still on the Pod",
    ).toEqual([]);
    // Said again by predicate, so an `<#address>` reached by some other route
    // fails here too rather than hiding behind the pointer being gone.
    for (const predicate of [SCHEMA.addressLocality, SCHEMA.addressCountry]) {
      expect(
        quads.filter((q) => q.predicate.value === predicate),
        `${predicate} survived a retraction`,
      ).toEqual([]);
    }
    expect(
      emptyLiteralsIn(quads),
      "an empty literal was published in place of a removal",
    ).toEqual([]);
    // The distinctive one, across every byte that left the browser: the stored
    // name must not have travelled out through the index row either.
    expect(
      pod.wire(),
      "the retracted place name left the browser anyway",
    ).not.toContain(SPEC_PLACE_NAME);

    // And the coordinate this restore said nothing about is untouched.
    const geo = geoNodeOf(quads, put!.url);
    expect(geo, "the untouched coordinate went with the retracted name").toBeDefined();
    const lat = oneObject(quads, geo!, SCHEMA.latitude);
    expect(Number(lat?.value)).toBe(stored!.lat);
    expect(datatypeOf(lat)).toBe(XSD.decimal);
    expect(Number(oneObject(quads, geo!, SCHEMA.longitude)?.value)).toBe(stored!.long);
  });
});

/* ──────────────────────────────── 8j. the offset in a local draft ─────────
 *
 * The seventeenth field, and the second control on this form whose STORED
 * VALUE MAY NOT APPEAR IN ITS OWN OPTION LIST — not "the second choice
 * control" (Trip, Travel mode, Status, Precision and Photos are choices too;
 * that count would make this the sixth). Precision is the first of the two:
 * `gridOf(draft.precision) === null ? presetPrecision : draft.precision`
 * refuses a restored precision the select cannot show. The offset is the
 * second, and it is exactly why it follows `precisionOptions`' union shape
 * rather than being refused the same way — see the note on `OFFSET_SHAPE`
 * where `restore()` is defined. §7.3: `dy:occurredAt` "carries the local
 * UTC offset of the place" — until section 1c that offset was the entry's own
 * or, failing that, the EDITING MACHINE'S, and nothing on the form could say
 * otherwise. Now it is an answer, so it is something the local copy has to
 * keep: a restored draft that dropped it would hand the owner back the same
 * silent guess the control exists to replace, under a banner that has just told
 * them their draft came back.
 *
 * AND THE VERSION SEGMENT IS NOT MOVED FOR IT — the third time that test is
 * answered "no", by the bar `lib/studio/drafts.ts` sets: the HALF-RESTORE. No
 * existing `v2` payload can carry an offset, because there was no control to
 * choose one with, so such a draft restores `""` and the editor falls through
 * to the same default it would have used with no draft at all. Nothing is
 * standing in for something lost. A bump would throw away real unsaved prose in
 * exchange for nothing, exactly as it would have for `photos` and for the place
 * fields. The store's half of that is test/drafts.test.ts §8; the half that can
 * actually hurt the owner — a blank control, and therefore a timestamp with no
 * offset on it — is the last test here.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — the offset in a local draft", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * FLUSHED BY THE UNMOUNT rather than by advancing a clock — 8f's mechanism,
   * and the same reason 8h and 8i use it: the restore half reaches the network,
   * and a faked timer stops everything that waits on one.
   *
   * WHAT WOULD BREAK IT: holding the offset in React state and leaving it out
   * of the payload; persisting it under a name `readDraft` strips (unknown keys
   * are stripped silently, so that is a failure with no error anywhere);
   * restoring it into the control but leaving it out of the save, which shows
   * the owner `+05:45` and publishes `+09:00`.
   */
  it("keeps the chosen offset, and a restored draft still publishes it", async () => {
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    requireOffsetControl();
    fillNewEntry();
    setChoice(LABEL.offset, offsetPattern("+05:45"));
    // The choice really took, or everything below is about the default.
    expect(shownValue(LABEL.offset)).toBe("+05:45");
    cleanup();

    expect(store.calls.set, "nothing was kept at all").not.toEqual([]);
    const written = store.calls.set.at(-1)!;
    expect(written.key).toBe(KEY);

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );
    expect(payload.offset, "the draft does not hold the offset the owner chose").toBe("+05:45");
    // The wall clock is kept beside it, unshifted: the two halves of the
    // timestamp are stored as the two controls hold them.
    expect(payload.occurred).toBe("2026-04-02T16:20");

    // The fence is unmoved: none of the three that may never be persisted.
    for (const forbidden of ["etag", "created", "datePublished"]) {
      expect(Object.keys(payload), forbidden).not.toContain(forbidden);
    }

    /* AND IT IS USABLE — the bytes the editor itself wrote, offered back to a
       fresh editor, restored, and saved. */
    const pod = podFake();
    const seeded = fakeStorage({ [KEY]: written.value });
    await renderEditor(fake.session, { storage: seeded.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "the draft this editor had just written was not offered back to it",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requireOffsetControl();
    expect(shownValue(LABEL.offset), "Restore did not put the offset back").toBe("+05:45");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(
      occurred?.value,
      "a restored draft published the editing machine's offset, not the one it was carrying",
    ).toBe("2026-04-02T16:20:00+05:45");
  });

  /**
   * CHANGING THE OFFSET ALONE ARMS THE AUTOSAVE.
   *
   * THIS IS A BUG THIS PROJECT HAS ALREADY SHIPPED ONCE, in the photo pipeline:
   * a state change that armed nothing, because the only thing that set
   * `touched` was a DOM `change` event on the form, and the settle happened
   * outside one. It reached review. The shape recurs here for a different
   * reason — an offset is not typing, and an implementation that hung the
   * control outside the `<form>` (a toolbar beside the datetime input is the
   * obvious layout) would move the state and arm nothing, so the owner corrects
   * `+02:00` to `+09:00`, closes the tab, and gets `+02:00` back.
   *
   * THE CONTROL IS IN THE SAME TEST, first: an untouched form stores nothing,
   * so the write below is the change and not the mount. Without it this passes
   * against an editor that autosaves a copy of the empty form on render.
   */
  it("arms the autosave when the offset is the only thing that changed", async () => {
    await withFakeTimers(FIRST);
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    requireOffsetControl();

    // THE CONTROL: nobody has touched anything, so nothing is armed.
    tick(DEBOUNCE * 2);
    expect(store.calls.set, "an untouched form stored a draft").toEqual([]);

    // ONE CHANGE, AND IT IS NOT TYPING.
    setChoice(LABEL.offset, offsetPattern("+05:45"));
    expect(shownValue(LABEL.offset), "the choice did not take").toBe("+05:45");
    tick(DEBOUNCE);

    expect(
      store.calls.set,
      "changing the offset armed nothing: the state moved and the autosave did not, so the correction is lost with the tab",
    ).toHaveLength(1);
    const payload = parseDraft(store.calls.set[0].value);
    expect(Object.keys(payload).sort()).toEqual(DRAFT_FIELDS);
    expect(payload.offset).toBe("+05:45");
    // The mutation half: this really is the offset alone, with nothing typed.
    expect(payload.headline).toBe("");
    expect(payload.story).toBe("");
  });

  /**
   * A DRAFT WRITTEN BEFORE THE CONTROL EXISTED, which is the decision the key
   * did not move for — and the one way that decision can hurt the owner rather
   * than merely disappoint them.
   *
   * `""` restored into the control literally is the blank `<select>` section 1c
   * refuses on an unlisted offset, and the consequence is worse than a control
   * that looks unfilled: the next save composes `dy:occurredAt` out of the wall
   * clock and an empty string, and §3 requires an offset. So the fallback chain
   * has to run — the same `offsetOf(existing?.occurredAt) ?? offsetHere(wall)`
   * a fresh form uses — exactly as `restore()` already re-derives the precision
   * when a draft carries a grid this build does not offer.
   *
   * WHAT WOULD BREAK IT: bumping the key to `v3` (the banner never appears and
   * the prose is gone); making the field required (the same loss, quieter);
   * `setOffset(draft.offset)` unconditionally, which is the blank control.
   */
  it("restores a draft written before the offset control without blanking it", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const before = { ...seededDraft() } as Partial<StoredDraft>;
    delete before.offset;
    // The fixture really is missing the field, or this test is about a payload
    // that has one.
    expect(Object.keys(before)).not.toContain("offset");

    const store = fakeStorage({ [KEY]: JSON.stringify(before) });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft written before the offset control is no longer offered: the key moved, or the field is required",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requireOffsetControl();
    expect(
      shownValue(LABEL.offset),
      "an empty offset was restored into the control, so the next save has none to write (§3)",
    ).toBe("+09:00");
    // The mutation half: the prose the owner would lose really did come back.
    expect(shownValue(LABEL.headline)).toBe("Rain on the Philosopher's Path");

    // AND THE CONSEQUENCE, at the wire: a restored pre-offset draft still
    // publishes a timestamp with an offset on it.
    await clickSaveAndWait();
    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(occurred?.value).toBe("2026-04-02T16:20:00+09:00");
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
  });

  /**
   * THE EDIT-PATH COMPLEMENT TO THE TEST ABOVE, and the one that actually
   * exercises `offsetOf(existing?.occurredAt)` rather than `offsetHere(wall)`
   * alone.
   *
   * THE TEST ABOVE IS A CREATE: `renderEditor` there is given no `initial`, so
   * `existing` is `undefined` and `offsetOf(existing?.occurredAt)` is
   * `undefined` no matter what the restore path does with it — the fallback
   * chain collapses to `offsetHere(wall)` alone, which in this file's fixed
   * Asia/Tokyo zone is exactly the `+09:00` the test above asserts. AN
   * IMPLEMENTATION WHOSE RESTORE FALL-THROUGH NEVER CONSULTS THE ENTRY AT ALL
   * — always `offsetHere(wall)`, never `offsetOf(existing?.occurredAt)` —
   * PASSES THE TEST ABOVE AND EVERY OTHER TEST IN THIS FILE. That is the shape
   * this project's review-lessons record as a recurring trap: when a mutant
   * survives, ask which OTHER mechanism is covering for it, then find the path
   * where it does not. This is that path.
   *
   * So this test edits an entry whose stored offset is `+05:45` — Nepal,
   * chosen for the same reason section 1c's own test uses it: the fixed test
   * zone cannot produce it by coincidence, so "the entry's own offset" and
   * "this machine's offset" are distinguishable outcomes rather than
   * accidentally equal ones. `+09:00` here would make the test vacuous. The
   * draft seeded onto it is the same pre-control fixture as the test above —
   * the `offset` key deleted — because ruling T2-A collapses that with a
   * hand-emptied `offset: ""` before `restore()` ever sees it.
   *
   * MUTATIONS THIS MUST DIE UNDER, both of them:
   *
   *   1. `setOffset(draft.offset)` unconditionally → the control shows `""`.
   *      Unlike the `+05:15` case in section 1c, this really is blank:
   *      `offsetOptions` unions in whatever the control holds, so an empty
   *      state puts an empty-valued option into the list and the `<select>`
   *      genuinely matches it. It is not the "no option matches" case —
   *      that one reads back as the FIRST option, not blank, per section 1c
   *      — so `shownValue(LABEL.offset)` reads `""` rather than `+05:45`.
   *   2. The restore fall-through consulting only `offsetHere(wall)` and never
   *      `offsetOf(existing?.occurredAt)` → the control shows `+09:00`, this
   *      machine's zone, instead of the entry's own. THIS is the mutation the
   *      test above cannot catch, and the entire reason this test exists.
   *
   * AND THE WIRE CONSEQUENCE, because a control that merely looks right while
   * the save publishes something else is the failure that actually costs the
   * owner: the timestamp reaching the Pod must carry `+05:45`, with the wall
   * clock the DRAFT held (`16:20`), not the entry's own (`21:40`).
   */
  it("restores a draft written before the offset control onto an edit, showing the entry's own offset rather than this machine's", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    const nepal: Entry = { ...entry, occurredAt: "2026-03-29T21:40:00+05:45" };
    // The mutation really happened, or this is the §7.3 fixture's own +09:00
    // again and the two mechanisms below are indistinguishable.
    expect(nepal.occurredAt).not.toBe(entry.occurredAt);

    const before = { ...seededDraft() } as Partial<StoredDraft>;
    delete before.offset;
    // The fixture really is missing the field, or this test is about a payload
    // that has one.
    expect(Object.keys(before)).not.toContain("offset");

    const store = fakeStorage({
      [draftKeyFor(OWNER, ARRIVAL_URL)]: JSON.stringify(before),
    });
    await renderEditor(fake.session, {
      initial: { entry: nepal, etag: '"entry-7"' },
      storage: store.storage,
    });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft written before the offset control is no longer offered on an edit: the key moved, or the field is required",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED — without this, the offset assertion below
    // would hold just as well for an editor that offered a draft and restored
    // nothing from it.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(before.headline);

    requireOffsetControl();
    expect(
      shownValue(LABEL.offset),
      "an empty offset restored onto an edit fell back to this machine's zone instead of the entry's own +05:45 — the mechanism the create-path test above cannot see",
    ).toBe("+05:45");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(
      occurred?.value,
      "the control showed the entry's own offset but a different one reached the Pod",
    ).toBe("2026-04-02T16:20:00+05:45");
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
  });

  /**
   * A SHAPE-INVALID, NON-EMPTY OFFSET IS REFUSED THE SAME WAY AN ABSENT ONE
   * IS. `restore()`'s guard is `OFFSET_SHAPE.test(draft.offset) ? draft.offset
   * : offset` — every fixture above only ever drives the `""` branch of that
   * ternary (an absent key or a hand-emptied one), so a narrower guard,
   * `draft.offset === "" ? offset : draft.offset`, would survive every test
   * before this one. `"banana"` is not `""` and not `[+-]dd:dd`, so it is the
   * one payload that can only reach the control through the SHAPE branch —
   * a hand-edited or corrupted `localStorage` entry, not anything this
   * editor itself would ever write.
   *
   * WHAT WOULD BREAK IT: the narrower `=== ""` guard above. Under it `banana`
   * is shown in the control, reaches the composer on save, and fails there —
   * `Entry.safeParse` (lib/pod/entry-model.ts) refuses the shape — so a save
   * that would otherwise have worked is silently lost instead of the visible,
   * correct fallback this test pins.
   */
  it("restores a draft carrying a shape-invalid offset onto the same fallback an absent one uses", async () => {
    const fake = fakeStudioSession();
    const bad = seededDraft({ offset: "banana" });
    const store = fakeStorage({ [KEY]: JSON.stringify(bad) });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft carrying a shape-invalid offset is no longer offered at all",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED, or the offset assertion below would hold
    // just as well for an editor that restored nothing.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(bad.headline);

    requireOffsetControl();
    expect(
      shownValue(LABEL.offset),
      "a shape-invalid offset from a hand-edited draft was shown rather than refused",
    ).toBe("+09:00");
  });
});

/* ──────────────────────────────────────────── 8k. task 2.5's crash test ── */

/**
 * TASK 2.5. `lib/studio/drafts.ts`'s `savedAt` becomes `.optional()`, at the
 * maintainer's explicit instruction, after being shown the module's own
 * docblock argues against it. THE CONSEQUENCE THAT MATTERS IS HERE, NOT IN
 * test/drafts.test.ts: today the schema is the only thing keeping a payload
 * with no `savedAt` off the render path — `Draft.safeParse` refuses it and
 * `readDraft` answers `null`, so the "Unsaved draft" banner never mounts and
 * `savedAtText(offered.savedAt)` — `(savedAt: string) => savedAt.slice(...)`
 * — never runs on `undefined`. Making the field optional moves such a payload
 * ONTO the render path, where that call is a TypeError thrown from the mount
 * effect: the exact failure lib/studio/drafts.ts's "NOTHING HERE THROWS,
 * EVER" headline invariant exists to prevent, reachable for the first time
 * through the one field that used to hold the door shut.
 *
 * RULING 2.5-A: the banner still appears; only the `<time>` goes away. The
 * banner's job is to offer the draft back, and suppressing the whole thing
 * over a missing label would discard recoverable prose — the inverse of what
 * this feature is for. So this test pins both halves: the crash does not
 * happen, AND the banner that survives still has its buttons. A test that
 * only checked "did not throw" would pass over a banner that had silently
 * lost Restore and Discard along with the timestamp.
 *
 * WHERE AN ABSENT `savedAt` ACTUALLY COMES FROM: never this build, which
 * stamps `nowWithOffset()` at every write site. Only a payload from another
 * build, or one hand-edited in devtools — exactly the class `readDraft`'s
 * "every unusable thing a real browser produces" contract is about.
 */
describe("entry editor — a draft with no savedAt at all (task 2.5)", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  it("mounts and still offers the draft, with no <time> and a live Restore", async () => {
    const withoutSavedAt = {
      ...seededDraft({
        headline: "written by a build with no timestamp control",
        story: "kept anyway, or this feature has failed at the one thing it is for",
      }),
    } as Partial<StoredDraft>;
    delete withoutSavedAt.savedAt;
    // The mutation really happened: the fixture is missing the key, or the
    // rest of this test is about a payload that has one.
    expect(Object.keys(withoutSavedAt), "savedAt").not.toContain("savedAt");
    expect(JSON.stringify(withoutSavedAt)).not.toContain("savedAt");

    const store = fakeStorage({ [KEY]: JSON.stringify(withoutSavedAt) });
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    // THE CRASH TEST. A schema-only change — `.optional()` with
    // `savedAtText`/`<time>` left untouched — throws a TypeError out of the
    // mount effect's render before this line is reached at all. TODAY, before
    // any implementation, `savedAt` is still required, so the payload above
    // is refused outright and this query finds nothing: the same red state as
    // the crash, reached by the other route the brief names as acceptable.
    const region = screen.getByRole("region", { name: /draft/i });

    // RULING 2.5-A, first half: no invented, no empty, no <time> at all.
    expect(
      region.querySelector("time"),
      "a <time> element appeared with no savedAt to build a datetime from",
    ).toBeNull();

    // RULING 2.5-A, second half — THE ONE A "DID NOT THROW" TEST WOULD MISS:
    // the banner that survives still has both of its ways out.
    within(region).getByRole("button", { name: "Discard" });
    fireEvent.click(within(region).getByRole("button", { name: "Restore" }));

    // Restore really did something: the prose the owner would otherwise lose
    // is back in the form, not merely "a click landed and nothing threw".
    expect(
      shownValue(LABEL.headline),
      "Restore did not put the headline back",
    ).toBe("written by a build with no timestamp control");
    expect(shownValue(LABEL.articleBody)).toBe(
      "kept anyway, or this feature has failed at the one thing it is for",
    );
    // Restored once — leaving the banner up invites a second click that would
    // overwrite whatever the owner types next.
    expect(screen.queryAllByRole("region", { name: /draft/i })).toEqual([]);
  });
});

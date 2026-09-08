// @vitest-environment jsdom
/** The studio's entry editor: section 1c — the offset it stamps.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  LABEL,
  OFFSET_WALL,
  SPEC_OCCURRED,
  clickSaveAndWait,
  datatypeOf,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  offsetOptions,
  offsetPattern,
  oneObject,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  requireOffsetControl,
  setChoice,
  setText,
  shownValue,
  specEntry,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { DY, XSD } from "@/lib/vocab";
import type { Entry } from "@/lib/pod/schema";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 1c. THE OFFSET IT STAMPS — the place's, chosen by the owner, and never the
 *     editing machine's guess.
 *
 * §7.3: `dy:occurredAt` "carries the local UTC offset of the place", because
 * "normalising to UTC destroys the fact that it was evening, which for a travel
 * diary is most of the meaning". The editor honours that on an EDIT — it keeps
 * the offset the entry already had — and gets it wrong everywhere else, because
 * the fallback is `offsetHere(wall)`: the zone of whatever machine the form is
 * open on. Writing up a Japan trip from the sofa at home stamps an evening in
 * Tokyo `+02:00`, silently, and there is no control anywhere on the form that
 * can correct it. Half past nine in the evening becomes half past nine in a
 * place the owner was not, and nothing about the entry says so.
 *
 * WHAT THIS SECTION PINS, each a different failure:
 *
 *   1. the control DEFAULTS to today's fallback chain — the entry's own offset
 *      on an edit, this machine's on a create — so the change is that the guess
 *      is now visible and correctable, not that it moved;
 *   2. choosing an offset changes what reaches the Pod, WITH THE WALL CLOCK
 *      UNMOVED. `toOffsetDateTime`'s docblock is explicit that the wall clock
 *      is copied and not recomputed, "the same instant, spelled as the wrong
 *      time of day"; an implementation that helpfully converts through a `Date`
 *      passes every other assertion in this file and fails this one;
 *   3. `+05:30` and `+05:45` both work — Kolkata and Kathmandu. This is the
 *      assertion that catches a whole-hours stepper, and it is why the control
 *      is a select over the offsets actually in use rather than a number input.
 *      `+08:45` is Eucla and `+12:45` is the Chathams: a list of whole hours
 *      makes those places unwritable, which for a travel diary is the wrong
 *      corner to cut;
 *   4. a stored offset the list does NOT contain still renders, rather than
 *      being silently swapped for a different one — the `Precision` select's
 *      established pattern, where the current value joins the options instead
 *      of being mapped onto them. An entry written by another tool with
 *      `+05:15` must not silently become something else, and a controlled
 *      `<select>` whose value matches no option reads back as its first
 *      option — not blank — which is exactly how it would.
 *
 * WHAT IS NOT PINNED HERE, deliberately: the option TEXT. "+09:00" alone and
 * "+09:00 — Tokyo, Seoul" are both fine, and `setChoice` reads either. What may
 * not vary is the VALUE, because that string is what `Draft.offset` carries and
 * what is concatenated onto the wall clock — one spelling, end to end.
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * THE OFFSETS THAT ARE NOT WHOLE HOURS — the places a stepper would delete from
 * the map. Nepal, India, Eucla, the Chathams, the Marquesas, and Newfoundland
 * and the Chathams AGAIN, in the halves of their year nobody had counted.
 *
 * TWO ENTRIES JOINED THIS LIST ON 2026-09-07 (F2), AND THE SHAPE THEY RECORD IS
 * WHY THEY ARE WORTH A DOCBLOCK. The list of offsets the editor offers was
 * verified — programmatically, at review — "against the brief text". **The
 * brief was the oracle, not the world**, so neither the brief nor the check
 * could name a value neither of them knew about. What is missing is not exotic:
 *
 *   `-02:30` is Newfoundland DAYLIGHT Time, May to November, and `-03:30` —
 *   the same island's standard time — was on the offered list already. Half of
 *   St John's year was unwritable.
 *   `+13:45` is Chatham DAYLIGHT Time, September to April, and the offered
 *   list's own docblock names the Chathams as one of the odd ones it exists
 *   for (`+12:45`).
 *
 * The consequence is silent and it is not a wall clock (§7.3's guarantee
 * survives): the owner writing up the Chathams in January picks `+12:45`, the
 * nearest offered, and the INSTANT is wrong by an hour — which is what any
 * cross-trip ordering uses. `offsetOptions`' union cannot rescue it either,
 * because on a create there is no stored value and no photo to supply one.
 *
 * `-03:30` AND `+12:45` STAY IN THIS LIST AS THE STANDARD-TIME TWINS, which is
 * what makes the two new entries a gap rather than a preference: each of them
 * is the other half of a year the form already half-covers.
 *
 * FIVE MORE JOINED THE SAME DAY (closing item 1). The component's own docblock
 * claims this array "lists the non-whole-hour zones and goes red if one stops
 * being offered" — and it named eight while `OFFSETS` carries thirteen.
 * `+03:30`, `+04:30` (Kabul), `+06:30` (Yangon), `+09:30` and `+10:30` were on
 * the offered list and in neither this file nor `e2e/` — verified by grep.
 * That is F2's exact mechanism again, this time wearing a comment that says a
 * test would catch it. The list is now the thirteen `OFFSETS` actually has, in
 * the same west-to-east order, so a stepper or a dropped legislature shows up
 * here rather than only in the component's own count.
 */
const ODD_OFFSETS = [
  "-09:30",
  "-03:30",
  "-02:30",
  "+03:30",
  "+04:30",
  "+05:30",
  "+05:45",
  "+06:30",
  "+08:45",
  "+09:30",
  "+10:30",
  "+12:45",
  "+13:45",
];

describe("entry editor — the offset it stamps", () => {
  /**
   * THE DEFAULT ON AN EDIT: the offset the entry was written with, which is
   * today's behaviour made visible rather than changed.
   *
   * TWO ENTRIES, AND THE SECOND IS THE ONE THAT CAN FAIL. This file fixes the
   * zone at Asia/Tokyo, which is +09:00 all year and is also what the §7.3
   * fixture carries — so the first half is satisfied by a control that reads
   * the machine and never looks at the entry at all, which is the exact defect
   * this section exists for. The Nepal entry separates them.
   *
   * WHAT WOULD BREAK IT: initialising the control from `offsetHere()` instead
   * of from `offsetOf(existing?.occurredAt)`; initialising it from the wall
   * clock through a `Date`, which is the same thing wearing a conversion.
   */
  it("shows the offset the entry was stored with, not this machine's", async () => {
    const fake = fakeStudioSession();
    const entry = await specEntry();

    // The normative §7.3 entry. Asserted against the fixture rather than
    // against a literal, so a change to §7.3 shows up here as a change.
    expect(SPEC_OCCURRED, "the §7.3 fixture no longer carries an offset").toMatch(/\+09:00$/);
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });
    requireOffsetControl();
    expect(shownValue(LABEL.offset)).toBe("+09:00");
    cleanup();

    // THE HALF THAT CAN FAIL: an entry whose offset is not this machine's.
    const nepal: Entry = { ...entry, occurredAt: "2026-03-29T21:40:00+05:45" };
    // The mutation really happened, or the assertion below is about the fixture
    // again and says nothing.
    expect(nepal.occurredAt).not.toBe(entry.occurredAt);

    await renderEditor(fake.session, {
      initial: { entry: nepal, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });
    requireOffsetControl();
    expect(
      shownValue(LABEL.offset),
      "the control is showing the editing machine's offset, not the one the entry was written with",
    ).toBe("+05:45");
    // And the wall clock beside it is still the stored one, unshifted.
    expect(shownValue(LABEL.occurredAt)).toBe("2026-03-29T21:40");
  });

  /**
   * THE DEFAULT ON A CREATE: this machine's offset, which is `offsetHere` —
   * today's silent fallback, now shown. It is the honest starting point (most
   * entries are written where they happened) and it is only defensible BECAUSE
   * it can now be corrected.
   *
   * ONLY THE FIXED ZONE MAKES THIS ABLE TO FAIL: on a UTC machine an
   * implementation that hardcoded `+00:00`, or one that left the control blank
   * and let `toOffsetDateTime` fall through, would look right. Asia/Tokyo is
   * pinned at the top of this file and by a control in section 0.
   */
  it("shows this machine's offset on a new entry, and it is a real offset", async () => {
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requireOffsetControl();
    const shown = shownValue(LABEL.offset);
    expect(
      shown,
      "the offset control is blank on a create: there is nothing to stamp the entry with",
    ).not.toBe("");
    expect(shown, "not an offset at all").toMatch(/^[+-]\d{2}:\d{2}$/);
    expect(shown, "the default is not this machine's zone").toBe("+09:00");
  });

  /**
   * THE LIST, AND WHY IT IS A LIST. The offsets that are not whole hours — see
   * `ODD_OFFSETS`, which is where each of them is argued for — and five that
   * are. The second half is the allow-case, because "contains +05:45" is
   * satisfied by a control offering every quarter hour from -12:00 to +14:00,
   * which is a different kind of wrong.
   *
   * A COUNT USED TO STAND IN THIS SENTENCE ("five … and four that are") and it
   * is deliberately gone: the count moved the moment F2 found two offsets in
   * real use that nobody had listed, and it was never what the test asserts.
   * The two arrays are the durable form of this claim.
   *
   * WHAT WOULD BREAK IT: an `<input type="number">` of hours; a list generated
   * by stepping whole hours; dropping the three-quarter-hour zones as
   * curiosities, which is how Kathmandu, Eucla and the Chathams stop being
   * writable; keeping a zone's standard time and not its daylight time, which
   * is how St John's and the Chathams become writable for half a year each.
   */
  it("offers the offsets that are not whole hours", async () => {
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    const values = offsetOptions();
    for (const odd of ODD_OFFSETS) {
      expect(values, `${odd} is not offered: that place cannot be written from this form`).toContain(
        odd,
      );
    }
    // The allow-case: the ordinary ones are there too, and the ends of the range.
    for (const whole of ["-12:00", "+00:00", "+01:00", "+09:00", "+14:00"]) {
      expect(values, `${whole} is not offered`).toContain(whole);
    }
    // `+00:00`, not `Z`: §6 and lib/pod/rdf.ts both want the explicit spelling,
    // and `offsetOf` already normalises a stored `Z` onto it.
    expect(values, "the list spells UTC as Z").not.toContain("Z");
  });

  /**
   * THE POINT OF THE WHOLE SECTION: what the owner picks is what the Pod gets,
   * and the wall clock does not move when they pick it.
   *
   * Three rows rather than one, and each is a place the alternatives cannot
   * express: a half hour, a three-quarter hour, and a NEGATIVE half hour, which
   * is where a sign dropped between the control and the string shows up.
   *
   * WHAT WOULD BREAK EACH HALF. The offset half: ignoring the chosen value and
   * passing `storedOffset ?? offsetHere(wall)` to `toOffsetDateTime`, which is
   * today's code and would write `+09:00` for every row. The wall-clock half:
   * recomputing the timestamp from the offset — `new Date(local + offset)` and
   * back — which preserves the instant and destroys the time of day, the one
   * thing §7.3 says the offset is carried for.
   */
  it.each([
    ["Kolkata", "+05:30"],
    ["Kathmandu", "+05:45"],
    ["the Marquesas", "-09:30"],
  ])("writes the offset chosen for %s, with the wall clock untouched", async (_where, offset) => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requireOffsetControl();
    fillNewEntry();
    setText(LABEL.occurredAt, OFFSET_WALL);

    // The choice is a real change: every row differs from the default this
    // machine supplies, so a control nobody reads cannot pass by coincidence.
    expect(shownValue(LABEL.offset)).not.toBe(offset);
    setChoice(LABEL.offset, offsetPattern(offset));
    expect(shownValue(LABEL.offset), `the ${offset} choice did not take`).toBe(offset);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "an offset was chosen and nothing was written at all").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(occurred, "no dy:occurredAt reached the Pod").toBeDefined();

    // Both halves named separately, so a failure says which one broke, and then
    // the whole string, which is what a reader will actually see.
    expect(
      occurred!.value.slice(-6),
      "the chosen offset is not the one that reached the Pod",
    ).toBe(offset);
    expect(
      occurred!.value.slice(0, 16),
      "the wall clock moved: the timestamp was recomputed from the offset instead of being copied",
    ).toBe(OFFSET_WALL);
    expect(occurred!.value).toBe(`${OFFSET_WALL}:00${offset}`);
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
    expect(occurred!.value, "§3: an offset is required, and Z is not the spelling").not.toMatch(/Z$/);
  });

  /**
   * AN OFFSET THE LIST DOES NOT HAVE, which is the `Precision` select's
   * unavailable-value case with a sharper consequence than blanking: a
   * controlled `<select>` whose value matches no option does not go blank —
   * React explicitly selects the first non-disabled option instead — so
   * losing the union below would not look unfilled, it would look ANSWERED,
   * with a plausible offset the owner never chose silently written into
   * `dy:occurredAt`.
   *
   * `+05:15` is not a zone anyone uses today, which is the point — an entry can
   * carry it because some other tool wrote it, and this editor's job is to show
   * it and put it back unchanged, not to correct it.
   *
   * WHAT WOULD BREAK IT: rendering only the fixed list, so the controlled
   * `<select>` finds no matching option and reads back as the first one on the
   * list (`-12:00` here) instead of `+05:15`; snapping the stored value onto
   * the nearest listed offset, which is the "helpful" version of losing it.
   */
  it("renders a stored offset the list does not contain, and puts it back unchanged", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    const odd: Entry = { ...entry, occurredAt: "2026-03-29T21:40:00+05:15" };
    // The mutation really happened.
    expect(odd.occurredAt).not.toBe(entry.occurredAt);

    await renderEditor(fake.session, {
      initial: { entry: odd, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });

    // A controlled <select> whose value matches no option reads back as the
    // FIRST option (measured: "-12:00", not ""), so this single assertion
    // covers both "it is showing +05:15" and "an option for it exists" —
    // neither "-12:00" nor "" is "+05:15".
    expect(
      shownValue(LABEL.offset),
      "the control blanked on an offset it does not offer, or replaced it with one it does",
    ).toBe("+05:15");

    // AND IT SURVIVES A SAVE THAT NEVER TOUCHED IT.
    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the edit was never written").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(
      occurred?.value,
      "an entry written by another tool had its offset rewritten by an edit that never touched it",
    ).toBe("2026-03-29T21:40:00+05:15");
    cleanup();

    // THE ALLOW-CASE, and the `Set` half of `Precision`'s pattern: an offset
    // that IS in the list appears once, not twice. This render uses the
    // unmodified `entry` (offset +09:00), so nothing unusual is unioned in
    // and its rendered list IS the canonical one — which is what
    // makes it the right place to check that +05:15 is not among them; the
    // odd-offset render above always has +05:15 unioned in and could never
    // pass that check.
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });
    // The fixture is only interesting if the list really lacks it.
    expect(offsetOptions(), "+05:15 is one of the offsets this editor offers").not.toContain(
      "+05:15",
    );
    expect(
      offsetOptions().filter((v) => v === "+09:00"),
      "the stored offset was appended to a list that already had it",
    ).toHaveLength(1);
  });

  /**
   * A STORED `Z` NORMALISES TO `+00:00` ON AN EDIT — the one branch of
   * `offsetOf` no fixture in this file had reached before this test.
   *
   * THE EXISTING `not.toContain("Z")` ASSERTION ABOVE CANNOT PIN THIS. It
   * renders a CREATE, where nothing is unioned in from an existing entry, so
   * it passes identically whether `offsetOf` normalises `Z` or not — it pins
   * the LIST's own spelling, never the normalisation. Only an EDIT of an
   * entry actually stored with `Z` drives the branch this test is about.
   *
   * WHAT WOULD BREAK IT: deleting the `found[1] === "Z" ? "+00:00" : found[1]`
   * branch from `offsetOf`. The mutant does not crash — `offsetMinutes("Z")`
   * is `Number("") * 60 + Number("")`, i.e. `0`, so it sorts beside `+00:00`
   * rather than throwing — it silently shows `Z` in the control and writes
   * `…T21:40:00Z` back on a save that never touched the offset, which is the
   * bare spelling §6 and lib/pod/rdf.ts both refuse.
   */
  it("shows +00:00, not Z, for an entry stored with the bare UTC spelling", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    const bareUtc: Entry = { ...entry, occurredAt: "2026-03-29T21:40:00Z" };
    // The mutation really happened.
    expect(bareUtc.occurredAt).not.toBe(entry.occurredAt);

    await renderEditor(fake.session, {
      initial: { entry: bareUtc, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });

    expect(
      shownValue(LABEL.offset),
      "a stored Z reached the control unnormalised",
    ).toBe("+00:00");

    // AND IT SURVIVES A SAVE THAT NEVER TOUCHED IT, spelled out rather than Z.
    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the edit was never written").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(
      occurred?.value,
      "a Z-stamped entry was written back with Z instead of the explicit offset",
    ).toBe("2026-03-29T21:40:00+00:00");
  });
});

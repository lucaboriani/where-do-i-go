// @vitest-environment jsdom
/** The studio's entry editor: section 1 — coordinates, snapped before the write or not published at all.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  COORDINATE_FIELD,
  CREDENTIAL,
  ENTRY_TTL,
  HALF_HOME_TTL,
  INDEX_TTL,
  INSIDE_HOME,
  LABEL,
  NO_HOME_TTL,
  NO_SETTINGS_REASON,
  OUTSIDE_HOME,
  PRECISION_2000_TTL,
  PRIVACY_TTL,
  SETTINGS_URL,
  SNAP_10KM,
  SNAP_2000,
  SNAP_500,
  SNAP_OUTSIDE_500,
  SPEC_PLACE_NAME,
  TYPED,
  awaitLiveCoordinateControls,
  clickSaveAndWait,
  coordinateControls,
  datatypeOf,
  describedByIdsOf,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  geoNodeOf,
  indexRowOf,
  objectsOf,
  oneObject,
  outcomeText,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  requireCoordinateControls,
  saveButton,
  setChoice,
  shownValue,
  specEntry,
  typeAsUser,
  typeCoordinate,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { DY, GEO, RDF, SCHEMA, XSD } from "@/lib/vocab";
import { readPrivacySettings } from "@/lib/pod/read";
import { snapToPrecision } from "@/lib/pod/fuzz";
import { describe as describeError } from "@/lib/pod/result";
import { triples } from "@/test/graph";
import { servePod } from "@/test/msw";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 1. COORDINATES — snapped before the write, or not published at all (§9).
 *
 * WHAT USED TO BE HERE. Two tests stood in this section: "exposes no coordinate
 * input, while exposing the fields that are in scope" and "writes no coordinate
 * predicate on a create". They were safety pins over a hole rather than
 * placeholders — fuzzing did not exist, so a latitude field would have put a
 * true coordinate on a world-readable resource — and both docblocks said they
 * were to be deleted deliberately when fuzzing landed rather than quietly
 * satisfied. That is what this section is. `lib/pod/fuzz.ts` exists and is
 * covered by test/fuzz.test.ts; `readPrivacySettings` exists and is covered by
 * test/privacy-settings.test.ts; neither had a caller. The invariant the pins
 * were holding the door for is now asserted where it actually lives: on the
 * bytes that left the browser.
 *
 * THE ORDER OF EVENTS IS THE WHOLE FEATURE. §9: "The studio applies fuzzing
 * before the write and discards the precise original." So it happens here, in
 * the editor, before the `Entry` is built — `saveEntry` never sees a precise
 * coordinate, and there is nothing downstream that could catch one, because by
 * then the precise value no longer exists anywhere. That is why every assertion
 * below reads the RECORDED REQUEST rather than an argument to a spy.
 *
 * THE FOUR THINGS THIS SECTION PINS, and each is a different failure:
 *
 *   1. the published pair is the SNAPPED one, and the typed one is in no
 *      request at all — not the entry document, not the index row, not the
 *      revalidation hook;
 *   2. inside the home region the geometry is DROPPED, not coarsened, and the
 *      place it names survives without it;
 *   3. `dy:precisionMeters` describes what was actually done — it comes from
 *      the settings, the owner may override it, and whatever number reaches the
 *      wire, the pair beside it is that grid's;
 *   4. it FAILS CLOSED: settings that cannot be read disable the controls with
 *      a stated reason, while valid settings with no home region leave them
 *      live. Conflating those two is the failure that silently strips the pin
 *      from every entry of everyone who never set a home region.
 *
 * WHAT IS NOT PINNED HERE, deliberately: whether the owner is TOLD that a
 * coordinate was dropped for being inside the home region. It would be kind,
 * §9 does not require it, and a wording assertion nobody agreed on is how a
 * test starts dictating copy.
 * ════════════════════════════════════════════════════════════════════════ */

describe("controls for section 1", () => {
  /**
   * NOT TESTS OF THE EDITOR — section 0's kind, and they pass on their first
   * run for the same reason. Every assertion in this section rests on the four
   * settings documents meaning what the tests think they mean and on the
   * hard-coded snapped values being the ones the real grid produces. Both are
   * things that go wrong silently: a mutation that no longer applies serves a
   * perfectly good document to a "this is refused" test, and a grid change
   * makes five tests fail with no hint of why.
   */
  it("the four settings documents are the ones this section thinks they are", async () => {
    servePod({ [SETTINGS_URL]: PRIVACY_TTL });
    const normative = await readPrivacySettings(SETTINGS_URL);
    expect(normative.ok, normative.ok ? "" : describeError(normative.error)).toBe(true);
    if (!normative.ok) return;
    expect(normative.value.defaultPrecisionMeters).toBe(500);
    expect(normative.value.home).toEqual({ lat: 45.4655, long: 9.1866, radiusMeters: 3000 });

    // Valid, and deliberately WITHOUT a home region — the case §7.6 calls "I
    // have no home to protect". The mutation guard has already proved the graph
    // changed; this proves it changed into something still readable, which is
    // the half a `.replace` cannot tell you.
    servePod({ [SETTINGS_URL]: NO_HOME_TTL });
    const noHome = await readPrivacySettings(SETTINGS_URL);
    expect(noHome.ok, noHome.ok ? "" : describeError(noHome.error)).toBe(true);
    if (!noHome.ok) return;
    expect(noHome.value.home, "the no-home fixture still declares a home region").toBeUndefined();
    expect(noHome.value.defaultPrecisionMeters).toBe(500);

    // Half a home region: REFUSED, and that is what makes the fail-closed test
    // below a test of the editor rather than of a document nobody rejected.
    servePod({ [SETTINGS_URL]: HALF_HOME_TTL });
    expect(
      (await readPrivacySettings(SETTINGS_URL)).ok,
      "the half-written home region reads fine, so the fail-closed case below is served a valid document",
    ).toBe(false);

    // And the third precision really is a third precision.
    servePod({ [SETTINGS_URL]: PRECISION_2000_TTL });
    const other = await readPrivacySettings(SETTINGS_URL);
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.value.defaultPrecisionMeters).toBe(2000);
  });

  it("the snapped values asserted below are the ones lib/pod/fuzz.ts produces", () => {
    const at = (metres: number) =>
      snapToPrecision(Number(TYPED.lat), Number(TYPED.long), metres);

    for (const [metres, expected] of [
      [500, SNAP_500],
      [2000, SNAP_2000],
      [10_000, SNAP_10KM],
    ] as const) {
      const snapped = at(metres);
      expect({ lat: Number(snapped.lat), long: Number(snapped.long) }, `@${metres}m`).toEqual(
        expected,
      );
    }

    const outside = snapToPrecision(Number(OUTSIDE_HOME.lat), Number(OUTSIDE_HOME.long), 500);
    expect({ lat: Number(outside.lat), long: Number(outside.long) }).toEqual(SNAP_OUTSIDE_500);

    // THE SUBSTRING PROPERTY, which is what makes "the typed pair appears
    // nowhere" an assertion capable of failing. If a future grid published
    // enough digits to contain the typed value, that test would pass while
    // leaking, and this control is where that gets caught.
    const published = Object.values({ SNAP_500, SNAP_2000, SNAP_10KM, SNAP_OUTSIDE_500 })
      .flatMap((p) => [String(p.lat), String(p.long)])
      .join(" ");
    expect(published).not.toContain(TYPED.lat);
    expect(published).not.toContain(TYPED.long);

    // And the snap really moves the point: at 500 m these differ by ~250 m.
    expect(Number(TYPED.lat)).not.toBe(SNAP_500.lat);
    expect(Number(TYPED.long)).not.toBe(SNAP_500.long);
  });
});

describe("entry editor — what a stranger can fetch", () => {
  /**
   * THE TEST THE TWO DELETED PINS WERE PROTECTING.
   *
   * §9: "Resources are publicly readable, so a design that stores a true
   * coordinate next to a 'please blur this' flag leaks immediately: anyone can
   * fetch the raw triple." There is no render-time mitigation behind this and
   * no second chance after the PUT.
   *
   * WHAT WOULD BREAK IT: building `place.geo` from the form state instead of
   * from the `FuzzResult`; calling `fuzzForPublication` and then writing the
   * inputs anyway; fuzzing for the entry document and passing the raw pair to
   * the index row; rounding the typed value instead of snapping it.
   */
  it("publishes the snapped pair, and the typed one reaches no request at all", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await typeCoordinate(TYPED);
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "nothing was written to the Pod at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    // The premise: this really is the save of the form that was filled in.
    expect(oneObject(quads, `${put!.url}#it`, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );

    const geo = geoNodeOf(quads, put!.url);
    expect(
      geo,
      "no #geo node reachable from <#it> via schema:contentLocation and schema:geo",
    ).toBeDefined();
    expect(oneObject(quads, geo!, RDF.type)?.value).toBe(SCHEMA.GeoCoordinates);

    // WHAT WAS PUBLISHED. Compared as numbers, never as bytes: §11 guardrail 6
    // — "35.6938 versus 35.69380 are free choices any library upgrade may
    // change".
    for (const predicate of [SCHEMA.latitude, GEO.lat]) {
      expect(Number(oneObject(quads, geo!, predicate)?.value), predicate).toBe(SNAP_500.lat);
    }
    for (const predicate of [SCHEMA.longitude, GEO.long]) {
      expect(Number(oneObject(quads, geo!, predicate)?.value), predicate).toBe(SNAP_500.long);
    }
    expect(oneObject(quads, geo!, DY.precisionMeters)?.value).toBe("500");

    // Fragments, never blank nodes (§11 guardrail 4) — `triples` throws on one.
    expect(() => triples(put!.body, put!.url)).not.toThrow();

    // AND THE TYPED PAIR IS IN NOTHING THAT LEFT THE BROWSER. Not scoped to the
    // entry document: a coordinate that escaped through the index row or a
    // query string has escaped.
    const wire = pod.wire();
    expect(wire, "the typed latitude is on the wire").not.toContain(TYPED.lat);
    expect(wire, "the typed longitude is on the wire").not.toContain(TYPED.long);
    // The mutation half: the snapped one IS there, so "nowhere" cannot be
    // satisfied by an editor that published no coordinate at all.
    expect(wire).toContain(String(SNAP_500.lat));

    // The index row carries the same snapped pair (§7.4's flat dy: geo terms).
    const indexPut = pod.indexPut();
    expect(indexPut, "the index was not written, so the map has no pin").toBeDefined();
    const { quads: rows, row } = indexRowOf(indexPut!.body, indexPut!.url, put!.url);
    expect(row, "no index row points at the entry that was just written").toBeDefined();
    expect(Number(oneObject(rows, row!, DY.lat)?.value)).toBe(SNAP_500.lat);
    expect(Number(oneObject(rows, row!, DY.long)?.value)).toBe(SNAP_500.long);
    expect(oneObject(rows, row!, DY.precisionMeters)?.value).toBe("500");
  });

  /**
   * §6, and CLAUDE.md's hard rule: "xsd:decimal for coordinates (never float),
   * xsd:integer for counts". BOTH SERIALISERS, because there are two —
   * lib/pod/entry-model.ts writes the `#geo` node and lib/pod/index-model.ts
   * writes the flat row, and lib/pod/literals.ts exists precisely because "a
   * second copy of these four lines in a second serialiser is how one of them
   * ends up writing 1e-7 while the other does not".
   *
   * WHAT WOULD BREAK IT: handing `place.geo` a string instead of a number, so
   * that n3 infers `xsd:string`; a serialiser reaching for `xsd:float`; a value
   * large or small enough to reach exponent notation, which `xsd:decimal` has
   * no form for.
   */
  it("writes xsd:decimal for the pair and xsd:integer for the precision", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await typeCoordinate(TYPED);
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const geo = geoNodeOf(quads, put.url)!;
    expect(geo, "no #geo node to check the datatypes of").toBeDefined();

    for (const predicate of [SCHEMA.latitude, SCHEMA.longitude, GEO.lat, GEO.long]) {
      const term = oneObject(quads, geo, predicate);
      expect(datatypeOf(term), predicate).toBe(XSD.decimal);
      // A decimal point and no exponent: "35" and "3.5e1" are both things a
      // careless serialiser produces and neither is what §6 asks for.
      expect(term?.value, predicate).toMatch(/^-?\d+\.\d+$/);
    }

    const precision = oneObject(quads, geo, DY.precisionMeters);
    expect(datatypeOf(precision)).toBe(XSD.integer);
    expect(precision?.value).toMatch(/^\d+$/);

    // The second serialiser, on the same values.
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put.url);
    expect(row).toBeDefined();
    expect(datatypeOf(oneObject(rows, row!, DY.lat))).toBe(XSD.decimal);
    expect(datatypeOf(oneObject(rows, row!, DY.long))).toBe(XSD.decimal);
    expect(datatypeOf(oneObject(rows, row!, DY.precisionMeters))).toBe(XSD.integer);
  });
});

describe("entry editor — the home region", () => {
  /**
   * §9 step 2, in its own words: "Inside the home radius, drop the coordinate
   * entirely. Do not coarsen it… The entry is still written, with its place
   * name if it has one — it is the geometry that is absent, not the entry."
   *
   * DRIVEN AS AN EDIT OF THE §7.3 ENTRY, for two reasons. The entry already
   * HAS a place with a name and an (already fuzzed) coordinate, so "the name
   * survives, the geometry does not" is assertable at all — the editor has no
   * place-name control, so a create has no name to keep. And it makes the drop
   * a REMOVAL rather than an omission: the stored `#geo` and the index row's
   * `dy:lat` have to go, and a stale coordinate left behind in either is a leak
   * that outlives the edit that was meant to remove it.
   *
   * THE ALLOW-CASE IS IN THE SAME TEST and it is 5.9 km from the same centre.
   * Without it an editor that dropped every coordinate on an edit would pass,
   * and that editor is indistinguishable from this one on the drop half alone.
   *
   * WHAT WOULD BREAK IT: coarsening instead of dropping (the tempting "20 km is
   * coarse enough", which §9 answers at length); keeping `place: existing.place`
   * and merely adding the new geometry, so the old one survives; dropping the
   * whole place along with its geometry; leaving the index row alone.
   */
  it("drops the geometry of a point inside it, keeps the place, and publishes one just outside", async () => {
    const fake = fakeStudioSession();

    /* THE DROP. */
    const pod = podFake();
    const entry = await specEntry();
    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });

    await typeCoordinate(INSIDE_HOME);
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "§9: it is the geometry that is absent, not the entry").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    // The place is still named. The premise for that assertion is the fixture:
    // if §7.3 ever loses its place name this fails here rather than passing for
    // an editor that dropped the lot.
    expect(ENTRY_TTL, "the §7.3 fixture no longer names a place").toContain(SPEC_PLACE_NAME);
    const place = oneObject(quads, `${put!.url}#it`, SCHEMA.contentLocation)?.value;
    expect(place, "the place went with the geometry").toBeDefined();
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe(SPEC_PLACE_NAME);

    // NOT ONE COORDINATE TRIPLE, anywhere in the document.
    for (const predicate of [
      SCHEMA.geo,
      SCHEMA.latitude,
      SCHEMA.longitude,
      GEO.lat,
      GEO.long,
      DY.precisionMeters,
    ]) {
      expect(
        quads.filter((q) => q.predicate.value === predicate),
        `${predicate} survived a drop`,
      ).toEqual([]);
    }
    // Nor the digits, anywhere on the wire — including the ones that were
    // typed, which is the pair that would identify the owner's front door.
    expect(pod.wire()).not.toContain(INSIDE_HOME.lat);
    expect(pod.wire()).not.toContain(INSIDE_HOME.long);

    // The index row loses what §7.4 had for it. The premise first, so this
    // cannot pass against a fixture that never carried a coordinate.
    expect(INDEX_TTL, "the §7.4 fixture's row no longer carries dy:lat").toContain("dy:lat");
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put!.url);
    expect(row).toBeDefined();
    for (const predicate of [DY.lat, DY.long, DY.precisionMeters]) {
      expect(
        objectsOf(rows, row!, predicate),
        `the index row kept ${predicate} after the entry dropped its geometry`,
      ).toEqual([]);
    }

    cleanup();

    /* THE ALLOW-CASE, 5.9 km away: the same form, the same settings, the same
       home region, and this one publishes. */
    const outside = podFake();
    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });

    await typeCoordinate(OUTSIDE_HOME);
    await clickSaveAndWait();

    const second = outside.entryPut()!;
    const secondQuads = quadsOf(second.body, second.url);
    const geo = geoNodeOf(secondQuads, second.url);
    expect(
      geo,
      "a point 5.9 km outside a 3 km home region published nothing: this editor drops every coordinate, and the half of this test above proves nothing",
    ).toBeDefined();
    expect(Number(oneObject(secondQuads, geo!, SCHEMA.latitude)?.value)).toBe(SNAP_OUTSIDE_500.lat);
    expect(Number(oneObject(secondQuads, geo!, SCHEMA.longitude)?.value)).toBe(
      SNAP_OUTSIDE_500.long,
    );
    expect(outside.wire()).not.toContain(OUTSIDE_HOME.lat);
    expect(outside.wire()).not.toContain(OUTSIDE_HOME.long);
  });
});

/* ─────────── 1a-bis. half a pair is not a coordinate (ruling F-A) ───────── */

describe("entry editor — one coordinate box filled and the other left empty", () => {
  /**
   * `Number("")` IS `0`, AND A PLAUSIBLE-LOOKING PIN IS WHERE THAT LANDS —
   * WORSE THAN AN IMPLAUSIBLE ONE, BECAUSE NOTHING ON SCREEN OR ON THE MAP
   * FLAGS IT.
   *
   * `save()` decides whether a coordinate is written at all with
   * `lat.trim() !== "" || long.trim() !== ""` — an OR, so one box is enough —
   * and then composes the point as `{ lat: Number(lat), long: Number(long) }`.
   * With only a latitude typed the empty box arrives as `0`, which is a finite,
   * in-range longitude that `fuzzForPublication` has no reason to refuse.
   * MEASURED against §7.6's own settings, through the real function, rather
   * than reasoned about:
   *
   *   { lat: 45.5155, long: 0      } → snap 45.51486 / 0.00000
   *   { lat: 0,       long: 9.2103 } → snap 0.00000  / 9.20909
   *
   * Both publish, and the two errors do not even land in the same ocean.
   * Leg 1's point is 0° east of the owner's own latitude — not "700 km off the
   * African coast", which is the OTHER leg's story, but inland in south-west
   * France, a plausible-looking pin on land. Leg 2's point IS the Gulf of
   * Guinea, but only a few tens of km off Gabon — the 700-odd-km figure
   * belongs to `{0, 0}` (Null Island, elsewhere in this file), not to either
   * leg here. Either way `dy:precisionMeters 500` stands beside a coordinate
   * the owner never chose, describing it as accurate to within half a
   * kilometre.
   *
   * RULING F-A: A HALF-FILLED PAIR IS NO COORDINATE, and falls through to
   * `existing?.place?.geo` exactly as an empty pair does. §9's fail-closed rule
   * everywhere else — an unreadable gate, an unusable grid, `insideHome` — is to
   * drop rather than approximate, and dropping what the owner half-typed is
   * plainly better than publishing a coordinate they did not choose. Both boxes
   * are on screen, so nothing is hidden from them; TELLING them is the better
   * long-term answer and is an open item rather than this test's subject.
   *
   * WHY RULING T3-A DID NOT ALREADY COVER IT: its stated cost was that an owner
   * who types one number "must type the second, rather than getting a silently
   * wrong location" — which assumed they are forced to notice. They are not.
   * The save succeeds, the outcome region says so, and nothing on the form is
   * red.
   *
   * ASSERTED AT THE WIRE, NEVER ON THE CONTROLS, and the ruling is why: it
   * fences `touchedCoordinate` explicitly — that flag decides whether a
   * coordinate is written AT ALL and Task 3's review confirmed it — so this
   * test may not be about any particular internal. What it is about is the
   * document a stranger can `curl`.
   *
   * THREE LEGS, AND THE THIRD IS WHAT STOPS THE FIRST TWO BEING VACUOUS:
   *
   *   1. A CREATE with only the latitude: no `#geo`, no coordinate predicate
   *      anywhere, and no `dy:lat` on the index row. On a create there is no
   *      stored geometry to fall through to, so "no coordinate" is the whole
   *      outcome.
   *   2. AN EDIT of the §7.3 entry with only the longitude — the MIRROR half,
   *      because a fix that checked one box and not the other would leave this
   *      direction exactly as it is. Here the fall-through is visible: the
   *      entry's own stored pin has to survive, unchanged and un-re-snapped,
   *      which is a stronger claim than "nothing was written".
   *   3. THE ALLOW-CASE, in the same file's own digits: `OUTSIDE_HOME` is the
   *      pair the home-region test above publishes, and legs 1 and 2 each type
   *      exactly HALF of it. So the drop cannot be the home region, cannot be a
   *      dead control, and cannot be an editor that publishes no coordinate at
   *      all — this leg types both boxes and `SNAP_OUTSIDE_500` reaches the Pod.
   *
   * `awaitLiveCoordinateControls()` IN EVERY LEG, for the trap that has already
   * made two pins in this file vacuous this stage: §7.6 arrives over MSW
   * mid-flight, `fireEvent.change` fills a disabled input perfectly happily, and
   * a test that asserts "no coordinate was published" against a form nobody
   * could have typed into is green and worthless. It waits for the precision
   * control to read §7.6's own 500, which cannot happen before the settings
   * have landed.
   *
   * WHAT WOULD BREAK IT: today's code; treating a half-pair as a DROP — the
   * §9-step-2 removal — rather than as untouched, which leg 2 catches by asking
   * for the stored pin back; a completeness check on `lat` alone, which leg 2
   * also catches; refusing the SAVE instead of the coordinate, which every leg
   * catches, since §9 is explicit that a coordinate's absence still writes the
   * entry.
   */
  it("writes no coordinate from a half-filled pair, and leaves a stored one alone", async () => {
    const fake = fakeStudioSession();

    /* ── LEG 1: A CREATE, LATITUDE ONLY ─────────────────────────────────── */
    const pod = podFake();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    fillNewEntry();
    await awaitLiveCoordinateControls();
    expect(
      typeAsUser(LABEL.latitude, OUTSIDE_HOME.lat),
      "the latitude control refused the keystroke",
    ).toBe(true);
    // AND THE HALF-PAIR REALLY IS THE STATE THIS TEST IS ABOUT: the typed value
    // stuck, and the other box is empty rather than holding something a
    // previous render left behind.
    expect(shownValue(LABEL.latitude), "the typed latitude did not stick").toBe(OUTSIDE_HOME.lat);
    expect(
      shownValue(LABEL.longitude),
      "the longitude box is not empty, so this is a whole pair and the defect is out of reach",
    ).toBe("");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "§9: it is the geometry that is absent, not the entry").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);
    // The premise: this really is the save of the form that was filled in.
    expect(oneObject(quads, `${put!.url}#it`, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );

    expect(
      geoNodeOf(quads, put!.url),
      "a coordinate was published from one typed number: the empty box became 0 and the pin sits 0° east of the typed latitude, inland in south-west France",
    ).toBeUndefined();
    for (const predicate of [
      SCHEMA.geo,
      SCHEMA.latitude,
      SCHEMA.longitude,
      GEO.lat,
      GEO.long,
      DY.precisionMeters,
    ]) {
      expect(
        quads.filter((q) => q.predicate.value === predicate),
        `${predicate} was written from half a pair`,
      ).toEqual([]);
    }

    // The index row is the other place a coordinate escapes through (§7.4).
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put!.url);
    expect(row, "no index row points at the entry that was just written").toBeDefined();
    for (const predicate of [DY.lat, DY.long, DY.precisionMeters]) {
      expect(
        objectsOf(rows, row!, predicate),
        `the index row carries ${predicate} for a coordinate the entry does not have`,
      ).toEqual([]);
    }
    // And the digits the owner typed are on no request at all.
    expect(pod.wire(), "the typed latitude is on the wire").not.toContain(OUTSIDE_HOME.lat);

    cleanup();

    /* ── LEG 2: AN EDIT, LONGITUDE ONLY — the mirror half, over a stored pin */
    const over = podFake();
    const entry = await specEntry();
    const stored = entry.place?.geo;
    expect(
      stored,
      "the §7.3 fixture no longer carries a coordinate, so this leg is not about a stored pin",
    ).toBeDefined();

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });

    await awaitLiveCoordinateControls();
    // The boxes start EMPTY on an edit, even for an entry that has a coordinate
    // — the premise for "one box filled" being reachable here at all.
    expect(shownValue(LABEL.latitude), "the latitude box was seeded from the stored pin").toBe("");
    expect(
      typeAsUser(LABEL.longitude, OUTSIDE_HOME.long),
      "the longitude control refused the keystroke",
    ).toBe(true);
    expect(shownValue(LABEL.longitude), "the typed longitude did not stick").toBe(
      OUTSIDE_HOME.long,
    );

    await clickSaveAndWait();

    const edited = over.entryPut();
    expect(edited, "the edit was never written").toBeDefined();
    const editedQuads = quadsOf(edited!.body, edited!.url);
    const geo = geoNodeOf(editedQuads, edited!.url);
    expect(
      geo,
      "half a pair deleted the coordinate the entry already had: that is §9 step 2's REMOVAL, and an empty pair is what this has to behave like",
    ).toBeDefined();
    expect(
      [
        Number(oneObject(editedQuads, geo!, SCHEMA.latitude)?.value),
        Number(oneObject(editedQuads, geo!, SCHEMA.longitude)?.value),
      ],
      "the stored pin was replaced by one composed from an empty box: `Number(\"\")` is 0, so the latitude is the equator and the entry is 4 000 km from Tokyo",
    ).toEqual([stored!.lat, stored!.long]);
    expect(
      Number(oneObject(editedQuads, geo!, DY.precisionMeters)?.value),
      "the carried coordinate's precision moved",
    ).toBe(stored!.precisionMeters);
    expect(over.wire(), "the typed longitude is on the wire").not.toContain(OUTSIDE_HOME.long);
    // And the index row says the same thing the entry does.
    const second = indexRowOf(over.indexPut()!.body, over.indexPut()!.url, edited!.url);
    expect(second.row).toBeDefined();
    expect(Number(oneObject(second.quads, second.row!, DY.lat)?.value)).toBe(stored!.lat);
    expect(Number(oneObject(second.quads, second.row!, DY.long)?.value)).toBe(stored!.long);

    cleanup();

    /* ── LEG 3: THE ALLOW-CASE, the same digits with both boxes filled ───── */
    const whole = podFake();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    fillNewEntry();
    await typeCoordinate(OUTSIDE_HOME);
    await clickSaveAndWait();

    const published = whole.entryPut();
    expect(published, "a whole pair wrote nothing at all").toBeDefined();
    const publishedQuads = quadsOf(published!.body, published!.url);
    const publishedGeo = geoNodeOf(publishedQuads, published!.url);
    expect(
      publishedGeo,
      "the whole pair published nothing either: this editor writes no coordinate at all, and the two legs above prove nothing",
    ).toBeDefined();
    expect(Number(oneObject(publishedQuads, publishedGeo!, SCHEMA.latitude)?.value)).toBe(
      SNAP_OUTSIDE_500.lat,
    );
    expect(Number(oneObject(publishedQuads, publishedGeo!, SCHEMA.longitude)?.value)).toBe(
      SNAP_OUTSIDE_500.long,
    );
  });
});

describe("entry editor — the precision it claims", () => {
  /**
   * §7.6: `dy:defaultPrecisionMeters` "is required outright, with no built-in
   * fallback, because a fallback is a distance this project would be choosing
   * for someone else's front door". A preset that ignores the owner's setting
   * is that fallback wearing a select's clothes — and it is invisible, because
   * both numbers look equally deliberate on the wire.
   *
   * THE SETTINGS VALUE IS TAKEN VERBATIM, AND THAT IS A DECISION THIS FILE IS
   * MAKING. The control offers exact / ~100 m / ~1 km / ~10 km, and §7.6's own
   * fixture says 500 — which is none of them. Rounding to the nearest option
   * would be defensible in one direction only (coarser is never a leak), and it
   * is still refused here: rounding COARSER publishes a pin further from the
   * truth than the owner asked for while `dy:precisionMeters` reports it as
   * intentional, and rounding FINER is a leak. So the settings value joins the
   * list rather than being mapped onto it.
   *
   * TWO DIFFERENT DOCUMENTS, because one would be satisfied by a constant that
   * happens to equal the fixture.
   *
   * WHAT WOULD BREAK IT: a default in the component; presetting from the first
   * option; reading the settings but passing `undefined` to
   * `fuzzForPublication` and writing the select's value to the Pod.
   */
  it("presets the precision from the settings, and is reading them rather than guessing", async () => {
    const fake = fakeStudioSession();

    const first = podFake();
    await renderEditor(fake.session);
    fillNewEntry();
    await typeCoordinate(TYPED);
    await clickSaveAndWait();

    const one = first.entryPut()!;
    const oneQuads = quadsOf(one.body, one.url);
    const oneGeo = geoNodeOf(oneQuads, one.url);
    expect(oneGeo, "no coordinate was published under the normative settings").toBeDefined();
    expect(oneObject(oneQuads, oneGeo!, DY.precisionMeters)?.value).toBe("500");
    expect(Number(oneObject(oneQuads, oneGeo!, SCHEMA.latitude)?.value)).toBe(SNAP_500.lat);

    // The settings really were read, on the session's own fetch: this resource
    // is owner-only and an anonymous GET is a 401 on a real Pod.
    expect(first.settingsGet(), "the editor never read §7.6 at all").toBeDefined();
    expect(first.settingsGet()!.headers.authorization).toBe(CREDENTIAL);

    cleanup();

    /* THE SAME FORM, A DIFFERENT SETTINGS DOCUMENT. */
    const second = podFake({ settings: PRECISION_2000_TTL });
    await renderEditor(fake.session);
    fillNewEntry();
    await typeCoordinate(TYPED);
    await clickSaveAndWait();

    const two = second.entryPut()!;
    const twoQuads = quadsOf(two.body, two.url);
    const twoGeo = geoNodeOf(twoQuads, two.url);
    expect(twoGeo, "no coordinate was published under the 2000 m settings").toBeDefined();
    expect(
      oneObject(twoQuads, twoGeo!, DY.precisionMeters)?.value,
      "the precision on the wire did not follow the settings: it is a constant in the editor",
    ).toBe("2000");
    // And the pair moved with it, which is what makes the number honest rather
    // than a label stuck on a 500 m snap.
    expect(Number(oneObject(twoQuads, twoGeo!, SCHEMA.latitude)?.value)).toBe(SNAP_2000.lat);
    expect(Number(oneObject(twoQuads, twoGeo!, SCHEMA.longitude)?.value)).toBe(SNAP_2000.long);
    expect(second.wire()).not.toContain(TYPED.lat);
  });

  /**
   * The override, and the invariant that survives whatever the options turn out
   * to be: THE PAIR ON THE WIRE IS THE PAIR THAT PRECISION PRODUCES. §9 step 3
   * — "write `dy:precisionMeters` to match what was actually done" — and
   * test/fuzz.test.ts section 9 says why in the other direction: "If the
   * reported number is not the one applied, the triple is a lie in whichever
   * direction is worse."
   *
   * WHAT WOULD BREAK IT: keeping the select's value in state and passing the
   * settings default to `fuzzForPublication` (or the reverse); writing
   * `result.precisionMeters` from the form rather than from the result.
   */
  it("applies the precision the owner chose, and writes the one it applied", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await typeCoordinate(TYPED);
    setChoice(LABEL.precision, /\b10\s*km/i);
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const geo = geoNodeOf(quads, put.url);
    expect(geo, "the override published no coordinate at all").toBeDefined();

    expect(oneObject(quads, geo!, DY.precisionMeters)?.value).toBe("10000");
    expect(Number(oneObject(quads, geo!, SCHEMA.latitude)?.value)).toBe(SNAP_10KM.lat);
    expect(Number(oneObject(quads, geo!, SCHEMA.longitude)?.value)).toBe(SNAP_10KM.long);

    /* THE HONEST-PRECISION INVARIANT, derived from the wire itself rather than
       from this file's constants: whatever number `dy:precisionMeters` claims,
       the pair beside it is that grid's. It is the assertion that survives a
       change to the option list, and the one that catches an editor that
       applied one precision and reported another — which is the shape §9 step 3
       and test/fuzz.test.ts section 9 both name as "a lie in whichever
       direction is worse". */
    const claimed = Number(oneObject(quads, geo!, DY.precisionMeters)!.value);
    const honest = snapToPrecision(Number(TYPED.lat), Number(TYPED.long), claimed);
    expect(
      Number(oneObject(quads, geo!, SCHEMA.latitude)?.value),
      `the published latitude is not on the ${claimed} m grid the triple claims`,
    ).toBe(Number(honest.lat));
    expect(Number(oneObject(quads, geo!, SCHEMA.longitude)?.value)).toBe(Number(honest.long));

    // The override really overrode: the settings' own 500 m answer is a
    // different point, and it is not what was published.
    expect(Number(oneObject(quads, geo!, SCHEMA.latitude)?.value)).not.toBe(SNAP_500.lat);
    expect(pod.wire()).not.toContain(TYPED.lat);
    expect(pod.wire()).not.toContain(TYPED.long);

    // And the index row agrees with the entry about which grid was used.
    const { quads: rows, row } = indexRowOf(pod.indexPut()!.body, pod.indexPut()!.url, put.url);
    expect(oneObject(rows, row!, DY.precisionMeters)?.value).toBe("10000");
  });
});

describe("entry editor — settings it cannot read", () => {
  /**
   * §9's fail-closed rule, and the posture is `sameWebId`'s: the control is
   * dead before it can take input, not live and refused at save time. "No
   * readable settings" and "no home region" are different facts and only one of
   * them is safe to act on.
   *
   * THE ALLOW-CASE IS THE THIRD ARM, and it is the one that matters most: §7.6
   * calls settings with no home region "a legitimate configuration" meaning "I
   * have no home to protect", and reading that as unreadable would silently
   * strip the pin from every entry of everyone who has not set one — forever,
   * and without a single error anywhere.
   *
   * WHAT WOULD BREAK EACH ARM: treating a failed read as "no home region" fails
   * A and B; treating an absent `home` as a failed read fails C; disabling the
   * controls without saying why fails the description half; a `title` instead
   * of an association fails it too (the control at the end of section 8
   * measures that distinction); a hard-coded `aria-describedby` pointing at an
   * element that is not rendered computes to nothing and fails the resolving
   * half.
   */
  it("disables the coordinate controls with a reason, and leaves them live when there is simply no home region", async () => {
    const fake = fakeStudioSession();

    /* A. NO privacy.ttl AT ALL — §9: "on a Pod that has never had a
       privacy.ttl, every entry is written with no coordinate", and that is what
       a brand-new deployment does by default. */
    podFake({ settings: 404 });
    await renderEditor(fake.session);

    requireCoordinateControls();
    await waitFor(() =>
      expect(
        screen.getByLabelText(LABEL.latitude),
        "the latitude control never explained why it is dead",
      ).toHaveAccessibleDescription(NO_SETTINGS_REASON),
    );
    for (const [what, control] of coordinateControls()) {
      expect(
        control,
        `the ${what} control takes input although the settings could not be read`,
      ).toBeDisabled();
    }

    // The reason is an ASSOCIATION that resolves — see the control at the end
    // of section 8: a `title` computes to a description too, and a dangling
    // IDREF computes to "" while looking correct in the markup.
    const ids = describedByIdsOf(screen.getByLabelText(LABEL.latitude));
    expect(ids, "the reason is not associated with the control (a title is not enough)").not.toEqual(
      [],
    );
    expect(
      ids.filter((id) => document.getElementById(id) === null),
      "the description points at ids nothing in the document has",
    ).toEqual([]);

    // And the rest of the form is untouched: an unreadable settings document
    // costs the owner a map pin, not an editor.
    expect(screen.getByLabelText(LABEL.headline)).toBeEnabled();
    expect(saveButton()).toBeEnabled();
    cleanup();

    /* B. A HALF-WRITTEN HOME REGION. It parses, it is our own resource, and it
       is exactly the shape §7.6 says "publishes coordinates from the owner's
       doorstep while reporting success" if it is read leniently. */
    podFake({ settings: HALF_HOME_TTL });
    await renderEditor(fake.session);

    requireCoordinateControls();
    await waitFor(() =>
      expect(screen.getByLabelText(LABEL.latitude)).toHaveAccessibleDescription(
        NO_SETTINGS_REASON,
      ),
    );
    for (const [what, control] of coordinateControls()) {
      expect(control, `the ${what} control takes input on a half-written home region`).toBeDisabled();
    }
    cleanup();

    /* C. THE ALLOW-CASE: valid settings, no home region. Live, and publishing.
       Asserted at the wire rather than as an attribute, because "enabled" is
       satisfied by a control wired to nothing. */
    const pod = podFake({ settings: NO_HOME_TTL });
    await renderEditor(fake.session);

    fillNewEntry();
    await typeCoordinate(TYPED);
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "nothing was saved under settings with no home region").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);
    const geo = geoNodeOf(quads, put!.url);
    expect(
      geo,
      'settings that say "I have no home to protect" published no coordinate: this is the failure that strips every pin from a diary that never set a home region',
    ).toBeDefined();
    expect(Number(oneObject(quads, geo!, SCHEMA.latitude)?.value)).toBe(SNAP_500.lat);
    expect(pod.wire()).not.toContain(TYPED.lat);
  });

  /**
   * The other half of failing closed, and the one that decides whether this is
   * a privacy feature or an outage: §9 — "The entry is still written… it is the
   * geometry that is absent, not the entry."
   *
   * WHAT WOULD BREAK IT: refusing the save outright when the settings are
   * unreadable; reporting the save as failed; publishing a coordinate anyway
   * because the form happened to hold one.
   */
  it("still writes the entry when the settings cannot be read, with no geometry on it", async () => {
    const pod = podFake({ settings: 404 });
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    /* THE PREMISE, AND WITHOUT IT THIS TEST IS THE DELETED PIN AGAIN. "No
       coordinate predicate on the wire" is trivially true of an editor with no
       coordinate control at all — it was true of every save in this file until
       today. Requiring the controls to exist, and to be held, is what makes the
       assertions below about a save that HAD a coordinate to publish and did
       not publish it. */
    requireCoordinateControls();
    await waitFor(() =>
      expect(screen.getByLabelText(LABEL.latitude)).toHaveAccessibleDescription(
        NO_SETTINGS_REASON,
      ),
    );
    expect(screen.getByLabelText(LABEL.latitude)).toBeDisabled();

    fillNewEntry();
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "an unreadable privacy.ttl stopped the entry being written at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);
    expect(oneObject(quads, `${put!.url}#it`, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );

    for (const predicate of [
      SCHEMA.geo,
      SCHEMA.latitude,
      SCHEMA.longitude,
      GEO.lat,
      GEO.long,
      DY.precisionMeters,
    ]) {
      expect(quads.filter((q) => q.predicate.value === predicate), predicate).toEqual([]);
    }

    // The save is a save. §10's report is unaffected by a settings document
    // that has nothing to do with it.
    expect(outcomeText()).toMatch(/saved|published/i);
  });

  /**
   * THE FORM AS A WHOLE, once. The family query is the one section 0 measures;
   * here it is used to say that the editor grew exactly the three controls it
   * was meant to grow — a fourth (a "GPS" paste box, a "position" field, a
   * hidden `lng`) would be a second path to the same triple, and the fuzzing
   * would only be in front of one of them.
   */
  it("has exactly three coordinate controls, and they are the three that were designed", async () => {
    const fake = fakeStudioSession();
    const { container } = await renderEditor(fake.session);

    // The in-scope fields are still found by the same accessible query, so this
    // is not a form that failed to render.
    expect(screen.getAllByLabelText(LABEL.headline)).toHaveLength(1);
    expect(screen.getAllByLabelText(LABEL.slug)).toHaveLength(1);

    // Exactly one of each, named individually so a missing one says which.
    requireCoordinateControls();
    // Filtered to form controls: a `<legend>` naming the group is not a fourth
    // input, and this assertion is about inputs.
    const coordinateish = screen
      .queryAllByLabelText(COORDINATE_FIELD)
      .filter((el) => el.matches("input, textarea, select"));
    expect(
      coordinateish.map((el) => el.getAttribute("id") ?? el.tagName),
      "a fourth coordinate control: the fuzzing stands in front of three inputs and nothing stands in front of that one",
    ).toHaveLength(3);

    // And every control is nameable, because a control this file's queries
    // cannot find is a control none of the tests above can be said to cover —
    // a hidden input included, which is how a raw coordinate would ride along.
    const controls = [...container.querySelectorAll("input, textarea, select")];
    expect(controls.length).toBeGreaterThan(0);
    const unlabelled = controls.filter((c) => {
      const labels = (c as HTMLInputElement).labels;
      return (labels === null || labels.length === 0) && c.getAttribute("aria-label") === null;
    });
    expect(unlabelled.map((c) => `${c.tagName}#${c.getAttribute("id") ?? ""}`)).toEqual([]);
  });
});

// @vitest-environment jsdom
/** The studio's entry editor: section 1b — the place it names.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  INSIDE_HOME,
  LABEL,
  OUTSIDE_HOME,
  SNAP_OUTSIDE_500,
  SPEC_COUNTRY,
  SPEC_LOCALITY,
  SPEC_PLACE_NAME,
  addressNodeOf,
  clickSaveAndWait,
  datatypeOf,
  emptyLiteralsIn,
  fakeStorage,
  fakeStudioSession,
  fillNewEntry,
  geoNodeOf,
  indexRowOf,
  languageOf,
  objectsOf,
  oneObject,
  placeNodeOf,
  podFake,
  quadsOf,
  registerEditorLifecycle,
  renderEditor,
  requirePlaceControls,
  setText,
  shownValue,
  specEntry,
  typeCoordinate,
} from "./entry-editor.harness";
import { describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { DY, GEO, RDF, SCHEMA, XSD } from "@/lib/vocab";
import { triples } from "@/test/graph";
import { Place } from "@/lib/pod/schema";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 1b. THE PLACE IT NAMES — the three fields §9 leans on and nothing could set.
 *
 * `Place.name`, `.locality` and `.country` are read by lib/pod/read.ts,
 * serialised by lib/pod/entry-model.ts and carried through an edit by the save
 * path above — and until this section there was no control anywhere in the
 * studio that could put a value in any of them. The only way an entry had one
 * was if some other tool wrote it.
 *
 * WHY THAT IS A HOLE RATHER THAN A MISSING NICETY. §9 step 2 drops the
 * coordinate inside the home radius rather than coarsening it, and the stated
 * mitigation for what that costs is: "The entry is still written, with its
 * place name if it has one — it is the geometry that is absent, not the
 * entry." An editor with no place-name control has no name to keep, so every
 * entry the owner writes near home is placeless: no pin, no words, nothing.
 * The docblock of the home-region test above says so in as many words — "the
 * editor has no place-name control, so a create has no name to keep" — and
 * drives its assertion off the §7.3 fixture for exactly that reason. The test
 * below is the create that fixture was standing in for.
 *
 * THE THREE THINGS PINNED HERE, each a different failure:
 *
 *   1. a typed name reaches `<#place>` as `schema:name`, LANGUAGE-TAGGED (§6);
 *   2. a place may be a NAME WITH NO GEOMETRY AT ALL — both because the owner
 *      may simply not know the coordinate, and because that is precisely what
 *      §9 leaves behind near home;
 *   3. `schema:addressLocality` is language-tagged and `schema:addressCountry`
 *      is a PLAIN literal. lib/pod/entry-model.ts already draws that
 *      distinction — "a country CODE, not a country name — untagged for the
 *      same reason the slug is" — and this pins it from the editor's side,
 *      where the value is chosen.
 *
 * AND THE TWO HALVES OF "UNTOUCHED" VERSUS "REMOVED", which is the same
 * three-outcome logic `touchedCoordinate` already implements for geometry and
 * the same trap: an edit that never opens these boxes must carry the existing
 * place through unchanged, and an edit that EMPTIES one must remove it rather
 * than be read as having left it alone. `undefined` and `""` are different
 * instructions, and an implementation that conflates them either erases the
 * name of every entry edited from this form or makes a name impossible to
 * retract once written.
 *
 * WHAT IS NOT PINNED HERE, deliberately: the shape of the country control. A
 * two-letter text box and a select of ISO codes both satisfy `/country/i`, and
 * `shownValue` reads either. What may not vary is that the value reaching the
 * Pod is the untagged code §7.3 shows.
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — the place it names", () => {
  /**
   * §6, on the one predicate that carries prose about where the owner was.
   *
   * WHAT WOULD BREAK IT: holding the name in state and never composing it into
   * the `Entry`; composing it only when a coordinate was typed too, which is
   * the shape `placeFor`'s geometry-only signature invites; writing it as a
   * plain literal, which puts a human-readable string beyond the reach of every
   * language-aware consumer (§8's JSON-LD included).
   */
  it("puts a typed place name on <#place>, language-tagged", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "Gion, Kyoto");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "a place was named and nothing was written at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(
      place,
      "a place name was typed and no <#place> was written: the name went nowhere",
    ).toBe(`${put!.url}#place`);
    expect(oneObject(quads, place!, RDF.type)?.value).toBe(SCHEMA.Place);

    const name = oneObject(quads, place!, SCHEMA.name);
    expect(name?.value, "the name that reached the Pod is not the one that was typed").toBe(
      "Gion, Kyoto",
    );
    expect(
      languageOf(name),
      "§6: language-tag every human-readable literal — an untagged place name is one no consumer can place",
    ).not.toBe("");

    // Fragments, never blank nodes (§11 guardrail 4). `triples` throws on one.
    expect(() => triples(put!.body, put!.url)).not.toThrow();
  });

  /**
   * THE SCENARIO THIS WHOLE SECTION EXISTS FOR, in its simplest form: a place
   * that is a NAME AND NOTHING ELSE.
   *
   * It is legitimate on its own terms — "Gion, Kyoto" is a perfectly good
   * answer from an owner who never looked up a coordinate — and it is the
   * shape §9 leaves behind near home, which the next test drives directly.
   *
   * WHAT WOULD BREAK IT: making `<#place>` conditional on geometry, so a name
   * with no coordinate is silently discarded; inventing a `<#geo>` with empty
   * or zero coordinates to hang the place off, which publishes a pin in the
   * Gulf of Guinea; leaving `dy:lat` on the index row from a coordinate that
   * was never typed.
   */
  it("writes a place that has a name and no geometry at all", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "Gion, Kyoto");
    // AND DELIBERATELY NO COORDINATE. The latitude and longitude controls are
    // live here — the settings are the normative ones — and are left alone.
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "a named place with no coordinate was not written at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(place, "the place went with the coordinate that was never typed").toBeDefined();
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe("Gion, Kyoto");

    expect(
      geoNodeOf(quads, put!.url),
      "a place with no coordinate was given a <#geo> node anyway",
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
        `${predicate} on an entry whose coordinate was never typed`,
      ).toEqual([]);
    }

    // And the index row says the same thing, since that is what the map reads.
    const index = pod.indexPut();
    expect(index, "the index was not written").toBeDefined();
    const { quads: rows, row } = indexRowOf(index!.body, index!.url, put!.url);
    expect(row).toBeDefined();
    for (const predicate of [DY.lat, DY.long, DY.precisionMeters]) {
      expect(objectsOf(rows, row!, predicate), `the index row carries ${predicate}`).toEqual([]);
    }
  });

  /**
   * §9's MITIGATION, DELIVERED ON A CREATE — the sentence the home-region test
   * above could only assert against a fixture that already had a name.
   *
   * "Inside the home radius, drop the coordinate entirely… The entry is still
   * written, with its place name if it has one — it is the geometry that is
   * absent, not the entry."
   *
   * THE ALLOW-CASE IS IN THE SAME TEST and it is 5.9 km from the same centre,
   * for the reason the home-region test gives: without it, an editor that
   * dropped every coordinate — or one that refused to write a place whenever a
   * coordinate was dropped — passes the first half and is indistinguishable
   * from the right one.
   *
   * WHAT WOULD BREAK IT: composing the name into the place only on the branch
   * where the geometry survives, which is what `placeFor`'s current signature
   * invites — it takes the geometry and nothing else, so a name has no way in
   * except through `existing`, and on a create there is no `existing`.
   */
  it("keeps the name when the coordinate is dropped inside the home region, and publishes both outside it", async () => {
    const fake = fakeStudioSession();

    /* THE DROP. */
    const inside = podFake();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "The bar at the end of my street");
    await typeCoordinate(INSIDE_HOME);
    await clickSaveAndWait();

    const put = inside.entryPut();
    expect(put, "§9: it is the geometry that is absent, not the entry").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(
      place,
      "the place was dropped along with its geometry, so §9's mitigation delivers nothing",
    ).toBeDefined();
    expect(
      oneObject(quads, place!, SCHEMA.name)?.value,
      "the name the owner typed did not survive the drop: this is the hole §9 says is covered",
    ).toBe("The bar at the end of my street");

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
    expect(inside.wire()).not.toContain(INSIDE_HOME.lat);
    expect(inside.wire()).not.toContain(INSIDE_HOME.long);

    cleanup();

    /* THE ALLOW-CASE, 5.9 km away: the same form, the same settings, and this
       one publishes the name AND the snapped pair. */
    const outside = podFake();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "Parco Sempione");
    await typeCoordinate(OUTSIDE_HOME);
    await clickSaveAndWait();

    const second = outside.entryPut()!;
    const secondQuads = quadsOf(second.body, second.url);
    const secondPlace = placeNodeOf(secondQuads, second.url);
    expect(secondPlace, "the place vanished on the allow-case too").toBeDefined();
    expect(oneObject(secondQuads, secondPlace!, SCHEMA.name)?.value).toBe("Parco Sempione");

    const geo = geoNodeOf(secondQuads, second.url);
    expect(
      geo,
      "a point 5.9 km outside a 3 km home region published nothing: this editor drops every coordinate, and the half of this test above proves nothing",
    ).toBeDefined();
    expect(Number(oneObject(secondQuads, geo!, SCHEMA.latitude)?.value)).toBe(SNAP_OUTSIDE_500.lat);
    expect(Number(oneObject(secondQuads, geo!, SCHEMA.longitude)?.value)).toBe(
      SNAP_OUTSIDE_500.long,
    );
  });

  /**
   * THE ASYMMETRY, PINNED FROM THE SIDE THAT CHOOSES THE VALUE.
   *
   * §7.3 writes `schema:addressLocality "Tokyo"@en` and `schema:addressCountry
   * "JP"` — one is prose, the other is a code, and lib/pod/entry-model.ts
   * already spells the difference out. Language-tagging the country would make
   * `"JP"@en` a different RDF term from `"JP"`, so every consumer filtering on
   * the plain literal silently stops matching entries this studio wrote.
   *
   * WHAT WOULD BREAK IT: running the country through the same `text()` helper
   * as the locality "for consistency"; hanging the locality off `<#place>`
   * directly instead of through `<#address>`, which is a predicate schema.org
   * does not put there.
   */
  it("writes the locality language-tagged and the country as a plain literal", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "Gion, Kyoto");
    setText(LABEL.locality, "Kyoto");
    setText(LABEL.country, "JP");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "nothing was written at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const address = addressNodeOf(quads, put!.url);
    expect(
      address,
      "a locality and a country were typed and no <#address> was written",
    ).toBe(`${put!.url}#address`);
    expect(oneObject(quads, address!, RDF.type)?.value).toBe(SCHEMA.PostalAddress);

    const locality = oneObject(quads, address!, SCHEMA.addressLocality);
    expect(locality?.value).toBe("Kyoto");
    expect(languageOf(locality), "§6: a locality is prose and carries a tag").not.toBe("");

    const country = oneObject(quads, address!, SCHEMA.addressCountry);
    expect(country?.value).toBe("JP");
    expect(
      languageOf(country),
      '§7.3: a country CODE, not a country name — "JP"@en is a different term from "JP"',
    ).toBe("");
    expect(datatypeOf(country)).toBe(XSD.string);
  });

  /**
   * AN EDIT THAT TOUCHES NO PLACE FIELD CARRIES THE PLACE THROUGH UNTOUCHED —
   * the same rule `touchedCoordinate` already implements for geometry, and the
   * regression these three controls create the moment they exist.
   *
   * Before them, the place could only travel through as `existing?.place`.
   * With them, the form holds three strings that are composed into the `Entry`
   * on every save, and a form that did not LOAD them from the entry composes
   * three empty ones — so opening an entry and correcting a typo in the
   * headline silently deletes its place name, its locality and its country.
   * That is a data loss with no error, discoverable only by reading the Pod.
   *
   * THE CONTROLS ARE ASSERTED TO SHOW THE STORED VALUES, not merely the
   * outgoing document, because that is the half that makes the carry-through
   * real: an editor that kept a hidden copy of `existing.place` and wrote it
   * back would pass the wire assertions while showing the owner an empty box
   * they cannot edit and cannot clear.
   *
   * The premise comes off the normative fixture through the real reader, so a
   * §7.3 that stopped carrying an address fails here rather than passing
   * vacuously.
   */
  it("shows the stored place, and carries it through an edit that touches no place field", async () => {
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

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });

    requirePlaceControls();
    expect(shownValue(LABEL.placeName), "the stored place name was not loaded into the form").toBe(
      SPEC_PLACE_NAME,
    );
    expect(shownValue(LABEL.locality)).toBe(SPEC_LOCALITY);
    expect(shownValue(LABEL.country)).toBe(SPEC_COUNTRY);

    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the edit was never written").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    // The mutation half: an editor that wrote the fixture back untouched would
    // pass everything below while having saved nothing.
    expect(oneObject(quads, `${put!.url}#it`, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited",
    );

    const place = placeNodeOf(quads, put!.url);
    expect(place, "an edit to the headline deleted the entry's place").toBeDefined();
    const name = oneObject(quads, place!, SCHEMA.name);
    expect(name?.value, "an edit to the headline deleted the place name").toBe(SPEC_PLACE_NAME);
    expect(languageOf(name)).not.toBe("");

    const address = addressNodeOf(quads, put!.url);
    expect(address, "an edit to the headline deleted the address").toBeDefined();
    expect(oneObject(quads, address!, SCHEMA.addressLocality)?.value).toBe(SPEC_LOCALITY);
    expect(oneObject(quads, address!, SCHEMA.addressCountry)?.value).toBe(SPEC_COUNTRY);
  });

  /**
   * CLEARING A NAME REMOVES IT, which is a different instruction from leaving
   * it alone and has to stay one.
   *
   * This is the distinction `placeFor` already draws for geometry, in the save
   * path's own words: "nothing typed → the place travels through UNTOUCHED …
   * drop → the geometry is REMOVED". Text needs it just as badly and in both
   * directions. If `""` is read as "untouched", a name written by mistake — or
   * one the owner no longer wants on a public resource — can never be taken
   * off the Pod from this form. If `""` is written through as a literal, the
   * entry claims to be somewhere called nothing.
   *
   * AND THE PLACE MUST SURVIVE ITS OWN NAME, because the coordinate is still
   * there. That is `placeFor`'s existing copy-and-delete shape read the other
   * way round: its comment says "a `Place` that grows one must not lose it
   * every time a coordinate is dropped", and the same is true of a coordinate
   * when a name is dropped.
   *
   * THE SECOND HALF IS THE ALLOW-CASE FOR THE FIRST: a create that never
   * touches the three boxes must write no place text rather than three empty
   * literals — which is the same rule, seen from the state every new entry
   * starts in.
   */
  it("removes text that was cleared, keeps the geometry it did not touch, and writes no empty literals", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    const stored = entry.place?.geo;
    expect(stored, "the §7.3 fixture carries no coordinate for this test to preserve").toBeDefined();

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: fakeStorage().storage,
    });

    requirePlaceControls();
    // The premise: there really is something to clear.
    expect(shownValue(LABEL.placeName)).toBe(SPEC_PLACE_NAME);
    setText(LABEL.placeName, "");
    setText(LABEL.locality, "");
    setText(LABEL.country, "");
    expect(shownValue(LABEL.placeName), "the control refused to be emptied").toBe("");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "clearing the place stopped the entry being written at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(
      place,
      "clearing the text took the whole place with it, coordinate and all",
    ).toBeDefined();
    expect(
      objectsOf(quads, place!, SCHEMA.name),
      "the cleared name is still on the Pod: an empty box was read as 'left alone'",
    ).toEqual([]);
    expect(
      objectsOf(quads, place!, SCHEMA.address),
      "the cleared address is still on the Pod",
    ).toEqual([]);
    expect(
      emptyLiteralsIn(quads),
      "an empty literal was published in place of a removal",
    ).toEqual([]);

    // The geometry this edit never touched is untouched — values and datatype
    // both, since it is exactly the case §6 says is xsd:decimal and never float.
    const geo = geoNodeOf(quads, put!.url);
    expect(geo, "the untouched coordinate went with the cleared name").toBeDefined();
    const lat = oneObject(quads, geo!, SCHEMA.latitude);
    expect(Number(lat?.value)).toBe(stored!.lat);
    expect(datatypeOf(lat)).toBe(XSD.decimal);
    expect(Number(oneObject(quads, geo!, SCHEMA.longitude)?.value)).toBe(stored!.long);

    cleanup();

    /* THE ALLOW-CASE: the same three empty boxes, on a create that never
       touched them. Nothing about the place at all — not an empty name, not an
       empty address, not a <#place> with nothing on it. */
    const bare = podFake();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requirePlaceControls();
    fillNewEntry();
    await clickSaveAndWait();

    const created = bare.entryPut();
    expect(created, "the create was never written").toBeDefined();
    const createdQuads = quadsOf(created!.body, created!.url);
    expect(
      placeNodeOf(createdQuads, created!.url),
      "an entry with nothing to say about its place was given a <#place> anyway",
    ).toBeUndefined();
    expect(emptyLiteralsIn(createdQuads), "empty literals on a create").toEqual([]);
  });

  /**
   * A BOX HOLDING ONLY SPACES IS AN EMPTY BOX, AND NOTHING BELOW THE EDITOR
   * WILL SAY SO.
   *
   * This is not the same test as "clearing removes", and the difference is the
   * whole reason it exists. `""` is caught by every guard on the way down,
   * because they all ask "is it absent". A space is not absent:
   *
   *   - `Place.name` is `min(1)` and `" ".length === 1`, so the schema PASSES
   *     it — asserted below rather than assumed, because the opposite was
   *     written down as the justification for the trim and was false;
   *   - `entry-model.ts` guards on truthiness and `!== undefined`, and `" "` is
   *     truthy and defined, so it writes the triple;
   *   - `emptyLiteralsIn` above looks for `value === ""` and does not find it.
   *
   * What reaches the Pod is `schema:name " "@en` on a world-readable resource:
   * a name that renders as nothing in every consumer, that no reader can see in
   * order to ask for its removal, and that makes the entry claim to be
   * somewhere. The trim in `placeTextOf` is the only thing standing in front of
   * it, so it is pinned here.
   *
   * WHAT WOULD BREAK IT: deleting any of the three `.trim()` calls; comparing
   * `!== ""` instead of trimming; "tidying" the trim away on the grounds that
   * the schema validates the value.
   */
  it("treats three boxes holding only whitespace as three empty boxes", async () => {
    // The premise, measured: nothing downstream refuses a one-space name, so
    // this test is about the only guard there is rather than a redundant one.
    expect(
      Place.safeParse({ name: { value: " " }, locality: " ", country: " " }).success,
      "the schema now refuses a whitespace-only place, so this test is about a guard that moved",
    ).toBe(true);

    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: fakeStorage().storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "  ");
    setText(LABEL.locality, " ");
    setText(LABEL.country, "\t ");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the entry was not written at all").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    expect(
      placeNodeOf(quads, put!.url),
      "three boxes holding nothing but spaces were published as a place",
    ).toBeUndefined();

    // And said the other way round, so a `<#place>` reached by some other
    // predicate fails here too: no literal anywhere in the document is blank.
    expect(
      quads
        .filter((q) => q.object.termType === "Literal" && q.object.value.trim() === "")
        .map((q) => `${q.predicate.value} "${q.object.value}"`),
      "a whitespace-only literal reached the Pod: it renders as nothing and cannot be seen to be removed",
    ).toEqual([]);
  });
});

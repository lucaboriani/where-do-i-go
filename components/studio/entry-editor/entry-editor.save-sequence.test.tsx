// @vitest-environment jsdom
/** The studio's entry editor: sections 2-6 — the precondition round trip, what must not drop, the authenticated fetch, the trip choice, drafts must not leak.
 *  Split out of entry-editor.test.tsx; the shared rig is ./entry-editor.harness. */

import {
  ARRIVAL_URL,
  CREDENTIAL,
  JAPAN,
  LABEL,
  OWNER,
  PERU,
  POD,
  SPEC_CREATED,
  SPEC_OCCURRED,
  SPEC_PLACE_NAME,
  TRIPS,
  accessCalls,
  clickSaveAndWait,
  datatypeOf,
  fakeStudioSession,
  fillNewEntry,
  geoNodeOf,
  languageOf,
  objectsOf,
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
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { DCTERMS, DY, GEO, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE, XSD } from "@/lib/vocab";
import { snapToPrecision } from "@/lib/pod/fuzz";
import { TAGS } from "@/lib/pod/tags";
import { triples } from "@/test/graph";

registerEditorLifecycle();

/* ══════════════════════════════════════════════════════════════════════════
 * 2. THE PRECONDITION ROUND TRIP (§10).
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — preconditions", () => {
  it("creates with If-None-Match: * and never a blind PUT", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry({ slug: "2026-04-02-kyoto" });
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put).toBeDefined();
    expect(put!.url).toBe(`${JAPAN.entriesContainer}2026-04-02-kyoto.ttl`);
    expect(put!.headers["if-none-match"]).toBe("*");
    expect(put!.headers["if-match"]).toBeUndefined();
  });

  it("edits with If-Match carrying the ETag of the read that produced the state", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();

    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });
    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put).toBeDefined();
    // Back to the resource it read. An edit that PUT somewhere else would
    // orphan the original and leave the index pointing at it.
    expect(put!.url).toBe(ARRIVAL_URL);
    expect(put!.headers["if-match"]).toBe('"entry-7"');
    expect(put!.headers["if-none-match"]).toBeUndefined();
  });

  /**
   * THE FIRST OF THE TWO NAMED BUGS: a second save of a new entry that reuses
   * `{create: true}`.
   *
   * The resource now exists, so `If-None-Match: *` is a guaranteed 412 — and
   * the owner is told their work collided with itself. The ETag the server
   * returned on the first PUT is what the second must carry.
   */
  it("does not reuse If-None-Match on the second save of an entry it just created", async () => {
    const pod = podFake({ entryEtag: '"entry-created-1"' });
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await clickSaveAndWait();
    const first = pod.entryPut();
    expect(first?.headers["if-none-match"]).toBe("*");

    setText(LABEL.headline, "Rain on the Philosopher's Path, later");
    await clickSaveAndWait();

    const entryPuts = pod.puts().filter((r) => !r.url.endsWith("entries.ttl"));
    expect(entryPuts).toHaveLength(2);
    expect(entryPuts[1].headers["if-none-match"]).toBeUndefined();
    expect(entryPuts[1].headers["if-match"]).toBe('"entry-created-1"');
  });

  /**
   * THE SECOND: an ETag kept across two saves.
   *
   * The server issues a new one on every write. A second save carrying the
   * first one's is a 412 the owner cannot act on, and the "just save again"
   * they will try next fails identically.
   */
  it("advances the ETag between two saves of the same entry", async () => {
    const pod = podFake({ entryEtag: '"entry-8"' });
    const fake = fakeStudioSession();
    const entry = await specEntry();

    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });

    setText(LABEL.headline, "First pass");
    await clickSaveAndWait();
    setText(LABEL.headline, "Second pass");
    await clickSaveAndWait();

    const entryPuts = pod.puts().filter((r) => !r.url.endsWith("entries.ttl"));
    expect(entryPuts).toHaveLength(2);
    expect(entryPuts[0].headers["if-match"]).toBe('"entry-7"');
    expect(entryPuts[1].headers["if-match"]).toBe('"entry-8"');
  });

  /**
   * A write whose response carried no ETag. `SaveEntryReport.etag` documents the
   * consequence: "the write happened, but the next update has nothing to
   * condition on and must re-read rather than invent one."
   *
   * Asserted as a NEGATIVE on the wire, so both honest designs pass — refusing
   * to save until the page is reloaded, and re-reading to obtain a fresh ETag.
   * The two dishonest ones do not: `If-None-Match: *` on an existing resource,
   * and the stale ETag from before.
   */
  it("never invents a precondition after a write that returned no ETag", async () => {
    const pod = podFake({ entryEtag: null });
    const fake = fakeStudioSession();
    const entry = await specEntry();

    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });
    setText(LABEL.headline, "First pass");
    await clickSaveAndWait();
    expect(pod.entryPut()?.headers["if-match"]).toBe('"entry-7"');

    setText(LABEL.headline, "Second pass");
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await act(async () => {
      await Promise.resolve();
    });

    const entryPuts = pod.puts().filter((r) => !r.url.endsWith("entries.ttl"));
    for (const put of entryPuts.slice(1)) {
      expect(put.headers["if-none-match"]).toBeUndefined();
      expect(put.headers["if-match"]).not.toBe('"entry-7"');
    }
    // And the owner is told something either way — a save that silently does
    // nothing is the worst of the available outcomes.
    expect(outcomeText()).not.toBe("");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. WHAT THE EDITOR MUST NOT DROP.
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — the entry it hands to saveEntry", () => {
  /**
   * `dcterms:created` SURVIVES AN EDIT. §7.3: "created is when the record came
   * into being and datePublished is when it became public. They differ by
   * however long the draft sat."
   *
   * `saveEntry` carries it forward — `created: opts.entry.created ?? ...` — but
   * only if the editor puts it in the Entry it passes. Dropping it there is
   * silent, permanent, and destroys the distinction on the first save after
   * publication. It was a real data-loss bug in this repo earlier today.
   *
   * Asserted as the literal that reaches the wire, value and datatype both.
   */
  it("carries dcterms:created through unchanged, and moves dcterms:modified on", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    expect(entry.created).toBe(SPEC_CREATED);

    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });
    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    const created = oneObject(quads, subject, DCTERMS.created);
    expect(created?.value).toBe(SPEC_CREATED);
    expect(datatypeOf(created)).toBe(XSD.dateTime);

    // The mutation half: an editor that wrote the fixture back untouched would
    // pass the assertion above while having saved nothing.
    expect(oneObject(quads, subject, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited",
    );

    // modified moves, and carries an offset rather than a bare Z (§6).
    const modified = oneObject(quads, subject, DCTERMS.modified);
    expect(datatypeOf(modified)).toBe(XSD.dateTime);
    expect(modified?.value).not.toBe("2026-03-30T08:15:00+09:00");
    expect(modified?.value).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  /**
   * The rest of the record survives too. An edit to the headline must not be a
   * quiet deletion of the tags, the travel mode, the place or the timestamp —
   * the read model round-trips through the editor, and every field it forgets
   * to carry is a field the next save erases.
   */
  it("leaves the fields it was not asked to change alone", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();

    await renderEditor(fake.session, { initial: { entry, etag: '"entry-7"' } });
    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    const occurred = oneObject(quads, subject, DY.occurredAt);
    expect(occurred?.value).toBe(SPEC_OCCURRED);
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);

    expect(objectsOf(quads, subject, DY.tag).map((t) => t.value).sort()).toEqual(["food", "trains"]);
    expect(oneObject(quads, subject, DY.travelModeFrom)?.value).toBe(TRAVEL_MODE.Flight);
    expect(oneObject(quads, subject, DCTERMS.creator)?.value).toBe(entry.creator);
    expect(oneObject(quads, subject, SCHEMA.datePublished)?.value).toBe(entry.datePublished);
    /**
     * The place, including its coordinates: they were stored fuzzed and must
     * survive an edit exactly as they are. This is the one place a coordinate
     * legitimately appears, and it appears because it was already on the Pod.
     *
     * THE VALUES, NOT JUST THE POINTER. Until section 1 landed this asserted
     * only that `schema:contentLocation` still pointed at `#place`, which an
     * editor that re-fuzzed the untouched pair on every save passes while
     * walking the pin across the map one save at a time. §9 puts the snap at
     * the moment of TYPING, and lib/pod/fuzz.ts is deliberately not idempotent
     * across saves — the control at the bottom of this test is that fact,
     * stated as an assertion rather than assumed.
     *
     * Compared as NUMBERS. Turtle has no canonical form for a decimal and
     * "35.6938" and "35.69380" are the same value; a byte comparison here
     * would be a test of the serialiser.
     */
    const place = oneObject(quads, subject, SCHEMA.contentLocation)?.value;
    expect(place).toBe(`${put.url}#place`);
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe(SPEC_PLACE_NAME);

    // Non-vacuous: the §7.3 fixture really does carry a coordinate, so the
    // assertions below are about one that survived rather than one that never
    // existed. Read out of the fixture, never typed here.
    const stored = entry.place?.geo;
    expect(stored, "the §7.3 fixture carries no coordinate to preserve").toBeDefined();
    expect(stored!.precisionMeters, "the fixture's pin is not a fuzzed one").toBe(500);

    const geo = geoNodeOf(quads, put.url);
    expect(geo, "the edit dropped the #geo node the fixture arrived with").toBeDefined();
    for (const [predicate, expected] of [
      [SCHEMA.latitude, stored!.lat],
      [GEO.lat, stored!.lat],
      [SCHEMA.longitude, stored!.long],
      [GEO.long, stored!.long],
    ] as const) {
      const term = oneObject(quads, geo!, predicate);
      expect(Number(term?.value), predicate).toBe(expected);
      // §6: xsd:decimal, never float — the same rule the write path is held to
      // everywhere else, checked on the values that merely passed through.
      expect(datatypeOf(term), predicate).toBe(XSD.decimal);
    }
    expect(oneObject(quads, geo!, DY.precisionMeters)?.value).toBe(
      String(stored!.precisionMeters),
    );

    /* WHAT WOULD BREAK THE FOUR ASSERTIONS ABOVE: an editor that ran the stored
       pair back through `fuzzForPublication` on a save that never touched it.
       This is that production change, computed rather than described, so the
       assertions are demonstrably capable of failing — snapping an already
       snapped pair to the same grid MOVES it. */
    const resnapped = snapToPrecision(stored!.lat, stored!.long, stored!.precisionMeters!);
    expect(
      Number(resnapped.lat),
      "re-snapping is a no-op on this fixture, so the latitude assertion above cannot fail",
    ).not.toBe(stored!.lat);
    expect(
      Number(resnapped.long),
      "re-snapping is a no-op on this fixture, so the longitude assertion above cannot fail",
    ).not.toBe(stored!.long);
  });

  /**
   * §6 and §11 guardrail 3. A resource written without dy:schemaVersion is one
   * that every read in this app refuses — including rebuildIndex's, which is
   * the tool that would otherwise recover it.
   */
  it("stamps dy:schemaVersion and the slug invariant on a create", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry({ slug: "2026-04-02-kyoto" });
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    const version = oneObject(quads, subject, DY.schemaVersion);
    expect(version?.value).toBe(String(SCHEMA_VERSION));
    expect(datatypeOf(version)).toBe(XSD.integer);

    // §11 guardrail 7: dy:slug equals the containing path segment. Here that is
    // the filename, and the two are produced by different code paths.
    expect(oneObject(quads, subject, DY.slug)?.value).toBe("2026-04-02-kyoto");
    expect(put.url).toBe(`${JAPAN.entriesContainer}2026-04-02-kyoto.ttl`);

    // Fragments, never blank nodes (§11 guardrail 4). `triples` throws on one.
    expect(() => triples(put.body, put.url)).not.toThrow();
  });

  /**
   * §6: language-tag every human-readable literal. An untagged headline is one
   * the JSON-LD output (§8) and any consumer cannot place.
   */
  it("language-tags the human-readable literals it writes", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    expect(languageOf(oneObject(quads, subject, SCHEMA.headline))).not.toBe("");
    expect(languageOf(oneObject(quads, subject, SCHEMA.articleBody))).not.toBe("");
    // dy:tag is xsd:string by §3 — a token, not prose. Tagging it would be as
    // wrong as leaving the headline untagged.
    expect(languageOf(oneObject(quads, subject, DY.tag))).toBe("");
  });

  /**
   * THE DATETIME SHAPE. §3: "dy:occurredAt (xsd:dateTime, offset required)",
   * and §7.3: it "carries the local UTC offset of the place".
   *
   * A browser date control hands back "2026-04-02T16:20" with no offset at all.
   * Turning that into a bare `Z` moves the moment by the offset and destroys
   * the fact that it was late afternoon; leaving it offsetless makes it
   * unreadable to `offsetDateTime` in lib/pod/rdf.ts. The expected offset is
   * derived from the zone rather than written out, so the assertion is correct
   * on any machine; the control at the top of this file is what guarantees the
   * zone is a non-zero one.
   */
  it("writes dy:occurredAt with a real UTC offset, not a bare Z", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    setText(LABEL.occurredAt, "2026-04-02T16:20");
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const occurred = oneObject(quads, `${put.url}#it`, DY.occurredAt);

    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
    expect(occurred?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?[+-]\d{2}:\d{2}$/);
    expect(occurred?.value).not.toMatch(/Z$/);

    // And it is the same instant the owner typed, read in their own zone.
    expect(new Date(occurred!.value).getTime()).toBe(new Date("2026-04-02T16:20:00").getTime());
    expect(occurred?.value).toContain("+09:00");
  });

  /** The owner's WebID is provenance and the ACL agent — §7.3's dcterms:creator.
   *  It is on the session and nowhere else in the browser. */
  it("takes the creator from the session, not from a prop or a guess", async () => {
    const pod = podFake();
    const fake = fakeStudioSession(`${POD}/profile/card#me`);
    await renderEditor(fake.session);

    fillNewEntry();
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    expect(oneObject(quads, `${put.url}#it`, DCTERMS.creator)?.value).toBe(OWNER);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. THE AUTHENTICATED FETCH (invariants 3 and 4).
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — whose fetch goes to the Pod", () => {
  /**
   * `saveEntry` takes `fetch: PodFetch` and its docblock says why: "the
   * visitor's own authenticated fetch, held only in their browser (invariant
   * 4). Never defaulted to the ambient one: that is a silent downgrade to
   * anonymous, which reads as 'not found' on a hosted Pod."
   *
   * Observed as a header the ambient fetch cannot produce, on the requests that
   * really went out — not as "the session object was touched".
   */
  it("uses the session's fetch for every Pod request", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await clickSaveAndWait();

    const podRequests = pod.requests.filter((r) => r.url.startsWith(POD));
    expect(podRequests.length).toBeGreaterThanOrEqual(3); // entry PUT, index GET, index PUT
    for (const r of podRequests) {
      expect(r.headers.authorization).toBe(CREDENTIAL);
    }
    expect(fake.fetched).toEqual(expect.arrayContaining([pod.entryPut()!.url]));
  });

  /**
   * AND NOT FOR THE REVALIDATION HOOK. `/api/revalidate` is this app's own
   * server, it is unauthenticated by design, and its route file says so:
   * "any credential it could send here would be shipped to every visitor in the
   * client bundle". Invariant 4 is "never hold Pod credentials server-side";
   * posting a Pod access token to our own route handler is the first step
   * towards holding one.
   */
  it("does not send the Pod credential to the app's own revalidation route", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await clickSaveAndWait();

    const post = pod.revalidatePost();
    expect(post).toBeDefined();
    expect(post!.headers.authorization).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. THE TRIP CHOICE.
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — choosing the trip", () => {
  it("offers the trips it was handed and writes into the one that was chosen", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { trips: TRIPS });

    /**
     * The allow-case, asserted through the chooser rather than through its
     * markup. `within(select).getByText("Peru")` would work for a native
     * <select> and fail for a Radix one, whose options live in a portal and do
     * not exist until it is opened — and this test is about the trip that gets
     * written, not about which control renders the list. `setChoice` throws
     * naming every available option if Peru is not among them, so the evidence
     * that both trips were offered is that choosing the second one works and
     * the first one is untouched at the end.
     */
    expect(screen.getAllByLabelText(LABEL.trip)).toHaveLength(1);

    fillNewEntry({ trip: PERU, slug: "2027-05-01-lima" });
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    expect(put.url).toBe(`${PERU.entriesContainer}2027-05-01-lima.ttl`);
    expect(oneObject(quadsOf(put.body, put.url), `${put.url}#it`, DY.trip)?.value).toBe(PERU.iri);

    // The index touched is Peru's, and Japan's was not touched at all.
    expect(pod.indexPut()?.url).toBe(PERU.indexUrl);
    expect(pod.requests.filter((r) => r.url === JAPAN.indexUrl)).toEqual([]);
  });

  /** §10 step 4. The tags must name the chosen trip, or the public site keeps
   *  serving the old page and nothing anywhere reports a problem. */
  it("revalidates the chosen trip's tags, and only those", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry({ trip: PERU, slug: "2027-05-01-lima" });
    await clickSaveAndWait();

    const post = pod.revalidatePost()!;
    const sent = JSON.parse(post.body) as { tags: string[] };
    expect(sent.tags).toEqual(
      expect.arrayContaining([TAGS.trip(PERU.slug), TAGS.entry(PERU.slug, "2027-05-01-lima")]),
    );
    expect(sent.tags).not.toContain(TAGS.trip(JAPAN.slug));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. DRAFTS MUST NOT LEAK.
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — a draft", () => {
  /**
   * §7.4: the index is the publication boundary. A draft's row in entries.ttl
   * publishes its title to everyone even though the entry resource is private —
   * which is the one thing that boundary exists to prevent.
   *
   * `saveEntry` does the removing; the editor's contribution is getting the
   * status there at all. Both halves are asserted, because an editor that sent
   * "published" regardless would still produce an index PUT.
   */
  it("goes to the Pod as dy:Draft, private, and unlisted", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry({ slug: "2026-04-05-unfinished", headline: "Not ready yet" });
    setChoice(LABEL.status, /draft/i);
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    expect(oneObject(quadsOf(put.body, put.url), `${put.url}#it`, DY.status)?.value).toBe(
      STATUS.Draft,
    );

    expect(accessCalls.map((c) => c.op)).toEqual(["makePrivate"]);
    expect(accessCalls[0].url).toBe(put.url);

    const indexPut = pod.indexPut();
    expect(indexPut).toBeDefined();
    expect(indexPut!.body).not.toContain("Not ready yet");
    expect(indexPut!.body).not.toContain("2026-04-05-unfinished");
  });

  it("goes to the Pod as dy:Published, public, and listed", async () => {
    // The allow-case for the test above: a rule that made everything private
    // would be worse than none.
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry({ slug: "2026-04-05-ready", headline: "Ready after all" });
    setChoice(LABEL.status, /publish/i);
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    expect(oneObject(quadsOf(put.body, put.url), `${put.url}#it`, DY.status)?.value).toBe(
      STATUS.Published,
    );
    expect(accessCalls.map((c) => c.op)).toEqual(["makePublic"]);
    expect(pod.indexPut()!.body).toContain("Ready after all");
  });
});

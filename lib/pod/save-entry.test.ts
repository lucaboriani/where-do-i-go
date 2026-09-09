import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Parser, type Quad, type Term } from "n3";
import { http, HttpResponse } from "msw";
import {
  DCTERMS, DY, DY_CLASS, GEO, RDF, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE, XSD,
} from "@/lib/vocab";
import { readEntry, readTripIndex } from "@/lib/pod/read";
import { graphEquals, triples } from "@/test/graph";
import { server, servePod } from "@/test/msw";
import type { Entry } from "@/lib/pod/schema";
import type { PodError } from "@/lib/pod/result";
import type { Precondition } from "@/lib/pod/write";

/**
 * Entry create and edit — the §10 write protocol.
 *
 * TWO THINGS DO NOT EXIST YET AND THIS FILE PINS BOTH. It is the red step of
 * the TDD loop; every test below is expected to fail on a missing export until
 * the implementation lands.
 *
 *   `serialiseEntry` — the inverse of `readEntry`. Modelled on `serialiseIndex`
 *                      in lib/pod/index-model.ts: n3 quads, explicit datatypes,
 *                      byte formatting deliberately not normative.
 *   `saveEntry`      — the four-step §10 sequence: PUT the entry, set its ACL,
 *                      insert the row into entries.ttl and recompute the
 *                      derived values, call the revalidation hook.
 *
 * WHERE THEY ARE EXPECTED TO LIVE, AND WHY IT IS NOT lib/pod/write.ts.
 * `lib/pod/access.ts` already imports `putGuarded` from `./write`, so a
 * `saveEntry` in write.ts that called `makePublic` would close an import cycle
 * between the two modules. It therefore needs a module of its own, above both:
 *
 *   lib/pod/entry-model.ts   serialiseEntry   (pure, the sibling of index-model)
 *   lib/pod/save-entry.ts    saveEntry        (orchestration, imports both)
 *
 * That layout is a consequence of the cycle, not a preference. An implementer
 * who finds a better one only has to change the two `import()` calls below —
 * every assertion here is about behaviour, not about file names.
 *
 * WHAT IS FAKED, AND AT WHICH SEAM.
 *
 *   The Pod        — MSW, at the HTTP layer, exactly as test/read.test.ts does.
 *                    Entry PUT, index GET and index PUT are all plain `fetch`
 *                    through `putGuarded`/`fetchTurtle`, so this is the seam
 *                    that matters and the preconditions are asserted on the
 *                    real outgoing request headers.
 *   lib/pod/access — mocked as a MODULE, and this is the one arrangement in the
 *                    file. Step 2 of §10 is "set the entry's ACL", and a fake
 *                    convincing enough for `universalAccess` to read its own
 *                    write back would encode @inrupt/solid-client 3.0.0's
 *                    request sequence — the argument test/access.test.ts
 *                    already makes at length, and the reason its own tests fake
 *                    at the injected fetch rather than driving a fake ACL
 *                    engine. What access.ts really does is covered there and in
 *                    test/integration/pod-access.integration.test.ts against a real
 *                    Community Solid Server. What is uncovered, and what these
 *                    tests are for, is the SEQUENCE around it.
 *
 *                    The mock is not a way of asserting nothing: `saveEntry`
 *                    that never reaches for access.ts leaves `accessCalls`
 *                    empty and fails. It is also the only way to make step 2
 *                    fail deterministically, which is one of the three failure
 *                    modes §10 explicitly designs for.
 *   next/cache     — neutralised so `TAGS` can be imported from lib/pod/cached.
 *                    `cacheTag()` throws outside a Next build. Same scope and
 *                    same reason as test/cached-owner-profile.test.ts.
 *
 * WHAT IS NOT TESTED HERE, SAID OUT LOUD: coordinate fuzzing (§9). It does not
 * exist — TODO.md puts it in phase 3, and nothing under lib/ mentions it. §9
 * requires it to happen BEFORE the write, so it is the caller's job and not
 * `serialiseEntry`'s. The one test this file can honestly write about it is the
 * positive one: the serialiser must pass a coordinate through unaltered, so
 * that when fuzzing arrives it is unambiguously upstream. Nothing below should
 * be read as evidence that a coordinate was fuzzed.
 */

/* ---------------------------------------------------- mock: next/cache only */

vi.mock("next/cache", () => ({
  cacheTag: () => {},
  cacheLife: () => {},
  revalidateTag: () => {},
}));

/* -------------------------------------------------- mock: lib/pod/access.ts */

const { accessCalls, accessOutcome } = vi.hoisted(() => ({
  accessCalls: [] as { op: string; url: string }[],
  /** Scripted per test. `null` means the ACL write succeeded. */
  accessOutcome: { failure: null as { kind: string } | null },
}));

vi.mock("@/lib/pod/access", () => {
  const state = (url: string, read: boolean) => ({
    ok: true as const,
    value: {
      url,
      read,
      append: false,
      write: false,
      verifiedBy: "rules" as const,
      inherits: false,
      inheritsVerifiedBy: "notApplicable" as const,
    },
  });
  const record = (op: string, read: boolean) => async (url: string) => {
    accessCalls.push({ op, url });
    return accessOutcome.failure
      ? { ok: false as const, error: accessOutcome.failure }
      : state(url, read);
  };
  return {
    makePublic: record("makePublic", true),
    makePrivate: record("makePrivate", false),
    getAccess: async (url: string) => state(url, true),
    createContainer: async (url: string) => state(url, true),
    initialiseContainers: async () => ({ ok: true as const, value: { podRoot: "", containers: [] } }),
  };
});

/* ------------------------------------------------------- normative fixtures */

/**
 * The §7 blocks, read out of docs/data-model.md at runtime. Those blocks are
 * normative (§11 guardrail 6), so a hand-copied fixture would test a copy of
 * the specification instead of the specification. Same extraction as
 * test/read.test.ts and test/owner-profile.test.ts.
 */
const doc = readFileSync("docs/data-model.md", "utf8");
const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);
const ENTRY_TTL = blocks[2];
const INDEX_TTL = blocks[3];

const POD = "https://me.solidcommunity.net";
const TRIP_SLUG = "2026-japan";
const TRIP_IRI = `${POD}/travel/trips/${TRIP_SLUG}/trip.ttl#it`;
const INDEX_URL = `${POD}/travel/trips/${TRIP_SLUG}/entries.ttl`;
const ENTRY_URL = `${POD}/travel/trips/${TRIP_SLUG}/entries/2026-03-29-arrival.ttl`;
const NARA_URL = `${POD}/travel/trips/${TRIP_SLUG}/entries/2026-03-31-nara.ttl`;
const WEBID = `${POD}/profile/card#me`;

/** Guard the extraction itself: if the §7 numbering ever shifts, every test
 *  below would silently run against the wrong block. */
if (!ENTRY_TTL?.includes("dy:Entry") || !INDEX_TTL?.includes("dy:TripIndex")) {
  throw new Error("docs/data-model.md §7.3/§7.4 blocks not found at the expected index");
}

/* ------------------------------------------------------------------ helpers */

const quadsOf = (ttl: string, base: string): Quad[] => new Parser({ baseIRI: base }).parse(ttl);

const objectsOf = (qs: Quad[], subject: string, predicate: string): Term[] =>
  qs.filter((q) => q.subject.value === subject && q.predicate.value === predicate).map((q) => q.object);

const oneObject = (qs: Quad[], subject: string, predicate: string): Term | undefined =>
  objectsOf(qs, subject, predicate)[0];

/** A literal's datatype IRI, or undefined if the term is not a literal. */
const datatypeOf = (t: Term | undefined) =>
  t && t.termType === "Literal" ? t.datatype.value : undefined;
const languageOf = (t: Term | undefined) =>
  t && t.termType === "Literal" ? t.language : undefined;

async function settle<T>(promise: Promise<T>): Promise<{ returned?: T; threw?: unknown }> {
  try {
    return { returned: await promise };
  } catch (threw) {
    return { threw };
  }
}

/**
 * Loaded through dynamic `import()` rather than a static named import, and
 * deliberately so while this is the red step: a static named import of an
 * export that does not exist is an ESM LINK error, which kills the whole file
 * with a SyntaxError before a single test runs and reads like a broken test
 * file rather than a missing implementation. Reached through the namespace,
 * every test below runs and fails on its own terms — the same shape
 * test/owner-profile.test.ts used for `readOwnerProfile`.
 */
const loadSerialise = async () =>
  (await import("@/lib/pod/entry-model")).serialiseEntry as (
    entry: Entry,
  ) => Promise<{ ok: true; value: string } | { ok: false; error: PodError }>;

const loadSave = async () => (await import("@/lib/pod/save-entry")).saveEntry as (
  opts: SaveEntryOptions,
) => Promise<SaveEntryReport>;

/**
 * The options `saveEntry` is pinned to take. Written here rather than imported
 * so the red run fails on `saveEntry` itself rather than on a type import.
 *
 * `indexUrl`, `tripIri` and `tripSlug` are passed rather than derived from
 * `entry.iri`: guessing a derivation rule is how a test ends up asserting the
 * implementation it imagined. An implementer who derives them instead still
 * passes, because the values below are the ones a derivation would produce.
 */
type SaveEntryOptions = {
  fetch: typeof globalThis.fetch;
  entry: Entry;
  /** `{create:true}` for a new entry; `{etag}` from THE READ THAT PRODUCED THE
   *  EDITED STATE for an update. §10: never a blind PUT. */
  precondition: Precondition;
  indexUrl: string;
  tripIri: string;
  tripSlug: string;
  /** Step 4. Injected rather than calling `revalidateTag` directly: writes run
   *  in the browser (invariant 4) and `revalidateTag` is server-side, so the
   *  studio's real hook posts to a route handler. A callback keeps `saveEntry`
   *  host-neutral (invariant 7) and makes step 4 observable. */
  revalidate: (tags: string[]) => void | Promise<void>;
  webId?: string;
  now?: () => string;
};

/**
 * What `saveEntry` must return.
 *
 * NOT a `Result<T>`, and that is the whole point of this file. §10's three
 * documented failure modes all leave the Pod in a state the caller has to act
 * on differently, and `{ok:false, error}` collapses "nothing happened" into the
 * same value as "the entry is on the Pod but unlisted — run rebuildIndex". An
 * interface that cannot express partial success makes §10's documented recovery
 * path unreachable, so the report is always returned and carries the failure.
 */
type SaveStep = "entry" | "access" | "index" | "revalidate";
type SaveEntryReport = {
  entryUrl: string;
  /** Steps that completed, in §10 order. */
  completed: SaveStep[];
  /** Absent on full success. */
  failed?: { step: SaveStep; error: PodError };
  /** What the caller must do next. */
  recovery: "none" | "retry" | "refetch" | "rebuildIndex";
  etag?: string | null;
};

/* ------------------------------------------------------------ the fake Pod */

type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };

type PodScript = {
  /** entries.ttl as served by the GET in step 3. */
  index?: string;
  indexEtag?: string;
  /** Status to answer with instead of success, keyed by step. */
  fail?: Partial<Record<"entryPut" | "indexGet" | "indexPut", number>>;
};

/**
 * Installs MSW handlers for the two resources §10 writes and records every
 * request that reaches them, headers and body included.
 *
 * Recording the REQUEST is the point: "assert the actual header on the actual
 * request, not that a helper was called" (CLAUDE.md, hard rules). A test that
 * spies on `putGuarded` would pass against an implementation that bypassed it.
 */
function podFake(script: PodScript = {}) {
  const requests: Recorded[] = [];
  const indexBody = script.index ?? INDEX_TTL;
  const indexEtag = script.indexEtag ?? '"idx-1"';

  const record = async (request: Request): Promise<Recorded> => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    const entry = { method: request.method, url: request.url, headers, body: await request.text() };
    requests.push(entry);
    return entry;
  };

  const putHandler = (failWith: number | undefined, etag: string) =>
    async ({ request }: { request: Request }) => {
      await record(request);
      return failWith
        ? new HttpResponse(`precondition or server failure (${failWith})`, { status: failWith })
        : new HttpResponse(null, { status: 205, headers: { etag } });
    };

  server.use(
    http.put(ENTRY_URL, putHandler(script.fail?.entryPut, '"entry-v8"')),
    http.put(NARA_URL, putHandler(script.fail?.entryPut, '"nara-v1"')),
    http.put(INDEX_URL, putHandler(script.fail?.indexPut, '"idx-2"')),
    http.get(INDEX_URL, async ({ request }) => {
      await record(request);
      return script.fail?.indexGet
        ? new HttpResponse("gone", { status: script.fail.indexGet })
        : HttpResponse.text(indexBody, {
            headers: { "content-type": "text/turtle", etag: indexEtag },
          });
    }),
    http.head(INDEX_URL, async ({ request }) => {
      await record(request);
      return new HttpResponse(null, { status: 200, headers: { etag: indexEtag } });
    }),
  );

  const of = (method: string, url: string) =>
    requests.filter((r) => r.method === method && r.url === url);

  return {
    requests,
    of,
    /** Every PUT the sequence made, whatever the target. */
    puts: () => requests.filter((r) => r.method === "PUT"),
    bodyOf: (method: string, url: string) => of(method, url)[0]?.body,
  };
}

/** Records what the implementation actually called, then delegates to the real
 *  (MSW-patched) fetch. An implementation reaching for the ambient `fetch`
 *  instead of the one it was handed leaves this log empty — and test/setup.ts
 *  throws on any unhandled non-loopback request, so it cannot pass either way. */
function recordingFetch(calls: string[]): typeof globalThis.fetch {
  return (input, init) => {
    calls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return globalThis.fetch(input, init);
  };
}

/* ------------------------------------------------- the entry, from the spec */

/** The §7.3 entry, obtained by running the normative fixture through the real
 *  reader. Built this way rather than by hand so the round-trip below compares
 *  against the specification and not against my typing. */
async function specEntry(): Promise<Entry> {
  servePod({ [ENTRY_URL]: ENTRY_TTL });
  const r = await readEntry(ENTRY_URL);
  if (!r.ok) throw new Error(`the §7.3 fixture no longer reads: ${r.error.kind}`);
  return r.value;
}

/** A second, different, published entry — so index insertion has something to
 *  insert alongside, and the bbox has two points to span. */
const naraEntry = (spec: Entry): Entry => ({
  ...spec,
  iri: `${NARA_URL}#it`,
  slug: "2026-03-31-nara",
  headline: { value: "Deer, and a very large bell", language: "en" },
  occurredAt: "2026-03-31T11:05:00+09:00",
  place: { geo: { lat: 34.6851, long: 135.8048, precisionMeters: 200 } },
  photos: [],
});

afterEach(() => {
  accessCalls.length = 0;
  accessOutcome.failure = null;
});

/* ========================================================== serialiseEntry */

describe("serialiseEntry — the inverse of readEntry", () => {
  it("round-trips: readEntry(serialiseEntry(entry)) is the same entry", async () => {
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();

    const ttl = await serialiseEntry(spec);
    expect(ttl.ok).toBe(true);
    if (!ttl.ok) return;

    servePod({ [ENTRY_URL]: ttl.value });
    const back = await readEntry(ENTRY_URL);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // Whole-object equality, not a field tour: a round trip that loses one
    // optional field is exactly the bug this is here to catch, and picking
    // fields to assert is how it gets missed.
    expect(back.value).toEqual(spec);
  });

  it("matches the normative §7.3 fixture as a graph, inventing nothing", async () => {
    // §11 guardrail 6: compare triple sets, never bytes. Turtle has no
    // canonical form, so a byte comparison would be permanently red.
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();
    const ttl = await serialiseEntry(spec);
    expect(ttl.ok).toBe(true);
    if (!ttl.ok) return;

    const { missing, extra } = graphEquals(ENTRY_TTL, ttl.value, ENTRY_URL);

    // The strong direction, and it is absolute: every triple we write must be
    // one the specification has. A serialiser that invents a predicate — or
    // spells one differently, or drops a language tag, or writes a plain
    // literal where the fixture has @en — shows up here.
    expect(extra).toEqual([]);

    /**
     * NOTHING is missing any more. This list used to hold three photo
     * predicates the media pipeline had not yet produced: the pipeline now
     * writes `schema:encodingFormat` and `schema:dateCreated`, and
     * `dy:originalUrl` left the fixture because nothing writes it — phase 3
     * decided against uploading originals, and §3 keeps the term reserved
     * rather than live.
     *
     * The list stays computed and enumerated rather than collapsing into
     * `expect(missing).toEqual([])`, because the failure it must catch is "we
     * quietly stopped writing a triple", and it must name the predicate when it
     * does. An empty array is now the assertion that says so.
     *
     * `dcterms:created` and `dcterms:creator` were once on this list, back when
     * `Entry` had no field for either. They are absent for the opposite reason
     * today: the model grew all three provenance fields and `serialiseEntry`
     * writes them. That was load-bearing rather than tidy — §7.3 says created
     * and datePublished "are not redundant … they differ by however long the
     * draft sat", so an edit that dropped created would have destroyed the
     * difference silently on the first save after publication.
     */
    const missingPredicates = [...new Set(missing.map((t) => t.split(" ")[1]))].sort();
    expect(missingPredicates).toEqual([]);
  });

  it("emits fragments and no blank nodes", async () => {
    // §11 guardrail 4 asks for exactly this test. `triples()` throws on a blank
    // node, so the assertion is that it does not — plus the positive half, that
    // the fragments §6 names are the subjects actually used. A serialiser that
    // emitted nothing would pass the first half alone.
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();
    const ttl = await serialiseEntry(spec);
    expect(ttl.ok).toBe(true);
    if (!ttl.ok) return;

    expect(() => triples(ttl.value, ENTRY_URL)).not.toThrow();

    const subjects = new Set(quadsOf(ttl.value, ENTRY_URL).map((q) => q.subject.value));
    expect([...subjects].sort()).toEqual(
      [`${ENTRY_URL}#it`, `${ENTRY_URL}#place`, `${ENTRY_URL}#address`, `${ENTRY_URL}#geo`, `${ENTRY_URL}#photo-1`].sort(),
    );
  });

  it("refuses an entry whose dy:slug disagrees with its own filename", async () => {
    // §11 guardrail 7: assert the slug invariant on write as well as on read.
    // Writing the mismatch instead produces a resource that `readEntry` then
    // refuses — an entry intact in the Pod and dead on every link built from
    // it. Refusing here is what stops it reaching the Pod at all.
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();

    const r = await serialiseEntry({ ...spec, slug: "somewhere-else" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("slugMismatch");
  });
});

describe("serialiseEntry — §6 datatypes and language tags", () => {
  const load = async () => {
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();
    const ttl = await serialiseEntry(spec);
    if (!ttl.ok) throw new Error(`serialiseEntry refused the §7.3 entry: ${ttl.error.kind}`);
    return { ttl: ttl.value, quads: quadsOf(ttl.value, ENTRY_URL), spec };
  };

  it("writes coordinates as xsd:decimal, never xsd:float", async () => {
    const { quads } = await load();
    const geo = `${ENTRY_URL}#geo`;
    for (const predicate of [SCHEMA.latitude, SCHEMA.longitude, GEO.lat, GEO.long]) {
      expect(datatypeOf(oneObject(quads, geo, predicate))).toBe(XSD.decimal);
    }
  });

  it("never writes a coordinate in exponent notation", async () => {
    // xsd:decimal has no exponent form; String(1e-7) is "1e-7". index-model.ts
    // formats explicitly for this reason and the entry serialiser must too.
    const { ttl } = await load();
    expect(ttl).not.toMatch(/\de[+-]?\d/i);
  });

  it("writes every instant as xsd:dateTime carrying its UTC offset", async () => {
    const { quads } = await load();
    const it = `${ENTRY_URL}#it`;
    for (const predicate of [DY.occurredAt, SCHEMA.datePublished, DCTERMS.modified]) {
      const term = oneObject(quads, it, predicate);
      expect(datatypeOf(term)).toBe(XSD.dateTime);
      // §7.3: "21:40+09:00 renders as 9:40pm in Tokyo for every reader.
      // Normalising to UTC destroys the fact that it was evening."
      expect(term?.value).toMatch(/([+-]\d{2}:\d{2}|Z)$/);
    }
    expect(oneObject(quads, it, DY.occurredAt)?.value).toBe("2026-03-29T21:40:00+09:00");
  });

  it("writes counts and distances as xsd:integer", async () => {
    const { quads } = await load();
    expect(datatypeOf(oneObject(quads, `${ENTRY_URL}#it`, DY.schemaVersion))).toBe(XSD.integer);
    expect(datatypeOf(oneObject(quads, `${ENTRY_URL}#geo`, DY.precisionMeters))).toBe(XSD.integer);
    for (const predicate of [SCHEMA.width, SCHEMA.height, DY.sortOrder]) {
      expect(datatypeOf(oneObject(quads, `${ENTRY_URL}#photo-1`, predicate))).toBe(XSD.integer);
    }
  });

  it("declares dy:schemaVersion on the entry", async () => {
    // §11 guardrail 3. Written as well as read, or the version gate on the read
    // side rejects everything this app writes.
    const { quads } = await load();
    expect(oneObject(quads, `${ENTRY_URL}#it`, DY.schemaVersion)?.value).toBe(String(SCHEMA_VERSION));
  });

  it("language-tags every human-readable literal, and only those", async () => {
    const { quads } = await load();
    const it = `${ENTRY_URL}#it`;
    expect(languageOf(oneObject(quads, it, SCHEMA.headline))).toBe("en");
    expect(languageOf(oneObject(quads, it, SCHEMA.articleBody))).toBe("en");
    expect(languageOf(oneObject(quads, `${ENTRY_URL}#place`, SCHEMA.name))).toBe("en");
    expect(languageOf(oneObject(quads, `${ENTRY_URL}#address`, SCHEMA.addressLocality))).toBe("en");
    expect(languageOf(oneObject(quads, `${ENTRY_URL}#photo-1`, SCHEMA.caption))).toBe("en");

    // The negative half. A rule that tags everything is as wrong as one that
    // tags nothing: a slug is an identifier and a country code is a code, and
    // tagging either makes it a different RDF term from the one §7.3 shows.
    expect(languageOf(oneObject(quads, it, DY.slug))).toBe("");
    expect(languageOf(oneObject(quads, `${ENTRY_URL}#address`, SCHEMA.addressCountry))).toBe("");
    for (const tag of objectsOf(quads, it, DY.tag)) expect(languageOf(tag)).toBe("");
  });

  /**
   * THE ENTRY'S LANGUAGE, NOT THE DEPLOYMENT'S — and the two are the same thing
   * only for a diary kept in the deployment's language.
   *
   * `entry-model.ts` serialises the locality as `text({ value: e.place.locality })`
   * with no language at all, so `text()` falls back to `config.defaultLanguage`.
   * That fallback is right as a fallback (§6: an untagged literal is a DIFFERENT
   * RDF term from a tagged one, so no tag is never the answer) and wrong as the
   * answer here, for a reason that has nothing to do with configuration:
   * `defaultLanguage` is `SITE_LANGUAGE ?? "en"`, `SITE_LANGUAGE` is not
   * `NEXT_PUBLIC_`, and every write in this app happens in the BROWSER
   * (invariant 4). So it is `"en"` at write time no matter what the deployment
   * sets, and an entry the owner wrote in Japanese publishes
   * `schema:name "…"@ja` beside `schema:addressLocality "…"@en` on the same
   * `<#place>` — two claims about one place in two languages, one of which
   * nobody chose.
   *
   * THE FIX IS TO PASS THE ENTRY'S OWN LANGUAGE, matching what `schema:name`
   * already gets: `e.headline` is a `LangText`, so it is available on the line
   * above. No schema change — `Place.locality` stays a plain `string`, which is
   * what `placeTextOf` in the studio relies on ("the locality is tagged by
   * `text()` at serialisation").
   *
   * WHY THE TEST ABOVE STAYS AS IT IS, CHECKED RATHER THAN ASSUMED. §7.3's
   * entry is written in English — its headline is `"First night in Shinjuku"@en`
   * — so `schema:addressLocality "Tokyo"@en` is what BOTH the current code and
   * the fix produce for it, and that `@en` was agreeing with the fix rather than
   * pinning the defect. The premise is asserted below, because if the fixture's
   * headline were ever tagged anything else that test would silently become a
   * pin on the wrong behaviour.
   *
   * THE THIRD LEG IS THE FALLBACK, AND IT IS NOT DECORATION. `LangText.language`
   * is optional, so an entry can arrive with no language of its own — and the
   * shortest spelling of this fix, `literal(e.place.locality, e.headline.language)`,
   * writes a PLAIN literal for that entry: §6's rule broken in the other
   * direction, by the change meant to honour it. Going through `text()` keeps
   * the deployment default. It is also what proves the leg above is not vacuous:
   * this environment sets no `SITE_LANGUAGE`, so the default really is `"en"`
   * and `"ja"` really is a different answer.
   *
   * WHAT MUST NOT MOVE: `schema:addressCountry`. It is a CODE, asserted here as
   * a plain literal in both halves — `"JP"@ja` would be as wrong as `"JP"@en`,
   * and both are different RDF terms from `"JP"`, so every consumer filtering
   * on the plain literal would stop matching entries this app wrote.
   */
  it("tags the locality with the entry's own language, never the deployment's", async () => {
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();

    /* ── THE PREMISES, ON THE FIXTURE ───────────────────────────────────── */
    expect(
      spec.headline.language,
      "the §7.3 fixture's headline is not @en, so the `@en` the test above asserts on schema:addressLocality was pinning this defect rather than agreeing with the fix — say so rather than changing it quietly",
    ).toBe("en");
    expect(
      spec.place?.locality,
      "the §7.3 fixture carries no locality, so there is no <#address> node for this test to be about",
    ).toBe("Tokyo");

    const JA = "ja";
    const inJapanese: Entry = {
      ...spec,
      headline: { value: "新宿の最初の夜", language: JA },
      articleBody: { value: "成田エクスプレスに乗ったのは失敗だった。", language: JA },
      /* The place the STUDIO would build for this entry: `placeTextOf` gives
         the name the entry's language and gives the locality none, because the
         locality is tagged at serialisation. That asymmetry is the defect's
         whole surface. */
      place: { ...spec.place, name: { value: "東京、新宿", language: JA }, locality: "東京", country: "JP" },
    };

    const ttl = await serialiseEntry(inJapanese);
    expect(ttl.ok).toBe(true);
    if (!ttl.ok) throw new Error(`serialiseEntry refused the @ja entry: ${ttl.error.kind}`);

    const quads = quadsOf(ttl.value, ENTRY_URL);
    const place = `${ENTRY_URL}#place`;
    const address = `${ENTRY_URL}#address`;
    const locality = oneObject(quads, address, SCHEMA.addressLocality);
    const country = oneObject(quads, address, SCHEMA.addressCountry);

    /* ── THE PREMISES, ON THE OUTPUT: the terms exist, so a wrong tag below
       cannot be told from a missing triple — `languageOf(undefined)` is
       `undefined` and would fail with the same shape. ───────────────────── */
    expect(locality?.value, "no schema:addressLocality was written at all").toBe("東京");
    expect(
      languageOf(oneObject(quads, `${ENTRY_URL}#it`, SCHEMA.headline)),
      "the entry's own language did not reach schema:headline, so `the entry's language` is not something this document can be about",
    ).toBe(JA);

    /* ── THE DEFECT ─────────────────────────────────────────────────────── */
    expect(
      languageOf(locality),
      "the locality is tagged with the deployment's default rather than the entry's own language: this entry says `schema:name`@ja and `schema:addressLocality`@en about the same place, and because SITE_LANGUAGE is not NEXT_PUBLIC_ the browser that wrote it could only ever have said @en",
    ).toBe(JA);

    /* ── AND WHAT MUST NOT CHANGE WITH IT ───────────────────────────────── */
    expect(
      languageOf(oneObject(quads, place, SCHEMA.name)),
      "schema:name stopped taking the entry's own language, which is the tag the locality is being brought into line WITH",
    ).toBe(JA);
    expect(country?.value, "no schema:addressCountry was written at all").toBe("JP");
    expect(
      languageOf(country),
      "the country CODE was language-tagged: `JP`@ja is a different RDF term from `JP`, so every consumer filtering on the plain literal stops matching",
    ).toBe("");
    expect(datatypeOf(country), "the country code is not a plain literal").toBe(XSD.string);

    /* ── THE FALLBACK: an entry with no language of its own is still tagged,
       with the deployment's default and never with nothing (§6). ────────── */
    const untagged = await serialiseEntry({
      ...inJapanese,
      headline: { value: inJapanese.headline.value },
      articleBody: undefined,
      place: { ...inJapanese.place, name: { value: "東京、新宿" } },
    });
    expect(untagged.ok).toBe(true);
    if (!untagged.ok) throw new Error(`serialiseEntry refused the untagged entry: ${untagged.error.kind}`);

    const fallback = quadsOf(untagged.value, ENTRY_URL);
    const fallbackLocality = oneObject(fallback, address, SCHEMA.addressLocality);
    expect(fallbackLocality?.value, "no schema:addressLocality was written at all").toBe("東京");
    expect(
      languageOf(fallbackLocality),
      "an entry that carries no language of its own left the locality UNTAGGED — §6's rule broken in the other direction by the change meant to honour it, and `literal(value, e.headline.language)` is the spelling that does it",
    ).toBe("en");
    expect(
      languageOf(oneObject(fallback, address, SCHEMA.addressCountry)),
      "the country code picked up the fallback language",
    ).toBe("");
  });

  it("types both <#it> classes and every sub-thing", async () => {
    const { quads } = await load();
    const types = (subject: string) =>
      objectsOf(quads, subject, RDF.type).map((t) => t.value).sort();
    expect(types(`${ENTRY_URL}#it`)).toEqual([DY_CLASS.Entry, SCHEMA.BlogPosting].sort());
    expect(types(`${ENTRY_URL}#place`)).toEqual([SCHEMA.Place]);
    expect(types(`${ENTRY_URL}#address`)).toEqual([SCHEMA.PostalAddress]);
    expect(types(`${ENTRY_URL}#geo`)).toEqual([SCHEMA.GeoCoordinates]);
    expect(types(`${ENTRY_URL}#photo-1`)).toEqual([SCHEMA.ImageObject]);
  });

  it("writes dy:status as an IRI, and a draft as dy:Draft", async () => {
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();

    const published = await serialiseEntry(spec);
    const draft = await serialiseEntry({ ...spec, status: "draft" });
    expect(published.ok && draft.ok).toBe(true);
    if (!published.ok || !draft.ok) return;

    const statusOf = (ttl: string) => oneObject(quadsOf(ttl, ENTRY_URL), `${ENTRY_URL}#it`, DY.status);
    expect(statusOf(published.value)?.value).toBe(STATUS.Published);
    expect(statusOf(published.value)?.termType).toBe("NamedNode");
    expect(statusOf(draft.value)?.value).toBe(STATUS.Draft);
  });

  it("writes dy:travelModeFrom as an IRI from the vocabulary", async () => {
    const { quads } = await load();
    const mode = oneObject(quads, `${ENTRY_URL}#it`, DY.travelModeFrom);
    expect(mode?.termType).toBe("NamedNode");
    expect(mode?.value).toBe(TRAVEL_MODE.Flight);
  });

  it("passes a coordinate through unaltered — it is not the fuzzing layer", async () => {
    /**
     * §9 requires fuzzing BEFORE the write, and it does not exist yet: TODO.md
     * puts "coordinate fuzzing with a configurable home radius" in phase 3, and
     * nothing under lib/ implements it. So this asserts the honest contract and
     * nothing more — whatever coordinate the serialiser is handed is the
     * coordinate that reaches the Pod, unrounded and unshifted. That is what
     * makes fuzzing unambiguously the caller's job, and it is why no test in
     * this file may be read as evidence that a coordinate was fuzzed.
     *
     * A serialiser that quietly rounded would also make `dy:precisionMeters` a
     * lie in the other direction, describing a precision the value no longer
     * has.
     */
    const serialiseEntry = await loadSerialise();
    const spec = await specEntry();
    const precise = { ...spec, place: { ...spec.place, geo: { lat: 35.69384712, long: 139.70341558, precisionMeters: 500 } } };

    const ttl = await serialiseEntry(precise);
    expect(ttl.ok).toBe(true);
    if (!ttl.ok) return;

    const quads = quadsOf(ttl.value, ENTRY_URL);
    expect(oneObject(quads, `${ENTRY_URL}#geo`, SCHEMA.latitude)?.value).toBe("35.69384712");
    expect(oneObject(quads, `${ENTRY_URL}#geo`, SCHEMA.longitude)?.value).toBe("139.70341558");
  });
});

/* =============================================== saveEntry — the §10 order */

describe("saveEntry — the §10 sequence", () => {
  it("creates: PUT with If-None-Match, then the ACL, then the index, then revalidation", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const entry = naraEntry(spec);
    const pod = podFake();
    const calls: string[] = [];
    const revalidated: string[][] = [];

    const report = await saveEntry({
      fetch: recordingFetch(calls),
      entry,
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: (tags) => void revalidated.push(tags),
      webId: WEBID,
      now: () => "2026-04-20T18:02:11+02:00",
    });

    expect(report.failed).toBeUndefined();
    expect(report.completed).toEqual(["entry", "access", "index", "revalidate"]);
    expect(report.recovery).toBe("none");

    // The caller's fetch is the only fetch. An implementation reaching for the
    // ambient one leaves this empty (invariant 4, and access.test.ts's rule 3).
    expect(calls.length).toBeGreaterThan(0);

    // Step 1 before step 3: the index must not be written before the resource
    // it lists exists, or a reader can follow a row to a 404.
    const order = pod.requests.map((r) => `${r.method} ${r.url}`);
    expect(order.indexOf(`PUT ${NARA_URL}`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`PUT ${NARA_URL}`)).toBeLessThan(order.indexOf(`PUT ${INDEX_URL}`));

    // Step 2 happened, through lib/pod/access.ts and nowhere else.
    expect(accessCalls).toEqual([{ op: "makePublic", url: NARA_URL }]);

    // Step 4 happened once, after step 3, with the tags the read layer uses.
    const { TAGS } = await import("@/lib/pod/cached");
    expect(revalidated).toHaveLength(1);
    expect(revalidated[0]).toEqual(
      expect.arrayContaining([TAGS.trip(TRIP_SLUG), TAGS.entry(TRIP_SLUG, entry.slug)]),
    );
  });

  it("sends If-None-Match: * to create, and no If-Match", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();

    await saveEntry({
      fetch: recordingFetch([]),
      entry: naraEntry(spec),
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => "2026-04-20T18:02:11+02:00",
    });

    const put = pod.of("PUT", NARA_URL)[0];
    expect(put).toBeDefined();
    expect(put.headers["if-none-match"]).toBe("*");
    expect(put.headers["if-match"]).toBeUndefined();
  });

  it("sends If-Match with the etag from the read that produced the edited state", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();

    await saveEntry({
      fetch: recordingFetch([]),
      entry: { ...spec, headline: { value: "First night in Shinjuku, revised", language: "en" } },
      precondition: { etag: '"entry-v7"' },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => "2026-04-20T18:02:11+02:00",
    });

    const put = pod.of("PUT", ENTRY_URL)[0];
    expect(put).toBeDefined();
    // The exact value, not merely "a header is present": an implementation that
    // sent the etag of the last write, or `*`, would satisfy a presence check
    // and defeat the precondition entirely.
    expect(put.headers["if-match"]).toBe('"entry-v7"');
    expect(put.headers["if-none-match"]).toBeUndefined();
  });

  it("writes the index with the etag from the index read in step 3", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake({ indexEtag: '"idx-99"' });

    await saveEntry({
      fetch: recordingFetch([]),
      entry: naraEntry(spec),
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => "2026-04-20T18:02:11+02:00",
    });

    const put = pod.of("PUT", INDEX_URL)[0];
    expect(put).toBeDefined();
    expect(put.headers["if-match"]).toBe('"idx-99"');
  });

  it("carries a precondition on EVERY PUT the sequence makes", async () => {
    // §10: "Never write without a precondition. A blind PUT is how a phone tab
    // that was open for two days silently reverts a week of edits." Swept
    // across the whole sequence rather than asserted per request, so a fourth
    // write added later cannot slip through unguarded.
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();

    await saveEntry({
      fetch: recordingFetch([]),
      entry: naraEntry(spec),
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => "2026-04-20T18:02:11+02:00",
    });

    const puts = pod.puts();
    expect(puts.length).toBeGreaterThanOrEqual(2);
    const unguarded = puts
      .filter((p) => !p.headers["if-match"] && !p.headers["if-none-match"])
      .map((p) => `${p.method} ${p.url}`);
    expect(unguarded).toEqual([]);
  });

  it("writes an entry body the real reader accepts, stamped with dcterms:modified", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const entry = naraEntry(spec);
    const pod = podFake();
    const NOW = "2026-04-20T18:02:11+02:00";

    // The input's dcterms:modified is the fixture's, so a stamp that did not
    // happen is visible rather than indistinguishable from one that did.
    expect(entry.modified).not.toBe(NOW);

    await saveEntry({
      fetch: recordingFetch([]),
      entry,
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => NOW,
    });

    const body = pod.bodyOf("PUT", NARA_URL);
    expect(body).toBeTruthy();
    expect(() => triples(body!, NARA_URL)).not.toThrow();

    servePod({ [NARA_URL]: body! });
    const back = await readEntry(NARA_URL);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.value.slug).toBe("2026-03-31-nara");
    expect(back.value.modified).toBe(NOW);
  });

  /**
   * `dcterms:created` ACROSS BOTH PATHS — the field this increment exists to
   * stop losing.
   *
   * The bug: `Entry` had no `created`, so `readEntry` dropped it and the first
   * read-modify-write in the studio wrote the resource back without it. §7.3 is
   * explicit about the cost — "created is when the record came into being and
   * datePublished is when it became public. They differ by however long the
   * draft sat" — and unlike a bad bbox this one is unrecoverable: no
   * `rebuildIndex` can reconstruct an instant nothing recorded.
   *
   * WHY THE TESTS ABOVE DID NOT CATCH IT, measured on scratch copies of
   * lib/pod/save-entry.ts before these were written:
   *
   *   created dropped on the update path only   372 passed   GREEN
   *   created dropped on BOTH paths             372 passed   GREEN
   *
   * The only update-path test was the `If-Match` one, which asserts headers and
   * never reads the PUT body back, and the create-path body test asserted
   * `slug` and `modified` and nothing else. `serialiseEntry` was covered —
   * dropping the triple there is 2 failed — so the hole was specifically
   * `saveEntry`'s stamping, the layer that decides between "set it" and "keep
   * it".
   *
   * Both read the PUT body back through the production `readEntry` rather than
   * grepping Turtle, so the assertion runs against the real parse: a `created`
   * written with the wrong datatype, or without its UTC offset, fails here too
   * instead of matching a substring.
   */
  it("an update carries dcterms:created forward unchanged", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();
    const NOW = "2026-04-20T18:02:11+02:00";

    /**
     * The fixture must actually HAVE a created, or the assertion below is
     * `undefined === undefined` and an implementation that dropped the field
     * entirely would pass. Pinned to the §7.3 value rather than merely checked
     * for truthiness, so a fixture edit that changes it is a visible failure
     * here and not a quietly weakened test.
     */
    expect(spec.created).toBe("2026-03-29T22:03:44+09:00");
    expect(spec.created).not.toBe(NOW);
    expect(spec.creator).toBe(WEBID);

    await saveEntry({
      fetch: recordingFetch([]),
      entry: { ...spec, headline: { value: "First night in Shinjuku, revised", language: "en" } },
      precondition: { etag: '"entry-v7"' },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      // A DIFFERENT webId from the fixture's dcterms:creator, deliberately: an
      // edit must not rewrite the entry's provenance to whoever is holding the
      // session. Same class of loss as created, one field over.
      webId: `${POD}/profile/card#not-the-author`,
      now: () => NOW,
    });

    const body = pod.bodyOf("PUT", ENTRY_URL);
    expect(body).toBeTruthy();

    servePod({ [ENTRY_URL]: body! });
    const back = await readEntry(ENTRY_URL);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // The load-bearing pair, and the second half is the one that matters.
    // Equality alone also passes an implementation that stamps `created` with
    // the write instant on every save — the same data loss wearing a plausible
    // value, which is exactly what would be hardest to spot in a Pod later.
    expect(back.value.created).toBe(spec.created);
    expect(back.value.created).not.toBe(NOW);

    // ...and this save really did produce this body, so the two above are about
    // a rewritten resource and not an untouched fixture served back to us.
    expect(back.value.modified).toBe(NOW);
    expect(back.value.headline.value).toBe("First night in Shinjuku, revised");

    // Provenance survives the edit too.
    expect(back.value.creator).toBe(spec.creator);

    /**
     * The sweep. Whole-object equality, for the same reason the round-trip test
     * above uses it: an update that loses ONE optional field is the bug in this
     * whole section, and picking fields to assert is how the next one gets
     * missed. Everything except the two things this save was supposed to change
     * must come back byte-for-byte identical through the model.
     */
    expect(back.value).toEqual({
      ...spec,
      headline: { value: "First night in Shinjuku, revised", language: "en" },
      modified: NOW,
    });
  });

  it("a create stamps dcterms:created and dcterms:creator", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();
    const NOW = "2026-04-20T18:02:11+02:00";

    // A genuinely new entry has neither: the studio's form state cannot know a
    // creation instant that has not happened yet, and the webId lives in the
    // session rather than in the form. `naraEntry` spreads the §7.3 fixture,
    // which carries both, so they are cleared explicitly — otherwise this would
    // pass on the caller's own values and prove nothing about the stamp.
    const entry: Entry = { ...naraEntry(spec), created: undefined, creator: undefined };
    expect(entry.created).toBeUndefined();
    expect(entry.creator).toBeUndefined();

    await saveEntry({
      fetch: recordingFetch([]),
      entry,
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      webId: WEBID,
      now: () => NOW,
    });

    const body = pod.bodyOf("PUT", NARA_URL);
    expect(body).toBeTruthy();

    servePod({ [NARA_URL]: body! });
    const back = await readEntry(NARA_URL);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    // §6: xsd:dateTime with its UTC offset, and `readEntry` validates that on
    // the way back in — so this is the datatype rule as well as the stamp.
    expect(back.value.created).toBe(NOW);
    expect(back.value.creator).toBe(WEBID);
    expect(back.value.modified).toBe(NOW);
  });

  it("a create keeps a caller-supplied dcterms:created — an import is not a new record", async () => {
    /**
     * `created: creating ? stamp : opts.entry.created` passes the test above
     * and quietly restamps every imported entry with the instant of the
     * import. §10's `rebuildIndex` is "how a new deployer imports data written
     * by an older version of the app", so entries arriving with a real creation
     * date is a documented case, not a hypothetical one.
     */
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();
    const NOW = "2026-04-20T18:02:11+02:00";
    const IMPORTED = "2019-08-04T07:12:00+02:00";

    await saveEntry({
      fetch: recordingFetch([]),
      entry: { ...naraEntry(spec), created: IMPORTED },
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      webId: WEBID,
      now: () => NOW,
    });

    const body = pod.bodyOf("PUT", NARA_URL);
    expect(body).toBeTruthy();

    servePod({ [NARA_URL]: body! });
    const back = await readEntry(NARA_URL);
    expect(back.ok).toBe(true);
    if (!back.ok) return;

    expect(back.value.created).toBe(IMPORTED);
    expect(back.value.created).not.toBe(NOW);
    // The write still happened and still stamped what it is supposed to stamp.
    expect(back.value.modified).toBe(NOW);
  });

  it("recomputes entryCount, bbox and centre rather than incrementing them", async () => {
    // The §7.4 fixture declares dy:entryCount 14 while carrying one populated
    // row. An implementation that inserted a row and did count+1 would write 15
    // and copy the old bbox; both are the same class of bug — derived data left
    // describing a set it no longer describes.
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();

    await saveEntry({
      fetch: recordingFetch([]),
      entry: naraEntry(spec),
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => "2026-04-20T18:02:11+02:00",
    });

    const body = pod.bodyOf("PUT", INDEX_URL);
    expect(body).toBeTruthy();
    servePod({ [INDEX_URL]: body! });
    const index = await readTripIndex(INDEX_URL);
    expect(index.ok).toBe(true);
    if (!index.ok) return;

    // The pre-existing row survives; the new one is inserted.
    expect(index.value.entries.map((e) => e.slug).sort()).toEqual(
      ["2026-03-29-arrival", "2026-03-31-nara"].sort(),
    );
    expect(index.value.entryCount).toBe(2);
    expect(index.value.bbox).toEqual({
      west: 135.8048,
      south: 34.6851,
      east: 139.7034,
      north: 35.6938,
    });
    expect(index.value.center).toEqual({
      lat: (35.6938 + 34.6851) / 2,
      long: (139.7034 + 135.8048) / 2,
    });
  });
});

/* ================================== saveEntry — the three §10 failure modes */

/**
 * §10 names these, so they are requirements and not edge cases:
 *
 *   step 1 ok, step 3 fails  -> the entry exists but is unlisted: invisible,
 *                               not corrupt.
 *   step 2 ok, step 3 fails  -> the same.
 *   step 1 ok, step 2 fails  -> published-but-unreadable.
 *
 * "All three recover through the same operation: rebuildIndex(trip)." That is
 * only reachable if the caller can tell them apart from the case where nothing
 * happened at all — which is what these tests are about.
 */
describe("saveEntry — the partial-failure modes §10 designs for", () => {
  const base = (entry: Entry) => ({
    fetch: recordingFetch([]),
    entry,
    precondition: { create: true } as Precondition,
    indexUrl: INDEX_URL,
    tripIri: TRIP_IRI,
    tripSlug: TRIP_SLUG,
    revalidate: () => {},
    now: () => "2026-04-20T18:02:11+02:00",
  });

  it("step 1 fails: nothing was written, and the caller is not sent to rebuildIndex", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake({ fail: { entryPut: 507 } });
    const revalidated: string[][] = [];

    const report = await saveEntry({ ...base(naraEntry(spec)), revalidate: (t) => void revalidated.push(t) });

    expect(report.completed).toEqual([]);
    expect(report.failed?.step).toBe("entry");
    expect(report.failed?.error).toEqual({ kind: "http", url: NARA_URL, status: 507 });
    // rebuildIndex is the recovery for a Pod left half-written. Sending the
    // caller there when the Pod was not touched is advice that does nothing.
    expect(report.recovery).not.toBe("rebuildIndex");

    // And the later steps really did not run.
    expect(accessCalls).toEqual([]);
    expect(pod.of("PUT", INDEX_URL)).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  it("step 2 fails: the entry is on the Pod but unreadable — recovery is rebuildIndex", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake();
    accessOutcome.failure = { kind: "accessUnverified" };
    const revalidated: string[][] = [];

    const report = await saveEntry({ ...base(naraEntry(spec)), revalidate: (t) => void revalidated.push(t) });

    // The entry IS on the Pod. Saying otherwise loses it.
    expect(report.completed).toEqual(["entry"]);
    expect(pod.of("PUT", NARA_URL)).toHaveLength(1);
    expect(report.failed?.step).toBe("access");
    expect(report.failed?.error.kind).toBe("accessUnverified");
    expect(report.recovery).toBe("rebuildIndex");

    // rebuildIndex also "verifies each kept entry's ACL matches its status",
    // so indexing a resource whose access is unconfirmed is not a repair — and
    // publishing it into the index would advertise a row the public cannot read.
    expect(pod.of("PUT", INDEX_URL)).toEqual([]);
    expect(revalidated).toEqual([]);
  });

  it("step 3 fails: the entry exists but is unlisted — recovery is rebuildIndex", async () => {
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake({ fail: { indexPut: 412 } });
    const revalidated: string[][] = [];

    const report = await saveEntry({ ...base(naraEntry(spec)), revalidate: (t) => void revalidated.push(t) });

    expect(report.completed).toEqual(["entry", "access"]);
    expect(report.failed?.step).toBe("index");
    expect(report.failed?.error).toEqual({ kind: "http", url: INDEX_URL, status: 412 });
    expect(report.recovery).toBe("rebuildIndex");
    // The public site's cache must not be dropped on a write that did not
    // change what the public site reads.
    expect(revalidated).toEqual([]);
    expect(pod.of("PUT", NARA_URL)).toHaveLength(1);
  });

  it("the three outcomes are distinguishable from each other and from success", async () => {
    /**
     * THE POINT OF THE WHOLE FILE. "A boolean, or a thrown error, loses the
     * distinction between 'nothing happened' and 'the entry is on the Pod but
     * unlisted, run rebuildIndex'." An interface that cannot express partial
     * success makes §10's documented recovery path unreachable, so this asserts
     * the distinctions exist rather than asserting any one of them.
     */
    const saveEntry = await loadSave();
    const spec = await specEntry();

    const run = async (script: PodScript, accessFails: boolean) => {
      accessCalls.length = 0;
      accessOutcome.failure = accessFails ? { kind: "accessUnverified" } : null;
      podFake(script);
      const report = await saveEntry(base(naraEntry(spec)));
      accessOutcome.failure = null;
      return report;
    };

    const ok = await run({}, false);
    const noEntry = await run({ fail: { entryPut: 507 } }, false);
    const noAccess = await run({}, true);
    const noIndex = await run({ fail: { indexPut: 412 } }, false);

    const fingerprint = (r: SaveEntryReport) =>
      JSON.stringify({ completed: r.completed, failed: r.failed?.step, recovery: r.recovery });

    const seen = [ok, noEntry, noAccess, noIndex].map(fingerprint);
    expect(new Set(seen).size).toBe(4);

    // And the distinction is the ACTIONABLE one, not just four different
    // strings: exactly the two that left the entry on the Pod send the caller
    // to rebuildIndex.
    expect([ok, noEntry, noAccess, noIndex].map((r) => r.recovery === "rebuildIndex")).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("a stale etag is reported as refetch, and never retried blindly", async () => {
    // §10: "Fails on concurrent modification; refetch and retry." Retrying with
    // the same stale etag fails identically; retrying without one is the blind
    // PUT the precondition exists to prevent, and would overwrite whatever the
    // other tab wrote.
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const pod = podFake({ fail: { entryPut: 412 } });

    const report = await saveEntry({
      ...base(spec),
      precondition: { etag: '"stale"' },
    });

    expect(report.failed?.step).toBe("entry");
    expect(report.failed?.error).toEqual({ kind: "http", url: ENTRY_URL, status: 412 });
    expect(report.recovery).toBe("refetch");
    expect(pod.of("PUT", ENTRY_URL)).toHaveLength(1);
  });

  it("returns a report rather than throwing when the Pod is unreachable", async () => {
    // Consistent with the rest of lib/pod: "a thrown exception is not a
    // structured error" (result.ts). The studio has to render something.
    const saveEntry = await loadSave();
    const spec = await specEntry();
    podFake();

    const settled = await settle(
      saveEntry({
        ...base(naraEntry(spec)),
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );

    expect(settled.threw).toBeUndefined();
    expect(settled.returned?.failed?.step).toBe("entry");
    expect(settled.returned?.failed?.error.kind).toBe("network");
    expect(settled.returned?.completed).toEqual([]);
  });
});

/* ============================== saveEntry — the public/studio boundary (§4) */

describe("saveEntry — a draft must not leak", () => {
  it("keeps a draft out of the index and gives it owner-only access", async () => {
    // §7.4: "Only published entries reach the index. This is what makes the
    // boundary hold: the public site reads the index and therefore cannot leak
    // a draft title, even by accident, because the data is not there."
    const saveEntry = await loadSave();
    const spec = await specEntry();
    const draft: Entry = {
      ...naraEntry(spec),
      status: "draft",
      headline: { value: "UNPUBLISHED-CANARY", language: "en" },
    };
    const pod = podFake();

    const report = await saveEntry({
      fetch: recordingFetch([]),
      entry: draft,
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => "2026-04-20T18:02:11+02:00",
    });

    expect(report.failed).toBeUndefined();

    // Owner-only, through lib/pod/access.ts — §10 step 2.
    expect(accessCalls).toEqual([{ op: "makePrivate", url: NARA_URL }]);

    // The entry resource itself of course carries the headline; the INDEX must
    // not. Checked against the body actually sent, not against a model.
    expect(pod.bodyOf("PUT", NARA_URL)).toContain("UNPUBLISHED-CANARY");
    const indexBody = pod.bodyOf("PUT", INDEX_URL);
    if (indexBody !== undefined) {
      expect(indexBody).not.toContain("UNPUBLISHED-CANARY");
      expect(indexBody).not.toContain(draft.slug);
      servePod({ [INDEX_URL]: indexBody });
      const index = await readTripIndex(INDEX_URL);
      expect(index.ok).toBe(true);
      if (index.ok) expect(index.value.entries.map((e) => e.slug)).toEqual(["2026-03-29-arrival"]);
    }
  });

  it("still reports success for a draft, since nothing failed", async () => {
    // A draft that is deliberately not indexed is not a partial failure, and
    // reporting one would send the owner to rebuildIndex on every draft save.
    const saveEntry = await loadSave();
    const spec = await specEntry();
    podFake();

    const report = await saveEntry({
      fetch: recordingFetch([]),
      entry: { ...naraEntry(spec), status: "draft" },
      precondition: { create: true },
      indexUrl: INDEX_URL,
      tripIri: TRIP_IRI,
      tripSlug: TRIP_SLUG,
      revalidate: () => {},
      now: () => "2026-04-20T18:02:11+02:00",
    });

    expect(report.recovery).toBe("none");
    expect(report.failed).toBeUndefined();
    expect(report.completed).toContain("entry");
    expect(report.completed).toContain("access");
  });
});

/* ======================= the §10 steps, addressed one at a time (task 3) */

/**
 * The sequence above proves the four steps in order; these prove each one on
 * its own, which is the only place a step's precondition and its error channel
 * are visible without the three other steps in the way.
 */
describe("the §10 steps, one at a time", () => {
  const load = () => import("@/lib/pod/save-entry");

  const stepOpts = (entry: Entry, over: Partial<SaveEntryOptions> = {}): SaveEntryOptions => ({
    fetch: recordingFetch([]),
    entry,
    precondition: { create: true },
    indexUrl: INDEX_URL,
    tripIri: TRIP_IRI,
    tripSlug: TRIP_SLUG,
    revalidate: () => {},
    now: () => "2026-04-20T18:02:11+02:00",
    ...over,
  });

  /** §10: `If-None-Match: *` to create, `If-Match: <etag>` to update, and no
   *  third option. Asserted on the outgoing request, at the step that sends it. */
  it("step 1 carries If-None-Match: * to create and If-Match to update", async () => {
    const { putEntry } = await load();
    const spec = await specEntry();
    const pod = podFake();

    const created = await putEntry(stepOpts(spec), spec, ENTRY_URL);
    expect(created.ok).toBe(true);
    if (created.ok) expect(created.value.etag).toBe('"entry-v8"');
    expect(pod.of("PUT", ENTRY_URL)[0].headers["if-none-match"]).toBe("*");
    expect(pod.of("PUT", ENTRY_URL)[0].headers["if-match"]).toBeUndefined();

    await putEntry(stepOpts(spec, { precondition: { etag: '"entry-v7"' } }), spec, ENTRY_URL);
    expect(pod.of("PUT", ENTRY_URL)[1].headers["if-match"]).toBe('"entry-v7"');
    expect(pod.of("PUT", ENTRY_URL)[1].headers["if-none-match"]).toBeUndefined();
  });

  /** A serialiser refusal must not reach the Pod at all: §11 guardrail 7 wants
   *  the slug invariant on write, and a refused write is nothing to rebuild. */
  it("step 1 refuses a slug that disagrees with its filename, sending nothing", async () => {
    const { putEntry } = await load();
    const spec = await specEntry();
    const pod = podFake();
    const wrong: Entry = { ...spec, slug: "not-the-filename" };

    const r = await putEntry(stepOpts(wrong), wrong, ENTRY_URL);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe("slugMismatch");
    expect(pod.puts()).toEqual([]);
  });

  /** §5 pairs the ACL with dy:status, and both come off the one field. */
  it("step 2 sends a published entry to makePublic and a draft to makePrivate", async () => {
    const { setEntryAccess } = await load();
    const spec = await specEntry();

    const published = await setEntryAccess(stepOpts(spec), spec, ENTRY_URL);
    expect(published.ok).toBe(true);
    const draft: Entry = { ...spec, status: "draft" };
    await setEntryAccess(stepOpts(draft), draft, ENTRY_URL);

    expect(accessCalls).toEqual([
      { op: "makePublic", url: ENTRY_URL },
      { op: "makePrivate", url: ENTRY_URL },
    ]);
  });

  it("step 4 passes both cache tags, and reports a throwing hook as a network error", async () => {
    const { runRevalidation } = await load();
    const spec = await specEntry();
    const tags: string[][] = [];

    const good = await runRevalidation(
      stepOpts(spec, { revalidate: (t) => void tags.push(t) }),
      spec,
      ENTRY_URL,
    );
    expect(good.ok).toBe(true);
    expect(tags).toEqual([[`trip:${TRIP_SLUG}`, `entry:${TRIP_SLUG}/${spec.slug}`]]);

    const bad = await runRevalidation(
      stepOpts(spec, {
        revalidate: () => {
          throw new Error("route handler said no");
        },
      }),
      spec,
      ENTRY_URL,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.kind).toBe("network");
    expect(bad.error).toMatchObject({ url: ENTRY_URL });
  });

  /** Pure, and the sequence tests cannot see it: three steps read `stamped`
   *  after this runs, so a version that mutated in place would pass them all. */
  it("the provenance stamp leaves the caller's entry untouched", async () => {
    const { stampedEntry } = await load();
    const spec = await specEntry();
    const before = structuredClone(spec);

    const stamped = stampedEntry(stepOpts(spec), "2026-04-20T18:02:11+02:00");
    expect(stamped.modified).toBe("2026-04-20T18:02:11+02:00");
    expect(stamped.created).toBe(spec.created);
    expect(spec).toEqual(before);
  });
});

/**
 * The studio's trip list — lib/studio/trips.ts, which does not exist yet.
 *
 * WHY THIS MODULE EXISTS AND WHY IT MAY NOT READ THE DIARY.
 *
 * `components/studio/studio-shell/studio-shell.tsx` takes an optional `trips` prop and
 * renders the entry editor when it is non-empty. Nothing supplies it, so the
 * owner always sees the honest "no trips" note instead. This is the module that
 * supplies it.
 *
 * docs/data-model.md §4, "The index is the publication boundary", settles how:
 *
 *   > The **public site** reads `entries.ttl` and can therefore never leak a
 *   > draft title […] The **studio** is authenticated and enumerates `entries/`
 *   > directly via `ldp:contains`, so it sees drafts and published entries
 *   > alike.
 *
 * The same split one level up. `travel/diary.ttl` is the public trip list, so a
 * studio built on `readDiary()` would list published trips only — and the owner
 * could never add an entry to a draft trip, which is most of what a draft trip
 * is for. The headline test below ("a draft trip appears") is the pin that stops
 * that simplification, and the fake Pod is built so it cannot pass by accident:
 * see THE FLIP, next.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FLIP. Everything about the intended design is load-bearing in the fake
 * Pod's behaviour rather than in a spy:
 *
 *   - The trips CONTAINER is owner-only, exactly as §4's verified WAC fix
 *     leaves it ("grant the public `acl:default` on the container without
 *     `acl:accessTo` — children stay readable, the listing closes, the
 *     authenticated studio still enumerates"). An implementation reaching for
 *     the ambient `fetch` gets 403 and returns a structured error, so every
 *     listing test fails rather than one header assertion.
 *   - The DRAFT trip's `trip.ttl` is owner-only too. An implementation that
 *     authenticated the listing but read the members anonymously finds the
 *     draft in `skipped` and not in `trips`, which is the one thing the draft
 *     test asserts it must not be.
 *
 * Both are what a real Pod does. Neither is a mock of our own code: the seam is
 * MSW at the HTTP layer, per CLAUDE.md's Testing section, and the module under
 * test is reached through the plain `fetch` it is handed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONTRACT THIS FILE ASSERTS, since it is the thing being designed here:
 *
 *   listStudioTrips({ fetch, podRoot }): Promise<Result<TripListing>>
 *   TripListing = { trips: EditorTrip[]; skipped: { url, reason }[] }
 *
 * `fetch` is the session's authenticated one — required, never defaulted to the
 * ambient one, the same rule `saveEntry` states in as many words. `podRoot`
 * arrives as a prop from the thin server component: POD_ROOT is not
 * `NEXT_PUBLIC_` and lib/config.ts throws the moment it is reached in a
 * browser, exactly as with `ownerWebId`, `oidcIssuer`, `siteUrl` and
 * `siteName`. Section 5 pins that the module reads neither.
 *
 * The trip shape is asserted STRUCTURALLY against `EditorTrip`, the prop type
 * `components/studio/entry-editor/entry-editor.tsx` already publishes, and not by requiring
 * that type to be imported: a lib/ module importing a type from a component is
 * backwards layering, and the editor only cares that the object fits.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { ESLint } from "eslint";
import { server } from "@/test/msw";
import { triples } from "@/test/graph";
import { NS } from "@/lib/vocab";
import { readTrip } from "@/lib/pod/read";
import { listContainer } from "@/lib/pod/write";
import type { PodFetch } from "@/lib/pod/rdf";
import type { EditorTrip } from "@/components/studio/entry-editor";

/* ==========================================================================
 * 0. Reaching a module that is not there yet.
 *
 * Lifted from components/studio/studio-shell/studio-shell.test.tsx, for the reason given there: a static
 * `import … from "@/lib/studio/trips"` is resolved by vite's import-analysis
 * before a single test runs, so the whole FILE fails to load and vitest reports
 * one transform error instead of nineteen failing assertions. A specifier held
 * in a parameter is opaque to that pass.
 *
 * `typeof import(…)` on the next line is a TYPE and is erased before
 * import-analysis ever sees it, so it costs nothing at runtime — and `tsc
 * --noEmit` reporting "Cannot find module '@/lib/studio/trips'" IS the correct
 * red state for this step. It is deliberately not a locally-declared signature:
 * once the module exists, tsc checks every call below against its REAL one,
 * which a local guess would have replaced with this file's opinion of it.
 * ======================================================================== */

type TripsModule = typeof import("@/lib/studio/trips");

/** Opaque to vite:import-analysis by construction: the specifier is a
 *  parameter. `@vite-ignore` only silences the warning that says so. */
const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

async function loadTrips(): Promise<TripsModule> {
  const mod = (await importModule("@/lib/studio/trips").catch((cause: unknown) => {
    throw new Error(
      "lib/studio/trips.ts does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as TripsModule;
  if (typeof mod.listStudioTrips !== "function") {
    throw new Error(
      "lib/studio/trips.ts exists but exports no listStudioTrips — still the red step.",
    );
  }
  return mod;
}

describe("the loader this file reaches the module through", () => {
  /**
   * The control, and it earns its place: with the trick above, "the module is
   * missing" and "the loader resolves nothing" look identical from the outside,
   * and the second would make every test below fail for a reason that is not
   * the module's. Both directions, against a module that certainly exists and
   * one that certainly does not.
   */
  it("resolves the @/ alias, and rejects what is absent", async () => {
    const known = (await importModule("@/lib/pod/write")) as { listContainer?: unknown };
    expect(typeof known.listContainer).toBe("function");

    await expect(importModule("@/lib/studio/definitely-not-here")).rejects.toThrow();
  });
});

/* ==========================================================================
 * 1. Fixtures — the §7.2 trip, read out of docs/data-model.md at runtime.
 *
 * Those blocks are normative ("the Turtle examples are the specification, not
 * illustrations"), so a hand-copied trip would test a copy of the spec.
 * ======================================================================== */

const doc = readFileSync("docs/data-model.md", "utf8");
const blocks = [...doc.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);
const [DIARY, TRIP] = blocks;

const POD = "https://pod.test.example/";
const TRIPS = `${POD}travel/trips/`;
const DIARY_URL = `${POD}travel/diary.ttl`;
const JAPAN = `${TRIPS}2026-japan/`;
const PATAGONIA = `${TRIPS}2025-patagonia/`;
const ICELAND = `${TRIPS}2024-iceland/`;
const tripDoc = (container: string) => `${container}trip.ttl`;

/** The credential the session's fetch carries. Its exact value is arbitrary;
 *  what matters is that the ambient fetch does not have it. */
const OWNER_CREDENTIAL = "DPoP owner-token";

/**
 * String-replace a fixture, and FAIL IF THE ANCHOR DID NOT MATCH.
 *
 * Copied from test/write-primitives.test.ts rather than shared, so that file's
 * 60 passing tests keep their own fixture. The reason is the same: a negative
 * test built by `fixture.replace(anchor, bad)` passes against the UNMODIFIED
 * fixture the moment the anchor drifts — reporting green while asserting that
 * valid data is valid. This project has been bitten by exactly that.
 */
function mutate(source: string, from: string, to: string): string {
  // Presence of the anchor is the check, not `out !== source`: a replacement
  // that happens to equal the anchor is legitimate (re-slugging the japan
  // fixture to its own slug, below) and would trip the latter.
  if (!source.includes(from)) {
    throw new Error(`fixture anchor did not match, so nothing was changed: ${from}`);
  }
  return source.replaceAll(from, to);
}

/** The §7.2 trip, re-slugged and renamed — and optionally demoted to a draft,
 *  or broken in one specific documented way. */
function tripFixture(
  slug: string,
  name: string,
  opts: {
    draft?: boolean;
    /** Drop `dy:index`. §4 fixes the layout, so the index URL is derivable
     *  without it; the schema has always had it optional. */
    noIndex?: boolean;
    /** A version this app does not understand (§11 guardrail 3). */
    schemaVersion?: number;
    /** A `dy:slug` that disagrees with the container segment (§11 guardrail 7). */
    slugSaying?: string;
    /** A coordinate typed `xsd:float`, which §6 rules out. */
    floatCoordinate?: boolean;
  } = {},
): string {
  let t = mutate(TRIP, '"2026-japan"', `"${slug}"`);
  t = mutate(t, '"Japan, spring"', `"${name}"`);
  if (opts.draft) t = mutate(t, "dy:Published", "dy:Draft");
  if (opts.noIndex) t = mutate(t, "dy:index           <entries.ttl#it> ;", "");
  if (opts.schemaVersion !== undefined) {
    t = mutate(t, "dy:schemaVersion   1", `dy:schemaVersion   ${opts.schemaVersion}`);
  }
  if (opts.slugSaying !== undefined) t = mutate(t, `"${slug}"`, `"${opts.slugSaying}"`);
  if (opts.floatCoordinate) {
    t = mutate(t, "schema:latitude    45.4642 ;", 'schema:latitude    "45.4642"^^xsd:float ;');
  }
  return t;
}

/** An LDP container listing with RELATIVE member IRIs — phase 0: "container
 *  listings use relative IRIs", which is why `listContainer` passes a baseIRI
 *  and why every expectation below is an absolute URL. */
function containerTurtle(members: readonly string[]): string {
  const contains =
    members.length === 0 ? "" : ` ;\n    ldp:contains ${members.map((m) => `<${m}>`).join(", ")}`;
  return `@prefix ldp: <${NS.ldp}> .
@prefix dcterms: <${NS.dcterms}> .

<>
    a ldp:BasicContainer, ldp:Container ;
    dcterms:modified "2026-09-04T10:00:00+00:00"${contains} .
`;
}

/**
 * What a trips container actually holds, and what it must not be mistaken for.
 *
 * `<>` is the container itself. It ends in "/" like every trip does, so a
 * member filter written as "keep the containers" walks straight into it and
 * fetches `travel/trips/trip.ttl`. `notes.ttl` is the mirror-image trap: a
 * filter copied from `rebuildIndex`, which keeps `.ttl` members, would read it
 * as a trip and skip every real one.
 */
const NOISE = ["", "notes.ttl", "README.md", ".acl", "cover.jpg"] as const;

type Served = string | number;

type Recorded = { url: string; method: string; authenticated: boolean; accept: string | null };

/**
 * A Pod over MSW, which discriminates on the credential the way a real one
 * does. Handlers are scoped to this one origin — no catch-all, so a request to
 * anything else still hits test/setup.ts's network guard and fails the test.
 */
function fakePod(spec: {
  /** Readable by anyone. */
  open?: Record<string, Served>;
  /** Readable only with the owner's credential; 403 without it, which is what
   *  §4's WAC fix leaves on the container and what a draft's ACL leaves on the
   *  resource. */
  ownerOnly?: Record<string, Served>;
  /** Runs inside every GET, before it answers. Used to observe overlap. */
  onGet?: (url: string) => Promise<void> | void;
}) {
  const requests: Recorded[] = [];

  const respond = (held: Served) =>
    typeof held === "number"
      ? new HttpResponse(`status ${held}`, { status: held })
      : HttpResponse.text(held, { headers: { "content-type": "text/turtle", etag: '"v1"' } });

  server.use(
    http.get(`${POD}*`, async ({ request }) => {
      const authenticated = request.headers.get("authorization") === OWNER_CREDENTIAL;
      requests.push({
        url: request.url,
        method: request.method,
        authenticated,
        accept: request.headers.get("accept"),
      });
      await spec.onGet?.(request.url);

      const guarded = spec.ownerOnly?.[request.url];
      if (guarded !== undefined) {
        return authenticated ? respond(guarded) : new HttpResponse("Forbidden", { status: 403 });
      }
      const open = spec.open?.[request.url];
      if (open !== undefined) return respond(open);
      return new HttpResponse("Not found", { status: 404 });
    }),
  );

  return {
    requests,
    urls: () => requests.map((r) => r.url),
    got: (url: string) => requests.filter((r) => r.url === url),
  };
}

/** The session's fetch. MSW patches globalThis.fetch, so this IS the HTTP
 *  layer; the credential is the only thing that distinguishes it from the
 *  ambient one, which is precisely the distinction under test. */
const ownerFetch: PodFetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("authorization", OWNER_CREDENTIAL);
  return globalThis.fetch(input, { ...init, headers });
};

/**
 * The §7.1 diary with the draft trip taken out of it — one `dy:trip`, naming
 * the published trip only.
 *
 * Cut by IRI plus the comma before it, whitespace-insensitively, rather than by
 * matching the fixture's two-line `dy:trip` block: the indentation there is 24
 * spaces today and is not something this test should be pinned to. The
 * `mutate` call is what fails loudly if the IRI itself ever changes — a silent
 * no-op here would serve the FULL diary, and the §4 test would then pass
 * against a `readDiary()` implementation, which is precisely the outcome it
 * exists to prevent.
 *
 * Named twice instead of once was tried first and rejected: `dy:trip <a> , <a>`
 * is one triple to a set-based comparison but two quads to n3, so a
 * diary-reading implementation returned the same trip twice and could have
 * satisfied a length assertion by accident.
 */
const DIARY_WITHOUT_THE_DRAFT = mutate(
  DIARY,
  "<trips/2025-patagonia/trip.ttl#it>",
  "<trips/2025-patagonia/trip.ttl#it>",
).replace(/\s*,\s*<trips\/2025-patagonia\/trip\.ttl#it>/, "");

/**
 * The scenario most tests below run against: one published trip, one DRAFT trip
 * that is absent from `diary.ttl`, and a container full of things that are not
 * trips.
 *
 * `diary.ttl` is served, and served with only the published trip in it, on
 * purpose. A `readDiary()`-based implementation would therefore WORK — it would
 * return one trip and no errors — and be wrong in exactly the way §4 forbids.
 * Nothing here fails it by refusing the request; the draft assertion does.
 */
function studioPod(extra: { onGet?: (url: string) => Promise<void> | void } = {}) {
  return fakePod({
    open: {
      [DIARY_URL]: DIARY_WITHOUT_THE_DRAFT,
      [tripDoc(JAPAN)]: tripFixture("2026-japan", "Japan, spring"),
    },
    ownerOnly: {
      [TRIPS]: containerTurtle([...NOISE, "2026-japan/", "2025-patagonia/"]),
      [tripDoc(PATAGONIA)]: tripFixture("2025-patagonia", "Patagonia, unfinished", {
        draft: true,
      }),
    },
    onGet: extra.onGet,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/* ==========================================================================
 * 2. The fixtures are what this file thinks they are.
 *
 * Three controls. Each of them would, if wrong, turn an assertion below into a
 * green statement about nothing.
 * ======================================================================== */

describe("the fixtures", () => {
  it("really are mutated — the draft differs from the published trip", () => {
    const published = tripFixture("2026-japan", "Japan, spring");
    const draft = tripFixture("2025-patagonia", "Patagonia, unfinished", { draft: true });

    // `mutate` throws on a missed anchor, so this cannot silently compare a
    // fixture with itself. Asserting it anyway, because the whole §4 test rests
    // on these two graphs genuinely differing in dy:status.
    expect(draft).not.toEqual(published);
    expect(published).toContain("dy:Published");
    expect(published).not.toContain("dy:Draft");
    expect(draft).toContain("dy:Draft");
    expect(draft).not.toContain("dy:Published");
  });

  it("parse as blank-node-free graphs, per §6", () => {
    // §6 bans blank nodes outright, which is what lets test/graph.ts compare by
    // set equality at all. `triples()` throws on one.
    for (const [base, turtle] of [
      [tripDoc(JAPAN), tripFixture("2026-japan", "Japan, spring")],
      [tripDoc(PATAGONIA), tripFixture("2025-patagonia", "Patagonia, unfinished", { draft: true })],
      [TRIPS, containerTurtle([...NOISE, "2026-japan/"])],
      [TRIPS, containerTurtle([])],
    ] as const) {
      expect(triples(turtle, base).size).toBeGreaterThan(0);
    }
  });

  /**
   * THE FLIP, PROVED AGAINST TODAY'S CODE.
   *
   * Everything this file asserts about the credential rests on the fake Pod
   * really answering differently without it. If it did not — if `ownerOnly`
   * were served to anyone — an implementation using `globalThis.fetch` would
   * pass every test below and the module would ship listing published trips
   * only. So the anonymous view is exercised here, through the same
   * `listContainer` and `readTrip` the module will use.
   */
  it("control: without the credential this Pod refuses the listing and the draft", async () => {
    studioPod();

    // The container: closed, which is what §4's verified WAC fix leaves behind.
    const anonymousListing = await listContainer(globalThis.fetch, TRIPS);
    expect(anonymousListing.ok).toBe(false);
    if (anonymousListing.ok) return;
    expect(anonymousListing.error).toEqual({ kind: "http", url: TRIPS, status: 403 });

    // The draft resource: closed by its own ACL.
    const anonymousDraft = await readTrip(tripDoc(PATAGONIA));
    expect(anonymousDraft.ok).toBe(false);

    // The published trip: open, so the discrimination is on the credential and
    // not on the fake Pod refusing everything.
    const anonymousPublished = await readTrip(tripDoc(JAPAN));
    expect(anonymousPublished.ok).toBe(true);

    // And with the credential, all three succeed.
    const authenticated = await listContainer(ownerFetch, TRIPS);
    expect(authenticated.ok).toBe(true);
    const authenticatedDraft = await readTrip(tripDoc(PATAGONIA), { fetch: ownerFetch });
    expect(authenticatedDraft.ok).toBe(true);
    if (!authenticatedDraft.ok) return;
    expect(authenticatedDraft.value.status).toBe("draft");
  });

  it("the diary served here lists the published trip and NOT the draft", () => {
    // The §7.1 fixture names two trips. The point of the studio module is that
    // it does not consult this resource at all, so it is served in the state
    // that makes a diary-based implementation look successful: one trip, no
    // errors, the draft missing. If this control ever fails, the §4 test below
    // is no longer distinguishing anything.
    expect(DIARY).toContain("2025-patagonia");
    expect(DIARY_WITHOUT_THE_DRAFT).toContain("2026-japan");
    expect(DIARY_WITHOUT_THE_DRAFT).not.toContain("2025-patagonia");
    // Exactly one dy:trip, counted on the TEXT and not only on the triple set:
    // a set collapses a duplicated IRI to one member while n3 hands a reader
    // two quads, and this fixture must not differ between those two views.
    expect(DIARY_WITHOUT_THE_DRAFT.match(/trip\.ttl#it/g)).toHaveLength(1);
    const tripTriples = [...triples(DIARY_WITHOUT_THE_DRAFT, DIARY_URL)].filter((t) =>
      t.includes("trip.ttl#it"),
    );
    expect(tripTriples).toHaveLength(1);
  });
});

/* ==========================================================================
 * 3. Enumerating the container.
 * ======================================================================== */

/**
 * The identity function, and it is doing real work.
 *
 * Every assertion below reads the list through this, so once lib/studio/trips.ts
 * exists `tsc --noEmit` checks what it returns against the prop type the editor
 * ACTUALLY declares, at each use site. A runtime key check would pass on a
 * `name` of the wrong type, and that is the field most likely to be wrong:
 * `EditorTrip.name` is a plain string while the `Trip` that comes off
 * `readTrip` carries a language-tagged `{ value, language }`.
 *
 * While the module is missing it types the array too, which keeps
 * `tsc --noEmit` reporting the ONE error that matters — the absent module —
 * rather than burying it under seven implicit-`any` callbacks.
 */
const asEditorTrips = (trips: EditorTrip[]): EditorTrip[] => trips;
const slugsOf = (trips: EditorTrip[]): string[] => asEditorTrips(trips).map((t) => t.slug);

describe("listStudioTrips", () => {
  it("enumerates the trips container and returns what the editor needs", async () => {
    const pod = studioPod();
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const trips = asEditorTrips(r.value.trips);
    expect(trips).toHaveLength(2);

    const japan = trips.find((t) => t.slug === "2026-japan");
    // `toMatchObject`, not `toEqual`: the brief for this module is "at least
    // what the editor needs", and an EXTRA field is something this test has no
    // business forbidding. `dy:status` is the obvious candidate — `EditorTrip`
    // has no room for it today, so a picker listing a draft and a published
    // trip side by side cannot say which is which, and that is a gap worth
    // leaving open rather than one worth locking shut. Every field named here
    // is still checked exactly, and `asEditorTrips` above is the compile-time
    // floor under the whole array.
    expect(japan).toMatchObject({
      // `<…/trip.ttl#it>` — what `dy:trip` on an entry points at, so it is the
      // fragment IRI and never the document URL.
      iri: `${tripDoc(JAPAN)}#it`,
      slug: "2026-japan",
      // Flattened out of the language-tagged literal: `EditorTrip.name` is what
      // the owner picks from a <select>, and that is a string.
      name: "Japan, spring",
      // A DOCUMENT URL, no fragment. `saveEntry` hands this straight to
      // `readTripIndexWithEtag` and then to `putGuarded`; `<entries.ttl#it>` as
      // written in the trip would address nothing and PUT over the index.
      indexUrl: `${JAPAN}entries.ttl`,
      // Trailing slash. In LDP a container without one is a different resource,
      // and CSS redirects to the slashed form.
      entriesContainer: `${JAPAN}entries/`,
    });

    expect(r.value.skipped).toEqual([]);
    // It asked the container, as Turtle.
    expect(pod.got(TRIPS)).toHaveLength(1);
    expect(pod.got(TRIPS)[0].accept).toBe("text/turtle");
  });

  /**
   * THE §4 ASSERTION. A draft trip is absent from `diary.ttl` by design, and
   * present in the container. The studio must see it, or the owner can never
   * add an entry to a draft trip — which is most of what a draft trip is for.
   *
   * This is also the test that fails if someone later "simplifies" the module
   * to `getDiary()`: the diary this Pod serves parses fine and names the
   * published trip, so that implementation returns `ok` with one trip and an
   * empty `skipped`, and dies here and here alone.
   */
  it("lists a DRAFT trip that the public diary does not name", async () => {
    const pod = studioPod();
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const trips = asEditorTrips(r.value.trips);
    expect(slugsOf(trips).sort()).toEqual(["2025-patagonia", "2026-japan"]);
    // Not merely "two trips": the draft is a first-class row the editor can
    // write into, not a stub with a missing container.
    const draft = trips.find((t) => t.slug === "2025-patagonia");
    expect(draft?.entriesContainer).toBe(`${PATAGONIA}entries/`);
    expect(draft?.indexUrl).toBe(`${PATAGONIA}entries.ttl`);
    expect(draft?.name).toBe("Patagonia, unfinished");
    // And it is not hiding in the skip report.
    expect(r.value.skipped).toEqual([]);
    // The diary is the public read model and this path must not consult it.
    // Asserted separately from the list contents because an implementation
    // could read BOTH and merge, which would pass every assertion above while
    // making the studio depend on a resource §4 says it does not.
    expect(pod.got(DIARY_URL)).toHaveLength(0);
  });

  it("reads one resource per trip and no index, so the list stays one round trip deep", async () => {
    const pod = studioPod();
    const { listStudioTrips } = await loadTrips();

    await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(pod.got(tripDoc(JAPAN))).toHaveLength(1);
    expect(pod.got(tripDoc(PATAGONIA))).toHaveLength(1);
    // `entries.ttl` and `entries/` are the editor's business at save time. A
    // list that read every trip's index would multiply the round trips by three
    // for a value it already knows from §4's layout.
    expect(pod.urls().filter((u) => u.includes("entries"))).toEqual([]);
    expect(pod.requests).toHaveLength(3);
  });

  /**
   * Two traps in one listing, and they pull in opposite directions, which is
   * why both are in the fixture rather than one.
   */
  it("mistakes neither the container itself nor a stray .ttl for a trip", async () => {
    const pod = studioPod();
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // `<>` resolves to the container, which ends in "/" exactly as a trip does.
    expect(pod.got(tripDoc(TRIPS))).toHaveLength(0);
    // `notes.ttl` is what a filter copied from rebuildIndex — which keeps
    // `.ttl` members — would read instead of the trips.
    expect(pod.got(`${TRIPS}notes.ttl`)).toHaveLength(0);
    expect(pod.got(`${TRIPS}README.md`)).toHaveLength(0);

    // And none of them is REPORTED either. Filtering a member that was never a
    // trip is normal; putting it in `skipped` would make the report noise on
    // every real Pod, and noise is how an actual skipped trip goes unnoticed.
    expect(r.value.skipped).toEqual([]);
    expect(asEditorTrips(r.value.trips)).toHaveLength(2);
  });

  it("derives the index URL from §4's layout when the trip omits dy:index", async () => {
    // `Trip.index` is optional in the schema and always has been: a Pod holds
    // whatever was written to it, including by an older version of this app.
    // §4 fixes the filename, so there is no reason to refuse the trip.
    const withoutIndex = tripFixture("2026-japan", "Japan, spring", { noIndex: true });
    // The mutation really removed it — otherwise this asserts that a trip WITH
    // dy:index gets an index URL, which every other test already covers.
    expect(withoutIndex).not.toContain("dy:index");
    fakePod({
      ownerOnly: {
        [TRIPS]: containerTurtle(["2026-japan/"]),
        [tripDoc(JAPAN)]: withoutIndex,
      },
    });
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const trips = asEditorTrips(r.value.trips);
    expect(trips).toHaveLength(1);
    expect(trips[0].indexUrl).toBe(`${JAPAN}entries.ttl`);
    expect(r.value.skipped).toEqual([]);
  });

  /**
   * Ordering. §6: "parse order carries no meaning and must never be relied on."
   * The owner's trip <select> must not reshuffle between page loads because the
   * server serialised its container differently.
   *
   * The KEY is deliberately not pinned — slug, start date or name are all
   * defensible and that is the implementer's call. What is pinned is that the
   * order does not come out of the document.
   */
  it("orders the list the same way whatever order the container serialises in", async () => {
    const members = ["2026-japan/", "2025-patagonia/", "2024-iceland/"];
    const trips: Record<string, Served> = {
      [tripDoc(JAPAN)]: tripFixture("2026-japan", "Japan, spring"),
      [tripDoc(PATAGONIA)]: tripFixture("2025-patagonia", "Patagonia, unfinished"),
      [tripDoc(ICELAND)]: tripFixture("2024-iceland", "Iceland, ring road"),
    };
    const { listStudioTrips } = await loadTrips();

    fakePod({ ownerOnly: { ...trips, [TRIPS]: containerTurtle(members) } });
    const forwards = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    // MSW resolves the most recently added handler first, so this replaces the
    // pod above. If it did not, both results would be identical and the control
    // test below — which proves the two listings really do parse differently —
    // is what tells the two failures apart.
    fakePod({ ownerOnly: { ...trips, [TRIPS]: containerTurtle([...members].reverse()) } });
    const backwards = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(forwards.ok && backwards.ok).toBe(true);
    if (!forwards.ok || !backwards.ok) return;
    expect(asEditorTrips(forwards.value.trips)).toHaveLength(3);
    expect(slugsOf(backwards.value.trips)).toEqual(slugsOf(forwards.value.trips));
  });

  it("control: the two listings above really do parse in different orders", async () => {
    // Without this, the determinism test passes against a parser that happened
    // to normalise the order for us, and would keep passing if the module never
    // sorted anything at all.
    const members = ["2026-japan/", "2025-patagonia/", "2024-iceland/"];

    fakePod({ ownerOnly: { [TRIPS]: containerTurtle(members) } });
    const forwards = await listContainer(ownerFetch, TRIPS);

    fakePod({ ownerOnly: { [TRIPS]: containerTurtle([...members].reverse()) } });
    const backwards = await listContainer(ownerFetch, TRIPS);

    expect(forwards.ok && backwards.ok).toBe(true);
    if (!forwards.ok || !backwards.ok) return;
    expect(forwards.value).not.toEqual(backwards.value);
    expect([...forwards.value].reverse()).toEqual(backwards.value);
  });
});

/* ==========================================================================
 * 4. The failure boundaries — where this project's bugs actually live.
 * ======================================================================== */

describe("listStudioTrips, when a trip cannot be read", () => {
  /**
   * `rebuildIndex`'s `RebuildReport` is the established shape and the reason
   * for it applies here verbatim: "one malformed entry is skipped and reported,
   * never fatal. A single bad resource must not make the whole trip
   * unrecoverable." One unreadable trip must not cost the owner the editor.
   *
   * `reason` is the `PodError.kind`, exactly as `rebuildIndex` records it —
   * that is what makes the report actionable rather than a count.
   */
  const BROKEN: [label: string, body: Served, reason: string][] = [
    ["a trip.ttl that is not there", 404, "http"],
    ["a closed trip.ttl", 403, "http"],
    ["a trip.ttl that is not Turtle", "@prefix broken", "parse"],
    [
      "a schemaVersion this app does not understand",
      tripFixture("2027-future", "From the future", { schemaVersion: 99 }),
      "schemaVersion",
    ],
    [
      "a dy:slug that disagrees with its container segment",
      tripFixture("2027-future", "Mislabelled", { slugSaying: "somewhere-else" }),
      "slugMismatch",
    ],
    [
      "a coordinate typed xsd:float",
      tripFixture("2027-future", "Floating point", { floatCoordinate: true }),
      "datatype",
    ],
  ];

  it.each(BROKEN)("skips AND reports %s, without losing the others", async (_label, body, reason) => {
    const broken = `${TRIPS}2027-future/`;
    fakePod({
      ownerOnly: {
        [TRIPS]: containerTurtle([...NOISE, "2026-japan/", "2025-patagonia/", "2027-future/"]),
        [tripDoc(JAPAN)]: tripFixture("2026-japan", "Japan, spring"),
        [tripDoc(PATAGONIA)]: tripFixture("2025-patagonia", "Patagonia, unfinished", {
          draft: true,
        }),
        ...(typeof body === "number" ? {} : { [tripDoc(broken)]: body }),
      },
      // A 404 has to be an absence, not a stored 404: `ownerOnly` would answer
      // 403 to an anonymous request and mask the case.
      open: typeof body === "number" && body === 403 ? { [tripDoc(broken)]: 403 } : {},
    });
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    // Not fatal. The whole operation still succeeds.
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Reported, with enough to act on: which resource, and why.
    expect(r.value.skipped).toEqual([{ url: tripDoc(broken), reason }]);
    // And not silently dropped INTO the list either.
    expect(slugsOf(r.value.trips).sort()).toEqual(["2025-patagonia", "2026-japan"]);
  });

  it("reports several broken trips rather than only the first", async () => {
    // A report that stops at the first failure sends the owner round the same
    // loop once per broken trip.
    const a = `${TRIPS}2027-a/`;
    const b = `${TRIPS}2027-b/`;
    fakePod({
      ownerOnly: {
        [TRIPS]: containerTurtle(["2026-japan/", "2027-a/", "2027-b/"]),
        [tripDoc(JAPAN)]: tripFixture("2026-japan", "Japan, spring"),
        [tripDoc(a)]: "@prefix broken",
      },
    });
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(slugsOf(r.value.trips)).toEqual(["2026-japan"]);
    expect([...r.value.skipped].sort((x, y) => x.url.localeCompare(y.url))).toEqual([
      { url: tripDoc(a), reason: "parse" },
      { url: tripDoc(b), reason: "http" },
    ]);
  });

  /**
   * Reads are concurrent, for the reason recorded in §13 item 6 after phase 0
   * and applied in `rebuildIndex`: "200 sequential reads against a hosted Pod
   * over real RTT". A diary has fewer trips than that, but the cost is the same
   * shape — n × RTT on the one screen the owner waits at before writing.
   *
   * The assertion is OVERLAP, not a bound and not a duration: a bound would pin
   * the constant 12, and a duration would be flaky on a loaded machine.
   */
  it("reads the trips concurrently rather than one after another", async () => {
    const slugs = Array.from({ length: 6 }, (_, i) => `202${i}-trip`);
    let inFlight = 0;
    let peak = 0;
    fakePod({
      ownerOnly: {
        [TRIPS]: containerTurtle(slugs.map((s) => `${s}/`)),
        ...Object.fromEntries(
          slugs.map((s) => [tripDoc(`${TRIPS}${s}/`), tripFixture(s, `Trip ${s}`)]),
        ),
      },
      onGet: async (url) => {
        if (!url.endsWith("trip.ttl")) return;
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
      },
    });
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(asEditorTrips(r.value.trips)).toHaveLength(6);
    // Serial reads give a peak of exactly 1. Nothing here asserts how much
    // concurrency, only that there is some.
    expect(peak).toBeGreaterThan(1);
  });
});

describe("listStudioTrips, when the container itself cannot be enumerated", () => {
  /**
   * "No trips yet" and "your Pod would not answer" must not collapse into the
   * same value. One means write your first trip; the other means something is
   * wrong, and the owner needs a different action for each. The shell's "no
   * trips" note is written for the first and would be a lie for the second.
   */
  it("returns a clean empty list for an empty container, not an error", async () => {
    fakePod({ ownerOnly: { [TRIPS]: containerTurtle([]) } });
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.trips).toEqual([]);
    // Empty, not "everything was skipped" — the note the shell renders is about
    // having no trips, and a skip report would contradict it.
    expect(r.value.skipped).toEqual([]);
  });

  it("returns a clean empty list when the container holds nothing but noise", async () => {
    fakePod({ ownerOnly: { [TRIPS]: containerTurtle([...NOISE]) } });
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.trips).toEqual([]);
    expect(r.value.skipped).toEqual([]);
  });

  it.each([
    ["a closed container", 403],
    ["a container that is not there", 404],
  ])("reports %s as a structured error, distinguishable from an empty list", async (_l, status) => {
    fakePod({ open: { [TRIPS]: status } });
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The SHAPE, not merely that something failed: the caller renders different
    // words for 403 (an access problem) than for 404 (the container is missing,
    // so first-run setup never ran).
    expect(r.error).toEqual({ kind: "http", url: TRIPS, status });
  });

  it("reports an unreachable Pod as a network error, and never throws", async () => {
    const failing: PodFetch = async () => {
      throw new TypeError("connect ECONNREFUSED 127.0.0.1:3001");
    };
    const { listStudioTrips } = await loadTrips();

    // Reads return a value or a structured error. A rejected promise here would
    // take the studio down with an unhandled rejection instead of rendering a
    // message, so "it settled at all" is part of the assertion and not an
    // incidental consequence of awaiting it.
    const settled = listStudioTrips({ fetch: failing, podRoot: POD });
    await expect(settled).resolves.toBeDefined();

    const result = await settled;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("network");
    if (result.error.kind !== "network") return;
    expect(result.error.url).toBe(TRIPS);
    expect(result.error.message).toContain("ECONNREFUSED");
  });
});

/* ==========================================================================
 * 5. The credential, and the config that is not read.
 * ======================================================================== */

describe("listStudioTrips uses the fetch it was handed", () => {
  /**
   * The failure this whole design exists to avoid, and the reason it needs its
   * own test even though THE FLIP at the top of this file already makes an
   * ambient-fetch implementation fail: an unauthenticated listing silently
   * omits every draft on a Pod whose container IS publicly readable, and that
   * looks exactly like success.
   */
  it("sends the session's credential on every request, and makes no other", async () => {
    const pod = studioPod();
    const injected = vi.fn(ownerFetch);
    const { listStudioTrips } = await loadTrips();

    await listStudioTrips({ fetch: injected, podRoot: POD });

    // Not vacuous: there were requests to check.
    expect(pod.requests.length).toBeGreaterThan(1);
    for (const request of pod.requests) expect(request.authenticated).toBe(true);
    // And the count matches, so nothing slipped out through globalThis.fetch
    // alongside the injected one.
    expect(injected).toHaveBeenCalledTimes(pod.requests.length);
  });

  it("returns the list with POD_ROOT unset, because the root is a parameter", async () => {
    // The browser reproduced. POD_ROOT is not NEXT_PUBLIC_, so lib/config.ts's
    // `required()` throws the moment it is reached there; the value arrives as
    // a prop from the thin server component, exactly as ownerWebId and the rest
    // already do. A module that reached for `config.podRoot` anywhere on this
    // path throws "POD_ROOT is not set" and this render fails.
    vi.stubEnv("POD_ROOT", "");
    vi.stubEnv("OWNER_WEBID", "");
    vi.stubEnv("SITE_URL", "");

    studioPod();
    const { listStudioTrips } = await loadTrips();

    const r = await listStudioTrips({ fetch: ownerFetch, podRoot: POD });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(asEditorTrips(r.value.trips)).toHaveLength(2);
  });
});

/**
 * What only the source can show. The runtime test above covers config being
 * READ on the one path it drives; this covers it being merely IMPORTED, which
 * is enough to break the browser bundle, and covers the paths that test does
 * not take. Same justification as section 5 of components/studio/studio-shell/studio-shell.test.tsx.
 */
describe("lib/studio/trips.ts, as source", () => {
  const PATH = "lib/studio/trips.ts";

  function source(): string {
    try {
      return readFileSync(PATH, "utf8");
    } catch (cause) {
      throw new Error(
        `${PATH} does not exist yet — this is the red step of the TDD loop, not a broken test.`,
        { cause },
      );
    }
  }

  /** Comments stripped, so a comment EXPLAINING why config is not read here
   *  cannot fail the checks below. */
  function code(): string {
    return source()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  }

  /** Every module specifier, from both `import x from "y"` and `import "y"`. */
  function specifiers(text: string): string[] {
    return [...text.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2],
    );
  }

  /** Specifiers of `import type …` statements only — erased at compile time. */
  function typeOnlySpecifiers(text: string): string[] {
    return [...text.matchAll(/\bimport\s+type\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
  }

  it("the scanners work, so the bans below cannot pass on an empty set", () => {
    // Control 1: the comment stripper leaves the code behind. Every module in
    // lib/ opens with a docblock, so a stripper that ate too much would return
    // something with no imports in it and every ban below would be vacuous.
    expect(code().trim().length).toBeGreaterThan(0);
    expect(specifiers(code()).length).toBeGreaterThan(0);
    // Control 2: the classifier discriminates, proved on two literals rather
    // than on whatever the file happens to contain today.
    const sample = `import type { A } from "erased";\nimport { B } from "kept";\n`;
    expect(typeOnlySpecifiers(sample)).toEqual(["erased"]);
    expect(specifiers(sample)).toEqual(["erased", "kept"]);
  });

  it("does not import lib/config, which throws in a browser", () => {
    const imported = specifiers(code());
    expect(imported.filter((s) => /(^|\/)lib\/config$/.test(s))).toEqual([]);
    expect(imported.filter((s) => s.includes("lib/config"))).toEqual([]);
  });

  it("reads no environment variable directly either", () => {
    // process.env.POD_ROOT is `undefined` in a browser bundle unless it is
    // NEXT_PUBLIC_, and an undefined interpolated into a Pod URL fetches
    // "undefined/travel/trips/" — a 404 the owner cannot diagnose.
    expect(code()).not.toMatch(/\bprocess\s*\.\s*env\b/);
  });

  it("imports no VALUE from the Solid auth library — the fetch is injected", () => {
    // The credential arrives as a `fetch`. A value import here would put the
    // browser session library in this module's chunk and give it a second way
    // to obtain one, which is how the ambient-session bug gets written.
    const text = code();
    const erased = new Set(typeOnlySpecifiers(text));
    const values = specifiers(text).filter((s) => !erased.has(s));
    expect(values.filter((s) => s.startsWith("@inrupt/solid-client-authn-browser"))).toEqual([]);
  });

  it("reuses listContainer rather than parsing ldp:contains a second time", () => {
    // `listContainer` is tested at the HTTP layer in test/write-primitives.test.ts,
    // including the baseIRI that makes relative member IRIs resolve. A second
    // hand-rolled listing is a second place for that to be forgotten.
    expect(specifiers(code()).some((s) => /(^|\/)lib\/pod\/write$/.test(s))).toBe(true);
    expect(code()).not.toContain("LDP.contains");
  });
});

/* ==========================================================================
 * 6. The fence. lib/studio is studio-only, and the new module must be inside
 * it rather than beside it.
 *
 * eslint.config.mjs fences the DIRECTORY, so this is a regression pin rather
 * than a new rule — it is green from its first run, deliberately, and it is
 * here because "put trips.ts in lib/pod/ instead" is the change it catches.
 * ======================================================================== */

describe("the public/studio fence covers lib/studio/trips", () => {
  const eslint = new ESLint({ cwd: process.cwd() });

  async function lint(filePath: string, code: string) {
    const [result] = await eslint.lintText(code, { filePath, warnIgnored: false });
    return (result?.messages ?? []).map((m) => ({ ruleId: m.ruleId, message: m.message }));
  }

  it.each(["app/(public)/thing.tsx", "components/public/thing.tsx", "app/not-found.tsx"])(
    "rejects %s importing @/lib/studio/trips",
    async (path) => {
      const msgs = await lint(
        path,
        `import { listStudioTrips } from "@/lib/studio/trips";\n` +
          `export default function T() { return <div>{String(listStudioTrips)}</div>; }\n`,
      );
      expect(msgs.map((m) => m.ruleId)).toContain("no-restricted-imports");
      // Naming the specifier is what makes the CI output actionable.
      expect(
        msgs.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message).join("\n"),
      ).toContain("@/lib/studio/trips");
    },
  );

  it.each(["app/(studio)/studio/page.tsx", "components/studio/studio-shell/studio-shell.tsx"])(
    "allows %s to import it — a fence that rejects everything is not a fence",
    async (path) => {
      const msgs = await lint(
        path,
        `import { listStudioTrips } from "@/lib/studio/trips";\nexport default listStudioTrips;\n`,
      );
      expect(msgs.map((m) => m.ruleId)).not.toContain("no-restricted-imports");
    },
  );
});

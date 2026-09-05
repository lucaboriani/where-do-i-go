// @vitest-environment jsdom
/**
 * The studio's entry editor — components/studio/entry-editor.tsx.
 *
 * THE RED STEP OF THE TDD LOOP. Nothing under components/studio/ answers to
 * that name yet, and every test below is expected to fail on the missing module
 * until the implementation lands. `lib/pod/save-entry.ts` exists and is fully
 * tested (test/entry-write.test.ts); what does not exist is anything that CALLS
 * it. This file pins the caller.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS FAKED, AND AT WHICH SEAM. This matters more here than usual, because
 * the interesting behaviour is a four-step sequence against a Pod.
 *
 *   the Pod          MSW, at the HTTP layer. The entry PUT, the index GET and
 *                    the index PUT all go through plain `fetch`, so that is the
 *                    seam, and it is where the preconditions are asserted — on
 *                    the real outgoing request headers, not on a spy.
 *   the session      Injected as a plain object, exactly as
 *                    test/studio-shell.test.tsx and test/session.test.ts do. A
 *                    test that mocks @inrupt/solid-client-authn-browser tests
 *                    the library's idea of a session.
 *   /api/revalidate  MSW again. jsdom's origin is http://localhost:3000 and
 *                    vitest's jsdom `fetch` resolves a relative URL against it,
 *                    so the real route path is interceptable — verified before
 *                    this file was written.
 *   lib/pod/access   MOCKED AS A MODULE, and it is the ONE mock here. Named
 *                    explicitly because the rule is "fake at the injected
 *                    fetch, not by mocking modules": step 2 of §10 is
 *                    "set the entry's ACL", and test/access.test.ts establishes
 *                    at length that a fake convincing enough for
 *                    @inrupt/solid-client to read its own ACL write back would
 *                    encode that library's request sequence rather than our
 *                    behaviour — its own "yesMan" fake, which answers 2xx to
 *                    everything, is the fake access.ts is REQUIRED to reject.
 *                    So there is no HTTP script that makes step 2 succeed.
 *                    test/entry-write.test.ts made the same call for the same
 *                    reason; this file follows it rather than inventing a
 *                    second arrangement.
 *
 *                    It is not a way of asserting nothing: an editor that never
 *                    reaches step 2 leaves `accessCalls` empty and fails, and
 *                    scripting a failure there is the only way to reach one of
 *                    §10's three documented partial failures.
 *
 * `lib/pod/save-entry.ts` IS NOT MOCKED. Mock it and this file would test its
 * own mock instead of the §10 sequence; every outcome below is produced by
 * driving the real `saveEntry` with a scripted Pod.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY OUT OF SCOPE, each for a reason worth stating:
 *
 *   COORDINATES. §9 requires fuzzing BEFORE the write — "the Pod stores only
 *   the coordinate you are willing to publish" — and fuzzing is phase 3 and
 *   does not exist anywhere under lib/. An editor with a latitude field would
 *   therefore write an unfuzzed coordinate to a publicly readable resource,
 *   which is a privacy invariant broken rather than a feature missing. There is
 *   a test below asserting the editor exposes NO coordinate input at all, and a
 *   second asserting no coordinate predicate reaches the wire on a create. Both
 *   are safety pins, not placeholders: they must be deleted deliberately when
 *   fuzzing lands, which is the point.
 *
 *   PHOTOS (phase 3, needs the resize/EXIF pipeline), CREATING A TRIP (not in
 *   phase 2), RICH TEXT.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE PROP AND LABEL SHAPES BELOW ARE THIS FILE'S PROPOSAL, NOT ITS SUBJECT.
 * Every assertion is about what reaches the Pod, what reaches the revalidation
 * hook, and what the owner is told. An implementer who prefers different prop
 * names or different field labels changes `renderEditor` and `LABEL` and
 * nothing else.
 */

import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { StrictMode } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Parser, type Quad, type Term } from "n3";
import { DCTERMS, DY, GEO, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE, XSD } from "@/lib/vocab";
import { readEntry } from "@/lib/pod/read";
import { TAGS } from "@/lib/pod/tags";
import { resetSessionRestore, type StudioSessionLike } from "@/lib/studio/session";
import { triples } from "./graph";
import { server, servePod } from "./msw";
import type { Entry } from "@/lib/pod/schema";

/**
 * FIXED, AND NOT THE MACHINE'S.
 *
 * §7.3: "dy:occurredAt carries the local UTC offset of the place", and the
 * editor's job is to turn what a human typed into a timestamp that carries one.
 * A test that inherited the developer's zone would assert +02:00 in Rome,
 * +00:00 in CI — and on a UTC machine an implementation that hardcoded a `Z`
 * or an empty offset would look correct. Asia/Tokyo makes the offset non-zero
 * everywhere, and `the clock this file runs on` below fails loudly if the
 * assignment stopped taking effect rather than letting the pin quietly weaken.
 *
 * Restored in afterAll. Vitest isolates each test file, but process.env is
 * process-global and this is cheaper than relying on that.
 */
const REAL_TZ = process.env.TZ;
process.env.TZ = "Asia/Tokyo";
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

/* ══════════════════════════════════════════════════ mock: lib/pod/access ══ */

const { accessCalls, accessOutcome } = vi.hoisted(() => ({
  accessCalls: [] as { op: string; url: string }[],
  /**
   * Scripted per test. Both `null` means the ACL write succeeded.
   *
   * `throws` is the ONE thing this fake does that lib/pod/access.ts contracts
   * itself never to do: throw instead of returning a Result. It exists because
   * `saveEntry` reports every failure it KNOWS about as a value, so the only way
   * to reach the editor's `catch` — the thing that stops an unexpected rejection
   * from leaving the save button disabled forever — is to make something throw
   * where nothing is meant to. @inrupt/solid-client, sitting under access.ts and
   * doing its own I/O, is exactly the sort of thing that can.
   */
  accessOutcome: {
    failure: null as { kind: string; url: string; expected: string; found: string } | null,
    throws: null as Error | null,
  },
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
    if (accessOutcome.throws !== null) throw accessOutcome.throws;
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

/* ══════════════════════════════════════════════ normative §7 fixtures ══ */

/**
 * The §7 blocks, extracted from docs/data-model.md AT RUNTIME. Those blocks are
 * normative (§11 guardrail 6); a hand-copied fixture would test a copy of the
 * specification instead of the specification. Same extraction as
 * test/read.test.ts and test/entry-write.test.ts.
 */
const DOC = readFileSync("docs/data-model.md", "utf8");
const BLOCKS = [...DOC.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);
const ENTRY_TTL = BLOCKS[2];
const INDEX_TTL = BLOCKS[3];

/** Guard the extraction: if the §7 numbering shifts, every test below would
 *  otherwise run silently against the wrong block. */
if (!ENTRY_TTL?.includes("dy:Entry") || !INDEX_TTL?.includes("dy:TripIndex")) {
  throw new Error("docs/data-model.md §7.3/§7.4 blocks not found at the expected index");
}

/* ═══════════════════════════════════════════════════════════ the fixtures ══ */

const POD = "https://me.solidcommunity.net";
const OWNER = `${POD}/profile/card#me`;
/** Deliberately not the owner's Pod host, so nothing can pass by coincidence. */
const REVALIDATE_URL = "http://localhost:3000/api/revalidate";

type EditorTrip = {
  iri: string;
  slug: string;
  /** What the owner picks from the list. */
  name: string;
  indexUrl: string;
  entriesContainer: string;
};

const tripFixture = (slug: string, name: string): EditorTrip => ({
  iri: `${POD}/travel/trips/${slug}/trip.ttl#it`,
  slug,
  name,
  indexUrl: `${POD}/travel/trips/${slug}/entries.ttl`,
  entriesContainer: `${POD}/travel/trips/${slug}/entries/`,
});

const JAPAN = tripFixture("2026-japan", "Japan, spring 2026");
const PERU = tripFixture("2027-peru", "Peru, 2027");
const TRIPS = [JAPAN, PERU];

const ARRIVAL_SLUG = "2026-03-29-arrival";
const ARRIVAL_URL = `${JAPAN.entriesContainer}${ARRIVAL_SLUG}.ttl`;

/** What the §7.3 fixture carries, so the "created survives an edit" assertion
 *  compares against the specification rather than against my typing. */
const SPEC_CREATED = "2026-03-29T22:03:44+09:00";
const SPEC_OCCURRED = "2026-03-29T21:40:00+09:00";

/* ═════════════════════════════════════════════════════════════ Turtle help ══ */

const quadsOf = (ttl: string, base: string): Quad[] => new Parser({ baseIRI: base }).parse(ttl);

const objectsOf = (qs: Quad[], subject: string, predicate: string): Term[] =>
  qs.filter((q) => q.subject.value === subject && q.predicate.value === predicate).map((q) => q.object);

const oneObject = (qs: Quad[], subject: string, predicate: string): Term | undefined =>
  objectsOf(qs, subject, predicate)[0];

const datatypeOf = (t: Term | undefined) =>
  t && t.termType === "Literal" ? t.datatype.value : undefined;
const languageOf = (t: Term | undefined) =>
  t && t.termType === "Literal" ? t.language : undefined;

/** The §7.3 entry as the app reads it — obtained by running the normative
 *  fixture through the real reader, so edit mode starts from the spec. */
async function specEntry(): Promise<Entry> {
  servePod({ [ARRIVAL_URL]: ENTRY_TTL });
  const r = await readEntry(ARRIVAL_URL);
  if (!r.ok) throw new Error(`the §7.3 fixture no longer reads: ${r.error.kind}`);
  return r.value;
}

/* ══════════════════════════════════════════════════════════ the fake Pod ══ */

type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };

type PodScript = {
  /** Per index URL: Turtle to serve, or a status code to answer with. */
  index?: Record<string, string | number>;
  indexEtag?: string;
  /** Status for the entry PUT. Anything outside 2xx is a failure. */
  entryPut?: number;
  /** The ETag the server returns on the entry PUT. `null` sends no header. */
  entryEtag?: string | null;
  indexPut?: number;
  /** The revalidation endpoint's answer. Status AND body, because a 200 whose
   *  body says `rejected: [...]` revalidated nothing — see §10 step 4 and the
   *  route's own docblock: "the hook can only know to throw by reading this". */
  revalidate?: { status: number; body?: unknown };
  /**
   * A ROUND TRIP HELD OPEN. Awaited by the entry PUT handler AFTER the request
   * has been recorded, so a test can observe the request in flight, act on the
   * form while it is, and then let the Pod answer.
   *
   * Additive and inert when absent — every existing script leaves it undefined
   * and the handler behaves exactly as before. It exists for section 8g, where
   * the invariant is about keystrokes made DURING a save, and there is no other
   * way to produce that window against a fake that answers instantly.
   */
  hold?: Promise<unknown>;
};

/**
 * Installs handlers for everything the §10 sequence touches, and records every
 * request with headers and body.
 *
 * Recording the REQUEST is the point. A test that spied on `putGuarded` would
 * pass against an implementation that bypassed it; the precondition headers
 * asserted below are the ones that actually went out.
 */
function podFake(script: PodScript = {}) {
  const requests: Recorded[] = [];
  const indexEtag = script.indexEtag ?? '"idx-1"';
  const entryEtag = script.entryEtag === undefined ? '"entry-2"' : script.entryEtag;
  const indexBodies = script.index ?? { [JAPAN.indexUrl]: INDEX_TTL, [PERU.indexUrl]: 404 };

  const record = async (request: Request) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    requests.push({ method: request.method, url: request.url, headers, body: await request.text() });
  };

  const indexHandlers = Object.entries(indexBodies).flatMap(([url, body]) => [
    http.get(url, async ({ request }) => {
      await record(request);
      return typeof body === "number"
        ? new HttpResponse(`index unavailable (${body})`, { status: body })
        : HttpResponse.text(body, { headers: { "content-type": "text/turtle", etag: indexEtag } });
    }),
    http.put(url, async ({ request }) => {
      await record(request);
      return script.indexPut
        ? new HttpResponse(`index write refused (${script.indexPut})`, { status: script.indexPut })
        : new HttpResponse(null, { status: 205, headers: { etag: '"idx-2"' } });
    }),
  ]);

  server.use(
    ...indexHandlers,
    // Any entry file under any trip: the slug is the test's choice, so the
    // handler cannot hardcode it, and a PUT to the WRONG url must be recorded
    // rather than 404ing into an unrelated error.
    http.put(`${POD}/travel/trips/:trip/entries/:file`, async ({ request }) => {
      await record(request);
      // Recorded FIRST, held second: a test waiting for the request to appear
      // must be able to see it while the response is still outstanding.
      if (script.hold !== undefined) await script.hold;
      if (script.entryPut) {
        return new HttpResponse(`entry write refused (${script.entryPut})`, { status: script.entryPut });
      }
      return new HttpResponse(null, {
        status: 205,
        headers: entryEtag === null ? {} : { etag: entryEtag },
      });
    }),
    http.post(REVALIDATE_URL, async ({ request }) => {
      await record(request);
      const answer = script.revalidate ?? { status: 200, body: { revalidated: 2, rejected: [] } };
      return HttpResponse.json(answer.body ?? {}, { status: answer.status });
    }),
  );

  const of = (method: string, url?: string) =>
    requests.filter((r) => r.method === method && (url === undefined || r.url === url));

  return {
    requests,
    of,
    puts: () => requests.filter((r) => r.method === "PUT"),
    /** The entry PUT — the one PUT that is not to an index resource. */
    entryPut: () =>
      requests.find((r) => r.method === "PUT" && !r.url.endsWith("entries.ttl")),
    indexPut: () => requests.find((r) => r.method === "PUT" && r.url.endsWith("entries.ttl")),
    revalidatePost: () => requests.find((r) => r.method === "POST" && r.url === REVALIDATE_URL),
  };
}

/* ════════════════════════════════════════════════════════ the fake session ══ */

/**
 * A CREDENTIAL, in the only form a test can observe one: a header the ambient
 * `fetch` would never add.
 *
 * The real `Session["fetch"]` attaches a DPoP-bound access token. An editor
 * that reaches for `globalThis.fetch` instead of the session's leaves every
 * request below without this header — which against a real Pod is a 401 on the
 * write and a draft invisible on the read (invariants 3 and 4).
 */
const CREDENTIAL = "DPoP test-token-not-a-real-one";

function fakeStudioSession(webId: string = OWNER) {
  const events = new EventEmitter();
  const info = { isLoggedIn: true, webId };
  const logins: unknown[] = [];
  const logouts: unknown[] = [];
  /** Every URL the SESSION's fetch was used for. */
  const fetched: string[] = [];

  const authenticatedFetch: typeof globalThis.fetch = async (input, init) => {
    fetched.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const headers = new Headers(init?.headers);
    headers.set("authorization", CREDENTIAL);
    return globalThis.fetch(input, { ...init, headers });
  };

  const session = {
    info,
    events,
    fetch: authenticatedFetch,
    async handleIncomingRedirect(): Promise<unknown> {
      return info;
    },
    async login(options?: unknown): Promise<void> {
      logins.push(options);
    },
    async logout(options?: unknown): Promise<void> {
      logouts.push(options);
      info.isLoggedIn = false;
      events.emit("logout");
    },
  };

  /**
   * Compile-time check that the fake still satisfies today's interface. It is
   * asserted through an intermediate const rather than an annotated literal on
   * purpose: excess-property checking does not apply, so `fetch` — which
   * StudioSessionLike does NOT model yet — is allowed to be here. That gap is
   * the point, and it is pinned as a source assertion at the bottom of this
   * file, because a type has no runtime trace to observe.
   */
  const asSessionLike: StudioSessionLike = session;
  void asSessionLike;

  return { session, info, events, logins, logouts, fetched };
}

/* ════════════════════════════════════════════════════════ the fake storage ══ */

/**
 * The three methods `lib/studio/drafts.ts` needs, and not one more.
 *
 * Declared structurally here rather than imported from the module, so these
 * tests fail on the EDITOR rather than on the module being absent — and so that
 * a `storage` prop typed as the DOM's `Storage` (which also demands `length`,
 * `key()` and `clear()`) is a tsc failure rather than a widened contract nobody
 * noticed. See section 8.
 */
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/* ═══════════════════════════════════════════ loading the component under test ══ */

/**
 * At RUNTIME through a dynamic import with a specifier vite cannot analyse, and
 * at COMPILE time through a type-only reference. The reasoning is
 * test/studio-shell.test.tsx's, measured there rather than assumed: a static
 * import of a module that does not exist is a resolution error that kills the
 * whole FILE and takes the environment controls with it, so the file reports
 * `(0 test)` instead of reporting red. `typeof import(...)` is a TYPE, erased
 * before import-analysis sees the file, and `tsc --noEmit` reporting "Cannot
 * find module '@/components/studio/entry-editor'" IS the correct red state.
 */
type EditorModule = typeof import("@/components/studio/entry-editor");

const importModule = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

async function loadEditor() {
  const mod = (await importModule("@/components/studio/entry-editor").catch((cause: unknown) => {
    throw new Error(
      "components/studio/entry-editor.tsx does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as EditorModule;
  const Editor = mod.default;
  if (typeof Editor !== "function") {
    throw new Error(
      "components/studio/entry-editor.tsx exists but default-exports no component — still the red step.",
    );
  }
  return Editor;
}

/**
 * Under StrictMode, for the same reason the shell is: the App Router runs the
 * studio under it in development and effects are invoked twice there.
 *
 * `initial` absent means CREATE. Present means EDIT, and it carries the ETag
 * from THE READ THAT PRODUCED THE STATE BEING EDITED — §10's words. There is no
 * `readEntryWithEtag` in lib/pod/read.ts today, so whoever opened the editor is
 * the only thing that can hold that ETag; an implementer who adds such a read
 * and does it inside the editor only has to change this harness.
 */
async function renderEditor(
  session: ReturnType<typeof fakeStudioSession>["session"],
  props: {
    trips?: EditorTrip[];
    initial?: { entry: Entry; etag: string | null };
    /**
     * The local draft store (section 8). Injected so the key scheme, the Zod
     * parse and the debounce all run for real against a storage whose failures
     * this file can script — a browser global cannot be made to throw
     * QuotaExceededError on demand, and Safari private mode is the case that
     * matters. Left undefined by every test above, which is what pins the
     * default: `localStorage`.
     */
    storage?: StorageLike;
  } = {},
) {
  const Editor = await loadEditor();
  return render(
    <StrictMode>
      <Editor
        session={session}
        trips={props.trips ?? TRIPS}
        initial={props.initial}
        storage={props.storage}
      />
    </StrictMode>,
  );
}

/* ══════════════════════════════════════════════════════════ form plumbing ══ */

/**
 * Accessible names only — `getByLabelText` and `getByRole`. Every input needs a
 * real label, and a query that reaches for a test id would let the editor ship
 * a field no screen reader can name.
 *
 * These patterns are loose on wording and strict on there being exactly one
 * match. An implementer who words a label differently changes this table.
 */
const LABEL = {
  trip: /trip/i,
  headline: /headline|title/i,
  articleBody: /body|story|what happened/i,
  occurredAt: /when|occurred|date/i,
  slug: /slug|url segment/i,
  status: /status|publish|draft/i,
  tags: /tags?\b/i,
  travelModeFrom: /travel mode|how you (got|arrived)|arriv|mode/i,
};

function setText(label: RegExp, value: string) {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
}

/** Accessible name of a labelled control, good enough for the choice helper. */
const nameOf = (el: HTMLElement) =>
  (el as HTMLInputElement).labels?.[0]?.textContent ??
  el.getAttribute("aria-label") ??
  el.textContent ??
  "";

/**
 * Pick one of a set. Supports `<select>`, a radio group and a single checkbox,
 * because "draft or published" is naturally any of the three and the choice is
 * the editor's to make. If it turns out to be a fourth thing, this helper is
 * what changes — not an assertion.
 */
function setChoice(label: RegExp, wanted: RegExp) {
  const radios = screen.queryAllByRole("radio", { name: wanted });
  if (radios.length === 1) {
    fireEvent.click(radios[0]);
    return;
  }

  const el = screen.getByLabelText(label);

  if (el instanceof HTMLSelectElement) {
    const option = [...el.options].find(
      (o) => wanted.test(o.textContent ?? "") || wanted.test(o.value) || wanted.test(o.label),
    );
    if (!option) {
      throw new Error(
        `no option matching ${wanted} in the ${label} control; options were [${[...el.options]
          .map((o) => `${o.value}=${o.textContent ?? ""}`)
          .join(", ")}]`,
      );
    }
    fireEvent.change(el, { target: { value: option.value } });
    return;
  }

  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    const on = wanted.test(nameOf(el));
    if (el.checked !== on) fireEvent.click(el);
    return;
  }

  throw new Error(
    `the ${label} control is a <${el.tagName.toLowerCase()}>, which setChoice does not drive yet`,
  );
}

const saveButton = () => screen.getByRole("button", { name: /save|publish|update/i });

/**
 * What the owner is told, read from the roles that ANNOUNCE it.
 *
 * Scoped to `alert` / `status` / `aria-live` deliberately: the result of a save
 * arrives asynchronously, after focus has moved on, and text dropped into a
 * plain <div> is text a screen-reader user never hears. This is also what keeps
 * the message assertions from matching the form's own labels.
 */
const outcomeText = () =>
  [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')]
    .map((n) => n.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** Fill a create form with a complete, valid entry. */
function fillNewEntry(overrides: { slug?: string; headline?: string; trip?: EditorTrip } = {}) {
  const trip = overrides.trip ?? JAPAN;
  setChoice(LABEL.trip, new RegExp(trip.name.split(",")[0], "i"));
  setText(LABEL.slug, overrides.slug ?? "2026-04-02-kyoto");
  setText(LABEL.headline, overrides.headline ?? "Rain on the Philosopher's Path");
  setText(LABEL.articleBody, "Two hours of drizzle and nobody else on the path.");
  setText(LABEL.occurredAt, "2026-04-02T16:20");
  setText(LABEL.tags, "walking, rain");
  setChoice(LABEL.travelModeFrom, /train/i);
  setChoice(LABEL.status, /publish/i);
}

async function clickSaveAndWait() {
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await waitFor(() => expect(outcomeText()).not.toBe(""));
}

/* ═══════════════════════════════════════════════════════════════ lifecycle ══ */

beforeEach(() => {
  resetSessionRestore();
});

afterEach(() => {
  // Manual: @testing-library/react registers auto-cleanup only when `afterEach`
  // is a global, and this project runs vitest without `globals: true`.
  cleanup();
  accessCalls.length = 0;
  accessOutcome.failure = null;
  accessOutcome.throws = null;
  // Only ever turned on by the two-saves tests, and off again here: a file-wide
  // fake clock would freeze `dcterms:modified` for every test above.
  vi.useRealTimers();
  vi.restoreAllMocks();
  /**
   * jsdom's localStorage is one object for the whole FILE, not one per test, and
   * from section 8 onward the editor reads it on mount whenever no storage is
   * injected. A draft left behind by one test would put an "Unsaved draft"
   * banner on the next one's first render — cross-test bleed through a browser
   * global, which is the sort of thing that makes one test fail only when the
   * whole file runs.
   */
  window.localStorage.clear();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 0. Controls. None of these test the editor. They test that this file is
 *    running the way it claims to, and they come first because every assertion
 *    below is worthless if one of them is wrong.
 * ════════════════════════════════════════════════════════════════════════ */

describe("controls for this file", () => {
  it("runs in jsdom, at the origin the revalidation handler is registered for", () => {
    expect(typeof document).toBe("object");
    expect(window.location.origin).toBe(new URL(REVALIDATE_URL).origin);
  });

  it("runs on the clock this file fixes, not the machine's", () => {
    // If the TZ assignment at the top stopped taking effect, the offset
    // assertions further down would silently start asserting the developer's
    // zone — and would pass in UTC against an implementation that hardcoded
    // "+00:00". This fails instead.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Tokyo");
    expect(new Date("2026-04-02T16:20:00").getTimezoneOffset()).toBe(-540);
  });

  it("the dynamic loader resolves the @/ alias, and rejects what is absent", async () => {
    const known = (await importModule("@/lib/pod/save-entry")) as { saveEntry?: unknown };
    expect(typeof known.saveEntry).toBe("function");
    await expect(importModule("@/components/studio/definitely-not-here")).rejects.toThrow();
  });

  it("the §7 fixtures were extracted, and are the ones this file thinks they are", () => {
    expect(ENTRY_TTL).toContain(SPEC_CREATED);
    expect(ENTRY_TTL).toContain(SPEC_OCCURRED);
    expect(INDEX_TTL).toContain("dy:entryCount");
  });

  it("the coordinate query would find a coordinate field if one existed", () => {
    // THE ALLOW-CASE for the safety pin below. A "no coordinate input" test
    // whose query matches nothing anywhere proves nothing at all, so the query
    // is proved against a control that certainly is one.
    const probe = document.createElement("div");
    probe.innerHTML = '<label for="p">Latitude</label><input id="p" />';
    document.body.append(probe);
    expect(screen.queryAllByLabelText(COORDINATE_FIELD)).toHaveLength(1);
    probe.remove();
    expect(screen.queryAllByLabelText(COORDINATE_FIELD)).toHaveLength(0);
  });
});

/** The family of names a coordinate input could plausibly carry. */
const COORDINATE_FIELD = /lat(itude)?|long(itude)?|\blng\b|coordinate|gps|geo\b|precision|position/i;

/* ══════════════════════════════════════════════════════════════════════════
 * 1. THE SAFETY PIN: no coordinates, at either end.
 * ════════════════════════════════════════════════════════════════════════ */

describe("entry editor — coordinates, which must not be here at all", () => {
  /**
   * §9: "The studio applies fuzzing before the write and discards the precise
   * original." Fuzzing is phase 3 and does not exist. A latitude field today
   * would put a true coordinate on a publicly readable resource, and §9 opens
   * by saying exactly why that cannot be fixed later: "anyone can fetch the raw
   * triple".
   *
   * THE ALLOW-CASE IS ASSERTED IN THE SAME TEST, and it is what stops this
   * being a rule that rejects nothing: the in-scope fields must be found by the
   * very same accessible query that finds no coordinate one.
   */
  it("exposes no coordinate input, while exposing the fields that are in scope", async () => {
    const fake = fakeStudioSession();
    const { container } = await renderEditor(fake.session);

    // Allow-case first.
    expect(screen.getAllByLabelText(LABEL.headline)).toHaveLength(1);
    expect(screen.getAllByLabelText(LABEL.articleBody)).toHaveLength(1);
    expect(screen.getAllByLabelText(LABEL.occurredAt)).toHaveLength(1);
    expect(screen.getAllByLabelText(LABEL.slug)).toHaveLength(1);
    expect(screen.getAllByLabelText(LABEL.tags)).toHaveLength(1);

    // The pin.
    expect(screen.queryAllByLabelText(COORDINATE_FIELD)).toEqual([]);
    expect(screen.queryAllByPlaceholderText(COORDINATE_FIELD)).toEqual([]);
    expect(screen.queryAllByText(COORDINATE_FIELD)).toEqual([]);

    // And nothing unlabelled sneaking through under a name attribute.
    const controls = [...container.querySelectorAll("input, textarea, select")];
    expect(controls.length).toBeGreaterThan(0);
    const suspicious = controls
      .map((c) => `${c.getAttribute("name") ?? ""} ${c.getAttribute("id") ?? ""}`)
      .filter((s) => COORDINATE_FIELD.test(s));
    expect(suspicious).toEqual([]);
  });

  /**
   * The same pin at the wire, which is where it actually matters: whatever the
   * form does, no coordinate predicate may reach the Pod on a create.
   *
   * Not vacuous — the entry PUT is asserted to have happened and to carry the
   * headline first, so an editor that saved nothing fails before it gets here.
   */
  it("writes no coordinate predicate on a create", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session);

    fillNewEntry();
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put).toBeDefined();
    const quads = quadsOf(put!.body, put!.url);
    const it_ = `${put!.url}#it`;
    expect(oneObject(quads, it_, SCHEMA.headline)?.value).toBe("Rain on the Philosopher's Path");

    for (const predicate of [SCHEMA.latitude, SCHEMA.longitude, GEO.lat, GEO.long, DY.precisionMeters]) {
      expect(quads.filter((q) => q.predicate.value === predicate)).toEqual([]);
    }
  });
});

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
    // The place, including its coordinates: they were stored fuzzed and must
    // survive an edit exactly as they are. This is the one place a coordinate
    // legitimately appears, and it appears because it was already on the Pod.
    expect(oneObject(quads, subject, SCHEMA.contentLocation)?.value).toBe(`${put.url}#place`);
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

const SCENARIOS = {
  /** recovery "none". */
  success: {} as PodScript,
  /** recovery "retry", completed []. Nothing was written. */
  entryRefused: { entryPut: 507 } as PodScript,
  /** recovery "refetch", completed []. A concurrent edit. */
  concurrent: { entryPut: 412 } as PodScript,
  /** recovery "rebuildIndex", completed ["entry"]. Published but unreadable. */
  aclUnverified: {} as PodScript,
  /** recovery "rebuildIndex", completed ["entry","access"]. Written, unlisted. */
  indexRefused: { indexPut: 500 } as PodScript,
  /** recovery "retry", completed ["entry","access","index"]. Pod fine, cache stale. */
  revalidateDown: { revalidate: { status: 502, body: { error: "bad gateway" } } } as PodScript,
};

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
      expect(pod.requests).toEqual([]);
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

    expect(pod.requests).toEqual([]);
    expect(outcomeText()).toMatch(/slug|address|file/i);
    expect(outcomeText()).toMatch(/headline|title/i);

    setText(LABEL.slug, "  2026-04-02-kyoto  ");
    setText(LABEL.headline, "  Rain on the Philosopher's Path  ");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put).toBeDefined();
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
 *     components/studio/entry-editor.tsx). @testing-library matches
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

/**
 * The key scheme, `wig.draft.v1.<webId>.<scope>`.
 *
 * Three parts, three failures they prevent: the VERSION so a future shape can
 * be given v2 instead of half-restoring a payload it cannot use; the WEBID so
 * one machine with two accounts does not hand the second person the first
 * person's unfinished text; the SCOPE so the entry being created and the entry
 * being edited are different drafts.
 */
const draftKeyFor = (webId: string, scope: string) => `wig.draft.v1.${webId}.${scope}`;

/** The scope of a create — there is no resource yet to name. */
const NEW_SCOPE = "new";

/** A second person signing in on the same browser. */
const SOMEONE_ELSE = "https://borrowed-laptop.example/profile/card#me";

/** Exactly the nine fields, sorted. A tenth is how the ETag gets in. */
const DRAFT_FIELDS = [
  "headline",
  "mode",
  "occurred",
  "savedAt",
  "slug",
  "status",
  "story",
  "tagsText",
  "tripIri",
];

/** What the editor must have persisted, as it comes back out of JSON. */
type StoredDraft = {
  tripIri: string;
  slug: string;
  headline: string;
  story: string;
  occurred: string;
  tagsText: string;
  mode: string;
  status: string;
  savedAt: string;
};

const seededDraft = (over: Partial<StoredDraft> = {}): StoredDraft => ({
  tripIri: JAPAN.iri,
  slug: "2026-04-02-kyoto",
  headline: "Rain on the Philosopher's Path",
  story: "Two hours of drizzle and nobody else on the path.",
  occurred: "2026-04-02T16:20",
  tagsText: "walking, rain",
  mode: "Train",
  status: "published",
  savedAt: "2026-04-02T19:00:00+09:00",
  ...over,
});

/** A storage whose contents are inspectable and whose failures are scripted. */
function fakeStorage(initial: Record<string, string> = {}) {
  const items = new Map<string, string>(Object.entries(initial));
  const calls = {
    get: [] as string[],
    set: [] as { key: string; value: string }[],
    remove: [] as string[],
  };
  const fail: { get: Error | null; set: Error | null; remove: Error | null } = {
    get: null,
    set: null,
    remove: null,
  };

  const storage: StorageLike = {
    getItem(key) {
      calls.get.push(key);
      if (fail.get !== null) throw fail.get;
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      calls.set.push({ key, value });
      if (fail.set !== null) throw fail.set;
      items.set(key, value);
    },
    removeItem(key) {
      calls.remove.push(key);
      if (fail.remove !== null) throw fail.remove;
      items.delete(key);
    },
  };

  return { storage, items, calls, fail };
}

/** Safari private mode, on the very first setItem: it reports a zero quota
 *  rather than refusing storage outright, so the failure arrives at write time
 *  and not at feature-detection time. */
const QUOTA = new DOMException("The quota has been exceeded.", "QuotaExceededError");

/**
 * THE DEBOUNCE THIS FILE DRIVES. Pinned against the editor's own export in the
 * first test below, so the two cannot drift apart silently — an implementer who
 * changes the interval changes both, deliberately.
 */
const DEBOUNCE = 800;

/**
 * `setTimeout` IS FAKED HERE, WHICH THE REST OF THIS FILE DELIBERATELY AVOIDS.
 *
 * Section 7b fakes `Date` alone so that `waitFor`, React's scheduler and MSW
 * stay real. A debounce cannot be tested that way: waiting 800 real milliseconds
 * per assertion is slow, and — worse — "not yet written" would be a race rather
 * than a fact. So these tests fake the timer functions too, and pay for it by
 * using neither `waitFor` nor the network: every interaction below is
 * `fireEvent` (synchronous) followed by `act(() => vi.advanceTimersByTime(…))`,
 * and the two that do reach the Pod (the save-clears-the-draft tests) run on
 * real timers.
 *
 * `queueMicrotask` and `MessageChannel` are NOT faked, so React 19's scheduling
 * and every `await` in this file are untouched.
 */
const TIMERS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const;

/** The module is imported while timers are still real, so nothing in vitest's
 *  loader can be waiting on a clock that has stopped. */
async function withFakeTimers(at: Date) {
  await loadEditor();
  vi.useFakeTimers({ toFake: [...TIMERS] });
  vi.setSystemTime(at);
}

const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Two instants seven and a half minutes apart, in UTC. Asia/Tokyo is fixed at
 *  the top of this file, so the +09:00 spellings below fail on a bare `Z`. */
const FIRST = new Date("2026-04-02T10:00:00.000Z");
const SECOND = new Date("2026-04-02T10:07:31.000Z");
const FIRST_STAMP = "2026-04-02T19:00:00+09:00";
const SECOND_STAMP = "2026-04-02T19:07:31+09:00";

const parseDraft = (value: string) => JSON.parse(value) as Record<string, unknown>;

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
   *   in `settleDraft`, components/studio/entry-editor.tsx, delete
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
 * TYPING THE WAY A BROWSER WOULD, WHICH `fireEvent` DOES NOT MODEL.
 *
 * MEASURED IN THIS EXACT STACK (jsdom 30.0.1 + @testing-library/react 16.3.3),
 * with a throwaway probe, because the whole of 8e turns on it:
 *
 *   an <input> inside a `<fieldset disabled>`   `fireEvent.change` STILL sets
 *   an <input disabled> itself                  the value and STILL reaches
 *                                               React's onChange
 *   a <button> inside a `<fieldset disabled>`   `fireEvent.click` STILL calls
 *                                               onClick
 *   `el.disabled` (the IDL property)            FALSE inside a disabled
 *                                               fieldset — it reflects the
 *                                               content attribute only
 *   `el.matches(":disabled")`                   TRUE, on input, textarea,
 *                                               select and button alike
 *   jest-dom's `toBeDisabled()`                 TRUE — it walks up to the
 *                                               fieldset, which `.disabled`
 *                                               does not
 *
 * So a test that drove a held form with bare `fireEvent` would report that the
 * hold does not work, against an implementation in which it works perfectly. A
 * browser delivers no event at all from a disabled control; this helper is that
 * rule, and nothing more.
 *
 * It RETURNS whether the keystroke was delivered so the test can say so out
 * loud. A helper that silently does nothing is the vacuous pass in miniature —
 * every "nothing was stored" assertion after it would hold for an editor with
 * no autosave at all. Every use below is paired with the same helper against an
 * unlocked control, where it must return `true` and the write must appear.
 */
function typeAsUser(label: RegExp, value: string): boolean {
  const el = screen.getByLabelText(label);
  if (el.matches(":disabled")) return false;
  fireEvent.change(el, { target: { value } });
  return true;
}

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
    expect(pod.requests, "the held Save button reached the Pod at all").toEqual([]);
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
 * typing. That is routine rather than exotic: `components/studio/studio-shell.tsx`
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
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. What only the source can show.
 *
 * Same justification as section 5 of test/studio-shell.test.tsx and the
 * "use cache" checks in test/cached-owner-profile.test.ts: `"use client"` is a
 * compiler directive and an inert string expression under vitest, an import
 * never exercised on a tested path leaves no runtime trace, and a TYPE has no
 * runtime trace at all.
 * ════════════════════════════════════════════════════════════════════════ */

describe("as source", () => {
  const EDITOR = "components/studio/entry-editor.tsx";
  const SESSION = "lib/studio/session.ts";

  function read(path: string): string {
    try {
      return readFileSync(path, "utf8");
    } catch (cause) {
      throw new Error(
        `${path} does not exist yet — this is the red step of the TDD loop, not a broken test.`,
        { cause },
      );
    }
  }

  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  const specifiers = (text: string) =>
    [...text.matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g)].map(
      (m) => m[1] ?? m[2],
    );

  const typeOnlySpecifiers = (text: string) =>
    [...text.matchAll(/\bimport\s+type\b[\s\S]*?\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);

  it("the scanners discriminate, so the bans below cannot pass on an empty set", () => {
    const sample = `import type { A } from "erased";\nimport { B } from "kept";\n`;
    expect(typeOnlySpecifiers(sample)).toEqual(["erased"]);
    expect(specifiers(sample)).toEqual(["erased", "kept"]);
    expect(stripComments("/* x */ const a = 1; // y\n")).not.toContain("x");
    expect(stripComments("/* x */ const a = 1; // y\n")).toContain("const a = 1");
    // And the file it is about to scan really is on disk and really has imports.
    expect(specifiers(stripComments(read(SESSION)))).toContain(
      "@inrupt/solid-client-authn-browser",
    );
  });

  it('the editor carries "use client" before any import', () => {
    const text = stripComments(read(EDITOR));
    const directive = text.search(/["']use client["']/);
    const firstImport = text.search(/^\s*import\b/m);
    expect(directive).toBeGreaterThanOrEqual(0);
    expect(firstImport).toBeGreaterThanOrEqual(0);
    expect(directive).toBeLessThan(firstImport);
  });

  it("the editor reads no config and no environment variable", () => {
    // OWNER_WEBID, SITE_URL, SITE_NAME and POD_ROOT are not NEXT_PUBLIC_ and
    // lib/config.ts throws the moment it is reached in a browser. Everything
    // the editor needs arrives as a prop or on the session — the same rule the
    // shell is held to.
    const text = stripComments(read(EDITOR));
    expect(specifiers(text).filter((s) => s.includes("lib/config"))).toEqual([]);
    expect(text).not.toMatch(/\bprocess\s*\.\s*env\b/);
  });

  it("the editor imports no VALUE from the Solid auth library", () => {
    // The session is injected, as it is into the shell. A value import here
    // would put the library outside the `ssr: false` boundary that
    // components/studio/studio-client.tsx draws.
    const text = stripComments(read(EDITOR));
    const erased = new Set(typeOnlySpecifiers(text));
    const values = specifiers(text).filter((s) => !erased.has(s));
    expect(values.filter((s) => s.startsWith("@inrupt/solid-client-authn-browser"))).toEqual([]);
  });

  /**
   * `StudioSessionLike` MUST GROW `fetch`, DERIVED FROM `Session["fetch"]`.
   *
   * It models `login`, `logout` and `events` today and not `fetch`, so the
   * editor has nothing typed to hand `saveEntry` — and `saveEntry`'s own
   * docblock forbids the fallback: "Never defaulted to the ambient one: that is
   * a silent downgrade to anonymous."
   *
   * Asserted on the source because a type leaves no runtime trace, and asserted
   * as DERIVED rather than merely present for the reason lib/studio/session.ts
   * argues at length about its other three members: "hand-writing
   * login(options: {...}) would compile happily against a library that had
   * renamed one of them." A hand-typed `fetch: (input, init) => Promise<Response>`
   * would compile against a library that changed the signature, and the failure
   * would be a 401 at runtime.
   */
  it("StudioSessionLike models fetch, derived from Session[\"fetch\"]", () => {
    const text = stripComments(read(SESSION));
    const iface = text.slice(text.indexOf("interface StudioSessionLike"));
    const body = iface.slice(iface.indexOf("{"), iface.indexOf("}") + 1);

    expect(body, "StudioSessionLike does not mention fetch").toMatch(/\bfetch\b/);
    expect(body, "fetch is retyped by hand rather than derived from Session").toMatch(
      /fetch\s*:\s*Session\[["']fetch["']\]/,
    );
    // The control: the three members it already derives are found by the same
    // scan, so a regex that had stopped matching would fail here first.
    expect(body).toMatch(/login\s*:\s*Session\[["']login["']\]/);
    expect(body).toMatch(/logout\s*:\s*Session\[["']logout["']\]/);
  });
});

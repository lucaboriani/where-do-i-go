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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  props: { trips?: EditorTrip[]; initial?: { entry: Entry; etag: string | null } } = {},
) {
  const Editor = await loadEditor();
  return render(
    <StrictMode>
      <Editor session={session} trips={props.trips ?? TRIPS} initial={props.initial} />
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
   */
  it("says six different things for the six outcomes §10 distinguishes", async () => {
    const said: Record<string, string> = {};
    for (const [name, script] of Object.entries(SCENARIOS)) {
      said[name] = await saveUnder(script, name === "aclUnverified");
      cleanup();
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
 * 8. What only the source can show.
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

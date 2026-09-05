// @vitest-environment jsdom
/**
 * THE LAST WIRING STEP: the studio shell asking the Pod which trips it may
 * write into.
 *
 * `lib/studio/trips.ts` exports `listStudioTrips({ fetch, podRoot })` and is
 * fully tested (test/studio-trips.test.ts, 37 cases).
 * `components/studio/studio-shell.tsx` renders an editor when it is handed a
 * non-empty `trips` prop and an honest "no trips" note when it is not
 * (test/studio-shell.test.tsx). NOTHING CONNECTS THE TWO, so the running studio
 * shows the note on every Pod, however many trips are in it. This file is the
 * red step that closes that.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SECOND FILE RATHER THAN MORE OF test/studio-shell.test.tsx.
 *
 * That file's fake session carries a `fetch` that THROWS — "the shell must not
 * fetch: nothing here goes to the Pod" — and twenty passing tests stand on it.
 * Widening it would put the listing on paths that are testing something else.
 * The same reasoning that file gives for writing a third fake session rather
 * than widening the two in test/session.test.ts applies one level up, so:
 *
 *   test/studio-shell.test.tsx    the shell's rendering, GIVEN its trips.
 *   this file                     where the trips come from.
 *
 * The seam between them is the `trips` prop, whose semantics this file pins so
 * that neither file is testing an assumption the other contradicts: SUPPLIED
 * MEANS SUPPLIED — the shell offers exactly those and enumerates nothing —
 * ABSENT means the shell asks the Pod. That is what keeps every existing case
 * over there honest once the shell can fetch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTHING IS MOCKED, AND lib/studio/trips IS NOT STUBBED.
 *
 * The Pod is faked at the HTTP layer with MSW, which is the seam CLAUDE.md's
 * Testing section names, and the module under test is reached through the
 * `fetch` on the injected session. `vi.mock("@/lib/studio/trips")` would have
 * tested this file's idea of a trip listing; every assertion below is instead a
 * statement about what the shell put on screen after a real Turtle round trip
 * through the real `listStudioTrips`, `listContainer` and `readTrip`.
 *
 * THE FLIP, inherited from test/studio-trips.test.ts and load-bearing here too:
 * the trips container and the draft trip are OWNER-ONLY on this fake Pod, and
 * 403 to anyone else. That is what §4's verified WAC fix leaves behind, and it
 * means a shell that reached for the ambient `fetch` instead of the session's
 * fails the listing tests outright rather than one header assertion.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STATES THIS PINS, all of them ones that get forgotten:
 *
 *   1. It lists for the OWNER ONLY. A `not-owner` or `signed-out` visitor must
 *      trigger no enumeration at all — an authenticated listing fired for
 *      someone who is not the owner is a request that will 403, and firing it
 *      says the shell asked a question it had no business asking.
 *   2. LOADING IS A STATE. Between "owner" and "trips arrived" the note must
 *      not appear: it means "your Pod has no trips", and that is false while
 *      the request is in flight. Same class as `restoring` never being a
 *      resolved value, which lib/studio/session.ts already takes seriously.
 *   3. A FAILED ENUMERATION IS NOT AN EMPTY POD. `listStudioTrips` keeps them
 *      apart deliberately; the shell must not flatten them back together.
 *   4. SKIPPED TRIPS ARE SURFACED. A trip the studio could not read is one the
 *      owner cannot write into, and silence there is the owner wondering where
 *      their trip went.
 *   5. IT LISTS ONCE. StrictMode invokes effects twice, and a listing keyed on
 *      a value that is recreated every render re-enters on its own result.
 *   6. UNMOUNT MID-FLIGHT IS SILENT.
 *   7. THE STATUS IS VISIBLE IN THE PICKER, in text. `listStudioTrips` carries
 *      `dy:status` per trip precisely so that a published entry cannot be
 *      written into a draft trip unawares.
 */

import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { StrictMode } from "react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { EVENTS } from "@inrupt/solid-client-authn-browser";
import { server } from "./msw";
import { NS } from "@/lib/vocab";
import { describe as describePodError } from "@/lib/pod/result";
import { resetSessionRestore } from "@/lib/studio/session";
/**
 * A STATIC import, unlike the deferred one in test/studio-shell.test.tsx. That
 * trick exists so a MISSING module does not kill the file; this module exists,
 * and every failure below is meant to be a missing BEHAVIOUR. The one
 * compile-time failure that comes with it is deliberate: `podRoot` does not
 * exist on `StudioShellProps` yet, so `tsc --noEmit` reporting it at each call
 * site IS the red state for the prop half of this step. vitest does not
 * typecheck, so the runtime cases still run and still fail on behaviour.
 */
import StudioShell from "@/components/studio/studio-shell";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ==========================================================================
 * 0. The environment this file declares.
 *
 * First, because every assertion below is worthless if this file were
 * collected into the node default: `render` would fail with "document is not
 * defined" and the reason would look like a broken component.
 * ======================================================================== */

describe("the test environment this file declares", () => {
  it("is jsdom, and the jest-dom matchers discriminate", () => {
    expect(window.navigator.userAgent).toMatch(/jsdom/i);
    const attached = document.createElement("div");
    document.body.append(attached);
    // Positive AND negative: the positive alone passes against a matcher shim
    // that returns { pass: true } unconditionally.
    expect(attached).toBeInTheDocument();
    expect(document.createElement("div")).not.toBeInTheDocument();
    attached.remove();
  });
});

/* ==========================================================================
 * 1. Fixtures — the §7.2 trip, read out of docs/data-model.md at runtime.
 *
 * Those blocks are normative (§11: "the Turtle examples are the specification,
 * not illustrations"), so a hand-copied trip would test a copy of the spec.
 * Same extraction and the same block index as test/studio-trips.test.ts.
 * ======================================================================== */

const blocks = [
  ...readFileSync("docs/data-model.md", "utf8").matchAll(/```turtle\n([\s\S]*?)```/g),
].map((m) => m[1]);
const TRIP_FIXTURE = blocks[1];

const OWNER = "https://alice.example/profile/card#me";
const VISITOR = "https://bob.example/profile/card#me";
const ISSUER = "https://login.example";
const SITE = "https://diary.example";
const SITE_NAME = "Luca's travel diary";

/**
 * The two event names, tied to the library's own literals by their annotations,
 * exactly as test/studio-shell.test.tsx does it. `typeof EVENTS.SESSION_EXPIRED`
 * is the string literal type "sessionExpired", so an upgrade that renames the
 * constant fails to COMPILE here rather than leaving this file emitting an
 * event nothing listens for. `import type` is erased: no library code loads.
 */
const SESSION_EXPIRED: typeof EVENTS.SESSION_EXPIRED = "sessionExpired";
const LOGOUT: typeof EVENTS.LOGOUT = "logout";

/**
 * The Pod, and it is NOT the identity host above. Both are under `.test` /
 * `.example`, which RFC 6761 and RFC 2606 reserve: a fixture host that can
 * resolve is a fixture host that can answer, and test/setup.ts lets loopback
 * through on purpose for the integration tests.
 */
const POD = "https://pod.test.example/";
const TRIPS = `${POD}travel/trips/`;
const DIARY_URL = `${POD}travel/diary.ttl`;
const JAPAN = `${TRIPS}2026-japan/`;
const PATAGONIA = `${TRIPS}2025-patagonia/`;
const BROKEN = `${TRIPS}2027-future/`;
const tripDoc = (container: string) => `${container}trip.ttl`;

/** A DIFFERENT Pod, used only as a decoy in the config test: nothing serves it,
 *  so a request to it is an unhandled request and test/setup.ts fails the test
 *  for it whether or not the assertion catches it first. */
const DECOY_POD = "https://decoy.test.example/";

/** The credential the session's fetch carries. Its value is arbitrary; what
 *  matters is that the ambient fetch does not have it. */
const OWNER_CREDENTIAL = "DPoP owner-token";

/**
 * String-replace a fixture, and FAIL IF THE ANCHOR DID NOT MATCH.
 *
 * The same guard as test/studio-trips.test.ts and test/write-primitives.test.ts,
 * copied rather than shared so those files keep their own fixtures. A negative
 * test built by `fixture.replace(anchor, bad)` passes against the UNMODIFIED
 * fixture the moment the anchor drifts, reporting green while asserting that
 * valid data is valid. This project has been bitten by exactly that.
 */
function mutate(source: string, from: string, to: string): string {
  if (!source.includes(from)) {
    throw new Error(`fixture anchor did not match, so nothing was changed: ${from}`);
  }
  return source.replaceAll(from, to);
}

/** The §7.2 trip, re-slugged and renamed, optionally demoted to a draft. */
function tripFixture(slug: string, name: string, opts: { draft?: boolean } = {}): string {
  let t = mutate(TRIP_FIXTURE, '"2026-japan"', `"${slug}"`);
  t = mutate(t, '"Japan, spring"', `"${name}"`);
  if (opts.draft) t = mutate(t, "dy:Published", "dy:Draft");
  return t;
}

const JAPAN_TTL = tripFixture("2026-japan", "Japan, spring");
const PATAGONIA_TTL = tripFixture("2025-patagonia", "Patagonia, unfinished", { draft: true });

/**
 * The §7.1 diary with the draft trip taken out of it, as in
 * test/studio-trips.test.ts and for the same reason: this is what the PUBLIC
 * trip list looks like, and serving it means a shell that read the diary
 * instead of enumerating would return one trip and no errors — successful, and
 * wrong in exactly the way §4 forbids. The draft assertion is what fails it.
 *
 * The `mutate` call with an identical replacement is an ANCHOR CHECK: it throws
 * if the IRI ever changes, so the cut below cannot silently become a no-op and
 * serve the full diary.
 */
const DIARY_WITHOUT_THE_DRAFT = mutate(
  blocks[0],
  "<trips/2025-patagonia/trip.ttl#it>",
  "<trips/2025-patagonia/trip.ttl#it>",
).replace(/\s*,\s*<trips\/2025-patagonia\/trip\.ttl#it>/, "");

/** An LDP container listing with RELATIVE member IRIs — phase 0: "container
 *  listings use relative IRIs", which is why every expectation is absolute. */
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

/** `<>` resolves to the container itself and ends in "/" exactly as a trip
 *  does; `notes.ttl` is the mirror-image trap. Both are in every listing so a
 *  member filter cannot be wrong in either direction unnoticed. */
const NOISE = ["", "notes.ttl", "README.md", ".acl", "cover.jpg"] as const;

type Served = string | number;
type Recorded = { url: string; authenticated: boolean };

/**
 * A Pod over MSW that discriminates on the credential the way a real one does.
 * Scoped to this one origin — no catch-all, so a request anywhere else still
 * hits test/setup.ts's network guard and fails the test.
 */
function fakePod(spec: {
  /** Readable by anyone. */
  open?: Record<string, Served>;
  /** Readable only with the owner's credential; 403 without it, which is what
   *  §4's WAC fix leaves on the container and a draft's ACL on the resource. */
  ownerOnly?: Record<string, Served>;
  /** Runs inside every GET, before it answers. Used to hold a response open. */
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
      // Recorded BEFORE onGet, so a gated response is observable as in flight.
      requests.push({ url: request.url, authenticated });
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

/**
 * The scenario most cases run against: one published trip, one DRAFT trip that
 * `diary.ttl` does not name, and a container full of things that are not trips.
 *
 * `diary.ttl` is served, and served WITHOUT the draft, on purpose — an
 * implementation that reached for the public diary would look successful and be
 * wrong in exactly the way §4 forbids. The draft assertions are what fail it.
 */
function studioPod(extra: { onGet?: (url: string) => Promise<void> | void } = {}) {
  return fakePod({
    open: { [DIARY_URL]: DIARY_WITHOUT_THE_DRAFT, [tripDoc(JAPAN)]: JAPAN_TTL },
    ownerOnly: {
      [TRIPS]: containerTurtle([...NOISE, "2026-japan/", "2025-patagonia/"]),
      [tripDoc(PATAGONIA)]: PATAGONIA_TTL,
    },
    onGet: extra.onGet,
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type FakeInfo = { isLoggedIn: boolean; webId?: string };

/**
 * A fake Solid session whose `fetch` WORKS.
 *
 * That is the whole difference from the fake in test/studio-shell.test.tsx, and
 * it is why this file exists: the credential is added here and nowhere else, so
 * "the shell used the session's fetch" and "the shell used the ambient one" are
 * two different HTTP conversations rather than two readings of a spy.
 *
 * `events` is a real node EventEmitter, not `{ on, off }`: measured with tsc in
 * test/session.test.ts, `ISessionEventListener` extends EventEmitter and its
 * methods return `this`, so a hand-rolled stand-in is rejected. The
 * `StudioSessionLike` annotation below is what enforces that here.
 */
function fakeStudioSession(initial: FakeInfo = { isLoggedIn: false }) {
  const events = new EventEmitter();
  const info: FakeInfo = { isLoggedIn: false };
  const restores: unknown[] = [];

  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", OWNER_CREDENTIAL);
    return globalThis.fetch(input, { ...init, headers });
  });

  const session = {
    info,
    events,
    fetch: fetch as unknown as typeof globalThis.fetch,
    async handleIncomingRedirect(options?: unknown): Promise<unknown> {
      restores.push(options);
      Object.assign(info, initial);
      return info;
    },
    async login(): Promise<void> {},
    async logout(): Promise<void> {
      info.isLoggedIn = false;
      events.emit(LOGOUT);
    },
  };
  // Compile-time check that a plain object is still enough — i.e. that the
  // shell's session prop stayed injectable.
  const asSessionLike: StudioSessionLike = session;
  return { session: asSessionLike, info, events, restores, fetch };
}

/**
 * Always under StrictMode. Not extra rigour: the App Router runs the studio
 * under StrictMode in development, effects are invoked twice there, and phase 0
 * found the session restore returning a different answer on each invocation
 * (docs/phase-0-spike.md, question 2). A shell tested outside StrictMode is
 * tested in a mode it never runs in.
 *
 * `trips` is deliberately NOT passed by default. That is the production shape —
 * the shell is mounted with `ssr: false`, so nothing upstream of it holds an
 * authenticated fetch and no server component can resolve the list.
 */
/**
 * Derived from the component's OWN signature rather than declared here, the
 * same device test/studio-shell.test.tsx uses for its trip fixture: a
 * hand-written local type would compile forever against a component whose props
 * had changed, and this file would go on testing its own idea of them.
 */
type ShellProps = ComponentProps<typeof StudioShell>;

function renderShell(
  session: StudioSessionLike,
  props: { ownerWebId?: string; podRoot?: string; trips?: ShellProps["trips"] } = {},
) {
  return render(
    <StrictMode>
      <StudioShell
        session={session}
        ownerWebId={props.ownerWebId ?? OWNER}
        oidcIssuer={ISSUER}
        siteUrl={SITE}
        siteName={SITE_NAME}
        podRoot={props.podRoot ?? POD}
        trips={props.trips}
      />
    </StrictMode>,
  );
}

/* --------------------------------------------------------------------------
 * The rendered contract, in accessible queries.
 *
 * queryAllBy*, not queryBy*, so an absence assertion can never fail for the
 * wrong reason — queryBy throws on multiple matches, which would read as the
 * rule being violated when it is the markup being nested.
 * ------------------------------------------------------------------------ */
const signInControl = () => screen.queryAllByRole("button", { name: /sign in/i });
const signOutControl = () => screen.queryAllByRole("button", { name: /sign out/i });
const courtesyMessage = () => screen.queryAllByText(/belongs to/i);
const editorHeadlineField = () => screen.queryAllByLabelText(/headline|title/i);
const editorSaveControl = () => screen.queryAllByRole("button", { name: /save/i });

/**
 * THE EMPTY-STATE NOTE, by its contract phrase — the same device
 * test/studio-shell.test.tsx uses for the not-owner message's "belongs to".
 *
 * It is the single most important query in this file, because three separate
 * cases turn on it being ABSENT (loading, a 403, a 404) and one on it being
 * PRESENT. That last one is what stops the other three passing against a shell
 * that stopped rendering the note at all.
 */
const emptyNote = () => screen.queryAllByText(/no trips/i);

/** The trip picker itself, so that the editor's own Status <select> — whose
 *  options are literally "Draft" and "Published" — cannot be mistaken for a
 *  labelled trip. Exact label match: the editor also has "Travel mode you
 *  arrived by" and "Status". */
const tripPicker = () => screen.getByLabelText("Trip");
const tripOptions = () =>
  within(tripPicker())
    .getAllByRole("option")
    .map((o) => o.textContent ?? "");

beforeEach(() => {
  // The restore memo is MODULE-level and outlives a test file. Without this the
  // first case to run decides the answer every later one gets, and the file
  // passes or fails on case order.
  resetSessionRestore();
});

afterEach(() => {
  // Manual, not automatic: @testing-library/react registers its auto-cleanup
  // only when `afterEach` is a global, and this project runs vitest without
  // `globals: true`.
  cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Let anything already queued settle, including a listing that should not have
 *  been started. A negative assertion made too early passes on timing. */
async function settle(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/* ==========================================================================
 * 2. The fixtures and the fake Pod are what this file thinks they are.
 *
 * Three controls. Each of them would, if wrong, turn an assertion below into a
 * green statement about nothing.
 * ======================================================================== */

describe("the fixtures this file stands on", () => {
  it("really are mutated — the draft differs from the published trip", () => {
    // `mutate` throws on a missed anchor, so these cannot silently be the same
    // fixture. Asserted anyway, because the picker test rests on them differing
    // in dy:status and nothing else would notice if they stopped.
    expect(PATAGONIA_TTL).not.toEqual(JAPAN_TTL);
    expect(JAPAN_TTL).toContain("dy:Published");
    expect(JAPAN_TTL).not.toContain("dy:Draft");
    expect(PATAGONIA_TTL).toContain("dy:Draft");
    expect(PATAGONIA_TTL).not.toContain("dy:Published");
    expect(JAPAN_TTL).toContain("Japan, spring");
    expect(PATAGONIA_TTL).toContain("Patagonia, unfinished");
  });

  it("serve a diary that names the published trip and NOT the draft", () => {
    // Without this control the §4 assertion below distinguishes nothing: a
    // diary-reading shell would find both trips and look correct.
    expect(blocks[0]).toContain("2025-patagonia");
    expect(DIARY_WITHOUT_THE_DRAFT).toContain("2026-japan");
    expect(DIARY_WITHOUT_THE_DRAFT).not.toContain("2025-patagonia");
    expect(DIARY_WITHOUT_THE_DRAFT.match(/trip\.ttl#it/g)).toHaveLength(1);
  });

  /**
   * THE FLIP, proved rather than assumed.
   *
   * Everything this file asserts about the credential rests on the fake Pod
   * really answering differently without it. If `ownerOnly` were served to
   * anyone, a shell using `globalThis.fetch` would pass every case below and
   * ship a studio that lists published trips only.
   */
  it("control: without the credential this Pod refuses the listing", async () => {
    studioPod();

    const anonymous = await globalThis.fetch(TRIPS, { headers: { accept: "text/turtle" } });
    expect(anonymous.status).toBe(403);
    // BODY AS WELL AS STATUS. A zero-byte 404 shipped here once because only
    // the status was checked.
    expect(await anonymous.text()).toContain("Forbidden");

    const authenticated = await globalThis.fetch(TRIPS, {
      headers: { accept: "text/turtle", authorization: OWNER_CREDENTIAL },
    });
    expect(authenticated.status).toBe(200);
    expect(await authenticated.text()).toContain("2025-patagonia");

    // And the published trip is open, so the discrimination is on the
    // credential and not on the fake Pod refusing everything.
    const open = await globalThis.fetch(tripDoc(JAPAN));
    expect(open.status).toBe(200);
    expect(await open.text()).toContain("Japan, spring");
  });
});

/* ==========================================================================
 * 3. The headline: the owner's trips reach the picker.
 * ======================================================================== */

describe("studio shell — listing the owner's trips", () => {
  /**
   * THE ONE THAT SAYS THE WIRE IS CONNECTED. No `trips` prop, a real Turtle
   * round trip through the real `listStudioTrips`, and the owner ends up with
   * an editor pointed at their own Pod.
   */
  it("enumerates the trips container and offers what it found", async () => {
    const pod = studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);

    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    expect(editorSaveControl()).toHaveLength(1);
    // Offered BY NAME: the owner picks a trip, not an IRI.
    expect(tripOptions().join("\n")).toContain("Japan, spring");
    // And the honest-but-now-false note is gone.
    expect(emptyNote()).toHaveLength(0);

    // It asked the container, once, as Turtle, with the credential.
    expect(pod.got(TRIPS)).toHaveLength(1);
    expect(pod.got(TRIPS)[0].authenticated).toBe(true);
  });

  /**
   * §4's split, one level up, and the reason `lib/studio/trips.ts` exists at
   * all: `travel/diary.ttl` is the PUBLIC trip list, so a studio built on it
   * lists published trips only and the owner can never add an entry to a draft
   * trip — which is most of what a draft trip is for.
   *
   * This Pod serves a diary that parses fine and names the published trip, so a
   * diary-reading shell looks successful. The draft is what fails it.
   */
  it("offers a DRAFT trip, which the public diary does not name", async () => {
    const pod = studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);

    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    const options = tripOptions().join("\n");
    expect(options).toContain("Patagonia, unfinished");
    expect(options).toContain("Japan, spring");
    // Asserted separately from the contents, because a shell could read BOTH
    // and merge — passing everything above while making the studio depend on a
    // resource §4 says it does not consult.
    expect(pod.got(DIARY_URL)).toHaveLength(0);
  });

  /**
   * THE STATUS, IN TEXT AND NOT IN A COLOUR.
   *
   * `listStudioTrips` carries `dy:status` per trip for one reason, stated in
   * its own docblock: "a picker that shows a draft trip and a published trip
   * identically invites the one mistake that cannot be undone from the editor:
   * writing a PUBLISHED entry into a DRAFT trip yields a public entry whose
   * trip is not public."
   *
   * The WORDING is the implementer's choice — "Patagonia, unfinished (draft)"
   * and a separate "draft" column both satisfy this. What is pinned is that
   * exactly one option in the TRIP picker says so, that it is the draft one,
   * and that the published one does not. Scoped with `within` because the
   * editor's own Status <select> has options literally called "Draft" and
   * "Published", and an unscoped query would pass on those alone.
   */
  it("marks the draft trip as a draft, in the picker, in text", async () => {
    studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);

    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));

    const options = tripOptions();
    // Non-vacuous: both trips are on the list before anything is said about how
    // they are labelled.
    expect(options.filter((o) => o.includes("Patagonia, unfinished"))).toHaveLength(1);
    expect(options.filter((o) => o.includes("Japan, spring"))).toHaveLength(1);

    const marked = options.filter((o) => /draft/i.test(o));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain("Patagonia, unfinished");
    // The other side of the same coin: labelling everything "draft" is not a
    // distinction.
    expect(options.filter((o) => o.includes("Japan, spring"))[0]).not.toMatch(/draft/i);
  });

  /**
   * IT LISTS ONCE.
   *
   * Two failure modes, and this catches both. StrictMode invokes every effect
   * twice — lib/studio/session.ts carries a synchronous memo for exactly that
   * reason, and its comments record the phase-0 finding behind it. And a
   * listing keyed on a value recreated each render (`studioState()` returns a
   * fresh object every time) re-enters on its own result, which is not a
   * doubled request but an unbounded one.
   *
   * `settle()` after the editor appears is what makes the second half real: the
   * re-entrant version only shows up on the render that the first result
   * caused.
   */
  it("lists once, not once per render, and reads each trip once", async () => {
    const pod = studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);
    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    await settle();

    expect(pod.got(TRIPS)).toHaveLength(1);
    expect(pod.got(tripDoc(JAPAN))).toHaveLength(1);
    expect(pod.got(tripDoc(PATAGONIA))).toHaveLength(1);
    // Exactly three requests in total: the container and the two trips. Neither
        // `entries.ttl` nor `entries/` is anyone's business until save time.
    expect(pod.requests).toHaveLength(3);
    expect(pod.urls().filter((u) => u.includes("entries"))).toEqual([]);
  });

  /**
   * The credential, asserted from both ends. `listStudioTrips` refuses to
   * default the fetch, so the only way for the ambient one to be used is for
   * the shell to hand it over — and on a Pod whose trips container happens to
   * be publicly readable that silently returns a list with every draft missing,
   * which looks exactly like success.
   */
  it("enumerates with the session's fetch and never the ambient one", async () => {
    const pod = studioPod();
    const ambient = vi.spyOn(globalThis, "fetch");
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);
    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));

    // Not vacuous: there were requests to check.
    expect(pod.requests.length).toBeGreaterThan(1);
    for (const request of pod.requests) expect(request.authenticated).toBe(true);
    // The counts match, so nothing slipped out alongside the injected fetch.
    // The session's own fetch calls through to globalThis.fetch, so the ambient
    // spy sees each request exactly once and no more.
    expect(fake.fetch).toHaveBeenCalledTimes(pod.requests.length);
    expect(ambient).toHaveBeenCalledTimes(pod.requests.length);
  });

  /**
   * THE POD ROOT IS A PROP, NOT CONFIG. POD_ROOT is not `NEXT_PUBLIC_`, so
   * lib/config.ts's `required()` throws the moment it is reached in a browser,
   * and this component runs in the browser.
   *
   * The decoy is what makes this precise rather than a repetition of the
   * source scan in test/studio-shell.test.tsx: `process.env.POD_ROOT` is set,
   * and set to something else, so a shell that read it would enumerate a
   * DIFFERENT host. Nothing serves that host, so test/setup.ts's guard fails
   * the test even if the assertion below somehow did not.
   */
  it("enumerates the podRoot it was handed, not the one in the environment", async () => {
    vi.stubEnv("POD_ROOT", DECOY_POD);
    vi.stubEnv("OWNER_WEBID", "");
    vi.stubEnv("SITE_URL", "");
    const pod = studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session, { podRoot: POD });

    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    expect(pod.got(TRIPS)).toHaveLength(1);
    expect(pod.urls().every((u) => u.startsWith(POD))).toBe(true);
    expect(pod.urls().filter((u) => u.startsWith(DECOY_POD))).toEqual([]);
  });
});

/* ==========================================================================
 * 4. Who it lists for — and who it must not even ask about.
 * ======================================================================== */

describe("studio shell — it lists for the owner and nobody else", () => {
  /**
   * NOT MERELY "renders no editor". An authenticated enumeration fired for
   * someone who is not the owner is a request that will 403 on a real Pod, and
   * firing it at all says the shell asked a question it had no business asking.
   * The assertion is therefore on the REQUEST LOG, not on the DOM.
   *
   * Invariant 5 still holds: the Pod is what enforces this, so a stray listing
   * is not a security hole. It is a request made on someone else's behalf.
   *
   * THE ALLOW-CASE IS THE THIRD RENDER, through the same fake Pod and the same
   * queries. Without it, a shell that had simply stopped enumerating at all
   * would pass this.
   */
  it("makes no request at all for a visitor who is not the owner, nor when signed out", async () => {
    const visitor = fakeStudioSession({ isLoggedIn: true, webId: VISITOR });
    const notOwner = studioPod();
    const first = renderShell(visitor.session, { ownerWebId: OWNER });
    await waitFor(() => expect(courtesyMessage().length).toBeGreaterThan(0));
    await settle();
    expect(notOwner.requests).toEqual([]);
    expect(visitor.fetch).not.toHaveBeenCalled();
    expect(editorHeadlineField()).toHaveLength(0);
    first.unmount();

    cleanup();
    resetSessionRestore();
    const anonymous = fakeStudioSession();
    const signedOut = studioPod();
    const second = renderShell(anonymous.session);
    await waitFor(() => expect(signInControl()).toHaveLength(1));
    await settle();
    expect(signedOut.requests).toEqual([]);
    expect(anonymous.fetch).not.toHaveBeenCalled();
    second.unmount();

    cleanup();
    resetSessionRestore();
    const owner = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    const asOwner = studioPod();
    renderShell(owner.session);
    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    expect(asOwner.got(TRIPS)).toHaveLength(1);
  });

  /**
   * The session lapsing mid-edit is the case
   * test/studio-shell.test.tsx calls "the bug this whole increment exists for":
   * an expiry never emits LOGOUT, and a shell that missed it goes on offering
   * to save over a session every write will 401.
   *
   * Here it has a second consequence. Once the shell is back on `signed-out`,
   * the trips it listed belong to a session that no longer exists, and a
   * re-listing on the way out is a 401 nobody asked for.
   */
  it("stops offering the trips, and asks for no more, once the session expires", async () => {
    const pod = studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);
    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    const before = pod.requests.length;

    act(() => {
      fake.events.emit(SESSION_EXPIRED);
    });

    await waitFor(() => expect(signInControl()).toHaveLength(1));
    expect(editorHeadlineField()).toHaveLength(0);
    expect(emptyNote()).toHaveLength(0);
    await settle();
    expect(pod.requests).toHaveLength(before);
  });
});

/* ==========================================================================
 * 5. Loading, empty and failed — three states one lazy implementation
 *    collapses into one.
 * ======================================================================== */

describe("studio shell — while the listing is in flight", () => {
  /**
   * LOADING IS A STATE, NOT A BLANK, and above all not the empty-state note.
   *
   * "No trips to write into yet" means YOUR POD HAS NO TRIPS. Rendering it
   * while the request is in flight tells the owner something false about their
   * own data — the same class of error as treating `restoring` as a resolved
   * value, which lib/studio/session.ts refuses to do in as many words.
   *
   * NON-VACUOUS BY CONSTRUCTION: the same queries, the same container and the
   * same fake Pod produce the editor once the gate is released, so a shell that
   * rendered nothing at all fails the second half. And the sibling case below
   * proves the note is reachable at all.
   */
  it("does not claim the Pod has no trips while it is still asking", async () => {
    const gate = deferred();
    const pod = studioPod({
      onGet: async (url) => {
        if (url === TRIPS) await gate.promise;
      },
    });
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);

    // On the owner branch, and the request is genuinely out.
    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    await waitFor(() => expect(pod.got(TRIPS)).toHaveLength(1));

    // The lie, and the two resolved values it would be mistaken for.
    expect(emptyNote()).toHaveLength(0);
    expect(editorHeadlineField()).toHaveLength(0);
    expect(courtesyMessage()).toHaveLength(0);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });
    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    expect(emptyNote()).toHaveLength(0);
  });

  /**
   * The allow-case for the note, and the whole reason the three cases around it
   * can assert its absence: an EMPTY container really does produce it.
   *
   * `listStudioTrips` returns `ok` with an empty list here, deliberately
   * distinct from a failure, because the note is written for exactly this
   * person — a new deployer who has written nothing yet.
   */
  it("does show the note when the Pod really has no trips", async () => {
    const pod = fakePod({ ownerOnly: { [TRIPS]: containerTurtle([...NOISE]) } });
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);

    await waitFor(() => expect(emptyNote().length).toBeGreaterThan(0));
    expect(editorHeadlineField()).toHaveLength(0);
    expect(editorSaveControl()).toHaveLength(0);
    // The owner is the owner: nobody is told whose diary this is.
    expect(courtesyMessage()).toHaveLength(0);
    // It really did ask, and the container really was empty of trips — a shell
    // that never enumerated would also render the note.
    expect(pod.got(TRIPS)).toHaveLength(1);
    expect(pod.requests).toHaveLength(1);
  });

  /**
   * UNMOUNT MID-FLIGHT.
   *
   * Pair to the unsubscribe case in test/studio-shell.test.tsx. Honest about
   * what it can catch: React 19 no longer warns on a state update after
   * unmount, so this is not a "setState on an unmounted component" detector. It
   * catches what still bites — a throw inside the settled handler, and an
   * unhandled rejection from a listing whose consumer has gone.
   *
   * The console spies are proved to discriminate at the end, so a clean run
   * cannot mean a spy that was never attached.
   */
  it("neither warns nor throws when the shell unmounts with a listing in flight", async () => {
    const errors: unknown[][] = [];
    const warnings: unknown[][] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);

    try {
      const gate = deferred();
      const pod = studioPod({
        onGet: async (url) => {
          if (url === TRIPS) await gate.promise;
        },
      });
      const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

      const { unmount } = renderShell(fake.session);
      await waitFor(() => expect(signOutControl()).toHaveLength(1));
      await waitFor(() => expect(pod.got(TRIPS)).toHaveLength(1));

      unmount();

      await act(async () => {
        gate.resolve();
        await gate.promise;
      });
      // Two macrotasks: an unhandledRejection is reported a tick after the
      // promise is abandoned, not synchronously.
      await settle();
      await settle();

      expect(errors).toEqual([]);
      expect(warnings).toEqual([]);
      expect(rejections).toEqual([]);

      // The controls. A clean run above must mean "nothing was logged", never
      // "nothing could have been logged".
      console.error("control: the error spy is attached");
      console.warn("control: the warn spy is attached");
      expect(errors).toHaveLength(1);
      expect(warnings).toHaveLength(1);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

describe("studio shell — when the Pod will not answer", () => {
  /**
   * A FAILED ENUMERATION IS NOT AN EMPTY POD, and `listStudioTrips` goes out of
   * its way to keep them apart: "telling that owner to write their first trip
   * when the truth is that their Pod is misconfigured sends them somewhere no
   * amount of writing helps." The shell must not flatten them back together.
   *
   * The message is asserted through `describe(error)` from lib/pod/result —
   * the module's own one-line rendering of a `PodError`, already what
   * app/(studio)/studio/page.tsx puts on screen when the WebID cannot be read.
   * That keeps 403 and 404 distinguishable in the DOM, which is the point: one
   * is an access problem, the other means first-run setup never ran.
   */
  it.each([
    ["a closed container", 403],
    ["a container that is not there", 404],
  ])("says what went wrong for %s, and does not call it an empty Pod", async (_label, status) => {
    fakePod({ open: { [TRIPS]: status } });
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    const { container } = renderShell(fake.session);

    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    await waitFor(() =>
      expect(container.textContent ?? "").toContain(
        describePodError({ kind: "http", url: TRIPS, status }),
      ),
    );
    // THE FLATTENING THIS EXISTS TO CATCH.
    expect(emptyNote()).toHaveLength(0);
    // And no form whose every save would go nowhere.
    expect(editorHeadlineField()).toHaveLength(0);
    expect(editorSaveControl()).toHaveLength(0);
    // Still the owner. A read failure is not an identity verdict.
    expect(courtesyMessage()).toHaveLength(0);
  });

  /**
   * An unreachable Pod. `listStudioTrips` returns a structured `network` error
   * and never throws, so the shell has something to render — but only if it
   * renders it. A shell that let the rejection escape would take the studio
   * down with it.
   */
  it("survives a fetch that rejects, and says so", async () => {
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });
    // Replaces the credential-adding implementation entirely: no request
    // reaches MSW, so this is a transport failure rather than an HTTP status.
    fake.fetch.mockImplementation(async () => {
      throw new TypeError("connect ECONNREFUSED 127.0.0.1:3001");
    });

    const { container } = renderShell(fake.session);

    await waitFor(() => expect(signOutControl()).toHaveLength(1));
    await waitFor(() => expect(container.textContent ?? "").toMatch(/ECONNREFUSED/));
    expect(emptyNote()).toHaveLength(0);
    expect(editorHeadlineField()).toHaveLength(0);
  });

  /**
   * SKIPPED TRIPS ARE SURFACED.
   *
   * `listStudioTrips` returns `{ trips, skipped }` and one unreadable member is
   * skipped rather than fatal — `rebuildIndex`'s rule verbatim, "a single bad
   * resource must not make the whole trip unrecoverable". The half that is this
   * shell's job is the other one: a trip the studio could not read is a trip
   * the owner cannot write into, and silence there is the owner wondering where
   * their trip went.
   *
   * The FORM is the implementer's choice — a count, a list of slugs, one line
   * per skip. What is pinned is that the skipped trip is identifiable from the
   * DOM, which its slug is and a bare "1 trip could not be read" is not.
   */
  it("says which trip it could not read, and still offers the ones it could", async () => {
    fakePod({
      ownerOnly: {
        [TRIPS]: containerTurtle([...NOISE, "2026-japan/", "2027-future/"]),
        [tripDoc(JAPAN)]: JAPAN_TTL,
        [tripDoc(BROKEN)]: "@prefix broken",
      },
    });
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    const { container } = renderShell(fake.session);

    // Not fatal: the readable trip is still there to write into.
    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    expect(tripOptions().join("\n")).toContain("Japan, spring");

    // And the one that was skipped is named, so the owner can go and look at it.
    expect(container.textContent ?? "").toContain("2027-future");
    // Not silently offered as though it were readable — and this is a real
    // discrimination, not a restatement: "2027-future" IS in the document, just
    // not in the picker.
    expect(tripOptions().filter((o) => o.includes("2027-future"))).toEqual([]);
    // Not the empty-state note either: there is a trip, and there is a problem.
    expect(emptyNote()).toHaveLength(0);
  });

  /**
   * The mirror of the case above, and it is what stops "say something about
   * skips" turning into "always say something about skips". A clean Pod must
   * not tell the owner a trip went missing.
   */
  it("says nothing about skipped trips when none were skipped", async () => {
    studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    const { container } = renderShell(fake.session);

    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/could not (be )?read|skipped|unreadable/i);
    expect(text).not.toContain("trip.ttl");
  });
});

/* ==========================================================================
 * 6. The `trips` prop, whose meaning this step decides.
 *
 * It is the seam every case in test/studio-shell.test.tsx uses, and once the
 * shell can fetch, "supplied" and "absent" have to mean different things or
 * those twenty cases are testing a path whose behaviour nobody stated.
 *
 * SUPPLIED MEANS SUPPLIED: offer exactly these and ask the Pod nothing. That
 * also means `[]` and `undefined` stop being interchangeable — the current
 * `trips = []` default in the destructuring makes them the same value, and this
 * is the case that says they must not be.
 * ======================================================================== */

describe("studio shell — the trips prop", () => {
  it("asks the Pod nothing when it is handed an explicit empty list", async () => {
    const pod = studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session, { trips: [] });

    await waitFor(() => expect(emptyNote().length).toBeGreaterThan(0));
    await settle();
    expect(pod.requests).toEqual([]);
    expect(fake.fetch).not.toHaveBeenCalled();
  });

  /** The allow-case for the rule above: absent still means ask. Without it,
   *  a shell that never enumerated would satisfy the case above. */
  it("asks the Pod when it is handed nothing", async () => {
    const pod = studioPod();
    const fake = fakeStudioSession({ isLoggedIn: true, webId: OWNER });

    renderShell(fake.session);

    await waitFor(() => expect(editorHeadlineField()).toHaveLength(1));
    expect(pod.got(TRIPS)).toHaveLength(1);
  });
});

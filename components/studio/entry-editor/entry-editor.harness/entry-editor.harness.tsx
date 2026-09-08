/**
 * The shared rig for the thirteen `entry-editor.*.test.tsx` suites: fixtures,
 * fake Pod, fake session, fake storage, loader, form plumbing, lifecycle.
 * IMPORT IT FIRST, ahead of every other module — measured, and load-bearing:
 * ./notes.md#the-harness-must-be-imported-first
 */

import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { StrictMode } from "react";
import { afterAll, afterEach, beforeEach, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Parser, type Quad, type Term } from "n3";
import { DY, SCHEMA } from "@/lib/vocab";
import { readEntry } from "@/lib/pod/read";
import { resetSessionRestore, type StudioSessionLike } from "@/lib/studio/session";
import { triples } from "@/test/graph";
import { servePod, server } from "@/test/msw";
import { type Entry, Photo } from "@/lib/pod/schema";
import { exifJpeg, type ExifOptions } from "@/test/fixtures/exif-jpeg";
import { readMetadata } from "@/lib/media/exif";
import type { Pipeline, PipelineResult } from "@/lib/media/pipeline";

/**
 * The studio's entry editor — components/studio/entry-editor/entry-editor.tsx.
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
 *                    components/studio/studio-shell/studio-shell.test.tsx and test/session.test.ts do. A
 *                    test that mocks @inrupt/solid-client-authn-browser tests
 *                    the library's idea of a session.
 *   privacy.ttl      MSW again, and deliberately NOT a mocked
 *                    `readPrivacySettings`. §7.6's resource is owner-only, the
 *                    read is the thing that has to fail closed, and a stubbed
 *                    module would let a test assert "the editor did the right
 *                    thing with settings that could not be read" against a
 *                    fake that never parsed a document. The fail-closed cases
 *                    below are real Turtle — a 404, and a half-written home
 *                    region mutated out of the normative §7.6 block — served
 *                    over HTTP and put through the real reader.
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
 * COORDINATES ARE IN SCOPE AS OF 2026-09-06, AND THE TWO SAFETY PINS THAT USED
 * TO STAND HERE ARE GONE. They were "exposes no coordinate input, while
 * exposing the fields that are in scope" and "writes no coordinate predicate on
 * a create", and this docblock said of them: "Both are safety pins, not
 * placeholders: they must be deleted deliberately when fuzzing lands, which is
 * the point." That is what happened. `lib/pod/fuzz.ts` exists and is covered by
 * test/fuzz.test.ts; `readPrivacySettings` exists and is covered by
 * test/privacy-settings.test.ts; section 1 below is the caller, and it asserts
 * at the wire the thing the pins were holding the door for — that the
 * coordinate a stranger can `curl` is the snapped one and the typed one is in
 * no request at all.
 *
 * WHAT IS DELIBERATELY OUT OF SCOPE, each for a reason worth stating:
 *
 *   PHOTOS (phase 3, needs the resize/EXIF pipeline — a photo's GPS is a
 *   coordinate like any other and goes through §9 steps 1-4 before anything is
 *   written, but there is no photo input to drive yet), CREATING A TRIP (not in
 *   phase 2), RICH TEXT, and a PLACE NAME control: an edit carries the place it
 *   already had, which is what the drop test in section 1 leans on, and a
 *   create has no name to keep.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE PROP AND LABEL SHAPES BELOW ARE THIS FILE'S PROPOSAL, NOT ITS SUBJECT.
 * Every assertion is about what reaches the Pod, what reaches the revalidation
 * hook, and what the owner is told. An implementer who prefers different prop
 * names or different field labels changes `renderEditor` and `LABEL` and
 * nothing else.
 */

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
export const REAL_TZ = process.env.TZ;
process.env.TZ = "Asia/Tokyo";
afterAll(() => {
  if (REAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = REAL_TZ;
});

/* ══════════════════════════════════════════════════ mock: lib/pod/access ══ */

/** Plain consts, not `vi.hoisted`, which Vitest 4 refuses to
 *  export. Why that is safe here: ./notes.md#plain-consts-rather-than-a-hoisted-binding */
export const accessCalls: { op: string; url: string }[] = [];

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
export const accessOutcome: {
  failure: { kind: string; url: string; expected: string; found: string } | null;
  throws: Error | null;
} = { failure: null, throws: null };

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
export const DOC = readFileSync("docs/data-model.md", "utf8");
export const BLOCKS = [...DOC.matchAll(/```turtle\n([\s\S]*?)```/g)].map((m) => m[1]);
export const ENTRY_TTL = BLOCKS[2];
export const INDEX_TTL = BLOCKS[3];
/** §7.6, the owner-only privacy settings. Block 6: diary, trip, entry, index,
 *  profile, type index, privacy — the same index test/privacy-settings.test.ts
 *  takes it from. */
export const PRIVACY_TTL = BLOCKS[6];

/** Guard the extraction: if the §7 numbering shifts, every test below would
 *  otherwise run silently against the wrong block. */
if (!ENTRY_TTL?.includes("dy:Entry") || !INDEX_TTL?.includes("dy:TripIndex")) {
  throw new Error("docs/data-model.md §7.3/§7.4 blocks not found at the expected index");
}
if (!PRIVACY_TTL?.includes("dy:homeRadiusMeters")) {
  throw new Error("docs/data-model.md §7.6 block not found at the expected index");
}

/* ═══════════════════════════════════════════════════════════ the fixtures ══ */

export const POD = "https://me.solidcommunity.net";
export const OWNER = `${POD}/profile/card#me`;
/** Deliberately not the owner's Pod host, so nothing can pass by coincidence. */
export const REVALIDATE_URL = "http://localhost:3000/api/revalidate";

export type EditorTrip = {
  iri: string;
  slug: string;
  /** What the owner picks from the list. */
  name: string;
  indexUrl: string;
  entriesContainer: string;
};

export const tripFixture = (slug: string, name: string): EditorTrip => ({
  iri: `${POD}/travel/trips/${slug}/trip.ttl#it`,
  slug,
  name,
  indexUrl: `${POD}/travel/trips/${slug}/entries.ttl`,
  entriesContainer: `${POD}/travel/trips/${slug}/entries/`,
});

export const JAPAN = tripFixture("2026-japan", "Japan, spring 2026");
export const PERU = tripFixture("2027-peru", "Peru, 2027");
export const TRIPS = [JAPAN, PERU];

export const ARRIVAL_SLUG = "2026-03-29-arrival";
export const ARRIVAL_URL = `${JAPAN.entriesContainer}${ARRIVAL_SLUG}.ttl`;

/** What the §7.3 fixture carries, so the "created survives an edit" assertion
 *  compares against the specification rather than against my typing. */
export const SPEC_CREATED = "2026-03-29T22:03:44+09:00";
export const SPEC_OCCURRED = "2026-03-29T21:40:00+09:00";
/** The place the §7.3 entry names, and the coordinate it already carries —
 *  fuzzed to 500 m when it was stored, which is why it is allowed to be there. */
export const SPEC_PLACE_NAME = "Shinjuku, Tokyo";
/** The rest of §7.3's address: prose and a code, and the two are written
 *  differently on purpose (section 1b). */
export const SPEC_LOCALITY = "Tokyo";
export const SPEC_COUNTRY = "JP";

/* ══════════════════════════════════════════════ §7.6 privacy settings ══ */

/**
 * The owner-only resource §9 makes every coordinate write conditional on.
 *
 * IT IS A URL THE EDITOR IS GIVEN, not one it derives: the editor reads no
 * config (`lib/config.ts` throws in the browser and there is a source assertion
 * about it at the bottom of this file), so `settingsUrl` joins `indexUrl` and
 * `entriesContainer` as something the shell resolves from `podRoot` —
 * `privacySettingsUrl(podRoot)` in lib/pod/read.ts already spells it. An
 * implementer who would rather pass the parsed settings down as a prop changes
 * `renderEditor` and the four settings documents below; what may not change is
 * that the failure cases are produced by a real read of a real document, since
 * "the settings could not be read" is the state the whole feature turns on.
 */
export const SETTINGS_URL = `${POD}/travel/settings/privacy.ttl`;

/**
 * A mutation of the normative block, guarded twice — the anchor must be found,
 * and the edit must change the GRAPH rather than the bytes. Lifted from
 * test/privacy-settings.test.ts, which states the reason: a negative test built
 * by string-replacing a fixture passes the *unmodified* fixture the day the
 * anchor drifts, and does it silently. Both guards throw at module load.
 */
export function mutateSettings(from: string | RegExp, to: string): string {
  const matched = typeof from === "string" ? PRIVACY_TTL.includes(from) : from.test(PRIVACY_TTL);
  if (!matched) {
    throw new Error(`§7.6 anchor not found in docs/data-model.md: ${String(from)}`);
  }
  const out = PRIVACY_TTL.replace(from, to);
  const before = triples(PRIVACY_TTL, SETTINGS_URL);
  const after = triples(out, SETTINGS_URL);
  if (before.size === after.size && [...before].every((t) => after.has(t))) {
    throw new Error(`§7.6 mutation left the graph unchanged: ${String(from)}`);
  }
  return out;
}

/**
 * "I have no home to protect" — §7.6 in as many words, and a legitimate
 * configuration rather than an error. Every coordinate is still snapped; none
 * is ever dropped. Reading this as unreadable settings would strip the pin from
 * every entry of everyone who has not set a home region, silently and forever,
 * which is why it has an allow-case of its own below.
 */
export const NO_HOME_TTL = mutateSettings(
  /\s*dy:homeLat[^;]*;\s*dy:homeLong[^;]*;\s*dy:homeRadiusMeters[^;]*;/,
  "",
);

/** A half-written home region: two of the three values. §7.6 — "a reader that
 *  treats an absent dy:homeRadiusMeters as zero has no home region at all, and
 *  publishes coordinates from the owner's doorstep while reporting success". */
export const HALF_HOME_TTL = mutateSettings(/\s*dy:homeRadiusMeters[^;]*;/, "");

/** Same document, a different default precision. Exists so that "the preset
 *  comes from the settings" can be shown to be a READ rather than a constant
 *  that happens to equal the fixture's 500. */
export const PRECISION_2000_TTL = mutateSettings("dy:defaultPrecisionMeters 500", "dy:defaultPrecisionMeters 2000");

/* ═════════════════════════════════════════════════════ the coordinates ══ */

/**
 * WHAT THE OWNER TYPES, and it is a string because that is what an
 * `<input type="number">` hands back — and because the whole point of the
 * headline test is a substring search for these exact characters across every
 * outgoing request.
 *
 * On the Philosopher's Path, six decimals: ~10 cm, far finer than any grid
 * below, and chosen so that none of the snapped forms contains it as a
 * substring. That last property is not decoration — without it the "appears
 * nowhere" assertion could not fail — so it is asserted in a control.
 */
export const TYPED = { lat: "35.026345", long: "135.794782" } as const;

/**
 * What §7.6's own settings publish for it, and what each option of the
 * precision control publishes.
 *
 * HARD-CODED, AND TIED TO lib/pod/fuzz.ts BY A CONTROL rather than computed
 * here. Computing them with `snapToPrecision` in each assertion would pass for
 * an editor that called the same function on the same input — including one
 * that called it on the wrong input in the same way — and would also pass if
 * the grid changed underneath. Hard-coding them means a grid change fails ONE
 * control test that says so, instead of five tests that do not.
 */
export const SNAP_500 = { lat: 35.02423, long: 135.79207 };
export const SNAP_2000 = { lat: 35.018, long: 135.7906 };
export const SNAP_10KM = { lat: 35.0649, long: 135.8242 };

/** Inside §7.6's home region — 285 m from the centre of a 3 km radius. */
export const INSIDE_HOME = { lat: "45.466102", long: "9.190154" } as const;
/** 5.9 km from the same centre: outside it, and the allow-case that stops
 *  "drops everything" from passing the drop test. */
export const OUTSIDE_HOME = { lat: "45.515500", long: "9.210300" } as const;
export const SNAP_OUTSIDE_500 = { lat: 45.51486, long: 9.20856 };

/* ═════════════════════════════════════════════════════════════ Turtle help ══ */

export const quadsOf = (ttl: string, base: string): Quad[] => new Parser({ baseIRI: base }).parse(ttl);

export const objectsOf = (qs: Quad[], subject: string, predicate: string): Term[] =>
  qs.filter((q) => q.subject.value === subject && q.predicate.value === predicate).map((q) => q.object);

export const oneObject = (qs: Quad[], subject: string, predicate: string): Term | undefined =>
  objectsOf(qs, subject, predicate)[0];

export const datatypeOf = (t: Term | undefined) =>
  t && t.termType === "Literal" ? t.datatype.value : undefined;
export const languageOf = (t: Term | undefined) =>
  t && t.termType === "Literal" ? t.language : undefined;

/** The §7.3 entry as the app reads it — obtained by running the normative
 *  fixture through the real reader, so edit mode starts from the spec. */
export async function specEntry(): Promise<Entry> {
  servePod({ [ARRIVAL_URL]: ENTRY_TTL });
  const r = await readEntry(ARRIVAL_URL);
  if (!r.ok) throw new Error(`the §7.3 fixture no longer reads: ${r.error.kind}`);
  return r.value;
}

/* ══════════════════════════════════════════════════════════ the fake Pod ══ */

export type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };

export type PodScript = {
  /** Per index URL: Turtle to serve, or a status code to answer with. */
  index?: Record<string, string | number>;
  indexEtag?: string;
  /**
   * §7.6's privacy settings: Turtle to serve, or a status code. Defaults to the
   * normative block, so every test written before coordinates existed keeps
   * working unchanged — and so that "the settings could not be read" is always
   * something a test asked for rather than something it forgot to arrange.
   *
   * A DEFAULT IS ALSO REGISTERED FILE-WIDE, in the beforeEach below, because
   * most tests here render the editor without a Pod script at all and an
   * unhandled GET fails the suite by design (test/setup.ts). msw's `use()`
   * prepends, so this one wins wherever podFake is called.
   */
  settings?: string | number;
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
export function podFake(script: PodScript = {}) {
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

  const settings = script.settings ?? PRIVACY_TTL;

  server.use(
    ...indexHandlers,
    // §7.6, recorded like everything else: it is owner-only, so "which fetch
    // asked for it" is an assertion section 4 makes on the recorded headers.
    http.get(SETTINGS_URL, async ({ request }) => {
      await record(request);
      return typeof settings === "number"
        ? new HttpResponse(`settings unavailable (${settings})`, { status: settings })
        : HttpResponse.text(settings, {
            headers: { "content-type": "text/turtle", etag: '"settings-1"' },
          });
    }),
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
    settingsGet: () => requests.find((r) => r.method === "GET" && r.url === SETTINGS_URL),
    /**
     * WHAT THE SAVE SENT: every recorded request except the §7.6 read the
     * editor makes ON MOUNT.
     *
     * "`pod.requests` is empty" used to be the spelling of "the save sent
     * nothing", and it stopped being one the day the coordinate gate landed:
     * the editor now reads the settings on mount, before any interaction, so
     * every render leaves one GET behind and three refusal tests failed for a
     * request no save made. Section 1's allow-case (`await waitFor(() =>
     * expect(latitude).toBeEnabled())` with no interaction in front of it) is
     * the assertion that makes an unconditional mount read the only possible
     * implementation, so this is a contradiction between two assertions of
     * mine, and the narrower claim is the one that survives.
     *
     * WHAT IS EXCLUDED IS ONE METHOD AT ONE URL, not "requests about
     * settings". A PUT to `privacy.ttl`, or a settings GET the SAVE issued, is
     * still here — and every caller pairs this with a count of the mount read,
     * so a save that re-read the settings n more times fails on that count
     * rather than passing through this filter.
     */
    saveTraffic: () =>
      requests.filter((r) => !(r.method === "GET" && r.url === SETTINGS_URL)),
    /**
     * EVERY BYTE THAT LEFT THE BROWSER, method and URL included. The privacy
     * assertion is "the typed coordinate is in no request at all" — not "not in
     * the entry document" — because a coordinate that escapes through the index
     * row, or through a query string on the revalidation hook, has escaped.
     */
    wire: () => requests.map((r) => `${r.method} ${r.url}\n${r.body}`).join("\n"),
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
export const CREDENTIAL = "DPoP test-token-not-a-real-one";

export function fakeStudioSession(webId: string = OWNER) {
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
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/* ═══════════════════════════════════════════ loading the component under test ══ */

/**
 * At RUNTIME through a dynamic import with a specifier vite cannot analyse, and
 * at COMPILE time through a type-only reference. The reasoning is
 * components/studio/studio-shell/studio-shell.test.tsx's, measured there rather than assumed: a static
 * import of a module that does not exist is a resolution error that kills the
 * whole FILE and takes the environment controls with it, so the file reports
 * `(0 test)` instead of reporting red. `typeof import(...)` is a TYPE, erased
 * before import-analysis sees the file, and `tsc --noEmit` reporting "Cannot
 * find module '@/components/studio/entry-editor'" IS the correct red state.
 */
export type EditorModule = typeof import("@/components/studio/entry-editor");

export const importModule = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

export async function loadEditor() {
  const mod = (await importModule("@/components/studio/entry-editor").catch((cause: unknown) => {
    throw new Error(
      "components/studio/entry-editor/entry-editor.tsx does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as EditorModule;
  const Editor = mod.default;
  if (typeof Editor !== "function") {
    throw new Error(
      "components/studio/entry-editor/entry-editor.tsx exists but default-exports no component — still the red step.",
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
export async function renderEditor(
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
    /**
     * §7.6's resource (section 1). A URL rather than a parsed value, because
     * the read failing is the case that matters and only a URL can be made to
     * 404. Every test above leaves it at the default, where the normative block
     * is served and the coordinate controls are live.
     *
     * REQUIRED ON THE COMPONENT, optional only in this harness. The shell is
     * what resolves it — `privacySettingsUrl(podRoot)` — and if the prop were
     * optional the day the shell forgot to pass it, the editor would fail
     * closed for ever, silently, with no test anywhere going red: coordinates
     * would simply never publish. A required prop makes that omission a tsc
     * error, which is the only check that covers a wire nobody rendered.
     */
    settingsUrl?: string;
    /**
     * THE MEDIA PIPELINE (section 10). Injected so a test can supply output it
     * knows byte for byte; `undefined` is what ships, and the editor creates a
     * real one lazily — a worker at mount would be a thread and a chunk for the
     * majority of edits, which touch no photo at all.
     *
     * OPTIONAL, UNLIKE `settingsUrl`, and for the opposite reason. A forgotten
     * `settingsUrl` fails closed invisibly; a forgotten pipeline cannot happen,
     * because the default IS the real one. The default is also what makes this
     * a seam rather than a mock: jsdom has no `createImageBitmap` and no
     * `OffscreenCanvas`, so the worker cannot run here at all.
     */
    pipeline?: Pipeline;
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
        settingsUrl={props.settingsUrl ?? SETTINGS_URL}
        /**
         * WHERE THE MEDIA CONTAINER IS (§4: one global `travel/media/`, outside
         * any trip). A prop rather than config, for the reason the editor's own
         * docblock gives about `settingsUrl`: `POD_ROOT` is not `NEXT_PUBLIC_`
         * and `lib/config.ts` throws the moment it is reached in a browser. The
         * shell already holds it — it is what `privacySettingsUrl(podRoot)` is
         * built from — so this is one more thing it passes down, not one more
         * thing it has to learn.
         *
         * REQUIRED ON THE COMPONENT, for the same reason `settingsUrl` is:
         * nothing renders a wire nobody passed, so tsc is the only check that
         * covers a shell that forgot it.
         */
        podRoot={POD}
        pipeline={props.pipeline}
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
export const LABEL = {
  trip: /trip/i,
  headline: /headline|title/i,
  articleBody: /body|story|what happened/i,
  occurredAt: /when|occurred|date/i,
  slug: /slug|url segment/i,
  status: /status|publish|draft/i,
  tags: /tags?\b/i,
  travelModeFrom: /travel mode|how you (got|arrived)|arriv|mode/i,
  /* Section 1. `/latitude/i` does not match "Longitude" and vice versa; both
     are matched by COORDINATE_FIELD as well, which is what the "exactly three
     of them" assertion uses. */
  latitude: /latitude/i,
  longitude: /longitude/i,
  precision: /precision/i,
  /* Section 10. In here rather than beside its own tests so that 8b's shadowing
     loop covers it: that loop demands exactly one match per entry, which is the
     guard this control wants — a `<section aria-label="Photos">` wrapper around
     the list would otherwise shadow the file input, and the failure would read
     "found multiple elements" from somewhere else entirely. */
  photos: /photos?\b/i,
  /* Section 1b, and in here for the same reason `photos` is: 8b's shadowing
     loop iterates `Object.entries(LABEL)` and demands exactly ONE match per
     entry, which is the guard these three need most.

     WHY THEY CANNOT COLLIDE, checked against the eleven above rather than
     assumed. None of "place name", "locality" or "country" contains `trip`,
     `headline`, `title`, `body`, `story`, `what happened`, `when`, `occurred`,
     `date`, `slug`, `status`, `publish`, `draft`, `tag`, `mode`, `arriv`,
     `latitude`, `longitude`, `precision` or `photo`; and none of the eleven
     labels contains `place name`, `locality`, `town`, `city` or `country`.
     They are also outside COORDINATE_FIELD — `locality` has no `lat` in it —
     which matters, because "exactly three coordinate controls" counts by that
     query, so a place field caught by it fails there instead of here. */
  placeName: /place name/i,
  locality: /locality|town|city/i,
  country: /country/i,
  /* Section 1c, and in here for the reason `photos` and the three above are:
     8b's shadowing loop demands exactly ONE match per entry, and this control
     sits next to "When it happened" — the one label it could plausibly collide
     with.

     WHY IT CANNOT COLLIDE, checked against the fourteen above rather than
     assumed. The editor's labels today are Trip, Slug, Headline, Story, When it
     happened, Place name, Town or city, Country, Latitude, Longitude,
     Precision, Photos, Tags, Travel mode you arrived by and Status: not one of
     them contains `offset` or `time zone`. In the other direction, an offset
     label must contain neither `when`, `occurred` nor `date` (LABEL.occurredAt
     would then find two), nor `mode`, `status`, `publish`, `draft`, `trip`,
     `title`, `body`, `story`, `tag`, `country`, `city`, `town` or `place name`.
     It is outside COORDINATE_FIELD too — no `lat`, `long`, `lng`, `geo`,
     `gps`, `coordinate`, `precision` or `position` in either alternative —
     which matters, because "exactly three coordinate controls" counts by that
     query and a fourth match would fail there instead of here. */
  offset: /offset|time zone/i,
};

export function setText(label: RegExp, value: string) {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
}

/** Accessible name of a labelled control, good enough for the choice helper. */
export const nameOf = (el: HTMLElement) =>
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
export function setChoice(label: RegExp, wanted: RegExp) {
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

export const saveButton = () => screen.getByRole("button", { name: /save|publish|update/i });

/**
 * What the owner is told, read from the roles that ANNOUNCE it.
 *
 * Scoped to `alert` / `status` / `aria-live` deliberately: the result of a save
 * arrives asynchronously, after focus has moved on, and text dropped into a
 * plain <div> is text a screen-reader user never hears. This is also what keeps
 * the message assertions from matching the form's own labels.
 */
export const outcomeText = () =>
  [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')]
    .map((n) => n.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** Fill a create form with a complete, valid entry. */
export function fillNewEntry(overrides: { slug?: string; headline?: string; trip?: EditorTrip } = {}) {
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

export async function clickSaveAndWait() {
  await act(async () => {
    fireEvent.click(saveButton());
  });
  await waitFor(() => expect(outcomeText()).not.toBe(""));
}

/** The family of names a coordinate input could plausibly carry. */
export const COORDINATE_FIELD = /lat(itude)?|long(itude)?|\blng\b|coordinate|gps|geo\b|precision|position/i;

/** The `#geo` node, reached the way a reader reaches it: `<#it>` →
 *  `schema:contentLocation` → `#place` → `schema:geo`. Resolving it by fragment
 *  name would also find a `<#geo>` node that nothing points at, which is a
 *  coordinate published into a document no consumer can navigate. */
export function geoNodeOf(quads: Quad[], url: string): string | undefined {
  const place = oneObject(quads, `${url}#it`, SCHEMA.contentLocation)?.value;
  return place === undefined ? undefined : oneObject(quads, place, SCHEMA.geo)?.value;
}

/** One entry's row in the index, found by `dy:entryResource` rather than by
 *  fragment name: the fragment is the serialiser's business, the pointer is the
 *  contract (§7.4). */
export function indexRowOf(body: string, indexUrl: string, entryUrl: string) {
  const quads = quadsOf(body, indexUrl);
  const row = quads.find(
    (q) => q.predicate.value === DY.entryResource && q.object.value === `${entryUrl}#it`,
  )?.subject.value;
  return { quads, row };
}

/** Every id an element points its description at. An association that resolves
 *  is the difference between a reason a screen reader announces and one that
 *  computes to the empty string — see the control at the end of section 8. */
export const describedByIdsOf = (el: Element): string[] =>
  (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");

/** The three controls, named so a failure says which one. */
export const coordinateControls = () =>
  [
    ["latitude", screen.getByLabelText(LABEL.latitude)],
    ["longitude", screen.getByLabelText(LABEL.longitude)],
    ["precision", screen.getByLabelText(LABEL.precision)],
  ] as const;

/**
 * All three are present, asserted BEFORE anything waits on one of them.
 *
 * A `waitFor` around an element that does not exist spends its whole timeout
 * and then reports "unable to find a label" under a dump of the form — which
 * reads like a broken query rather than like a missing control, and costs a
 * second per test while it does it. This says which control is missing, at
 * once.
 */
export function requireCoordinateControls() {
  for (const [what, label] of [
    ["latitude", LABEL.latitude],
    ["longitude", LABEL.longitude],
    ["precision", LABEL.precision],
  ] as const) {
    expect(
      screen.queryAllByLabelText(label),
      `the editor has no ${what} control`,
    ).toHaveLength(1);
  }
}

/**
 * The wording a fail-closed editor has to reach for. Loose on purpose and, like
 * `LABEL`, this file's proposal rather than its subject: what is being asserted
 * is that the owner is told WHY the control is dead, and §9's own sentence for
 * it is "you have not set a home region yet". An implementer who words it
 * differently changes this regex and nothing else.
 */
export const NO_SETTINGS_REASON = /settings|privacy|home region/i;

/**
 * Type a coordinate the way the owner would, and refuse to pretend when the
 * control would not have accepted it.
 *
 * `fireEvent.change` fills a DISABLED input perfectly happily — jsdom dispatches
 * the event and React's handler runs — so a test that typed without checking
 * would report a published coordinate against a form nobody could have used.
 * That exact shape has already been found in this file once, in section 8c's
 * docblock: "eight keystrokes a real browser refuses, green only because
 * `fireEvent` ignores disabled state."
 *
 * It WAITS first, because the settings arrive over the network and the controls
 * cannot be live until they have. Typing synchronously on mount would assert
 * against whatever the pending state happens to be.
 */
export async function typeCoordinate(point: { lat: string; long: string }) {
  requireCoordinateControls();
  await waitFor(() => {
    expect(
      screen.getByLabelText(LABEL.latitude),
      "the latitude control never became live: either the settings read did not settle, or it took the fail-closed branch",
    ).toBeEnabled();
  });

  expect(typeAsUser(LABEL.latitude, point.lat), "the latitude control refused the keystroke").toBe(
    true,
  );
  expect(
    typeAsUser(LABEL.longitude, point.long),
    "the longitude control refused the keystroke",
  ).toBe(true);

  // AND THE VALUE STUCK. A controlled input whose onChange goes nowhere takes
  // the event and re-renders with the old value, which publishes an empty
  // coordinate while this helper reports success.
  expect((screen.getByLabelText(LABEL.latitude) as HTMLInputElement).value).toBe(point.lat);
  expect((screen.getByLabelText(LABEL.longitude) as HTMLInputElement).value).toBe(point.long);
}

/** `<#place>`, reached the way a reader reaches it rather than by fragment
 *  name: a `<#place>` nothing points at is a place no consumer can navigate to,
 *  which is the same defect `geoNodeOf` above exists to avoid. */
export const placeNodeOf = (quads: Quad[], url: string): string | undefined =>
  oneObject(quads, `${url}#it`, SCHEMA.contentLocation)?.value;

/** `<#address>`, reached through the place for the same reason. */
export function addressNodeOf(quads: Quad[], url: string): string | undefined {
  const place = placeNodeOf(quads, url);
  return place === undefined ? undefined : oneObject(quads, place, SCHEMA.address)?.value;
}

/** What a control is SHOWING, whichever element it turned out to be. The
 *  country field may reasonably be a `<select>` of codes and the others text
 *  inputs; every one of them answers `.value`. */
export const shownValue = (label: RegExp) =>
  (screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
    .value;

/** The three controls, named so a failure says which one — `requireCoordinateControls`'s
 *  reasoning exactly: a `waitFor` or a `setText` against a label that does not
 *  exist spends a timeout and then reports a dump of the whole form, which
 *  reads like a broken query rather than like a missing control. */
export function requirePlaceControls() {
  for (const [what, label] of [
    ["place name", LABEL.placeName],
    ["locality", LABEL.locality],
    ["country", LABEL.country],
  ] as const) {
    expect(
      screen.queryAllByLabelText(label),
      `the editor has no ${what} control`,
    ).toHaveLength(1);
  }
}

/** Every literal with nothing in it, by predicate. `""@en` is not a name, a
 *  locality or a country: it is a triple that renders as blank everywhere and
 *  reads as "this entry claims to be somewhere called nothing". */
export const emptyLiteralsIn = (quads: Quad[]): string[] =>
  quads
    .filter((q) => q.object.termType === "Literal" && q.object.value === "")
    .map((q) => q.predicate.value);

/** The wall clock every create below types, so "unchanged" has one spelling. */
export const OFFSET_WALL = "2026-04-02T16:20";

/** A literal offset as a pattern `setChoice` can match against an option's text
 *  or its value. `+` is a regex metacharacter; a bare `new RegExp("+05:45")`
 *  throws, and a hand-escaped literal per test is how one of them ends up
 *  matching the wrong row. */
export const offsetPattern = (offset: string) => new RegExp(offset.replace("+", "\\+"));

/**
 * The control, named so a failure says so — `requirePlaceControls`' reasoning
 * exactly: a `setChoice` against a label that does not exist spends a query and
 * then dumps the whole form, which reads like a broken test rather than like a
 * missing control.
 *
 * IT ASSERTS THE ELEMENT, WHICH IS THE ONE SHAPE DECISION THIS SECTION MAKES.
 * A `<select>` over a fixed list is what makes `+05:45` and `+08:45` reachable
 * and `+05:61` unreachable; a text box or a number input admits both, and a
 * stepper of hours admits neither of the first two.
 */
export function requireOffsetControl(): HTMLSelectElement {
  const found = screen.queryAllByLabelText(LABEL.offset);
  expect(found, "the editor has no UTC-offset control").toHaveLength(1);
  expect(
    found[0].tagName,
    "the offset control is not a <select>: a free-text or numeric control cannot offer +05:45 without also admitting +05:61",
  ).toBe("SELECT");
  return found[0] as HTMLSelectElement;
}

export const offsetOptions = () => [...requireOffsetControl().options].map((o) => o.value);

export const SCENARIOS = {
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
 * The key scheme, `wig.draft.v2.<webId>.<scope>`.
 *
 * Three parts, three failures they prevent: the VERSION so a future shape can
 * be given a new one instead of half-restoring a payload it cannot use; the
 * WEBID so one machine with two accounts does not hand the second person the
 * first person's unfinished text; the SCOPE so the entry being created and the
 * entry being edited are different drafts.
 *
 * **`v1` → `v2` ON 2026-09-06, WHICH IS THE VERSION SEGMENT DOING ITS JOB.**
 * The draft was exactly nine fields; the coordinate controls (section 1) make
 * it twelve, and a `v1` payload restored into the new form would fill nine of
 * them and leave a coordinate the owner never typed — or, worse, leave the
 * three new fields undefined and have the editor read them as empty while the
 * banner claimed the draft was restored. Invisible is the correct outcome for a
 * payload whose shape has moved on, and it is what `lib/studio/drafts.ts` says
 * the segment is for: "a future shape can be given v2 and this one's payloads
 * become invisible rather than half-restorable". Section 8h pins it, with the
 * allow-case: the same bytes under the current key ARE offered.
 */
export const draftKeyFor = (webId: string, scope: string) => `wig.draft.v2.${webId}.${scope}`;

/** The key a build before 2026-09-06 wrote. Used only to prove it is ignored. */
export const legacyDraftKeyFor = (webId: string, scope: string) => `wig.draft.v1.${webId}.${scope}`;

/** The scope of a create — there is no resource yet to name. */
export const NEW_SCOPE = "new";

/**
 * Exactly the seventeen fields, sorted. An eighteenth is how the ETag gets in.
 *
 * NINE UNTIL 2026-09-06. `lat`, `long` and `precision` arrived with the
 * coordinate controls, and they are the reason the key moved to `v2`. All three
 * hold what the FORM holds — strings, empty when nothing has been typed and
 * when no precision could be preset — rather than what the Pod would get; see
 * section 8h for the decision and its justification.
 *
 * `placeName`, `locality` AND `country` ARRIVED WITH THE PLACE CONTROLS
 * (section 1b), AND THE KEY DID NOT MOVE FOR THEM EITHER — the same answer as
 * `photos`, for the same reason: no existing `v2` payload can carry a place
 * name, because there was no control to type one into, so such a draft
 * restores three empty boxes rather than three defaults standing in for
 * something lost. Section 8i owns that decision.
 *
 * `photos` ARRIVED WITH THE PICKER (section 10) AND THE KEY DID NOT MOVE, which
 * is the same version test answered the other way: no `v2` payload can carry a
 * photo, because there was no control to attach one with, so an older draft
 * restores an empty list rather than a half-restore. It is here — and therefore
 * required in every draft this editor writes, including the ones written by the
 * tests above that pick nothing — because the FENCE is what this set is: a key
 * the editor forgets is a photo it silently stops restoring, and an extra one
 * is how the ETag gets in.
 *
 * `offset` ARRIVED WITH THE UTC-OFFSET CONTROL (section 1c) AND THE KEY DID NOT
 * MOVE FOR IT EITHER — the third time that test is answered "no", for the same
 * reason: no existing `v2` payload can carry an offset, because there was no
 * control to choose one with, so such a draft restores `""` and the editor
 * falls back to exactly the chain it used before the control existed. Section
 * 8j owns that decision. It is a form value like `occurred` beside it and not a
 * derived one, which is the whole change: until 1c the offset was the entry's
 * own or, failing that, the editing MACHINE'S, and a draft that dropped it
 * would hand the owner back that same silent guess.
 */
export const DRAFT_FIELDS = [
  "country",
  "headline",
  "lat",
  "locality",
  "long",
  "mode",
  "occurred",
  "offset",
  "photos",
  "placeName",
  "precision",
  "savedAt",
  "slug",
  "status",
  "story",
  "tagsText",
  "tripIri",
];

/** What the editor must have persisted, as it comes back out of JSON. */
export type StoredDraft = {
  tripIri: string;
  slug: string;
  headline: string;
  story: string;
  occurred: string;
  /** The offset of the PLACE, as the owner chose it — section 1c. Held beside
   *  the wall clock rather than folded into it, because the control the owner
   *  types the time into has no offset at all. */
  offset: string;
  tagsText: string;
  mode: string;
  status: string;
  /** As typed, not as published — section 8h. */
  lat: string;
  long: string;
  /** The precision control's value, in metres, as a string: it is a form value
   *  like the rest, and "" is what there is to keep when the settings could not
   *  be read and the control was never live. */
  precision: string;
  /** The three place-text controls (section 1b), as the FORM holds them:
   *  strings, empty when nothing has been typed. `""` is not the same
   *  instruction as absent — see 1b on removal versus untouched. */
  placeName: string;
  locality: string;
  country: string;
  /**
   * The photos already on the Pod — section 10's picker uploads on pick, so a
   * draft holds URLs and JSON and never a Blob.
   *
   * SEEDED EMPTY EVERYWHERE IN THIS SECTION, AND SEEDED AT ALL FOR A REASON:
   * the failed-save pair below asserts `Object.keys` against `DRAFT_FIELDS` on
   * "whichever copy is at the key, the seeded one or one the live window
   * wrote". A seed that was a field short would make that assertion a race
   * between two shapes rather than a statement about a restorable draft.
   */
  photos: Photo[];
  savedAt: string;
};

export const seededDraft = (over: Partial<StoredDraft> = {}): StoredDraft => ({
  tripIri: JAPAN.iri,
  slug: "2026-04-02-kyoto",
  headline: "Rain on the Philosopher's Path",
  story: "Two hours of drizzle and nobody else on the path.",
  occurred: "2026-04-02T16:20",
  // This machine's zone, which is what a create starts at — the interesting
  // values are 8j's, where the offset is the subject rather than the setting.
  offset: "+09:00",
  tagsText: "walking, rain",
  mode: "Train",
  status: "published",
  // Empty by default: most of this section is about text, and a draft with no
  // coordinate in it is the common one — the owner types the story first.
  lat: "",
  long: "",
  precision: "500",
  // Empty by default, like the coordinate above: a draft that names no place is
  // the ordinary one. Present rather than absent because `DRAFT_FIELDS` is
  // asserted against whichever copy is at the key, and a seed a field short
  // would make that assertion a race between two shapes.
  placeName: "",
  locality: "",
  country: "",
  photos: [],
  savedAt: "2026-04-02T19:00:00+09:00",
  ...over,
});

/** A storage whose contents are inspectable and whose failures are scripted. */
export function fakeStorage(initial: Record<string, string> = {}) {
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

/**
 * THE DEBOUNCE THIS FILE DRIVES. Pinned against the editor's own export in the
 * first test below, so the two cannot drift apart silently — an implementer who
 * changes the interval changes both, deliberately.
 */
export const DEBOUNCE = 800;

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
export const TIMERS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const;

/** The module is imported while timers are still real, so nothing in vitest's
 *  loader can be waiting on a clock that has stopped. */
export async function withFakeTimers(at: Date) {
  await loadEditor();
  vi.useFakeTimers({ toFake: [...TIMERS] });
  vi.setSystemTime(at);
}

export const tick = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

/** Two instants seven and a half minutes apart, in UTC. Asia/Tokyo is fixed at
 *  the top of this file, so the +09:00 spellings below fail on a bare `Z`. */
export const FIRST = new Date("2026-04-02T10:00:00.000Z");

export const SECOND = new Date("2026-04-02T10:07:31.000Z");

export const FIRST_STAMP = "2026-04-02T19:00:00+09:00";

export const SECOND_STAMP = "2026-04-02T19:07:31+09:00";

export const parseDraft = (value: string) => JSON.parse(value) as Record<string, unknown>;

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
export function typeAsUser(label: RegExp, value: string): boolean {
  const el = screen.getByLabelText(label);
  if (el.matches(":disabled")) return false;
  fireEvent.change(el, { target: { value } });
  return true;
}

/**
 * The photo control's accessible name.
 *
 * IT MOVED INTO `LABEL` WITH THE PICKER, as the note here asked: 8b's shadowing
 * loop iterates `Object.entries(LABEL)` and demands exactly one match per entry,
 * which is exactly the guard this control wants — a `<section
 * aria-label="Photos">` wrapper would otherwise shadow the file input and the
 * failure would read "found multiple elements" from inside `fillNewEntry`. This
 * alias is kept so the tests below read as they were written.
 */
export const PHOTOS_LABEL = LABEL.photos;

/**
 * A real JPEG with real EXIF, built byte by byte by test/fixtures/exif-jpeg.ts.
 *
 * Not an empty `new File([], …)`: the container path is `sha256(source)[0..16]`
 * and the metadata read is over these bytes, so a file with no bytes would make
 * both of those vacuous.
 */
export const jpegFile = (name: string) => {
  // Copied out of the view rather than passed straight in, the same way
  // test/media-exif.test.ts's `bytesOf` does it: `exifJpeg` returns
  // `Uint8Array<ArrayBufferLike>`, and `BlobPart` demands `ArrayBuffer` — a
  // SharedArrayBuffer could not back a Blob, so tsc refuses the wider type.
  const bytes = exifJpeg({ orientation: 1, dateTimeOriginal: "2026:03:29 21:38:02" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new File([buffer], name, { type: "image/jpeg" });
};

/** Distinctive and tiny, so "which blob reached the Pod" is answerable by
 *  length alone — and so neither can be confused with the source JPEG. */
export const WEB_BYTES = [0x57, 0x45, 0x42, 0x50, 0x21];

export const THUMB_BYTES = [0x54, 0x48, 0x21];

/** Inside BLUR_BUDGET_BYTES. It rides in the entry's Turtle and in the draft's
 *  JSON, which is the whole reason a placeholder is a string and not bytes. */
export const BLUR =
  "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

export const blobOf = (bytes: number[], type: string) => new Blob([new Uint8Array(bytes)], { type });

/**
 * A pipeline that succeeds, with output nobody has to guess at.
 *
 * `metadata` comes from the REAL `readMetadata` over the REAL file bytes rather
 * than from a literal: the fake's job is to stand in for the worker, not to
 * stand in for the EXIF reader, and a hand-written metadata object would let a
 * GPS wire be built against a shape lib/media/exif.ts does not produce.
 */
export function fakePipeline() {
  const processed: number[] = [];
  const disposals: number[] = [];
  const pipeline: Pipeline = {
    async process(file: Blob): Promise<PipelineResult> {
      const bytes = await file.arrayBuffer();
      processed.push(bytes.byteLength);
      return {
        web: { blob: blobOf(WEB_BYTES, "image/webp"), width: 1600, height: 1067 },
        thumb: { blob: blobOf(THUMB_BYTES, "image/webp"), width: 400, height: 267 },
        blurDataUrl: BLUR,
        metadata: readMetadata(bytes),
      };
    },
    dispose() {
      disposals.push(Date.now());
    },
  };
  return { pipeline, processed, disposals };
}

/**
 * The one global media container (§4), at the HTTP layer.
 *
 * THE REQUEST BODY IS NOT RECORDED, AND CANNOT USEFULLY BE. Measured, not
 * assumed: a jsdom `Blob` handed to the fetch this environment provides arrives
 * at the handler as the nine bytes of the string `"undefined"` — verified
 * against a real `uploadPhoto` call before this section was written. So no
 * assertion about uploaded BYTES is possible here for any implementation, and
 * one that looked like it worked would be asserting on that string. What
 * survives is what the URL and the headers say, which is where the rules live
 * anyway: the container is content-addressed from the source, the file name and
 * the content type come from the DERIVATIVE's blob (never from what was asked
 * for), and every write carries `If-None-Match: *`.
 */
export function mediaFake(script: { status?: number } = {}) {
  const puts: { url: string; headers: Record<string, string> }[] = [];
  server.use(
    http.put(`${POD}/travel/media/:hash/:file`, ({ request }) => {
      const headers: Record<string, string> = {};
      request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
      puts.push({ url: request.url, headers });
      return new HttpResponse(null, {
        status: script.status ?? 201,
        headers: { etag: '"media-1"' },
      });
    }),
  );
  return {
    puts,
    /** The file names, since the hash is the file's business and not this
     *  test's — and the names are derived from the blob's type, so they are
     *  also how "a derivative was uploaded" is told from "the JPEG was". */
    names: () => new Set(puts.map((p) => new URL(p.url).pathname.split("/").pop()!)),
    containers: () => [...new Set(puts.map((p) => new URL(p.url).pathname.replace(/[^/]+$/, "")))],
  };
}

export const pickPhoto = (file: File) => {
  const input = screen.getByLabelText(PHOTOS_LABEL);
  fireEvent.change(input, { target: { files: [file] } });
};

export type Gps = NonNullable<ExifOptions["gps"]>;

/** Exactly the EXIF `jpegFile` writes, so the only difference between these
 *  fixtures and stage 1's is the GPS block. */
export const EXIF_BASE = { orientation: 1, dateTimeOriginal: "2026:03:29 21:38:02" } as const;

/** `jpegFile`'s own copy-out-of-the-view dance, and for its reason: `exifJpeg`
 *  returns `Uint8Array<ArrayBufferLike>` and `BlobPart` demands `ArrayBuffer`. */
export const gpsBytes = (gps: Gps): ArrayBuffer => {
  const bytes = exifJpeg({ ...EXIF_BASE, gps });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

/**
 * What the REAL reader returns for those bytes — the oracle for every "the
 * values are the photo's" assertion below.
 *
 * THROWS RATHER THAN RETURNING `undefined`, at module load, for
 * `mutateSettings`' reason: a fixture that stopped carrying a coordinate would
 * otherwise serve `undefined` to a test about auto-fill and the test would
 * report a green "nothing was filled".
 */
export function gpsOf(gps: Gps): { lat: number; long: number } {
  const read = readMetadata(gpsBytes(gps)).gps;
  if (read === undefined) {
    throw new Error("a section 11 GPS fixture carries no coordinate lib/media/exif.ts will accept");
  }
  return read;
}

/** Tokyo, 35°41'37.68"N 139°42'12.24"E — test/media-exif.test.ts's own
 *  fixture, and the §7.3 entry's place. The FIRST photo nearly everywhere
 *  below. */
export const GPS_TOKYO: Gps = {
  latRef: "N",
  lat: [[35, 1], [41, 1], [3768, 100]],
  longRef: "E",
  long: [[139, 1], [42, 1], [1224, 100]],
};

export const TOKYO = gpsOf(GPS_TOKYO);

/** How a picked file shows up on screen, with the dot escaped: `beach.jpg`
 *  unescaped would also match `beachXjpg`, which is harmless, and would not
 *  match at all if the name ever contained a `+`. */
export const alt = (file: File) => new RegExp(file.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/**
 * THE SETTINGS HAVE LANDED — not "a render happened".
 *
 * `typeCoordinate`'s first half, factored out because most of this section does
 * not type: the photo does the typing. It is the delta's FIRST trap, which has
 * already made two pins in this file vacuous this stage — §7.6 arrives over MSW
 * mid-flight, so a test that asserts on a save cycle can end up measuring the
 * settings arriving rather than the behaviour under test.
 *
 * TWO CHECKS, AND THE SECOND IS THE ONE THAT CANNOT BE FAKED BY A PENDING
 * STATE. `toBeEnabled()` alone would also hold for a build that never gated the
 * controls; the precision showing §7.6's own 500 can only happen after
 * `readPrivacySettings` resolved, because this app supplies no fallback for
 * `dy:defaultPrecisionMeters` (§7.6: "required outright").
 */
export async function awaitLiveCoordinateControls() {
  requireCoordinateControls();
  await waitFor(() => {
    for (const [what, el] of coordinateControls()) {
      expect(
        el,
        `the ${what} control never became live: either the settings read did not settle, or it took the fail-closed branch`,
      ).toBeEnabled();
    }
  });
  expect(
    shownValue(LABEL.precision),
    "the precision control is live but is not showing §7.6's own default: the settings had not landed when this test started",
  ).toBe("500");
}

/** Pick a photo and wait until it has SETTLED, which is the state `attach`
 *  reaches `ready` in and therefore the only state auto-fill can key on: both
 *  derivatives on the Pod, and the row showing it from the Pod rather than from
 *  a `blob:` URL (10a's assertion). */
export async function pickAndSettle(file: File, media: ReturnType<typeof mediaFake>) {
  const before = media.puts.length;
  pickPhoto(file);
  await screen.findByRole("img", { name: alt(file) });
  await waitFor(() => expect(media.puts).toHaveLength(before + 2));
}

/** What a control announces as its description, with every IDREF it names
 *  proved to resolve first. Both halves, because a dangling id computes to ""
 *  and the failure would otherwise read "no note" (8e-bis's measurement). */
export function describedTextOf(label: RegExp): string {
  const el = screen.getByLabelText(label);
  for (const id of describedByIdsOf(el)) {
    expect(
      document.getElementById(id),
      `the ${String(label)} control points aria-describedby at "${id}", which nothing has`,
    ).not.toBeNull();
  }
  return el.getAttribute("aria-describedby") === null
    ? ""
    : describedByIdsOf(el)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * EXIF that varies the TIME rather than the GPS — `jpegWithGps`'s builder with
 * the whole option bag exposed, because this section's fixtures differ in which
 * of `DateTimeOriginal`, `OffsetTimeOriginal` and GPS they carry.
 *
 * Additive on purpose: section 11's `gpsBytes`/`jpegWithGps` are left exactly
 * as they are rather than refactored through this, so nothing in section 11
 * moves for a section 12 change.
 */
export const exifBytes = (options: ExifOptions): ArrayBuffer => {
  // `jpegFile`'s copy-out-of-the-view dance, for its reason: `exifJpeg` returns
  // `Uint8Array<ArrayBufferLike>` and `BlobPart` demands `ArrayBuffer`.
  const bytes = exifJpeg(options);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

export const jpegWithExif = (name: string, options: ExifOptions): File =>
  new File([exifBytes(options)], name, { type: "image/jpeg" });

/** What the REAL reader makes of those bytes — the oracle for every "the value
 *  is the photo's" assertion below, for `fakePipeline`'s reason: the fake's job
 *  is to stand in for the worker, not for the EXIF reader. */
export const metadataOf = (options: ExifOptions) => readMetadata(exifBytes(options));

/**
 * THROWS AT MODULE LOAD rather than returning `undefined`, `gpsOf`'s reason
 * exactly: a fixture that stopped carrying a date would otherwise serve
 * `undefined` to a test about auto-dating, and the test would report a green
 * "nothing was filled".
 */
export function fromFixture<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new Error(`a section 12 EXIF fixture carries no ${what} lib/media/exif.ts will accept`);
  }
  return value;
}

/**
 * 11 April 2026, five past seven in the morning, EXIF spelling.
 *
 * CHOSEN FOR THREE PROPERTIES, all asserted by the control below rather than
 * eyeballed: it is not the §7.3 fixture's wall clock, not what `fillNewEntry`
 * types and not what `seededDraft` carries — so "the box changed" is never a
 * coincidence; and 07:05 at `+09:00` is the PREVIOUS DAY in UTC, so an
 * implementation that normalised the wall clock through a `Date` moves the date
 * and not merely the hour.
 */
export const EXIF_WHEN = "2026:04:11 07:05:33";

/** A phone that wrote the time and not the zone — the common case, and the
 *  whole reason §11.5 exists. No GPS either: scenario 6's first leg. */
export const TIMED: ExifOptions = { orientation: 1, dateTimeOriginal: EXIF_WHEN };

/** A camera with a GPS and an unset clock: scenario 6's second leg. */
export const PINNED_ONLY: ExifOptions = { orientation: 1, gps: GPS_TOKYO };

/**
 * A SECOND PHONE, AND NEITHER OF ITS TWO TAGS IS THE FIRST'S — the fixture 12h
 * needs and the one this suite did not have. `TIMED_WITH_OFFSET` was the ONLY
 * fixture in the whole file carrying `offsetTimeOriginal`, so a second photo
 * built from it would arrive with the same wall clock and the same zone as the
 * first: "the first photo's value survived" would then be satisfied by the
 * second photo winning, which is the shape 12h exists to catch.
 *
 * `+12:45` IS THE CHATHAMS, this file's established third value — on the offset
 * control's list (12f chooses it by hand) and neither this machine's zone nor
 * `TIMED_WITH_OFFSET`'s. That is what lets it discriminate in 12d's third leg,
 * where the entry's stored `+05:45` is BYTE-IDENTICAL to the first photo's tag
 * and the obvious fixture substitution would have proved nothing.
 */
export const SECOND_WHEN = "2026:04:12 18:20:07";

export const TIMED_WITH_OTHER_OFFSET: ExifOptions = {
  orientation: 1,
  dateTimeOriginal: SECOND_WHEN,
  offsetTimeOriginal: "+12:45",
};

/**
 * A PHONE THAT WROTE THE ZONE AND NOT THE CLOCK — 12i's first photo, and the
 * fixture the mirror case cannot be written without.
 *
 * LEGAL IN EXIF AND READ INDEPENDENTLY: `lib/media/exif.ts` guards 0x9003 and
 * 0x9011 separately, so `{ offsetTimeOriginal }` with no `dateTimeOriginal` is
 * what arrives here. MEASURED THROUGH THE REAL READER by the control below,
 * not assumed — a fixture the reader dropped whole would make 12i's first pick
 * a no-op, and the mirror a claim about a form nothing had touched.
 */
export const OFFSET_ONLY: ExifOptions = { orientation: 1, offsetTimeOriginal: "+12:45" };

/**
 * A CAMERA WHOSE ZONE TAG IS NOT A ZONE — 12k's fixture (F4).
 *
 * `lib/media/exif.ts` validates `OffsetTimeOriginal` by SHAPE ALONE
 * (`/^[+-]\d{2}:\d{2}$/` at exif.ts:38,105) and the editor's own
 * `OFFSET_SHAPE` is the same loose regex, so `+99:99` is a value the whole
 * chain accepts and only `Entry.safeParse` refuses — which is at the very end
 * of it, after the control has been filled and the owner has pressed Save.
 *
 * `+99:99` RATHER THAN SOMETHING SUBTLER, so the failure cannot be mistaken for
 * a rounding question: `offsetMinutes("+99:99")` is 6 039, seven times the
 * ±840 that exists. Measured against this repo's zod 4.5.4, on the timestamp
 * this fixture composes: `+99:99` FAIL, `+30:00` FAIL, `+23:59` PASS,
 * `+05:15` PASS — so the schema's fence is not at ±840 either, and a fixture
 * inside 24 hours would pass validation and prove nothing.
 *
 * BUILT ON `TIMED`, WHICH IS LOAD-BEARING TWICE. A wall clock has to reach the
 * form for `toOffsetDateTime` to have anything to concatenate the bad offset
 * onto — with no clock, `occurredAt` is `undefined`, the entry validates and
 * the save succeeds, so the outcome this test is about is unreachable. And it
 * makes the DATE half the allow-case: the photo still dates the entry.
 */
export const OFFSET_OUT_OF_RANGE: ExifOptions = { ...TIMED, offsetTimeOriginal: "+99:99" };

/**
 * ONE FILE NAME, TWO PHOTOS — 12j's fixture (F1), and the whole test rests on
 * the collision, so the name is a constant rather than typed twice.
 *
 * `IMG_0001.jpg` IS THE ORDINARY CASE, not a contrived one: it is what every
 * camera in the world calls its first photo, so two cameras on one day's walk
 * collide by default. `PhotoSlot`'s own docblock says so in as many words —
 * "`key` IS NOT THE FILE NAME. Two files picked from two directories can share
 * one" — and the file input is `multiple` with no dedup on name.
 */
export const COLLIDING_NAME = "IMG_0001.jpg";

export const PHOTO_WALL = fromFixture(metadataOf(TIMED).dateTimeOriginal, "DateTimeOriginal");

/** The second photo's two tags, through the same reader for the same reason. */
export const SECOND_WALL = fromFixture(
  metadataOf(TIMED_WITH_OTHER_OFFSET).dateTimeOriginal,
  "second DateTimeOriginal",
);

export const SECOND_OFFSET = fromFixture(
  metadataOf(TIMED_WITH_OTHER_OFFSET).offsetTimeOriginal,
  "second OffsetTimeOriginal",
);

/**
 * THE OUT-OF-RANGE TAG, THROUGH THE REAL READER — and `fromFixture` is the
 * point rather than the plumbing here: if `lib/media/exif.ts` ever range-checks
 * `OffsetTimeOriginal` itself, this throws at module load and says so, instead
 * of 12k reporting a green "the editor refused it" about a value the reader had
 * already dropped.
 */
export const OUT_OF_RANGE_OFFSET = fromFixture(
  metadataOf(OFFSET_OUT_OF_RANGE).offsetTimeOriginal,
  "out-of-range OffsetTimeOriginal",
);

/**
 * MINUTES ≥ 60 WITH SMALL HOURS — the conjunct F4's range check is missing
 * (closing item 4), and `+99:99` above cannot reach it.
 *
 * `entry-editor.tsx`'s guard is `Math.abs(offsetMinutes(zone)) <= 840`, and
 * `offsetMinutes` reads the two digit pairs separately and never checks either
 * is in range — so `"+05:61"` composes as `5 * 60 + 61 = 361`, inside the
 * fence that stops `+99:99`'s 6 039. `lib/media/exif.ts` only checks shape
 * (`/^[+-]\d{2}:\d{2}$/` at exif.ts:38,105), which two digits of `61` also
 * satisfies. So this value clears every check the chain has before the Pod,
 * and only `Entry.safeParse`'s `z.iso.datetime({ offset: true })` refuses the
 * timestamp it is concatenated onto — measured on this repo's zod 4.5.4,
 * `+05:61` FAILS. That is F4's own defect, reachable again: the control
 * fills, the select offers the value beside real zones, the save is refused,
 * and `announce`'s "did not reach your Pod … try again" is false on every
 * retry.
 *
 * BUILT ON `TIMED`, for the same reason `OFFSET_OUT_OF_RANGE` is: a wall
 * clock has to reach the form for `toOffsetDateTime` to have anything to
 * concatenate the bad offset onto.
 */
export const OFFSET_MINUTES_OUT_OF_RANGE: ExifOptions = { ...TIMED, offsetTimeOriginal: "+05:61" };

/**
 * THE MINUTES-OUT-OF-RANGE TAG, THROUGH THE REAL READER — same reasoning as
 * `OUT_OF_RANGE_OFFSET`: if `lib/media/exif.ts` ever range-checks
 * `OffsetTimeOriginal` itself, this throws at module load rather than letting
 * the test below report a green refusal of a value the reader had already
 * dropped.
 */
export const MINUTES_OUT_OF_RANGE_OFFSET = fromFixture(
  metadataOf(OFFSET_MINUTES_OUT_OF_RANGE).offsetTimeOriginal,
  "minutes-out-of-range OffsetTimeOriginal",
);

/** This machine's zone. Asia/Tokyo is fixed at the top of this file and checked
 *  by a control in section 0; written out rather than computed so that an
 *  editor which read the machine where it should have read the photo cannot
 *  agree with the expectation by construction. */
export const MACHINE_OFFSET = "+09:00";

/**
 * WHAT THE `datetime-local` CONTROL MAY READ BACK for a wall clock the editor
 * put in it — the set of honest spellings, measured on jsdom 30.0.1 (see the
 * section docblock) and re-measured by the control below.
 *
 * Truncating the photo's seconds and keeping them are both defensible, and
 * `toOffsetDateTime`'s `LOCAL_DATETIME` accepts either. What is NOT in the set
 * is `""`, anything shifted, and anything with an offset on it.
 */
export const wallClockShapes = (wall: string): string[] => [wall.slice(0, 16), wall, `${wall}.000`];

/**
 * THE UNCONFIRMED MARK, READ AS A STATE AND NEVER AS A SENTENCE. See the
 * section docblock for why a role and a wording match are both ruled out, and
 * for the deal an implementer who spells this differently gets.
 *
 * ON THE CONTROL ITSELF, because the control is what holds the value in doubt.
 * A mark on a wrapper is reported as a named failure rather than read as
 * "absent" — a rule tested at the wrong node proves nothing, and this helper
 * returning a quiet `false` for a mark that IS in the document is exactly how
 * that would look.
 */
export const OFFSET_GUESS_ATTR = "data-offset-unconfirmed";

export function offsetMarkedAsGuess(): boolean {
  const el = requireOffsetControl();
  const raw = el.getAttribute(OFFSET_GUESS_ATTR);
  expect(
    [null, "", "true", "false"],
    `the offset control's ${OFFSET_GUESS_ATTR} reads ${JSON.stringify(raw)}, which is neither present nor absent: nothing below can tell the two states apart`,
  ).toContain(raw);
  if (raw === null) {
    expect(
      document.querySelectorAll(`[${OFFSET_GUESS_ATTR}]`).length,
      `nothing on the offset control carries ${OFFSET_GUESS_ATTR}, but something else in the form does: the mark is on a wrapper, and a wrapper is not what holds the value in doubt`,
    ).toBe(0);
  }
  return raw === "" || raw === "true";
}

/**
 * WHAT THE NOTE HAS TO SAY, loose on purpose and — like `LABEL` — this file's
 * proposal rather than its subject. The brief's scenario 3: the note names the
 * photo "and the fact that the offset is not from it".
 *
 * IT IS THE WEAKER OF THE TWO CONTENT FENCES AND IS NEVER USED ALONE. 12c
 * asserts it does not match the control's PERMANENT hint first, in the same
 * render, because that hint already says "not of wherever you are writing
 * this" and a regex that caught it would pass in every state.
 */
export const GUESS_WORDING =
  /not from|no (utc )?(offset|time ?zone)|(this|the editing|your) (machine|computer|browser|device|laptop|zone)|where you are writing/i;

/* ═══════════════════════════════════════════════════════════════ lifecycle ══ */

/** Called by each suite itself; a side-effecting import registers against the
 *  wrong file. Not `use`-prefixed: ./notes.md#why-it-is-not-called-useeditorlifecycle */
export function registerEditorLifecycle() {
  beforeEach(() => {
    resetSessionRestore();
    /**
     * §7.6, SERVED FOR EVERY TEST IN THIS FILE, valid unless a test says
     * otherwise.
     *
     * The editor reads the settings on mount — it has to, since the coordinate
     * controls are disabled or live depending on the answer, and "accept the
     * input and refuse at save time" is the posture §9 rules out. So every render
     * below issues this GET, including the forty-odd tests that have nothing to
     * do with coordinates, and an unhandled request throws (test/setup.ts).
     *
     * Registered here rather than inside `podFake` because most of those renders
     * never call `podFake`. Where a test does, its own handler is registered
     * later and msw's `use()` prepends, so the script wins — verified in
     * node_modules/msw/lib/core/experimental/handlers-controller.mjs, where
     * `use()` puts the new handlers in front of the existing ones.
     */
    server.use(
      http.get(SETTINGS_URL, () =>
        HttpResponse.text(PRIVACY_TTL, {
          headers: { "content-type": "text/turtle", etag: '"settings-1"' },
        }),
      ),
    );
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
}

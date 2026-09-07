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

import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { StrictMode } from "react";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { Parser, type Quad, type Term } from "n3";
import { DCTERMS, DY, GEO, RDF, SCHEMA, SCHEMA_VERSION, STATUS, TRAVEL_MODE, XSD } from "@/lib/vocab";
import { readEntry, readPrivacySettings } from "@/lib/pod/read";
// Section 1's ORACLE, not its subject: the snapped values are hard-coded and
// this is what ties them to the grid that produced them, in one control test.
import { snapToPrecision } from "@/lib/pod/fuzz";
// Aliased — `describe` is vitest's here. Used to print a structured PodError
// when a control fails, so the message names the read rather than "false".
import { describe as describeError } from "@/lib/pod/result";
import { TAGS } from "@/lib/pod/tags";
import { resetSessionRestore, type StudioSessionLike } from "@/lib/studio/session";
import { triples } from "./graph";
import { server, servePod } from "./msw";
import { Photo, Place } from "@/lib/pod/schema";
import type { Entry } from "@/lib/pod/schema";
/* Section 10. The picked file is a real JPEG with real EXIF, built byte by byte
   by the same fixture test/media-exif.test.ts reads back — so the container
   hash and the metadata read are over bytes rather than over an empty File. */
import { exifJpeg } from "./fixtures/exif-jpeg";
import { readMetadata } from "@/lib/media/exif";
/* Section 10e's duplicate case needs the container a given file hashes to, and
   the real functions rather than a literal: a hardcoded hash would still pass
   the day the digest changed, against an editor that had stopped deduplicating. */
import { mediaContainer, mediaHash } from "@/lib/media/upload";
import type { Pipeline, PipelineResult } from "@/lib/media/pipeline";

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
/** §7.6, the owner-only privacy settings. Block 6: diary, trip, entry, index,
 *  profile, type index, privacy — the same index test/privacy-settings.test.ts
 *  takes it from. */
const PRIVACY_TTL = BLOCKS[6];

/** Guard the extraction: if the §7 numbering shifts, every test below would
 *  otherwise run silently against the wrong block. */
if (!ENTRY_TTL?.includes("dy:Entry") || !INDEX_TTL?.includes("dy:TripIndex")) {
  throw new Error("docs/data-model.md §7.3/§7.4 blocks not found at the expected index");
}
if (!PRIVACY_TTL?.includes("dy:homeRadiusMeters")) {
  throw new Error("docs/data-model.md §7.6 block not found at the expected index");
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
/** The place the §7.3 entry names, and the coordinate it already carries —
 *  fuzzed to 500 m when it was stored, which is why it is allowed to be there. */
const SPEC_PLACE_NAME = "Shinjuku, Tokyo";
/** The rest of §7.3's address: prose and a code, and the two are written
 *  differently on purpose (section 1b). */
const SPEC_LOCALITY = "Tokyo";
const SPEC_COUNTRY = "JP";

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
const SETTINGS_URL = `${POD}/travel/settings/privacy.ttl`;

/**
 * A mutation of the normative block, guarded twice — the anchor must be found,
 * and the edit must change the GRAPH rather than the bytes. Lifted from
 * test/privacy-settings.test.ts, which states the reason: a negative test built
 * by string-replacing a fixture passes the *unmodified* fixture the day the
 * anchor drifts, and does it silently. Both guards throw at module load.
 */
function mutateSettings(from: string | RegExp, to: string): string {
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
const NO_HOME_TTL = mutateSettings(
  /\s*dy:homeLat[^;]*;\s*dy:homeLong[^;]*;\s*dy:homeRadiusMeters[^;]*;/,
  "",
);

/** A half-written home region: two of the three values. §7.6 — "a reader that
 *  treats an absent dy:homeRadiusMeters as zero has no home region at all, and
 *  publishes coordinates from the owner's doorstep while reporting success". */
const HALF_HOME_TTL = mutateSettings(/\s*dy:homeRadiusMeters[^;]*;/, "");

/** Same document, a different default precision. Exists so that "the preset
 *  comes from the settings" can be shown to be a READ rather than a constant
 *  that happens to equal the fixture's 500. */
const PRECISION_2000_TTL = mutateSettings("dy:defaultPrecisionMeters 500", "dy:defaultPrecisionMeters 2000");

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
const TYPED = { lat: "35.026345", long: "135.794782" } as const;

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
const SNAP_500 = { lat: 35.02423, long: 135.79207 };
const SNAP_2000 = { lat: 35.018, long: 135.7906 };
const SNAP_10KM = { lat: 35.0649, long: 135.8242 };

/** Inside §7.6's home region — 285 m from the centre of a 3 km radius. */
const INSIDE_HOME = { lat: "45.466102", long: "9.190154" } as const;
/** 5.9 km from the same centre: outside it, and the allow-case that stops
 *  "drops everything" from passing the drop test. */
const OUTSIDE_HOME = { lat: "45.515500", long: "9.210300" } as const;
const SNAP_OUTSIDE_500 = { lat: 45.51486, long: 9.20856 };

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
const LABEL = {
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
    // The family query is now used the other way round — section 1 asserts it
    // finds EXACTLY the three controls the editor is meant to have, so a fourth
    // coordinate-ish input cannot appear unnoticed. It still has to be a query
    // that resolves something, and it still has to resolve nothing on a tree
    // with no coordinate field in it; both halves are measured here rather than
    // assumed, exactly as they were when the pin they served was the opposite.
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

/** The `#geo` node, reached the way a reader reaches it: `<#it>` →
 *  `schema:contentLocation` → `#place` → `schema:geo`. Resolving it by fragment
 *  name would also find a `<#geo>` node that nothing points at, which is a
 *  coordinate published into a document no consumer can navigate. */
function geoNodeOf(quads: Quad[], url: string): string | undefined {
  const place = oneObject(quads, `${url}#it`, SCHEMA.contentLocation)?.value;
  return place === undefined ? undefined : oneObject(quads, place, SCHEMA.geo)?.value;
}

/** One entry's row in the index, found by `dy:entryResource` rather than by
 *  fragment name: the fragment is the serialiser's business, the pointer is the
 *  contract (§7.4). */
function indexRowOf(body: string, indexUrl: string, entryUrl: string) {
  const quads = quadsOf(body, indexUrl);
  const row = quads.find(
    (q) => q.predicate.value === DY.entryResource && q.object.value === `${entryUrl}#it`,
  )?.subject.value;
  return { quads, row };
}

/** Every id an element points its description at. An association that resolves
 *  is the difference between a reason a screen reader announces and one that
 *  computes to the empty string — see the control at the end of section 8. */
const describedByIdsOf = (el: Element): string[] =>
  (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id !== "");

/** The three controls, named so a failure says which one. */
const coordinateControls = () =>
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
function requireCoordinateControls() {
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
const NO_SETTINGS_REASON = /settings|privacy|home region/i;

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
async function typeCoordinate(point: { lat: string; long: string }) {
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

/** `<#place>`, reached the way a reader reaches it rather than by fragment
 *  name: a `<#place>` nothing points at is a place no consumer can navigate to,
 *  which is the same defect `geoNodeOf` above exists to avoid. */
const placeNodeOf = (quads: Quad[], url: string): string | undefined =>
  oneObject(quads, `${url}#it`, SCHEMA.contentLocation)?.value;

/** `<#address>`, reached through the place for the same reason. */
function addressNodeOf(quads: Quad[], url: string): string | undefined {
  const place = placeNodeOf(quads, url);
  return place === undefined ? undefined : oneObject(quads, place, SCHEMA.address)?.value;
}

/** What a control is SHOWING, whichever element it turned out to be. The
 *  country field may reasonably be a `<select>` of codes and the others text
 *  inputs; every one of them answers `.value`. */
const shownValue = (label: RegExp) =>
  (screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
    .value;

/** The three controls, named so a failure says which one — `requireCoordinateControls`'s
 *  reasoning exactly: a `waitFor` or a `setText` against a label that does not
 *  exist spends a timeout and then reports a dump of the whole form, which
 *  reads like a broken query rather than like a missing control. */
function requirePlaceControls() {
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
const emptyLiteralsIn = (quads: Quad[]): string[] =>
  quads
    .filter((q) => q.object.termType === "Literal" && q.object.value === "")
    .map((q) => q.predicate.value);

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

/** The wall clock every create below types, so "unchanged" has one spelling. */
const OFFSET_WALL = "2026-04-02T16:20";

/** A literal offset as a pattern `setChoice` can match against an option's text
 *  or its value. `+` is a regex metacharacter; a bare `new RegExp("+05:45")`
 *  throws, and a hand-escaped literal per test is how one of them ends up
 *  matching the wrong row. */
const offsetPattern = (offset: string) => new RegExp(offset.replace("+", "\\+"));

/** The five that are not whole hours. Nepal, India, Eucla, the Chathams, the
 *  Marquesas — the places a stepper would delete from the map. */
const ODD_OFFSETS = ["-09:30", "+05:30", "+05:45", "+08:45", "+12:45"];

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
function requireOffsetControl(): HTMLSelectElement {
  const found = screen.queryAllByLabelText(LABEL.offset);
  expect(found, "the editor has no UTC-offset control").toHaveLength(1);
  expect(
    found[0].tagName,
    "the offset control is not a <select>: a free-text or numeric control cannot offer +05:45 without also admitting +05:61",
  ).toBe("SELECT");
  return found[0] as HTMLSelectElement;
}

const offsetOptions = () => [...requireOffsetControl().options].map((o) => o.value);

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
   * THE LIST, AND WHY IT IS A LIST. Five offsets that are not whole hours, and
   * four that are — the second half is the allow-case, because "contains
   * +05:45" is satisfied by a control offering every quarter hour from -12:00
   * to +14:00, which is a different kind of wrong.
   *
   * WHAT WOULD BREAK IT: an `<input type="number">` of hours; a list generated
   * by stepping whole hours; dropping the three-quarter-hour zones as
   * curiosities, which is how Kathmandu, Eucla and the Chathams stop being
   * writable.
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
   * WHAT WOULD BREAK IT: rendering only the thirty-eight, so the controlled
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
    // and its rendered list IS the canonical thirty-eight — which is what
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
      //
      // The mount read of §7.6 is not part of "the save sent nothing" — it
      // happened before the form was touched — so it is excluded BY NAME and
      // then counted, rather than swallowed by a laxer assertion. The count is
      // also what makes the empty list above non-vacuous: the fake demonstrably
      // records what reaches it.
      expect(pod.saveTraffic()).toEqual([]);
      expect(pod.of("GET", SETTINGS_URL), "the §7.6 read is not once per save").toHaveLength(1);
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
      // AND THE FILTER USED ABOVE HIDES ONLY THE MOUNT READ. The same
      // `saveTraffic()` that was empty before the field was supplied carries
      // this PUT — by identity, so a helper that started dropping everything
      // would fail here rather than making the refusal assertion vacuous.
      expect(pod.saveTraffic(), "saveTraffic() filters out the save's own traffic").toContain(put);
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

    // The save sent nothing — the §7.6 mount read excluded by name and counted
    // beside it, for the reason `saveTraffic` gives.
    expect(pod.saveTraffic()).toEqual([]);
    expect(pod.of("GET", SETTINGS_URL), "the §7.6 read is not once per save").toHaveLength(1);
    expect(outcomeText()).toMatch(/slug|address|file/i);
    expect(outcomeText()).toMatch(/headline|title/i);

    setText(LABEL.slug, "  2026-04-02-kyoto  ");
    setText(LABEL.headline, "  Rain on the Philosopher's Path  ");
    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put).toBeDefined();
    // The filter hides only the mount read: this PUT is in `saveTraffic()`,
    // which is what keeps the empty assertion above a real one.
    expect(pod.saveTraffic(), "saveTraffic() filters out the save's own traffic").toContain(put);
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
const draftKeyFor = (webId: string, scope: string) => `wig.draft.v2.${webId}.${scope}`;

/** The key a build before 2026-09-06 wrote. Used only to prove it is ignored. */
const legacyDraftKeyFor = (webId: string, scope: string) => `wig.draft.v1.${webId}.${scope}`;

/** The scope of a create — there is no resource yet to name. */
const NEW_SCOPE = "new";

/** A second person signing in on the same browser. */
const SOMEONE_ELSE = "https://borrowed-laptop.example/profile/card#me";

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
const DRAFT_FIELDS = [
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
type StoredDraft = {
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

const seededDraft = (over: Partial<StoredDraft> = {}): StoredDraft => ({
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
    // Everything the CLICK sent, which is nothing. The §7.6 read the editor
    // makes on mount happened before the button was touched and is excluded by
    // name, then counted — see `saveTraffic`. `pastTheWindow()` above means
    // that read has long since settled, so the count is not a race.
    expect(pod.saveTraffic(), "the held Save button reached the Pod at all").toEqual([]);
    expect(
      pod.of("GET", SETTINGS_URL),
      "the held Save button re-read the privacy settings",
    ).toHaveLength(1);
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
    // The filter hides only the mount read: this PUT is in `saveTraffic()`, so
    // the empty assertion above is about a click that sent nothing rather than
    // about a helper that reports nothing.
    expect(pod.saveTraffic(), "saveTraffic() filters out the save's own traffic").toContain(put);
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

  /**
   * THE SAME LOSS, ON THE THREE FIELDS THE STORY TEST CANNOT SEE — ONE CASE
   * EACH, WHICH IS THE WHOLE REASON THIS IS PARAMETERISED.
   *
   * `settleDraft` clears the local copy the moment the Pod has the text, and
   * re-keeps it only when `sameText` says the form has moved on since the
   * snapshot the save sent. `sameText` compares field by field, so a field it
   * omits is a field whose in-flight edit is in NEITHER the Pod nor storage:
   * the save reports success, the draft is cleared, and the sentence typed
   * while the spinner was up never existed.
   *
   * The place text is where that is worst rather than merely annoying. §9 drops
   * the coordinate inside the home radius, so near home these three are the
   * ONLY thing the entry says about where it was — and a place name is exactly
   * the kind of thing an owner types while waiting, having just remembered it.
   * `sameText`'s own docblock leans on that: "So are the three place fields, and
   * there the loss is the one §9 leans on."
   *
   * ONE FIELD PER CASE, AND EACH CASE TOUCHES NOTHING ELSE, because that is
   * what makes each comparison pinned SEPARATELY. A single test that typed all
   * three would go green with two of the three comparisons deleted — the one
   * survivor would report "different" and the draft would be re-kept for a
   * field the assertion was not about. That is precisely how this pin was
   * unpinned for `locality` and `country`: the re-reviewer deleted both
   * comparisons from `sameText` and the suite stayed green, while the docblock
   * went on claiming all three.
   *
   * WHAT WOULD BREAK IT: dropping any ONE of `a.placeName === b.placeName`,
   * `a.locality === b.locality` or `a.country === b.country` from `sameText` —
   * each takes exactly one case below with it, and nothing else in this file
   * notices.
   *
   * THE WAIT ON `precision` IS LOAD-BEARING IN EVERY CASE. §7.6's settings
   * arrive over the network and set `precision` from `""` to the owner's preset,
   * so without it that happens DURING the flight and `sameText` differs on
   * `precision` as well — the draft is then re-kept for a reason that has
   * nothing to do with the field under test. Measured rather than reasoned
   * about: with the three place comparisons deleted, the differing fields at
   * settle time were `["precision", "placeName"]` and every assertion below
   * still passed. It is one wait in one place here for the same reason the cases
   * are parameterised: three copies of it are three chances to lose one.
   */
  const IN_FLIGHT_PLACE = [
    ["place name", LABEL.placeName, "placeName", "Gion, Kyoto"],
    ["town or city", LABEL.locality, "locality", "Kyoto"],
    ["country", LABEL.country, "country", "JP"],
  ] as const;

  it.each(IN_FLIGHT_PLACE)(
    "keeps a %s typed while the save was in flight",
    async (what, label, field, IN_FLIGHT) => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      const pod = podFake({ hold: held });
      const store = fakeStorage();
      await renderEditor(fakeStudioSession().session, { storage: store.storage });

      /* THE SETTINGS MUST LAND BEFORE THE SNAPSHOT IS TAKEN — see the docblock
         above; this line is the difference between a real pin and a vacuous
         one, and it has already been the difference once. */
      await waitFor(() => expect(screen.getByLabelText(LABEL.precision)).toBeEnabled());

      fillNewEntry();
      await act(async () => {
        fireEvent.click(saveButton());
      });
      await waitFor(() => expect(pod.entryPut(), "the entry PUT never went out").toBeDefined());

      expect(
        typeAsUser(label, IN_FLIGHT),
        "the form was not writable during the save, so this test's premise no longer holds",
      ).toBe(true);

      release();
      await waitFor(() => expect(outcomeText()).not.toBe(""));

      // It never reached the Pod: the save sent the snapshot taken before the
      // await, and that snapshot said nothing about the place at all — no
      // `<#place>`, so no name, no locality and no country either.
      const put = pod.entryPut()!;
      expect(
        placeNodeOf(quadsOf(put.body, put.url), put.url),
        `the in-flight ${what} reached the Pod, so this case proves nothing`,
      ).toBeUndefined();

      // So it has to be in storage, under the key this editor owns now.
      await pastTheWindow();
      expect(
        draftKeys(store),
        `the ${what} typed during the save is in neither the Pod nor storage`,
      ).toEqual([CREATED_KEY]);
      expect(
        parseDraft(store.items.get(CREATED_KEY)!)[field],
        `the draft was re-kept but the ${what} is not in it`,
      ).toBe(IN_FLIGHT);
    },
  );
});

/* ─────────────────────────────── 8h. the coordinate in a local draft ──────
 *
 * THE DECISION, TAKEN HERE AND STATED SO IT CAN BE ARGUED WITH: **the draft
 * keeps the coordinate the owner TYPED, not the one that would be published.**
 *
 * §9 says the studio "discards the precise original", and it is worth being
 * precise about what that sentence is protecting. Its own first line gives the
 * threat model: "Resources are publicly readable… anyone can fetch the raw
 * triple." `localStorage` is not a resource, is not readable by anyone else,
 * and never leaves the browser the owner typed into — it is the same trust
 * boundary as the React state the value is already sitting in, and as the input
 * element still showing it. Discarding it there would not close a hole; it
 * would close the feature: the field is the one thing in this form an owner
 * cannot retype from memory a day later, which is exactly what
 * `docs/decisions.md` §10 says autosave exists for.
 *
 * THE ALTERNATIVE WAS CONSIDERED AND IS WORSE, and not by a little. Persisting
 * the SNAPPED pair means a restored form shows a coordinate the owner did not
 * type, cannot refine, and cannot tell apart from one they did — and it freezes
 * a decision made under settings that may since have changed, since the snap is
 * a function of `dy:defaultPrecisionMeters` and of a home region that moves
 * when the owner moves house. Re-fuzzing it on save would then be idempotent
 * and therefore invisible, which is the wrong kind of harmless: nothing would
 * ever go wrong loudly.
 *
 * WHAT MAKES IT TESTABLE RATHER THAN A PREFERENCE: the two choices differ in
 * exactly one observable, the bytes at the key, so the first test below reads
 * them. Nothing else in the file can tell them apart — a save from a restored
 * draft publishes the same triple either way, because snapping a snapped value
 * returns it unchanged.
 *
 * AND THE FENCE AROUND IT IS UNMOVED. The three fields that may never be
 * persisted are still the ETag, `dcterms:created` and `schema:datePublished`
 * (lib/studio/drafts.ts), and `DRAFT_FIELDS` is what enforces it: seventeen,
 * no more.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — the coordinate in a local draft", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * FLUSHED BY THE UNMOUNT rather than by advancing a clock, which is 8f's
   * mechanism ("flushes the pending window on unmount instead of dropping it")
   * and is what lets this run on REAL timers. It has to: the settings arrive
   * over the network, `typeCoordinate` waits for them, and section 8's fake
   * clock does not fake microtasks but does stop everything that waits on a
   * timer. A test that faked time here would type into a control that was still
   * disabled and assert against whatever the pending state left behind.
   *
   * WHAT WOULD BREAK IT: writing `fuzzForPublication`'s output into the draft
   * instead of the form state; dropping the coordinate from the payload
   * altogether; persisting it under a field name `readDraft` strips.
   */
  it("keeps what was typed, not what would be published", async () => {
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    // The coordinate FIRST, because it is the one that has to wait for the
    // settings: everything after it is synchronous, so the debounce window that
    // opens here is still open when the unmount flushes it.
    await typeCoordinate(TYPED);
    fillNewEntry();
    cleanup();

    expect(store.calls.set, "nothing was kept at all").not.toEqual([]);
    const written = store.calls.set.at(-1)!;
    expect(written.key).toBe(KEY);

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );

    // THE DECISION.
    expect(payload.lat, "the draft does not hold the latitude the owner typed").toBe(TYPED.lat);
    expect(payload.long).toBe(TYPED.long);
    expect(payload.precision, "the precision the form was showing was not kept").toBe("500");

    // …and the other choice, spelled out so that switching to it fails here
    // rather than silently: the published pair is not what is on disk.
    expect(written.value, "the draft holds the SNAPPED pair, not the typed one").not.toContain(
      String(SNAP_500.lat),
    );
    expect(written.value).not.toContain(String(SNAP_500.long));

    // The fence: none of the three that may never be persisted.
    for (const forbidden of ["etag", "created", "datePublished"]) {
      expect(Object.keys(payload), forbidden).not.toContain(forbidden);
    }
  });

  /**
   * THE VERSION SEGMENT, DOING THE ONE THING IT IS THERE FOR.
   *
   * A `v1` payload is nine fields; the form is now twelve. Restoring it would
   * fill nine controls and leave three in whatever state the editor's own
   * defaults left them — a coordinate field the owner never typed into, sitting
   * next to text they recognise, on a form whose banner has just told them
   * their draft was restored. `lib/studio/drafts.ts`: "a future shape can be
   * given v2 and this one's payloads become invisible rather than
   * half-restorable."
   *
   * THE ALLOW-CASE IS THE SAME BYTES AT THE CURRENT KEY, which is what stops
   * this passing for an editor that offers nothing at all — the failure mode
   * that would take the whole feature with it and look like a clean pass.
   *
   * WHAT WOULD BREAK IT: leaving `draftKey` at `v1`; reading both keys "to be
   * kind"; migrating a v1 payload forward, which is the same half-restore in a
   * politer coat.
   */
  it("does not offer a draft left behind under the previous key version", async () => {
    const fake = fakeStudioSession();
    // Deliberately a payload that is perfectly valid under the CURRENT shape,
    // so the only thing making it invisible is the key it is under.
    const payload = JSON.stringify(seededDraft({ lat: TYPED.lat, long: TYPED.long }));

    const stale = fakeStorage({ [legacyDraftKeyFor(OWNER, NEW_SCOPE)]: payload });
    await renderEditor(fake.session, { storage: stale.storage });

    expect(
      screen.queryAllByRole("region", { name: /draft/i }),
      "a draft written by the previous build was offered: nine fields into a twelve-field form",
    ).toEqual([]);
    // And it looked in the right place, so this is a key that moved rather than
    // an editor that stopped reading drafts.
    expect(stale.calls.get, "the editor never looked for a draft at all").toContain(KEY);
    expect(stale.calls.get).not.toContain(legacyDraftKeyFor(OWNER, NEW_SCOPE));
    cleanup();

    /* THE ALLOW-CASE. */
    const current = fakeStorage({ [KEY]: payload });
    await renderEditor(fake.session, { storage: current.storage });
    expect(
      screen.getAllByRole("region", { name: /draft/i }),
      "the same bytes under the current key were not offered either: this editor offers nothing",
    ).toHaveLength(1);
  });

  /**
   * THE ROUND TRIP, END TO END: what was typed comes back into the control as
   * typed, and what leaves for the Pod is still the snapped pair. The first
   * half is the observable difference the decision above turns on; the second
   * is the guarantee that keeping the precise value locally costs nothing at
   * the wire.
   *
   * WHAT WOULD BREAK IT: restoring into the wrong control, or not at all;
   * restoring the value but not putting it through the fuzz on the save that
   * follows — which is the shape that would put a typed coordinate on a
   * world-readable resource by way of `localStorage`.
   */
  it("Restore puts the typed coordinate back, and the save still publishes the snapped one", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const store = fakeStorage({
      [KEY]: JSON.stringify(seededDraft({ lat: TYPED.lat, long: TYPED.long, precision: "500" })),
    });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "no draft was offered: the editor is reading a key this file no longer writes (v1 rather than v2), or is not reading one at all",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requireCoordinateControls();
    await waitFor(() => expect(screen.getByLabelText(LABEL.latitude)).toBeEnabled());
    expect(
      (screen.getByLabelText(LABEL.latitude) as HTMLInputElement).value,
      "Restore did not put the kept latitude back into the control",
    ).toBe(TYPED.lat);
    expect((screen.getByLabelText(LABEL.longitude) as HTMLInputElement).value).toBe(TYPED.long);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);
    const geo = geoNodeOf(quads, put!.url);
    expect(geo, "a restored coordinate published nothing").toBeDefined();
    expect(Number(oneObject(quads, geo!, SCHEMA.latitude)?.value)).toBe(SNAP_500.lat);
    expect(Number(oneObject(quads, geo!, SCHEMA.longitude)?.value)).toBe(SNAP_500.long);
    expect(
      pod.wire(),
      "the coordinate went from localStorage to the Pod without passing through the fuzz",
    ).not.toContain(TYPED.lat);
    expect(pod.wire()).not.toContain(TYPED.long);
  });

  /**
   * 8e's hold, extended to the three controls that were not there when it was
   * written. Same defect, same fix: one storage slot, so only one of the banner
   * and the autosave may hold the pen, and the owner cannot type past an
   * unanswered offer.
   *
   * THE DISCARD AT THE END IS NOT DECORATION. Under an unreadable settings
   * document these three controls are disabled too (section 1), so "disabled
   * while a banner is up" is a state this editor can reach for a completely
   * different reason — including "the settings read has not come back yet".
   * Answering the banner and watching them come alive is what makes the hold
   * attributable to the banner.
   *
   * WHAT WOULD BREAK IT: leaving the coordinate controls outside the
   * `<fieldset disabled>`; wiring their `disabled` to the settings alone.
   */
  it("holds the coordinate controls while a draft is offered, and holds nothing when there is nothing to answer", async () => {
    const fake = fakeStudioSession();

    /* THE ALLOW-CASE: no draft, so nothing to answer, so nothing held. */
    const live = fakeStorage();
    await renderEditor(fake.session, { storage: live.storage });
    expect(screen.queryAllByRole("region", { name: /draft/i })).toEqual([]);
    requireCoordinateControls();
    await waitFor(() => expect(screen.getByLabelText(LABEL.latitude)).toBeEnabled());
    for (const [what, control] of coordinateControls()) {
      expect(control, `the ${what} control is held although no draft was offered`).toBeEnabled();
    }
    expect(typeAsUser(LABEL.latitude, TYPED.lat)).toBe(true);
    cleanup();

    /* THE PIN. */
    const seeded = JSON.stringify(seededDraft());
    const store = fakeStorage({ [KEY]: seeded });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "no draft was offered, so there is no hold to observe: the editor is reading a key this file no longer writes (v1 rather than v2)",
    ).toHaveLength(1);
    const banner = offered[0];
    for (const [what, control] of coordinateControls()) {
      expect(control, `the ${what} control is still live while a draft is offered`).toBeDisabled();
    }
    expect(
      typeAsUser(LABEL.latitude, "35.9"),
      "the browser would have refused this keystroke",
    ).toBe(false);
    expect(
      store.items.get(KEY),
      "the offered draft was overwritten by the form behind the banner",
    ).toBe(seeded);

    /* AND THE HOLD WAS THE BANNER'S. */
    fireEvent.click(within(banner).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.getByLabelText(LABEL.latitude)).toBeEnabled());
    for (const [what, control] of coordinateControls()) {
      expect(control, `the ${what} control is still held after Discard`).toBeEnabled();
    }
    expect(typeAsUser(LABEL.latitude, TYPED.lat)).toBe(true);
  });
});

/* ─────────────────────────────────────── 8i. the place fields in a draft ──
 *
 * Three more strings off three more form controls, kept for the same reason
 * the other nine are (`docs/decisions.md` §10: "losing a long entry in a hostel
 * is what kills the habit") — and the version segment is deliberately NOT
 * moved for them, which is the second time that test is answered "no".
 *
 * THE BAR `lib/studio/drafts.ts` SETS FOR A BUMP is the HALF-RESTORE: a field
 * the payload cannot carry, showing whatever the editor's own default left in
 * it, under a banner that has just told the owner their draft came back. That
 * is what `v1` → `v2` was for — nine fields into a twelve-field form, with a
 * coordinate the owner never typed sitting next to text they recognise. It
 * cannot arise here: no existing `v2` payload can contain a place name,
 * because there was no control to type one into, so such a draft restores
 * three empty boxes — the truth about that draft, not a default standing in
 * for something lost. Bumping would throw away real unsaved prose in exchange
 * for nothing, exactly as it would have done for `photos`. The half of this
 * pinned in the store itself is in test/drafts.test.ts §7.
 *
 * WHAT THIS TEST ASSERTS IS THE INVARIANT — a USABLE draft — rather than the
 * bytes: the fields are kept, they come back into the controls, and a save
 * made from the restored form puts the same place on the Pod. Bytes alone
 * would pass for a draft that stored three strings nothing ever read back.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — the place fields in a local draft", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * FLUSHED BY THE UNMOUNT rather than by advancing a clock — 8f's mechanism,
   * and the same reason 8h uses it: this test reaches the network on the
   * restore half, and a faked timer stops everything that waits on one.
   *
   * WHAT WOULD BREAK IT: keeping the three fields in React state and leaving
   * them out of the payload; persisting them under names `readDraft` strips
   * (unknown keys are stripped silently, so this is a failure with no error);
   * restoring them into the wrong control, or not at all; restoring them into
   * the form but leaving them out of the save that follows, which would show
   * the owner a place name and publish an entry without one.
   */
  it("keeps the three place fields, and a restored draft still names its place", async () => {
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    requirePlaceControls();
    fillNewEntry();
    setText(LABEL.placeName, "Gion, Kyoto");
    setText(LABEL.locality, "Kyoto");
    setText(LABEL.country, "JP");
    cleanup();

    expect(store.calls.set, "nothing was kept at all").not.toEqual([]);
    const written = store.calls.set.at(-1)!;
    expect(written.key).toBe(KEY);

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );
    expect(payload.placeName, "the draft does not hold the place name that was typed").toBe(
      "Gion, Kyoto",
    );
    expect(payload.locality).toBe("Kyoto");
    expect(payload.country).toBe("JP");

    // The fence is unmoved: none of the three that may never be persisted.
    for (const forbidden of ["etag", "created", "datePublished"]) {
      expect(Object.keys(payload), forbidden).not.toContain(forbidden);
    }

    /* AND IT IS USABLE — the bytes the editor itself wrote, offered back to a
       fresh editor, restored, and saved. */
    const pod = podFake();
    const seeded = fakeStorage({ [KEY]: written.value });
    await renderEditor(fake.session, { storage: seeded.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "the draft this editor had just written was not offered back to it",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requirePlaceControls();
    expect(shownValue(LABEL.placeName), "Restore did not put the place name back").toBe(
      "Gion, Kyoto",
    );
    expect(shownValue(LABEL.locality)).toBe("Kyoto");
    expect(shownValue(LABEL.country)).toBe("JP");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(place, "a restored draft published no place at all").toBeDefined();
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe("Gion, Kyoto");

    const address = addressNodeOf(quads, put!.url);
    expect(address, "a restored draft published no address").toBeDefined();
    expect(oneObject(quads, address!, SCHEMA.addressLocality)?.value).toBe("Kyoto");
    expect(oneObject(quads, address!, SCHEMA.addressCountry)?.value).toBe("JP");
  });

  /**
   * THE HALF-RESTORE THE VERSION SEGMENT EXISTS TO PREVENT, REACHED WITHOUT
   * MOVING THE VERSION SEGMENT — and the reason these three fields are
   * `.optional()` rather than `.default("")`.
   *
   * A `v2` payload written before the place controls existed carries no place
   * fields at all. Give them a default and `readDraft` hands back `""` for each
   * — which in this editor is not "nothing typed", it is REMOVE, the only way a
   * name already on the Pod can be taken off it. Restore such a draft onto an
   * entry that HAS a place and the three boxes go empty, and the next save
   * deletes `schema:name` and the whole `<#address>` from a world-readable
   * resource. The owner asked for their unsaved text back and lost data they
   * never touched, with no error anywhere.
   *
   * THE `photos` PRECEDENT DOES NOT TRANSFER, which is what made the default
   * look safe: a restored empty photo list is harmless because `photosFor`
   * re-carries `existing.photos` at save time. Place text has no carry-through
   * — the form state IS the answer — so an absent field has to stay absent all
   * the way to `restore()`, which leaves the control showing what it was
   * showing.
   *
   * WHAT WOULD BREAK IT: `.default("")` on the three in lib/studio/drafts.ts;
   * `setPlaceName(draft.placeName)` without the `??` in `restore()`; bumping
   * the key to `v3`, which passes this by making the draft invisible and loses
   * the prose the key was left at `v2` to protect — so the restore is asserted
   * to have HAPPENED before the place is asserted to have survived it.
   */
  it("does not empty a stored place when the restored draft predates the controls", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    expect(entry.place?.name?.value, "the §7.3 fixture no longer names a place").toBe(
      SPEC_PLACE_NAME,
    );

    /* Exactly the shape a build before these controls wrote: every other field
       of the current draft, and no place fields at all. */
    const RESTORED_HEADLINE = "Rain on the Philosopher's Path";
    const before = seededDraft({ headline: RESTORED_HEADLINE }) as Partial<StoredDraft>;
    delete before.placeName;
    delete before.locality;
    delete before.country;
    for (const field of ["placeName", "locality", "country"]) {
      expect(Object.keys(before), field).not.toContain(field);
    }

    const store = fakeStorage({
      [draftKeyFor(OWNER, ARRIVAL_URL)]: JSON.stringify(before),
    });
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft written before the place controls was not offered at all: the key moved, or the payload is now refused",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED. Without this the assertions below would hold
    // just as well for a build that offered nothing and restored nothing.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(RESTORED_HEADLINE);

    requirePlaceControls();
    expect(
      shownValue(LABEL.placeName),
      "a draft with no opinion about the place emptied the box that had one",
    ).toBe(SPEC_PLACE_NAME);
    expect(shownValue(LABEL.locality)).toBe(SPEC_LOCALITY);
    expect(shownValue(LABEL.country)).toBe(SPEC_COUNTRY);

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(
      place,
      "restoring a draft that predates these controls deleted the entry's place from the Pod",
    ).toBeDefined();
    expect(oneObject(quads, place!, SCHEMA.name)?.value).toBe(SPEC_PLACE_NAME);

    const address = addressNodeOf(quads, put!.url);
    expect(address, "the whole <#address> went with it").toBeDefined();
    expect(oneObject(quads, address!, SCHEMA.addressLocality)?.value).toBe(SPEC_LOCALITY);
    expect(oneObject(quads, address!, SCHEMA.addressCountry)?.value).toBe(SPEC_COUNTRY);
  });

  /**
   * THE OTHER SIDE OF THE SAME OPERATOR, AND THE ONE A RETRACTION DEPENDS ON.
   *
   * The test above pins ABSENT: a `v2` payload that predates these controls has
   * no opinion about the place, so `restore()` leaves the boxes showing the
   * stored value. This one pins `""`, which is a DIFFERENT INSTRUCTION — a box
   * the owner deliberately emptied, which `placeTextOf` reads as REMOVE and
   * which is the only way a name already on a world-readable resource can be
   * taken off it.
   *
   * BOTH SIDES ARE NEEDED BECAUSE THE OPERATOR HAS TWO OF THEM AND EACH SIDE
   * FAILS ALONE. `draft.placeName ?? placeName` keeps them apart. `||` does not:
   * it treats `""` as falsy and falls through to the current state, so an owner
   * who emptied the three boxes, walked away before the save, and then clicked
   * Restore gets the entry's STORED place handed back to them — the retraction
   * silently reverted, on a resource anyone can fetch, with the banner having
   * just said the draft came back. The absent test cannot see that: an absent
   * key reaches the same branch under both operators. Measured by the
   * re-reviewer, not reasoned about — `??` → `||` produced an identical failure
   * set until this test existed.
   *
   * THE PREMISE IS GUARDED, because it is the whole difference between the two
   * tests and it is one `delete` away from being the other one. `seededDraft`
   * already defaults the three to `""`, so a test that merely relied on that
   * default would still be testing the `""` side the day the default moved to
   * absent — silently, and it would pass. So the three keys are asserted PRESENT
   * and asserted EMPTY before anything is restored.
   *
   * TWO SURFACES, ASSERTED SEPARATELY, BECAUSE THEY FAIL INDEPENDENTLY: the
   * control shows `""` after Restore, and the save that follows actually takes
   * `schema:name` and the whole `<#address>` off the Pod. An editor that emptied
   * the boxes and then wrote a hidden copy of `existing.place` back would pass
   * the first and lose the owner's removal at the second.
   *
   * AND THE GEOMETRY IT NEVER TOUCHED SURVIVES — 1b's rule, seen through a
   * restore this time. `placeFor` removes the four fields independently, so the
   * `<#place>` node is still there for the coordinate to hang off; a `<#place>`
   * that vanished with its name would take a coordinate the owner never asked to
   * remove with it.
   */
  it("restores three boxes the owner emptied, and the save takes the place off the Pod", async () => {
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
    const stored = entry.place?.geo;
    expect(stored, "the §7.3 fixture carries no coordinate for this test to preserve").toBeDefined();

    /* A draft the owner emptied the place out of: the three fields PRESENT and
       EMPTY, which is what makes this the `""` side rather than the one above. */
    const RESTORED_HEADLINE = "Rain on the Philosopher's Path";
    const emptied = seededDraft({
      headline: RESTORED_HEADLINE,
      placeName: "",
      locality: "",
      country: "",
    });
    for (const field of ["placeName", "locality", "country"] as const) {
      expect(
        Object.keys(emptied),
        `${field} is absent from this payload, so this test is the other test`,
      ).toContain(field);
      expect(emptied[field], `${field} is not the empty string, so nothing is being retracted`).toBe(
        "",
      );
    }

    const store = fakeStorage({
      [draftKeyFor(OWNER, ARRIVAL_URL)]: JSON.stringify(emptied),
    });
    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      storage: store.storage,
    });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "the emptied draft was not offered at all: the key moved, or the payload is now refused",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED, on a field neither operator touches — so
    // "the boxes are empty" below cannot be satisfied by a build that offered
    // the draft and restored nothing from it.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(RESTORED_HEADLINE);

    /* SURFACE ONE: what the owner is looking at. Under `||` all three of these
       show the stored value instead. */
    requirePlaceControls();
    expect(
      shownValue(LABEL.placeName),
      "the box the owner emptied came back holding the stored name: their removal was reverted",
    ).toBe("");
    expect(shownValue(LABEL.locality), "the emptied locality came back").toBe("");
    expect(shownValue(LABEL.country), "the emptied country came back").toBe("");

    await clickSaveAndWait();

    /* SURFACE TWO: what the Pod is left holding, which is the consequence. */
    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const quads = quadsOf(put!.body, put!.url);

    const place = placeNodeOf(quads, put!.url);
    expect(
      place,
      "the retraction took the whole place with it, coordinate and all",
    ).toBeDefined();
    expect(
      objectsOf(quads, place!, SCHEMA.name),
      "the name the owner emptied is still on the Pod: an emptied box was restored as the stored value",
    ).toEqual([]);
    expect(
      objectsOf(quads, place!, SCHEMA.address),
      "the address the owner emptied is still on the Pod",
    ).toEqual([]);
    // Said again by predicate, so an `<#address>` reached by some other route
    // fails here too rather than hiding behind the pointer being gone.
    for (const predicate of [SCHEMA.addressLocality, SCHEMA.addressCountry]) {
      expect(
        quads.filter((q) => q.predicate.value === predicate),
        `${predicate} survived a retraction`,
      ).toEqual([]);
    }
    expect(
      emptyLiteralsIn(quads),
      "an empty literal was published in place of a removal",
    ).toEqual([]);
    // The distinctive one, across every byte that left the browser: the stored
    // name must not have travelled out through the index row either.
    expect(
      pod.wire(),
      "the retracted place name left the browser anyway",
    ).not.toContain(SPEC_PLACE_NAME);

    // And the coordinate this restore said nothing about is untouched.
    const geo = geoNodeOf(quads, put!.url);
    expect(geo, "the untouched coordinate went with the retracted name").toBeDefined();
    const lat = oneObject(quads, geo!, SCHEMA.latitude);
    expect(Number(lat?.value)).toBe(stored!.lat);
    expect(datatypeOf(lat)).toBe(XSD.decimal);
    expect(Number(oneObject(quads, geo!, SCHEMA.longitude)?.value)).toBe(stored!.long);
  });
});

/* ──────────────────────────────── 8j. the offset in a local draft ─────────
 *
 * The seventeenth field, and the second control on this form whose STORED
 * VALUE MAY NOT APPEAR IN ITS OWN OPTION LIST — not "the second choice
 * control" (Trip, Travel mode, Status, Precision and Photos are choices too;
 * that count would make this the sixth). Precision is the first of the two:
 * `gridOf(draft.precision) === null ? presetPrecision : draft.precision`
 * refuses a restored precision the select cannot show. The offset is the
 * second, and it is exactly why it follows `precisionOptions`' union shape
 * rather than being refused the same way — see the note on `OFFSET_SHAPE`
 * where `restore()` is defined. §7.3: `dy:occurredAt` "carries the local
 * UTC offset of the place" — until section 1c that offset was the entry's own
 * or, failing that, the EDITING MACHINE'S, and nothing on the form could say
 * otherwise. Now it is an answer, so it is something the local copy has to
 * keep: a restored draft that dropped it would hand the owner back the same
 * silent guess the control exists to replace, under a banner that has just told
 * them their draft came back.
 *
 * AND THE VERSION SEGMENT IS NOT MOVED FOR IT — the third time that test is
 * answered "no", by the bar `lib/studio/drafts.ts` sets: the HALF-RESTORE. No
 * existing `v2` payload can carry an offset, because there was no control to
 * choose one with, so such a draft restores `""` and the editor falls through
 * to the same default it would have used with no draft at all. Nothing is
 * standing in for something lost. A bump would throw away real unsaved prose in
 * exchange for nothing, exactly as it would have for `photos` and for the place
 * fields. The store's half of that is test/drafts.test.ts §8; the half that can
 * actually hurt the owner — a blank control, and therefore a timestamp with no
 * offset on it — is the last test here.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — the offset in a local draft", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  /**
   * FLUSHED BY THE UNMOUNT rather than by advancing a clock — 8f's mechanism,
   * and the same reason 8h and 8i use it: the restore half reaches the network,
   * and a faked timer stops everything that waits on one.
   *
   * WHAT WOULD BREAK IT: holding the offset in React state and leaving it out
   * of the payload; persisting it under a name `readDraft` strips (unknown keys
   * are stripped silently, so that is a failure with no error anywhere);
   * restoring it into the control but leaving it out of the save, which shows
   * the owner `+05:45` and publishes `+09:00`.
   */
  it("keeps the chosen offset, and a restored draft still publishes it", async () => {
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    requireOffsetControl();
    fillNewEntry();
    setChoice(LABEL.offset, offsetPattern("+05:45"));
    // The choice really took, or everything below is about the default.
    expect(shownValue(LABEL.offset)).toBe("+05:45");
    cleanup();

    expect(store.calls.set, "nothing was kept at all").not.toEqual([]);
    const written = store.calls.set.at(-1)!;
    expect(written.key).toBe(KEY);

    const payload = parseDraft(written.value);
    expect(Object.keys(payload).sort(), "the persisted shape is not the draft shape").toEqual(
      DRAFT_FIELDS,
    );
    expect(payload.offset, "the draft does not hold the offset the owner chose").toBe("+05:45");
    // The wall clock is kept beside it, unshifted: the two halves of the
    // timestamp are stored as the two controls hold them.
    expect(payload.occurred).toBe("2026-04-02T16:20");

    // The fence is unmoved: none of the three that may never be persisted.
    for (const forbidden of ["etag", "created", "datePublished"]) {
      expect(Object.keys(payload), forbidden).not.toContain(forbidden);
    }

    /* AND IT IS USABLE — the bytes the editor itself wrote, offered back to a
       fresh editor, restored, and saved. */
    const pod = podFake();
    const seeded = fakeStorage({ [KEY]: written.value });
    await renderEditor(fake.session, { storage: seeded.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "the draft this editor had just written was not offered back to it",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requireOffsetControl();
    expect(shownValue(LABEL.offset), "Restore did not put the offset back").toBe("+05:45");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(
      occurred?.value,
      "a restored draft published the editing machine's offset, not the one it was carrying",
    ).toBe("2026-04-02T16:20:00+05:45");
  });

  /**
   * CHANGING THE OFFSET ALONE ARMS THE AUTOSAVE.
   *
   * THIS IS A BUG THIS PROJECT HAS ALREADY SHIPPED ONCE, in the photo pipeline:
   * a state change that armed nothing, because the only thing that set
   * `touched` was a DOM `change` event on the form, and the settle happened
   * outside one. It reached review. The shape recurs here for a different
   * reason — an offset is not typing, and an implementation that hung the
   * control outside the `<form>` (a toolbar beside the datetime input is the
   * obvious layout) would move the state and arm nothing, so the owner corrects
   * `+02:00` to `+09:00`, closes the tab, and gets `+02:00` back.
   *
   * THE CONTROL IS IN THE SAME TEST, first: an untouched form stores nothing,
   * so the write below is the change and not the mount. Without it this passes
   * against an editor that autosaves a copy of the empty form on render.
   */
  it("arms the autosave when the offset is the only thing that changed", async () => {
    await withFakeTimers(FIRST);
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    requireOffsetControl();

    // THE CONTROL: nobody has touched anything, so nothing is armed.
    tick(DEBOUNCE * 2);
    expect(store.calls.set, "an untouched form stored a draft").toEqual([]);

    // ONE CHANGE, AND IT IS NOT TYPING.
    setChoice(LABEL.offset, offsetPattern("+05:45"));
    expect(shownValue(LABEL.offset), "the choice did not take").toBe("+05:45");
    tick(DEBOUNCE);

    expect(
      store.calls.set,
      "changing the offset armed nothing: the state moved and the autosave did not, so the correction is lost with the tab",
    ).toHaveLength(1);
    const payload = parseDraft(store.calls.set[0].value);
    expect(Object.keys(payload).sort()).toEqual(DRAFT_FIELDS);
    expect(payload.offset).toBe("+05:45");
    // The mutation half: this really is the offset alone, with nothing typed.
    expect(payload.headline).toBe("");
    expect(payload.story).toBe("");
  });

  /**
   * A DRAFT WRITTEN BEFORE THE CONTROL EXISTED, which is the decision the key
   * did not move for — and the one way that decision can hurt the owner rather
   * than merely disappoint them.
   *
   * `""` restored into the control literally is the blank `<select>` section 1c
   * refuses on an unlisted offset, and the consequence is worse than a control
   * that looks unfilled: the next save composes `dy:occurredAt` out of the wall
   * clock and an empty string, and §3 requires an offset. So the fallback chain
   * has to run — the same `offsetOf(existing?.occurredAt) ?? offsetHere(wall)`
   * a fresh form uses — exactly as `restore()` already re-derives the precision
   * when a draft carries a grid this build does not offer.
   *
   * WHAT WOULD BREAK IT: bumping the key to `v3` (the banner never appears and
   * the prose is gone); making the field required (the same loss, quieter);
   * `setOffset(draft.offset)` unconditionally, which is the blank control.
   */
  it("restores a draft written before the offset control without blanking it", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const before = { ...seededDraft() } as Partial<StoredDraft>;
    delete before.offset;
    // The fixture really is missing the field, or this test is about a payload
    // that has one.
    expect(Object.keys(before)).not.toContain("offset");

    const store = fakeStorage({ [KEY]: JSON.stringify(before) });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft written before the offset control is no longer offered: the key moved, or the field is required",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    requireOffsetControl();
    expect(
      shownValue(LABEL.offset),
      "an empty offset was restored into the control, so the next save has none to write (§3)",
    ).toBe("+09:00");
    // The mutation half: the prose the owner would lose really did come back.
    expect(shownValue(LABEL.headline)).toBe("Rain on the Philosopher's Path");

    // AND THE CONSEQUENCE, at the wire: a restored pre-offset draft still
    // publishes a timestamp with an offset on it.
    await clickSaveAndWait();
    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(occurred?.value).toBe("2026-04-02T16:20:00+09:00");
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
  });

  /**
   * THE EDIT-PATH COMPLEMENT TO THE TEST ABOVE, and the one that actually
   * exercises `offsetOf(existing?.occurredAt)` rather than `offsetHere(wall)`
   * alone.
   *
   * THE TEST ABOVE IS A CREATE: `renderEditor` there is given no `initial`, so
   * `existing` is `undefined` and `offsetOf(existing?.occurredAt)` is
   * `undefined` no matter what the restore path does with it — the fallback
   * chain collapses to `offsetHere(wall)` alone, which in this file's fixed
   * Asia/Tokyo zone is exactly the `+09:00` the test above asserts. AN
   * IMPLEMENTATION WHOSE RESTORE FALL-THROUGH NEVER CONSULTS THE ENTRY AT ALL
   * — always `offsetHere(wall)`, never `offsetOf(existing?.occurredAt)` —
   * PASSES THE TEST ABOVE AND EVERY OTHER TEST IN THIS FILE. That is the shape
   * this project's review-lessons record as a recurring trap: when a mutant
   * survives, ask which OTHER mechanism is covering for it, then find the path
   * where it does not. This is that path.
   *
   * So this test edits an entry whose stored offset is `+05:45` — Nepal,
   * chosen for the same reason section 1c's own test uses it: the fixed test
   * zone cannot produce it by coincidence, so "the entry's own offset" and
   * "this machine's offset" are distinguishable outcomes rather than
   * accidentally equal ones. `+09:00` here would make the test vacuous. The
   * draft seeded onto it is the same pre-control fixture as the test above —
   * the `offset` key deleted — because ruling T2-A collapses that with a
   * hand-emptied `offset: ""` before `restore()` ever sees it.
   *
   * MUTATIONS THIS MUST DIE UNDER, both of them:
   *
   *   1. `setOffset(draft.offset)` unconditionally → the control shows `""`.
   *      Unlike the `+05:15` case in section 1c, this really is blank:
   *      `offsetOptions` unions in whatever the control holds, so an empty
   *      state puts an empty-valued option into the list and the `<select>`
   *      genuinely matches it. It is not the "no option matches" case —
   *      that one reads back as the FIRST option, not blank, per section 1c
   *      — so `shownValue(LABEL.offset)` reads `""` rather than `+05:45`.
   *   2. The restore fall-through consulting only `offsetHere(wall)` and never
   *      `offsetOf(existing?.occurredAt)` → the control shows `+09:00`, this
   *      machine's zone, instead of the entry's own. THIS is the mutation the
   *      test above cannot catch, and the entire reason this test exists.
   *
   * AND THE WIRE CONSEQUENCE, because a control that merely looks right while
   * the save publishes something else is the failure that actually costs the
   * owner: the timestamp reaching the Pod must carry `+05:45`, with the wall
   * clock the DRAFT held (`16:20`), not the entry's own (`21:40`).
   */
  it("restores a draft written before the offset control onto an edit, showing the entry's own offset rather than this machine's", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();
    const nepal: Entry = { ...entry, occurredAt: "2026-03-29T21:40:00+05:45" };
    // The mutation really happened, or this is the §7.3 fixture's own +09:00
    // again and the two mechanisms below are indistinguishable.
    expect(nepal.occurredAt).not.toBe(entry.occurredAt);

    const before = { ...seededDraft() } as Partial<StoredDraft>;
    delete before.offset;
    // The fixture really is missing the field, or this test is about a payload
    // that has one.
    expect(Object.keys(before)).not.toContain("offset");

    const store = fakeStorage({
      [draftKeyFor(OWNER, ARRIVAL_URL)]: JSON.stringify(before),
    });
    await renderEditor(fake.session, {
      initial: { entry: nepal, etag: '"entry-7"' },
      storage: store.storage,
    });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft written before the offset control is no longer offered on an edit: the key moved, or the field is required",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED — without this, the offset assertion below
    // would hold just as well for an editor that offered a draft and restored
    // nothing from it.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(before.headline);

    requireOffsetControl();
    expect(
      shownValue(LABEL.offset),
      "an empty offset restored onto an edit fell back to this machine's zone instead of the entry's own +05:45 — the mechanism the create-path test above cannot see",
    ).toBe("+05:45");

    await clickSaveAndWait();

    const put = pod.entryPut();
    expect(put, "the restored draft was never saved").toBeDefined();
    const occurred = oneObject(quadsOf(put!.body, put!.url), `${put!.url}#it`, DY.occurredAt);
    expect(
      occurred?.value,
      "the control showed the entry's own offset but a different one reached the Pod",
    ).toBe("2026-04-02T16:20:00+05:45");
    expect(datatypeOf(occurred)).toBe(XSD.dateTime);
  });

  /**
   * A SHAPE-INVALID, NON-EMPTY OFFSET IS REFUSED THE SAME WAY AN ABSENT ONE
   * IS. `restore()`'s guard is `OFFSET_SHAPE.test(draft.offset) ? draft.offset
   * : offset` — every fixture above only ever drives the `""` branch of that
   * ternary (an absent key or a hand-emptied one), so a narrower guard,
   * `draft.offset === "" ? offset : draft.offset`, would survive every test
   * before this one. `"banana"` is not `""` and not `[+-]dd:dd`, so it is the
   * one payload that can only reach the control through the SHAPE branch —
   * a hand-edited or corrupted `localStorage` entry, not anything this
   * editor itself would ever write.
   *
   * WHAT WOULD BREAK IT: the narrower `=== ""` guard above. Under it `banana`
   * is shown in the control, reaches the composer on save, and fails there —
   * `Entry.safeParse` (lib/pod/entry-model.ts) refuses the shape — so a save
   * that would otherwise have worked is silently lost instead of the visible,
   * correct fallback this test pins.
   */
  it("restores a draft carrying a shape-invalid offset onto the same fallback an absent one uses", async () => {
    const fake = fakeStudioSession();
    const bad = seededDraft({ offset: "banana" });
    const store = fakeStorage({ [KEY]: JSON.stringify(bad) });
    await renderEditor(fake.session, { storage: store.storage });

    const offered = screen.queryAllByRole("region", { name: /draft/i });
    expect(
      offered,
      "a draft carrying a shape-invalid offset is no longer offered at all",
    ).toHaveLength(1);
    fireEvent.click(within(offered[0]).getByRole("button", { name: "Restore" }));

    // THE RESTORE REALLY HAPPENED, or the offset assertion below would hold
    // just as well for an editor that restored nothing.
    expect(
      shownValue(LABEL.headline),
      "the draft was offered but nothing was restored from it",
    ).toBe(bad.headline);

    requireOffsetControl();
    expect(
      shownValue(LABEL.offset),
      "a shape-invalid offset from a hand-edited draft was shown rather than refused",
    ).toBe("+09:00");
  });
});

/* ──────────────────────────────────────────── 8k. task 2.5's crash test ── */

/**
 * TASK 2.5. `lib/studio/drafts.ts`'s `savedAt` becomes `.optional()`, at the
 * maintainer's explicit instruction, after being shown the module's own
 * docblock argues against it. THE CONSEQUENCE THAT MATTERS IS HERE, NOT IN
 * test/drafts.test.ts: today the schema is the only thing keeping a payload
 * with no `savedAt` off the render path — `Draft.safeParse` refuses it and
 * `readDraft` answers `null`, so the "Unsaved draft" banner never mounts and
 * `savedAtText(offered.savedAt)` — `(savedAt: string) => savedAt.slice(...)`
 * — never runs on `undefined`. Making the field optional moves such a payload
 * ONTO the render path, where that call is a TypeError thrown from the mount
 * effect: the exact failure lib/studio/drafts.ts's "NOTHING HERE THROWS,
 * EVER" headline invariant exists to prevent, reachable for the first time
 * through the one field that used to hold the door shut.
 *
 * RULING 2.5-A: the banner still appears; only the `<time>` goes away. The
 * banner's job is to offer the draft back, and suppressing the whole thing
 * over a missing label would discard recoverable prose — the inverse of what
 * this feature is for. So this test pins both halves: the crash does not
 * happen, AND the banner that survives still has its buttons. A test that
 * only checked "did not throw" would pass over a banner that had silently
 * lost Restore and Discard along with the timestamp.
 *
 * WHERE AN ABSENT `savedAt` ACTUALLY COMES FROM: never this build, which
 * stamps `nowWithOffset()` at every write site. Only a payload from another
 * build, or one hand-edited in devtools — exactly the class `readDraft`'s
 * "every unusable thing a real browser produces" contract is about.
 */
describe("entry editor — a draft with no savedAt at all (task 2.5)", () => {
  const KEY = draftKeyFor(OWNER, NEW_SCOPE);

  it("mounts and still offers the draft, with no <time> and a live Restore", async () => {
    const withoutSavedAt = {
      ...seededDraft({
        headline: "written by a build with no timestamp control",
        story: "kept anyway, or this feature has failed at the one thing it is for",
      }),
    } as Partial<StoredDraft>;
    delete withoutSavedAt.savedAt;
    // The mutation really happened: the fixture is missing the key, or the
    // rest of this test is about a payload that has one.
    expect(Object.keys(withoutSavedAt), "savedAt").not.toContain("savedAt");
    expect(JSON.stringify(withoutSavedAt)).not.toContain("savedAt");

    const store = fakeStorage({ [KEY]: JSON.stringify(withoutSavedAt) });
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { storage: store.storage });

    // THE CRASH TEST. A schema-only change — `.optional()` with
    // `savedAtText`/`<time>` left untouched — throws a TypeError out of the
    // mount effect's render before this line is reached at all. TODAY, before
    // any implementation, `savedAt` is still required, so the payload above
    // is refused outright and this query finds nothing: the same red state as
    // the crash, reached by the other route the brief names as acceptable.
    const region = screen.getByRole("region", { name: /draft/i });

    // RULING 2.5-A, first half: no invented, no empty, no <time> at all.
    expect(
      region.querySelector("time"),
      "a <time> element appeared with no savedAt to build a datetime from",
    ).toBeNull();

    // RULING 2.5-A, second half — THE ONE A "DID NOT THROW" TEST WOULD MISS:
    // the banner that survives still has both of its ways out.
    within(region).getByRole("button", { name: "Discard" });
    fireEvent.click(within(region).getByRole("button", { name: "Restore" }));

    // Restore really did something: the prose the owner would otherwise lose
    // is back in the form, not merely "a click landed and nothing threw".
    expect(
      shownValue(LABEL.headline),
      "Restore did not put the headline back",
    ).toBe("written by a build with no timestamp control");
    expect(shownValue(LABEL.articleBody)).toBe(
      "kept anyway, or this feature has failed at the one thing it is for",
    );
    // Restored once — leaving the banner up invites a second click that would
    // overwrite whatever the owner types next.
    expect(screen.queryAllByRole("region", { name: /draft/i })).toEqual([]);
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

/* ══════════════════════════════════════════════════════════════════════════
 * 10. PHOTOS — THE PICKER (task 7).
 *
 * THE RED STEP. Nothing in components/studio/entry-editor.tsx answers to a
 * photo control today; line 61-64 of it still says photos are phase 3.
 *
 * WHAT IS FAKED, AND WHERE. Two new seams, and only two:
 *
 *   the pipeline   INJECTED as a `Pipeline` prop — `{ process, dispose }` from
 *                  lib/media/pipeline.ts. Not mocked as a module, and not the
 *                  real one: the real one spawns a Web Worker that calls
 *                  `createImageBitmap` and `OffscreenCanvas.convertToBlob`,
 *                  neither of which jsdom has. The prop defaults to a lazily
 *                  created real pipeline, which is what ships; every test here
 *                  passes a fake whose output is known byte for byte, so
 *                  "the derivative was uploaded" and "the ORIGINAL was
 *                  uploaded" are different assertions rather than two readings
 *                  of one opaque blob.
 *   the media PUTs MSW, at the HTTP layer, exactly like every other Pod write
 *                  in this file. `uploadPhoto` is NOT mocked: the precondition
 *                  (`If-None-Match: *`), the credential and the content type
 *                  are asserted on the real outgoing requests, because a spy on
 *                  `uploadPhoto` would pass against an editor that hand-rolled
 *                  a blind PUT of its own.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   `schema:dateCreated` ON A NEW PHOTO. §6 requires a UTC offset on every
 *   xsd:dateTime, and lib/media/exif.ts yields an offset-less wall clock —
 *   EXIF's DateTimeOriginal has no zone and OffsetTimeOriginal is usually
 *   absent (§11.5). Stage 1 therefore cannot produce a valid one, so no test
 *   below expects it. The absence is not asserted either: `Photo.safeParse` in
 *   the draft test refuses an offset-less one, which is the check that matters,
 *   and a stage-2 implementation that supplies a real offset must not go red
 *   for having done the right thing. Carrying an EXISTING one through is a
 *   different question and is scenario 4's.
 *
 *   THE EXIF GPS → COORDINATE WIRE. A photo's GPS goes through §9 steps 1-4
 *   like any other coordinate, and that is its own task. The fake pipeline runs
 *   the REAL `readMetadata` over the REAL fixture bytes so the seam is faithful
 *   when it arrives, but nothing below asserts on it.
 * ════════════════════════════════════════════════════════════════════════ */

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
const PHOTOS_LABEL = LABEL.photos;

/**
 * A real JPEG with real EXIF, built byte by byte by test/fixtures/exif-jpeg.ts.
 *
 * Not an empty `new File([], …)`: the container path is `sha256(source)[0..16]`
 * and the metadata read is over these bytes, so a file with no bytes would make
 * both of those vacuous.
 */
const jpegFile = (name: string) => {
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
const WEB_BYTES = [0x57, 0x45, 0x42, 0x50, 0x21];
const THUMB_BYTES = [0x54, 0x48, 0x21];
/** Inside BLUR_BUDGET_BYTES. It rides in the entry's Turtle and in the draft's
 *  JSON, which is the whole reason a placeholder is a string and not bytes. */
const BLUR =
  "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

const blobOf = (bytes: number[], type: string) => new Blob([new Uint8Array(bytes)], { type });

/**
 * A pipeline that succeeds, with output nobody has to guess at.
 *
 * `metadata` comes from the REAL `readMetadata` over the REAL file bytes rather
 * than from a literal: the fake's job is to stand in for the worker, not to
 * stand in for the EXIF reader, and a hand-written metadata object would let a
 * GPS wire be built against a shape lib/media/exif.ts does not produce.
 */
function fakePipeline() {
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
 * A pipeline that refuses the file, REJECTING rather than resolving an error
 * value — that is `createPipeline`'s own contract: it rejects with
 * `new Error(data.message)` when the worker reports `ok: false`.
 */
function failingPipeline(message: string): Pipeline {
  return {
    process: () => Promise.reject(new Error(message)),
    dispose() {},
  };
}

/** The reason the owner must be given. Distinctive on purpose: it comes from
 *  the FAKE, so finding it on screen asserts that the real reason travels,
 *  rather than asserting this file's idea of how a failure is worded. */
const DECODE_FAILURE = "the decoder could not read this file";

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
function mediaFake(script: { status?: number } = {}) {
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

/** §7.3's own path shape, asserted rather than assumed: content-addressed,
 *  16 hex characters, and named from the BLOB's type (never from what was
 *  asked for — `convertToBlob` returns PNG when it cannot encode WebP). */
const MEDIA_PATH = /^\/travel\/media\/[0-9a-f]{16}\/(web|thumb)\.webp$/;

const pickPhoto = (file: File) => {
  const input = screen.getByLabelText(PHOTOS_LABEL);
  fireEvent.change(input, { target: { files: [file] } });
};

/* ─────────────────────────────────────────────── 10a. a photo that works ── */

describe("entry editor — a picked photo", () => {
  /**
   * UPLOAD ON PICK, and the assertion that says so is the `src`.
   *
   * An editor that held the File and uploaded at save time would also render an
   * `<img>` — from `URL.createObjectURL`, a `blob:` URL that dies with the page
   * and cannot be autosaved. So "shown as attached" is asserted as "shown FROM
   * THE POD": the element the owner sees points at the resource that now
   * exists, which is the only version of "attached" that survives a reload.
   */
  it("uploads a picked photo and shows it as attached", async () => {
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const source = jpegFile("beach.jpg");
    await renderEditor(fake.session, { pipeline: rig.pipeline });

    pickPhoto(source);

    const shown = await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    /* THE FILE REALLY WENT THROUGH THE PIPELINE, with all of its bytes. */
    expect(rig.processed, "the pipeline was not given the picked file").toEqual([source.size]);
    expect(source.size, "the JPEG fixture is empty, so nothing below is a real trace").
      toBeGreaterThan(0);

    /* BOTH DERIVATIVES, ONE CONTAINER, EACH WITH ITS PRECONDITION. */
    for (const put of media.puts) {
      const url = new URL(put.url);
      expect(url.origin).toBe(new URL(POD).origin);
      expect(url.pathname).toMatch(MEDIA_PATH);
      expect(put.headers["if-none-match"], `a blind PUT of ${url.pathname}`).toBe("*");
      expect(
        put.headers.authorization,
        `${url.pathname} was written without the session credential`,
      ).toBe(CREDENTIAL);
      expect(put.headers["content-type"], `${url.pathname} was typed from the request, not the blob`)
        .toMatch(/^image\/webp\b/);
    }
    expect(media.containers(), "the two derivatives went to different containers").toHaveLength(1);

    /**
     * WHAT WAS UPLOADED IS THE DERIVATIVE, NOT THE ORIGINAL — the media rules:
     * originals are never uploaded, and a photo's GPS leaves with them.
     *
     * PINNED ON THE NAMES AND THE CONTENT TYPES, not on the bytes, and the
     * reason is in `mediaFake`'s docblock: a Blob body is unreadable in this
     * environment. It is not a weaker claim than it looks. Both come from the
     * DERIVATIVE's blob — `extensionFor(web.blob.type)` and the mime handed to
     * `putGuarded` — so a picked JPEG that went up untouched would be
     * `image/jpeg` at `.../web.jpg`, and both assertions would fail. The
     * `rig.processed` check above is the other half: the file went through the
     * pipeline rather than around it.
     */
    expect(media.names(), "the derivatives are not named from the encoded blob").toEqual(
      new Set(["web.webp", "thumb.webp"]),
    );

    /* SHOWN FROM THE POD. */
    const src = shown.getAttribute("src") ?? "";
    expect(src, "the attached photo is shown from a local object URL, not from the Pod").not.
      toMatch(/^blob:/);
    expect(new URL(src, window.location.href).pathname).toMatch(MEDIA_PATH);

    /* STRUCTURALLY SETTLED, not worded. A settled photo is a `status`; a failed
       one is an `alert` (10b). Asserting the pair is what keeps either from
       being satisfied by a screen that announces everything the same way. */
    expect(screen.queryAllByRole("alert"), "a photo that worked raised an alert").toEqual([]);
    expect(
      screen.getAllByRole("status"),
      "nothing announced that the photo had settled",
    ).not.toHaveLength(0);
  });
});

/* ──────────────────────────────────────────── 10b. a photo that does not ── */

describe("entry editor — a photo that fails", () => {
  /**
   * ONE UNREADABLE FILE MUST NOT COST THE OWNER THE PROSE THEY JUST WROTE.
   *
   * Three claims, and the third is the one the brief left out. Without it this
   * test passes over a real defect: an editor that renders an optimistic slot
   * with a local preview URL, announces the failure, and then saves that slot
   * anyway writes `schema:contentUrl <blob:…>` into a public resource — a photo
   * that 404s for every reader, on an entry that reports itself saved.
   */
  it("keeps the entry saveable when a photo fails, and leaves it out of what is saved", async () => {
    const pod = podFake();
    const media = mediaFake();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { pipeline: failingPipeline(DECODE_FAILURE) });

    pickPhoto(jpegFile("broken.jpg"));

    /* ANNOUNCED, AS AN ALERT, CARRYING THE REASON THE PIPELINE GAVE. */
    const alerts = await screen.findAllByRole("alert");
    expect(
      alerts.map((a) => a.textContent ?? "").join(" "),
      "the failure was announced without saying why",
    ).toMatch(new RegExp(DECODE_FAILURE, "i"));

    /* NOTHING WAS UPLOADED: a photo the pipeline refused has no bytes to put. */
    expect(media.puts, "a photo that never decoded was uploaded anyway").toEqual([]);

    /* AND THE ENTRY IS STILL SAVEABLE. The form fills with the failure on
       screen, which is the state the owner is actually in. */
    fillNewEntry();
    expect(saveButton(), "one bad photo took the Save button with it").toBeEnabled();

    await act(async () => {
      fireEvent.click(saveButton());
    });
    // NOT `clickSaveAndWait`: it waits for `outcomeText()` to be non-empty and
    // the photo's own alert already made it so, so it would return before the
    // save had done anything. Wait for the request instead.
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    /* THE MUTATION HALF FIRST: this really is a save that happened, so the
       emptiness below is an absence and not a request that never went out. */
    expect(oneObject(quads, subject, SCHEMA.headline)?.value).toBe(
      "Rain on the Philosopher's Path",
    );

    expect(
      objectsOf(quads, subject, SCHEMA.image).map((t) => t.value),
      "a photo that failed reached the saved entry",
    ).toEqual([]);
    expect(put.body, "the failed file's name was written into the entry").not.toContain(
      "broken.jpg",
    );
    expect(put.body, "an optimistic local preview URL was saved as a photo").not.toContain("blob:");
  });
});

/* ──────────────────────────────────────────── 10c. what the draft holds ──── */

describe("entry editor — a photo in the autosaved draft", () => {
  /**
   * THE DECIDING ARGUMENT FOR UPLOAD-ON-PICK, stated as the invariant rather
   * than as bytes.
   *
   * `localStorage` takes strings. A `File` or a `Blob` in the draft object
   * serialises to `{}` — it does not throw, and it does not print
   * "[object Blob]" — so the draft is written, reports success, and restores a
   * photo with no URL on it. That is why the assertion is `Photo.safeParse`:
   * what came back out of storage has to be a photo this app could render.
   *
   * NOT FROZEN TO BYTES, AND NOT ON A FAKE CLOCK. `savedAt` moves with a real
   * debounce and comparing the stored string against a literal is how this
   * project has already written tests that race a timer. The storage is the
   * injected fake (section 8's), so nothing here touches the file-wide
   * `window.localStorage` and nothing can leak into the next test.
   */
  it("stores a usable photo in the autosaved draft, and no Blob", async () => {
    const media = mediaFake();
    const store = fakeStorage();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, {
      pipeline: fakePipeline().pipeline,
      storage: store.storage,
    });

    fillNewEntry();
    pickPhoto(jpegFile("beach.jpg"));
    await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    const key = draftKeyFor(OWNER, NEW_SCOPE);
    let raw = "";
    await waitFor(
      () => {
        const stored = store.items.get(key);
        expect(stored, "no draft was autosaved at all").toBeDefined();
        const held = JSON.parse(stored!) as { photos?: unknown[] };
        expect(held.photos, "the autosaved draft carries no photos").toHaveLength(1);
        raw = stored!;
      },
      { timeout: DEBOUNCE * 6, interval: 25 },
    );

    const draft = JSON.parse(raw) as { photos: unknown[] };
    const held = draft.photos[0] as Record<string, unknown>;

    /* A BLOB SERIALISES TO `{}`, so this is the assertion that catches it. */
    expect(
      typeof held.contentUrl,
      "the stored photo has no contentUrl — which is what a Blob serialises to",
    ).toBe("string");
    expect(new URL(String(held.contentUrl)).pathname).toMatch(MEDIA_PATH);

    /* USABLE, by the app's own definition of the word. */
    const parsed = Photo.safeParse(held);
    expect(
      parsed.success || JSON.stringify(parsed.error?.issues),
      "the stored photo does not round-trip into a Photo",
    ).toBe(true);

    /* ALL THREE DERIVATIVES AND THE DIMENSIONS, which the media rules require
       to be stored — the placeholder is a string precisely so it can ride in
       JSON and in Turtle rather than as bytes. */
    expect(new URL(String(held.thumbnailUrl)).pathname).toMatch(MEDIA_PATH);
    expect(held.width).toBe(1600);
    expect(held.height).toBe(1067);
    expect(held.encodingFormat).toBe("image/webp");
    expect(held.blurDataUrl).toBe(BLUR);

    /* AND NO BYTES ANYWHERE IN IT. */
    expect(raw, "a Blob was stringified into the draft").not.toContain("[object Blob]");
    expect(raw, "a local object URL was persisted; it dies with the page").not.toContain("blob:");
  });
});

/* ─────────────────────────────────── 10d. an edit that touches no photo ──── */

describe("entry editor — photos an edit did not touch", () => {
  /**
   * THE SAME RULE `created`, `datePublished` AND THE PLACE ALREADY FOLLOW: an
   * edit that rewrites the resource without them destroys them silently, and
   * for photos it destroys the binaries' only reference as well.
   *
   * AGAINST THE §7.3 FIXTURE, not a hand-built entry: the normative block is
   * the contract (§11 guardrail 6) and it carries exactly one photo with all
   * nine of its predicates populated, including a `schema:dateCreated` that
   * already has an offset on it. Carrying that through is a different question
   * from minting one, which stage 1 cannot do.
   */
  it("carries an existing entry's photos through an edit that does not touch them", async () => {
    const pod = podFake();
    const fake = fakeStudioSession();
    const entry = await specEntry();

    // NON-VACUOUS: the fixture really does carry a photo to preserve. Without
    // this the assertions below are about an entry that never had one.
    expect(entry.photos, "the §7.3 fixture carries no photo to preserve").toHaveLength(1);
    const kept = entry.photos[0]!;
    expect(kept.dateCreated, "the fixture's photo carries no dateCreated").toBeDefined();

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      pipeline: fakePipeline().pipeline,
    });

    /**
     * THE ANCHOR. "an edit that does not touch photos" is only a claim about a
     * form that HAS a photo control; without this the test passes just as
     * happily on a build with no picker at all, which is exactly the shape of
     * vacuous pass this file keeps having to guard against.
     */
    expect(
      screen.queryAllByLabelText(PHOTOS_LABEL),
      "the editor has no photo control, so there is nothing to leave untouched",
    ).toHaveLength(1);

    setText(LABEL.headline, "First night in Shinjuku, revisited");
    await clickSaveAndWait();

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    // The mutation half: this is a save that changed something.
    expect(oneObject(quads, subject, SCHEMA.headline)?.value).toBe(
      "First night in Shinjuku, revisited",
    );

    const images = objectsOf(quads, subject, SCHEMA.image).map((t) => t.value);
    expect(images, "the edit dropped the photo the entry arrived with").toEqual([
      `${put.url}#photo-1`,
    ]);
    const node = images[0]!;

    // A fragment, never a blank node (§11 guardrail 2).
    expect(quads.every((q) => q.subject.termType !== "BlankNode")).toBe(true);
    expect(quads.every((q) => q.object.termType !== "BlankNode")).toBe(true);

    expect(oneObject(quads, node, SCHEMA.contentUrl)?.value).toBe(kept.contentUrl);
    expect(oneObject(quads, node, SCHEMA.thumbnailUrl)?.value).toBe(kept.thumbnailUrl);

    const caption = oneObject(quads, node, SCHEMA.caption);
    expect(caption?.value).toBe(kept.caption?.value);
    expect(languageOf(caption), "the caption lost its language tag").toBe(kept.caption?.language);

    for (const [predicate, expected] of [
      [SCHEMA.width, kept.width],
      [SCHEMA.height, kept.height],
      [DY.sortOrder, kept.sortOrder],
    ] as const) {
      const term = oneObject(quads, node, predicate);
      expect(Number(term?.value), predicate).toBe(expected);
      expect(datatypeOf(term), predicate).toBe(XSD.integer);
    }

    expect(oneObject(quads, node, SCHEMA.encodingFormat)?.value).toBe(kept.encodingFormat);
    expect(oneObject(quads, node, DY.blurDataUrl)?.value).toBe(kept.blurDataUrl);

    const dateCreated = oneObject(quads, node, SCHEMA.dateCreated);
    expect(dateCreated?.value).toBe(kept.dateCreated);
    expect(datatypeOf(dateCreated)).toBe(XSD.dateTime);
    expect(dateCreated?.value, "the photo's timestamp lost its offset").toMatch(
      /[+-]\d{2}:\d{2}$/,
    );

    /* AND THE DENORMALISED ROW KEEPS ITS THUMBNAIL. §7.4's index is what the
       public trip page renders from; an entry whose photo survived in the
       document but not in the row loses its picture on every listing. */
    const index = pod.indexPut()!;
    const { quads: rowQuads, row } = indexRowOf(index.body, JAPAN.indexUrl, put.url);
    expect(row, "the edited entry has no row in the index it was written to").toBeDefined();
    expect(oneObject(rowQuads, row!, DY.thumbnail)?.value).toBe(kept.thumbnailUrl);
  });
});

/* ─────────────────────────── 10e. a photo added to an entry that has one ── */

/**
 * THE PRODUCT OF THE TWO BRANCHES, WHICH NOTHING ABOVE RENDERS.
 *
 * 10a, 10b and 10c pick a photo and never pass `initial`, so what the entry
 * arrived with is always empty. 10d passes `initial` and never picks, so what
 * was attached here is always empty. Neither half therefore says anything about
 * an edit that does BOTH — and that is the half where photos are destroyed.
 *
 * MEASURED, NOT SUPPOSED: with `photosFor` replaced by "if nothing was picked,
 * keep what was carried; otherwise save what was picked", the whole suite is
 * 927 passed and 2 todo — no red anywhere. The saved entry is a whole-document
 * replace serialised from `entry.photos` (lib/pod/save-entry.ts), so a photo
 * left out of that array has its triples removed and its binary orphaned:
 * nothing else on the Pod references `travel/media/<hash>/`.
 * ────────────────────────────────────────────────────────────────────────── */

describe("entry editor — a photo added to an entry that already has one", () => {
  it("keeps both, and numbers the new one after the one that was there", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    const entry = await specEntry();

    // NON-VACUOUS, both halves: there is a photo to preserve, and it carries the
    // number the new one has to be placed after.
    expect(entry.photos, "the §7.3 fixture carries no photo to preserve").toHaveLength(1);
    const kept = entry.photos[0]!;
    expect(kept.sortOrder, "the fixture's photo carries no sortOrder").toBe(1);

    await renderEditor(fake.session, {
      initial: { entry, etag: '"entry-7"' },
      pipeline: rig.pipeline,
    });

    pickPhoto(jpegFile("beach.jpg"));
    await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    // NOT `clickSaveAndWait`: the attached photo's own `role="status"` has
    // already made `outcomeText()` non-empty, so it would return before the save
    // had done anything. 10b's reasoning, and the same fix.
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const subject = `${put.url}#it`;

    const images = objectsOf(quads, subject, SCHEMA.image).map((t) => t.value);
    expect(
      images,
      "the entry does not carry both photos: adding one destroyed the one it arrived with",
    ).toEqual([`${put.url}#photo-1`, `${put.url}#photo-2`]);

    /* THE CARRIED ONE, UNTOUCHED — the same URL and the same number. Renumbering
       it would rewrite §7.3 data the owner never touched. */
    const carried = images[0]!;
    expect(oneObject(quads, carried, SCHEMA.contentUrl)?.value).toBe(kept.contentUrl);
    expect(Number(oneObject(quads, carried, DY.sortOrder)?.value)).toBe(kept.sortOrder);

    /* AND THE NEW ONE, ON THE POD AND NUMBERED AFTER IT. */
    const added = images[1]!;
    const contentUrl = oneObject(quads, added, SCHEMA.contentUrl)?.value ?? "";
    expect(new URL(contentUrl).pathname, "the added photo is not a Pod media URL").toMatch(
      MEDIA_PATH,
    );
    expect(contentUrl, "both fragments point at the same binary").not.toBe(kept.contentUrl);
    const order = oneObject(quads, added, DY.sortOrder);
    expect(
      Number(order?.value),
      "the added photo did not take the next position after the carried one",
    ).toBe(2);
    expect(datatypeOf(order), "sortOrder is not an xsd:integer").toBe(XSD.integer);

    /* THE LISTING'S PICTURE DOES NOT MOVE. §7.4's row is denormalised from
       `photos[0]`, so appending must not swap the cover of an entry the owner
       only added a picture to. */
    const index = pod.indexPut()!;
    const { quads: rowQuads, row } = indexRowOf(index.body, JAPAN.indexUrl, put.url);
    expect(row, "the edited entry has no row in the index it was written to").toBeDefined();
    expect(oneObject(rowQuads, row!, DY.thumbnail)?.value).toBe(kept.thumbnailUrl);
  });

  /**
   * A PHOTO THE ENTRY ALREADY HAS, PICKED AGAIN.
   *
   * Not a hypothetical: the container is `sha256(source)[0..16]`, so the same
   * file always lands at the same URL and `uploadPhoto` reads the 412 as reuse.
   * The upload is therefore harmless and the APPEND is not — two `#photo-N`
   * fragments pointing at one binary render the same picture twice on every
   * public listing, and this editor has no way to remove one.
   *
   * The carried photo is put at the container the picked file really hashes to,
   * using the app's own `mediaHash`, so this cannot pass against an editor that
   * deduplicates on something else.
   */
  it("attaches a photo the entry already carries only once", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();

    const source = jpegFile("beach.jpg");
    const container = mediaContainer(POD, await mediaHash(await source.arrayBuffer()));
    expect(new URL(container).pathname, "the container is not §7.3's media shape").toMatch(
      /^\/travel\/media\/[0-9a-f]{16}\/$/,
    );

    const entry = await specEntry();
    const already: Entry = {
      ...entry,
      photos: [
        { ...entry.photos[0]!, contentUrl: `${container}web.webp`, thumbnailUrl: `${container}thumb.webp` },
      ],
    };

    await renderEditor(fake.session, {
      initial: { entry: already, etag: '"entry-7"' },
      pipeline: rig.pipeline,
    });

    pickPhoto(source);
    await screen.findByRole("img", { name: /beach\.jpg/i });
    // It really went up — this is a save-time deduplication, not a pick the
    // editor quietly ignored.
    await waitFor(() => expect(media.puts).toHaveLength(2));

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const images = objectsOf(quads, `${put.url}#it`, SCHEMA.image).map((t) => t.value);

    expect(images, "the same photo was attached twice").toEqual([`${put.url}#photo-1`]);
    expect(oneObject(quads, images[0]!, SCHEMA.contentUrl)?.value).toBe(`${container}web.webp`);
    // And the carried photo kept everything else it had.
    expect(oneObject(quads, images[0]!, SCHEMA.caption)?.value).toBe(already.photos[0]!.caption?.value);
  });

  /** The same defect on a CREATE, where there is nothing carried to compare
   *  against: one file, picked twice, is one photo. */
  it("attaches the same file picked twice only once", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();
    await renderEditor(fake.session, { pipeline: rig.pipeline });

    pickPhoto(jpegFile("beach.jpg"));
    pickPhoto(jpegFile("beach.jpg"));
    await waitFor(() => expect(screen.getAllByRole("img", { name: /beach\.jpg/i })).toHaveLength(2));
    // Both picks really ran: two files through the pipeline, four PUTs to one
    // content-addressed container (a real Pod answers the second pair 412).
    expect(rig.processed).toHaveLength(2);
    await waitFor(() => expect(media.puts).toHaveLength(4));
    expect(media.containers(), "the same bytes went to two containers").toHaveLength(1);

    fillNewEntry();
    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    expect(
      objectsOf(quads, `${put.url}#it`, SCHEMA.image).map((t) => t.value),
      "one file picked twice was written as two photos",
    ).toEqual([`${put.url}#photo-1`]);
  });

  /**
   * A CARRIED PHOTO WITH NO `dy:sortOrder` OF ITS OWN.
   *
   * `Photo.sortOrder` is optional — a Pod contains whatever was written to it,
   * including data from an older build — and lib/pod/entry-model.ts fills the
   * gap with the photo's ONE-BASED POSITION rather than leaving it unwritten.
   * So a single unnumbered carried photo is serialised as `dy:sortOrder 1`, and
   * the number a new photo may take is 2.
   *
   * WHAT THIS CATCHES, and it catches two different wrong answers: seeding the
   * search at `-1` gives the new photo 0, which sorts it in FRONT of a photo the
   * owner already had, and seeding it at `carried.length` gives 1 — a collision
   * with the very photo the fallback exists for.
   */
  it("numbers a new photo past a carried one that has no sortOrder", async () => {
    const pod = podFake();
    const media = mediaFake();
    const rig = fakePipeline();
    const fake = fakeStudioSession();

    const entry = await specEntry();
    const unnumbered: Entry = {
      ...entry,
      photos: [{ ...entry.photos[0]!, sortOrder: undefined }],
    };
    expect(unnumbered.photos[0]!.sortOrder, "the carried photo still has a number").toBeUndefined();

    await renderEditor(fake.session, {
      initial: { entry: unnumbered, etag: '"entry-7"' },
      pipeline: rig.pipeline,
    });

    pickPhoto(jpegFile("beach.jpg"));
    await screen.findByRole("img", { name: /beach\.jpg/i });
    await waitFor(() => expect(media.puts).toHaveLength(2));

    await act(async () => {
      fireEvent.click(saveButton());
    });
    await waitFor(() => expect(pod.entryPut()).toBeDefined());

    const put = pod.entryPut()!;
    const quads = quadsOf(put.body, put.url);
    const images = objectsOf(quads, `${put.url}#it`, SCHEMA.image).map((t) => t.value);
    expect(images).toHaveLength(2);

    // What the serialiser gave the carried photo, which is the number that is
    // taken. Asserted rather than assumed: it is the premise of the next line.
    const carried = Number(oneObject(quads, images[0]!, DY.sortOrder)?.value);
    expect(carried, "an unnumbered carried photo is no longer written as its position").toBe(1);

    const added = Number(oneObject(quads, images[1]!, DY.sortOrder)?.value);
    expect(added, "the added photo took a position the carried photo already occupies").not.toBe(
      carried,
    );
    expect(added, "the added photo did not take the next free position").toBe(2);
  });
});

/* ────────────────── 10f. a photo that settles AFTER the save has landed ──── */

/**
 * THE DEFECT, AND IT LOSES THE PHOTO ENTIRELY — from the entry AND from the
 * draft, with the screen saying the opposite.
 *
 * `settleDraft` sets `touched.current = false` when the Pod holds what the form
 * holds, which at that instant is true and legitimate: a slot still `decoding`
 * contributes nothing to `attached`, so `sameText` compares two empty photo
 * lists and agrees. The autosave effect then returns at `if (!touched.current)`,
 * and the ONLY thing that put it back to `true` was a DOM `change` event on the
 * `<form>`. A slot moving `uploading → ready` changes `attached` and re-runs the
 * effect — but arms nothing, so the window it opens is never opened at all.
 *
 * ORDINARY USE, NOT A CONTRIVED RACE. Save is `disabled={saving}` and nothing
 * else, so "pick a photo, type the headline, press Save" is a sequence the UI
 * invites while the decode is still running. A second later the row reads
 * "beach.jpg is attached to this entry", the derivatives really are on the Pod
 * — and the entry resource does not reference them and `localStorage` holds
 * nothing. Close the tab: the photo is orphaned and silently absent, and every
 * surface the owner can see said it was attached.
 *
 * NOT THE NARROWER RACE, which is already handled and must stay that way: a
 * settle DURING the round trip is caught by `live.current.text` and
 * `samePhotos` inside `save()`. This one lands strictly AFTER `settleDraft` has
 * run, which is the window those two cannot see.
 *
 * BOTH HALVES ARE ASSERTED, and the first is what stops the second being
 * vacuous: the entry PUT is read to show the photo genuinely did NOT reach the
 * Pod, and the store is read at that same moment to show the draft key really
 * is empty. Only then is the settle released.
 *
 * WHAT WOULD BREAK IT: deleting `if (next.state === "ready") touched.current =
 * true` from `attach`'s `move()`. Measured, not supposed — removing that line
 * turns the final assertion red with `[]` for the draft keys.
 */
describe("entry editor — a photo that settles after the save", () => {
  const CREATED_URL = `${JAPAN.entriesContainer}2026-04-02-kyoto.ttl`;
  const CREATED_KEY = draftKeyFor(OWNER, CREATED_URL);

  const pastTheWindow = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE + 400));
    });

  const draftKeys = (store: ReturnType<typeof fakeStorage>) =>
    [...store.items.keys()].filter((k) => k.startsWith("wig.draft."));

  /**
   * A pipeline held open at `process`, so the slot stays `decoding` for exactly
   * as long as this test wants it to. The output when it does resolve is the
   * real fake's, so the settle that follows is the ordinary one and not a
   * shape invented here.
   */
  function heldPipeline() {
    const inner = fakePipeline();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pipeline: Pipeline = {
      async process(file: Blob) {
        await gate;
        return inner.pipeline.process(file);
      },
      dispose() {
        inner.pipeline.dispose();
      },
    };
    return { pipeline, release: () => release() };
  }

  it("keeps a photo that settles after the save, rather than losing it from both", async () => {
    const pod = podFake();
    const media = mediaFake();
    const store = fakeStorage();
    const held = heldPipeline();
    await renderEditor(fakeStudioSession().session, {
      storage: store.storage,
      pipeline: held.pipeline,
    });

    fillNewEntry();
    pickPhoto(jpegFile("beach.jpg"));

    // THE PREMISE: the slot is still working when Save is pressed, and the
    // control invites it. If a later change disables Save while a photo is in
    // flight, this line fails and the right response is to revisit this test
    // deliberately rather than to reach past the guard.
    expect(
      await screen.findByText(/Preparing beach\.jpg/i),
      "the photo settled before the save, so this test proves nothing",
    ).toBeInTheDocument();
    expect(
      saveButton(),
      "Save is disabled while a photo is in flight, so this scenario is unreachable",
    ).toBeEnabled();

    await clickSaveAndWait();

    /* ── half one: the photo is demonstrably NOT on the entry ─────────────── */
    const put = pod.entryPut();
    expect(put, "the entry was never written").toBeDefined();
    expect(
      quadsOf(put!.body, put!.url).filter((q) => q.predicate.value === SCHEMA.image),
      "the in-flight photo reached the entry, so the loss this test is about cannot happen",
    ).toEqual([]);

    /* ── …and the draft was settled, which is what disarms the autosave ───── */
    expect(
      draftKeys(store),
      "the save did not settle the draft, so `touched` was never reset and this test proves nothing",
    ).toEqual([]);
    expect(media.puts, "the derivatives went up before the gate opened").toEqual([]);

    /* ── half two: NOW the photo settles, and it must not vanish ──────────── */
    held.release();
    await screen.findByText(/beach\.jpg is attached to this entry/i);
    await waitFor(() => expect(media.puts).toHaveLength(2));

    await pastTheWindow();

    // THE DECISION. A settle is a change to the form and has to arm the
    // autosave window like any other one — under the key this editor owns now
    // that the entry exists, not stranded under `new`.
    expect(
      draftKeys(store),
      "the settled photo is in neither the entry nor the draft: close the tab and it is orphaned",
    ).toEqual([CREATED_KEY]);

    const kept = parseDraft(store.items.get(CREATED_KEY)!) as { photos?: unknown[] };
    expect(kept.photos, "the draft was written without the photo that settled").toHaveLength(1);
    const photo = kept.photos![0] as Record<string, unknown>;
    expect(
      Photo.safeParse(photo).success,
      "what was kept does not round-trip into a Photo",
    ).toBe(true);
    expect(new URL(String(photo.contentUrl)).pathname).toMatch(MEDIA_PATH);
  });
});

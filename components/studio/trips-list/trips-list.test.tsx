// @vitest-environment jsdom

/**
 * `TripsList` — Task 3.2, RED. Its two new hooks don't exist yet either, so
 * they cannot be module-mocked (vi.mock needs the specifier to resolve);
 * this drives the real stack over a fake Pod (MSW), with `@/lib/pod/access`
 * mocked as entry-editor.harness.tsx mocks it.
 */

import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { NS } from "@/lib/vocab";
import { server } from "@/test/msw";
import { computeIndexFromRows, serialiseIndex } from "@/lib/pod/index-model";
import { diaryUrl, tripUrl, tripIndexUrl } from "@/lib/pod/read";
import type { JSX } from "react";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ══════════════════════════════════════════════ mock: lib/pod/access ══ */

/**
 * The ONE mock in this file, for the reason entry-editor.harness.tsx gives:
 * a fake convincing enough to drive @inrupt/solid-client's real ACL
 * negotiation over MSW would encode that library's request sequence, not
 * this component's behaviour.
 */
const accessCalls = vi.hoisted(() => [] as { op: string; url: string }[]);

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
    return state(url, read);
  };
  return {
    makePublic: record("makePublic", true),
    makePrivate: record("makePrivate", false),
    getAccess: async (url: string) => state(url, true),
    createContainer: async (url: string) => state(url, true),
    initialiseContainers: async (opts: { podRoot: string }) => ({
      ok: true as const,
      value: { podRoot: opts.podRoot, containers: [] },
    }),
  };
});

afterEach(() => {
  cleanup();
  accessCalls.length = 0;
});

/* ══════════════════════════════════════════════ loading the module under test ══ */

const importModule = (specifier: string): Promise<unknown> =>
  import(/* @vite-ignore */ specifier);

async function loadTripsList() {
  const mod = (await importModule("@/components/studio/trips-list").catch((cause: unknown) => {
    throw new Error(
      "components/studio/trips-list/trips-list.tsx does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(
      "components/studio/trips-list/trips-list.tsx exists but default-exports no component — still the red step.",
    );
  }
  return mod.default as (props: { session: StudioSessionLike; podRoot: string }) => JSX.Element;
}

/* ══════════════════════════════════════════════════════════════ fixtures ══ */

const blocks = [
  ...readFileSync("docs/data-model.md", "utf8").matchAll(/```turtle\n([\s\S]*?)```/g),
].map((m) => m[1]);
const [DIARY_FIXTURE, TRIP_FIXTURE] = blocks;

const POD = "https://pod.test.example/";
const TRIPS_URL = `${POD}travel/trips/`;
const OWNER = "https://alice.example/profile/card#me";
const CREDENTIAL = "DPoP owner-token";
const REVALIDATE_URL = "http://localhost:3000/api/revalidate";

/** Fail loudly on a drifted anchor rather than silently pass the unmodified
 *  fixture — the same guard `lib/studio/trips.test.ts` uses. */
function mutate(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`fixture anchor did not match: ${from}`);
  return source.replaceAll(from, to);
}

function tripFixture(slug: string, name: string, draft: boolean): string {
  let t = mutate(TRIP_FIXTURE, '"2026-japan"', `"${slug}"`);
  t = mutate(t, '"Japan, spring"', `"${name}"`);
  if (draft) t = mutate(t, "dy:Published", "dy:Draft");
  return t;
}

const JAPAN_SLUG = "2026-japan";
const PATAGONIA_SLUG = "2025-patagonia";
const JAPAN_NAME = "Japan, spring";
const PATAGONIA_NAME = "Patagonia, unfinished";
const PATAGONIA_CONTAINER = `${TRIPS_URL}${PATAGONIA_SLUG}/`;
const JAPAN_ENTRIES = `${TRIPS_URL}${JAPAN_SLUG}/entries/`;
const PATAGONIA_ENTRIES = `${TRIPS_URL}${PATAGONIA_SLUG}/entries/`;
const JAPAN_TTL = tripFixture(JAPAN_SLUG, JAPAN_NAME, false);
const PATAGONIA_TTL = tripFixture(PATAGONIA_SLUG, PATAGONIA_NAME, true);

/** The §7.1 diary with the draft trip cut out — published-only, as §4 now
 *  requires. `mutate` with an identical replacement is an anchor check. */
const DIARY_PUBLISHED_ONLY = mutate(
  DIARY_FIXTURE,
  "<trips/2025-patagonia/trip.ttl#it>",
  "<trips/2025-patagonia/trip.ttl#it>",
).replace(/\s*,\s*<trips\/2025-patagonia\/trip\.ttl#it>/, "");

function containerTurtle(members: readonly string[]): string {
  const contains =
    members.length === 0 ? "" : ` ;\n    ldp:contains ${members.map((m) => `<${m}>`).join(", ")}`;
  return `@prefix ldp: <${NS.ldp}> .\n@prefix dcterms: <${NS.dcterms}> .\n\n<>\n    a ldp:BasicContainer, ldp:Container ;\n    dcterms:modified "2026-09-04T10:00:00+00:00"${contains} .\n`;
}

async function entriesTtl(indexUrl: string, tripIri: string, count: number): Promise<string> {
  const rows = Array.from({ length: count }, (_, i) => ({
    entryResource: `${indexUrl.replace(/entries\.ttl$/, "entries/")}e${i}.ttl#it`,
    title: { value: `Entry ${i}`, language: "en" },
    slug: `e${i}`,
  }));
  return serialiseIndex(indexUrl, tripIri, computeIndexFromRows(rows), "2026-01-01T00:00:00+00:00");
}

/* ══════════════════════════════════════════════════════════ the fake Pod ══ */

type Served = string | number;
type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };

/** Discriminates on the credential like a real Pod (§4's WAC fix), records
 *  every request, and answers PUT/POST for the publish flow. */
function fakePod(spec: { open?: Record<string, Served>; ownerOnly?: Record<string, Served> }) {
  const requests: Recorded[] = [];
  const record = async (request: Request) => {
    const headers: Record<string, string> = {};
    request.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    requests.push({ method: request.method, url: request.url, headers, body: await request.text() });
  };
  const respond = (served: Served) =>
    typeof served === "number"
      ? new HttpResponse(null, { status: served })
      : HttpResponse.text(served, { headers: { "content-type": "text/turtle", etag: '"v1"' } });

  server.use(
    http.get(`${POD}*`, async ({ request }) => {
      await record(request);
      const authed = request.headers.get("authorization") === CREDENTIAL;
      const guarded = spec.ownerOnly?.[request.url];
      if (guarded !== undefined) {
        return authed ? respond(guarded) : new HttpResponse("Forbidden", { status: 403 });
      }
      const open = spec.open?.[request.url];
      if (open !== undefined) return respond(open);
      return new HttpResponse("Not found", { status: 404 });
    }),
    http.put(`${POD}*`, async ({ request }) => {
      await record(request);
      if (request.headers.get("authorization") !== CREDENTIAL) {
        return new HttpResponse("Unauthorized", { status: 401 });
      }
      const exists =
        spec.open?.[request.url] !== undefined || spec.ownerOnly?.[request.url] !== undefined;
      if (request.headers.get("if-none-match") === "*" && exists) {
        return new HttpResponse("Precondition Failed", { status: 412 });
      }
      return new HttpResponse(null, { status: 205, headers: { etag: '"v2"' } });
    }),
    http.post(REVALIDATE_URL, async ({ request }) => {
      await record(request);
      const body = (await request.clone().json().catch(() => ({ tags: [] }))) as {
        tags?: string[];
      };
      return HttpResponse.json({ revalidated: new Set(body.tags ?? []).size, rejected: [] });
    }),
  );

  return { requests, puts: (url: string) => requests.filter((r) => r.method === "PUT" && r.url === url) };
}

function fakeSession(): StudioSessionLike {
  const authedFetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", CREDENTIAL);
    return globalThis.fetch(input, { ...init, headers });
  };
  const session = {
    info: { isLoggedIn: true, webId: OWNER },
    events: new EventEmitter(),
    fetch: authedFetch,
    async login(): Promise<void> {},
    async logout(): Promise<void> {},
  };
  return session as unknown as StudioSessionLike;
}

/**
 * The usual scenario: one published trip (2 entries), one draft (0 entries),
 * a diary that already omits the draft, and both containers/indexes served.
 * The entries.ttl INDEX is served too but is no longer what entryCount reads
 * from (fix round 1, finding E2) — the entries/ CONTAINER listing below is.
 */
async function twoTripPod() {
  return fakePod({
    open: {
      [diaryUrl(POD)]: DIARY_PUBLISHED_ONLY,
      [tripUrl(POD, JAPAN_SLUG)]: JAPAN_TTL,
      [tripIndexUrl(POD, JAPAN_SLUG)]: await entriesTtl(
        tripIndexUrl(POD, JAPAN_SLUG),
        `${tripUrl(POD, JAPAN_SLUG)}#it`,
        2,
      ),
      [JAPAN_ENTRIES]: containerTurtle(["e0.ttl", "e1.ttl"]),
    },
    ownerOnly: {
      [TRIPS_URL]: containerTurtle([`${JAPAN_SLUG}/`, `${PATAGONIA_SLUG}/`]),
      [tripUrl(POD, PATAGONIA_SLUG)]: PATAGONIA_TTL,
      [tripIndexUrl(POD, PATAGONIA_SLUG)]: await entriesTtl(
        tripIndexUrl(POD, PATAGONIA_SLUG),
        `${tripUrl(POD, PATAGONIA_SLUG)}#it`,
        0,
      ),
      [PATAGONIA_ENTRIES]: containerTurtle([]),
    },
  });
}

/* ══════════════════════════════════════════════════════════════ the tests ══ */

describe("the test environment this file declares", () => {
  it("is jsdom", () => {
    expect(window.navigator.userAgent).toMatch(/jsdom/i);
  });
});

describe("TripsList", () => {
  it("renders both trips with their status, entry count, and a New-trip affordance", async () => {
    await twoTripPod();
    const TripsList = await loadTripsList();

    render(
      <StrictMode>
        <TripsList session={fakeSession()} podRoot={POD} />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText(new RegExp(JAPAN_NAME))).toBeInTheDocument());
    expect(screen.getByText(new RegExp(PATAGONIA_NAME))).toBeInTheDocument();
    expect(screen.getByText(/published/i)).toBeInTheDocument();
    expect(screen.getByText(/draft/i)).toBeInTheDocument();
    // Two entries for Japan, none for Patagonia — somewhere on the page.
    expect(screen.getByText(/\b2\b/)).toBeInTheDocument();

    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/studio/trips/new");
    expect(links).toContain(`/studio/trips/${JAPAN_SLUG}`);
    expect(links).toContain(`/studio/trips/${PATAGONIA_SLUG}`);
  });

  it("renders a message, and does not throw, when the trips container cannot be listed", async () => {
    fakePod({ open: { [TRIPS_URL]: 403 } });
    const TripsList = await loadTripsList();

    render(<TripsList session={fakeSession()} podRoot={POD} />);

    // The render call above already proved "no throw"; this is the message.
    await waitFor(() => expect(screen.getByText(/could not|error|went wrong/i)).toBeInTheDocument());
  });

  /**
   * USES use-publish FOR THE ACTION: clicking Publish on the draft trip must
   * reach the real publishTrip → a PUT of `dy:Published` to ITS OWN
   * trip.ttl, and the container ACL reconciled through the mocked access.ts
   * — proving the wiring rather than a component that merely renders a button.
   */
  it("publishing the draft trip PUTs the new status and reconciles the container's ACL", async () => {
    await twoTripPod();
    const TripsList = await loadTripsList();

    render(
      <StrictMode>
        <TripsList session={fakeSession()} podRoot={POD} />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText(new RegExp(PATAGONIA_NAME))).toBeInTheDocument());
    const button = screen.getByRole("button", { name: /publish/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(accessCalls.some((c) => c.op === "makePublic" && c.url === PATAGONIA_CONTAINER)).toBe(
        true,
      ),
    );
  });

  // Fix round 1, finding E1's own covering test: a Pod that answers with no
  // ETag must never turn into `If-Match: ""`. Overrides only Japan's GET;
  // Patagonia's own (etag-bearing) button is the "not just no buttons" control.
  it("blocks publishing a trip whose Pod answered with no ETag, and never sends If-Match: \"\"", async () => {
    const pod = await twoTripPod();
    server.use(
      http.get(tripUrl(POD, JAPAN_SLUG), () =>
        HttpResponse.text(JAPAN_TTL, { headers: { "content-type": "text/turtle" } }),
      ),
    );
    const TripsList = await loadTripsList();

    render(
      <StrictMode>
        <TripsList session={fakeSession()} podRoot={POD} />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText(new RegExp(JAPAN_NAME))).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/reload to publish/i)).toBeInTheDocument());
    // The control: Patagonia's own button, from a trip whose ETag DID arrive,
    // still renders — so this is "one trip blocked", not "no buttons at all".
    expect(screen.getAllByRole("button", { name: /publish/i })).toHaveLength(1);

    const empty = pod.requests.filter(
      (r) => r.method === "PUT" && r.url === tripUrl(POD, JAPAN_SLUG) && r.headers["if-match"] === "",
    );
    expect(empty).toEqual([]);
  });

  /**
   * FIX ROUND 1, FINDING E2's own covering test, one layer up from
   * `use-studio-trips.test.ts`'s: the published-only index says 0 for a
   * trip whose entries are all drafts, and the rendered count must be the
   * entries/ CONTAINER's 2, not the index's 0.
   */
  it("counts a trip's entries including drafts, not just what the published-only index reports", async () => {
    fakePod({
      open: {
        [diaryUrl(POD)]: DIARY_PUBLISHED_ONLY,
        [tripUrl(POD, JAPAN_SLUG)]: JAPAN_TTL,
        [tripIndexUrl(POD, JAPAN_SLUG)]: await entriesTtl(
          tripIndexUrl(POD, JAPAN_SLUG),
          `${tripUrl(POD, JAPAN_SLUG)}#it`,
          0,
        ),
        [JAPAN_ENTRIES]: containerTurtle(["draft-1.ttl", "draft-2.ttl"]),
      },
      ownerOnly: { [TRIPS_URL]: containerTurtle([`${JAPAN_SLUG}/`]) },
    });
    const TripsList = await loadTripsList();

    render(<TripsList session={fakeSession()} podRoot={POD} />);

    await waitFor(() => expect(screen.getByText(new RegExp(JAPAN_NAME))).toBeInTheDocument());
    expect(screen.getByText(/\b2\b/)).toBeInTheDocument();
    expect(screen.queryByText(/\b0\b/)).not.toBeInTheDocument();
  });
});

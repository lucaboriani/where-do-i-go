// @vitest-environment jsdom

/**
 * `EntriesList` — Task 4.1, RED. Its own hook (`use-studio-entries`)
 * doesn't exist either, so it cannot be module-mocked (`vi.mock` needs the
 * specifier to resolve); this drives the real stack over a fake Pod (MSW),
 * with `@/lib/pod/access` mocked as `trips-list.test.tsx` mocks it.
 */

import { readFileSync } from "node:fs";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { DY, NS, STATUS } from "@/lib/vocab";
import { server } from "@/test/msw";
import { triples } from "@/test/graph";
import { computeIndexFromRows, serialiseIndex } from "@/lib/pod/index-model";
import { tripIndexUrl } from "@/lib/pod/read";
import type { JSX } from "react";
import type { Status } from "@/lib/pod/schema";
import type { StudioSessionLike } from "@/lib/studio/session";

/* ══════════════════════════════════════════════ mock: lib/pod/access ══ */

/** The ONE mock in this file — see `trips-list.test.tsx`'s own comment: a
 *  fake convincing enough to drive the real ACL negotiation over MSW would
 *  encode that library's request sequence, not this component's. */
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

interface EntriesListProps {
  session: StudioSessionLike;
  podRoot: string;
  tripSlug: string;
  tripStatus: Status | undefined;
}

async function loadEntriesList() {
  const mod = (await importModule("@/components/studio/entries-list").catch((cause: unknown) => {
    throw new Error(
      "components/studio/entries-list/entries-list.tsx does not exist yet — this is the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(
      "components/studio/entries-list/entries-list.tsx exists but default-exports no component — still the red step.",
    );
  }
  return mod.default as (props: EntriesListProps) => JSX.Element;
}

/* ══════════════════════════════════════════════════════════════ fixtures ══ */

/** §7.3's own normative Entry — the third `turtle` block in the data model. */
const ENTRY_FIXTURE = [
  ...readFileSync("docs/data-model.md", "utf8").matchAll(/```turtle\n([\s\S]*?)```/g),
].map((m) => m[1])[2];

const POD = "https://pod.test.example/";
const TRIP_SLUG = "2026-japan";
const ENTRIES_URL = `${POD}travel/trips/${TRIP_SLUG}/entries/`;
const OWNER = "https://alice.example/profile/card#me";
const CREDENTIAL = "DPoP owner-token";
const REVALIDATE_URL = "http://localhost:3000/api/revalidate";

/** Fails loudly on a drifted anchor rather than silently passing the
 *  unmodified fixture — the same guard `trips-list.test.tsx` uses. */
function mutate(source: string, from: string, to: string): string {
  if (!source.includes(from)) throw new Error(`fixture anchor did not match: ${from}`);
  return source.replaceAll(from, to);
}

function entryFixture(slug: string, headline: string, status: Status): string {
  let e = mutate(ENTRY_FIXTURE, '"2026-03-29-arrival"', `"${slug}"`);
  e = mutate(e, '"First night in Shinjuku"@en', `"${headline}"@en`);
  if (status === "draft") e = mutate(e, "dy:Published", "dy:Draft");
  return e;
}

function containerTurtle(members: readonly string[]): string {
  const contains =
    members.length === 0 ? "" : ` ;\n    ldp:contains ${members.map((m) => `<${m}>`).join(", ")}`;
  return `@prefix ldp: <${NS.ldp}> .\n@prefix dcterms: <${NS.dcterms}> .\n\n<>\n    a ldp:BasicContainer, ldp:Container ;\n    dcterms:modified "2026-09-04T10:00:00+00:00"${contains} .\n`;
}

async function indexTtl(rows: { slug: string; title: string }[]): Promise<string> {
  const indexUrl = tripIndexUrl(POD, TRIP_SLUG);
  const tripIri = `${POD}travel/trips/${TRIP_SLUG}/trip.ttl#it`;
  const indexRows = rows.map((r) => ({
    entryResource: `${ENTRIES_URL}${r.slug}.ttl#it`,
    title: { value: r.title, language: "en" },
    slug: r.slug,
  }));
  return serialiseIndex(indexUrl, tripIri, computeIndexFromRows(indexRows), "2026-01-01T00:00:00+00:00");
}

/* ══════════════════════════════════════════════════════════ the fake Pod ══ */

type Served = string | number;
type Recorded = { method: string; url: string; headers: Record<string, string>; body: string };

/** Records every request and answers GET from `spec.get`; every authenticated
 *  PUT unconditionally succeeds — this file is not testing preconditions. */
function fakePod(spec: { get: Record<string, Served> }) {
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
      const served = spec.get[request.url];
      return served !== undefined ? respond(served) : new HttpResponse("Not found", { status: 404 });
    }),
    http.put(`${POD}*`, async ({ request }) => {
      await record(request);
      if (request.headers.get("authorization") !== CREDENTIAL) {
        return new HttpResponse("Unauthorized", { status: 401 });
      }
      return new HttpResponse(null, { status: 205, headers: { etag: '"v2"' } });
    }),
    http.post(REVALIDATE_URL, async ({ request }) => {
      await record(request);
      const body = (await request.clone().json().catch(() => ({ tags: [] }))) as { tags?: string[] };
      return HttpResponse.json({ revalidated: new Set(body.tags ?? []).size, rejected: [] });
    }),
  );

  return { requests, puts: (url: string) => requests.filter((r) => r.method === "PUT" && r.url === url) };
}

/** One trip's entries container: each entry's own document, the container
 *  listing, and the entries.ttl index a full write may need to rewrite. */
async function podWith(entries: { slug: string; headline: string; status: Status }[]) {
  const get: Record<string, Served> = {
    [ENTRIES_URL]: containerTurtle(entries.map((e) => `${ENTRIES_URL}${e.slug}.ttl`)),
    [tripIndexUrl(POD, TRIP_SLUG)]: await indexTtl(
      entries.map((e) => ({ slug: e.slug, title: e.headline })),
    ),
  };
  for (const e of entries) get[`${ENTRIES_URL}${e.slug}.ttl`] = entryFixture(e.slug, e.headline, e.status);
  return fakePod({ get });
}

function fakeSession(): StudioSessionLike {
  const authedFetch: typeof globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", CREDENTIAL);
    return globalThis.fetch(input, { ...init, headers });
  };
  return {
    info: { isLoggedIn: true, webId: OWNER },
    fetch: authedFetch,
  } as unknown as StudioSessionLike;
}

/* ══════════════════════════════════════════════════════════════ the tests ══ */

describe("the test environment this file declares", () => {
  it("is jsdom", () => {
    expect(window.navigator.userAgent).toMatch(/jsdom/i);
  });
});

describe("EntriesList", () => {
  it("renders the trip's entries with status badges, edit links, and a New-entry affordance", async () => {
    await podWith([
      { slug: "arrival", headline: "Arrival day", status: "published" },
      { slug: "unfinished", headline: "Still drafting this one", status: "draft" },
    ]);
    const EntriesList = await loadEntriesList();

    render(
      <StrictMode>
        <EntriesList
          session={fakeSession()}
          podRoot={POD}
          tripSlug={TRIP_SLUG}
          tripStatus="published"
        />
      </StrictMode>,
    );

    await waitFor(() => expect(screen.getByText(/arrival day/i)).toBeInTheDocument());
    expect(screen.getByText(/still drafting this one/i)).toBeInTheDocument();
    expect(screen.getByText(/published/i)).toBeInTheDocument();
    expect(screen.getByText(/draft/i)).toBeInTheDocument();

    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain(`/studio/trips/${TRIP_SLUG}/arrival`);
    expect(links).toContain(`/studio/trips/${TRIP_SLUG}/unfinished`);
    expect(links).toContain(`/studio/trips/${TRIP_SLUG}/new-entry`);
  });

  it("renders a message, and does not throw, when the entries container cannot be listed", async () => {
    fakePod({ get: { [ENTRIES_URL]: 403 } });
    const EntriesList = await loadEntriesList();

    render(
      <EntriesList session={fakeSession()} podRoot={POD} tripSlug={TRIP_SLUG} tripStatus="draft" />,
    );

    await waitFor(() => expect(screen.getByText(/could not|error|went wrong/i)).toBeInTheDocument());
  });

  // Fix-round-1-shaped regression guard, one layer up from
  // `use-studio-entries.test.ts`'s own: a trip whose every entry is a draft
  // must render that entry, not the empty list a published-only read gives.
  it("lists a drafts-only trip's entries rather than an empty list", async () => {
    await podWith([{ slug: "unfinished", headline: "Nobody has read this yet", status: "draft" }]);
    const EntriesList = await loadEntriesList();

    render(
      <EntriesList session={fakeSession()} podRoot={POD} tripSlug={TRIP_SLUG} tripStatus="draft" />,
    );

    await waitFor(() =>
      expect(screen.getByText(/nobody has read this yet/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/no entries/i)).not.toBeInTheDocument();
  });

  /**
   * THE GUARD, surfaced in the UI (§5): a draft entry's publish control is
   * enabled once its trip is published, and reaches the Pod when clicked —
   * the mirror image of the disabled test right below it.
   */
  it("a published trip's entries CAN be published: the control is enabled and reaches the Pod", async () => {
    const pod = await podWith([{ slug: "e0", headline: "Draft entry", status: "draft" }]);
    const EntriesList = await loadEntriesList();

    render(
      <EntriesList
        session={fakeSession()}
        podRoot={POD}
        tripSlug={TRIP_SLUG}
        tripStatus="published"
      />,
    );

    await waitFor(() => expect(screen.getByText(/draft entry/i)).toBeInTheDocument());
    const button = await screen.findByRole("button", { name: /publish/i });
    expect(button).not.toBeDisabled();
    expect(screen.queryByText(/not published yet/i)).not.toBeInTheDocument();

    fireEvent.click(button);

    const entryUrl = `${ENTRIES_URL}e0.ttl`;
    await waitFor(() => expect(pod.puts(entryUrl).length).toBeGreaterThan(0));
    const put = pod.puts(entryUrl)[0];
    const expected = [
      ...triples(`<${entryUrl}#it> <${DY.status}> <${STATUS.Published}> .`, put.url),
    ][0];
    expect(triples(put.body, put.url).has(expected)).toBe(true);
  });

  it("a draft trip's entries CANNOT be published: the control is disabled, with a reason shown", async () => {
    await podWith([{ slug: "e0", headline: "Draft entry", status: "draft" }]);
    const EntriesList = await loadEntriesList();

    render(
      <EntriesList session={fakeSession()} podRoot={POD} tripSlug={TRIP_SLUG} tripStatus="draft" />,
    );

    await waitFor(() => expect(screen.getByText(/draft entry/i)).toBeInTheDocument());
    const button = await screen.findByRole("button", { name: /publish/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/not published yet/i)).toBeInTheDocument();
  });
});

/**
 * `app/(studio)/studio/trips/[slug]/[entry]/page.tsx` — Task 4.2, RED: the
 * route does not exist yet. Same instrument as `trips/[slug]/page.test.ts`.
 * `[entry]` is a bare segment, reconciled against `entries-list.tsx`'s own
 * edit link: `/studio/trips/${tripSlug}/${row.slug}`.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw";
import StudioClient from "@/components/studio/studio-client";

vi.mock("next/cache", () => ({
  cacheTag: () => {},
  cacheLife: () => {},
  revalidateTag: () => {},
}));

/* ----------------------------------------------------------------- fixtures */

const blocks = [
  ...readFileSync("docs/data-model.md", "utf8").matchAll(/```turtle\n([\s\S]*?)```/g),
].map((m) => m[1]);
const PROFILE_TTL = blocks[4];

const IDENTITY = "https://id.owner.test";
const WEBID = `${IDENTITY}/luca/card#me`;
const WEBID_DOC = `${IDENTITY}/luca/card`;
const ISSUER = "https://login.inrupt.com";

const POD_ROOT = "https://storage.owner.test/2f9c1a/";
const SITE_URL = "https://diary.example";
const SITE_NAME = "Luca's travel diary";

function serveProfile(body: string | number = PROFILE_TTL) {
  server.use(
    http.get(WEBID_DOC, () =>
      typeof body === "number"
        ? new HttpResponse(`status ${body}`, { status: body })
        : HttpResponse.text(body, { headers: { "content-type": "text/turtle" } }),
    ),
  );
}

function stubDeployment(overrides: Record<string, string> = {}) {
  const env: Record<string, string> = {
    POD_ROOT,
    OWNER_WEBID: WEBID,
    SITE_URL,
    SITE_NAME,
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Opaque to vite:import-analysis by construction: the route does not exist
 *  yet. */
async function renderPage(slug: string, entry: string) {
  const mod = (await import(
    /* @vite-ignore */ "@/app/(studio)/studio/trips/[slug]/[entry]/page"
  ).catch((cause: unknown) => {
    throw new Error(
      "app/(studio)/studio/trips/[slug]/[entry]/page.tsx does not exist yet — the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as {
    default: (props: {
      params: Promise<{ slug: string; entry: string }>;
    }) => Promise<{ type: unknown; props: Record<string, unknown> }>;
  };
  return mod.default({ params: Promise.resolve({ slug, entry }) });
}

describe("app/(studio)/studio/trips/[slug]/[entry]/page.tsx", () => {
  it("mounts the client shell naming both the trip and the entry from the route", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage("2026-japan", "2026-03-29-arrival");

    expect(element.type).toBe(StudioClient);
    // Exact: every value that crosses the server/client boundary, named — the
    // same discipline `app/(studio)/studio/page.test.ts` holds the five-prop
    // page to, so an entry route that also sets `newTrip` or `tripsHome`
    // fails here rather than shipping a route that renders two surfaces.
    expect(element.props).toStrictEqual({
      ownerWebId: WEBID,
      oidcIssuer: ISSUER,
      siteUrl: SITE_URL,
      siteName: SITE_NAME,
      podRoot: POD_ROOT,
      editEntry: { tripSlug: "2026-japan", entrySlug: "2026-03-29-arrival" },
    });
  });

  it("carries a DIFFERENT trip and entry through for a second route — not a hardcoded pair", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage("2027-peru", "day-one");

    expect(element.props.editEntry).toStrictEqual({ tripSlug: "2027-peru", entrySlug: "day-one" });
  });

  it("still renders the diagnostic, and no client shell, when the WebID cannot be read", async () => {
    stubDeployment();
    serveProfile(404);

    const element = await renderPage("2026-japan", "2026-03-29-arrival");

    expect(element.type).not.toBe(StudioClient);
    const text = JSON.stringify(element);
    expect(text).toContain("404");
  });
});

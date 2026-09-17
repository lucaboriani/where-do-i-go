/**
 * `app/(studio)/studio/trips/[slug]/new-entry/page.tsx` — Task 4.2, RED: the
 * route does not exist yet. Same instrument as `trips/[slug]/page.test.ts`.
 * The segment is `new-entry`, reconciled against `entries-list.tsx`'s own
 * "New entry" link at `/studio/trips/${tripSlug}/new-entry`.
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
async function renderPage(slug: string) {
  const mod = (await import(
    /* @vite-ignore */ "@/app/(studio)/studio/trips/[slug]/new-entry/page"
  ).catch((cause: unknown) => {
    throw new Error(
      "app/(studio)/studio/trips/[slug]/new-entry/page.tsx does not exist yet — the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as {
    default: (props: {
      params: Promise<{ slug: string }>;
    }) => Promise<{ type: unknown; props: Record<string, unknown> }>;
  };
  return mod.default({ params: Promise.resolve({ slug }) });
}

describe("app/(studio)/studio/trips/[slug]/new-entry/page.tsx", () => {
  it("mounts the client shell in CREATE mode, preset to the trip named by the route", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage("2026-japan");

    expect(element.type).toBe(StudioClient);
    // Exact, mirroring app/(studio)/studio/page.test.ts's own five-key
    // discipline: this route must not also carry `newTrip`, `editTripSlug` or
    // `editEntry` — any of those would mount a second, unrelated surface.
    expect(element.props).toStrictEqual({
      ownerWebId: WEBID,
      oidcIssuer: ISSUER,
      siteUrl: SITE_URL,
      siteName: SITE_NAME,
      podRoot: POD_ROOT,
      newEntryTripSlug: "2026-japan",
    });
  });

  it("carries a DIFFERENT trip slug through for a second trip — not a hardcoded one", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage("2027-peru");

    expect(element.props.newEntryTripSlug).toBe("2027-peru");
  });

  it("still renders the diagnostic, and no client shell, when the WebID cannot be read", async () => {
    stubDeployment();
    serveProfile(404);

    const element = await renderPage("2026-japan");

    expect(element.type).not.toBe(StudioClient);
    const text = JSON.stringify(element);
    expect(text).toContain("404");
  });
});

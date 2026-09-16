/**
 * `app/(studio)/studio/trips/[slug]/page.tsx` — Task 3.3, RED: the route does
 * not exist yet. Same instrument as the sibling `trips/new/page.test.ts` and
 * `app/(studio)/studio/page.test.ts`: call the async server component
 * directly and read the element it returns, rather than a source scan.
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
    /* @vite-ignore */ "@/app/(studio)/studio/trips/[slug]/page"
  ).catch((cause: unknown) => {
    throw new Error(
      "app/(studio)/studio/trips/[slug]/page.tsx does not exist yet — the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as {
    default: (props: {
      params: Promise<{ slug: string }>;
    }) => Promise<{ type: unknown; props: Record<string, unknown> }>;
  };
  return mod.default({ params: Promise.resolve({ slug }) });
}

describe("app/(studio)/studio/trips/[slug]/page.tsx", () => {
  it("mounts the client shell in EDIT mode, naming the slug from the route param", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage("japan-2026");

    expect(element.type).toBe(StudioClient);
    expect(element.props.editTripSlug).toBe("japan-2026");
    expect(element.props.newTrip, "an edit route is not the create route").toBeFalsy();
    expect(element.props.podRoot).toBe(POD_ROOT);
  });

  it("carries a DIFFERENT slug through for a second trip — not a hardcoded one", async () => {
    // Guards against a page that reads params but ignores them, or answers a
    // literal it happened to be written against.
    stubDeployment();
    serveProfile();

    const element = await renderPage("iceland-2025");

    expect(element.props.editTripSlug).toBe("iceland-2025");
  });

  it("still renders the diagnostic, and no client shell, when the WebID cannot be read", async () => {
    stubDeployment();
    serveProfile(404);

    const element = await renderPage("japan-2026");

    expect(element.type).not.toBe(StudioClient);
    const text = JSON.stringify(element);
    expect(text).toContain("404");
  });
});

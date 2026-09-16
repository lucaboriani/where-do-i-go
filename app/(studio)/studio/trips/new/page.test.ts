/**
 * `app/(studio)/studio/trips/new/page.tsx` — Task 3.3, RED: the route does not
 * exist yet. Mirrors `app/(studio)/studio/page.test.ts`'s own instrument (call
 * the async server component directly and read the element it returns) rather
 * than a source scan, for the same reason that file gives. Loaded through a
 * non-literal specifier — the route file does not exist, so a literal
 * `import("@/app/(studio)/studio/trips/new/page")` would fail module
 * resolution for the whole file rather than one test.
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
 *  yet, and this keeps the failure scoped to one test rather than the file. */
async function renderPage() {
  const mod = (await import(
    /* @vite-ignore */ "@/app/(studio)/studio/trips/new/page"
  ).catch((cause: unknown) => {
    throw new Error(
      "app/(studio)/studio/trips/new/page.tsx does not exist yet — the red step of the TDD loop, not a broken test.",
      { cause },
    );
  })) as { default: () => Promise<{ type: unknown; props: Record<string, unknown> }> };
  return mod.default();
}

describe("app/(studio)/studio/trips/new/page.tsx", () => {
  it("mounts the client shell in CREATE mode: newTrip true, no editTripSlug", async () => {
    stubDeployment();
    serveProfile();

    const element = await renderPage();

    // By identity, like the sibling /studio route: a page rendering the shell
    // directly would put the Solid session library on the server.
    expect(element.type).toBe(StudioClient);
    expect(element.props.newTrip).toBe(true);
    expect(element.props.editTripSlug, "a create route names no trip to edit").toBeUndefined();
    expect(element.props.podRoot).toBe(POD_ROOT);
    expect(element.props.ownerWebId).toBe(WEBID);
    expect(element.props.oidcIssuer).toBe(ISSUER);
  });

  it("still renders the diagnostic, and no client shell, when the WebID cannot be read", async () => {
    stubDeployment();
    serveProfile(404);

    const element = await renderPage();

    expect(element.type).not.toBe(StudioClient);
    const text = JSON.stringify(element);
    expect(text, "a zero-byte diagnostic shipped once from an unchecked status alone").toContain(
      "404",
    );
  });
});

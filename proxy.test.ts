import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { NextRequest } from "next/server";
import { DY, DY_CLASS, RDF, SCHEMA_VERSION, XSD } from "@/lib/vocab";
import { server } from "@/test/msw";

/**
 * The soft-404 middleware, and the just-published race it must not lose: a slug
 * published within TTL_MS is in a fresh diary read but not the stale module
 * cache, so the gate must re-read on a miss before 404-ing.
 * ./notes.md#the-module-scope-cache-is-best-effort-only
 */

const POD_ROOT = "https://pod.example/";
const DIARY_URL = new URL("travel/diary.ttl", POD_ROOT).toString();

const tripIri = (slug: string) => `${POD_ROOT}travel/trips/${slug}/trip.ttl#it`;
const diaryTtl = (slugs: string[]) => `
<#it>
    <${RDF.type}> <${DY_CLASS.Diary}> ;
    <${DY.schemaVersion}> "${SCHEMA_VERSION}"^^<${XSD.integer}> ;
    ${slugs.map((s) => `<${DY.trip}> <${tripIri(s)}>`).join(" ;\n    ")} .
`;

/** The diary the fake Pod serves, mutable so a test can "publish" between calls.
 *  A number stands for a bare status code (the unreadable-diary case). */
let diaryResponse: string | number;
let reads = 0;
let savedPodRoot: string | undefined;

beforeEach(() => {
  vi.resetModules();
  savedPodRoot = process.env.POD_ROOT;
  process.env.POD_ROOT = POD_ROOT;
  reads = 0;
  diaryResponse = diaryTtl(["kyoto"]);
  server.use(
    http.get(DIARY_URL, () => {
      reads += 1;
      return typeof diaryResponse === "number"
        ? new HttpResponse(null, { status: diaryResponse })
        : HttpResponse.text(diaryResponse, { headers: { "content-type": "text/turtle" } });
    }),
  );
});

afterEach(() => {
  if (savedPodRoot === undefined) delete process.env.POD_ROOT;
  else process.env.POD_ROOT = savedPodRoot;
});

async function runProxy(slug: string): Promise<Response> {
  const { proxy } = await import("@/proxy");
  return proxy(new NextRequest(new URL(`http://localhost:3000/trips/${slug}`)));
}

const served = (res: Response) =>
  res.headers.get("x-middleware-next") === "1" && res.headers.get("x-middleware-rewrite") === null;
const soft404 = (res: Response) =>
  res.status === 404 && res.headers.get("x-middleware-rewrite") !== null;

describe("proxy soft-404 middleware", () => {
  it("re-reads the diary on a cache miss, so a just-published trip is not 404'd", async () => {
    expect(served(await runProxy("kyoto"))).toBe(true); // fills the cache with {kyoto}
    expect(reads).toBe(1);

    diaryResponse = diaryTtl(["kyoto", "osaka"]); // osaka published after the fill

    const res = await runProxy("osaka");
    expect(served(res)).toBe(true); // the fix: a miss forces one fresh read
    expect(reads).toBe(2);
  });

  it("still 404s a slug absent from both the cache and a fresh read", async () => {
    expect(served(await runProxy("kyoto"))).toBe(true);
    expect(soft404(await runProxy("ghost"))).toBe(true);
  });

  it("serves a known slug from the cache without a second read", async () => {
    expect(served(await runProxy("kyoto"))).toBe(true);
    expect(served(await runProxy("kyoto"))).toBe(true);
    expect(reads).toBe(1);
  });

  it("fails open when the diary is unreadable, rather than 404-ing real content", async () => {
    diaryResponse = 500;
    expect(served(await runProxy("kyoto"))).toBe(true);
  });
});

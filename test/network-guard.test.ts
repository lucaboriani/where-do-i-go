import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "./msw";
import { takeStrayRequests } from "./network-guard";

/**
 * The test suite's own network guard, pinned.
 *
 * `test/setup.ts` claims that "an accidental real network call must fail the
 * test, not quietly succeed". It did not. It called MSW's `print.error()`,
 * which in msw 2.15 writes to stderr and nothing else — see
 * node_modules/msw/lib/core/experimental/on-unhandled-frame.js, whose own
 * comment says the `print` defaults "only print the corresponding messages
 * now. They do not affect the frame resolution". Vitest does not fail on
 * stderr, so the request went to the live internet and the test passed:
 *
 *     it("PROBE", async () => {
 *       const r = await fetch("https://example.com/");
 *       expect(r.status).toBe(200);   // passed. 559 bytes, from the internet.
 *     });
 *
 * The guard had been decorative since it was written, for exactly as long as
 * nothing tested it. This file is the test that was missing. It exercises the
 * guard through a real `fetch`, because the guard's whole job is what happens
 * to a real fetch — asserting on the predicate alone would have passed against
 * the broken version too.
 */

/**
 * Deliberately a host that really resolves. If the guard regresses, this test
 * fails with "the request reached the internet" rather than with a DNS error
 * that could be mistaken for the guard working.
 */
const STRAY = "https://example.com/";

/** What the request did, whether MSW blocked it by responding or by rejecting.
 *  Both count as blocked; the assertions are on the guard's message, which
 *  neither the internet nor a DNS failure can produce. */
type Attempt = { status: number; body: string };

async function attempt(url: string): Promise<Attempt> {
  try {
    const res = await fetch(url);
    return { status: res.status, body: await res.text() };
  } catch (cause) {
    const parts = [cause instanceof Error ? cause.message : String(cause)];
    if (cause instanceof Error && cause.cause instanceof Error) parts.push(cause.cause.message);
    return { status: 0, body: parts.join("\n") };
  }
}

/** Every blocked request must produce this, and nothing else can. */
function expectBlocked(outcome: Attempt, url: string) {
  expect(outcome.status).not.toBe(200);
  expect(outcome.body).toContain(url);
  expect(outcome.body).toContain("Blocked a real network request");
  expect(outcome.body).toContain("add an MSW handler");
}

describe("an unhandled request fails the test instead of reaching the network", () => {
  it("blocks it, and says which URL and what to do about it", async () => {
    const outcome = await attempt(STRAY);
    expectBlocked(outcome, STRAY);

    // Draining is also the assertion: it proves the guard recorded the stray
    // for the afterEach sweep, and it is how this test — the one file that
    // trips the guard on purpose — avoids being failed by that sweep.
    expect(takeStrayRequests()).toEqual([`GET ${STRAY}`]);
  });

  it("matches loopback whole, so a host that merely looks local is still blocked", async () => {
    // A substring or suffix match on "localhost" would let all four out, and
    // two of them are registrable on the public internet.
    const urls = [
      "https://localhost.example.com/x",
      "https://notlocalhost.example.com/x",
      "https://sub.localhost/x",
      "https://127.0.0.1.example.com/x",
    ];
    for (const url of urls) expectBlocked(await attempt(url), url);
    expect(takeStrayRequests()).toEqual(urls.map((u) => `GET ${u}`));
  });
});

describe("the allow-cases — a guard that blocks everything is useless", () => {
  let ipv4: Server;
  let ipv6: Server | undefined;
  const BODY = "pong from the loopback allow-case";

  const listen = (host: string) =>
    new Promise<Server>((resolve, reject) => {
      const s = createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(BODY);
      });
      s.once("error", reject);
      s.listen(0, host, () => resolve(s));
    });

  const port = (s: Server) => (s.address() as AddressInfo).port;

  beforeAll(async () => {
    ipv4 = await listen("127.0.0.1");
    // Not every host has an IPv6 loopback. Report that as a skip, never as a pass.
    ipv6 = await listen("::1").catch(() => undefined);
  });

  afterAll(async () => {
    await Promise.all(
      [ipv4, ipv6].map(
        (s) => new Promise<void>((r) => (s ? s.close(() => r()) : r())),
      ),
    );
  });

  it("lets 127.0.0.1 through to a real server on this machine", async () => {
    const res = await fetch(`http://127.0.0.1:${port(ipv4)}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
  });

  it("lets localhost through — the exemption the Pod integration tests rely on", async () => {
    const res = await fetch(`http://localhost:${port(ipv4)}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
  });

  it("lets [::1] through", async (ctx) => {
    if (!ipv6) ctx.skip("no IPv6 loopback on this host");
    const res = await fetch(`http://[::1]:${port(ipv6!)}/ping`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(BODY);
  });

  it("leaves a handled request completely alone", async () => {
    server.use(
      http.get("https://pod.test/thing.ttl", () =>
        HttpResponse.text("handled", { headers: { "content-type": "text/turtle" } }),
      ),
    );
    const res = await fetch("https://pod.test/thing.ttl");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("handled");
  });
});

describe("the sweep — a test cannot swallow the blocked response and pass", () => {
  /**
   * The throw only makes the REQUEST fail, and msw 2.15 renders that as a 500
   * rather than a rejected fetch. lib/pod/read.ts turns any non-2xx into a
   * structured error and never throws, so a caller shaped like that receives
   * the 500, asserts something true about it, and goes green. That is the
   * failure mode this repository keeps hitting, so it gets its own pin.
   *
   * Run in a child process because the assertion is "that test FAILS", which
   * cannot be expressed from inside the run it is asserting about.
   */
  it("fails a test that receives the blocked response and handles it politely", () => {
    const config = fileURLToPath(new URL("./fixtures/vitest.config.ts", import.meta.url));
    const run = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url)), "run", "--config", config],
      { encoding: "utf8", cwd: fileURLToPath(new URL("..", import.meta.url)) },
    );
    const output = `${run.stdout}\n${run.stderr}`;

    // Status and body, not status alone: a child run can exit non-zero because
    // it failed to start at all, which would prove nothing about the sweep.
    expect(run.status, output).not.toBe(0);
    expect(output).toContain("swallows the blocked response");
    expect(output).toContain("Blocked a real network request");
    expect(output).toContain("https://swallowed.example/thing.ttl");
    // The fixture's own expect() passes; the failure must come from the hook.
    expect(output).toContain("test/setup.ts");
    expect(output).toMatch(/Tests\s+1 failed/);
  }, 120_000);
});

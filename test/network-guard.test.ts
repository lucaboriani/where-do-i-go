import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ONE_FAILED_TEST, stripAnsi } from "./child-output";
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

/**
 * The summary line as a styled child really writes it, captured verbatim on
 * 2026-09-06 from
 *
 *     env -i HOME="$HOME" CI=true node node_modules/vitest/vitest.mjs run \
 *       --config test/fixtures/vitest.config.ts
 *
 * and the same line as an unstyled child writes it. One copy, used by both the
 * live child run below and the table at the bottom of the file — and the live
 * run asserts the styled spelling is still what vitest produces, so the table
 * cannot rot into a fixture that only agrees with itself.
 */
const STYLED_SUMMARY =
  "\u001B[2m      Tests \u001B[22m \u001B[1m\u001B[31m1 failed\u001B[39m\u001B[22m\u001B[90m (1)\u001B[39m";
const UNSTYLED_SUMMARY = "      Tests  1 failed (1)";

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
  const CONFIG = fileURLToPath(new URL("./fixtures/vitest.config.ts", import.meta.url));
  const VITEST = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
  const REPO = fileURLToPath(new URL("..", import.meta.url));

  type ChildRun = {
    status: number;
    /** Exactly what the child wrote, escape sequences and all. */
    raw: string;
    /** The same thing with the styling removed. Assert against this. */
    text: string;
  };

  /**
   * The environment is passed explicitly rather than inherited, and that is
   * half the fix — see test/child-output.ts. The spawn used to pass no `env` at
   * all, so the child inherited the agent variables that make vitest turn its
   * own colours off, which is the whole reason this file was green here and red
   * on CI.
   */
  function runFixtureChild(env: NodeJS.ProcessEnv): ChildRun {
    const run = spawnSync(process.execPath, [VITEST, "run", "--config", CONFIG], {
      encoding: "utf8",
      cwd: REPO,
      env,
    });
    if (run.error) throw run.error;
    const raw = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
    return { status: run.status ?? -1, raw, text: stripAnsi(raw) };
  }

  /** Any CSI introducer. Enough to tell a styled run from an unstyled one. */
  const HAS_ANSI = /\u001B\[/;

  /**
   * Everything the ambient environment has, plus the switch that silences
   * tinyrainbow outright — `!("NO_COLOR" in env)` gates every colour path in
   * node_modules/tinyrainbow/dist/index.js. Belt to the strip's braces, and the
   * two do different jobs: the strip is what makes the assertions correct, this
   * is what keeps the FAILURE MESSAGE readable when one of them goes red.
   */
  const UNSTYLED_ENV: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1" };

  /**
   * CI's environment, near enough: no NO_COLOR, and — the part that actually
   * matters — none of the `AI_AGENT` / `CLAUDECODE` variables that make vitest
   * call `disableDefaultColors()`. Built up rather than filtered down, because
   * a subtraction would have to know all twelve of std-env's agent probes and
   * would quietly stop reproducing anything on the thirteenth.
   */
  const STYLED_ENV: NodeJS.ProcessEnv = {
    HOME: process.env.HOME,
    PATH: process.env.PATH,
    // Next augments NodeJS.ProcessEnv to make this one required, and vitest
    // sets it to "test" in the child regardless. Node drops undefined entries
    // rather than passing the string "undefined", so this is a no-op at runtime.
    NODE_ENV: process.env.NODE_ENV,
    CI: "true",
    FORCE_COLOR: "1",
  };

  /**
   * Everything the run has to show, asserted against the UNSTYLED text so that
   * none of it depends on where the child happened to put a style run. Four of
   * these five survived colour by luck — each substring sat inside one style
   * run — which is the same brittleness as the summary, one reformat away.
   */
  function expectTheSweepFailedIt(run: ChildRun) {
    // Status and body, not status alone: a child run can exit non-zero because
    // it failed to start at all, which would prove nothing about the sweep.
    expect(run.status, run.text).not.toBe(0);
    expect(run.text).toContain("swallows the blocked response");
    expect(run.text).toContain("https://swallowed.example/thing.ttl");
    // The SWEEP's message, not merely the guard's. `straySweepMessage` is the
    // only thing in the repository that says "— N of them"; the per-request
    // throw that the fixture swallows says "...from the test suite: GET <url>".
    expect(run.text).toContain("Blocked a real network request from the test suite — 1 of them");
    // The fixture's own expect() passes, so the failure has to come from the
    // hook. With a line:column, because the guard's advice text ends "Raised by
    // test/setup.ts, not by MSW" — a bare toContain("test/setup.ts") is
    // satisfied by that prose and proves no attribution at all.
    expect(run.text).toMatch(/test\/setup\.ts:\d+:\d+/);
    expect(run.text).toMatch(ONE_FAILED_TEST);
  }

  it("fails a test that receives the blocked response and handles it politely", () => {
    const run = runFixtureChild(UNSTYLED_ENV);
    // Not decoration: if NO_COLOR stops silencing vitest, this run becomes a
    // second copy of the styled one and the pair stops being a pair.
    expect(run.raw, "NO_COLOR no longer suppresses vitest's styling").not.toMatch(HAS_ANSI);
    expectTheSweepFailedIt(run);
  }, 120_000);

  it("fails it just the same when the child styles its output, as it does on CI", () => {
    const run = runFixtureChild(STYLED_ENV);
    // Without this the case is vacuous: an unstyled run satisfies every
    // assertion below while reproducing nothing.
    expect(
      run.raw.slice(0, 200),
      "the child emitted no escape sequences, so this case exercised nothing",
    ).toMatch(HAS_ANSI);
    // And the fixture the table below is built from is still what vitest writes.
    expect(
      run.raw,
      "vitest no longer spells the summary the way STYLED_SUMMARY does — recapture it",
    ).toContain(STYLED_SUMMARY);
    expectTheSweepFailedIt(run);
  }, 120_000);
});

describe("the summary check reads the child's output whatever colours it chose", () => {
  /**
   * The regression, in isolation and without a 300 ms child process.
   *
   * `/Tests\s+1 failed/` against raw output was green on every machine with an
   * agent variable in its environment and red on the first CI run, because
   * between `Tests` and `1 failed` there are two spaces AND four escape
   * sequences: `\s+` matches the spaces, meets the ESC, and stops. STYLED_SUMMARY
   * is the line a real child wrote, and the sweep above re-checks it against a
   * live run, so this cannot drift into a fixture of a fixture.
   */
  it("strips the styling, and changes nothing else about the line", () => {
    // The fixture really is styled — otherwise the table below tests the plain
    // case twice under two names.
    expect(STYLED_SUMMARY).not.toBe(UNSTYLED_SUMMARY);
    expect(STYLED_SUMMARY).toMatch(/\u001B\[/);
    // Exact equality, not toContain: a strip that also ate the two spaces after
    // `Tests`, or the `(1)`, would satisfy a containment check while breaking
    // every count this file asserts.
    expect(stripAnsi(STYLED_SUMMARY)).toBe(UNSTYLED_SUMMARY);
  });

  /**
   * Both directions. A check that accepts everything is exactly as useless as
   * one that accepts nothing, and the negative rows are what tell them apart —
   * each says "1 failed" in a form this child never writes for a fixture config
   * that runs one file containing one test.
   *
   * The mutated rows are built by replacing inside the styled fixture rather
   * than retyped, so a stale anchor cannot quietly leave the original in place:
   * that would hand a MATCHING string to a row expecting `false`, and the row
   * goes red rather than silently green.
   */
  const twoFailed = STYLED_SUMMARY.replace("1 failed", "2 failed").replace("(1)", "(2)");
  const onePassed = STYLED_SUMMARY.replace("1 failed", "1 passed");

  it.each([
    ["an unstyled summary", UNSTYLED_SUMMARY, true],
    ["a styled summary — the CI case, and the reason this file changed", STYLED_SUMMARY, true],
    ["a styled run where two tests failed", twoFailed, false],
    ["a styled run where the one test passed", onePassed, false],
    [
      "one failure among a suite this child was never meant to collect",
      "      Tests  1 failed | 7 passed (8)",
      false,
    ],
    ["the Test Files line on its own", " Test Files  1 failed (1)", false],
    ["a child that never started, so wrote nothing at all", "", false],
  ])("%s", (_name, output, expected) => {
    expect(ONE_FAILED_TEST.test(stripAnsi(output))).toBe(expected);
  });

  it("the two mutated fixtures really were mutated", () => {
    // Said directly rather than left to inference. `replace` with a stale
    // anchor returns the subject unchanged, and this repository has shipped a
    // negative test that silently asserted about an unmodified fixture.
    expect(twoFailed).not.toBe(STYLED_SUMMARY);
    expect(onePassed).not.toBe(STYLED_SUMMARY);
    expect(stripAnsi(twoFailed)).toBe("      Tests  2 failed (2)");
    expect(stripAnsi(onePassed)).toBe("      Tests  1 passed (1)");
  });
});

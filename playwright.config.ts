import { defineConfig } from "@playwright/test";
import { E2E, appEnv } from "./e2e/environment";

/**
 * Playwright, for two flows: the Solid login redirect, and the media pipeline.
 *
 * CLAUDE.md, Testing: "Playwright only for what cannot be meaningfully tested
 * faster — never a slow duplicate of a fast test." That is the whole remit, and
 * it is a bar each flow has to clear rather than a licence to add a third. The
 * studio's states — restoring, signed-out, owner, not-owner, the expiry
 * subscription — are covered by the component tests in components/studio/studio-shell/studio-shell.test.tsx,
 * which run in about a second. Re-driving them in a browser would be a slow
 * duplicate of a fast test, which is worse than no test: it costs minutes per
 * run and finds nothing the fast one does not.
 *
 * THE FILE IS NAMED AND NO TOTAL IS GIVEN, DELIBERATELY. This line said "23
 * component tests" until 2026-09-06, by which point `vitest list` reported 26.
 * Commit 3c751c6 went through CLAUDE.md deleting every instance of that same
 * number, replacing counts with file names and adding "do not reintroduce a
 * total" — and this file, one directory over, kept it anyway. A count in prose
 * is wrong the next time a test is added and nothing checks it. Let `vitest
 * list` do the counting.
 *
 * The login redirect clears the bar because a real OIDC round trip cannot be
 * unit-tested at all. e2e/media-pipeline.spec.ts clears it for a different
 * reason, and one that was measured rather than assumed (2026-09-06): jsdom has
 * no createImageBitmap, no OffscreenCanvas and no encoder, and a jsdom Blob
 * reaches MSW as the NINE BYTES of the string "undefined". So the fast tests
 * can pin file names, content types, IRIs and call order — and cannot see one
 * pixel or one EXIF tag of what is actually uploaded. This file is the only
 * place the real bytes are read back, and the defect that justifies it is the
 * pass-through shortcut in lib/media/pipeline.worker.ts, which would put the
 * owner's unstripped GPS into a publicly readable container.
 *
 * WHY THIS FILE HAD TO EXIST AT ALL. Without a config, Playwright falls back to
 * scanning the repository, finds test/*.test.ts, tries to load the Vitest
 * suites as Playwright specs and dies inside @vitest/runner:
 * "TypeError: Cannot read properties of undefined (reading 'config')" at
 * test/access.test.ts:103, before reporting on anything. `testDir` below is
 * what stops that: Playwright only ever looks in e2e/, and vitest collects
 * only `*.test.ts(x)`, so neither runner can collect the other's files. The
 * separation is the EXTENSION, not the directory — vitest's include grew to
 * four globs on 2026-09-08 (test, lib, components, app) when tests moved
 * beside their subjects, and would grow again; `.spec.ts` matches none of them
 * at any depth, and test/vitest-collection.test.ts pins that no .spec.ts is
 * ever collected. Do not restate vitest's include here: this comment named two
 * globs and was stale the day a third was added.
 */
export default defineConfig({
  testDir: "./e2e",

  /**
   * One worker, no parallelism, no retries.
   *
   * The spec drives a real OIDC round trip against one Community Solid Server
   * account. Two workers would race over the same session cookie and the same
   * "remember this client" state on the server, and a retry would quietly turn
   * "the login flow is flaky against a real provider" — the single most
   * valuable thing this spec can tell us — into a green tick on the second go.
   */
  workers: 1,
  fullyParallel: false,
  retries: 0,

  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",

  /**
   * Generous, because the first request to `next dev` compiles the route — but
   * not so generous that a broken flow takes two minutes to say so. The happy
   * path runs in about ten seconds end to end; every wait inside the spec is a
   * web-first assertion bounded by `expect.timeout`, so a failure surfaces at
   * twenty seconds with the URL the browser is stuck on rather than at the test
   * timeout with "waiting for navigation".
   */
  timeout: 60_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: E2E.siteUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  /**
   * Chromium only, and the bundled build rather than `devices["Desktop Chrome"]`.
   * TODO.md phase 0.5 installs Chromium alone; the descriptor adds a spoofed
   * Windows user agent this flow has no use for. Install it with
   * `npx playwright install chromium` — and check the revision matches, because
   * a cache left over from an older Playwright does not count.
   */
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],

  webServer: {
    /**
     * `next dev`, not `next build && next start`, and the reason is the thing
     * this spec is for.
     *
     * React only double-invokes effects under StrictMode in a DEVELOPMENT
     * build. docs/phase-0-spike.md question 2 found that the two invocations
     * disagree — the first `handleIncomingRedirect` returns `isLoggedIn: false`
     * and the second returns `true` — which is the entire reason
     * `restoreSession` installs its memo synchronously. A production build
     * invokes the effect once, so `next start` would run the round trip without
     * ever exercising the bug the memo exists for, and would report green if
     * the memo were deleted. Strict Mode is on by default with the App Router
     * (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md),
     * so nothing needs configuring for this.
     *
     * Secondary, but real: with Cache Components on, the production build reads
     * the Pod during prerender, so `build && start` would need the Pod seeded
     * before the build as well as before the tests, and would bake a `/studio`
     * prerendered from build-time Pod state. And it costs minutes in front of
     * one spec.
     *
     * What this gives up is that dev is not what ships. That gap is covered:
     * `npm run build` is in CLAUDE.md's definition of done and reads the same
     * Pod, so a production-only failure is caught there rather than here.
     */
    command: `npx next dev --port ${E2E.port}`,

    /**
     * `/client-id.jsonld` and NOT `/`, deliberately. See the ordering note at
     * the top of e2e/global-setup.ts: this probe runs BEFORE globalSetup, so it
     * must not be a route that reads the Pod — `/` would render the diary
     * against a possibly-unseeded Pod and cache the failure. This route reads
     * only SITE_URL and SITE_NAME, and answers 500 if SITE_URL is unset, which
     * Playwright treats as not-available rather than ready.
     */
    url: `${E2E.siteUrl}/client-id.jsonld`,

    /**
     * NEVER reuse. A dev server someone already has open is running with their
     * `.env.local` — POD_ROOT pointed at whatever pod they were last working
     * on — and reusing it would run the whole spec against the wrong Pod while
     * reporting green. Playwright throws "…is already used" instead, which is
     * the right answer: stop the other server, or set E2E_PORT.
     */
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",

    /**
     * Passed as real process variables, which is also how they beat
     * `.env.local`: @next/env snapshots process.env before reading any .env
     * file and never overwrites a key already present in that snapshot
     * (node_modules/@next/env/dist/index.js, `processEnv`). And because nothing
     * here goes through a dotenv parser, the `#` in OWNER_WEBID cannot be
     * eaten as a comment — see the note in e2e/environment.ts.
     */
    env: appEnv,
  },
});

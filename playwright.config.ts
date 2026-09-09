import { defineConfig } from "@playwright/test";
import { E2E, appEnv } from "./e2e/environment";

/** Playwright, for two flows only: the Solid login redirect and the media
 *  pipeline's real bytes. Each cleared CLAUDE.md's "never a slow duplicate of a
 *  fast test" bar on its own, and no test count is restated here —
 *  ./notes.md#why-playwright-exists-here-and-for-exactly-two-flows */
export default defineConfig({
  /** DO NOT RESTATE VITEST'S INCLUDE HERE — this comment named two globs and
   *  was stale the day a third was added. The separation is the EXTENSION, not
   *  the directory: ./notes.md#why-testdir-keeps-the-two-runners-apart */
  testDir: "./e2e",

  /** One Community Solid Server account and a real OIDC round trip: two workers
   *  would race over the same session cookie, and a retry would turn "flaky
   *  against a real provider" into a green tick on the second go.
   *  ./notes.md#one-worker-no-parallelism-no-retries */
  workers: 1,
  fullyParallel: false,
  retries: 0,

  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",

  /** Generous enough for `next dev` to compile the route, tight enough that a
   *  failure surfaces in twenty seconds with the URL the browser is stuck on:
   *  ./notes.md#the-two-timeouts-and-which-one-reports-a-failure-first */
  timeout: 60_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: E2E.siteUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },

  /** Chromium only, and the bundled build rather than devices["Desktop Chrome"].
   *  Install it with `npx playwright install chromium`, and check the revision:
   *  ./notes.md#chromium-only-and-the-bundled-build-rather-than-the-device-descriptor */
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],

  webServer: {
    /** `next dev`, and the reason IS the thing this spec is for: StrictMode
     *  double-invokes effects only in a development build, so `next start`
     *  would pass with the memo that double invocation justifies deleted.
     *  ./notes.md#why-the-web-server-is-next-dev-not-a-production-build */
    command: `npx next dev --port ${E2E.port}`,

    /** NOT `/`, WHICH READS THE POD: this probe runs BEFORE globalSetup, so `/`
     *  would render the diary against a possibly-unseeded Pod and cache the
     *  failure. ./notes.md#why-the-readiness-probe-is-a-route-that-does-not-read-the-pod */
    url: `${E2E.siteUrl}/client-id.jsonld`,

    /** NEVER REUSE: a dev server someone already has open carries their own
     *  `.env.local`, so the whole spec would run against the wrong Pod and
     *  report green. ./notes.md#never-reuse-an-existing-dev-server */
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",

    /** Real process variables, which is also how they beat `.env.local`, and how
     *  the `#` in OWNER_WEBID survives having no dotenv parser in the way:
     *  ./notes.md#why-the-env-is-passed-as-real-process-variables */
    env: appEnv,
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Mirrors the "@/*" path alias in tsconfig.json. Done by hand rather than
 *  adding vite-tsconfig-paths — decisions.md §23: no new tooling without a
 *  reason worth recording. */
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
    /**
     * The default, and it stays the default: most of this suite needs no DOM
     * and jsdom is not free. Component tests opt in per FILE with a
     * `// @vitest-environment jsdom` docblock.
     *
     * NO COUNT HERE ON PURPOSE. This line read "282 tests" until 2026-09-08,
     * by which point the suite was 1024 — the count-in-prose rot that
     * CLAUDE.md and playwright.config.ts both warn about.
     */
    environment: "node",
    setupFiles: ["test/setup.ts"],
    /**
     * `.tsx` IS LOAD-BEARING — see test/support/notes.md#why-a-walker.
     * `components/**` and `app/**` are here AHEAD of the moves that need them,
     * so a colocated test cannot land uncollected; test/vitest-collection.test.ts
     * fails if any of the four stops matching a file that exists.
     *
     * `.spec.ts` stays deliberately excluded, and BOTH halves matter:
     * test/fixtures/swallowed-stray.spec.ts is a fixture that MUST fail and is
     * spawned as a child through test/fixtures/vitest.config.ts by
     * test/network-guard.test.ts — collecting it HERE would make this suite
     * permanently red. And e2e/*.spec.ts belongs to Playwright.
     */
    include: [
      "test/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
    ],
  },
});

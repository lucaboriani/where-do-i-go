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
     * The default, and it stays the default: 282 tests here need no DOM and
     * jsdom is not free. Component tests opt in per FILE with a
     * `// @vitest-environment jsdom` docblock — see test/studio-shell.test.tsx.
     */
    environment: "node",
    setupFiles: ["test/setup.ts"],
    /**
     * `.tsx` IS LOAD-BEARING. This read `*.test.ts` only, and the repository's
     * first component test was therefore collected by nothing: the suite
     * reported "280 passed" identically with and without 31 kB of new test file
     * on disk. An uncollected file does not report red, it does not report at
     * all — the project's "green run that verified nothing" failure mode in its
     * purest form. test/vitest-collection.test.ts now fails if this regresses.
     *
     * `.spec.ts` is still deliberately excluded: test/fixtures/swallowed-stray.spec.ts
     * is a fixture that MUST fail, and test/network-guard.test.ts spawns it
     * through test/fixtures/vitest.config.ts. Collecting it here would make the
     * main suite permanently red. Also pinned by test/vitest-collection.test.ts.
     */
    include: ["test/**/*.test.{ts,tsx}", "lib/**/*.test.{ts,tsx}"],
  },
});

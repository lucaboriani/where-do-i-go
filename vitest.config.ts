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
     * `.tsx` IS LOAD-BEARING — see test/support/notes.md#why-a-walker.
     * `components/**` and `app/**` joined the list when tests moved beside
     * their subjects; test/vitest-collection.test.ts fails if any of the four
     * stops matching a file that exists.
     *
     * `.spec.ts` stays deliberately excluded: test/fixtures/swallowed-stray.spec.ts
     * is a fixture that MUST fail, and e2e/*.spec.ts belongs to Playwright.
     */
    include: [
      "test/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
    ],
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Mirrors the "@/*" path alias in tsconfig.json. Done by hand rather than
 *  adding vite-tsconfig-paths — decisions.md §23: no new tooling without a
 *  reason worth recording. */
const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": root } },
  test: {
        /** node by default: most of this suite needs no DOM. Component tests opt in
     *  per FILE. No test count here on purpose:
     *  ./notes.md#why-the-vitest-environment-is-node */
    environment: "node",
    setupFiles: ["test/setup.ts"],
        /** `.tsx` IS LOAD-BEARING - test/support/notes.md#why-a-walker. Five globs,
     *  and `.spec.ts` excluded for two separate reasons:
     *  ./notes.md#why-the-include-list-has-five-globs-and-excludes-spects */
    include: [
      "test/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
      "hooks/**/*.test.{ts,tsx}",
    ],
  },
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The child run used by test/network-guard.test.ts to prove that the stray-request
 * sweep in test/setup.ts fails a test that swallows the blocked response.
 *
 * It has to be a separate config rather than a filename argument: vitest has no
 * `--include` flag, and the fixture is deliberately `.spec.ts` so the real
 * config's `test/**\/*.test.ts` never collects it. Everything else mirrors
 * ../../vitest.config.ts — crucially the same `setupFiles`, so this exercises
 * the real guard and not a copy of it.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root,
  resolve: { alias: { "@": root } },
  test: {
    environment: "node",
    setupFiles: ["test/setup.ts"],
    include: ["test/fixtures/swallowed-stray.spec.ts"],
  },
});

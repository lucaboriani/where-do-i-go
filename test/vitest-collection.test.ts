import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every test file on disk is actually collected.
 *
 * WHY THIS EXISTS. `vitest.config.ts` used to include only `**\/*.test.ts`, so
 * the repository's first `.tsx` test — test/studio-shell.test.tsx, 31 kB of it —
 * was silently never run. The suite reported "280 passed" both with and without
 * it, byte for byte. That is this project's named failure mode in its purest
 * form: not a test that passes while verifying nothing, but a test file that
 * does not report at all.
 *
 * An uncollected file cannot fail, so nothing inside it can protect it. The
 * check has to live in a file the config already collects, which is why this is
 * `.ts` and not `.tsx`.
 *
 * HOW. `vitest list --filesOnly` asks the real config which files it would run —
 * a child process rather than a re-implementation of the include globs, because
 * a hand-rolled matcher would be a second opinion about picomatch semantics
 * rather than the answer vitest gives. It resolves in about a third of a second
 * and does not import the files.
 */

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const vitestBin = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

/** The files the REAL config would run, as vitest itself reports them. */
function collectedFiles(): string[] {
  const run = spawnSync(process.execPath, [vitestBin, "list", "--filesOnly"], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  const output = `${run.stdout}\n${run.stderr}`;
  // Status AND body. A child that failed to start exits non-zero with an empty
  // stdout, and an empty list would make "no file is missing" vacuously true.
  expect(run.status, output).toBe(0);
  const files = run.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  expect(files.length, output).toBeGreaterThan(10);
  return files;
}

/** Every *.test.ts / *.test.tsx sitting in test/, top level only. */
function testFilesOnDisk(): string[] {
  return readdirSync(new URL("../test", import.meta.url))
    .filter((name) => /\.test\.tsx?$/.test(name))
    .map((name) => `test/${name}`)
    .sort();
}

describe("vitest collects every test file that exists", () => {
  const collected = collectedFiles();
  const onDisk = testFilesOnDisk();

  it("the scan sees both extensions, so the comparison below is not one-sided", () => {
    // Control. If readdir found no .tsx at all — the file renamed, moved, or
    // deleted — "every file on disk is collected" would pass while the .tsx
    // include had been quietly reverted.
    expect(onDisk.filter((f) => f.endsWith(".test.ts")).length).toBeGreaterThan(10);
    expect(onDisk.filter((f) => f.endsWith(".test.tsx")).length).toBeGreaterThan(0);
    expect(onDisk).toContain("test/studio-shell.test.tsx");
  });

  it("runs every .test.ts and .test.tsx under test/", () => {
    const missing = onDisk.filter((file) => !collected.includes(file));
    expect(
      missing,
      `these test files exist but vitest.config.ts would not run them — an uncollected file reports nothing at all, it does not report red:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * The other direction, and it is not symmetry for its own sake:
   * test/fixtures/swallowed-stray.spec.ts is DELIBERATELY not collected by this
   * config. It is a fixture that must fail, spawned by test/network-guard.test.ts
   * through test/fixtures/vitest.config.ts. Widening the include to catch it
   * would make the main suite permanently red.
   */
  it("still leaves the deliberately-excluded fixture spec alone", () => {
    expect(collected).not.toContain("test/fixtures/swallowed-stray.spec.ts");
    expect(collected.filter((f) => f.endsWith(".spec.ts"))).toEqual([]);
    // And it really is there to be excluded, rather than merely absent.
    expect(readdirSync(new URL("../test/fixtures", import.meta.url))).toContain(
      "swallowed-stray.spec.ts",
    );
  });
});

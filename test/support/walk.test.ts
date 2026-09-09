import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { walkTestFiles } from "./walk";

/** A tree with a test file NESTED, which is the whole point: the guard this
 *  feeds used to scan one directory deep. See ./notes.md#why-a-walker */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "walk-"));
  mkdirSync(join(root, "lib", "deep", "deeper"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "top.test.ts"), "");
  writeFileSync(join(root, "lib", "mid.test.ts"), "");
  writeFileSync(join(root, "lib", "deep", "deeper", "low.test.tsx"), "");
  writeFileSync(join(root, "lib", "deep", "not-a-test.ts"), "");
  writeFileSync(join(root, "node_modules", "pkg", "vendor.test.ts"), "");
  return root;
}

describe("walkTestFiles", () => {
  it("finds test files at every depth, not just the top", () => {
    expect(walkTestFiles(tree())).toEqual([
      "lib/deep/deeper/low.test.tsx",
      "lib/mid.test.ts",
      "top.test.ts",
    ]);
  });

  it("collects both extensions, so a .tsx-only regression cannot hide", () => {
    const found = walkTestFiles(tree());
    expect(found.some((f) => f.endsWith(".test.ts"))).toBe(true);
    expect(found.some((f) => f.endsWith(".test.tsx"))).toBe(true);
  });

  it("skips node_modules, or the guard grades vendor code", () => {
    expect(walkTestFiles(tree()).join("\n")).not.toContain("node_modules");
  });

  it("returns [] for a directory that does not exist, rather than throwing", () => {
    expect(walkTestFiles(join(tmpdir(), "walk-absent-" + Date.now()))).toEqual([]);
  });
});

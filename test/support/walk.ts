import { existsSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";

/** Directories no guard should grade. */
const SKIP = new Set(["node_modules", ".next", ".git", ".pod-data", "test-results", "coverage"]);

/**
 * Every test file under `rootDir`, at any depth, relative and POSIX-separated.
 * See ./notes.md#why-a-walker for why depth is the point.
 */
export function walkTestFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  const found: string[] = [];
  const visit = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        visit(join(dir, entry.name), prefix === "" ? entry.name : `${prefix}/${entry.name}`);
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        found.push(prefix === "" ? entry.name : `${prefix}/${entry.name}`);
      }
    }
  };
  visit(rootDir, "");
  return found.map((f) => f.split(sep).join(posix.sep)).sort();
}

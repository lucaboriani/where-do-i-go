import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";

/** Directories no walk should enter. */
const SKIP = new Set(["node_modules", ".next", ".git", ".pod-data", "test-results", "coverage"]);
const CODE_FILE = /\.(ts|tsx)$/;

/**
 * Every static import/export specifier a file names — `from "…"` and the bare
 * `import "…"` form. Dynamic `import()` is deliberately NOT walked: the map
 * guardrail already proves that shape stays invisible to a prerendered page,
 * and following it here would defeat the laziness the fence is for.
 */
function specifiersIn(source: string): string[] {
  const re = /\b(?:import|export)\b[^'";]*?from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g;
  return [...source.matchAll(re)].map((m) => m[1] ?? m[2]);
}

/** `@/x` resolves repo-root-relative; `./x`/`../x` resolves against the
 *  importer's own directory; anything else is an npm package and not walked. */
function resolveSpecifier(spec: string, fromFile: string, rootDir: string): string | undefined {
  if (spec.startsWith("@/")) return join(rootDir, spec.slice(2));
  if (spec.startsWith(".")) return join(rootDir, dirname(fromFile), spec);
  return undefined;
}

/** A resolved specifier names a file directly, one missing its extension, or a
 *  directory's index — tried in that order, repo-relative and POSIX-separated. */
function toRepoRelativeFile(absNoExt: string, rootDir: string): string | undefined {
  for (const candidate of [
    absNoExt,
    `${absNoExt}.ts`,
    `${absNoExt}.tsx`,
    join(absNoExt, "index.ts"),
    join(absNoExt, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(rootDir, candidate).split(sep).join(posix.sep);
    }
  }
  return undefined;
}

/**
 * Every file reachable from `entryFiles` by a static import, repo-relative and
 * POSIX-separated. An entry file missing on disk is skipped rather than
 * thrown on — app/global-error.tsx does not exist yet, exactly how
 * eslint.config.mjs's own `files` array already treats it.
 */
export function transitiveClosure(entryFiles: string[], rootDir: string): Set<string> {
  const visited = new Set<string>();
  const queue = entryFiles.filter((f) => existsSync(join(rootDir, f)));
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    const source = readFileSync(join(rootDir, file), "utf8");
    for (const spec of specifiersIn(source)) {
      const resolved = resolveSpecifier(spec, file, rootDir);
      if (resolved === undefined) continue;
      const rel = toRepoRelativeFile(resolved, rootDir);
      if (rel !== undefined && !visited.has(rel)) queue.push(rel);
    }
  }
  return visited;
}

/**
 * Every non-test source file under app/(public), plus the two public pages
 * CLAUDE.md's boundary lists individually because they sit outside it by
 * construction. app/global-error.tsx does not exist yet and is skipped, not
 * asserted — the same treatment eslint.config.mjs gives it.
 */
export function publicEntryPoints(rootDir: string): string[] {
  const found: string[] = [];
  const base = join(rootDir, "app", "(public)");
  const visit = (dir: string, prefix: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue;
      const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
      if (e.isDirectory()) visit(join(dir, e.name), rel);
      else if (CODE_FILE.test(e.name) && !e.name.includes(".test.")) found.push(`app/(public)/${rel}`);
    }
  };
  if (existsSync(base)) visit(base, "");
  for (const extra of ["app/not-found.tsx", "app/global-error.tsx"]) {
    if (existsSync(join(rootDir, extra))) found.push(extra);
  }
  return found.sort();
}

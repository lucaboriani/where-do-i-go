/**
 * Layout, comment length and notes.md pointers — what ESLint cannot express.
 * FAILS on a component .tsx outside its own folder, a misplaced test, a dead
 * pointer, a comment count above the ratchet. REPORTS, exit 0: the tendency
 * drift and every active exemption. Numbers: CLAUDE.md "Code structure".
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "@typescript-eslint/parser";
import { walkTestFiles } from "../test/support/walk";

const flag = process.argv.indexOf("--root");
const IS_REPO = flag === -1;
const ROOT = resolve(IS_REPO ? process.cwd() : process.argv[flag + 1]);
const rel = (p: string) => p.slice(ROOT.length + 1).split("\\").join("/");
const SKIP = ["node_modules", ".next", ".git", ".pod-data", "test-results", "coverage"];

/** Every .ts/.tsx under `dir`, tests included only when `withTests`. */
function files(dir: string, withTests: boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.includes(e.name)) files(p, withTests, out);
    } else if (/\.tsx?$/.test(e.name)) {
      if (withTests || !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

const DIRS = ["components", "app", "hooks", "lib", "scripts", "test", "e2e"];

/** Root config files too: `eslint.config.mjs`, `playwright.config.ts`,
 *  `vitest.config.ts`, `proxy.ts`. Not recursive - `DIRS` covers the rest.
 *  Why they were missing, and what it cost: ../notes.md#the-scan-and-what-it-once-could-not-see */
const rootFiles = () =>
  readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx|mjs)$/.test(e.name) && !/^next-env/.test(e.name))
    .map((e) => join(ROOT, e.name));

const sources = (withTests: boolean) => [
  ...DIRS.flatMap((d) => files(join(ROOT, d), withTests)),
  ...rootFiles(),
];

/** Real comment tokens, never line prefixes: ./notes.md#tokens-not-prefixes
 *  `jsx` follows the extension, and must: ./notes.md#jsx-by-extension */
function commentTokens(file: string) {
  const jsx = file.endsWith(".tsx");
  const ast = parse(readFileSync(file, "utf8"), { comment: true, loc: true, jsx });
  return (ast.comments ?? []).sort((a, b) => a.loc.start.line - b.loc.start.line);
}

/** Runs of adjacent comment lines, as [path:line, lineCount]. */
function commentRuns(file: string): Array<[string, number]> {
  const runs: Array<[string, number]> = [];
  let first: number | null = null;
  let last = 0;
  for (const c of commentTokens(file)) {
    if (first !== null && c.loc.start.line > last + 1) {
      runs.push([`${rel(file)}:${first}`, last - first + 1]);
      first = null;
    }
    if (first === null) first = c.loc.start.line;
    last = Math.max(last, c.loc.end.line);
  }
  if (first !== null) runs.push([`${rel(file)}:${first}`, last - first + 1]);
  return runs;
}

/**
 * PRODUCTION IS ZERO, so its half is a hard bound and no longer a ratchet — the
 * Stage C sweep finished 2026-09-09. Test docblocks stay exempt but ratcheted,
 * so "exempt" means "not rewritten" and never "unbounded".
 * ./notes.md#the-comment-ratchet
 */
const PROD_COMMENT_BASELINE = 0;
const TEST_COMMENT_BASELINE = 545;

/** The test side: the placement rule's own predicate, plus the editor rig (54
 *  blocks, no `*.test.tsx`) and all of `e2e/`, which is Playwright's suite and
 *  as much a test as anything under `test/`.
 *  ../notes.md#the-scan-and-what-it-once-could-not-see */
const EDITOR_HARNESS = "components/studio/entry-editor/entry-editor.harness/";
const isTestSide = (path: string) =>
  /\.(test|spec)\.tsx?$/.test(path) ||
  path.startsWith("test/") ||
  path.startsWith("e2e/") ||
  path.startsWith(EDITOR_HARNESS);

type Ratchet = { over: string[]; verdict: string[] };

/**
 * The allowance is this repository's own debt, so a fixture tree gets none —
 * the same IS_REPO gate REPO_TESTS needs. The exempt half is not a bound
 * anywhere else, so outside this repository it counts and never fails.
 */
function ratchetOn(over: string[], baseline: number, name: string, exempt = false): Ratchet {
  if (!IS_REPO && exempt)
    return { over: [], verdict: [`  ${over.length}, exempt outside this repository`] };
  const allowed = IS_REPO ? baseline : 0;
  if (over.length > allowed)
    return { over, verdict: [`  ${over.length} — ROSE above the allowance of ${allowed}`] };
  const note =
    over.length < allowed
      ? `  ${over.length} now, allowance ${allowed} — lower ${name} to ${over.length}`
      : `  ${over.length}, at the allowance`;
  return { over: [], verdict: [note] };
}

function commentsOverBound(): { prod: Ratchet; test: Ratchet } {
  const listed = sources(true)
    .map((f) => rel(f))
    .filter((path) => !path.startsWith("components/ui/"))
    .flatMap((path) =>
      commentRuns(join(ROOT, path))
        .filter(([, n]) => n > 6)
        .map(([at, n]) => [path, `${at} — ${n} lines`] as const),
    );
  const half = (wantTest: boolean) =>
    listed.filter(([path]) => isTestSide(path) === wantTest).map(([, line]) => line);
  return {
    prod: ratchetOn(half(false), PROD_COMMENT_BASELINE, "PROD_COMMENT_BASELINE"),
    test: ratchetOn(half(true), TEST_COMMENT_BASELINE, "TEST_COMMENT_BASELINE", true),
  };
}

function componentFoldersAreOwn(): string[] {
  const bad: string[] = [];
  for (const file of files(join(ROOT, "components"), false)) {
    const path = rel(file);
    if (path.startsWith("components/ui/") || !path.endsWith(".tsx")) continue;
    const name = basename(file, ".tsx");
    if (name === "index") continue;
    if (basename(dirname(file)) !== name) bad.push(`${path} is not in a folder named "${name}"`);
    else if (!existsSync(join(dirname(file), "index.ts")))
      bad.push(`${path} has no index.ts barrel beside it`);
  }
  return bad;
}

const REPO_TESTS = [
  "test/guardrails.test.ts", "test/check-commands.test.ts", "test/check-structure.test.ts",
  "test/public-bundle.test.ts", "test/public-bundle-cli.test.ts",
  "test/vitest-collection.test.ts", "test/network-guard.test.ts", "test/support/walk.test.ts",
];

function testsSitBesideSubjects(): string[] {
  const bad: string[] = [];
  for (const path of walkTestFiles(ROOT)) {
    if (REPO_TESTS.includes(path) || path.startsWith("test/integration/")) continue;
    const dir = join(ROOT, dirname(path));
    const stem = basename(path).replace(/\.test\.tsx?$/, "").split(".")[0];
    if (!["ts", "tsx"].some((ext) => existsSync(join(dir, `${stem}.${ext}`))))
      bad.push(`${path} has no ${stem}.ts(x) beside it, and is not an allowed repo test`);
  }
  // Only on the real tree: a fixture root contains none of these by design.
  if (IS_REPO)
    for (const listed of REPO_TESTS)
      if (!existsSync(join(ROOT, listed)))
        bad.push(`REPO_TESTS names ${listed}, which does not exist`);
  return bad;
}

/**
 * GitHub's heading slug: lowercase, drop punctuation, hyphenate EACH space.
 * Per-character is load-bearing — `/\s+/g` collapses the two spaces a removed
 * em dash leaves, and em-dash headings are the house style here.
 * ./notes.md#github-heading-slugs
 */
const slug = (heading: string) =>
  heading.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/ /g, "-");

/** A pointer is a pointer only inside a comment: ./notes.md#tokens-not-prefixes */
function pointersIn(file: string): Array<[string, string]> {
  return commentTokens(file).flatMap((c) =>
    [...c.value.matchAll(/([\w./-]*notes\.md)#([\w-]+)/g)].map(
      ([, path, anchor]) => [path, anchor] as [string, string],
    ),
  );
}

function notesPointersResolve(): string[] {
  const bad: string[] = [];
  for (const file of sources(true)) {
    for (const [path, anchor] of pointersIn(file)) {
      const notes = path.startsWith(".") ? join(dirname(file), path) : join(ROOT, path);
      if (!existsSync(notes)) {
        bad.push(`${rel(file)} points at ${path}#${anchor}, which does not exist`);
        continue;
      }
      const anchors = [...readFileSync(notes, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)]
        .map((m) => slug(m[1]));
      if (!anchors.includes(anchor))
        bad.push(`${rel(file)} points at #${anchor}, absent from ${rel(notes)} (has: ${anchors.join(", ")})`);
    }
  }
  return bad;
}

async function driftReport(): Promise<string[]> {
  const { ESLint } = await import("eslint");
  // The NAMESPACE, not `.default`, which is undefined: ./notes.md#no-default-export
  const parser = await import("@typescript-eslint/parser");
  const lines: string[] = [];
  for (const [dirs, max] of [[["components", "app", "hooks"], 130], [["lib", "scripts"], 50]] as const) {
    const list = dirs.flatMap((d) => files(join(ROOT, d), false));
    if (list.length === 0) continue;
    const e = new ESLint({
      cwd: ROOT, // WITHOUT THIS THE REPORT IS ALWAYS EMPTY under --root.
      overrideConfigFile: true, ignore: false,
      allowInlineConfig: false, // ./notes.md#reporting-past-a-disable
      overrideConfig: [{
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        rules: {
          "max-lines-per-function": ["warn", { max, skipComments: true, skipBlankLines: true, IIFEs: true }],
        },
      }],
    });
    for (const r of await e.lintFiles(list))
      for (const m of r.messages)
        if (m.ruleId === "max-lines-per-function")
          lines.push(`  ${rel(r.filePath)}:${m.line} — ${m.message} (tendency ${max})`);
  }
  return lines;
}

/**
 * Includes test files: one of the four Stage A exemptions is on a test file.
 * THE COMMENT MUST START THE LINE, or a probe's template literal in
 * guardrails.test.ts reports as a fifth live exemption.
 * ./notes.md#exemptions-must-start-the-line
 */
function exemptionReport(): string[] {
  const found: string[] = [];
  for (const file of sources(true))
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const hit = /^\s*(?:\/\*|\/\/)\s*eslint-disable(?:-next-line)?\s+(max-lines[\w-]*)/.exec(line);
      if (hit) found.push(`  ${rel(file)}:${i + 1} — ${hit[1]}`);
    });
  return found;
}

/** Four rules that fail, two reports that do not: ./notes.md#two-tiers */
/**
 * Test files over the 600-line tendency. Reported, never failed — ESLint holds
 * the 1000 hard bound. CLAUDE.md's table lists this tendency and nothing was
 * printing it, so the row was decoration. See ./notes.md#two-tiers
 */
function testFileDrift(): string[] {
  return walkTestFiles(ROOT)
    .map((path) => {
      const src = readFileSync(join(ROOT, path), "utf8").split("\n");
      let inBlock = false;
      const code = src.filter((raw) => {
        const l = raw.trim();
        if (inBlock) {
          if (l.includes("*/")) inBlock = false;
          return false;
        }
        if (l === "" || l.startsWith("//")) return false;
        if (l.startsWith("/*")) {
          if (!l.includes("*/")) inBlock = true;
          return false;
        }
        return true;
      }).length;
      return [path, code] as const;
    })
    .filter(([, code]) => code > 600)
    .sort((a, b) => b[1] - a[1])
    .map(([path, code]) => `  ${path} — ${code} code lines (tendency 600)`);
}

async function main() {
  const scanned = sources(true).length;
  console.log(`scanned ${scanned} files under ${DIRS.join(", ")}`);
  if (IS_REPO && scanned < 50) {
    console.log(`\nonly ${scanned} files scanned — a directory moved, and every rule below is vacuous.`);
    process.exit(1);
  }

  const comments = commentsOverBound();
  const failures = [
    ["component folders", componentFoldersAreOwn()],
    ["test placement", testsSitBesideSubjects()],
    ["notes.md pointers", notesPointersResolve()],
    ["production comment ratchet", comments.prod.over],
    ["test comment ratchet", comments.test.over],
  ] as const;

  for (const [label, list] of failures)
    if (list.length > 0) {
      console.log(`\n${label} — ${list.length} problem(s):`);
      for (const item of list.slice(0, 40)) console.log(`  ${item}`);
    }

  console.log("\nproduction comment blocks over 6 lines (ratchet, reported):");
  for (const line of comments.prod.verdict) console.log(line);
  console.log("\ntest comment blocks over 6 lines (exempt, ratcheted):");
  for (const line of comments.test.verdict) console.log(line);

  const drift = await driftReport();
  console.log(`\nover the tendency — ${drift.length} function(s), reported, not failing:`);
  for (const line of drift) console.log(line);

  const testDrift = testFileDrift();
  console.log(`\ntest files over 600 code lines — ${testDrift.length}, reported, not failing:`);
  for (const line of testDrift) console.log(line);

  const exemptions = exemptionReport();
  console.log(`\nactive exemptions — ${exemptions.length}:`);
  for (const line of exemptions) console.log(line);

  const total = failures.reduce((n, [, list]) => n + list.length, 0);
  console.log(total === 0 ? "\nStructure OK." : `\n${total} structural problem(s).`);
  process.exit(total === 0 ? 0 : 1);
}

await main();

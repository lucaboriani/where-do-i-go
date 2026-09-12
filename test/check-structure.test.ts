import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { stripAnsi } from "./child-output";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

type Run = { status: number; stdout: string; transcript: string };

function runCli(root: string): Run {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-structure.ts", "--root", root],
    { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  const stdout = stripAnsi(result.stdout ?? "");
  const stderr = stripAnsi(result.stderr ?? "");
  return {
    status: result.status ?? -1,
    stdout,
    transcript: `\n$ check-structure.ts --root ${root}\n[exit ${result.status}]\n${stdout}${stderr}`,
  };
}

/** The real repository, with no --root at all, so IS_REPO is true. */
function runRepo(): Run {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-structure.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  const stdout = stripAnsi(result.stdout ?? "");
  return {
    status: result.status ?? -1,
    stdout,
    transcript: `\n$ check-structure.ts\n[exit ${result.status}]\n${stdout}`,
  };
}

/** A COMPLIANT fixture, so each case below breaks exactly one rule. */
function compliant(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "structure-")));
  created.push(root);
  mkdirSync(join(root, "components", "studio", "widget"), { recursive: true });
  mkdirSync(join(root, "components", "studio", "widget", "hooks"), { recursive: true });
  mkdirSync(join(root, "lib", "pod"), { recursive: true });
  mkdirSync(join(root, "test", "integration"), { recursive: true });
  const w = join(root, "components", "studio", "widget");
  writeFileSync(join(w, "widget.tsx"), "export const W = 1;\n");
  writeFileSync(join(w, "index.ts"), 'export * from "./widget";\n');
  writeFileSync(join(w, "hooks", "use-widget.ts"), "export const u = 1;\n");
  writeFileSync(join(root, "lib", "pod", "thing.ts"), "export const t = 1;\n");
  writeFileSync(join(root, "lib", "pod", "thing.test.ts"), 'import "./thing";\n');
  return root;
}

/**
 * The count printed under one of the two ratchet headers. Parsed, not
 * eyeballed: a partition that classified nothing as test-side would print 0
 * here, and every exit-code assertion below would still be green.
 */
function ratchetCount(stdout: string, half: "production" | "test"): number {
  const line = new RegExp(`^${half} comment blocks over 6 lines[^\\n]*:\\n {2}(\\d+)`, "m");
  return Number(line.exec(stdout)?.[1] ?? NaN);
}

/** One block, 8 lines counting its delimiters, so neither side of the
 *  decision can be exercising a different fixture from the other. */
const OVER_BOUND_BLOCK = `/**\n${" * prose\n".repeat(6)} */\n`;

describe("check:structure, against this repository", () => {
  const run = runRepo();

  it("passes", () => {
    expect(run.status, run.transcript).toBe(0);
  });

  it("says how many files it scanned, so a moved directory cannot make it vacuous", () => {
    const scanned = Number(/scanned (\d+) files/.exec(run.stdout)?.[1] ?? 0);
    expect(scanned, run.transcript).toBeGreaterThan(50);
  });

  it("reports length drift with real content, not an empty header", () => {
    // Named function, real line number, real tendency. The earlier draft asserted
    // /tendency/i, which the header line satisfies at a count of zero — I neutered
    // driftReport to `return []` and that assertion still passed.
    expect(run.stdout, run.transcript).toMatch(/entry-editor\.tsx:\d+ .*\(tendency 130\)/);

    /** THE COUNT IS CHECKED AGAINST THE ROWS, never against a number. It read
     *  `> 5` until 2026-09-08, when task 4 took lib/pod/access.ts's three
     *  functions off the list and left exactly 5 — the same shape as the "23
     *  integration tests" pin CLAUDE.md warns about. The hole this closes is a
     *  header with no rows under it, and rows are what closes it. */
    const block = /over the tendency — (\d+) function\(s\), reported, not failing:\n((?:  .*\n)*)/.exec(run.stdout);
    const rows = (block?.[2] ?? "").split("\n").filter((line) => line.trim() !== "");
    expect(rows.length, run.transcript).toBeGreaterThan(0);
    expect(Number(block?.[1]), run.transcript).toBe(rows.length);
    for (const row of rows) expect(row, run.transcript).toMatch(/:\d+ — .*\(tendency \d+\)$/);
  });

  /** ZERO since 2026-09-09. The last one was `main`'s in check-public-bundle.ts,
   *  dropped by the split that took it from 94 code lines to 20 — lint reported
   *  the directive unused before anyone deleted it. Read off THE EXEMPTIONS
   *  BLOCK, not stdout, because those paths appear in the drift report too. At
   *  zero the number needs a control, and the fixture case below is it: an
   *  `exemptionReport()` that found nothing would print 0 here just as happily. */
  it("reports zero active exemptions, because nothing is suppressed any more", () => {
    const block = /active exemptions — (\d+):\n((?:  .*\n)*)/.exec(run.stdout);
    expect(block?.[1], run.transcript).toBe("0");
    expect((block?.[2] ?? "").trim(), run.transcript).toBe("");
  });

  it("reports the comment ratchet as a count, not as a failure", () => {
    expect(run.stdout, run.transcript).toMatch(/comment blocks over 6 lines \(ratchet, reported\)/);
    expect(run.status, "the ratchet must not fail at or below baseline").toBe(0);
  });

  it("reports the two comment ratchets separately", () => {
    expect(run.stdout, run.transcript).toMatch(/production comment blocks over 6 lines/);
    expect(run.stdout, run.transcript).toMatch(/test comment blocks over 6 lines/);
    const production = ratchetCount(run.stdout, "production");
    const tests = ratchetCount(run.stdout, "test");
    expect(Number.isInteger(production), run.transcript).toBe(true);
    // 279 and 509 on 2026-09-08, and the split is the point: 54 of the test
    // half are the editor harness, which is not a *.test.tsx at all.
    expect(tests, run.transcript).toBeGreaterThan(400);
    expect(production, run.transcript).toBeLessThan(tests);
  });
});

/* Each case spawns a tsx child, so the 5 s default is thin under a parallel
   full-suite run - three of these flaked that way on 2026-09-09 and passed
   alone immediately after. The spawn itself already has a 120 s timeout. */
describe("check:structure, on fixtures that each break one rule", { timeout: 30_000 }, () => {
  it("accepts the compliant fixture, so every case below means something", () => {
    const run = runCli(compliant());
    expect(run.status, run.transcript).toBe(0);
  });

  it("accepts a flat hooks/ module without demanding a folder for it", () => {
    // Stage B puts ten plain modules inside state/ and hooks/. The folder rule
    // binds .tsx only; an earlier draft scanned .ts and would have failed all ten.
    const root = compliant();
    writeFileSync(
      join(root, "components", "studio", "widget", "hooks", "use-other.ts"),
      "export const o = 1;\n",
    );
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a component .tsx outside a folder of its own name", () => {
    const root = compliant();
    writeFileSync(join(root, "components", "studio", "loose.tsx"), "export const L = 1;\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("components/studio/loose.tsx");
  });

  it("fails on a component folder with no index.ts barrel", () => {
    const root = compliant();
    rmSync(join(root, "components", "studio", "widget", "index.ts"));
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("no index.ts barrel");
  });

  it("exempts components/ui from the folder rule", () => {
    const root = compliant();
    mkdirSync(join(root, "components", "ui"), { recursive: true });
    writeFileSync(join(root, "components", "ui", "button.tsx"), "export const B = 1;\n");
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a test with no source of the same base name beside it", () => {
    const root = compliant();
    writeFileSync(join(root, "test", "orphan.test.ts"), 'import "vitest";\n');
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("test/orphan.test.ts");
  });

  it("accepts a dotted stem whose first segment matches its subject", () => {
    // The rule Task 4 invented for read.owner-profile.test.ts, tested in the
    // direction that matters: the prefix must MATCH, not merely exist.
    const root = compliant();
    writeFileSync(join(root, "lib", "pod", "thing.extra.test.ts"), 'import "./thing";\n');
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a dotted stem whose first segment matches nothing", () => {
    const root = compliant();
    writeFileSync(join(root, "lib", "pod", "absent.extra.test.ts"), 'import "vitest";\n');
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("absent.extra.test.ts");
  });

  it("skips test/integration/, which has no single subject by design", () => {
    const root = compliant();
    writeFileSync(
      join(root, "test", "integration", "pod.integration.test.ts"),
      'import "vitest";\n',
    );
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a notes pointer whose anchor does not resolve", () => {
    const root = compliant();
    const dir = join(root, "components", "studio", "widget");
    writeFileSync(
      join(dir, "widget.tsx"),
      "// see ./notes.md#no-such-heading\nexport const W = 1;\n",
    );
    writeFileSync(join(dir, "notes.md"), "# widget\n\n## a-real-heading\n\nprose\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("no-such-heading");
  });

  it("fails on a pointer to a notes.md that does not exist", () => {
    const root = compliant();
    writeFileSync(
      join(root, "components", "studio", "widget", "widget.tsx"),
      "// see ./notes.md#anything\nexport const W = 1;\n",
    );
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    // NOT just "notes.md" — that substring is in other messages too.
    expect(run.stdout, run.transcript).toMatch(
      /points at \.\/notes\.md#anything, which does not exist/,
    );
  });

  it("resolves an em-dash heading the way GitHub does", () => {
    // The house style in docs/data-model.md. `/\s+/g` collapses the two spaces
    // left by the removed dash and yields ONE hyphen; GitHub yields two.
    const root = compliant();
    const dir = join(root, "components", "studio", "widget");
    writeFileSync(
      join(dir, "widget.tsx"),
      "// see ./notes.md#rule-1--where-it-applies\nexport const W = 1;\n",
    );
    writeFileSync(join(dir, "notes.md"), "# widget\n\n## Rule 1 — where it applies\n\nprose\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(0);
  });

  it("finds a pointer inside a test file, which is where the stale citations were", () => {
    const root = compliant();
    writeFileSync(
      join(root, "lib", "pod", "thing.test.ts"),
      '// see ./notes.md#absent\nimport "./thing";\n',
    );
    writeFileSync(join(root, "lib", "pod", "notes.md"), "# thing\n\n## present\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("#absent");
  });

  it("resolves a non-sibling pointer, which two real ones already are", () => {
    const root = compliant();
    mkdirSync(join(root, "lib", "pod", "support"), { recursive: true });
    writeFileSync(join(root, "lib", "pod", "support", "notes.md"), "# s\n\n## why\n");
    writeFileSync(
      join(root, "lib", "pod", "thing.ts"),
      "// see ./support/notes.md#why\nexport const t = 1;\n",
    );
    expect(runCli(root).status).toBe(0);
  });

  it("counts a JSX comment block, which is the entry editor's house style", () => {
    // 17 false negatives were measured against a prefix scanner, every one in
    // entry-editor.tsx, because these lines begin with `{`.
    const root = compliant();
    const block = `export const W = () => (\n  <div>\n    {/*\n${"      prose\n".repeat(8)}    */}\n  </div>\n);\n`;
    writeFileSync(join(root, "components", "studio", "widget", "widget.tsx"), block);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("widget.tsx");
  });

  it("does not count a comment-looking line inside a template literal", () => {
    const root = compliant();
    const lit = "export const md = `\n" + "* a markdown bullet\n".repeat(8) + "`;\n";
    writeFileSync(join(root, "lib", "pod", "thing.ts"), lit);
    expect(runCli(root).status).toBe(0);
  });

  it("allows a six-line block and fails a seven-line one, so the bound is a bound", () => {
    const six = compliant();
    writeFileSync(
      join(six, "lib", "pod", "thing.ts"),
      `${"// prose\n".repeat(6)}export const t = 1;\n`,
    );
    expect(runCli(six).status, "six lines is at the bound, not over it").toBe(0);

    const seven = compliant();
    writeFileSync(
      join(seven, "lib", "pod", "thing.ts"),
      `${"// prose\n".repeat(7)}export const t = 1;\n`,
    );
    const run = runCli(seven);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("lib/pod/thing.ts");
  });

  it("treats two blocks with no blank line between them as one run", () => {
    // Task 5 Step 6 inserts a 4-line disable directly above existing docblocks,
    // which is exactly this shape. Documented in CLAUDE.md; pinned here.
    const root = compliant();
    const merged = "/** a\n * b\n * c */\n/** d\n * e\n * f\n * g */\nexport const t = 1;\n";
    writeFileSync(join(root, "lib", "pod", "thing.ts"), merged);
    expect(runCli(root).status).toBe(1);
  });

  it("lets a blank line reset the run", () => {
    const root = compliant();
    const split = "/** a\n * b\n * c */\n\n/** d\n * e\n * f */\nexport const t = 1;\n";
    writeFileSync(join(root, "lib", "pod", "thing.ts"), split);
    expect(runCli(root).status).toBe(0);
  });

  it("fails when the production count rises, and not when a test file's does", () => {
    // The whole 2026-09-08 decision in one tree: the same block, two files.
    const root = compliant();
    writeFileSync(join(root, "lib", "pod", "thing.ts"), `${OVER_BOUND_BLOCK}export const t = 1;\n`);
    writeFileSync(join(root, "lib", "pod", "thing.test.ts"), `${OVER_BOUND_BLOCK}import "./thing";\n`);
    expect(OVER_BOUND_BLOCK.trimEnd().split("\n"), "the fixture block must be over 6").toHaveLength(8);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toMatch(/lib\/pod\/thing\.ts:1 — 8 lines/);
    expect(ratchetCount(run.stdout, "production"), run.transcript).toBe(1);
    expect(ratchetCount(run.stdout, "test"), run.transcript).toBe(1);
    const failed = /production comment ratchet — \d+ problem\(s\):\n((?:  .*\n)*)/.exec(run.stdout);
    expect(failed?.[1] ?? "", run.transcript).not.toContain("thing.test.ts");
  });

  it("accepts that same block in a test file alone, which is the exemption", () => {
    const root = compliant();
    writeFileSync(join(root, "lib", "pod", "thing.test.ts"), `${OVER_BOUND_BLOCK}import "./thing";\n`);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(0);
    expect(ratchetCount(run.stdout, "test"), "the block must be COUNTED, not missed").toBe(1);
    expect(ratchetCount(run.stdout, "production"), run.transcript).toBe(0);
  });

  it("counts a shared module under test/ on the test side", () => {
    const root = compliant();
    writeFileSync(join(root, "test", "graph.ts"), `${OVER_BOUND_BLOCK}export const g = 1;\n`);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(0);
    expect(ratchetCount(run.stdout, "test"), run.transcript).toBe(1);
  });

  it("counts the editor harness on the test side, though it is no *.test.tsx", () => {
    const root = compliant();
    const dir = join(root, "components", "studio", "entry-editor", "entry-editor.harness");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), 'export * from "./entry-editor.harness";\n');
    writeFileSync(join(dir, "entry-editor.harness.tsx"), `${OVER_BOUND_BLOCK}export const H = 1;\n`);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(0);
    expect(ratchetCount(run.stdout, "test"), run.transcript).toBe(1);
  });

  it("counts the harness's sibling component on the production side", () => {
    // The narrow clause, tested at the path next door: exempting the rig must
    // not exempt the editor it fakes for. A rule that exempts everything is
    // indistinguishable from a deleted rule by the case above alone.
    const root = compliant();
    const dir = join(root, "components", "studio", "entry-editor");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), 'export * from "./entry-editor";\n');
    writeFileSync(join(dir, "entry-editor.tsx"), `${OVER_BOUND_BLOCK}export const E = 1;\n`);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(ratchetCount(run.stdout, "production"), run.transcript).toBe(1);
  });

  it("still counts an exemption where there is one, which is what zero means", () => {
    // The allow-case for the repository assertion above. Without it, an
    // exemptionReport() that scanned nothing and a repository that suppresses
    // nothing print the same line.
    const root = compliant();
    writeFileSync(
      join(root, "lib", "pod", "thing.ts"),
      "/* eslint-disable-next-line max-lines-per-function */\nexport function t() {}\n",
    );
    const run = runCli(root);
    expect(run.status, "an exemption is reported, never failed").toBe(0);
    const block = /active exemptions — (\d+):\n((?:  .*\n)*)/.exec(run.stdout);
    expect(block?.[1], run.transcript).toBe("1");
    expect(block?.[2] ?? "", run.transcript).toContain(
      "lib/pod/thing.ts:1 — max-lines-per-function",
    );
  });

  /** hooks/ is a ROOT directory, sibling of components/. A directory absent
   *  from DIRS is not scanned at all, so every rule below reports nothing
   *  about it and the run stays green — the same silence a missing include
   *  glob buys a test file. Six lines pass, seven fail, at hooks/ too. */
  it("scans hooks/, where a six-line comment block passes and a seven-line one fails", () => {
    const six = compliant();
    mkdirSync(join(six, "hooks", "studio"), { recursive: true });
    writeFileSync(
      join(six, "hooks", "studio", "use-x.ts"),
      `${"// prose\n".repeat(6)}export const u = 1;\n`,
    );
    expect(runCli(six).status, "six lines is at the bound, not over it").toBe(0);

    const seven = compliant();
    mkdirSync(join(seven, "hooks", "studio"), { recursive: true });
    writeFileSync(
      join(seven, "hooks", "studio", "use-x.ts"),
      `${"// prose\n".repeat(7)}export const u = 1;\n`,
    );
    const run = runCli(seven);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("hooks/studio/use-x.ts");
  });

  /** The pointer this refactor actually breaks: the map hooks cite
   *  `../notes.md#…`, which is trip-map/notes.md today and hooks/notes.md
   *  after the move — a file nobody is creating. Unscanned, it breaks silently. */
  it("resolves notes pointers from hooks/, which is where ../notes.md breaks on the move", () => {
    const root = compliant();
    mkdirSync(join(root, "hooks", "map"), { recursive: true });
    writeFileSync(
      join(root, "hooks", "map", "use-y.ts"),
      "// see ../notes.md#why-styleloaded-is-not-isstyleloaded\nexport const y = 1;\n",
    );
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toMatch(
      /points at \.\.\/notes\.md#why-styleloaded-is-not-isstyleloaded, which does not exist/,
    );
  });

  /** 130, the render tendency, because these are React hooks — the drift
   *  report's other pair is 50. A hooks/ entry in the wrong pair still prints
   *  a row, so the tendency NUMBER is what this matches on. */
  it("reports hooks/ drift at the 130 tendency, not at lib's 50", () => {
    const root = compliant();
    mkdirSync(join(root, "hooks", "studio"), { recursive: true });
    const body = `${"  let x = 1;\n".repeat(140)}`;
    writeFileSync(
      join(root, "hooks", "studio", "use-long.ts"),
      `export function useLong() {\n${body}}\n`,
    );
    const run = runCli(root);
    expect(run.status, "the drift report reports; it never fails").toBe(0);
    expect(run.stdout, run.transcript).toMatch(/hooks\/studio\/use-long\.ts:1 .*\(tendency 130\)/);
  });

  it("reports drift under --root too, which is what cwd: ROOT buys", () => {
    // The 25th case, added because nothing else pins `cwd: ROOT`. Without it
    // ESLint's basePath is the repository, this file is out of basePath, and
    // the one `ruleId: null` message that comes back is dropped by the filter —
    // so the report prints zero for a fixture that has a 60-line function in it.
    const root = compliant();
    const body = `${"  let x = 1;\n".repeat(60)}`;
    writeFileSync(join(root, "lib", "pod", "long.ts"), `export function long() {\n${body}}\n`);
    const run = runCli(root);
    expect(run.status, "the drift report reports; it never fails").toBe(0);
    expect(run.stdout, run.transcript).toMatch(/lib\/pod\/long\.ts:1 .*\(tendency 50\)/);
  });
});

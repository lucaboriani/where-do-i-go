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
    const count = Number(/over the tendency — (\d+) function/.exec(run.stdout)?.[1] ?? 0);
    expect(count, run.transcript).toBeGreaterThan(5);
  });

  /** Three since 2026-09-08: the fourth was `max-lines` on entry-editor.test.tsx
   *  and went with the file when Stage B split it into thirteen suites, none of
   *  which needs one. The count is asserted too — an exemption reappearing
   *  somewhere unlisted is the thing worth failing on. */
  it("lists all three exemptions by path, and exactly three", () => {
    expect(run.stdout, run.transcript).toMatch(/active exemptions — 3/);
    for (const path of [
      "entry-editor/entry-editor.tsx",
      "lib/pod/entry-model.ts",
      "scripts/check-public-bundle.ts",
    ])
      expect(run.stdout, run.transcript).toContain(path);
    expect(run.stdout, run.transcript).not.toContain("entry-editor.test.tsx");
  });

  it("reports the comment ratchet as a count, not as a failure", () => {
    expect(run.stdout, run.transcript).toMatch(/comment blocks over 6 lines \(ratchet, reported\)/);
    expect(run.status, "the ratchet must not fail at or below baseline").toBe(0);
  });
});

describe("check:structure, on fixtures that each break one rule", () => {
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
    writeFileSync(join(root, "test", "integration", "pod.integration.test.ts"), 'import "vitest";\n');
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a notes pointer whose anchor does not resolve", () => {
    const root = compliant();
    const dir = join(root, "components", "studio", "widget");
    writeFileSync(join(dir, "widget.tsx"), "// see ./notes.md#no-such-heading\nexport const W = 1;\n");
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
    expect(run.stdout, run.transcript).toMatch(/points at \.\/notes\.md#anything, which does not exist/);
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
    writeFileSync(join(root, "lib", "pod", "thing.ts"), "// see ./support/notes.md#why\nexport const t = 1;\n");
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
    writeFileSync(join(six, "lib", "pod", "thing.ts"), `${"// prose\n".repeat(6)}export const t = 1;\n`);
    expect(runCli(six).status, "six lines is at the bound, not over it").toBe(0);

    const seven = compliant();
    writeFileSync(join(seven, "lib", "pod", "thing.ts"), `${"// prose\n".repeat(7)}export const t = 1;\n`);
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

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `npm run check:commands`, run as a command.
 *
 * CLAUDE.md is the contract and package.json implements it; this script exists
 * so the two cannot drift. It had no test, and a read-only review found it
 * grades the wrong thing in one direction and does not look at all in the
 * other:
 *
 *   F4  The sentinel that is supposed to prove "this is the scripts list" only
 *       requires the graded block to contain `test` and `build`. A plausible
 *       untagged decoy passes the sentinel, gets graded instead of the real
 *       list, and the script reports success having checked a fraction of the
 *       commands. The comment above the sentinel claims it closes exactly this
 *       hole. The fix was to stop guessing: two untagged fences in the Commands
 *       section is fatal, and the sentinel stayed as a second guard for the
 *       case where there is only one and it is the wrong one. Both are fenced
 *       below, and both were unfenced when this file was first written — see
 *       the comment on DECOY for the mutation runs that proved it.
 *
 *   F10 It is one-directional. CI runs `npm run size`; CLAUDE.md's Commands
 *       block never names it, and never names `start` either. Rename either
 *       script and CI breaks while this check stays green.
 *
 * Each case builds a miniature checkout — the script, a CLAUDE.md, a
 * package.json — in a temp directory and runs the script against it, so the
 * fixtures can be wrong on purpose without touching the repository's own
 * files. The last case is the exception: it reads the real CLAUDE.md and the
 * real package.json, because F10 is a drift that exists here, now.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/check-commands.ts";

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------- the fixture

/** The script list as CLAUDE.md writes it: name, padding, `#` comment. The
 *  script keeps the first whitespace-delimited token of each line. */
const entry = (name: string) => `${name.padEnd(20)} # what ${name} does`;

/**
 * A CLAUDE.md shaped like the real one: a heading, prose, a TAGGED ```sh block
 * (the Node-version note, which is what put a fence ahead of the real list in
 * the first place), then the untagged scripts list, then the next section.
 */
function claudeMd(spec: { decoy?: string[]; list: string[] }): string {
  const lines = [
    "# CLAUDE.md",
    "",
    "## Commands",
    "",
    "**The Node version IS dictated. Select it before running anything.**",
    "",
    "```sh",
    "nvm use",
    "node -v",
    "```",
    "",
  ];
  if (spec.decoy) {
    lines.push("Every script, listed again:", "", "```", ...spec.decoy, "```", "");
  }
  lines.push(
    "```",
    ...spec.list.map(entry),
    "```",
    "",
    "## Ask before doing",
    "",
    "- Anything.",
    "",
  );
  return lines.join("\n");
}

function checkout(spec: { markdown: string; scripts: string[] }): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wig-check-commands-")));
  created.push(base);
  const root = join(base, "repo");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(resolve(ROOT, SCRIPT), join(root, "scripts", "check-commands.ts"));
  writeFileSync(join(root, "CLAUDE.md"), spec.markdown);
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "fixture",
        private: true,
        type: "module",
        scripts: Object.fromEntries(spec.scripts.map((s) => [s, `echo ${s}`])),
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

type Run = { status: number; stdout: string; stderr: string; transcript: string };

function runCli(root: string): Run {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", join(root, "scripts", "check-commands.ts")],
    // cwd is the repo so that `tsx` resolves; the script under test is not here.
    { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const transcript =
    `\n$ tsx ${root}/scripts/check-commands.ts\n[exit ${result.status}]\n${stdout}${stderr}`
      .replace(/^\s+at\s+/gm, "      | ")
      .slice(0, 4000);
  return { status: result.status ?? -1, stdout, stderr, transcript };
}

/** The line the script prints only when it is satisfied. */
const SUCCESS = /All \d+ commands in CLAUDE\.md exist in package\.json/;

/** The real list, as CLAUDE.md's Commands block spells it. */
const LIST = [
  "dev",
  "build",
  "test",
  "test:e2e",
  "lint",
  "typecheck",
  "validate:fixtures",
  "check:vocab",
  "check:commands",
  "size:public",
  "pod:dev",
  "pod:seed",
];

/**
 * An untagged block, above the real list, that must not be graded in its place.
 *
 * IT NAMES EVERY SCRIPT IN `LIST`, AND THAT IS THE POINT. This fixture used to
 * be `["test", "build", "lint"]` — "the three you run most" — which is a strict
 * SUBSET of `LIST`, and that made both cases below pass without the F4 guard
 * existing at all: grading a three-name decoy leaves nine scripts undocumented,
 * so the F10 BACKWARD direction reports drift and exits 1. Measured 2026-09-04,
 * with the guard disabled (`if (fences.length > 1)` forced to `if (false)`):
 * 239 passed (239). Both F4 cases were being satisfied by the F10 mechanism,
 * and F4 could have been deleted unnoticed.
 *
 * A decoy that names every entry of `LIST` removes that crutch. Grading it
 * produces no forward drift (every name is a real script) and no backward
 * drift (every real script is named), so the ONLY thing left that can fail
 * these fixtures is the guard that refuses to choose between two untagged
 * fences.
 *
 * Which is also why the assertions match the guard's own words rather than
 * `status !== 0`. An exit code cannot say WHICH guard fired, and that
 * ambiguity is the whole defect being fixed here.
 */
const DECOY = [...LIST];

/** The uniqueness guard's own message. The only output that proves F4 fired
 *  rather than one of the drift checks. */
const REFUSED = /untagged code blocks/;

// -------------------------------------------------------------------- cases

describe("check:commands, run as a command", () => {
  it("passes, and grades every command in the block, when the two files agree", () => {
    // The allow-case. A check that rejects everything is no more useful than
    // one that accepts everything.
    expect(LIST.length).toBe(12);
    const run = runCli(checkout({ markdown: claudeMd({ list: LIST }), scripts: LIST }));

    expect(run.status, `two files that agree were reported as drifted:${run.transcript}`).toBe(0);
    expect(run.stdout).toMatch(SUCCESS);
    // Every one of them was actually looked at, not just the first line.
    for (const name of LIST) expect(run.stdout, `${name} was never graded`).toContain(name);
    expect(run.stdout).toContain("All 12 commands");
  });

  it("fails, naming the command, when CLAUDE.md names a script package.json lacks", () => {
    // The control for the decoy case below: without a decoy in the way, the
    // drift is caught. (This is the reviewer's "without decoy" run.)
    const list = [...LIST, "deploy:prod"];
    const run = runCli(checkout({ markdown: claudeMd({ list }), scripts: LIST }));

    expect(run.status, `an undefined command was not reported:${run.transcript}`).not.toBe(0);
    expect(run.stdout).toContain("deploy:prod");
    expect(run.stdout).not.toMatch(SUCCESS);
  });
});

describe("F4: two untagged blocks must be refused, not guessed between", () => {
  it("refuses, and says which guard refused, when a decoy sits above the list", () => {
    const markdown = claudeMd({ decoy: DECOY, list: LIST });

    // The fixture is the shape the case is about, and the shape is load-bearing:
    // an untagged fence, above the real one, naming ALL twelve scripts. If it
    // ever drifts back to a subset, the F10 backward check starts doing this
    // case's work and the F4 guard goes unfenced again.
    expect(
      [...DECOY].sort(),
      "the decoy no longer names every script in LIST — see the comment on DECOY",
    ).toEqual([...LIST].sort());
    const FENCE = "```";
    const decoyFence = ["", FENCE, ...DECOY, FENCE, ""].join("\n");
    const firstFence = markdown.indexOf(decoyFence);
    expect(firstFence, "the decoy block is not in the fixture").toBeGreaterThan(-1);
    expect(firstFence).toBeLessThan(markdown.indexOf(entry("size:public")));

    const run = runCli(checkout({ markdown, scripts: LIST }));

    // Nothing has drifted in either direction here — the decoy, the list and
    // package.json all name the same twelve scripts — so this run can only fail
    // for the reason the case is about.
    expect(
      run.status,
      `check:commands did not refuse a Commands section with two untagged code blocks. It ` +
        `cannot tell a decoy from the list — they are both fences full of script ` +
        `names — so guessing is how it once graded three commands out of twelve and ` +
        `reported success:${run.transcript}`,
    ).not.toBe(0);
    expect(
      run.stdout,
      `the run failed, but not because of the F4 guard. An exit code alone cannot say which ` +
        `check fired, and F4 is the one this case is about:${run.transcript}`,
    ).toMatch(REFUSED);
    // The message is actionable: it says how many it found.
    expect(run.stdout).toContain("2 untagged code blocks");
    expect(run.stdout).not.toMatch(SUCCESS);
  });

  it("does not swallow a real drift when a decoy block sits above the list", () => {
    // The reviewer's "with decoy" run: `deploy:prod` is named by CLAUDE.md and
    // defined nowhere, and grading the decoy is exactly how it disappears.
    const markdown = claudeMd({ decoy: DECOY, list: [...LIST, "deploy:prod"] });
    expect(markdown).toContain(entry("deploy:prod"));
    // The decoy is otherwise complete, so it is the ONLY thing wrong with the
    // fixture: a decoy naming fewer scripts would be caught by F10 instead and
    // this case would prove nothing about F4.
    expect(DECOY).not.toContain("deploy:prod");
    expect(DECOY).toHaveLength(LIST.length);

    const run = runCli(checkout({ markdown, scripts: LIST }));

    expect(
      run.status,
      `a command CLAUDE.md names and package.json does not define went unreported because a ` +
        `decoy block was graded instead:${run.transcript}`,
    ).not.toBe(0);
    expect(
      run.stdout,
      `the drift was not reported, and neither was the ambiguity that hid it:${run.transcript}`,
    ).toMatch(REFUSED);
    expect(run.stdout, "the run claimed success").not.toMatch(SUCCESS);
  });
});

/**
 * The `test`/`build` sentinel, which the two cases above cannot reach: a
 * section with two untagged fences never gets past the uniqueness guard, so
 * nothing exercised the sentinel and deleting it was invisible. Measured
 * 2026-09-04, with `for (const sentinel of ["test", "build"])` forced to
 * `for (const sentinel of [])`: 239 passed (239).
 *
 * It is for the other half of the ambiguity — exactly ONE untagged fence, which
 * is not the scripts list. Uniqueness cannot see that, because there is nothing
 * to compare it against.
 */
describe("the sentinel: one untagged block that is not the scripts list", () => {
  it("refuses a Commands block that names neither test nor build", () => {
    // Two scripts, both documented, both defined: no forward drift, no backward
    // drift, exactly one untagged fence. The only thing wrong is that a
    // Commands block which has lost `test` and `build` is not this project's
    // scripts list, so whatever was graded, it was not the contract.
    const list = ["dev", "lint"];
    const run = runCli(checkout({ markdown: claudeMd({ list }), scripts: list }));

    expect(
      run.status,
      `check:commands graded an untagged block that names neither "test" nor "build" and ` +
        `reported success. Nothing else about this fixture is wrong, so the sentinel is the ` +
        `only thing that could have caught it:${run.transcript}`,
    ).not.toBe(0);
    expect(
      run.stdout,
      `the run failed for some other reason than the sentinel:${run.transcript}`,
    ).toMatch(/does not contain "test"/);
    expect(run.stdout).not.toMatch(SUCCESS);
  });

  it("accepts a block that does name them", () => {
    // The allow-case. A sentinel that rejects every block is no more useful
    // than one that accepts every block.
    const list = ["dev", "test", "build", "lint"];
    const run = runCli(checkout({ markdown: claudeMd({ list }), scripts: list }));

    expect(
      run.status,
      `a Commands block naming both sentinels was rejected:${run.transcript}`,
    ).toBe(0);
    expect(run.stdout).toMatch(SUCCESS);
    expect(run.stdout).toContain("All 4 commands");
  });
});

describe("F10: the check must run in both directions", () => {
  it("reports a script package.json defines that CLAUDE.md never names", () => {
    // `size` and `start` are the two this actually happens to: CI runs
    // `npm run size`, and nothing in the Commands block mentions either.
    const list = ["dev", "build", "test", "size:public"];
    const run = runCli(
      checkout({ markdown: claudeMd({ list }), scripts: [...list, "size", "start"] }),
    );

    const out = `${run.stdout}${run.stderr}`;
    // Word-ish boundaries, so that "size:public" cannot be mistaken for a
    // report of "size".
    expect(
      out,
      `package.json defines "size" and CLAUDE.md never names it. Rename the script and CI's ` +
        `\`npm run size\` step breaks while this check stays green:${run.transcript}`,
    ).toMatch(/(?<![\w:-])size(?![\w:-])/);
    expect(out).toMatch(/(?<![\w:-])start(?![\w:-])/);
    expect(
      run.status,
      `the drift was not fatal, so CI would not catch it:${run.transcript}`,
    ).not.toBe(0);
  });

  it("this repository's package.json and CLAUDE.md have not drifted", () => {
    // Not a fixture: the real two files. This is the drift that exists today.
    const claude = readFileSync(resolve(ROOT, "CLAUDE.md"), "utf8");
    const start = claude.indexOf("## Commands");
    expect(start, 'CLAUDE.md has no "## Commands" heading').toBeGreaterThan(-1);
    const rest = claude.slice(start + 1);
    const end = rest.indexOf("\n## ");
    const section = end === -1 ? rest : rest.slice(0, end);
    expect(section.length, "the Commands section came out empty").toBeGreaterThan(200);

    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    const names = Object.keys(pkg.scripts ?? {});
    expect(names.length, "package.json defines no scripts").toBeGreaterThanOrEqual(10);

    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const named = (name: string) => new RegExp(`^${escape(name)}(\\s|$)`, "m").test(section);
    // The matcher finds the ones that are documented, so an empty result below
    // means "all documented" rather than "the matcher is broken".
    expect(names.filter(named).length).toBeGreaterThan(5);

    expect(
      names.filter((name) => !named(name)),
      "these scripts exist in package.json and are named nowhere in CLAUDE.md's Commands " +
        "section. CLAUDE.md is the contract: an undocumented script can be renamed or deleted " +
        "without any check noticing, and CI runs one of these",
    ).toEqual([]);
  });
});

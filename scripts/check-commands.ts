#!/usr/bin/env tsx
/**
 * Keep CLAUDE.md's Commands block and package.json's scripts from drifting, in
 * BOTH directions. CLAUDE.md is the contract; package.json implements it.
 *
 *   forward   every command CLAUDE.md names must exist in package.json.
 *   backward  every script package.json defines must be named in CLAUDE.md.
 *
 * The backward direction was missing, and the drift it would have caught was
 * already there: CI runs `npm run size`, and the Commands block named neither
 * `size` nor `start`. Rename either script and CI breaks while this check
 * stays green — an undocumented script is one no check is holding onto.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const claude = readFileSync(resolve(REPO_ROOT, "CLAUDE.md"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));

/**
 * The Commands section, bounded at the next `## ` heading rather than running
 * to the end of the file. Bounded, because everything below counts fences and a
 * fence three sections further down is none of this check's business.
 */
const start = claude.indexOf("## Commands");
if (start === -1) {
  console.log('Could not find a "## Commands" heading in CLAUDE.md.');
  process.exit(1);
}
const afterHeading = claude.slice(start + "## Commands".length);
const nextHeading = afterHeading.indexOf("\n## ");
const section = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);

/**
 * Walk the fences line by line rather than matching them with a regex.
 *
 * A regex cannot do this: the CLOSING fence of a tagged block is spelled
 * exactly like the OPENING fence of an untagged one (```), so
 * `/```\n([\s\S]*?)```/` happily starts capturing at the end of a ```sh block
 * and returns the prose that follows it. That is not a hypothetical — it is
 * what this script did on the first attempt at an earlier fix.
 */
function untaggedFences(markdown: string): string[] {
  const found: string[] = [];
  let open: string | undefined;
  let body: string[] = [];
  for (const line of markdown.split("\n")) {
    const fence = /^```(.*)$/.exec(line.trim());
    if (!fence) {
      if (open !== undefined) body.push(line);
      continue;
    }
    if (open === undefined) {
      open = fence[1].trim();
      body = [];
    } else {
      if (open === "") found.push(body.join("\n"));
      open = undefined;
    }
  }
  return found;
}

/**
 * The scripts list is the ONE untagged fence in the Commands section. Every
 * other code block there is tagged (```sh), which is both better markdown and
 * what makes this unambiguous.
 *
 * WHY AMBIGUITY IS FATAL RATHER THAN RESOLVED BY GUESSING. This used to take
 * the FIRST untagged fence and then "prove" it was the right one by requiring
 * it to contain `test` and `build`. That sentinel did not close the hole its own
 * comment claimed it closed: an untagged decoy above the real list — "the three
 * you run most: test, build, lint" — satisfies it, gets graded instead of the
 * list, and the script reports "All 3 commands in CLAUDE.md exist in
 * package.json" having never looked at the other nine. A check that grades a
 * quarter of the contract and says "all" is worse than one that is simply
 * absent, because it occupies the slot where the real check would go.
 *
 * There is no reliable way to tell a decoy from the list — they are both fences
 * full of script names — so this does not try. Two untagged fences in the
 * Commands section means the maintainer has to say which is which, by tagging
 * the other one.
 */
const fences = untaggedFences(section);
if (fences.length === 0) {
  console.log("Could not find an untagged command block in CLAUDE.md's Commands section.");
  process.exit(1);
}
if (fences.length > 1) {
  console.log(
    `CLAUDE.md's Commands section contains ${fences.length} untagged code blocks, and the ` +
      `scripts list is supposed to be the only one. This check will not guess which of them is ` +
      `the contract: guessing is how it once graded three commands out of twelve and reported ` +
      `success. Tag every other code block in that section with a language (\`\`\`sh) so exactly ` +
      `one untagged block remains.`,
  );
  process.exit(1);
}
const block = fences[0];

// Belt and braces on top of the uniqueness rule above. `test` and `build` are
// the two commands this project cannot lose, so their absence means the one
// untagged fence is not the scripts list at all.
for (const sentinel of ["test", "build"]) {
  if (!new RegExp(`^${sentinel}\\b`, "m").test(block)) {
    console.log(
      `The untagged code block in CLAUDE.md's "## Commands" section does not contain ` +
        `"${sentinel}", so it is not the scripts list — this check would have graded the wrong ` +
        `block.`,
    );
    process.exit(1);
  }
}

const named = block
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split(/\s+/)[0]);

const scripts: Record<string, string> = pkg.scripts ?? {};
const defined = Object.keys(scripts);

const missing = named.filter((n) => !(n in scripts));
const undocumented = defined.filter((n) => !named.includes(n));

for (const n of named) console.log(`  ${n in scripts ? "ok  " : "MISSING"} ${n}`);
for (const n of undocumented) console.log(`  EXTRA   ${n}`);

let failed = false;

if (missing.length) {
  console.log(
    `\nCLAUDE.md names ${missing.length} command(s) package.json does not define: ` +
      missing.join(", "),
  );
  failed = true;
}

if (undocumented.length) {
  console.log(
    `\npackage.json defines ${undocumented.length} script(s) CLAUDE.md's Commands block does ` +
      `not name: ${undocumented.join(", ")}\n` +
      `CLAUDE.md is the contract. An undocumented script can be renamed or deleted with nothing ` +
      `noticing — and CI invokes some of these by name. Add them to the block, or delete them.`,
  );
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `\nAll ${named.length} commands in CLAUDE.md exist in package.json, and all ` +
    `${defined.length} scripts in package.json are named in CLAUDE.md.`,
);

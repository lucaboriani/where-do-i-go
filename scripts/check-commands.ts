#!/usr/bin/env tsx
/**
 * Assert every command named in CLAUDE.md exists in package.json, so the two
 * files cannot drift. CLAUDE.md is the contract; package.json implements it.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const claude = readFileSync(resolve(REPO_ROOT, "CLAUDE.md"), "utf8");
const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));

/**
 * The scripts list is the FIRST UNTAGGED fence after the heading. Every other
 * code block in that section is tagged (```sh), which is both better markdown
 * and what keeps this regex off it.
 *
 * That is too subtle to rely on alone. Adding a Node-version note to the
 * Commands section put an untagged ```/nvm use``` block ahead of the real list,
 * and this script cheerfully graded THAT — reporting `nvm` and `node` as
 * missing scripts. It failed loudly, which is luck: a block whose lines all
 * happened to be real script names would have passed while checking nothing.
 * Hence the sentinel below.
 */
const section = claude.slice(claude.indexOf("## Commands"));
if (!section.startsWith("## Commands")) {
  console.log('Could not find a "## Commands" heading in CLAUDE.md.');
  process.exit(1);
}

/**
 * Walk the fences line by line rather than matching them with a regex.
 *
 * A regex cannot do this: the CLOSING fence of a tagged block is spelled
 * exactly like the OPENING fence of an untagged one (```), so
 * `/```\n([\s\S]*?)```/` happily starts capturing at the end of a ```sh block
 * and returns the prose that follows it. That is not a hypothetical — it is
 * what this script did on the first attempt at the fix above.
 */
function firstUntaggedFence(markdown: string): string | undefined {
  const lines = markdown.split("\n");
  let open: string | undefined;
  let body: string[] = [];
  for (const line of lines) {
    const fence = /^```(.*)$/.exec(line.trim());
    if (!fence) {
      if (open !== undefined) body.push(line);
      continue;
    }
    if (open === undefined) {
      open = fence[1].trim();
      body = [];
    } else {
      if (open === "") return body.join("\n");
      open = undefined;
    }
  }
  return undefined;
}

const found = firstUntaggedFence(section);
if (found === undefined) {
  console.log("Could not find an untagged command block in CLAUDE.md's Commands section.");
  process.exit(1);
}
const block = [null, found] as const;

// The block we found must be the scripts list and not some other fence that
// drifted above it. `test` and `build` are the two commands this project cannot
// lose, so their absence means we are reading the wrong block.
for (const sentinel of ["test", "build"]) {
  if (!new RegExp(`^${sentinel}\\b`, "m").test(block[1])) {
    console.log(
      `The first untagged code block after "## Commands" does not contain "${sentinel}", so it ` +
        `is not the scripts list — this check would have graded the wrong block. Tag any other ` +
        `code block in that section with a language (\`\`\`sh) so it is skipped.`,
    );
    process.exit(1);
  }
}

const named = block[1]
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => l.split(/\s+/)[0]);

const scripts: Record<string, string> = pkg.scripts ?? {};
const missing = named.filter((n) => !(n in scripts));

for (const n of named) console.log(`  ${n in scripts ? "ok  " : "MISSING"} ${n}`);

if (missing.length) {
  console.log(`\nCLAUDE.md names ${missing.length} command(s) package.json does not define: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${named.length} commands in CLAUDE.md exist in package.json.`);

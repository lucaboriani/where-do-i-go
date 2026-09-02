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

const block = /## Commands[\s\S]*?```\n([\s\S]*?)```/.exec(claude);
if (!block) {
  console.log("Could not find the Commands block in CLAUDE.md.");
  process.exit(1);
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

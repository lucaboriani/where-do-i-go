#!/usr/bin/env tsx
/**
 * Budget on the JavaScript a PUBLIC page actually ships.
 *
 * `size-limit` globs files; it cannot answer "what does /trips/[slug] send to a
 * browser". Globbing `.next/static/chunks/**` measures the studio's Radix and
 * shadcn weight too, so a public regression could hide inside the total and a
 * studio addition could fail a budget it has nothing to do with.
 *
 * This derives the file list from the prerendered HTML of each public route —
 * the scripts the browser is actually told to load — and sums them gzipped.
 * Chunk names are content-hashed, so deriving beats hardcoding.
 *
 * Run after `next build`.
 */
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * Ceiling taken from the first real build (2026-09-02): the worst public route
 * measured 173.3 kB gzip, all of it React and the Next runtime — verified by
 * scanning every loaded chunk for radix / inrupt / maplibre / exifreader and
 * finding none. The headroom is small on purpose.
 *
 * TODO.md: set it from the first real build, then ONLY EVER LOWER IT. Raising
 * this number is how a budget stops being a budget.
 */
const LIMIT_KB = Number(process.env.PUBLIC_BUNDLE_LIMIT_KB ?? 180);

/**
 * Every concrete prerendered public page. Discovered rather than listed:
 * `[slug].html` is a zero-byte Partial Prerendering shell, so the file that
 * matters is the one built for a real param (`2026-japan.html`).
 *
 * The studio is excluded deliberately — it is allowed to be heavy, and the
 * whole point of this budget is that its weight must not hide a public
 * regression.
 */
function publicPages(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".html") && statSync(full).size > 0) out.push(full);
    }
  };
  walk(resolve(ROOT, ".next/server/app"));
  return out
    .filter((f) => !/studio|_not-found|_global-error/.test(f))
    .map((f) => f.slice(ROOT.length + 1));
}
const PAGES = publicPages();

const scriptsIn = (html: string) =>
  new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));

let worst = { page: "", bytes: 0, files: 0 };
let missing = 0;

for (const page of PAGES) {
  const file = resolve(ROOT, page);
  if (!existsSync(file)) {
    console.log(`  skip  ${page} (not prerendered)`);
    missing++;
    continue;
  }
  const refs = scriptsIn(readFileSync(file, "utf8"));
  let bytes = 0;
  for (const ref of refs) {
    const onDisk = resolve(ROOT, ".next", ref.replace("/_next/", ""));
    if (existsSync(onDisk)) bytes += gzipSync(readFileSync(onDisk)).length;
  }
  console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} kB gzip  ${refs.size} files  ${page}`);
  if (bytes > worst.bytes) worst = { page, bytes, files: refs.size };
}

if (missing === PAGES.length) {
  console.log("\nNo public pages were prerendered — did `next build` run?");
  process.exit(1);
}

const kb = worst.bytes / 1024;
console.log(`\n  worst public route: ${kb.toFixed(1)} kB gzip (${worst.page})`);
console.log(`  budget:             ${LIMIT_KB} kB`);

if (kb > LIMIT_KB) {
  console.log(
    `\nOver budget. This is the enforcement that actually holds — a lint rule can be ` +
      `rationalised past, a failing build cannot. Check what reached a public route: ` +
      `Radix, the Solid auth library, image code and write-only schemas are all studio-only.`,
  );
  process.exit(1);
}
console.log("\nPublic bundle within budget.");

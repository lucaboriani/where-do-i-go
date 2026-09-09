#!/usr/bin/env tsx
/**
 * A gzip ceiling and a studio-dependency name scan, over the JavaScript a
 * PUBLIC page tells the browser to load. Derived from prerendered HTML, never
 * globbed; importable and pure. Run after `next build`.
 * ./notes.md#why-this-module-is-importable-and-pure
 */
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where `next build` puts the prerendered HTML. Route paths are computed
 *  relative to this, which is what makes the studio exclusion below exact. */
const APP_DIR = resolve(ROOT, ".next/server/app");

/* -------------------------------------------------------------- the ceiling */

/**
 * 190 kB, set 2026-09-03 against 176.3 kB measured. Framework cost may raise
 * it, with a breakdown; our own code never may - that is a boundary failure.
 * ./notes.md#the-gzip-ceiling-and-what-it-is-now-for
 */
export const LIMIT_KB = Number(process.env.PUBLIC_BUNDLE_LIMIT_KB ?? 190);

/* ------------------------------------------------------ the composition scan */

/** NAMES, NOT WEIGHT. Never the bare package name, >= 8 identifier chars, and
 *  must survive bundling: ./notes.md#why-markers-are-not-package-names */

/** RE-DERIVE WHEN A STUDIO DEPENDENCY IS ADDED, here and in eslint.config.mjs's
 *  public block. On neither list is invisible to every check in this repo. */
export const BANNED_DEPS: { name: string; markers: string[] }[] = [
  {
    // CLAUDE.md, Map: one instance, lazy-mounted on intersection. Lazy means it
    // must not be in a public page's initial chunks at all. At 252.8 kB gzip
    // bundled it is the one leak the ceiling would also catch; listed so the
    // scan does not depend on the ceiling.
    name: "maplibre-gl",
    markers: ["MapLibre", "maplibregl"],
  },
  {
    // RDF/JS term names, NOT `n3` — that hits React's minified DOM code. A
    // solid-client leak reports as both deps, accurately: ./notes.md#the-individual-markers-and-the-two-that-were-wrong
    name: "n3",
    markers: ["blankNode", "namedNode", "defaultGraph"],
  },
  { name: "@inrupt/solid-client", markers: ["SolidDataset"] },
  {
    // The pre-bundled build contains no `@inrupt` at all, so a specifier-based
    // marker misses it: ./notes.md#the-individual-markers-and-the-two-that-were-wrong
    name: "@inrupt/solid-client-authn-browser",
    markers: ["handleIncomingRedirect"],
  },
  // eslint.config.mjs: "Image-processing code is studio-only".
  { name: "exifreader", markers: ["ExifReader"] },
  // decisions.md §11: shadcn/Radix is studio-only.
  { name: "@radix-ui", markers: ["--radix-", "data-radix-"] },
  { name: "vaul", markers: ["data-vaul-"] },
  { name: "sonner", markers: ["data-sonner-"] },
  { name: "cmdk", markers: ["cmdk-item", "cmdk-input", "cmdk-list"] },
  {
    // Public API names, which a minifier preserves as object keys. The tempting
    // markers are in react-dom and Next's own runtime: ./notes.md#the-individual-markers-and-the-two-that-were-wrong
    name: "next-themes",
    markers: ["disableTransitionOnChange", "enableColorScheme", "resolvedTheme"],
  },
];

export type Chunk = { name: string; source: string };
export type Finding = { dep: string; chunk: string; marker: string };

/** One finding per (dep, chunk) hit, naming the marker that fired, so a report
 *  can be checked rather than believed. THROWS ON A SCAN OF NOTHING: `[]`
 *  cannot mean both "clean" and "I did not look".
 *  ./notes.md#the-three-guards-that-must-fail-rather-than-pass */
export function findStudioDeps(chunks: Chunk[]): Finding[] {
  if (chunks.length === 0) {
    throw new Error(
      "findStudioDeps was given no chunks. A scan of nothing is not a clean bundle — " +
        "the chunk extraction in scripts/check-public-bundle.ts found no scripts to read.",
    );
  }
  if (chunks.every((chunk) => chunk.source.length === 0)) {
    throw new Error(
      `findStudioDeps was given ${chunks.length} chunk(s) and every one is empty. ` +
        "A scan of nothing is not a clean bundle — the chunk files named by the prerendered " +
        "HTML could not be read from disk.",
    );
  }

  const findings: Finding[] = [];
  for (const chunk of chunks) {
    for (const dep of BANNED_DEPS) {
      const marker = dep.markers.find((candidate) => chunk.source.includes(candidate));
      // One finding per (dep, chunk): attributing a hit to the wrong chunk
      // sends whoever reads CI to the wrong file.
      if (marker !== undefined) findings.push({ dep: dep.name, chunk: chunk.name, marker });
    }
  }
  return findings;
}

/* ----------------------------------------------------------------- the CLI */

/** A page that was found and deliberately not measured, and the reason. */
type Exclusion = { page: string; why: string };

/**
 * Every prerendered public page, and separately everything found and left out,
 * with the reason. ONLY THE STUDIO ROUTE IS EXCLUDED, matched on the route path
 * and ANCHORED - an unanchored absolute-path test silently dropped a trip
 * called "Studio Ghibli Museum". ./notes.md#which-pages-count-as-public
 */
function publicPages(): { pages: string[]; excluded: Exclusion[] } {
  const pages: string[] = [];
  const excluded: Exclusion[] = [];

  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!e.name.endsWith(".html")) continue;

      // Repo-relative for reporting; route-relative for deciding. Computing the
      // route BEFORE testing it is what keeps the exclusion off the rest of the
      // absolute path.
      const page = full.slice(ROOT.length + 1);
      const route = relative(APP_DIR, full).split(sep).join("/");

      if (route === "studio.html" || route.startsWith("studio/")) {
        excluded.push({
          page,
          why:
            "the studio route — allowed to be heavy, and kept out so its weight cannot hide " +
            "a public regression",
        });
        continue;
      }
      if (statSync(full).size === 0) {
        excluded.push({
          page,
          why: "zero bytes on disk — it names no scripts, so there is nothing to measure",
        });
        continue;
      }
      pages.push(page);
    }
  };

  walk(APP_DIR);
  return { pages, excluded };
}

const scriptsIn = (html: string) =>
  new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));

/**
 * What one pass over the pages learned, and — separately — what it could not
 * learn. Both halves are needed: a run that measured less than it reported
 * must fail, and `reportMeasurementGaps` is the half that says so.
 */
export type Measurement = {
  worst: { page: string; bytes: number };
  chunks: Map<string, string>;
  unresolved: { page: string; ref: string }[];
  noScripts: string[];
};

/**
 * Weigh every page and keep every chunk, printing the ledger line by line.
 *
 * `root` is a parameter rather than this module's `ROOT` so that the step can
 * be exercised against a synthesised build; `main` passes `ROOT`.
 */
export function measurePages(pages: string[], root: string): Measurement {
  let worst = { page: "", bytes: 0 };
  /** Deduped across pages: the framework chunks are shared by all of them. */
  const chunks = new Map<string, string>();
  /** Script references the HTML names and `.next` does not have. */
  const unresolved: { page: string; ref: string }[] = [];
  /** Pages the extraction matched no script reference at all on. */
  const noScripts: string[] = [];

  for (const page of pages) {
    const refs = scriptsIn(readFileSync(resolve(root, page), "utf8"));
    if (refs.size === 0) noScripts.push(page);
    let bytes = 0;
    for (const ref of refs) {
      const onDisk = resolve(root, ".next", ref.replace("/_next/", ""));
      if (!existsSync(onDisk)) {
        unresolved.push({ page, ref });
        continue;
      }
      const raw = readFileSync(onDisk);
      bytes += gzipSync(raw).length;
      const name = ref.replace("/_next/", "");
      if (!chunks.has(name)) chunks.set(name, raw.toString("utf8"));
    }
    console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} kB gzip  ${refs.size} files  ${page}`);
    if (bytes > worst.bytes) worst = { page, bytes };
  }

  return { worst, chunks, unresolved, noScripts };
}

/**
 * Everything this run measured less of than it printed, in two parts: a gap
 * that fails at the end, and measuring nothing at all, which is fatal before
 * the size report is reached.
 */
export function reportMeasurementGaps(measured: Measurement): {
  failed: boolean;
  measuredNothing: boolean;
} {
  let failed = false;

  // A reference that does not resolve is FATAL, not skippable — a skipped chunk
  // leaves the byte sum and the scanned set while the ledger still counts it:
  // ./notes.md#the-three-guards-that-must-fail-rather-than-pass
  if (measured.unresolved.length > 0) {
    console.log(
      `\n${measured.unresolved.length} script reference(s) named by a prerendered page do not ` +
        `exist in .next. A chunk that cannot be read is a chunk that was not weighed and not ` +
        `scanned, so this run measured less than it reported:`,
    );
    for (const u of measured.unresolved) console.log(`  ${u.ref} — referenced by ${u.page}`);
    failed = true;
  }

  // A page the extraction matched NOTHING on is FATAL. This is the gap between
  // its two neighbouring guards, and the extraction is the part of this file
  // most likely to stop working in silence:
  // ./notes.md#the-three-guards-that-must-fail-rather-than-pass
  if (measured.noScripts.length > 0) {
    console.log(
      `\n${measured.noScripts.length} prerendered public page(s) named no script that this ` +
        `check could extract. Zero-byte HTML is excluded upstream, so these pages have bytes — ` +
        `and a page yielding no references was neither weighed nor scanned, whatever its ledger ` +
        `line says. Fix the extraction in scripts/check-public-bundle.ts:`,
    );
    for (const p of measured.noScripts) console.log(`  ${p} — no script references extracted`);
    failed = true;
  }

  // A budget that measures nothing must fail, not pass. If Next changes how it
  // emits script references, the extraction silently matches zero files and
  // every page reports 0.0 kB — which would print "within budget" and exit 0.
  if (measured.worst.bytes === 0) {
    console.log(
      "\nMeasured 0 bytes across every public page. That is not a pass: the script " +
        "extraction found nothing, so this check is not enforcing anything. Fix the " +
        "extraction in scripts/check-public-bundle.ts.",
    );
    return { failed, measuredNothing: true };
  }

  return { failed, measuredNothing: false };
}

/** The size half of the report, and the ceiling it will be judged against.
 *  Printed before the scan so both numbers are visible when either fails. */
export function reportSize(worst: { page: string; bytes: number }): number {
  const kb = worst.bytes / 1024;
  console.log(`\n  size  worst public route: ${kb.toFixed(1)} kB gzip (${worst.page})`);
  console.log(`        budget:              ${LIMIT_KB} kB`);
  return kb;
}

/** The composition scan, with one ledger line per banned dep — including the
 *  ones that did not fire, so the report shows what was looked for. */
export function reportComposition(chunks: Map<string, string>, pageCount: number): Finding[] {
  const findings = findStudioDeps([...chunks].map(([name, source]) => ({ name, source })));
  console.log(`\n  deps  scanned ${chunks.size} chunks across ${pageCount} pages`);
  for (const dep of BANNED_DEPS) {
    const hit = findings.find((f) => f.dep === dep.name);
    console.log(
      `        ${dep.name.padEnd(36)}${hit ? `FOUND in ${hit.chunk} (${hit.marker})` : "absent"}`,
    );
  }
  return findings;
}

/** The verdict: a leak, weight, or both. Whichever fired is explained rather
 *  than merely counted, and the answer is what the CLI exits on. */
export function reportViolations(findings: Finding[], kb: number): boolean {
  let failed = false;

  if (findings.length > 0) {
    console.log(
      `\nA studio-only dependency reached a public route. This is the public/studio ` +
        `boundary failing (CLAUDE.md, invariant 3), not a size problem — raising the ` +
        `ceiling will not fix it, and neither will anything but removing the import:`,
    );
    for (const f of findings) {
      console.log(`  ${f.dep} in ${f.chunk} — matched ${JSON.stringify(f.marker)}`);
    }
    failed = true;
  }

  if (kb > LIMIT_KB) {
    console.log(
      `\nOver budget. Break down the chunks before touching the ceiling: framework growth ` +
        `may raise it, our own code may not. Check what reached a public route — Radix, the ` +
        `Solid auth library, image code and write-only schemas are all studio-only.`,
    );
    failed = true;
  }

  return failed;
}

/** The CLI: discover, weigh, scan, judge. 94 lines and an `eslint-disable`
 *  until 2026-09-09, now 20 and the last max-lines exemption in the repository gone —
 *  lint reported the directive unused before it was deleted.
 *  ./notes.md#the-steps-main-prints */
function main(): void {
  if (!existsSync(APP_DIR)) {
    console.log(`\nNo public pages were prerendered — did \`next build\` run? (no ${APP_DIR})`);
    process.exit(1);
  }

  const { pages: PAGES, excluded } = publicPages();

  // Exclusions go to stderr, not stdout. stdout is the ledger of what WAS
  // measured — one line per page, and the CLI test reads it that way — so a
  // page named there has been weighed and scanned. Naming a skipped page in the
  // same stream would make the two indistinguishable. stderr keeps every
  // exclusion visible and attributable without that ambiguity, which is the
  // point: the old filter excluded pages and said nothing at all.
  for (const x of excluded) console.error(`  skip  ${x.page} — ${x.why}`);

  if (PAGES.length === 0) {
    console.log("\nNo public pages were prerendered — did `next build` run?");
    process.exit(1);
  }

  const measured = measurePages(PAGES, ROOT);
  const gaps = reportMeasurementGaps(measured);
  if (gaps.measuredNothing) process.exit(1);

  const kb = reportSize(measured.worst);
  const findings = reportComposition(measured.chunks, PAGES.length);
  // Both are reported before either exits: `||` here would short-circuit the
  // second paragraph away whenever the first fired.
  const violations = reportViolations(findings, kb);

  if (gaps.failed || violations) process.exit(1);
  console.log("\nPublic bundle within budget, and free of studio-only dependencies.");
}

/**
 * The two spellings of "this file" that have to meet: realpath what exists,
 * keep what does not, and drop a script extension.
 */
function canonicalScript(path: string): string {
  const abs = resolve(path);
  let dir = dirname(abs);
  try {
    dir = realpathSync(dir);
  } catch {
    // A directory that does not exist cannot be the one this module was loaded
    // from. Leave it unresolved and let the comparison below fail.
  }
  return join(dir, basename(abs)).replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

/**
 * Run the CLI only when this file is what was executed. NOT
 * `import.meta.main`, which tsx leaves undefined for a .ts entry, and a guard
 * on an undefined value never fires. argv[1], canonicalised on both sides.
 * ./notes.md#why-the-cli-guard-is-argv1-and-not-importmetamain
 */
const entry = process.argv[1];
if (entry !== undefined) {
  const self = canonicalScript(fileURLToPath(import.meta.url));
  const invoked = canonicalScript(entry);
  if (invoked === self) {
    main();
  } else if (basename(invoked) === basename(self)) {
    console.error(
      `check-public-bundle was invoked as ${entry}\n` +
        `  which canonicalises to  ${invoked}\n` +
        `  but this module is      ${self}\n` +
        `Refusing to exit 0 without running: a public-bundle check that silently does nothing ` +
        `looks exactly like a public bundle with nothing wrong with it.`,
    );
    process.exit(1);
  }
}

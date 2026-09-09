#!/usr/bin/env tsx
/**
 * Two guardrails on what a PUBLIC page ships:
 *
 *   1. a gzip ceiling on the JavaScript the page tells the browser to load;
 *   2. a scan of that same JavaScript for studio-only dependencies, by name.
 *
 * `size-limit` globs files; it cannot answer "what does /trips/[slug] send to a
 * browser". Globbing `.next/static/chunks/**` measures the studio's Radix and
 * shadcn weight too, so a public regression could hide inside the total and a
 * studio addition could fail a budget it has nothing to do with.
 *
 * Both checks therefore derive their file list from the prerendered HTML of
 * each public route — the scripts the browser is actually told to load. Chunk
 * names are content-hashed, so deriving beats hardcoding.
 *
 * Run after `next build`.
 *
 * The module is importable and pure: nothing below runs, and no build output is
 * read, unless this file is executed directly. `test/public-bundle.test.ts`
 * enforces that by copying the file to a directory with no `.next` and
 * importing it in a child process.
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
 * The gzip ceiling, and what it is now for.
 *
 * An earlier revision of this file said: "set it from the first real build,
 * then ONLY EVER LOWER IT. Raising this number is how a budget stops being a
 * budget." That was true while the number was the *only* enforcement. It is
 * not any more — `findStudioDeps` below asserts the invariant directly — so the
 * rule has been replaced rather than quietly broken.
 *
 * 190 kB, set 2026-09-03 against a measured 176.3 kB worst public route. Every
 * one of the eight chunks that route loads was broken down and scanned: it is
 * React 19 and the Next 16 runtime end to end, and this project's own code is a
 * rounding error inside it. The previous ceiling of 180 left 3.7 kB, which is
 * less than the framework has already moved on its own — the streaming-routes
 * change cost +3.0 kB with no code of ours involved. A budget that fails on
 * Next's growth rather than on ours teaches people to raise it, which is the
 * actual way a budget dies.
 *
 * WHAT MAY AND MAY NOT MOVE THIS NUMBER. Framework cost, upward, and only with
 * the per-chunk breakdown to prove that is what it is. Never our own code:
 * anything of ours arriving on a public route is a boundary failure, and the
 * fix is the import, not the ceiling. Lowering it is always allowed.
 *
 * WHY A NAME SCAN AS WELL. 190 kB against 176.3 kB leaves 13.7 kB of headroom,
 * and what fits inside it is not what you would guess. Measured 2026-09-04,
 * each library bundled and minified by esbuild on its own and gzipped — which
 * is what a bundler would actually add to a chunk:
 *
 *     sonner        9.6 kB   fits inside the headroom; the ceiling never sees it
 *     cmdk         17.1 kB   trips the ceiling, by 3.4 kB
 *     vaul         21.4 kB   trips the ceiling
 *     maplibre-gl 252.8 kB   entry plus its shared chunk; unmissable
 *
 * An earlier revision of this comment had these as 28.9, 11.0, 33.9 and 777.9
 * and concluded "only the last of those would trip a size budget". Every figure
 * was the gzip sum of every `.js`/`.mjs` in the package's `dist/` — the ESM
 * build plus the duplicate CJS build, plus dev builds and web workers nothing
 * imports — so it measured the tarball, not the leak. The ranking it produced
 * was inverted: `sonner`, the one it called the only dangerous one, is in fact
 * the one that slips through, and the two it called safe are the two that fail.
 *
 * The conclusion survives its arithmetic. A ceiling catches weight, so it
 * misses the small leak entirely; a name scan catches either at any size, but
 * says nothing about the framework getting fatter. Neither one subsumes the
 * other.
 */
export const LIMIT_KB = Number(process.env.PUBLIC_BUNDLE_LIMIT_KB ?? 190);

/* ------------------------------------------------------ the composition scan */

/**
 * Studio-only dependencies, and the strings that prove one is present in a
 * chunk.
 *
 * WHY NAMES AND NOT WEIGHT. `CLAUDE.md`'s public/studio boundary is a rule
 * about *what* may appear on a public route, and `eslint.config.mjs` enforces
 * it at the import. A lint rule can be rationalised past; this cannot, and
 * unlike the ceiling it does not care how small the leak is.
 *
 * MARKERS ARE NOT PACKAGE NAMES. Grepping a real public chunk for "n3" hits,
 * and the hit is React's minified DOM code — `n2={},n3={}` … `n3=document
 * .createElement("div").style`. A guardrail that cries wolf on the framework
 * gets switched off by the first person it annoys. So a marker must be a string
 * a minifier cannot produce by accident:
 *
 *   - identifier-shaped markers are >= 8 characters.
 *   - markers containing a character that cannot occur in an identifier
 *     (`-`, `/`, `.`) can never be synthesised whole by mangling, so 6 is
 *     enough.
 *   - the bare, all-lowercase package name is never a marker. It is both the
 *     most collision-prone choice and usually the one that does not even
 *     match: "exifreader" appears nowhere in `exif-reader.js`, only
 *     "ExifReader" does.
 *
 * WHY 8, MEASURED. Over the 9 files of `.next/static/chunks/*.js` in this
 * project's own build (599,640 bytes; 108,076 identifier tokens, 4,985
 * distinct), distinct tokens by length run 54, 1614, 170, 246, 260, 267, 267,
 * 272, 238, 179 … for lengths 1 to 10, and there are 2,107 distinct tokens of
 * 8 characters or more, the longest 63.
 *
 * The number that proves mangling is the first one: 54 distinct one-character
 * tokens is the base-54 identifier alphabet — `$`, `_`, and the 52 letters —
 * exhausted, every one of them in use, 49,320 times between them. A mangler
 * allocates shortest-first and only spills into length n once length n-1 runs
 * out, so reaching 8 characters would take on the order of 54^7 live names in
 * one scope. It never happens. Every one of those 2,107 long tokens is a name
 * the toolchain had to PRESERVE, not one it invented: `$$typeof`, `Suspense`,
 * `NODE_ENV`, `onlyHashChange`, `scrollBehavior`, `TURBOPACK`.
 *
 * That is the real justification, and it is not the one this comment used to
 * give. It claimed "7483 mangled identifiers of 1 character, 1839 of 2, 14 of
 * 3, 546 of 4, and nothing mangled longer — the only 7+ character tokens are
 * DOM names", and set the floor at "double the longest observed". Neither half
 * holds: the 7- and 8-character buckets have 267 and 272 distinct tokens in
 * them, and they are Next's own preserved identifiers rather than DOM names.
 * The floor is right for a different reason — a mangler cannot synthesise a
 * long name, only preserve one.
 *
 * Which is also where the residual risk lives, and length does not fix it: a
 * preserved name can be an ordinary word. `Fragment`, `Provider`, `Response`
 * and `Infinity` are all in these chunks at 8 characters or more. A marker has
 * to be a name only the banned library would preserve, not merely a long one.
 *
 * MARKERS MUST SURVIVE BUNDLING. Every `@radix-ui/...` occurrence in the
 * primitives is an import specifier that a bundler resolves away, so the scope
 * name would catch nothing in a real chunk. The runtime literals do.
 *
 * Every marker here was verified in both directions against the real installed
 * builds: present in each artifact the library actually ships, and absent from
 * React, React DOM, the scheduler and both of Next's pre-minified runtimes.
 * `test/public-bundle.test.ts` re-checks that on every run against the files in
 * `node_modules`, and runs each artifact through esbuild first, so a marker
 * that only survives in a comment or an import specifier fails there rather
 * than sitting here matching nothing.
 *
 * RE-DERIVE THIS WHEN A STUDIO DEPENDENCY IS ADDED — here and in
 * `eslint.config.mjs`'s public block. A dependency on neither list is invisible
 * to every check in this repository.
 */
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
    // The RDF stack. lib/pod/read.ts is unauthenticated and shared, and parses
    // Turtle on the server; n3 in a client chunk means the read path was pulled
    // into the browser. Also the dependency whose name produces the false
    // positive above, which is why the markers are RDF/JS term names.
    //
    // These three markers are also present in @inrupt/solid-client, which
    // genuinely depends on n3 (^1.17.2, its own package.json), so a
    // solid-client leak reports as BOTH deps. That is accurate noise, not a
    // false positive — do not go looking for a direct `n3` import that is not
    // there.
    name: "n3",
    markers: ["blankNode", "namedNode", "defaultGraph"],
  },
  { name: "@inrupt/solid-client", markers: ["SolidDataset"] },
  {
    // eslint.config.mjs: "The public path is unauthenticated by design and uses
    // plain fetch." Note the pre-bundled build contains no "@inrupt" at all, so
    // a marker leaning on the package specifier would miss it.
    //
    // "solid-client-authn" used to be here too and was removed: it violated
    // this file's own MARKERS MUST SURVIVE BUNDLING rule. In `dist/index.mjs`
    // its only occurrence is inside `export … from
    // '@inrupt/solid-client-authn-core'`, which a bundler resolves away; in the
    // pre-bundled build it survives only in the trailing
    // `//# sourceMappingURL=` comment, which a minifier drops. Measured
    // 2026-09-04: gone from both after esbuild. `handleIncomingRedirect`
    // survives both, so the dependency stays covered.
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
    // CLAUDE.md, Styling: the theme is fixed dark, the palette lives at :root
    // rather than under a `.dark` class, and there is no toggle. next-themes is
    // on disk because shadcn's sonner component imports `useTheme` from it, so
    // it is importable from anywhere; on a public route it is either dead
    // weight or the start of a toggle the design has already declined.
    // eslint.config.mjs bans it from the public block, and this is the other
    // half of that pair.
    //
    // The markers are next-themes' own public API names, which a minifier
    // preserves because they are object and destructuring keys. Verified
    // 2026-09-04 in both directions: present in dist/index.mjs and dist/index.js
    // and still present after esbuild bundles and minifies each of them; absent
    // from React, React DOM, the scheduler and both Next runtimes. The
    // tempting markers are the ones that fail that second half —
    // `suppressHydrationWarning` is in react-dom, and
    // "(prefers-color-scheme: dark)" is in Next's own runtime and devtools.
    name: "next-themes",
    markers: ["disableTransitionOnChange", "enableColorScheme", "resolvedTheme"],
  },
];

export type Chunk = { name: string; source: string };
export type Finding = { dep: string; chunk: string; marker: string };

/**
 * Scan chunk sources for studio-only dependencies. Pure; one finding per
 * (dep, chunk) hit, naming the marker that fired so a report can be checked
 * rather than believed.
 *
 * THROWS ON A SCAN OF NOTHING, deliberately. With `Finding[]` as the return
 * type, "clean" and "I did not look" are the same value — `[]` — and the
 * failure this file already guards against downstream ("a budget that measures
 * nothing must fail, not pass") applies here in a nastier form: if Next changes
 * how it emits script references, the extraction matches nothing, every chunk
 * arrives empty, and a scan of zero bytes reports the public bundle clean. An
 * exception is the only answer that cannot be mistaken for a pass.
 */
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
 * Every concrete prerendered public page, and — separately — everything that
 * was found and left out, with the reason.
 *
 * ONLY THE STUDIO ROUTE IS EXCLUDED, and only because it is allowed to be heavy
 * — keeping it out is what stops its weight hiding a public regression. The
 * decision is made on the path RELATIVE TO `.next/server/app`, i.e. the route,
 * and it is an exact match on `studio.html` or a `studio/` prefix.
 *
 * That is the whole of a fix. The test was `!/studio/.test(f)` against the
 * ABSOLUTE path, unanchored, and it dropped two kinds of page silently. A trip
 * titled "Studio Ghibli Museum" builds to `trips/studio-ghibli-museum.html`
 * (slugs come from titles — docs/data-model.md), and it vanished from both the
 * ceiling and the scan. So did every page in the repository, for anyone whose
 * checkout sits under a directory named `studio`. Deleting the filter is not
 * the fix either: then the studio's own weight and its Radix get measured as
 * public.
 *
 * Route-group directories are not part of this: Next strips `(studio)` from the
 * emitted HTML path, so the studio page really is at `studio.html`.
 *
 * `_not-found` and `_global-error` used to be excluded too, and should not have
 * been: `app/not-found.tsx` is a page real visitors hit, it renders its own
 * `<html>` because there is no shared root layout, and a read-only review found
 * it was fenced by neither this budget nor the import boundary. Measured when
 * they were added back — `_not-found` 173.3 kB, `_global-error` 169.7 kB
 * against a 176.3 kB worst case — so including them changed the reported worst
 * route not at all. They are public in the bundle sense even though they are
 * not routes anyone links to.
 *
 * THE ZERO-BYTE FILTER IS KEPT, and it is honest about doing nothing today.
 * A previous comment called `[slug].html` "a zero-byte Partial Prerendering
 * shell"; it is 1,617 bytes in the 2026-09-03 build, it is measured, and it
 * reports the same 176.3 kB as the concrete `2026-japan.html` — so the filter
 * fires on nothing here. It stays because an HTML file with no bytes names no
 * scripts, and a 0.0 kB page in the report is noise that reads like a finding.
 * What has changed is that it can no longer be a silent third exclusion: like
 * the studio one, it is reported.
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

  // A reference that does not resolve is fatal. This used to be
  // `if (!existsSync(onDisk)) continue;` — the chunk left the byte sum AND the
  // scanned set, while the line above still printed `refs.size`, so
  // "93.3 kB gzip 2 files" described one file and the composition scan never
  // opened the other. If the one it skipped is the one carrying maplibre, the
  // run prints "absent" for every banned dep and exits 0. Same rule as the
  // "measured nothing" guard below, applied per chunk.
  if (measured.unresolved.length > 0) {
    console.log(
      `\n${measured.unresolved.length} script reference(s) named by a prerendered page do not ` +
        `exist in .next. A chunk that cannot be read is a chunk that was not weighed and not ` +
        `scanned, so this run measured less than it reported:`,
    );
    for (const u of measured.unresolved) console.log(`  ${u.ref} — referenced by ${u.page}`);
    failed = true;
  }

  // A page the extraction matched NOTHING on is fatal, for the same reason the
  // guard above it and the guard below it are. `refs.size === 0` means no chunk
  // of that page entered the byte sum and none entered the scanned set, so the
  // page was neither weighed nor scanned — while its ledger line printed anyway,
  // as "0.0 kB gzip  0 files", which reads like a measurement rather than like a
  // page nothing was learned about.
  //
  // The extraction is the part of this file most likely to stop working in
  // silence. It is one regex against HTML that Next emits, and Next emits three
  // route shapes in this project — static, dynamic, and the PPR shell. Change
  // the attribute, the extension or the quoting on ONE of them and that route's
  // pages measure zero while every other page keeps the run green. Neither
  // neighbouring guard covers that: `unresolved` needs a reference to have been
  // extracted before it can be missing, and `worst.bytes === 0` needs EVERY page
  // to measure nothing. This is the gap between them, and it is the F5 reasoning
  // — "the same rule as the 'measured nothing' guard, applied per chunk" —
  // carried the one level further it stopped short of.
  //
  // It is a failure and not an oddity because `publicPages()` has already
  // excluded zero-byte HTML, with its reason, before that loop runs. A page that
  // gets that far has bytes. A real public page with bytes and no script
  // reference in it is this check having lost sight of the build, not a page
  // that happens to ship no JavaScript: every App Router page here loads the
  // framework chunks. Reporting it and passing is the one answer that cannot be
  // right.
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
 *  until 2026-09-09, now 20 and the last suppression in the repository gone —
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
 * Run the CLI only when this file is what was executed.
 *
 * `import.meta.main` is not the answer, and the reason is not the one this
 * comment used to give. It said the property is "not available across the Node
 * versions this repo supports". It is: measured 2026-09-04 on Node 22.23.2,
 * `node script.mjs` reports `import.meta.main === true`, and `engines` is
 * `^22.22.2`, so it exists on every supported runtime. The real reason is that
 * every entry point here is TypeScript loaded through `tsx`, and tsx's
 * TypeScript transform does not set it — the same measurement gives
 * `typeof import.meta.main === "undefined"` for `node --import tsx script.ts`
 * while giving `true` for `node --import tsx script.mjs`. A guard on an
 * undefined value never fires, which is exactly the failure this guard exists
 * to avoid.
 *
 * So `process.argv[1]`, canonicalised on BOTH sides:
 *
 *   - realpath, because Node has already realpath'd `import.meta.url` while
 *     `argv[1]` keeps whatever the caller typed. Measured: invoked through a
 *     symlinked checkout, `argv[1]` is `/tmp/link/scripts/x.ts` and
 *     `import.meta.url` is `/private/tmp/repo/scripts/x.ts`. The old comparison
 *     called those different and the CLI exited 0 in silence — a `size:public`
 *     step that checked nothing and reported success.
 *   - extension-stripped, because `tsx scripts/check-public-bundle` resolves
 *     the `.ts` for the loader and leaves `argv[1]` extensionless. Measured
 *     too, and the same silent exit 0.
 *
 * Under `node --import tsx -e "await import(...)"` — how the purity test loads
 * this file — `argv[1]` is `undefined` (measured), so nothing runs. That is
 * deliberate and must stay: importing this module executes nothing.
 *
 * A mismatch that still looks like an ATTEMPT to run this file — the same
 * filename at a path that does not canonicalise to this one — is loud and
 * non-zero. Exiting 0 having done nothing is the one answer a guard must never
 * give, because it is indistinguishable from a clean build. The comparison is
 * narrowed to the filename so that an ordinary `import` from some other module
 * (vitest's worker, for instance) stays silent, as it must.
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

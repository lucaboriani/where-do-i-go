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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
 * The pair is stronger than a tight number alone. A ceiling catches weight and
 * therefore misses `cmdk` (11.0 kB gzip) entirely and `sonner` (28.9) if the
 * headroom ever drifts; a name scan catches either at any size, but says
 * nothing about the framework getting fatter. Neither one subsumes the other.
 */
const LIMIT_KB = Number(process.env.PUBLIC_BUNDLE_LIMIT_KB ?? 190);

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
 *   - identifier-shaped markers are >= 8 characters. Measured across this
 *     project's own chunks: 7483 mangled identifiers of 1 character, 1839 of 2,
 *     14 of 3, 546 of 4, and nothing mangled longer — the only 7+ character
 *     tokens are DOM names the minifier had to preserve. 8 is double the
 *     longest observed, with room for the minifier to get greedier.
 *   - markers containing a character that cannot occur in an identifier
 *     (`-`, `/`, `.`) can never be synthesised whole by mangling, so 6 is
 *     enough.
 *   - the bare, all-lowercase package name is never a marker. It is both the
 *     most collision-prone choice and usually the one that does not even
 *     match: "exifreader" appears nowhere in `exif-reader.js`, only
 *     "ExifReader" does.
 *
 * MARKERS MUST SURVIVE BUNDLING. Every `@radix-ui/...` occurrence in the
 * primitives is an import specifier that a bundler resolves away, so the scope
 * name would catch nothing in a real chunk. The runtime literals do.
 *
 * Every marker here was verified in both directions against the real installed
 * builds: present in each artifact the library actually ships, and absent from
 * React, React DOM, the scheduler and both of Next's pre-minified runtimes.
 * `test/public-bundle.test.ts` re-checks that on every run against the files in
 * `node_modules`, so a library upgrade that changes its output turns the suite
 * red instead of leaving this list silently matching nothing.
 *
 * RE-DERIVE THIS WHEN A STUDIO DEPENDENCY IS ADDED — here and in
 * `eslint.config.mjs`'s public block. A dependency on neither list is invisible
 * to every check in this repository.
 */
export const BANNED_DEPS: { name: string; markers: string[] }[] = [
  {
    // CLAUDE.md, Map: one instance, lazy-mounted on intersection. Lazy means it
    // must not be in a public page's initial chunks at all. At 777.9 kB gzip it
    // is the one leak the ceiling would also catch; listed so the scan does not
    // depend on the ceiling.
    name: "maplibre-gl",
    markers: ["MapLibre", "maplibregl"],
  },
  {
    // The RDF stack. lib/pod/read.ts is unauthenticated and shared, and parses
    // Turtle on the server; n3 in a client chunk means the read path was pulled
    // into the browser. Also the dependency whose name produces the false
    // positive above, which is why the markers are RDF/JS term names.
    name: "n3",
    markers: ["blankNode", "namedNode", "defaultGraph"],
  },
  { name: "@inrupt/solid-client", markers: ["SolidDataset"] },
  {
    // eslint.config.mjs: "The public path is unauthenticated by design and uses
    // plain fetch." Note the pre-bundled build contains no "@inrupt" at all, so
    // a marker leaning on the package specifier would miss it.
    name: "@inrupt/solid-client-authn-browser",
    markers: ["solid-client-authn", "handleIncomingRedirect"],
  },
  // eslint.config.mjs: "Image-processing code is studio-only".
  { name: "exifreader", markers: ["ExifReader"] },
  // decisions.md §11: shadcn/Radix is studio-only.
  { name: "@radix-ui", markers: ["--radix-", "data-radix-"] },
  { name: "vaul", markers: ["data-vaul-"] },
  { name: "sonner", markers: ["data-sonner-"] },
  { name: "cmdk", markers: ["cmdk-item", "cmdk-input", "cmdk-list"] },
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

/**
 * Every concrete prerendered public page. Discovered rather than listed:
 * `[slug].html` is a zero-byte Partial Prerendering shell, so the file that
 * matters is the one built for a real param (`2026-japan.html`).
 *
 * ONLY the studio is excluded, and only because it is allowed to be heavy —
 * keeping it out is what stops its weight hiding a public regression.
 *
 * `_not-found` and `_global-error` used to be excluded too, and should not have
 * been: `app/not-found.tsx` is a page real visitors hit, it renders its own
 * `<html>` because there is no shared root layout, and a read-only review found
 * it was fenced by neither this budget nor the import boundary. Measured when
 * they were added back — `_not-found` 173.3 kB, `_global-error` 169.7 kB
 * against a 176.3 kB worst case — so including them changed the reported worst
 * route not at all. They are public in the bundle sense even though they are
 * not routes anyone links to.
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
  return out.filter((f) => !/studio/.test(f)).map((f) => f.slice(ROOT.length + 1));
}

const scriptsIn = (html: string) =>
  new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]));

function main(): void {
  const PAGES = publicPages();

  let worst = { page: "", bytes: 0, files: 0 };
  let missing = 0;
  /** Deduped across pages: the framework chunks are shared by all of them. */
  const chunks = new Map<string, string>();

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
      if (!existsSync(onDisk)) continue;
      const raw = readFileSync(onDisk);
      bytes += gzipSync(raw).length;
      const name = ref.replace("/_next/", "");
      if (!chunks.has(name)) chunks.set(name, raw.toString("utf8"));
    }
    console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} kB gzip  ${refs.size} files  ${page}`);
    if (bytes > worst.bytes) worst = { page, bytes, files: refs.size };
  }

  if (missing === PAGES.length || PAGES.length === 0) {
    console.log("\nNo public pages were prerendered — did `next build` run?");
    process.exit(1);
  }

  // A budget that measures nothing must fail, not pass. If Next changes how it
  // emits script references, the extraction silently matches zero files and
  // every page reports 0.0 kB — which would print "within budget" and exit 0.
  if (worst.bytes === 0) {
    console.log(
      "\nMeasured 0 bytes across every public page. That is not a pass: the script " +
        "extraction found nothing, so this check is not enforcing anything. Fix the " +
        "extraction in scripts/check-public-bundle.ts.",
    );
    process.exit(1);
  }

  const kb = worst.bytes / 1024;
  console.log(`\n  size  worst public route: ${kb.toFixed(1)} kB gzip (${worst.page})`);
  console.log(`        budget:              ${LIMIT_KB} kB`);

  // The composition scan. Deliberately after the size report so both numbers
  // are visible even when one of them fails.
  const findings = findStudioDeps(
    [...chunks].map(([name, source]) => ({ name, source })),
  );
  console.log(`\n  deps  scanned ${chunks.size} chunks across ${PAGES.length - missing} pages`);
  for (const dep of BANNED_DEPS) {
    const hit = findings.find((f) => f.dep === dep.name);
    console.log(
      `        ${dep.name.padEnd(36)}${hit ? `FOUND in ${hit.chunk} (${hit.marker})` : "absent"}`,
    );
  }

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

  if (failed) process.exit(1);
  console.log("\nPublic bundle within budget, and free of studio-only dependencies.");
}

/**
 * Run the CLI only when executed directly.
 *
 * `process.argv[1]` is compared rather than using `import.meta.main`, which is
 * not available across the Node versions this repo supports. Under `node
 * --import tsx -e "await import(...)"` — how the purity test loads this file —
 * `argv[1]` is undefined, so nothing runs.
 */
const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  main();
}

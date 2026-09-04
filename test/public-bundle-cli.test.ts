import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";

/**
 * `npm run size:public`, run as a command.
 *
 * `test/public-bundle.test.ts` tests `findStudioDeps` — the pure half — very
 * thoroughly. The other half of the same script had no test at all: `main`,
 * `publicPages`, `scriptsIn`, the ceiling comparison, the exit code, and the
 * guard that decides whether the CLI runs when it is invoked. A read-only
 * review applied six independent sabotages to that half and the whole suite
 * stayed green on every one:
 *
 *   M1  the entry guard can never fire (a permanent, silent no-op)
 *   M2  over-budget and leak no longer exit non-zero
 *   M3  the ceiling raised to 100000 kB
 *   M4  script extraction drops every `href=` preload
 *   M5  the "measured 0 bytes must fail" guard removed
 *   M6  the studio-page exclusion removed entirely
 *
 * `npm test` and the CI `size:public` step would both have stayed green with
 * the check effectively switched off. Weight and composition are only enforced
 * if the *command* enforces them, so this file runs the command.
 *
 * HOW. Each case synthesises a `.next` in a temp directory — a copy of the
 * script, the chunk files, and the prerendered HTML that names them — and
 * spawns the script against it. `next build` is not an option: it reads the
 * Pod, so it needs a Community Solid Server running, and a build artifact is
 * not a fixture anyway. The chunk *bytes* are real files out of node_modules,
 * for the same reason the sibling file uses them: an invented leak only proves
 * that a marker matches something invented.
 *
 * Every assertion checks the exit code AND the output. This repository has
 * already shipped a zero-byte 404 behind an asserted status, and a check that
 * exits 1 while printing "No public pages were prerendered" is not the same
 * check as one that exits 1 naming the dependency that leaked.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/check-public-bundle.ts";

/**
 * The ceiling `scripts/check-public-bundle.ts` applies when
 * `PUBLIC_BUNDLE_LIMIT_KB` is unset — which is how CI runs it. Written here as
 * a number the fixtures are sized against rather than imported, so that raising
 * the default in the script does not silently raise it here too: the pair of
 * cases below (200 kB fails, 180 kB passes) is what pins it.
 */
const DEFAULT_LIMIT_KB = 190;

const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

// --------------------------------------------------------------- real bytes

/** A real built file out of node_modules. A path that has moved is a finding,
 *  not a reason to skip — same rule as test/public-bundle.test.ts. */
function realFile(relative: string): Buffer {
  const abs = resolve(ROOT, relative);
  if (!existsSync(abs)) {
    throw new Error(
      `${relative} is not in node_modules. Either the install is incomplete or an upgrade ` +
        `moved the artifact — find the new path and update this test, do not delete the case.`,
    );
  }
  const buffer = readFileSync(abs);
  expect(buffer.length, `${relative} is too small to be the real build`).toBeGreaterThan(2000);
  return buffer;
}

/** React DOM: ~93 kB gzip of code that is emphatically not a studio dependency.
 *  Stands in for the framework chunk every public page loads. */
const framework = () => realFile("node_modules/react-dom/cjs/react-dom-client.production.js");
const small = () => realFile("node_modules/react/cjs/react.production.js");

/**
 * A 2 kB window of a real studio-only build, taken around one of the markers
 * the script scans for. A window rather than the whole library, so that the
 * leak is invisible to the size ceiling and the run can only fail for the
 * reason the case is about.
 */
function leakWindow(relative: string, marker: string): string {
  const source = realFile(relative).toString("utf8");
  const at = source.indexOf(marker);
  expect(
    at,
    `${relative} no longer contains ${marker}; find another marker window`,
  ).toBeGreaterThan(-1);
  const window = source.slice(Math.max(0, at - 1024), at + 1024);
  expect(window).toContain(marker);
  return window;
}

/** A chunk that carries a real MapLibre fingerprint inside otherwise clean
 *  React. `maplibregl` is one of the markers in BANNED_DEPS. */
const leakyChunk = () =>
  small().toString("utf8") +
  leakWindow("node_modules/maplibre-gl/dist/maplibre-gl.mjs", "maplibregl");

/** Incompressible filler, for the cases that are about weight and nothing else.
 *  gzip of random bytes is ~1.0003x, so the fixture size IS the gzip size. */
const filler = (kb: number) => randomBytes(kb * 1024);

// ------------------------------------------------------------ the fixture

/**
 * How the page names the chunk. `module` is the odd one out on purpose: it is
 * a reference `scriptsIn` does NOT match, because the URL ends `.mjs"` and the
 * extraction requires `.js"`. Next emits three route shapes in this project
 * (static, dynamic and a PPR shell), so "the framework changed how it names
 * the script for ONE of them" is the scenario F6 below is about.
 */
type Ref = { chunk: string; via?: "src" | "href" | "module" };
type Page = { path: string; refs?: Ref[]; empty?: boolean };
type Chunks = Record<string, string | Buffer>;

/** The `<link rel="preload" as="script" href=...>` form is not decoration: it
 *  is how Next names the first chunk of every real page in this project's own
 *  build output, and it is the one a `src`-only extraction would miss. */
function pageHtml(page: Page): string {
  const refs = page.refs ?? [];
  const preloads = refs
    .filter((r) => r.via === "href")
    .map((r) => `<link rel="preload" as="script" fetchPriority="low" href="/_next/${r.chunk}"/>`)
    .join("");
  const scripts = refs
    .filter((r) => r.via === undefined || r.via === "src")
    .map((r) => `<script src="/_next/${r.chunk}" async=""></script>`)
    .join("");
  const modules = refs
    .filter((r) => r.via === "module")
    .map((r) => `<script type="module" src="/_next/${r.chunk}"></script>`)
    .join("");
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/>${preloads}</head>` +
    `<body><main>where i go</main>${scripts}${modules}</body></html>`
  );
}

/**
 * A checkout: the script, a `.next` with the given chunks, and the prerendered
 * HTML that references them.
 *
 * The temp directory is realpath'd deliberately. macOS hands out `/var/...`
 * paths that are symlinks to `/private/var/...`, and the entry guard in the
 * script under test compares a resolved path against a realpath'd one — so
 * without this, EVERY case here would silently exercise the F3 symlink bug and
 * measure nothing. The symlink case below opts back in, on purpose.
 */
function checkout(spec: { pages: Page[]; chunks: Chunks; under?: string }): string {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "wig-size-public-")));
  created.push(base);
  const root = join(base, spec.under ?? "repo");

  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(resolve(ROOT, SCRIPT), join(root, "scripts", "check-public-bundle.ts"));

  for (const [name, content] of Object.entries(spec.chunks)) {
    const file = join(root, ".next", name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }

  mkdirSync(join(root, ".next", "server", "app"), { recursive: true });
  for (const page of spec.pages) {
    const file = join(root, ".next", "server", "app", page.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, page.empty ? "" : pageHtml(page));
  }
  return root;
}

/** What the script should report for a page loading these chunks: the sum of
 *  the per-file gzip lengths, which is what it measures. */
function expectedKb(chunks: Chunks, names: string[]): number {
  let bytes = 0;
  for (const name of names) {
    const content = chunks[name];
    if (content === undefined) throw new Error(`the fixture has no chunk named ${name}`);
    bytes += gzipSync(typeof content === "string" ? Buffer.from(content) : content).length;
  }
  return bytes / 1024;
}

type Run = { status: number; stdout: string; stderr: string; transcript: string };

function runCli(entry: string): Run {
  const env = { ...process.env };
  // The default ceiling is part of what is under test, so an ambient override
  // must not reach the child.
  delete env.PUBLIC_BUNDLE_LIMIT_KB;

  const result = spawnSync(process.execPath, ["--import", "tsx", entry], {
    // cwd is the repo so that `tsx` resolves; the script under test is not here.
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  // Vitest resolves stack frames it finds inside an assertion message, and a
  // child stack pasted in verbatim sends that through node_modules until it
  // dies on a bundled inline source map. Defanged, still readable.
  const transcript = `\n$ node --import tsx ${entry}\n[exit ${result.status}]\n${stdout}${stderr}`
    .replace(/^\s+at\s+/gm, "      | ")
    .slice(0, 4000);

  return { status: result.status ?? -1, stdout, stderr, transcript };
}

/** The line the script prints only when both checks passed. */
const SUCCESS = /free of studio-only dependencies/;
/**
 * Everything the run said EXCEPT the per-page measurement ledger.
 *
 * stdout carries one `… kB gzip  N files  <page>` line per page, so finding a
 * page name in stdout proves only that the page was LISTED — which the F6 case
 * below already does today, while exiting 0. A page that was not measured has
 * to be named somewhere a reader would act on: in a failure. Filtering the
 * ledger (and the `worst public route` summary, which is the same shape) is
 * what keeps "reported" and "flagged" from being the same assertion.
 */
const beyondTheLedger = (run: Run) =>
  `${run.stdout}${run.stderr}`
    .split("\n")
    .filter((line) => !/kB gzip/.test(line))
    .join("\n");

/** `  size  worst public route: 176.3 kB gzip (...)` */
const worstKb = (stdout: string): number | undefined => {
  const m = /worst public route:\s*([\d.]+) kB/.exec(stdout);
  return m ? Number(m[1]) : undefined;
};

// -------------------------------------------------------------------- cases

describe("size:public, run as a command against a synthesised build", () => {
  it("reports every prerendered public page and passes a clean build", () => {
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      "static/chunks/page-4d5e6f.js": small(),
    };
    const root = checkout({
      chunks,
      pages: [
        {
          path: "index.html",
          refs: [
            { chunk: "static/chunks/framework-0a1b2c.js", via: "href" },
            { chunk: "static/chunks/framework-0a1b2c.js" },
            { chunk: "static/chunks/page-4d5e6f.js" },
          ],
        },
        {
          path: "trips/2026-japan.html",
          refs: [
            { chunk: "static/chunks/framework-0a1b2c.js" },
            { chunk: "static/chunks/page-4d5e6f.js" },
          ],
        },
        // The zero-byte Partial Prerendering shell. It is not a page anyone
        // ships, and counting it would report a 0.0 kB route.
        { path: "trips/[slug].html", empty: true },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(run.status, `a clean build did not pass:${run.transcript}`).toBe(0);
    expect(run.stdout).toContain(".next/server/app/index.html");
    expect(run.stdout).toContain(".next/server/app/trips/2026-japan.html");
    expect(run.stdout, "the zero-byte PPR shell was measured as a page").not.toContain("[slug]");
    expect(run.stdout).toMatch(SUCCESS);

    // The number it prints is the number it measured. A report that is not the
    // gzip sum of the page's chunks is a report nobody can act on.
    const expected = expectedKb(chunks, [
      "static/chunks/framework-0a1b2c.js",
      "static/chunks/page-4d5e6f.js",
    ]);
    expect(expected).toBeGreaterThan(50);
    expect(
      worstKb(run.stdout),
      `expected ~${expected.toFixed(1)} kB:${run.transcript}`,
    ).toBeCloseTo(expected, 0);
    // Both chunks were actually opened and scanned, not just counted.
    expect(run.stdout).toMatch(/scanned\s+2\s+chunks/);
  });

  it("exits non-zero and names the chunk when a public page ships maplibre", () => {
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      "static/chunks/page-9f8e7d.js": leakyChunk(),
    };
    // The fixture really does carry the leak — otherwise this test would be
    // asserting that a clean build fails.
    expect(String(chunks["static/chunks/page-9f8e7d.js"])).toContain("maplibregl");

    const root = checkout({
      chunks,
      pages: [
        {
          path: "trips/2026-japan.html",
          refs: [
            { chunk: "static/chunks/framework-0a1b2c.js" },
            { chunk: "static/chunks/page-9f8e7d.js" },
          ],
        },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(run.status, `a leaking public page did not fail the check:${run.transcript}`).not.toBe(
      0,
    );
    expect(run.stdout, "the report does not say which chunk leaked").toContain("page-9f8e7d.js");
    expect(run.stdout).not.toMatch(SUCCESS);
    // It failed as a boundary violation, not as a size one: the leak is 2 kB.
    expect(run.stdout, "this should not be a size failure").not.toMatch(/Over budget/);
  });

  it("counts a chunk the page only preloads with href=", () => {
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      "static/chunks/preloaded-7c6b5a.js": leakyChunk(),
    };
    const root = checkout({
      chunks,
      pages: [
        {
          path: "index.html",
          refs: [
            // The leak is reachable ONLY through the preload link, exactly as
            // Next emits the first chunk of a real page.
            { chunk: "static/chunks/preloaded-7c6b5a.js", via: "href" },
            { chunk: "static/chunks/framework-0a1b2c.js" },
          ],
        },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.status,
      `a chunk referenced by a preload link was not read, so the leak inside it was never ` +
        `scanned:${run.transcript}`,
    ).not.toBe(0);
    expect(run.stdout).toContain("preloaded-7c6b5a.js");
    expect(run.stdout).not.toMatch(SUCCESS);
  });

  it("refuses to pass a page it found no scripts on", () => {
    const root = checkout({
      chunks: { "static/chunks/framework-0a1b2c.js": framework() },
      // The failure the script's own comment describes: Next changes how it
      // emits script references, the extraction matches nothing, and a scan of
      // zero bytes reports the public bundle clean.
      pages: [{ path: "index.html", refs: [] }],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(run.status, `a measurement of nothing passed:${run.transcript}`).not.toBe(0);
    expect(run.stdout).not.toMatch(SUCCESS);
    // On stdout, as an explanation. A stack trace on stderr also exits non-zero
    // and tells whoever reads CI nothing about what to fix.
    expect(
      run.stdout,
      `the run failed without explaining that it measured nothing:${run.transcript}`,
    ).toMatch(/0 bytes/i);
  });

  it("fails on the default ceiling with no leak present", () => {
    const chunks: Chunks = { "static/chunks/heavy-1a2b3c.js": filler(200) };
    const over = expectedKb(chunks, ["static/chunks/heavy-1a2b3c.js"]);
    // The fixture is genuinely over the documented default, not merely large.
    expect(over, "the filler compressed; this fixture is no longer over budget").toBeGreaterThan(
      DEFAULT_LIMIT_KB,
    );

    const root = checkout({
      chunks,
      pages: [{ path: "index.html", refs: [{ chunk: "static/chunks/heavy-1a2b3c.js" }] }],
    });
    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.status,
      `${over.toFixed(1)} kB on a public route passed a ${DEFAULT_LIMIT_KB} kB ` +
        `budget:${run.transcript}`,
    ).not.toBe(0);
    expect(run.stdout).toMatch(/Over budget/);
    expect(run.stdout).not.toMatch(SUCCESS);
    // It failed on weight, not because something was mistaken for a studio dep.
    expect(run.stdout).not.toMatch(/A studio-only dependency reached a public route/);
  });

  it("passes just under the default ceiling", () => {
    const chunks: Chunks = { "static/chunks/heavy-1a2b3c.js": filler(180) };
    const under = expectedKb(chunks, ["static/chunks/heavy-1a2b3c.js"]);
    expect(under).toBeLessThan(DEFAULT_LIMIT_KB);
    expect(under).toBeGreaterThan(DEFAULT_LIMIT_KB - 20);

    const root = checkout({
      chunks,
      pages: [{ path: "index.html", refs: [{ chunk: "static/chunks/heavy-1a2b3c.js" }] }],
    });
    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.status,
      `${under.toFixed(1)} kB failed a ${DEFAULT_LIMIT_KB} kB budget — a ceiling that rejects ` +
        `everything is not a ceiling:${run.transcript}`,
    ).toBe(0);
    expect(run.stdout).toMatch(SUCCESS);
  });
});

/**
 * F1. `publicPages()` filters with `!/studio/.test(f)` against the ABSOLUTE
 * path of each prerendered file. Unanchored, and applied before the path is
 * made relative to the checkout — so it excludes far more than the studio
 * route, and what it excludes is invisible to both the ceiling and the
 * composition scan.
 */
describe("F1: only the studio ROUTE may be excluded", () => {
  it("catches a leak on a public trip whose slug contains the word studio", () => {
    // docs/data-model.md: slugs are derived from titles. "Studio Ghibli Museum"
    // is an ordinary public trip, and nothing about it is studio-only.
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      "static/chunks/page-9f8e7d.js": leakyChunk(),
    };
    const root = checkout({
      chunks,
      pages: [
        { path: "index.html", refs: [{ chunk: "static/chunks/framework-0a1b2c.js" }] },
        {
          path: "trips/studio-ghibli-museum.html",
          refs: [
            { chunk: "static/chunks/framework-0a1b2c.js" },
            { chunk: "static/chunks/page-9f8e7d.js" },
          ],
        },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.stdout,
      `a public page was dropped from the check because its slug contains "studio". Slugs come ` +
        `from titles, so this is a trip called "Studio Ghibli Museum" shipping maplibre with ` +
        `nothing to stop it:${run.transcript}`,
    ).toContain("trips/studio-ghibli-museum.html");
    expect(run.status, `the leak on that page was not caught:${run.transcript}`).not.toBe(0);
    expect(run.stdout).toContain("page-9f8e7d.js");
    expect(run.stdout).not.toMatch(SUCCESS);
  });

  it("still excludes the studio route itself, at both of the paths Next emits", () => {
    // The allow-case. The studio is allowed to be heavy and to hold Radix —
    // keeping it out is what stops its weight hiding a public regression. A
    // rule that excludes nothing is as broken as one that excludes everything.
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      "static/chunks/studio-3e2d1c.js": Buffer.concat([filler(240), Buffer.from(leakyChunk())]),
    };
    const root = checkout({
      chunks,
      pages: [
        { path: "index.html", refs: [{ chunk: "static/chunks/framework-0a1b2c.js" }] },
        // What `app/(studio)/page.tsx` actually builds to in this project.
        { path: "studio.html", refs: [{ chunk: "static/chunks/studio-3e2d1c.js" }] },
        { path: "studio/settings.html", refs: [{ chunk: "static/chunks/studio-3e2d1c.js" }] },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(run.status, `the studio route was measured as a public page:${run.transcript}`).toBe(0);
    expect(run.stdout).not.toContain("studio.html");
    expect(run.stdout).not.toContain("settings.html");
    expect(run.stdout).toMatch(SUCCESS);
    // And the public page it did measure is the clean one.
    expect(worstKb(run.stdout)).toBeCloseTo(
      expectedKb(chunks, ["static/chunks/framework-0a1b2c.js"]),
      0,
    );
  });

  it("enforces when the checkout itself sits in a directory named studio", () => {
    // Same defect, second symptom: the filter runs against the absolute path,
    // so ~/src/studio/where-i-go excludes every page in the repository and the
    // check reports that nothing was built.
    const chunks: Chunks = { "static/chunks/framework-0a1b2c.js": framework() };
    const root = checkout({
      under: "studio",
      chunks,
      pages: [{ path: "index.html", refs: [{ chunk: "static/chunks/framework-0a1b2c.js" }] }],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.stdout,
      `a checkout under a directory named "studio" excluded every public page:${run.transcript}`,
    ).not.toMatch(/No public pages were prerendered/);
    expect(run.stdout).toContain(".next/server/app/index.html");
    expect(run.stdout).toMatch(/worst public route/);
    expect(run.status, run.transcript).toBe(0);
  });
});

/**
 * F3. The entry guard compares `resolve(process.argv[1])` — which does not
 * follow symlinks — against `fileURLToPath(import.meta.url)`, which Node has
 * already realpath'd. Two ordinary invocations therefore produce no output and
 * exit 0. A guard that fails open is worse than no guard: `size:public` would
 * report success on a build it never looked at.
 *
 * The opposite direction — importing the module must run nothing — is correct
 * and deliberate, and stays pinned by the purity test in
 * test/public-bundle.test.ts. Both must hold.
 */
describe("F3: the entry guard must fail closed", () => {
  const leakingCheckout = () => {
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      "static/chunks/page-9f8e7d.js": leakyChunk(),
    };
    return checkout({
      chunks,
      pages: [
        {
          path: "index.html",
          refs: [
            { chunk: "static/chunks/framework-0a1b2c.js" },
            { chunk: "static/chunks/page-9f8e7d.js" },
          ],
        },
      ],
    });
  };

  it("runs when invoked through a symlink to the checkout", () => {
    const root = leakingCheckout();
    const link = join(dirname(root), "checkout-link");
    symlinkSync(root, link, "dir");

    const run = runCli(join(link, "scripts", "check-public-bundle.ts"));

    expect(
      run.stdout.trim(),
      `the CLI printed nothing and exited ${run.status}: invoked through a symlink, the entry ` +
        `guard did not fire and the check silently did not run:${run.transcript}`,
    ).not.toBe("");
    expect(
      run.status,
      `a leaking build passed through a symlinked path:${run.transcript}`,
    ).not.toBe(0);
    expect(run.stdout).toContain("page-9f8e7d.js");
    expect(run.stdout).not.toMatch(SUCCESS);
  });

  it("runs when invoked without the .ts extension", () => {
    const root = leakingCheckout();

    // `tsx scripts/check-public-bundle` resolves the extension and loads the
    // file; argv[1] keeps the extensionless spelling the caller typed.
    const run = runCli(join(root, "scripts", "check-public-bundle"));

    expect(
      run.stdout.trim(),
      `the CLI printed nothing and exited ${run.status}: invoked without the .ts extension, the ` +
        `entry guard did not fire and the check silently did not run:${run.transcript}`,
    ).not.toBe("");
    expect(
      run.status,
      `a leaking build passed when invoked extensionless:${run.transcript}`,
    ).not.toBe(0);
    expect(run.stdout).toContain("page-9f8e7d.js");
    expect(run.stdout).not.toMatch(SUCCESS);
  });
});

/**
 * F5. `if (!existsSync(onDisk)) continue;` drops a referenced chunk from the
 * byte sum AND from the map that gets scanned, while the report still prints
 * `refs.size` files. The script already refuses to pass a measurement of
 * nothing; the same principle applies per chunk, because a chunk that could not
 * be read is a chunk that was not scanned.
 */
describe("F5: a referenced chunk that does not resolve on disk", () => {
  it("fails, naming the reference it could not read", () => {
    const chunks: Chunks = { "static/chunks/framework-0a1b2c.js": framework() };
    const root = checkout({
      chunks,
      pages: [
        {
          path: "index.html",
          refs: [
            { chunk: "static/chunks/framework-0a1b2c.js" },
            // Named by the HTML, absent from .next.
            { chunk: "static/chunks/2f8a1b0c.js" },
          ],
        },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.status,
      `a page referencing a chunk that is not on disk was reported as measured and clean. The ` +
        `printed file count includes it; the bytes and the scan do not:${run.transcript}`,
    ).not.toBe(0);
    expect(
      `${run.stdout}${run.stderr}`,
      "the failure does not name the reference that could not be read",
    ).toContain("2f8a1b0c.js");
    expect(run.stdout).not.toMatch(SUCCESS);
  });

  it("does not report a clean scan when the unreadable chunk is the leaking one", () => {
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      // The leak exists in the checkout, but not at the path the HTML names —
      // a chunk that moved. Today it is skipped, never scanned, and the run
      // prints "absent" for every banned dep and exits 0.
      "static/chunks/moved/page-9f8e7d.js": leakyChunk(),
    };
    const root = checkout({
      chunks,
      pages: [
        {
          path: "index.html",
          refs: [
            { chunk: "static/chunks/framework-0a1b2c.js" },
            { chunk: "static/chunks/page-9f8e7d.js" },
          ],
        },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.status,
      `the check reported the public bundle free of studio-only dependencies without reading ` +
        `the chunk that carries one:${run.transcript}`,
    ).not.toBe(0);
    expect(run.stdout).not.toMatch(SUCCESS);
  });
});

/**
 * F6. A page the extraction found ZERO script references on is reported and
 * passed, as long as some OTHER page has scripts.
 *
 * The `worst.bytes === 0` guard is global — it fires only when EVERY page
 * measures nothing. The F5 `unresolved` guard fires only for a reference that
 * WAS extracted and is then missing on disk. Neither covers the gap between
 * them: the extraction matched nothing on this page. Observed:
 *
 *      93.3 kB gzip  1 files  .next/server/app/index.html
 *       0.0 kB gzip  0 files  .next/server/app/trips/2026-japan.html
 *   deps  scanned 1 chunks across 2 pages
 *   Public bundle within budget, and free of studio-only dependencies.
 *   exit=0
 *
 * The second page was neither weighed nor scanned, and the run is green. Zero-
 * byte HTML is already excluded upstream by `publicPages()`, so a page that
 * reaches the loop and yields no references can only ever be a REAL page.
 *
 * This is the script's own F5 reasoning — "the same rule as the 'measured
 * nothing' guard, applied per chunk" — stopping one level short of the page.
 */
describe("F6: a page the extraction found no scripts on", () => {
  it("fails, naming the page it measured nothing on", () => {
    const chunks: Chunks = {
      "static/chunks/framework-0a1b2c.js": framework(),
      // On disk, real, and carrying a real maplibre fingerprint — the page
      // below genuinely ships it. Keeping the file PRESENT is deliberate: if
      // the reference ever did match, the chunk would resolve, be weighed and
      // be scanned, the leak would be reported, and this case would go red as
      // a broken fixture instead of passing for the wrong reason.
      "static/chunks/page-esm-8b7a6d.mjs": leakyChunk(),
    };
    const root = checkout({
      chunks,
      pages: [
        // An ordinary page, measured normally. It is what keeps the global
        // "measured 0 bytes" guard silent, and it is why this run is green.
        { path: "index.html", refs: [{ chunk: "static/chunks/framework-0a1b2c.js" }] },
        // A real public trip page whose only script the extraction misses.
        {
          path: "trips/2026-japan.html",
          refs: [{ chunk: "static/chunks/page-esm-8b7a6d.mjs", via: "module" }],
        },
      ],
    });

    // The fixture is only the shape this case needs if the extraction really
    // does miss that reference, so prove it rather than assume it. `scriptsIn`
    // requires the URL to end `.js"`; `.mjs"` has no dot before `js`. The regex
    // is mirrored from the script — if it is ever widened to match modules,
    // this assertion fails HERE, which is the loud place for it.
    const html = readFileSync(
      join(root, ".next", "server", "app", "trips", "2026-japan.html"),
      "utf8",
    );
    expect(html, "the fixture page names no script at all").toContain(
      "/_next/static/chunks/page-esm-8b7a6d.mjs",
    );
    expect(
      [...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)],
      "the fixture page's script reference is one the extraction DOES match, so this case is " +
        "no longer about a page that measured nothing",
    ).toHaveLength(0);

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(
      run.status,
      `a public page the script extracted ZERO script references from was reported and passed. ` +
        `It was neither weighed nor scanned — the chunk it ships carries maplibre — and the run ` +
        `still printed "free of studio-only dependencies". The 0-byte guard is global: it fires ` +
        `only when EVERY page measures nothing, and index.html measured fine:${run.transcript}`,
    ).not.toBe(0);
    expect(run.stdout).not.toMatch(SUCCESS);
    expect(
      beyondTheLedger(run),
      `the run never names the page it measured nothing on anywhere but its own ledger line. ` +
        `"0.0 kB gzip  0 files" sits in the list of pages that WERE measured, so it reads as a ` +
        `measurement rather than as a page nothing was learned about:${run.transcript}`,
    ).toContain("trips/2026-japan.html");
    // And it is the per-page case, not the global one: index.html measured
    // 93 kB, so `worst.bytes === 0` never fires here.
    expect(run.stdout, "this is the per-page case, not the global one").not.toMatch(
      /Measured 0 bytes/,
    );
  });

  it("does not fire on the zero-byte PPR shell, which never reaches the page loop", () => {
    // The allow-case, and a constraint on the fix rather than a restatement of
    // it. `trips/[slug].html` has no bytes, is excluded by publicPages() with a
    // reason on stderr, and never gets as far as being extracted from. A guard
    // that counted zero-script pages by looking at the wrong list would turn
    // this perfectly ordinary build red. It passes today, and must keep
    // passing after F6 is fixed.
    const chunks: Chunks = { "static/chunks/framework-0a1b2c.js": framework() };
    const root = checkout({
      chunks,
      pages: [
        { path: "index.html", refs: [{ chunk: "static/chunks/framework-0a1b2c.js" }] },
        { path: "trips/[slug].html", empty: true },
      ],
    });

    const run = runCli(join(root, "scripts", "check-public-bundle.ts"));

    expect(run.status, `an excluded zero-byte shell failed the run:${run.transcript}`).toBe(0);
    expect(run.stdout).toMatch(SUCCESS);
    // Excluded, and said so — on stderr, where exclusions go.
    expect(run.stderr, "the shell was dropped without a word").toContain("trips/[slug].html");
    expect(run.stderr).toMatch(/zero bytes on disk/);
    expect(run.stdout, "the shell was measured as a page").not.toContain("[slug]");
  });
});

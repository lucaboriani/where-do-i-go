import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as esbuild from "esbuild";
import eslintConfig from "../eslint.config.mjs";

/**
 * The dependency-composition guardrail on the public bundle.
 *
 * `scripts/check-public-bundle.ts` weighs the chunks a public page loads. The
 * ceiling is going 180 -> 190 kB because the worst public route measures
 * 176.3 kB, and 13.7 kB of headroom is enough room for a studio dependency to
 * slip in unnoticed. Measured 2026-09-04, each library bundled and minified by
 * esbuild on its own and gzipped — what a bundler would actually add to a
 * chunk: `sonner` 9.6 kB, `cmdk` 17.1, `vaul` 21.4. Only the first fits inside
 * the headroom, so only the first is invisible to a size budget — the reverse
 * of what an earlier revision of this comment said, which had these as 11.0,
 * 28.9 and 33.9 by summing the gzip of every `.js`/`.mjs` in each package's
 * `dist/`: the ESM build plus the duplicate CJS build, plus dev builds and
 * workers nothing imports. Weight is the wrong question either way. The right
 * question is "is this dependency here at all", asked by NAME, at any size.
 *
 * So this file tests a second check in the same script: a pure scan over the
 * chunk sources for markers that prove a studio-only library is present.
 *
 * The trap it must not fall into is a substring match on a short package name.
 * Grepping a real public chunk for "n3" hits, and the hit is React's minified
 * DOM code:
 *
 *     n2={},n3={};function n4(e){...}   tU&&(n3=document.createElement("div").style,...)
 *
 * A guardrail that cries wolf on the framework gets switched off by the first
 * person it annoys, so that false positive is pinned here in two ways: against
 * real framework builds read out of node_modules, and against the literal
 * shape, captured verbatim from a built chunk.
 *
 * Every fixture in this file is a real file from `node_modules`. An invented
 * fixture would only prove that a marker matches the fixture; a real one makes
 * the marker list self-maintaining, because a library upgrade that changes its
 * output turns THIS file red instead of leaving the guardrail silently passing.
 *
 * Nothing here reads `.next`. A build artifact is not a fixture, and the suite
 * has to pass on a clean checkout.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = "scripts/check-public-bundle.ts";

type Chunk = { name: string; source: string };
type Finding = { dep: string; chunk: string; marker: string };
type BannedDep = { name: string; markers: string[] };
type Worst = { page: string; bytes: number };
type Measurement = {
  worst: Worst;
  chunks: Map<string, string>;
  unresolved: { page: string; ref: string }[];
  noScripts: string[];
};
type Gaps = { failed: boolean; measuredNothing: boolean };
type LazyProof = { present: string[]; leaked: string[] };
type Mod = {
  BANNED_DEPS?: BannedDep[];
  findStudioDeps?: (chunks: Chunk[]) => Finding[];
  findLazyChunks?: (chunks: Chunk[], referenced: Set<string>, markers: string[]) => LazyProof;
  LIMIT_KB?: number;
  measurePages?: (pages: string[], root: string) => Measurement;
  reportMeasurementGaps?: (measured: Measurement) => Gaps;
  reportSize?: (worst: Worst) => number;
  reportComposition?: (chunks: Map<string, string>, pageCount: number) => Finding[];
  reportViolations?: (findings: Finding[], kb: number) => boolean;
};

// ---------------------------------------------------------------- the module

let mod: Mod = {};
let loadError: unknown;

beforeAll(async () => {
  // Importing the script runs nothing: the CLI sits behind an entry guard, and
  // the child-process case at the bottom of this file proves it from a
  // directory with no `.next`.
  //
  // This used to spy on `process.exit` and `console.log` here, with a comment
  // saying "the script runs its whole CLI at import time today". It did not,
  // and the purity test already said so. The spies were removed rather than
  // left as scaffolding: without them, a regression that DID run the CLI on
  // import prints its report over this file's output or takes the worker down
  // with process.exit(), instead of being quietly absorbed.
  try {
    mod = (await import("../scripts/check-public-bundle")) as unknown as Mod;
  } catch (error) {
    loadError = error;
  }
});

/** Throws rather than returning a stub, so a missing export fails the test that
 *  needed it instead of quietly turning its assertions into no-ops. */
function findStudioDeps(chunks: Chunk[]): Finding[] {
  if (loadError) throw loadError;
  const fn = mod.findStudioDeps;
  if (typeof fn !== "function") {
    throw new Error(
      `${MODULE} does not export findStudioDeps(chunks). It must be importable and pure: ` +
        `one finding per (dep, chunk) hit, empty for a clean scan.`,
    );
  }
  return fn(chunks);
}

/** Same rule as findStudioDeps above: throws rather than stubbing so a missing
 *  export fails the case that needed it. */
function findLazyChunks(chunks: Chunk[], referenced: Set<string>, markers: string[]): LazyProof {
  if (loadError) throw loadError;
  const fn = mod.findLazyChunks;
  if (typeof fn !== "function") {
    throw new Error(
      `${MODULE} does not export findLazyChunks(chunks, referenced, markers). It is the ` +
        "positive control: a chunk carrying the map must exist, and no public page may reference it.",
    );
  }
  return fn(chunks, referenced, markers);
}

function bannedDeps(): BannedDep[] {
  if (loadError) throw loadError;
  const list = mod.BANNED_DEPS;
  if (!Array.isArray(list)) {
    throw new Error(`${MODULE} does not export BANNED_DEPS: { name, markers }[].`);
  }
  return list;
}

/**
 * One of the steps `main` is made of, or a failure naming the contract. Same
 * rule as the two accessors above: a missing export fails the case that needed
 * it rather than turning its assertions into no-ops.
 */
function step<K extends keyof Mod>(name: K): NonNullable<Mod[K]> {
  if (loadError) throw loadError;
  const value = mod[name];
  if (value === undefined) {
    throw new Error(
      `${MODULE} does not export ${String(name)}. \`main\` splits into the steps it prints ` +
        `progress for — measurePages, reportMeasurementGaps, reportSize, reportComposition, ` +
        `reportViolations — each exported so it can be checked where the CLI cannot reach.`,
    );
  }
  return value as NonNullable<Mod[K]>;
}

// ------------------------------------------------------------ real artifacts

/** Reads a real built file out of node_modules. A path that has moved is a
 *  finding, not a reason to skip: the marker list is only self-maintaining if
 *  it is checked against the output the library actually ships today. */
function realSource(relative: string): string {
  const abs = resolve(ROOT, relative);
  if (!existsSync(abs)) {
    throw new Error(
      `${relative} is not in node_modules. Either the install is incomplete or an upgrade ` +
        `moved the built artifact — find the new path and update this test, do not delete the case.`,
    );
  }
  const source = readFileSync(abs, "utf8");
  // A zero-byte or stub file would make "no findings" and "found the marker"
  // both meaningless.
  expect(source.length, `${relative} is too small to be the real build`).toBeGreaterThan(2000);
  return source;
}

const EXIFREADER_BUILD = "node_modules/exifreader/dist/exif-reader.js";

/**
 * The real built output of every studio-only dependency, keyed by the names an
 * implementation might reasonably give it.
 *
 * Files were chosen by looking at what each package actually publishes (there
 * is no `maplibre-gl/dist/maplibre-gl.js` — it ships `.mjs` only) and, where
 * there was a choice, by preferring the build closest to what ends up in a
 * chunk: n3's minified browser bundle rather than its `src`, because a marker
 * that survives minification survives bundling.
 *
 * RE-DERIVE THIS WHEN A STUDIO DEPENDENCY IS ADDED.
 */
const ARTIFACTS: { aliases: string[]; files: string[] }[] = [
  {
    aliases: ["maplibre-gl", "maplibre"],
    files: ["node_modules/maplibre-gl/dist/maplibre-gl.mjs"],
  },
  {
    // Deliberately NOT aliased to a bare "inrupt": the two Inrupt packages have
    // different output and each has to be proven separately. A single entry
    // named "@inrupt" covering both still matches here, and then has to be
    // found in both builds — which is the correct requirement.
    aliases: ["@inrupt/solid-client", "solid-client"],
    files: [
      "node_modules/@inrupt/solid-client/dist/index.es.js",
      "node_modules/@inrupt/solid-client/dist/index.umd.js",
    ],
  },
  {
    aliases: [
      "@inrupt/solid-client-authn-browser",
      "@inrupt/solid-client-authn",
      "solid-client-authn-browser",
      "solid-client-authn",
    ],
    files: [
      "node_modules/@inrupt/solid-client-authn-browser/dist/index.mjs",
      // The pre-bundled build. It contains no "@inrupt" at all — the scope name
      // is gone — so a marker that leans on the package specifier fails here,
      // which is the point.
      "node_modules/@inrupt/solid-client-authn-browser/dist/solid-client-authn.bundle.js",
    ],
  },
  {
    aliases: ["n3"],
    files: [
      "node_modules/n3/browser/n3.esm.min.js",
      // What a bundler actually resolves: package.json "module" points at src.
      "node_modules/n3/src/N3Parser.js",
    ],
  },
  {
    aliases: ["exifreader", "exif-reader"],
    files: [EXIFREADER_BUILD],
  },
  { aliases: ["vaul"], files: ["node_modules/vaul/dist/index.mjs"] },
  { aliases: ["sonner"], files: ["node_modules/sonner/dist/index.mjs"] },
  { aliases: ["cmdk"], files: ["node_modules/cmdk/dist/index.mjs"] },
  {
    // On disk because shadcn's sonner component imports `useTheme` from it, and
    // banned from the public block in eslint.config.mjs because CLAUDE.md fixes
    // the theme to dark with no toggle. Both builds, because the markers are
    // API names and the two builds spell their internals differently.
    aliases: ["next-themes"],
    files: ["node_modules/next-themes/dist/index.mjs", "node_modules/next-themes/dist/index.js"],
  },
  {
    // `radix-ui/dist/index.mjs` is a re-export shim — nothing of it survives
    // bundling. Two real primitives instead, both of which carry runtime
    // literals (`--radix-popper-*`, `data-radix-scroll-area-viewport`).
    aliases: ["@radix-ui", "radix-ui", "radix"],
    files: [
      "node_modules/@radix-ui/react-popper/dist/index.mjs",
      "node_modules/@radix-ui/react-scroll-area/dist/index.mjs",
    ],
  },
  {
    // `zod/index.js` is a 422-byte re-export barrel — too small even to pass
    // realSource's own minimum. This is where `$ZodError` is actually defined.
    aliases: ["zod"],
    files: ["node_modules/zod/v4/core/errors.js"],
  },
];

/** Real framework code that must never be flagged. */
const FRAMEWORK = {
  reactDomClient: "node_modules/react-dom/cjs/react-dom-client.production.js",
  reactDom: "node_modules/react-dom/cjs/react-dom.production.js",
  react: "node_modules/react/cjs/react.production.js",
  scheduler: "node_modules/scheduler/cjs/scheduler.production.js",
} as const;

/**
 * Real framework code that is ALSO identifier-minified, i.e. the only thing in
 * node_modules that reproduces the conditions of the `n3` collision. React's
 * own npm builds are not identifier-mangled — `react-dom-client.production.js`
 * contains no "n3" substring at all — so on its own it cannot exercise the
 * false positive. Next ships pre-minified copies that do: 14 and 15 `n3` tokens
 * respectively at next 16.3.4.
 */
const MINIFIED_FRAMEWORK = [
  "node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js",
  "node_modules/next/dist/compiled/next-devtools/index.js",
];

/** "@radix-ui/*" -> "radix-ui", "@inrupt/solid-client" -> "inrupt/solid-client". */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\/\*+$/, "")
    .replace(/\/+$/, "");

/** Same package, or one is a scope/family of the other. */
function covers(depName: string, specifier: string): boolean {
  const d = norm(depName);
  const s = norm(specifier);
  return d === s || s.startsWith(`${d}/`) || d.startsWith(`${s}/`);
}

const matchesGroup = (depName: string, aliases: string[]) =>
  aliases.some((alias) => covers(depName, alias));

// -------------------------------------------------------------------- tests

describe("findStudioDeps: every banned dep is detected in its own real build", () => {
  it.each(ARTIFACTS.map((g) => [g.aliases[0], g] as const))(
    "flags %s in the build it actually ships",
    (label, group) => {
      const deps = bannedDeps().filter((d) => matchesGroup(d.name, group.aliases));
      // A dep dropped from BANNED_DEPS would otherwise make every assertion
      // below iterate over nothing and pass.
      expect(
        deps.map((d) => d.name),
        `no entry in BANNED_DEPS covers ${label} — it is studio-only and must be on the list`,
      ).not.toEqual([]);

      for (const file of group.files) {
        const source = realSource(file);
        const chunk: Chunk = { name: `static/chunks/${basename(file)}`, source };
        const findings = findStudioDeps([chunk]);

        for (const dep of deps) {
          const hit = findings.find((f) => f.dep === dep.name && f.chunk === chunk.name);
          expect(
            hit,
            `${dep.name} was not detected in ${file}. Its markers are ` +
              `${JSON.stringify(dep.markers)}; none of them appears in the build the library ` +
              `ships today. Update the markers from the real file — do not relax the check.`,
          ).toBeDefined();
          // A finding that names a marker not present in the source is a lie,
          // and a lie is how a guardrail loses its credibility.
          expect(source).toContain(hit!.marker);
        }
      }
    },
  );

  it("registers a real artifact for every entry in BANNED_DEPS", () => {
    const unregistered = bannedDeps()
      .filter((d) => !ARTIFACTS.some((g) => matchesGroup(d.name, g.aliases)))
      .map((d) => d.name);
    expect(
      unregistered,
      "a banned dep with no real build to check against is a marker nobody can verify — " +
        "add its node_modules artifact to ARTIFACTS in this file",
    ).toEqual([]);
  });

  /**
   * The dist files above still contain their own import specifiers
   * (`from "@radix-ui/react-primitive"`), which a bundler resolves away. A
   * marker that only matches a specifier looks fine here and catches nothing in
   * a real chunk. Radix is where that shortcut is tempting, because the runtime
   * strings are `--radix-popper-*` and `data-radix-*` rather than the package
   * name.
   */
  it("keeps radix detectable after the bundler resolves its import specifiers away", () => {
    const deps = bannedDeps().filter((d) =>
      matchesGroup(d.name, ["@radix-ui", "radix-ui", "radix"]),
    );
    expect(deps.map((d) => d.name)).not.toEqual([]);

    for (const file of [
      "node_modules/@radix-ui/react-popper/dist/index.mjs",
      "node_modules/@radix-ui/react-scroll-area/dist/index.mjs",
    ]) {
      const source = realSource(file);
      const bundled = source
        .replace(/\bfrom\s*(["'])(?:(?!\1).)*\1/g, 'from ""')
        .replace(/\brequire\(\s*(["'])(?:(?!\1).)*\1\s*\)/g, 'require("")')
        .replace(/\bimport\s*(["'])(?:(?!\1).)*\1/g, 'import ""');

      // The mutation has to have happened, or this test silently re-runs the
      // one above on the unmodified file and proves nothing.
      expect(bundled.length, `${file}: nothing was stripped`).toBeLessThan(source.length);
      expect(source).toContain("@radix-ui/");
      expect(bundled).not.toContain("@radix-ui/");

      const findings = findStudioDeps([{ name: "static/chunks/page.js", source: bundled }]);
      for (const dep of deps) {
        expect(
          findings.find((f) => f.dep === dep.name),
          `${dep.name} is only detectable through an import specifier. Markers ` +
            `${JSON.stringify(dep.markers)} do not survive bundling, so they would never fire ` +
            `on a real chunk. Use a runtime literal such as "--radix-popper-" or "data-radix-".`,
        ).toBeDefined();
      }
    }
  });
});

/**
 * The same requirement as the Radix case above — "MARKERS MUST SURVIVE
 * BUNDLING", the rule scripts/check-public-bundle.ts states about itself —
 * applied to every dep on the list, and through a real bundler rather than a
 * regex that pretends to be one.
 *
 * The regex above only removes import specifiers. A bundler also drops
 * comments, and a marker that lives in a comment is exactly as useless as one
 * that lives in a specifier: neither can ever fire on a chunk. Only the real
 * thing catches both.
 *
 * esbuild is what does the bundling, and it IS a declared devDependency —
 * added for exactly this. It arrived here transitively first, and the comment
 * that used to sit here said it was "already installed as vite's, and
 * therefore vitest's, own". That was wrong twice over: vite 8.2.2 bundles with
 * rolldown and lists esbuild only as an optional peer, so the real provider was
 * `tsx`, at an unpinned `~0.28.0`. Relying on that was a live hazard rather
 * than an untidiness — `docs/decisions.md` §21 declines to dictate a package
 * manager, and under pnpm's default isolated layout an undeclared transitive
 * does not resolve, so this import would fail to load and take all 40 tests in
 * this file with it, silently losing the marker guardrail on a pnpm checkout.
 *
 * If esbuild ever disappears these cases must fail rather than skip: a marker
 * list nobody checks is how this guardrail goes quiet.
 */
const BUNDLE_EXTERNAL = [
  // Node built-ins and the peer deps these libraries expect a host to provide.
  // Everything else is genuinely bundled in, which is the point.
  "node:*",
  "fs",
  "path",
  "crypto",
  "util",
  "stream",
  "http",
  "https",
  "url",
  "zlib",
  "events",
  "buffer",
  "react",
  "react-dom",
];

const bundles = new Map<string, string>();

/** The real artifact, bundled and minified the way a chunk in `.next` is. */
async function bundledSource(relative: string): Promise<string> {
  const cached = bundles.get(relative);
  if (cached !== undefined) return cached;

  // Fails loudly if the artifact moved, and rejects a stub.
  realSource(relative);
  const result = await esbuild.build({
    entryPoints: [resolve(ROOT, relative)],
    bundle: true,
    minify: true,
    write: false,
    format: "esm",
    platform: "browser",
    legalComments: "none",
    logLevel: "silent",
    external: BUNDLE_EXTERNAL,
    absWorkingDir: ROOT,
  });
  const code = result.outputFiles?.[0]?.text ?? "";
  // A failed bundle would otherwise be an empty string, in which case every
  // marker is "missing" and the second case below fails for the wrong reason.
  expect(code.length, `esbuild produced no output for ${relative}`).toBeGreaterThan(1000);
  bundles.set(relative, code);
  return code;
}

describe("BANNED_DEPS: markers must survive a real bundler", () => {
  it.each(ARTIFACTS.map((g) => [g.aliases[0], g] as const))(
    "still detects %s after esbuild bundles and minifies it",
    async (label, group) => {
      const deps = bannedDeps().filter((d) => matchesGroup(d.name, group.aliases));
      expect(deps.map((d) => d.name), `no entry in BANNED_DEPS covers ${label}`).not.toEqual([]);

      for (const file of group.files) {
        const code = await bundledSource(file);
        // The bundler really did something; otherwise this repeats the
        // detection case earlier in the file on the untouched artifact.
        expect(code, `${file} came back unchanged`).not.toBe(realSource(file));

        const findings = findStudioDeps([{ name: `static/chunks/${basename(file)}`, source: code }]);
        for (const dep of deps) {
          const hit = findings.find((f) => f.dep === dep.name);
          expect(
            hit,
            `${dep.name} is undetectable once ${file} has been through a bundler. Markers ` +
              `${JSON.stringify(dep.markers)} do not survive, so none of them would ever fire on ` +
              `a real chunk. Use a runtime literal — a CSS custom property, a data attribute, an ` +
              `exported function name — not an import specifier.`,
          ).toBeDefined();
          expect(code).toContain(hit!.marker);
        }
      }
    },
  );

  /**
   * Dep-level coverage is not enough. A dep with two markers, one of which is
   * dead, looks fine above and is a marker nobody can rely on: the day the
   * surviving one is renamed upstream, the list matches nothing and the scan
   * goes quiet. Every marker that fires on the shipped build must still fire
   * after bundling, or it should not be on the list.
   */
  it("keeps every marker that fires on the shipped build firing after bundling", async () => {
    const casualties: { dep: string; marker: string; file: string }[] = [];
    let checked = 0;

    for (const group of ARTIFACTS) {
      const deps = bannedDeps().filter((d) => matchesGroup(d.name, group.aliases));
      for (const file of group.files) {
        const source = realSource(file);
        const code = await bundledSource(file);
        for (const dep of deps) {
          for (const marker of dep.markers) {
            // Only markers this artifact actually carries. A marker for a
            // sibling build is not this file's to prove.
            if (!source.includes(marker)) continue;
            checked++;
            if (!code.includes(marker)) casualties.push({ dep: dep.name, marker, file });
          }
        }
      }
    }

    expect(
      checked,
      "no marker was checked at all — the artifact list or the deps went empty",
    ).toBeGreaterThanOrEqual(20);
    expect(
      casualties,
      "these markers are present in the build the library ships and gone from the same build " +
        "once a bundler has been through it — an import specifier the bundler resolved away, or " +
        "a comment the minifier dropped. They can never fire on a chunk in .next, so they are " +
        "list padding: either replace them with a runtime literal or remove them, and check the " +
        "dep still has a marker that works",
    ).toEqual([]);
  });
});

describe("findStudioDeps: the framework is not a studio dependency", () => {
  it.each(Object.values(FRAMEWORK))("does not flag %s", (file) => {
    const source = realSource(file);
    const findings = findStudioDeps([{ name: "static/chunks/framework.js", source }]);
    expect(
      findings,
      `real React code was reported as a studio dependency: ${JSON.stringify(findings.slice(0, 5))}`,
    ).toEqual([]);
  });

  /**
   * The `n3` false positive, against real minified code rather than a snippet
   * anyone retyped. These files contain the `n3` token — asserted, so the case
   * cannot go vacuous if a Next upgrade renames the mangled identifiers — and
   * none of the things that would actually mean n3 is present.
   */
  it.each(MINIFIED_FRAMEWORK)("does not flag %s, which contains a minified `n3` token", (file) => {
    const source = realSource(file);
    const n3Token = /(?<![A-Za-z0-9_$])n3(?![A-Za-z0-9_$])/;
    expect(
      n3Token.test(source),
      `${file} no longer contains a bare "n3" token, so this case no longer exercises the ` +
        `false positive. Find another minified framework build that does.`,
    ).toBe(true);
    // ...and it is a collision, not the library: none of n3's real vocabulary
    // is in there.
    expect(source).not.toContain("blankNode");
    expect(source).not.toContain("namedNode");

    const findings = findStudioDeps([{ name: "static/chunks/framework.js", source }]);
    expect(findings).toEqual([]);
  });

  /**
   * The same collision, named. Captured verbatim from
   * `.next/static/chunks/2o7ivrfewh24i.js` on the 2026-09-03 build and inlined
   * rather than read, because a build artifact is not a fixture. The test above
   * catches this against a real file; this one exists so that when it breaks,
   * the failure points straight at the cause.
   */
  it("does not flag React's `n3={}` / `n3=document.createElement` DOM code", () => {
    const reactMinifiedDomCode =
      'transitionend:n0("Transition","TransitionEnd")},n2={},n3={};' +
      "function n4(e){if(n2[e])return n2[e];if(!n1[e])return e;var t,n=n1[e];" +
      "for(t in n)if(n.hasOwnProperty(t)&&t in n3)return n2[e]=n[t];return e}" +
      'tU&&(n3=document.createElement("div").style,"AnimationEvent"in window||' +
      "(delete n1.animationend.animation,delete n1.animationiteration.animation," +
      'delete n1.animationstart.animation),"TransitionEvent"in window||' +
      'delete n1.transitionend.transition);var n6=n4("animationend");';

    const findings = findStudioDeps([
      { name: "static/chunks/2o7ivrfewh24i.js", source: reactMinifiedDomCode },
    ]);
    expect(
      findings,
      'the "n3" substring in React\'s minified DOM code was read as the n3 RDF library',
    ).toEqual([]);
  });
});

describe("BANNED_DEPS", () => {
  /**
   * The floor on marker length, and why these two numbers.
   *
   * Measured 2026-09-04 over the 9 files of `.next/static/chunks/*.js` this
   * project's own build emits — 599,640 bytes, 108,076 identifier tokens, 4,985
   * distinct. Distinct tokens by length, 1 through 10: 54, 1614, 170, 246, 260,
   * 267, 267, 272, 238, 179. 2,107 of them are 8 characters or longer; the
   * longest is 63.
   *
   * The 54 is the number that demonstrates mangling. It is the base-54
   * identifier alphabet — `$`, `_` and the 52 letters — completely exhausted,
   * every single-character name in use, 49,320 times between them. A mangler
   * allocates shortest-first and only spills into length n when length n-1 runs
   * out, so an 8-character generated name would need on the order of 54^7 live
   * names in one scope. It does not happen.
   *
   * So:
   *   - a marker shaped like a JS identifier must be >= 8 characters, because
   *     at that length a mangler cannot SYNTHESISE the token. Every one of
   *     those 2,107 long tokens is a name the toolchain had to PRESERVE.
   *   - a marker containing a character that cannot appear in an identifier
   *     (`-`, `/`, `.`, `[`, a space) can never be synthesised whole by name
   *     mangling at any length, so 6 is enough.
   *
   * "n3" fails both, which is the point.
   *
   * An earlier revision of this comment gave the histogram as "7483 mangled
   * identifiers of 1 character, 1839 of 2, 14 of 3, 546 of 4, and nothing
   * mangled longer — the only tokens above 6 characters are real DOM names",
   * and justified the floor as "double the longest observed". It does not
   * reproduce: there are 267 distinct 7-character and 272 distinct 8-character
   * tokens, and they are mostly Next's own preserved identifiers rather than
   * DOM names — `onlyHashChange`, `hashFragment`, `scrollBehavior`,
   * `inspectSource`, `TURBOPACK`. The floor is right; that was not the reason.
   *
   * And length alone is not safety. A preserved name can be an ordinary word:
   * `Fragment`, `Provider`, `Response`, `Infinity`, `charset` and `imagesizes`
   * are all in these chunks. A marker has to be a name only the banned library
   * would preserve, not merely a long one.
   */
  const IDENTIFIER_SHAPED = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  const floorFor = (marker: string) => (IDENTIFIER_SHAPED.test(marker) ? 8 : 6);

  it("has no marker short enough to be a minified identifier", () => {
    const deps = bannedDeps();
    // Guards the `every`-style assertions below against a list that shrank.
    expect(deps.length).toBeGreaterThanOrEqual(8);

    const withoutMarkers = deps.filter((d) => !Array.isArray(d.markers) || d.markers.length === 0);
    expect(
      withoutMarkers.map((d) => d.name),
      "a dep with no markers can never be detected",
    ).toEqual([]);

    const markers = deps.flatMap((d) => d.markers.map((marker) => ({ dep: d.name, marker })));
    expect(markers.length).toBeGreaterThanOrEqual(deps.length);

    const tooShort = markers.filter(({ marker }) => marker.length < floorFor(marker));
    expect(
      tooShort,
      "these markers are short enough to collide with a mangled identifier — that is how " +
        'grepping for "n3" flags React',
    ).toEqual([]);
  });

  /**
   * ...and no marker may be the bare, all-lowercase package name.
   *
   * The all-lowercase qualifier is deliberate. A minifier generates lowercase
   * identifiers, so `n3`, `vaul` and `cmdk` as markers are collisions waiting
   * to happen; a CamelCase export name is not something mangling produces. It
   * also happens to be the marker that works: the string "exifreader" appears
   * nowhere in `exif-reader.js` — only "ExifReader" does — so the bare package
   * name is usually both the most dangerous choice and the one that does not
   * even match.
   */
  it("has no marker that is just the bare, lowercase package name", () => {
    const deps = bannedDeps();
    expect(deps.length).toBeGreaterThanOrEqual(8);

    const bare = deps.flatMap((d) =>
      d.markers
        .filter(
          (marker) =>
            IDENTIFIER_SHAPED.test(marker) &&
            marker === marker.toLowerCase() &&
            norm(marker) === norm(d.name),
        )
        .map((marker) => ({ dep: d.name, marker })),
    );
    expect(bare).toEqual([]);
  });

  /**
   * The list has to match the boundary the project already draws, so the two
   * cannot drift apart. The eslint side is read out of the config at runtime
   * rather than copied, exactly as test/guardrails.test.ts does with the ACL
   * primitives.
   *
   * RE-DERIVE BOTH SIDES WHEN A STUDIO DEPENDENCY IS ADDED. A dependency added
   * to the studio and to neither list is invisible to every check here.
   */
  function publicBoundarySpecifiers(): string[] {
    const entries = eslintConfig as Array<{
      files?: string[];
      rules?: Record<string, unknown>;
    }>;
    const specifiers = entries
      .filter((entry) =>
        (entry.files ?? []).some(
          (f) => f.startsWith("app/(public)") || f.startsWith("components/public"),
        ),
      )
      .flatMap((entry) => {
        const rule = entry.rules?.["no-restricted-imports"];
        if (!Array.isArray(rule)) return [];
        return (
          rule.slice(1) as Array<{
            paths?: Array<{ name?: string }>;
            patterns?: Array<{ group?: string[] }>;
          }>
        ).flatMap((option) => [
          ...(option.paths ?? []).map((p) => p.name ?? ""),
          ...(option.patterns ?? []).flatMap((p) => p.group ?? []),
        ]);
      })
      // Only npm packages. The relative patterns (`**/lib/studio/**`,
      // `**/(studio)/**`) are our own source, which is not what a chunk scan
      // looks for.
      .filter((s) => s !== "" && !s.startsWith("**/") && !s.startsWith(".") && !s.includes("("))
      .map(norm);
    return [...new Set(specifiers)];
  }

  it("covers every npm package the public/studio import boundary already bans", () => {
    const specifiers = publicBoundarySpecifiers();
    // If the extraction broke it would return [] and "nothing uncovered" would
    // be vacuously true.
    expect(specifiers.length).toBeGreaterThanOrEqual(5);
    expect(specifiers).toContain("vaul");
    expect(specifiers).toContain("exifreader");
    expect(specifiers).toContain("inrupt/solid-client-authn-browser");

    const deps = bannedDeps();
    const uncovered = specifiers.filter((s) => !deps.some((d) => covers(d.name, s)));
    expect(
      uncovered,
      "eslint.config.mjs bans these from a public route, so a chunk scan must be able to " +
        "recognise them in a chunk",
    ).toEqual([]);
  });

  it("covers the studio surface the size ceiling alone cannot police", () => {
    const deps = bannedDeps();
    const required = [
      // CLAUDE.md, Map: one MapLibre instance, lazy-mounted on intersection.
      // Lazy means it must not be in a public page's initial chunks at all —
      // and at 252.8 kB gzip bundled it is the one leak the ceiling would
      // catch. It is listed anyway so the check does not depend on the ceiling.
      "maplibre-gl",
      // CLAUDE.md, hard rules: lib/pod/read.ts is unauthenticated and shared,
      // and the RDF stack that parses Turtle runs on the server. n3 in a client
      // chunk means the read path was pulled into the browser. This is also the
      // dep whose name produces the false positive above.
      "n3",
      // eslint.config.mjs public block + the ACL ban list.
      "@inrupt/solid-client",
      "@inrupt/solid-client-authn-browser",
      // eslint.config.mjs public block: "Image-processing code is studio-only".
      "exifreader",
      // eslint.config.mjs public block: shadcn/Radix is studio-only.
      "@radix-ui",
      "vaul",
      "sonner",
      "cmdk",
    ];
    const missing = required.filter((r) => !deps.some((d) => covers(d.name, r)));
    expect(missing).toEqual([]);
  });
});

describe("findStudioDeps: a leak is caught at any size", () => {
  /** The headroom the raised ceiling leaves: 190 kB budget, 176.3 kB worst
   *  public route. Anything smaller than this is invisible to the size check. */
  const CEILING_HEADROOM_BYTES = Math.round((190 - 176.3) * 1024);

  it("flags 512 bytes of real exifreader hidden in half a megabyte of React", () => {
    const clean = realSource(FRAMEWORK.reactDomClient);
    const chunkName = "static/chunks/app/(public)/page-4f2a1c.js";

    // The control. If this were not clean the test below would prove nothing
    // about the leak.
    expect(findStudioDeps([{ name: chunkName, source: clean }])).toEqual([]);

    const leak = realSource(EXIFREADER_BUILD).slice(0, 512);
    expect(leak.length).toBe(512);

    const at = 100_000;
    const leaked = clean.slice(0, at) + leak + clean.slice(at);
    // The mutation happened: a splice that silently no-opped would re-run the
    // control and report a pass.
    expect(leaked.length).toBe(clean.length + 512);
    expect(leaked).not.toBe(clean);

    const findings = findStudioDeps([{ name: chunkName, source: leaked }]);
    const hit = findings.find(
      (f) => f.chunk === chunkName && matchesGroup(f.dep, ["exifreader", "exif-reader"]),
    );
    expect(
      hit,
      `512 bytes of the real exifreader build went undetected. Findings: ` +
        `${JSON.stringify(findings.slice(0, 5))}`,
    ).toBeDefined();
    // The finding names the dep and the chunk, and its marker really came from
    // the leak rather than from the surrounding React.
    expect(hit!.dep).toBeTruthy();
    expect(leak).toContain(hit!.marker);
    expect(clean).not.toContain(hit!.marker);

    // And the reason this check has to exist: the size budget cannot see it.
    const delta = gzipSync(Buffer.from(leaked)).length - gzipSync(Buffer.from(clean)).length;
    expect(delta).toBeLessThan(CEILING_HEADROOM_BYTES);
  });

  it("flags a 1 kB window of real vaul drawer code in the same chunk", () => {
    const clean = realSource(FRAMEWORK.reactDomClient);
    const chunkName = "static/chunks/app/(public)/trips-9b3e7d.js";

    const vaul = realSource("node_modules/vaul/dist/index.mjs");
    // A window of runtime component code, not the import header — that is what
    // a partial leak actually looks like once a bundler has been through it.
    const anchor = vaul.indexOf("data-vaul-drawer");
    expect(anchor, "vaul no longer contains data-vaul-drawer").toBeGreaterThan(0);
    const leak = vaul.slice(Math.max(0, anchor - 512), anchor + 512);
    expect(leak.length).toBeLessThanOrEqual(1024);
    expect(leak.length).toBeGreaterThan(512);

    const leaked = clean + leak;
    expect(leaked.length).toBe(clean.length + leak.length);

    const findings = findStudioDeps([{ name: chunkName, source: leaked }]);
    const hit = findings.find((f) => f.chunk === chunkName && matchesGroup(f.dep, ["vaul"]));
    expect(
      hit,
      `1 kB of the real vaul build went undetected. Findings: ${JSON.stringify(findings.slice(0, 5))}`,
    ).toBeDefined();
    expect(leak).toContain(hit!.marker);

    const delta = gzipSync(Buffer.from(leaked)).length - gzipSync(Buffer.from(clean)).length;
    expect(delta).toBeLessThan(CEILING_HEADROOM_BYTES);
  });

  it("names every (dep, chunk) pair when two chunks leak", () => {
    const exif = realSource(EXIFREADER_BUILD).slice(0, 512);
    const sonner = realSource("node_modules/sonner/dist/index.mjs");

    const findings = findStudioDeps([
      { name: "static/chunks/a.js", source: realSource(FRAMEWORK.react) + exif },
      { name: "static/chunks/b.js", source: realSource(FRAMEWORK.scheduler) + sonner },
    ]);

    expect(
      findings.some(
        (f) =>
          f.chunk === "static/chunks/a.js" && matchesGroup(f.dep, ["exifreader", "exif-reader"]),
      ),
    ).toBe(true);
    expect(
      findings.some((f) => f.chunk === "static/chunks/b.js" && matchesGroup(f.dep, ["sonner"])),
    ).toBe(true);
    // Findings are per (dep, chunk): the exifreader hit must not be attributed
    // to the chunk that does not contain it, or the CI output sends someone to
    // the wrong file.
    expect(
      findings.some(
        (f) =>
          f.chunk === "static/chunks/b.js" && matchesGroup(f.dep, ["exifreader", "exif-reader"]),
      ),
    ).toBe(false);
  });
});

describe("findStudioDeps: an empty scan is not a pass", () => {
  /**
   * `scripts/check-public-bundle.ts` already refuses to pass on a measurement
   * of nothing: "A budget that measures nothing must fail, not pass." The same
   * hole exists here in a nastier form, because with a `Finding[]` return type
   * "clean" and "nothing was scanned" are the same value — `[]`.
   *
   * The honest shape, given that return type, is for zero chunks to be a hard
   * error rather than an answer: there is no way to encode "I did not look" in
   * an array of findings, and a caller that forgets to check `chunks.length`
   * gets a green run out of a broken extraction. The alternative shape would be
   * to return `{ scanned, findings }` and make the caller read `scanned`; that
   * is defensible too, but it puts the guard back in the caller, which is where
   * it was missed the first time.
   */
  it("refuses to answer for zero chunks", () => {
    // Ordering matters: this call fails the test outright if findStudioDeps is
    // missing, so the expect(...).toThrow() below cannot pass just because the
    // export does not exist yet.
    const cleanAnswer = findStudioDeps([
      { name: "static/chunks/framework.js", source: realSource(FRAMEWORK.reactDomClient) },
    ]);
    expect(cleanAnswer).toEqual([]);

    expect(
      () => findStudioDeps([]),
      "zero chunks returned the same value as a clean scan — a scan that looked at nothing " +
        "would report the public bundle as clean",
    ).toThrow(/chunk/i);
  });

  it("refuses to answer when every chunk is empty", () => {
    const cleanAnswer = findStudioDeps([
      { name: "static/chunks/framework.js", source: realSource(FRAMEWORK.reactDomClient) },
    ]);
    expect(cleanAnswer).toEqual([]);

    // The failure mode the script's own comment describes: Next changes how it
    // emits script references, the extraction matches nothing, every chunk
    // comes through empty and the check reports clean.
    expect(() =>
      findStudioDeps([
        { name: "static/chunks/a.js", source: "" },
        { name: "static/chunks/b.js", source: "" },
      ]),
    ).toThrow(/chunk|empt/i);
  });
});

// ------------------------------------------------ the steps `main` is made of

/**
 * `main` was 94 code lines behind an `eslint-disable`, and none of its steps
 * had a test of its own: the sibling CLI file spawns the whole command, which
 * pins the verdict and the exit code but not the arithmetic underneath. These
 * cases pin each printed step at the seam Stage C splits `main` on.
 */

/** The builds below synthesise their own `.next` under a temp directory. That
 *  is a fixture; the rule against reading the repository's own build holds. */
const stepRoots: string[] = [];

afterAll(() => {
  for (const dir of stepRoots) rmSync(dir, { recursive: true, force: true });
});

/** How the page names the chunk. `module` is the shape the extraction does NOT
 *  match — that URL ends `.mjs"` — which is the page-measured-nothing case. */
type Ref = { chunk: string; via?: "src" | "href" | "module" };

function pageHtml(refs: Ref[]): string {
  const tag = (r: Ref) => {
    if (r.via === "href") return `<link rel="preload" as="script" href="/_next/${r.chunk}"/>`;
    if (r.via === "module") return `<script type="module" src="/_next/${r.chunk}"></script>`;
    return `<script src="/_next/${r.chunk}" async=""></script>`;
  };
  return `<!DOCTYPE html><html lang="en"><head></head><body>${refs.map(tag).join("")}</body></html>`;
}

/** A root holding chunk files under `.next` and the prerendered HTML that names
 *  them. Page keys are root-relative, as `publicPages()` yields them. */
function buildRoot(chunks: Record<string, string>, pages: Record<string, Ref[]>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wig-bundle-steps-")));
  stepRoots.push(root);
  for (const [name, content] of Object.entries(chunks)) {
    const file = join(root, ".next", name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  for (const [page, refs] of Object.entries(pages)) {
    const file = join(root, page);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, pageHtml(refs));
  }
  return root;
}

/** Printing is half of what each step does, so the output is an assertion and
 *  not noise. The real console comes back even when the step throws. */
function capture<T>(run: () => T): { value: T; lines: string[] } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  try {
    return { value: run(), lines };
  } finally {
    spy.mockRestore();
  }
}

/** A measurement with no gaps in it, so each case below introduces exactly one. */
const measurement = (over: Partial<Measurement> = {}): Measurement => ({
  worst: { page: "index.html", bytes: 95_000 },
  chunks: new Map([["static/chunks/framework.js", "clean"]]),
  unresolved: [],
  noScripts: [],
  ...over,
});

const FRAMEWORK_CHUNK = "static/chunks/framework-0a1b2c.js";
const PAGE_CHUNK = "static/chunks/page-4d5e6f.js";
const gzipLen = (source: string) => gzipSync(Buffer.from(source)).length;

describe("measurePages: the per-page ledger", () => {
  const chunks: Record<string, string> = {
    [FRAMEWORK_CHUNK]: realSource(FRAMEWORK.reactDomClient),
    [PAGE_CHUNK]: realSource(FRAMEWORK.react),
  };

  it("sums the gzip bytes of the chunks a page names, and dedupes across pages", () => {
    const root = buildRoot(chunks, {
      "index.html": [
        { chunk: FRAMEWORK_CHUNK, via: "href" },
        { chunk: FRAMEWORK_CHUNK },
        { chunk: PAGE_CHUNK },
      ],
      "trips/2026-japan.html": [{ chunk: FRAMEWORK_CHUNK }],
    });

    const { value, lines } = capture(() =>
      step("measurePages")(["index.html", "trips/2026-japan.html"], root),
    );

    // The number it reports is the gzip sum of that page's chunks. A report
    // that is not that is a report nobody can act on.
    const expected = gzipLen(chunks[FRAMEWORK_CHUNK]) + gzipLen(chunks[PAGE_CHUNK]);
    expect(expected).toBeGreaterThan(50 * 1024);
    expect(value.worst).toEqual({ page: "index.html", bytes: expected });

    // Deduped: the framework chunk is named three times across the two pages,
    // and every chunk that was weighed is kept for the composition scan.
    expect([...value.chunks.keys()].sort()).toEqual([FRAMEWORK_CHUNK, PAGE_CHUNK]);
    expect(value.chunks.get(PAGE_CHUNK)).toBe(chunks[PAGE_CHUNK]);
    expect(value.unresolved).toEqual([]);
    expect(value.noScripts).toEqual([]);

    // One ledger line per page, and the file count is the deduped ref count.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/kB gzip {2}2 files {2}index\.html$/);
    expect(lines[1]).toMatch(/kB gzip {2}1 files {2}trips\/2026-japan\.html$/);
  });

  it("records a reference that is not on disk rather than skipping it", () => {
    const root = buildRoot(
      { [FRAMEWORK_CHUNK]: chunks[FRAMEWORK_CHUNK] },
      {
        "index.html": [{ chunk: FRAMEWORK_CHUNK }, { chunk: "static/chunks/2f8a1b0c.js" }],
      },
    );

    const { value } = capture(() => step("measurePages")(["index.html"], root));

    expect(value.unresolved).toEqual([
      { page: "index.html", ref: "/_next/static/chunks/2f8a1b0c.js" },
    ]);
    // The chunk that IS there was still weighed and still scanned.
    expect(value.worst.bytes).toBe(gzipLen(chunks[FRAMEWORK_CHUNK]));
    expect([...value.chunks.keys()]).toEqual([FRAMEWORK_CHUNK]);
  });

  it("records a page it extracted no script reference from", () => {
    const root = buildRoot(
      { "static/chunks/page-esm-8b7a6d.mjs": chunks[PAGE_CHUNK] },
      { "trips/2026-japan.html": [{ chunk: "static/chunks/page-esm-8b7a6d.mjs", via: "module" }] },
    );

    // The fixture is only this case if the extraction really does miss the
    // reference: it requires the URL to end `.js"`, and `.mjs"` does not.
    const html = readFileSync(join(root, "trips", "2026-japan.html"), "utf8");
    expect(html).toContain("/_next/static/chunks/page-esm-8b7a6d.mjs");
    expect([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)]).toHaveLength(0);

    const { value } = capture(() => step("measurePages")(["trips/2026-japan.html"], root));

    expect(value.noScripts).toEqual(["trips/2026-japan.html"]);
    expect(value.worst.bytes).toBe(0);
    expect(value.chunks.size).toBe(0);
  });

  it("weighs a chunk the page only preloads with href=", () => {
    const root = buildRoot(
      { "static/chunks/preloaded-7c6b5a.js": chunks[PAGE_CHUNK] },
      { "index.html": [{ chunk: "static/chunks/preloaded-7c6b5a.js", via: "href" }] },
    );

    const { value } = capture(() => step("measurePages")(["index.html"], root));

    expect([...value.chunks.keys()]).toEqual(["static/chunks/preloaded-7c6b5a.js"]);
    expect(value.worst.bytes).toBe(gzipLen(chunks[PAGE_CHUNK]));
  });
});

describe("reportMeasurementGaps: a run that measured less than it reported", () => {
  it("passes a measurement with no gaps in it, and prints nothing", () => {
    const { value, lines } = capture(() => step("reportMeasurementGaps")(measurement()));
    expect(value).toEqual({ failed: false, measuredNothing: false });
    expect(lines).toEqual([]);
  });

  it("fails and names every reference it could not read", () => {
    const { value, lines } = capture(() =>
      step("reportMeasurementGaps")(
        measurement({ unresolved: [{ page: "index.html", ref: "/_next/static/chunks/2f8a.js" }] }),
      ),
    );

    expect(value).toEqual({ failed: true, measuredNothing: false });
    expect(lines.join("\n")).toContain("2f8a.js");
    expect(lines.join("\n")).toContain("index.html");
  });

  it("fails and names every page it extracted no script from", () => {
    const { value, lines } = capture(() =>
      step("reportMeasurementGaps")(measurement({ noScripts: ["trips/2026-japan.html"] })),
    );

    expect(value).toEqual({ failed: true, measuredNothing: false });
    expect(lines.join("\n")).toContain("trips/2026-japan.html");
  });

  it("reports measuring nothing at all as fatal, not as one more gap", () => {
    const { value, lines } = capture(() =>
      step("reportMeasurementGaps")(measurement({ worst: { page: "", bytes: 0 } })),
    );

    expect(value.measuredNothing, "a budget that measures nothing must fail").toBe(true);
    expect(lines.join("\n")).toMatch(/0 bytes/i);
  });
});

describe("reportSize: the ceiling report", () => {
  it("returns kB and prints the worst route beside the budget", () => {
    // 180,531 bytes is 176.3 kB — the measured worst public route of 2026-09-03.
    const { value, lines } = capture(() =>
      step("reportSize")({ page: "trips/2026-japan.html", bytes: 180_531 }),
    );

    expect(value).toBeCloseTo(180_531 / 1024, 6);
    const printed = lines.join("\n");
    expect(printed).toContain("trips/2026-japan.html");
    expect(printed).toMatch(/worst public route: 176\.3 kB gzip/);
    expect(printed).toMatch(new RegExp(`budget: +${step("LIMIT_KB")} kB`));
  });
});

describe("reportComposition: the dependency ledger", () => {
  it("names every banned dep, and returns the finding for the one that leaked", () => {
    const clean = realSource(FRAMEWORK.react);
    const leak = realSource(EXIFREADER_BUILD).slice(0, 512);
    // The control, in both directions, so the leak is what the case is about.
    expect(clean).not.toContain("ExifReader");
    expect(leak).toContain("ExifReader");

    const { value, lines } = capture(() =>
      step("reportComposition")(
        new Map([
          ["static/chunks/framework.js", clean],
          ["static/chunks/page.js", clean + leak],
        ]),
        2,
      ),
    );

    expect(
      value.some(
        (f) => f.chunk === "static/chunks/page.js" && matchesGroup(f.dep, ["exifreader"]),
      ),
      `the leak was not returned to the caller. Findings: ${JSON.stringify(value)}`,
    ).toBe(true);

    const printed = lines.join("\n");
    expect(printed).toMatch(/scanned 2 chunks across 2 pages/);
    expect(printed).toMatch(/FOUND in static\/chunks\/page\.js \(ExifReader\)/);
    // Every dep is reported as looked at, not merely the one that fired.
    for (const dep of bannedDeps()) expect(printed).toContain(dep.name);
    expect((printed.match(/absent/g) ?? []).length).toBe(bannedDeps().length - 1);
  });

  it("refuses to answer for an empty chunk map", () => {
    // Printing "absent" for every dep after scanning nothing is the one answer
    // that cannot be right — the same rule findStudioDeps enforces.
    expect(() => capture(() => step("reportComposition")(new Map(), 3))).toThrow(/chunk/i);
  });
});

describe("reportViolations: the verdict", () => {
  const FINDING = { dep: "maplibre-gl", chunk: "static/chunks/page-9f8e7d.js", marker: "maplibregl" };

  it("passes a clean scan under the ceiling, and prints nothing", () => {
    const { value, lines } = capture(() => step("reportViolations")([], step("LIMIT_KB") - 1));
    expect(value).toBe(false);
    expect(lines).toEqual([]);
  });

  it("treats a route measuring exactly the budget as within it", () => {
    const { value } = capture(() => step("reportViolations")([], step("LIMIT_KB")));
    expect(value, "the comparison is strictly greater-than").toBe(false);
  });

  it("fails a route over the ceiling, and calls it weight rather than a leak", () => {
    const { value, lines } = capture(() => step("reportViolations")([], step("LIMIT_KB") + 1));
    expect(value).toBe(true);
    expect(lines.join("\n")).toMatch(/Over budget/);
    expect(lines.join("\n")).not.toMatch(/studio-only dependency reached a public route/);
  });

  it("fails a finding under the ceiling, naming dep, chunk and marker", () => {
    const { value, lines } = capture(() =>
      step("reportViolations")([FINDING], step("LIMIT_KB") - 1),
    );

    expect(value).toBe(true);
    const printed = lines.join("\n");
    expect(printed).toContain("maplibre-gl");
    expect(printed).toContain("static/chunks/page-9f8e7d.js");
    expect(printed).toContain('"maplibregl"');
    expect(printed, "a 2 kB leak is not a size problem").not.toMatch(/Over budget/);
  });

  it("reports both when a route is over the ceiling AND leaking", () => {
    const { value, lines } = capture(() =>
      step("reportViolations")([FINDING], step("LIMIT_KB") + 40),
    );

    expect(value).toBe(true);
    expect(lines.join("\n")).toMatch(/Over budget/);
    expect(lines.join("\n")).toContain("maplibre-gl");
  });
});

describe("findLazyChunks: the positive control that size:public otherwise lacks", () => {
  const markers = ["maplibregl"];

  it("finds the lazy chunk and reports no leak when no page references it", () => {
    const chunks = [
      { name: "static/chunks/9021.js", source: "var maplibregl={};" },
      { name: "static/chunks/main.js", source: "console.log(1)" },
    ];
    const result = findLazyChunks(chunks, new Set(["static/chunks/main.js"]), markers);
    expect(result.present).toEqual(["static/chunks/9021.js"]);
    expect(result.leaked).toEqual([]);
  });

  it("reports a leak when a page's HTML references the chunk, which is the import escaping the effect", () => {
    const chunks = [{ name: "static/chunks/9021.js", source: "var maplibregl={};" }];
    const result = findLazyChunks(chunks, new Set(["static/chunks/9021.js"]), markers);
    expect(result.leaked).toEqual(["static/chunks/9021.js"]);
  });

  it("reports no chunk at all, which is the case that means there is no map", () => {
    const chunks = [{ name: "static/chunks/main.js", source: "console.log(1)" }];
    expect(findLazyChunks(chunks, new Set(), markers).present).toEqual([]);
  });

  it("refuses to answer for zero chunks, the same way findStudioDeps does", () => {
    // An empty scan is not a pass — a build that produced nothing must not
    // report "lazy and correct".
    expect(() => findLazyChunks([], new Set(), markers)).toThrow(/no chunks/i);
  });
});

describe("the module is importable and pure", () => {
  /**
   * Importing the detector must not run the CLI and must not read `.next`.
   *
   * Checked by copying the script to a temp directory — where `.next` does not
   * exist, exactly like a clean checkout — and importing it in a child process
   * on the same Node binary vitest is running on. If it reads the build output
   * at import time it throws ENOENT; if it runs the CLI it prints the budget
   * report or exits non-zero. Either way the sentinel never arrives.
   *
   * A spy in-process could not prove the `.next` half of this, because `.next`
   * exists in this working tree.
   */
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wig-bundle-purity-"));
    mkdirSync(join(dir, "scripts"), { recursive: true });
    copyFileSync(resolve(ROOT, MODULE), join(dir, "scripts", basename(MODULE)));
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("runs no CLI and reads no build output when imported", () => {
    const target = pathToFileURL(join(dir, "scripts", basename(MODULE))).href;
    let stdout = "";
    let status = 0;
    try {
      stdout = execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          `const m = await import(${JSON.stringify(target)});` +
            `console.log("SENTINEL:" + Object.keys(m).sort().join(","));`,
        ],
        // cwd is the repo so `tsx` resolves; the module under import is not.
        { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (error) {
      const e = error as { status?: number; stdout?: string; stderr?: string };
      status = e.status ?? 1;
      // Vitest parses an assertion message as part of the error stack, so a
      // child stack trace pasted in verbatim sends its own frame-resolution
      // through node_modules and it blows up reading a bundled inline source
      // map. Defanged, still readable.
      stdout = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.replace(/^\s+at\s+/gm, "      | ");
    }

    expect(status, `importing ${MODULE} from a directory without .next failed:\n${stdout}`).toBe(0);
    expect(stdout).toContain("SENTINEL:");
    // The CLI's own output. None of it may appear on an import.
    for (const cliOutput of [
      "kB gzip",
      "within budget",
      "budget:",
      "No public pages",
      "Over budget",
    ]) {
      expect(stdout, `${MODULE} ran its CLI on import`).not.toContain(cliOutput);
    }
    // And the exports the rest of this file needs are actually there.
    expect(stdout).toContain("BANNED_DEPS");
    expect(stdout).toContain("findStudioDeps");
    expect(stdout).toContain("findLazyChunks");
  });
});

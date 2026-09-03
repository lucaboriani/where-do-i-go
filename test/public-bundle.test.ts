import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import eslintConfig from "../eslint.config.mjs";

/**
 * The dependency-composition guardrail on the public bundle.
 *
 * `scripts/check-public-bundle.ts` weighs the chunks a public page loads. The
 * ceiling is going 180 -> 190 kB because the worst public route measures
 * 176.3 kB, and 13.7 kB of headroom is more than enough room for a small studio
 * dependency to slip in unnoticed: `cmdk` is 11.0 kB gzip, `sonner` 28.9,
 * `vaul` 33.9 — only the last of those would trip a size budget, and only
 * barely. Weight is the wrong question. The right question is "is this
 * dependency here at all", asked by NAME, at any size.
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
type Mod = {
  BANNED_DEPS?: BannedDep[];
  findStudioDeps?: (chunks: Chunk[]) => Finding[];
};

// ---------------------------------------------------------------- the module

let mod: Mod = {};
let loadError: unknown;

beforeAll(async () => {
  // The script runs its whole CLI at import time today. That is the thing the
  // refactor has to remove, and the child-process test at the bottom is what
  // asserts it. These two spies only stop the CLI printing over the test output
  // or killing the worker with process.exit() in the meantime.
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`${MODULE} called process.exit(${code}) while being imported`);
  }) as never);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    mod = (await import("../scripts/check-public-bundle")) as unknown as Mod;
  } catch (error) {
    loadError = error;
  } finally {
    log.mockRestore();
    exit.mockRestore();
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

function bannedDeps(): BannedDep[] {
  if (loadError) throw loadError;
  const list = mod.BANNED_DEPS;
  if (!Array.isArray(list)) {
    throw new Error(`${MODULE} does not export BANNED_DEPS: { name, markers }[].`);
  }
  return list;
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
    // `radix-ui/dist/index.mjs` is a re-export shim — nothing of it survives
    // bundling. Two real primitives instead, both of which carry runtime
    // literals (`--radix-popper-*`, `data-radix-scroll-area-viewport`).
    aliases: ["@radix-ui", "radix-ui", "radix"],
    files: [
      "node_modules/@radix-ui/react-popper/dist/index.mjs",
      "node_modules/@radix-ui/react-scroll-area/dist/index.mjs",
    ],
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
   * Measured against the chunks this project's own build emits: of every
   * assigned identifier in `.next/static/chunks/*.js`, 7483 are 1 character,
   * 1839 are 2, 14 are 3, 546 are 4, and nothing mangled is longer — the only
   * tokens above 6 characters are real DOM names the minifier had to preserve
   * (`charset`, `crossorigin`, `imagesizes`, `imagesrcset`, `Infinity`).
   *
   * So:
   *   - a marker shaped like a JS identifier must be >= 8 characters, double
   *     the longest mangled identifier observed, with room for the minifier to
   *     get greedier;
   *   - a marker containing a character that cannot appear in an identifier
   *     (`-`, `/`, `.`, `[`, a space) can never be synthesised whole by name
   *     mangling, so 6 is enough.
   *
   * "n3" fails both, which is the point. `charset` and `imagesizes` in that
   * list are the reminder that a generic word is not safe either just because
   * it is long.
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
      // and at 777.9 kB gzip it is the one leak the ceiling would catch. It is
      // listed anyway so the check does not depend on the ceiling.
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
  });
});

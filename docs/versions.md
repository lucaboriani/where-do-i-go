# Dependency versions

Resolved against the npm registry on **2026-09-02**. Every version below is the
`latest` dist-tag as published on that date, except where a note says otherwise.

Re-resolve before starting work: your package manager's `outdated` command after install, or
query the registry
directly (`npm view <pkg> version`). Do not trust these numbers if the date above is more
than a few weeks stale — record what you actually installed by committing the lockfile.

## Runtime

| Package | Version | Notes |
|---|---|---|
| `next` | 16.3.4 | requires Node >= 20.9 |
| `react` | 19.2.8 | |
| `react-dom` | 19.2.8 | |
| `typescript` | **6.0.3** | not latest — see the conflict below |
| `tailwindcss` | 4.3.3 | CSS-first config, no `tailwind.config.js` theme block |
| `@tailwindcss/postcss` | 4.3.3 | |
| `maplibre-gl` | 6.6.0 | globe projection available since 5.0.0 |
| `react-map-gl` | 8.1.2 | **removed 2026-09-09, never imported** — see `docs/decisions.md` §25 |
| `@inrupt/solid-client` | 3.0.0 | `engines: ^20 \|\| ^22` — **excludes Node 24** |
| `@inrupt/solid-client-authn-browser` | 5.0.0 | declares no engines; pulls `authn-core` 5.0.0, which needs `^22 \|\| ^24` |
| `n3` | 2.7.2 | **required** — `scripts/validate-fixtures.ts` and the Pod read path both use it |
| `zod` | 4.5.4 | read-validation layer |
| `exifreader` | 4.44.0 | **not `exifr`** — see stale-package note |
| `sonner` | 2.0.8 | shadcn's toast replacement |
| `lucide-react` | 1.39.0 | |
| `vaul` | 1.1.2 | pulled in by shadcn's Drawer; last published 2024-12 |
| `class-variance-authority` | 0.7.1 | pulled in by shadcn; last published 2024-11 |
| `clsx` | 2.1.1 | |
| `tailwind-merge` | 3.6.0 | |

## Tooling

| Package | Version | Notes |
|---|---|---|
| `shadcn` (CLI) | 4.19.1 | run via `npx --yes shadcn@latest`; the old package name `shadcn-ui` is dead |
| `eslint` | **9.39.5** | not latest — see the ESLint conflict below |
| `eslint-config-next` | 16.3.4 | tracks the `next` version |
| `typescript-eslint` | 8.69.0 | **peer-declares `typescript >=4.8.4 <6.1.0`** |
| `@types/n3` | 1.26.3 | required — `n3` ships no type declarations of its own |
| `prettier` | 3.9.6 | |
| `vitest` | 4.1.11 | |
| `@vitest/coverage-v8` | 4.1.11 | match vitest exactly |
| `@testing-library/react` | 16.3.3 | |
| `@testing-library/jest-dom` | 7.0.1 | |
| `jsdom` | 30.0.1 | `engines: ^22.22.2 \|\| ^24.15.0 \|\| >=26` — sets the Node 22 floor |
| `@playwright/test` | 1.62.1 | login redirect flow only |
| `msw` | 2.15.0 | HTTP-level Pod faking |
| `@solid/community-server` | 7.2.0 | local Pod for dev and CI |

## Platform

- **Node 22 LTS — 22.23.2 or later, and below 23.** Pin it in `.nvmrc` and in the Netlify
  build image. See the engine conflict below; this is not interchangeable with Node 24.
- **Package manager: the deployer's choice** — npm, pnpm, yarn or bun. Pick one per checkout,
  commit its lockfile, and never mix two in the same tree. Examples throughout these docs are
  written with npm, which is the lockfile this tree commits; substitute the equivalent. Rationale in `docs/decisions.md` §21.

### The Node engine conflict — this is why it is 22, not 24

Corrected 2026-09-02 from the phase-0 spike. An earlier revision of this file said "Node 24
LTS. Satisfies every engine constraint above." That was wrong, and it was wrong in the
direction that breaks the one library doing every Pod read and write.

Resolved against the registry, the two binding declarations point in opposite directions:

| Package | `engines.node` | Excludes |
|---|---|---|
| `@inrupt/solid-client` 3.0.0 | `^20.0.0 \|\| ^22.0.0` | **Node 24** |
| `@inrupt/solid-client-authn-core` 5.0.0 | `^22.0.0 \|\| ^24.0.0` | **Node 20** |

`authn-core` arrives transitively via `@inrupt/solid-client-authn-browser@5.0.0`, which
declares no engines of its own, so nothing in the dependency you actually name warns you about
this. The intersection of the two ranges is the 22 line and nothing else.

Within 22.x, two packages set a floor — `jsdom@30.0.1` (`^22.22.2`) and `eslint@10.9.1`
(`^22.13.0`). The highest wins: **>= 22.22.2, < 23**. The current 22.x LTS is 22.23.2.

`size-limit@13.0.3` (`^22.18.0`) used to be a third, and its removal on 2026-09-05 does not
move the answer: `jsdom` was already the binding constraint and still is. Worth stating rather
than silently dropping, because "the floor came from a package we no longer depend on" is the
kind of thing that gets re-derived wrongly later.

npm treats `engines` as advisory rather than a hard gate, so Node 24 installs with an
`EBADENGINE` warning instead of failing. That makes this a supportedness decision, not a build
error: choosing 24 anyway means running `solid-client` on a Node version its maintainers do not
claim to support, and finding out at runtime.

**Upgrade trigger:** when `@inrupt/solid-client` publishes a release whose engine range admits
`^24`, move to Node 24 in a single dedicated commit and update this file. Check with
`npm view @inrupt/solid-client engines`.

## The ESLint conflict — read this before installing

Found in phase 0.5 by running it, not by reading version numbers.

**ESLint's `latest` is 10.9.1, and this project cannot use it.** `eslint-config-next@16.3.4`
declares a permissive `eslint >=9.0.0` peer, which looks fine — but it nests
`eslint-plugin-react@7.37.5`, whose own peer range stops at `^9.7`. Under ESLint 10 that plugin
crashes on the first file linted:

```
TypeError: Error while loading rule 'react/display-name':
contextOrFilename.getFilename is not a function
    at resolveBasedir (node_modules/eslint-config-next/node_modules/eslint-plugin-react/lib/util/version.js)
```

ESLint 10 removed a deprecated `context` API that `eslint-plugin-react` 7.x still calls. Nothing
in the top-level peer declarations predicts this, because the incompatible package is a
transitive dependency of the config, not of the project.

**So use ESLint 9.39.5**, which is what `create-next-app@16.3.4` installs anyway, and which
satisfies every other constraint: `eslint-config-next` wants `>=9.0.0`, `typescript-eslint@8.69.0`
wants `^8.57.0 || ^9.0.0 || ^10.0.0`. Verified: `lint` and `typecheck` both exit 0.

npm reports this only as `npm warn ERESOLVE overriding peer dependency` during install — easy to
scroll past, and the failure arrives later as a stack trace inside a linter rule. Do not take a
clean install as evidence that a version combination works.

**Upgrade trigger:** when `eslint-config-next` ships with an `eslint-plugin-react` that supports
ESLint 10, move up in a dedicated commit and update this file. Check with
`npm view eslint-config-next@latest dependencies` and the nested plugin's peer range.

## The TypeScript conflict — read this before installing

TypeScript's `latest` is **7.0.2**. `typescript-eslint@8.69.0`, the current stable, declares
a peer range of `typescript >=4.8.4 <6.1.0`, which **excludes 7.x**. There is no stable
typescript-eslint release that supports TypeScript 7 as of the resolution date; only
`canary` (`8.69.1-alpha.0`) and an unrelated `rc-v8` tag exist.

So "latest stable for everything" is not internally consistent right now. Three options:

1. **TypeScript 6.0.3 with typescript-eslint 8.69.0.** Everything works, type-aware lint
   rules included. This is what the tables above specify and what the project should start
   with.
2. TypeScript 7.0.2 and drop typescript-eslint. Loses the type-aware lint rules that enforce
   several guardrails in `CLAUDE.md`. Not worth it.
3. TypeScript 7.0.2 with a forced peer override. Unsupported combination, silent breakage
   likely in the parser. Do not.

**Upgrade trigger:** when typescript-eslint publishes a stable release whose peer range
admits `7.x`, move to TypeScript 7 in a single dedicated commit and update this file.
Check with `npm view typescript-eslint peerDependencies`.

## Stale packages, deliberately chosen anyway

Three dependencies have not been published in a long time. None is a blocker, but know
what you are accepting:

- **`exifr` was rejected.** Last published 2022-05. Replaced with **`exifreader` 4.44.0**
  (published 2026-08), which is actively maintained. If you find `exifr` in any generated
  code, it came from stale training data — replace it.
- **`vaul` 1.1.2** (2024-12) backs shadcn's Drawer, which is the mobile map sheet. Verify
  the snap-point API against current shadcn docs rather than blog posts. If it proves
  unmaintained or broken under React 19, the fallback is a hand-written sheet using CSS
  scroll-snap, which is a day of work, not a redesign.
- **`class-variance-authority` 0.7.1** (2024-11) is a shadcn transitive dependency. Small,
  stable, low risk.

## Things agents get wrong on this stack

### An agent shell hides a whole class of test failure. Verified 2026-09-06.

**`npm test` inside Claude Code is not `npm test` in a terminal, and the difference silently
changed a test result.** Claude Code sets `CLAUDECODE=1`; std-env reports that as `isAgent`, and
`vitest/dist/chunks/cac.*.js` `createCLI()` calls `disableDefaultColors()` when it sees it. So
vitest emits **no ANSI escapes** in an agent shell and **does** emit them everywhere else —
colour is the default, TTY or pipe, whenever `TERM` is set and is not `dumb`.

`test/network-guard.test.ts` spawns a child vitest and asserted `/Tests\s+1 failed/` against its
output. Styled, that summary is

```
\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m…
```

— `\s+` matches the spaces, hits the escape, and the match fails. It went red on GitHub Actions
and green in every agent-run check, including a full CI reproduction against a clean clone. It
was never a CI-only bug: any maintainer running `npm test` from an ordinary terminal would have
hit it on the first try.

**How to apply.** Two things follow, and the second is the general one:

- Never assert against another process's human-readable output without stripping ANSI first.
  `test/child-output.ts` has `stripAnsi()` for exactly this, and the spawn also sets `NO_COLOR`
  (tinyrainbow gates every colour path on `!("NO_COLOR" in env)`) so the failure message stays
  readable.
- **When a check passes locally and fails on CI, suspect the agent environment before suspecting
  the runner.** Reproducing CI faithfully — clean clone, `npm ci`, fresh Pod, CI's env vars, UTC
  — reproduced nothing here, because every one of those runs still carried `CLAUDECODE=1`. The
  command that actually reproduced it was `env -u CLAUDECODE -u AI_AGENT`. Reach for that early.


Training data skews old. Expect and reject all of the following:

- `npx shadcn-ui@latest` — wrong package name. It is `shadcn`.
- `npx tailwindcss init -p` and a `tailwind.config.js` with a `theme.extend` block — Tailwind
  v4 is CSS-first. Tokens go in the global stylesheet under `@theme`.
- `forwardRef` wrappers in shadcn components — removed. Current components use `data-slot`
  attributes as the styling hook.
- shadcn's `toast` component — deprecated in favour of `sonner`.
- HSL colour values in the shadcn theme — current base colours are OKLCH.
- `mapboxgl.*` calls or `mapbox-gl` imports — this project uses `maplibregl` from
  `maplibre-gl`. Any Mapbox reference is a hallucination from v1-era examples.
- `map.setProjection()` called before `style.load` — throws. Always inside the event handler.
- `zod` v3 syntax — the project is on v4.
- **A source file containing a literal NUL byte reads as clean to shell `grep`.** An agent
  writing `\u0000` into a file as a real NUL rather than an escape produces something `file(1)`
  calls `data`; `grep` then reports NO MATCH — not an error, and `grep -c` prints nothing at all
  — while `sed` and `cat` display it as ordinary text. Hit for real on 2026-09-04 while writing
  `app/(public)/api/revalidate/route.ts`. Scope, measured rather than assumed: this blinds
  **shell** inspection only. Node's `readFileSync(f, "utf8")` finds the matches, so the
  source-text guardrails that run inside vitest — the `"use cache"` directive scan, the
  studio-shell import bans, the marker scan in `check-public-bundle.ts` — are unaffected. The
  hazard is a human or agent grepping from a shell and believing the silence.
- **An unquoted fragment IRI in a `.env` file.** Next's env loader reads an unquoted `#` as the
  start of a comment, so `OWNER_WEBID=https://you.example/profile/card#me` is stored as
  `https://you.example/profile/card`. Measured 2026-09-04 with `@next/env`: quoted keeps the
  fragment, unquoted does not, and nothing warns. This bites every WebID, because a WebID is
  usually a fragment IRI — and it is worse than a crash. The read finds the profile document's
  own subject rather than the person, so it fails as "oidcIssuer: expected string, received
  undefined" with nothing pointing at a missing fragment; and where the issuer does sit on the
  document subject it does not fail at all — the studio comes up and `sameWebId` locks the owner
  out of their own diary over three characters. Quote the value. `.env.example` says so at
  `OWNER_WEBID`, which is where anyone configuring will actually look.
- `print.error()` in a custom MSW `onUnhandledRequest` callback, believed to fail the test. It
  does not, on msw 2.15: the `print` defaults were downgraded to printing only and, in the
  library's own words, "do not affect the frame resolution"
  (`node_modules/msw/lib/core/experimental/on-unhandled-frame.js`). Vitest does not fail on
  stderr, so the request goes to the live internet and the test passes. `test/setup.ts` throws
  instead, and `test/network-guard.test.ts` pins it. Two further details, measured rather than
  assumed: a thrown plain `Error` becomes a 500 "Unhandled Exception" *response*, not a rejected
  fetch — only msw's own unexported `InternalError` produces a network error — and since
  `lib/pod/read.ts` turns every non-2xx into a structured error and never throws, a test can
  receive that 500 and still pass. That is why the guard also sweeps in `afterEach`.

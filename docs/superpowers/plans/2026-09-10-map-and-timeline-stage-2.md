# Phase 4 — Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One MapLibre instance on the public trip pages — lazy-mounted on intersection, surviving navigation from trip to entry to entry, with the OpenStreetMap attribution unconditional and `setProjection` reduced to a single call site.

**Architecture:** The fences come first, because `lib/map/**` is currently restricted by nothing and the whole stage lives there. Then the instance hook, which owns the dynamic import and the lifecycle; then the client component, which owns the container and the IntersectionObserver; then the layout, which is the actual mechanism for "never remounted" — Next 16 preserves layout state across navigation, so a map in the `[slug]` layout survives every entry route beneath it. Last, the two things that stop this becoming a lie: a positive bundle control proving a MapLibre chunk exists that no public page references, and one Playwright spec, because jsdom has no WebGL.

**Tech Stack:** Node 22.23.2, Next 16 App Router, React 19, `maplibre-gl@6.6.0` (ESM, **named exports only**), Vitest 4, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-09-map-and-timeline-design.md` — §5 is this stage; §1 defines the two bundle controls that land here.

**Depends on:** Stage 1 (`docs/superpowers/plans/2026-09-09-map-and-timeline-stage-1.md`), merged as `e8690a2`. This stage consumes `buildBasemapStyle()` and `config.mapStyleUrl` and adds no new dependency.

## Global Constraints

- **Node 22.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`, then `node -v` must print `v22.23.2`. Every command here runs and passes on Node 20 too, which is why checking is a step you do.
- **`npm test` needs a Pod.** A Community Solid Server must answer on `localhost:3001` or the two `test/integration/` suites skip themselves and the run reports green having tested less than it says. **Do not kill a Pod you did not start.** The dead-port control is `TEST_POD=http://localhost:3999 npm test` — the integration suites read `process.env.TEST_POD ?? "http://localhost:3001"`, so the override proves the same thing without touching anyone's process. Measured baseline at this stage's base commit: **1471 passed / 2 todo / 0 skipped / 66 files** with the Pod up, **1435 passed / 36 skipped** with it pointed at a dead port.
- **`npm run test:e2e` IS required by this stage's diff**, and must be run as `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`. Note that the six gated paths in `CLAUDE.md` do **not** yet include `components/public/**` or `lib/map/**` — see Task 6, which records why deliberately rather than widening them.
- **`maplibre-gl` v6 has NO default export.** Measured against `node_modules/maplibre-gl/dist/maplibre-gl.mjs`'s export list: `Map`, `AttributionControl`, `NavigationControl`, `Marker`, `Popup` and ~200 more are named exports, and `import maplibregl from "maplibre-gl"` fails at runtime with *"does not provide an export named 'default'"*. Destructure what you need.
- **`maplibre-gl` may never be imported statically from a public path.** 252.8 kB gzip against 190 kB of budget. The only permitted static import is the stylesheet subpath `maplibre-gl/dist/maplibre-gl.css`. Everything else is `await import("maplibre-gl")` inside a handler, with types spelled `import("maplibre-gl").Map` inline — the base `no-restricted-imports` rule has no `allowTypeImports`, and that inline form is the honest spelling anyway, because the module genuinely is only available dynamically.
- **Arbitrary Tailwind values are banned outside `components/ui/**`**, and the guardrail reaches a class string held in a `const`. No `h-[60vh]`, no `aspect-[4/3]`. Use the scale (`h-96`) or a token.
- **Comment blocks in production code: hard bound six lines, and delimiter lines count** — a `/** … */` block has four lines of prose. Two blocks with no blank line between them are ONE run; a blank line resets it. The repository is at zero blocks over the bound and `npm run lint` runs `--max-warnings 0`.
- **Comment less; make the code readable instead.** Said by the owner on 2026-09-10, and the six-line bound is a ceiling on a comment that earned its place, not a target. Reach for a clearer name, a smaller function, or a `notes.md` anchor first. Keep a comment only when it carries a measurement, warns of a trap at the point of danger, or states a reason the code cannot. **The samples below still over-comment in places — treat their prose as explanation for the reader of this plan, and trim it as you type the code in.**
- **Longer explanation goes in a sibling `notes.md` behind an anchor**, with the code keeping `// <one line>; see ./notes.md#anchor`. An anchor that does not resolve fails `npm run check:structure`. The slug drops punctuation rather than hyphenating it and keeps `_` — check a slug against the tool, never reason about it.
- **One component, one folder.** `componentFoldersAreOwn()` in `scripts/check-structure.ts` fails any `.tsx` under `components/` whose folder is not named after it, or that has no `index.ts` beside it. `index.tsx` is exempt. A second `.tsx` in the same folder therefore cannot exist — a second *exported symbol from the same file* is fine.
- **Tests live beside their subject**, base name matching the part before the first dot.
- **Render functions: 130 tendency, 200 hard bound. `lib/**` and `scripts/**` functions: 50 tendency, 80 hard bound.** ESLint errors at the hard bound only.
- **No `eslint-disable`.** There is exactly one in the whole repository and `active exemptions — 0` must stay true.
- **`lib/` holds no React.** The hook lives in the component folder for that reason, not by accident.
- **Never remove the OpenStreetMap attribution control**, and no code path may make it conditional.
- **The `dy:` namespace is still `https://example.org/ns/traveldiary#`.** Nothing here touches a live Pod.

## File Structure

| File | Responsibility |
|---|---|
| `eslint.config.mjs` | `lib/map/**` and `lib/utils.ts` join the belt; `lib/map/**` gains the `maplibre-gl` fence; `.pod-data/**` joins `globalIgnores` |
| `test/guardrails.test.ts` | cases for the new fence entries, derived from the config rather than retyped |
| `components/public/trip-map/hooks/use-map-instance.ts` | the dynamic import, the instance, its one `setProjection`, its teardown |
| `components/public/trip-map/hooks/use-map-instance.test.ts` | the lifecycle, against a fake `maplibre-gl` |
| `components/public/trip-map/trip-map.tsx` | `"use client"` container, IntersectionObserver, the stylesheet import, `MAP_FRAME_CLASS` |
| `components/public/trip-map/trip-map.test.tsx` | lazy activation, the no-observer fallback, the reserved frame |
| `components/public/trip-map/index.ts` | the one-line barrel `componentFoldersAreOwn()` requires |
| `components/public/trip-map/notes.md` | why the import is bare-dynamic, why the fallback exists, what the `[slug]` measurement found |
| `app/(public)/trips/[slug]/layout.tsx` | server layout: reserves the frame, reads the index, renders the map above `children` |
| `app/(public)/trips/[slug]/layout.test.tsx` | the layout renders the frame without awaiting params on the shell path |
| `scripts/check-public-bundle.ts` | `findLazyChunks()` — the positive control |
| `test/public-bundle.test.ts` | cases for `findLazyChunks`, both directions |
| `e2e/trip-map.spec.ts` | canvas after scroll, attribution present, tiles stubbed |
| `TODO.md`, `docs/decisions.md` | the deferred e2e-gate decision, and §28 |

---

### Task 1: the fences, before any map code

`lib/map/**` exists now and is restricted by **nothing**. It is not in `eslint.config.mjs`'s belt block (the list of `lib/` modules a public page can reach, fenced from `@inrupt/*` and `lib/studio`), and it carries no `maplibre-gl` entry — so `import { Map } from "maplibre-gl"` written directly in `lib/map/view.ts` lints clean today and would put 252.8 kB in a public chunk with no error at all.

Two things make this urgent rather than tidy. This stage is the first to import `lib/map` from a public page, and `lib/utils.ts` (shadcn's `cn`) is about to become publicly reachable the same way.

**Why the fence is not simply a glob over `lib/**`:** stage 0 enumerated the belt by name deliberately, and `test/guardrails.test.ts` derives its list from the imported config and walks the real import graph from the public entry points — so a reachable module missing from the belt is already a red test. That is the self-healing property; this task is what it heals into.

**`.pod-data` rides along.** It is in `.gitignore` but not in `globalIgnores`, and flat config does not read `.gitignore`. A lint run already died mid-stage-1 with `ENOENT` walking `.pod-data/.internal/locks/…`, racing the live Solid server. It passes on retry, which is exactly how a false green gets reported.

**Files:**
- Modify: `eslint.config.mjs`
- Modify: `test/guardrails.test.ts`
- Modify: `notes.md` (repository root) — the belt's existing anchor gains a paragraph

**Interfaces:**
- Consumes: nothing.
- Produces: no code interface. What later tasks rely on is that a static `maplibre-gl` import from `lib/map/**`, `components/public/**` or `app/(public)/**` is a lint error, and that the stylesheet subpath is not.

- [ ] **Step 1: Read the two blocks you are about to edit**

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; node -v
sed -n '95,300p' eslint.config.mjs
```

You are looking for three things: `globalIgnores([...])` near line 101; the public block whose `files` array is `["app/(public)/**", "components/public/**", "app/not-found.tsx", "app/global-error.tsx"]`, which carries the `maplibre-gl` `paths` entry and the `maplibre-gl/dist/*.{js,mjs}` `patterns` entry; and the belt block whose `files` array lists ten `lib/` modules.

**The `maplibre-gl` entries are spelled the way they are for a measured reason.** The `paths` entry is an EXACT specifier, because the obvious `["maplibre-gl", "maplibre-gl/**"]` group also refuses `maplibre-gl/dist/maplibre-gl.css`, which this stage must import, and a `!`-negation cannot rescue it under gitignore semantics. Do not "simplify" it.

- [ ] **Step 2: Write the failing test**

Add to `test/guardrails.test.ts`. Match the file's existing style — it already imports the config and derives lists from it; find the helper it uses to lint a source string and reuse it rather than inventing a second one.

```ts
describe("lib/map is fenced like the public path it serves", () => {
  it("refuses a static maplibre-gl import in lib/map, which would be 252.8 kB in a public chunk", async () => {
    expect(ruleIds(await lint("lib/map/view.ts", `import { Map } from "maplibre-gl";\n`))).toContain(
      "no-restricted-imports",
    );
  });

  it("refuses the deep dist path too, which is the same bytes by another name", async () => {
    expect(
      ruleIds(await lint("lib/map/view.ts", `import "maplibre-gl/dist/maplibre-gl.mjs";\n`)),
    ).toContain("no-restricted-imports");
  });

  it("allows the stylesheet subpath, which the attribution control needs", async () => {
    const msgs = await lint("lib/map/view.ts", `import "maplibre-gl/dist/maplibre-gl.css";\n`);
    // A snippet that fails to PARSE yields one fatal message and no rule
    // messages, so this allow-case would pass having linted nothing.
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("keeps lib/map out of the auth library and out of lib/studio", async () => {
    expect(
      ruleIds(await lint("lib/map/view.ts", `import { x } from "@/lib/studio/session";\n`)),
    ).toContain("no-restricted-imports");
  });

  it("fences lib/utils.ts the same way, because a public component is about to import cn", async () => {
    const code = `import { getDefaultSession } from "@inrupt/solid-client-authn-browser";\n`;
    expect(ruleIds(await lint("lib/utils.ts", code))).toContain("no-restricted-imports");
  });
});
```

`lint`, `ruleIds` and `fatals` already exist at the top of `test/guardrails.test.ts` — use them and add no fourth helper. **Every allow-case must assert `fatals(msgs)` is empty**, for the reason that file's own docblock gives: a snippet ESLint cannot parse produces one fatal message and no rule messages at all, so an allow-case without the guard passes on a snippet that was never linted.

`test/support/imports.ts` holds the import-graph walker the belt's sweep uses — check there before writing anything new.

- [ ] **Step 3: Run it and watch it fail for the right reason**

Run: `npx vitest run test/guardrails.test.ts`

Expected: the first, second, fourth and fifth cases FAIL because no rule fires; the third PASSES from the start, since nothing restricts `lib/map` at all yet. **A third case that fails means your helper is wrong, not the config** — stop and read the failure before editing `eslint.config.mjs`.

- [ ] **Step 4: Hoist the two maplibre entries, then apply them twice**

The public block and the new `lib/map` block need the *same* two entries. Two copies drift — the belt's `ACL_PRIMITIVES` repetition nearly proved that in stage 0. Declare them once near the top of `eslint.config.mjs`, beside the existing shared consts:

```js
/** The exact-specifier ban plus its deep-path twin, shared by the public block
 *  and lib/map so the two copies cannot drift. The stylesheet subpath stays
 *  importable on purpose. ./notes.md#why-the-maplibre-entries-are-hoisted */
const MAPLIBRE_PATH = {
  name: "maplibre-gl",
  message:
    "maplibre-gl must never be statically imported by a public route — 252.8 kB gzip against a 190 kB budget. The map is lazy: `await import(\"maplibre-gl\")` inside the intersection handler, typed with `import(\"maplibre-gl\").Map`, so the chunk is one the prerendered HTML never names (CLAUDE.md, Map). The stylesheet subpath is deliberately still allowed.",
};

const MAPLIBRE_PATTERN = {
  group: ["maplibre-gl/dist/*.js", "maplibre-gl/dist/*.mjs"],
  message:
    "Import maplibre-gl lazily, not by a deep path: `await import(\"maplibre-gl\")`. Only the stylesheet subpath may be imported statically.",
};
```

Then replace the inline literals in the public block with `MAPLIBRE_PATH` and `MAPLIBRE_PATTERN`. **The message strings must survive byte-identical** — they are what a developer reads at the moment they are blocked. Copy them out of the file rather than retyping them from this plan, then diff to confirm nothing changed but the indirection.

- [ ] **Step 5: Add `lib/map/**` and `lib/utils.ts` to the belt, with the maplibre entries**

In the belt block's `files` array, after `"lib/place/**/*.ts"`:

```js
      "lib/map/**/*.ts",
      "lib/utils.ts",
```

Flat config **replaces** a rule's options rather than merging them, so the belt block's `no-restricted-imports` must carry every entry that applies to these files. It already repeats the ACL `paths` entry for exactly this reason. Add the maplibre entries to the same block:

The belt block writes its ACL entry and its `@inrupt/*` / `lib/studio` pattern as **inline object literals**, not as named consts. Append to each array rather than renaming anything:

```js
          paths: [
            { name: "@inrupt/solid-client", importNames: ACL_PRIMITIVES, message: "…unchanged…" },
            MAPLIBRE_PATH,
          ],
          patterns: [
            { group: ["@inrupt/*", "**/lib/studio", "**/lib/studio/**"], message: "…unchanged…" },
            MAPLIBRE_PATTERN,
          ],
```

Leave both existing literals byte-identical — they are repeated in that block precisely because flat config replaces rule options, and four existing tests fail if either goes missing. **Adding `MAPLIBRE_PATH` to the belt block also applies it to the ten `lib/` modules already listed there**, which is correct and intended: none of them may import MapLibre either.

- [ ] **Step 6: Add `.pod-data` to `globalIgnores`**

```js
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "node_modules/**", ".pod-data/**"]),
```

- [ ] **Step 7: Run it and watch it pass**

```sh
npx vitest run test/guardrails.test.ts
npm run lint
```

Expected: all five new cases pass, every pre-existing case in the file still passes, and `lint` is clean. **If any pre-existing guardrail case fails, you have replaced a rule's options rather than extended them** — that is the failure this repository has already had once, and four existing tests exist to catch it. Fix the block, do not adjust the test.

- [ ] **Step 8: Prove the fence is not vacuous**

A fence nobody can trip is not a fence. Write a real static import into a real file, watch lint refuse it, and put the file back. **Guarded, because a heredoc that silently writes nothing leaves lint green:**

```sh
printf 'import { Map } from "maplibre-gl";\nexport const x: typeof Map | null = null;\n' > lib/map/fence-probe.ts
grep -q 'from "maplibre-gl"' lib/map/fence-probe.ts || { echo "PROBE NOT WRITTEN — stop"; exit 1; }
npx eslint lib/map/fence-probe.ts   # expect: no-restricted-imports, exit 1
rm lib/map/fence-probe.ts
```

Then the same for the stylesheet, which must be **accepted**:

```sh
printf 'import "maplibre-gl/dist/maplibre-gl.css";\n' > lib/map/fence-probe.ts
npx eslint lib/map/fence-probe.ts   # expect: clean, exit 0
rm lib/map/fence-probe.ts
git status --short                   # must be clean of fence-probe.ts
```

- [ ] **Step 9: Write the reasoning down, then commit**

Add a paragraph to the root `notes.md` under the belt's existing anchor, and a new `#why-the-maplibre-entries-are-hoisted` anchor. Keep each under the six-line bound in the code that points at them.

```sh
npm run lint
npm run typecheck
npm run check:structure
npx vitest run test/guardrails.test.ts

git add eslint.config.mjs test/guardrails.test.ts notes.md
git commit -m "lib/map joins the fences it has been outside of since it was created

Stage 1 created lib/map and could not fence it: stage 0 enumerated both the
belt and the maplibre ban by name, and the directory did not exist yet. So a
static import of maplibre-gl in lib/map/view.ts has been lint-clean this whole
time, which is 252.8 kB into a public chunk against a 190 kB budget with no
error at all. lib/utils.ts has the same property and a public component is
about to import cn from it.

The two maplibre entries are hoisted into shared consts rather than copied,
because flat config replaces a rule's options per file rather than merging
them, so both blocks must carry both entries — and two hand-kept copies is the
shape the belt's ACL repetition nearly failed on. The exact-specifier spelling
survives untouched: a maplibre-gl/** group would also refuse the stylesheet
subpath, which the attribution control needs.

.pod-data joins globalIgnores. It is in .gitignore, flat config does not read
.gitignore, and a lint run died on an ENOENT race with the live Pod's lock
files during stage 1. It passed on retry, which is how a false green happens.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `useMapInstance` — the lazy import, the instance, the teardown

The hook owns everything about the MapLibre object: when it is created, that it is created **once**, its single `setProjection` call site, the attribution control, and its destruction. The component in Task 3 owns only the DOM node and the decision to activate.

**Why a bare `await import()` and not `next/dynamic`.** §1 measured that a `ssr: false` chunk is invisible to the bundle check; a bare dynamic import has the same property with less machinery, and `components/studio/studio-client/studio-client.tsx` already uses exactly this shape for the auth library, with a docblock warning that it must stay inside the effect or Next prerenders it into the eager chunk. Same reasoning, same trap.

**Why the map is created once and never on a prop change.** "Never remounted across navigation or drawer state" is an invariant in `CLAUDE.md`. A `bbox` object arrives as a fresh object identity on every render, so an effect depending on it would tear the map down and rebuild it on a re-render that changed nothing. The effect therefore depends on activation alone and reads the rest from refs. A different trip is a different map, and Task 4 measures whether that even remounts the layout.

**Files:**
- Create: `components/public/trip-map/hooks/use-map-instance.ts`
- Create: `components/public/trip-map/hooks/use-map-instance.test.ts`
- Create: `components/public/trip-map/notes.md`
- Modify: `test/guardrails.test.ts` — the single-`setProjection`-call-site scan (Step 3b)

**Interfaces:**
- Consumes: `buildBasemapStyle` from `@/lib/map/style` (stage 1, no arguments).
- Produces:
  - `type Bbox = { west: number; south: number; east: number; north: number }`
  - `type MapStatus = "idle" | "loading" | "ready" | "failed"`
  - `useMapInstance(options: { container: RefObject<HTMLDivElement | null>; active: boolean; bbox?: Bbox; styleUrl?: string }): MapStatus`

- [ ] **Step 1: Write the failing test**

Create `components/public/trip-map/hooks/use-map-instance.test.ts`. The fake stands in for the real library — `vi.mock` with a factory, because the real module is 252.8 kB of WebGL that jsdom cannot run at all.

```ts
/**
 * The instance lifecycle, against a fake maplibre-gl. jsdom has no WebGL, so
 * the real library cannot be exercised here — the canvas is stage 2's one
 * Playwright case. ./../notes.md#what-the-hook-test-can-and-cannot-see
 */

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: FakeMap[] = [];

class FakeMap {
  readonly handlers = new Map<string, (() => void)[]>();
  readonly controls: unknown[] = [];
  readonly projections: unknown[] = [];
  readonly fitted: unknown[] = [];
  removed = 0;
  constructor(readonly options: Record<string, unknown>) {
    created.push(this);
  }
  on(event: string, handler: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  once(event: string, handler: () => void) {
    return this.on(event, handler);
  }
  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }
  addControl(control: unknown) {
    this.controls.push(control);
    return this;
  }
  setProjection(projection: unknown) {
    this.projections.push(projection);
    return this;
  }
  fitBounds(bounds: unknown, options: unknown) {
    this.fitted.push({ bounds, options });
    return this;
  }
  remove() {
    this.removed += 1;
  }
}

class FakeAttributionControl {
  constructor(readonly options: unknown) {}
}

vi.mock("maplibre-gl", () => ({ Map: FakeMap, AttributionControl: FakeAttributionControl }));

const BBOX = { west: 129.87, south: 31.59, east: 141.02, north: 35.71 };

function harness(overrides: Partial<Parameters<typeof useMapInstance>[0]> = {}) {
  const node = document.createElement("div");
  document.body.append(node);
  return { container: { current: node }, active: true, bbox: BBOX, ...overrides };
}

let useMapInstance: typeof import("./use-map-instance").useMapInstance;

beforeEach(async () => {
  created.length = 0;
  ({ useMapInstance } = await import("./use-map-instance"));
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("useMapInstance", () => {
  it("creates nothing at all while inactive, which is the whole point of lazy", async () => {
    const { result } = renderHook(() => useMapInstance(harness({ active: false })));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(created).toHaveLength(0);
    expect(result.current).toBe("idle");
  });

  it("creates exactly one map when it becomes active", async () => {
    renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
  });

  it("adds the attribution control unconditionally, because removing it is never allowed", async () => {
    renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].controls.filter((c) => c instanceof FakeAttributionControl)).toHaveLength(1);
  });

  it("calls setProjection only from the style.load handler, never before it", async () => {
    renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
    // NOT `toHaveLength(0)` on a map that never loaded — that would pass against
    // a hook with no setProjection at all. Prove the call exists, then prove
    // nothing called it early.
    expect(created[0].projections).toHaveLength(0);
    created[0].emit("style.load");
    expect(created[0].projections).toEqual([{ type: "mercator" }]);
  });

  it("fits the bbox it was given, without animating, so the first paint is the trip", async () => {
    renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].emit("style.load");
    expect(created[0].fitted).toEqual([
      {
        bounds: [
          [BBOX.west, BBOX.south],
          [BBOX.east, BBOX.north],
        ],
        options: { padding: 32, animate: false },
      },
    ]);
  });

  it("skips fitBounds when the index has no bbox, rather than fitting a null island", async () => {
    renderHook(() => useMapInstance(harness({ bbox: undefined })));
    await waitFor(() => expect(created).toHaveLength(1));
    created[0].emit("style.load");
    expect(created[0].fitted).toHaveLength(0);
  });

  it("reports ready only once the map says load, not when the import resolves", async () => {
    const { result } = renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(result.current).toBe("loading");
    created[0].emit("load");
    await waitFor(() => expect(result.current).toBe("ready"));
  });

  it("does not rebuild the map when the bbox object identity changes", async () => {
    // The layout hands down a fresh object every render. An effect that
    // depended on it would tear down the instance the invariant says is
    // mounted once. ./../notes.md#why-the-effect-depends-on-activation-alone
    const { rerender } = renderHook((props: { bbox: typeof BBOX }) =>
      useMapInstance(harness({ bbox: props.bbox })),
    { initialProps: { bbox: { ...BBOX } } });
    await waitFor(() => expect(created).toHaveLength(1));
    rerender({ bbox: { ...BBOX } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(created).toHaveLength(1);
    expect(created[0].removed).toBe(0);
  });

  it("destroys the instance on unmount, so a navigation away does not leak a WebGL context", async () => {
    const { unmount } = renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
    unmount();
    expect(created[0].removed).toBe(1);
  });

  it("passes the deployer's style URL straight through when one is set", async () => {
    renderHook(() => useMapInstance(harness({ styleUrl: "https://tiles.example/styles/mine" })));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0].options.style).toBe("https://tiles.example/styles/mine");
  });

  it("builds the in-repo style when no URL is set, which is what unset means", async () => {
    renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
    const style = created[0].options.style as { layers: unknown[] };
    expect(Array.isArray(style.layers)).toBe(true);
    expect(style.layers).toHaveLength(17);
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts`

Expected: FAIL with `Failed to resolve import "./use-map-instance"`. Not an assertion failure.

- [ ] **Step 3: Write the hook**

Create `components/public/trip-map/hooks/use-map-instance.ts`:

```ts
"use client";

/**
 * THE IMPORT MUST STAY INSIDE THE EFFECT — at module scope Next prerenders
 * maplibre-gl into the eager chunk, which is 252.8 kB against a 190 kB budget.
 * Same trap, same shape as studio-client.tsx's auth import.
 * ./../notes.md#why-a-bare-dynamic-import-and-not-nextdynamic
 */

import { useEffect, useRef, useState } from "react";
import { buildBasemapStyle } from "@/lib/map/style";

export type Bbox = { west: number; south: number; east: number; north: number };
export type MapStatus = "idle" | "loading" | "ready" | "failed";

export type MapInstanceOptions = {
  container: React.RefObject<HTMLDivElement | null>;
  active: boolean;
  bbox?: Bbox;
  styleUrl?: string;
};

export function useMapInstance({ container, active, bbox, styleUrl }: MapInstanceOptions): MapStatus {
  const [status, setStatus] = useState<MapStatus>("idle");
  const map = useRef<import("maplibre-gl").Map | null>(null);

  // Read at creation, never depended on; see ./../notes.md#why-the-effect-depends-on-activation-alone
  const latest = useRef({ bbox, styleUrl });
  latest.current = { bbox, styleUrl };

  useEffect(() => {
    if (!active || map.current !== null) return;
    const node = container.current;
    if (node === null) return;

    let live = true;
    setStatus("loading");

    void import("maplibre-gl")
      .then(({ Map, AttributionControl }) => {
        if (!live) return;
        const { bbox: bounds, styleUrl: url } = latest.current;
        const instance = new Map({
          container: node,
          style: url ?? buildBasemapStyle(),
          attributionControl: false,
        });
        // Never conditional: OpenStreetMap requires it and CLAUDE.md forbids removing it.
        instance.addControl(new AttributionControl({ compact: true }));
        instance.on("style.load", () => {
          instance.setProjection({ type: "mercator" });
          if (bounds !== undefined) {
            instance.fitBounds(
              [
                [bounds.west, bounds.south],
                [bounds.east, bounds.north],
              ],
              { padding: 32, animate: false },
            );
          }
        });
        instance.once("load", () => setStatus("ready"));
        map.current = instance;
      })
      .catch(() => {
        if (live) setStatus("failed");
      });

    return () => {
      live = false;
    };
  }, [active, container]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
    },
    [],
  );

  return status;
}
```

**`attributionControl: false` in the options is not a removal.** It suppresses MapLibre's own default control so the explicit one on the next line is not a duplicate. Both would render, and two attribution bars is a bug, not extra compliance.

- [ ] **Step 3b: Pin the single call site, in the repo-level test file**

The lifecycle case above proves `setProjection` fires from `style.load`. Only a source scan can prove a **second** call site does not exist somewhere the fake never reaches, which is what §5 actually asks for. That is a repository assertion rather than a hook assertion, so it goes in `test/guardrails.test.ts` — already on `check-structure.ts`'s list of tests with no subject beside them.

```ts
describe("setProjection has one call site", () => {
  it("is reached from the style.load handler and from nowhere else in the tree", () => {
    const hits = execFileSync("git", ["grep", "-l", "setProjection(", "--", "lib", "components", "app"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
    expect(hits).toEqual(["components/public/trip-map/hooks/use-map-instance.ts"]);
  });
});
```

`git grep` searches tracked files from the repository root and returns repo-relative paths. **It exits non-zero when it matches nothing**, so if this case throws rather than failing an assertion, that IS the failure: no call site at all. Import `execFileSync` at the top of the file with the other node imports.

Run: `npx vitest run test/guardrails.test.ts` — and note that this case only passes once the hook is **committed**, because `git grep` reads the index, not the working tree. Run it after Step 7's `git add`, or stage the file first.

- [ ] **Step 4: Create `notes.md` with the three anchors the code points at**

Create `components/public/trip-map/notes.md`. `check:structure` fails on an anchor that does not resolve, and both the hook and its test point here already:

```markdown
# components/public/trip-map — notes

## Why a bare dynamic import and not next/dynamic

§1 of the design measured that a chunk produced by `next/dynamic` with
`ssr: false` is invisible to `size:public`, because the check derives its chunk
list from prerendered HTML and a lazily loaded chunk is never named there. A
bare `await import()` has exactly the same property with less machinery, and
`components/studio/studio-client/studio-client.tsx` already uses this shape for
the auth library.

The trap both share: at module scope, Next prerenders the import onto the
server and into the eager chunk. For the auth library that is a correctness
bug; here it is 252.8 kB gzip against 190 kB of budget. The import stays inside
the effect, and `scripts/check-public-bundle.ts`'s positive control is what
notices if it ever moves.

## Why the effect depends on activation alone

`bbox` arrives from the server layout as a fresh object on every render, so an
effect listing it in its dependencies would destroy and rebuild the map on a
re-render that changed nothing. "One MapLibre instance, mounted once, never
remounted across navigation or drawer state" is an invariant in `CLAUDE.md`,
and this is the line that keeps it: the effect depends on `active` and the
container ref, and reads the rest from a ref updated each render.

A different trip is a different map. Whether that is even a remount is
answered under the `[slug]` heading below rather than assumed.

## What the hook test can and cannot see

jsdom has no WebGL and no `IntersectionObserver`. The hook test therefore runs
against a fake `maplibre-gl` and proves the lifecycle: one instance, the
attribution control added, `setProjection` reached only from `style.load`, the
bbox fitted without animation, teardown on unmount.

It cannot prove a canvas appears, that the style renders, or that the chunk is
fetched lazily by a real browser. Those are `e2e/trip-map.spec.ts`, which is
why that spec clears `CLAUDE.md`'s "never a slow duplicate of a fast test" bar.
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts`

Expected: PASS, 11 cases.

`test/support/walk.ts` exports only `walkTestFiles`, which is the wrong tool here — hence `git grep`, which searches tracked files from the repository root and returns repo-relative paths. **`git grep` exits non-zero when it matches nothing**, so if this case ever throws rather than failing an assertion, that IS the failure: no call site at all.

- [ ] **Step 6: Prove three of them are not vacuous**

Each mutation is guarded, because a `sed` that matches nothing exits 0 and leaves the suite green. **Back the file up with `cp` and restore with `cp`** — `git checkout --` cannot restore a file that is not committed yet, and it silently over-reverts one that is.

```sh
cp components/public/trip-map/hooks/use-map-instance.ts /tmp/hook.bak

# 1. The attribution control. Expect: the attribution case alone reddens.
sed -i '' 's|instance.addControl(new AttributionControl({ compact: true }));||' components/public/trip-map/hooks/use-map-instance.ts
grep -q 'addControl' components/public/trip-map/hooks/use-map-instance.ts && { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts
cp /tmp/hook.bak components/public/trip-map/hooks/use-map-instance.ts

# 2. setProjection moved OUT of the style.load handler — the exact bug the
#    invariant names. Expect: the projection case reddens on the "called early"
#    half, not on the "never called" half.
sed -i '' 's|instance.on("style.load", () => {|instance.setProjection({ type: "mercator" });\n        instance.on("style.load", () => {|' components/public/trip-map/hooks/use-map-instance.ts
grep -c 'setProjection' components/public/trip-map/hooks/use-map-instance.ts   # must print 2
npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts
cp /tmp/hook.bak components/public/trip-map/hooks/use-map-instance.ts

# 3. bbox listed in the dependency array — the rebuild the invariant forbids.
sed -i '' 's|}, \[active, container\]);|}, [active, container, bbox]);|' components/public/trip-map/hooks/use-map-instance.ts
grep -q 'active, container, bbox' components/public/trip-map/hooks/use-map-instance.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts
cp /tmp/hook.bak components/public/trip-map/hooks/use-map-instance.ts

npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts   # 11 passed again
```

Report the actual output of each. If mutation 3 leaves the suite green, the identity-stability case is asserting nothing and must be fixed before you continue — that case is the invariant's only mechanical defence.

- [ ] **Step 7: Run the checks and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

`check:structure` is the one to read: it resolves the three `notes.md` anchors and checks that `use-map-instance.test.ts` sits beside its subject.

```sh
git add components/public/trip-map test/guardrails.test.ts
git commit -m "The map instance is created once, lazily, and destroyed on unmount

maplibre-gl is imported inside the effect and must stay there: at module scope
Next prerenders it into the eager chunk, which is 252.8 kB gzip against a
190 kB budget. studio-client.tsx already carries this shape and this warning
for the auth library.

The effect depends on activation and the container ref alone. bbox arrives from
the server layout as a fresh object every render, so depending on it would
destroy and rebuild the instance CLAUDE.md says is mounted once — watched
failing by putting bbox back in the dependency array.

setProjection has one call site, inside the style.load handler, and the case
proving it fires there also proves it does not fire before, because asserting
only that it was never called early passes against a hook that never calls it
at all. The attribution control is unconditional; attributionControl: false in
the options suppresses MapLibre's duplicate, it does not remove ours.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `TripMap` — the container, the observer, the reserved frame

**Files:**
- Create: `components/public/trip-map/trip-map.tsx`
- Create: `components/public/trip-map/trip-map.test.tsx`
- Create: `components/public/trip-map/index.ts`
- Modify: `components/public/trip-map/notes.md` — two new anchors

**Interfaces:**
- Consumes: `useMapInstance`, `Bbox` from `./hooks/use-map-instance` (Task 2).
- Produces:
  - `TripMap(props: { bbox?: Bbox; styleUrl?: string })` — default export, re-exported by the barrel.
  - `MAP_FRAME_CLASS: string` — the reserved-space class, so the layout's Suspense fallback and the map itself cannot drift apart.

- [ ] **Step 1: Write the failing test**

Create `components/public/trip-map/trip-map.test.tsx`:

```tsx
/**
 * Lazy activation and the reserved frame. jsdom has no IntersectionObserver,
 * so this file installs one — which is also why the component carries a
 * fallback. ./notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripMap, { MAP_FRAME_CLASS } from "./trip-map";

const instances: { active: boolean }[] = [];

vi.mock("./hooks/use-map-instance", () => ({
  useMapInstance: (options: { active: boolean }) => {
    instances.push({ active: options.active });
    return options.active ? "loading" : "idle";
  },
}));

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;
const observers: { callback: ObserverCallback; disconnected: boolean }[] = [];

function installObserver() {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(readonly callback: ObserverCallback) {
        observers.push({ callback, disconnected: false });
      }
      observe() {}
      disconnect() {
        const mine = observers.find((o) => o.callback === this.callback);
        if (mine) mine.disconnected = true;
      }
    },
  );
}

beforeEach(() => {
  instances.length = 0;
  observers.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TripMap", () => {
  it("reserves the frame before any script runs, so nothing shifts when the map arrives", () => {
    installObserver();
    const { container } = render(<TripMap />);
    const frame = container.querySelector(`.${MAP_FRAME_CLASS.split(" ")[0]}`);
    expect(frame).not.toBeNull();
  });

  it("does not activate the instance until the frame intersects", () => {
    installObserver();
    render(<TripMap />);
    expect(instances.at(-1)?.active).toBe(false);
  });

  it("activates once the frame intersects, which is the lazy mount", async () => {
    installObserver();
    render(<TripMap />);
    observers[0].callback([{ isIntersecting: true }]);
    await waitFor(() => expect(instances.at(-1)?.active).toBe(true));
  });

  it("stops observing once it has activated, because there is nothing left to wait for", async () => {
    installObserver();
    render(<TripMap />);
    observers[0].callback([{ isIntersecting: true }]);
    await waitFor(() => expect(observers[0].disconnected).toBe(true));
  });

  it("activates immediately where there is no IntersectionObserver, rather than never", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<TripMap />);
    expect(instances.at(-1)?.active).toBe(true);
  });

  it("names the map for a screen reader, because a bare div is not a region", () => {
    installObserver();
    render(<TripMap />);
    expect(screen.getByRole("region", { name: /map/i })).toBeInTheDocument();
  });
});
```

**Check the harness before you rely on `toBeInTheDocument`** — read `test/setup.ts` (or whatever `vitest.config.ts` names) and confirm `@testing-library/jest-dom` is registered. If it is not, use `expect(...).not.toBeNull()` rather than adding a global.

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run components/public/trip-map/trip-map.test.tsx`

Expected: FAIL with `Failed to resolve import "./trip-map"`.

- [ ] **Step 3: Write the component and the barrel**

Create `components/public/trip-map/trip-map.tsx`:

```tsx
"use client";

// Outside the lazy chunk on purpose; see ./notes.md#the-frame-is-reserved-by-the-server-and-the-class-is-shared
import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import { useMapInstance, type Bbox } from "./hooks/use-map-instance";

/** Shared with the layout's Suspense fallback so the two boxes cannot drift. */
export const MAP_FRAME_CLASS = "h-96 w-full bg-surface";

export default function TripMap({ bbox, styleUrl }: { bbox?: Bbox; styleUrl?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const node = container.current;
    if (node === null || active) return;
    // ./notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setActive(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);

  useMapInstance({ container, active, bbox, styleUrl });

  return <div ref={container} role="region" aria-label="Trip map" className={MAP_FRAME_CLASS} />;
}
```

Create `components/public/trip-map/index.ts`:

```ts
export { default, MAP_FRAME_CLASS } from "./trip-map";
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/public/trip-map/trip-map.test.tsx`

Expected: PASS, 6 cases.

- [ ] **Step 5: Add the two anchors**

Append to `components/public/trip-map/notes.md`:

```markdown
## The no-observer fallback, and why it is not a hole

`IntersectionObserver` is absent in jsdom and in no browser this app targets.
The component falls back to activating immediately rather than to never
activating, because a map that never appears is a broken page while an eagerly
mounted one is only a wasted download — and in the one environment where the
fallback fires, the test environment, the library is a fake.

The fallback is what makes the component testable at all, so it is load-bearing
rather than defensive. What it must never become is the path a real browser
takes: if the observer branch stops running, the laziness the whole stage is
built on is gone with no test failing. `e2e/trip-map.spec.ts` is what watches
that, by asserting the canvas is absent before the scroll.

## The frame is reserved by the server, and the class is shared

`MAP_FRAME_CLASS` is exported and used twice: by the component, and by the
layout's Suspense fallback. The layout can render the box before the index has
been read, because the box's size does not depend on the data — so the page
reserves the map's space before any JavaScript runs and nothing shifts when the
instance arrives.

Two copies of that class string would drift, and the drift would be a layout
shift that no test asserts against. One export, two call sites.
```

- [ ] **Step 6: Run the checks and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

`check:structure` proves the folder rule: `trip-map.tsx` in a folder named `trip-map`, `index.ts` beside it, the test beside its subject, and all five anchors resolving.

```sh
git add components/public/trip-map
git commit -m "TripMap reserves its frame on the server and mounts the map on intersection

The container renders with its height fixed before any script runs, so the page
does not shift when the instance arrives; the class is exported rather than
written twice, because the layout's Suspense fallback draws the same box and
two copies would drift into a layout shift no test asserts against.

The maplibre stylesheet is imported here rather than inside the lazy chunk, so
the map's chrome is styled before the library lands. The public fence permits
that one subpath deliberately and refuses every other static form.

Where IntersectionObserver does not exist the component activates immediately
rather than never — a map that never appears is a broken page, and the only
environment without the observer is the test one, where the library is a fake.
That fallback must never become the path a browser takes, which is what the
Playwright case watches.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: the layout, which is the mechanism for "never remounted"

`app/(public)/trips/[slug]/` has a `page.tsx` and an `[entry]/page.tsx` and no layout. Adding one puts the map above both, and Next 16's documented behaviour — layouts preserve state, remain interactive, and do not rerender on navigation (`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`) — is what keeps a single instance alive across trip → entry → entry. That is the case the invariant exists for: the timeline navigates to entry routes and the map must survive it.

**Do not await `params` on the shell path.** `page.tsx` carries a docblock explaining why: reading URL data outside `<Suspense>` blocks the static shell, which is what Next's instant-navigation validation flags. The layout follows the same shape — the frame renders immediately, the index read happens inside a boundary.

**One thing to measure rather than assume:** whether changing `[slug]` — trip A to trip B — remounts the layout, since the param belongs to the layout's own segment. Either answer is acceptable, because a different trip is a different map. The answer goes in `notes.md`.

**Files:**
- Create: `app/(public)/trips/[slug]/layout.tsx`
- Create: `app/(public)/trips/[slug]/layout.test.tsx`
- Create: `app/(public)/trips/[slug]/notes.md`
- Modify: `components/public/trip-map/notes.md` — the `[slug]` measurement

**Interfaces:**
- Consumes: `TripMap` and `MAP_FRAME_CLASS` from `@/components/public/trip-map`; `getTripIndex` from `@/lib/pod/cached`; `config.mapStyleUrl` from `@/lib/config`.
- Produces: nothing later tasks import. Task 6's Playwright spec navigates the routes it creates.

- [ ] **Step 1: Write the failing test**

Create `app/(public)/trips/[slug]/layout.test.tsx`. Keep it to what a server component test can honestly assert — the async child is exercised through its own units, and the browser path is Task 6.

```tsx
/**
 * The layout's shell path: the frame is reserved without awaiting params, and
 * the map sits above children rather than inside a page. ./notes.md#why-the-map-lives-in-the-layout
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Layout from "./layout";

vi.mock("@/components/public/trip-map", () => ({
  default: () => <div data-testid="trip-map" />,
  MAP_FRAME_CLASS: "h-96 w-full bg-surface",
}));

const params = new Promise<{ slug: string }>(() => {
  // Never resolves: a layout that awaited this would hang, which is the point.
});

describe("the trip layout", () => {
  it("renders children immediately, without waiting on params", () => {
    render(<Layout params={params}>{<p>{"entry body"}</p>}</Layout>);
    expect(screen.getByText("entry body")).toBeInTheDocument();
  });

  it("reserves the map frame on the shell path, before the index has been read", () => {
    const { container } = render(<Layout params={params}>{null}</Layout>);
    expect(container.querySelector(".h-96")).not.toBeNull();
  });
});
```

**If rendering a Suspense boundary whose child never resolves warns or hangs under this project's Testing Library setup, say so and simplify** — assert the fallback and the children only, and note the limitation in `notes.md`. Do not silence a warning to make the test pass.

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run "app/(public)/trips/[slug]/layout.test.tsx"`

Expected: FAIL with an unresolved import of `./layout`.

- [ ] **Step 3: Write the layout**

Create `app/(public)/trips/[slug]/layout.tsx`:

```tsx
import { Suspense } from "react";
import TripMap, { MAP_FRAME_CLASS } from "@/components/public/trip-map";
import { config } from "@/lib/config";
import { getTripIndex } from "@/lib/pod/cached";

/** The layout, not the page, is what keeps ONE map alive across trip → entry →
 *  entry: Next preserves layout state on navigation. ./notes.md#why-the-map-lives-in-the-layout */
export default function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  return (
    <>
      <Suspense fallback={<div aria-hidden className={MAP_FRAME_CLASS} />}>
        <MapForTrip params={params} />
      </Suspense>
      {children}
    </>
  );
}

async function MapForTrip({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const index = await getTripIndex(slug);
  // A trip whose index will not read still gets a map, just an unfitted one.
  // Losing the index must not lose the page — the same rule page.tsx follows.
  return <TripMap bbox={index.ok ? index.value.bbox : undefined} styleUrl={config.mapStyleUrl} />;
}
```

`config.mapStyleUrl` is read here, in a server component, because `lib/config.ts` throws in the browser by design — the value reaches the client as a prop, the way `ownerWebId` already does. **There is no `NEXT_PUBLIC_MAP_STYLE_URL` and there must not be one.**

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run "app/(public)/trips/[slug]/layout.test.tsx"`

Expected: PASS, 2 cases.

- [ ] **Step 5: Measure the `[slug]` question, against a running app**

This is the step that produces a fact rather than an opinion. With a Pod up and the dev server running:

```sh
npm run dev            # in another shell, or reuse .next/dev/lock's port
```

Open `/trips/2026-japan`, then navigate to an entry beneath it, then back. Then reach a *different* trip's page. Instrument it however you like — the cheapest is a `console.log` in the hook's creation path, read from the terminal because `logging.browserToTerminal` is on.

Record two answers in `components/public/trip-map/notes.md`, under a new `## Navigating between trips, measured` heading: **how many instances are created for trip → entry → entry**, and **how many for trip A → trip B**. State the date and the command. If the second remounts, say so plainly — it is acceptable, and a future reader needs to know it was measured rather than hoped.

Remove the instrumentation before committing, and confirm with `git diff` that no `console.log` survives.

- [ ] **Step 6: Write `notes.md` for the route folder**

Create `app/(public)/trips/[slug]/notes.md`:

```markdown
# app/(public)/trips/[slug] — notes

## Why the map lives in the layout

Next preserves layout state across navigation: a layout does not rerender when
a child route changes, which is documented in the bundled docs at
`01-app/01-getting-started/03-layouts-and-pages.md`. That is the mechanism
behind `CLAUDE.md`'s "one MapLibre instance, mounted once, never remounted
across navigation" — not a discipline the components maintain, but a property
of where the component is mounted.

Put the same map in `page.tsx` and every navigation to an entry would tear down
a WebGL context and build a new one, with the tiles refetched and the camera
reset. The invariant would be violated by the file it lives in.

The layout does not await `params` on its shell path, for the reason
`page.tsx`'s own docblock gives: reading URL data outside a boundary blocks the
static shell, which is what makes a navigation feel slow. The frame is reserved
synchronously and the index read happens inside `<Suspense>`.
```

- [ ] **Step 7: Run the checks and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
npm run build
npm run size:public
```

**Read `size:public` carefully — this is the first build with a public page that reaches the map.** `maplibre-gl` must still report **absent**. If it reports FOUND, the import has escaped the effect and the whole stage's premise is broken: stop and report rather than adjusting the budget.

```sh
git add "app/(public)/trips/[slug]" components/public/trip-map/notes.md
git commit -m "The trip map lives in the layout, because that is what makes it survive

Next preserves layout state across navigation, so a map mounted in the [slug]
layout stays alive through trip → entry → entry. The same component in page.tsx
would tear down a WebGL context on every navigation and the invariant would be
violated by the file it sits in rather than by anyone's mistake.

The shell path does not await params: reading URL data outside a boundary
blocks the static shell, which page.tsx already carries a docblock about. The
frame is reserved synchronously with the class the component exports, and the
index read happens inside Suspense — a trip whose index will not read still
gets a map, just an unfitted one.

Whether changing [slug] remounts the layout was measured rather than assumed;
notes.md records what was seen and when.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: the positive bundle control

**`size:public` has gone quiet on the map, and that is the half-check this repository keeps hitting.** With the library lazy, the check passes identically whether the map is correct or entirely absent: `maplibre-gl` will report `absent` in the composition ledger forever, and that line now means nothing. §1 requires two assertions in opposite directions. The negative one already follows from `BANNED_DEPS`. This task adds the positive one:

> the real build must emit a chunk containing MapLibre that **no** public page's HTML references.

Both halves matter. A chunk that exists and is referenced means the import escaped the effect. No chunk at all means there is no map.

**Files:**
- Modify: `scripts/check-public-bundle.ts`
- Modify: `test/public-bundle.test.ts`
- Modify: `scripts/notes.md`

**Interfaces:**
- Consumes: `BANNED_DEPS`, `Chunk`, and the page-measurement machinery already in the script.
- Produces: `findLazyChunks(all: Chunk[], referenced: Set<string>, markers: string[]): { present: string[]; leaked: string[] }` — `present` is every chunk whose source matches a marker; `leaked` is the subset a public page references.

- [ ] **Step 1: Look at the real build before asserting anything about it**

```sh
npm run build
grep -rl "maplibregl\|maplibre-gl" .next/static/chunks | head
```

Write down what you find: how many chunk files match, and their names. **If nothing matches, stop and report** — either the build did not include the map, or the marker is wrong, and both are findings rather than obstacles. Compare against `BANNED_DEPS`'s existing `maplibre-gl` markers and use those rather than inventing a string.

- [ ] **Step 2: Write the failing test**

Add to `test/public-bundle.test.ts`, following the file's existing style of synthesising chunk objects rather than reading a build:

```ts
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
```

- [ ] **Step 3: Run it and watch it fail for the right reason**

Run: `npx vitest run test/public-bundle.test.ts`

Expected: FAIL — `findLazyChunks is not a function` (or an unresolved import). Not an assertion failure.

- [ ] **Step 4: Implement it**

Add to `scripts/check-public-bundle.ts`, beside `findStudioDeps` and following its shape:

```ts
export type LazyProof = { present: string[]; leaked: string[] };

/** The positive half of §1's pair: a chunk carrying the map must exist, and no
 *  public page's HTML may reference it. ./notes.md#the-positive-control */
export function findLazyChunks(chunks: Chunk[], referenced: Set<string>, markers: string[]): LazyProof {
  if (chunks.length === 0) throw new Error("findLazyChunks: no chunks to scan");
  const present = chunks
    .filter((chunk) => markers.some((marker) => chunk.source.includes(marker)))
    .map((chunk) => chunk.name);
  return { present, leaked: present.filter((name) => referenced.has(name)) };
}
```

Then call it from `main()`, after the composition report, and fail the run on either half. Read how `main()` already assembles its chunk list and its set of referenced scripts — reuse both rather than re-reading the directory, and use `canonicalScript()` for name comparison if that is what the existing code compares on. **Getting the two name spellings out of step would make `leaked` permanently empty, which is a green that proves nothing** — the exact failure mode this control exists to prevent. Assert the shapes match by printing both once while you develop.

The failure messages a developer reads:

```ts
  if (proof.present.length === 0) {
    console.log("\n  map   NO chunk contains maplibre — the map is lazy, or absent, and this cannot tell which");
  }
  if (proof.leaked.length > 0) {
    console.log(`\n  map   a public page references the maplibre chunk: ${proof.leaked.join(", ")}`);
  }
```

- [ ] **Step 5: Run it and watch it pass, then run it against the real build**

```sh
npx vitest run test/public-bundle.test.ts
npm run build
npm run size:public
```

Expected: the unit cases pass, and `size:public` on the real build reports the map chunk present and unreferenced. **Report the actual line it printed.**

- [ ] **Step 6: Prove the control can fail on a real build, not just on a synthesised one**

This is the step that separates this control from the one it replaces. Move the import to module scope, rebuild, and watch it catch:

```sh
cp components/public/trip-map/hooks/use-map-instance.ts /tmp/hook.bak
# A static import at module scope — exactly what the fence and this control both exist to stop.
# Expect: `npm run lint` refuses it AND, if you bypass lint, size:public reports a leak.
sed -i '' '1a\
import { Map as EagerMap } from "maplibre-gl";
' components/public/trip-map/hooks/use-map-instance.ts
grep -q 'EagerMap' components/public/trip-map/hooks/use-map-instance.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npm run lint          # expect: no-restricted-imports
npm run build && npm run size:public   # expect: maplibre-gl FOUND, and/or the leak line
cp /tmp/hook.bak components/public/trip-map/hooks/use-map-instance.ts
npm run build && npm run size:public   # expect: back to absent + present-and-unreferenced
```

Report which check caught it first. If `size:public` stays green with the eager import in place, the control is not wired to the real chunk list and must be fixed before this task is done.

- [ ] **Step 7: Commit**

```sh
git add scripts/check-public-bundle.ts test/public-bundle.test.ts scripts/notes.md
git commit -m "size:public gains the positive control it needed the moment the map went lazy

With maplibre-gl loaded lazily, the composition ledger reports it absent
forever — and that line reads identically whether the map is correct or was
never built. That is the half-check this repository keeps hitting, and §1 asked
for the other direction.

findLazyChunks asserts both halves: a chunk carrying the map must exist, and no
public page's HTML may reference it. A missing chunk means there is no map; a
referenced one means the import escaped the effect. Zero chunks throws rather
than passing, the same rule findStudioDeps already follows.

Watched failing on a real build, not only on synthesised chunks: the import was
moved to module scope, rebuilt, and the run caught it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: the Playwright case, the decision, and the deferred gate

jsdom has no WebGL, so "the canvas appears after scrolling and the attribution is present" cannot be tested anywhere faster. That clears `CLAUDE.md`'s "never a slow duplicate of a fast test" bar the same way the media pipeline's uploaded bytes did — by measurement, not by assertion.

**The tiles are stubbed.** The spec must not depend on `tiles.openfreemap.org` being reachable: a test that fails on a train is a test people stop running, and the repository bans network in its unit tests for the same reason. Aborting tile requests still leaves a canvas, an attribution bar, and a style — everything this case asserts.

**The e2e gate is NOT widened, by decision.** `components/public/**` and `lib/map/**` do not join the six paths in `CLAUDE.md` and `docs/testing-gates.md`. The owner deferred it on 2026-09-10, to be revisited when stage 3's markers land. Record the decision; do not quietly implement it.

**Files:**
- Create: `e2e/trip-map.spec.ts`
- Modify: `docs/decisions.md` — §28
- Modify: `TODO.md` — tick stage 2's deliverable, record the deferred gate
- Modify: `e2e/notes.md` if one exists (check first)

**Interfaces:**
- Consumes: `E2E` from `./environment`; the seeded trip `2026-japan`, whose index carries a bbox and one placed entry.
- Produces: nothing.

- [ ] **Step 1: Confirm the seeded fixture actually has what the spec assumes**

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
npm run pod:dev &                       # only if nothing answers on 3001 already
SEED_NAME=e2e npm run pod:seed
curl -s http://localhost:3001/e2e/travel/trips/2026-japan/entries.ttl | grep -i "bbox\|lat"
```

Expected: `dy:bboxWest` and friends, and at least one `dy:lat`. **If the bbox is absent, the map renders unfitted and the spec must not assert a camera** — say so rather than asserting something the fixture cannot support.

- [ ] **Step 2: Write the spec**

Create `e2e/trip-map.spec.ts`. Read `e2e/solid-login.spec.ts` first and match its structure and its comment style.

```ts
/**
 * The one thing no faster test can see: a real WebGL canvas, mounted only
 * after the frame scrolls into view, with the OpenStreetMap attribution on it.
 * jsdom has neither WebGL nor IntersectionObserver.
 */

import { expect, test } from "@playwright/test";

const TRIP = "/trips/2026-japan";

test.beforeEach(async ({ page }) => {
  // Never touch the real tile server: a spec that needs the internet is a spec
  // people stop running. A blocked tile still leaves a canvas and an
  // attribution bar, which is everything asserted below.
  await page.route("**tiles.openfreemap.org/**", (route) => route.abort());
});

test.describe("the trip map", () => {
  test("reserves its frame before the map exists, and mounts a canvas only after it scrolls into view", async ({
    page,
  }) => {
    await page.goto(TRIP);

    const frame = page.getByRole("region", { name: /map/i });
    await expect(frame).toBeVisible();

    // Scroll the frame out of view first, then back: landing at the top of a
    // short page can intersect immediately, which would make the assertion
    // below pass without the observer ever firing.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.evaluate(() => window.scrollTo(0, 0));

    await expect(frame.locator("canvas.maplibregl-canvas")).toBeVisible();
  });

  test("carries the OpenStreetMap attribution, which is never removed", async ({ page }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: /map/i });
    await expect(frame.locator("canvas.maplibregl-canvas")).toBeVisible();
    await expect(frame.getByText(/OpenStreetMap/i)).toBeVisible();
  });

  test("keeps one canvas across a navigation to an entry, because the map is in the layout", async ({
    page,
  }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: /map/i });
    await expect(frame.locator("canvas.maplibregl-canvas")).toBeVisible();

    await page.getByRole("link", { name: /.+/ }).first().click();
    await expect(page).toHaveURL(/\/trips\/2026-japan\/.+/);
    await expect(page.locator("canvas.maplibregl-canvas")).toHaveCount(1);
  });
});
```

**The first test's scroll dance is load-bearing and may still not be enough.** If the frame is already in the viewport on load, the observer fires immediately and the case cannot distinguish lazy from eager. Measure it: add a `page.on("request")` listener logging every `.js` URL, run once, and see whether any request arrives only after the scroll. **If the frame is above the fold, either give the page enough content above it or drop the laziness half of that assertion and say so in the spec's docblock** — do not leave an assertion that cannot fail.

- [ ] **Step 3: Run it**

```sh
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
```

Expected: the two pre-existing specs still pass (6 cases) plus the three new ones. Report the actual count. **If the canvas never appears, read the terminal** — `logging.browserToTerminal` forwards browser errors, and a style or WebGL failure will be there rather than in the Playwright output.

- [ ] **Step 4: Prove the spec can fail**

```sh
cp components/public/trip-map/trip-map.tsx /tmp/tm.bak
# Never activate: the observer callback stops setting state.
sed -i '' 's|if (entries.some((entry) => entry.isIntersecting)) setActive(true);||' components/public/trip-map/trip-map.tsx
grep -q 'setActive(true);' components/public/trip-map/trip-map.tsx && echo "note: the fallback branch still sets it — check which line was removed"
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e   # expect: the canvas cases fail
cp /tmp/tm.bak components/public/trip-map/trip-map.tsx
```

- [ ] **Step 5: Record the decision and the deferral**

Append to `docs/decisions.md`:

```markdown
---

## 28. The map is mounted by the trip layout, and the e2e gate is not widened for it

`CLAUDE.md` requires one MapLibre instance, mounted once, never remounted across navigation. Two
places could hold it: the trip page, or a layout above both the trip page and its entry routes.

**The layout.** Next preserves layout state across navigation, so the instance survives trip →
entry → entry as a property of where it is mounted rather than as a discipline the components
maintain. In `page.tsx` the same code would tear down a WebGL context on every navigation and the
invariant would be violated by the file it lives in.

**Consequences.** The map is above the page content on every entry route, which is what the
timeline in stage 4 needs. `config.mapStyleUrl` is read in the layout, a server component, because
`lib/config.ts` throws in the browser — the value crosses as a prop and there is no
`NEXT_PUBLIC_` variant. `size:public` gained a positive control (`findLazyChunks`), because with
the library lazy the composition ledger reports `maplibre-gl` absent whether the map is correct or
missing entirely.

**`components/public/**` and `lib/map/**` do NOT join the e2e gate globs.** The design suggested
they should; the owner deferred it on 2026-09-10, to be revisited when stage 3's markers land. So
`e2e/trip-map.spec.ts` exists and is run deliberately rather than by a path match, and a future
diff touching only the map will not trip the gate. That is a known hole, recorded rather than
papered over.

**Also considered:** mounting the map in `page.tsx` with a client-side cache keyed by slug —
rejected as a second state machine reimplementing what the router already guarantees.
```

Then in `TODO.md`'s phase 4 section, tick the second deliverable with what landed, and add the deferred-gate line where the other open decisions live:

```markdown
- [x] One MapLibre instance, lazy-mounted, never remounted — landed 2026-09-10, plan at
      `docs/superpowers/plans/2026-09-10-map-and-timeline-stage-2.md`. The instance lives in
      `app/(public)/trips/[slug]/layout.tsx`, so it survives navigation to entry routes;
      `docs/decisions.md` §28. `size:public` gained `findLazyChunks`, the positive control that
      distinguishes "lazy and correct" from "no map at all".
- [ ] **Decide whether `components/public/**` and `lib/map/**` join the e2e gate globs.** Deferred
      by the owner on 2026-09-10 when stage 2 offered it. Until then a diff touching only the map
      does not require `npm run test:e2e`, and `e2e/trip-map.spec.ts` is run deliberately. Revisit
      when stage 3's markers land.
```

- [ ] **Step 6: Run the whole definition of done, unchained, and read every log**

```sh
node -v                     # v22.x
# a Pod must answer on 3001 — do not kill one you did not start
npm test
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure
npm run build
npm run size:public
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
```

Then the control that proves the integration suites ran rather than skipped:

```sh
TEST_POD=http://localhost:3999 npm test    # the passed count must DROP by 36, and the two
                                           # test/integration files must report skipped
```

Record both counts. **Do not predict either.**

- [ ] **Step 7: Commit**

```sh
git add e2e docs/decisions.md TODO.md
git commit -m "One Playwright case for the canvas, and decision 28 for where the map lives

jsdom has no WebGL and no IntersectionObserver, so a real canvas mounted after
a scroll, with the OpenStreetMap attribution on it, cannot be tested anywhere
faster. Tiles are aborted rather than fetched: a spec that needs the internet
is a spec people stop running, and a blocked tile still leaves everything this
case asserts.

Decision 28 records why the instance lives in the layout rather than the page —
Next preserves layout state across navigation, so the invariant is a property
of where the component is mounted rather than a discipline the components keep.

The e2e gate is deliberately NOT widened to components/public/** and
lib/map/**. The design suggested it; the owner deferred it, to revisit when
stage 3's markers land. So this spec runs deliberately rather than by a path
match, which is a known hole and is written down as one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `npx vitest run components/public app/\(public\)/trips test/guardrails.test.ts test/public-bundle.test.ts` passes, and the full suite's count is **1471 plus this stage's new cases** — measured, not predicted.
- A static `maplibre-gl` import in `lib/map/**` is refused by lint, and the stylesheet subpath is not. **Both were watched, on a real file, with the probe removed afterwards.**
- The five new guardrail cases fail before the config change and pass after, and **every pre-existing guardrail case still passes** — flat config replaces rule options rather than merging them, and four existing tests exist because that has already gone wrong once.
- `useMapInstance` creates exactly one instance, adds the attribution control unconditionally, reaches `setProjection` only from `style.load` — with a source scan proving there is no second call site anywhere in the tree — fits the bbox without animating, and destroys the instance on unmount. **The bbox-identity case was watched failing with `bbox` restored to the dependency array** — that case is the "never remounted" invariant's only mechanical defence.
- The frame is reserved by the server with the class the component exports, and the map does not activate before the frame intersects. The no-observer fallback is tested in both directions.
- Whether trip A → trip B remounts the layout is **recorded in `notes.md` as a measurement with a date**, not assumed in either direction.
- `size:public` reports the maplibre chunk **present and unreferenced**, and the control was watched catching a module-scope import on a real build — not only on synthesised chunks.
- `e2e/trip-map.spec.ts` passes with tiles aborted, and was watched failing with activation disabled. If the frame turns out to sit above the fold, the laziness half of that assertion was either made meaningful or removed with the reason written down.
- `docs/decisions.md` §28 exists; `TODO.md` ticks the deliverable and records the deferred e2e-gate decision as an open item.
- All ten definition-of-done commands pass, each run separately and each log read, plus `test:e2e`. The dead-port control shows the count dropping by 36 with both integration files reported skipped.

## What stage 3 needs from this

- `TripMap` accepts `bbox` and `styleUrl` and nothing else. Stage 3's markers and route need the `IndexEntry[]`, so the prop is added there — along with `lib/map/points.ts`, `legs.ts`, `dashes.ts` and `view.ts`, all of which are now inside a fenced directory.
- `useMapInstance` returns a status but not the instance. Stage 3 needs the instance to add sources and layers: widen the return to `{ status, map }` there, rather than reaching into the ref from the component now.
- `setProjection` has exactly one call site, in the `style.load` handler, and the globe view in phase 4's last deliverable changes that argument rather than adding a second call.
- `SOURCE_ID` is `"openmaptiles"`. Stage 3's point and leg sources must not collide with it.
- The e2e gate question is open and belongs to stage 3's plan, because that is when the owner said to revisit it.

# Phase 4 — Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dark desaturated basemap style, authored in-repo to the design brief's map tokens, validated against the real MapLibre style spec, with `MAP_STYLE_URL` demoted from default to wholesale override.

**Architecture:** Colours first, because MapLibre cannot parse `oklch()` and the stylesheet is written entirely in it — so the style has to restate the palette in hex, and a drift check has to exist before anything depends on it. Then the style itself, composed from four layer-group functions rather than one long builder, because `lib/**` has an 80-line hard bound and seventeen layer literals in one function would blow it. Then the config seam, which is what lets a deployer opt out.

**Tech Stack:** Node 22.23.2, TypeScript 6.0.3, Vitest 4, and `@maplibre/maplibre-gl-style-spec` — already in the tree as a transitive dependency of `maplibre-gl@6.6.0`, and promoted to a declared devDependency by Task 2 Step 1, because `maplibre-gl` re-exports none of what this stage needs from it.

**Spec:** `docs/superpowers/specs/2026-09-09-map-and-timeline-design.md` — §4.

**Depends on:** Stage 0 (`docs/superpowers/plans/2026-09-09-map-and-timeline-stage-0.md`) landing first. Nothing here imports `lib/time` or `lib/place`, but stage 0 removes `react-map-gl` and this stage assumes `maplibre-gl` is the only map library present.

## Global Constraints

- **Node 22.** `nvm use`, then confirm `node -v` prints `v22.x`. If `nvm` is not on `PATH`: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. Every command below runs and passes on Node 20 too, which is why checking is a step you do.
- **`npm test` needs a Pod.** `npm run pod:dev &` first, or the two integration suites skip themselves. Measured 2026-09-09: with the Pod up, **1420 passed | 2 todo**; with it down, **1384 passed | 36 skipped | 2 todo** — 62 files either way, and the 36 are the whole of `test/integration/`. Run the control once before closing the stage.
- **`npm run test:e2e` is NOT required by this stage's diff** — it touches `lib/map/**`, `lib/config.ts`, `app/globals.css`, `.env.example` and `docs/`, none of which are among the six paths `CLAUDE.md`'s path-scoped gate names. Do not run it, and do not add those paths to the gate here; stage 2 does that, when there is a public component to gate.
- **No network in any test.** `test/network-guard.test.ts` pins a guard that fails a test on a real `fetch`, and it was decorative for as long as nothing tested it. Everything in this stage is offline: `validateStyleMin` is a local function, and the OpenFreeMap URLs are asserted as strings, never fetched.
- **MapLibre cannot parse `oklch()`.** Measured 2026-09-09: `Color.parse("oklch(0.185 0.008 250)")` returns `undefined`, and `validateStyleMin` rejects it with `color expected, "oklch(0.185 0.008 250)" found`. Every colour in the style is a 6-digit hex string. Do not "modernise" one to `oklch()`; the style will silently stop rendering that layer.
- **Comment blocks in production code are a hard bound of six lines and the repository is at zero over it.** Anything longer moves to `lib/map/notes.md` behind an anchor, with the code keeping `// <one line>; see ./notes.md#anchor`. An anchor that does not resolve fails `check:structure`.
- **`lib/**` function length: 50 tendency, 80 hard bound**, excluding comments and blank lines. ESLint errors at 80.
- **Arbitrary Tailwind values are banned outside `components/ui/**`.** Nothing in this stage writes a class string, but `app/globals.css` is edited — comments only.
- **The `dy:` namespace is still `https://example.org/ns/traveldiary#`.** Nothing here touches a Pod.
- **`lib/` holds no React.** `lib/map/` is pure data.

- **The code-structure refactor's conventions bind every line of this stage.** **`CLAUDE.md` § Code structure is the rules; `docs/code-structure.md` is the reasoning and the measurements — read that before arguing with one.** Three mechanics that catch people, all of them measured rather than reasoned: **delimiter lines count**, so a `/** … */` block's real budget is four lines of prose; **two comment blocks with no blank line between them are one run**, and a blank line resets it, so splitting a docblock in place is a legitimate fix; and the `notes.md` slug drops punctuation rather than hyphenating it while **keeping `_`**, so `place.ts` becomes `placets` and `MAP_STYLE_URL` becomes `map_style_url`. Check a slug, never reason about it.
- **Readability is the point and the line counts are a proxy for it.** A change that hits 130/50 by extracting helpers whose names hide the arrangement has failed, even with every check green. Do not tighten a lint rule to a tendency value — that undoes an instruction. And never quote a threshold you did not get from the enforcing tool: this project has a committed error from a hand-written line counter that disagreed with ESLint by a third.
- **Do not add an `eslint-disable` to get a check green.** There is exactly one in the repository and `active exemptions — 0` for length bounds. If a bound is hit, decompose — or report it and stop.
- **`lib/map/**` does not exist yet, so `eslint.config.mjs`'s belt and its `maplibre-gl` fence name nothing under it — do not make that config change now.** This stage creates the directory the design puts all the map code in, and stage 0's belt block and public-block `paths`/`patterns` entries were both enumerated by name rather than matched by a glob over `lib/**`. As soon as `lib/map/**/*.ts` exists, it needs to join the belt's `files` array (it is reachable from a public page exactly as `lib/pod/rdf.ts` was), and once `lib/map/view.ts` (stage 2) imports `maplibre-gl` for real, that directory needs the same exact-specifier `maplibre-gl` `paths` entry and deep-path `patterns` entry the public block carries — ideally by hoisting those two entries into a shared const both blocks spread, so the two copies cannot drift the way the belt's `ACL_PRIMITIVES` repetition almost did. `lib/utils.ts` will want the same fencing once stage 2's component imports `cn` from it. Stage 2's plan must open a task for both edits; this stage does not make them.

## File Structure

| File | Responsibility |
|---|---|
| `lib/map/tokens.ts` | the six map-relevant palette colours as hex, plus the CSS custom property each mirrors |
| `lib/map/tokens.test.ts` | the drift check: every hex equals the one `app/globals.css` records for that token |
| `lib/map/style.ts` | `buildBasemapStyle()`, and the four layer-group functions it composes |
| `lib/map/style.test.ts` | nine cases: spec validation, the OpenFreeMap literals, no API key, palette used, channel spread, fontstack, hex-only, no accent, label order |
| `lib/map/notes.md` | why hex and not oklch, what the drift check does not catch, why seventeen layers |
| `app/globals.css` | hex comments added to the three `--color-map-*` lines, matching the convention the other eight already follow |
| `lib/config.ts` | `mapStyleUrl` getter |
| `lib/config.test.ts` | five cases — unset, set, blank, trimmed, and the `.env.example` regression |
| `lib/notes.md` | the override's reasoning, behind a new anchor |
| `.env.example` | `MAP_STYLE_URL` commented out, with both meanings written down |
| `package.json`, `package-lock.json` | `@maplibre/maplibre-gl-style-spec` promoted from transitive to declared devDependency |
| `docs/versions.md` | that pin, and the upgrade trap it carries |
| `docs/decisions.md` | new §27 |
| `TODO.md` | phase 4's first deliverable ticked |

---

### Task 1: the palette, in hex, and a check that it cannot drift

**MapLibre cannot read a CSS custom property, and it cannot parse `oklch()` either.** So the style module has to carry the palette itself, in hex — which duplicates `app/globals.css`. That is the same shape as `BLUR_BUDGET_BYTES`, which `lib/pod/schema.ts` restates rather than imports because `lib/media` is fenced from public routes, and whose docblock says "keep the two in step".

This gets more than a comment. `app/globals.css` **already** records the hex beside eight of its eleven `@theme` colours, in a trailing `/* #RRGGBB … */` comment — the accent trio included. Task 1 extends that convention to the three `--color-map-*` lines and then makes the stylesheet's own comment the thing `lib/map/tokens.ts` is checked against.

**What this catches and what it does not**, stated rather than implied: it catches someone editing one file and not the other, which is the real risk. It does **not** catch a hex comment that is wrong for its `oklch()` value — that is a one-time colour-space question, answered by `docs/design-brief.md`, which computed all eleven and verified them in-gamut for sRGB with contrast ratios measured.

**Files:**
- Create: `lib/map/tokens.ts`
- Create: `lib/map/tokens.test.ts`
- Create: `lib/map/notes.md`
- Modify: `app/globals.css` — three trailing comments

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAP_COLORS: Record<MapColor, string>` — hex strings, keys `land`, `water`, `label`, `accent`, `accentBright`, `accentDeep`. Task 2 and stage 3 both use this.
  - `MAP_COLOR_TOKENS: Record<MapColor, string>` — the same keys, mapping to the CSS custom property name each mirrors. Only the test uses it.
  - `type MapColor = keyof typeof MAP_COLORS`.

- [ ] **Step 1: Write the failing test**

Create `lib/map/tokens.test.ts`:

```ts
/**
 * MapLibre cannot read a CSS custom property and cannot parse `oklch()`, so
 * the palette is restated in hex and this is what stops the two drifting.
 * What it does not catch: ./notes.md#the-drift-check-and-what-it-does-not-catch
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAP_COLORS, MAP_COLOR_TOKENS } from "@/lib/map/tokens";

const CSS = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

/** Pulls the oklch value and the hex the stylesheet records beside it, off a
 *  line of the shape `--color-accent: oklch(...); ` plus a trailing hex
 *  comment. The colon is what stops `--color-accent` matching
 *  `--color-accent-bright`. */
function declared(token: string): { oklch: string; hex: string } | undefined {
  const found = new RegExp(
    `${token}:\\s*(oklch\\([^)]*\\));\\s*/\\*\\s*(#[0-9A-Fa-f]{6})`,
  ).exec(CSS);
  return found === null ? undefined : { oklch: found[1], hex: found[2].toUpperCase() };
}

describe("MAP_COLORS against app/globals.css", () => {
  it("mirrors a token that the stylesheet actually declares, for every colour", () => {
    for (const [key, token] of Object.entries(MAP_COLOR_TOKENS)) {
      expect(declared(token), `${key} → ${token}`).toBeDefined();
    }
  });

  it("carries the same hex the stylesheet records", () => {
    for (const [key, token] of Object.entries(MAP_COLOR_TOKENS)) {
      expect(declared(token)?.hex, `${key} → ${token}`).toBe(
        MAP_COLORS[key as keyof typeof MAP_COLORS].toUpperCase(),
      );
    }
  });

  it("names the same six colours in both objects, so neither can gain one alone", () => {
    expect(Object.keys(MAP_COLORS).sort()).toEqual(Object.keys(MAP_COLOR_TOKENS).sort());
  });

  it("holds six-digit hex and never oklch, because MapLibre parses one and not the other", () => {
    // Color.parse("oklch(…)") returns undefined and validateStyleMin rejects
    // it: ./notes.md#why-the-style-is-hex-and-not-oklch
    for (const [key, hex] of Object.entries(MAP_COLORS)) {
      expect(hex, key).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
```

Create `lib/map/notes.md` in the same step — the two docblocks above already point into it, and `check:structure` fails on an anchor that does not resolve:

```markdown
# lib/map — notes

## Why the style is hex and not oklch

`app/globals.css` is written entirely in `oklch()`, and MapLibre cannot parse
it. Measured 2026-09-09 against the installed
`@maplibre/maplibre-gl-style-spec`:

    Color.parse("oklch(0.185 0.008 250)")  ->  undefined
    Color.parse("#101316")                 ->  { r: 0.0627…, g: 0.0745…, b: 0.0862…, a: 1 }

    validateStyleMin(… "background-color": "oklch(0.185 0.008 250)" …)
      -> ['layers[0].paint.background-color: color expected, "oklch(0.185 0.008 250)" found']

So the failure mode is not a thrown error at startup. A layer with an
unparseable colour is a layer that does not draw, and a basemap missing its
water fill looks like a tile problem rather than a colour problem. Hence the
`/^#[0-9A-Fa-f]{6}$/` assertion in `tokens.test.ts`: it is there to stop
someone modernising a value into the spelling the rest of the project uses.

## The drift check and what it does not catch

`app/globals.css` records the hex beside eight of its eleven `@theme` colours
in a trailing comment, and Task 1 extended that to the three `--color-map-*`
lines. `tokens.test.ts` parses those comments and asserts `MAP_COLORS` agrees.

**It catches** someone editing the stylesheet and not the style module, or the
other way round, which is the drift that actually happens.

**It does not catch** a hex comment that is wrong for the `oklch()` value on
the same line. That would need an OKLCH→sRGB conversion in the test — about
twenty-five lines of colour maths with a rounding tolerance to argue about, and
a second place for the answer to be wrong. `docs/design-brief.md` computed all
eleven pairs and verified them in-gamut for sRGB with contrast ratios measured,
so the pairing is settled upstream and the check guards the copy rather than
the arithmetic.

**It does not reach the CSS at runtime either.** Nothing here proves the
browser renders the same colour the style names; that is what stage 2's
Playwright spec looks at.
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run lib/map/tokens.test.ts`

Expected: FAIL with `Failed to resolve import "@/lib/map/tokens"`. Not an assertion failure.

- [ ] **Step 3: Create the module and extend the stylesheet's convention**

Create `lib/map/tokens.ts`:

```ts
/**
 * The palette the map draws with, in hex because MapLibre parses hex and not
 * `oklch()`: ./notes.md#why-the-style-is-hex-and-not-oklch
 * Values are `app/globals.css`'s, checked against it by `tokens.test.ts`.
 */

/** Basemap, then the two-step accent the route and markers use. Roads and
 *  boundaries are NOT here: they are near-achromatic greys hand-stepped off
 *  `land` in `style.ts`, and `style.test.ts` bounds their channel spread. */
export const MAP_COLORS = {
  land: "#101316",
  water: "#152026",
  label: "#70757A",
  accent: "#1295FC",
  accentBright: "#84C0FD",
  accentDeep: "#034F8A",
} as const;

export type MapColor = keyof typeof MAP_COLORS;

/** The CSS custom property each mirrors. Same keys as `MAP_COLORS`, asserted,
 *  so neither object can gain a colour on its own. */
export const MAP_COLOR_TOKENS: Record<MapColor, string> = {
  land: "--color-map-land",
  water: "--color-map-water",
  label: "--color-map-label",
  accent: "--color-accent",
  accentBright: "--color-accent-bright",
  accentDeep: "--color-accent-deep",
};
```

Then in `app/globals.css`, add the trailing hex comment to the three basemap lines, aligned with the eight above them. The hex values come from `docs/design-brief.md`'s basemap table — do not compute them:

```css
  --color-map-land:      oklch(0.185 0.008 250); /* #101316 landmass, near-neutral */
  --color-map-water:     oklch(0.235 0.020 235); /* #152026 water, desaturated     */
  --color-map-label:     oklch(0.560 0.010 250); /* #70757A place labels           */
```

Nothing else in `globals.css` changes — the `oklch()` values are untouched, and the eight existing comments are untouched.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run lib/map/tokens.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the check is not vacuous**

A drift check that cannot fail is worse than none. Break each side once, watch it fail, and put it back:

**Every recipe below is guarded, because a `sed` that matches nothing exits 0 and leaves the test green** — which looks exactly like a check that works. Anchor on the bare hex rather than the whole comment, so the wording of Step 3's comment cannot break the recipe:

```sh
# The stylesheet's side.
sed -i '' 's|#101316|#101317|' app/globals.css
grep -q '#101317' app/globals.css || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/tokens.test.ts   # expect FAIL: "#101317" vs "#101316"
git checkout -- app/globals.css
```

```sh
# The module's side, and the shape guard.
sed -i '' 's|land: "#101316"|land: "oklch(0.185 0.008 250)"|' lib/map/tokens.ts
grep -q 'land: "oklch' lib/map/tokens.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/tokens.test.ts   # expect FAIL on two cases: the hex compare AND the /^#…$/ shape
git checkout -- lib/map/tokens.ts
```

Both must fail, and the second must fail on **two** cases — if the shape guard stays green while holding an `oklch()` string, its regex is wrong.

- [ ] **Step 6: Run the checks and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

`check:structure` is the one that matters: it resolves `#why-the-style-is-hex-and-not-oklch` and `#the-drift-check-and-what-it-does-not-catch` in `lib/map/notes.md`, and confirms `tokens.test.ts` has `tokens.ts` beside it.

```sh
git add lib/map app/globals.css
git commit -m "The map palette is hex, and the stylesheet is what it is checked against

MapLibre cannot read a CSS custom property and cannot parse oklch(), which is
the spelling app/globals.css uses throughout. Measured: Color.parse returns
undefined and validateStyleMin says 'color expected'. The failure mode is not
an error — it is a layer that does not draw, so a missing water fill reads as a
tile problem.

So the palette is restated in hex, the shape lib/pod/schema.ts already has with
BLUR_BUDGET_BYTES. It gets more than a keep-in-step comment: globals.css
already records the hex beside eight of its eleven @theme colours in a trailing
comment, that convention now extends to the three --color-map-* lines, and
tokens.test.ts parses those comments and asserts the module agrees. Both sides
were broken once to watch it fail.

What it does not catch is a hex comment wrong for its own oklch value. That is
colour maths with a tolerance to argue about, and design-brief.md settled all
eleven pairs in-gamut upstream — so the check guards the copy, not the
arithmetic. Said so in notes.md rather than implied.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `buildBasemapStyle`

`docs/design-brief.md` calls this "the single highest-leverage visual decision in the project" and says it lives in the style JSON rather than the stylesheet. So the style is authored, not fetched and recoloured.

**Seventeen layers, subtracted from OpenFreeMap's forty-seven rather than copied.** Dropped: buildings, aeroways, oneway arrows, road labels, railway dashlines, water labels. A spare basemap serves a photograph-first page better than a complete cartographic one, and it is less code — the brief's "let one element be the memorable thing and keep everything around it quiet", applied to the map.

**The whole style below has been validated against the real spec** — `validateStyleMin` returned zero errors on 2026-09-09. Type it in as given rather than improvising equivalents; several of the filter and expression spellings are the ones the spec accepts and near-misses are rejected.

**Four group functions, not one builder.** `lib/**` carries an 80-line hard bound and seventeen layer literals in one function blows it. The split is by cartographic role, which is also how the brief argues about them.

**Files:**
- Modify: `package.json`, `package-lock.json` — declare `@maplibre/maplibre-gl-style-spec`
- Modify: `docs/versions.md` — record the pin and why it is declared
- Create: `lib/map/style.ts`
- Create: `lib/map/style.test.ts`
- Modify: `lib/map/notes.md` — two new anchors

**Interfaces:**
- Consumes: `MAP_COLORS` from `@/lib/map/tokens` (Task 1).
- Produces:
  - `TILES_URL = "https://tiles.openfreemap.org/planet"`, `GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"`, `FONTSTACK = ["Noto Sans Regular"]`.
  - `buildBasemapStyle(): StyleSpecification` — **no parameters.** An earlier draft took
    `{ tiles?, glyphs? }`, and nothing could ever reach it: stage 1 adds only
    `config.mapStyleUrl`, stage 2 passes only that, and §27's own "Also considered" *rejects* a
    `MAP_TILES_URL`. A dead parameter plus a test whose name asserts "a deployer can self-host
    tiles" is a product claim the stage does not ship. The endpoints are module constants, so
    adding the parameter later is a one-line change if anyone asks for it.
  - `SOURCE_ID = "openmaptiles"` — stage 3 adds its own sources beside it and needs to not collide.

- [ ] **Step 1: Declare `@maplibre/maplibre-gl-style-spec`, because it is currently transitive**

Both the types this task imports (`StyleSpecification`, `LayerSpecification`) and the validator the test depends on (`validateStyleMin`) live in `@maplibre/maplibre-gl-style-spec`. **`maplibre-gl` does not re-export any of them** — measured 2026-09-09 by reading its `export { … }` list in `node_modules/maplibre-gl/dist/maplibre-gl.d.ts`, which carries `AttributionControl`, `Marker`, `Map` and around two hundred others, and none of these three.

So it has to be imported directly, and today it is only present because `maplibre-gl@6.6.0` depends on `^26.3.0` (resolved: `26.4.1`). Importing an undeclared transitive dependency works under npm's flat `node_modules` and **fails under pnpm's strict layout** — and `docs/decisions.md` §21 says the package manager is deliberately not dictated. Declaring it is the fix, not a new dependency: the package is already installed and already pinned by MapLibre.

```sh
node -v          # v22.x — .npmrc sets engine-strict, so npm refuses on the wrong runtime
npm install -D @maplibre/maplibre-gl-style-spec@26.4.1
```

**Confirm the version against what MapLibre resolves rather than trusting `26.4.1`:**

```sh
node -e "console.log(require('./node_modules/maplibre-gl/package.json').dependencies['@maplibre/maplibre-gl-style-spec'])"
node -e "console.log(require('./node_modules/@maplibre/maplibre-gl-style-spec/package.json').version)"
```

The second must satisfy the first, or there are two copies in the tree and the validator would be a different version from the one MapLibre's own types describe. If they disagree, pin to whatever MapLibre resolved and say so in the commit.

**A devDependency, deliberately.** `lib/map/style.ts` uses it only through `import type`, which TypeScript erases, and `validateStyleMin` is called only from a test. Nothing ships. Verify that after Task 3's build: `size:public` must still report every studio-only dependency absent, and the style spec must not appear in any public chunk.

Add to `docs/versions.md`, in whatever section holds the map dependencies:

```markdown
- **`@maplibre/maplibre-gl-style-spec@26.4.1`** — devDependency, declared 2026-09-09. Already in
  the tree as a transitive dependency of `maplibre-gl@6.6.0` (which asks for `^26.3.0`), but
  `maplibre-gl` re-exports neither `StyleSpecification`, `LayerSpecification` nor
  `validateStyleMin` — verified against its `export { … }` list, not assumed. An undeclared
  transitive import works under npm's flat `node_modules` and breaks under pnpm, and
  `docs/decisions.md` §21 leaves the package manager to the checkout. **On a `maplibre-gl`
  upgrade, re-check that this pin still satisfies MapLibre's own range**, or the validator and
  the types come from two different copies.
```

- [ ] **Step 2: Write the failing test**

Create `lib/map/style.test.ts`:

```ts
/**
 * The basemap, checked against the real style spec rather than against its own
 * object literal. Why seventeen: ./notes.md#seventeen-layers-and-what-was-left-out
 */

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { MAP_COLORS } from "@/lib/map/tokens";
import { FONTSTACK, GLYPHS_URL, SOURCE_ID, TILES_URL, buildBasemapStyle } from "@/lib/map/style";

describe("buildBasemapStyle", () => {
  it("is accepted by the MapLibre style spec", () => {
    // The point of the whole file: an assertion against our own literal would
    // verify nothing. validateStyleMin is the real validator, offline.
    expect(validateStyleMin(buildBasemapStyle()).map((e) => e.message)).toEqual([]);
  });

  it("draws from OpenFreeMap, which needs no key, no account and no cookies", () => {
    // The LITERAL host, not TILES_URL — comparing the output against the
    // module's own constants is a tautology that stays green if someone
    // repoints them at a keyed provider, which is invariant 6 breaking.
    const style = buildBasemapStyle();
    expect(style.sources[SOURCE_ID]).toEqual({
      type: "vector",
      url: "https://tiles.openfreemap.org/planet",
    });
    expect(style.glyphs).toBe(
      "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    );
    // And the constants are what the style actually uses, so the two halves
    // of this file cannot disagree.
    expect(TILES_URL).toBe("https://tiles.openfreemap.org/planet");
    expect(GLYPHS_URL).toBe(style.glyphs);
  });

  it("carries no API key, token or placeholder for one, anywhere", () => {
    // Invariant 6 is "zero required API keys", and it is a product feature.
    expect(JSON.stringify(buildBasemapStyle())).not.toMatch(
      /\{?(key|access[_-]?token|api[_-]?key|apikey)\}?/i,
    );
  });

  it("uses land, water and label — a ban on the accent is not proof it used the palette", () => {
    const json = JSON.stringify(buildBasemapStyle()).toUpperCase();
    for (const key of ["land", "water", "label"] as const) {
      expect(json, key).toContain(MAP_COLORS[key].toUpperCase());
    }
  });

  it("keeps every road and boundary achromatic, which is the brief's actual rule", () => {
    // "Any saturated hue in the basemap competes with the route." 32 is
    // measured, not chosen: ./notes.md#the-achromatic-bound-is-32-and-why
    const inks = JSON.stringify(buildBasemapStyle()).match(/"#[0-9a-fA-F]{6}"/g) ?? [];
    expect(inks.length, "no colours found means this loop asserts nothing").toBeGreaterThan(10);
    const palette = new Set(Object.values(MAP_COLORS).map((h) => h.toUpperCase()));
    for (const quoted of inks) {
      const hex = quoted.slice(2, -1).toUpperCase();
      if (palette.has(`#${hex}`)) continue;
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b), `#${hex}`).toBeLessThanOrEqual(32);
    }
  });

  it("names only a fontstack the glyph endpoint serves, on every symbol layer", () => {
    // NO `if (font !== undefined)` GUARD, and that is the whole case. A missing
    // text-font is spec-legal — validateStyleMin returns [] — and MapLibre then
    // falls back to a fontstack OpenFreeMap does not serve, so every place
    // label silently disappears. A guarded loop skips exactly that failure.
    const symbols = buildBasemapStyle().layers.filter((l) => l.type === "symbol");
    expect(symbols.length, "no symbol layer means the loop below asserts nothing").toBe(5);
    for (const layer of symbols) {
      expect(layer.layout?.["text-font"], layer.id).toEqual(FONTSTACK);
    }
  });

  it("uses hex everywhere, because an oklch colour is a layer that does not draw", () => {
    const colours = JSON.stringify(buildBasemapStyle()).match(/"[^"]*oklch\([^"]*"/g);
    expect(colours).toBeNull();
  });

  it("spends no accent colour in the basemap, because the route needs all three", () => {
    // The brief: "any saturated hue in the basemap competes with the route".
    // The accent trio belongs to the route and the markers, which stage 3 adds
    // imperatively — so none of it may appear here. Narrower than the channel
    // -spread case above and kept beside it: this one names the three hexes.
    const json = JSON.stringify(buildBasemapStyle());
    for (const key of ["accent", "accentBright", "accentDeep"] as const) {
      expect(json.toUpperCase(), key).not.toContain(MAP_COLORS[key].toUpperCase());
    }
  });

  it("puts every label above every fill and line, so nothing paints over a place name", () => {
    const types = buildBasemapStyle().layers.map((l) => l.type);
    expect(types.lastIndexOf("fill")).toBeLessThan(types.indexOf("symbol"));
    expect(types.lastIndexOf("line")).toBeLessThan(types.indexOf("symbol"));
  });
});
```

- [ ] **Step 3: Run it and watch it fail for the right reason**

Run: `npx vitest run lib/map/style.test.ts`

Expected: FAIL with `Failed to resolve import "@/lib/map/style"`.

- [ ] **Step 4: Write the style**

Create `lib/map/style.ts`. This is the validated content:

```ts
/**
 * The dark desaturated basemap, authored rather than recoloured.
 * ./notes.md#seventeen-layers-and-what-was-left-out
 */
import type { LayerSpecification, StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import { MAP_COLORS } from "@/lib/map/tokens";

/** OpenFreeMap: no key, no account, no cookies (decisions.md §7). Overridable
 *  per deployer; the OSM attribution it requires is added by the map, never
 *  here, and is never removed. */
export const TILES_URL = "https://tiles.openfreemap.org/planet";
export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

/** The only fontstack the glyph endpoint is known to serve — measured, not
 *  chosen. Typefaces are phase 7 and are unrelated to this. */
export const FONTSTACK = ["Noto Sans Regular"];

/** Stage 3 adds its own sources beside this one, so the id is exported rather
 *  than spelled twice. */
export const SOURCE_ID = "openmaptiles";

/** Achromatic steps off `land`, not palette tokens: the brief bans a saturated
 *  hue in the basemap so the route and the photographs are the only saturated
 *  things on screen. */
const INK = {
  wood: "#131719",
  glacier: "#1a1f23",
  park: "#121618",
  roadMinor: "#191d21",
  roadMajor: "#20252a",
  roadMotorway: "#272d33",
  rail: "#1d2226",
  boundaryState: "#232a30",
  boundaryCountry: "#2c343b",
} as const;

/** Background, water and the two landcover steps. Everything here paints
 *  before any line or label. */
function groundLayers(): LayerSpecification[] {
  return [
    { id: "background", type: "background", paint: { "background-color": MAP_COLORS.land } },
    {
      id: "water",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "water",
      // A tunnelled waterway is under the ground, not on it.
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: { "fill-color": MAP_COLORS.water },
    },
    {
      id: "waterway",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "waterway",
      paint: {
        "line-color": MAP_COLORS.water,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 2],
      },
    },
    {
      id: "landcover_wood",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "landcover",
      filter: ["==", ["get", "class"], "wood"],
      paint: { "fill-color": INK.wood, "fill-opacity": 0.6 },
    },
    {
      id: "landcover_glacier",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "landcover",
      filter: ["==", ["get", "subclass"], "glacier"],
      paint: { "fill-color": INK.glacier, "fill-opacity": 0.5 },
    },
    {
      id: "landuse_park",
      type: "fill",
      source: SOURCE_ID,
      "source-layer": "landuse",
      filter: ["==", ["get", "class"], "park"],
      paint: { "fill-color": INK.park },
    },
  ];
}

/** One line layer per road class, plus rail. No casings: a casing on a road
 *  competes with the route's, which is the one thing the brief wants cased. */
function roadLayers(): LayerSpecification[] {
  const road = (
    id: string,
    classes: string[],
    color: string,
    narrow: number,
    wide: number,
  ): LayerSpecification => ({
    id,
    type: "line",
    source: SOURCE_ID,
    "source-layer": "transportation",
    filter: ["in", ["get", "class"], ["literal", classes]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 6, narrow, 18, wide],
    },
  });

  return [
    road("highway_minor", ["minor", "service", "track", "path"], INK.roadMinor, 0.3, 3),
    road("highway_major", ["primary", "secondary", "tertiary", "trunk"], INK.roadMajor, 0.6, 6),
    road("highway_motorway", ["motorway"], INK.roadMotorway, 0.9, 8),
    {
      id: "railway",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "transportation",
      filter: ["==", ["get", "class"], "rail"],
      paint: {
        "line-color": INK.rail,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 18, 1.6],
        "line-dasharray": [3, 2],
      },
    },
  ];
}

/** Country and state only. `admin_level` is a number in this schema, so the
 *  comparisons are numeric rather than string. */
function boundaryLayers(): LayerSpecification[] {
  return [
    {
      id: "boundary_state",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "boundary",
      filter: ["==", ["get", "admin_level"], 4],
      minzoom: 4,
      paint: {
        "line-color": INK.boundaryState,
        "line-width": 0.7,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "boundary_country",
      type: "line",
      source: SOURCE_ID,
      "source-layer": "boundary",
      filter: ["<=", ["get", "admin_level"], 2],
      layout: { "line-join": "round" },
      paint: {
        "line-color": INK.boundaryCountry,
        "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 8, 1.6],
      },
    },
  ];
}

/** Five place classes, smallest first so the largest paints last. A halo in
 *  `land` is what keeps a label legible over water and over a route line. */
function labelLayers(): LayerSpecification[] {
  const place = (
    id: string,
    cls: string,
    small: number,
    large: number,
    minzoom: number,
  ): LayerSpecification => ({
    id,
    type: "symbol",
    source: SOURCE_ID,
    "source-layer": "place",
    minzoom,
    filter: ["==", ["get", "class"], cls],
    layout: {
      "text-field": ["coalesce", ["get", "name:latin"], ["get", "name"]],
      "text-font": FONTSTACK,
      "text-size": ["interpolate", ["linear"], ["zoom"], minzoom, small, minzoom + 6, large],
      "text-max-width": 8,
      "text-padding": 4,
    },
    paint: {
      "text-color": MAP_COLORS.label,
      "text-halo-color": MAP_COLORS.land,
      "text-halo-width": 1.1,
    },
  });

  return [
    place("place_village", "village", 9, 11, 10),
    place("place_town", "town", 10, 13, 8),
    place("place_city", "city", 11, 15, 5),
    place("place_state", "state", 10, 13, 4),
    place("place_country", "country", 10, 15, 2),
  ];
}

/** The style, in paint order: ground, roads, boundaries, labels. */
export function buildBasemapStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Travel diary — dark",
    glyphs: GLYPHS_URL,
    sources: {
      [SOURCE_ID]: { type: "vector", url: TILES_URL },
    },
    layers: [...groundLayers(), ...roadLayers(), ...boundaryLayers(), ...labelLayers()],
  };
}
```

Add the anchor to `lib/map/notes.md`:

```markdown
## Seventeen layers, and what was left out

OpenFreeMap's own dark style has forty-seven layers, and this one is subtracted
from that list rather than assembled from scratch. Left out deliberately:
buildings, aeroways, oneway arrows, road labels, railway dashlines and water
labels.

The reason is the brief's, not laziness. The basemap exists so that the route
line and the photographs are the only saturated things on screen, and a
complete cartographic style competes with both. Enumerated rather than counted,
because a count in this repository goes stale the first time the list moves:

    background            landuse_park          boundary_country      place_city
    water                 highway_minor         boundary_state        place_town
    waterway              highway_major         place_country         place_village
    landcover_wood        highway_motorway      place_state
    landcover_glacier     railway

## The achromatic bound is 32, and why

`docs/design-brief.md` requires that "roads and boundaries stay achromatic",
and `style.test.ts` enforces it as a bound on each colour's RGB channel spread
— `max - min` — which is zero for a true grey and large for a saturated hue.

The number is measured, not chosen. The nine `INK` values span **6 to 15**
(`wood` 6, `park` 6, `roadMinor` 8, `glacier` 9, `rail` 9, `roadMajor` 10,
`roadMotorway` 12, `boundaryState` 13, `boundaryCountry` 15). The accent trio
spans **121 to 234** (`accentBright` 121, `accentDeep` 135, `accent` 234). So
32 sits in a gap 106 wide, 17 above the highest ink and 89 below the lowest
accent.

The inks are not literally achromatic and are not meant to be: the brief gives
the whole palette a cool cast at hue 250 so the accent "reads as belonging to
the palette instead of sitting on top of it". A bound of 12 was the first
guess and it fails on both boundary colours.

`MAP_COLORS` values are skipped rather than bounded. `map-water` measures 17 —
deliberately tinted to hue 235 — and the accent trio is banned outright by the
case beside this one, which names the three hexes.

## Roads carry no casing

Unlike OpenFreeMap's, which draws a casing and an inner
line per class. The brief wants exactly one cased line on the map — the route —
and a cased road at the same zoom reads as a competing route.

`admin_level` is a number in the OpenMapTiles schema, so the boundary filters
compare numerically. A string comparison silently matches nothing, which looks
like a tile problem.
```

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run lib/map/style.test.ts`

Expected: PASS, 9 tests. If the spec-validation case fails, read the messages — each names a layer **index** and a property, never the layer id, and the fix is in this file rather than in the test.

- [ ] **Step 6: Prove the four load-bearing cases are not vacuous**

Four mutations, each guarded. **The validator names the layer INDEX, never the layer id** — the spec-validation case is the one carrying the whole file, so read its message rather than pattern-matching on a name:

```sh
# 1. Spec validation. Expect: layers[10].paint.line-width: number expected, string found
sed -i '' 's|"line-width": 0.7,|"line-width": "0.7",|' lib/map/style.ts
grep -q '"line-width": "0.7"' lib/map/style.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/style.test.ts
git checkout -- lib/map/style.ts
```

```sh
# 2. The accent ban. Expect: the accent case fails, the channel-spread case does not
#    (#1295FC is in the palette set, so the spread loop skips it).
sed -i '' 's|"line-color": INK.boundaryCountry,|"line-color": MAP_COLORS.accent,|' lib/map/style.ts
grep -q 'MAP_COLORS.accent' lib/map/style.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/style.test.ts
git checkout -- lib/map/style.ts
```

```sh
# 3. The fontstack case — the one that matters most, because a MISSING text-font
#    is spec-legal and kills every label. Expect: the fontstack case fails and
#    validateStyleMin still returns [].
sed -i '' 's|      "text-font": FONTSTACK,||' lib/map/style.ts
grep -q '"text-font": FONTSTACK' lib/map/style.ts && { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/style.test.ts
git checkout -- lib/map/style.ts
```

```sh
# 4. The oklch ban, which "Done when" claims was watched failing. Mutating
#    tokens.ts reddens TWO style cases plus the token shape guard: six spec
#    errors (background-color and five text-halo-color) and a non-null oklch match.
sed -i '' 's|  land: "#101316",|  land: "oklch(0.185 0.008 250)",|' lib/map/tokens.ts
grep -q 'land: "oklch' lib/map/tokens.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/style.test.ts lib/map/tokens.test.ts
git checkout -- lib/map/tokens.ts
```

```sh
# 5. A saturated ink. Expect: only the channel-spread case fails.
sed -i '' 's|roadMajor: "#20252a",|roadMajor: "#2050a0",|' lib/map/style.ts
grep -q '#2050a0' lib/map/style.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/style.test.ts
git checkout -- lib/map/style.ts
```

```sh
# 6. A keyed tile endpoint — invariant 6. Expect TWO cases: the OpenFreeMap
#    literals and the key scan.
sed -i '' 's|"https://tiles.openfreemap.org/planet"|"https://tiles.example.com/planet?api_key={key}"|' lib/map/style.ts
grep -q 'api_key' lib/map/style.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/style.test.ts
git checkout -- lib/map/style.ts
```

```sh
# 7. The palette-used case. NOTE THE `g` — MAP_COLORS.water is used TWICE, by
#    `water` and by `waterway`, so a single-site swap leaves the hex in the JSON
#    and the suite stays at 9 passed. Measured: that looks exactly like a
#    vacuous test and is not one.
sed -i '' 's|MAP_COLORS.water|INK.rail|g' lib/map/style.ts
grep -q 'MAP_COLORS.water' lib/map/style.ts && { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/style.test.ts
git checkout -- lib/map/style.ts
```

**All seven were run on 2026-09-09 against this plan's own code**, and each reddens exactly the cases named: 3 → the fontstack case alone; 2 → the accent case alone; 1 → the spec case alone; 4 → the spec case and the hex case; 5 → the spread case alone; 6 → the literals case and the key scan; 7 → the palette-used case alone. With the style intact: **9 passed**.

Mutation 3 is the reason this step exists. An earlier draft of the fontstack case guarded on `if (font !== undefined)`, which skipped exactly this failure: with `text-font` deleted from all five symbol layers the suite reported **9 passed** and `validateStyleMin` returned **0 errors**, while MapLibre falls back to a fontstack OpenFreeMap does not serve and every place label vanishes.

- [ ] **Step 7: Run the checks and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

`lint` matters here: `max-lines-per-function` is 80 for `lib/**` and the four group functions are what keep it under. If it errors, split further rather than adding an `eslint-disable` — an exemption needs a reason and a removal condition, and "seventeen layer literals" is neither.

```sh
git add lib/map
git commit -m "The basemap style, seventeen layers, validated against the real spec

design-brief.md calls the dark desaturated basemap the project's
highest-leverage visual decision and puts it in the style JSON, so it is
authored here rather than fetched and recoloured. Subtracted from OpenFreeMap's
forty-seven rather than copied: no buildings, aeroways, oneway arrows, road
labels, railway dashlines or water labels. Enumerated in notes.md, not counted.

The test is validateStyleMin from @maplibre/maplibre-gl-style-spec, already a
transitive dependency and offline. A style test asserting against its own
object literal verifies nothing; this one was watched failing with a stringified
line-width. Two further cases earn their place the same way: no oklch anywhere,
and no accent colour in the basemap, because the brief's rule is that the route
and the photographs are the only saturated things on screen.

Four group functions rather than one builder, because lib/** has an 80-line
hard bound and seventeen layer literals in one function blows it. Roads carry no
casing on purpose — the brief wants exactly one cased line and a cased road
reads as a competing route. admin_level is numeric in this schema; a string
comparison matches nothing and looks like a tile problem.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `MAP_STYLE_URL` becomes an override, not the default

`.env.example` currently **sets** `MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark`. Anyone who copied it to `.env.local` — which its own first line instructs — gets OpenFreeMap's palette rather than the one Task 2 just built, with nothing to tell them that is not the design.

The variable stays, because decision 7's consequence is explicit: *"The style URL is an env var so any deployer can point at a paid provider."* Its meaning changes. Set ⇒ MapLibre loads that URL verbatim and the in-repo style is unused. Unset ⇒ the in-repo style.

`lib/config.ts` throws in the browser by design, so the value reaches the client as a prop from a server component — the pattern `app/(studio)/studio/page.tsx` already uses for `ownerWebId` and `siteUrl`. **No `NEXT_PUBLIC_` variable.** Stage 2 does the passing; this task only exposes the getter.

**Files:**
- Create: `lib/config.test.ts`
- Modify: `lib/config.ts`
- Modify: `lib/notes.md` — one new anchor
- Modify: `.env.example`
- Modify: `docs/decisions.md` — new §27
- Modify: `TODO.md` — tick phase 4's first deliverable

**Interfaces:**
- Consumes: nothing.
- Produces: `config.mapStyleUrl: string | undefined`. Stage 2's `app/(public)/trips/[slug]/layout.tsx` reads it and passes it to the map island, which calls `buildBasemapStyle()` when it is `undefined`.

- [ ] **Step 1: Write the failing test**

`lib/config.ts` has no test today. Create `lib/config.test.ts`:

```ts
/**
 * `MAP_STYLE_URL` is an override rather than a default, and `undefined` is the
 * signal that means "use the in-repo style".
 * ./notes.md#the-map-style-url-is-an-override-not-a-default
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { config } from "@/lib/config";

const original = process.env.MAP_STYLE_URL;

afterEach(() => {
  if (original === undefined) delete process.env.MAP_STYLE_URL;
  else process.env.MAP_STYLE_URL = original;
});

const SET = "https://tiles.example/styles/mine";

/** Each case asserts the getter is LIVE before asserting what it answers.
 *  Without that, "expected undefined" passes against a `config` object with no
 *  such property at all — green for the wrong reason, in the exact shape
 *  CLAUDE.md names. */
describe("config.mapStyleUrl", () => {
  it("is undefined when unset, which is what selects the in-repo style", () => {
    process.env.MAP_STYLE_URL = SET;
    expect(config.mapStyleUrl, "the getter is live").toBe(SET);
    delete process.env.MAP_STYLE_URL;
    expect(config.mapStyleUrl).toBeUndefined();
  });

  it("is the value verbatim when set, so a deployer's own style wins whole", () => {
    process.env.MAP_STYLE_URL = SET;
    expect(config.mapStyleUrl).toBe(SET);
  });

  it("treats an empty or blank value as unset, because a blank .env line is not a URL", () => {
    process.env.MAP_STYLE_URL = SET;
    expect(config.mapStyleUrl, "the getter is live").toBe(SET);
    process.env.MAP_STYLE_URL = "";
    expect(config.mapStyleUrl).toBeUndefined();
    process.env.MAP_STYLE_URL = "   ";
    expect(config.mapStyleUrl, "whitespace is blank too").toBeUndefined();
  });

  it("trims what it returns, so a stray leading space is not part of the URL", () => {
    process.env.MAP_STYLE_URL = ` ${SET} `;
    expect(config.mapStyleUrl).toBe(SET);
  });
});

/**
 * The regression decision 27 exists for, pinned so it cannot come back. Nothing
 * under `test/` or `scripts/` reads `.env.example`, so without this the only
 * guard was a `grep -c` in a plan nobody re-runs. The precedent for a test
 * reading a non-source file is `lib/map/tokens.test.ts` on `app/globals.css`.
 */
describe(".env.example", () => {
  it("ships no MAP_STYLE_URL value, because a copied .env.local would swap the palette", () => {
    const env = readFileSync(
      fileURLToPath(new URL("../.env.example", import.meta.url)),
      "utf8",
    );
    expect(env, "the file was found and is not empty").toContain("MAP_STYLE_URL");
    expect(env).not.toMatch(/^\s*MAP_STYLE_URL=.+$/m);
  });
});
```

The third case is the one worth having. `.env.example` ships commented-out lines that people uncomment and leave blank, and `""` passed to MapLibre as a style URL is a fetch of the current page.

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run lib/config.test.ts`

Expected: FAIL. The first case may pass by accident — `config.mapStyleUrl` is `undefined` because the getter does not exist — so check the failure names the second case, with `expected "https://tiles.example/styles/mine", received undefined`. TypeScript will also refuse the property; `npm run typecheck` is a second signal.

- [ ] **Step 3: Add the getter**

In `lib/config.ts`, inside the `config` object, after `siteUrl`:

```ts
  /** Unset means the in-repo basemap; set means load that URL wholesale.
   *  `""` is unset: ./notes.md#the-map-style-url-is-an-override-not-a-default */
  get mapStyleUrl() {
    const url = process.env.MAP_STYLE_URL?.trim();
    return url === undefined || url === "" ? undefined : url;
  },
```

Add the anchor to `lib/notes.md`:

```markdown
## The map style URL is an override, not a default

`.env.example` used to *set* this to `https://tiles.openfreemap.org/styles/dark`,
and its own first line tells you to copy the file to `.env.local`. So the
default deployment rendered OpenFreeMap's palette rather than the one
`docs/design-brief.md` specifies, and nothing said so — the map looked
plausible, which is the worst version of wrong.

The variable stays, because `docs/decisions.md` §7 is explicit that it is there
"so any deployer can point at a paid provider". Only its default changed:

- **unset** — `lib/map/style.ts` builds the style, from OpenFreeMap's vector
  tiles, to the brief's tokens.
- **set** — MapLibre loads that URL verbatim and the in-repo style is unused.
  Wholesale, deliberately: merging a deployer's style with ours would produce a
  third thing neither of us designed.

`""` is treated as unset. A commented-out line that someone uncomments and
leaves blank is the normal way this variable arrives empty, and `""` handed to
MapLibre as a style URL is a fetch of the current page — an HTML document
parsed as JSON, reported as a syntax error with no mention of the map.

`lib/config.ts` throws in the browser, so the value reaches the client as a
prop from a server component, the way `ownerWebId` already does. There is no
`NEXT_PUBLIC_MAP_STYLE_URL` and there must not be one.
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run lib/config.test.ts`

Expected: PASS, 5 tests — four on the getter, one on `.env.example`.

- [ ] **Step 5: Rewrite the `.env.example` block**

Replace the existing map block:

```
# Map tiles. OpenFreeMap needs no key, no account and no cookies — that is why
# it is the default. Point this at a paid provider if you prefer.
MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
```

with:

```
# Map style. LEAVE THIS UNSET unless you want your own cartography: unset means
# the project's own dark basemap, built to the palette in docs/design-brief.md
# from OpenFreeMap's vector tiles — no key, no account, no cookies, which is
# what makes "fork, set your WebID, deploy" true with no setup step.
#
# Set it and MapLibre loads that URL wholesale instead, so your style replaces
# ours rather than merging with it. That is the escape hatch for a paid
# provider or a self-hosted tile server (docs/decisions.md §7 and §27).
#
# Until 2026-09-09 this line shipped with a value, so a copied .env.local
# rendered OpenFreeMap's own palette and nothing said the design had been
# replaced. Blank counts as unset, so uncommenting it and leaving it empty is
# safe.
#MAP_STYLE_URL=
```

Then confirm nothing regressed for the other variables:

```sh
grep -c '^[A-Z_]*=' .env.example    # one fewer than at HEAD
```

- [ ] **Step 6: Record the decision and tick the deliverable**

Append to `docs/decisions.md`:

```markdown
---

## 27. The basemap style is authored in-repo; MAP_STYLE_URL overrides it wholesale

`docs/design-brief.md` calls the dark desaturated basemap "the single highest-leverage visual
decision in the project" and locates it in the style JSON rather than the stylesheet. Two ways to
honour that were available: author a style against OpenFreeMap's vector tiles, or fetch their dark
style and rewrite its paint properties at `style.load`.

**Authored, in `lib/map/style.ts`.** Recolouring a remote style keys every paint write to that
style's layer ids, so an upstream rename is a silent partial revert — half the map in our palette
and half in theirs. And the brief's requirement is not a recolour: roads lose their casings and six
layer groups are dropped, which is a different style rather than the same one tinted.

**Consequences.** Seventeen layers to maintain against the OpenMapTiles schema, validated by
`validateStyleMin` in `lib/map/style.test.ts` so a schema mistake is a red test rather than a blank
map. `MAP_STYLE_URL` changes meaning: unset selects the in-repo style, set loads that URL verbatim.
`.env.example` shipped a value until 2026-09-09, which meant a copied `.env.local` quietly rendered
OpenFreeMap's palette instead of the brief's; it is now commented out, and `""` counts as unset.

**Also considered:** patching the remote style's layers at `style.load`, above. And a
`MAP_TILES_URL` alongside the style URL, so a deployer could keep our cartography over their own
tiles — rejected for now as a third variable serving a case nobody has asked for, and addable
without breaking anything if someone does.
```

**First, two lines in the phase 0.5 checklist that would reintroduce the defect.** `TODO.md`
prescribes `MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark` inside its ticked
"`.env.example`, committed, with every variable" item, and carries an unticked "Verify the
OpenFreeMap style URL against their current docs before committing it as the default" — which
stage 1 is precisely the answer to. Anyone rebuilding `.env.example` from that checklist puts the
value straight back. Annotate the first the way `react-map-gl` is annotated, and resolve the
second:

```markdown
      **The `MAP_STYLE_URL=` value above was removed on 2026-09-09** — see `docs/decisions.md`
      §27. Left here as the record of what phase 0.5 committed. `.env.example` now ships the
      variable commented out, because a copied `.env.local` otherwise replaced the brief's
      palette with OpenFreeMap's and nothing said so.
- [x] **Resolved 2026-09-09: there is no default style URL to verify.** The project builds its
      own style from OpenFreeMap's vector tiles (`lib/map/style.ts`), validated against the real
      style spec. The endpoint that now needs checking on an upgrade is the tile TileJSON and the
      glyph URL, both asserted in `lib/map/style.test.ts`.
```

Then tick phase 4's first deliverable and say what landed:

```markdown
- [x] Dark desaturated map style built to the tokens in `docs/design-brief.md` — landed
      2026-09-09, plan at `docs/superpowers/plans/2026-09-09-map-and-timeline-stage-1.md`.
      Seventeen layers in `lib/map/style.ts`, validated against the real style spec. The palette
      is restated in hex because MapLibre cannot parse `oklch()`, with a drift check against
      `app/globals.css`'s own hex comments. `MAP_STYLE_URL` is now an override rather than a
      default (`docs/decisions.md` §27).
```

- [ ] **Step 7: Run the whole definition of done, unchained, and read every log**

```sh
node -v                     # v22.x
npm run pod:dev &           # FIRST, or the integration suites skip
npm test
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure
npm run build
npm run size:public
```

**`test:e2e` is deliberately not in this list** — see Global Constraints.

Then prove the integration suites ran:

```sh
kill %1
npm test          # the passed count must DROP, and the two integration files report skipped
```

Restart the Pod afterwards. Record both counts in the commit message.

`size:public` must report the same worst public route as HEAD, with `maplibre-gl` **absent**. This stage adds no public component and `lib/map/**` is imported by nothing yet, so a change here means something unexpected. If `maplibre-gl` reports FOUND, stop: something imports it eagerly, and that is stage 2's problem arriving early.

- [ ] **Step 8: Commit**

```sh
git add lib/config.ts lib/config.test.ts lib/notes.md .env.example docs/decisions.md TODO.md
git commit -m "MAP_STYLE_URL is an override rather than a default, and decision 27 says why

.env.example set it to OpenFreeMap's styles/dark, and its own first line tells
you to copy the file to .env.local — so a default deployment rendered their
palette instead of the brief's and nothing said the design had been replaced.
The map looked plausible, which is the worst version of wrong.

The variable stays, because decision 7 is explicit that it exists so a deployer
can point at a paid provider. Only its default changed: unset builds the
in-repo style, set loads that URL wholesale. Wholesale deliberately — merging
two styles produces a third thing neither party designed.

\"\" counts as unset, and that case is tested rather than assumed. A
commented-out line someone uncomments and leaves blank is how this variable
actually arrives empty, and \"\" handed to MapLibre is a fetch of the current
page: an HTML document parsed as JSON, reported as a syntax error that never
mentions the map.

lib/config.ts had no test at all before this; it has three.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `npx vitest run lib/map lib/config.test.ts` passes **18 cases**: 4 token, 9 style, 5 config.
- `validateStyleMin(buildBasemapStyle())` returns no errors, and that case was watched failing under a stringified `line-width` — reading the message, which names `layers[10]` and not `boundary_state`.
- The drift check was watched failing from **both** sides, and the shape guard failed when handed an `oklch()` string. Every mutation recipe was guarded, so a `sed` that matched nothing could not be mistaken for a passing check.
- **The fontstack case was watched failing with `text-font` deleted**, not merely with a wrong value. That is the mutation the case exists for: a missing `text-font` is spec-legal, so `validateStyleMin` stays green while every place label disappears.
- All seven mutation recipes in Task 2 Step 6 were run and each reddened the cases it names — including recipe 7, whose `g` flag is load-bearing because `MAP_COLORS.water` is used twice.
- No colour anywhere in the style is `oklch()`, no accent colour appears in the basemap, every non-palette colour's channel spread is ≤ 32, and `land`, `water` and `label` are all actually used — a ban is not proof of use.
- `.env.example` sets no `MAP_STYLE_URL`, pinned by a test rather than by a `grep` in this plan; `config.mapStyleUrl` is `undefined` for unset, `""` and whitespace, and trims what it returns.
- `TODO.md`'s two phase-0.5 lines are annotated and resolved, so the checklist cannot reintroduce the value.
- `docs/decisions.md` §27 exists; `TODO.md`'s first phase-4 deliverable is ticked with what landed.
- All ten definition-of-done commands pass, each run separately and each log read, and the integration suites were proven to have run by the dead-port control (1420 up, 1384 passed / 36 skipped down). `size:public` unchanged, `maplibre-gl` absent, and `@maplibre/maplibre-gl-style-spec` absent from every public chunk.

## What stage 2 needs from this

- `buildBasemapStyle()` — no arguments — and `config.mapStyleUrl`. The map island receives the style URL as a prop and calls `buildBasemapStyle()` when it is `undefined`.
- The maplibre stylesheet is imported in `components/public/trip-map/trip-map.tsx`, not inside the lazy chunk. Stage 0's fence permits that one subpath and refuses every other static form; the eight measured shapes are in stage 0 Task 3.
- `MAP_COLORS.accent`, `.accentBright` and `.accentDeep` are unused by the basemap on purpose. Stage 3's route and markers are their only consumers, and `style.test.ts` asserts the basemap does not touch them.
- `SOURCE_ID` is `"openmaptiles"`. Stage 3's point and leg sources must not collide with it.

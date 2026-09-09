# Phase 4 — Stage 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two modules phase 4 needs reachable from the public path, close the lint hole that lets `maplibre-gl` be statically imported into a public route, and drop the map library the project is not going to use — with zero change to behaviour.

**Architecture:** Three moves and one removal, in risk order. The two `lib/studio` modules move first, because until they do the timeline cannot import them and nothing else in the stage can be built on them. Each move is a real `git mv` of the test file *before* its subject, so the red is genuine rather than staged. Then the fence gains `maplibre-gl`, proven in both directions — static refused, dynamic allowed — because a fence that refused the dynamic import would ban the map outright. Then `react-map-gl` leaves.

**Tech Stack:** Node 22.23.2, TypeScript 6.0.3, ESLint 9 flat config, Vitest 4, tsx.

**Spec:** `docs/superpowers/specs/2026-09-09-map-and-timeline-design.md` — §2 and §3.

## Global Constraints

- **Node 22.** Run `nvm use`, then confirm `node -v` prints `v22.x` before anything else. If `nvm` is not on `PATH`: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. Every command below runs and passes on Node 20 as well, which is exactly why checking is a step you do rather than one the tooling does for you.
- **`npm test` needs a Pod.** Start `npm run pod:dev &` first. Without it, `test/integration/pod-read.integration.test.ts` and `test/integration/pod-access.integration.test.ts` skip themselves and the run reports green having never executed them.
- **Prove the integration suites RAN, not skipped.** Measured on 2026-09-09, both ways, so these are the two numbers to compare — with the Pod up, `npm test` reports **62 files, 1420 passed | 2 todo (1422)**; with it down, **62 files, 1384 passed | 36 skipped | 2 todo (1422)**. Vitest does print the skip line, and 1420 − 1384 = 36 is the whole of `test/integration/`. Run the control once at the end of the stage, not per task, and expect the passed count to move by exactly 36 plus whatever this stage adds.
- **`npm run test:e2e` is required for this stage.** The diff touches `lib/studio/**` and `components/studio/**`, two of the six paths `CLAUDE.md`'s path-scoped gate names. Run it as `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`.
- **Zero behaviour change in this entire stage.** The invariant that proves it: **no test file is edited for content.** Import paths change, and one describe block is relocated verbatim. Assertions, fixtures and test names do not change. If a move seems to require an assertion change, the move changed behaviour — stop and report rather than adjusting the test.
- **Take every count from HEAD, never from this plan.** Run `npm test` before touching anything and compare against that number. `TEST_COMMENT_BASELINE` in `scripts/check-structure.ts` is `545` at the time of writing; read the file rather than trusting that.
- **`npm run size:public` does not build.** Run `npm run build` first or it silently grades a stale `.next`.
- **`npm run lint` carries `--max-warnings 0`**, so a stale `eslint-disable` fails rather than warns.
- **The `dy:` namespace is still `https://example.org/ns/traveldiary#`.** Nothing in this stage reads or writes any Pod resource, and no `dy:` term is added, changed or renamed.
- **`lib/` holds no React.** Both modules being moved are already pure; keep them that way.

- **The code-structure refactor's conventions bind every line of this stage.** **`CLAUDE.md` § Code structure is the rules; `docs/code-structure.md` is the reasoning and the measurements — read that before arguing with one.** Three mechanics that catch people, all of them measured rather than reasoned: **delimiter lines count**, so a `/** … */` block's real budget is four lines of prose; **two comment blocks with no blank line between them are one run**, and a blank line resets it, so splitting a docblock in place is a legitimate fix; and the `notes.md` slug drops punctuation rather than hyphenating it while **keeping `_`**, so `place.ts` becomes `placets` and `MAP_STYLE_URL` becomes `map_style_url`. Check a slug, never reason about it.
- **Readability is the point and the line counts are a proxy for it.** A change that hits 130/50 by extracting helpers whose names hide the arrangement has failed, even with every check green. Do not tighten a lint rule to a tendency value — that undoes an instruction. And never quote a threshold you did not get from the enforcing tool: this project has a committed error from a hand-written line counter that disagreed with ESLint by a third.
- **Do not add an `eslint-disable` to get a check green.** There is exactly one in the repository and `active exemptions — 0` for length bounds. If a bound is hit, decompose — or report it and stop.

## File Structure

| File | Responsibility |
|---|---|
| `lib/time/offsets.ts` | moved from `lib/studio/time/offsets.ts`, unchanged content |
| `lib/time/offsets.test.ts` | moved with it, import path repointed |
| `lib/time/notes.md` | moved with it, heading repointed |
| `lib/place/precision.ts` | new: `precisionLabel`, moved out of `lib/studio/place/place.ts` |
| `lib/place/precision.test.ts` | new: the `precisionLabel` describe block, verbatim |
| `lib/place/notes.md` | new: why `precisionLabel` left `place.ts` |
| `lib/studio/place/place.ts` | keeps `placeFor`, `placeTextOf`, `gridOf`, `PRECISION_GRIDS`, `EntryPlace`, `PlaceText` |
| `lib/studio/place/place.test.ts` | keeps everything except the `precisionLabel` describe |
| `eslint.config.mjs` | public block gains a `maplibre-gl` `paths` entry and a deep-path `patterns` entry; a new block fences the publicly reachable `lib/` modules |
| `notes.md` (repo root) | the belt's reasoning, behind a new anchor |
| `test/guardrails.test.ts` | six new cases — four for the maplibre fence's eight measured shapes, two pinning what the moves make reachable |
| `package.json`, `package-lock.json` | `react-map-gl` removed |
| `docs/decisions.md` | new §25, and §26 reserved in writing |
| `docs/versions.md` | the `react-map-gl` row annotated |
| `.claude/agents/nextjs-specialist.md` | stops naming `react-map-gl` — **ask the owner first** |
| `TODO.md` | phase 0.5's `react-map-gl` pin annotated; a Stage 0 line under phase 4 |

**Eight files name the two modules today; seven need an edit.** Confirm the list at HEAD rather than trusting it:

```sh
grep -rn "lib/studio/time\|lib/studio/place" --include='*.ts' --include='*.tsx' \
  . --exclude-dir=node_modules --exclude-dir=.next
```

At the time of writing, under `components/studio/entry-editor/`:

- **`lib/studio/time/offsets` — six importers, all repointed by Task 1:** `state/apply-restore.ts`,
  `state/apply-photo-offer.ts`, `hooks/use-entry-form.ts`, `hooks/use-entry-form.test.ts`,
  `hooks/use-entry-draft.ts`, `hooks/use-entry-save.ts`.
- **`precisionLabel` — one importer, repointed by Task 2:** `fields/where-fields/where-fields.tsx`.
- **`hooks/use-settings-gate.ts` needs NO edit.** It imports `PRECISION_GRIDS`, `gridOf` and
  `EntryPlace` from `@/lib/studio/place/place`, none of which move. `state/apply-restore.ts`
  likewise keeps its `gridOf` import while its `offsets` import is repointed — it appears in both
  lists for different reasons.

Two prose mentions in `lib/pod/entry-model.ts` and `lib/pod/entry-model.test.ts` refer to
`placeFor`, which does **not** move — leave both alone.

---

### Task 1: `lib/studio/time/` becomes `lib/time/`

`eslint.config.mjs` restricts the group `["**/lib/studio", "**/lib/studio/**"]` on `app/(public)/**` and `components/public/**`, so the timeline cannot import `offsets.ts` where it is. The fence's stated reason is that `lib/studio` wraps the auth library; `offsets.ts` imports nothing at all. It moves rather than earning a carve-out, because a carve-out turns the fence into a list of exceptions.

Every export moves together — twelve of them, counted rather than remembered (`grep -c 'export ' lib/time/offsets.ts`), because an earlier draft of this line said nine. `nowWithOffset` and `wallClockNow` are write-side only and move anyway: splitting a pure arithmetic module to keep two functions behind a fence costs more than it protects.

**Files:**
- Move: `lib/studio/time/offsets.test.ts` → `lib/time/offsets.test.ts`
- Move: `lib/studio/time/offsets.ts` → `lib/time/offsets.ts`
- Move: `lib/studio/time/notes.md` → `lib/time/notes.md`
- Modify: `components/studio/entry-editor/state/apply-restore.ts`, `state/apply-photo-offer.ts`, `hooks/use-entry-form.ts`, `hooks/use-entry-form.test.ts`, `hooks/use-entry-draft.ts`, `hooks/use-entry-save.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `@/lib/time/offsets`, exporting exactly what `@/lib/studio/time/offsets` exports today — `pad`, `LOCAL_DATETIME`, `TRAILING_OFFSET`, `offsetHere(wall: string): string`, `toOffsetDateTime(local: string, offset: string): string | undefined`, `offsetOf(value: string | undefined): string | undefined`, `wallClockOf(value: string | undefined): string`, `wallClockNow(): string`, `nowWithOffset(): string`, `OFFSETS`, `OFFSET_SHAPE`, `offsetMinutes(offset: string): number`. Stage 4's timeline uses `offsetOf` and `wallClockOf`.

- [ ] **Step 1: Move the test file alone, and repoint its import**

The test moves *before* its subject so that running it produces a real failure rather than a staged one.

```sh
mkdir -p lib/time
git mv lib/studio/time/offsets.test.ts lib/time/offsets.test.ts
```

Then in `lib/time/offsets.test.ts`, change the one import specifier:

```ts
} from "@/lib/time/offsets";
```

Confirm there is exactly one, and that nothing else in the file changes:

```sh
grep -n 'studio/time' lib/time/offsets.test.ts   # expect: no output
git diff --stat -- lib/time/offsets.test.ts
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run lib/time/offsets.test.ts`

Expected: FAIL. The exact shape, measured rather than paraphrased — note that it is a failed
**suite** with `Tests  no tests`, not a failed test:

```
FAIL  lib/time/offsets.test.ts [ lib/time/offsets.test.ts ]
Error: Cannot find package '@/lib/time/offsets' imported from /…/lib/time/offsets.test.ts
Test Files  1 failed (1)
      Tests  no tests
```

If it fails with assertion errors instead, the wrong thing moved; stop.

- [ ] **Step 3: Move the subject and its notes**

```sh
git mv lib/studio/time/offsets.ts lib/time/offsets.ts
git mv lib/studio/time/notes.md lib/time/notes.md
```

Change the notes heading on line 1 of `lib/time/notes.md`:

```markdown
# lib/time — notes
```

Nothing else in `notes.md` changes. Its five anchors are cited by `offsets.ts` as `./notes.md#…`, and both files moved together, so every pointer still resolves — `check:structure` in Step 6 is what proves that rather than this sentence.

`offsets.ts` itself needs one edit. Its docblock says *"Why it left the editor: ./notes.md#tested-through-the-dom-until-now"*, which is still true and still resolves. Leave it. But the first line reads "phase 4's timeline wants this without wanting a form" — that is now a description of the present rather than the future, so make it so:

```ts
/**
 * The offset arithmetic behind `dy:occurredAt` (§7.3). No React and no DOM,
 * and out of `lib/studio` so the public timeline can reach it.
 * Why it left the editor: ./notes.md#tested-through-the-dom-until-now
 */
```

Three lines, inside the hard bound of six.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run lib/time/offsets.test.ts`

Expected: PASS, with the same test count it had at HEAD — **40**. Confirm with the colon form, not `--`: `git show HEAD -- <path>` prints nothing at all when HEAD's own commit does not touch that path, so `grep -c` answers `0` and you would be comparing against zero.

```sh
git show HEAD:lib/studio/time/offsets.test.ts | grep -c '  it('
```

- [ ] **Step 5: Repoint the six importers**

```sh
grep -rln 'lib/studio/time/offsets' --include='*.ts' --include='*.tsx' \
  . --exclude-dir=node_modules --exclude-dir=.next \
  | xargs sed -i '' 's|@/lib/studio/time/offsets|@/lib/time/offsets|g'
```

Then the check — and **it must be scoped to source, or it can never be quiet.** Unscoped, this
string still matches `TODO.md`, `docs/superpowers/plans/2026-09-08-code-structure-stage-b.md`, the
phase 4 spec, and this plan itself, all of which are historical record that must not be edited:

```sh
grep -rn 'lib/studio/time' --include='*.ts' --include='*.tsx' \
  . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git   # expect: no output
```

`lib/studio/time/` is now empty. Remove it:

```sh
rmdir lib/studio/time
```

- [ ] **Step 6: Run the checks that can see a move**

Run each, read each, do not chain them:

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

Expected: the same passed count as HEAD; lint and typecheck clean; `check:structure` reporting `Structure OK`. `check:structure` is the one that matters here — it resolves every `./notes.md#anchor` and enforces that a test file has its subject beside it, which is precisely what a directory move can break.

If `check:structure` names an unresolved anchor, the notes file and its source did not move together. If it says `lib/time/offsets.test.ts has no offsets.ts(x) beside it`, Step 3 did not run.

- [ ] **Step 7: Commit**

```sh
git add -A lib/time lib/studio components
git commit -m "offsets.ts leaves lib/studio, because the timeline is a public feature

lib/studio is fenced from app/(public)/** and components/public/**, so the
module extracted for phase 4's timeline could not be imported by it. The
fence's reason is that lib/studio wraps the auth library; offsets.ts imports
nothing at all. Moved rather than carved out — a carve-out turns the fence into
a list of exceptions, which is how the ACL primitive list nearly failed.

Every export moves together, twelve of them. nowWithOffset and wallClockNow are write-side
only, and splitting a pure arithmetic module to keep two functions behind a
fence costs more than it protects.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `precisionLabel` leaves `place.ts`

`place.ts` does not move wholesale, because most of it is write-shaped. `placeFor` and `placeTextOf` assemble a `Place` for a save; `gridOf` and `PRECISION_GRIDS` serve the studio's precision select. Nothing public has any business with those, and `eslint.config.mjs` already sets that precedent for `lib/pod/entry-model.ts` — *"pure and drags nothing in, and is fenced anyway"*.

`precisionLabel` is the one function the public path needs: `docs/design-brief.md` requires that `dy:precisionMeters` change the rendering, and `~500 m` is how the page says so.

**Files:**
- Create: `lib/place/precision.ts`
- Create: `lib/place/precision.test.ts`
- Create: `lib/place/notes.md`
- Modify: `lib/studio/place/place.ts` — remove `precisionLabel`
- Modify: `lib/studio/place/place.test.ts` — remove the `precisionLabel` describe and the import
- Modify: `components/studio/entry-editor/fields/where-fields/where-fields.tsx` — one import

**Interfaces:**
- Consumes: nothing.
- Produces: `@/lib/place/precision`, exporting `precisionLabel(metres: number): string`. Stage 3 adds `coordinateDecimals` and the pin-versus-circle decision to this same module.

- [ ] **Step 1: Write the failing test**

Create `lib/place/precision.test.ts`. The four cases are the existing `describe("precisionLabel")` block from `lib/studio/place/place.test.ts` **verbatim** — copy them, do not retype them, and do not add or remove a case. It is self-contained: it references no fixture and no other export.

```ts
/**
 * How `dy:precisionMeters` is rendered. Public-path, unlike the rest of what
 * `place.ts` holds: ./notes.md#why-precisionlabel-left-placets
 */

import { describe, expect, it } from "vitest";
import { precisionLabel } from "@/lib/place/precision";

describe("precisionLabel", () => {
  it("renders metres under a kilometre as metres", () => {
    expect(precisionLabel(100)).toBe("~100 m");
    expect(precisionLabel(500)).toBe("~500 m");
  });

  it("renders round kilometres as kilometres", () => {
    expect(precisionLabel(1000)).toBe("~1 km");
    expect(precisionLabel(10_000)).toBe("~10 km");
    expect(precisionLabel(1500)).toBe("~1.5 km");
  });

  it("keeps a value that does not divide into a tidy kilometre in metres", () => {
    expect(precisionLabel(1050)).toBe("~1050 m");
  });

  it("always says about, because what is published is a cell rather than a distance", () => {
    for (const metres of [100, 500, 1000, 1050, 10_000])
      expect(precisionLabel(metres).startsWith("~"), String(metres)).toBe(true);
  });
});
```

Also create `lib/place/notes.md` now, because the docblock above points at it and `check:structure` fails on an anchor that does not resolve:

```markdown
# lib/place — notes

## Why precisionLabel left place.ts

`lib/studio/place/place.ts` is write-shaped: `placeFor` and `placeTextOf`
assemble a `Place` for a save, and `gridOf` and `PRECISION_GRIDS` serve the
studio's precision select. `eslint.config.mjs` fences all of `lib/studio` from
`app/(public)/**`, and for `lib/pod/entry-model.ts` it already records the
narrower reason: a write-shaped module stays fenced even when it is pure,
because nothing public has any business assembling one.

`precisionLabel` is the exception, so it moved rather than being carved out of
the fence. `docs/design-brief.md` requires that `dy:precisionMeters` change the
rendering — "show fewer decimal places when the stored location is coarse, and
a soft circle rather than a pin" — which makes the label a reading-page
concern. The tilde is the honest part: what is published is a cell of about
that size, not a distance from anywhere.

Phase 4 stage 3 adds the decimal count and the pin-versus-circle decision here,
for the same reason and to the same consumers.
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run lib/place/precision.test.ts`

Expected: FAIL as a failed suite with `Tests  no tests` and
`Error: Cannot find package '@/lib/place/precision' imported from …`. Not an assertion failure —
if you see one, something already exports `precisionLabel` from that path.

- [ ] **Step 3: Create the module and remove the original**

Create `lib/place/precision.ts`, with the function body unchanged from `place.ts`:

```ts
/**
 * How `dy:precisionMeters` is rendered, on the reading page as well as in the
 * studio. No React and no DOM. ./notes.md#why-precisionlabel-left-placets
 */

/** `500` → `~500 m`, `10000` → `~10 km`. The tilde is the honest part: what is
 *  published is a cell of about this size, not a distance from anywhere. */
export function precisionLabel(metres: number): string {
  return metres >= 1000 && metres % 100 === 0 ? `~${metres / 1000} km` : `~${metres} m`;
}
```

Then in `lib/studio/place/place.ts`, delete the `precisionLabel` function **and its docblock**. Leave `PRECISION_GRIDS`, `gridOf`, `EntryPlace`, `PlaceText`, `placeFor` and `placeTextOf` exactly as they are, `PRECISION_GRIDS`' `./notes.md#no-exact-option-and-what-it-would-take` pointer included.

And in `lib/studio/place/place.test.ts`: delete the whole `describe("precisionLabel", …)` block, and drop `precisionLabel` from the import list. Every other line in that file stays, including the `describe("PRECISION_GRIDS")` block that follows it — it references `PRECISION_GRIDS` and `gridOf`, both of which stay.

- [ ] **Step 4: Run both files and watch both pass**

```sh
npx vitest run lib/place/precision.test.ts lib/studio/place/place.test.ts
```

Expected: PASS. The two files' combined `it` count must equal what `place.test.ts` alone had at HEAD — nothing was added and nothing dropped. Check with:

```sh
git show HEAD:lib/studio/place/place.test.ts | grep -c '  it('
grep -hc '  it(' lib/place/precision.test.ts lib/studio/place/place.test.ts | paste -sd+ - | bc
```

- [ ] **Step 5: Repoint the one importer**

`components/studio/entry-editor/fields/where-fields/where-fields.tsx` imports `precisionLabel` from `@/lib/studio/place/place` on line 7 and calls it on line 230. Split that import — it may be the only name on the line, in which case just repoint it:

```ts
import { precisionLabel } from "@/lib/place/precision";
```

Then confirm nothing still reaches for it in the old place:

```sh
grep -rn 'precisionLabel' --include='*.ts' --include='*.tsx' . \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```

Expected: hits only in `lib/place/precision.ts`, `lib/place/precision.test.ts` and
`where-fields.tsx`. **`--include='*.ts'` excludes `notes.md`, so no markdown appears in that
output** — an earlier draft of this step told you to expect some, which it cannot produce.

One prose mention does survive in a file this step does not touch:
`lib/studio/place/place.test.ts`'s section-3 banner comment says "`precisionLabel` renders it" and
will now describe a block that has left the file. **Leave it.** The stage's own invariant is that
no test file is edited for content, and it is named here so it reads as a deliberate omission
rather than a missed edit — stage 3 rewrites that banner when it adds the decimal count.

- [ ] **Step 6: Run the full suite and the checks**

```sh
npm run pod:dev &      # if it is not already up
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

Expected: the same passed count as HEAD; `Structure OK`. `check:structure` verifies `lib/place/precision.test.ts` has `precision.ts` beside it and that `#why-precisionlabel-left-placets` resolves in `lib/place/notes.md`. That anchor is the one to watch: GitHub's slug drops punctuation rather than hyphenating it, so `place.ts` in a heading becomes `placets`, not `place-ts`. `check:structure` will say so if the heading and the pointer disagree.

- [ ] **Step 7: Commit**

```sh
git add -A lib/place lib/studio components
git commit -m "precisionLabel leaves place.ts; the write-shaped half stays fenced

place.ts does not move wholesale, because most of it is write-shaped: placeFor
and placeTextOf assemble a Place for a save, gridOf and PRECISION_GRIDS serve
the studio's precision select. eslint.config.mjs already records the narrower
rule for entry-model.ts — a write-shaped module stays fenced even when it is
pure — and that reasoning holds here.

precisionLabel is the exception. design-brief.md requires dy:precisionMeters to
change the rendering, which makes the label a reading-page concern. Stage 3
adds the decimal count and the pin-versus-circle decision to the same module.

The describe block moved verbatim; the two files' it-count equals what
place.test.ts alone had.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: the public fence gains `maplibre-gl`, and the two moved modules gain a belt

`scripts/check-public-bundle.ts` has listed `maplibre-gl` in `BANNED_DEPS` since phase 0.5, but `eslint.config.mjs`'s public block never has — so today lint permits an import the bundle check refuses, and the mistake is caught at build time rather than at edit time. `eslint.config.mjs`'s own docblock says that is backwards: *"the public bundle budget is the enforcement which really holds; these catch the same mistake earlier."*

**The obvious spelling of the fence is wrong, and it was in an earlier draft of this plan.** A `patterns` group of `["maplibre-gl", "maplibre-gl/**"]` also refuses `maplibre-gl/dist/maplibre-gl.css` — the stylesheet that positions the canvas and renders the attribution control `CLAUDE.md` forbids removing — and a `!`-negated pattern does **not** rescue it, because gitignore semantics refuse to re-include under an excluded parent. The bare `"maplibre-gl"` arm already matches every subpath, so the second arm is redundant as well.

**Eight import shapes, all measured on real files under `components/public/` against the real config.** This is the table the rule has to produce:

| Shape | Verdict | Why |
|---|---|---|
| `import maplibregl from "maplibre-gl"` | refused | 252.8 kB in the eager chunk |
| `import { Marker } from "maplibre-gl"` | refused | same |
| `import mod from "maplibre-gl/dist/maplibre-gl.mjs"` | refused | the same bytes by a deep path |
| `import type { Map } from "maplibre-gl"` | refused | acceptable; the inline form below is the spelling to use |
| `import "maplibre-gl/dist/maplibre-gl.css"` | **allowed** | ~4 kB of CSS the attribution control needs |
| `await import("maplibre-gl")` | **allowed** | how the map mounts |
| `import("maplibre-gl").Map`, as a type | **allowed** | how the hook types itself |
| `import type … from "@maplibre/maplibre-gl-style-spec"` | **allowed** | stage 1's types, and it ships nothing |

**Types come through the inline `import("maplibre-gl").X` form, not `import type`.** The base rule has no `allowTypeImports` — only `@typescript-eslint`'s version does — and putting two rules on the same job to permit a spelling that can simply be avoided is worse than using the spelling. It is also the honest one: the module genuinely is only available dynamically.

**The CSS import lives in `components/public/trip-map/trip-map.tsx`** (stage 2), not inside the lazy chunk, so the map's chrome is styled before the instance arrives. It costs nothing against the budget: `measurePages` matches only `.js` references.

**And the moves in Tasks 1 and 2 open a gap.** `lib/time/**` and `lib/place/**` are now publicly reachable and fenced by nothing, so a later edit importing `@/lib/studio/session` there would drag the auth library into a public route indirectly — the shape the `lib/studio` fence exists to stop, one level down. `lib/pod/read.ts` has had this property all along and `size:public`'s marker scan is the backstop. The belt is cheap and goes in now, while the reason is fresh.

**Files:**
- Modify: `test/guardrails.test.ts` — four new cases
- Modify: `eslint.config.mjs` — the public block's `paths` and `patterns`, plus one new block

**Interfaces:**
- Consumes: `@/lib/time/offsets` and `@/lib/place/precision` from Tasks 1 and 2.
- Produces: lint rules stage 2 relies on. No exported code.

- [ ] **Step 1: Write the four failing cases, using the file's own three helpers**

`test/guardrails.test.ts` already has everything needed, and the signatures matter:

- `lint(filePath, code)` — **path first, code second.** Getting this round the wrong way lints the snippet at a path where no rule applies, and every reject-case then passes for the wrong reason.
- `ruleIds(msgs)` — the rule ids, for `toContain` / `not.toContain`.
- `fatals(msgs)` — parse failures. **Every allow-case must assert this is empty.** The helper's own docblock explains why: an unparseable snippet yields one message with `fatal: true` and `ruleId: null` and no rule messages at all, so *every* allow-case would pass on a snippet that was never linted. That is this repository's "green run that verified nothing" in miniature.

Add all four inside the existing `describe("guardrails actually fire", …)`, beside the other public-boundary cases:

```ts
  it("rejects a static maplibre-gl import from a public route", async () => {
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import maplibregl from "maplibre-gl";\nexport const a = maplibregl;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    expect(msgs.map((m) => m.message).join()).toMatch(/lazy/i);
  });

  it("rejects the same bytes reached by a deep path", async () => {
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import mod from "maplibre-gl/dist/maplibre-gl.mjs";\nexport const a = mod;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
  });

  it("allows the maplibre stylesheet, which the attribution control needs", async () => {
    // An exact-specifier `paths` entry is what makes this possible: a
    // "maplibre-gl/**" pattern refuses it and no negation re-includes it.
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `import "maplibre-gl/dist/maplibre-gl.css";\nexport const a = 1;\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("allows a dynamic maplibre-gl import and an inline type, which is how the map mounts", async () => {
    // The asymmetry is the whole point: no-restricted-imports reaches neither
    // an ImportExpression nor a TSImportType, and the map is a chunk the
    // prerendered HTML never names.
    const msgs = await lint(
      "components/public/trip-map/probe.ts",
      `export type M = import("maplibre-gl").Map;\n` +
        `export async function load() {\n  const m = await import("maplibre-gl");\n  return m.default;\n}\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });
```

And two more that pin what Tasks 1 and 2 exist to make true. Both are green before *and* after — controls rather than red-first tests — but `test/guardrails.test.ts` already keeps exactly this convention for `lib/pod/read.ts` and the studio's session module, on the principle that a fence which rejects everything proves nothing. Without them, a later `**/lib/**`-shaped group re-breaks the timeline in silence:

```ts
  it("allows a public route to import the two modules stage 0 moved out of lib/studio", async () => {
    const msgs = await lint(
      "app/(public)/trips/[slug]/probe.ts",
      `import { offsetOf } from "@/lib/time/offsets";\n` +
        `import { precisionLabel } from "@/lib/place/precision";\n` +
        `export const a = [offsetOf, precisionLabel];\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });

  it("still refuses the paths they moved from, so the fence did not simply widen", async () => {
    const msgs = await lint(
      "app/(public)/trips/[slug]/probe.ts",
      `import { offsetOf } from "@/lib/studio/time/offsets";\n` +
        `import { placeFor } from "@/lib/studio/place/place";\n` +
        `export const a = [offsetOf, placeFor];\n`,
    );
    expect(msgs.filter((m) => m.ruleId === "no-restricted-imports")).toHaveLength(2);
  });
```

- [ ] **Step 2: Run them and watch the two reject-cases fail**

Run: `npx vitest run test/guardrails.test.ts`

Expected: the two `maplibre-gl` reject-cases FAIL with `AssertionError: expected [] to include 'no-restricted-imports'` — the fence does not exist yet. Everything else passes already, which is correct.

If an allow-case fails, read `fatals(msgs)` first: a fixture ESLint cannot parse reports as fatal, and that is a fixture bug rather than a rule.

- [ ] **Step 3: Add the fence, in two parts**

Both go in the `app/(public)/**` block in `eslint.config.mjs`. **`paths` for the exact specifier, `patterns` for the deep-JS hole** — the split is what leaves the stylesheet reachable.

Into the block's existing `paths` array — the one whose entry carries the message *"Access control goes through lib/pod/access.ts only"*, **not** the identically-shaped array in the ACL block higher up the file:

```js
            {
              // EXACT SPECIFIER, not a pattern. "maplibre-gl/**" would also
              // refuse dist/maplibre-gl.css, which the attribution control
              // needs, and no negation re-includes it under gitignore
              // semantics. Measured across eight import shapes.
              name: "maplibre-gl",
              message:
                "maplibre-gl must never be statically imported by a public route — 252.8 kB gzip against a 190 kB budget. The map is lazy: `await import(\"maplibre-gl\")` inside the intersection handler, typed with `import(\"maplibre-gl\").Map`, so the chunk is one the prerendered HTML never names (CLAUDE.md, Map). The stylesheet subpath is deliberately still allowed.",
            },
```

And into the same block's `patterns` array, as its own entry — **not** appended to the `exifreader` group, whose message is about image processing and would be actively misleading:

```js
            {
              // The bare specifier above does not cover a deep path, and
              // dist/maplibre-gl.mjs is the same 252.8 kB by another name.
              // Scoped to JS so the .css subpath stays reachable.
              group: ["maplibre-gl/dist/*.js", "maplibre-gl/dist/*.mjs"],
              message:
                "Import maplibre-gl lazily, not by a deep path: `await import(\"maplibre-gl\")`. Only the stylesheet subpath may be imported statically.",
            },
```

Then the belt, as a **new block** after the public one, because its file list is different:

```js
  // ------------------------------- the two modules stage 0 moved, and read.ts
  {
    /** Publicly reachable and fenced by nothing until now: an import of
     *  lib/studio here would drag the auth library into a public route one
     *  level down. ./notes.md#why-the-publicly-reachable-lib-modules-are-fenced-too */
    files: ["lib/time/**/*.ts", "lib/place/**/*.ts", "lib/pod/read.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@inrupt/*", "**/lib/studio", "**/lib/studio/**"],
              message:
                "This module is imported by public routes. Importing lib/studio or an Inrupt package here puts the auth library in the public bundle indirectly — the same failure the app/(public) fence prevents, one level down.",
            },
          ],
        },
      ],
    },
  },
```

That block's docblock carries a `./notes.md#` pointer, so add the anchor to `notes.md` **beside `eslint.config.mjs`** — the repository root's `notes.md`, which the config's other pointers already use:

```markdown
## Why the publicly reachable lib modules are fenced too

`app/(public)/**` and `components/public/**` are fenced from `lib/studio`, but the modules they
*import* were not. Phase 4 stage 0 moved `lib/time/offsets.ts` and `lib/place/precision.ts` out of
`lib/studio` precisely so the public timeline could reach them — which means a later edit adding
`import { session } from "@/lib/studio/session"` to either one would put
`@inrupt/solid-client-authn-browser` in a public bundle, with every fence above it still green.

`lib/pod/read.ts` has had exactly this property since phase 1, and nothing had noticed: it is
imported by every public page and restricted by nothing. `size:public`'s marker scan would catch
the leak at build time, which is why this was never a live defect — but `eslint.config.mjs`'s own
docblock says the point of these rules is to catch the same mistake earlier.

Three paths rather than a glob over `lib/**`, deliberately. `lib/media`, `lib/pod/write.ts` and
`lib/pod/access.ts` are studio-only and *must* import Inrupt packages; a blanket rule would fence
the modules whose job it is.
```

- [ ] **Step 4: Run them and watch all six pass**

```sh
npx vitest run test/guardrails.test.ts
```

Expected: PASS, all six new cases. Then lint the config, the guardrail suite, and the two moved modules **on disk** — which is what catches a rule that breaks the very files proving it works:

```sh
npx eslint eslint.config.mjs test/guardrails.test.ts lib/time lib/place lib/pod/read.ts
```

Expected: clean, no output. If `lib/pod/read.ts` errors, the belt's group is catching something it already imports legitimately — read the error before widening the rule, and report rather than loosening it.

- [ ] **Step 5: Prove it on real files, then remove the proof**

The cases above trust ESLint's `filePath` argument. Confirm the globs match real paths too — and note the probe directory is `components/public/`, which does not exist yet:

```sh
mkdir -p 'components/public/__probe'
printf 'import maplibregl from "maplibre-gl";\nexport const a = maplibregl;\n'        > 'components/public/__probe/p1.ts'
printf 'import mod from "maplibre-gl/dist/maplibre-gl.mjs";\nexport const a = mod;\n' > 'components/public/__probe/p2.ts'
printf 'import "maplibre-gl/dist/maplibre-gl.css";\nexport const a = 1;\n'            > 'components/public/__probe/p3.ts'
printf 'export type M = import("maplibre-gl").Map;\n'                                 > 'components/public/__probe/p4.ts'
npx eslint 'components/public/__probe/p*.ts'
```

Expected: exactly two errors, on `p1.ts` and `p2.ts`, both `no-restricted-imports`. `p3.ts` and `p4.ts` clean. Then:

```sh
rm -rf 'components/public'
git status --porcelain    # expect only eslint.config.mjs, notes.md and test/guardrails.test.ts
```

`rm -rf 'components/public'` and not just the probe directory — `components/public/` is created by stage 2, and leaving an empty one behind makes `check:structure`'s component walk read a directory that is not a component yet.

- [ ] **Step 6: Run the full suite and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

`check:structure` matters here: it resolves the new `#why-the-publicly-reachable-lib-modules-are-fenced-too` anchor. Watch the slug — `scripts/check-structure.ts` lowercases, drops `[^\w\s-]` and hyphenates each space, so punctuation vanishes rather than becoming a hyphen.

```sh
git add eslint.config.mjs notes.md test/guardrails.test.ts
git commit -m "The public fence gains maplibre-gl, and the two moved modules gain a belt

BANNED_DEPS has listed maplibre-gl since phase 0.5, but the eslint public block
never has, so lint permitted an import the bundle check refuses and the mistake
surfaced at build time instead of edit time. eslint.config.mjs's own docblock
says that is backwards.

The obvious spelling was wrong. A patterns group of [\"maplibre-gl\",
\"maplibre-gl/**\"] also refuses dist/maplibre-gl.css — the stylesheet the
attribution control needs, which CLAUDE.md forbids removing — and a !-negated
pattern does not rescue it, because gitignore semantics refuse to re-include
under an excluded parent. So: an exact-specifier paths entry, plus a patterns
group scoped to dist/*.{js,mjs} to close the deep-path hole. Eight import
shapes measured on real files; four are now cases in guardrails.test.ts.

Types come through import(\"maplibre-gl\").Map rather than import type. The base
rule has no allowTypeImports and only @typescript-eslint's version does, and
putting two rules on one job to permit a spelling we can avoid is worse than
using the spelling — which is also the honest one, since the module genuinely
is only available dynamically.

The belt is the gap Tasks 1 and 2 opened: lib/time and lib/place are now
publicly reachable and were fenced by nothing, so an import of lib/studio there
would put the auth library in a public bundle with every fence above it green.
lib/pod/read.ts has had that property since phase 1 and nothing had noticed.
Three named paths rather than lib/**, because lib/media and lib/pod/write.ts
must import Inrupt packages.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `react-map-gl` leaves, and the decision is recorded

Nothing imports it — confirm that before removing it, because this task's only real risk is that something does.

**There is no test here, and that is deliberate rather than an omission.** Removing an unimported dependency has no behaviour to assert; what verifies it is that `typecheck` and the full suite stay green with the package gone, plus a grep proving nothing reached for it. Adding a test that asserts a package is absent from `package.json` would assert the plan rather than the software.

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `docs/decisions.md` — new §25
- Modify: `docs/versions.md` — annotate the pinned-versions row
- Modify: `.claude/agents/nextjs-specialist.md` — **ask the owner before this one**
- Modify: `TODO.md` — annotate the phase 0.5 pin; add a Stage 0 line under `## Phase 4`

**Two files beyond `package.json` name this library, and one of them briefs the agent that
implements stages 2–5.** `.claude/agents/nextjs-specialist.md` says "`maplibre-gl` 6.6.0 with
`react-map-gl` 8.1.2", and `docs/versions.md` carries it as a pinned-versions row. Leaving either
produces exactly the failure §25's own "Rejected" paragraph is about: the next agent reads a
sanctioned wrapper that is no longer in the lockfile, one commit after the decision rejecting it.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. Stage 2 relies on `maplibre-gl` being the only map library present.

- [ ] **Step 1: Prove nothing imports it**

```sh
grep -rn 'react-map-gl' --include='*.ts' --include='*.tsx' --include='*.mjs' \
  . --exclude-dir=node_modules --exclude-dir=.next
```

Expected: hits only in `package.json`, `package-lock.json`, `TODO.md` and `docs/`. **If any `.ts`/`.tsx` file imports it, stop and report** — the spec assumed nothing did, and that assumption failing changes the task.

- [ ] **Step 2: Remove it**

```sh
node -v          # v22.x — .npmrc sets engine-strict, so npm refuses on the wrong runtime
npm uninstall react-map-gl
```

Expected: `package.json` loses the dependency and `package-lock.json` is rewritten. Commit the lockfile.

- [ ] **Step 3: Verify nothing broke**

```sh
npm run typecheck
npx vitest run
npm run lint
```

Expected: all three clean, with the same passed count as Task 3 left. If `typecheck` fails naming `react-map-gl`, Step 1's grep missed something — restore with `npm install react-map-gl@8.1.2` and report.

- [ ] **Step 4: Record the decision, and reserve the next number**

Append to `docs/decisions.md`, following the format of the numbered sections above it — a claim,
the reasoning, a **Consequences** paragraph and a **Rejected** paragraph. The highest existing
section is **24**, so this is 25. **§27 lands in stage 1 and §26 in stage 4**, so the reservation
line at the end is load-bearing: without it, 27 arrives first and the next doc-writing agent
either appends 28 or slots 26 in out of order.

```markdown
---

## 25. Raw MapLibre, not react-map-gl

`react-map-gl@8.1.2` was pinned in phase 0.5 and nothing ever imported it. Two of phase 4's
invariants push against the declarative wrapper at exactly the points where this project has
written rules.

**`setProjection` only inside the `style.load` handler.** react-map-gl applies a `projection`
prop on its own schedule, so satisfying the invariant means reaching through `mapRef.getMap()`
inside `onStyleData` and leaving the prop unused. The globe becomes imperative either way, and
the wrapper's value was that it would not be.

**One instance, mounted once, never remounted.** The wrapper keeps its instance as long as its
element is mounted, which a layout provides. But having both a declarative and an imperative
route to the same map is how a one-instance rule rots. There is one way to touch the map.

**Consequences.** Roughly seventy lines of marker DOM reconciliation are written by hand rather
than by `<Marker>`. That cost is real and is accepted: clustering needs `querySourceFeatures` on
`render` regardless, so the imperative loop exists either way and the wrapper would have sat
beside it rather than replaced it. Everything worth testing is pure and lives in `lib/map/` — the
style, the GeoJSON builders, the leg derivation, the dash expression, the cluster threshold — and
needs no browser and no library to test.

**Rejected:** keeping the dependency installed but unused. A pinned library nothing imports reads
to the next agent as sanctioned — which is why this landed alongside edits to `docs/versions.md`
and `.claude/agents/nextjs-specialist.md`, the two other places that named it.

**§26 is reserved** for the public map sheet, landing in phase 4 stage 4. It withdraws decision
11's sentence about the Drawer providing the mobile map layout's snap-point sheet. Do not reuse
the number.
```

- [ ] **Step 5: Annotate the phase 0.5 pin rather than deleting it**

In `TODO.md`, the runtime-dependencies install command lists `react-map-gl@8.1.2`. Leave the command as the historical record of what phase 0.5 installed — the same treatment `size-limit` already gets — and add a note beneath it:

```markdown
- [x] **`react-map-gl` was removed on 2026-09-09** and must not be reinstalled — see
      `docs/decisions.md` §25. Nothing ever imported it. Left in the command above as the
      historical record of what phase 0.5 installed, exactly as `size-limit` is.
```

Then add a Stage 0 line under `## Phase 4`, above the seven deliverables:

```markdown
- [x] **Stage 0 — prerequisites.** Landed 2026-09-09, plan at
      `docs/superpowers/plans/2026-09-09-map-and-timeline-stage-0.md`. `offsets.ts` moved to
      `lib/time/` and `precisionLabel` to `lib/place/`, because `lib/studio` is fenced from the
      public path and the timeline is a public feature. The eslint public fence gained
      `maplibre-gl`, statically only. `react-map-gl` removed.
```

Leave the seven deliverable checkboxes unticked — none of them landed here.

- [ ] **Step 6: Run the whole definition of done, unchained, and read every log**

Nine commands plus the gated tenth. Run them one at a time. A chained run hides which one failed.

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
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
```

`test:e2e` is required: the diff touches `lib/studio/**` and `components/studio/**`.

**Then prove the integration suites ran rather than skipped.** Stop the Pod and re-run:

```sh
kill %1
npm test
```

Expected: the passed count drops and `test/integration/pod-read.integration.test.ts` and `test/integration/pod-access.integration.test.ts` report as skipped. Restart the Pod afterwards. Record both numbers in the commit message — a green run that omitted them is the half-check `CLAUDE.md` names.

`size:public` should report the same worst-route figure as HEAD (176.4 kB of 190 at the time of writing) with every studio-only dependency `absent`. This stage adds no public code, so a change here means something unexpected happened.

- [ ] **Step 7: Commit**

```sh
git add package.json package-lock.json docs/decisions.md TODO.md
git commit -m "react-map-gl leaves, and decision 25 says why

Nothing ever imported it. Two phase 4 invariants push against the declarative
wrapper at exactly the points this project has rules about: setProjection must
be called inside style.load, which means reaching through mapRef.getMap() and
leaving the projection prop unused, and one-instance-never-remounted rots as
soon as there are two ways to touch the map.

What that costs is ~70 lines of marker DOM by hand. Accepted: clustering needs
querySourceFeatures on render regardless, so the imperative loop exists either
way and the wrapper would have sat beside it.

Rejected leaving it installed-but-unused — a pinned library nothing imports
reads to the next agent as sanctioned. The phase 0.5 install command keeps it
as the historical record, as size-limit already is.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `lib/time/offsets.ts` and `lib/place/precision.ts` exist, and this **source-scoped** grep returns nothing (unscoped it never can — it matches `TODO.md`, the stage-B plan, the spec and this file):

  ```sh
  grep -rn 'lib/studio/time' --include='*.ts' --include='*.tsx' \
    . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
  ```

- `test/guardrails.test.ts` carries six new cases, and the two `maplibre-gl` reject-cases were watched failing before the rule existed. The four allow-cases each assert `fatals(msgs)` is empty, so none of them can pass on a snippet that was never linted.
- The fence's eight measured shapes hold, on real files as well as virtual paths: the bare and deep JS imports refused, the `.css` subpath and both dynamic forms allowed.
- `lib/time/**`, `lib/place/**` and `lib/pod/read.ts` are fenced from `@inrupt/*` and `lib/studio`, and `npx eslint lib/time lib/place lib/pod/read.ts` is clean.
- `react-map-gl` is gone from `package.json` and the lockfile, and from `docs/versions.md` and `.claude/agents/nextjs-specialist.md`; `docs/decisions.md` §25 records why and reserves §26.
- All nine definition-of-done commands pass, plus `test:e2e`, each run separately and each log read — and the integration suites were proven to have run by the dead-port control: 1420 passed with the Pod up, 1384 passed / 36 skipped with it down.
- No test file was edited for content. `git diff main -- '**/*.test.ts' '**/*.test.tsx'` shows only import specifiers, one relocated describe block, and the six added guardrail cases.

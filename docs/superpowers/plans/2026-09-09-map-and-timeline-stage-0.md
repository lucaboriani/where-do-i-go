# Phase 4 — Stage 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the two modules phase 4 needs reachable from the public path, close the lint hole that lets `maplibre-gl` be statically imported into a public route, and drop the map library the project is not going to use — with zero change to behaviour.

**Architecture:** Three moves and one removal, in risk order. The two `lib/studio` modules move first, because until they do the timeline cannot import them and nothing else in the stage can be built on them. Each move is a real `git mv` of the test file *before* its subject, so the red is genuine rather than staged. Then the fence gains `maplibre-gl`, proven in both directions — static refused, dynamic allowed — because a fence that refused the dynamic import would ban the map outright. Then `react-map-gl` leaves.

**Tech Stack:** Node 22.23.2, TypeScript 6.0.3, ESLint 9 flat config, Vitest 4, tsx.

**Spec:** `docs/superpowers/specs/2026-09-09-map-and-timeline-design.md` — §2 and §3.

## Global Constraints

- **Node 22.** Run `nvm use`, then confirm `node -v` prints `v22.x` before anything else. If `nvm` is not on `PATH`: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. Every command below runs and passes on Node 20 as well, which is exactly why checking is a step you do rather than one the tooling does for you.
- **`npm test` needs a Pod.** Start `npm run pod:dev &` first. Without it, `test/integration/pod-read.integration.test.ts` and `test/integration/pod-access.integration.test.ts` skip themselves and the run reports green having never executed them.
- **Prove the integration suites RAN, not skipped.** After a full-suite run, note the passed count. Then stop the Pod and run again: the count must drop and the same files must report as skipped. Do this once at the end of the stage, not per task.
- **`npm run test:e2e` is required for this stage.** The diff touches `lib/studio/**` and `components/studio/**`, two of the six paths `CLAUDE.md`'s path-scoped gate names. Run it as `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`.
- **Zero behaviour change in this entire stage.** The invariant that proves it: **no test file is edited for content.** Import paths change, and one describe block is relocated verbatim. Assertions, fixtures and test names do not change. If a move seems to require an assertion change, the move changed behaviour — stop and report rather than adjusting the test.
- **Take every count from HEAD, never from this plan.** Run `npm test` before touching anything and compare against that number. `TEST_COMMENT_BASELINE` in `scripts/check-structure.ts` is `545` at the time of writing; read the file rather than trusting that.
- **`npm run size:public` does not build.** Run `npm run build` first or it silently grades a stale `.next`.
- **`npm run lint` carries `--max-warnings 0`**, so a stale `eslint-disable` fails rather than warns.
- **The `dy:` namespace is still `https://example.org/ns/traveldiary#`.** Nothing in this stage reads or writes any Pod resource, and no `dy:` term is added, changed or renamed.
- **`lib/` holds no React.** Both modules being moved are already pure; keep them that way.

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
| `eslint.config.mjs` | public `no-restricted-imports` gains a `maplibre-gl` entry with its own message |
| `test/guardrails.test.ts` | two new cases: static import refused, dynamic import allowed |
| `package.json` | `react-map-gl` removed |
| `docs/decisions.md` | new §25 |
| `TODO.md` | phase 0.5's `react-map-gl` pin annotated; a Stage 0 line under phase 4 |

**Six files import the two modules today**, and Tasks 1 and 2 repoint them. Confirm the list at HEAD rather than trusting it:

```sh
grep -rn "lib/studio/time\|lib/studio/place" --include='*.ts' --include='*.tsx' \
  . --exclude-dir=node_modules --exclude-dir=.next
```

At the time of writing: `components/studio/entry-editor/state/apply-restore.ts`, `state/apply-photo-offer.ts`, `hooks/use-settings-gate.ts`, `hooks/use-entry-form.ts`, `hooks/use-entry-form.test.ts`, `hooks/use-entry-draft.ts`, `hooks/use-entry-save.ts`, `fields/where-fields/where-fields.tsx`. Two prose mentions in `lib/pod/entry-model.ts` and `lib/pod/entry-model.test.ts` refer to `placeFor`, which does **not** move — leave both alone.

---

### Task 1: `lib/studio/time/` becomes `lib/time/`

`eslint.config.mjs` restricts the group `["**/lib/studio", "**/lib/studio/**"]` on `app/(public)/**` and `components/public/**`, so the timeline cannot import `offsets.ts` where it is. The fence's stated reason is that `lib/studio` wraps the auth library; `offsets.ts` imports nothing at all. It moves rather than earning a carve-out, because a carve-out turns the fence into a list of exceptions.

All nine exports move, `nowWithOffset` and `wallClockNow` included. Splitting a pure arithmetic module to keep two write-side functions behind a fence costs more than it protects.

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

Expected: FAIL, and specifically a resolution failure naming `@/lib/time/offsets` — something of the shape `Failed to resolve import "@/lib/time/offsets"`. If it fails with assertion errors instead, the wrong thing moved; stop.

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

Expected: PASS, with the same test count it had at HEAD. Get that number from `git show HEAD -- lib/studio/time/offsets.test.ts | grep -c '  it('` if you did not record it.

- [ ] **Step 5: Repoint the six importers**

```sh
grep -rln 'lib/studio/time/offsets' --include='*.ts' --include='*.tsx' \
  . --exclude-dir=node_modules --exclude-dir=.next \
  | xargs sed -i '' 's|@/lib/studio/time/offsets|@/lib/time/offsets|g'
grep -rn 'lib/studio/time' . --exclude-dir=node_modules --exclude-dir=.next   # expect: no output
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

All nine exports move together. nowWithOffset and wallClockNow are write-side
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

Expected: FAIL with `Failed to resolve import "@/lib/place/precision"`. Not an assertion failure — if you see one, something already exports `precisionLabel` from that path.

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
  --exclude-dir=node_modules --exclude-dir=.next
```

Expected: hits only in `lib/place/*`, `where-fields.tsx`, and prose inside `lib/studio/place/notes.md` or `place.test.ts` docblocks. A prose mention is not an import; leave it.

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

### Task 3: the public fence gains `maplibre-gl`

`scripts/check-public-bundle.ts` has listed `maplibre-gl` in `BANNED_DEPS` since phase 0.5, but `eslint.config.mjs`'s public block never has — so today lint permits an import the bundle check refuses, and the mistake is caught at build time rather than at edit time. `eslint.config.mjs`'s own docblock says that is backwards: *"the public bundle budget is the enforcement which really holds; these catch the same mistake earlier."*

**The fence must refuse the static import and permit the dynamic one.** Measured on 2026-09-09 with the real config: `no-restricted-imports` flags `import maplibregl from "maplibre-gl"` and does not flag `await import("maplibre-gl")`. That asymmetry is what makes the rule usable — the map's whole design is a dynamic import — and both halves are asserted, because a fence that also refused `import()` would ban the map outright and nothing would say so until stage 2.

**Files:**
- Modify: `test/guardrails.test.ts`
- Modify: `eslint.config.mjs` — the public `no-restricted-imports` `patterns` array

**Interfaces:**
- Consumes: nothing.
- Produces: a lint rule stage 2 relies on. No exported code.

- [ ] **Step 1: Write the two failing cases, using the file's own three helpers**

`test/guardrails.test.ts` already has everything needed, and the signatures matter:

- `lint(filePath, code)` — **path first, code second.** Getting this round the wrong way lints the snippet at a path where no rule applies, and every reject-case then passes for the wrong reason.
- `ruleIds(msgs)` — the rule ids, for `toContain` / `not.toContain`.
- `fatals(msgs)` — parse failures. **The allow-case must assert this is empty.** The helper's own docblock explains why: an unparseable snippet yields one message with `fatal: true` and `ruleId: null` and no rule messages at all, so *every* allow-case would pass on a snippet that was never linted. That is this repository's "green run that verified nothing" in miniature.

Add both cases inside the existing `describe("guardrails actually fire", …)`, beside the other public-boundary cases:

```ts
  it("rejects a static maplibre-gl import from a public route", async () => {
    const msgs = await lint(
      "app/(public)/trips/[slug]/probe.ts",
      `import maplibregl from "maplibre-gl";\nexport const a = maplibregl;\n`,
    );
    expect(ruleIds(msgs)).toContain("no-restricted-imports");
    expect(msgs.map((m) => m.message).join()).toMatch(/lazy/i);
  });

  it("allows a dynamic maplibre-gl import from a public route, which is how the map mounts", async () => {
    // The asymmetry is the whole point: no-restricted-imports does not reach an
    // ImportExpression, and the map is a chunk the prerendered HTML never names.
    const msgs = await lint(
      "app/(public)/trips/[slug]/probe.ts",
      `export async function load() {\n  const m = await import("maplibre-gl");\n  return m.default;\n}\n`,
    );
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("no-restricted-imports");
  });
```

- [ ] **Step 2: Run them and watch the first fail and the second pass**

Run: `npx vitest run test/guardrails.test.ts`

Expected: the static case FAILS — `ruleIds(msgs)` is `[]` because the fence does not exist yet. The dynamic case PASSES already, which is correct and is a control rather than a bug: it must keep passing after Step 3, and its value is that it will fail if anyone later reaches for `no-restricted-syntax` on `ImportExpression`.

If the dynamic case fails at this step, read `fatals(msgs)` first — a top-level `await import` in a snippet ESLint cannot parse would report as fatal, and that is a fixture bug, not a rule.

If the static case passes at this step, the fence is already there and this task is done — check `git log` before doing anything else.

- [ ] **Step 3: Add the fence, as its own entry**

In `eslint.config.mjs`, inside the `app/(public)/**` block's `no-restricted-imports` `patterns` array, add a new entry. **Its own entry, not appended to the `exifreader` group** — that group's message is about image processing and would be actively misleading here.

```js
{
  // BANNED_DEPS has listed maplibre-gl since phase 0.5; this is the same ban
  // one step earlier. STATIC ONLY, deliberately: no-restricted-imports does
  // not reach an ImportExpression, and the map is mounted by
  // `await import("maplibre-gl")` on intersection, which must stay legal.
  group: ["maplibre-gl", "maplibre-gl/**"],
  message:
    "maplibre-gl must never be statically imported by a public route — it is 252.8 kB gzip against a 190 kB budget. The map is lazy: `await import(\"maplibre-gl\")` inside the intersection handler, so the chunk is one the prerendered HTML never names (CLAUDE.md, Map).",
},
```

Four comment lines, inside the hard bound of six.

- [ ] **Step 4: Run them and watch both pass**

```sh
npx vitest run test/guardrails.test.ts
```

Expected: PASS, both cases. Then lint the config and the guardrail suite **on disk**, which is what catches a selector that breaks the very file proving it works:

```sh
npx eslint eslint.config.mjs test/guardrails.test.ts
```

Expected: clean, no output.

- [ ] **Step 5: Prove it on a real file, then remove the proof**

The virtual-path cases above trust ESLint's `filePath` argument. Confirm the glob matches a real path too:

```sh
mkdir -p 'app/(public)/__probe'
printf 'import maplibregl from "maplibre-gl";\nexport const a = maplibregl;\n' > 'app/(public)/__probe/static.ts'
printf 'export async function load() {\n  const m = await import("maplibre-gl");\n  return m.default;\n}\n' > 'app/(public)/__probe/dynamic.ts'
npx eslint 'app/(public)/__probe/static.ts' 'app/(public)/__probe/dynamic.ts'
```

Expected: exactly one error, on `static.ts`, naming `no-restricted-imports`. Then:

```sh
rm -rf 'app/(public)/__probe'
git status --porcelain    # expect only eslint.config.mjs and test/guardrails.test.ts
```

- [ ] **Step 6: Run the full suite and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
```

```sh
git add eslint.config.mjs test/guardrails.test.ts
git commit -m "The public fence gains maplibre-gl, statically only

BANNED_DEPS has listed maplibre-gl since phase 0.5, but the eslint public block
never has, so lint permitted an import the bundle check refuses and the mistake
surfaced at build time instead of edit time. eslint.config.mjs's own docblock
says that is backwards.

Static only, and measured rather than assumed: no-restricted-imports flags
\`import maplibregl from \"maplibre-gl\"\` and does not reach
\`await import(\"maplibre-gl\")\`. That asymmetry is what makes the rule usable,
since the map's whole design is the dynamic form — so the dynamic case is
asserted too, as a control. Without it, a later move to no-restricted-syntax on
ImportExpression would ban the map outright and nothing would say so until
stage 2.

Its own patterns entry rather than appended to the exifreader group, whose
message is about image processing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `react-map-gl` leaves, and the decision is recorded

Nothing imports it — confirm that before removing it, because this task's only real risk is that something does.

**There is no test here, and that is deliberate rather than an omission.** Removing an unimported dependency has no behaviour to assert; what verifies it is that `typecheck` and the full suite stay green with the package gone, plus a grep proving nothing reached for it. Adding a test that asserts a package is absent from `package.json` would assert the plan rather than the software.

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `docs/decisions.md` — new §25
- Modify: `TODO.md` — annotate the phase 0.5 pin; add a Stage 0 line under `## Phase 4`

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

- [ ] **Step 4: Record the decision**

Append to `docs/decisions.md`, following the format of the numbered sections above it — a claim, the reasoning, a **Consequences** paragraph and a **Rejected** paragraph:

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
to the next agent as sanctioned.
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

- `lib/time/offsets.ts` and `lib/place/precision.ts` exist, and `grep -rn 'lib/studio/time'` over the tree returns nothing.
- A public-path file can import both without a lint error, and cannot statically import `maplibre-gl`.
- `test/guardrails.test.ts` asserts that fence in both directions, and the static half was watched failing before the rule existed.
- `react-map-gl` is gone from `package.json` and the lockfile; `docs/decisions.md` §25 records why.
- All nine definition-of-done commands pass, plus `test:e2e`, each run separately and each log read — and the integration suites were proven to have run by the dead-port control.
- No test file was edited for content. `git diff HEAD~4 -- '**/*.test.ts' '**/*.test.tsx'` shows only import specifiers and one relocated describe block.

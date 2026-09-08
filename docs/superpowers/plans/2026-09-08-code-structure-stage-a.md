# Code Structure Conventions — Stage A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the code-structure conventions into `CLAUDE.md`, enforce them in lint and CI, and move the repository's files to the new layout — with zero change to behaviour.

**Architecture:** Documentation first, so the rules exist before anything is measured against them. Then the collection guard is widened, because moving a test file out from under a guard that only scans `test/` is this repository's named failure mode. Then the moves, mechanically, with the suite green and no test file edited for content. Then the two enforcement mechanisms: ESLint at the hard bounds, and a new `check:structure` script for layout, comment length and `notes.md` pointer resolution.

**Tech Stack:** Node 22.23.2, TypeScript, ESLint 9.39.5 flat config, Vitest, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md`

## Global Constraints

- **Node 22.** Run `nvm use` then confirm `node -v` prints `v22.x` before anything. If `nvm` is absent: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. Every command in this plan passes on Node 20 too, which is why checking is a step you do rather than one the tooling does.
- **Zero behaviour change in this entire stage.** The invariant that proves it: **no test file is edited for content.** Import paths change; assertions, fixtures and test names do not. If a move requires an assertion change, the move changed behaviour — stop and report.
- **`npm test` needs a Pod.** Run `npm run pod:dev &` first, or the two integration suites skip themselves and the run is green having never executed them.
- Prettier is not in the definition of done and this stage does not reformat. Touch only what the task names.
- Limits, all excluding comment-only and blank lines: render 130 tendency / 200 hard; lib and scripts 50 / 80; comment block 3 / 6; test file 600 / 1000; test function bodies unlimited.
- The `dy:` namespace is still `https://example.org/ns/traveldiary#`. Nothing in this stage writes to any Pod.

## File Structure

| File | Responsibility |
|---|---|
| `CLAUDE.md` | conventions section; `check:structure` in the Commands block and the definition of done; e2e diff-gate globs rewritten to post-move paths |
| `test/vitest-collection.test.ts` | widened from a `test/`-only scan to a repository-wide walk |
| `test/support/walk.ts` | the directory walker the guard uses, unit-tested on a fixture tree |
| `components/studio/entry-editor/` | `entry-editor.tsx`, `index.ts`, `entry-editor.test.tsx` |
| `components/studio/studio-shell/` | `studio-shell.tsx`, `index.ts`, `studio-shell.test.tsx`, `studio-trip-loading.test.tsx` |
| `components/studio/studio-client/` | `studio-client.tsx`, `index.ts` |
| `lib/**/<module>.test.ts` | colocated module tests, moved from `test/` |
| `test/integration/` | the two Pod integration suites |
| `eslint.config.mjs` | `max-lines-per-function` and `max-lines`, path-scoped, at the hard bounds |
| `scripts/check-structure.ts` | layout, comment length, `notes.md` pointers, and the drift report |
| `test/check-structure.test.ts` | tests for that script |
| `test/guardrails.test.ts` | lint-rule probes for the two new ESLint rules; virtual paths updated |
| `.github/workflows/ci.yml` | `check:structure` step |

---

### Task 1: The conventions, written down

Documentation only. No code, no moves. This lands first so that every later task has something to be measured against.

**Files:**
- Modify: `CLAUDE.md` — a new `## Code structure` section, placed immediately after `## Hard rules`

**Interfaces:**
- Consumes: nothing.
- Produces: the section that Tasks 5, 6 and 7 cite, and the wording `check:structure` reports quote.

- [ ] **Step 1: Add the section to `CLAUDE.md`, after the `## Hard rules` section and before `## Commands`**

```markdown
## Code structure

Numbers below are **tendencies, then hard bounds**. The tendency is what the code should look
like; the hard bound is what CI refuses. Both exclude comment-only and blank lines, which is
what makes them countable: a 200-line function carrying 120 lines of prose is an 80-line
function, and the prose is the comment rule's problem rather than this one's.

| Rule | Tendency | Hard bound | Applies to |
|---|---|---|---|
| Render function | 130 | 200 | `components/**`, `app/**` |
| Util / lib function | 50 | 80 | `lib/**`, `scripts/**` |
| Inline comment block | 3 lines | 6 lines | everywhere except `components/ui/**` |
| Test file | 600 | 1000 | `**/*.test.{ts,tsx}` |
| Test function body | no limit | no limit | — |

Test bodies carry no length limit on purpose. A scenario test reads better whole than shredded
into helpers whose names hide the arrangement; the file ceiling is what keeps tests navigable.

**Comments say what the code cannot, in three lines or fewer.** Anything longer moves to a
sibling `notes.md` and the code keeps a pointer: `// First writer wins; see ./notes.md#first-writer-wins`.
`check:structure` fails if that anchor does not resolve, so the pointer cannot rot the way the
line-number citations in the entry-editor tests did — twice in one stage, the second time within
a single fix round.

`notes.md`, not `README.md`: README promises "how to use this", notes promises "why it is like
this", and the second is what the prose in this repository actually is. **Notes cite
`docs/data-model.md` by section number rather than restating it** — that file stays the single
normative source, and a note that paraphrases a normative rule is a second opinion waiting to
drift.

One exception, deliberately. Where a comment is a trap warning **at the point of danger** —
`vitest.config.ts`'s "`.tsx` IS LOAD-BEARING", which exists because 31 kB of test file once went
silently uncollected — one shouted line plus a pointer stays inline. A cross-reference is worse
than a shout for something the reader must not walk past, and a long docblock is worse than both
because it gets skimmed.

**One component, one folder**, holding the named component file, a one-line `index.ts`
re-export, its test, and its `notes.md` if it has one:

    components/studio/entry-editor/
      entry-editor.tsx  index.ts  entry-editor.test.tsx  notes.md

Named file plus a barrel, because a tab bar of twelve `index.tsx` files is the opposite of
readable and stack traces that all say `index.tsx` are worse, while the barrel keeps imports
short. `components/ui/**` is exempt and stays flat: it is shadcn's copied source, the CLI
rewrites it flat on update, and it is already exempt from the arbitrary-Tailwind guardrail.

**`lib/**` holds no React.** A helper pulled out of a component goes to `lib/studio/<topic>/` if
it is pure and reusable, and stays in the component folder if it is presentation. The
public/studio lint boundary is written in terms of `lib/`, so this split is what keeps that
boundary meaningful.

**Tests live beside their subject.** A `*.test.ts(x)` file sits in the same directory as the
source file of the same base name. Three kinds have no single subject and stay in `test/`:
the shared harness (`setup.ts`, `msw.ts`, `graph.ts`, `network-guard.ts`, `child-output.ts`,
`fixtures/`, `support/`), the Pod integration suites in `test/integration/`, and the tests whose
subject is the repository itself (`guardrails`, `check-commands`, `check-structure`,
`public-bundle`, `public-bundle-cli`, `vitest-collection`). `check:structure` carries that list
and fails on anything else left loose in `test/`.

**An exemption is a comment with a reason and a removal condition**, never a bare disable:

    /* eslint-disable-next-line max-lines-per-function --
       Stage B decomposes this; see docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md §5 */

`check:structure` prints every active exemption on every run, so none of them hides.
```

- [ ] **Step 2: Verify the docs checks still pass**

Run: `node -v && npm run check:commands`
Expected: PASS. This task adds no script, so the Commands block is untouched; the check confirms the new section did not disturb the block it parses. It looks for a `## Commands` heading and **exactly one** untagged code fence beneath it — the new section is above `## Commands`, and its fences are indented blocks rather than fenced ones, so neither concern is triggered.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "The conventions are rules in CLAUDE.md, not a preference in a chat log"
```

---

### Task 2: Widen the collection guard before anything moves

`test/vitest-collection.test.ts` exists because `vitest.config.ts` once included only `**/*.test.ts`, so the repository's first `.tsx` test — 31 kB of it — was collected by nothing, and the suite reported "280 passed" byte-for-byte identically with and without it. That guard currently scans `test/` **top level only**. Move tests out from under it and it keeps passing while guarding an empty directory: the same failure it was written to prevent, reintroduced by the fix.

It is widened **before** the first move, not alongside it.

**Files:**
- Create: `test/support/walk.ts`
- Create: `test/support/walk.test.ts`
- Modify: `test/vitest-collection.test.ts`

**Interfaces:**
- Produces: `walkTestFiles(rootDir: string): string[]` — every `*.test.ts` and `*.test.tsx` under `rootDir` at any depth, as paths relative to `rootDir`, POSIX separators, sorted, with `node_modules`, `.next`, `.git`, `.pod-data` and `test-results` skipped. Task 3 and Task 4 rely on the widened guard catching a mis-collected move; Task 6 imports this same function.

- [ ] **Step 1: Write the failing test for the walker**

Create `test/support/walk.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { walkTestFiles } from "./walk";

/** A tree with a test file NESTED, which is the whole point: the guard this
 *  feeds used to scan one directory deep. See ./notes.md#why-a-walker */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "walk-"));
  mkdirSync(join(root, "lib", "deep", "deeper"), { recursive: true });
  mkdirSync(join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(root, "top.test.ts"), "");
  writeFileSync(join(root, "lib", "mid.test.ts"), "");
  writeFileSync(join(root, "lib", "deep", "deeper", "low.test.tsx"), "");
  writeFileSync(join(root, "lib", "deep", "not-a-test.ts"), "");
  writeFileSync(join(root, "node_modules", "pkg", "vendor.test.ts"), "");
  return root;
}

describe("walkTestFiles", () => {
  it("finds test files at every depth, not just the top", () => {
    expect(walkTestFiles(tree())).toEqual([
      "lib/deep/deeper/low.test.tsx",
      "lib/mid.test.ts",
      "top.test.ts",
    ]);
  });

  it("collects both extensions, so a .tsx-only regression cannot hide", () => {
    const found = walkTestFiles(tree());
    expect(found.some((f) => f.endsWith(".test.ts"))).toBe(true);
    expect(found.some((f) => f.endsWith(".test.tsx"))).toBe(true);
  });

  it("skips node_modules, or the guard grades vendor code", () => {
    expect(walkTestFiles(tree()).join("\n")).not.toContain("node_modules");
  });

  it("returns [] for a directory that does not exist, rather than throwing", () => {
    expect(walkTestFiles(join(tmpdir(), "walk-absent-" + Date.now()))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run test/support/walk.test.ts`
Expected: FAIL — `Failed to resolve import "./walk"`.

- [ ] **Step 3: Write the walker**

Create `test/support/walk.ts`:

```ts
import { existsSync, readdirSync } from "node:fs";
import { join, posix, sep } from "node:path";

/** Directories no guard should grade. */
const SKIP = new Set(["node_modules", ".next", ".git", ".pod-data", "test-results", "coverage"]);

/**
 * Every test file under `rootDir`, at any depth, relative and POSIX-separated.
 * See ./notes.md#why-a-walker for why depth is the point.
 */
export function walkTestFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) return [];
  const found: string[] = [];
  const visit = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        visit(join(dir, entry.name), prefix === "" ? entry.name : `${prefix}/${entry.name}`);
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        found.push(prefix === "" ? entry.name : `${prefix}/${entry.name}`);
      }
    }
  };
  visit(rootDir, "");
  return found.map((f) => f.split(sep).join(posix.sep)).sort();
}
```

- [ ] **Step 4: Write the note the pointers reference**

Create `test/support/notes.md`:

```markdown
# test/support

## why-a-walker

`vitest.config.ts` once included only `**/*.test.ts`. The repository's first `.tsx` test —
`test/studio-shell.test.tsx`, 31 kB — was therefore collected by nothing, and the suite
reported "280 passed" identically with and without it on disk. An uncollected file does not
report red; it does not report at all.

`vitest-collection.test.ts` was written to catch that, but it listed `test/` **top level
only**. Once tests moved next to their subjects, that guard would have kept passing while
grading an empty directory — the same defect, reintroduced by its own fix. Hence a walker,
and hence a test that asserts depth rather than merely presence.
```

- [ ] **Step 5: Run the walker tests and watch them pass**

Run: `npx vitest run test/support/walk.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Point the collection guard at the walker**

In `test/vitest-collection.test.ts`, replace the `testFilesOnDisk` function. It currently reads
`readdirSync(new URL("../test", …))` and prefixes `test/`. Replace with a repository-wide walk,
and import the walker:

```ts
import { walkTestFiles } from "./support/walk";
```

```ts
/** Every *.test.ts / *.test.tsx anywhere in the repository. NOT just test/ —
 *  see ./support/notes.md#why-a-walker for what a one-deep scan cost. */
function testFilesOnDisk(): string[] {
  return walkTestFiles(repoRoot);
}
```

`repoRoot` already exists in that file. `collectedFiles()` returns paths as vitest prints them,
which are repository-relative with POSIX separators — the same shape the walker returns — so the
comparison stays a comparison. Leave the existing `expect(files.length).toBeGreaterThan(10)`
guard alone: it is what stops an empty list making "no file is missing" vacuously true.

- [ ] **Step 7: Run the guard and confirm it still passes on the unmoved tree**

Run: `npx vitest run test/vitest-collection.test.ts test/support/walk.test.ts`
Expected: PASS. Every test file is still in `test/`, so widening the scan changes nothing yet — which is the point of doing it before the moves rather than with them.

- [ ] **Step 8: Prove the widened guard actually catches what the old one could not**

This is the step that stops this task from being a green run that verified nothing. Create a colocated test file where none existed, and confirm the guard *notices* it:

```bash
printf 'import { it, expect } from "vitest";\nit("probe", () => expect(1).toBe(1));\n' > lib/probe-delete-me.test.ts
npx vitest run test/vitest-collection.test.ts
```

Expected: PASS, and the guard's collected list now includes `lib/probe-delete-me.test.ts` — `vitest.config.ts` already includes `lib/**/*.test.{ts,tsx}`. Now break it deliberately:

```bash
mkdir -p components/probe && mv lib/probe-delete-me.test.ts components/probe/probe-delete-me.test.ts
npx vitest run test/vitest-collection.test.ts
```

Expected: **FAIL**, naming `components/probe/probe-delete-me.test.ts` as on disk but not collected — because the config's `include` covers `test/**` and `lib/**` but not `components/**`. That failure is the guard doing its job, and it is exactly the hole Task 3 must close before moving a component test.

```bash
rm -rf components/probe
```

- [ ] **Step 9: Widen the vitest `include` so component tests are collected**

In `vitest.config.ts`, change `include` and record why:

```ts
    /**
     * `.tsx` IS LOAD-BEARING — see test/support/notes.md#why-a-walker.
     * `components/**` and `app/**` joined the list when tests moved beside
     * their subjects; test/vitest-collection.test.ts fails if any of the four
     * stops matching a file that exists.
     *
     * `.spec.ts` stays deliberately excluded: test/fixtures/swallowed-stray.spec.ts
     * is a fixture that MUST fail, and e2e/*.spec.ts belongs to Playwright.
     */
    include: [
      "test/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "components/**/*.test.{ts,tsx}",
      "app/**/*.test.{ts,tsx}",
    ],
```

- [ ] **Step 10: Re-run the probe and confirm the hole is closed**

```bash
mkdir -p components/probe
printf 'import { it, expect } from "vitest";\nit("probe", () => expect(1).toBe(1));\n' > components/probe/probe-delete-me.test.ts
npx vitest run test/vitest-collection.test.ts
```

Expected: PASS, with the probe now collected. Then remove it: `rm -rf components/probe`

- [ ] **Step 11: Full suite, with the Pod up**

Run: `npm run pod:dev & sleep 5; npm test`
Expected: PASS, 1020 passed / 2 todo / **0 skipped** / 29 files, plus the 4 new walker tests — 1024 passed / 30 files. If skipped is not 0, the Pod is not up and the integration suites did not run.

- [ ] **Step 12: Commit**

```bash
git add test/support/ test/vitest-collection.test.ts vitest.config.ts
git commit -m "The collection guard walks the repository, before any test moves out of test/"
```

---

### Task 3: `components/studio` becomes three folders

Mechanical. Three components, each into its own folder with a barrel and its colocated test. Two of the traps in the spec are paid here: the e2e diff-gate globs in `CLAUDE.md`, and the virtual filenames in `test/guardrails.test.ts`.

**Files:**
- Move: `components/studio/entry-editor.tsx` → `components/studio/entry-editor/entry-editor.tsx`
- Move: `components/studio/studio-shell.tsx` → `components/studio/studio-shell/studio-shell.tsx`
- Move: `components/studio/studio-client.tsx` → `components/studio/studio-client/studio-client.tsx`
- Move: `test/entry-editor.test.tsx` → `components/studio/entry-editor/entry-editor.test.tsx`
- Move: `test/studio-shell.test.tsx` → `components/studio/studio-shell/studio-shell.test.tsx`
- Move: `test/studio-trip-loading.test.tsx` → `components/studio/studio-shell/studio-trip-loading.test.tsx`
- Create: an `index.ts` in each of the three folders
- Modify: importers of the three components; `CLAUDE.md`; `test/guardrails.test.ts`

**Interfaces:**
- Consumes: `walkTestFiles` via the widened guard from Task 2, and the widened `include`.
- Produces: the three import paths `@/components/studio/entry-editor`, `@/components/studio/studio-shell`, `@/components/studio/studio-client`, each resolving through a barrel. Tasks 5, 6 and 7 reference the post-move paths.

- [ ] **Step 1: Find every importer before moving anything**

```bash
grep -rn "components/studio/" --include='*.ts' --include='*.tsx' --include='*.md' --include='*.mjs' --include='*.yml' . \
  | grep -v node_modules | grep -v '^./.next'
```

Write the list down. It must include `app/(studio)/studio/page.tsx` or its client wrapper, the three test files, `CLAUDE.md`, and `test/guardrails.test.ts`. Anything else you find is also in scope for this task.

- [ ] **Step 2: Move the files with `git mv`, so history follows**

```bash
for c in entry-editor studio-shell studio-client; do mkdir -p "components/studio/$c"; done
git mv components/studio/entry-editor.tsx  components/studio/entry-editor/entry-editor.tsx
git mv components/studio/studio-shell.tsx  components/studio/studio-shell/studio-shell.tsx
git mv components/studio/studio-client.tsx components/studio/studio-client/studio-client.tsx
git mv test/entry-editor.test.tsx          components/studio/entry-editor/entry-editor.test.tsx
git mv test/studio-shell.test.tsx          components/studio/studio-shell/studio-shell.test.tsx
git mv test/studio-trip-loading.test.tsx   components/studio/studio-shell/studio-trip-loading.test.tsx
```

`studio-trip-loading.test.tsx` goes with `studio-shell` because that is its subject — confirm by reading its imports before moving, and if it imports a different component, put it with that one instead and say so in the commit message.

- [ ] **Step 3: Add the three barrels**

`components/studio/entry-editor/index.ts`:

```ts
export { default } from "./entry-editor";
export type { EditorTrip, EntryEditorProps } from "./entry-editor";
export { DRAFT_DEBOUNCE_MS } from "./entry-editor";
```

`components/studio/studio-shell/index.ts` and `components/studio/studio-client/index.ts` follow the same shape. **Re-export exactly what each file exports and no more** — read the `export` lines in the moved file and mirror them. A barrel that exports something the module does not have fails `typecheck`; one that omits something an importer needs fails the same way, which is how you know the list is right.

- [ ] **Step 4: Fix the import paths**

Inside each moved test file, imports of the component change from `@/components/studio/entry-editor` — which still resolves, via the barrel — so most need no change at all. What does change: **relative** imports. A moved test importing `./msw` or `./graph` now needs `@/test/msw`. Prefer the `@/` alias over `../../../test/msw`, which is unreadable and breaks again on the next move.

```bash
npm run typecheck
```

Expected: errors naming exactly the unresolved relative imports. Fix each, re-run until clean. **Do not touch an assertion.** If typecheck reports anything that is not an import path, stop and report it.

- [ ] **Step 5: Rewrite the e2e diff-gate globs in `CLAUDE.md`**

The gate lists literal paths. `components/studio/**` still matches after this move, but the two single-file entries and the studio-lib entry must be checked, and the block re-read as a whole to confirm every path still names something that exists. In the fenced block under "A ninth command, path-scoped rather than unconditional", verify each of the six paths resolves:

```bash
for p in "lib/studio" "app/(studio)" "components/studio" "app/(public)/client-id.jsonld" "lib/media" "lib/pod/write.ts"; do
  test -e "$p" && echo "ok   $p" || echo "GONE $p"
done
```

Expected: six `ok`. Any `GONE` is a gate that has stopped matching what it was written to catch — including the EXIF/GPS pass-through hole `lib/media/**` was added for. Fix the path in `CLAUDE.md` before continuing.

- [ ] **Step 6: Update the virtual filenames in `test/guardrails.test.ts`**

That file hands ESLint filenames like `components/studio/entry-editor.tsx` without reading any file, so nothing breaks when the real file moves — which is exactly why they must be changed deliberately, or the probes describe paths that no longer exist.

```bash
grep -n 'components/studio/entry-editor.tsx' test/guardrails.test.ts
```

Replace each with `components/studio/entry-editor/entry-editor.tsx`. These are strings passed to a linter, not assertions about behaviour, so this is a path fix and not a content edit.

- [ ] **Step 7: Run lint, typecheck and the full suite**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all pass. Test count unchanged from Task 2's 1024 — a move that changes the count moved a test into or out of collection, and the collection guard should have said so first.

- [ ] **Step 8: Confirm the public bundle did not move**

Run: `npm run size:public`
Expected: within budget, and every studio-only dependency still absent from the public graph. Barrels can pull more into a module graph than the direct import did; this is the check that catches it.

- [ ] **Step 9: The gated e2e run, because this diff touches `components/studio/**`**

```bash
npx playwright install chromium
npm run pod:dev &
npm run test:e2e
```

Expected: 6 passed. A cached browser from another Playwright version does not count — this repo has stale 1208 and 1223 revisions alongside the 1234 that `@playwright/test@1.62.1` wants.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Each studio component has a folder, and its test sits beside it"
```

---

### Task 4: The remaining tests move beside their subjects

Twenty-six test files remain in `test/`. Fourteen have a single module as their subject and colocate. The rest have no single subject and stay, two of them relocated into `test/integration/`.

**Files:**
- Move, each `test/<name>.test.ts` → beside its subject:
  `access.test.ts` → `lib/pod/access.test.ts`;
  `read.test.ts` → `lib/pod/read.test.ts`;
  `fuzz.test.ts` → `lib/pod/fuzz.test.ts`;
  `index-model.test.ts` → `lib/pod/index-model.test.ts`;
  `entry-write.test.ts` → `lib/pod/entry-model.test.ts`;
  `write-primitives.test.ts` → `lib/pod/write.test.ts`;
  `drafts.test.ts` → `lib/studio/drafts.test.ts`;
  `session.test.ts` → `lib/studio/session.test.ts`;
  `studio-trips.test.ts` → `lib/studio/trips.test.ts`;
  `owner-profile.test.ts` → `lib/pod/owner-profile.test.ts`;
  `cached-owner-profile.test.ts` → `lib/pod/cached.test.ts`;
  `privacy-settings.test.ts` → `lib/pod/privacy-settings.test.ts`;
  `media-exif.test.ts` → `lib/media/exif.test.ts`;
  `media-pipeline.test.ts` → `lib/media/pipeline.test.ts`;
  `media-targets.test.ts` → `lib/media/targets.test.ts`;
  `media-upload.test.ts` → `lib/media/upload.test.ts`
- Move: `test/pod-read.integration.test.ts` and `test/pod-access.integration.test.ts` → `test/integration/`
- Move: `test/revalidate-route.test.ts` → `app/(public)/api/revalidate/route.test.ts`; `test/studio-page.test.ts` → `app/(studio)/studio/page.test.ts`
- Stay in `test/`: `guardrails`, `check-commands`, `public-bundle`, `public-bundle-cli`, `vitest-collection`, `network-guard`, plus `setup.ts`, `msw.ts`, `graph.ts`, `network-guard.ts`, `child-output.ts`, `fixtures/`, `support/`

**Interfaces:**
- Consumes: the widened `include` and guard from Task 2.
- Produces: the final layout `check:structure` validates in Task 6, and the allowlist it carries.

- [ ] **Step 1: Confirm each subject before moving, one grep**

The mapping above pairs a test with a module by name, and three of those pairings rename the test (`entry-write` → `entry-model`, `studio-trips` → `trips`, `cached-owner-profile` → `cached`). Verify each by reading the test's own imports:

```bash
for t in access read fuzz index-model entry-write write-primitives drafts session \
         studio-trips owner-profile cached-owner-profile privacy-settings \
         media-exif media-pipeline media-targets media-upload revalidate-route studio-page; do
  echo "--- $t"; grep -m3 -E '^import .*from "(@/|\.)' "test/$t.test.ts" 2>/dev/null | head -3
done
```

Where the imports name a different module than the mapping does, follow the imports and note the correction in the commit message. `owner-profile` and `privacy-settings` in particular may be functions inside `lib/pod/read.ts` rather than modules of their own — if so, they colocate as `lib/pod/owner-profile.test.ts` next to nothing, which `check:structure` will reject in Task 6. In that case put them at `lib/pod/read.owner-profile.test.ts` and `lib/pod/read.privacy-settings.test.ts`, so the base name before the first dot matches `read.ts`.

- [ ] **Step 2: Move them**

Use `git mv` for every one, per the mapping confirmed in Step 1. Create `test/integration/` first:

```bash
mkdir -p test/integration
git mv test/pod-read.integration.test.ts   test/integration/pod-read.integration.test.ts
git mv test/pod-access.integration.test.ts test/integration/pod-access.integration.test.ts
```

- [ ] **Step 3: Fix the relative imports, and only those**

Every moved file that imported `./msw`, `./graph`, `./setup`, `./network-guard` or `./child-output` now needs `@/test/<name>`.

```bash
npm run typecheck
```

Expected: errors naming only unresolved import paths. Fix, re-run until clean. **No assertion, fixture or test name is edited in this task.**

- [ ] **Step 4: Confirm the two integration suites still find the Pod**

```bash
npm run pod:dev &
sleep 5
npx vitest run test/integration/
```

Expected: PASS with a real count, **not "skipped"**. Those suites skip themselves when nothing answers on `localhost:3001`; a move that broke their Pod detection would show up here as a green skip rather than a failure, which is the specific thing to look for.

- [ ] **Step 5: Full suite and the guard**

```bash
npm test
```

Expected: 1024 passed / 2 todo / 0 skipped, same as Task 3, across 30 files. The collection guard now walks the whole repository, so a file that landed somewhere `include` does not cover fails here by name.

- [ ] **Step 6: Lint, typecheck, and what a public page ships**

```bash
npm run lint && npm run typecheck && npm run size:public
```

Expected: all pass. `size:public` matters again because `app/(public)/api/revalidate/route.test.ts` now sits inside the public route group — confirm the bundle check does not start counting a test file. If it does, that is a real finding: report it rather than excluding the file quietly.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "A test sits beside its subject, and the three without one keep a home in test/"
```

---

### Task 5: ESLint enforces the hard bounds

Two core rules, path-scoped, at the hard bounds — not the tendencies. CI must refuse a monolith without refusing a function that is merely a little long, because the maintainer's numbers are tendencies.

Three functions and one test file exceed the hard bounds today, and each gets an exemption naming the stage that removes it. Measured with ESLint before this task was written: `EntryEditor` 941 against 200; `serialiseEntry` 111 and `check-public-bundle.ts :: main` 94 against 80; `entry-editor.test.tsx` 6,514 lines against 1000.

**Files:**
- Modify: `test/guardrails.test.ts` — the failing probes first
- Modify: `eslint.config.mjs`
- Modify: `components/studio/entry-editor/entry-editor.tsx`, `lib/pod/entry-model.ts`, `scripts/check-public-bundle.ts`, `components/studio/entry-editor/entry-editor.test.tsx` — one exemption each

**Interfaces:**
- Consumes: the post-move paths from Tasks 3 and 4.
- Produces: the rule names `max-lines-per-function` and `max-lines` that Task 6's exemption report greps for.

- [ ] **Step 1: Write the failing lint probes**

`test/guardrails.test.ts` already lints synthetic sources through ESLint with virtual filenames.
Its helper is `async function lint(filePath, code)` — **path first, code second** — returning the
message list, with `ruleIds(msgs)` mapping to rule names. Use them; do not add a second helper.

Add this block to that file:

```ts
describe("function length", () => {
  /** 210 statements: over the 200 hard bound for a render, and over lib's 80. */
  const longRender = `export function C() {\n${"  let x = 0;\n".repeat(210)}  return null;\n}\n`;
  /** 90 statements: over lib's 80 hard bound, under a render's 200. */
  const longUtil = `export function f() {\n${"  let x = 0;\n".repeat(90)}  return 1;\n}\n`;

  it("rejects a render function past the hard bound", async () => {
    const msgs = await lint("components/studio/thing/thing.tsx", longRender);
    expect(ruleIds(msgs)).toContain("max-lines-per-function");
    expect(msgs.map((m) => m.message).join()).toMatch(/too many lines/);
  });

  it("allows a render function that is merely long, because 130 is a tendency", async () => {
    const merely = `export function C() {\n${"  let x = 0;\n".repeat(140)}  return null;\n}\n`;
    const msgs = await lint("components/studio/thing/thing.tsx", merely);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
  });

  it("rejects a lib function past the hard bound", async () => {
    const msgs = await lint("lib/pod/thing.ts", longUtil);
    expect(ruleIds(msgs)).toContain("max-lines-per-function");
  });

  it("holds lib tighter than a render at the very same length", async () => {
    expect(ruleIds(await lint("lib/pod/thing.ts", longUtil))).toContain("max-lines-per-function");
    expect(ruleIds(await lint("components/studio/thing/thing.tsx", longUtil)))
      .not.toContain("max-lines-per-function");
  });

  it("counts code and not prose: 300 comment lines change nothing", async () => {
    const prose =
      `export function f() {\n${"  // a line of prose\n".repeat(300)}` +
      `${"  let x = 0;\n".repeat(40)}  return 1;\n}\n`;
    const msgs = await lint("lib/pod/thing.ts", prose);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
  });

  it("limits a test FILE but never a test function body", async () => {
    const bigIt = `it("x", () => {\n${"  let x = 0;\n".repeat(300)}});\n`;
    const msgs = await lint("lib/pod/thing.test.ts", bigIt);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
    expect(ruleIds(msgs)).not.toContain("max-lines");
  });

  it("rejects a test file past its own 1000-line ceiling", async () => {
    const huge = `${"let x = 0;\n".repeat(1010)}`;
    expect(ruleIds(await lint("lib/pod/thing.test.ts", huge))).toContain("max-lines");
  });
});
```

Note the last two cases together: the file ceiling must fire while the function limit stays
silent, or "no limit on a test body" has been implemented as "no limit on a test file".

- [ ] **Step 2: Run the probes and watch them fail**

Run: `npx vitest run test/guardrails.test.ts`
Expected: FAIL — the three "refuses" cases get no `max-lines-per-function` message, because the rule does not exist yet. The three "allows" cases pass vacuously, which is why they are not the whole test.

- [ ] **Step 3: Add the rules to `eslint.config.mjs`**

Append two config blocks. ESLint flat config **replaces** a rule's options rather than merging them, and that has already bitten this file — the existing `no-restricted-imports` blocks carry a comment saying so. These are new rule names in their own blocks, so nothing is overwritten, but keep them in their own blocks for that reason.

```js
  /**
   * FUNCTION LENGTH, AT THE HARD BOUND ONLY. CLAUDE.md's "Code structure"
   * section sets 130 for a render and 50 for a util as TENDENCIES; these are
   * the 200/80 bounds CI refuses. The tendency is reported by
   * `npm run check:structure`, which does not fail on it — the maintainer's
   * numbers are "tend to", not a dictate, and a lint error cannot express that.
   *
   * `skipComments` is what makes the number mean anything here: this repository
   * runs 44% comment lines, so a 200-line span is routinely an 80-line function.
   */
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 200, skipComments: true, skipBlankLines: true, IIFEs: true },
      ],
    },
  },
  {
    files: ["lib/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "max-lines-per-function": [
        "error",
        { max: 80, skipComments: true, skipBlankLines: true, IIFEs: true },
      ],
    },
  },
  /**
   * A test file has a ceiling; a test FUNCTION has none. A scenario test reads
   * better whole than shredded into helpers whose names hide the arrangement,
   * so `max-lines-per-function` is off here and `max-lines` takes its place.
   */
  {
    files: ["**/*.test.{ts,tsx}", "e2e/**/*.ts"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": ["error", { max: 1000, skipComments: true, skipBlankLines: true }],
    },
  },
```

- [ ] **Step 4: Run the probes and watch them pass**

Run: `npx vitest run test/guardrails.test.ts`
Expected: PASS, all six new cases.

- [ ] **Step 5: See what the rules say about the real repository**

Run: `npm run lint`
Expected: FAIL with exactly four errors — `EntryEditor`, `serialiseEntry`, `check-public-bundle.ts :: main`, and `entry-editor.test.tsx`'s file length. Any fifth error is a function this plan did not measure: report it rather than exempting it silently.

- [ ] **Step 6: Add the four exemptions, each with a reason and a removal condition**

Immediately above `export default function EntryEditor(` in `components/studio/entry-editor/entry-editor.tsx`:

```ts
/* eslint-disable-next-line max-lines-per-function --
   941 lines against a 200 bound. Stage B decomposes this into hooks, a reducer and
   field groups; see docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md §5.
   Remove this line with the last field group. */
```

Above `serialiseEntry` in `lib/pod/entry-model.ts`, and above `main` in `scripts/check-public-bundle.ts`, the same shape citing §6 and Stage C. At the top of `components/studio/entry-editor/entry-editor.test.tsx`:

```ts
/* eslint-disable max-lines --
   6,514 code lines. Stage B splits this along its own numbered sections 0-11;
   see the spec §8. Remove with the split. */
```

- [ ] **Step 7: Lint clean, and the whole suite**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all pass. Four exemptions, no errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "CI refuses a monolith, and says which stage removes each of the four exemptions"
```

---

### Task 6: `check:structure` reports the tendency and enforces the layout

The rules ESLint cannot express: folder layout, test placement, comment-block length, `notes.md` pointer resolution, and the drift list. It **fails** on layout, on a comment block over 6 lines, and on a broken pointer. It **reports** — prints, exit 0 — every function over the tendency, every test file over 600 lines, and every active exemption.

**Files:**
- Create: `scripts/check-structure.ts`
- Create: `test/check-structure.test.ts`
- Modify: `package.json`, `CLAUDE.md`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `walkTestFiles` from `test/support/walk.ts` (Task 2); the layout from Tasks 3 and 4; the rule names from Task 5.
- Produces: `npm run check:structure`, exit 0 on pass, exit 1 with a named list on failure.

- [ ] **Step 1: Write the failing tests**

Create `test/check-structure.test.ts`. `test/check-commands.test.ts` is the model for running a
script as a child process here — it defines a local `runCli(root)` returning
`{ status, stdout, stderr, transcript }` and builds fixture checkouts in `tmpdir()`. There is no
shared `runScript` helper in this repository; `test/child-output.ts` exports only `stripAnsi`
and `ONE_FAILED_TEST`.

That file also states the doctrine this test must follow, in its own words: an exit code "cannot
say WHICH guard fired". So every failing case asserts the offending **path appears in the
output**, not merely that the status was 1.

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { stripAnsi } from "./child-output";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const created: string[] = [];
afterAll(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

type Run = { status: number; stdout: string; transcript: string };

function runCli(root: string): Run {
  const result = spawnSync("npx", ["tsx", "scripts/check-structure.ts", "--root", root], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const stdout = stripAnsi(result.stdout ?? "");
  const stderr = stripAnsi(result.stderr ?? "");
  return {
    status: result.status ?? -1,
    stdout,
    transcript: `\n$ tsx scripts/check-structure.ts --root ${root}\n[exit ${result.status}]\n${stdout}${stderr}`,
  };
}

/** A fixture tree that is COMPLIANT, so each case below breaks exactly one rule. */
function compliant(): string {
  const root = mkdtempSync(join(tmpdir(), "structure-"));
  created.push(root);
  mkdirSync(join(root, "components", "studio", "widget"), { recursive: true });
  mkdirSync(join(root, "lib", "pod"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "components", "studio", "widget", "widget.tsx"), "export const W = 1;\n");
  writeFileSync(join(root, "components", "studio", "widget", "index.ts"), 'export * from "./widget";\n');
  writeFileSync(join(root, "lib", "pod", "thing.ts"), "export const t = 1;\n");
  writeFileSync(join(root, "lib", "pod", "thing.test.ts"), 'import "./thing";\n');
  return root;
}

describe("check:structure, against this repository", () => {
  it("passes", () => {
    const run = runCli(ROOT);
    expect(run.status, run.transcript).toBe(0);
  });

  it("reports length drift without failing on it", () => {
    const run = runCli(ROOT);
    // EntryEditor is 941 against a tendency of 130, exempted rather than fixed until Stage B.
    expect(run.stdout, run.transcript).toMatch(/entry-editor/);
    expect(run.stdout, run.transcript).toMatch(/tendency/i);
    expect(run.status, "drift must report, never fail").toBe(0);
  });

  it("lists every active exemption by rule and path, so none of them hides", () => {
    const run = runCli(ROOT);
    expect(run.stdout, run.transcript).toMatch(/max-lines-per-function/);
    expect(run.stdout, run.transcript).toMatch(/entry-model\.ts/);
    // The count is the point: a report that scans only production files finds
    // three of Task 5's four and looks complete. The fourth is on a test file.
    expect(run.stdout, run.transcript).toMatch(/active exemptions — 4/);
    expect(run.stdout, run.transcript).toMatch(/entry-editor\.test\.tsx/);
  });
});

describe("check:structure, on fixtures that each break one rule", () => {
  it("accepts the compliant fixture, so the cases below mean something", () => {
    const run = runCli(compliant());
    expect(run.status, run.transcript).toBe(0);
  });

  it("fails on a component file outside a folder of its own name", () => {
    const root = compliant();
    writeFileSync(join(root, "components", "studio", "loose.tsx"), "export const L = 1;\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("components/studio/loose.tsx");
  });

  it("exempts components/ui from the folder rule", () => {
    const root = compliant();
    mkdirSync(join(root, "components", "ui"), { recursive: true });
    writeFileSync(join(root, "components", "ui", "button.tsx"), "export const B = 1;\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(0);
  });

  it("fails on a test with no source file of the same base name beside it", () => {
    const root = compliant();
    writeFileSync(join(root, "test", "orphan.test.ts"), 'import "vitest";\n');
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("test/orphan.test.ts");
  });

  it("fails on a notes pointer whose anchor does not resolve", () => {
    const root = compliant();
    const dir = join(root, "components", "studio", "widget");
    writeFileSync(join(dir, "widget.tsx"), "// see ./notes.md#no-such-heading\nexport const W = 1;\n");
    writeFileSync(join(dir, "notes.md"), "# widget\n\n## a-real-heading\n\nprose\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("no-such-heading");
  });

  it("accepts a pointer whose anchor does resolve, including a slugged heading", () => {
    const root = compliant();
    const dir = join(root, "components", "studio", "widget");
    writeFileSync(join(dir, "widget.tsx"), "// see ./notes.md#first-writer-wins\nexport const W = 1;\n");
    writeFileSync(join(dir, "notes.md"), "# widget\n\n## First writer wins\n\nprose\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(0);
  });

  it("fails on a pointer to a notes.md that does not exist at all", () => {
    const root = compliant();
    writeFileSync(
      join(root, "components", "studio", "widget", "widget.tsx"),
      "// see ./notes.md#anything\nexport const W = 1;\n",
    );
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("notes.md");
  });

  it("fails on a comment block past the six-line hard bound", () => {
    const root = compliant();
    const block = `${"// prose\n".repeat(7)}export const t = 1;\n`;
    writeFileSync(join(root, "lib", "pod", "thing.ts"), block);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("lib/pod/thing.ts");
  });

  it("allows a six-line block, so the bound is a bound and not an off-by-one", () => {
    const root = compliant();
    writeFileSync(join(root, "lib", "pod", "thing.ts"), `${"// prose\n".repeat(6)}export const t = 1;\n`);
    expect(runCli(root).status).toBe(0);
  });

  it("counts a block comment span, not just // runs", () => {
    const root = compliant();
    const span = `/**\n${" * prose\n".repeat(6)} */\nexport const t = 1;\n`;
    writeFileSync(join(root, "lib", "pod", "thing.ts"), span);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("lib/pod/thing.ts");
  });
});
```

Fourteen cases, and note the shape: every rule has a **positive** case beside its negative one —
`components/ui` exempted, a six-line block allowed, a resolving anchor accepted. A rule tested
only by what it rejects passes just as well when it rejects everything.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/check-structure.test.ts`
Expected: FAIL — `Cannot find module scripts/check-structure.ts`.

- [ ] **Step 3: Write the script**

Create `scripts/check-structure.ts`. Every function stays under the 50-line tendency — this
script is the first thing that would be embarrassing to exempt. One function per rule, each
returning the failures it found, and a `main` that collects and prints.

```ts
/**
 * Layout, comment length, and notes.md pointers — what ESLint cannot express.
 * FAILS on: a component outside its own folder, an orphan test, a comment block
 * over six lines, a `see ./notes.md#anchor` that does not resolve.
 * REPORTS, exit 0: functions over the tendency, test files over 600 lines, and
 * every active exemption. See CLAUDE.md "Code structure" for the two tiers.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { walkTestFiles } from "../test/support/walk";

const arg = process.argv.indexOf("--root");
const ROOT = resolve(arg === -1 ? process.cwd() : process.argv[arg + 1]);
const rel = (p: string) => p.slice(ROOT.length + 1).split("\\").join("/");

/** Every source file under `dir`, at any depth, skipping the usual noise. */
function sources(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!["node_modules", ".next", ".git", ".pod-data", "test-results"].includes(e.name))
        sources(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}
```

Rule 1, the folder layout. `components/ui` is exempt, and so is anything named `index`:

```ts
function componentFoldersAreOwn(): string[] {
  const bad: string[] = [];
  for (const file of sources(join(ROOT, "components"))) {
    const path = rel(file);
    if (path.startsWith("components/ui/")) continue;
    const name = basename(file).replace(/\.tsx?$/, "");
    if (name === "index") continue;
    if (basename(dirname(file)) !== name) bad.push(`${path} is not in a folder named "${name}"`);
    else if (!existsSync(join(dirname(file), "index.ts")))
      bad.push(`${path} has no index.ts barrel beside it`);
  }
  return bad;
}
```

Rule 2, test placement. The allowlist is the table in CLAUDE.md, and a path in it that no longer
exists is itself a failure — that is what stops the list rotting into a set of permanent excuses:

```ts
const REPO_TESTS = [
  "test/guardrails.test.ts", "test/check-commands.test.ts", "test/check-structure.test.ts",
  "test/public-bundle.test.ts", "test/public-bundle-cli.test.ts",
  "test/vitest-collection.test.ts", "test/network-guard.test.ts", "test/support/walk.test.ts",
];

function testsSitBesideSubjects(): string[] {
  const bad: string[] = [];
  for (const path of walkTestFiles(ROOT)) {
    if (REPO_TESTS.includes(path) || path.startsWith("test/integration/")) continue;
    const dir = join(ROOT, dirname(path));
    const stem = basename(path).replace(/\.test\.tsx?$/, "").split(".")[0];
    const beside = ["ts", "tsx"].some((ext) => existsSync(join(dir, `${stem}.${ext}`)));
    if (!beside) bad.push(`${path} has no ${stem}.ts(x) beside it, and is not an allowed repo test`);
  }
  for (const listed of REPO_TESTS)
    if (!existsSync(join(ROOT, listed))) bad.push(`REPO_TESTS names ${listed}, which does not exist`);
  return bad;
}
```

Rule 3, comment length. Counts a `//` run and a `/* … */` span alike, and reports the line the
block starts on:

```ts
function commentBlocksAreShort(): string[] {
  const bad: string[] = [];
  for (const file of sources(join(ROOT, "lib")).concat(
    sources(join(ROOT, "components")), sources(join(ROOT, "app")), sources(join(ROOT, "scripts")),
  )) {
    const path = rel(file);
    if (path.startsWith("components/ui/")) continue;
    let run = 0, startedAt = 0, inSpan = false;
    readFileSync(file, "utf8").split("\n").forEach((raw, i) => {
      const line = raw.trim();
      const isComment =
        inSpan || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*");
      if (line.startsWith("/*") && !line.includes("*/")) inSpan = true;
      if (inSpan && line.includes("*/")) inSpan = false;
      if (isComment) {
        if (run === 0) startedAt = i + 1;
        run += 1;
      } else {
        if (run > 6) bad.push(`${path}:${startedAt} has a ${run}-line comment block; move it to notes.md`);
        run = 0;
      }
    });
    if (run > 6) bad.push(`${path}:${startedAt} has a ${run}-line comment block; move it to notes.md`);
  }
  return bad;
}
```

Rule 4, the pointers. GitHub's slug: lowercase, spaces to hyphens, drop the rest:

```ts
const slug = (heading: string) =>
  heading.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");

function notesPointersResolve(): string[] {
  const bad: string[] = [];
  const dirs = [join(ROOT, "lib"), join(ROOT, "components"), join(ROOT, "app"), join(ROOT, "test")];
  for (const file of dirs.flatMap((d) => sources(d))) {
    const body = readFileSync(file, "utf8");
    for (const [, anchor] of body.matchAll(/\.\/notes\.md#([\w-]+)/g)) {
      const notes = join(dirname(file), "notes.md");
      if (!existsSync(notes)) {
        bad.push(`${rel(file)} points at ./notes.md#${anchor}, and no notes.md is beside it`);
        continue;
      }
      const anchors = [...readFileSync(notes, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
        slug(m[1]),
      );
      if (!anchors.includes(anchor))
        bad.push(`${rel(file)} points at #${anchor}, absent from ${rel(notes)} (has: ${anchors.join(", ")})`);
    }
  }
  return bad;
}
```

The two reports, which print and never fail. Reuse ESLint at the **tendency** values so there is
one length implementation in the repository rather than two opinions about it:

```ts
async function driftReport(): Promise<string[]> {
  const { ESLint } = await import("eslint");
  const lines: string[] = [];
  for (const [dirs, max] of [[["components", "app"], 130], [["lib", "scripts"], 50]] as const) {
    const files = dirs.flatMap((d) => sources(join(ROOT, d)));
    if (files.length === 0) continue;
    const e = new ESLint({
      overrideConfigFile: true, ignore: false,
      overrideConfig: [{
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
          parser: (await import("@typescript-eslint/parser")).default,
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        rules: {
          "max-lines-per-function": ["warn", { max, skipComments: true, skipBlankLines: true, IIFEs: true }],
        },
      }],
    });
    for (const r of await e.lintFiles(files))
      for (const m of r.messages)
        if (m.ruleId === "max-lines-per-function")
          lines.push(`  ${rel(r.filePath)}:${m.line} — ${m.message} (tendency ${max})`);
  }
  return lines;
}

function exemptionReport(): string[] {
  const dirs = [join(ROOT, "lib"), join(ROOT, "components"), join(ROOT, "app"), join(ROOT, "scripts")];
  const found: string[] = [];
  for (const file of dirs.flatMap((d) => sources(d)))
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const hit = /eslint-disable(?:-next-line)?\s+(max-lines[\w-]*)/.exec(line);
      if (hit) found.push(`  ${rel(file)}:${i + 1} — ${hit[1]}`);
    });
  return found;
}
```

`main`, which stays a list of steps and nothing more:

```ts
async function main() {
  const failures = [
    ["component folders", componentFoldersAreOwn()],
    ["test placement", testsSitBesideSubjects()],
    ["comment length", commentBlocksAreShort()],
    ["notes.md pointers", notesPointersResolve()],
  ] as const;

  for (const [label, list] of failures)
    if (list.length > 0) {
      console.log(`\n${label} — ${list.length} problem(s):`);
      for (const item of list) console.log(`  ${item}`);
    }

  const drift = await driftReport();
  console.log(`\nover the tendency — ${drift.length} function(s), reported, not failing:`);
  for (const line of drift) console.log(line);

  const exemptions = exemptionReport();
  console.log(`\nactive exemptions — ${exemptions.length}:`);
  for (const line of exemptions) console.log(line);

  const total = failures.reduce((n, [, list]) => n + list.length, 0);
  console.log(total === 0 ? "\nStructure OK." : `\n${total} structural problem(s).`);
  process.exit(total === 0 ? 0 : 1);
}

await main();
```

As written, `exemptionReport` scans `lib`, `components`, `app` and `scripts` — and `sources()`
excludes `*.test.ts(x)` by construction. `entry-editor.test.tsx` carries one of Task 5's four
exemptions, so this report shows **three** and silently omits the one attached to a test file.
Fix it here rather than later: give `exemptionReport` its own file list that includes test files,
and assert the count in the test, so "every active exemption" is true rather than nearly true.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/check-structure.test.ts`
Expected: PASS. If "passes on this repository" fails, the script found a real layout violation Tasks 3 and 4 left behind — fix the layout, not the script.

- [ ] **Step 5: Wire it into `package.json` and `CLAUDE.md` together**

`check:commands` compares CLAUDE.md's Commands block against `package.json` in **both** directions, so adding one without the other fails. Add to `package.json`:

```json
    "check:structure": "tsx scripts/check-structure.ts",
```

And to CLAUDE.md's Commands fence — the **one untagged fence** in that section; do not add a second, the check refuses to guess between them:

```
check:structure      # layout, comment length, notes.md pointers; reports length drift
```

Add it to the definition-of-done block in the same file, making nine unconditional commands, and update the surrounding prose that says eight.

- [ ] **Step 6: Both directions of the drift check**

```bash
npm run check:commands && npm run check:structure
```
Expected: both pass.

- [ ] **Step 7: Add the CI step**

In `.github/workflows/ci.yml`, after the `check:commands` step and matching its shape:

```yaml
      - name: Structure
        run: npm run check:structure
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "check:structure fails on layout and a dead notes pointer, and only reports drift"
```

---

### Task 7: The whole definition of done, read rather than assumed

Nine commands, in order, on Node 22, with a Pod up. Plus the gated e2e run, because this branch has touched `components/studio/**`, `lib/studio/**`, `app/(studio)/**` and `lib/pod/write.ts`.

**Files:** none. This task produces a record, not a diff.

- [ ] **Step 1: Confirm the runtime and start a Pod**

```bash
node -v          # must print v22.x
npm run pod:dev &
sleep 5
```

- [ ] **Step 2: Run all nine and read every result**

```bash
npm test && npm run lint && npm run typecheck && npm run validate:fixtures \
  && npm run check:vocab && npm run check:commands && npm run check:structure \
  && npm run build && npm run size:public
```

Record the actual test count, and that **skipped is 0**. A green `npm test` with skips is the half-check this repository has already shipped once.

- [ ] **Step 3: The gated e2e run**

```bash
npx playwright install chromium
npm run test:e2e
```
Expected: 6 passed.

- [ ] **Step 4: Write the results into `TODO.md`**

Under Phase 3, or a new short section if that reads better, record: what moved, the four exemptions and the stage that removes each, the nine results with real numbers, and the e2e result. Name anything that failed. A failure written down plainly is worth more than a green summary that is wrong.

- [ ] **Step 5: Commit**

```bash
git add TODO.md
git commit -m "Stage A is ticked, with the nine results and the four exemptions it leaves open"
```

---

## What Stage A does not do

`EntryEditor` is still 941 lines and its test still 6,514 — Stage B, on its own plan. The eleven
other long functions are untouched — Stage C, with the comment sweep, where the 18,999 comment
lines come down to under ~4,000 in code. Both exist as exemptions with named removal conditions
rather than as intentions, which is the point of doing enforcement before decomposition.

# Code Structure Conventions — Stage A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the code-structure conventions into `CLAUDE.md`, enforce them in lint and CI, and move the repository's files to the new layout — with zero change to behaviour.

**Architecture:** Documentation first, so the rules exist before anything is measured against them. Then the collection guard is widened, because moving a test file out from under a guard that only scans `test/` is this repository's named failure mode. Then the moves, mechanically, with the suite green and no test file edited for content. Then the two enforcement mechanisms: ESLint at the hard bounds, and a new `check:structure` script for layout, comment length and `notes.md` pointer resolution.

**Tech Stack:** Node 22.23.2, TypeScript, ESLint 9.39.5 flat config, Vitest, tsx for scripts.

**Spec:** `docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md`

## Global Constraints

- **Node 22.** Run `nvm use` then confirm `node -v` prints `v22.x` before anything. If `nvm` is absent: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. Every command in this plan passes on Node 20 too, which is why checking is a step you do rather than one the tooling does.
- **Zero behaviour change in this entire stage.** The invariant that proves it: **no test file is edited for content.** Import paths change; assertions, fixtures and test names do not. If a move requires an assertion change, the move changed behaviour — stop and report.
- **One carve-out from that, named in advance so nobody halts on it.** `test/vitest-collection.test.ts` asserts on test-file *paths* — `expect(onDisk).toContain("test/studio-shell.test.tsx")` is a control against the `.tsx` include being reverted. Task 3 moves that file, so that literal must change. It is a path, not a behaviour, and Task 3 Step 4a replaces it with a count so it cannot go stale again. No other assertion in any test file may be touched in Stage A.
- **Take the test count from HEAD, never from this plan.** Counts written into prose go stale — `vitest.config.ts` carried "282 tests" until the suite was 1024. Run `npm test` before you touch anything, and compare against that.
- **`npm run size:public` does not build.** It will silently grade a stale `.next`. Run `npm run build` first.
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
- Move: `test/studio-trip-loading.test.tsx` → `components/studio/studio-shell/studio-shell.trip-loading.test.tsx` — **renamed, and the rename is required.** Task 6's placement rule compares the base name before the first dot against a source file beside it; `studio-trip-loading.ts` does not exist, so the original name fails the check this very plan installs. The `studio-shell.` prefix is the same device Task 4 uses for `read.owner-profile.test.ts`, applied here rather than discovered in Task 6.
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
git mv test/studio-trip-loading.test.tsx   components/studio/studio-shell/studio-shell.trip-loading.test.tsx
```

`studio-shell.trip-loading.test.tsx` goes with `studio-shell` because that is its subject: it imports `StudioShell from "@/components/studio/studio-shell"` and its docblock names that file. Confirmed by survey before this plan was written.

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

- [ ] **Step 4a: Replace the collection guard's path literal with a count**

`test/vitest-collection.test.ts` has, as a control against the `.tsx` include being silently
reverted:

```ts
expect(onDisk).toContain("test/studio-shell.test.tsx");
```

Task 3 deletes that path. This is the one assertion edit Stage A permits (see Global
Constraints). Replace it with a count, so it protects the same thing without naming a file that
can move:

```ts
    // Control, by COUNT not by path. This named test/studio-shell.test.tsx until
    // it moved beside its subject on 2026-09-08; a path here goes stale on every
    // move, and the thing being guarded is "the .tsx include still matches
    // something", which a count says directly.
    expect(onDisk.filter((f) => f.endsWith(".test.tsx")).length).toBeGreaterThan(2);
```

Three `.tsx` test files exist after this task (`entry-editor`, `studio-shell`,
`studio-shell.trip-loading`), so `> 2` is satisfied and would fail if the include regressed.
**Do not simply delete the line** — the two remaining assertions are `.length > 10` and
`.length > 0`, and `> 0` is satisfied by any single `.tsx` file anywhere, which is weaker than
what this control was for.

- [ ] **Step 4b: Fix the one relative import in production code**

`components/studio/studio-client.tsx` has `dynamic(() => import("./studio-shell"), …)`. After the
move both files are in sibling folders, so that becomes `import("../studio-shell")` — or better,
`import("@/components/studio/studio-shell")`, matching how every other importer names it.
`typecheck` catches this either way; it is listed so the failure is expected rather than
confusing.

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

Twenty-six test files remain in `test/`. **Eighteen** have a single subject and colocate — the sixteen `lib/` moves plus `revalidate-route` and `studio-page`. The rest have no single subject and stay, two of them relocated into `test/integration/`.

**Files:**
- Move, each `test/<name>.test.ts` → beside its subject:
  `access.test.ts` → `lib/pod/access.test.ts`;
  `read.test.ts` → `lib/pod/read.test.ts`;
  `fuzz.test.ts` → `lib/pod/fuzz.test.ts`;
  `index-model.test.ts` → `lib/pod/index-model.test.ts`;
  `entry-write.test.ts` → `lib/pod/save-entry.test.ts`;
  `write-primitives.test.ts` → `lib/pod/write.test.ts`;
  `drafts.test.ts` → `lib/studio/drafts.test.ts`;
  `session.test.ts` → `lib/studio/session.test.ts`;
  `studio-trips.test.ts` → `lib/studio/trips.test.ts`;
  `owner-profile.test.ts` → `lib/pod/read.owner-profile.test.ts`;
  `cached-owner-profile.test.ts` → `lib/pod/cached.test.ts`;
  `privacy-settings.test.ts` → `lib/pod/read.privacy-settings.test.ts`;
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

- [ ] **Step 1: The subjects, already confirmed — read this instead of re-deriving it**

This survey was run before the plan was finalised, and it corrected three of the mappings. The
results, from each test file's own imports:

| Test file | Subject, as its imports name it | Moves to |
|---|---|---|
| `access` | `@/lib/pod/access` | `lib/pod/access.test.ts` |
| `read` | `@/lib/pod/read` | `lib/pod/read.test.ts` |
| `fuzz` | `@/lib/pod/fuzz` | `lib/pod/fuzz.test.ts` |
| `index-model` | `@/lib/pod/index-model` | `lib/pod/index-model.test.ts` |
| `write-primitives` | `putGuarded`, `listContainer`, `rebuildIndex` from `@/lib/pod/write` | `lib/pod/write.test.ts` |
| `entry-write` | **`saveEntry` (52 references), `serialiseEntry` (31)** | `lib/pod/save-entry.test.ts` |
| `drafts` | `@/lib/studio/drafts` | `lib/studio/drafts.test.ts` |
| `session` | `@/lib/studio/session` | `lib/studio/session.test.ts` |
| `studio-trips` | `@/lib/studio/trips` | `lib/studio/trips.test.ts` |
| `owner-profile` | **`import("@/lib/pod/read")`, dynamically** | `lib/pod/read.owner-profile.test.ts` |
| `privacy-settings` | **`import("@/lib/pod/read")`, dynamically** | `lib/pod/read.privacy-settings.test.ts` |
| `cached-owner-profile` | `import("@/lib/pod/cached")` | `lib/pod/cached.test.ts` |
| `media-exif` / `-pipeline` / `-targets` / `-upload` | the matching `@/lib/media/*` | `lib/media/<name>.test.ts` |
| `revalidate-route` | the route it exercises | `app/(public)/api/revalidate/route.test.ts` |
| `studio-page` | `import("@/app/(studio)/studio/page")` | `app/(studio)/studio/page.test.ts` |

**Three of these were wrong in an earlier draft and are the reason this table exists.**
`entry-write` was mapped to `entry-model.test.ts` on the strength of its name; its imports say
it is overwhelmingly a `saveEntry` test — the §10 write sequence — so it colocates with
`save-entry.ts`. `owner-profile` and `privacy-settings` have no module of their own at all: both
dynamically import `lib/pod/read.ts`, so they take the `read.` prefix, which keeps the base name
before the first dot matching `read.ts` and satisfies the placement rule in Task 6.

`lib/pod/entry-model.ts` is consequently left with no colocated test, and that is correct:
`serialiseEntry` is exercised inside the `saveEntry` suite. The placement rule is "a test has a
source beside it", never "a source has a test beside it".

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

Expected: **1026** passed / 2 todo / 0 skipped, across 30 files — the count at the end of Task 3, which added two barrel probes to the 1024 Task 2 left. Do not trust a count written in this plan over one you measured: re-run and compare against HEAD before you move anything. The collection guard now walks the whole repository, so a file that landed somewhere `include` does not cover fails here by name.

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
    expect(fatals(msgs)).toEqual([]);
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
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
  });

  it("limits a test FILE but never a test function body", async () => {
    const bigIt = `it("x", () => {\n${"  let x = 0;\n".repeat(300)}});\n`;
    const msgs = await lint("lib/pod/thing.test.ts", bigIt);
    expect(fatals(msgs)).toEqual([]);
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

**`fatals()` on every allow-case is not optional.** That helper exists in this very file with a
docblock saying why: a snippet ESLint cannot parse yields ONE message with `fatal: true` and
`ruleId: null` and no rule messages at all, so *every* `not.toContain` case would pass on a
snippet that was never linted. Six existing allow-cases already call it. The three new ones now
do too.

Two more cases, both pinning things Stage A depends on:

```ts
  it("honours a multi-line disable with a reason, which is the shape CLAUDE.md mandates", async () => {
    const exempted =
      `/* eslint-disable-next-line max-lines-per-function --\n` +
      `   reason on its own line, removal condition on another */\n` +
      `export function f() {\n${"  let x = 0;\n".repeat(90)}  return 1;\n}\n`;
    const msgs = await lint("lib/pod/thing.ts", exempted);
    expect(fatals(msgs)).toEqual([]);
    expect(ruleIds(msgs)).not.toContain("max-lines-per-function");
  });

  it("holds components/ui to the render bound, since the shadcn CLI rewrites that directory", async () => {
    const longUi = `export function C() {\n${"  let x = 0;\n".repeat(210)}  return null;\n}\n`;
    expect(ruleIds(await lint("components/ui/thing.tsx", longUi))).toContain("max-lines-per-function");
  });
```

The first matters because Step 6's four exemptions are the only thing between Step 7 and a red
`npm run lint`, and a multi-line `-- reason` directive is version-sensitive ESLint behaviour that
CLAUDE.md is about to mandate. Measured working on ESLint 9.39.5; pinned so an upgrade says so.

The second records a deliberate asymmetry: `components/ui/**` is exempt from the folder rule, the
comment rule and the arbitrary-Tailwind guardrail, but **not** from the 200-line render bound.
Largest file there today is 40 lines, so nothing is affected — but the shadcn CLI rewrites that
directory on update, and a vendored `sidebar.tsx` or `chart.tsx` could fail a bound on source the
project does not own. If that happens, the answer is an exemption with a reason, not a silent
widening.

- [ ] **Step 2: Run the probes and watch them fail**

Run: `npx vitest run test/guardrails.test.ts`
Expected: FAIL — **four** cases carry a `toContain` and all four fail, because the rule does not exist yet: the three "rejects" cases plus "holds lib tighter than a render at the very same length", whose first assertion is positive. The three "allows" cases pass vacuously, which is why they are not the whole test — and why Step 1 adds `fatals()` to each of them.

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
Expected: PASS, all seven new cases.

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
script as a child here — it defines a local `runCli` and builds fixture checkouts in `tmpdir()`.
There is no shared `runScript` helper; `test/child-output.ts` exports only `stripAnsi` and
`ONE_FAILED_TEST`.

**Copy `runCli`'s three details from that model rather than simplifying them**: `process.execPath`
with `["--import", "tsx", …]` (not `npx`, which costs a resolution per call and would make this
the slowest test file in the repo), an explicit `timeout`, and `if (result.error) throw result.error`
so a spawn failure arrives as the error it is rather than as `status: -1` and a confusing
exit-code assertion.

**And wrap `mkdtempSync` in `realpathSync`.** On macOS `mkdtempSync` returns `/var/…` while the
child resolves `/private/var/…`; `rel()` is `p.slice(ROOT.length + 1)`, so the mismatch silently
mangles every reported path. `check-commands.test.ts` already does this for the same reason.

That model also states the doctrine this file must follow, in its own words: an exit code "cannot
say WHICH guard fired". So every failing case asserts the offending **path appears in the
output**, not merely that the status was 1.

```ts
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
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
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/check-structure.ts", "--root", root],
    { cwd: ROOT, encoding: "utf8", timeout: 120_000 },
  );
  if (result.error) throw result.error;
  const stdout = stripAnsi(result.stdout ?? "");
  const stderr = stripAnsi(result.stderr ?? "");
  return {
    status: result.status ?? -1,
    stdout,
    transcript: `\n$ check-structure.ts --root ${root}\n[exit ${result.status}]\n${stdout}${stderr}`,
  };
}

/** The real repository, with no --root at all, so IS_REPO is true. */
function runRepo(): Run {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-structure.ts"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  const stdout = stripAnsi(result.stdout ?? "");
  return {
    status: result.status ?? -1,
    stdout,
    transcript: `\n$ check-structure.ts\n[exit ${result.status}]\n${stdout}`,
  };
}

/** A COMPLIANT fixture, so each case below breaks exactly one rule. */
function compliant(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "structure-")));
  created.push(root);
  mkdirSync(join(root, "components", "studio", "widget"), { recursive: true });
  mkdirSync(join(root, "components", "studio", "widget", "hooks"), { recursive: true });
  mkdirSync(join(root, "lib", "pod"), { recursive: true });
  mkdirSync(join(root, "test", "integration"), { recursive: true });
  const w = join(root, "components", "studio", "widget");
  writeFileSync(join(w, "widget.tsx"), "export const W = 1;\n");
  writeFileSync(join(w, "index.ts"), 'export * from "./widget";\n');
  writeFileSync(join(w, "hooks", "use-widget.ts"), "export const u = 1;\n");
  writeFileSync(join(root, "lib", "pod", "thing.ts"), "export const t = 1;\n");
  writeFileSync(join(root, "lib", "pod", "thing.test.ts"), 'import "./thing";\n');
  return root;
}

describe("check:structure, against this repository", () => {
  const run = runRepo();

  it("passes", () => {
    expect(run.status, run.transcript).toBe(0);
  });

  it("says how many files it scanned, so a moved directory cannot make it vacuous", () => {
    const scanned = Number(/scanned (\d+) files/.exec(run.stdout)?.[1] ?? 0);
    expect(scanned, run.transcript).toBeGreaterThan(50);
  });

  it("reports length drift with real content, not an empty header", () => {
    // Named function, real line number, real tendency. The earlier draft asserted
    // /tendency/i, which the header line satisfies at a count of zero — I neutered
    // driftReport to `return []` and that assertion still passed.
    expect(run.stdout, run.transcript).toMatch(/entry-editor\.tsx:\d+ .*\(tendency 130\)/);
    const count = Number(/over the tendency — (\d+) function/.exec(run.stdout)?.[1] ?? 0);
    expect(count, run.transcript).toBeGreaterThan(5);
  });

  it("lists all four exemptions by path, and exactly four", () => {
    expect(run.stdout, run.transcript).toMatch(/active exemptions — 4/);
    for (const path of [
      "entry-editor/entry-editor.tsx",
      "entry-editor/entry-editor.test.tsx",
      "lib/pod/entry-model.ts",
      "scripts/check-public-bundle.ts",
    ])
      expect(run.stdout, run.transcript).toContain(path);
  });

  it("reports the comment ratchet as a count, not as a failure", () => {
    expect(run.stdout, run.transcript).toMatch(/comment blocks over 6 lines \(ratchet, reported\)/);
    expect(run.status, "the ratchet must not fail at or below baseline").toBe(0);
  });
});

describe("check:structure, on fixtures that each break one rule", () => {
  it("accepts the compliant fixture, so every case below means something", () => {
    const run = runCli(compliant());
    expect(run.status, run.transcript).toBe(0);
  });

  it("accepts a flat hooks/ module without demanding a folder for it", () => {
    // Stage B puts ten plain modules inside state/ and hooks/. The folder rule
    // binds .tsx only; an earlier draft scanned .ts and would have failed all ten.
    const root = compliant();
    writeFileSync(
      join(root, "components", "studio", "widget", "hooks", "use-other.ts"),
      "export const o = 1;\n",
    );
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a component .tsx outside a folder of its own name", () => {
    const root = compliant();
    writeFileSync(join(root, "components", "studio", "loose.tsx"), "export const L = 1;\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("components/studio/loose.tsx");
  });

  it("fails on a component folder with no index.ts barrel", () => {
    const root = compliant();
    rmSync(join(root, "components", "studio", "widget", "index.ts"));
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("no index.ts barrel");
  });

  it("exempts components/ui from the folder rule", () => {
    const root = compliant();
    mkdirSync(join(root, "components", "ui"), { recursive: true });
    writeFileSync(join(root, "components", "ui", "button.tsx"), "export const B = 1;\n");
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a test with no source of the same base name beside it", () => {
    const root = compliant();
    writeFileSync(join(root, "test", "orphan.test.ts"), 'import "vitest";\n');
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("test/orphan.test.ts");
  });

  it("accepts a dotted stem whose first segment matches its subject", () => {
    // The rule Task 4 invented for read.owner-profile.test.ts, tested in the
    // direction that matters: the prefix must MATCH, not merely exist.
    const root = compliant();
    writeFileSync(join(root, "lib", "pod", "thing.extra.test.ts"), 'import "./thing";\n');
    expect(runCli(root).status).toBe(0);
  });

  it("fails on a dotted stem whose first segment matches nothing", () => {
    const root = compliant();
    writeFileSync(join(root, "lib", "pod", "absent.extra.test.ts"), 'import "vitest";\n');
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("absent.extra.test.ts");
  });

  it("skips test/integration/, which has no single subject by design", () => {
    const root = compliant();
    writeFileSync(join(root, "test", "integration", "pod.integration.test.ts"), 'import "vitest";\n');
    expect(runCli(root).status).toBe(0);
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

  it("fails on a pointer to a notes.md that does not exist", () => {
    const root = compliant();
    writeFileSync(
      join(root, "components", "studio", "widget", "widget.tsx"),
      "// see ./notes.md#anything\nexport const W = 1;\n",
    );
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    // NOT just "notes.md" — that substring is in other messages too.
    expect(run.stdout, run.transcript).toMatch(/points at \.\/notes\.md#anything, which does not exist/);
  });

  it("resolves an em-dash heading the way GitHub does", () => {
    // The house style in docs/data-model.md. `/\s+/g` collapses the two spaces
    // left by the removed dash and yields ONE hyphen; GitHub yields two.
    const root = compliant();
    const dir = join(root, "components", "studio", "widget");
    writeFileSync(
      join(dir, "widget.tsx"),
      "// see ./notes.md#rule-1--where-it-applies\nexport const W = 1;\n",
    );
    writeFileSync(join(dir, "notes.md"), "# widget\n\n## Rule 1 — where it applies\n\nprose\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(0);
  });

  it("finds a pointer inside a test file, which is where the stale citations were", () => {
    const root = compliant();
    writeFileSync(
      join(root, "lib", "pod", "thing.test.ts"),
      '// see ./notes.md#absent\nimport "./thing";\n',
    );
    writeFileSync(join(root, "lib", "pod", "notes.md"), "# thing\n\n## present\n");
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("#absent");
  });

  it("resolves a non-sibling pointer, which two real ones already are", () => {
    const root = compliant();
    mkdirSync(join(root, "lib", "pod", "support"), { recursive: true });
    writeFileSync(join(root, "lib", "pod", "support", "notes.md"), "# s\n\n## why\n");
    writeFileSync(join(root, "lib", "pod", "thing.ts"), "// see ./support/notes.md#why\nexport const t = 1;\n");
    expect(runCli(root).status).toBe(0);
  });

  it("counts a JSX comment block, which is the entry editor's house style", () => {
    // 17 false negatives were measured against a prefix scanner, every one in
    // entry-editor.tsx, because these lines begin with `{`.
    const root = compliant();
    const block = `export const W = () => (\n  <div>\n    {/*\n${"      prose\n".repeat(8)}    */}\n  </div>\n);\n`;
    writeFileSync(join(root, "components", "studio", "widget", "widget.tsx"), block);
    const run = runCli(root);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("widget.tsx");
  });

  it("does not count a comment-looking line inside a template literal", () => {
    const root = compliant();
    const lit = "export const md = `\n" + "* a markdown bullet\n".repeat(8) + "`;\n";
    writeFileSync(join(root, "lib", "pod", "thing.ts"), lit);
    expect(runCli(root).status).toBe(0);
  });

  it("allows a six-line block and fails a seven-line one, so the bound is a bound", () => {
    const six = compliant();
    writeFileSync(join(six, "lib", "pod", "thing.ts"), `${"// prose\n".repeat(6)}export const t = 1;\n`);
    expect(runCli(six).status, "six lines is at the bound, not over it").toBe(0);

    const seven = compliant();
    writeFileSync(join(seven, "lib", "pod", "thing.ts"), `${"// prose\n".repeat(7)}export const t = 1;\n`);
    const run = runCli(seven);
    expect(run.status, run.transcript).toBe(1);
    expect(run.stdout, run.transcript).toContain("lib/pod/thing.ts");
  });

  it("treats two blocks with no blank line between them as one run", () => {
    // Task 5 Step 6 inserts a 4-line disable directly above existing docblocks,
    // which is exactly this shape. Documented in CLAUDE.md; pinned here.
    const root = compliant();
    const merged = "/** a\n * b\n * c */\n/** d\n * e\n * f\n * g */\nexport const t = 1;\n";
    writeFileSync(join(root, "lib", "pod", "thing.ts"), merged);
    expect(runCli(root).status).toBe(1);
  });

  it("lets a blank line reset the run", () => {
    const root = compliant();
    const split = "/** a\n * b\n * c */\n\n/** d\n * e\n * f */\nexport const t = 1;\n";
    writeFileSync(join(root, "lib", "pod", "thing.ts"), split);
    expect(runCli(root).status).toBe(0);
  });
});
```

Twenty-two cases. The shape to preserve: **every rule has a positive case beside its negative
one** — `components/ui` exempted, a flat `hooks/` module accepted, a six-line block allowed, a
matching dotted stem accepted, `test/integration/` skipped, an em-dash anchor resolved, a
template literal not counted, a blank line resetting a run. An earlier draft had that claim in
its prose and four of seven rules actually covered; a rule tested only by what it rejects passes
just as well when it rejects everything.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run test/check-structure.test.ts`
Expected: FAIL — `Cannot find module scripts/check-structure.ts`.

- [ ] **Step 3: Write the script**

Create `scripts/check-structure.ts`. Every function stays under the 50-line tendency — this
script is the first thing that would be embarrassing to exempt. One function per rule, each
returning what it found, and a `main` that collects and prints.

```ts
/**
 * Layout, comment length and notes.md pointers — what ESLint cannot express.
 * FAILS on: a component .tsx outside its own folder, a misplaced test, an
 * unresolved `notes.md#anchor`, and a comment count above the ratchet.
 * REPORTS: functions over the tendency, test files over 600 lines, exemptions.
 * See CLAUDE.md "Code structure" for the numbers and why two tiers exist.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parse } from "@typescript-eslint/parser";
import { walkTestFiles } from "../test/support/walk";

const flag = process.argv.indexOf("--root");
const IS_REPO = flag === -1;
const ROOT = resolve(IS_REPO ? process.cwd() : process.argv[flag + 1]);
const rel = (p: string) => p.slice(ROOT.length + 1).split("\\").join("/");
const SKIP = ["node_modules", ".next", ".git", ".pod-data", "test-results", "coverage"];

/** Every .ts/.tsx under `dir`, tests included only when `withTests`. */
function files(dir: string, withTests: boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP.includes(e.name)) files(p, withTests, out);
    } else if (/\.tsx?$/.test(e.name)) {
      if (withTests || !/\.test\.tsx?$/.test(e.name)) out.push(p);
    }
  }
  return out;
}

const DIRS = ["components", "app", "lib", "scripts", "test"];
const sources = (withTests: boolean) => DIRS.flatMap((d) => files(join(ROOT, d), withTests));
```

**The comment counter uses the parser's comment ranges, not string prefixes.** A hand-rolled
version was measured against real comment tokens across all 59 scanned files: zero false
positives, but **17 false negatives, every one of them in `entry-editor.tsx`** — including a
47-line block — because that file's house style is the JSX form, whose lines begin with `{`:

```jsx
      {/*
        NAMED BY `title`, NOT BY `aria-label`, AND THAT IS LOAD-BEARING.
        … seven more prose lines …
      */}
```

None of `//`, `/*` or `*` matches that, so the span never opened. A prefix scanner would also
count a markdown bullet list inside a template literal as comment lines. Both problems disappear
with real tokens, so this is the shorter correct answer rather than a patched wrong one:

```ts
/** Runs of adjacent comment lines, as [path:line, lineCount]. */
function commentRuns(file: string): Array<[string, number]> {
  const ast = parse(readFileSync(file, "utf8"), { comment: true, loc: true, jsx: true });
  const runs: Array<[string, number]> = [];
  let first: number | null = null;
  let last = 0;
  for (const c of (ast.comments ?? []).sort((a, b) => a.loc.start.line - b.loc.start.line)) {
    if (first !== null && c.loc.start.line > last + 1) {
      runs.push([`${rel(file)}:${first}`, last - first + 1]);
      first = null;
    }
    if (first === null) first = c.loc.start.line;
    last = Math.max(last, c.loc.end.line);
  }
  if (first !== null) runs.push([`${rel(file)}:${first}`, last - first + 1]);
  return runs;
}

/**
 * The ratchet. **780** blocks over six lines across 88 scanned files, measured
 * at c1c5339 with the parser-based counter below —
 * and the sweep that fixes them is Stage C — so a flat failure would block
 * every merge on deferred work. Fails only when the count RISES. Lower this
 * number as the sweep proceeds; Stage C's last commit sets it to 0.
 *
 * MEASURE IT AGAIN BEFORE COMMITTING, and use what you measure. Two earlier
 * numbers were wrong and both are instructive: 262 came from a prefix scanner
 * over production code only, which missed every JSX-form block and never opened
 * a test file; and 779 was the parser's count one commit earlier, before Task 5
 * added a 14-line docblock to eslint.config.mjs. If your number differs from
 * 780 by more than the blocks your own diff adds, the SCAN changed rather than
 * the code — find out why before adjusting the number.
 */
const COMMENT_BASELINE = 780;

function commentsOverBound(): { over: string[]; verdict: string[] } {
  const over = sources(true)
    .filter((f) => !rel(f).startsWith("components/ui/"))
    .flatMap((f) => commentRuns(f).filter(([, n]) => n > 6).map(([at, n]) => `${at} — ${n} lines`));
  if (over.length > COMMENT_BASELINE)
    return { over, verdict: [`comment blocks over 6 lines ROSE to ${over.length}, baseline ${COMMENT_BASELINE}`] };
  const note =
    over.length < COMMENT_BASELINE
      ? `  ${over.length} now, baseline ${COMMENT_BASELINE} — lower COMMENT_BASELINE to ${over.length}`
      : `  ${over.length}, at the baseline`;
  return { over: [], verdict: [note] };
}
```

Rule 1, the folder layout. **`.tsx` only** — a component folder holds flat `state/` and `hooks/`
modules, and an earlier draft of this rule scanned `.ts` too, which would have hard-failed the
ten plain modules Stage B's own design puts inside those directories:

```ts
function componentFoldersAreOwn(): string[] {
  const bad: string[] = [];
  for (const file of files(join(ROOT, "components"), false)) {
    const path = rel(file);
    if (path.startsWith("components/ui/") || !path.endsWith(".tsx")) continue;
    const name = basename(file, ".tsx");
    if (name === "index") continue;
    if (basename(dirname(file)) !== name) bad.push(`${path} is not in a folder named "${name}"`);
    else if (!existsSync(join(dirname(file), "index.ts")))
      bad.push(`${path} has no index.ts barrel beside it`);
  }
  return bad;
}
```

Rule 2, test placement. **The allowlist-existence check runs only against the real repository** —
under a `--root` fixture none of the eight listed files exists, and an earlier draft pushed eight
failures on every fixture case, which silently broke the four cases that assert exit 0:

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
    if (!["ts", "tsx"].some((ext) => existsSync(join(dir, `${stem}.${ext}`))))
      bad.push(`${path} has no ${stem}.ts(x) beside it, and is not an allowed repo test`);
  }
  // Only on the real tree: a fixture root contains none of these by design.
  if (IS_REPO)
    for (const listed of REPO_TESTS)
      if (!existsSync(join(ROOT, listed)))
        bad.push(`REPO_TESTS names ${listed}, which does not exist`);
  return bad;
}
```

Rule 3, the pointers. **Scans test files too, and resolves non-sibling paths** — the file whose
stale citations are the reason this check exists is `entry-editor.test.tsx`, and a sibling-only
regex over non-test files could never open it:

```ts
/**
 * GitHub's heading slug: lowercase, drop punctuation, then hyphenate EACH
 * space. Per-character is load-bearing — `/\s+/g` collapses runs, so
 * "Rule 1 — where …" (a removed em dash leaving two spaces) slugs to
 * `rule-1-where-…` where GitHub gives `rule-1--where-…`. Em-dash headings are
 * the house style in docs/data-model.md, so the collapsed form both rejects
 * anchors copied from GitHub and accepts anchors GitHub cannot resolve.
 * Known limit: `[^\w\s-]` is ASCII, so a non-ASCII heading slugs differently
 * from GitHub. No heading in this repository has one.
 */
const slug = (heading: string) =>
  heading.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/ /g, "-");

function notesPointersResolve(): string[] {
  const bad: string[] = [];
  for (const file of sources(true)) {
    for (const [, path, anchor] of readFileSync(file, "utf8")
      .matchAll(/([\w./-]*notes\.md)#([\w-]+)/g)) {
      const notes = path.startsWith(".") ? join(dirname(file), path) : join(ROOT, path);
      if (!existsSync(notes)) {
        bad.push(`${rel(file)} points at ${path}#${anchor}, which does not exist`);
        continue;
      }
      const anchors = [...readFileSync(notes, "utf8").matchAll(/^#{1,6}\s+(.+)$/gm)]
        .map((m) => slug(m[1]));
      if (!anchors.includes(anchor))
        bad.push(`${rel(file)} points at #${anchor}, absent from ${rel(notes)} (has: ${anchors.join(", ")})`);
    }
  }
  return bad;
}
```

The two reports. `driftReport` **passes `cwd: ROOT`** — without it ESLint's basePath is the
repository, an out-of-basePath file returns exactly one `ruleId: null` message reading "File
ignored because outside of base path", and the filter drops it, so the whole report silently
prints zero under any fixture:

```ts
async function driftReport(): Promise<string[]> {
  const { ESLint } = await import("eslint");
  const parser = (await import("@typescript-eslint/parser")).default;
  const lines: string[] = [];
  for (const [dirs, max] of [[["components", "app"], 130], [["lib", "scripts"], 50]] as const) {
    const list = dirs.flatMap((d) => files(join(ROOT, d), false));
    if (list.length === 0) continue;
    const e = new ESLint({
      cwd: ROOT, // WITHOUT THIS THE REPORT IS ALWAYS EMPTY under --root.
      overrideConfigFile: true, ignore: false,
      overrideConfig: [{
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        rules: {
          "max-lines-per-function": ["warn", { max, skipComments: true, skipBlankLines: true, IIFEs: true }],
        },
      }],
    });
    for (const r of await e.lintFiles(list))
      for (const m of r.messages)
        if (m.ruleId === "max-lines-per-function")
          lines.push(`  ${rel(r.filePath)}:${m.line} — ${m.message} (tendency ${max})`);
  }
  return lines;
}

/**
 * Includes test files: one of the four Stage A exemptions is on a test file.
 *
 * THE COMMENT MUST START THE LINE. Task 5's guardrail probe contains the
 * string `eslint-disable-next-line max-lines-per-function` inside a template
 * literal, and a looser regex counts that fixture as a fifth live exemption —
 * the report would name a test snippet as suppressing a rule.
 */
function exemptionReport(): string[] {
  const found: string[] = [];
  for (const file of sources(true))
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const hit = /^\s*(?:\/\*|\/\/)\s*eslint-disable(?:-next-line)?\s+(max-lines[\w-]*)/.exec(line);
      if (hit) found.push(`  ${rel(file)}:${i + 1} — ${hit[1]}`);
    });
  return found;
}
```

`main`. Note the **scanned-file control**: without it, renaming `components/` makes every rule
pass with "Structure OK." The two files this script imitates both carry one —
`vitest-collection.test.ts` asserts `files.length > 10`, `check-commands.test.ts` asserts
`LIST.length === 12` — and an earlier draft of this script carried neither:

```ts
async function main() {
  const scanned = sources(true).length;
  console.log(`scanned ${scanned} files under ${DIRS.join(", ")}`);
  if (IS_REPO && scanned < 50) {
    console.log(`\nonly ${scanned} files scanned — a directory moved, and every rule below is vacuous.`);
    process.exit(1);
  }

  const comments = commentsOverBound();
  const failures = [
    ["component folders", componentFoldersAreOwn()],
    ["test placement", testsSitBesideSubjects()],
    ["notes.md pointers", notesPointersResolve()],
    ["comment ratchet", comments.over],
  ] as const;

  for (const [label, list] of failures)
    if (list.length > 0) {
      console.log(`\n${label} — ${list.length} problem(s):`);
      for (const item of list.slice(0, 40)) console.log(`  ${item}`);
    }

  console.log("\ncomment blocks over 6 lines (ratchet, reported):");
  for (const line of comments.verdict) console.log(line);

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

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run test/check-structure.test.ts`
Expected: PASS. If "passes on this repository" fails, read *which* rule failed before touching anything:

- **component folders** or **test placement** — a real violation Tasks 3 and 4 left behind. Fix the layout, not the script.
- **notes.md pointers** — a pointer written this stage is wrong, or `slug()` disagrees with the heading. Fix whichever is actually wrong; do not loosen the matcher to make a bad anchor pass.
- **comment ratchet** — the count rose above `COMMENT_BASELINE`. Something in this stage *added* a long comment block. That is the ratchet working; shorten the block. Do **not** raise the baseline, which is the one move that makes the ratchet meaningless.

The earlier draft of this step said only "the script found a real layout violation … fix the layout, not the script", which was wrong advice for three of the four rules — the comment rule had 779 pre-existing violations and no layout fix at all.

**Where those 779 are, because it decides how big Stage C is:**

| | blocks over 6 lines |
|---|---|
| `test/entry-editor.test.tsx` | 207 |
| `components/studio/entry-editor.tsx` | 115 |
| the other 69 files | 457 |

**Test files are 60% of the total, and that is a question Stage C has to answer rather than
assume.** A test's docblock explaining which defect it catches is arguably prose that belongs
exactly where it is, unlike a 47-line essay in a render function. CLAUDE.md's comment rule
currently says "everywhere except `components/ui/**`", so as written it binds tests too. Raise it
with the maintainer when Stage C is planned; the ratchet means nothing is blocked either way, and
207 of them are in a file Stage B splits regardless.

- [ ] **Step 5: Wire it into `package.json` and `CLAUDE.md` together**

`check:commands` compares CLAUDE.md's Commands block against `package.json` in **both** directions, so adding one without the other fails. Add to `package.json`:

```json
    "check:structure": "tsx scripts/check-structure.ts",
```

And to CLAUDE.md's Commands fence — the **one untagged fence** in that section; do not add a second, the check refuses to guess between them:

```
check:structure      # layout, comment length, notes.md pointers; reports length drift
```

Add it to the definition-of-done block in the same file, making **nine** unconditional commands.
Two prose lines in `CLAUDE.md` then need updating, and two others must be left strictly alone:

| Line | Currently | Becomes |
|---|---|---|
| ~150 | "**A ninth command**, path-scoped rather than unconditional" — the `test:e2e` gate | "**A tenth command**, path-scoped rather than unconditional" |
| ~183 | "The **eight** run anywhere with a checkout and Node 22" | "The **nine** run anywhere with a checkout and Node 22" |

**Do NOT touch lines ~179 and ~463.** Both read "a jsdom `Blob` arrives at MSW as the **nine
bytes** of the string `"undefined"`". That is a measurement taken on 2026-09-06, and the word
"nine" there counts bytes, not commands. A global replace of `eight`→`nine` or `ninth`→`tenth`
corrupts a recorded fact into nonsense. Edit both lines by hand, verify with:

```bash
grep -nE '\b(eight|nine|ninth|tenth)\b' CLAUDE.md
```

Expected after the edit: line ~150 says "tenth", line ~183 says "nine ... run anywhere", and the
two "nine bytes" lines are unchanged.

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

**Not chained with `&&`.** A chain aborts at the first failure, so one red step hides the eight
answers you came for — and `build` and `size:public` are last, which is where a refactor's real
damage would show. Run them all, collect the statuses, then read:

```bash
for c in test lint typecheck validate:fixtures check:vocab check:commands check:structure build size:public; do
  if [ "$c" = "test" ]; then npm test > "/tmp/dod-$c.log" 2>&1; else npm run "$c" > "/tmp/dod-$c.log" 2>&1; fi
  printf '%-20s %s\n' "$c" "$([ $? -eq 0 ] && echo PASS || echo FAIL)"
done
```

Then read each log rather than trusting the table — in particular:

- `npm test`: the real counts, and that **skipped is 0**. Vitest 4 prints no `skipped` line at
  zero, which reads too much like a pass by omission, so confirm the two integration suites
  actually ran: `grep -c 'pod-.*integration' /tmp/dod-test.log`. A green `npm test` with skips is
  the half-check this repository has already shipped once.
- `check:structure`: the `scanned N files` line, the ratchet count, and `active exemptions — 4`.
- `size:public`: the actual kB against the 190 budget, and that every studio-only dependency is
  still absent.

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

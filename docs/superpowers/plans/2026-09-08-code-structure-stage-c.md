# Code Structure Stage C — The Long Functions and the Comment Sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the eleven remaining over-tendency functions down, drive the production comment ratchet from 279 to zero, and remove the last two ESLint exemptions — so the conventions hold everywhere they are meant to hold and nothing is suppressed.

**Architecture:** The comment rule is split first, because Stage C cannot be scoped until it is: the maintainer decided on 2026-09-08 that the conventions bind **production code and not test docblocks**, and `check:structure` currently ratchets one combined number. Then the functions come down in dependency order — the `lib/pod` serialisers and parsers, where the §10 clause boundaries and resource shapes give real seams — and the comment sweep follows per directory, because a swept file is easier to shorten than a shortened file is to sweep.

**Tech Stack:** Node 22.23.2, TypeScript, Vitest, ESLint 9 flat config, `@typescript-eslint/parser` for comment ranges.

**Spec:** `docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md` — §2 is the comment policy, §6 the long functions, §7 the enforcement tiers.

## Global Constraints

- **Node 22.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`, then `node -v` must print `v22.x`.
- **Take every count from HEAD, never from this plan.** At `0b2d99e`: `npm test` **1332 passed / 2 todo / 0 skipped / 60 files**; ratchet **788** combined (279 production, 509 test); **14** functions over tendency; **2** exemptions.
- **`npm run pod:dev &` before `npm test`.** Prove the integration suites ran rather than skipped: `npx vitest run test/integration/` → 33 passed, and `TEST_POD=http://localhost:3999 npx vitest run test/integration/` → 33 skipped. A green run without that control is not evidence.
- **`npm run size:public` does not build.** `npm run build` first.
- **e2e when the diff touches the gated globs**, which most of this stage does: `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`, 6 expected. The `E2E_PORT` is because a `next dev` holds 3000 and `reuseExistingServer: false` makes Playwright refuse rather than reuse.
- **`npm run lint` carries `--max-warnings 0`** with `reportUnusedDisableDirectives` active. When a shortened function drops under its bound, its `eslint-disable` becomes an unused directive and **fails the build**. Delete it in the same commit — that is the designed signal, and it is how both remaining exemptions leave.
- **Prose is moved, not deleted.** This repository's comments record measurements: which fixture could not reach which branch, what was tried and found false. A block over the bound goes to a sibling `notes.md` behind an anchor `check:structure` resolves, with a one-line pointer left behind. Compressing while moving is right; discarding a finding is not.
- **Behaviour does not change in this stage.** Splitting a function is not an invitation to fix it. Anything that looks wrong gets written down and left; that is a separate commit with its own test.
- The `dy:` namespace is still `https://example.org/ns/traveldiary#`. Nothing here writes to a live Pod.

## The fourteen, measured at `0b2d99e`

Three are over the **render** tendency of 130 and under the 200 bound; eleven are over the **lib/scripts** tendency of 50, two of them over the 80 bound and carrying the last exemptions.

| Function | lines | File | Task |
|---|---|---|---|
| `serialiseEntry` | **111** | `lib/pod/entry-model.ts` | 2 — has an exemption |
| `main` | **94** | `scripts/check-public-bundle.ts` | 5 — has an exemption |
| `setContainerAccess` | 73 | `lib/pod/access.ts` | 4 |
| `saveEntry` | 69 | `lib/pod/save-entry.ts` | 3 |
| `readTripIndexWithEtag` | 64 | `lib/pod/read.ts` | 3 |
| `setDocumentPublicRead` | 59 | `lib/pod/access.ts` | 4 |
| `main` | 59 | `scripts/validate-fixtures.ts` | 5 |
| `serialiseIndex` | 57 | `lib/pod/index-model.ts` | 2 |
| (arrow) | 55 | `lib/pod/read.ts:300` | 3 |
| `verifyContainerAccess` | 54 | `lib/pod/access.ts` | 4 |
| `readEntry` | 52 | `lib/pod/read.ts` | 3 |
| `EntryEditor` | 195 | `components/studio/entry-editor/entry-editor.tsx` | 7, and may stay |
| `WhereFields` | 161 | `…/fields/where-fields/where-fields.tsx` | 7, and may stay |
| `useEntryDraft` | 142 | `…/hooks/use-entry-draft.ts` | 7, and may stay |

---

### Task 1: Split the ratchet, and write the test exemption down

Stage C cannot be scoped while `check:structure` ratchets one number. The maintainer's decision, 2026-09-08: **the comment conventions bind production code; test docblocks are exempt.** The reasoning belongs in `CLAUDE.md`, because the next session will otherwise read the exemption as an oversight.

**Files:**
- Modify: `scripts/check-structure.ts` — two ratchets in place of one
- Modify: `test/check-structure.test.ts` — the cases for both
- Modify: `CLAUDE.md` — the comment rule's scope and why

**Interfaces:**
- Produces: `PROD_COMMENT_BASELINE` (0 is the goal, 279 today) and `TEST_COMMENT_BASELINE` (509, frozen). Tasks 2–6 lower the first; nothing raises either.

- [ ] **Step 1: Write the failing cases first**

In `test/check-structure.test.ts`, against the fixture root and the repository:

```ts
  it("reports the two comment ratchets separately", () => {
    const run = runRepo();
    expect(run.stdout, run.transcript).toMatch(/production comment blocks over 6 lines/);
    expect(run.stdout, run.transcript).toMatch(/test comment blocks over 6 lines/);
  });

  it("fails when the PRODUCTION count rises, and not when a test file's does", () => {
    // fixture: one 8-line block in lib/pod/thing.ts → exit 1
    // fixture: one 8-line block in lib/pod/thing.test.ts → exit 0
  });
```

Write both fixture cases out in full, following the existing `compliant()` helper. The second is the one that matters: it is the whole decision, and a rule tested only by what it rejects passes just as well when it rejects everything.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run test/check-structure.test.ts
```

Expected: the two new cases fail; the existing ones still pass.

- [ ] **Step 3: Split the counter**

`commentsOverBound()` currently partitions nothing. Partition on the same predicate the placement rule already understands — a `*.test.ts(x)` file, anything under `test/`, and the editor harness — and carry two baselines with two verdicts. Keep the existing behaviour for the production half exactly: fail on a rise, print the lower number to paste when it falls.

- [ ] **Step 4: Write the decision into `CLAUDE.md`**

In `## Code structure`, replace the comment rule's scope line and the ratchet paragraph:

```markdown
**The comment bound binds production code. Test docblocks are exempt**, decided 2026-09-08 after
measuring: 509 of the 788 over-bound blocks were in test files, and the two real defects this
project has found — the deleted map pin and the timestamp that happened nowhere — were both found
*because* a test docblock recorded which fixture could reach which branch. A docblock saying what
a case catches is prose sitting where it belongs; a 47-line essay inside a render function is not.

Both halves are still ratcheted, for different reasons. The production count fails when it rises
and is being driven to zero by Stage C. The test count is frozen at its measured value and fails
when it rises, so "exempt" means "not rewritten", never "unbounded".
```

- [ ] **Step 5: Verify, then commit**

```bash
npx vitest run test/check-structure.test.ts && npm run check:structure
npm test && npm run lint && npm run typecheck && npm run check:commands
```

`check:structure` must print both numbers and exit 0.

```bash
git add -A
git commit -m "The comment bound binds production code, and the ratchet splits to say so"
```

---

### Task 2: The two serialisers, and the first exemption leaves

`serialiseEntry` (111 lines, over the 80 bound, exempted) and `serialiseIndex` (57).

**The seam is §7.3's and §7.4's normative fragment subjects, not §10.** An earlier draft of this
task said §10 and that was wrong: §10 is the write protocol — PUT with `If-None-Match`, set ACL,
read/insert/recompute the index, revalidate — which is `saveEntry`'s sequence in Task 3. A pure
serialiser implements no §10 clause. The subjects are §7.3's five (`<#it>`, `<#place>`,
`<#address>`, `<#geo>`, `<#photo-n>`) plus §7.4's two and the derived half §7.4 names separately.
One function per normative subject.

**Files:** `lib/pod/entry-model.ts`, `lib/pod/index-model.ts`, their colocated tests (`lib/pod/save-entry.test.ts` holds the `serialiseEntry` cases — 52 references to `saveEntry`, 31 to `serialiseEntry`), plus `lib/pod/notes.md`

- [x] **Step 1: Read §7.3 and §7.4 of `docs/data-model.md` first** (§10 is Task 3's, not this task's)

The split must follow the normative clause boundaries, not convenience. Every IRI comes from
`lib/vocab.ts` — `no-restricted-syntax` enforces that and will tell you if a helper reintroduces a
literal. Datatypes are explicit: `xsd:date`, `xsd:dateTime` **with UTC offset**, `xsd:decimal` for
coordinates (never float), `xsd:integer` for counts. Human-readable literals are language-tagged.

- [ ] **Step 2: Write the failing tests for the new helpers**

Each extracted clause gets a direct test before it exists. **Compare RDF by graph isomorphism, never
bytes** — `test/graph.ts` has `graphEquals` and `triples`; Turtle has no canonical form and a
byte-comparison test is permanently red.

- [ ] **Step 3: Extract, verbatim per clause**

No behaviour change. If a clause looks wrong against §10, write it down and leave it.

- [ ] **Step 4: The exemption must now fail as unused**

```bash
npm run lint
```

Expected: **FAIL** with `Unused eslint-disable directive` on `lib/pod/entry-model.ts`, because
`serialiseEntry` is under 80. Delete the directive, re-run, and amend
`test/check-structure.test.ts`'s exemption count from two to one — it parses the
`active exemptions — N:` block, so it will go red on the change, which is it working.

- [ ] **Step 5: Full checks and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run validate:fixtures && npm run check:vocab && npm run check:structure && npm run build && npm run size:public
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
git commit -am "The entry serialiser splits at the clause boundaries it already walks"
```

---

### Task 3: `lib/pod/read.ts` and `saveEntry`

Four functions: `readEntry` (52), `readTripIndexWithEtag` (64), an unnamed arrow at `:300` (55), and
`saveEntry` (69). The parsers split per resource shape; `saveEntry` splits along §10's write
sequence.

**Files:** `lib/pod/read.ts`, `lib/pod/save-entry.ts`, `lib/pod/read.test.ts`, `lib/pod/read.owner-profile.test.ts`, `lib/pod/read.privacy-settings.test.ts`, `lib/pod/save-entry.test.ts`

- [ ] **Step 1: The arrow at `:300` gets a name before it gets a split**

An anonymous 55-line arrow inside `readTripIndexWithEtag` cannot be cited, tested directly, or
reported usefully — `check:structure` calls it "Arrow function". Name it first, in its own commit,
and confirm the drift line changes from `Arrow function` to the name. That alone is a readability
win and makes the rest of the task legible.

- [ ] **Step 2: Failing tests for each extracted parser**

`lib/pod/read.ts` is **unauthenticated and shared** — it is the only `lib/pod` module the public
path may import. Nothing extracted from it may import `lib/pod/write.ts` or `lib/pod/access.ts`;
`no-restricted-imports` enforces the access boundary and `size:public` is the real check. Validate
on read: every read returns a typed object or a structured error through Zod, and
`dy:schemaVersion` is checked on every top-level read. Do not let a split drop that check.

- [ ] **Step 3: Extract; then `saveEntry` along §10**

`saveEntry`'s sequence carries the preconditions — `If-None-Match: *` to create, `If-Match: <etag>`
to update. **A blind PUT is a bug**, so every extracted step must still carry its precondition, and
`lib/pod/save-entry.test.ts` already pins the six §10 outcomes.

- [ ] **Step 4: Full checks and commit, one commit per function**

Four functions, four commits, checks between each.

---

### Task 4: `lib/pod/access.ts`

Three functions: `setContainerAccess` (73), `setDocumentPublicRead` (59), `verifyContainerAccess`
(54).

**They do NOT split per mechanism.** `docs/decisions.md` §19 is "Access control goes through one
interface, and never branches on mechanism": the implementation "is the universal API rather than a
WAC branch and an ACP branch" because "the mechanism is not reliably detectable from headers, which
is precisely why the abstraction exists". An earlier draft of the spec proposed the ACP/WAC split
citing §4 — which is "No drafts container" — and that was a re-litigation of a settled decision.

**The axis actually present is document versus container.** `setDocumentPublicRead` goes through
`universalAccess`; `setContainerAccess` hand-rolls ACL because `universalAccess` cannot express
`acl:default` without `acl:accessTo`. Split per resource kind, keep the one interface.

**Files:** `lib/pod/access.ts`, `lib/pod/access.test.ts`, `test/integration/pod-access.integration.test.ts`, `lib/pod/notes.md`

- [ ] **Step 1: Read `docs/decisions.md` §19 and the ACP memory before writing anything**

- [ ] **Step 2: Failing tests, then extract**

`lib/pod/access.ts` is the one file exempt from `no-restricted-imports` — everything else reaches
access control only through it, and that boundary must survive the split. Anything extracted stays
inside this module or is imported only by it.

`rebuildIndex` implements four of §10's five clauses and has no ACL verification, marked `it.todo`;
it needs the `write.ts` ↔ `access.ts` import cycle broken first. **Not this task.** Do not
accidentally close or delete that todo.

- [ ] **Step 3: The integration suite is the real check here**

```bash
npm run pod:dev &
npx vitest run test/integration/
TEST_POD=http://localhost:3999 npx vitest run test/integration/
```

33 passed, then 33 skipped. Access control against a real Community Solid Server is the only thing
that exercises the ACL path end to end.

- [ ] **Step 4: Full checks and commit, one per function**

---

### Task 5: The two scripts, and the last exemption leaves

`scripts/check-public-bundle.ts :: main` (94, over the 80 bound, exempted) and
`scripts/validate-fixtures.ts :: main` (59). Both split into the steps they already print progress
for, which is the seam their own output describes.

**Files:** the two scripts, `test/public-bundle.test.ts`, `test/public-bundle-cli.test.ts`, `test/check-structure.test.ts`, `scripts/notes.md`

- [ ] **Step 1: `check-public-bundle.ts` is the enforcement that really holds — treat it as such**

`CLAUDE.md` names the public bundle budget as the real public/studio enforcement. A refactor that
quietly weakened it would remove the only thing standing between a studio dependency and a public
route. `test/public-bundle.test.ts` and `test/public-bundle-cli.test.ts` are 1,086 code lines
between them and exist for this; read them before touching the script.

**Prove the split did not weaken it**, by more than a green run: after extracting, temporarily add a
fenced import (say `@inrupt/solid-client-authn-browser`) to a public page, rebuild, and confirm
`size:public` **fails** and names the dependency. Then revert. A budget that cannot be made to fail
is not a budget.

- [ ] **Step 2: Failing tests for each extracted step, then extract**

- [ ] **Step 3: The last exemption goes**

```bash
npm run lint
```

Expected: **FAIL**, `Unused eslint-disable directive` on `scripts/check-public-bundle.ts`. Delete
it, and amend `test/check-structure.test.ts` to expect **zero** exemptions —
`active exemptions — 0:` — which is the first time in this refactor that nothing is suppressed.

- [ ] **Step 4: Full checks and commit**

---

### Task 6: The production comment sweep, per directory

279 blocks over six lines, in production code, going to zero. Per directory, one commit each, so a
reviewer can read the prose that moved rather than a 279-block diff. Worst first:

| Directory | blocks |
|---|---|
| `components/studio/entry-editor/` (component, hooks, state, fields) | ~75 |
| `lib/pod/` | ~55 |
| `lib/studio/` | ~35 |
| `components/studio/studio-shell/`, `studio-client/` | ~20 |
| `scripts/` | ~20 |
| `lib/media/`, `app/`, the rest | remainder |

- [ ] **Step 1: For each directory — move, do not delete**

A block over six lines goes to the sibling `notes.md` under a heading, and the code keeps
`// <one line>; see ./notes.md#anchor`. Compress while moving. `check:structure` fails on an anchor
that does not resolve, so **write the `notes.md` heading before the pointer** — Task 5 of Stage B
hit that twice, including once red in its own suite.

Two mechanics worth knowing, both measured during Stage B:

- Delimiter lines count toward the bound, so a `/** … */` block's real budget is **four** lines of
  prose.
- Two blocks with no blank line between them are **one run**. A blank line resets it. So splitting a
  long docblock in place, with a blank line, is a legitimate fix where the prose genuinely belongs
  at that spot — the `vitest.config.ts` trap-warning exception in `CLAUDE.md` exists for exactly
  that case.

- [ ] **Step 2: Lower the baseline in the same commit**

`PROD_COMMENT_BASELINE` drops to the measured number each time. `check:structure` prints the value
to paste when the count falls. **Never raise it**, and never lower it without the sweep that earns
it.

- [ ] **Step 3: After each directory, the full checks**

The sweep touches `components/studio/**` and `lib/studio/**`, so e2e runs every time.

- [ ] **Step 4: The last commit sets the production baseline to 0**

At zero, change the production half from a ratchet to a hard bound: fail on any block over six
lines, with no baseline. Update `CLAUDE.md`'s ratchet paragraph to say the production half is now
absolute and only the test half is ratcheted.

---

### Task 7: The three render functions, decided rather than forced

`EntryEditor` (195), `WhereFields` (161), `useEntryDraft` (142) are over the 130 tendency and under
the 200 bound. They are drift lines, not failures.

**This task may legitimately conclude that all three stay.** The tendency is a tendency; the
maintainer said the numbers are "tend to", not a dictate, and readability is the goal the numbers
proxy for. Forcing a function under 130 by moving code somewhere it does not belong makes the
codebase worse while making the report shorter.

- [ ] **Step 1: Read each and decide, in writing**

Stage B already named one real candidate: the unsaved-draft banner inside `EntryEditor` is ~32 code
lines and shares `HOLD_REASON_ID` with the Save button, exactly as `OCCURRED_SOURCE_ID` is shared
with the when-fields group. By Task 5-of-Stage-B's own argument that is a sixth presentational
group. It was left out because an unasked-for extraction inside the commit that removed an exemption
is how a reviewable diff stops being one — the reason was timing, not merit.

`WhereFields` was left at 161 because splitting separates the coordinate boxes from the note that
names them. `useEntryDraft` is 142 because of a seventeen-field payload and a sixteen-value
dependency array kept value-for-value rather than keyed on reducer-state identity — the shorter
spelling is equivalent only by an argument about React's batching, and `applyPhotoTimestamp` returns
a new object even when both branches refuse.

For each: extract, or write the reason it stays into the nearest `notes.md`. Both are acceptable
outcomes; an undocumented decision is not.

- [ ] **Step 2: If you extract, one commit each, test first**

- [ ] **Step 3: Full checks**

---

### Task 8: The stage and the refactor close

- [ ] **Step 1: Nothing is suppressed and nothing is over a bound**

```bash
npm run check:structure
```

Expected: `active exemptions — 0`, the production comment count absolute at zero, and the drift list
holding only functions Task 7 decided to keep with a written reason.

- [ ] **Step 2: All nine, unchained, and read every log**

```bash
npm run pod:dev & sleep 5
for c in test lint typecheck validate:fixtures check:vocab check:commands check:structure build size:public; do
  if [ "$c" = "test" ]; then npm test > "/tmp/c-$c.log" 2>&1; else npm run "$c" > "/tmp/c-$c.log" 2>&1; fi
  printf '%-20s %s\n' "$c" "$([ $? -eq 0 ] && echo PASS || echo FAIL)"
done
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
npx vitest run test/integration/                                    # 33 passed
TEST_POD=http://localhost:3999 npx vitest run test/integration/     # 33 skipped
```

- [ ] **Step 3: Write it up in `TODO.md` and tick Stage C**

Record: the final drift list with the reason each survivor survives, both ratchet numbers, that
exemptions are zero, the test total, and anything left undone. Name what failed.

- [ ] **Step 4: The refactor is done — say what is now true that was not**

The three stages together are one deliverable. In `TODO.md`, one short paragraph: what a reader can
now rely on (a component per folder, a test beside its subject, prose behind a checked anchor, two
bounds enforced by a build and nothing suppressed), and what is still open — the ~500 test-file
comment blocks that are exempt rather than swept, `OFFSET_SHAPE`'s unpinned width, the missing
"exact" precision option that needs a §9 decision, and the fifteen phase-3 follow-ups.

Then phase 4.

## What Stage C does not do

No behaviour changes. `rebuildIndex`'s missing ACL verification stays `it.todo` and still needs the
`write.ts` ↔ `access.ts` cycle broken. `OFFSET_SHAPE`'s width stays unpinned. The "exact" precision
option stays absent — it needs a §9 decision, because `GeoPoint.precisionMeters` is `.positive()`
and its own docblock argues against 0. Test docblocks are exempt from the comment bound by decision,
not by omission, and their ratchet stays frozen. The fifteen phase-3 follow-ups in `TODO.md` are
untouched.

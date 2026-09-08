# Code structure conventions, and the refactor that brings the repository to them

Design, 2026-09-08. Approved in conversation before phase 4 opened.

## Why

The maintainer's report was "you tend to make really enormous files, for instance
`components/studio/entry-editor.tsx` is more than 3k lines", plus "comments are way too
verbose". Measured across the 101 `.ts`/`.tsx` files in `app/`, `components/`, `lib/`, `e2e/`,
`scripts/` and `test/`, both halves are true but not in the shape the file sizes suggest:

- **23,771 code lines against 18,999 comment lines.** Comments are **44% of every non-blank
  line in the repository**. `lib/studio/drafts.ts` is 84% comment: 345 comment lines carrying
  65 lines of code. This, and not code, is what makes most files here look enormous.
- **Function length is already almost compliant.** Measured by ESLint's own
  `max-lines-per-function` with `skipComments` and `skipBlankLines` — the tool that will enforce
  it, rather than a counter of this document's own — **twelve** production functions exceed the
  tendencies below and **three** exceed the hard bounds.
- **`EntryEditor` is a genuine monolith** — 941 code lines in one function, 2,790 lines
  including its prose, 27 `useState`, 10 `useRef`, and ~990 lines of JSX in a single `return`.
  Its test file is 13,354 lines, 6,514 of them code.
- **Layout**: `components/studio/` is flat, and 29 test files sit in `test/` away from their
  subjects.

**Readability is the goal. The numbers are a proxy for it and are written as tendencies, not
dictates** — the maintainer's words. Section 7 says what that means for enforcement, which is
the only place the distinction can be got wrong.

## The twelve, and the three that actually block

Counted by ESLint, which is the authority here because it is the enforcement. An earlier draft
of this spec used a hand-rolled counter and reported nine; it over-counted `EntryEditor` by a
third and missed three functions in `lib/pod/read.ts` entirely. The numbers below are the tool's.

| Function | code lines | File |
|---|---|---|
| `EntryEditor` | **941** | `components/studio/entry-editor.tsx` |
| `serialiseEntry` | **111** | `lib/pod/entry-model.ts` |
| `main` | **94** | `scripts/check-public-bundle.ts` |
| `setContainerAccess` | 73 | `lib/pod/access.ts` |
| `saveEntry` | 69 | `lib/pod/save-entry.ts` |
| (read.ts, line 292) | 64 | `lib/pod/read.ts` |
| `setDocumentPublicRead` | 59 | `lib/pod/access.ts` |
| `main` | 59 | `scripts/validate-fixtures.ts` |
| `serialiseIndex` | 57 | `lib/pod/index-model.ts` |
| (read.ts, line 300) | 55 | `lib/pod/read.ts` |
| `verifyContainerAccess` | 54 | `lib/pod/access.ts` |
| (read.ts, line 215) | 52 | `lib/pod/read.ts` |

The three in bold are the only ones over the hard bounds, so they are the only ones that need a
documented exemption when enforcement lands ahead of the work that fixes them. Test files add a
fourth: `test/entry-editor.test.tsx` at 6,514 code lines against a 1000-line ceiling. Three test
files exceed the 600-line tendency — that one plus `pod-access.integration.test.ts` (870) and
`entry-write.test.ts` (811).

Near misses worth knowing, because they will cross on their next edit: `save` inside
`EntryEditor`, `rebuildIndex` (48) and `createPipeline` (44).

## 1. The conventions

| Rule | Tendency | Hard bound | Applies to |
|---|---|---|---|
| Render function | 130 code lines | 200 | `components/**`, `app/**` |
| Util / lib function | 50 code lines | 80 | `lib/**`, `scripts/**` |
| Inline comment block | 3 lines | 6 | everywhere except `components/ui/**` |
| Test function | none | none | — |
| Test file | 600 code lines | 1000 | `**/*.test.{ts,tsx}` |

"Code lines" excludes comment-only lines and blank lines everywhere in this table. That is what
makes the maintainer's rule countable: a 200-line function with 120 lines of prose in it is a
80-line function, and the prose is section 2's problem rather than this one's.

Test function bodies carry **no** length limit, by decision. A scenario test reads better whole
than shredded into helpers whose names hide the arrangement; the file ceiling is what keeps test
files navigable.

## 2. Comments, and `notes.md`

**In code, a comment says what the code cannot.** Three lines is the tendency. Anything longer
moves to a sibling `notes.md`, and the code keeps a pointer:

```ts
// First writer wins; see ./notes.md#first-writer-wins
```

`notes.md`, not `README.md`: README promises "how to use this", notes promises "why it is like
this", and the second is what this repository's prose actually is.

**Notes cite `docs/data-model.md` by section number rather than restating it.** That file stays
the single normative source; a note that paraphrases a normative rule is a second opinion
waiting to drift.

**One exception, deliberately.** Where a comment is a trap warning *at the point of danger* —
`vitest.config.ts`'s "`.tsx` IS LOAD-BEARING", which exists because 31 kB of test file once went
silently uncollected — one shouted line plus a pointer stays inline. A cross-reference is worse
than a shout for something the reader must not walk past, and a 12-line docblock is worse than
both because it gets skimmed.

**Nothing is deleted without being read.** The prose in this repository records measurements:
which fixture could not reach which branch, why a memo is synchronous, what was tried and found
false. Stage C moves it and compresses it while moving. The target is under ~4,000 comment lines
in code, down from 18,999, with the survivors in `notes.md` files.

## 3. Folder and file layout

One component, one folder:

```
components/studio/entry-editor/
  entry-editor.tsx          the component, named
  index.ts                  one-line re-export
  entry-editor.test.tsx
  notes.md
```

**Named file plus a one-line `index.ts`.** A tab bar of twelve `index.tsx` files is the opposite
of readable, and stack traces that all say `index.tsx` are worse; the barrel keeps import paths
short. The cost is one trivial file per component, paid knowingly.

**The `components/ui` directory is exempt and stays flat.** It is shadcn's copied source, the CLI rewrites
it flat on update, and it is already exempt from the arbitrary-Tailwind guardrail. Restructuring
vendored source means redoing it on every update.

**Where extracted helpers go.** `lib/**` holds no React. A helper pulled out of a component is
domain logic and goes to `lib/studio/<topic>/` if it is pure and reusable — the offset
arithmetic and `placeFor` are wanted by phase 4's timeline — and stays in the component folder
if it is presentation. The public/studio lint boundary is defined in terms of `lib/`, so this
split keeps that boundary meaningful.

## 4. Tests live next to their subject

`vitest.config.ts` already collects `lib/**/*.test.{ts,tsx}`, so half of this is wired.

A test with a single subject colocates with it. Three kinds do not, and stay in `test/`:

| Stays | Why |
|---|---|
| `test/setup.ts`, `msw.ts`, `graph.ts`, `network-guard.ts`, `child-output.ts`, `fixtures/` | shared harness, no subject |
| `test/integration/pod-{read,access}.integration.test.ts` | no single module under test; they need a running Pod |
| `test/guardrails.test.ts`, `check-commands.test.ts`, `check-structure.test.ts`, `public-bundle*.test.ts`, `vitest-collection.test.ts`, `network-guard.test.ts` | the subject is the repository, not a module |

## 5. `EntryEditor`: the target shape

Hooks per concern, presentational field groups, and **a reducer for the interdependent core**.

```
components/studio/entry-editor/
  entry-editor.tsx              composition and layout, ~120 lines
  index.ts  notes.md
  state/
    actions.ts                  the action union: the catalogue of legal transitions
    entry-form-reducer.ts       a thin switch
    apply-field-edit.ts         + .test.ts
    apply-photo-offer.ts        + .test.ts   first-writer-wins and credit, atomically
    apply-restore.ts            + .test.ts
    notes.md
  hooks/
    use-entry-form.ts           the useReducer wrapper the field groups consume
    use-entry-save.ts  use-entry-draft.ts  use-settings-gate.ts  use-photo-pipeline.ts
  fields/
    identity-fields/  when-fields/  where-fields/  photo-fields/  classification-fields/
  field/                        the shared <Field> wrapper, CONTROL and BUTTON tokens
```

### Why a reducer, and for exactly which state

**An earlier draft of this section argued the wrong thing, and the code says so in writing.**
It claimed the three ref/state pairs — `coordinateAuthor`/`coordinateSource`,
`occurredAuthor`/`occurredSource`, `offsetAuthor`/`offsetSource` — were "two stores of one truth,
kept in step by hand at every call site". Measured: there is **exactly one writer per pair**.
`creditCoordinate` assigns both members at `entry-editor.tsx:1428-1429` and nothing else touches
either; `creditTime` assigns all four at `:1519-1522`. The file's own docblock at `:1409` makes
the counter-argument, and makes it well:

> THEY CANNOT DRIFT, BECAUSE THERE IS ONE WRITER … This file argues against two things that have
> to agree and say nothing when they stop — the offset chain, the precision select — and the
> argument holds here: what makes this pair safe is not that it is small, it is that neither
> member has a setter of its own.

That is right, and the defect this spec pointed at is a different thing entirely. `TODO.md`
records it as one truth split across **two independently credited halves**: photo A supplied the
wall clock, photo B's offset was accepted beside it, and the composite published an instant that
happened nowhere. A reducer does not fix that by construction — the cross-half guard is still
needed, and it already exists, spelled `(offsetTo.kind !== "photo" || offsetTo.key === key)` at
`entry-editor.tsx:1998-2001`.

So the reducer is justified on three narrower grounds, none of which is "collapse the shadow":

1. **`restore(draft)` is one action instead of thirteen setters plus a credit call.** That is the
   real ordering hazard, at `entry-editor.tsx:2534-2690`.
2. **The rules become pure functions with their own tests.** First-writer-wins per half, and the
   cross-half guard, are today reachable only through a jsdom render and `fireEvent`.
3. **The transition becomes the only place a value and its credit can be set**, which is what the
   single-writer discipline achieves today by convention and a docblock asking the next reader to
   preserve it.

**In (20 of 27 `useState`, and 3 of 10 refs):** the 15 form fields — `tripIri`, `slug`,
`headline`, `story`, `occurred`, `offset`, `tagsText`, `mode`, `status`, `lat`, `long`,
`precision`, `placeName`, `locality`, `country` — plus `slots`, plus the four credit values
`coordinateSource`, `occurredSource`, `offsetSource`, `offsetGuess`.

The state shape is not invented: `Draft` in `lib/studio/drafts.ts` is a Zod object of exactly
those 15 fields plus `photos` and `savedAt` (verified 2026-09-08), and `sameText` — which lives
in `entry-editor.tsx`, not in `drafts.ts` — already compares them as one value over
`Omit<Draft, "savedAt">`.

**Out, staying `useState` inside their own hooks (7):** `target`, `provenance`, `outcome` and
`saving` in `use-entry-save.ts`; `gate` in `use-settings-gate.ts`; `offered` and
`storageRefused` in `use-entry-draft.ts`. A dispatch table buys nothing for a boolean one call
site flips, and pretending otherwise is ceremony.

### The constraint Stage B must honour, and the test that has to come first

**This is the highest-risk part of the entire refactor, and the three refs are load-bearing
across an `await`.**

`offerTimestamp` reads `occurredAuthor.current` and `offsetAuthor.current` **synchronously** at
`entry-editor.tsx:1988-1989`, inside `attach`'s continuation — after a decode and two PUTs. The
picker is `multiple` and starts every file at once: `for (const file of picked) void attach(file)`
at `:3722`. `lib/media/pipeline.ts` serialises the *decodes* (`queue = result.catch(…)`, one
worker, one photo), but photo 2's continuation resumes as a microtask, and React batches updates
across those. What makes first-writer-wins correct today is precisely that photo 1 has already
assigned the ref before photo 2 reads it — no re-render required.

**A reducer preserves that only if the first-writer-wins decision lives INSIDE the transition.**
If Stage B reads `state.occurredAuthor` from the hook's returned value and dispatches a plain
set, two photos settling in one render cycle both see `nobody`, both fill, and the
instant-that-happened-nowhere defect is republished — by the commit that was supposed to make it
harder.

**The existing tests cannot tell the two implementations apart.** `pickAndSettle` picks one file
and awaits both PUTs and the rendered `<img>`; the sections that exercise two photos call it
twice in sequence, so React has fully re-rendered in between. No test in the 6,514 lines picks
two files in one `change` event.

Therefore Stage B's **first** commit is a failing test that dispatches two photo offers with no
intervening flush, and the guard-inside-the-transition is a stated constraint on the design
rather than a property hoped for. This paragraph exists so that an implementer told to "extract
hooks" cannot satisfy the brief and lose the invariant.

### What this buys beyond line count

The first-writer-wins and credit rules become **pure functions with their own tests**. Today
they are reachable only through a jsdom render and `fireEvent`, which is why the two defects
above needed a whole-branch review to find. `apply-photo-offer.test.ts` tests them in
milliseconds. Some of the 13,354-line test file therefore *shrinks* rather than merely splitting.

### The three approaches considered

- **Field groups with state left lifted** — safe and mechanical, but the parent keeps all 27
  `useState` and lands near 700 lines. Rejected: misses the point.
- **Hooks plus a reducer for the core** — chosen.
- **One reducer for everything, plus context** — rewrites every transition at once against 6,514
  lines of tests, and broad context re-render in a form is a known regression shape. Rejected as
  the highest risk for the least additional readability.

## 6. The other eleven

`serialiseEntry` (111), `serialiseIndex` (57) and `saveEntry` (69) split along the §10 clause
boundaries they already implement in sequence. The three unnamed spans in `lib/pod/read.ts` (64,
55, 52) are parse functions and split per resource shape. The two `main` functions in `scripts/`
split into the steps they already print progress for.

**The three in `lib/pod/access.ts` do NOT split per mechanism.** An earlier draft said they
should, citing `docs/decisions.md` §4 — which is "No drafts container" and has nothing to do with
access control. The section that governs here is **§19, "Access control goes through one
interface, and never branches on mechanism"**, which states the implementation "is the universal
API rather than a WAC branch and an ACP branch" because "the mechanism is not reliably detectable
from headers, which is precisely why the abstraction exists". A per-mechanism split is the one
refactor this repository has already ruled out in writing, and proposing it re-litigated a
settled decision.

The axis actually present is **document versus container**: `setDocumentPublicRead` goes through
`universalAccess`, while `setContainerAccess` hand-rolls ACL because `universalAccess` cannot
express `acl:default` without `acl:accessTo`. Stage C splits along that, per resource kind, and
keeps the single interface §19 requires.

The reducer's own top-level switch is expected to exceed 50 lines and is not made to fit by
compression: the per-transition `apply-*.ts` files are each well under it, and the switch is a
catalogue. This is the first place the "tendency, not dictate" doctrine is exercised, so it is
recorded here rather than argued again later.

## 7. Enforcement

A convention in a document is advisory. This repository's own doctrine, in the header docblock of
`eslint.config.mjs`, is that "an agent can rationalise past a lint rule but not past a failing
build" and that "the size-limit budget on public routes is the enforcement that really holds";
the maintainer asked for these conventions enforced. But the numbers are tendencies, so
enforcement is two-tier — **and an earlier draft of this section put the wrong rule in each
tier.**

It had ESLint hard-failing the comment bound and `check:structure` merely reporting function
length. Measured against the current tree, that is exactly inverted:

- The comment bound finds **262 violations across 38 files** today (98 in `entry-editor.tsx`
  alone). The sweep that fixes them is Stage C, by this document's own §8. So the hard-failing
  tier would have blocked every merge in Stages A and B on work deliberately deferred.
- Function length finds **twelve**, and ESLint already hard-fails **three** of them. So the
  reporting tier covered the one thing a build already enforced.

Corrected:

- **ESLint errors at the hard bound.** `max-lines-per-function` with `skipComments` and
  `skipBlankLines`, 200 for `components/**` and `app/**`, 80 for `lib/**` and `scripts/**`;
  `max-lines` at 1000 for test files. CI fails only on a genuine monolith. `npm run lint` also
  gains `--max-warnings 0`, so a stale `eslint-disable` left behind by Stage B fails the build
  instead of printing a severity-1 warning nobody sees. Measured 2026-09-08: the repository has
  zero warnings today, so the flag costs nothing to add.
- **The comment bound is a ratchet, not a report.** `check:structure` stores the current count
  and **fails when it rises**. That is the only form of "report" the doctrine above concedes
  cannot be rationalised past: it is a failing build. The number can only go down; Stage C drives
  it to zero and the ratchet becomes a hard zero in the same commit.
- **`check:structure` fails outright on layout and pointers**, where there is no backlog to
  ratchet against: a component outside its own folder, a test not placed by the rule below, and
  **a `see ./notes.md#anchor` that does not resolve to a real heading.**
- **It reports function-length drift** — every function over 130/50 and every test file over 600
  — beside the ESLint bound rather than instead of it.

Test placement is a rule with no judgement in it: **a `*.test.ts(x)` file must sit in the same
directory as a source file whose base name matches the part before the first dot** —
`use-entry-form.test.ts` beside `use-entry-form.ts`, `read.owner-profile.test.ts` beside
`read.ts` — **or be named in the repository-test allowlist**, which is the table in section 4. A
test whose subject was renamed or deleted fails the check rather than drifting into an orphan.

**The pointer check does not, on its own, close the TODO item it was written for.** That item is
the line-number citations in `test/entry-editor.test.tsx`, which went stale twice in one stage —
once by 76 lines, once by 57, the second time *within a single fix round*, because the production
commit landed after the test commit. Rewriting them as symbol and anchor references is what
closes it. Keeping it closed requires the check to actually scan the file, and a naive
implementation excludes `*.test.ts(x)` and matches only sibling `./notes.md#` — which would
never open that file at all. The check therefore scans test files too, and resolves any relative
`notes.md` path rather than siblings only. Stated here because the earlier draft claimed the
closure outright and the check as first written could not have delivered it.

Each rule arrives test-first through `test/guardrails.test.ts`, the way the existing guardrails
did.

## 8. Sequencing

**Stage A — conventions, enforcement, and the moves. Zero logic change.**
`CLAUDE.md` and `AGENTS.md` first, so the rules exist before anything is measured against them.
Then the lint rules and `check:structure`, test-first. Then `git mv` with import rewrites.
*Invariant: the full suite stays green with no test file edited for content.* A test that needed
its assertions changed by a move means the move changed behaviour.

**Stage B — `EntryEditor`.** The test file splits along its own numbered sections (0 through 11,
already cleanly marked) first. Then helpers out — they are already top-level, so this is near
zero risk. Then field groups, props only. Then the hooks and the reducer, which is the only step
with behavioural risk and goes last, test-first, with the pure `apply-*` tests written before the
reducer they describe. Suite green between every step.

**Stage C — the other eleven functions, and the comment sweep.** 18,999 comment lines down to
under ~4,000 in code, the remainder trimmed into `notes.md` files.

## 9. Four traps, named now

1. **`test/vitest-collection.test.ts` scans `test/` top level only.** Move tests out from under
   it and it keeps passing while guarding an empty directory — a green run that verifies nothing,
   this repository's named failure mode, which that very file exists to prevent. It is widened to
   a repository-wide scan **in the same commit as the first move**.
2. **`CLAUDE.md`'s e2e diff-gate globs are literal paths** — `lib/studio/**`, `app/(studio)/**`,
   `components/studio/**`, `app/(public)/client-id.jsonld/**`, `lib/media/**`, `lib/pod/write.ts`.
   Every path this refactor moves is rewritten there in the same commit, or the gate silently
   stops matching the files it was written to catch, including the EXIF/GPS pass-through hole it
   was widened for on 2026-09-06.
3. **`npm run size:public` is re-measured at every stage boundary.** More, smaller modules change
   what tree-shakes; the budget is the real public/studio enforcement and a refactor is exactly
   the kind of change that moves it quietly.
4. **`test/guardrails.test.ts` hands ESLint virtual filenames** such as
   `components/studio/entry-editor.tsx`. They do not break when the file moves, because no file is
   read — which is why they must be updated deliberately, so the probes keep describing paths that
   exist.

## 10. Definition of done

`check:structure` joins the list in `CLAUDE.md`, making it nine unconditional commands. The
path-scoped `test:e2e` gate stays scoped, with its globs rewritten per trap 2.

## 11. Out of scope

No behaviour changes, no new features, no phase 4 work, and no re-litigating the stack. The
`dy:` namespace blocker is untouched: this refactor writes nothing to any Pod.

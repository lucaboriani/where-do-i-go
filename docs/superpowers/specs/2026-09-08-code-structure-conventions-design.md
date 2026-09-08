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
| `test/guardrails.test.ts`, `check-commands.test.ts`, `public-bundle*.test.ts`, `vitest-collection.test.ts` | the subject is the repository, not a module |

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

Not tidiness. **Three of the ten refs shadow three of the state values** —
`coordinateAuthor`/`coordinateSource`, `occurredAuthor`/`occurredSource`,
`offsetAuthor`/`offsetSource` — one store for the callback path, one for the render path, kept in
step by hand at every call site:

```ts
function creditCoordinate(to: CoordinateAuthor) {
  coordinateAuthor.current = to;                                   // for callbacks
  setCoordinateSource(to.kind === "photo" ? to.name : null);       // for render
}
```

Two stores of one truth, updated by convention, is the shape of the defect this stage already
found and wrote up: *two photos could compose a timestamp that happened nowhere* — one photo's
wall clock beside another's offset, published as a real instant. A reducer makes "set the value
**and** record who supplied it" a single transition, and first-writer-wins a guard inside it
rather than a rule each caller must remember.

**In (20 of 27 `useState`, and 3 of 10 refs):** the 15 form fields — `tripIri`, `slug`,
`headline`, `story`, `occurred`, `offset`, `tagsText`, `mode`, `status`, `lat`, `long`,
`precision`, `placeName`, `locality`, `country` — plus `slots`, plus the four credit values
`coordinateSource`, `occurredSource`, `offsetSource`, `offsetGuess`.

The state shape is not invented: `Draft` in `lib/studio/drafts.ts` is already a Zod object of
exactly those form fields, with `sameText` already comparing them as one value. `restore(draft)`
becomes one action instead of fifteen setters.

**Out, staying `useState` inside their own hooks (7):** `target`, `provenance`, `outcome` and
`saving` in `use-entry-save.ts`; `gate` in `use-settings-gate.ts`; `offered` and
`storageRefused` in `use-entry-draft.ts`. A dispatch table buys nothing for a boolean one call
site flips, and pretending otherwise is ceremony.

**`useState` granularity inside the reducer is preserved in behaviour, not collapsed in
semantics.** Fields keep updating independently; what changes is that a transition touching two
of them is one dispatch. No `useState` is merged into an object outside the reducer, because
that changes batching and this file's tests assert on render behaviour.

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
55, 52) are parse functions and split per resource shape. The three in `lib/pod/access.ts` split
into a per-mechanism helper each — the ACP/WAC split that `docs/decisions.md` §4 already describes. The
two `main` functions in `scripts/` split into the steps they already print progress for.

The reducer's own top-level switch is expected to exceed 50 lines and is not made to fit by
compression: the per-transition `apply-*.ts` files are each well under it, and the switch is a
catalogue. This is the first place the "tendency, not dictate" doctrine is exercised, so it is
recorded here rather than argued again later.

## 7. Enforcement

A convention in a document is advisory. This repository's own doctrine, in the header docblock of
`eslint.config.mjs`, is that "an agent can rationalise past a lint rule but not past a failing
build" and that "the size-limit budget on public routes is the enforcement that really holds";
the maintainer asked for these conventions enforced. But the numbers are tendencies,
so enforcement is two-tier:

- **ESLint errors at the hard bound.** `max-lines-per-function` with `skipComments` and
  `skipBlankLines`, 200 for `components/**` and `app/**`, 80 for `lib/**` and `scripts/**`;
  `max-lines` at 1000 for test files. CI fails only on a genuine monolith.
- **`check:structure` reports the tendency and fails on layout.** It prints every function over
  130/50, every comment block over 3 lines, and every test file over 600 lines — as a drift list,
  not a failure. It *fails* on: a component outside its own folder, a comment block over 6
  lines, and **a `see ./notes.md#anchor` pointer that does not resolve to a real heading.** It
  fails on test placement by a rule with no judgement in it: **a `*.test.ts(x)` file must sit in
  the same directory as a source file of the same base name** — `use-entry-form.test.ts` beside
  `use-entry-form.ts` — **or be named in the repository-test allowlist** the script carries, which
  is exactly the table in section 4. A test whose subject was renamed or deleted therefore fails
  the check rather than drifting into an orphan.

The drift list is printed by a command that is in the definition of done, so it is seen on every
full check rather than filed somewhere nobody reads.

**The pointer check closes an open TODO item outright.** `test/entry-editor.test.tsx`'s docblocks
cite line numbers that went stale twice in one stage — once by 76 lines, once by 57, and the
second time *within a single fix round*, because the production commit landed after the test
commit. Symbol and anchor references replace them, and the check keeps them true.

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

**Stage C — the other eight functions, and the comment sweep.** 18,999 comment lines down to
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

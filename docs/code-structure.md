# Code structure

The rules are in `CLAUDE.md` `## Code structure`. **This file is why**, and it is where the
measurements live. The design is
`docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md`; the three
implementation plans sit beside it.

Asked for on 2026-09-08, between phases 3 and 4, after `components/studio/entry-editor.tsx`
passed 3,000 lines. The maintainer's framing, which outranks every number below: **"readability
is a must"**, and the limits are **"meant to be *tend to*, not a dictate"**.

## Why two tiers

ESLint errors at the hard bound. `check:structure` reports the tendency and fails on none of it.

A lint rule cannot express "tend to" — it either errors or it does not. So the outer bound
errors, and the tendency is printed by a command in the definition of done: seen on every full
check, blocking only a genuine monolith. **Do not tighten the lint rules to the tendency
values.** That would turn an instruction into its opposite.

The tiers were the other way round in the first draft, and it took a measurement to see it. The
hard-failing tier was the comment bound, which had 788 pre-existing violations whose fix was
deferred to Stage C; the reporting tier was function length, which a build already failed three
of. The failing tier would have blocked every merge in Stages A and B on deferred work.

## Why the numbers exclude comments

This repository ran **44% comment lines** — 18,999 against 23,771 of code. A 200-line span here
is routinely an 80-line function, so counting raw lines would measure prose volume, not code.

That is also why the first estimate was wrong. A hand-rolled counter reported nine long functions
and `EntryEditor` at 1,275 lines; ESLint with `skipComments` reported twelve and **941** — the
counter over-counted by a third and missed three spans in `lib/pod/read.ts` entirely. **When a
rule will be enforced by a tool, that tool's count is the only number worth quoting.**

The same error recurred one stage later in the other direction: the plan predicted `EntryEditor`
would fall under 200 once its five field groups were out, on the strength of "~990 lines of JSX".
That span was two-thirds comment, so the groups took ~308 code lines and the component stood at
633. It reached 195 only after the hooks and the reducer.

## The comment bound binds production code

Of the 788 blocks over six lines, **509 were in test files and the editor harness**. The two real
defects this project has found — a photo attached inside the home region deleting the entry's
published map pin, and two photos composing a timestamp that happened nowhere — were both found
*because* a test docblock recorded which fixture could reach which branch.

A docblock saying what a case catches is prose where it belongs. A 47-line essay inside a render
function is not.

**Both halves are ratcheted**, so "exempt" means *not rewritten*, never *unbounded*. Production
was 279 at the split and goes to zero; test is frozen at 509. When production reaches zero its
half becomes a hard zero.

The partition has three clauses and the third is load-bearing: a `*.test.ts(x)` file, anything
under `test/`, **and the editor harness** — 54 blocks, and not a `*.test.tsx`. Without it the
split reads 333/455 and the number Stage C drives to zero has a 54-block hole.

The allowance is this repository's own debt, so it applies only here. Against any other tree the
bound is a flat six on both sides.

### Three counts of one thing, two of them wrong

- **262** — a line-prefix scanner over production code only. Never opened a test file, and could
  not see the JSX `{/* … */}` form, whose lines begin with `{`. Against real comment tokens: zero
  false positives, **17 false negatives, every one in `entry-editor.tsx`**, including a 47-line
  block.
- **780** — a parser scan that died on the two `lib/pod` files whose generic arrows
  (`export const ok = <T>(value: T) => …`) are unparseable with `jsx: true` on a `.ts` file.
  Eight blocks went missing with them.
- **788** — the parser with `jsx` following the extension. Probes in
  `scripts/notes.md#the-comment-ratchet`.

### Counting mechanics that surprise people

**Delimiter lines count**, so a `/** … */` block's real budget is four lines of prose. **Two
blocks with no blank line between them are one run**; a blank line resets it — so splitting a
long docblock in place, with a blank line, is a legitimate fix where the prose belongs there.

`check:structure` reads real comment tokens, so `notes.md#…` inside a string literal is fixture
text rather than a citation. Both directions measured — `scripts/notes.md#tokens-not-prefixes`.

## Why `notes.md`, and why the anchor is checked

README promises "how to use this"; notes promises "why it is like this", and the second is what
the prose here actually is.

The anchor check exists because of a specific rot: `entry-editor`'s test docblocks cited line
numbers and went stale **twice in one stage** — once by 76 lines, once by 57, the second time
*within a single fix round*, because the production commit landed after the test commit. A
citation that decays whenever the file it points into grows is a maintenance tax that reads as
fact.

`slug()` matches GitHub's heading algorithm, and getting that wrong is worse than not checking.
An early version collapsed whitespace with `/\s+/g`; GitHub replaces **each** space, so a removed
em dash leaves two spaces and two hyphens. Em-dash headings are the house style throughout
`docs/data-model.md`, so the collapsed form would have *rejected* anchors copied from GitHub and
*accepted* anchors GitHub cannot resolve. Known limit: `[^\w\s-]` is ASCII. No heading here is.

**One exception to moving prose out.** Where a comment is a trap warning **at the point of
danger** — `vitest.config.ts`'s "`.tsx` IS LOAD-BEARING", which exists because 31 kB of test file
once went silently uncollected — one shouted line plus a pointer stays inline. A cross-reference
is worse than a shout for something the reader must not walk past, and a long docblock is worse
than both, because it gets skimmed.

## Why a named file plus a barrel

A tab bar of twelve `index.tsx` files is the opposite of readable, and stack traces that all say
`index.tsx` are worse. The barrel keeps imports short. One trivial file per component, paid
knowingly.

**The rule binds `.tsx` — components — not the `.ts` files beside them.** A component folder may
hold a flat `state/` module without it earning a directory. Giving a five-line reducer helper its
own folder is the reductio, and a rule demanding it would be weakened under deadline rather than
followed. The first draft of the check scanned `.ts` too and would have hard-failed the ten
modules the reducer design puts in `state/` and `hooks/` — the check would have banned the
refactor it was written to enable.

## Why hooks live at the root, not in the component folder

Until 2026-09-12 hooks were colocated: `components/studio/entry-editor/hooks/` held five,
`components/public/trip-map/hooks/` three. That is what this section prescribed, and it is not a
Next.js convention — Next is unopinionated outside `app/`, and its own project-structure guide
says the naming of `components`, `lib` and `hooks` "has no special framework significance".

Two things decided the move. `trip-map`'s three hooks are map machinery rather than that
component's private business — stage 5's globe wants `useMapInstance` — and a hooks folder nested
under one component is the wrong home for something two components share. And the nesting
buys nothing at three files: `entry-editor`'s eleven earn a directory, `trip-map`'s six do not.

**`hooks/<area>/`, not a flat `hooks/`, because the public/studio wall is written in paths.**
`eslint.config.mjs` bans `components/studio/**` from `app/(public)/**` and `components/public/**`.
The five studio hooks import `lib/studio/session`, `lib/pod/write` and `lib/media/*` — `@inrupt/*`
transitively — so a flat root `hooks/` would have taken them out from behind that ban and left the
fence a hand-typed list of five filenames, which is the shape this file already records as having
failed. `hooks/studio/**` keeps the same mechanism, bare directory and subpath both.

**What a new root directory goes invisible to, measured before the move rather than after —
and, for each, whether the blindness shows up red or green:**

| Check | Why it went blind | How it failed |
|---|---|---|
| `eslint.config.mjs` bounds | 200 lines for `components/**`+`app/**`, 80 for `lib/**`+`scripts/**`; `hooks/**` matched neither, so the bound disappeared rather than tightening | **open** |
| `scripts/check-structure.ts` | `DIRS` and the tendency pairs name directories one by one | **open** |
| the belt block | `hooks/map/**` is reachable from a public page and was fenced by nothing; the closure walk that would have said so was itself scoped to `lib/**` | **open** |
| `vitest.config.ts` include | `test/ lib/ components/ app/` matches no `hooks/` file, so eight test files stop being collected | red |
| the `setProjection` scan | `git grep -- lib components app` finds nothing at the new path | red |

**Three fail open, and the two that fail red are the interesting ones.** Neither is red by luck:
`test/vitest-collection.test.ts` diffs the whole repository against `vitest list` rather than
walking a directory list, and `git grep` exits 1 on no match, which `execFileSync` turns into a
throw. Both were built by someone who assumed the file tree would move. Measured on this tree,
not reasoned about — the first draft of this table claimed four of five failed open and was
wrong about the `setProjection` row in the direction that flatters the author.

A sixth is not a check but a gate, and it fails open with no test behind it at all: `CLAUDE.md`'s
path-scoped `test:e2e` list named `components/studio/**`, which is where the media and write
seams' hooks used to live. `hooks/studio/**` joined that list in the same commit — see
`docs/testing-gates.md`.

The general form worth carrying: **a directory-scoped check cannot notice a directory it does not
name**, and the ones that survive a move are the ones written against the whole tree. Hence the
same-commit rule in `CLAUDE.md`, and hence preferring a derived list to a typed one wherever a
check can manage it.

**A barrel re-exports ONE component, never a directory of them.** `studio-client.tsx`
dynamic-imports the shell with `ssr: false`, and an aggregating `components/studio/index.ts`
would pull `EntryEditor` into the shell chunk unconditionally — with the lint fence silent,
because it is a studio-to-studio import.

**Barrels do not reopen the public/studio hole.** `eslint.config.mjs` warns that a glob "does not
match a bare `@/x` import resolving to an index file", which is the shape a barrel creates.
Measured against the real config at four fenced paths: `@/components/studio`,
`@/components/studio/entry-editor` (the barrel), `@/components/studio/entry-editor/entry-editor`
and a `state/` module are all blocked — the fence carries the bare form as well as `/**`, and
`no-restricted-imports` matches the literal specifier.

## Why `lib/` holds no React

The public/studio import boundary is written in terms of `lib/`, so keeping React out is what
keeps that boundary meaningful. Pure and reusable goes to `lib/studio/<topic>/` — phase 4's
timeline wants the offset arithmetic — and presentation stays in the component folder.

## Why tests colocate, and why three kinds do not

A test beside its subject is found by whoever changes the subject. The three exceptions have no
single subject: the shared harness, the Pod integration suites, and the tests whose subject is
the repository itself. `check:structure` carries that allowlist and fails **both** on anything
else loose in `test/` and on a name in the list that no longer exists, so it cannot rot into a
set of permanent excuses.

Moving them was where the refactor nearly reintroduced its own worst failure.
`test/vitest-collection.test.ts` exists because `vitest.config.ts` once included only
`**/*.test.ts`, so the first `.tsx` test — 31 kB — was collected by nothing and the suite
reported "280 passed" identically with and without it. That guard scanned `test/` **top level
only**. Moving tests out would have left it passing while grading an empty directory: the same
defect, reintroduced by its own fix. It was widened to a repository-wide walk in the commit
*before* the first move, and the widening was proved by watching it fail on a probe file in a
directory the config did not cover.

## Why test bodies have no length limit

A scenario test reads better whole than shredded into helpers whose names hide the arrangement.
The file ceiling keeps tests navigable. The 6,514-line editor suite split into thirteen files at
the eighteen section banners it already carried, and the case count was verified unchanged by
diffing the 169 `describe > it` paths — not by trusting the number.

## Why an exemption carries a removal condition

`npm run lint` runs at `--max-warnings 0` and flat config has `reportUnusedDisableDirectives`
active. The moment a decomposed function drops under its bound, its `eslint-disable` becomes an
unused directive and **fails the build**. That is the designed removal signal, and it worked:
`EntryEditor`'s exemption left on `Unused eslint-disable directive` at 195 lines, not because
anyone remembered it.

The corollary is stronger: a run reporting **zero warnings** is itself evidence that every
remaining exemption still suppresses a live violation.

Write the condition anyway, and correct it when it turns out false — `EntryEditor`'s said "Remove
this line with the last field group", which the field-group task disproved by leaving the
function at 633.

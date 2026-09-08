# scripts

## two tiers

`check-structure.ts` enforces what ESLint cannot express and **reports** what CLAUDE.md's "Code
structure" section calls a tendency. The split is the maintainer's instruction: the tendencies are
"tend to", not a dictate, and a lint error cannot say that. So ESLint carries the hard bounds (200
/ 80 / 1000) and this script prints the 130 / 50 drift and exits 0.

Four things do fail it: a component `.tsx` outside a folder of its own name, a test with no
subject beside it, a `notes.md#anchor` that does not resolve, and a comment count above the
ratchet below.

## tokens-not-prefixes

Comment runs and `notes.md` pointers are both read from `@typescript-eslint/parser` comment
tokens, never from line prefixes, and each direction of that was measured.

**False negatives, without tokens.** A `//`/`/*`/`*` prefix scanner missed 17 blocks, every one of
them in `entry-editor.tsx` and one of them 47 lines, because that file's house style is the JSX
form whose lines begin with `{`:

    {/*
      NAMED BY `title`, NOT BY `aria-label`, AND THAT IS LOAD-BEARING.
    */}

**False positives, without tokens.** A text scan for `notes.md#…` reported 8 problems on this
repository on 2026-09-08, and none of them was a real pointer: 4 came from the fixture strings in
`test/check-structure.test.ts` (`"// see ./notes.md#no-such-heading\n"` — a string literal that
the script then resolved against `test/`), 1 from `./support/notes.md#why` in the same file, and 3
from this script's own docblocks. Every one is inside a string literal or is prose about the rule
rather than a use of it, and a comment token distinguishes them for free.

The fixtures those cases write to disk are still graded, because there the same text is a real
comment in a real file. The rule is unchanged; only the reader is.

## jsx-by-extension

`jsx` cannot simply be `true` for every file. In a `.ts` file a generic arrow is unambiguous, and
under JSX it is an unclosed element:

    export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

That is `lib/pod/result.ts:36`, and `lib/pod/read.ts:31` has the same shape. Measured 2026-09-08:
`jsx: true` across all 103 scanned files throws `TSError: Unexpected token. Did you mean {'>'} or
&gt;?` and the script dies before printing a single rule. So `jsx` follows the extension, which is
what ESLint does with these files anyway — `typescript-estree` picks the script kind from the file
path, which is why `driftReport` can keep one `ecmaFeatures: { jsx: true }` block for both.

## the-comment-ratchet

The bound is 6 lines and the count is 788, not the 780 the Stage A plan carried. The 8 are not new
code: they are the comment blocks of `lib/pod/read.ts` (6) and `lib/pod/result.ts` (2) — the two
files the paragraph above cannot parse under `jsx: true`. A scan that dies on them counts 780; a
scan that reads them counts 788. Nothing in the repository changed between the two numbers, and
`git log c1c5339..HEAD` touches only the plan document.

That is the failure the plan warned about in its own words — "if your number differs by more than
the blocks your own diff adds, the SCAN changed rather than the code" — arriving from the
direction it did not expect: the scan that was wrong was the one that produced the baseline.

Two earlier numbers are recorded for the same reason. 262 came from a prefix scanner over
production code only, which never opened a test file. 779 was one commit earlier.

The four blocks this script's own diff added are not in the 788: they were shortened into the
sections you are reading rather than baked into the baseline, which is what the plan's Step 4 says
to do when the count rises.

Where the 788 are, because it sizes Stage C:

| | blocks over 6 lines |
|---|---|
| `entry-editor.test.tsx` | 207 |
| `entry-editor.tsx` | 115 |
| the other 88 files | 466 |

### The split, 2026-09-08: 279 production and 509 test-side

The 788 is now two ratchets, on the maintainer's decision that day: the comment conventions bind
production code and test docblocks are exempt. Measured from HEAD at `0b2d99e` rather than taken
from the Stage C plan, and the two agreed — 279 + 509 = 788.

The partition is `isTestSide`: a `*.test.ts(x)` file, anything under `test/`, and
`components/studio/entry-editor/entry-editor.harness/`. The third clause is not decoration. The rig
holds **54** of the 509 and is no `*.test.tsx`, so without it the production half reads 333 and the
exempt half 455 — a 54-block hole in the number Stage C is driving to zero.

| | blocks over 6 lines |
|---|---|
| production, `PROD_COMMENT_BASELINE` | 279 |
| test-side, `TEST_COMMENT_BASELINE` | 509 |

Both fail on a rise. Only the production half is also a flat six outside this repository, and that
asymmetry *is* the exemption: "exempt" means "not rewritten", never "unbounded". Proved by control
on 2026-09-08 rather than by reading the branch — dropping each baseline by one in turn makes
`check:structure` exit 1 naming that half, and only that half.

## github-heading-slugs

`slug()` lowercases, drops non-word characters, then hyphenates **each space individually**.
`/\s+/g` would collapse runs, and the two spaces left by a dropped em dash are exactly such a run:
`## Rule 1 — where it applies` is `#rule-1--where-it-applies` on GitHub and `#rule-1-where-it-applies`
under a collapsing slug. Em-dash headings are the house style in `docs/data-model.md`, so the
collapsed form would both reject anchors copied out of GitHub and accept anchors GitHub cannot
resolve. Known limit: `[^\w\s-]` is ASCII, so a non-ASCII heading slugs differently from GitHub.
No heading in this repository has one.

## no-default-export

`driftReport` hands ESLint the parser **namespace**, not `.default`. Measured 2026-09-08 under
`tsx` on Node 22.23.2: `Object.keys(await import("@typescript-eslint/parser"))` is `parse`,
`parseForESLint`, `clearCaches`, `createProgram`, `withoutProjectParserOptions`, `version`,
`meta` — and `.default` is `undefined`. Passing that as `languageOptions.parser` silently selects
espree, which cannot read TypeScript, so every file returns one `Parsing error` message with
`ruleId: null`, the `max-lines-per-function` filter drops it, and the report prints
`over the tendency — 0 function(s)` on a repository with twelve.

Zero from a broken parser and zero from compliant code look identical in the output, which is why
`test/check-structure.test.ts` asserts a named function, a real line number and a count above
five rather than merely matching the header.

`@typescript-eslint/parser` is in `devDependencies` for this script's sake, pinned to the 8.69.0
that `typescript-eslint` already resolved. It was only ever a hoisted transitive dependency, and
CLAUDE.md's Commands section does not dictate the package manager — under pnpm's strict layout an
undeclared import does not resolve at all. `typescript-eslint`'s own `parser` re-export is not a
substitute: it exposes `parseForESLint` typed as taking one argument, so `{ comment: true }`
fails `tsc`.

## reporting-past-a-disable

`allowInlineConfig: false`. The drift report exists to name the functions over the tendency, and
the most interesting of them is the one with an `eslint-disable-next-line max-lines-per-function`
above it — `EntryEditor`, 941 lines. Honouring inline directives dropped it and two others: 9
functions reported instead of 12. An exemption suppresses the *hard bound*; it does not make the
function short, and this report is the record that it is still there.

## exemptions-must-start-the-line

`exemptionReport`'s regex anchors the comment to the start of the line. `test/guardrails.test.ts`
builds lint probes as template literals, one of which contains the text
`eslint-disable-next-line max-lines-per-function` indented inside a backtick string. A looser
pattern counts it, and the report then names a test fixture as a fifth live exemption. There are
four.

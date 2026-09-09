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

## the steps main prints

`check-public-bundle.ts`'s `main` was 94 code lines against an 80 bound and carried the last
`eslint-disable` in the repository. It is now 20, split at the seam its own output already
described: `measurePages` (25), `reportMeasurementGaps` (34), `reportSize` (6),
`reportComposition` (11), `reportViolations` (23). Verbatim — every message string concatenates
to the same text and the printed order is unchanged.

Two mechanics are not cosmetic.

**`measurePages(pages, root)` takes the root as a parameter** rather than reading this module's
`ROOT`. That is the only way the step can be exercised against a synthesised build:
`test/public-bundle-cli.test.ts` copies *one file* into its temp checkout, so a helper extracted
into a sibling module would not resolve there, and the in-process cases would otherwise have to
read this repository's own `.next`. `main` passes `ROOT`.

**The verdict is called into a local before the exit test.** `if (gaps.failed ||
reportViolations(findings, kb))` short-circuits the second verdict paragraph away whenever the
first has already fired. Not hypothetical: the made-to-fail run on 2026-09-09 — a fenced
`@inrupt/solid-client-authn-browser` import on the public home page — is over the ceiling *and*
leaking, 204.9 kB against 190, and printed both paragraphs. Under `||` the leak would have been
named and "Over budget" silently dropped.

The exemption left on lint's own signal, not on judgement: `npm run lint` failed with
`Unused eslint-disable directive (no problems were reported from 'max-lines-per-function')` at
`check-public-bundle.ts:538`, and only then was the directive deleted.

## fixtures without a test file

`validate-fixtures.ts` has **no test file at all**, and none can be added without touching a
file outside this task's scope. Both homes are closed:

- `scripts/validate-fixtures.test.ts` sits beside its subject and satisfies `check:structure`'s
  colocation rule — but `vitest.config.ts`'s `include` covers `test/`, `lib/`, `components/` and
  `app/` only, so vitest would never collect it. Widening `include` is guarded by
  `test/vitest-collection.test.ts`.
- `test/validate-fixtures.test.ts` would be collected, and would fail the colocation rule until
  it were added to `REPO_TESTS` in `check-structure.ts`.

So the 59 -> 25 line split of its `main` was verified by measurement instead: byte-identical
stdout and exit code before and after, plus seven controls run in a `git worktree` with
`node_modules` symlinked in, each mutating `docs/data-model.md` and asserting the mutation
applied before believing the failure. Blank node, `xsd:float` coordinate, coordinate as
`xsd:string`, count as `xsd:decimal`, `xsd:dateTime` with no offset, an eighth turtle block, and
an unresolved relative IRI: all seven fail identically before and after. An eighth control was
written and refused to run — its anchor matched two turtle blocks — which is the string-replace
fixture trap catching itself rather than silently grading the unmodified document.

A test file for it is worth having and is not this task's to add.

## the gzip ceiling and what it is now for

190 kB, set 2026-09-03 against a measured 176.3 kB worst public route. Every chunk that route
loads was broken down and scanned: React 19 and the Next 16 runtime end to end, with this
project's own code a rounding error inside it.

An earlier revision said "set it from the first real build, then ONLY EVER LOWER IT. Raising this
number is how a budget stops being a budget." That was true while the number was the only
enforcement. `findStudioDeps` now asserts the invariant directly, so the rule was **replaced
rather than quietly broken**.

The previous ceiling of 180 left 3.7 kB, less than the framework has already moved on its own —
the streaming-routes change cost +3.0 kB with no code of ours involved. A budget that fails on
Next's growth rather than on ours teaches people to raise it, which is the actual way a budget
dies.

**What may and may not move this number.** Framework cost, upward, and only with the per-chunk
breakdown to prove that is what it is. Never our own code: anything of ours arriving on a public
route is a boundary failure, and the fix is the import, not the ceiling. Lowering is always
allowed.

### Why a name scan as well

190 against 176.3 leaves 13.7 kB of headroom, and what fits inside it is not what you would
guess. Measured 2026-09-04, each library bundled and minified by esbuild on its own and gzipped —
what a bundler would actually add to a chunk:

| | | |
|---|---|---|
| `sonner` | 9.6 kB | fits inside the headroom; the ceiling never sees it |
| `cmdk` | 17.1 kB | trips the ceiling, by 3.4 kB |
| `vaul` | 21.4 kB | trips the ceiling |
| `maplibre-gl` | 252.8 kB | entry plus its shared chunk; unmissable |

An earlier revision had these as 28.9, 11.0, 33.9 and 777.9 and concluded "only the last would
trip a size budget". Every figure was the gzip sum of every `.js`/`.mjs` in the package's `dist/`
— the ESM build plus the duplicate CJS build, plus dev builds and web workers nothing imports —
so it measured the tarball, not the leak. **The ranking it produced was inverted**: `sonner`, the
one it called the only dangerous one, is the one that slips through, and the two it called safe
are the two that fail.

The conclusion survives its arithmetic. A ceiling catches weight, so it misses the small leak
entirely; a name scan catches either at any size, but says nothing about the framework getting
fatter. Neither subsumes the other.

## why markers are not package names

Grepping a real public chunk for `n3` hits, and the hit is React's minified DOM code —
`n2={},n3={}` … `n3=document.createElement("div").style`. A guardrail that cries wolf on the
framework gets switched off by the first person it annoys. So a marker must be a string a
minifier cannot produce by accident:

- identifier-shaped markers are **>= 8 characters**;
- markers containing a character that cannot occur in an identifier (`-`, `/`, `.`) can never be
  synthesised whole by mangling, so 6 is enough;
- the bare all-lowercase package name is never a marker. It is both the most collision-prone
  choice and usually the one that does not even match — `exifreader` appears nowhere in
  `exif-reader.js`, only `ExifReader` does.

### Why 8, measured

Over the 9 files of `.next/static/chunks/*.js` in this project's own build (599,640 bytes;
108,076 identifier tokens, 4,985 distinct), distinct tokens by length run 54, 1614, 170, 246,
260, 267, 267, 272, 238, 179 for lengths 1 to 10, with 2,107 distinct tokens of 8 characters or
more and the longest 63.

**The number that proves mangling is the first one.** 54 distinct one-character tokens is the
base-54 identifier alphabet — `$`, `_`, and the 52 letters — exhausted, every one in use, 49,320
times between them. A mangler allocates shortest-first and spills into length n only once n-1
runs out, so reaching 8 characters would take on the order of 54^7 live names in one scope. It
never happens. Every one of those 2,107 long tokens is a name the toolchain had to **preserve**,
not one it invented: `$$typeof`, `Suspense`, `NODE_ENV`, `onlyHashChange`, `TURBOPACK`.

That is the real justification, and not the one this comment used to give. It claimed "7483
mangled identifiers of 1 character, 1839 of 2, 14 of 3, 546 of 4, and nothing mangled longer —
the only 7+ character tokens are DOM names", and set the floor at "double the longest observed".
Neither half holds: the 7- and 8-character buckets have 267 and 272 distinct tokens, and they are
Next's own preserved identifiers rather than DOM names. The floor is right for a different
reason — a mangler cannot synthesise a long name, only preserve one.

**Which is where the residual risk lives, and length does not fix it.** A preserved name can be
an ordinary word: `Fragment`, `Provider`, `Response` and `Infinity` are all in these chunks at 8
characters or more. A marker has to be a name only the banned library would preserve, not merely
a long one.

### Markers must survive bundling

Every `@radix-ui/...` occurrence in the primitives is an import specifier a bundler resolves
away, so the scope name would catch nothing in a real chunk. The runtime literals do.

Every marker was verified in both directions against the real installed builds: present in each
artifact the library ships, and absent from React, React DOM, the scheduler and both of Next's
pre-minified runtimes. `test/public-bundle.test.ts` re-checks that on every run and puts each
artifact through esbuild first, so a marker surviving only in a comment or an import specifier
fails there rather than sitting here matching nothing.

**Re-derive this when a studio dependency is added** — here and in `eslint.config.mjs`'s public
block. A dependency on neither list is invisible to every check in this repository.

### The individual markers, and the two that were wrong

- **`n3`** — the RDF stack. `lib/pod/read.ts` is unauthenticated, shared, and parses Turtle on
  the server, so `n3` in a client chunk means the read path reached the browser. Its markers are
  RDF/JS term names because the package name is the false positive above. These three markers are
  also in `@inrupt/solid-client`, which genuinely depends on `n3`, so a solid-client leak reports
  as **both** deps — accurate noise, not a false positive. Do not go looking for a direct `n3`
  import that is not there.
- **`@inrupt/solid-client-authn-browser`** — the pre-bundled build contains no `@inrupt` at all,
  so a marker leaning on the package specifier would miss it. `solid-client-authn` used to be a
  marker and was removed for violating this file's own survive-bundling rule: in `dist/index.mjs`
  its only occurrence is inside `export … from '@inrupt/solid-client-authn-core'`, which a
  bundler resolves away, and in the pre-bundled build it survives only in the trailing
  `//# sourceMappingURL=` comment, which a minifier drops. Measured 2026-09-04: gone from both
  after esbuild. `handleIncomingRedirect` survives both.
- **`next-themes`** — on disk because shadcn's sonner imports `useTheme` from it, so it is
  importable from anywhere; on a public route it is either dead weight or the start of a toggle
  the design has declined. Its markers are next-themes' own public API names, which a minifier
  preserves because they are object and destructuring keys. The tempting markers fail the
  absent-from-the-framework half: `suppressHydrationWarning` is in react-dom, and
  `(prefers-color-scheme: dark)` is in Next's own runtime and devtools.

## the three guards that must fail rather than pass

All three exist because, with `Finding[]` as a return type, "clean" and "I did not look" are the
same value: `[]`.

- **`findStudioDeps` throws on a scan of nothing.** If Next changes how it emits script
  references, the extraction matches nothing, every chunk arrives empty, and a scan of zero bytes
  reports the public bundle clean. An exception is the only answer that cannot be mistaken for a
  pass.
- **An unresolved reference is fatal.** This was once `if (!existsSync(onDisk)) continue;` — the
  chunk left the byte sum *and* the scanned set while the line above still printed `refs.size`,
  so "93.3 kB gzip 2 files" described one file and the composition scan never opened the other.
  If the skipped one carries maplibre, the run prints "absent" for every banned dep and exits 0.
- **A page the extraction matched nothing on is fatal.** `refs.size === 0` means no chunk of that
  page entered the byte sum or the scanned set, so it was neither weighed nor scanned — while its
  ledger line printed anyway as "0.0 kB gzip 0 files", which reads like a measurement rather than
  like a page nothing was learned about.

The extraction is the part of this file most likely to stop working in silence: one regex against
HTML Next emits, and Next emits three route shapes here — static, dynamic, and the PPR shell.
Change the attribute, the extension or the quoting on **one** of them and that route's pages
measure zero while every other page keeps the run green. Neither neighbouring guard covers that:
`unresolved` needs a reference to have been extracted before it can be missing, and
`worst.bytes === 0` needs *every* page to measure nothing. This is the gap between them.

It is a failure and not an oddity because `publicPages()` has already excluded zero-byte HTML,
with its reason, before that loop runs. A page that gets that far has bytes, and a real public
page with bytes and no script reference is this check having lost sight of the build — every App
Router page here loads the framework chunks.

## why this module is importable and pure

Nothing runs and no build output is read unless the file is executed directly.
`test/public-bundle.test.ts` enforces that by copying the file to a directory with no `.next` and
importing it in a child process.

`size-limit` globs files; it cannot answer "what does `/trips/[slug]` send to a browser".
Globbing `.next/static/chunks/**` would measure the studio's Radix and shadcn weight too, so a
public regression could hide inside the total and a studio addition could fail a budget it has
nothing to do with. Both checks therefore derive their file list from the prerendered HTML of
each public route — the scripts the browser is actually told to load. Chunk names are
content-hashed, so deriving beats hardcoding.

## which pages count as public

**Only the studio route is excluded**, and only because it is allowed to be heavy — keeping it
out is what stops its weight hiding a public regression. The decision is made on the path
**relative to `.next/server/app`**, i.e. the route, as an exact match on `studio.html` or a
`studio/` prefix.

That anchoring is the whole of a fix. The test was `!/studio/.test(f)` against the **absolute**
path, unanchored, and it dropped two kinds of page silently: a trip titled "Studio Ghibli Museum"
builds to `trips/studio-ghibli-museum.html` (slugs come from titles — `docs/data-model.md`) and
vanished from both the ceiling and the scan, as did *every* page for anyone whose checkout sits
under a directory named `studio`. Deleting the filter is not the fix either: then the studio's
own weight and its Radix get measured as public.

Route-group directories are not part of this — Next strips `(studio)` from the emitted path, so
the studio page really is at `studio.html`.

**`_not-found` and `_global-error` used to be excluded and should not have been.**
`app/not-found.tsx` is a page real visitors hit, it renders its own `<html>` because there is no
shared root layout, and a read-only review found it fenced by neither this budget nor the import
boundary. Measured when they were added back — `_not-found` 173.3 kB, `_global-error` 169.7 kB
against a 176.3 kB worst case — so including them changed the reported worst route not at all.
They are public in the bundle sense even though nobody links to them.

**The zero-byte filter is kept, and is honest about doing nothing today.** A previous comment
called `[slug].html` "a zero-byte Partial Prerendering shell"; it is 1,617 bytes in the
2026-09-03 build, it is measured, and it reports the same 176.3 kB as the concrete
`2026-japan.html` — so the filter fires on nothing here. It stays because an HTML file with no
bytes names no scripts, and a 0.0 kB page in the report is noise that reads like a finding. What
changed is that it can no longer be a silent third exclusion: like the studio one, it is
reported.

## why the CLI guard is argv[1] and not import.meta.main

`import.meta.main` is not the answer, and not for the reason the comment used to give. It said
the property is "not available across the Node versions this repo supports". It is: measured
2026-09-04 on Node 22.23.2, `node script.mjs` reports `import.meta.main === true`, and `engines`
is `^22.22.2`.

The real reason is that every entry point here is TypeScript loaded through `tsx`, and tsx's
transform does not set it — the same measurement gives `typeof import.meta.main === "undefined"`
for `node --import tsx script.ts` while giving `true` for `node --import tsx script.mjs`. **A
guard on an undefined value never fires**, which is exactly the failure this guard exists to
avoid.

So `process.argv[1]`, canonicalised on **both** sides:

- **realpath**, because Node has already realpath'd `import.meta.url` while `argv[1]` keeps
  whatever the caller typed. Measured: through a symlinked checkout, `argv[1]` is
  `/tmp/link/scripts/x.ts` and `import.meta.url` is `/private/tmp/repo/scripts/x.ts`. The old
  comparison called those different and the CLI exited 0 in silence — a `size:public` step that
  checked nothing and reported success.
- **extension-stripped**, because `tsx scripts/check-public-bundle` resolves the `.ts` for the
  loader and leaves `argv[1]` extensionless. Measured too, and the same silent exit 0.

Under `node --import tsx -e "await import(...)"` — how the purity test loads this file —
`argv[1]` is `undefined` (measured), so nothing runs. That is deliberate and must stay:
importing this module executes nothing.

A mismatch that still looks like an **attempt** to run this file — the same filename at a path
that does not canonicalise to this one — is loud and non-zero. Exiting 0 having done nothing is
the one answer a guard must never give, because it is indistinguishable from a clean build. The
comparison is narrowed to the filename so an ordinary `import` from some other module (vitest's
worker, for instance) stays silent, as it must.

## why the drift check runs in both directions

CLAUDE.md is the contract; `package.json` implements it. Forward: every command CLAUDE.md names
must exist. Backward: every script `package.json` defines must be named.

The backward direction was missing, and the drift it would have caught was already there — CI ran
`npm run size`, and the Commands block named neither `size` nor `start`. Rename either script and
CI breaks while the check stays green. **An undocumented script is one no check is holding onto.**

## why the fences are walked and not matched

A regex cannot do this. The **closing** fence of a tagged block is spelled exactly like the
**opening** fence of an untagged one (```` ``` ````), so `/```\n([\s\S]*?)```/` happily starts
capturing at the end of a ```` ```sh ```` block and returns the prose that follows. Not
hypothetical — it is what this script did on the first attempt at an earlier fix.

## why two untagged fences is fatal rather than guessed

The scripts list is the one untagged fence in the Commands section; every other block there is
tagged, which is both better markdown and what makes this unambiguous.

This used to take the **first** untagged fence and then "prove" it was the right one by requiring
it to contain `test` and `build`. That sentinel did not close the hole its own comment claimed:
an untagged decoy above the real list — "the three you run most: test, build, lint" — satisfies
it, gets graded instead of the list, and the script reports "All 3 commands in CLAUDE.md exist in
package.json" having never looked at the other nine. **A check that grades a quarter of the
contract and says "all" is worse than one that is simply absent**, because it occupies the slot
where the real check would go.

There is no reliable way to tell a decoy from the list — both are fences full of script names —
so this does not try. Two untagged fences means the maintainer says which is which, by tagging
the other one.

## why §12 is excluded from the vocabulary scan

`docs/data-model.md` §12 "Deliberately out of scope" names terms that intentionally do **not**
exist — `dy:companionTrip` for multi-traveller trips, for instance. Scanning it would demand
exports for vocabulary the document explicitly declines to define. If a term graduates out of
§12 it must move into §3, which is where the check looks.

The check runs in both directions for the same reason as the command drift check: a term added
to the document but never exported is unusable, and a term exported but no longer in the document
is a predicate nobody agreed to write to a Pod.

## what the fixture validator checks, and with what

For every ```` ```turtle ```` block in `docs/data-model.md`: it parses standalone (all prefixes
declared), relative IRIs resolve to the intended absolute URLs, no blank nodes anywhere,
coordinates are `xsd:decimal` and never `xsd:float`, and every `xsd:dateTime` literal carries a
UTC offset.

Uses `n3`, the same RDF parser the application uses — `docs/decisions.md` §23 for what that trade
costs.

## seeding a local Pod

Seeds a local Community Solid Server with the §7 fixtures so the app has something to read during
development. Phase 1 works "against hand-written Turtle placed in the Pod manually"; this is that,
automated. Local CSS data is disposable, which is why the still-unresolved `example.org` `dy:`
namespace is fine here and would not be on a live Pod.

Usage: `npm run pod:dev` in another terminal, then `npm run pod:seed`.

## the two datatype lists, and what each was missing

**Coordinates must be `xsd:decimal`** (§6: "never xsd:float for coordinates"). `homeLat` and
`homeLong` are spelled out because neither matched any existing entry — `#homeLat` does not
contain `#lat`, and it is not `latitude` either — so §7.6's coordinate pair arrived unchecked.

What that does and does not cost, measured rather than reasoned: `xsd:float` is banned
unconditionally a few lines below, so a float home latitude was caught either way, and an earlier
draft of this comment claimed otherwise and was wrong. What those two entries actually catch is
every **other** wrong datatype — with them removed, `dy:homeLat "45.4655"` (i.e. `xsd:string`)
passes this script while failing `decimal()` in `lib/pod/rdf.ts` on every real read. With them
present it fails here, naming the predicate and both datatypes.

**Counts must be `xsd:integer`** (§6: "counts and distances"), and that half was missing
entirely. The script banned `xsd:float` and required decimals on coordinates and said nothing
about integers, so `dy:homeRadiusMeters 3000.0` — `xsd:decimal`, a datatype error through
`integer()` in `lib/pod/rdf.ts` on every read — was a perfectly valid fixture as far as this file
was concerned. `Meters` covers `precisionMeters`, `homeRadiusMeters` and `defaultPrecisionMeters`
at once.

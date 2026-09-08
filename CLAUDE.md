@AGENTS.md

# CLAUDE.md

Rules and invariants for this repository. Read every session. Dense on purpose.

## This file, AGENTS.md, and the Next.js managed block

`next dev` on Next 16.3+ writes a managed block of Next.js agent rules, delimited by HTML
comment markers spelled `BEGIN:nextjs-agent-rules` and `END:nextjs-agent-rules`.

**Those markers are deliberately written here without their `<!--` and `-->` wrappers, and that
is load-bearing — do not "fix" it.** Until 2026-09-05 this section quoted them in full, which
made *this file* contain a well-formed managed block inside a backtick-quoted paragraph. The
consequences were the opposite of what the section claimed:

- `hasCurrentAgentRules()` scans `AGENTS.md` **and** `CLAUDE.md`. It found the block here, saw
  it matched Next's current text exactly, and returned early — so `writeAgentFiles()` never ran
  and `AGENTS.md` was never given the block at all. `TODO.md` blamed this on "only `next build`
  has run", which was wrong: `next dev` had run many times through the e2e harness.
- Worse, it was latent rather than merely untidy. On a Next upgrade the block text changes, the
  early return stops firing, and `writeAgentFiles` evaluates
  `agentsMdExists && (agentsMdHostsBlock || !claudeMdHostsBlock)` → `true && (false || false)`
  → false, falls through to `if (claudeMdExists)`, and **upserts into `CLAUDE.md`** — rewriting
  the middle of this very paragraph. The rule would have failed exactly when it mattered.

Note that `claudeMdHostsBlock` tests for the START marker **on its own**, so breaking the pair
is not enough: the literal `<!` `-- BEGIN:…` string must not appear in this file in any form.

It never truncates existing content — it replaces the block in place if the markers are present,
otherwise appends it to the end of the file. Which file receives it, per
`node_modules/next/dist/server/lib/generate-agent-files.js`:

- If `AGENTS.md` exists, the block goes there and `CLAUDE.md` is left alone.
- If only `CLAUDE.md` exists, the block is appended to *this file*.
- If neither exists, it creates `AGENTS.md` with the block and `CLAUDE.md` containing
  `@AGENTS.md`.

**This repository keeps an `AGENTS.md`, so the managed block lives there and never touches this
file** — true as of 2026-09-05, and verified by running `next dev` and watching `AGENTS.md`
receive it, rather than by reading the code alone. `CLAUDE.md` imports it via `@AGENTS.md` at
the top, so the Next.js rules are still in context. Do not delete `AGENTS.md`, or the block
starts landing here.

Commit the managed block when it changes. Stripping it from a diff only recreates it as an
uncommitted change on the next `next dev`.

Never set `agentRules: false`. Next's own benchmarks show agents do better with the bundled
docs in context.

## Everything else here is authoritative

If `/init` or any other tool generates project rules, **merge into this file, never replace
it.** These rules encode design intent that cannot be inferred by reading the code, and during
early phases the code is incomplete — a scan-generated description would document a half-built
app as if it were the design.

Existing sections stay as written. Append genuinely new findings to the relevant section. If a
generated line contradicts a rule here, the rule wins, and the contradiction means the code
has drifted from the design.

## Next.js: read the bundled docs, not your training data

Next 16 has breaking changes against most training data. Version-matched documentation ships
inside the package at `node_modules/next/dist/docs/`, mirroring the structure of the docs
site. **Read the relevant guide there before writing Next.js code.** No network request
needed, and it upgrades with the package.

Markdown over the network also works if needed: append `.md` to any `nextjs.org/docs` URL, and
the per-error pages under `/docs/messages` are written for agents to read but are not bundled.

Two runtime tools matter here, because this app is map- and browser-heavy and its most
confusing failures are invisible in server logs:

- **`logging.browserToTerminal`** forwards browser console errors and warnings to the terminal.
  Keep it on. MapLibre and Solid-OIDC failures happen in the browser.
- **The Next.js MCP server** at `/_next/mcp` on the running dev server exposes routes, server
  logs, and compilation issues. `get_compilation_issues` and `compile_route` answer "does this
  compile" without a full `next build`.

`next dev` writes its PID, port and URL to `.next/dev/lock`. Connect to the running server
rather than starting a second one.

For build failures where the error alone is not enough, `next build --debug-prerender` turns on
server source maps and continues past the first failure.

## How work is done here — mandatory

**Test-driven, and delegated to subagents. Both, always.** This is not a style preference; it
is how this repository is worked on, and it applies to features, bugfixes and refactors alike.

### 1. Test first

1. `test-specialist` writes a **failing** test and shows the failure. A test that passes the
   first time it runs is suspect: either the behaviour already existed, or the test asserts
   nothing.
2. Only then does implementation start — `nextjs-specialist` for anything rendered,
   `solid-specialist` for anything touching the Pod.
3. `test-specialist` re-runs and confirms the test now passes for the right reason.
4. `fullstack-solid-reviewer` reviews the diff before it is considered done. It is read-only,
   so it cannot quietly fix what it finds — which is the point.

Do not write implementation code before its test exists. If a test genuinely cannot be written
before the implementation, say so and explain why rather than skipping the step silently.

### 2. Use the subagents

The four definitions live in `.claude/agents/`. They exist because each carries context that is
expensive to reconstruct — the phase-0 findings, the import boundary, the datatype rules, the
ways tests in this project have passed while verifying nothing. Working around them wastes that.

| Agent | For |
|---|---|
| `test-specialist` | every test, and the failing test that opens the loop |
| `nextjs-specialist` | App Router, React, Tailwind, shadcn, MapLibre |
| `solid-specialist` | Pod reads and writes, RDF, ACLs, vocabulary |
| `fullstack-solid-reviewer` | reviewing the diff — read-only, by design |

### 3. Definition of done

Work is **not done** until all of these pass. Run them, read the output, and only then say so.
**Check `node -v` prints v22.x first** — see the Node version note under Commands; these all run
and pass on an unsupported runtime, so a green result on the wrong Node proves less than it looks.

```
npm run pod:dev &           # FIRST — see below. Without it, `npm test` skips the integration tests
npm test                  # vitest — unit, integration, guardrails
npm run lint              # eslint, including the project guardrails
npm run typecheck         # tsc --noEmit
npm run validate:fixtures # the normative Turtle in docs/data-model.md
npm run check:vocab       # lib/vocab.ts vs the data model, both directions
npm run check:commands    # this file's commands vs package.json
npm run check:structure   # layout, comment length, notes.md pointers; reports drift
npm run build             # reads the Pod; needs one running
npm run size:public       # what a public page actually ships
```

**Start the Pod before `npm test`, not just before `npm run build`.** The Community Solid Server
integration tests skip themselves when nothing answers on `localhost:3001` — correctly, as
skips rather than vacuous passes. But `npm test` then reports green having never run
`test/integration/pod-read.integration.test.ts` or
`test/integration/pod-access.integration.test.ts` at all, and the list
above put the Pod requirement only against `build`, six lines too late. With a Pod up they pass
in a few seconds. They are real tests, not rot — which is precisely why a run that quietly omits
them is the "half a check" this section warns about.

**The two file names are the durable form of that, and a count is not.** This paragraph said "23
of them" from 2026-09-04 until 2026-09-06, when the same two files ran 29 — the number moves
every time either file gains a case, and it was never the point. If a third integration file
appears, name it here; do not reintroduce a total.

**A tenth command, path-scoped rather than unconditional.** If the diff touches any of

```
lib/studio/**   app/(studio)/**   components/studio/**   app/(public)/client-id.jsonld/**
lib/media/**   lib/pod/write.ts
```

then `npm run test:e2e` must pass too. **Two seams, not one.**

Since tests moved beside their subjects on 2026-09-08, those globs also match a diff that only
adds or edits a **test** file under `lib/media/**` or `lib/studio/**`. That over-fires, and
deliberately so: the gate is a path match rather than an intent match, and an extra 21-second run
is cheaper than the reasoning needed to decide a media test is harmless. Do not narrow it.

The first line is the auth seam, and it is where this test's failures live: it drives a real
Solid login round trip through the local Community Solid Server — redirect, consent,
authorization code, `handleIncomingRedirect`, owner studio.

`lib/media/**` is the media seam, added 2026-09-06 because the gate had a hole with a name.
The pass-through shortcut — "the source is already small, skip the re-encode" — lives in
`lib/media/pipeline.worker.ts`, and taking it uploads the owner's unstripped EXIF, GPS
included, into a publicly readable container. A change to that file **alone** touches none of
the four paths on the first line, so neither the gate nor CI would have asked for the one test
that catches it, and it need never have run.

`lib/pod/write.ts` is on the same seam for the same reason, added 2026-09-06 alongside it.
`putGuarded` took a `Blob` body in phase 3, so it is now the single function every image
derivative reaches the Pod through — the media path's last mile, and the one carrying the
`If-None-Match: *` that makes a re-upload answer 412 instead of overwriting. It sits in
`lib/pod/`, not `lib/media/`, so the media glob does not reach it, and a change confined to it
would slip the gate exactly as the worker would have.

That test is also the only place in this repository where the bytes that actually reach the Pod
are read back and inspected. jsdom has no `createImageBitmap`, no `OffscreenCanvas` and no
encoder, and a jsdom `Blob` arrives at MSW as the nine bytes of the string `"undefined"` —
measured 2026-09-06. So every faster test can check file names, content types, IRIs and call
order, and none of them can check one pixel or one EXIF tag.

It is deliberately NOT in the list above. The nine run anywhere with a checkout and Node 22;
this one needs a Pod, a 178 MB browser and port 3000 free, and a list gated on three pieces of
infrastructure is a list people stop running. Scoping it to the diff keeps it checkable by
reading the diff.

Two things it needs, both of which fail loudly rather than skipping: `npm run pod:dev`, and
`npx playwright install chromium`. A browser already in the Playwright cache is not enough —
a cached revision only counts for the Playwright version that asks for it, and this repo has
stale 1208 and 1223 alongside the 1234 that `@playwright/test@1.62.1` actually wants.

It runs against `next dev` on purpose. React only double-invokes effects under StrictMode in a
development build, and that double invocation is the whole reason `restoreSession` memoises
synchronously (phase-0 question 2: the first `handleIncomingRedirect` returned
`isLoggedIn: false`). Under `next start` the effect runs once and the spec would pass with the
memo deleted.

"It should pass" is not done. **Never report work as complete on the strength of a command you
did not run, or a result you did not read.** If something fails, say which and why — a failure
reported plainly is worth more than a green summary that is wrong.

Two failure modes this project has already hit, so check for them specifically:

- **A green run that verified nothing.** A skipped integration test reporting as passed; a
  negative test whose fixture edit silently failed to apply; a lint rule exercised at a path it
  does not cover.
- **Half a check.** An HTTP status asserted without its body — that shipped a zero-byte 404.

## What this is

A travel diary. A public, server-rendered Next.js site reads trips and entries from the
owner's Solid Pod; a client-side studio lets the owner write to it. There is no database and
no server-side session anywhere in the system.

## Read before writing code

| File | What it is |
|---|---|
| `docs/data-model.md` | **Normative.** The RDF contract. Never invent a predicate. |
| `docs/versions.md` | Resolved dependency versions and known agent traps. |
| `docs/decisions.md` | Why the stack is what it is. Do not re-litigate. |
| `docs/design-brief.md` | Visual direction, fixed vs open decisions. |
| `docs/phase-0-spike.md` | Platform assumptions still unverified. |
| `TODO.md` | Ordered task list, including installation and setup. Start here. |
| `AGENTS.md` | Pointer file; hosts the Next.js managed block. Do not delete. |

## Blocked until decided

**The `dy:` namespace URL is still `https://example.org/ns/traveldiary#`.** It is a permanent
identifier baked into every triple. Nothing may be written to a live Pod until the real
project domain replaces it. Local dev against Community Solid Server is fine — that data is
disposable. Ask before proceeding past this if it is still unset.

## Architecture invariants

1. **The Pod is the only datastore.** No database, no ORM, no Prisma, no Supabase, no KV. If a
   task appears to need a database, it needs an index resource — see `docs/data-model.md` §7.4.
2. **The Pod cannot be queried.** No server-side filtering, sorting, or aggregation exists.
   Reads go through the index resource. There is no SPARQL endpoint.
3. **Two access paths, one app.** The public path uses unauthenticated `fetch` from the
   server. The studio holds the visitor's own Solid session in their browser. These never mix.
4. **Never hold Pod credentials server-side.** No server session, no service account, no
   proxying writes through a route handler. Writes go browser → Pod directly.
5. **The studio route guard is UX, not security.** All authorisation is enforced by the Pod.
   Never write code that treats the owner check as a guarantee.
6. **Zero required API keys.** Any dependency needing a signup is rejected. This is a product
   feature, not a preference. Tile URL and Pod root are env vars with working defaults.
7. **Host-neutral.** No `@vercel/*`, no Netlify-specific packages in application code.
   Standard Next APIs only. Netlify is the deploy target; self-hosting must stay possible.

## Hard rules

**Data layer**

- All IRIs come from `lib/vocab.ts`. No predicate string literals anywhere else. Enforced by
  `no-restricted-syntax`.
- No blank nodes. Fragments only (`#it`, `#place`, `#geo`, `#photo-1`).
- Validate on read. Every read returns a typed object or a structured error via Zod. Never
  index into raw triples in a component.
- Check `dy:schemaVersion` on every top-level read.
- Explicit datatypes: `xsd:date`, `xsd:dateTime` **with UTC offset**, `xsd:decimal` for
  coordinates (never float), `xsd:integer` for counts.
- Language-tag all human-readable literals.
- Every write carries a precondition: `If-None-Match: *` to create, `If-Match: <etag>` to
  update. A blind PUT is a bug.
- Access control only through `lib/pod/access.ts`. Enforced by `no-restricted-imports`.

**Public / studio boundary**

- Separate root layouts: `app/(public)/layout.tsx` and `app/(studio)/layout.tsx`. No shared
  provider tree.
- `(public)` must never import from `(studio)`, and must never import the Solid auth library,
  Radix, Zod schemas used only for writes, or image-processing code.
- A bundle-size budget on public routes fails CI. This is the real enforcement.
- Studio pages are thin server components, but the `dynamic(…, { ssr: false })` import of the
  client shell lives **inside a `"use client"` wrapper, not in the page**. Next 16 rejects the
  shorter spelling outright: "`ssr: false` is not allowed with `next/dynamic` in Server
  Components. Please move it into a Client Component" — see
  `node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`, confirmed by building a probe
  page. So the shape is **server page → `"use client"` wrapper → `dynamic(…, { ssr: false })`**,
  three files rather than two. The page stays a server component because that is what may read
  `OWNER_WEBID`, `SITE_URL` and `SITE_NAME`: none of them are `NEXT_PUBLIC_`, so `lib/config.ts`
  throws in the browser and the shell has to receive them as props.
- `lib/pod/read.ts` is unauthenticated and shared. `lib/pod/write.ts` and
  `lib/pod/access.ts` are studio-only.

**Media**

- Resize client-side before upload, in a Web Worker: thumb, web (~1600px), and a tiny blur
  placeholder. Store all three plus dimensions.
- Strip EXIF from every uploaded derivative. Originals either are not uploaded or are
  stripped too — never uploaded with GPS intact.
- Coordinates are fuzzed **before** the write. The Pod never stores a coordinate more precise
  than what is published.

**Map**

- One MapLibre instance, mounted once, never remounted across navigation or drawer state.
- Lazy-mount on intersection.
- `setProjection` only inside the `style.load` handler.
- Never remove the OpenStreetMap attribution control.

**Styling**

- Tailwind v4, CSS-first. Design tokens in the global stylesheet under `@theme`.
- Arbitrary Tailwind values are banned outside `components/ui/**` (shadcn's copied source is
  exempt).
- Fixed dark theme. Palette lives at `:root`, not under a `.dark` class. No theme toggle.

## Code structure

Numbers below are **tendencies, then hard bounds**. The tendency is what the code should look
like; the hard bound is what CI refuses. Both exclude comment-only and blank lines, which is
what makes them mean anything here: this repository runs 44% comment lines, so a 200-line span
is routinely an 80-line function, and the prose is the comment rule's problem rather than this
one's.

| Rule | Tendency | Hard bound | Applies to |
|---|---|---|---|
| Render function | 130 | 200 | `components/**`, `app/**` |
| Util / lib function | 50 | 80 | `lib/**`, `scripts/**` |
| Inline comment block | 3 lines | 6 lines (ratchet, see below) | **production code**, except `components/ui/**` |
| Test file | 600 | 1000 | `**/*.test.{ts,tsx}` |
| Test function body | no limit | no limit | — |

ESLint enforces the hard bounds and says nothing about the tendencies; `npm run check:structure`
reports every function over a tendency and fails on none of them. That split is deliberate and
is the maintainer's instruction: the numbers are "tend to", not a dictate, and a lint error
cannot express that. Do not tighten the lint rules to the tendency values.

**`npm run lint` carries `--max-warnings 0`**, so a stale `eslint-disable` whose code has since
been fixed fails the build rather than printing a severity-1 warning nobody reads. The repository
had zero warnings when that was added, on 2026-09-08.

**The comment bound binds production code. Test docblocks are exempt** — decided 2026-09-08,
after measuring. Of the 788 blocks over six lines, **509 were in test files** and the editor's
harness, and the two real defects this project has found (the deleted map pin, and the timestamp
that happened nowhere) were both found *because* a test docblock recorded which fixture could
reach which branch. A docblock saying what a case catches is prose sitting where it belongs; a
47-line essay inside a render function is not.

**Both halves are ratcheted, for different reasons, and `check:structure` prints two numbers.**
The **production** count fails when it rises and is being driven to zero by Stage C — 279 when
the split landed. The **test** count is frozen at its measured 509 and also fails when it rises,
so "exempt" means *not rewritten*, never *unbounded*. When production reaches zero its half stops
being a ratchet and becomes a hard zero.

A failing build is the only kind of "report" the doctrine above concedes cannot be rationalised
past, and a hard bound that blocks every merge on deferred work is worse than none — which is
what a single combined 788 would have been through Stages A and B.

The partition has three clauses and the third is load-bearing: a `*.test.ts(x)` file, anything
under `test/`, **and the editor harness**, which holds 54 blocks and is not a `*.test.tsx`.
Without it the split reads 333/455 and the number Stage C drives to zero has a 54-block hole.

Two earlier figures for that count were wrong, in ways worth knowing before quoting a third: 262
came from a line-prefix scanner that never opened a test file and could not see the JSX `{/* … */}`
form, and 780 came from a parser-based scan that died on the two `lib/pod` files whose generic
arrows are unparseable as JSX. Both are recorded in `scripts/notes.md#the-comment-ratchet`. The
allowance is this repository's own debt, so it applies only to this repository: run the script
against any other tree and the bound is a flat six, on both sides.

**Delimiter lines count toward the bound**, so a `/** … */` docblock's real budget is four lines
of prose, not six. Two comment blocks with no blank line between them are one run: a blank line
resets it.

Test bodies carry no length limit on purpose. A scenario test reads better whole than shredded
into helpers whose names hide the arrangement; the file ceiling is what keeps tests navigable.

**Comments say what the code cannot, in three lines or fewer.** Anything longer moves to a
sibling `notes.md`, and the code keeps a pointer:

```ts
// First writer wins; see ./notes.md#first-writer-wins
```

`check:structure` fails if that anchor does not resolve, so a pointer cannot rot the way the
line-number citations in the entry-editor tests did — twice in one stage, the second time within
a single fix round, because the production commit landed after the test commit.

A pointer counts only where a pointer belongs: `check:structure` reads real comment tokens, so
`notes.md#…` inside a string literal is fixture text rather than a citation, and the JSX comment
form is seen. Both directions were measured — `scripts/notes.md#tokens-not-prefixes`.

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

**One component, one folder**, holding the named component file, a one-line `index.ts` re-export,
its test, and its `notes.md` if it has one:

    components/studio/entry-editor/
      entry-editor.tsx  index.ts  entry-editor.test.tsx  notes.md

Named file plus a barrel, because a tab bar of twelve `index.tsx` files is the opposite of
readable and stack traces that all say `index.tsx` are worse, while the barrel keeps imports
short. `components/ui/**` is exempt and stays flat: it is shadcn's copied source, the CLI
rewrites it flat on update, and it is already exempt from the arbitrary-Tailwind guardrail.

**The rule binds `.tsx` files — components — and not the `.ts` files beside them.** A component
folder may hold flat `state/` and `hooks/` subdirectories of plain modules
(`hooks/use-entry-form.ts`, `state/apply-photo-offer.ts`) without each earning a folder of its
own. Giving a five-line reducer helper its own directory is the reductio, and a rule that
demanded it would be weakened under deadline instead of followed.

**A barrel re-exports ONE component, never a directory of them.** No `components/studio/index.ts`
aggregating all three. `components/studio/studio-client/studio-client.tsx` dynamic-imports the shell with
`ssr: false`, and an aggregating barrel at that boundary pulls `EntryEditor` into the shell chunk
unconditionally — the lint fence would not object, because it is a studio-to-studio import.

**`lib/` holds no React.** A helper pulled out of a component goes to `lib/studio/<topic>/` if it
is pure and reusable, and stays in the component folder if it is presentation. The public/studio
import boundary is written in terms of `lib/`, so this split is what keeps that boundary
meaningful.

**Tests live beside their subject.** A `*.test.ts(x)` file sits in the same directory as the
source file of the same base name. Three kinds have no single subject and stay in `test/`:

- the shared harness — `setup.ts`, `msw.ts`, `graph.ts`, `network-guard.ts`, `child-output.ts`,
  `fixtures/`, `support/`
- the Pod integration suites, in `test/integration/`
- the tests whose subject is the repository itself — `guardrails`, `check-commands`,
  `check-structure`, `public-bundle`, `public-bundle-cli`, `vitest-collection`, `network-guard`

`check:structure` carries that list and fails both on anything else left loose in `test/` **and
on a name in the list that no longer exists**, so it cannot rot into a set of permanent excuses.

**An exemption is a comment with a reason and a removal condition**, never a bare disable:

```ts
/* eslint-disable-next-line max-lines-per-function --
   Stage B decomposes this; see the spec §5. Remove with the last field group. */
```

`check:structure` prints every active exemption on every run, so none of them hides.

## Commands

**The Node version IS dictated. Select it before running anything.** `.nvmrc` pins `22.23.2`
and `package.json` declares `engines: ^22.22.2`. Not 24, and not 20 — the two Inrupt packages
disagree, and the 22 line is their only overlap, with `jsdom@30.0.1` setting the floor inside
it. Full reasoning in `docs/versions.md`.

```sh
nvm use            # reads .nvmrc
node -v            # must print v22.x — check, do not assume
```

A shell whose default `node` is something else is the normal case, not an exotic one: this has
already happened on the maintainer's machine, where the default is 20.20.0 with 22.23.2 sitting
installed alongside it.

`.npmrc` sets `engine-strict=true`, so **`npm install` and `npm ci` refuse** on a wrong runtime
rather than warning — verified on npm 10.8.2, which fails with "Unsupported engine" naming
required and actual. **`npm run` is not gated by it.** Also verified: a script ran happily on
v20.20.0 with the flag set. So every command below will still execute, and pass, on an
unsupported Node, and `node -v` remains a step you do rather than one the tooling does for you.

If `nvm` is not on `PATH` (a non-interactive shell, or an agent's shell that does not source the
profile), select the binary directly rather than giving up and using the default:

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

Node 20 does not obviously break anything today — the suite gives identical results on both, as
of 2026-09-03. That is exactly why this is worth writing down: nothing will tell you. But
`@inrupt/solid-client-authn-core@5.0.0` declares `^22.0.0 || ^24.0.0`, so from phase 2 onward —
the first code that actually loads the auth library — a Node 20 run is unverified rather than
merely untidy. **Reporting "the checks pass" from an unsupported runtime is a half-check**, in
the specific sense the definition of done above means it.

**The package manager is not dictated** — see `docs/decisions.md` §21. Run these with whichever
one the checkout uses: `pnpm <script>`, `npm run <script>`, `yarn <script>`, `bun run <script>`.
The script *names* are the contract; the runner is not.

```
dev                  # Next dev server
build                # production build
start                # serve the production build (`next start`); smoke-testing a build locally
test                 # vitest
test:e2e             # playwright: the login redirect, and the media pipeline's real bytes
lint                 # eslint
typecheck            # tsc --noEmit
validate:fixtures    # tsx scripts/validate-fixtures.ts
check:vocab          # lib/vocab.ts vs docs/data-model.md, both directions
check:commands       # the commands above vs package.json
check:structure      # layout, comment length, notes.md pointers; reports length drift
size:public          # gzip budget on what a public page ships; the only bundle budget, CI runs it
pod:dev              # local Community Solid Server
pod:seed             # seed it with the docs/data-model.md fixtures
```

`validate:fixtures` must pass. It parses every Turtle block in `docs/data-model.md`,
checks IRI resolution, and rejects blank nodes and wrong datatypes.

## Testing

- Unit tests against an in-memory fake Pod at the repository interface.
- HTTP-level tests with MSW.
- Integration tests against the local Community Solid Server.
- Playwright only for what cannot be meaningfully tested faster — never a slow duplicate of a
  fast test. Two flows clear that bar, as of 2026-09-06: the Solid login redirect, which cannot
  be unit-tested at all, and the media pipeline's uploaded bytes, which cannot be inspected
  anywhere else. jsdom has no `createImageBitmap`, no `OffscreenCanvas` and no encoder, and a
  jsdom `Blob` reaches MSW as the nine bytes of `"undefined"` — measured 2026-09-06. The rule
  has not been relaxed; the set of things that clear it grew by one, and the next addition has
  to earn it the same way, by measurement.
- Compare RDF by **graph isomorphism**, never bytes. Turtle has no canonical form; a
  byte-comparison test will be permanently red.

## Ask before doing

- Changing, adding, or renaming any `dy:` predicate or class.
- Changing the Pod container layout.
- Adding a dependency that requires an account, API key, or paid tier.
- Introducing any server-side session or credential store.
- Changing the access-control mechanism or its interface.
- Anything that puts a database in the stack.

## Current phase

**Phase 0** — the spike in `docs/phase-0-spike.md`. Answer its seven questions, record the
results, then delete the spike code. No feature work until it is done.

Then **phase 0.5**, the installation and setup checklist in `TODO.md`. It pins every version
and includes the theme tokens, the guardrail lint rules, and the local Pod command. Work
through it in order rather than scaffolding from memory — several steps exist specifically to
undo defaults that `create-next-app` and `shadcn init` get wrong for this project.

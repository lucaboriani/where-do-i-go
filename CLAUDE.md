@AGENTS.md

# CLAUDE.md

Rules and invariants for this repository. Read every session. Dense on purpose.

## This file, AGENTS.md, and the Next.js managed block

`next dev` on Next 16.3+ writes a managed block of Next.js agent rules, delimited by
`<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->`. It never truncates
existing content — it replaces the block in place if the markers are present, otherwise
appends it to the end of the file.

Which file receives it, per `node_modules/next/dist/server/lib/generate-agent-files.js`:

- If `AGENTS.md` exists, the block goes there and `CLAUDE.md` is left alone.
- If only `CLAUDE.md` exists, the block is appended to *this file*.
- If neither exists, it creates `AGENTS.md` with the block and `CLAUDE.md` containing
  `@AGENTS.md`.

**This repository keeps an `AGENTS.md`, so the managed block lives there and never touches
this file.** `CLAUDE.md` imports it via `@AGENTS.md` at the top, so the Next.js rules are
still in context. Do not delete `AGENTS.md`, or the block starts landing here.

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

Work is **not done** until all of these pass. Run them, read the output, and only then say so:

```
npm test                  # vitest — unit, integration, guardrails
npm run lint              # eslint, including the project guardrails
npm run typecheck         # tsc --noEmit
npm run validate:fixtures # the normative Turtle in docs/data-model.md
npm run check:vocab       # lib/vocab.ts vs the data model, both directions
npm run check:commands    # this file's commands vs package.json
npm run build             # reads the Pod; needs one running
npm run size:public       # what a public page actually ships
```

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
- Studio pages are thin server components rendering a dynamically imported client shell with
  SSR disabled.
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

## Commands

**The package manager is not dictated** — see `docs/decisions.md` §21. Run these with whichever
one the checkout uses: `pnpm <script>`, `npm run <script>`, `yarn <script>`, `bun run <script>`.
The script *names* are the contract; the runner is not.

```
dev                  # Next dev server
build                # production build
test                 # vitest
test:e2e             # playwright, login flow only
lint                 # eslint
typecheck            # tsc --noEmit
validate:fixtures    # tsx scripts/validate-fixtures.ts
check:vocab          # lib/vocab.ts vs docs/data-model.md, both directions
check:commands       # the commands above vs package.json
size:public          # gzip budget on what a public page ships
pod:dev              # local Community Solid Server
pod:seed             # seed it with the docs/data-model.md fixtures
```

`validate:fixtures` must pass. It parses every Turtle block in `docs/data-model.md`,
checks IRI resolution, and rejects blank nodes and wrong datatypes.

## Testing

- Unit tests against an in-memory fake Pod at the repository interface.
- HTTP-level tests with MSW.
- Integration tests against the local Community Solid Server.
- Playwright only for the Solid login redirect, which cannot be meaningfully unit-tested.
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

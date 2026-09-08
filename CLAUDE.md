# MANDATORY RULES

1. **BE CONCISE UNLESS OTHERWISE STATED.**
2. **SIMPLICITY BEATS CLEVERNESS.**

They outrank everything below. A shorter answer and a plainer implementation are the defaults;
length and cleverness have to be asked for. When a rule further down this file could be read two
ways, these two decide it.

---

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

**Keep this file rules, not reasoning.** It is read every session, so every line here is paid
for on every task. A rule belongs here; the measurement, the trap and the argument behind it
belong in a file under `docs/` that this one points at — the way `## Code structure

**Reasoning, measurements and traps: `docs/code-structure.md`.** This section is the rules. Read
that file before arguing with one.

Numbers are **tendencies, then hard bounds**. Both exclude comment-only and blank lines.

| Rule | Tendency | Hard bound | Applies to |
|---|---|---|---|
| Render function | 130 | 200 | `components/**`, `app/**` |
| Util / lib function | 50 | 80 | `lib/**`, `scripts/**` |
| Inline comment block | 3 lines | 6 lines (ratchet) | **production code**, except `components/ui/**` |
| Test file | 600 | 1000 | `**/*.test.{ts,tsx}` |
| Test function body | no limit | no limit | — |

- **ESLint errors at the hard bound; `check:structure` reports the tendency and fails on none of
  it.** That is "tend to, not a dictate" made mechanical. **Do not tighten the lint rules to the
  tendency values.**
- **`npm run lint` carries `--max-warnings 0`**, so a stale `eslint-disable` fails the build
  rather than warning. That is how an exemption leaves when its function shrinks.
- **The comment bound binds production code; test docblocks are exempt but still ratcheted.**
  Two numbers: production goes to zero, test is frozen. Neither may rise.
- **Comments say what the code cannot, in three lines or fewer.** Anything longer moves to a
  sibling `notes.md`, and the code keeps `// <one line>; see ./notes.md#anchor`. An anchor that
  does not resolve fails `check:structure`. Notes cite `docs/data-model.md` by section rather
  than restating it. One exception: a trap warning at the point of danger stays inline, as one
  shouted line plus a pointer.
- **One component, one folder** — named file, one-line `index.ts` barrel, its test, its
  `notes.md`. The rule binds `.tsx`; flat `state/` and `hooks/` modules beside it are fine. A
  barrel re-exports one component, never a directory of them. `components/ui/**` stays flat.
- **`lib/` holds no React.** Pure and reusable goes to `lib/studio/<topic>/`; presentation stays
  in the component folder.
- **Tests live beside their subject** — same directory, base name matching the part before the
  first dot. Three kinds have no subject and stay in `test/`: the shared harness, the Pod
  integration suites in `test/integration/`, and the tests whose subject is the repository
  itself. `check:structure` carries that list and fails on a name in it that no longer exists.
- **An exemption is a comment with a reason and a removal condition**, never a bare disable:

```ts
/* eslint-disable-next-line max-lines-per-function --
   Stage B decomposes this; see docs/code-structure.md. Remove with the reducer. */
```

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

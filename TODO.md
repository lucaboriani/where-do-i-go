# TODO

Ordered. Do not start a phase before the one above it is finished.

Checkboxes are for the implementing session to tick. Where a step has a verification
criterion, the box is not ticked until the criterion is observed, not until the code is
written.

---

## Phase 0 — spike

See `docs/phase-0-spike.md` for the seven questions, how to test each, and the results table.

- [x] Answer questions 1–6, against **both** Community Solid Server (WAC) and a hosted Inrupt
      ESS Pod (ACP)
- [x] Fill in the results table with reasoning, not just verdicts
- [x] Update `docs/data-model.md` §13 to match
- [x] Decision 4 did **not** need reopening — per-resource override works on both mechanisms.
      Outcome recorded as decisions 19 and 20, and §7.5 rewritten from what phase 0 disproved.
- [ ] **Question 7 moved to phase 5.** It requires a Netlify deploy preview, which requires an
      app, which is phase 0.5 — so it could never be answered while phase 0 was open. It is now
      part of the OG-image task in phase 5, where the deploy exists.
- [ ] **Delete the spike code.** Kept for now: the hosted `rebuildIndex` cost at ~200 entries
      and the ACP equivalent of the container-listing fix are both still unmeasured, and the
      harness is what measures them.

**Carried into later phases, do not lose these:**

- The ACP equivalent of closing the container listing (WAC's `acl:default` without
  `acl:accessTo`) is untested. Until it is, assume draft slugs are public on a hosted Pod.
- A static `client-id.jsonld` cannot be exercised from localhost against a hosted provider — the
  identity provider must be able to fetch it. Dynamic registration is the fallback and it showed
  a bare UUID on the consent screen and broke session restore. Phase 2 needs a deployed origin
  before the login flow can be validated end to end.

**Blocker before any of this touches a live Pod:** the `dy:` namespace is still
`https://example.org/ns/traveldiary#`. Local Community Solid Server data is disposable, so
spiking against that is fine. See `CLAUDE.md`.

---

## Phase 0.5 — installation and setup

Every version below is pinned from `docs/versions.md`, resolved 2026-09-02. Re-resolve if
that date is stale, and commit the lockfile either way.

### Read first: scaffolding order and agent files

Two separate things happen here. Get the order right and neither is a problem.

**`create-next-app` aborts rather than overwrites.** It refuses to scaffold into a directory
containing unexpected files, printing "contains files that could conflict". Its tolerated
list, verified against `create-next-app@16.3.4`, is: `.claude`, `.cursor`, `.DS_Store`,
`.git`, `.gitattributes`, `.gitignore`, `.gitlab-ci.yml`, `.hg`, `.hgcheck`, `.hgignore`,
`.idea`, `.npmignore`, `.travis.yml`, `.vscode`, `.zed`, `LICENSE`, `Thumbs.db`, `docs`,
`mkdocs.yml`, the npm/yarn debug logs, `yarnrc.yml` and `.yarn`.

So `docs/`, `.claude/`, `.git` and `.gitignore` may stay. Everything else blocks it. In this
repository that meant **eight** entries, not the five originally listed here: `CLAUDE.md`,
`AGENTS.md`, `README.md`, `TODO.md`, `scripts/`, and also **`.nvmrc`, `.env.spike` and
`where-i-go.zip`** — none of which are on the tolerated list. Enumerate the directory against the
list above rather than trusting a remembered set.

**`.gitignore` is tolerated but overwritten.** `create-next-app` replaces it wholesale with its
own. Merge yours back afterwards — and note its generated `.env*` line would exclude the
`.env.example` this phase requires you to commit, so the `!.env.example` negation has to be
re-added.

**`create-next-app` also generates `AGENTS.md` and `CLAUDE.md` itself**, programmatically
rather than from a template. Pass `--no-agents-md` and there is nothing to merge at scaffold
time — `next dev` adds the managed block afterwards anyway.

Do this:

- [x] Move `CLAUDE.md`, `AGENTS.md`, `README.md`, `TODO.md` and `scripts/` aside — into
      `docs/`, which is tolerated, or one directory up. Leave `docs/`, `.git`, `.gitignore`
      and `LICENSE` in place.
- [x] Scaffold with `--no-agents-md` (next section).
- [x] Move the five back.
- [x] **Merge the two READMEs.** `create-next-app` writes its own with generic dev-server
      boilerplate. The project README wins on structure and content; fold in only what is
      useful, realistically just the dev-server command, then delete the generated version.
      Do not keep both, and do not let boilerplate end up at the top of the file.
- [x] Confirm `AGENTS.md` is present before the first `next dev`. It is the designated host
      for the Next.js managed block, and if it is missing the block lands in `CLAUDE.md`
      instead.

### The Next.js managed block

`next dev` on 16.3+ writes a block of Next.js agent rules delimited by
`<!-- BEGIN:nextjs-agent-rules -->` / `<!-- END:nextjs-agent-rules -->`. Verified behaviour
from `node_modules/next/dist/server/lib/generate-agent-files.js`: it replaces its own block in
place when the markers exist, otherwise appends. **It never truncates existing content.**
Routing is: `AGENTS.md` if present, else `CLAUDE.md` if present, else both are created fresh.

- [ ] After the first `next dev`, confirm the block landed in `AGENTS.md` and that `CLAUDE.md`
      is untouched apart from its `@AGENTS.md` first line.
      **Checked 2026-09-03: it has NOT landed.** `AGENTS.md` contains neither marker, though
      its closing paragraph already promises "the Next.js managed block below". `CLAUDE.md`
      does contain the marker text, but inside a backtick span in its own prose describing the
      mechanism — not as a real block. So `CLAUDE.md`'s claim that "the managed block lives
      there and never touches this file" is currently aspirational rather than observed.
      Likely cause: the block is written by `next dev`, and this session only ran `next build`.
      Run `next dev` once and re-check both files before ticking this.
- [ ] Commit the block with the work that triggered it. Stripping it from a diff only
      recreates it as an uncommitted change next run.
- [ ] Do not set `agentRules: false`. Next's benchmarks show agents perform better with the
      bundled docs in context.

### Next.js agent tooling

Worth setting up before feature work, because this app's worst failures happen in the browser
where server logs cannot see them.

- [ ] Confirm version-matched docs are present at `node_modules/next/dist/docs/` after install.
      This is what replaces guessing from training data; Next 16 differs substantially from
      most of it.
- [x] Enable `logging.browserToTerminal` in `next.config.ts` so browser console errors and
      warnings reach the terminal. MapLibre and Solid-OIDC failures are client-side.
      Verified present in `next.config.ts` alongside `cacheComponents` and
      `partialPrefetching`.
- [ ] Confirm the Next.js MCP server responds at `/_next/mcp` on the running dev server, and
      use `get_compilation_issues` / `compile_route` instead of a full `next build` when the
      question is only whether something compiles.
- [ ] Install the dev-loop skill for a repeatable inspect-edit-verify cycle:

      npx skills add vercel/next.js --skill next-dev-loop

- [ ] Note that `next dev` records its PID, port and URL in `.next/dev/lock`. Connect to the
      running server rather than starting a duplicate.
- [ ] For opaque build failures, use `next build --debug-prerender`.

### Cache Components — decide early

Cache Components changes how uncached data access behaves: reading data outside a `<Suspense>`
boundary blocks prerendering and raises a labelled error offering `"use cache"`, a Suspense
fallback, or an opt-out.

Every public page in this project reads from the Pod, so this is not a corner case — it is the
main render path. The good news is that `"use cache"` with tag-based revalidation is already
the design: the studio calls a revalidation hook after each save, which is exactly what the
cached-and-invalidated model expects.

- [x] **Decided: enable it, from the first scaffold.** See `docs/decisions.md` §22, which closes
      §18. `cacheComponents: true` and `partialPrefetching: true`; `use cache` with `cacheTag`,
      invalidated by the studio's revalidation hook calling `revalidateTag`.
      **`'use cache: remote'` is rejected** — it incurs platform fees and needs a `cacheHandlers`
      implementation when self-hosting, contradicting the no-API-keys and host-neutral rules.
- [x] Set both flags in `next.config.ts` during the scaffold step, not later.
- [ ] Read the bundled caching guide at `node_modules/next/dist/docs/01-app/01-getting-started/`
      `08-caching.md` first, and treat the labelled error menu as the specification for which fix
      to apply per route.
- [x] No route may set `runtime = 'edge'`. Cache Components requires the Node runtime.

### Prerequisites

- [x] **Node 22 LTS.** Write `.nvmrc` containing `22.23.2`. **Not 24, and not 20** — the two
      Inrupt packages disagree: `@inrupt/solid-client@3.0.0` declares
      `^20.0.0 || ^22.0.0` and `@inrupt/solid-client-authn-core@5.0.0` (transitive, via
      `solid-client-authn-browser`) declares `^22.0.0 || ^24.0.0`. The 22 line is the only
      overlap, and `jsdom@30.0.1` (`^22.22.2`) sets the floor inside it. Verified against the
      registry in phase 0; full reasoning in `docs/versions.md`.
- [x] **`.npmrc` sets `engine-strict=true`** so a wrong runtime is refused rather than warned
      about. Measured on npm 10.8.2: `npm install` exits 1 on Node 20.20.0 with "Unsupported
      engine" naming required and actual, and exits 0 on 22.23.2. **It does not gate
      `npm run`** — a script ran happily on v20.20.0 with the flag set — so `node -v` before
      the definition-of-done commands stays a manual step. CI is already safe: the workflow
      pins via `node-version-file: .nvmrc`.
- [x] **A package manager of your choice** — pnpm, npm, yarn or bun. Whichever you pick, use it
      for everything in this checkout and commit its lockfile; never mix two. The commands below
      are written with pnpm, so substitute the equivalent (`npm run <script>`, `yarn <script>`,
      `bun run <script>`; `npx` or `bunx` for `pnpm dlx`).
- [ ] Docker is optional. The local Pod runs fine without it (see below).

### Scaffold

- [x] Create the app:

      pnpm create next-app@16.3.4 . --ts --app --tailwind --eslint \
        --use-pnpm --no-src-dir --import-alias "@/*" --no-agents-md

      Swap `--use-pnpm` for `--use-npm`, `--use-yarn` or `--use-bun` to match your choice —
      the flag decides which lockfile the scaffold generates.

- [x] **Set TypeScript to 6.0.3.** This is a move *up* from the scaffold default, not a
      rescue. Verified in phase 0: `create-next-app@16.3.4` writes `"typescript": "^5"` into
      the generated `package.json` and installs 5.9.3 — already inside
      `typescript-eslint@8.69.0`'s peer range (`>=4.8.4 <6.1.0`), so nothing is broken on
      arrival and nothing is urgent here:

      pnpm add -D typescript@6.0.3

      TypeScript's `latest` is 7.0.2, but nothing in this scaffold reaches for it. Do not
      install it — it falls outside the typescript-eslint peer range. See `docs/versions.md`.

- [x] Verify: the `typecheck` and `lint` scripts both run clean before adding anything else.

### Runtime dependencies

- [x] Install, exact versions:

      pnpm add maplibre-gl@6.6.0 react-map-gl@8.1.2 \
        @inrupt/solid-client@3.0.0 @inrupt/solid-client-authn-browser@5.0.0 \
        zod@4.5.4 exifreader@4.44.0

- [x] **Do not install `exifr`.** It was last published in 2022. If generated code reaches
      for it, that is stale training data — replace with `exifreader`.
- [x] `n3@2.7.2` — **required**, not optional. `scripts/validate-fixtures.ts` uses it, and it is
      the parser behind every Pod read. See `docs/decisions.md` §23.

### Dev dependencies

- [x] Install:

      pnpm add -D vitest@4.1.11 @vitest/coverage-v8@4.1.11 \
        @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 jsdom@30.0.1 \
        @playwright/test@1.62.1 msw@2.15.0 \
        typescript-eslint@8.69.0 prettier@3.9.6 tsx@4.23.13 \
        size-limit@13.0.3 @size-limit/preset-app@13.0.3

- [x] `pnpm exec playwright install chromium` — only Chromium is needed, for the login flow.

      **The earlier "verified installed (`chromium-1223`)" here was wrong, and it is the
      reason this looked done for two days.** A browser in the Playwright cache is only
      installed *for the Playwright that wants it*: 1223 and 1208 were left behind by older
      versions, and `@playwright/test@1.62.1` asks for **chromium-1234**
      (`node_modules/playwright-core/browsers.json`). The first real launch failed with
      "Executable doesn't exist at …/chromium_headless_shell-1234/…". Re-running
      `playwright install chromium` fetched 1234 and it works. On an upgrade, check the
      revision rather than the presence of a directory.

### shadcn/ui — studio only

- [x] Initialise:

      pnpm dlx shadcn@latest init

      Template `next`, base colour `neutral`. **Not** `npx shadcn-ui` — that package name is
      dead.

- [x] Add only what the studio needs. Resist adding the whole registry:

      pnpm dlx shadcn@latest add button input textarea select dialog drawer \
        tabs popover command switch tooltip sonner

- [x] Confirm `sonner` is used for toasts. shadcn's own `toast` component is deprecated.
- [ ] Note that `drawer` pulls in `vaul`, last published 2024-12. Verify its snap-point API
      against current shadcn docs, not blog posts. This component is the mobile map sheet.
- [ ] Restyle rather than tweak: radius near zero, borders and background steps instead of
      shadows, focus rings in `accent`. See `docs/design-brief.md`.

### Theme tokens

- [x] Replace the generated CSS variables in `app/globals.css` wholesale with the palette from
      `docs/design-brief.md`. Tailwind v4 is CSS-first — there is no `tailwind.config.js`
      theme block to edit:

      @import "tailwindcss";
      @import "shadcn/tailwind.css";

      @theme {
        --color-bg:            oklch(0.145 0.012 250);
        --color-surface:       oklch(0.195 0.014 250);
        --color-hairline:      oklch(0.300 0.018 250);
        --color-text-muted:    oklch(0.680 0.012 250);
        --color-text:          oklch(0.920 0.006 250);
        --color-accent:        oklch(0.660 0.182 250);
        --color-accent-bright: oklch(0.790 0.107 250);
        --color-accent-deep:   oklch(0.420 0.117 250);
      }

- [x] Map the shadcn variables (`--background`, `--foreground`, `--primary`, `--ring`, …) onto
      these tokens at `:root`. **Not under a `.dark` class** — the site is fixed dark, so
      there is no toggle and no flash of wrong theme.
- [x] Delete any generated light-mode block.

### Project structure

- [x] Route groups with **separate root layouts**:

      app/(public)/layout.tsx
      app/(studio)/layout.tsx

      Separate layouts are what keep the bundles apart. A single shared root layout importing
      a session provider would undo the whole boundary in one line.

- [x] Pod layer split along the same seam:

      lib/pod/read.ts      unauthenticated, imported by both
      lib/pod/write.ts     studio only
      lib/pod/access.ts    studio only, the four-method ACL interface
      lib/vocab.ts         every IRI as a named constant

- [x] Generate `lib/vocab.ts` from `docs/data-model.md` §3 and keep it the only source of IRIs.

### Guardrail enforcement

- [x] ESLint `no-restricted-syntax` banning raw vocabulary IRIs outside `lib/vocab.ts`:

      {
        selector: "Literal[value=/^https?:\\/\\/(schema\\.org|purl\\.org|www\\.w3\\.org|example\\.org\\/ns)/]",
        message: "Import the IRI from lib/vocab.ts instead of writing it inline."
      }

- [x] ESLint `no-restricted-imports` so nothing outside `lib/pod/access.ts` imports ACL
      primitives, and nothing under `app/(public)` imports `@inrupt/solid-client-authn-browser`,
      Radix, or anything from `app/(studio)`.
- [x] Exempt `components/ui/**` from the arbitrary-Tailwind-values rule. shadcn's copied source
      uses them freely and fighting it wastes time.
- [x] Bundle budget, failing CI. **Now measures public routes specifically.**
      `size-limit` globs files and cannot answer "what does a public page ship", so
      `scripts/check-public-bundle.ts` derives the script list from each prerendered public
      page's HTML and sums it gzipped. Chunk names are content-hashed, so deriving beats
      hardcoding, and `[slug].html` is a zero-byte PPR shell — the file that matters is the one
      built for a real param.
      - [x] Ceiling set from the first real build: worst public route 173.3 kB gzip, budget 180.
            Verified all of it is React and the Next runtime by scanning every loaded chunk for
            radix / inrupt / maplibre / exifreader — none present.
      - [x] Verified the budget actually fails, by running it under the real size.
      - [x] **Ceiling raised to 190 (2026-09-03), and the "only ever lower it" rule replaced
            rather than broken.** The worst public route had reached 176.3 kB, leaving 3.7 kB —
            less than the framework has already moved on its own, since the streaming-routes
            change cost +3.0 kB with no code of ours involved. All eight loaded chunks were
            broken down and scanned again: still React 19 and the Next 16 runtime end to end.
            A ceiling that fails on Next's growth rather than ours teaches people to raise it,
            which is the actual way a budget dies.
      - [x] **Composition check, which is what makes a generous ceiling safe.**
            `findStudioDeps` scans the chunks a public page loads for studio-only dependencies
            by NAME and fails on any hit, at any size. Weight was the wrong question: `cmdk` is
            11.0 kB gzip and `sonner` 28.9, so neither would ever trip a ceiling.
            - Markers are not package names. Grepping a real chunk for `n3` hits React's
              minified DOM code (`n2={},n3={}` … `n3=document.createElement("div").style`), and
              a guardrail that cries wolf on the framework gets switched off. Hence:
              identifier-shaped markers ≥ 8 characters, markers containing `-` or `/` ≥ 6, and
              never the bare lowercase package name. The floor is measured, not guessed — of
              every mangled identifier in this project's chunks, 7483 are 1 character, 1839
              are 2, 14 are 3, 546 are 4, and nothing mangled is longer.
            - Markers must survive bundling. Every `@radix-ui/...` occurrence in the primitives
              is an import specifier a bundler resolves away, so radix is caught by
              `--radix-` / `data-radix-` instead.
            - `test/public-bundle.test.ts` checks every marker in both directions against the
              real builds in `node_modules`, so a library upgrade that changes its output turns
              the suite red rather than leaving the list silently matching nothing.
            - [x] Verified it fails: 512 bytes of the real `exifreader` build appended to a
                  public chunk → exit 1, naming the dep, the chunk and the marker. The size
                  moved 176.3 → 176.5 kB, i.e. the ceiling would never have seen it.
      - [x] **`_not-found` and `_global-error` are measured too.** They were excluded, and
            should not have been: `app/not-found.tsx` is a page every 404 renders, and a review
            found it fenced by neither this budget nor the import boundary. Adding them changed
            the worst route not at all (173.3 and 169.7 kB against 176.3). `app/not-found.tsx`
            and `app/global-error.tsx` are now in the eslint public-boundary block as well —
            they sit outside `app/(public)/**` because Next requires them at the app root.
      - [x] **The public lint fence was banning a spelling this project does not use.** The
            group listed `@radix-ui/*`, but `package.json` depends on `radix-ui` ^1.6.7 — the
            unified package — and all seven Radix imports under `components/ui/**` are
            `from "radix-ui"`. The spelling the repo actually writes lint-passed on every public
            path. `test/guardrails.test.ts` had only ever exercised the scoped form, so the
            suite was green on a fence with a hole in it. Group is now
            `["radix-ui", "radix-ui/*", "@radix-ui/*", "vaul", "sonner", "cmdk"]`.
            Worth knowing for the next person who edits these: `no-restricted-imports` matches
            `group` with **gitignore semantics, not minimatch**, so the bare name is a superset
            of the subpath glob — `["radix-ui"]` blocks `radix-ui/dialog`, while `["radix-ui/*"]`
            does *not* block bare `radix-ui`. The subpath entry is deliberate redundancy, not
            load-bearing.
      - [x] **`next-themes` added to the fence.** `components/ui/sonner.tsx` is its only
            importer, there is no `ThemeProvider` in the tree, and the theme is fixed dark at
            `:root` with no toggle — nothing public can legitimately want it.
      - [x] **The `(studio)` route-group and `exifreader`/`lib/media` groups are now pinned.**
            Both were correct and both untested; the `(studio)` globs contain literal
            parentheses that nothing else would notice breaking.
      - [x] **Both guardrail scripts were mutation-reviewed, 2026-09-04, and ten findings fixed.**
            They had shipped without independent review. Every defect was found by applying a
            wrong implementation and watching the check stay green — none by reading.
            - **The studio exclusion was an unanchored substring test on the absolute path.** A
              trip titled "Studio Ghibli Museum" was dropped from both the ceiling and the leak
              scan — slugs derive from titles — and a checkout under any directory named
              `studio` excluded every page. Now matched against the route-relative path, and
              every exclusion is printed with its reason instead of happening silently.
            - **The enforcement path had no test at all.** Six one-line sabotages — CLI guard
              disabled, exit code removed, ceiling raised to 100000 kB, `href=` preloads dropped,
              zero-bytes guard removed, studio exclusion removed — all left the suite green. CI
              would have stayed green with the check switched off. `test/public-bundle-cli.test.ts`
              and `test/check-commands.test.ts` are child-process harnesses against synthesised
              `.next` fixtures; all six now turn them red.
            - **The CLI entry guard failed open** under a symlinked absolute path and an
              extensionless invocation — zero output, exit 0. Both sides are canonicalised now,
              and a mismatch is loud. Its comment was wrong too: `import.meta.main` IS available
              on Node 22; `tsx` leaving it `undefined` is the real reason it cannot be used.
            - **A referenced chunk missing on disk was dropped silently** while the report still
              printed the original file count, so "2 files, 93.3 kB" described one file. Fatal
              now, and it names the reference. Same for a page the extraction found no scripts
              on at all — the zero-bytes guard was global and never fired while one other page
              had scripts.
            - **`check:commands` graded whatever untagged fence came first** and its sentinel did
              not close the hole its own comment claimed: a decoy naming `test` and `build`
              passed while nine of twelve commands went ungraded. More than one untagged fence in
              the section is now fatal — there is no reliable way to tell a decoy from the list,
              so it refuses to guess. It also runs **both directions** now: `npm run size`, which
              CI invokes, and `start`, which `netlify.toml` and the `Dockerfile` name, were both
              invisible to the contract.
            - **`"solid-client-authn"` never survived bundling**, violating the file's own
              "markers must survive bundling" rule — it lives only in an import specifier and a
              sourcemap comment. Dropped; `handleIncomingRedirect` covers the dep. The
              survives-bundling test now runs against every dep, not just Radix.
            - **The measurements justifying the whole second guardrail were wrong.** The gzip
              figures had been taken as the sum of ESM + CJS + dev builds: cmdk 11.0 is really
              17.1, sonner 28.9 is 9.6, vaul 33.9 is 21.4, maplibre 777.9 is 252.8. That inverts
              the conclusion — with 13.7 kB of headroom sonner is the one that slips through, and
              cmdk and vaul both trip. The identifier histogram was not reproducible either; the
              real number is 54 distinct one-character names, the base-54 mangler alphabet
              exhausted, and 2,107 distinct tokens of eight characters or more. The `>= 8` floor
              survives, but because long tokens are *preserved* names a mangler cannot
              synthesise — not because "8 is double the longest observed", which was false.
            - **`esbuild` was imported by the test suite and declared nowhere.** It resolved only
              as `tsx`'s transitive at an unpinned range — the comment blaming vite was wrong,
              vite 8 bundles with rolldown. Under pnpm's isolated layout the import would not
              resolve and the file would fail to load, silently taking the marker guardrail with
              it. Now a pinned devDependency.
      - [ ] **`test/setup.ts`'s network guard does not guard.** Its comment says "An accidental
            real network call must fail the test, not quietly succeed." It does not: MSW's
            `onUnhandledRequest` handler calls `print.error()`, which writes to stderr, and
            vitest does not fail on stderr. Measured twice on 2026-09-04 — once by a test agent
            (`REACHED THE REAL NETWORK: status=200 bytes=777`) and once directly, with a
            throwaway spec that fetches `https://example.com/` and reports `1 passed`. So every
            test in this suite relying on that guard to catch a stray fetch is relying on
            nothing, and a unit test can silently depend on the live internet. Fix by throwing
            from `onUnhandledRequest` rather than printing — keeping the deliberate localhost
            exemption the Pod integration tests need — and pin it with a test that asserts an
            unhandled request FAILS. Expect the fix to expose tests that were quietly reaching
            the network; those are findings, not breakage.
      - [ ] **Nothing checks that the Zod schemas cover the normative shapes**, and that gap has
            already cost something. `lib/pod/schema.ts`'s `Entry` has neither `dcterms:created`
            nor `dcterms:creator`, both of which §7.3 carries and describes as deliberately
            non-redundant — "created is when the record came into being and datePublished is
            when it became public". So `readEntry` silently drops them, and the first
            read-modify-write in the studio would have destroyed them permanently. `readTrip`
            reads `created`, so it is an inconsistency, not a policy.
            Neither existing guardrail could see it: `check:vocab` compares `lib/vocab.ts`
            against the data model and both terms ARE in vocab, and `validate:fixtures` parses
            the §7 Turtle without asking whether any schema covers it. The missing check is the
            third edge of that triangle — every predicate in a §7 block should appear in the Zod
            schema for that resource, or be listed as a deliberate omission with a reason.
      - [ ] The ceiling may still only rise for **framework** cost, and only with the per-chunk
            breakdown to prove that is what it is. Never for our own code: anything of ours on
            a public route is a boundary failure, and the fix is the import. Lowering is always
            allowed. Re-derive `BANNED_DEPS` and the eslint public block together whenever a
            studio dependency is added — a dependency on neither list is invisible to every
            check in this repository.

### Local Pod

- [x] Run Community Solid Server pinned, no Docker needed:

      pnpm dlx @solid/community-server@7.2.0 -p 3001 -c @css:config/file.json -f ./.pod-data

- [x] Add `.pod-data/` to `.gitignore`.
- [x] Wire it as the `pod:dev` script and use it for all development and CI. Do not develop against
      a live Pod.
- [x] Note which access-control mechanism it uses versus the hosted Pod, and confirm
      `lib/pod/access.ts` covers both. **Done in phase 0**: CSS is WAC, Inrupt ESS is ACP, and
      `universalAccess` handled both with identical calling code. Do not branch on mechanism —
      `rel="acl"` does not mean WAC. See `docs/decisions.md` §19.

### Configuration

- [x] `.env.example`, committed, with every variable and a comment each:

      OWNER_WEBID=
      POD_ROOT=
      SITE_NAME=
      SITE_URL=
      MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
      REVALIDATE_SECRET=

- [ ] Verify the OpenFreeMap style URL against their current docs before committing it as the
      default.
- [x] `next.config.ts`: add the Pod host to `images.remotePatterns`. Without it `next/image`
      refuses Pod-hosted photos.
- [x] Serve `client-id.jsonld` from the app origin, generated from config rather than
      hardcoded, since each deployer serves it from their own domain.

### Scripts and CI

- [x] `package.json` scripts exactly as listed in `CLAUDE.md`, so the two files cannot drift.
- [x] CI runs: `lint`, `typecheck`, `test`, `validate:fixtures`, `size-limit`, `build`.
- [ ] `validate:fixtures` must pass from a clean checkout. Verify it now — it is already
      written and already passes. It runs on `tsx` and `n3`, both already in the dependency
      list; there is no second language runtime to install.
- [x] Add a CI check asserting every `dy:` term in `docs/data-model.md` matches the exports in
      `lib/vocab.ts`, in both directions. This is what stops the data model rotting.
- [x] Add a CI check that every command named in `CLAUDE.md` exists in `package.json`.
- [x] `.nvmrc`, `.prettierrc`, `netlify.toml`, `Dockerfile`.

### Done when

- [x] `build` succeeds
- [x] `test`, `lint`, `typecheck` and `validate:fixtures` all pass
- [x] Local Pod starts and the app reads one hand-written resource from it
- [x] A deliberate violation of each guardrail rule fails CI — test the enforcement, don't
      assume it. **Done for the lint guardrails**: `test/guardrails.test.ts` lints deliberate
      violations at the paths where each rule applies, and asserts the allow-cases too, since a
      rule that rejects everything is useless. 10 cases, all passing.
      - [ ] **Not yet done for the size budget.** See the size-limit item above: the glob still
            measures every chunk, so there is nothing meaningful to violate yet. Do it when the
            budget is narrowed to public routes in phase 1.

---

## Phase 1 — public read path

Against hand-written Turtle placed in the Pod manually. No editor yet.

- [x] `lib/vocab.ts` complete and CI-checked against the data model
- [x] `lib/pod/read.ts` with Zod validation returning typed results or structured errors
- [x] `rebuildIndex(trip)` — build it now, not when it is first needed. It is also the
      migration tool and the recovery path. **Built, but four of §10's five clauses only**: it
      does not verify each kept entry's ACL matches its status, which is the clause that
      recovers "published but unreadable". See the guardrail section — fixing it needs the
      `write.ts` <-> `access.ts` import cycle broken first.
- [x] Trip index page and entry page, server-rendered
- [x] Slug resolution plus the slug-equals-container-segment invariant asserted
- [x] Sitemap, RSS, metadata

**Cache Components consequence — handle this deliberately, it is a build-breaker.**

`generateStaticParams` must return **at least one param**; returning `[]` raises
`empty-generate-static-params`, and `dynamicParams` is not supported (`docs/decisions.md` §22).
Trip slugs come from the Pod, so:

- [x] `generateStaticParams` for `/trips/[slug]` reads the diary root's trip list at build time.
      This couples every deploy to Pod availability — accept it knowingly. Present on both
      `/trips/[slug]` and `/trips/[slug]/[entry]`.
- [ ] **STILL OPEN (not stale).** Decide and implement the empty-Pod case. A deployer who has not written a trip yet
      currently gets a **failed build, not an empty site**, which is a terrible first run for the
      "fork it and deploy" promise. Either seed a placeholder param, or fail with an explicit
      message naming the fix ("create your diary root and one trip, then redeploy") rather than
      Next's raw error. Record which in `docs/decisions.md`.
- [ ] **STILL OPEN (not stale).** Decide what a build does when the Pod is unreachable, as distinct from empty. Failing is
      defensible; failing with an unreadable stack trace is not.
- [x] Confirm the App Shell path: a trip published after the build should be served the shell and
      upgraded in the background, with no redeploy. **Verified** — the build's route table shows
      known params as `○ (Static)` and unknown ones as `◐ (Partial Prerender)`.

- [x] **Soft 404 on unknown slugs — fixed in `proxy.ts`.** Under PPR the shell is flushed
      before the dynamic part resolves, so `notFound()` in a page cannot set the status.
      Neither `instant = false` nor an in-page slug check works; both were tried and measured.
      The check now runs in `proxy.ts`, which executes before rendering, and fails open so a
      Pod outage never 404s real content. See `docs/decisions.md` §24.

**Known limitation carried from phase 1 — draft trips return a soft 404.**
A guessed URL for an unpublished trip (`/trips/<draft-slug>`) returns HTTP 200 while rendering
the not-found page. Its name, description and metadata do not leak — verified — but the status
is wrong, for the same reason as `docs/decisions.md` §24: `proxy.ts` allows it through because
`diary.ttl` lists drafts, and `notFound()` in the page body cannot set a status under Partial
Prerendering. Fixing it properly means the proxy reading `dy:status` per trip, which costs a
fetch per trip in a file that must stay small. Accepted for now because drafts are linked from
nowhere and leak nothing; revisit with the publish flow.

## Phase 2 — studio

In progress on branch `phase-2-studio`.

- [x] **`lib/pod/access.ts` — the §5 access-control interface.** Four methods, never branching
      on WAC vs ACP (decisions.md §19). Verifies resulting access by reading it back, because a
      2xx on an ACL write proves nothing (phase-0 question 3).
- [x] **First-run `initialiseContainers()`**, idempotent, verifying resulting access rather
      than assuming writes took effect. Integration-tested against a real Community Solid
      Server, including a re-run after access was tightened. Each container gets its OWN ACL:
      with an ACL on `travel/` alone, an anonymous GET of `travel/trips/` returned 200 and
      listed its children.
- [x] **Static client ID document** at `app/(public)/client-id.jsonld/route.ts`, generated from
      config rather than hardcoded. Still cannot be exercised end to end from localhost — the
      identity provider has to fetch it, so a deployed origin is needed (phase-0 question 2).
- [x] **Session restore across reload**, in `lib/studio/session.ts`. `restoreSession` installs
      its memo synchronously and reads `session.info` after the await, because under React 19
      StrictMode the effect runs twice and the FIRST invocation returned `isLoggedIn: false`.
      A rejection resolves to signed-out and is never memoised.
- [x] **Owner check with the "signed in as X, this diary belongs to Y" message.** `studioState`
      carries both WebIDs; `sameWebId` compares IRIs properly and fails closed, so a mistyped
      `OWNER_WEBID` makes nobody the owner. A courtesy message, not a boundary (decisions.md
      §3, invariant 5).
- [x] **Corrected the studio-shell rule, which did not compile.** `CLAUDE.md` said "thin server
      components rendering a dynamically imported client shell with SSR disabled". Next 16
      rejects that: "`ssr: false` is not allowed with `next/dynamic` in Server Components"
      (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`, and a probe build). The
      shape is **server page → `"use client"` wrapper → `dynamic(…, { ssr: false })`**. Fixed in
      all four places it was written down: `CLAUDE.md`, `app/(studio)/studio/page.tsx` and both
      `.claude/agents/` definitions — the agent files matter most, since leaving them stale
      would have had `nextjs-specialist` build the broken shape and `fullstack-solid-reviewer`
      reject the working one.
- [x] **`login()` / `logout()`, and the studio client shell.** Landed 2026-09-04 as
      `signIn`/`signOut` plus `subscribeSessionState` in `lib/studio/session.ts`, and the
      three-file shape below. 23 component tests; `/studio` still builds `○ (Static)`.
      What follows is the original note, kept because each bullet turned into a test. Deliberately deferred out of the
      session module: they redirect the browser and no test covered them, so they land with the
      shell where a component test can assert the `clientId` actually passed. Build it as the
      three-file shape above. Things found while building the session module and while
      preparing this step —
      - `SolidSessionLike` does not model `session.events`. Without an
        `EVENTS.SESSION_EXPIRED` subscription the studio keeps rendering `owner` after the
        session lapses while every write 401s.
      - `config.ownerWebId` reads a non-`NEXT_PUBLIC_` env var, so the owner WebID must arrive
        at `studioState` as a **prop from the thin server component**. Reaching for `config`
        inside the client shell throws "OWNER_WEBID is not set" in the browser.
      - The same applies to the whole `login()` argument list, not just the owner WebID.
        `app/(public)/client-id.jsonld/route.ts` builds `clientId` as `${SITE_URL}/client-id.jsonld`
        and the redirect as `${SITE_URL}/studio`; `SITE_URL` is not `NEXT_PUBLIC_` either. Pass
        both down as props rather than recomputing from `window.location.origin`, which would
        drift from the client ID document the identity provider actually fetches.
      - A component test needs config work first: `vitest.config.ts` includes only
        `**/*.test.ts`, so a `.tsx` test file is silently never run — this project's known
        "green run that verified nothing" failure mode. `environment` is `node`, and
        `test/setup.ts` does not load `@testing-library/jest-dom`. Fix all three with the test.
      - **`login()` needs an `oidcIssuer` and nothing supplies one.** The library makes
        `oidcIssuer` and `redirectUrl` mandatory (`ILoginInputOptions`, and Session.d.ts says so
        outright), but there is no `OIDC_ISSUER` env var and there should not be: §7.5 already
        says the WebID reliably carries `solid:oidcIssuer`, and `PROFILE.oidcIssuer` is already
        in `lib/vocab.ts` waiting to be used. So the thin server component reads the owner's
        WebID document — a public, unauthenticated read — and passes the issuer down with the
        rest. **`readOwnerProfile` now exists** in `lib/pod/read.ts` (2026-09-04): it follows
        `readDiary` in every respect but three, each pinned by a test because each looks like an
        omission a cleanup would "fix" — the graph subject is the whole WebID rather than
        `<#it>`, there is no `dy:schemaVersion` check because the WebID document is not ours,
        and there is no `rdf:type` gate. `pim:storage` is optional: login needs only the issuer,
        and `POD_ROOT` is an env var today.
      - `logout()` takes a mandatory discriminator, `{ logoutType: "app" }` or
        `{ logoutType: "idp", postLogoutUrl }`. App logout is the right default: IDP logout
        signs the owner out of their identity provider entirely, and its `postLogoutUrl` has to
        already be listed in `post_logout_redirect_uris` in the client ID document, which
        currently names only `${SITE_URL}/`.
- [ ] Entry create and edit, index maintenance, revalidation hook. `rebuildIndex` and
      `putGuarded` already exist in `lib/pod/write.ts` from phase 1; this is the UI and the
      §10 write sequence on top of them.
- [ ] `localStorage` autosave of in-progress text
- [x] **`npm run test:e2e` — fixed 2026-09-04.** `playwright.config.ts`, `e2e/environment.ts`,
      `e2e/global-setup.ts` and `e2e/solid-login.spec.ts`. Two tests, 11 seconds, both green:
      the authorization redirect carries the `client_id` and `redirect_uri` that
      `client-id.jsonld` publishes, and the full round trip logs in with the seeded credential
      and returns to a studio showing the owner UI.

      It was broken because there was no `playwright.config.*`, so Playwright scanned the
      repository, tried to load the Vitest suites and died on `test/access.test.ts:103` with
      "Cannot read properties of undefined (reading 'config')". `testDir: "./e2e"` is what
      stops that. Still not in the definition of done — see the note at the end of this item.

      **Both tests were killed to prove they were not vacuous.** Changing `clientId` in
      `lib/studio/session.ts` to `${origin}/client-id.json` fails test 1 on the exact value
      and leaves test 2 on CSS's "Server error" page. Deleting the `clientId` argument
      altogether — the real dynamic-registration fallback — fails both.

      **What that second mutation corrected, and it is worth keeping.** Phase 0 recorded the
      fallback as "a bare UUID instead of the app name". Against CSS 7.2 that is not what
      happens. Measured consent screen under dynamic registration:

          Name  Where I Go e2e        ID  FruZ8UCqY2QwZdac1kd0b

      The **name survives** — `@inrupt/solid-client-authn-browser` forwards `clientName` into
      the registration — and the ID is a 21-character opaque handle, not a dashed UUID. So an
      assertion on the name discriminates nothing, and a UUID regex matches nothing. The first
      draft of the spec asserted both and would have passed while the app fell back. The
      assertion that earns its keep is an exact match on the ID cell.

      **Also fixed on the way:** Chromium was not actually installed for Playwright 1.62.1 —
      see the phase 0.5 note above.

      ---

      *Original plan, kept because its findings are still the recipe:*

      **Do this AFTER the shell, not before.** Playwright exists here for exactly one thing —
      the Solid login redirect — and there is no sign-in button to drive until the shell lands.
      A `playwright.config.ts` added now would make `test:e2e` exit 0 while running nothing,
      which is the "green run that verified nothing" failure mode `CLAUDE.md` names, dressed up
      as progress. When it is written: point `testDir` at a new `e2e/` so Playwright never
      scans `test/` again, and drive it against the local Community Solid Server — phase 0
      found the real flow cannot be validated from localhost against a hosted Pod, because the
      identity provider has to be able to fetch `client-id.jsonld`.

      **The local recipe, worked out and verified 2026-09-04.** A real login IS exercisable
      against CSS, credentials and all:
      - `scripts/seed-dev-pod.ts` randomises the pod name per run, but honours `SEED_NAME`. So
        `SEED_NAME=e2e npm run pod:seed` gives a deterministic pod at
        `http://localhost:3001/e2e/`, WebID `…/e2e/profile/card#me`.
      - the seeder creates a password account alongside it: `e2e@localhost.test` / `dev`. That
        is a real credential CSS's login form accepts, so the spec can go past the redirect
        rather than only asserting it.
      - both the app and CSS are on localhost, so CSS *can* fetch `client-id.jsonld` — which is
        exactly what a hosted provider cannot do from a dev machine, and is why the static
        client ID path is testable here and nowhere else locally.
      - **a CSS-created profile card carries `solid:oidcIssuer` but NOT `pim:storage`.**
        Verified against a live seeded pod, and `readOwnerProfile` returns
        `{ ok: true, value: { oidcIssuer: "http://localhost:3001/" } }` against it. This is the
        empirical case for `storage` being optional in `OwnerProfile`: had it been required,
        the read would fail on every CSS pod and the studio could never offer sign-in.

      **Should `test:e2e` join the definition of done?** Recommendation: **no, not as a ninth
      line in that list — but yes as a named gate on any change to the auth seam.** The
      argument for is that this is the only check covering the login flow, and its absence is
      exactly why the command stayed broken. The argument against is what the list is *for*:
      the other eight run anywhere with a checkout and Node 22, and `npm run build` already
      needs a Pod, but this one needs a Pod **and** a 180 MB browser **and** port 3000 free,
      and it fails loudly on all three. Put it in the unconditional list and the predictable
      result is that the list stops being run — which costs more than this test is worth.
      A workable middle: the definition of done gains a line saying that a diff touching
      `lib/studio/**`, `app/(studio)/**`, `components/studio/**` or
      `app/(public)/client-id.jsonld/**` must also run `npm run test:e2e`. That is where its
      failures actually live, and it is checkable by reading the diff.
      **Changing CLAUDE.md is the maintainer's call — this is a recommendation, not a change.**

## Phase 3 — media

- [ ] Client-side resize in a Web Worker: thumb, web, blur placeholder
- [ ] EXIF read then strip; auto-place and auto-date from photo GPS
- [ ] Coordinate fuzzing with a configurable home radius
- [ ] Decide the originals question from the quota finding in phase 0

## Phase 4 — map and timeline

- [ ] Dark desaturated map style built to the tokens in `docs/design-brief.md`
- [ ] One MapLibre instance, lazy-mounted, never remounted
- [ ] Photo-thumbnail markers, clustering above ~50 points
- [ ] Route with per-leg travel mode and `accent-deep` casing
- [ ] Bidirectional map/timeline highlighting
- [ ] Mobile drawer with three snap points, map staying mounted throughout
- [ ] Globe view for the all-trips map

## Phase 5 — publishing and sharing

- [ ] Draft and publish flow via `dy:status` plus per-resource ACL
- [ ] OG image generation, verified on a Netlify preview — **this is phase-0 spike question 7**,
      moved here because it needs a deploy. Generate one `next/og` image containing an embedded
      SVG polyline on a Netlify deploy preview, not locally; local success does not predict the
      serverless runtime. If it fails: compose over a trip photo, or pre-generate at publish time
      and store in the Pod. Record the result in `docs/phase-0-spike.md`.
- [ ] Per-entry deep links

## Phase 6 — deployability

- [ ] `netlify.toml`, `Dockerfile`, `next start` instructions
- [ ] `docs/deploying.md` and `docs/self-hosting.md`
- [ ] `docs/pod-compatibility.md` from the phase-0 findings
- [ ] README deploy section under ten steps, tested by someone other than the author

## Phase 7 — look and feel

Design plan first, per the process section of `docs/design-brief.md`. Typefaces are still
open.

## Phase 8 — landing page

Separate domain, which also serves the `dy:` namespace document with
`Content-Type: text/turtle`.

- [ ] Write the copy against the built app, not the plan. If "no API keys" or "no backend" is
      no longer literally true, change the app or change the claim — do not soften the wording.

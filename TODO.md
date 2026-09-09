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
- [x] **A package manager of your choice** — npm, pnpm, yarn or bun. Whichever you pick, use it
      for everything in this checkout and commit its lockfile; never mix two.

      **The commands below are written with npm, because `package-lock.json` is the lockfile
      this tree actually commits** — `.npmrc` is npm's file, and CI runs `npm ci`. They were
      written with pnpm until 2026-09-08, which made every one of them a paste-and-edit for
      everybody working in this checkout, for no gain: `docs/decisions.md` §21's reason for the
      pnpm dialect was "something has to be written down". Something did; it should be the one
      in the tree.

      Substitute freely if your checkout picked differently — `pnpm <script>`, `yarn <script>`,
      `bun run <script>`, and `pnpm dlx` or `bunx` for `npx`.
- [ ] Docker is optional. The local Pod runs fine without it (see below).

### Scaffold

- [x] Create the app:

      npx create-next-app@16.3.4 . --ts --app --tailwind --eslint \
        --use-npm --no-src-dir --import-alias "@/*" --no-agents-md

      Swap `--use-npm` for `--use-pnpm`, `--use-yarn` or `--use-bun` to match your choice —
      the flag decides which lockfile the scaffold generates.

- [x] **Set TypeScript to 6.0.3.** This is a move *up* from the scaffold default, not a
      rescue. Verified in phase 0: `create-next-app@16.3.4` writes `"typescript": "^5"` into
      the generated `package.json` and installs 5.9.3 — already inside
      `typescript-eslint@8.69.0`'s peer range (`>=4.8.4 <6.1.0`), so nothing is broken on
      arrival and nothing is urgent here:

      npm install -D typescript@6.0.3

      TypeScript's `latest` is 7.0.2, but nothing in this scaffold reaches for it. Do not
      install it — it falls outside the typescript-eslint peer range. See `docs/versions.md`.

- [x] Verify: the `typecheck` and `lint` scripts both run clean before adding anything else.

### Runtime dependencies

- [x] Install, exact versions:

      npm install maplibre-gl@6.6.0 react-map-gl@8.1.2 \
        @inrupt/solid-client@3.0.0 @inrupt/solid-client-authn-browser@5.0.0 \
        zod@4.5.4 exifreader@4.44.0

- [x] **Do not install `exifr`.** It was last published in 2022. If generated code reaches
      for it, that is stale training data — replace with `exifreader`.
- [x] `n3@2.7.2` — **required**, not optional. `scripts/validate-fixtures.ts` uses it, and it is
      the parser behind every Pod read. See `docs/decisions.md` §23.

### Dev dependencies

- [x] Install:

      npm install -D vitest@4.1.11 @vitest/coverage-v8@4.1.11 \
        @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 jsdom@30.0.1 \
        @playwright/test@1.62.1 msw@2.15.0 \
        typescript-eslint@8.69.0 prettier@3.9.6 tsx@4.23.13 \
        size-limit@13.0.3 @size-limit/preset-app@13.0.3

      **`size-limit` and `@size-limit/preset-app` were removed on 2026-09-05** — see the
      bundle-budget item below. Left in this command as the historical record of what phase 0.5
      installed; do not reinstall them.

- [x] `npx playwright install chromium` — only Chromium is needed, for the login flow.

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

      npx --yes shadcn@latest init

      Template `next`, base colour `neutral`. **Not** `npx shadcn-ui` — that package name is
      dead.

- [x] Add only what the studio needs. Resist adding the whole registry:

      npx --yes shadcn@latest add button input textarea select dialog drawer \
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
      - [x] **Closed 2026-09-05. The rule reached only a class string written inline.** Its
            selector was `JSXAttribute[name.name='className'] Literal[…]`, so a const
            initialiser was invisible: `components/studio/entry-editor.tsx` keeps its two shared
            class strings in module-level consts spent as `className={CONTROL}` — an
            `Identifier`, not a `Literal`. Measured: `disabled:bg-[#222]` inside `CONTROL`
            produced zero errors, the same string inline produced one.

            Now four arms, and the depths are deliberately asymmetric — child-anchored at the
            `VariableDeclarator`, descendant *within* a `BinaryExpression`. Both halves are
            load-bearing, and both were established by measurement rather than by reading:
            - `VariableDeclarator Literal` (descendant) makes **`test/guardrails.test.ts` itself
              unlintable** — its own fixtures live inside `const msgs = await lint(…)`, so every
              deliberate violation is a descendant of a declarator. It flags that file twice
              while still passing every snippet case, so the tests would look fine while the
              guardrail broke the file that proves it works.
            - `> BinaryExpression > Literal` (child) misses a three-part concatenation, because
              `+` nests to the left and the offender is then a grandchild. Two-part passes,
              three-part slips through.
            - A `TemplateLiteral` arm is needed because static template text is a
              `TemplateElement`, not a `Literal` — otherwise the rule is bypassed by swapping a
              quote for a backtick, which both a formatter and an agent emit without thinking.

            Name-agnostic on purpose (a rule keyed to `CONTROL`/`BUTTON` dies at the first
            rename) and not directory-scoped (a `files` list rots). Repo-wide it flags zero
            places outside `components/ui/**`, which is already exempt. 13 new cases in
            `test/guardrails.test.ts` — 5 reject shapes, 4 allow, 2 non-vacuity, and 2 that lint
            `eslint.config.mjs` and `test/guardrails.test.ts` **on disk**, which is what would
            have caught the descendant mistake.

            Still not covered, and named rather than pretended away: a class string in an object
            property or array element, `clsx`/`cva` argument positions, and the `lib/vocab.ts`
            config block, which names the arm list explicitly and must be kept in step by hand.
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
              CI invoked, and `start`, which `netlify.toml` and the `Dockerfile` name, were both
              invisible to the contract. (`size` was deleted on 2026-09-05; `start` is named in
              CLAUDE.md now. The both-directions check is what kept the pair honest through the
              deletion — it went red until CLAUDE.md's Commands block dropped `size` too.)
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

      npx --yes @solid/community-server@7.2.0 -p 3001 -c @css:config/file.json -f ./.pod-data

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
- [x] CI runs: `lint`, `typecheck`, `test`, `validate:fixtures`, `size:public`, `build`.
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
      - [x] **Resolved 2026-09-05 by deleting the whole-app budget.** `size-limit`'s glob was
            `.next/static/chunks/**/*.js` — EVERY chunk — under the name "public routes —
            first-load JS", which it stopped measuring the moment the studio shipped a client
            bundle. Measured against a clean `HEAD` worktree: **it was failing at 359.02 kB
            against its own 200 kB limit on `ca80ec9` with nothing uncommitted**, because it was
            summing the studio's 145 kB Inrupt auth chunk and React's 71 kB and calling them
            public. So CI had a red step measuring something nobody had chosen.

            Deleted rather than renumbered, and the reasoning is worth keeping because the
            obvious move is to raise the limit. A studio budget cannot be made useful here: the
            studio is behind a login, loaded once, and phase 3 brings MapLibre (252.8 kB gzip
            alone) plus image processing, so any number tight enough to catch a real regression
            would be renegotiated every phase — which is how a budget becomes a step people
            skip. `npm run size:public` already enforces the invariant that matters, and better:
            it derives the script list from each prerendered public page's HTML rather than
            globbing, and scans every loaded chunk for studio-only dependencies by name. CI's
            own comment on the step below already said "the studio is allowed to be heavy".

            Removed: the `size` script, the `size-limit` config block, both devDependencies (62
            packages), and the CI step. Updated: CLAUDE.md's Commands block, this file's CI
            list, `docs/decisions.md` §24 (which said "the `size-limit` budget"), and
            `docs/versions.md`, which cited `size-limit@13.0.3` as one of three packages setting
            the Node floor — `jsdom@30.0.1` was and remains the binding one, so `engines` does
            not move. `check:commands` verifies both directions and passes at 13 commands.

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
- [x] **Entry create and edit, index maintenance, revalidation hook.** Landed 2026-09-04 as
      `serialiseEntry` + `saveEntry` (`lib/pod/save-entry.ts`), the revalidation route at
      `app/(public)/api/revalidate/route.ts`, `listStudioTrips` (`lib/studio/trips.ts`) and the
      editor itself (`components/studio/entry-editor.tsx`). `rebuildIndex` and `putGuarded`
      already existed in `lib/pod/write.ts` from phase 1; this was the UI and the §10 write
      sequence on top of them. **Seen working against a real Pod**, not only tested: the picker
      lists a seeded draft trip, marked as a draft, in three requests with no StrictMode
      duplicates.

      Two things it exposed, both worth keeping in view:
      - **A data-loss bug the tests found first.** On the SECOND save of an entry this editor
        had just created, `initial` is still absent, so a form supplying neither `created` nor
        `datePublished` left them undefined on an update and the serialiser dropped the triples
        — §7.3's "when the record came into being" vs "when it became public" destroyed
        silently and permanently. The editor now holds both in `provenance` state. Measured
        with a throwaway probe before that state existed: the second PUT carried no
        `dcterms:created` at all.
      - **`rebuildIndex` still implements only four of §10's five clauses** — it does not
        verify each kept entry's ACL matches its status, which is the clause that recovers
        "published but unreadable". Marked `it.todo`; fixing it needs the
        `write.ts` ↔ `access.ts` import cycle broken first.
- [x] **`localStorage` autosave of in-progress text.** Landed 2026-09-05.
      `lib/studio/drafts.ts` is the storage half — `draftKey` / `readDraft` / `writeDraft` /
      `clearDraft` over an INJECTED `StorageLike`, Zod-validated, and **nothing in it throws**:
      it is called from the editor's mount effect, so anything it threw would turn "we kept a
      backup of your text" into "you cannot open the editor at all". The key is
      `wig.draft.v1.<webId>.<scope>` — versioned so a future shape makes this one invisible
      rather than half-restorable, per-webId so a shared machine does not hand one person
      another's unfinished text, per-scope so a create and an edit are different drafts.
      `components/studio/entry-editor.tsx` is the wiring: `DRAFT_DEBOUNCE_MS = 800`, a mount
      read, the banner, and clearing after the entry reaches the Pod.

      **The ETag, `dcterms:created` and `schema:datePublished` are never persisted.** They come
      from the read that produced the editor's state (§10) and a draft outlives that read by
      however long the browser was closed. `writeDraft` stores `checked.data` rather than its
      argument, so the schema is the fence in both directions — a caller spreading the editor's
      state cannot leak one in. A restored ETag would be a blind PUT wearing a helpful hat.

      **Offered, never applied**, and the form is HELD while the offer stands. The banner is
      `<section role="region" title="Unsaved draft">` with Restore and Discard, and the nine
      controls — Save included — sit in a `<fieldset disabled={offered !== null}>`.
      - `title`, not `aria-label`, and it is load-bearing: `@testing-library`'s
        `queryAllByLabelText` matches `aria-label` on ANY element, so an `aria-label` naming
        the banner "Unsaved draft" shadows the Status control and six tests fail with "found
        multiple elements" rather than anything legible. Measured, and now pinned directly.
      - The hold exists because the banner and the autosave share one storage slot. Without it,
        typing past an unanswered banner lets the 800 ms window overwrite the very draft being
        offered — losing the long entry that decisions.md §10 names as the whole reason for the
        feature. Two other designs were weighed and declined: dismissing the banner on
        overwrite (honest, still loses the draft) and a second key promoted on answer (preserves
        both, but two unanswered drafts on the next mount have no clean rule for which to offer).
      - Save is held for the same reason. Left free, one unprompted click on an EDIT writes the
        entry and settles the draft with the banner never read. jsdom gates a submit button's
        activation behaviour on "actually disabled", which walks up to the fieldset, so the hold
        dispatches no `submit` at all rather than merely looking inert.

      **Four defects a read-only review and a mutation pass found after it first went green**,
      each of which had passed all eight checks:
      - the banner kept offering a draft the autosave had already destroyed (above);
      - unmount dropped up to 800 ms of typing — routine, not exotic: the shell flips
        `view.status` on session expiry and stops rendering the editor, so an expiring Solid
        token took the typing with it. Fixed with an unmount-only effect reading a ref, NOT the
        debounce cleanup, which React runs on every keystroke and which would defeat the
        debounce;
      - after a successful create the scope stayed `new`, so further typing was autosaved under
        `new` carrying the created entry's slug — restore it on a fresh create form tomorrow and
        Save sends `If-None-Match: *` to a URL that now exists, and the 412 tells the owner the
        resource "changed elsewhere", which is not what happened;
      - the draft was cleared for text typed DURING the round trip, which was then in neither
        the Pod nor storage.

      **Mutation testing is what earned the confidence**, again. Ten mutants; eight went red
      immediately, and the two survivors were both worth the trouble: one was a genuinely
      uncovered invariant (a `settleDraft` that leaves the debounce armed) and one was a
      near-equivalent mutant whose survival showed the component's own docblock was **wrong** —
      it claimed keying the scope on `target` "would clear a key nothing was ever stored under",
      when on an edit `target.url` IS `documentUrlOf(initial.entry.iri)`. The justification was
      corrected rather than left in the file to mislead.

      Also found, and fixed, in tests written the same day: a byte-identity assertion racing a
      live 800 ms timer, two docblocks specifying a spelling the implementation deliberately did
      not use, and a cross-test leak where a failed save's outstanding window was flushed into
      jsdom's file-wide `localStorage` by `cleanup()`, putting a banner on screen for four of the
      six §10 outcome comparisons.

      **Left open, deliberately:**
      - **A tab close still loses up to 800 ms of typing.** Closing a tab does not unmount a
        React tree, and nothing listens on `pagehide`/`visibilitychange`. Unmount covers the
        session-expiry path, which is the routine one here; a tab close costs a few words, not
        the long entry §10 is about. Which event to listen on — `pagehide` is unreliable on iOS,
        `visibilitychange` fires on tab switches too — is a decision nobody has taken.
      - **A draft restored in a different time zone from the one it was written in** gets this
        machine's offset on `dy:occurredAt`. Write in Kyoto, restore in Rome, and the entry
        claims `+02:00` for something that happened at `+09:00` — §7.3 says that is most of the
        meaning. Pre-existing (a create has always used `offsetHere()` because there is no place
        input until phase 3), but drafts widen the window from minutes to weeks. Revisit with §9.
        **Closed by phase 3 stage 2**: the offset is a control, `Draft` carries it, and a restored
        draft shows the offset the owner chose rather than this machine's.
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

- [x] **EXIF read then strip; auto-place and auto-date from photo GPS.** Landed 2026-09-07 as
      stage 2, on its own plan (`docs/superpowers/plans/2026-09-06-media-pipeline-stage-2.md`).
      Production changes are confined to `components/studio/entry-editor.tsx` and
      `lib/studio/drafts.ts` — the RDF contract needed nothing, because `lib/pod/entry-model.ts`
      already serialised `schema:name`, `addressLocality` and `addressCountry` and
      `lib/pod/read.ts` already parsed them. Definition of done at `64f1788`, all eight with the
      Pod up: `npm test` **1014 passed, 2 todo, 0 skipped, 29 files**, then `lint`, `typecheck`,
      `validate:fixtures`, `check:vocab`, `check:commands`, `build` and `size:public`; plus the
      gated `npm run test:e2e` — **6 passed** — since the diff touches `components/studio/**`.
      **This clears nothing in the blocker above:** every measurement was taken against local
      Community Solid Server data, the `dy:` namespace is still `example.org`, and nothing may
      be written to a live Pod.

      **The editor could not name a place at all, and §9 was leaning on a control that did not
      exist.** `Place.name`, `.locality` and `.country` were read, serialised and carried through
      an edit with nothing in the studio able to set one — so §9's "inside the home radius the
      coordinate is dropped and the place keeps its name" had no name to keep, and every entry
      near home was placeless. Three text controls now, on the untouched / replaced / removed
      logic `placeFor` already drew for geometry: `""` means remove, absent means untouched.

      **The offset was silently the editing machine's**, on every entry ever saved. It is a
      `<select>` of thirty-eight offsets now, initialised from the entry's own stored offset on an
      edit and from this machine only on a create, and `Draft` carries it — which closes the
      phase-2 item about a draft restored in another time zone. A stored offset the list does not
      contain renders rather than blanking. **The trap the tests had to be built around:** the
      suite pins the test zone to `Asia/Tokyo`, so "shows the stored offset" and "shows the
      machine's offset" are indistinguishable for any `+09:00` fixture — every offset fixture here
      is one Tokyo cannot produce. And the create-path restore test was satisfied by an
      implementation that never consults the entry's offset at all, because on a create the
      fallback chain collapses to the machine's; the pin is an edit-path test with a `+05:45` entry.

      **Auto-fill is first-writer-wins in both directions.** A photo never overwrites a value the
      owner set, and never a value an earlier photo set. Authorship is recorded explicitly, never
      inferred from an empty box, and each auto-filled field names the file it came from in its own
      control's accessible description. The coordinate is **one unit**: `lib/media/exif.ts` sets
      `gps` only when both tags are present, so a photo can never supply half a coordinate and only
      the owner can, and a latitude from one source beside a longitude from another is a point that
      is nowhere. The wall clock and the offset were deliberately left **independent** of each
      other, because owner-typed time beside a photo's zone is the owner correcting *when* while
      the photo supplies *where* — which held for owner-vs-photo and not for photo-vs-photo, below.

      **Two defects found in review, each publishing something false, each reachable by an ordinary
      action, and each invisible to the entire suite.**
      - **On an edit, attaching a photo taken at home DELETED the entry's published map pin.** Both
        coordinate boxes start empty on an edit by design — the stored pair is already snapped and
        prefilling it would re-snap and walk the pin — so nothing recorded that the entry had a
        coordinate: a GPS photo filled the boxes, `touchedCoordinate` flipped true,
        `fuzzForPublication` returned `undefined` for a point inside the home region, and
        `placeFor` reads `undefined` as a removal. `#geo` came off a world-readable resource. The
        fix is one conditional, seeding the authorship record from the entry.
        **No existing fixture could have caught it**, which is sharper than "it was unpinned": the
        two tests that look as though they should have — the geometry-survival test and the only
        edit-with-photo test — each see one half and neither can reach the other, the first picking
        no photo and the second asserting photos, sort order and the index thumbnail and nothing
        about geometry. **And exactly one assertion in the suite separates the fix from its lazy
        spelling** (`initial === undefined ? nobody : owner`, which switches auto-fill off for
        every edit while every refusal still passes): an allow-case editing an entry with *no*
        stored geometry, where the photo must still fill. The test author added it unasked, before
        anyone knew it would be the only thing standing there.
      - **Two photos could compose a timestamp that happened nowhere.** Photo A (Tokyo, a date with
        no offset tag) fills the clock and leaves the offset marked as this machine's guess; photo
        B (Kathmandu, date and `+05:45`) has its clock correctly refused and its offset accepted —
        which cleared the mark and removed the note. The save published Tokyo's wall clock on
        Kathmandu's offset as a real instant, with §11.5's warning actively suppressed by the one
        composition that needed it. Both branches carry a same-photo guard now. One offset-carrying
        fixture existed in the whole suite and no test attached two photos, so nothing could see it.

      **Twice a ruling made by reading was corrected by measurement, and the corrections are worth
      more than the rulings were.** The evidence offered for the pin-deletion fix — that swapping a
      GPS fixture into the existing edit-with-photo test would go red — is false; it does not, and
      chasing that is what produced the un-pinnable finding above. And the "one unit" reasoning
      that fused latitude and longitude was declined for the clock and the offset because a mixed
      time/zone is coherent: true when one side is the owner, who can see and correct both halves,
      false for photo-vs-photo, which is how the second defect got through. Three times this stage
      an implementer corrected a reviewer's stated reason by measuring it instead of complying —
      including the one-line fix for that defect, which guarded one direction and left the mirror
      case (photo A offset-only, photo B date-only) composing the same value.

      **A restored draft may not speak for a field it has no opinion about.** `.default("")` on the
      three place fields would turn "this payload predates these controls" into "the owner emptied
      the box", which is a removal — so restoring a pre-stage-2 draft on an edit would have deleted
      the entry's published place name and its whole `<#address>`. `.optional()` is what keeps `""`
      (remove) distinct from absent (no opinion), and `drafts.ts`'s docblock had that backwards.
      The offset is deliberately the other shape, `.default("")`: there is no "remove the offset"
      instruction — §3 and §6 require one — so absent and `""` are the same instruction there.
      `Draft` is seventeen fields; no `v2` → `v3` bump, on the reasoning `photos` used in stage 1.

      **`Draft.savedAt` is optional at the maintainer's explicit instruction, over the objection
      written in `lib/studio/drafts.ts`'s own docblock.** It was the only required timestamp in the
      repository — every timestamp in `lib/pod/schema.ts` was already optional. **A schema-only
      change there would have crashed the editor on mount:** the banner renders
      `savedAtText(offered.savedAt)`, reached from the mount effect's `readDraft`, so an absent
      value is a `TypeError` thrown during render — the crash-on-mount that file's "nothing here
      throws, ever" invariant exists to prevent, unreachable before only because the required field
      refused such a payload outright. So the render guard moved with the schema: the banner still
      appears and keeps Restore and Discard, and the whole ", from <time>…" clause is dropped
      rather than an empty `<time>` (meaningless markup) or a placeholder date (a lie about when
      the text was kept). Mutation-proved — `.optional()` with the render untouched throws
      "Cannot read properties of undefined (reading 'slice')" from inside render.

      **Left open, deliberately:**
      - [ ] **Seed `/travel/settings/privacy.ttl` in `pod:seed`, and then DELETE the `page.route`
            standing in for it.** The seeded e2e Pod has no privacy settings document at all —
            measured: the resource and its container both 404, and `.pod-data/e2e/travel/` has no
            `settings` directory — so §9 fails closed and the coordinate controls render disabled.
            The browser leg therefore serves §7.6's own normative block out of `docs/data-model.md`
            through `page.route`, GET only: the single non-real part of that spec. Seeding it is the
            better fix, deferred only because it changes what every Community Solid Server
            integration test sees, at the close of a stage, for a cleanliness gain rather than a
            correctness one. It is **not** a container-layout change needing an ask — §7.6 defines
            the path and `readPrivacySettings` already looks there; the seeder simply never wrote
            it. **When it lands, delete the route rather than leave it shadowing a real resource.**
      - [x] **Two flakes, and the pattern is the finding, not the incidents.** Both were "wait for
            one thing, then assert on something another mechanism produces": the test waits on a
            commit-phase DOM node and then reads a fetch issued from a passive effect, a gap load
            widens. `test/studio-shell.test.tsx` was fixed that way (one `waitFor`, `f89c152`).
            The second — `test/studio-trip-loading.test.tsx > stops offering the trips … once the
            session expires` — failed once, then passed 22/22 alone and three times under `-t`, and
            **its message was never captured**, which is the part to do differently. It was fixed
            without ever being reproduced: the whole-branch review derived the mechanism from the
            source instead, and two cross-checks in the same file confirmed the reading — the
            sibling test at `:645` already counts *after* `settle()` and names §7.6 as the fourth
            request, and `studioPod`'s own docblock records a prior intermittent failure of the same
            kind. **A mechanism read off the source is worth more than a repro you cannot get**, and
            neither flake needed load to be understood once the shape was named.
      - [ ] **Tell the owner when half a coordinate pair is dropped, rather than dropping it in
            silence.** A pair with one box filled now publishes no geometry and leaves any stored
            coordinate alone — before that it published `{lat, 0}`, a pin in the Gulf of Guinea,
            silently. Fail-closed is the right default and matches what §9 does for an unreadable
            gate, an unusable grid and `insideHome`, but the owner still gets no word that the
            number they typed reached nothing. Refusing the save with a message is the better
            answer and needs its own test round. Found by the whole-branch review, which also
            corrected the record: the ruling that made the coordinate one unit for auto-fill
            purposes had claimed such an owner "must type the second" number — assuming they are
            forced to notice. They were not; the save succeeded.
      - [ ] **`touchedCoordinate` is now provably subsumed, and the redundancy is deliberate.** The
            pair-completeness condition implies it (`wholePair → touched`), and its only use site is
            that one line — so the alternatives were a redundant conjunct or an unused variable, and
            the plan fences the name against redefinition. The conjunct stays with a comment saying
            the redundancy out loud, because a no-op defended by a comment claiming otherwise is a
            shape this file has already carried once. Worth resolving deliberately rather than by
            deletion.
      - [ ] **`OFFSET_SHAPE`'s width is unpinned.** It is read only inside `restore()`, and every
            draft-offset fixture the suite exercises is `"+09:00"`, `"+05:45"`, `""` or `"banana"` —
            none is shape-valid but unlisted. So tightening it from a regex to list membership
            passes all 166 tests, while a draft carrying `+05:15` would then be refused on restore
            and silently fall back, losing an offset the owner had. The loose/strict split is
            deliberate — wide for what the select may *display*, strict for what a photo may
            *supply* — and only the strict half is pinned. One test closes it: a draft whose offset
            is shape-valid and unlisted restores unchanged. Found by mutating a hypothetical
            alternative rather than the shipped code, so nothing is reachable today.
      - [ ] **Replace the line-number citations in `test/entry-editor.test.tsx`'s docblocks with
            symbol references.** They went stale twice in one stage — once by ~76 lines, once by 57
            — and the second time happened *within a single fix round*, after being corrected,
            because the production commit landed after the test commit. A citation that decays
            every time the file it points into grows is a maintenance tax that reads as fact.
      - [ ] **The auto-fill is silent to a screen reader.** The note is discoverable at the control
            through `aria-describedby`, but nothing announces that a value arrived. The cheap fix
            is what makes this deferred rather than done: `role="status"` on the note would make
            `getByRole("status")` ambiguous with the save-outcome region six tests in that file
            depend on, and the save outcome is the one this project has already shipped a
            data-visibility bug behind. The underpinning measurement — section 10a pinning the live
            roles for a photo that works — was re-derived independently while building auto-date
            and holds, now with a correct citation.
      - [ ] **The unconfirmed-offset mark does not survive a draft restore.** Within a session the
            clearing is a no-op and provably so: the draft is read once, so the banner appears only
            at mount, and while it is up the disabled fieldset makes the picker unreachable — the
            mark is always `null` when `restore()` runs. The loss is strictly cross-session, and no
            code change recovers it, because after a reload the editor cannot know the restored
            clock came from a photo. A provenance field on `Draft` is the only route, and
            `lib/studio/drafts.ts` treats every field addition as a versioning decision.
      - [ ] **Three documentation debts, all in tests, none behavioural.** A hedged assertion
            message in `test/entry-editor.test.tsx` ("the control blanked on an offset it does
            not offer, or replaced it with one it does") whose correct mechanism is stated
            immediately above it — cited by its text, not its line, per the item above; the docblock above
            `test/drafts.test.ts`'s `DRAFT` constant, which still reads as though `savedAt` were
            guaranteed present; and section 11i leg 1's raw-reading-absent assertion, which is true
            of today's code rather than earned by the fix and, unlike leg 2's, is not labelled as
            such — a future reader could mistake it for a pin the fix bought.
      - [ ] **`prettier --check` flags files that `npm run lint` does not**, `lint` being eslint
            only, and there is no `format` script in the definition of done. Not reformatting
            inside a stage was right; whether the formatter is part of the contract is not a
            stage-2 question.
- [x] **Client-side resize in a Web Worker: thumb, web, blur placeholder.** Landed 2026-09-06.
      `lib/media/{targets,exif,pipeline,pipeline.worker,upload}.ts`, a photo control in the entry
      editor, `dy:blurDataUrl` as a new term, and `e2e/media-pipeline.spec.ts`. 931 tests,
      0 skipped, 2 todo, 29 files; `test:e2e` 5 passed; `size:public` 176.4 kB against a 190 kB
      budget with `exifreader`, `n3`, `maplibre-gl`, both Inrupt packages and radix all absent
      from every public chunk.

      **The original is hashed and never uploaded.** The three derivatives are re-encoded from a
      decoded bitmap, and *the re-encode is what strips the EXIF* — not a metadata filter that
      could be configured wrong, and not a strip step that could be skipped. The content address
      is SHA-256 over the ORIGINAL bytes, so re-picking the same file yields the same IRIs and a
      412 on the web PUT is reuse rather than a failure; a partial upload self-heals on retry for
      the same reason.

      **Four ways this could have failed silently, and the guard for each.** Every one was applied
      as a mutation and watched go red — except where it could not be, which is said rather than
      glossed.
      - **`convertToBlob` does not throw for a type it cannot encode; it returns PNG.** So the
        extension and `schema:encodingFormat` come from `blob.type` READ BACK, never from the type
        that was requested, and a type we do not recognise fails at the call site instead of
        writing `web.undefined`. The plain mutation — trust the requested type — is inert on a
        WebP-capable Chromium, which is every current one, so the underlying condition was forced
        instead (request `image/avif`): with the read-back removed the test fails on `web.png`
        with magic `137 80 78 71`. Reported as forced, not as a red that was not seen.
      - **Always re-encode. There is no "the source is already small, skip it" shortcut**, and a
        pass-through would upload the owner's untouched file — GPS included — into a publicly
        readable container. Guarded by an 800×600 fixture carrying southern/western GPS, and see
        the note below on why the two tests the plan asked for could not see it.
      - **Orientation is the decoder's job, and the targets come from the BITMAP.**
        `createImageBitmap(file, { imageOrientation: "from-image" })`, then `fitWithin` is fed
        `bitmap.width/height` — never the file's declared pair — so an orientation-6 photo stores
        the dimensions it actually renders at. There is no rotation maths anywhere.
      - **The blur placeholder is DROPPED when it exceeds 1200 bytes, never truncated.** It rides
        inside the entry's Turtle, which is public and fetched on every page view, so an oversized
        one degrades every reader's first paint multiplied by photo count; a missing one degrades
        to a plain image load. `withinBlurBudget` measures encoded BYTES, not characters.

      **The most valuable thing found in this whole stage: the plan's own Playwright tests could
      not see the mutation the Playwright leg exists for.** The pass-through guard is
      `bitmap.width <= longestEdge && …`, which is FALSE for the 3000×2000 fixture the plan
      specified at the 1600 box — so the "skip the re-encode" mutation is **inert** against both
      briefed tests and both stay green. A third test at 800×600 with southern/western GPS is what
      catches it, failing on "GPS survived into …/web.jpg". Without that test, the single defect
      the entire e2e leg was written for would have shipped under a green suite *and* a mutation
      report claiming it was covered. A mutation is only evidence where the fixture can reach it.

      **`imageOrientation: "from-image"` is inert on the only browser this repo installs, so
      `test:e2e` is NOT a fence against deleting it.** Measured: this Chromium decodes the same
      orientation-6 JPEG as 2000×3000 with the option, without it, and with `"none"` — the three
      variants attested in `e2e/media-pipeline.spec.ts`'s header, which is where to re-check this
      rather than here. So test 2 pins
      "the targets follow the decoded bitmap", not "the option is present", and transposing the
      pair fed to `fitWithin` — the same defect reached another way — is what turns all three
      media tests red. Safari and Firefox are where a deletion would show, as sideways photos, with
      nothing red here. The alternatives were both worse — restructuring a deliberately thin
      worker for vitest loadability to guard one deletion, or adding a second 178 MB browser to a
      definition of done kept to eight commands — so **the gap is documented rather than fenced,
      and accepted knowingly.** It is written into `e2e/media-pipeline.spec.ts`'s header as what
      that spec measurably cannot catch.

      **The EXIF fixtures are built byte by byte rather than committed** (`test/fixtures/exif-jpeg.ts`,
      193 lines, no dependency). A committed binary is opaque in a diff, cannot be varied per test,
      and nobody can review it; a builder can produce N/E and S/W GPS, orientation 6 and 8,
      `DateTimeOriginal` with and without an offset, an empty EXIF block and a bare JPEG with no
      APP1 segment at all — each verified against `exifreader` 4.44.0. `spliceExif` then puts real
      EXIF into a real encoded JPEG for the browser tests.

      **Corrections to two things this file and the project's memory had recorded wrongly:**
      - **`putGuarded`'s `extraHeaders` `it.todo` describes a hazard that does not exist.**
        `lib/pod/write.ts:44-46` spreads `extraHeaders` FIRST and assigns the precondition keys
        after, so `if-none-match`/`if-match` always win. A caller passing a precondition through
        `extraHeaders` gets it silently overwritten — a different and much smaller thing than
        defeating a precondition, which is what it had been carried as. Verified by reading the
        assignment order, then independently by the reviewer.
      - **`test/guardrails.test.ts`'s allow-case block was vacuous, and had been since the day it
        was written.** It lint-tested a JSX snippet against `.ts` paths; ESLint answers an
        unparseable snippet with exactly one `{ fatal: true, ruleId: null }` message and NO rule
        messages, so `not.toContain("no-restricted-imports")` passed on a file that was never
        parsed. Measured: `lintText` returned `[null]` for that pair versus
        `["no-restricted-imports"]` for the same import at a `.tsx` path. **The pre-existing
        `["lib/media/resize.ts", "exifreader"]` pin was therefore proving nothing.** Fixed with a
        JSX-free snippet plus `expect(fatals(msgs)).toEqual([])` — and `fatals` was already in
        that file, called at three other blocks, for exactly this. Nothing would have surfaced it
        except demanding that a new pin be PROVED load-bearing by widening the fence and watching
        it fail.

      **Known limitation, not a bug: HEIC.** `createImageBitmap` decodes HEIC in Safari and not in
      Chrome or Firefox, and iPhones shoot it by default (iOS's picker usually transcodes to JPEG,
      but not on every path). A decoder is a large dependency for a format the source device can
      be asked to avoid, so the answer is an explicit failure rather than a photo that silently
      does nothing: the slot goes to `failed` and the editor renders
      `"<file name> was not attached: <message>"` beside it, per photo, with the rest of the batch
      unaffected.

      - [ ] **The HEIC message is the browser's, not ours.** The spec's §12 wording — "this
            browser cannot read HEIC; export as JPEG" — is not implemented; what surfaces is the
            decoder's own `DOMException`, which is attributable but not actionable. One mapping in
            the worker's reject path, with a test.
      - [ ] **No photo removal control, and no retry — one UI task, not two.** An accidental
            attach can only be undone by reloading the editor, and the derivatives stay on the Pod
            either way. The reviewer's verdict was "ship stage 1; file the removal control as the
            next UI task rather than deferring it indefinitely", so it is filed here as a task and
            not a footnote. It needs: a control per slot, removal from `photos[]` with the
            remaining `sortOrder`s left alone (they are positions, not indices —
            `lib/pod/entry-model.ts:161` serialises `sortOrder ?? i + 1` one-based), and a
            decision about whether removal deletes the binaries or leaves them, which is the
            orphan question below.

            **Retry is specified and was never built, and the two are the same control.** §8 asks
            for a "per-photo state machine: decoding → uploading → ready | failed, *with retry*".
            There is no retry affordance anywhere: a failed slot renders a permanent
            `role="alert"` row that cannot be dismissed, and with no removal control either, the
            only escape from a failed photo is reloading the editor and losing the draft.
            Re-picking the same file does work — the content-addressed path makes it idempotent —
            but it leaves the failed row in place and adds a second slot beside it. So a slot
            needs both verbs, and retrying is nearly free: the source bytes are already held (see
            the multi-pick bullet below, which wants to stop holding them) and a repeat upload of
            an already-written derivative is the 412-as-reuse path.
      - [ ] **Multi-pick reads every original into main-thread memory at once — the tab-kill the
            worker queue exists to prevent, reached from the other side.** `attach` runs to its
            first `await` synchronously, and the picker handler is
            `for (const file of picked) void attach(file)`
            (`components/studio/entry-editor.tsx:2141` at this commit). So N `file.arrayBuffer()`
            reads start in a single tick; only `process()` is serialised behind the single-worker
            queue, and `source` stays captured for the whole slot's life, until `uploadPhoto`
            returns. Twelve 50 MP photos at ~25 MB each is ~300 MB held on the main thread while
            the worker holds its own ~200 MB bitmap. There is no size guard and no count guard.
            It also contradicts the spec's "keeps the raw file bytes off the main thread": the
            file is read twice, once in `attach` for the hash and once in the worker's `run()`.

            **The fix worth recording, because it removes the read rather than throttling it:**
            hash in the worker. `run()` already has `bytes` (`lib/media/pipeline.worker.ts:77`),
            so return `sourceHash` on `TransferableResult` and change `UploadPhotoOptions.source`
            from `ArrayBuffer` to `hash: string`. The main thread then never calls
            `arrayBuffer()` at all, and `File` stays a handle to disk. Serialising the picks
            would also bound the peak, but it keeps the double read and the spec violation.

            **Coverage gap, filed with it: nothing anywhere picks more than one file.** Every
            test — unit, MSW and Playwright — attaches a single photo, so the multi-pick handler
            that causes this has never been exercised at all. Whatever lands here needs a
            multi-file pick in the test that would have caught it.
      - [ ] **Orphaned media is accepted, with no cleanup pass.** A photo that uploads and is then
            abandoned — the entry is never saved, the tab is closed, a slot is removed — leaves
            two binaries in `/travel/media/<hash>/` that nothing references. Accepted for stage 1
            because the alternative is not cheap: **the Pod cannot be queried**, so deciding
            whether one blob is unreferenced means enumerating the media container and then
            reading every entry of every trip to see if anything points at it — an O(entries)
            crawl for each candidate, with no index that answers it. Content addressing bounds the
            damage: the same photo uploaded twice occupies one address, not two. If a cleanup is
            ever wanted it belongs in an index resource (§7.4), designed as such rather than
            bolted on.
- [x] **Coordinate fuzzing with a configurable home radius.** Landed 2026-09-06. `lib/pod/fuzz.ts`
      (121 tests), `/travel/settings/privacy.ttl` with four new `dy:` terms, `readPrivacySettings`,
      and three controls in the editor. 872 tests, 0 skipped; all eight checks plus `test:e2e`.

      **Deterministic grid snap, not a random offset**, and the reason is the whole design: a
      random offset redrawn on each write lets an observer average several publications back to
      the true point. `snapToPrecision` is a pure function of its inputs, and idempotence —
      `snap(snap(x)) === snap(x)` — is asserted directly rather than assumed.

      **Inside the home radius the coordinate is DROPPED, not coarsened.** Coarsening still pins
      every home entry inside one known cell, and a handful of them identify the cell whose
      centroid is the owner's home. The place name survives; only the geometry goes.

      **The settings live in the owner's Pod, owner-only**, because the two obvious alternatives
      both leak: `/studio` builds `○ (Static)`, so a build-time prop bakes home coordinates into
      publicly-readable prerendered HTML, and `localStorage` is per-browser, so a new device has
      no home region and the protection fails open exactly while travelling. Note the Pod ROOT
      does travel through that static page as a prop, and that is fine — the public site already
      reads it unauthenticated.

      **It fails closed, and the two failure cases are deliberately different.** Absent,
      unreadable or schema-invalid settings → no coordinate published at all, controls disabled
      with a stated reason. Valid settings with **no home region** → coordinates publish, snapped.
      Conflating them would silently drop every coordinate forever.

      Three things found by measurement that a later reader would otherwise simplify away:
      - **The longitude step must divide 360°**, not merely scale by `cos φ`. An arbitrary step
        leaves a seam at the antimeridian and breaks idempotence — measured:
        `snap(12, -180, 20000)` → `179.95` → re-snap → `179.87`. The polar collapse then falls
        out of the same expression at `N === 1`, with no special case.
      - **The meridian needs the same treatment for a different reason.** A plain
        `precisionMeters / M_PER_DEG_LAT` step puts `round(90/step)*step` at **90.000055** for a
        50 m grid — a published latitude that is not a latitude.
      - **Quantise before wrapping.** The antimeridian cell is exactly 180 in decimal but can
        arrive as `179.99999999999997`, publish as `"180.000"`, and re-snap across to `"-180.000"`.

      Also fixed on the way: **`acl:default` inherits recursively**, so the new container picked
      up `travel/`'s public default and an anonymous GET of `privacy.ttl` returned **200 with the
      home latitude in the body** — measured before and after. And `validate:fixtures` checked
      neither `dy:homeLat`/`dy:homeLong` (its geo rule matched on substrings that miss them) nor
      integers at all, so `dy:homeRadiusMeters 3000.0` was a valid fixture.

      The two tests pinning the ABSENCE of coordinate input are gone, deliberately, as their
      docblocks said they should be. What replaced them is the assertion that matters: the typed
      pair appears **nowhere** in the outgoing request body.

      - [ ] **No "exact" option in the precision select, and adding one needs care.** It was in
            the approved design and was left out: "exact" is the one path around
            `fuzzForPublication`, which is also the only thing that checks the home region — so
            it would publish the front door for the entry most likely to be marked exact.
            `lib/pod/schema.ts` already contemplates `dy:precisionMeters 0` meaning "this point
            is exact", so the safe shape is for `fuzzForPublication` to accept 0 — snapping
            nothing while still applying the home check — rather than for the editor to bypass it.
            That is a fuzz-module change with its own tests.
      - [ ] **`test/studio-trip-loading.test.tsx:632`'s docblock overclaims** and it predates this
            work. It says it catches StrictMode double-invocation; deleting the shell's `started`
            ref memo leaves all 22 tests green, because `enumerating` is false on first mount
            (`view.status` is `restoring`, the fake's `handleIncomingRedirect` being async) so the
            effect body never runs twice. Only the re-entrancy mode is caught. Making the shell's
            memo observable means altering restore timing that 22 tests stand on.
- [x] **The originals question: do not upload originals.** Phase-0 question 5 came back
      **unanswerable** — PodSpaces is Developer Preview and explicitly not for production, so its
      quota limits would not be representative of anything. §9 already recorded that the
      recommended default "stands on its own merits", and it does: every view uses the web-sized
      derivative anyway, and an original at a public URL keeps full GPS and device metadata.
      Uploading originals with metadata intact was never a third option. If archival originals
      are ever wanted, they are stripped too.

## Code structure — a refactor between phases 3 and 4

Asked for on 2026-09-08, before phase 4, after `components/studio/entry-editor.tsx` passed 3,000
lines. Rules in `CLAUDE.md` `## Code structure`; reasoning in
`docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md`. Three stages.

- [x] **Stage A — conventions, enforcement, and the moves. Zero logic change.** Plan at
      `docs/superpowers/plans/2026-09-08-code-structure-stage-a.md`, seven tasks. All ten checks
      green on the merged branch, run unchained so no failure could hide behind an earlier one:
      `npm test` **1060 passed / 2 todo / 0 skipped / 31 files**; `lint` (now
      `--max-warnings 0`); `typecheck`; `validate:fixtures`; `check:vocab`; `check:commands`
      (14 both directions); `check:structure` (103 files scanned, Structure OK); `build`;
      `size:public` **176.4 kB of 190**, every studio-only dependency absent; and the gated
      `npm run test:e2e` **6 passed**, since the diff touches `components/studio/**`.

      The integration suites were proven to have RUN, not skipped, by a control rather than a
      count: `TEST_POD=http://localhost:3999` flips the same 33 to `33 skipped`.

      What landed: three studio components each in their own folder with a named file and an
      `index.ts` barrel; 20 module tests beside their subjects; the two Pod suites in
      `test/integration/`; `max-lines-per-function` at 200/80 and `max-lines` at 1000 for tests;
      and `scripts/check-structure.ts` for what ESLint cannot express — folder layout, test
      placement, `notes.md` anchor resolution, and a comment ratchet.

      **Two enforcement decisions worth not re-litigating.** The bounds are two-tier because the
      maintainer's numbers are "tend to": ESLint fails at 200/80, `check:structure` reports
      130/50 and fails on neither. And the comment bound is a **ratchet** — 788 blocks over six
      lines exist today and the sweep is Stage C, so it fails only when the count rises. A flat
      bound would have blocked every merge in Stages A and B on deferred work.

      **Four exemptions, each naming the stage that removes it**: `EntryEditor` (941 lines),
      `entry-editor.test.tsx` (6,514), `serialiseEntry` (111), `check-public-bundle.ts :: main`
      (94). `reportUnusedDisableDirectives` is active and `lint` runs at `--max-warnings 0`, so a
      run at zero warnings is itself evidence all four still suppress a live violation, and each
      fails the build the day its function is decomposed.

      **Both review passes found defects that would have shipped**, and they are the shapes worth
      remembering:

      - **A hand-rolled line counter disagreed with the tool that enforces the rule.** It
        reported nine long functions and `EntryEditor` at 1,275 lines; ESLint says twelve and
        941. It over-counted by a third and missed three spans in `lib/pod/read.ts` entirely.
        Every threshold in the spec was rewritten from the enforcing tool's output.
      - **`check:structure` could not have exited 0 on the day it landed**, because the comment
        rule's backlog is a Stage C job. Caught before it went into CI.
      - **The folder rule as first written would have banned Stage B's own design** — it scanned
        `.ts` as well as `.tsx`, failing the ten plain modules the reducer plan puts in `state/`
        and `hooks/`.
      - **Three separate "reports zero and looks fine" bugs.** `driftReport` without `cwd: ROOT`
        (ESLint answers an out-of-basePath file with one `ruleId: null` message the filter drops);
        `@typescript-eslint/parser` having no `.default` under tsx, so ESLint silently fell back
        to espree and every file returned a parse error that was likewise dropped; and
        `allowInlineConfig` left on, which let the 941-line `EntryEditor` hide behind its own
        exemption — 9 reported where there are 12.
      - **A prefix-based comment scanner had 17 false negatives, every one in
        `entry-editor.tsx`**, including a 47-line block, because that file's house style is the
        JSX `{/* … */}` form whose lines begin with `{`. Replaced with the parser's comment
        ranges, which also stops a markdown list in a template literal counting as comments.
      - **`slug()` disagreed with GitHub in both directions** on em-dash headings — the house
        style in `docs/data-model.md` — so it would have rejected anchors copied from GitHub and
        accepted anchors GitHub cannot resolve.

- [x] **Stage B — `EntryEditor`.** Landed 2026-09-08, 15 commits on
      `refactor/code-structure-conventions`, plan at
      `docs/superpowers/plans/2026-09-08-code-structure-stage-b.md`. **941 code lines → 195**, and
      one file → 63. All nine checks plus the gated e2e:
      `npm test` **1332 passed / 2 todo / 0 skipped / 60 files** (from 1060 at Stage A's close);
      `lint` at `--max-warnings 0`; `typecheck`; `validate:fixtures`; `check:vocab`;
      `check:commands`; `check:structure` **Structure OK, ratchet 788, two exemptions**; `build`;
      `size:public` **176.4 kB of 190** with every studio-only dependency absent; and
      `E2E_PORT=3007 npm run test:e2e` **6 passed**. The integration suites were proven to have
      RUN, not skipped, by the `TEST_POD=http://localhost:3999` control on every task.

      **`EntryEditor`'s exemption came out on its designed signal**, not by anyone remembering:
      at 195 lines `npm run lint` reported `Unused eslint-disable directive` and failed at
      `--max-warnings 0`. `check:structure` now lists **two** exemptions, both Stage C's.

      The order was risk-ascending and the first task was the point of it. **Task 1 wrote the test
      the 6,514-line suite could not express**: two photos picked in ONE `change` event. Every
      other two-photo case awaited the first photo's `<img>`, so React had fully re-rendered
      between them — but the picker is `multiple` and runs
      `for (const file of picked) void attach(file)`, and `offerTimestamp` reads
      `occurredAuthor.current` **synchronously** in `attach`'s continuation. The decodes serialise;
      the continuations do not. Proven by mutation before it was committed: moving the ref reads
      before the `await` put the *second* photo's `2026-04-12T18:20` in the clock and accepted its
      `+12:45` beside the first photo's time — §11.5's instant that happened nowhere, reproduced
      on demand. The suite also had to wrap the fake pipeline to serialise, because `fakePipeline`
      does not and the real one does.

      **What the stage is: 63 files.** A harness plus thirteen suites split at the eighteen section
      banners the original already carried; five presentational field groups behind 44 **named**
      props and no spreads; four hooks holding every `useState`, `useRef` and effect; a reducer
      over 20 of the 27 state values with the first-writer-wins guard as a branch **inside** the
      transition; and the offset arithmetic and place logic moved to `lib/studio/time/` and
      `lib/studio/place/`, where phase 4's timeline can reach them.

      **Four things measurement corrected, all of them in the plan rather than the code:**

      - **"~120 lines when the stage ends" was not reachable by moving state, and 195 says so.**
        ~55 of it is composition and ~140 is JSX in one `return`. Relatedly, the plan predicted the
        exemption would come out after Task 5; at that point the editor was still **633** lines,
        because "~990 lines of JSX" was a *raw* span roughly two-thirds comment and
        `max-lines-per-function` runs with `skipComments: true`. The bound never saw mostly markup.
      - **A `{ kind: "slots"; slots }` action would have lost a photo.** A wholesale set must be
        built from a list a *render* held — the stale read the guard forbids — so two photos in one
        pick would each append to the same array and one would vanish. `slot-added` /
        `slot-settled` instead; `applyRestore` still replaces wholesale, because it replaces rather
        than appends.
      - **Two of the plan's own test fixtures would have verified nothing.** `fillNewEntry()` types
        an `occurredAt`, making the *owner* the clock's author so no photo can ever fill — the
        control's `not.toBe("")` would have passed on the owner's own typing. And
        `jpegWithGps("clockless.jpg", …)` is not clockless: `EXIF_BASE` carries a
        `dateTimeOriginal`.
      - **An exemption assertion was half a check.** `toContain("lib/pod/entry-model.ts")` over the
        whole of stdout passes because every exemption path also appears in the drift report, so it
        would have passed whatever the exemptions block held. It now parses the
        `active exemptions — N:` block.

      **Two stale claims found in code that predated this work**, both recorded rather than
      silently fixed: `CONTROL`'s docblock says the arbitrary-Tailwind guardrail "does not reach
      these two constants" — it does, re-measured, and has since the rule grew three arms
      *because of* those constants; and `test/studio-trip-loading`'s successor still cites line
      numbers that were already wrong at HEAD.

      **Reported, not failing:** `EntryEditor` at 195 and `useEntryDraft` at 142 are over the 130
      tendency; three suites are over the 600 test-file tendency. The unsaved-draft banner (~32
      lines) would qualify as a sixth field group by Task 5's own argument and was deliberately
      left — an unasked-for extraction inside the commit that removes an exemption is how a
      reviewable diff stops being one.

      **One flake to watch, not caused by this work.** Section 12m's third case
      (`refuses an offset-only second photo beside the first photo's clock`) failed once at
      `de7658b` **before** that task's changes, under full-suite parallel load, and has been green
      in every run since — four full suites and five of that file in isolation at the stage's
      close. Timing-sensitive rather than wrong; watch it rather than act on it.

- [x] **Stage C — the long functions, and the comment sweep.** Landed 2026-09-09, plan at
      `docs/superpowers/plans/2026-09-08-code-structure-stage-c.md`. All nine checks plus the
      gated e2e, run unchained and each log read: `npm test` **1420 passed / 2 todo / 0 skipped /
      62 files**; `lint` at `--max-warnings 0`; `typecheck`; `validate:fixtures`; `check:vocab`;
      `check:commands`; `check:structure` **Structure OK, 162 files scanned**; `build`;
      `size:public` **176.4 kB of 190** with every studio-only dependency absent; and
      `E2E_PORT=3007 npm run test:e2e` **6 passed**. The integration suites were proven to have
      RUN, not skipped, by the dead-port control on every task: 36 passed, then 36 skipped.

      **No length bound anywhere is suppressed.** `active exemptions — 0`. Both of Stage A's
      remaining `eslint-disable` directives left on their own signal — `npm run lint` reporting
      `Unused eslint-disable directive` at `--max-warnings 0` — rather than because anyone
      remembered them.

      **The production comment bound is now a hard zero**, down from 279. Three sweeps moved
      **277 blocks and deleted none**: `scripts/` 20, `lib/` 124 (the plan estimated ~90), and
      `components/` + `app/` 133. Proved absolute by adding an eight-line block to `lib/config.ts`
      and watching `check:structure` name the file and exit 1. Test docblocks stay **exempt but
      ratcheted at 509** — the maintainer's decision on measurement, since 509 of the original 788
      were test-side and this project's two real defects were both found *because* a test docblock
      recorded which fixture could reach which branch. Exempt means not rewritten, never
      unbounded.

      **Eleven long functions became three, and the three are decisions rather than leftovers.**
      `serialiseEntry` 111→29, `serialiseIndex` 57→20, `saveEntry` 69→23, `readTripIndexWithEtag`
      64→10, `tripIndexOf` 55→23, `readEntry` 52→37, `setContainerAccess` 73→15,
      `setDocumentPublicRead` 59→32, `verifyContainerAccess` 54→29,
      `check-public-bundle.ts :: main` 94→20, `validate-fixtures.ts :: main` 59→24. What remains
      is over the 130 *tendency* and under the 200 bound, each with its reason in the nearest
      `notes.md`: `EntryEditor` **164** (the draft banner became a sixth field group; the three
      further candidates are costed), `WhereFields` **161**, `useEntryDraft` **142**.

      **`WhereFields` is the one worth reading, because the alternative was measured rather than
      asserted.** The split along the §9 hold boundary is a real seam, and it comes to **199 lines
      across three functions where there are 161 in one** — but the decisive argument is a test:
      `holds the three coordinate controls when the settings cannot be read` asserts three
      disabled and three live in a single render, which *is* §9's mitigation, and split in two the
      only place left to render it is the harness, where the banner's own `fieldset disabled`
      holds all six and confounds it. A tendency that would make the code worse is not followed.

      **Four things this stage corrected in its own plan**, each found by doing the work:

      - **The serialisers' seam is §7.3 and §7.4, not §10.** §10 is the write protocol — PUT with
        `If-None-Match`, set ACL, recompute the index, revalidate — which is `saveEntry`'s
        sequence. A pure serialiser implements no §10 clause, so following the citation literally
        would have split them along a protocol they do not implement.
      - **`access.ts` does not split per mechanism**, and the earlier draft citing `decisions.md`
        §4 was citing "No drafts container". §19 is "Access control goes through one interface,
        and never branches on mechanism". The axis actually present is document versus container.
      - **A blank line inside a `/** */` does not split a comment run**, because the whole block
        is one token. Several replacement pointers came in over the bound that way.
      - **GitHub's heading slug removes punctuation rather than hyphenating it**, so a pointer at
        `#…not-import-meta-main` did not resolve to a heading about `import.meta.main`. Caught by
        `check:structure` going red, and missed first time by grepping its output for one line
        instead of reading its exit status — a half-check in the shape this file warns about.

      **Findings recorded rather than fixed**, each in a `notes.md` beside the code: an unreadable
      ACL is indistinguishable from no ACL in `@inrupt/solid-client` 3.0.0, so a 403 on
      `{container}.acl` reports "race" where the truth was a transient failure; a half-written
      bbox is dropped silently, unlike `readPrivacySettings`' deliberate all-three-or-none;
      `scripts/validate-fixtures.ts` cannot have a test file without changing `vitest.config.ts`
      or `REPO_TESTS`; and `drafts.ts` requires the editor to render a shape-valid-but-unlisted
      offset while the select in fact falls back silently — both claims are now in the notes,
      unreconciled, because that contradiction is the open item.

### The refactor, as one thing

Three stages, 2026-09-08 to 2026-09-09, between phases 3 and 4. What a reader can now rely on:

- **A component lives in its own folder** with a named file, a one-line `index.ts`, its test and
  its `notes.md`. `EntryEditor` went from **941 code lines in one file to 164 in a folder of
  sixty-odd**.
- **A test sits beside its subject**, and the three kinds that have no subject are listed in
  `CLAUDE.md` and enforced — including that a name on that list which no longer exists fails the
  check.
- **Prose lives behind a checked anchor.** A `see ./notes.md#anchor` that does not resolve fails
  the build, which is what stops the line-number rot that went stale twice in one stage.
- **Two bounds are enforced by a build and neither is suppressed**: 200/80 on function length at
  `--max-warnings 0`, and a hard zero on production comment blocks. One `eslint-disable` remains
  in the whole repository — `@next/next/no-img-element` in `photo-fields.tsx`, because
  `next/image` cannot serve a Pod URL — and it is reported like any other.
- **The tendencies are reported, never enforced** — 130/50 and 600 — because the maintainer's
  instruction was "tend to, not a dictate", and a lint error cannot express that.

Still open, and none of it caused by the refactor: the ~509 test-side comment blocks are exempt
rather than swept; `OFFSET_SHAPE`'s width is unpinned; the "exact" precision option needs a §9
decision, because `GeoPoint.precisionMeters` is `.positive()` and its own docblock argues against
0; `rebuildIndex` still lacks ACL verification and needs the `write.ts` ↔ `access.ts` cycle broken
first; and the fifteen phase-3 follow-ups above are untouched.

**Phase 4 next.**

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

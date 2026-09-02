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
- [ ] Enable `logging.browserToTerminal` in `next.config.ts` so browser console errors and
      warnings reach the terminal. MapLibre and Solid-OIDC failures are client-side.
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

- [ ] `pnpm exec playwright install chromium` — only Chromium is needed, for the login flow.

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
      - [ ] Only ever lower this number. Raising it is how a budget stops being a budget.

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

- [ ] `lib/vocab.ts` complete and CI-checked against the data model
- [ ] `lib/pod/read.ts` with Zod validation returning typed results or structured errors
- [ ] `rebuildIndex(trip)` — build it now, not when it is first needed. It is also the
      migration tool and the recovery path.
- [ ] Trip index page and entry page, server-rendered
- [ ] Slug resolution plus the slug-equals-container-segment invariant asserted
- [ ] Sitemap, RSS, metadata

**Cache Components consequence — handle this deliberately, it is a build-breaker.**

`generateStaticParams` must return **at least one param**; returning `[]` raises
`empty-generate-static-params`, and `dynamicParams` is not supported (`docs/decisions.md` §22).
Trip slugs come from the Pod, so:

- [ ] `generateStaticParams` for `/trips/[slug]` reads the diary root's trip list at build time.
      This couples every deploy to Pod availability — accept it knowingly.
- [ ] Decide and implement the empty-Pod case. A deployer who has not written a trip yet
      currently gets a **failed build, not an empty site**, which is a terrible first run for the
      "fork it and deploy" promise. Either seed a placeholder param, or fail with an explicit
      message naming the fix ("create your diary root and one trip, then redeploy") rather than
      Next's raw error. Record which in `docs/decisions.md`.
- [ ] Decide what a build does when the Pod is unreachable, as distinct from empty. Failing is
      defensible; failing with an unreadable stack trace is not.
- [x] Confirm the App Shell path: a trip published after the build should be served the shell and
      upgraded in the background, with no redeploy. **Verified** — the build's route table shows
      known params as `○ (Static)` and unknown ones as `◐ (Partial Prerender)`.

- [ ] **Soft 404 on unknown slugs — open, and it matters for SEO.** Under Partial Prerendering
      the static shell is flushed before the dynamic part resolves, so a `notFound()` in the page
      body arrives after the status line is committed: `/trips/nope` returns **HTTP 200 carrying
      404 content**. The body is correct; the status is not, and this site server-renders
      specifically for SEO and share previews (`docs/decisions.md` §2).

      `export const instant = false` does **not** fix this — it governs instant-*navigation*
      validation, not response blocking, despite reading like the fix in Next's labelled-error
      menu. Verified against the bundled docs and by measuring: the status stayed 200.

      Options to weigh, none yet chosen:
      - validate the slug against the cached `allTripSlugs()` inside the shell, so an unknown
        slug is rejected before anything dynamic is touched
      - make these routes fully dynamic, giving up PPR on them
      - accept the soft 404 and mark unknown slugs `noindex` in `generateMetadata`
      Decide before phase 5, since OG images and share previews depend on it.

## Phase 2 — studio

- [ ] Solid login, static client ID document, session restore across reload
- [ ] Owner check with the "signed in as X, this diary belongs to Y" message
- [ ] Entry create and edit, index maintenance, revalidation hook
- [ ] First-run `initialiseContainers()`, idempotent, verifying resulting access rather than
      assuming writes took effect
- [ ] `localStorage` autosave of in-progress text

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

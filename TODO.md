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

So `docs/` and `.claude/` may stay. `CLAUDE.md`, `AGENTS.md`, `README.md`, `TODO.md` and
`scripts/` will block it.

**`create-next-app` also generates `AGENTS.md` and `CLAUDE.md` itself**, programmatically
rather than from a template. Pass `--no-agents-md` and there is nothing to merge at scaffold
time — `next dev` adds the managed block afterwards anyway.

Do this:

- [ ] Move `CLAUDE.md`, `AGENTS.md`, `README.md`, `TODO.md` and `scripts/` aside — into
      `docs/`, which is tolerated, or one directory up. Leave `docs/`, `.git`, `.gitignore`
      and `LICENSE` in place.
- [ ] Scaffold with `--no-agents-md` (next section).
- [ ] Move the five back.
- [ ] **Merge the two READMEs.** `create-next-app` writes its own with generic dev-server
      boilerplate. The project README wins on structure and content; fold in only what is
      useful, realistically just the dev-server command, then delete the generated version.
      Do not keep both, and do not let boilerplate end up at the top of the file.
- [ ] Confirm `AGENTS.md` is present before the first `next dev`. It is the designated host
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

- [ ] Decide whether to enable Cache Components in phase 1 rather than retrofitting. Record
      the outcome in `docs/decisions.md`.
- [ ] If enabled, read the bundled caching guide first, and treat the labelled error menu as
      the specification for which fix to apply per route.
- [ ] Whichever way you go, the Pod read path needs an explicit caching story before phase 1
      ships. Do not leave it to defaults.

### Prerequisites

- [ ] **Node 22 LTS.** Write `.nvmrc` containing `22.23.2`. **Not 24, and not 20** — the two
      Inrupt packages disagree: `@inrupt/solid-client@3.0.0` declares
      `^20.0.0 || ^22.0.0` and `@inrupt/solid-client-authn-core@5.0.0` (transitive, via
      `solid-client-authn-browser`) declares `^22.0.0 || ^24.0.0`. The 22 line is the only
      overlap, and `jsdom@30.0.1` (`^22.22.2`) sets the floor inside it. Verified against the
      registry in phase 0; full reasoning in `docs/versions.md`.
- [ ] **A package manager of your choice** — pnpm, npm, yarn or bun. Whichever you pick, use it
      for everything in this checkout and commit its lockfile; never mix two. The commands below
      are written with pnpm, so substitute the equivalent (`npm run <script>`, `yarn <script>`,
      `bun run <script>`; `npx` or `bunx` for `pnpm dlx`).
- [ ] **Python 3 with rdflib** — `pip install rdflib` — for `scripts/validate-fixtures.py`.
- [ ] Docker is optional. The local Pod runs fine without it (see below).

### Scaffold

- [ ] Create the app:

      pnpm create next-app@16.3.4 . --ts --app --tailwind --eslint \
        --use-pnpm --no-src-dir --import-alias "@/*" --no-agents-md

      Swap `--use-pnpm` for `--use-npm`, `--use-yarn` or `--use-bun` to match your choice —
      the flag decides which lockfile the scaffold generates.

- [ ] **Set TypeScript to 6.0.3.** This is a move *up* from the scaffold default, not a
      rescue. Verified in phase 0: `create-next-app@16.3.4` writes `"typescript": "^5"` into
      the generated `package.json` and installs 5.9.3 — already inside
      `typescript-eslint@8.69.0`'s peer range (`>=4.8.4 <6.1.0`), so nothing is broken on
      arrival and nothing is urgent here:

      pnpm add -D typescript@6.0.3

      TypeScript's `latest` is 7.0.2, but nothing in this scaffold reaches for it. Do not
      install it — it falls outside the typescript-eslint peer range. See `docs/versions.md`.

- [ ] Verify: the `typecheck` and `lint` scripts both run clean before adding anything else.

### Runtime dependencies

- [ ] Install, exact versions:

      pnpm add maplibre-gl@6.6.0 react-map-gl@8.1.2 \
        @inrupt/solid-client@3.0.0 @inrupt/solid-client-authn-browser@5.0.0 \
        zod@4.5.4 exifreader@4.44.0

- [ ] **Do not install `exifr`.** It was last published in 2022. If generated code reaches
      for it, that is stale training data — replace with `exifreader`.
- [ ] `n3@2.7.2` only if a lower-level RDF parser turns out to be needed. Try without it.

### Dev dependencies

- [ ] Install:

      pnpm add -D vitest@4.1.11 @vitest/coverage-v8@4.1.11 \
        @testing-library/react@16.3.3 @testing-library/jest-dom@7.0.1 jsdom@30.0.1 \
        @playwright/test@1.62.1 msw@2.15.0 \
        typescript-eslint@8.69.0 prettier@3.9.6 tsx@4.23.13 \
        size-limit@13.0.3 @size-limit/preset-app@13.0.3

- [ ] `pnpm exec playwright install chromium` — only Chromium is needed, for the login flow.

### shadcn/ui — studio only

- [ ] Initialise:

      pnpm dlx shadcn@latest init

      Template `next`, base colour `neutral`. **Not** `npx shadcn-ui` — that package name is
      dead.

- [ ] Add only what the studio needs. Resist adding the whole registry:

      pnpm dlx shadcn@latest add button input textarea select dialog drawer \
        tabs popover command switch tooltip sonner

- [ ] Confirm `sonner` is used for toasts. shadcn's own `toast` component is deprecated.
- [ ] Note that `drawer` pulls in `vaul`, last published 2024-12. Verify its snap-point API
      against current shadcn docs, not blog posts. This component is the mobile map sheet.
- [ ] Restyle rather than tweak: radius near zero, borders and background steps instead of
      shadows, focus rings in `accent`. See `docs/design-brief.md`.

### Theme tokens

- [ ] Replace the generated CSS variables in `app/globals.css` wholesale with the palette from
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

- [ ] Map the shadcn variables (`--background`, `--foreground`, `--primary`, `--ring`, …) onto
      these tokens at `:root`. **Not under a `.dark` class** — the site is fixed dark, so
      there is no toggle and no flash of wrong theme.
- [ ] Delete any generated light-mode block.

### Project structure

- [ ] Route groups with **separate root layouts**:

      app/(public)/layout.tsx
      app/(studio)/layout.tsx

      Separate layouts are what keep the bundles apart. A single shared root layout importing
      a session provider would undo the whole boundary in one line.

- [ ] Pod layer split along the same seam:

      lib/pod/read.ts      unauthenticated, imported by both
      lib/pod/write.ts     studio only
      lib/pod/access.ts    studio only, the four-method ACL interface
      lib/vocab.ts         every IRI as a named constant

- [ ] Generate `lib/vocab.ts` from `docs/data-model.md` §3 and keep it the only source of IRIs.

### Guardrail enforcement

- [ ] ESLint `no-restricted-syntax` banning raw vocabulary IRIs outside `lib/vocab.ts`:

      {
        selector: "Literal[value=/^https?:\\/\\/(schema\\.org|purl\\.org|www\\.w3\\.org|example\\.org\\/ns)/]",
        message: "Import the IRI from lib/vocab.ts instead of writing it inline."
      }

- [ ] ESLint `no-restricted-imports` so nothing outside `lib/pod/access.ts` imports ACL
      primitives, and nothing under `app/(public)` imports `@inrupt/solid-client-authn-browser`,
      Radix, or anything from `app/(studio)`.
- [ ] Exempt `components/ui/**` from the arbitrary-Tailwind-values rule. shadcn's copied source
      uses them freely and fighting it wastes time.
- [ ] `size-limit` budget on the public routes, failing CI. This is the only enforcement that
      really holds — an agent can rationalise past a lint rule but not past a failing build.
      Set the initial ceiling from the first real build, then only ever lower it.

### Local Pod

- [ ] Run Community Solid Server pinned, no Docker needed:

      pnpm dlx @solid/community-server@7.2.0 -p 3001 -c @css:config/file.json -f ./.pod-data

- [ ] Add `.pod-data/` to `.gitignore`.
- [ ] Wire it as the `pod:dev` script and use it for all development and CI. Do not develop against
      a live Pod.
- [ ] Note which access-control mechanism it uses versus the hosted Pod, and confirm
      `lib/pod/access.ts` covers both.

### Configuration

- [ ] `.env.example`, committed, with every variable and a comment each:

      OWNER_WEBID=
      POD_ROOT=
      SITE_NAME=
      SITE_URL=
      MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark
      REVALIDATE_SECRET=

- [ ] Verify the OpenFreeMap style URL against their current docs before committing it as the
      default.
- [ ] `next.config.ts`: add the Pod host to `images.remotePatterns`. Without it `next/image`
      refuses Pod-hosted photos.
- [ ] Serve `client-id.jsonld` from the app origin, generated from config rather than
      hardcoded, since each deployer serves it from their own domain.

### Scripts and CI

- [ ] `package.json` scripts exactly as listed in `CLAUDE.md`, so the two files cannot drift.
- [ ] CI runs: `lint`, `typecheck`, `test`, `validate:fixtures`, `size-limit`, `build`.
- [ ] `validate:fixtures` must pass from a clean checkout. Verify it now — it is already
      written and already passes. It needs Python 3 with `rdflib`, which is independent of the
      JavaScript package manager.
- [ ] Add a CI check asserting every `dy:` term in `docs/data-model.md` matches the exports in
      `lib/vocab.ts`, in both directions. This is what stops the data model rotting.
- [ ] Add a CI check that every command named in `CLAUDE.md` exists in `package.json`.
- [ ] `.nvmrc`, `.prettierrc`, `netlify.toml`, `Dockerfile`.

### Done when

- [ ] `build` succeeds
- [ ] `test`, `lint`, `typecheck` and `validate:fixtures` all pass
- [ ] Local Pod starts and the app reads one hand-written resource from it
- [ ] A deliberate violation of each guardrail rule fails CI — test the enforcement, don't
      assume it

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

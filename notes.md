# Repository-root config

Why the four config files at the root are the way they are. `CLAUDE.md` carries the rules; this
file carries the reasoning and the measurements behind these four, the way every `notes.md` in
this tree does.

- `eslint.config.mjs` — the guardrails
- `playwright.config.ts` — the e2e runner, and how it stays out of vitest's way
- `vitest.config.ts` — collection, and the one glob that is load-bearing
- `proxy.ts` — the soft-404 middleware

## the-scan-and-what-it-once-could-not-see

`scripts/check-structure.ts` scanned five directories and no root files until 2026-09-09. That
left **57 over-bound comment blocks invisible** — 21 here at the root and 36 under `e2e/` — while
`CLAUDE.md` stated the production comment bound as an absolute zero and `TODO.md` proved it
"absolute" by adding an eight-line block to `lib/config.ts`. The same block in
`playwright.config.ts` kept the build green.

Worse than the count: the anchor check could not read `vitest.config.ts`, whose
`see test/support/notes.md#why-a-walker` pointer is the case `docs/code-structure.md` holds up as
the canonical "one shouted line plus a pointer". The check written to stop that pointer rotting
never opened the file.

Found by the pre-merge review, not by the sweep. `e2e/` is now on the **test** side — it is
Playwright's suite and as much a test as anything under `test/` — which moved the test ratchet
from 509 to 545, and the root files are on the production side, which is why they were swept.

## why the middleware returns the 404

Under Partial Prerendering the static shell is flushed before the dynamic part resolves, so a
`notFound()` inside the page lands **after** the status line is committed and produces a 200
carrying 404 content. Measured, not assumed. `export const instant = false` does not help — it
governs instant-navigation validation — and `force-dynamic` is a no-op now that every page is
dynamic by default.

Middleware runs before rendering, so it is the one place left that can set the status. A soft 404
matters here because this site server-renders specifically for SEO and share previews
(`docs/decisions.md` §2).

No Node APIs: Netlify does not support them here (`docs/decisions.md` §13).

## the module-scope cache is best-effort only

The Next docs warn that proxy code may be deployed to a CDN and should not rely on shared modules
or globals. So the module-scope cache is an optimisation that may simply never hit, not a
guarantee. **The correctness of this file does not depend on it.**

## why the vitest environment is node

Most of the suite needs no DOM and jsdom is not free. Component tests opt in per **file** with a
`// @vitest-environment jsdom` docblock.

No test count here on purpose: that line read "282 tests" until 2026-09-08, by which point the
suite was 1024. `CLAUDE.md` warns about exactly this rot, and this repository had committed it
three times — here; in `playwright.config.ts`, "23 component tests" against 26; and in
`docs/testing-gates.md`, 33 against a real 36. All three were removed rather than corrected, the
last two on 2026-09-09.

## why the include list has five globs and excludes .spec.ts

`components/**` and `app/**` were added **ahead** of the moves that needed them, so a colocated
test could not land uncollected. `hooks/**` was added *with* the move that needed it, on
2026-09-12, which is the same-commit rule in `CLAUDE.md` — a root directory the include list does
not name loses its tests in silence. `test/vitest-collection.test.ts` fails if any of the five
stops matching a file that exists.

`.spec.ts` is excluded and **both halves matter**. `test/fixtures/swallowed-stray.spec.ts` is a
fixture that MUST fail, and `test/network-guard.test.ts` spawns it as a child through
`test/fixtures/vitest.config.ts` — collecting it in the main config would make the suite
permanently red. And `e2e/*.spec.ts` belongs to Playwright.

## why a regex and not a parser, and the guard that could never fail

Middleware must stay small, and this reads one predicate from one resource. `lib/pod/read.ts`
remains the only validated reader — nothing downstream trusts what is extracted here.

**Check it IS a diary before extracting, and test for something that can actually be absent.**
The previous guard tested for the substring `"trip"`, which any document containing a
`.../trips/x/trip.ttl` link necessarily has — so it could never fail. A non-diary 200 response
would then have cached an empty slug set and 404'd every real trip for a minute.

## why the guardrails exist, and the honest limit

`eslint.config.mjs` encodes rules from `CLAUDE.md` and `docs/data-model.md` §11 that cannot be
inferred from the code, and they exist because an agent — or a tired human — will otherwise
rationalise past them.

Note the honest limit, which is `TODO.md`'s: "an agent can rationalise past a lint rule but not
past a failing build". The size-limit budget on public routes is the enforcement that really
holds; these rules catch the same mistake earlier and explain it.

## the ACL primitive list is the fence, so it must be complete

`ACL_PRIMITIVES` bans every access-control primitive `@inrupt/solid-client` exposes outside
`lib/pod/access.ts`. The list IS the fence, so it has to be complete rather than representative:
an unlisted primitive is a hole, and a hole here means `lib/pod/read.ts` can rewrite an ACL with
no lint error at all. Nine names once covered the ones the module happened to use, which is a
different thing.

Re-derive it on an upgrade from `node_modules/@inrupt/solid-client/dist/index.d.ts`: everything
exported from `./acl/acl`, `./acl/agent`, `./acl/group`, `./acl/class` and `./acl/mock`, plus
`getEffectiveAccess` from `./resource/resource` (it reads the `WAC-Allow` header, i.e. it answers
"is this public?" — that is `getAccess`'s job), and the `universalAccess` and `acp_ess_2`
namespaces.

## four arms against arbitrary Tailwind values, and two depths

FOUR ARMS, BECAUSE ONE ONLY SAW HALF THE CODE. Until 2026-09-05 this was the `JSXAttribute` arm
alone, so it read a class string written INLINE in the attribute and nothing else.
`components/studio/entry-editor/entry-editor.tsx` keeps its two shared class strings in
module-level consts spent as `className={CONTROL}` — an `Identifier`, not a `Literal` — and the
rule was blind to both. Measured: `disabled:bg-[#222]` inside `CONTROL` produced zero errors, the
same string inline produced one. Extracting a class string to a const is the ordinary way to stop
two controls drifting apart, so this was not an exotic dodge; it is what the file already did.

THE DEPTHS ARE DELIBERATELY ASYMMETRIC — child-anchored at the declarator, descendant inside the
concatenation — and both halves are load-bearing:

- `VariableDeclarator > Literal` rather than `VariableDeclarator Literal`. The descendant form
  makes `test/guardrails.test.ts` UNLINTABLE: its own fixtures live inside
  `const msgs = await lint(…)`, which makes every deliberate violation a descendant of a
  declarator. Measured — the descendant shape flags that file twice and still passes every
  snippet case, so the tests would look fine while the guardrail broke the file that proves it
  works.
- ...but descendant WITHIN the `BinaryExpression`, because `+` nests to the left: in
  `"a " + "b " + "p-[3px]"` the offender is a grandchild, not a child, and a
  `> BinaryExpression > Literal` arm would pass a two-part concatenation and miss a three-part
  one.
- The `TemplateLiteral` arm exists because static template text is a `TemplateElement`, not a
  `Literal`. Without it the rule is bypassed by swapping a quote for a backtick, which is output
  both a formatter and an agent produce without thinking about it.

Name-agnostic on purpose: a rule keyed to `CONTROL`/`BUTTON` is defeated by a rename, and
directory scoping would need a `files` list that rots. Repo-wide this flags zero places outside
`components/ui/**`, which is already exempt.

**The `-` in the pattern is what keeps `eslint.config.mjs` itself clean**, not the selector depth:
that file holds two bare `[…]` strings, but none with an alphanumeric immediately before the
bracket. Do not "simplify" it away.

NOT covered, and kept in view rather than pretended away: a class string held in an object
property or an array element, and `clsx`/`cva` argument positions. Also note that the
`lib/vocab.ts` block names this list explicitly — new arms do not reach it unless that spread is
kept in step.

## why the two app-root public pages are listed individually

`app/not-found.tsx` and `app/global-error.tsx` are named in the public fence's `files` list
because they are public-facing pages that sit OUTSIDE `app/(public)/**`. Next requires them at the
app root; `not-found.tsx` renders its own `<html>` precisely because there is no shared root
layout to inherit.

A read-only review found `not-found.tsx` could import the Solid auth library with no error at all,
on a page every 404 renders. `global-error.tsx` does not exist yet, and a `files` entry for an
absent file is inert — it is listed so that the day someone adds one, it is not another unfenced
public page.

## the parenthesis hole in the studio fence

`components/studio/**` has NO PARENTHESES, so neither `**/app/(studio)/**` nor `**/(studio)/**`
matched it and the whole media subsystem was reachable from a public page in one import.

Measured, not inferred: at `app/(public)/__fence-probe.tsx`, `@/lib/media`, `@/lib/studio/session`
and `@/app/(studio)/layout` were each reported, while `@/components/studio/entry-editor` produced
no output at all — and that one import drags `lib/media/*`,
`lib/pod/{write,save-entry,access}` → `@inrupt/solid-client`, `lib/studio/*` → the auth library,
and Radix into the public graph. Reusing `Field` or the tag parser out of the editor is the obvious
move that trips it.

## why a fence names the bare directory as well as the subpath

`no-restricted-imports` matches these groups with **gitignore semantics, not minimatch**, so
`"**/lib/media/**"` alone does NOT match a bare `"@/lib/media"` import resolving to an index file.
Every fenced directory therefore appears twice, bare and with `/**`.

Measured, not inferred: before the bare entry existed, linting `import * as m from "@/lib/media"`
at `app/(public)/__fence-probe.tsx` reported nothing at all, while the same file importing
`"@/lib/media/resize"` was reported — so the file was being linted and the fence simply did not
match. There is no `lib/media/index.ts` today; the bare entry closes the hole before there is one,
which is the only time it can be closed without a public bundle already carrying the weight. The
same hole was found and closed once already on this branch, at `components/studio`.

These are also the semantics that make the Radix entry's subpath redundant — next section.

## the three Radix spellings, and which one does the work

All three, because the one this project actually writes was the one missing. `package.json`
depends on `radix-ui` ^1.6.7 — the unified package — and on no `@radix-ui/react-*` package
directly; all seven Radix imports under `components/ui/**` are `from "radix-ui"`. So the group
used to fence a scoped spelling that appears nowhere in the repository, while the spelling someone
would actually produce — copying a line out of `components/ui/dialog.tsx` — sailed through.

On `radix-ui/*`, measured rather than assumed: under the gitignore semantics above, the bare
`radix-ui` entry ALREADY covers `radix-ui/dialog` and deeper. The subpath entry is redundant today
and kept anyway, because the subpath is genuinely reachable (the exports map has `"./*"` and
`dist/dialog.mjs` exists) and this is the entry that would still fence it if that matcher ever
changed. **Do not read it as the thing doing the work — the bare name is.**

The scoped form stays on its own account: `radix-ui` depends on the scoped packages, so they sit
in `node_modules` and a deliberate import, or one copied out of Radix's own docs, resolves today.

## why next-themes is fenced from public routes

`next-themes` arrives as a transitive concern of shadcn's sonner component
(`components/ui/sonner.tsx` imports `useTheme` from it), so it is on disk and importable.

Nothing public may want it: `CLAUDE.md` fixes the theme to dark, puts the palette at `:root`
rather than under a `.dark` class, and rules out a theme toggle. A `next-themes` import on a
public route is therefore either dead weight in the bundle or the start of a toggle that the
design has already declined. Studio and `components/ui` keep it. Bare name only: per the section
above it covers subpaths too.

## why the function-length bounds are 200 and 80, in blocks of their own

`CLAUDE.md`'s "Code structure" sets 130 for a render and 50 for a util as TENDENCIES; the lint
rules carry the 200/80 bounds CI refuses. The tendency is reported by `npm run check:structure`,
which does not fail on it — the maintainer's numbers are "tend to", not a dictate, and a lint
error cannot express that.

`skipComments` is what makes the number mean anything: this repository runs 44% comment lines, so
a 200-line span is routinely an 80-line function.

Own blocks per rule name, because flat config REPLACES a rule's options rather than merging them —
the `no-restricted-imports` blocks carry the scar. Nothing is overwritten here, and keeping them
separate is why.

## why Playwright exists here, and for exactly two flows

`CLAUDE.md`, Testing: "Playwright only for what cannot be meaningfully tested faster — never a
slow duplicate of a fast test." That is the whole remit, and it is a bar each flow has to clear
rather than a licence to add a third.

The studio's states — restoring, signed-out, owner, not-owner, the expiry subscription — are
covered by the component tests in `components/studio/studio-shell/studio-shell.test.tsx`, which
run in about a second. Re-driving them in a browser would be a slow duplicate of a fast test,
which is worse than no test: it costs minutes per run and finds nothing the fast one does not.

THE FILE IS NAMED AND NO TOTAL IS GIVEN, DELIBERATELY. That sentence said "23 component tests"
until 2026-09-06, by which point `vitest list` reported 26. Commit 3c751c6 went through
`CLAUDE.md` deleting every instance of that same number, replacing counts with file names and
adding "do not reintroduce a total" — and `playwright.config.ts`, one directory over, kept it
anyway. A count in prose is wrong the next time a test is added and nothing checks it. Let
`vitest list` do the counting.

The login redirect clears the bar because a real OIDC round trip cannot be unit-tested at all.
`e2e/media-pipeline.spec.ts` clears it for a different reason, and one that was measured rather
than assumed (2026-09-06): jsdom has no `createImageBitmap`, no `OffscreenCanvas` and no encoder,
and a jsdom `Blob` reaches MSW as the NINE BYTES of the string `"undefined"`. So the fast tests can
pin file names, content types, IRIs and call order — and cannot see one pixel or one EXIF tag of
what is actually uploaded. That file is the only place the real bytes are read back, and the defect
that justifies it is the pass-through shortcut in `lib/media/pipeline.worker.ts`, which would put
the owner's unstripped GPS into a publicly readable container.

## why testDir keeps the two runners apart

WHY THIS FILE HAD TO EXIST AT ALL. Without a config, Playwright falls back to scanning the
repository, finds `test/*.test.ts`, tries to load the Vitest suites as Playwright specs and dies
inside `@vitest/runner`: "TypeError: Cannot read properties of undefined (reading 'config')" at
`test/access.test.ts:103`, before reporting on anything.

`testDir` is what stops that: Playwright only ever looks in `e2e/`, and vitest collects only
`*.test.ts(x)`, so neither runner can collect the other's files.

**The separation is the EXTENSION, not the directory.** Vitest's `include` grew to four globs on
2026-09-08 (test, lib, components, app) when tests moved beside their subjects, and would grow
again; `.spec.ts` matches none of them at any depth, and `test/vitest-collection.test.ts` pins
that no `.spec.ts` is ever collected. Do not restate vitest's include in `playwright.config.ts`:
that comment named two globs and was stale the day a third was added.

## one worker, no parallelism, no retries

The spec drives a real OIDC round trip against one Community Solid Server account. Two workers
would race over the same session cookie and the same "remember this client" state on the server.

A retry would quietly turn "the login flow is flaky against a real provider" — the single most
valuable thing this spec can tell us — into a green tick on the second go.

## the two timeouts, and which one reports a failure first

`timeout` is generous because the first request to `next dev` compiles the route — but not so
generous that a broken flow takes two minutes to say so. The happy path runs in about ten seconds
end to end.

Every wait inside the spec is a web-first assertion bounded by `expect.timeout`, so a failure
surfaces at twenty seconds with the URL the browser is stuck on, rather than at the test timeout
with "waiting for navigation".

## Chromium only, and the bundled build rather than the device descriptor

`TODO.md` phase 0.5 installs Chromium alone, and `devices["Desktop Chrome"]` adds a spoofed
Windows user agent this flow has no use for — so the project is `{ browserName: "chromium" }`.

Install it with `npx playwright install chromium`, and check the revision matches: a cache left
over from an older Playwright does not count.

## why the web server is next dev, not a production build

React only double-invokes effects under StrictMode in a DEVELOPMENT build.
`docs/phase-0-spike.md` question 2 found that the two invocations disagree — the first
`handleIncomingRedirect` returns `isLoggedIn: false` and the second returns `true` — which is the
entire reason `restoreSession` installs its memo synchronously. A production build invokes the
effect once, so `next start` would run the round trip without ever exercising the bug the memo
exists for, and would report green if the memo were deleted. Strict Mode is on by default with
the App Router
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactStrictMode.md`),
so nothing needs configuring for this.

Secondary, but real: with Cache Components on, the production build reads the Pod during
prerender, so `build && start` would need the Pod seeded before the build as well as before the
tests, and would bake a `/studio` prerendered from build-time Pod state. And it costs minutes in
front of one spec.

What this gives up is that dev is not what ships. That gap is covered: `npm run build` is in
`CLAUDE.md`'s definition of done and reads the same Pod, so a production-only failure is caught
there rather than here.

## why the readiness probe is a route that does not read the Pod

`webServer.url` is `/client-id.jsonld` and NOT `/`, deliberately. See the ordering note at the top
of `e2e/global-setup.ts`: this probe runs BEFORE `globalSetup`, so it must not be a route that
reads the Pod — `/` would render the diary against a possibly-unseeded Pod and cache the failure.

`/client-id.jsonld` reads only `SITE_URL` and `SITE_NAME`, and answers 500 if `SITE_URL` is unset,
which Playwright treats as not-available rather than ready.

## never reuse an existing dev server

A dev server someone already has open is running with their `.env.local` — `POD_ROOT` pointed at
whatever pod they were last working on — and reusing it would run the whole spec against the wrong
Pod while reporting green.

With `reuseExistingServer: false` Playwright throws "…is already used" instead, which is the right
answer: stop the other server, or set `E2E_PORT`.

## why the env is passed as real process variables

`appEnv` is passed as real process variables, which is also how those keys beat `.env.local`:
`@next/env` snapshots `process.env` before reading any `.env` file and never overwrites a key
already present in that snapshot (`node_modules/@next/env/dist/index.js`, `processEnv`).

And because nothing here goes through a dotenv parser, the `#` in `OWNER_WEBID` cannot be eaten as
a comment — see the note in `e2e/environment.ts`.

## why the publicly reachable lib modules are fenced too

`app/(public)/**` and `components/public/**` are fenced from `lib/studio`, but the modules they
*import* were not. Phase 4 stage 0 moved `lib/time/offsets.ts` and `lib/place/precision.ts` out of
`lib/studio` precisely so the public timeline could reach them — which means a later edit adding
`import { session } from "@/lib/studio/session"` to either one would put
`@inrupt/solid-client-authn-browser` in a public bundle, with every fence above it still green.

`lib/pod/read.ts` has had exactly this property since phase 1, and nothing had noticed: it is
imported by every public page and restricted by nothing. `size:public`'s marker scan would catch
the leak at build time, which is why this was never a live defect — but `eslint.config.mjs`'s own
docblock says the point of these rules is to catch the same mistake earlier.

**The set is every module a public page can reach, not only the two this stage moved** — the
sentence this note lacked the first time, and the gap a review found by grepping what
`app/(public)/page.tsx`, `sitemap.ts`, `rss.xml/route.ts` and both `trips/[slug]` pages actually
import: `lib/config.ts`, `lib/vocab.ts`, and `lib/pod/cached.ts` (which wraps `read.ts` and is
what every one of those entry points actually calls), plus `result.ts`, `tags.ts` and `schema.ts`
underneath it. A grep still missed `lib/pod/rdf.ts`, one level deeper again — `read.ts` imports
values from it — which is why `test/guardrails.test.ts` now walks the real import graph from the
public entry points instead of trusting a list assembled by reading imports by eye.

Named paths rather than a glob over `lib/**`, deliberately — enumerated so `lib/media`,
`lib/pod/write.ts`, `lib/pod/access.ts` and `lib/pod/save-entry.ts` stay off the list. Those four
are studio-only and *must* import Inrupt packages; a blanket rule would fence the modules whose
job it is.

**This fence, and every other one written with `no-restricted-imports`, sees only STATIC
imports.** Measured 2026-09-09: a dynamic `import("@/lib/studio/session")` produces zero messages
at a belted module — and zero written directly in `app/(public)/page.tsx`. The rule reaches an
`ImportDeclaration` and an `export … from`, never an `ImportExpression` or a `TSImportType`.

That is not a hole to close, it is the property the map depends on. `CLAUDE.md` requires MapLibre
to be lazy-mounted, and stage 0's own `maplibre-gl` fence is built on exactly this asymmetry:
`import maplibregl from "maplibre-gl"` is refused, `await import("maplibre-gl")` is allowed,
because the second produces a chunk no prerendered page references. A rule that caught both would
ban the map outright.

So the honest statement of what these fences are: **a static-import guard, backstopped by
`size:public`'s marker scan for anything that actually ships.** A dynamic import of studio code
from a public route lints clean and is caught only at build time, by name, in
`scripts/check-public-bundle.ts`'s `BANNED_DEPS`.

`lib/map/**` and `lib/utils.ts` joined the belt in phase 4 stage 2, for the same reason
`lib/pod/rdf.ts` did: stage 1 created `lib/map` and nothing restricted it, so a static
`import { Map } from "maplibre-gl"` in `lib/map/view.ts` would have been lint-clean and 252.8 kB
in a public chunk. `lib/utils.ts` has the identical property once a public component imports
`cn` from it.

## why the maplibre entries are hoisted

`MAPLIBRE_PATH` and `MAPLIBRE_PATTERN` are declared once, near the other shared consts, because
the public block and the belt block both need them and flat config replaces a rule's options
per file rather than merging them — two hand-kept copies is exactly the shape the belt's
`ACL_PRIMITIVES` repetition nearly drifted on. The exact-specifier spelling of `MAPLIBRE_PATH` is
unchanged: a `maplibre-gl/**` group would also refuse `maplibre-gl/dist/maplibre-gl.css`, which
the attribution control needs, and no negation rescues it under gitignore semantics.

## why the belt names any studio directory

The belt fences its members from `**/studio` and `**/studio/**`, not from `**/lib/studio` and
`**/hooks/studio`. The narrower pair was written first and measured wrong: from `hooks/map` the
studio hooks are a *sibling*, spelled `../studio/use-entry-save`, and that specifier contains no
`hooks/` segment for a glob to match. `**/studio/**` alone catches the subpath but not a bare
`../studio`, so the group carries the bare form too — the same asymmetry
`#why-a-fence-names-the-bare-directory-as-well-as-the-subpath` records for `lib/media`.

Naming any directory called `studio` is deliberately broader than the hole it closes. A belt
member is by construction in the public import closure, and nothing in that closure has business
importing a directory named `studio` by any spelling or from any depth. The breadth costs an
allow-case if a public-reachable module ever legitimately wants one, which would itself be the
bug.

This is the second time the relative spelling has escaped a fence written in absolute terms. The
first was `components/studio/**` missing the parenthesised route group; both were found by
measuring specifiers rather than reading globs.

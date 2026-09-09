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
suite was 1024 — the count-in-prose rot that `CLAUDE.md` and `playwright.config.ts` both warn
about, and that this file's own testing-gates counterpart then committed again with 33 against a
real 36.

## why the include list has four globs and excludes .spec.ts

`components/**` and `app/**` were added **ahead** of the moves that needed them, so a colocated
test could not land uncollected. `test/vitest-collection.test.ts` fails if any of the four stops
matching a file that exists.

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

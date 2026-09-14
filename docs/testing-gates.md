# The e2e gate, and why the definition of done is ten commands plus one

`CLAUDE.md` `## How work is done here` carries the rule: ten unconditional commands, plus
`npm run test:e2e` when the diff touches one of the paths below. **This file is why those
paths**, and why the gate is scoped to the diff rather than added to the list. No count here on
purpose: the list gained `hooks/studio/**` on 2026-09-12 while three sentences elsewhere still
said "six", and a reader reconciling a numeral against a list deletes the newest entry.

**An eleventh command, path-scoped rather than unconditional.** If the diff touches any of

```
lib/studio/**   app/(studio)/**   components/studio/**   app/(public)/client-id.jsonld/**
lib/media/**   lib/pod/write.ts   hooks/studio/**
components/public/**   lib/map/**   hooks/map/**   hooks/trip/**
app/(public)/page.tsx   scripts/seed-dev-pod.ts
```

then `npm run test:e2e` must pass too. **Three seams, not one.**

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

`hooks/studio/**` is the React half of both seams, added 2026-09-12 when the hooks left the
component folders. `use-photo-pipeline.ts` drives the media pipeline and `use-entry-save.ts` the
§10 write sequence; before the move they sat inside `components/studio/**` and were gated by it,
and a root directory named by no glob is gated by nothing. It is the one hole in
`docs/code-structure.md`'s table that no test closes — the gate is prose, read by a person.

That test is also the only place in this repository where the bytes that actually reach the Pod
are read back and inspected. jsdom has no `createImageBitmap`, no `OffscreenCanvas` and no
encoder, and a jsdom `Blob` arrives at MSW as the nine bytes of the string `"undefined"` —
measured 2026-09-06. So every faster test can check file names, content types, IRIs and call
order, and none of them can check one pixel or one EXIF tag.

It is deliberately NOT in the list above. The ten run anywhere with a checkout and Node 22;
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

`components/public/**`, `lib/map/**` and `hooks/map/**` are the map seam, added 2026-09-13
(`docs/decisions.md` §32) after three deferrals recorded in §28. `e2e/trip-map.spec.ts` and
`e2e/trip-timeline.spec.ts` are what catch a browser-only failure here — stage 3's `maplibre-gl`
worker bug left the canvas painting and the attribution control intact while every worker-dependent
feature silently never ran, which is exactly the shape no faster test sees. The same three globs do
not reach a `maplibre-gl` version bump: that touches `package.json` and `package-lock.json`
instead, and §32 records the gap rather than closing it, because adding the lockfile would gate
nearly every dependency bump.

`hooks/trip/**` joined that seam on 2026-09-14, one stage late. Stage 4a created the directory —
`useHighlightState` and the context that every marker and every timeline row reads — and put it in
the ESLint belt, which is the OTHER of the two lists `docs/code-structure.md` says a new hooks area
must join **in the same commit**. It reached this one only now, and **nothing failed in between**,
which is exactly why it stayed invisible: every diff that has touched `hooks/trip` so far also
touched `components/public/**`, so the gate fired anyway and no run was ever actually skipped. A
diff confined to `hooks/trip` — the pin precedence in `useHighlightState`, say, which is what
decides whether a tapped marker opens the sheet at all — would have slipped `e2e/map-sheet.spec.ts`
and `e2e/trip-timeline.spec.ts` with nothing to say so. The belt half has a test behind it in
`test/guardrails.test.ts`; this half is prose read by a person, the same hole `hooks/studio/**`
above is named for.


`app/(public)/page.tsx` and `scripts/seed-dev-pod.ts` joined the same seam on 2026-09-14, with
stage 5's globe, and **this one had already fired in anger before it was written down.** Commit
`c6b0969`, "The diary page becomes a globe with its trips beside it", changed three files:
`app/(public)/page.tsx`, `app/(public)/page.test.tsx` beside it, and `test/guardrails.test.ts`. No
glob above matches any of them, so the gate did not ask for a run on the commit that turned `/`
into a map — the one commit in the stage where a browser check was most worth having. Every other commit in the stage also touched
`components/public/**` and fired the gate anyway, which is precisely how the hole stayed invisible:
it is a page, it is public, and it is the busiest route in the app, and it was gated by nothing.

The seeder is on the list for a different reason: **it is the fixture the browser cases assert
against**, so changing it changes the test without touching the test. `e2e/diary-globe.spec.ts`
names `2026-japan`, `2025-patagonia` and `2026-secret` and asserts markers at their seeded
coordinates; control 5 in `e2e/notes.md` is that measured, one line in the seeder turning all five
cases red. A seed-only diff — a third trip, a moved coordinate, a status flipped — is exactly the
change that needs the run and would have skipped it. Both halves are prose read by a person, the
same shape as `hooks/studio/**` and `hooks/trip/**` above.

## Running it

`env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`.

The `env -u` is because the harness behaves differently when it detects an agent. The `E2E_PORT`
is because a `next dev` often holds 3000 in this project and `reuseExistingServer: false` makes
Playwright refuse rather than quietly run against another `.env.local` — measured 2026-09-08.

## Proving the integration suites ran rather than skipped

The two Pod suites skip themselves when nothing answers on `localhost:3001`, which is correct —
but Vitest 4 prints no `skipped` line at zero, so a green `npm test` reads the same whether they
ran or were absent. The control:

```sh
npx vitest run test/integration/                                    # all passed
TEST_POD=http://localhost:3999 npx vitest run test/integration/     # all skipped
```

Both halves. A count alone is not evidence: it is the same N either way, whatever N is, and only
the flip between passed and skipped shows the suites are genuinely Pod-dependent and that the skip
path still works. Used on every task of the 2026-09-08 refactor.

**No total here, and that is the durable form.** All three lines above said 33 until 2026-09-09,
by which point Stage C had added three integration cases and the real number was 36 — in the one
file that also quotes `CLAUDE.md`'s own rule against reintroducing a total, and the one people
actually run. What the control proves is the flip, not the count.

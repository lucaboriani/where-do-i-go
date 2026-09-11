# Phase 4 stage 2 — complete on `phase-4-stage-2`, unmerged

All six tasks landed. Branch from `main` @ `e8690a2`; `main` is untouched.

Plan: `docs/superpowers/plans/2026-09-10-map-and-timeline-stage-2.md`.
Spec: `docs/superpowers/specs/2026-09-09-map-and-timeline-design.md` §5, with §1 for the bundle
controls. The SDD ledger at `.superpowers/sdd/2026-09-10-map-and-timeline-stage-2/` is gitignored
and **left in place**: it holds fourteen rulings, six task briefs, and every review report.

> This file previously described the branch as partial, stopped after task 2 — the owner paused
> the run on 2026-09-10 and resumed it on 2026-09-11. That is why the commit list has a
> "stops after task 2" commit in the middle of it.

## What landed

| Commit | What |
|---|---|
| `7517322` | `lib/map/**` and `lib/utils.ts` join the eslint belt; the two `maplibre-gl` entries hoisted so the public block and the belt cannot drift; `.pod-data` into `globalIgnores` |
| `4c591b3` | `useMapInstance` — the dynamic import inside the effect, one instance, the unconditional attribution control, one `setProjection` call site, teardown on unmount |
| `5388e97` | `TripMap` — the client container, the IntersectionObserver, the stylesheet import, `MAP_FRAME_CLASS`, the barrel |
| `66827d7` | `app/(public)/trips/[slug]/layout.tsx` — the map above `children`, which is what makes it survive navigation |
| `bb6da60`, `b54f544` | the `[slug]` navigation measurement, and a correction to a false "no warnings" claim |
| `7552c31`, `cdd8e53`, `68bb996` | `findLazyChunks`, its CLI-level coverage, and which half of it is actually new |
| `1ee9ca3`, `f69fb02` | `e2e/trip-map.spec.ts`, decision §28, the `TODO.md` write-up, and the laziness correction |

## The definition of done, run on `f69fb02` and read

| Check | Result |
|---|---|
| `node -v` | v22.23.2 |
| `npm test` (Pod up) | **1508 passed / 2 todo / 0 skipped / 69 files** — from 1471/66 at the branch base |
| dead-port control | **1472 passed / 36 skipped**, exactly the two `test/integration/` files; verified those 36 run for real with the Pod up |
| `npm run lint` | clean, `--max-warnings 0` |
| `npm run typecheck` | clean |
| `npm run validate:fixtures` | all fixtures valid |
| `npm run check:vocab` | 50 `dy:` terms both directions |
| `npm run check:commands` | 14 and 14 |
| `npm run check:structure` | Structure OK; `active exemptions — 0`; production comment ratchet 0, test ratchet 545, both at the allowance |
| `npm run build` | clean |
| `npm run size:public` | 178.2 kB gzip worst public route against 190 kB; every banned dependency absent |
| `npm run test:e2e` | **9 passed** (4 media-pipeline, 2 solid-login, 3 trip-map) |

**The positive control, verified by hand on the real build rather than only through the script:**
the MapLibre chunk exists on disk (`static/chunks/1gawt8ufzox7b.js`) and is referenced by **0**
prerendered pages, while a framework chunk on the same build is referenced by 20. That is both
halves of what §1 asked for — the library is built, and no public page's HTML names it.

## Four checks in this plan could not fail, and each was found by running it

This is the stage's most useful output, and it is the reason the plan's own instruction to
mutation-test everything earned its cost.

1. **The bbox-identity test case** — the "never remounted" invariant's only mechanical defence —
   asserted that one instance exists after a rerender. True whether or not `bbox` sat in the
   dependency array, because the effect's `map.current !== null` guard hides the second run. Now
   counts reads of `container.current`, which the guard runs *before*.
2. **Task 5's Step 6 mutation**, meant to prove the bundle control catches a module-scope import,
   added an *unused* import that Turbopack tree-shakes. `size:public` stayed green. The faithful
   mutation — the real, used dynamic import lifted to module scope — is caught by lint first, then
   by `size:public`.
3. **`size:public`'s `maplibre-gl absent` line**, which read identically whether the map was lazy
   and correct or missing entirely. That is what `findLazyChunks` exists to fix.
4. **The e2e laziness assertion.** The map frame sits at the top of the layout with nothing above
   it and `rootMargin` is `200px`, so it is inside the observer's margin on load. The chunk is
   requested ~770 ms *before* the scroll dance begins, and the canvas case that never scrolls gets
   a canvas in 1.4 s. The assertion was dropped rather than left unfalsifiable.

A fifth, adjacent: deleting `|| mapFailed` from `main()` passed the entire suite until Task 5's fix
round added CLI-level cases — a control that was not itself controlled.

## Two things the owner should know

**The observer is implemented correctly but gates nothing on this page.** Because the frame is
above the fold, the map always activates on load. The bundle win is unaffected — the chunk is
absent from the prerendered HTML's chunk list, which is what `size:public` weighs — but the
"don't download until scrolled" win is not realised on the trip page as laid out today. If that
win matters, it needs content above the frame or a smaller `rootMargin`, and either is a design
change rather than a bug fix.

**A measurement in `components/public/trip-map/notes.md` was wrong and has been corrected in
place.** It claimed laziness held in a real browser on a landing-then-scroll canvas count. That
count was elapsed wall-clock time between two synchronous samples, not scroll-triggered
activation. The correction is marked as one, with the date and the contradicting evidence.

## Open, and deliberately so

**`components/public/**` and `lib/map/**` do NOT join the e2e gate globs.** Spec §5 proposed it;
§5 also makes the change conditional on the owner's sign-off, and the owner deferred it on
2026-09-10, to revisit when stage 3's markers land. So `e2e/trip-map.spec.ts` is run deliberately
rather than by a path match, and a future diff touching only the map will not trip the gate. A
known hole, recorded in `docs/decisions.md` §28 and as an open item in `TODO.md`.

**Whether changing `[slug]` remounts the layout is unmeasured.** trip → entry → back → entry keeps
one canvas and the same DOM node — measured. trip A → trip B could not be exercised: no in-app
link joins two trips, an injected plain `<a>` is a document load (measured, not assumed), and the
only other seeded trip is a draft that renders not-found with no map frame. Closing it needs a
second *published* trip in the seed plus a link between trips.

Two Minor findings were left deferred rather than fixed: `findLazyChunks` throws on zero chunks but
not on all-empty sources, so its diagnostic would misreport unreadable chunks as "no chunk contains
maplibre"; and `check:structure`'s test-comment ratchet sits at exactly its allowance, so the next
e2e docblock over six lines fails the build.

## What stage 3 inherits

- `TripMap` takes `bbox` and `styleUrl` only. Markers need the `IndexEntry[]`, so the prop is added
  there, along with `lib/map/points.ts`, `legs.ts`, `dashes.ts` and `view.ts` — all now inside a
  fenced directory.
- `useMapInstance` returns a status, not the instance. Widen it to `{ status, map }` in stage 3
  rather than reaching into the ref from the component.
- `setProjection` has exactly one call site. The globe view changes its argument rather than adding
  a second call.
- `SOURCE_ID` is `"openmaptiles"`; stage 3's point and leg sources must not collide with it.
- **A trap:** `TripMap`'s SSR safety depends on the returned markup *not* branching on `active`.
  The lazy `useState` initializer returns `true` on the server and `false` on the client, so any
  future edit that makes the JSX depend on `active` — a loading state, a marker layer — becomes a
  real hydration mismatch. Stage 3 is the likely first offender.

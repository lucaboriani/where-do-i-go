# Phase 4 stage 2 — partial, stopped after task 2 by instruction

Branch `phase-4-stage-2`, from `main` @ `e8690a2`. **Unmerged.** The owner narrowed the run
mid-flight on 2026-09-10: execute task 2 and its review, then stop. Tasks 3-6 are unstarted.

Plan: `docs/superpowers/plans/2026-09-10-map-and-timeline-stage-2.md`, six tasks.
Spec: `docs/superpowers/specs/2026-09-09-map-and-timeline-design.md` §5, with §1 for the bundle
controls. The SDD ledger at `.superpowers/sdd/2026-09-10-map-and-timeline-stage-2/` is gitignored
and **left in place**: it holds the eight rulings, the six task briefs and both review reports.

## What landed

**`7517322` — `lib/map` joins the fences it had been outside of since it was created.** Stage 1
created `lib/map/` and could not fence it: stage 0 enumerated both the belt and the `maplibre-gl`
ban by name and the directory did not exist yet. So a static `maplibre-gl` import in
`lib/map/view.ts` was lint-clean, which is 252.8 kB into a public chunk against 190 kB of budget
with no error at all. `lib/utils.ts` had the same property and a public component is about to
import `cn` from it.

The two maplibre entries are hoisted into shared consts rather than copied, because flat config
replaces a rule's options per file rather than merging them, so both blocks must carry both
entries. The exact-specifier spelling survives untouched — a `maplibre-gl/**` group would also
refuse the stylesheet subpath the attribution control needs. `.pod-data` joins `globalIgnores`.

**`4c591b3` — the map instance is created once, lazily, and destroyed on unmount.**
`components/public/trip-map/hooks/use-map-instance.ts`: the dynamic import inside the effect, one
instance, the unconditional attribution control, one `setProjection` call site inside the
`style.load` handler, `fitBounds` without animation, teardown on unmount. Eleven cases against a
fake `maplibre-gl`, plus a source scan in `test/guardrails.test.ts` pinning the single call site.

## Measurements, all run and read on `4c591b3`

| Check | Result |
|---|---|
| `npm test` (Pod up) | **1494 passed / 2 todo / 0 skipped / 67 files** — from 1471/66 at the base |
| dead-port control | **1458 passed / 36 skipped / 2 todo**, exactly the two `test/integration/` files |
| `npm run lint` | clean, `--max-warnings 0` |
| `npm run typecheck` | clean |
| `npm run validate:fixtures` | all fixtures valid |
| `npm run check:vocab` | 50 `dy:` terms both directions |
| `npm run check:commands` | 14 and 14 |
| `npm run check:structure` | Structure OK, `active exemptions — 0` |
| `npm run build` | clean |
| `npm run size:public` | within budget, every studio-only dependency absent |

`npm run test:e2e` was **not** run and is not required: the diff touches none of the six gated
paths, and `components/public/**` is deliberately not among them — see the deferred decision below.

**The `maplibre-gl absent` line in `size:public` is currently vacuous, and worth knowing before
anyone reads it as reassurance.** Nothing imports the hook yet, so no chunk in the build contains
MapLibre at all — verified by grepping `.next/static/chunks`. That line will read `absent`
identically whether the map is correct, lazy, or entirely missing. Closing it is task 5's whole
purpose (`findLazyChunks`), and until task 5 lands the budget says nothing about the map.

One full-suite dead-port run failed a single pre-existing studio case
(`entry-editor.autodate-edges.test.tsx`, "refuses an offset-only second photo beside the first
photo's clock"). It passed 5/5 in isolation under both configurations and the whole suite passed
on re-run, so it is a load-dependent flake, not a regression — this branch touches nothing that
file reaches. Recorded because a flake seen once and not written down gets rediscovered.

## Two defects in the plan, found by running it

**The plan's hook does not pass this repository's lint.** Its sample writes a ref during render
(`react-hooks/refs`) and calls `setStatus("loading")` synchronously inside the effect
(`react-hooks/set-state-in-effect`). With `--max-warnings 0` and no `eslint-disable` permitted it
was unshippable as written. The committed hook syncs the ref in an effect and derives the public
status from `active` plus an internal `pending|ready|failed` outcome; `MapStatus` is unchanged.
The synchronous `setStatus` also caused a real reproduced bug — a cascading render tore the effect
down and rebuilt it, and two overlapping `import("maplibre-gl")` calls raced, one resolving to the
real library instead of the mock.

**The plan's bbox-identity case was vacuous, and it was the "never remounted" invariant's only
mechanical defence.** It asserted `created` stays at length 1 after a rerender — which is true
whether or not `bbox` sits in the dependency array, because the effect's `map.current !== null`
guard hides the second run. The mutation was measured staying green. The case now counts reads of
`container.current`, which the guard runs *before*, so the count cannot be hidden; the rerender is
synchronous, before any `await`, so the import promise provably cannot have resolved and the count
is deterministic (confirmed over five consecutive runs).

What this established about the invariant itself: **the `map.current !== null` guard is what keeps
an existing instance alive, not the dependency list.** The deps list matters only in the window
before `map.current` is set, where a `bbox` identity change would start a second import chain —
churn rather than a duplicate map, since the stale chain bails on `live` before constructing. Say
it that way rather than "the deps array protects the invariant", which is what the plan implied.

## What remains

- **Task 3** `TripMap` — the `"use client"` container, the IntersectionObserver, the stylesheet
  import, `MAP_FRAME_CLASS`, the barrel.
- **Task 4** `app/(public)/trips/[slug]/layout.tsx` — the actual mechanism for "never remounted",
  since Next preserves layout state across navigation. Includes the unmeasured question of whether
  trip A → trip B remounts the layout, which goes in `notes.md` as a measurement either way.
- **Task 5** `findLazyChunks` — the positive bundle control described above.
- **Task 6** the Playwright spec, `docs/decisions.md` §28, and the `TODO.md` write-up.

Task briefs for all four are already written, in the gitignored ledger directory.

Two review findings from task 2 are deferred rather than fixed, both Minor:

- **`use-map-instance.ts:35-36`** — a container that is null when the effect first runs reports
  `"loading"` forever, with no retry path, and no case covers it. Likely unreachable once task 3
  drives `active` from an observer on the same div, but it is a stuck spinner if that precondition
  is ever violated. Worth a test or a recorded precondition when task 3 lands.
- **`components/public/trip-map/notes.md:26`** — the prose forward-references a `[slug]` heading
  that task 4 was to add to the same file. With task 4 unstarted the reference dangles. Inherited
  verbatim from the plan's sample prose, not introduced by the diff; a one-line fix.
  `check:structure` does not catch it, and correctly so — it validates anchors that code points
  at, not forward references inside prose.

## The decision that is still open

**`components/public/**` and `lib/map/**` do NOT join the e2e gate globs.** Spec §5 says they
should, but §5 makes that change conditional on the owner's sign-off within the stage, and the
owner deferred it on 2026-09-10, to revisit when stage 3's markers land. So a diff touching only
the map does not require `npm run test:e2e`. That is a known hole, recorded rather than papered
over — and it is why `test:e2e` was not part of this branch's definition of done.

`docs/decisions.md` §28 does not exist yet: it was task 6's to write, and §27 is still the last.

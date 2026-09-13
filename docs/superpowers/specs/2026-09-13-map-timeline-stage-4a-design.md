# Phase 4 stage 4a — the timeline and the highlight

Stage 4 as sketched in `2026-09-09-map-and-timeline-design.md` §7 is three features. This spec
covers two of them; **the mobile sheet is stage 4b and has its own spec**, because it changes the
tree shape around the map and deserves its own review cycle against the never-remounted invariant.

Read `§7` of the parent design first. Where this file contradicts it, this file is newer and wins
— §7 was written on 2026-09-09, before stages 2 and 3 measured anything.

## 1. What ships

- The `<ol>` in `app/(public)/trips/[slug]/page.tsx` becomes a real timeline, server-rendered from
  the index that is already fetched there.
- Hovering a timeline row highlights the matching marker and the leg arriving at it; hovering
  either highlights the row. Clicking either navigates to the entry — there is no selected state.
- On an entry route, that entry carries the same highlight with no pointer involved.
- `components/public/**`, `lib/map/**` and `hooks/map/**` join the `test:e2e` gate.

Out of scope, named so they are not smuggled in: the mobile sheet (4b), the all-trips globe
(stage 5), any camera movement, and any change to the index read model.

## 2. Decisions taken, with the reasoning that is not obvious from the code

**Hover highlights, click navigates.** No pinned selection. The context therefore holds no
dismissal state, no Escape handler and no "second click opens" rule, and a timeline row stays what
it already is — a link. Touch devices get no hover affordance in 4a; that is 4b's job, and
pretending otherwise here would build a selection model that 4b then has to unpick.

**The route drives the same highlight.** `source` is `"map" | "timeline" | "route" | null`. The
map has survived trip → entry navigation since stage 2 and said nothing about where the reader
was; this is what makes that persistence legible. It is a read of `useSelectedLayoutSegment()`,
not a new data flow.

**Plain React context, not a store.** The provider is a `"use client"` component in
`app/(public)/trips/[slug]/layout.tsx` wrapping both `<TripMap/>` and `{children}` — they are
siblings, so it is the only place that can hold state for both. A hover re-renders the client
consumers: the timeline rows and a `<div>`. `useSyncExternalStore` with selectors would re-render
only the two rows that changed, and was rejected under CLAUDE.md's second mandatory rule — it
optimises a cost nobody has measured. **It is a contained upgrade if a long trip ever makes hover
feel heavy**: same tree, same context boundary, only the value's shape changes.

**`{children}` does not re-render.** It arrives as RSC output — already-created elements — so the
provider's state changes reach client consumers only. This is the property that makes plain
context affordable here, and it is worth a test rather than a comment.

## 3. The timeline

Server-rendered, in `components/public/trip-timeline/`. Eleven fields are available in
`IndexEntry`; the timeline uses `title`, `occurredAt`, `thumbnail`, `travelModeFrom`,
`precisionMeters` and `slug`.

- **Times render in the entry's own offset**, via `lib/time/offsets.ts`, never shifted into the
  reader's zone. The wall clock is what happened. `occurredAt` is `xsd:dateTime` with a UTC offset
  precisely so this is possible — see `docs/data-model.md` §11.5.
- **Numbering is sanctioned here specifically** by `docs/design-brief.md`: entries within a trip
  are a sequence. Monospace for dates and coordinates is honest use, not decoration.
- **A missing `occurredAt` renders a row without a date, never a placeholder date.** The field is
  optional in the schema and a fabricated one is worse than none.
- The row is a link to `/trips/[slug]/[entry]`, as today. Hover handlers sit on the row, not on
  the link, so keyboard focus and pointer hover share one code path: React's `onFocus`/`onBlur`
  delegate the bubbling `focusin`/`focusout`, not the native non-bubbling `focus`, so the row sees
  focus moving into its own link without the row itself needing `tabIndex`. **Do not "simplify"
  this to a focusable row** — that adds a second tab stop per entry.

**Keyboard reaches everything the pointer does.** Focus on a row raises the same highlight as
hover, through the same context write. This is not an accessibility afterthought bolted on at
review: it is why the handlers are on the row.

## 4. How the map applies a highlight — and why it is two mechanisms, not one

§7 says "the map applies it with `setFeatureState`, so highlighting a leg or a marker never
re-renders one". **That is half-implementable as the code stands, and the half that fails is
silent.** Two measured facts, both from stage 3:

- **A marker is a DOM element, not a GL feature** (`docs/decisions.md` §30). `setFeatureState`
  cannot address it at all. `lib/map/marker-element.ts:13` already sets `el.dataset.slug`, so the
  marker highlight is a class toggle on that element, keyed by slug — the data needed is present.
- **The leg features carry no `id`.** `lib/map/legs.ts:29` builds
  `properties: { mode, fromSlug, toSlug }` and nothing else, and `setFeatureState` needs a feature
  id to key on. The source gains `promoteId: "toSlug"` — each leg is identified by the entry it
  arrives at, which is exactly what a highlight wants.

So: **legs are `setFeatureState`, markers are a class, clusters are neither.** A clustered marker
has no element of its own; above the threshold of 50 the individual markers do not exist, and a
highlight for an entry inside a cluster has nowhere to land. **It renders as nothing, deliberately,
and the timeline row still highlights.** Inventing a cluster-level highlight would mean deciding
what "one of these 50 is active" looks like, which is a design question stage 4a has not asked.

## 5. The e2e gate — §32

`components/public/**`, `lib/map/**` and `hooks/map/**` join the path list in `CLAUDE.md` and
`docs/testing-gates.md`. This closes §28, open since 2026-09-10 and deferred three times.

**It does not close the hazard that motivated it, and §32 must say so.** The worker bug of stage 3
recurs through a `maplibre-gl` version bump renaming the worker's sibling chunk. That touches
`package.json` and `package-lock.json`, **neither of which is on the gate list, and adding the map
paths does not put them there**. Adding the lockfile would close it and make nearly every
dependency bump demand a Pod, a browser and a free port — and `docs/testing-gates.md` already
argues that a gate people stop running is worse than a narrow one. What actually stands between
the repo and a silent repeat is
`app/(public)/maplibre-gl-worker.mjs/route.test.ts`, which parses the served bytes and pins the
single relative import, and which runs in `npm test` rather than behind the gate.

§32 records the widening and that sentence together. A gate whose limits are unwritten is read as
covering more than it does.

## 6. Testing

Per `CLAUDE.md`, the failing test comes first and `test-specialist` writes it.

**Unit, at the fast layer** — the timeline's rendering from a fixture index, including the
no-`occurredAt` row and offset rendering; the context's reducer-free state transitions, including
that a `"map"`-sourced hover does not echo back to the map; `promoteId` present on the legs
source; the marker class toggle keyed by slug.

**The RSC property gets a test, not a comment**: that a context value change does not re-render
the server-rendered `{children}` subtree. It is the assumption the whole approach rests on.

**Browser, and only what no faster test can see.** jsdom has no WebGL, so `setFeatureState`
reaching a real leg is unobservable there — the same bar stages 2 and 3 cleared, and the reason
stage 3 found three defects nothing else could. One case: hover a timeline row, assert the leg's
feature state and the marker's class; navigate to the entry; assert the highlight follows the
route with no pointer.

**The control that must exist**, on the pattern of every stage since 2: a mutation that proves the
browser case can fail. Disable the context write and the case must go red — otherwise it is
asserting the DOM it rendered rather than the behaviour.

## 7. What no check in this repository will see

Written down because stage 3's most useful output was a list like this.

- **A highlight that lands on nothing.** An entry inside a cluster, or a leg whose `promoteId` is
  missing after a refactor: `setFeatureState` on an unknown id is a no-op, with no error. The
  browser case covers the unclustered path only.
- **`size:public` is indifferent to this stage.** The timeline is server-rendered and the context
  is a few hundred bytes; the budget will not move, and a green budget therefore says nothing
  about whether any of this works.
- **Offset rendering is only as right as the fixture.** A timeline that silently renders every
  time in the reader's zone passes any test whose fixture is written in the reader's zone. The
  fixture must carry a non-local offset, and the test must assert the rendered string rather than
  a `Date`.

## 8. Open, and deliberately not decided here

- **4b's sheet may want a selected state after all.** If it does, it is a change to this context's
  shape, not a new one — noted so 4b does not build a parallel mechanism.
- **The stage 3 defect this stage inherits**: marker identity, the cluster threshold and the
  fitted camera are all fixed by whichever trip's data the hooks saw first, never revisited on a
  second trip's data. Unreachable today because no in-app link joins two trips. **Stage 4a does not
  add one either** — the timeline links to entries within a trip — so this stays open and stays
  unreachable. It closes with stage 5's globe, which is the first surface that joins two trips.

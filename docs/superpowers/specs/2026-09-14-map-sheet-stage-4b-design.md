# Phase 4 stage 4b — the mobile sheet and the trip shell

Stage 4 as sketched in `2026-09-09-map-and-timeline-design.md` §7 is three features; 4a shipped
two. This spec covers the third, plus the desktop half of `docs/design-brief.md`'s map layout,
because both are one question: **what shape is the tree around a map that must never remount?**

Read §7 of the parent design and the whole of `2026-09-13-map-timeline-stage-4a-design.md` first.
Where this file contradicts either, this file is newer and wins.

## 1. What ships

- A hand-rolled sheet in `components/public/map-sheet/` with three snap points — peek, half, full
  — over a map that fills the viewport behind it. No `vaul`, no `components/ui`.
- The desktop half of the same layout: a sticky map beside a scrolling entry column, at and above
  `48rem`. **One DOM at every width**; only CSS differs.
- A pinned selection: tapping a marker pins that entry, which is what gives a touch device the
  map → timeline direction that hover gives a mouse. It is a change to `hooks/trip`'s existing
  context, not a second mechanism.
- The three `IndexEntry` fields 4a's spec §3 listed and 4a did not ship: `thumbnail`,
  `travelModeFrom`, `precisionMeters`.
- `docs/decisions.md` **§26**, in its reserved slot, **and the retraction of §11's contrary
  sentence in the same commit**.
- `hooks/trip/**` joins the `test:e2e` gate; Prettier is wired to a script and to the definition
  of done.

Out of scope, named so they are not smuggled in: the all-trips globe (stage 5), any camera
movement on pin, cluster taps, view transitions (phase 7), and any change to the index read model
or to any `dy:` term.

## 2. Two measurements the design rests on

Both were run in headless Chromium at 390×800 against a standalone page before anything was
designed around them, because the failure mode of guessing either is a sheet that looks right and
is unusable. The probe is throwaway; these numbers are the durable part.

**Three snap points work in ONE scroller, and a long timeline still scrolls.** Content order is
spacer-A (`--sheet-half` − `--sheet-peek`), spacer-B (`100dvh` − `--sheet-half`), then the sheet
body at `min-height: 100dvh`, each `scroll-snap-align: start`, the container
`scroll-snap-type: y mandatory`. Rest positions measured at **0 / 240 / 640** px, exactly the
three intended, and a programmatic scroll to an off-snap 120 yanked back to 0. With a body taller
than the viewport the container **rests freely at 900** — past the last snap point — which is
the CSS Scroll Snap large-snap-area rule (a snap area larger than the snapport makes every position
covering the snapport valid). With a body of exactly `100dvh` it clamps at the end instead.

**The strip of map at full costs one property, and makes the third snap soft.** With
`scroll-margin-top` on the sheet body, the third snap position moves up by exactly that much —
measured at scrollTop 576 with the body's top rect at 64px on an 800px viewport, i.e. the intended
8dvh strip. But with a long timeline, 640 and 1000 are *also* valid rest positions, because the
same large-snap-area rule that lets the timeline scroll makes every position covering the snapport
a snap position. **So peek and half are enforced, and full is a floor rather than a detent** — the
handle button and the pin still land on it exactly, a flick past it keeps reading. With a short
timeline the body is not larger than the snapport and full is enforced like the other two.

That result is why there is no nested scroller. The obvious alternative — an outer scroller for
the sheet position and an inner one for the content — needs scroll chaining to feel right on
touch, and gets its own class of bugs. One scroller is simpler and was measured to work.

**`pointer-events` is load-bearing, and the wrong value fails silently.** With the fixed scroller
at `pointer-events: auto`, `document.elementFromPoint` in the map region returns **the scroller**:
every marker is untappable, with nothing thrown and nothing logged. With `pointer-events: none` on
the scroller and `auto` on the sheet body, the same point returns the map, the sheet still returns
the sheet, and a wheel gesture over the sheet still snaps to half. **The map region above the
sheet is map, the sheet is sheet, and there is no third state** — that pair gets its own e2e case
with its own mutation control, because no unit test can see it.

## 3. The tree, and why this shape is the invariant

```
TripHighlightProvider
└── div.trip-shell
    ├── div.trip-map-pane   →  <Suspense><MapForTrip/></Suspense>     ← sibling
    └── MapSheet            →  spacers, handle, body → {children}     ← sibling
```

The map is a **sibling** of the sheet at every width and in every snap state. No snap point, no
breakpoint and no pin has a code path that could unmount it: there is no conditional rendering
anywhere in the shell. This is `CLAUDE.md`'s "one MapLibre instance, mounted once, never
remounted" expressed as a tree shape rather than as a rule someone has to remember.

**There is no JS branch on viewport width.** A `useMediaQuery` that swapped two trees would remount
`{children}` on every rotation and would put the never-remounted invariant one render away from
being violated. The breakpoint lives in a media query, once.

`{children}` is still RSC output handed to a client component, exactly as 4a's provider takes it,
so the sheet's own state changes do not re-render the timeline.

## 4. Where the CSS lives, and why it is not Tailwind classes

One block in `app/globals.css`, with `--sheet-peek` and `--sheet-half` declared beside the other
tokens. Three reasons, in order:

1. The geometry is `calc()` over viewport units. `h-[30vh]` is an arbitrary value, banned outside
   `components/ui/**` and enforced by four ESLint arms.
2. The breakpoint is then spelled **once**, in the media query. Half the layout in `md:` variants
   and half in a stylesheet is two sources that can drift by one edit.
3. The mobile and desktop rules are contradictory per property (`fixed` vs `sticky`, snap vs no
   snap, `pointer-events: none` vs `auto`). Reading them as two adjacent blocks is how a reviewer
   checks them; reading them as interleaved utility strings is not.

Units are `dvh`, not `vh`: a mobile toolbar that collapses changes the viewport, and `vh` would
leave the peek snap point in the wrong place for the rest of the session.

## 5. The snap points

| Point | Sheet shows | Map shows |
|---|---|---|
| peek | the handle and roughly one row | the whole viewport behind it |
| half | half the viewport of timeline | the upper half |
| full | the timeline, top at 8dvh | a strip at the top |

The three values are `--sheet-peek: 20dvh`, `--sheet-half: 50dvh` and an 8dvh strip at full,
which is what §2 measured. They are tokens rather than literals so the two spacers and the body's
`scroll-margin-top` cannot be changed out of step with each other.

**Full leaves a strip of map deliberately.** It keeps the page's subject on screen, and it keeps a
tap target for the background tap that clears a pin — without it, clearing a pin needs a second
affordance invented for one state.

The handle is a real `<button>`, not a decorative bar: it cycles peek → half → full → peek,
which is the whole keyboard and screen-reader story for the sheet. **The drag is native.** The
handle sits inside the scroller, so a touch drag on it is an ordinary scroll and the CSS snapping
does the rest; the parent design's "pointer handlers" sentence anticipated hand-written drag maths that the
measurement in §2 makes unnecessary. Writing it anyway would be cleverness beating simplicity.

At and above `48rem` the spacers and the handle are `display: none` and the sheet is a static
column. Nothing is unmounted; the same nodes are in the same order.

## 6. The pin

`useHighlightState` gains `pinned` beside `pointer`:

```
activeSlug = pointer ?? pinned ?? route
source     = "map" | "timeline" | "pin" | "route" | null
```

Hover still outranks a pin while it lasts, so the desktop behaviour of 4a is unchanged. A route
change clears **both**, in the same render-phase adjustment that already clears the pointer — an
effect would be too late for a removed element, which is the trap `hooks/trip/notes.md` records.

- Marker `click` → `pin(slug)`. `useMapMarkers` already holds its handlers in a ref so a caller's
  inline arrow cannot re-run the reconcile effect; the new handler joins that ref.
- A click on the map background → `unpin()`. Markers are DOM overlays, so a tap on a marker never
  reaches the canvas and the two handlers cannot both fire.
- Cluster taps do nothing, as today. A pin on an entry inside a cluster lands on nothing visible,
  which is the same deliberate hole 4a recorded for the highlight.

**On a pin the sheet opens to `max(halfOffset, rowTop − handleHeight)`.** The offsets are **read
from the DOM** — `spacerB.offsetTop` and `body.offsetTop` — never recomputed from `vh` in JS, so
the stylesheet stays the single source and no drift check is needed. The arithmetic is a pure
function in `components/public/map-sheet/snap.ts` with its own unit test; the component measures
and calls it. `behavior: "smooth"` only when `prefers-reduced-motion: reduce` does not match.

**One exception to "only a pin moves the sheet": the position it starts in.** A fresh load
straight onto an entry route — the shared-link path — opens the sheet at full, or the prose sits
below the fold on arrival. That runs once, on mount, without animation; every later route
change leaves the sheet exactly where the reader put it, because the component stays mounted and
the scroller keeps its position across navigation.

With one scroller, revealing a row far down the list necessarily raises the sheet past half. That
is accepted and is the honest consequence of §2's choice: tapping a marker opens the sheet to the
entry it names.

## 7. The three fields

All three are already on `IndexEntry` and all three render **in `TripTimeline`, on the server** —
the row stays a thin client component taking children, which is what took 4.2 kB out of the trip
page's chunk in 4a. No new client bytes for any of them.

- `thumbnail` — a plain `<img>` at marker size over a `bg-surface` skeleton, `loading="lazy"`,
  explicit dimensions. Decision 29 stands: no `dy:blurDataUrl`, the skeleton is the placeholder.
  `next/image` is not introduced for a 40px square on a page that ships no other image component.
- `precisionMeters` — `precisionLabel` from `lib/place/precision.ts`, already public-path-safe.
- `travelModeFrom` — a monospace chip carrying the mode, sanctioned by the brief's category-chip
  reference. The marker's circle-vs-square already says fuzzed-vs-exact; the row says it in words.

## 8. §26, and the retraction that has to travel with it

§26 is **reserved** by §25 for this stage and the file currently jumps 25 → 27. It records: the
public sheet is hand-rolled, `vaul` stays studio-only and stays in `BANNED_DEPS`, and the trip
shell is one responsive tree whose map is a sibling of the sheet.

**In the same commit, decision 11 loses this sentence**: "Its Drawer wraps Vaul and provides the
snap-point sheet the mobile map layout needs." §11 also says none of shadcn may reach public
reading pages, so it contradicts itself today. Landing §26 beside an unamended §11 would leave two
decisions disagreeing, which is worse than the state before either. `TODO.md`'s phase 0.5 line
echoes the same clause and is corrected with it.

## 9. Prettier, wired to production code only

Measured on 2026-09-14, in this order, because the first number would have produced a broken
branch:

- `prettier --check "**/*.{ts,tsx}"` fails **100 files / 3,325 changed lines**.
- **That reformat cannot be run.** `check:structure` reports `test/guardrails.test.ts` at **999
  code lines against a 1000-line HARD bound**, and Prettier adds **257** to it. Four more test
  files sit between 869 and 967. A whole-repo `--write` would fail `npm run lint` on a bound that
  has nothing to do with formatting, and the fix would be splitting four test files — not the job
  of this stage.
- Scoped to production code — `{app,components,hooks,lib,scripts}/**/*.{ts,tsx}` with
  `components/ui/` and `**/*.test.*` in `.prettierignore` — it is **46 files, ~600 lines**, and
  nothing near a bound.

So the scope is production code, and the two exclusions are principled rather than convenient:
`components/ui/**` is vendored shadcn source, already exempt from the arbitrary-value rule, and
reformatting it would noise up every future upstream diff; test files are where the bound problem
is and where hand-aligned tables do the most work. Markdown and CSS are out of the glob entirely —
`app/globals.css`'s token table is aligned by hand and Prettier moves it.

`lib/time/offsets.ts`'s offset table gets `// prettier-ignore`: 6 hand-aligned lines become 40
without it, and those 40 lines then count against the file's own bounds.

**Order matters. The reformat is its own commit, first**, before any 4b code, so that the feature
diff is reviewable. Then `format` and `format:check` join `package.json`, the `CLAUDE.md` command
list (which `check:commands` verifies in both directions) and the definition of done.

**The definition-of-done list gains a tenth unconditional command, which makes `test:e2e` the
eleventh one.** The sentence in `CLAUDE.md` that reads "A tenth command, path-scoped" must be
renumbered in the same edit, or the file contradicts its own list.

**What this does not do**: it does not format the tests, so a long line in a test file is still
caught by hand or not at all. Recorded rather than papered over.

## 10. The gate

`hooks/trip/**` is in the ESLint belt but is **missing from the path-scoped `test:e2e` list** —
4a created the directory and added it to one of the two places a new hooks area must be added.
`CLAUDE.md`'s own code-structure section names that failure mode; this closes it. The run fires
for 4b anyway through `components/public/**`, which is precisely why it would otherwise stay
invisible until a diff touched `hooks/trip` alone.

## 11. Testing

Every test failing first, per `CLAUDE.md`, and every browser case with its own mutation control —
stage 4a's seven could-not-fail checks were all found that way, not by reading.

**Unit (vitest).**

- `snap.ts`: the target arithmetic, including the clamp at half and a row already visible.
- `useHighlightState`: pin precedence under hover, pin surviving a hover that ends, and a route
  change clearing both. The existing pointer cases must keep passing unchanged.
- `useMapMarkers`: a marker click calls the select handler with its slug; an inline arrow handler
  does not rebuild markers.
- `TripTimeline`: the three new fields render, from a fixture that carries all of them and one
  that carries none of them.
- `MapSheet`: renders `{children}`; a pin scrolls the scroller; `prefers-reduced-motion` changes
  the behaviour argument, asserted on the call rather than on a class name.

**Browser (playwright), at 390×800 unless stated.**

1. The three snap points are reachable and rest where §2 measured, **and the canvas node is the
   identical element at all three** — `===` on a handle captured at peek, not a count of canvases.
   Peek and half are asserted as scrollTop; **full is asserted as the sheet body's top rect**,
   because §2 measured it to be a floor rather than a detent once the timeline is long.
2. A marker in the map region is tappable through the sheet's spacer, and tapping it pins: the row
   gets `data-active` and the sheet opens. Control: set the scroller to `pointer-events: auto` and
   this must fail.
3. A tap on the map background clears the pin.
4. At 1280×800 the sheet is a static column, the map pane is sticky, and the canvas is again the
   same node after a scroll.

**What is asserted about the map is the canvas, never the container** — a mounted map is not a map
that drew anything, and stage 3 paid for learning that.

## 12. What no check in this repository will see

- **iOS Safari.** Playwright here is Chromium. `dvh`, `overscroll-behavior` and snap behaviour
  under a collapsing toolbar are the three most likely places for this design to be wrong, and
  nothing in CI will say so. Recorded, not closed — the same shape as §31's Netlify caveat.
- **A pin that lands on nothing**, when the entry is inside a cluster. Silent by construction.
- **`size:public` is nearly indifferent**, as it was in 4a: the sheet is the only new client code
  and the three fields are server-rendered. The budget stands at 181.3 kB of 190, and a green
  budget says nothing about whether any of this works. If the sheet costs more than ~2 kB gzip,
  something is in the wrong file.
- **A sheet that never scrolls because the content is short.** With fewer entries than a viewport
  the body is exactly `100dvh` and full is the last reachable position — correct, and identical on
  screen to a sheet whose scrolling is broken.

## 13. Open, and deliberately not decided here

- **The stage-3 defect still does not close.** Marker identity, the cluster threshold and the
  fitted camera remain fixed by whichever trip's data the hooks saw first. 4b adds no link that
  joins two trips; stage 5's globe is where it closes, and it inherits the measurement.
- **No `onLeave` fires when a hovered marker is removed.** Unreachable below the 50-entry cluster
  threshold, unchanged by this stage, still recorded in `TODO.md`.
- **A future site header** would conflict with a shell that owns the viewport on mobile. There is
  no header today; phase 7 inherits the question.

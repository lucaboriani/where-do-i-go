# Phase 4 — the map and the timeline

Design agreed 2026-09-09, against `main` at `4110644`. Six stages, specified in full for stages
0–3 and to the level of their interfaces for stages 4–5, which depend on primitives stage 3
establishes.

This document is a design, not a plan. It says what is being built and why each choice is the one
it is. The implementation plan is written separately, one per stage.

Everything below labelled **measured** was run in the checkout on 2026-09-09 and its output read.
Everything labelled **to measure** is a question the implementing stage must answer by running
something, not by reasoning — the distinction is the point of the labels.

**Section numbers are not stage numbers.** The stages, one commit and one plan each:

| Stage | What lands | Sections |
|---|---|---|
| 0 | Module moves out of `lib/studio`, the fence line, `react-map-gl` dropped | §2, §3 |
| 1 | The basemap style, and `MAP_STYLE_URL`'s new meaning | §4 |
| 2 | One instance: lazy-mount, never remount, attribution, the bundle controls | §5 |
| 3 | Photo markers, clustering, the route | §6 |
| 4 | Timeline, bidirectional highlight, the mobile sheet | §7 |
| 5 | The all-trips globe | §8 |

Stages 0–3 are specified in full. Stages 4 and 5 are specified to the level of their interfaces,
because both build on primitives stage 3 establishes and their plans are written when it lands —
the same split the media-pipeline spec used.

## 0. What already exists, so it is not rebuilt

- **`maplibre-gl@6.6.0` is a dependency**, pinned in phase 0.5. So is `react-map-gl@8.1.2`, which
  nothing imports; stage 0 removes it for the reasons in §3.
- **The brief's map tokens are already in `app/globals.css`** — `--color-map-land`,
  `--color-map-water`, `--color-map-label`, in the `@theme` block. §4 says what that means for a
  style module that cannot read them.
- **`scripts/check-public-bundle.ts` already lists `maplibre-gl` in `BANNED_DEPS`**, with markers
  `MapLibre` and `maplibregl`, and its comment already states the intended answer: *"Lazy means it
  must not be in a public page's initial chunks at all."* §1 confirms that comment is correct.
- **`.env.example` already documents `MAP_STYLE_URL`**, with OpenFreeMap named as the default
  because it needs no key. `lib/config.ts` does **not** read it. §4 changes both.
- **`lib/studio/time/offsets.ts` and `lib/studio/place/place.ts` exist**, extracted from
  `EntryEditor` during the code-structure refactor with docblocks that say phase 4's timeline
  wants them. §2 makes them reachable, which they currently are not.
- **`IndexEntry` carries almost everything the map needs** — `lat`, `long`, `precisionMeters`,
  `thumbnail`, `travelModeFrom`, `sortOrder`, `title`, `slug` — and `TripIndex` carries `bbox`
  and `center`. One fetch, which is §7.4's stated purpose. **No data-model change is made by any
  of the six stages.** The one thing it does not carry is a blur placeholder, and §6 says what
  that costs and why closing it is the owner's call rather than stage 3's.
- **`app/(public)/trips/[slug]/page.tsx` renders a plain `<ol>` of entry links.** That list is
  what becomes the timeline; the page's `Suspense` shape and its four not-found guards stay as
  they are.

## 1. The bundle question, resolved by measurement

`CLAUDE.md` calls `size:public` "the real enforcement", and phase 4's deliverable is a map on
public pages while `maplibre-gl` is a banned public dependency measured at 252.8 kB gzip against
13.6 kB of headroom. That reads like a contradiction requiring either the ban or the budget to
move. It requires neither.

**How the check actually decides what to look at.** `publicPages()` walks `.next/server/app` for
`*.html` and computes each route path relative to it, so route groups are already stripped and
where a component lives in the source tree is irrelevant. `measurePages()` then extracts only
`src=`/`href=` references to `/_next/static/**.js` **from the prerendered HTML**, and
`findStudioDeps()` scans only the chunks those references resolve to.

**Measured, on the build already in the tree.** `app/(studio)/studio/page.tsx` →
`studio-client.tsx` → `dynamic(() => import("@/components/studio/studio-shell"), { ssr: false })`,
and `studio-shell` statically imports Radix, sonner and cmdk through the entry editor. `studio.html`
names eight chunks. **None of the eight contains `--radix-`, `data-radix-`, `data-sonner-`,
`cmdk-item`, `SolidDataset`, `handleIncomingRedirect` or `ExifReader`.** A chunk reached only by a
dynamic import is therefore neither weighed nor scanned.

So lazy-mounting is the intended answer and the mechanism works. Two consequences follow, and the
second is the one that matters.

**The eslint fence gains an entry, which is a tightening — and the shape of it matters.**
`eslint.config.mjs`'s public block does not name `maplibre-gl` today, so lint permits the static
import the bundle check would refuse. The obvious spelling, a `patterns` group of
`["maplibre-gl", "maplibre-gl/**"]`, **also refuses `maplibre-gl/dist/maplibre-gl.css`** — the
stylesheet that positions the canvas and renders the attribution control this project may never
remove — and a `!`-negated pattern does not rescue it, because gitignore semantics refuse to
re-include under an excluded parent. So the fence is an exact-specifier `paths` entry plus a
`patterns` group closing the deep-JS hole. Eight import shapes, all measured against the real
config on real files:

| Shape | Verdict |
|---|---|
| `import maplibregl from "maplibre-gl"` | refused |
| `import { Marker } from "maplibre-gl"` | refused |
| `import type { Map } from "maplibre-gl"` | refused |
| `import mod from "maplibre-gl/dist/maplibre-gl.mjs"` | refused |
| `import "maplibre-gl/dist/maplibre-gl.css"` | allowed |
| `await import("maplibre-gl")` | allowed |
| `import("maplibre-gl").Map`, as a type | allowed |
| `import type … from "@maplibre/maplibre-gl-style-spec"` | allowed |

Types therefore come through the inline `import("maplibre-gl").X` form rather than `import type`,
which is the honest spelling: the module genuinely is only available dynamically. The base rule
has no `allowTypeImports`, and reaching for `@typescript-eslint/no-restricted-imports` to permit
a spelling that can simply be avoided would put two rules on the same job.

**The moves in §2 open a gap worth a belt.** After them, `lib/time/**` and `lib/place/**` are
publicly reachable and fenced by nothing, so a future edit importing `@/lib/studio/session` there
would drag the auth library into a public route indirectly — the shape the `lib/studio` fence
exists to stop, one level down. `lib/pod/read.ts` has had this property all along and
`size:public`'s marker scan is the backstop. Stage 0 adds the cheap belt: a block over
`lib/time/**`, `lib/place/**` and `lib/pod/read.ts` restricting `@inrupt/*` and `**/lib/studio/**`.

**`size:public` goes quiet on the map, and that is the half-check this repository keeps hitting.**
With the library lazy, the check passes identically whether the map is correct or entirely absent —
`maplibre-gl` will report `absent` in the composition ledger forever, and that line will mean
nothing. Stage 2 therefore adds two assertions, in opposite directions:

- **Positive control.** The real build must emit a chunk containing MapLibre that **no** public
  page's HTML references. This is what distinguishes "lazy and correct" from "no map".
- **Negative control.** A static import of `maplibre-gl` from a public path must be refused by
  lint, and a synthesised public chunk containing `maplibregl` must be caught by
  `findStudioDeps`. The second half already follows from `BANNED_DEPS`; the first is new.

Neither the ban nor the budget changes, so no `CLAUDE.md` "Ask before doing" item is triggered
by any of this.

## 2. Stage 0 — three prerequisites, before any map code

**`lib/studio/**` is fenced from public routes, so the two modules extracted for this phase are
unreachable from it.** `eslint.config.mjs` restricts the group `["**/lib/studio",
"**/lib/studio/**"]` on `app/(public)/**` and `components/public/**`, with the reason that
`lib/studio` wraps the auth library. Neither `time/offsets.ts` nor `place/place.ts` imports
anything auth-shaped — `offsets.ts` imports nothing at all and `place.ts` imports one type from
`lib/pod/schema` — so the fence is right about the directory and wrong about these two files. They
move rather than earn a carve-out; a carve-out would make the fence a list of exceptions, which is
how the ACL primitive list nearly failed.

- **`lib/studio/time/` → `lib/time/`, wholesale.** All of it is pure arithmetic over strings. Its
  `notes.md` and `offsets.test.ts` move with it. `nowWithOffset` and `wallClockNow` are write-side
  only and move anyway: splitting a nine-function arithmetic module to keep two functions on the
  other side of a fence costs more than it protects.
- **`lib/studio/place/place.ts` splits.** `precisionLabel` moves to a new `lib/place/precision.ts`.
  Only that one function: the coordinate-decimal count §6 needs lands in the same module in stage
  3, where it has a consumer. `placeFor`, `placeTextOf`, `gridOf` and
  `PRECISION_GRIDS` stay in `lib/studio/place/`, following the precedent `eslint.config.mjs`
  already sets for `entry-model.ts`: a write-shaped module stays fenced even when it is pure,
  because nothing public has any business assembling a `Place`.
- **`react-map-gl` leaves `package.json`**, for the reasons in §3.

The import updates in `EntryEditor`'s field groups and hooks are mechanical, and `check:structure`
carries the test-file list that must be kept in step.

## 3. Stage 0 — raw MapLibre, not react-map-gl

Two of phase 4's invariants push against the declarative wrapper at exactly the points where the
project has written rules.

**`setProjection` only inside the `style.load` handler.** react-map-gl applies a `projection` prop
on its own schedule, so satisfying the invariant means reaching through `mapRef.getMap()` inside
`onStyleData` and leaving the prop unused. The globe deliverable becomes imperative either way,
and the wrapper's value was that it would not be.

**One instance, mounted once.** The wrapper keeps its instance as long as its element is mounted,
which a layout provides — but having both a declarative and an imperative route to the same map is
how a one-instance rule rots. There is one way to touch the map.

**What is given up is real**, and §6's clustering needs `querySourceFeatures` on `moveend` and
`sourcedata` regardless, so the imperative reconcile loop exists either way and the wrapper would
have sat beside it rather than replaced it.

Everything interesting is pure and lives in `lib/map/`, testable with no browser and no library:
the style, the two GeoJSON builders, the leg derivation, the dash expression, the cluster threshold
and the fit-to-bounds arithmetic. The React surface is one hook that creates and destroys.

Recorded as `docs/decisions.md` §25, and phase 0.5's `react-map-gl` pin is annotated rather than
deleted — the historical record of what was installed stays, as it does for `size-limit`.

## 4. Stage 1 — the basemap style

`docs/design-brief.md` calls the dark desaturated basemap "the single highest-leverage visual
decision in the project" and says it lives in the style JSON, not the stylesheet. So the style is
authored in-repo rather than fetched and recoloured.

**Source, measured live.** OpenFreeMap's TileJSON at `https://tiles.openfreemap.org/planet`
serves the OpenMapTiles schema; glyphs at `https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`;
and the only fontstack their own dark style uses is `Noto Sans Regular`, so that is the only one
this style may name.

**Their dark style's forty-seven layers are the reference, and it is subtracted from rather than
copied.** No buildings, no aeroways, no oneway arrows, no road labels, no railway dashlines, no
water labels. A deliberately spare basemap serves a photograph-first page better than a complete
cartographic one, and it is less code — the brief's "let one element be the memorable thing and
keep everything around it quiet", applied to the map itself.

What stays, enumerated rather than counted, because a count in this repository goes stale the
first time the list moves and was never the point:

```
background            landuse_park          boundary_country      place_city
water                 highway_minor         boundary_state        place_town
waterway              highway_major         place_country         place_village
landcover_wood        highway_motorway      place_state
landcover_glacier     railway
```

**The palette is the brief's map tokens and nothing else.** Roads and boundaries are achromatic
greys stepped off `map-land` — the brief's requirement, because any saturated hue in the basemap
competes with the route.

**The palette is restated as hex in `lib/map/tokens.ts`, and that duplicates `app/globals.css`.**
Two measured reasons, not one: a MapLibre paint property cannot read a CSS custom property, **and
MapLibre cannot parse `oklch()`** — `Color.parse` returns `undefined` and `validateStyleMin`
answers `color expected`, so an `oklch()` colour is a layer that silently does not draw. The
stylesheet is written entirely in `oklch()`.

Six tokens, not three: `--color-map-land`, `--color-map-water`, `--color-map-label`, plus the
accent trio, which stage 3's route and markers need in the same form. This is the shape
`lib/pod/schema.ts` already has with `BLUR_BUDGET_BYTES` — and it gets more than a keep-in-step
comment. `app/globals.css` already records the hex beside eight of its eleven `@theme` colours in
a trailing comment; stage 1 extends that to the three basemap lines, and a test parses those
comments and asserts `lib/map/tokens.ts` agrees. It catches the copy drifting, which is the real
risk. It does **not** catch a hex comment wrong for its own `oklch()` value — that is colour maths
with a tolerance to argue about, and `docs/design-brief.md` settled all eleven pairs in-gamut
upstream.

**`@maplibre/maplibre-gl-style-spec` gets declared.** It holds `StyleSpecification`,
`LayerSpecification` and `validateStyleMin`, and **`maplibre-gl` re-exports none of them** —
verified against its `export { … }` list. It is only in the tree today as a transitive dependency,
which works under npm's flat `node_modules` and breaks under pnpm, and `docs/decisions.md` §21
leaves the package manager to the checkout. A devDependency: the style module uses it through
`import type` and the validator runs only in tests, so nothing ships.

**`MAP_STYLE_URL` becomes a wholesale override rather than the default.** Set ⇒ MapLibre loads that
URL verbatim and the in-repo style is not used. Unset ⇒ the in-repo style. This keeps decision 7's
escape hatch — "the style URL is an env var so any deployer can point at a paid provider" — while
making the project's own cartography what a default deployment actually shows.

`.env.example` currently **sets** `MAP_STYLE_URL=https://tiles.openfreemap.org/styles/dark`, so
anyone who has already copied it to `.env.local` would get OpenFreeMap's palette instead of this
one and would have no way to tell that was not the design. That line becomes commented out, with
the two meanings written next to it.

`lib/config.ts` gains one optional getter. The value reaches the browser as a prop from the server
layout, exactly as `ownerWebId` and `siteUrl` reach the studio shell — no `NEXT_PUBLIC_` variable,
because `lib/config.ts` throws in the browser by design.

**Its test validates against the real spec.** `@maplibre/maplibre-gl-style-spec` is already a
transitive dependency and exports `validateStyleMin`. A style test that asserts against its own
object literal verifies nothing; this one asserts the spec accepts the output, and that every
`text-font` in it is a fontstack OpenFreeMap serves.

## 5. Stage 2 — one instance, lazy, never remounted

Three files, mirroring the shape the studio already proved:

```
app/(public)/trips/[slug]/layout.tsx           server: reads the index, renders shell + map + children
components/public/trip-map/trip-map.tsx        "use client": container, IntersectionObserver
components/public/trip-map/index.ts            the one-line barrel the layout rule requires
components/public/trip-map/notes.md            the reasoning behind the anchors below
components/public/trip-map/hooks/use-map-instance.ts   the dynamic import, create, destroy
```

The barrel and the `notes.md` are not optional: `componentFoldersAreOwn()` in
`scripts/check-structure.ts` fails a `.tsx` with no `index.ts` beside it, and every `./notes.md#`
pointer the component carries must resolve. `maplibre-gl/dist/maplibre-gl.css` is imported here,
in `trip-map.tsx` rather than inside the lazy chunk, so the map's chrome is styled before the
instance arrives. It costs nothing against the budget — `measurePages` matches only `.js`
references — and §1's fence permits that one subpath deliberately.

**The layout is the mechanism for "never remounted".** The bundled Next 16 docs state that on
navigation layouts preserve state, remain interactive and do not rerender
(`node_modules/next/dist/docs/01-app/01-getting-started/03-layouts-and-pages.md`). Trip → entry →
entry therefore keeps one instance, which is the case the invariant exists for: the timeline
navigates to entry routes and the map must survive it.

**To measure:** whether changing `[slug]` — trip A to trip B — remounts the layout, since the
param belongs to the layout's own segment. Either answer is acceptable, because a different trip is
a different map, but the answer goes in `notes.md` rather than being assumed in either direction.

**`await import("maplibre-gl")` inside the observer callback, not `next/dynamic`.** §1 measured
that a `ssr: false` chunk is invisible to the bundle check; a bare dynamic import has the same
property with less machinery, and `studio-client.tsx` already uses exactly this shape for the auth
library with a docblock explaining that it must stay inside the effect or Next prerenders it into
the eager chunk. The same reasoning applies here and for the same reason.

**`setProjection` has one call site**, inside the `style.load` handler, asserted by a test that
fails if it is reached from anywhere else. **The attribution control is added unconditionally**
and no code path removes it.

The map container is server-rendered with the index's `bbox` already known, so the page reserves
the map's space before any JavaScript runs and nothing shifts when the instance arrives. `bbox`
is on the index precisely so that this is possible (§7.4).

The two bundle controls from §1 land here, and so does the one Playwright spec: jsdom has no
WebGL, so "the canvas appears after scrolling, the OSM attribution is present, and MapLibre is
requested only after the scroll" cannot be tested anywhere faster. `CLAUDE.md`'s testing section
requires that bar to be cleared by measurement rather than asserted, and this clears it the same
way the media pipeline's uploaded bytes did.

**`components/public/**` and `lib/map/**` join the e2e gate globs** in `CLAUDE.md` and
`docs/testing-gates.md`. That edits the project's own rules rather than its code, so it wants the
owner's sign-off in the stage rather than arriving inside a commit.

## 6. Stage 3 — markers, clustering, route

One `IndexEntry[]` feeds all of it. Pure builders in `lib/map/`:

| Module | Exports |
|---|---|
| `points.ts` | `IndexEntry[]` → `FeatureCollection<Point>`; props `slug`, `title`, `thumbnail`, `precisionMeters`, `sortOrder` |
| `legs.ts` | `IndexEntry[]` → `FeatureCollection<LineString>`; props `mode`, `fromSlug`, `toSlug` |
| `dashes.ts` | the `["match", ["get","mode"], …]` dash expression, per `TravelMode` |
| `view.ts` | fit-to-bounds options from `bbox`, the cluster threshold, the projection choice |

**Clustering splits the rendering by what each engine is good at.** One GeoJSON source with
`cluster: entries.length > 50`. Two GL layers render **clusters only** (`filter: ["has","point_count"]`)
as `accent-deep` circles carrying their count. **Leaves are HTML markers**, reconciled from
`querySourceFeatures` on `moveend` and `sourcedata`. Below the threshold `cluster` is false, every
feature is a leaf, and the cluster layers never fire.

Two reasons the thumbnails are HTML and not a symbol layer: a thumbnail is a Pod URL and
`map.addImage` needs a CORS-loaded bitmap where an `<img>` needs nothing; and
`dy:precisionMeters` → pin versus soft circle is a CSS distinction, which is what the brief asks
for when it says the typography should tell the truth about the data. `lib/place/precision.ts`
owns the coordinate-decimal count for the same reason.

**There is no blur placeholder on a marker, and that is a gap rather than a solved problem.** An
earlier draft of this section claimed `dy:blurDataUrl` "rides in the index"; it does not.
`IndexEntry` carries eleven fields and no blur, `lib/pod/index-model.ts` serialises none, and the
normative §7.4 fixture lists none — the term lives on `Photo`, i.e. on the entry resource.
Stage 3 therefore ships markers with no placeholder. **Adding `dy:blurDataUrl` to the index is a
change to the normative read model and must be put to the owner before stage 3 starts**, not
decided by whoever hits the gap: nothing mechanical would stop it, since `check:vocab` passes (the
term is already in `lib/vocab.ts`), `validate:fixtures` passes (it is an `xsd:string`), and
`size:public` is indifferent. §7.4's own rule is "keep it strictly to what those views need", and
the alternative — fetching each entry for its blur — destroys the one-fetch purpose the index
exists for.

**The route is two layers over one source.** Legs are consecutive index entries ordered by
`sortOrder` then `occurredAt`; each leg takes its mode from its **destination** entry, because
`dy:travelModeFrom` is defined as the leg arriving at that entry. Entries with no coordinate drop
out of both the points and the legs.

The casing is a solid `accent-deep` line at width + 3.5 — 1.75 px on each side, inside the brief's
1.5–2 px requirement, without which the route breaks up wherever it crosses a label or a
coastline. It is deliberately **not** dashed: the casing reads as the continuous path and the
dashed `accent` line on top reads as the mode. Dashing both would only produce a thicker dash.

**Measured, and it removes the obvious complication:** `line-dasharray` in MapLibre 6 is
`cross-faded-data-driven` with `parameters: ["zoom","feature"]`, so per-leg dashes are one `match`
expression on one layer. Mapbox GL JS makes it constant-only, which is what most training data
reflects and what would have produced eight filtered layers. Read out of
`@maplibre/maplibre-gl-style-spec`'s `latest.json`, not remembered.

Two constraints come with it, from the same reference and easy to trip over: **each `match` arm
must be `["literal", [a, b]]`**, because that is the only way to write an array value in an
expression, and a zoom-dependent dash expression **is evaluated only at integer zoom levels**. The
per-mode dash is feature-driven rather than zoom-driven, so the second does not bite here — but a
later attempt to taper dashes with zoom would find it does.

`dy:track` — the GeoJSON or GPX file a trip may point at — is out of scope. The route drawn here is
derived from the index, which is what the deliverable asks for.

## 7. Stage 4 — the timeline, the highlight, the sheet

The timeline is a public-path feature, server-rendered from the same index, replacing the `<ol>` in
`page.tsx`. `docs/design-brief.md` sanctions numbering here specifically — entries within a trip
are a sequence, and monospace for dates and coordinates is honest use. Times render in the entry's
own local offset via `lib/time/offsets.ts`, never shifted into the reader's zone: the wall clock is
what happened.

**Bidirectional highlighting is a client context in the layout**, wrapping both the map island and
`{children}` — they are siblings, so this is the only place that can hold state for both. It holds
`{ activeSlug, source }`, `source` being `"map" | "timeline" | null` so a hover can be answered
without echoing back. The map applies it with `setFeatureState`, so highlighting a leg or a marker
never re-renders one.

**The sheet is hand-rolled**, in `components/public/map-sheet/`, with three snap points. `vaul`
stays studio-only — but **§26 has to retract a sentence rather than merely cite agreement**, and
the earlier draft of this paragraph got that wrong. The eslint public group and `BANNED_DEPS` do
fence `vaul`, and `docs/decisions.md` §11 does say "None of it may reach public reading pages" —
yet the same decision also says its Drawer "provides the snap-point sheet the mobile map layout
needs". §11 is internally inconsistent, and `TODO.md`'s phase 0.5 line is echoing it rather than
being the sole odd one out. So §26 must quote and withdraw that clause of §11 explicitly;
landing §26 beside an unamended §11 leaves two decisions contradicting each other. Carving `vaul` out would open the exact hole the composition scan
exists to close, on a library last published in 2024-12 whose snap-point API `TODO.md` already
flags as unverified. Recorded as `docs/decisions.md` §26.

CSS scroll-snap with pointer handlers, `prefers-reduced-motion` respected per the brief. **The map
is a sibling of the sheet and never a child**, so no snap point has a code path that unmounts it —
which is the invariant restated as a tree shape rather than as a rule someone has to remember.

## 8. Stage 5 — the all-trips globe

`/` gets the second surface: one index fetch per published trip, all behind `use cache`, one
marker at each trip's `center`, and the trip's `bbox` for the fly-to on click.

**Measured:** `setProjection({ type: "globe" })` is a shorthand that MapLibre 6 expands to
`["interpolate", ["linear"], ["zoom"], 11, "vertical-perspective", 12, "mercator"]` — globe below
z11, flat above z12. `"vertical-perspective"` is the always-globe value. Read out of the shipped
`maplibre-gl.mjs`. `"globe"` is the right choice for an overview map, because it flattens on the
way in rather than fighting the reader.

The call is inside the `style.load` handler, the same single call site as stage 2.

## 9. Testing

- **`lib/map/**`, `lib/time/**`, `lib/place/**` by vitest**, directly. This is where the coverage
  actually is: the style, both GeoJSON builders, the leg ordering and mode attribution, the dash
  expression, the cluster threshold, the fit arithmetic, the precision formatting.
- **Components in jsdom against a faked `maplibre-gl`** recording `addSource`, `addLayer`, `on`
  and `setProjection`. Asserted: one instance across re-renders, no instance before intersection,
  `setProjection` reached only from `style.load`, and the attribution control present.
- **Guardrails.** `test/guardrails.test.ts` gains the `maplibre-gl` case in both directions —
  static import rejected, dynamic import allowed — since a fence that also refused the dynamic
  import would ban the map outright.
- **The bundle controls from §1**, in `test/public-bundle.test.ts`.
- **The token-drift check from §4**, asserting `app/globals.css` and `lib/map/tokens.ts` agree on
  all six map-relevant colours, and that none of them is spelled `oklch()`.
- **One Playwright spec**, justified in §5.

Every test is written failing first and shown failing, per `CLAUDE.md`. The two failure modes that
section names are both live here: a lazy chunk makes "green but verified nothing" the default
outcome, which §1's positive control exists to prevent, and a map that mounts is not a map that
drew anything, which is why the e2e asserts the canvas rather than the container.

## 10. Three decisions.md entries

- **§25** — raw MapLibre, not react-map-gl. §3. Lands in stage 0.
- **§26** — the public sheet is hand-rolled; `vaul` stays studio-only, and §11's contrary sentence
  is withdrawn. §7. Lands in stage 4, so **§25 reserves the number in writing** — otherwise §27
  arrives first and the next doc-writing agent appends 28 or slots 26 in out of order.
- **§27** — the basemap style is authored in-repo; `MAP_STYLE_URL` is a wholesale override. §4.
  Lands in stage 1.

## 11. Out of scope, and stated so it is not re-decided

- **The `dy:` namespace blocker stands.** Phase 4 reads and never writes, so nothing here
  approaches a live Pod. No `dy:` predicate or class is added, changed or renamed, and no
  container layout changes — none of `CLAUDE.md`'s "Ask before doing" items is triggered.
- **`dy:track`** — §6.
- **`OFFSET_SHAPE`'s unpinned width** and **the "exact" precision option**. Reading
  `precisionMeters` to choose a marker shape and a decimal count needs no §9 decision; writing a
  zero-precision coordinate does, and phase 4 writes nothing.
- **The fifteen phase-3 follow-ups**, and `rebuildIndex`'s missing ACL verification.
- **Typefaces and the rest of look-and-feel**, which are phase 7. Stage 1's style is cartography,
  not typography; it names `Noto Sans Regular` because that is what the tile server serves glyphs
  for, and that choice is independent of the site's two families.
- **OG images** — phase 5, and decision 8 already says they project coordinates directly rather
  than rendering MapLibre server-side.

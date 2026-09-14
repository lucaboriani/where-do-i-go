# Phase 4 stage 5 — the all-trips globe: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/` from a list of trip slugs into a globe with one marker per published trip, in the
same responsive shell the trip page got in stage 4b, with a click flying the camera to that trip's
bounds and highlighting its row.

**Architecture:** The page — not a layout, because `/` has no child routes — renders
`TripHighlightProvider` around a shell holding two siblings: the map pane and `<MapSheet>` wrapping
the trip list. Trip markers are a GeoJSON circle layer with `promoteId: "slug"` and
`setFeatureState`, not the DOM markers entry pins use. One new hook, `hooks/map/use-map-trips.ts`,
owns the source, the layer, the hover and the camera; one new pure module, `lib/map/trips.ts`, owns
the arithmetic.

**Tech Stack:** Next 16.3.4 App Router, React 19.2.8, Tailwind v4.3.3, MapLibre GL 6.6.0, Vitest,
Playwright, Community Solid Server 7.2.0.

**Spec:** `docs/superpowers/specs/2026-09-14-diary-globe-stage-5-design.md` (commits `27e6d35`,
`740776e`). Read it first — this plan argues from it and does not repeat its reasoning. §9 is the
one to read closely: the stage-3 defect closes by argument here, and **no fix for it ships**.

## Global Constraints

- **Node 22.** `nvm use`, then `node -v` must print `v22.x`. If `nvm` is not on `PATH`:
  `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. `npm run` is NOT gated by
  `engine-strict`; checking is a step you do.
- **No new dependencies.** No globe library, no animation library, no `react-map-gl`.
- **No `dy:` term, no container layout change, no read-model change.** The seed's new trip is
  fixture data built from the existing normative fixtures in `docs/data-model.md`.
- **`lib/` holds no React.** Pure goes to `lib/map/`; hooks go to `hooks/map/`; presentation stays
  in the component folder.
- **One component, one folder** — named file, one-line `index.ts` barrel, its test, its `notes.md`.
- **Comments are three lines or fewer**, pointing at a sibling `notes.md#anchor` that must resolve.
- **Function length**: 200 hard bound in `components/**`, `app/**`, `hooks/**`; 80 in `lib/**` and
  `scripts/**`.
- **Arbitrary Tailwind values are banned** outside `components/ui/**`.
- **`npm run lint` carries `--max-warnings 0`**; `npm run format:check` covers
  `{app,components,hooks,lib,scripts}/**/*.{ts,tsx}`.
- **The map is mounted once and never remounted**, and **nothing branches the tree on viewport
  width** — the stylesheet decides, exactly as in 4b.
- **`maplibre-gl` is never statically imported** by anything a public route reaches. The ESLint
  fence refuses it; the import lives inside the effect in `useMapInstance`.
- **Definition of done, run and read** — with a Pod up (`npm run pod:dev &`) before `npm test`:
  `npm test`, `npm run lint`, `npm run typecheck`, `npm run validate:fixtures`,
  `npm run check:vocab`, `npm run check:commands`, `npm run check:structure`,
  `npm run format:check`, `npm run build`, `npm run size:public`, and
  `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`.
- **Baselines to hold**, from `main` @ `740776e`: `npm test` 1754 passed / 2 todo / 0 skipped / 87
  files; `test:e2e` 17; `size:public` 182.0 kB of 190 (worst route); `check:structure`
  `Structure OK` with `active exemptions — 0`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/seed-dev-pod.ts` | **Modify.** A second published trip, `2025-patagonia`, which the diary fixture already names and the seeder currently strips. |
| `lib/map/trips.ts` | **Create.** Pure: `buildTripPoints`, `centresBbox`, `flyOptions`. No DOM, no map. |
| `lib/map/view.ts` | **Modify.** `GLOBE_PROJECTION` beside the existing mercator `PROJECTION`. |
| `hooks/map/use-map-instance.ts` | **Modify.** An optional `projection`, defaulting to `PROJECTION`. The single `setProjection` call site does not move. |
| `hooks/map/use-map-trips.ts` | **Create.** The trips source with `promoteId`, its circle layer, hover feature state, and the click that flies and pins. |
| `components/public/diary-map/` | **Create.** The map island for `/`: the frame, the lazy mount, the dev-only `__map` handle. |
| `components/public/trip-list/` | **Create.** Server-rendered list; `trip-row/` is the thin client row carrying `data-slug` and the hover handlers. |
| `components/public/map-sheet/map-sheet.tsx` | **Modify.** The handle's `sr-only` label becomes a prop defaulting to today's string. |
| `app/(public)/page.tsx` | **Modify.** The shell, the `<Suspense>` with an async child, the diary copy in the sheet. |
| `e2e/diary-globe.spec.ts` | **Create.** The browser case, with its mutation controls. |
| `CLAUDE.md`, `docs/testing-gates.md` | **Modify.** `app/(public)/page.tsx` and `scripts/seed-dev-pod.ts` join the e2e gate. |
| `docs/decisions.md`, `TODO.md` | **Modify.** §33, and the stage-3 claim closed by argument. |

---

### Task 1: A second published trip in the seed

**Files:**
- Modify: `scripts/seed-dev-pod.ts`
- Test: `test/integration/pod-read.integration.test.ts`

**Interfaces:**
- Produces: a seeded Pod where `publishedTripSlugs()` returns `["2025-patagonia", "2026-japan"]` in
  some order, `2025-patagonia`'s index carries a `center` and a `bbox`, and `2026-secret` is still
  a draft.

**Read first:** the seeder parses four Turtle fixtures out of `docs/data-model.md` — `DIARY`,
`TRIP`, `ENTRY`, `INDEX` — and derives everything else by string replacement. The diary fixture
**already lists `<trips/2025-patagonia/trip.ttl#it>`** and the seeder currently strips it with a
regex, under the comment "One trip only: the fixture diary lists a second that does not exist here."
This task makes that comment obsolete rather than working around it again.

- [ ] **Step 1: Write the failing test**

```ts
// test/integration/pod-read.integration.test.ts — add to the existing describe
it("serves two published trips and keeps the draft out", async () => {
  const published = await publishedTripSlugs();
  expect(published.ok).toBe(true);
  if (!published.ok) return;

  expect([...published.value].sort()).toEqual(["2025-patagonia", "2026-japan"]);
  expect(published.value).not.toContain("2026-secret");
});

it("the second trip's index carries the centre and bbox a globe needs", async () => {
  const index = await getTripIndex("2025-patagonia");
  expect(index.ok).toBe(true);
  if (!index.ok) return;

  expect(index.value.center).toBeDefined();
  expect(index.value.bbox).toBeDefined();
  // Far from Japan on purpose: a globe with two markers a few degrees apart
  // tests nothing about a globe.
  expect(index.value.center?.long).toBeLessThan(-60);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/integration/pod-read.integration.test.ts`
Expected: FAIL — the first case gets `["2026-japan"]`, the second a read error for a trip that is
not there. **If it SKIPS instead, no Pod is answering on `localhost:3001`** — start one with
`npm run pod:dev &` and run again; a skip here is not a pass.

- [ ] **Step 3: Seed the trip**

In `scripts/seed-dev-pod.ts`, add `2025-patagonia` to the container loop:

```ts
for (const c of [
  "travel/",
  "travel/trips/",
  "travel/trips/2026-japan/",
  "travel/trips/2026-japan/entries/",
  "travel/trips/2025-patagonia/",
  "travel/trips/2025-patagonia/entries/",
]) {
```

Stop stripping it from the diary — the `.replace(/\s*,\s*<trips\/2025-patagonia\/trip\.ttl#it>/, "")`
call goes, and the comment above it with it:

```ts
// Both trips the §7 diary fixture lists now exist, plus a draft the fixture
// does not: there is no index acting as a publication boundary for trips, so
// the app must filter on dy:status and dev data has to make that reachable.
await put(
  "travel/diary.ttl",
  DIARY.replace(
    "<trips/2026-japan/trip.ttl#it> .",
    "<trips/2026-japan/trip.ttl#it> ,\n                        <trips/2026-secret/trip.ttl#it> .",
  ),
);
```

Then the trip, its index and its two entries, after the Japan block:

```ts
// Patagonia, and deliberately a hemisphere away: two markers a few degrees
// apart would exercise nothing a globe does.
await put(
  "travel/trips/2025-patagonia/trip.ttl",
  TRIP.replace('dy:slug            "2026-japan"', 'dy:slug            "2025-patagonia"')
    .replace('schema:name        "Japan, spring"@en', 'schema:name        "Patagonia, autumn"@en')
    .replace('dy:startDate       "2026-03-29"^^xsd:date', 'dy:startDate       "2025-03-08"^^xsd:date')
    .replace('dy:endDate         "2026-04-12"^^xsd:date', 'dy:endDate         "2025-03-22"^^xsd:date'),
);
await put(
  "travel/trips/2025-patagonia/entries.ttl",
  INDEX.replace(/<#e-2026-03-31-nara>\s*;?/g, "")
    .replaceAll("2026-03-29-arrival", "2025-03-09-el-chalten")
    .replaceAll("35.6938", "-49.3315")
    .replaceAll("139.7034", "-72.8860")
    .replace('"First night in Shinjuku"@en', '"Under Fitz Roy"@en')
    .replace('"2026-03-29T21:40:00+09:00"', '"2025-03-09T18:20:00-03:00"'),
);
await put(
  "travel/trips/2025-patagonia/entries/2025-03-09-el-chalten.ttl",
  ENTRY.replace('"2026-03-29-arrival"', '"2025-03-09-el-chalten"')
    .replace('"First night in Shinjuku"@en', '"Under Fitz Roy"@en')
    .replace('dy:occurredAt        "2026-03-29T21:40:00+09:00"', 'dy:occurredAt        "2025-03-09T18:20:00-03:00"')
    .replace('"Shinjuku, Tokyo"@en', '"El Chaltén"@en')
    .replace('schema:addressLocality "Tokyo"@en', 'schema:addressLocality "El Chaltén"@en')
    .replaceAll("35.6938", "-49.3315")
    .replaceAll("139.7034", "-72.8860"),
);
```

**The index fixture's `dy:centerLat`/`dy:centerLong` and its four bbox terms must end up describing
Patagonia, not Tokyo** — check what `INDEX` actually contains and extend the replacements until they
do. `lib/pod/schema.ts`'s `TripIndex` is what the test asserts against, so read it rather than
guessing the predicate names; `lib/vocab.ts` has the IRIs.

- [ ] **Step 4: Re-seed and point the app at the new Pod**

```bash
npm run pod:seed
```

It prints `POD_ROOT=` and `OWNER_WEBID=`. **Paste both into `.env.local`** — every run creates a
fresh pod with a timestamped name, so the old values now point at a pod without Patagonia.
**Quote `OWNER_WEBID`**: it ends in a `#fragment`, which an unquoted value silently truncates.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/integration/pod-read.integration.test.ts`
Expected: PASS, and the file's pre-existing cases still green — several assert against
`2026-japan` and must be unaffected.

- [ ] **Step 6: Deal with the e2e Pod, which does NOT re-seed itself**

`e2e/global-setup.ts`'s `requireSeededPod` returns early when `travel/diary.ttl` already answers
200, so the existing `e2e` pod keeps its one-trip contents and Task 9's browser case would fail
looking for a second marker. Delete it so the next e2e run re-seeds:

```bash
rm -rf .pod-data/e2e
```

Record the trap in `e2e/notes.md` under a new `## the seeded pod does not follow the seeder`
section: the guard is a resource check, not a version check, so any change to
`scripts/seed-dev-pod.ts` needs that directory removed or an `E2E_SEED_NAME` bump.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed-dev-pod.ts test/integration/pod-read.integration.test.ts e2e/notes.md
git commit -m "Seed the second trip the diary fixture already named"
```

---

### Task 2: The pure arithmetic

**Files:**
- Create: `lib/map/trips.ts`, `lib/map/trips.test.ts`

**Interfaces:**
- Consumes: `Bbox` and `fitOptions` from `lib/map/view.ts`; `Trip` and `TripIndex` from
  `lib/pod/schema.ts`.
- Produces, and later tasks depend on these exactly:
  `type TripPoint = { slug: string; name: string; center?: { lat: number; long: number }; bbox?: Bbox }`;
  `buildTripPoints(trips: TripPoint[]): FeatureCollection<Point, { slug: string; name: string }>`;
  `centresBbox(trips: TripPoint[]): Bbox | undefined`;
  `flyOptions(bbox: Bbox): ReturnType<typeof fitOptions>` with `animate: true`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/map/trips.test.ts
import { describe, expect, it } from "vitest";
import { buildTripPoints, centresBbox, flyOptions, type TripPoint } from "./trips";

const japan: TripPoint = {
  slug: "2026-japan",
  name: "Japan, spring",
  center: { lat: 35.6938, long: 139.7034 },
  bbox: { west: 135.0, south: 34.0, east: 140.0, north: 36.0 },
};
const patagonia: TripPoint = {
  slug: "2025-patagonia",
  name: "Patagonia, autumn",
  center: { lat: -49.3315, long: -72.886 },
  bbox: { west: -73.5, south: -50.0, east: -72.0, north: -49.0 },
};
const unplaced: TripPoint = { slug: "2024-notes", name: "No coordinates at all" };

describe("buildTripPoints", () => {
  it("makes one Point per placed trip, carrying the slug and the name", () => {
    const collection = buildTripPoints([japan, patagonia]);

    expect(collection.features).toHaveLength(2);
    expect(collection.features[0].geometry.coordinates).toEqual([139.7034, 35.6938]);
    expect(collection.features[0].properties).toEqual({
      slug: "2026-japan",
      name: "Japan, spring",
    });
  });

  it("drops a trip with no centre rather than placing it at null island", () => {
    const collection = buildTripPoints([japan, unplaced]);

    expect(collection.features).toHaveLength(1);
    expect(collection.features[0].properties.slug).toBe("2026-japan");
  });
});

describe("centresBbox", () => {
  it("encloses every placed centre", () => {
    expect(centresBbox([japan, patagonia])).toEqual({
      west: -72.886,
      south: -49.3315,
      east: 139.7034,
      north: 35.6938,
    });
  });

  it("pads a single centre, which would otherwise be a zero-width box", () => {
    const box = centresBbox([japan]);

    expect(box).toBeDefined();
    if (box === undefined) return;
    expect(box.east - box.west).toBeGreaterThan(0);
    expect(box.north - box.south).toBeGreaterThan(0);
    // Still centred on the trip it came from.
    expect((box.east + box.west) / 2).toBeCloseTo(139.7034, 5);
  });

  it("is undefined when nothing is placed, so a caller can skip the fit", () => {
    expect(centresBbox([unplaced])).toBeUndefined();
    expect(centresBbox([])).toBeUndefined();
  });
});

describe("flyOptions", () => {
  it("is fitOptions with the animation turned on", () => {
    const options = flyOptions(japan.bbox!);

    expect(options.bounds).toEqual([
      [135.0, 34.0],
      [140.0, 36.0],
    ]);
    expect(options.animate).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/map/trips.test.ts`
Expected: FAIL — cannot find module `./trips`.

- [ ] **Step 3: Implement**

```ts
// lib/map/trips.ts
import type { FeatureCollection, Point } from "geojson";
import { fitOptions, type Bbox } from "./view";

export type TripPoint = {
  slug: string;
  name: string;
  center?: { lat: number; long: number };
  bbox?: Bbox;
};

type Placed = TripPoint & { center: { lat: number; long: number } };

const isPlaced = (trip: TripPoint): trip is Placed => trip.center !== undefined;

/** A degree either side of a lone centre: fitBounds on a zero-width box zooms
 *  to its maximum, which on a globe is a view of one street. */
const LONE_PAD = 1;

export function buildTripPoints(
  trips: TripPoint[],
): FeatureCollection<Point, { slug: string; name: string }> {
  return {
    type: "FeatureCollection",
    features: trips.filter(isPlaced).map((trip) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [trip.center.long, trip.center.lat] },
      properties: { slug: trip.slug, name: trip.name },
    })),
  };
}

export function centresBbox(trips: TripPoint[]): Bbox | undefined {
  const placed = trips.filter(isPlaced);
  if (placed.length === 0) return undefined;
  const longs = placed.map((trip) => trip.center.long);
  const lats = placed.map((trip) => trip.center.lat);
  const pad = placed.length === 1 ? LONE_PAD : 0;
  return {
    west: Math.min(...longs) - pad,
    south: Math.min(...lats) - pad,
    east: Math.max(...longs) + pad,
    north: Math.max(...lats) + pad,
  };
}

/** The same object `fitOptions` returns, animated: both are destructured into
 *  `map.fitBounds(bounds, camera)` at the call site. Staying pure means it does
 *  NOT read prefers-reduced-motion — the hook overrides the flag. */
export function flyOptions(bbox: Bbox) {
  return { ...fitOptions(bbox), animate: true as const };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/map/trips.test.ts`
Expected: PASS, 7 cases.

- [ ] **Step 5: Mutation-check the padding**

Change `LONE_PAD` to `0` and re-run: the single-centre case MUST fail on both the width and the
height assertions. Restore it.

- [ ] **Step 6: Commit**

```bash
git add lib/map/trips.ts lib/map/trips.test.ts
git commit -m "The globe's arithmetic, before anything can draw it"
```

---

### Task 3: The projection becomes an option

**Files:**
- Modify: `lib/map/view.ts`, `hooks/map/use-map-instance.ts`
- Test: `lib/map/view.test.ts`, `hooks/map/use-map-instance.test.ts`
- Modify: `hooks/map/notes.md`

**Interfaces:**
- Produces: `GLOBE_PROJECTION = { type: "globe" } as const` in `lib/map/view.ts`;
  `useMapInstance({ container, active, bbox, styleUrl, projection })` where `projection` is optional
  and defaults to `PROJECTION`.

**Read first:** `hooks/map/use-map-instance.ts`'s `setProjection` call sits inside the `style.load`
handler and is the ONLY reader of `PROJECTION` in the tree. It does not move. The options object is
already held in a ref (`latest`) so that changing `bbox` or `styleUrl` cannot re-run the
construction effect — `projection` joins that ref for the same reason.

- [ ] **Step 1: Write the failing test**

```ts
// lib/map/view.test.ts — add to the existing describe
it("offers a globe projection distinct from the flat default", () => {
  expect(PROJECTION).toEqual({ type: "mercator" });
  // "globe" is MapLibre's shorthand: globe below z11, mercator above z12, so
  // it flattens as the reader zooms in. "vertical-perspective" never does.
  expect(GLOBE_PROJECTION).toEqual({ type: "globe" });
});
```

```ts
// hooks/map/use-map-instance.test.ts — add to the existing describe
it("passes the projection it was given to the one setProjection call", async () => {
  const { map } = renderInstance({ projection: { type: "globe" } });
  await waitFor(() => expect(map()).not.toBeNull());

  map()!.emit("style.load");

  expect(map()!.projection).toEqual({ type: "globe" });
});

it("defaults to mercator when no projection is given", async () => {
  const { map } = renderInstance({});
  await waitFor(() => expect(map()).not.toBeNull());

  map()!.emit("style.load");

  expect(map()!.projection).toEqual({ type: "mercator" });
});
```

**Adapt these two to the fake and helpers the file already has** — it declares its own `FakeMap`
and there is no shared one. The fake needs a `setProjection(value)` recording what it was called
with; if it has one already, use it. Do not rewrite the file's existing cases.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/map/view.test.ts hooks/map/use-map-instance.test.ts`
Expected: FAIL — `GLOBE_PROJECTION` is not exported, and the hook has no `projection` option.

- [ ] **Step 3: Implement**

`lib/map/view.ts`, beside the existing constant:

```ts
/** MapLibre expands "globe" to an interpolation: globe below z11, mercator
 *  above z12. ./notes.md#why-the-globe-is-a-shorthand-not-vertical-perspective */
export const GLOBE_PROJECTION = { type: "globe" } as const;
```

`hooks/map/use-map-instance.ts`:

```ts
export type MapInstanceOptions = {
  container: RefObject<HTMLDivElement | null>;
  active: boolean;
  bbox?: Bbox;
  styleUrl?: string;
  projection?: typeof PROJECTION | typeof GLOBE_PROJECTION;
};
```

with the destructure and the ref carrying it, and inside `style.load`:

```ts
        instance.on("style.load", () => {
          instance.setProjection(latest.current.projection ?? PROJECTION);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/map hooks/map components/public/trip-map`
Expected: PASS, every pre-existing case included. `TripMap` passes no `projection` and must keep
getting mercator.

- [ ] **Step 5: Note why the shorthand**

In `lib/map/notes.md`, a section `## why the globe is a shorthand not vertical-perspective`: read
out of the shipped `maplibre-gl.mjs`, `"globe"` expands to
`["interpolate", ["linear"], ["zoom"], 11, "vertical-perspective", 12, "mercator"]`, so it flattens
between z11 and z12 rather than fighting a reader who zooms in; `"vertical-perspective"` is the
always-globe value and is deliberately not used.

- [ ] **Step 6: Commit**

```bash
git add lib/map hooks/map
git commit -m "The projection is an option, and the call site stays put"
```

---

### Task 4: The trips source, its layer, and the camera

**Files:**
- Create: `hooks/map/use-map-trips.ts`, `hooks/map/use-map-trips.test.ts`
- Modify: `hooks/map/notes.md`

**Interfaces:**
- Consumes: `buildTripPoints`, `centresBbox`, `flyOptions`, `type TripPoint` (Task 2);
  `fitOptions` and `MAP_COLORS`.
- Produces, and Task 5 depends on these exactly:
  `export const TRIPS_SOURCE = "diary-trips"`; `export const TRIPS_LAYER = "diary-trip-points"`;
  `useMapTrips(map, trips: TripPoint[], styleLoaded: boolean, activeSlug: string | null, handlers: TripHandlers): void`
  where `type TripHandlers = { onEnter?: (slug: string) => void; onLeave?: () => void; onSelect?: (slug: string) => void }`.

**Read first:** `hooks/map/use-map-layers.ts` is the shape to follow — gate on `styleLoaded` (NOT
`map.isStyleLoaded()`, which also waits on tiles), add the source once and afterwards only
`setData`. `hooks/map/use-map-highlight.ts` is the shape for feature state. Both are short; read
them before writing this.

**Two things this hook must get right, and both have bitten this project already:**
1. **`promoteId: "slug"` on the source**, or `setFeatureState` has no id to key on and silently
   paints nothing. Stage 4a shipped a leg highlight that did exactly that.
2. **Handlers live in a ref**, not in the effect's dependency array, or a caller's fresh object
   literal rebuilds the layer on every render.

- [ ] **Step 1: Write the failing test**

```ts
// @vitest-environment jsdom
// hooks/map/use-map-trips.test.ts
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMapTrips, TRIPS_SOURCE, TRIPS_LAYER } from "./use-map-trips";
import type { TripPoint } from "@/lib/map/trips";

// No shared fake exists in this repository — use-map-instance.test.ts and
// use-map-layers.test.ts each declare their own. This one needs two things
// neither has: setFeatureState, and the three-argument layer-scoped on().
class FakeMap {
  sources = new Map<string, Record<string, unknown>>();
  layers: Record<string, unknown>[] = [];
  states: { id: string; state: Record<string, unknown> }[] = [];
  removed: string[] = [];
  fitted: [unknown, Record<string, unknown>][] = [];
  handlers = new Map<string, ((event: unknown) => void)[]>();

  addSource(id: string, spec: Record<string, unknown>) {
    this.sources.set(id, spec);
  }
  getSource(id: string) {
    return this.sources.has(id) ? { setData: vi.fn() } : undefined;
  }
  addLayer(spec: Record<string, unknown>) {
    this.layers.push(spec);
  }
  setFeatureState(target: { id: string }, state: Record<string, unknown>) {
    this.states.push({ id: target.id, state });
  }
  removeFeatureState(target: { id: string }) {
    this.removed.push(target.id);
  }
  fitBounds(bounds: unknown, camera: Record<string, unknown>) {
    this.fitted.push([bounds, camera]);
  }
  // Layer-scoped: on(event, layer, handler). The two-argument form is not used
  // by this hook, so the fake does not pretend to support it.
  on(event: string, _layer: string, handler: (event: unknown) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  off() {
    return this;
  }
  emit(event: string, payload: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(payload);
  }
}

const japan: TripPoint = {
  slug: "2026-japan",
  name: "Japan, spring",
  center: { lat: 35.6938, long: 139.7034 },
  bbox: { west: 135, south: 34, east: 140, north: 36 },
};
const patagonia: TripPoint = {
  slug: "2025-patagonia",
  name: "Patagonia, autumn",
  center: { lat: -49.3315, long: -72.886 },
  bbox: { west: -73.5, south: -50, east: -72, north: -49 },
};
const feature = (slug: string) => ({ features: [{ properties: { slug } }] });

let map: FakeMap;
beforeEach(() => {
  map = new FakeMap();
});

describe("useMapTrips", () => {
  it("does nothing until the style has loaded", () => {
    renderHook(() => useMapTrips(map as never, [japan], false, null, {}));
    expect(map.sources.size).toBe(0);
  });

  it("promotes the slug, or the highlight would key on nothing", () => {
    renderHook(() => useMapTrips(map as never, [japan, patagonia], true, null, {}));

    expect(map.sources.get(TRIPS_SOURCE)?.promoteId).toBe("slug");
    expect(map.layers.map((layer) => layer.id)).toContain(TRIPS_LAYER);
  });

  it("fits every centre once, not one trip's own bounds", () => {
    renderHook(() => useMapTrips(map as never, [japan, patagonia], true, null, {}));

    expect(map.fitted).toHaveLength(1);
    const [bounds] = map.fitted[0];
    expect(bounds).toEqual([
      [-72.886, -49.3315],
      [139.7034, 35.6938],
    ]);
  });

  it("paints the active trip and clears the one before it", () => {
    const { rerender } = renderHook(
      ({ slug }: { slug: string | null }) =>
        useMapTrips(map as never, [japan, patagonia], true, slug, {}),
      { initialProps: { slug: null as string | null } },
    );

    rerender({ slug: "2026-japan" });
    expect(map.states.at(-1)).toEqual({ id: "2026-japan", state: { active: true } });

    rerender({ slug: "2025-patagonia" });
    expect(map.removed).toContain("2026-japan");
  });

  it("reports hover and selection by slug, and flies to the selected trip", () => {
    const onEnter = vi.fn();
    const onSelect = vi.fn();
    renderHook(() => useMapTrips(map as never, [japan, patagonia], true, null, { onEnter, onSelect }));

    map.emit("mouseenter", feature("2025-patagonia"));
    expect(onEnter).toHaveBeenCalledWith("2025-patagonia");

    map.emit("click", feature("2025-patagonia"));
    expect(onSelect).toHaveBeenCalledWith("2025-patagonia");
    // The second fit is the fly: that trip's OWN bbox, animated.
    expect(map.fitted).toHaveLength(2);
    expect(map.fitted[1][1].animate).toBe(true);
    expect(map.fitted[1][0]).toEqual([
      [-73.5, -50],
      [-72, -49],
    ]);
  });

  it("jumps instead of flying when the reader asked for less motion", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    renderHook(() => useMapTrips(map as never, [japan, patagonia], true, null, {}));

    map.emit("click", feature("2025-patagonia"));

    expect(map.fitted[1][1].animate).toBe(false);
  });

  it("does not rebuild when the handlers object is a fresh literal", () => {
    const { rerender } = renderHook(() =>
      useMapTrips(map as never, [japan], true, null, { onEnter: vi.fn() }),
    );

    rerender();
    expect(map.layers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run hooks/map/use-map-trips.test.ts`
Expected: FAIL — cannot find module `./use-map-trips`.

- [ ] **Step 3: Implement**

```ts
// hooks/map/use-map-trips.ts
"use client";

import { useEffect, useRef } from "react";
import { buildTripPoints, centresBbox, flyOptions, type TripPoint } from "@/lib/map/trips";
import { fitOptions } from "@/lib/map/view";
import { MAP_COLORS } from "@/lib/map/tokens";

type MapLibreMap = import("maplibre-gl").Map;

export const TRIPS_SOURCE = "diary-trips";
export const TRIPS_LAYER = "diary-trip-points";

export type TripHandlers = {
  onEnter?: (slug: string) => void;
  onLeave?: () => void;
  onSelect?: (slug: string) => void;
};

export function useMapTrips(
  map: MapLibreMap | null,
  trips: TripPoint[],
  styleLoaded: boolean,
  activeSlug: string | null = null,
  handlers: TripHandlers = {},
): void {
  // A ref, not a dependency: a fresh object literal per render would otherwise
  // tear the layer down and rebuild it. ./notes.md#why-the-trip-handlers-are-a-ref
  const hooks = useRef(handlers);
  useEffect(() => {
    hooks.current = handlers;
  });

  useEffect(() => {
    if (map === null || !styleLoaded) return;
    const points = buildTripPoints(trips);
    if (map.getSource(TRIPS_SOURCE) === undefined) addTrips(map, points, trips);
    // Data in place on a later change; the source is never re-added.
    else (map.getSource(TRIPS_SOURCE) as { setData: (value: unknown) => void }).setData(points);
  }, [map, trips, styleLoaded]);

  useEffect(() => {
    if (map === null || !styleLoaded) return;
    const enter = (event: { features?: { properties: { slug: string } }[] }) => {
      const slug = event.features?.[0]?.properties.slug;
      if (slug !== undefined) hooks.current.onEnter?.(slug);
    };
    const leave = () => hooks.current.onLeave?.();
    const select = (event: { features?: { properties: { slug: string } }[] }) => {
      const slug = event.features?.[0]?.properties.slug;
      if (slug === undefined) return;
      hooks.current.onSelect?.(slug);
      const bbox = trips.find((trip) => trip.slug === slug)?.bbox;
      if (bbox === undefined) return;
      const { bounds, ...camera } = flyOptions(bbox);
      // maplibre already zeroes a non-essential duration under the query; this
      // is belt-and-braces AND what the jsdom case can assert.
      // ./notes.md#the-fly-is-a-jump-under-reduced-motion
      const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      map.fitBounds(bounds, { ...camera, animate });
    };
    map.on("mouseenter", TRIPS_LAYER, enter);
    map.on("mouseleave", TRIPS_LAYER, leave);
    map.on("click", TRIPS_LAYER, select);
    return () => {
      map.off("mouseenter", TRIPS_LAYER, enter);
      map.off("mouseleave", TRIPS_LAYER, leave);
      map.off("click", TRIPS_LAYER, select);
    };
  }, [map, trips, styleLoaded]);

  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (map === null || !styleLoaded) return;
    // setFeatureState on an unknown id is a silent no-op — the same trap
    // use-map-highlight.ts records. ./notes.md#a-highlight-can-land-on-nothing
    if (previous.current !== null) {
      map.removeFeatureState({ source: TRIPS_SOURCE, id: previous.current });
    }
    if (activeSlug !== null) {
      map.setFeatureState({ source: TRIPS_SOURCE, id: activeSlug }, { active: true });
    }
    previous.current = activeSlug;
  }, [map, activeSlug, styleLoaded]);
}

function addTrips(map: MapLibreMap, points: ReturnType<typeof buildTripPoints>, trips: TripPoint[]) {
  map.addSource(TRIPS_SOURCE, { type: "geojson", data: points, promoteId: "slug" } as never);
  map.addLayer({
    id: TRIPS_LAYER,
    type: "circle",
    source: TRIPS_SOURCE,
    paint: {
      "circle-radius": 7,
      "circle-color": [
        "case",
        ["boolean", ["feature-state", "active"], false],
        MAP_COLORS.accentBright,
        MAP_COLORS.accent,
      ],
      "circle-stroke-width": 2,
      "circle-stroke-color": MAP_COLORS.accentDeep,
    },
  } as never);
  const box = centresBbox(trips);
  if (box === undefined) return;
  const { bounds, ...camera } = fitOptions(box);
  map.fitBounds(bounds, camera);
}
```

**If `as never` on the two spec objects offends `typecheck`, type them properly** with
`GeoJSONSourceSpecification` and `LayerSpecification` the way `use-map-layers.ts` does — read that
file for the imports. Do not leave an `eslint-disable` behind either way.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run hooks/map`
Expected: PASS, 6 new cases plus every pre-existing one.

- [ ] **Step 5: Mutation-check the two traps**

Delete `promoteId: "slug"` and re-run — the promote case MUST fail. Then move `handlers` from the
ref into the second effect's dependency array and re-run — the rebuild case MUST fail. Restore both.

- [ ] **Step 6: Notes**

In `hooks/map/notes.md`, add `## why the trip handlers are a ref` (same reason
`use-map-markers.ts`'s are, one sentence and a pointer to that section), a sentence under the
existing highlight anchor that a trips feature state keys on the promoted `slug`, and
`## the fly is a jump under reduced motion` — recording that maplibre-gl 6.6.0 already zeroes a
non-essential duration when the query matches, so the explicit flag is belt-and-braces kept because
it is what a jsdom test can assert.

**The jsdom stub matters here**: jsdom implements no `matchMedia`, so the optional call is what
keeps the hook working un-stubbed, and the new case stubs it deliberately. Reset it between cases or
it leaks into the ones after.

- [ ] **Step 7: Commit**

```bash
git add hooks/map
git commit -m "The trips source, its circle layer, and the fly-to"
```

---

### Task 5: The map island for `/`

**Files:**
- Create: `components/public/diary-map/diary-map.tsx`, `index.ts`, `notes.md`,
  `diary-map.test.tsx`

**Interfaces:**
- Consumes: `useMapInstance` with the new `projection` option (Task 3), `useMapTrips` (Task 4),
  `useTripHighlight` from `@/hooks/trip/highlight-context`, `GLOBE_PROJECTION`.
- Produces: `export default function DiaryMap({ trips, styleUrl }: { trips?: TripPoint[]; styleUrl?: string })`.
  **It exports no frame class**: it imports `MAP_FRAME_CLASS` from `components/public/trip-map`,
  because the pane owns the position and a second copy of `"size-full bg-surface"` is a value that
  can drift. Task 7's page imports it from the same place.

**Read `components/public/trip-map/trip-map.tsx` first.** This component is its sibling: same
IntersectionObserver activation, same lazy mount, same dev-only `__map` handle, different data and
a different projection. Copy its shape deliberately rather than inventing a second one, but do NOT
copy its entry-specific hooks.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// components/public/diary-map/diary-map.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DiaryMap from "./diary-map";
import type { TripPoint } from "@/lib/map/trips";

afterEach(cleanup);

const useMapInstance = vi.fn(() => ({ map: null, styleLoaded: false, status: "idle" }));
const useMapTrips = vi.fn();
vi.mock("@/hooks/map/use-map-instance", () => ({ useMapInstance: (o: unknown) => useMapInstance(o) }));
vi.mock("@/hooks/map/use-map-trips", () => ({
  useMapTrips: (...args: unknown[]) => useMapTrips(...args),
}));

const trips: TripPoint[] = [
  { slug: "2026-japan", name: "Japan, spring", center: { lat: 35.6938, long: 139.7034 } },
];

describe("DiaryMap", () => {
  it("renders a labelled region, so the browser case has something to find", () => {
    render(<DiaryMap trips={trips} />);
    expect(screen.getByRole("region", { name: /diary map/i })).toBeTruthy();
  });

  it("asks for the globe, not the flat default", () => {
    render(<DiaryMap trips={trips} />);
    expect(useMapInstance).toHaveBeenCalledWith(
      expect.objectContaining({ projection: { type: "globe" } }),
    );
  });

  it("hands the trips straight to the trips hook", () => {
    render(<DiaryMap trips={trips} />);
    expect(useMapTrips).toHaveBeenCalledWith(null, trips, false, null, expect.any(Object));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run components/public/diary-map`
Expected: FAIL — cannot find module `./diary-map`.

- [ ] **Step 3: Implement**

```tsx
// components/public/diary-map/diary-map.tsx
"use client";

// Outside the lazy chunk on purpose, exactly as trip-map does it.
import "maplibre-gl/dist/maplibre-gl.css";

import { useEffect, useRef, useState } from "react";
import { MAP_FRAME_CLASS } from "@/components/public/trip-map";
import { GLOBE_PROJECTION } from "@/lib/map/view";
import type { TripPoint } from "@/lib/map/trips";
import { useMapInstance } from "@/hooks/map/use-map-instance";
import { useMapTrips } from "@/hooks/map/use-map-trips";
import { useTripHighlight } from "@/hooks/trip/highlight-context";

type MapLibreMap = import("maplibre-gl").Map;

const NO_TRIPS: TripPoint[] = [];

export default function DiaryMap({
  trips = NO_TRIPS,
  styleUrl,
}: {
  trips?: TripPoint[];
  styleUrl?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  // ../trip-map/notes.md#the-no-observer-fallback-and-why-it-is-not-a-hole
  const [active, setActive] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const node = container.current;
    if (node === null || active) return;
    const observer = new IntersectionObserver(
      (seen) => {
        if (seen.some((record) => record.isIntersecting)) setActive(true);
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active]);

  const { activeSlug, raise, clear, pin } = useTripHighlight();
  const { map, styleLoaded } = useMapInstance({
    container,
    active,
    styleUrl,
    projection: GLOBE_PROJECTION,
  });
  useMapTrips(map, trips, styleLoaded, activeSlug, {
    onEnter: (slug) => raise(slug, "map"),
    onLeave: clear,
    onSelect: pin,
  });

  // e2e-only handle, and free outside production.
  // ../trip-map/notes.md#the-map-handle-attached-for-e2e
  useEffect(() => {
    const node = container.current;
    if (process.env.NODE_ENV === "production" || node === null || map === null) return;
    (node as HTMLDivElement & { __map?: MapLibreMap }).__map = map;
  }, [map]);

  return <div ref={container} role="region" aria-label="Diary map" className={MAP_FRAME_CLASS} />;
}
```

**No `bbox` is passed to `useMapInstance`** — the initial camera for this surface is `centresBbox`,
which `useMapTrips` fits once the source exists. Passing both would fight.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run components/public`
Expected: PASS.

- [ ] **Step 5: Barrel and notes**

`index.ts` is `export { default } from "./diary-map";`. `notes.md` gets two short sections:
`## why this is not trip-map with a flag` (different data, different projection, different hooks —
one component with a mode flag would carry both surfaces' state) and `## the camera is fitted by
the trips hook, not the instance` (why no `bbox` prop).

- [ ] **Step 6: Commit**

```bash
git add components/public/diary-map
git commit -m "The globe island, lazy like its sibling"
```

---

### Task 6: The trip list, and a label that stops lying

**Files:**
- Create: `components/public/trip-list/trip-list.tsx`, `index.ts`, `notes.md`,
  `trip-list.test.tsx`, and `trip-list/trip-row/{trip-row.tsx,index.ts,notes.md,trip-row.test.tsx}`
- Modify: `components/public/map-sheet/map-sheet.tsx`, `components/public/map-sheet/map-sheet.test.tsx`

**Interfaces:**
- Consumes: `useTripHighlight` (hover, and `activeSlug` for the active styling).
- Produces: `TripList({ trips }: { trips: TripListItem[] })` where
  `type TripListItem = { slug: string; name: string; startDate?: string; endDate?: string }`;
  rows carrying `data-slug` and `data-active`; `MapSheet` gains `label?: string`.

**Read `components/public/trip-timeline/` first** — this is the same two-file split for the same
measured reason: the `<Link>` renders in the SERVER component and the client row takes it as
children, which kept a duplicate `next/link` out of the trip page's chunk. Do not put the link in
the row.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// components/public/trip-list/trip-list.test.tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TripList from "./trip-list";

afterEach(cleanup);

describe("TripList", () => {
  it("links each trip by slug and shows its name", () => {
    render(<TripList trips={[{ slug: "2026-japan", name: "Japan, spring" }]} />);

    const link = screen.getByRole("link", { name: "Japan, spring" });
    expect(link.getAttribute("href")).toBe("/trips/2026-japan");
  });

  it("renders the dates when they are there and nothing when they are not", () => {
    const { rerender, container } = render(
      <TripList trips={[{ slug: "a", name: "A", startDate: "2026-03-29", endDate: "2026-04-12" }]} />,
    );
    expect(screen.getByText(/2026-03-29/)).toBeTruthy();

    rerender(<TripList trips={[{ slug: "a", name: "A" }]} />);
    // The whole row is the link: no empty date element left behind.
    expect(container.querySelector("li")?.children).toHaveLength(1);
  });
});
```

```tsx
// @vitest-environment jsdom
// components/public/trip-list/trip-row/trip-row.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TripRow from "./trip-row";
import { TripHighlightContext, type HighlightValue } from "@/hooks/trip/highlight-context";

afterEach(cleanup);

const value = (over: Partial<HighlightValue>): HighlightValue => ({
  activeSlug: null,
  pinnedSlug: null,
  source: null,
  raise: () => {},
  clear: () => {},
  pin: () => {},
  unpin: () => {},
  ...over,
});

describe("TripRow", () => {
  it("carries its slug, so the sheet can reveal it", () => {
    render(
      <TripHighlightContext value={value({})}>
        <TripRow slug="2026-japan">body</TripRow>
      </TripHighlightContext>,
    );
    expect(screen.getByText("body").closest("li")?.dataset.slug).toBe("2026-japan");
  });

  it("raises on pointer enter and clears on leave", () => {
    const raise = vi.fn();
    const clear = vi.fn();
    render(
      <TripHighlightContext value={value({ raise, clear })}>
        <TripRow slug="2026-japan">body</TripRow>
      </TripHighlightContext>,
    );
    const row = screen.getByText("body").closest("li")!;

    fireEvent.pointerEnter(row);
    expect(raise).toHaveBeenCalledWith("2026-japan", "timeline");

    fireEvent.pointerLeave(row);
    expect(clear).toHaveBeenCalled();
  });

  it("marks itself active when the highlight names it", () => {
    render(
      <TripHighlightContext value={value({ activeSlug: "2026-japan" })}>
        <TripRow slug="2026-japan">body</TripRow>
      </TripHighlightContext>,
    );
    expect(screen.getByText("body").closest("li")?.dataset.active).toBe("true");
  });
});
```

```tsx
// components/public/map-sheet/map-sheet.test.tsx — add one case
it("takes the handle's label, because 'entry list' is wrong on the diary page", () => {
  render(<MapSheet label="Resize the trip list">x</MapSheet>);
  expect(screen.getByRole("button", { name: "Resize the trip list" })).toBeTruthy();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run components/public/trip-list components/public/map-sheet`
Expected: FAIL — the modules do not exist, and `MapSheet` takes no `label`.

- [ ] **Step 3: Implement**

`trip-row.tsx` mirrors `timeline-row.tsx` — the handlers on the `<li>`, `data-slug`, `data-active`,
and the same ternary of literal class strings rather than a `data-[active]:` variant, which trips
the arbitrary-value rule. Raise with source `"timeline"`: the context's source union is
`"map" | "timeline" | "pin" | "route"` and a list row is the not-the-map side of it; do not widen
the union for a new name.

`trip-list.tsx` is the server component:

```tsx
import Link from "next/link";
import TripRow from "./trip-row";

export type TripListItem = { slug: string; name: string; startDate?: string; endDate?: string };

/** Numbering is sanctioned here for the same reason the timeline numbers its
 *  entries: a diary's trips are a sequence. docs/design-brief.md */
export default function TripList({ trips }: { trips: TripListItem[] }) {
  return (
    <ol className="mt-8 list-inside list-decimal space-y-1">
      {trips.map((trip) => {
        // The link renders HERE, on the server: a <Link> inside the client row
        // shipped a second copy of next/link in stage 4a, measured at 3.4 kB.
        const dates = [trip.startDate, trip.endDate].filter(Boolean).join(" – ");
        return (
          <TripRow key={trip.slug} slug={trip.slug}>
            <Link className="text-accent-bright underline" href={`/trips/${trip.slug}`}>
              {trip.name}
            </Link>
            {dates !== "" && (
              <span className="ml-2 font-mono text-sm text-muted-foreground">{dates}</span>
            )}
          </TripRow>
        );
      })}
    </ol>
  );
}
```

`map-sheet.tsx` takes the label:

```tsx
export default function MapSheet({
  children,
  label = "Resize the entry list",
}: {
  children: React.ReactNode;
  label?: string;
}) {
```

with the `<span className="sr-only">{label}</span>`.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run components/public`
Expected: PASS, and every pre-existing `map-sheet` case unchanged — the default keeps the trip page
identical.

- [ ] **Step 5: Notes and commit**

`trip-list/notes.md` records why the link is server-rendered (pointing at the timeline's measured
section rather than restating it) and that the row carries `data-slug`, which map markers also carry,
so a page-level locator must scope.

```bash
git add components/public
git commit -m "The trip list, and a sheet label that fits both pages"
```

---

### Task 7: The landing page becomes the shell

**Files:**
- Modify: `app/(public)/page.tsx`
- Test: `app/(public)/page.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `DiaryMap` (Task 5), `TripList` (Task 6), `MapSheet` with `label`,
  `TripHighlightProvider`, and `getDiary` / `publishedTripSlugs` / `getTrip` / `getTripIndex` from
  `@/lib/pod/cached`.
- Produces: the rendered tree `div.trip-shell > (div.trip-map-pane, div.trip-sheet)` on `/`.

**Read `app/(public)/trips/[slug]/layout.tsx` first** — it is the shape this page takes, including
the async child inside `<Suspense>`. The page must NOT await its reads directly: that would block
the static shell, which is the thing Next's instant-navigation validation flags.

**The data**: for each slug from `publishedTripSlugs()`, `getTrip(slug)` gives the name and dates,
`getTripIndex(slug)` gives `center` and `bbox`. Both are `use cache` with `cacheTag`, so this is 2N
cached reads. A trip whose trip read fails is dropped from the list; a trip whose INDEX fails still
gets a row, just no marker — **losing one index must not lose the diary**, the same rule
`app/(public)/trips/[slug]/page.tsx` follows for its own index.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// app/(public)/page.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ok, err } from "@/lib/pod/result";
import Home, { DiaryContent } from "./page";

vi.mock("@/lib/pod/cached", () => ({
  getDiary: vi.fn(),
  publishedTripSlugs: vi.fn(),
  getTrip: vi.fn(),
  getTripIndex: vi.fn(),
}));
vi.mock("@/components/public/diary-map", () => ({
  default: () => <div data-testid="diary-map" />,
  MAP_FRAME_CLASS: "size-full bg-surface",
}));

describe("the diary page", () => {
  it("puts the map BESIDE the sheet, never inside it", () => {
    const { container } = render(<Home />);
    const pane = container.querySelector(".trip-map-pane");
    const sheet = container.querySelector(".trip-sheet");

    expect(pane).not.toBeNull();
    expect(sheet).not.toBeNull();
    // The never-remounted invariant, as a tree shape. Same assertion the trip
    // layout carries, for the same reason.
    expect(sheet?.contains(pane as Node)).toBe(false);
  });

  it("keeps the shell when the diary cannot be read", async () => {
    const { getDiary, publishedTripSlugs } = await import("@/lib/pod/cached");
    vi.mocked(getDiary).mockResolvedValue(err({ kind: "http", status: 500 }) as never);
    vi.mocked(publishedTripSlugs).mockResolvedValue(ok([]) as never);

    const tree = await DiaryContent();
    const { container } = render(tree);

    // An unreachable diary still gets a map: throwing the surface away to show
    // one line of text is the worse failure.
    expect(container.textContent).toContain("unavailable");
  });
});
```

**`DiaryContent` is exported for this test** for the same reason `MapForTrip` is exported from the
trip layout: React's client renderer rejects an async component reached through JSX, so the resolved
path is tested by calling it directly. Adapt the error-shape mock to whatever `lib/pod/result.ts`
actually exports — read it rather than guessing.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "app/(public)/page.test.tsx"`
Expected: FAIL — no `.trip-map-pane`, and no `DiaryContent` export.

- [ ] **Step 3: Implement**

```tsx
import { Suspense } from "react";
import TripHighlightProvider from "@/components/public/trip-highlight";
import DiaryMap from "@/components/public/diary-map";
import { MAP_FRAME_CLASS } from "@/components/public/trip-map";
import MapSheet from "@/components/public/map-sheet";
import TripList from "@/components/public/trip-list";
import { config } from "@/lib/config";
import { getDiary, getTrip, getTripIndex, publishedTripSlugs } from "@/lib/pod/cached";
import { describe as describeError } from "@/lib/pod/result";

export default function Home() {
  return (
    <TripHighlightProvider>
      <div className="trip-shell">
        <div className="trip-map-pane">
          <Suspense fallback={<div aria-hidden className={MAP_FRAME_CLASS} />}>
            <DiaryMapForDiary />
          </Suspense>
        </div>
        <MapSheet label="Resize the trip list">
          <Suspense fallback={<DiarySkeleton />}>
            <DiaryContent />
          </Suspense>
        </MapSheet>
      </div>
    </TripHighlightProvider>
  );
}
```

with two async children — one reading the trips for the map, one for the sheet's copy and list —
and a `readTrips()` helper they share, which maps each published slug to
`{ slug, name, startDate, endDate, center, bbox }` and drops the ones whose `getTrip` failed.
`DiarySkeleton` is shaped like the real content, as `TripSkeleton` is on the trip page.

Both children call the same cached reads, so the second is served from the cache rather than
re-fetching — `use cache` with a `cacheTag` is what makes two readers cheap. Do not hoist the read
to the page and pass it down: that is what makes the shell wait.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run "app/(public)"`
Expected: PASS.

- [ ] **Step 5: Look at it in a real browser**

`npm run dev`, then `/` at a phone width and at 1280px. Expected: a globe — a visibly curved
horizon, not a flat rectangle — with two markers, the trip list in the sheet, and a click that
flies. **If the projection looks flat, `setProjection` is not being reached**; check `style.load`
before anything else. If you have no browser tool, say so plainly in your report rather than
implying you looked.

- [ ] **Step 6: Prove the budget**

Run: `npm run build && npm run size:public`
Expected: within 190 kB. The landing route now carries substantially the trip page's client tree, so
expect it near 182 kB rather than its old 176.3. **If it EXCEEDS, stop and report** — do not raise
the ceiling.

- [ ] **Step 7: Commit**

```bash
git add "app/(public)/page.tsx" "app/(public)/page.test.tsx"
git commit -m "The diary page becomes a globe with its trips beside it"
```

---

### Task 8: The browser case, and the gate paths nobody added

**Files:**
- Create: `e2e/diary-globe.spec.ts`
- Modify: `e2e/notes.md`, `CLAUDE.md`, `docs/testing-gates.md`

**Before starting:** if `.pod-data/e2e` still exists from before Task 1, delete it — `requireSeededPod`
short-circuits on an existing `travel/diary.ttl` and the pod would have one trip.

- [ ] **Step 1: Write the spec**

```ts
// e2e/diary-globe.spec.ts
/**
 * The diary globe: a real canvas, both seeded trips, and the click that flies.
 * Mutation controls in ./notes.md#the-diary-globe-controls
 */

import { expect, test } from "@playwright/test";

type MapLibreMap = import("maplibre-gl").Map;

const frameOf = (page: import("@playwright/test").Page) =>
  page.getByRole("region", { name: "Diary map" });

test("draws a globe carrying both published trips", async ({ page }) => {
  await page.goto("/");
  const frame = frameOf(page);
  await expect(frame.locator("canvas")).toBeVisible();

  // The rendered features, not the source's own data: querySourceFeatures
  // would pass on a layer that draws nothing.
  await expect
    .poll(() =>
      frame.evaluate((el) => {
        const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
        return map?.queryRenderedFeatures(undefined, { layers: ["diary-trip-points"] }).length ?? 0;
      }),
    )
    .toBe(2);

  // The draft must not be among them.
  const slugs = await frame.evaluate((el) => {
    const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
    return (map?.queryRenderedFeatures(undefined, { layers: ["diary-trip-points"] }) ?? []).map(
      (feature) => feature.properties?.slug,
    );
  });
  expect(slugs).not.toContain("2026-secret");
});

test("clicking a trip flies the camera and marks its row", async ({ page }) => {
  await page.goto("/");
  const frame = frameOf(page);
  await expect(frame.locator("canvas")).toBeVisible();

  const before = await frame.evaluate((el) => {
    const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
    return map?.getCenter().lng ?? 0;
  });

  // Clicked through the map's own API rather than by pixel: a circle layer has
  // no DOM node to target, and its screen position depends on the camera.
  await frame.evaluate((el) => {
    const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
    const [feature] = map?.queryRenderedFeatures(undefined, { layers: ["diary-trip-points"] }) ?? [];
    const point = map?.project((feature.geometry as { coordinates: [number, number] }).coordinates);
    if (point !== undefined) map?.fire("click", { lngLat: map.unproject(point), point, features: [feature] });
  });

  await expect
    .poll(() =>
      frame.evaluate((el) => {
        const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
        return map?.getCenter().lng ?? 0;
      }),
    )
    .not.toBe(before);
});

test("hovering a trip row marks its marker's feature state", async ({ page }) => {
  await page.goto("/");
  const frame = frameOf(page);
  await expect(frame.locator("canvas")).toBeVisible();

  await page.locator('a[href="/trips/2026-japan"]').hover();

  await expect
    .poll(() =>
      frame.evaluate((el) => {
        const map = (el as HTMLDivElement & { __map?: MapLibreMap }).__map;
        const rendered = map?.queryRenderedFeatures(undefined, { layers: ["diary-trip-points"] }) ?? [];
        return rendered.find((feature) => feature.properties?.slug === "2026-japan")?.state;
      }),
    )
    .toEqual({ active: true });
});
```

**`map.fire("click", …)` may not drive the layer-scoped handler** the way a real pointer does. If it
does not, click by pixel: project the feature's coordinates and `page.mouse.click` there, having
first asserted the point is inside the frame. Say in your report which one you used and why.

- [ ] **Step 2: Run it**

Run: `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e e2e/diary-globe.spec.ts`
Expected: PASS. **That is the wrong kind of green until Step 3 proves each case can fail.**

- [ ] **Step 3: Mutation-control every case**

| Mutation | Must break |
|---|---|
| `use-map-trips.ts`: delete `promoteId: "slug"` | the hover case — feature state keys on nothing |
| `use-map-trips.ts`: drop the `flyOptions` fit from `select` | the click case |
| `diary-map.tsx`: pass `PROJECTION` instead of `GLOBE_PROJECTION` | nothing, and that is the point — record it as the assertion this suite CANNOT make |
| `page.tsx`: filter the trips list to the first entry | the two-feature count |
| `seed-dev-pod.ts`: mark `2025-patagonia` a draft | the two-feature count |

Apply each, run, confirm, revert. **The projection row is expected to break nothing** — record it in
`e2e/notes.md` as a hole rather than inventing an assertion that pretends to cover it.

- [ ] **Step 4: The gate**

`CLAUDE.md`'s path-scoped `test:e2e` list gains two entries:

```
app/(public)/page.tsx   scripts/seed-dev-pod.ts
```

`docs/testing-gates.md` gets a paragraph: neither was on the list, this stage fires the gate anyway
through `components/public/**`, and that is exactly why the hole stayed invisible — a later
page-only or seed-only change is the one that would skip the run it needed. The seed is on the list
because the browser cases assert against seeded data, so changing the fixture changes the test.

- [ ] **Step 5: Commit**

```bash
git add e2e CLAUDE.md docs/testing-gates.md
git commit -m "A browser case for the globe, and two gate paths nobody added"
```

---

### Task 9: §33, and a claim this project stops making

**Files:**
- Modify: `docs/decisions.md`, `TODO.md`, `components/public/trip-map/notes.md`

- [ ] **Step 1: Write §33**

After §32 in `docs/decisions.md`:

```markdown
## 33. A marker that carries a photo is DOM; a plain point is GL

Entry markers are DOM elements (§30) because each carries a photo thumbnail and because the
clustering loop walks `querySourceFeatures` to keep elements in step with the source. Neither is
true of a trip on the diary globe: there is no thumbnail, and a diary with fifty published trips is
not a problem this project has.

So the trips source is one GeoJSON source with `promoteId: "slug"` and a `circle` layer, and the
active trip is painted with `setFeatureState` — the mechanism §30 already uses for clusters and 4a
uses for legs.

**Consequences.** Two marker mechanisms exist in one codebase and a reader must know which surface
uses which; the criterion above is the rule, not the file they happened to open first. A trip
marker cannot show a photo without moving to the DOM shape, which is a real cost if phase 7 wants
one. §30 is unchanged and not contradicted: its own words are "a cluster never touches a photo, so
it never needs the DOM".
```

- [ ] **Step 2: Close the stage-3 claim in `TODO.md`**

Tick the globe line, write the stage record in the shape the 4a and 4b entries use — spec and plan
paths, task count, the numbers from your own verification run, what stayed open — and **replace the
"closes in stage 5" prediction with what was actually established**: the defect needs a direct trip
A → trip B soft navigation to be reachable; every route in the app goes through `/`, which tears the
`[slug]` layout down; stage 5 adds no such link; so the three stale assumptions
(`useMapLayers`'s `cluster` fixed at `addSource`, `useMapInstance`'s one-shot fit,
`useMapMarkers`'s skip-if-present) remain unreachable and no fix ships. What would have to exist
first is a trip-to-trip link, which is a product decision nobody has taken.

Mirror one sentence of that into `components/public/trip-map/notes.md`'s existing section, so the
note that poses the question also carries the answer.

- [ ] **Step 3: Verify the documentation checks**

Run: `npm run check:commands`, `npm run check:structure`, `npm test`
Expected: PASS, `Structure OK`.

- [ ] **Step 4: Commit**

```bash
git add docs TODO.md components/public/trip-map/notes.md
git commit -m "Decision 33, and the stage-3 claim closed by argument"
```

---

## Definition of done for the whole stage

Run every one of these, **read the output**, and only then say the stage is done. `node -v` must
print `v22.x` first, and `.env.local` must point at the Pod re-seeded in Task 1.

```sh
npm run pod:dev &                       # FIRST, or the integration tests skip and report green
npm test                                # expect > 1754 passed, 2 todo, 0 skipped
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure                 # Structure OK; active exemptions — 0 stays 0
npm run format:check
npm run build
npm run size:public                     # 190 kB ceiling; the worst route was 182.0 kB
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e   # expect 20 passed (17 + 3)
```

**The integration control, both halves.** With the Pod up, `test/integration/` must RUN — and now
its new cases depend on the re-seeded Pod, so a stale `.env.local` shows up here as a failure rather
than a skip. Kill the Pod and re-run: the same two files must report skipped.

**Then run the whole list again on the merge result**, before pushing, as every stage since 3 has.

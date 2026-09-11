# Phase 4 — Stage 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photo-thumbnail markers, clustering above ~50 points, and a per-leg travel-mode route with `accent-deep` casing — all fed by the one `IndexEntry[]` the index already carries, on the single MapLibre instance stage 2 mounted.

**Architecture:** Four pure builders in `lib/map/` turn `IndexEntry[]` into GeoJSON and style expressions, and are tested without a map at all. Then the instance hook widens from `MapStatus` to `{ status, map }` so two new hooks can reach it: one owning sources and layers, one owning HTML markers reconciled from `querySourceFeatures`. Clustering splits the work by what each engine is good at — GL layers draw cluster circles, HTML elements draw leaves, because a thumbnail is a Pod URL that an `<img>` can load and `map.addImage` cannot. Nothing here remounts the map.

**Tech Stack:** Node 22.23.2, Next 16 App Router, React 19, `maplibre-gl@6.6.0` (ESM, **named exports only**), Vitest 4, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-09-map-and-timeline-design.md` — §6 is this stage. §1 defines the bundle controls it must not break.

**Depends on:** Stage 2 (`docs/superpowers/plans/2026-09-10-map-and-timeline-stage-2.md`), merged as `f6e07ca`. This stage consumes `useMapInstance`, `TripMap`, `buildBasemapStyle()` and `SOURCE_ID`, and adds no new dependency.

## Global Constraints

- **Node 22.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`, then `node -v` must print `v22.23.2`. Every command here runs and passes on Node 20 too, which is why checking is a step you do.
- **`npm test` needs a Pod.** A Community Solid Server must answer on `localhost:3001` or the two `test/integration/` suites skip themselves and the run reports green having tested less than it says. **Do not kill a Pod you did not start.** The dead-port control is `TEST_POD=http://localhost:3999 npm test`. Measured baseline at this stage's base commit `f6e07ca`: **1508 passed / 2 todo / 0 skipped / 69 files** with the Pod up, **1472 passed / 36 skipped** with it pointed at a dead port.
- **`npm run test:e2e` IS required by this stage's diff**, as `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`. Baseline at `f6e07ca`: **9 passed**. The six gated paths in `CLAUDE.md` still do **not** include `components/public/**` or `lib/map/**` — deferred by the owner on 2026-09-10 and recorded in `docs/decisions.md` §28. **Do not widen them here either.** Revisit is this stage's to offer, not to implement.
- **`maplibre-gl` may never be imported statically from a public path.** 252.8 kB gzip against 190 kB of budget. The only permitted static import is the stylesheet subpath `maplibre-gl/dist/maplibre-gl.css`, already in `trip-map.tsx`. Everything else is `await import("maplibre-gl")` inside a handler, with types spelled `import("maplibre-gl").Map` inline. The fence covers `lib/map/**` as of stage 2, so this binds the new modules too.
- **`maplibre-gl` v6 has NO default export.** Destructure named exports: `const { Marker } = await import("maplibre-gl")`.
- **`SOURCE_ID` is `"openmaptiles"`** and belongs to the basemap. This stage's sources must not collide with it. Use `"trip-points"` and `"trip-legs"`.
- **`setProjection` has exactly one call site**, inside the `style.load` handler in `use-map-instance.ts`, and `test/guardrails.test.ts` pins it by source scan. **This stage does not add a second.** If the globe view needs a different argument, change the argument.
- **Never remove the OpenStreetMap attribution control**, and no code path may make it conditional.
- **One MapLibre instance, mounted once, never remounted.** The map is created by `useMapInstance` and kept alive by the `[slug]` layout. Nothing here may tear it down to apply data — sources and layers are added once and their **data** is updated in place.
- **`TripMap`'s markup must NOT branch on `active`.** The lazy `useState` initializer returns `true` on the server (no `IntersectionObserver` in Node) and `false` on the client, so any JSX that depends on `active` becomes a real hydration mismatch. This stage is the likely first offender — a marker layer or a loading state. Render the same DOM either way and drive everything from effects.
- **Marker placeholders are a CSS skeleton, and `IndexEntry` stays at eleven fields** — `docs/decisions.md` §29, decided 2026-09-11. **Do not add `dy:blurDataUrl` to the index**, and do not fetch entry resources for it. Nothing mechanical would stop you: `check:vocab` passes because the term is already in `lib/vocab.ts`, `validate:fixtures` passes because it is an `xsd:string`, and `size:public` is indifferent.
- **Arbitrary Tailwind values are banned outside `components/ui/**`**, and the guardrail reaches a class string held in a `const`. Marker classes are scale and token values only.
- **Comment less; make the code readable instead.** Said by the owner six times, most recently pre-emptively mid-run. The six-line bound is a ceiling on a comment that earned its place, **not a target and not evidence of compliance** — a file can sit under every bound and still be noise. **The code samples in this plan are already trimmed to what earns its place; type them as they are rather than adding explanation.** Keep a comment only when it carries a measurement, warns of a trap at the point of danger, or states a reason the code cannot.
- **Comment blocks in production code: hard bound six lines, delimiter lines count.** Two blocks with no blank line between them are ONE run; a blank line resets it. `npm run lint` runs `--max-warnings 0`, so a stale `eslint-disable` fails the build.
- **No `eslint-disable`.** There is exactly one in the whole repository and `active exemptions — 0` must stay true.
- **Longer explanation goes in a sibling `notes.md` behind an anchor**, with the code keeping `// <one line>; see ./notes.md#anchor`. An anchor that does not resolve fails `npm run check:structure`. The slug drops punctuation rather than hyphenating it — check a slug against the tool, never reason about it.
- **One component, one folder.** `componentFoldersAreOwn()` fails any `.tsx` under `components/` whose folder is not named after it, or that has no `index.ts` beside it. **A second `.tsx` cannot live in `components/public/trip-map/`** — which is why the marker is built as a DOM element in `lib/map/`, not as a React component. Flat `hooks/` modules beside the component are fine.
- **`lib/` holds no React.** A DOM factory is not React and belongs there; anything with JSX does not.
- **Render functions: 130 tendency, 200 hard bound. `lib/**` and `scripts/**` functions: 50 tendency, 80 hard bound.** ESLint errors at the hard bound only. **Never tighten a lint rule to a tendency value**, and never add an exemption to pass one.
- **Tests live beside their subject**, base name matching the part before the first dot.
- **Every test must be able to fail, and you prove it by mutation.** Stage 2 shipped four checks that could not fail and found every one by running it rather than reading it: a test whose observable was pinned by a guard rather than by the code under test, a mutation whose edit was tree-shaken away, a bundle line whose green was indifferent to the thing it named, and an e2e assertion whose precondition never held. **Guard every mutation** — `cp` the file first, `grep` to confirm the edit actually applied, `cp` back, re-run. A `sed` that matches nothing exits 0 and leaves the suite green.
- **The `dy:` namespace is still `https://example.org/ns/traveldiary#`.** Nothing here touches a live Pod.

## File Structure

| File | Responsibility |
|---|---|
| `lib/map/points.ts` | `IndexEntry[]` → `FeatureCollection<Point>`; drops entries with no coordinate |
| `lib/map/points.test.ts` | the drop rule, the properties, the empty case |
| `lib/map/legs.ts` | `IndexEntry[]` → `FeatureCollection<LineString>`; ordering, the mode-from-destination rule |
| `lib/map/legs.test.ts` | ordering, mode source, entries dropping out of both ends |
| `lib/map/dashes.ts` | the `["match", ["get","mode"], …]` dash expression, per `TravelMode` |
| `lib/map/dashes.test.ts` | every mode covered, the fallback, validated by the real style spec |
| `lib/map/view.ts` | fit options from `bbox`, the cluster threshold, the projection choice |
| `lib/map/view.test.ts` | the threshold boundary, the padding, the no-bbox case |
| `lib/map/marker-element.ts` | the DOM element for one leaf: skeleton, thumbnail swap, pin vs soft circle |
| `lib/map/marker-element.test.ts` | the skeleton before load, the swap, the precision distinction |
| `lib/map/notes.md` | why markers are DOM and not React, why leaves are HTML and clusters are GL |
| `components/public/trip-map/hooks/use-map-instance.ts` | **modified** — return `{ status, map }` instead of `MapStatus` |
| `components/public/trip-map/hooks/use-map-layers.ts` | the two sources and the four layers; updates data in place |
| `components/public/trip-map/hooks/use-map-layers.test.ts` | added once, updated not recreated, clustering threshold applied |
| `components/public/trip-map/hooks/use-map-markers.ts` | leaf reconciliation from `querySourceFeatures` |
| `components/public/trip-map/hooks/use-map-markers.test.ts` | add, remove, no-duplicate, teardown |
| `components/public/trip-map/trip-map.tsx` | **modified** — accepts `entries`, passes them to the two new hooks |
| `components/public/trip-map/notes.md` | **modified** — the reconciliation contract |
| `app/(public)/trips/[slug]/layout.tsx` | **modified** — passes `index.value.entries` |
| `e2e/trip-map.spec.ts` | **modified** — one case: a marker and a route line on a real canvas |
| `docs/decisions.md`, `TODO.md` | §30, and the stage-3 tick |

---

### Task 1: `lib/map/points.ts` — entries to point features

The first of four pure builders. No map, no React, no I/O — which is why these come first and why their tests are fast and honest.

**The drop rule is the interesting part.** `IndexEntry.lat` and `.long` are both optional, and an entry with only one of them is not a point. §6 says entries with no coordinate drop out of both the points and the legs, so both builders need the same predicate — put it here and let `legs.ts` import it rather than writing a second one that can drift.

**Files:**
- Create: `lib/map/points.ts`
- Create: `lib/map/points.test.ts`

**Interfaces:**
- Consumes: `IndexEntry` from `@/lib/pod/schema`.
- Produces:
  - `hasCoordinate(entry: IndexEntry): entry is IndexEntry & { lat: number; long: number }`
  - `buildPoints(entries: IndexEntry[]): FeatureCollection<Point, PointProps>`
  - `type PointProps = { slug: string; title: string; thumbnail?: string; precisionMeters?: number; sortOrder: number }`

`FeatureCollection` and `Point` come from `geojson`, which arrives transitively as a dependency of `maplibre-gl` (`@types/geojson@^7946.0.16`, confirmed present on 2026-09-11). It is types only, erased at build. **If `npm run typecheck` cannot resolve it, declare the two shapes locally in this file rather than adding a dependency** — and say so in your report.

- [ ] **Step 1: Write the failing test**

Create `lib/map/points.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/pod/schema";
import { buildPoints, hasCoordinate } from "@/lib/map/points";

function entry(over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    iri: "https://pod.example/travel/trips/t/entries.ttl#e1",
    entryResource: "https://pod.example/travel/trips/t/e1.ttl",
    title: { value: "Arrival", language: "en" },
    slug: "arrival",
    lat: 35.68,
    long: 139.76,
    sortOrder: 1,
    ...over,
  };
}

describe("buildPoints", () => {
  it("keeps an entry that has both halves of a coordinate", () => {
    const fc = buildPoints([entry()]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([139.76, 35.68]);
  });

  it("puts long before lat, because GeoJSON is x,y and the schema is not", () => {
    const fc = buildPoints([entry({ lat: 1, long: 2 })]);
    expect(fc.features[0].geometry.coordinates).toEqual([2, 1]);
  });

  it("drops an entry with no coordinate at all", () => {
    expect(buildPoints([entry({ lat: undefined, long: undefined })]).features).toEqual([]);
  });

  it("drops an entry with only one half, which is not a point", () => {
    expect(buildPoints([entry({ long: undefined })]).features).toEqual([]);
    expect(buildPoints([entry({ lat: undefined })]).features).toEqual([]);
  });

  it("keeps a zero coordinate, which is a real place and not a missing one", () => {
    expect(buildPoints([entry({ lat: 0, long: 0 })]).features).toHaveLength(1);
  });

  it("carries the properties the marker needs and nothing else", () => {
    const fc = buildPoints([
      entry({ thumbnail: "https://pod.example/t.jpg", precisionMeters: 1000, sortOrder: 4 }),
    ]);
    expect(fc.features[0].properties).toEqual({
      slug: "arrival",
      title: "Arrival",
      thumbnail: "https://pod.example/t.jpg",
      precisionMeters: 1000,
      sortOrder: 4,
    });
  });

  it("omits absent optional properties rather than writing undefined into them", () => {
    const props = buildPoints([entry()]).features[0].properties;
    expect("thumbnail" in props).toBe(false);
    expect("precisionMeters" in props).toBe(false);
  });

  it("is a valid empty FeatureCollection for no entries, not null", () => {
    expect(buildPoints([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});

describe("hasCoordinate", () => {
  it("narrows so callers do not re-check", () => {
    const e = entry();
    expect(hasCoordinate(e)).toBe(true);
    expect(hasCoordinate(entry({ lat: undefined }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run lib/map/points.test.ts`

Expected: FAIL with `Failed to resolve import "@/lib/map/points"`. Not an assertion failure.

- [ ] **Step 3: Write it**

Create `lib/map/points.ts`:

```ts
import type { FeatureCollection, Point } from "geojson";
import type { IndexEntry } from "@/lib/pod/schema";

export type PointProps = {
  slug: string;
  title: string;
  thumbnail?: string;
  precisionMeters?: number;
  sortOrder: number;
};

type Placed = IndexEntry & { lat: number; long: number };

export function hasCoordinate(entry: IndexEntry): entry is Placed {
  return entry.lat !== undefined && entry.long !== undefined;
}

export function buildPoints(entries: IndexEntry[]): FeatureCollection<Point, PointProps> {
  return {
    type: "FeatureCollection",
    features: entries.filter(hasCoordinate).map((entry) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [entry.long, entry.lat] },
      properties: {
        slug: entry.slug,
        title: entry.title.value,
        ...(entry.thumbnail === undefined ? {} : { thumbnail: entry.thumbnail }),
        ...(entry.precisionMeters === undefined ? {} : { precisionMeters: entry.precisionMeters }),
        sortOrder: entry.sortOrder,
      },
    })),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run lib/map/points.test.ts` — expected: PASS, 9 cases.

- [ ] **Step 5: Prove two of them are not vacuous**

```sh
cp lib/map/points.ts /tmp/points.bak

# 1. The zero-coordinate case. A truthiness test would drop 0,0 — the classic
#    bug this case exists for. Expect: the zero case reddens, alone.
sed -i '' 's|return entry.lat !== undefined \&\& entry.long !== undefined;|return Boolean(entry.lat) \&\& Boolean(entry.long);|' lib/map/points.ts
grep -q 'Boolean(entry.lat)' lib/map/points.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/points.test.ts
cp /tmp/points.bak lib/map/points.ts

# 2. Coordinate order. Expect: the x,y case reddens.
sed -i '' 's|coordinates: \[entry.long, entry.lat\]|coordinates: [entry.lat, entry.long]|' lib/map/points.ts
grep -q 'entry.lat, entry.long' lib/map/points.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/points.test.ts
cp /tmp/points.bak lib/map/points.ts

npx vitest run lib/map/points.test.ts   # 9 passed again
```

Report the actual output of each.

- [ ] **Step 6: Run the checks and commit**

```sh
npx vitest run lib/map
npm run lint
npm run typecheck
npm run check:structure
```

```sh
git add lib/map/points.ts lib/map/points.test.ts
git commit -m "Entries become point features, and a missing half is not a point

hasCoordinate lives here rather than in each builder because legs.ts needs the
same predicate and two copies drift. It tests for undefined rather than
truthiness: 0,0 is a real place off the coast of Ghana, and a Boolean check
would drop it — watched failing.

GeoJSON is x,y and the schema is lat/long, so the order is flipped exactly
once, here, with a case pinning it."
```

---

### Task 2: `lib/map/legs.ts` — consecutive entries to lines

**Two rules that are easy to get backwards, and both are in §6.** Legs are consecutive index entries ordered by `sortOrder` **then** `occurredAt`; and each leg takes its mode from its **destination** entry, because `dy:travelModeFrom` is defined as the leg arriving at that entry. A leg whose destination has no mode is still a leg — it draws with the fallback dash.

**Entries with no coordinate drop out before pairing, not after.** Otherwise a placeless entry in the middle of a trip would split one leg into none instead of joining its neighbours.

**Files:**
- Create: `lib/map/legs.ts`
- Create: `lib/map/legs.test.ts`

**Interfaces:**
- Consumes: `hasCoordinate` from `@/lib/map/points` (Task 1); `IndexEntry`, `TravelMode` from `@/lib/pod/schema`.
- Produces:
  - `type LegProps = { mode: TravelMode | "Unknown"; fromSlug: string; toSlug: string }`
  - `buildLegs(entries: IndexEntry[]): FeatureCollection<LineString, LegProps>`
  - `orderEntries(entries: IndexEntry[]): IndexEntry[]` — exported so the marker and timeline work can share one ordering

- [ ] **Step 1: Write the failing test**

Create `lib/map/legs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/pod/schema";
import { buildLegs, orderEntries } from "@/lib/map/legs";

function entry(slug: string, over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    iri: `https://pod.example/travel/trips/t/entries.ttl#${slug}`,
    entryResource: `https://pod.example/travel/trips/t/${slug}.ttl`,
    title: { value: slug, language: "en" },
    slug,
    lat: 1,
    long: 1,
    sortOrder: 1,
    ...over,
  };
}

describe("orderEntries", () => {
  it("orders by sortOrder first", () => {
    const ordered = orderEntries([entry("b", { sortOrder: 2 }), entry("a", { sortOrder: 1 })]);
    expect(ordered.map((e) => e.slug)).toEqual(["a", "b"]);
  });

  it("breaks a sortOrder tie with occurredAt", () => {
    const ordered = orderEntries([
      entry("late", { sortOrder: 1, occurredAt: "2026-03-30T09:00:00+09:00" }),
      entry("early", { sortOrder: 1, occurredAt: "2026-03-29T09:00:00+09:00" }),
    ]);
    expect(ordered.map((e) => e.slug)).toEqual(["early", "late"]);
  });

  it("does not mutate its argument, because the caller renders from the same array", () => {
    const input = [entry("b", { sortOrder: 2 }), entry("a", { sortOrder: 1 })];
    orderEntries(input);
    expect(input.map((e) => e.slug)).toEqual(["b", "a"]);
  });
});

describe("buildLegs", () => {
  it("joins two placed entries into one line", () => {
    const fc = buildLegs([
      entry("a", { sortOrder: 1, lat: 1, long: 2 }),
      entry("b", { sortOrder: 2, lat: 3, long: 4 }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.coordinates).toEqual([
      [2, 1],
      [4, 3],
    ]);
  });

  it("takes the mode from the DESTINATION, because travelModeFrom is the leg arriving there", () => {
    const fc = buildLegs([
      entry("a", { sortOrder: 1, travelModeFrom: "Walk" }),
      entry("b", { sortOrder: 2, travelModeFrom: "Train" }),
    ]);
    expect(fc.features[0].properties.mode).toBe("Train");
  });

  it("names both ends, so a leg can be traced back to its entries", () => {
    const fc = buildLegs([entry("a", { sortOrder: 1 }), entry("b", { sortOrder: 2 })]);
    expect(fc.features[0].properties).toMatchObject({ fromSlug: "a", toSlug: "b" });
  });

  it("falls back to Unknown when the destination carries no mode", () => {
    const fc = buildLegs([entry("a", { sortOrder: 1 }), entry("b", { sortOrder: 2 })]);
    expect(fc.features[0].properties.mode).toBe("Unknown");
  });

  it("joins across a placeless entry rather than splitting the route in two", () => {
    const fc = buildLegs([
      entry("a", { sortOrder: 1 }),
      entry("nowhere", { sortOrder: 2, lat: undefined, long: undefined }),
      entry("c", { sortOrder: 3 }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties).toMatchObject({ fromSlug: "a", toSlug: "c" });
  });

  it("orders before pairing, so an out-of-order array does not zigzag", () => {
    const fc = buildLegs([
      entry("c", { sortOrder: 3 }),
      entry("a", { sortOrder: 1 }),
      entry("b", { sortOrder: 2 }),
    ]);
    expect(fc.features.map((f) => f.properties.toSlug)).toEqual(["b", "c"]);
  });

  it("makes no leg from a single entry, and none from none", () => {
    expect(buildLegs([entry("a")]).features).toEqual([]);
    expect(buildLegs([])).toEqual({ type: "FeatureCollection", features: [] });
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run lib/map/legs.test.ts` — expected: FAIL on an unresolved import of `@/lib/map/legs`.

- [ ] **Step 3: Write it**

Create `lib/map/legs.ts`:

```ts
import type { FeatureCollection, LineString } from "geojson";
import { hasCoordinate } from "@/lib/map/points";
import type { IndexEntry, TravelMode } from "@/lib/pod/schema";

export type LegProps = { mode: TravelMode | "Unknown"; fromSlug: string; toSlug: string };

export function orderEntries(entries: IndexEntry[]): IndexEntry[] {
  return [...entries].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.occurredAt ?? "").localeCompare(b.occurredAt ?? ""),
  );
}

export function buildLegs(entries: IndexEntry[]): FeatureCollection<LineString, LegProps> {
  const placed = orderEntries(entries).filter(hasCoordinate);
  return {
    type: "FeatureCollection",
    features: placed.slice(1).map((to, i) => {
      const from = placed[i];
      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [from.long, from.lat],
            [to.long, to.lat],
          ],
        },
        // The mode belongs to the arriving leg, not the departing one (§6).
        properties: { mode: to.travelModeFrom ?? "Unknown", fromSlug: from.slug, toSlug: to.slug },
      };
    }),
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run lib/map/legs.test.ts` — expected: PASS, 11 cases.

- [ ] **Step 5: Prove three of them are not vacuous**

```sh
cp lib/map/legs.ts /tmp/legs.bak

# 1. Mode from the ORIGIN instead of the destination — the rule most likely to
#    be written backwards. Expect: the destination case reddens.
sed -i '' 's|mode: to.travelModeFrom ?? "Unknown"|mode: from.travelModeFrom ?? "Unknown"|' lib/map/legs.ts
grep -q 'from.travelModeFrom' lib/map/legs.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/legs.test.ts
cp /tmp/legs.bak lib/map/legs.ts

# 2. Filter before ordering. Expect: the ordering case reddens.
sed -i '' 's|orderEntries(entries).filter(hasCoordinate)|orderEntries(entries.filter(hasCoordinate))|' lib/map/legs.ts
npx vitest run lib/map/legs.test.ts   # still green — this one is equivalent, and that is the point
cp /tmp/legs.bak lib/map/legs.ts

# 3. Sort in place. Expect: the no-mutation case reddens.
sed -i '' 's|return \[...entries\].sort(|return entries.sort(|' lib/map/legs.ts
grep -q 'return entries.sort(' lib/map/legs.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/legs.test.ts
cp /tmp/legs.bak lib/map/legs.ts

npx vitest run lib/map/legs.test.ts   # 11 passed again
```

**Mutation 2 is expected to stay GREEN, and that is information rather than a failure** — filtering and ordering commute here, so no case can tell them apart. Say so in your report rather than hunting for a case that would; inventing one would be asserting an implementation detail, not a behaviour.

- [ ] **Step 6: Run the checks and commit**

```sh
npx vitest run lib/map
npm run lint
npm run typecheck
npm run check:structure
```

```sh
git add lib/map/legs.ts lib/map/legs.test.ts
git commit -m "Legs join consecutive placed entries, and take their mode from the arrival

dy:travelModeFrom is defined as the leg arriving at an entry, so a leg reads its
mode from its destination. Written the other way round it looks identical on a
two-entry trip and is wrong on every longer one — watched failing.

Placeless entries drop out before pairing rather than after, so an entry with no
coordinate in the middle of a trip joins its neighbours instead of splitting the
route into nothing. orderEntries copies before sorting: the caller renders from
the same array."
```

---

### Task 3: `lib/map/dashes.ts` and `lib/map/view.ts` — the expression and the numbers

Two small modules, one commit. They are grouped because neither carries its own test cycle worth a separate review gate, and both are pure data.

**The dash expression is a style expression, not a lookup table.** MapLibre evaluates `["match", ["get","mode"], …]` per feature at render time, which is why one line layer draws eight modes. It has to be validated by the real style spec rather than by an assertion against its own literal — `lib/map/style.test.ts` already sets that precedent with `validateStyleMin`.

**Files:**
- Create: `lib/map/dashes.ts`, `lib/map/dashes.test.ts`
- Create: `lib/map/view.ts`, `lib/map/view.test.ts`

**Interfaces:**
- Consumes: `TravelMode` from `@/lib/pod/schema`. Nothing from `components/` — `lib/` must not import from there, which is why `Bbox` is **defined here and moved out of the hook** in Task 4.
- Produces:
  - `DASH_BY_MODE: ExpressionSpecification` — the `["match", …]` expression
  - `MODE_DASHES: Record<TravelMode | "Unknown", number[]>` — the source of truth the expression is built from
  - `type Bbox = { west: number; south: number; east: number; north: number }` — moved here from `use-map-instance.ts`, whose two importers Task 4 updates
  - `CLUSTER_THRESHOLD = 50`
  - `shouldCluster(count: number): boolean`
  - `fitOptions(bbox: Bbox): { bounds: [[number, number], [number, number]]; padding: number; animate: false }`
  - `PROJECTION: { type: "mercator" }` — §6 puts the projection choice in this module. It is a **value**, consumed by the single existing `setProjection` call site; this stage adds no second one.
  - `ROUTE_WIDTH = 2.5`, `CASING_EXTRA = 3.5`

- [ ] **Step 1: Write the failing tests**

Create `lib/map/dashes.test.ts`:

```ts
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { DASH_BY_MODE, MODE_DASHES } from "@/lib/map/dashes";
import { TravelMode } from "@/lib/pod/schema";

describe("MODE_DASHES", () => {
  it("covers every TravelMode the schema allows, plus Unknown", () => {
    expect(Object.keys(MODE_DASHES).sort()).toEqual([...TravelMode.options, "Unknown"].sort());
  });

  it("gives Walk and Flight different patterns, or the mode says nothing", () => {
    expect(MODE_DASHES.Walk).not.toEqual(MODE_DASHES.Flight);
  });

  it("uses a solid line for exactly one mode, so the others read as interruptions", () => {
    const solid = Object.entries(MODE_DASHES).filter(([, d]) => d.length === 0);
    expect(solid.map(([m]) => m)).toEqual(["Car"]);
  });
});

describe("DASH_BY_MODE", () => {
  it("is accepted by the real style spec inside a line layer", () => {
    const errors = validateStyleMin({
      version: 8,
      sources: { s: { type: "geojson", data: { type: "FeatureCollection", features: [] } } },
      layers: [
        {
          id: "l",
          type: "line",
          source: "s",
          paint: { "line-dasharray": DASH_BY_MODE },
        },
      ],
    });
    expect(errors.map((e) => e.message)).toEqual([]);
  });

  it("names every mode in the expression, not just the ones a fixture happened to have", () => {
    const flat = JSON.stringify(DASH_BY_MODE);
    for (const mode of TravelMode.options) expect(flat).toContain(`"${mode}"`);
  });
});
```

Create `lib/map/view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CLUSTER_THRESHOLD, fitOptions, shouldCluster } from "@/lib/map/view";

describe("shouldCluster", () => {
  it("does not cluster at the threshold, only above it", () => {
    expect(shouldCluster(CLUSTER_THRESHOLD)).toBe(false);
    expect(shouldCluster(CLUSTER_THRESHOLD + 1)).toBe(true);
  });

  it("does not cluster an empty trip", () => {
    expect(shouldCluster(0)).toBe(false);
  });
});

describe("fitOptions", () => {
  it("turns a bbox into the [[w,s],[e,n]] MapLibre wants", () => {
    expect(fitOptions({ west: 1, south: 2, east: 3, north: 4 }).bounds).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("never animates, so the first paint is already the trip", () => {
    expect(fitOptions({ west: 1, south: 2, east: 3, north: 4 }).animate).toBe(false);
  });
});
```

- [ ] **Step 2: Run them and watch them fail for the right reason**

Run: `npx vitest run lib/map/dashes.test.ts lib/map/view.test.ts`

Expected: FAIL on unresolved imports of both modules. Not assertion failures.

- [ ] **Step 3: Write both**

Create `lib/map/dashes.ts`:

```ts
import type { ExpressionSpecification } from "@maplibre/maplibre-gl-style-spec";
import { TravelMode } from "@/lib/pod/schema";

/** Dash lengths are in line-widths, not pixels, so they hold as the line scales. */
export const MODE_DASHES: Record<TravelMode | "Unknown", number[]> = {
  Flight: [1, 2],
  Train: [4, 1.5],
  Bus: [3, 2],
  Car: [],
  Boat: [2, 2, 0.5, 2],
  Bike: [2, 1],
  Walk: [0.5, 1.5],
  Other: [3, 3],
  Unknown: [3, 3],
};

export const DASH_BY_MODE: ExpressionSpecification = [
  "match",
  ["get", "mode"],
  ...TravelMode.options.flatMap((mode) => [mode, MODE_DASHES[mode]] as const),
  MODE_DASHES.Unknown,
] as ExpressionSpecification;
```

Create `lib/map/view.ts`:

```ts
export type Bbox = { west: number; south: number; east: number; north: number };

/** §6: one source clusters above ~50 points. At or below, every feature is a
 *  leaf and the cluster layers never fire. */
export const CLUSTER_THRESHOLD = 50;

/** §6 puts the projection choice here. It is a value, not a call: the one
 *  setProjection call site stays in use-map-instance.ts. */
export const PROJECTION = { type: "mercator" } as const;

export const ROUTE_WIDTH = 2.5;
/** Casing is drawn at ROUTE_WIDTH + this, i.e. 1.75px each side — inside the
 *  design brief's 1.5–2px requirement. */
export const CASING_EXTRA = 3.5;

export function shouldCluster(count: number): boolean {
  return count > CLUSTER_THRESHOLD;
}

export function fitOptions(bbox: Bbox) {
  return {
    bounds: [
      [bbox.west, bbox.south],
      [bbox.east, bbox.north],
    ] as [[number, number], [number, number]],
    padding: 32,
    animate: false as const,
  };
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run lib/map/dashes.test.ts lib/map/view.test.ts` — expected: PASS, 7 cases.

- [ ] **Step 5: Prove the coverage cases are not vacuous**

```sh
cp lib/map/dashes.ts /tmp/dashes.bak

# Drop a mode from the table. Expect: the coverage case AND the expression case
# both redden — the second is what catches a mode the expression forgot.
sed -i '' 's|^  Bike: \[2, 1\],$||' lib/map/dashes.ts
grep -q 'Bike:' lib/map/dashes.ts && { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/dashes.test.ts
cp /tmp/dashes.bak lib/map/dashes.ts

# Make two modes identical. Expect: the Walk/Flight case reddens.
sed -i '' 's|  Walk: \[0.5, 1.5\],|  Walk: [1, 2],|' lib/map/dashes.ts
grep -q 'Walk: \[1, 2\]' lib/map/dashes.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/dashes.test.ts
cp /tmp/dashes.bak lib/map/dashes.ts

npx vitest run lib/map/dashes.test.ts lib/map/view.test.ts   # 7 passed again
```

- [ ] **Step 6: Run the checks and commit**

```sh
npx vitest run lib/map
npm run lint
npm run typecheck
npm run check:structure
```

```sh
git add lib/map/dashes.ts lib/map/dashes.test.ts lib/map/view.ts lib/map/view.test.ts
git commit -m "One match expression draws eight travel modes, validated by the real spec

The dash pattern is a style expression evaluated per feature, not a lookup the
component performs, so one line layer covers every mode. It is checked with
validateStyleMin rather than against its own literal — an assertion that the
object equals itself is the shape this repository has shipped before.

The coverage case is derived from TravelMode.options rather than a typed list,
so a ninth mode added to the schema reddens here instead of silently drawing
with the fallback. Watched failing by deleting a mode.

view.ts holds the numbers the brief fixes: the cluster threshold at >50 and the
casing at width + 3.5, which is 1.75px each side."
```

---

### Task 4: widen `useMapInstance` to `{ status, map }`

Stage 2 closed with this written down as what stage 3 needs: *"`useMapInstance` returns a status but not the instance. Stage 3 needs the instance to add sources and layers: widen the return to `{ status, map }` there, rather than reaching into the ref from the component now."* This task does exactly that and nothing else, so the change is reviewable on its own before anything depends on it.

**The instance must become observable without becoming a dependency.** The map is created inside a promise callback, so returning `map.current` directly would hand callers a value that is `null` on the render where it matters and never triggers another. Put the instance in state alongside the outcome, set once, and never on a later render.

**Do not touch the creation effect's dependency array.** `[active, container]` is what keeps the instance from being rebuilt, and a case in this file is the invariant's only mechanical defence. Do not add a `setProjection` call site either — there is exactly one and `test/guardrails.test.ts` pins it.

**`Bbox` moves out of the hook in this task**, because Task 3's `view.ts` defines it and `lib/` may not import from `components/`. Exactly two files reference it today — `use-map-instance.ts:13` (the definition) and `trip-map.tsx:7` (an import) — so delete the definition and point both at `@/lib/map/view`. Do **not** leave a re-export behind: one name, one home.

**Use `fitOptions` and `PROJECTION` rather than the inline literals.** The hook currently spells the camera by hand at `use-map-instance.ts:52-59` — `setProjection({ type: "mercator" })` and `fitBounds([[…]], { padding: 32, animate: false })`. Task 3 moved both into `view.ts`, so this is where they get consumed. The `setProjection` **call** stays exactly where it is; only its argument comes from elsewhere.

**Files:**
- Modify: `components/public/trip-map/hooks/use-map-instance.ts`
- Modify: `components/public/trip-map/hooks/use-map-instance.test.ts`
- Modify: `components/public/trip-map/trip-map.tsx` — the `Bbox` import

**Interfaces:**
- Consumes: `Bbox`, `fitOptions`, `PROJECTION` from `@/lib/map/view` (Task 3).
- Produces: `useMapInstance(options): { status: MapStatus; map: MapLibreMap | null }` where `type MapLibreMap = import("maplibre-gl").Map`.

- [ ] **Step 1: Update the existing tests to the new shape, and add two**

The eleven existing cases read `result.current` as a string. They become `result.current.status`. Add:

```ts
  it("hands back the instance once it exists, so layers can be added to it", async () => {
    const { result } = renderHook(() => useMapInstance(harness()));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(result.current.map).toBe(created[0]);
  });

  it("has no instance to hand back while inactive", () => {
    const { result } = renderHook(() => useMapInstance(harness({ active: false })));
    expect(result.current.map).toBeNull();
  });
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts`

Expected: the two new cases FAIL because `result.current.map` is `undefined` — the hook still returns a string. The rewritten existing cases fail the same way. **If a case fails with "Cannot read properties of null" instead, you have changed the hook before the test.**

- [ ] **Step 3: Make the change**

In `use-map-instance.ts`, add an instance state, set it where `map.current` is assigned, clear it in the teardown effect, and widen the return:

```ts
type MapLibreMap = import("maplibre-gl").Map;

const [instance, setInstance] = useState<MapLibreMap | null>(null);
```

At the end of the creation callback, beside `map.current = instance`:

```ts
        map.current = created;
        setInstance(created);
```

In the teardown effect, after `map.current?.remove()`:

```ts
      setInstance(null);
```

And the return:

```ts
  return { status: !active ? "idle" : outcome === "pending" ? "loading" : outcome, map: instance };
}
```

**Watch for `react-hooks/set-state-in-effect`.** Two of stage 2's samples tripped it and both had to be restructured. `setInstance` inside a promise callback is not the same thing as a synchronous `setState` in an effect body, but **run `npm run lint` before you believe that**, and if it fires, restructure rather than disabling.

- [ ] **Step 3b: Consume `fitOptions` and `PROJECTION`, and move `Bbox`**

In the `style.load` handler, replace the two hand-spelled literals:

```ts
        instance.on("style.load", () => {
          instance.setProjection(PROJECTION);
          if (bounds !== undefined) instance.fitBounds(...Object.values(fitOptions(bounds)).slice(0, 1), fitOptions(bounds));
        });
```

That spelling is deliberately awkward — **do not use it.** `fitBounds` takes bounds and options as two arguments, so destructure instead:

```ts
        instance.on("style.load", () => {
          instance.setProjection(PROJECTION);
          if (bounds !== undefined) {
            const { bounds: box, ...camera } = fitOptions(bounds);
            instance.fitBounds(box, camera);
          }
        });
```

Then delete `export type Bbox = …` from this file and import it from `@/lib/map/view`, and update `trip-map.tsx:7` to import `Bbox` from `@/lib/map/view` too. `grep -rn "Bbox" components app lib` must show no other importer.

The existing cases already assert `fitted` equals `{ bounds: [[w,s],[e,n]], options: { padding: 32, animate: false } }` and that `projections` equals `[{ type: "mercator" }]`. **They must keep passing unchanged** — if either moves, `fitOptions`/`PROJECTION` disagree with what stage 2 shipped and the mismatch is the finding.

- [ ] **Step 4: Confirm nothing else reads the return**

`trip-map.tsx` calls `useMapInstance({...})` and discards the result; it keeps discarding it in this task — Task 7 is what consumes it. Confirm with `grep -rn "useMapInstance" components app lib`.

- [ ] **Step 5: Run it and watch it pass**

Run: `npx vitest run components/public/trip-map` — expected: PASS, 13 cases in the hook file.

- [ ] **Step 6: Prove the invariant still holds**

The bbox-identity case is the "never remounted" invariant's only mechanical defence, and stage 2 found the plan's original version of it vacuous. Re-run the mutation that proves it still bites:

```sh
cp components/public/trip-map/hooks/use-map-instance.ts /tmp/hook.bak
sed -i '' 's|}, \[active, container\]);|}, [active, container, bbox]);|' components/public/trip-map/hooks/use-map-instance.ts
grep -q 'active, container, bbox' components/public/trip-map/hooks/use-map-instance.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts
cp /tmp/hook.bak components/public/trip-map/hooks/use-map-instance.ts
npx vitest run components/public/trip-map/hooks/use-map-instance.test.ts
```

Expected: the bbox-identity case reddens, then passes again. **If it stays green, stop** — the widening has broken the one case that guards the invariant, and that is a finding, not a nuisance.

- [ ] **Step 7: Run the checks and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
npm run build
npm run size:public
```

`size:public` must still report `maplibre-gl absent`, and `findLazyChunks` must still find the chunk present and unreferenced. **If either moves, stop and report.**

```sh
git add components/public/trip-map lib/map/view.ts
git commit -m "useMapInstance hands back the instance, not only its status

Stage 2 deliberately returned a status alone and wrote down that stage 3 would
widen it here rather than reaching into the ref from the component. The instance
goes into state because it is created inside a promise callback: a ref alone is
null on the render where a caller needs it and never triggers another.

The creation effect's dependency array is untouched, and the bbox-identity case
was re-run under mutation to confirm the invariant's only mechanical defence
still bites after the widening."
```

---

### Task 5: `use-map-layers.ts` — two sources, four layers, updated in place

**This is where the invariant is easiest to break.** The map is created once; sources and layers must be added once, after the style has loaded, and their **data** updated on every entries change. Removing and re-adding a source on each render would not remount the map but would tear down the route and flash it, which is the same failure one level down.

**Order matters and is fixed by §6:** casing under line, both under the cluster circles. MapLibre draws in insertion order, so add them in that order and never rely on `beforeId`.

**Files:**
- Create: `components/public/trip-map/hooks/use-map-layers.ts`
- Create: `components/public/trip-map/hooks/use-map-layers.test.ts`
- Modify: `lib/map/notes.md` — why leaves are HTML and clusters are GL

**Interfaces:**
- Consumes: `buildPoints` (Task 1), `buildLegs` (Task 2), `DASH_BY_MODE`, `shouldCluster`, `ROUTE_WIDTH`, `CASING_EXTRA` (Task 3), `MAP_COLORS` from `@/lib/map/tokens`.
- Produces:
  - `POINTS_SOURCE = "trip-points"`, `LEGS_SOURCE = "trip-legs"`
  - `LAYERS = { casing: "trip-route-casing", line: "trip-route-line", clusters: "trip-clusters", clusterCount: "trip-cluster-count" }`
  - `useMapLayers(map: MapLibreMap | null, entries: IndexEntry[]): void`

- [ ] **Step 1: Write the failing test**

Create `components/public/trip-map/hooks/use-map-layers.test.ts`. A fake map, because jsdom has no WebGL:

```ts
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LAYERS, LEGS_SOURCE, POINTS_SOURCE, useMapLayers } from "./use-map-layers";
import type { IndexEntry } from "@/lib/pod/schema";

class FakeSource {
  data: unknown = null;
  setData(next: unknown) {
    this.data = next;
  }
}

class FakeMap {
  readonly sources = new Map<string, FakeSource>();
  readonly added: string[] = [];
  readonly sourceOptions: Record<string, Record<string, unknown>> = {};
  loaded = true;
  isStyleLoaded() {
    return this.loaded;
  }
  addSource(id: string, options: Record<string, unknown>) {
    this.sources.set(id, new FakeSource());
    this.sourceOptions[id] = options;
  }
  getSource(id: string) {
    return this.sources.get(id);
  }
  addLayer(layer: { id: string }) {
    this.added.push(layer.id);
  }
  getLayer(id: string) {
    return this.added.includes(id) ? { id } : undefined;
  }
  on() {
    return this;
  }
  off() {
    return this;
  }
}

function entry(slug: string, over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    iri: `https://pod.example/e#${slug}`,
    entryResource: `https://pod.example/${slug}.ttl`,
    title: { value: slug, language: "en" },
    slug,
    lat: 1,
    long: 1,
    sortOrder: 1,
    ...over,
  };
}

let map: FakeMap;
beforeEach(() => {
  map = new FakeMap();
});

describe("useMapLayers", () => {
  it("does nothing at all without a map, rather than throwing", () => {
    expect(() => renderHook(() => useMapLayers(null, [entry("a")]))).not.toThrow();
  });

  it("adds both sources and all four layers once the map is there", () => {
    renderHook(() => useMapLayers(map as never, [entry("a"), entry("b", { sortOrder: 2 })]));
    expect([...map.sources.keys()].sort()).toEqual([LEGS_SOURCE, POINTS_SOURCE].sort());
    expect(map.added).toEqual([LAYERS.casing, LAYERS.line, LAYERS.clusters, LAYERS.clusterCount]);
  });

  it("draws the casing before the line, because insertion order is paint order", () => {
    renderHook(() => useMapLayers(map as never, [entry("a")]));
    expect(map.added.indexOf(LAYERS.casing)).toBeLessThan(map.added.indexOf(LAYERS.line));
  });

  it("updates data in place on a rerender instead of re-adding the source", () => {
    const { rerender } = renderHook(({ e }: { e: IndexEntry[] }) => useMapLayers(map as never, e), {
      initialProps: { e: [entry("a")] },
    });
    const before = map.getSource(POINTS_SOURCE);
    rerender({ e: [entry("a"), entry("b", { sortOrder: 2 })] });
    expect(map.getSource(POINTS_SOURCE)).toBe(before);
    expect(map.added).toHaveLength(4);
  });

  it("clusters only above the threshold", () => {
    const many = Array.from({ length: 51 }, (_, i) => entry(`e${i}`, { sortOrder: i }));
    renderHook(() => useMapLayers(map as never, many));
    expect(map.sourceOptions[POINTS_SOURCE].cluster).toBe(true);
  });

  it("does not cluster a small trip", () => {
    renderHook(() => useMapLayers(map as never, [entry("a")]));
    expect(map.sourceOptions[POINTS_SOURCE].cluster).toBe(false);
  });

  it("waits for the style rather than adding sources to a map that has none", () => {
    map.loaded = false;
    renderHook(() => useMapLayers(map as never, [entry("a")]));
    expect(map.sources.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `npx vitest run components/public/trip-map/hooks/use-map-layers.test.ts` — expected: FAIL on an unresolved import of `./use-map-layers`.

- [ ] **Step 3: Write it**

Create `components/public/trip-map/hooks/use-map-layers.ts`:

```ts
"use client";

import { useEffect } from "react";
import { DASH_BY_MODE } from "@/lib/map/dashes";
import { buildLegs } from "@/lib/map/legs";
import { buildPoints } from "@/lib/map/points";
import { MAP_COLORS } from "@/lib/map/tokens";
import { CASING_EXTRA, ROUTE_WIDTH, shouldCluster } from "@/lib/map/view";
import type { IndexEntry } from "@/lib/pod/schema";

type MapLibreMap = import("maplibre-gl").Map;

export const POINTS_SOURCE = "trip-points";
export const LEGS_SOURCE = "trip-legs";

export const LAYERS = {
  casing: "trip-route-casing",
  line: "trip-route-line",
  clusters: "trip-clusters",
  clusterCount: "trip-cluster-count",
} as const;

export function useMapLayers(map: MapLibreMap | null, entries: IndexEntry[]): void {
  useEffect(() => {
    if (map === null || !map.isStyleLoaded()) return;

    const points = buildPoints(entries);
    const legs = buildLegs(entries);

    const pointsSource = map.getSource(POINTS_SOURCE);
    if (pointsSource === undefined) {
      addAll(map, points, legs, shouldCluster(points.features.length));
      return;
    }
    // Data in place, never a re-add: re-adding would flash the route away.
    (pointsSource as { setData: (d: unknown) => void }).setData(points);
    (map.getSource(LEGS_SOURCE) as { setData: (d: unknown) => void } | undefined)?.setData(legs);
  }, [map, entries]);
}

function addAll(map: MapLibreMap, points: unknown, legs: unknown, cluster: boolean): void {
  map.addSource(LEGS_SOURCE, { type: "geojson", data: legs } as never);
  map.addSource(POINTS_SOURCE, { type: "geojson", data: points, cluster, clusterRadius: 60 } as never);

  map.addLayer({
    id: LAYERS.casing,
    type: "line",
    source: LEGS_SOURCE,
    paint: { "line-color": MAP_COLORS.accentDeep, "line-width": ROUTE_WIDTH + CASING_EXTRA },
  } as never);
  map.addLayer({
    id: LAYERS.line,
    type: "line",
    source: LEGS_SOURCE,
    paint: { "line-color": MAP_COLORS.accent, "line-width": ROUTE_WIDTH, "line-dasharray": DASH_BY_MODE },
  } as never);
  map.addLayer({
    id: LAYERS.clusters,
    type: "circle",
    source: POINTS_SOURCE,
    filter: ["has", "point_count"],
    paint: { "circle-color": MAP_COLORS.accentDeep, "circle-radius": 18 },
  } as never);
  map.addLayer({
    id: LAYERS.clusterCount,
    type: "symbol",
    source: POINTS_SOURCE,
    filter: ["has", "point_count"],
    layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
  } as never);
}
```

`MAP_COLORS.accent` (`#1295FC`) and `MAP_COLORS.accentDeep` (`#034F8A`) are the real key names, verified against `lib/map/tokens.ts` on 2026-09-11.

**`addAll` will be near the `lib/**` 50-line tendency but is a `components/` file**, so the 130/200 bounds apply. Do not split it to chase a number that does not bind it.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run components/public/trip-map/hooks/use-map-layers.test.ts` — expected: PASS, 7 cases.

- [ ] **Step 5: Prove three of them are not vacuous**

```sh
cp components/public/trip-map/hooks/use-map-layers.ts /tmp/layers.bak

# 1. Re-add instead of setData — the flash this hook exists to avoid.
sed -i '' 's|if (pointsSource === undefined) {|if (true) {|' components/public/trip-map/hooks/use-map-layers.ts
grep -q 'if (true) {' components/public/trip-map/hooks/use-map-layers.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run components/public/trip-map/hooks/use-map-layers.test.ts   # expect: the in-place case reddens
cp /tmp/layers.bak components/public/trip-map/hooks/use-map-layers.ts

# 2. Casing after the line — the paint-order bug.
python3 - <<'PY'
import re,io
p="components/public/trip-map/hooks/use-map-layers.ts"
s=io.open(p).read()
casing=s[s.index("  map.addLayer({\n    id: LAYERS.casing"):s.index("  map.addLayer({\n    id: LAYERS.line")]
line=s[s.index("  map.addLayer({\n    id: LAYERS.line"):s.index("  map.addLayer({\n    id: LAYERS.clusters")]
io.open(p,"w").write(s.replace(casing+line, line+casing))
PY
npx vitest run components/public/trip-map/hooks/use-map-layers.test.ts   # expect: the paint-order case reddens
cp /tmp/layers.bak components/public/trip-map/hooks/use-map-layers.ts

# 3. Cluster always on.
sed -i '' 's|shouldCluster(points.features.length)|true|' components/public/trip-map/hooks/use-map-layers.ts
grep -q 'legs, true)' components/public/trip-map/hooks/use-map-layers.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run components/public/trip-map/hooks/use-map-layers.test.ts   # expect: the small-trip case reddens
cp /tmp/layers.bak components/public/trip-map/hooks/use-map-layers.ts

npx vitest run components/public/trip-map/hooks/use-map-layers.test.ts   # 7 passed again
```

- [ ] **Step 6: Write the note, run the checks, commit**

Append to `lib/map/notes.md` a `## Why leaves are HTML and clusters are GL` section: a thumbnail is a Pod URL and `map.addImage` needs a CORS-loaded bitmap where an `<img>` needs nothing, and `dy:precisionMeters` → pin versus soft circle is a CSS distinction. Keep it under six lines of prose per paragraph and do not restate §6.

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

```sh
git add components/public/trip-map lib/map/notes.md
git commit -m "Two sources and four layers, added once and updated in place

The map is created once and must stay created, so this hook adds sources on the
first style-loaded render and thereafter calls setData. Re-adding a source on
every entries change would not remount the map but would tear down the route and
flash it — the same failure one level down, and the case that catches it was
watched failing.

Casing is inserted before the line because MapLibre paints in insertion order,
which is cheaper to keep right than a beforeId that has to name a layer that may
not exist yet."
```

---

### Task 6: the markers — a DOM factory and a reconciler

**Leaves are HTML, clusters are GL, and the reason is in §6.** A thumbnail is a Pod URL: `<img>` loads it with no CORS dance, `map.addImage` cannot. And `dy:precisionMeters` → pin versus soft circle is a CSS distinction, which is what the design brief asks for when it says the typography should tell the truth about the data.

**The marker is a DOM element, not a React component, and that is a layout rule rather than a preference.** `componentFoldersAreOwn()` forbids a second `.tsx` in `components/public/trip-map/`, and a marker in its own component folder would then need a React root per marker. A DOM factory in `lib/map/` is smaller, has no roots to tear down, and keeps `lib/` React-free — building an element is not React.

**Reconciliation is by `slug`, and it must be idempotent.** `sourcedata` and `moveend` both fire more often than the leaf set changes; an implementation that adds on every event leaks a marker per event.

**Files:**
- Create: `lib/map/marker-element.ts`, `lib/map/marker-element.test.ts`
- Create: `components/public/trip-map/hooks/use-map-markers.ts`, `components/public/trip-map/hooks/use-map-markers.test.ts`

**Interfaces:**
- Consumes: `PointProps` from `@/lib/map/points`; `POINTS_SOURCE` from `./use-map-layers`.
- Produces:
  - `buildMarkerElement(props: PointProps): HTMLElement`
  - `useMapMarkers(map: MapLibreMap | null): void`

- [ ] **Step 1: Write the failing tests**

Create `lib/map/marker-element.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildMarkerElement } from "@/lib/map/marker-element";

const base = { slug: "arrival", title: "Arrival", sortOrder: 1 };

describe("buildMarkerElement", () => {
  it("labels itself for a screen reader with the entry's title", () => {
    expect(buildMarkerElement(base).getAttribute("aria-label")).toBe("Arrival");
  });

  it("shows a skeleton and no image when the entry has no thumbnail", () => {
    const el = buildMarkerElement(base);
    expect(el.querySelector("img")).toBeNull();
    expect(el.className).toContain("bg-surface");
  });

  it("renders an image when there is a thumbnail, still over the skeleton", () => {
    const el = buildMarkerElement({ ...base, thumbnail: "https://pod.example/t.jpg" });
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toBe("https://pod.example/t.jpg");
    expect(el.className).toContain("bg-surface");
  });

  it("marks a fuzzed coordinate differently from an exact one, because the shape is the claim", () => {
    const exact = buildMarkerElement(base).className;
    const fuzzed = buildMarkerElement({ ...base, precisionMeters: 5000 }).className;
    expect(fuzzed).not.toBe(exact);
  });

  it("carries the slug, so the reconciler can match it", () => {
    expect(buildMarkerElement(base).dataset.slug).toBe("arrival");
  });

  it("uses no arbitrary Tailwind values, which the guardrail bans outside components/ui", () => {
    expect(buildMarkerElement({ ...base, precisionMeters: 5000 }).className).not.toMatch(/\[[^\]]+\]/);
  });
});
```

Create `components/public/trip-map/hooks/use-map-markers.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMapMarkers } from "./use-map-markers";

const markers: FakeMarker[] = [];

class FakeMarker {
  element: HTMLElement | null = null;
  lngLat: unknown = null;
  removed = 0;
  constructor(readonly options: { element?: HTMLElement }) {
    this.element = options.element ?? null;
    markers.push(this);
  }
  setLngLat(value: unknown) {
    this.lngLat = value;
    return this;
  }
  addTo() {
    return this;
  }
  remove() {
    this.removed += 1;
  }
}

vi.mock("maplibre-gl", () => ({ Marker: FakeMarker }));

type Feature = { properties: Record<string, unknown>; geometry: { coordinates: [number, number] } };

class FakeMap {
  features: Feature[] = [];
  readonly handlers = new Map<string, (() => void)[]>();
  querySourceFeatures() {
    return this.features;
  }
  on(event: string, handler: () => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  off(event: string, handler: () => void) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
    return this;
  }
  emit(event: string) {
    for (const handler of this.handlers.get(event) ?? []) handler();
  }
}

function leaf(slug: string): Feature {
  return { properties: { slug, title: slug, sortOrder: 1 }, geometry: { coordinates: [1, 2] } };
}

let map: FakeMap;
beforeEach(() => {
  markers.length = 0;
  map = new FakeMap();
});

describe("useMapMarkers", () => {
  it("does nothing without a map, rather than throwing", () => {
    expect(() => renderHook(() => useMapMarkers(null))).not.toThrow();
    expect(markers).toHaveLength(0);
  });

  it("adds one marker per leaf", async () => {
    map.features = [leaf("a"), leaf("b")];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(2));
  });

  it("ignores a cluster feature, which the GL layer draws instead", async () => {
    map.features = [leaf("a"), { properties: { point_count: 7 }, geometry: { coordinates: [0, 0] } }];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(1));
  });

  it("does not add a second marker for a slug it already has", async () => {
    map.features = [leaf("a")];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(1));
    map.emit("moveend");
    map.emit("sourcedata");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(markers).toHaveLength(1);
  });

  it("removes a marker whose leaf has gone", async () => {
    map.features = [leaf("a"), leaf("b")];
    renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(2));
    map.features = [leaf("a")];
    map.emit("moveend");
    await waitFor(() => expect(markers.filter((m) => m.removed > 0)).toHaveLength(1));
  });

  it("removes every marker on unmount, so a navigation does not leak them", async () => {
    map.features = [leaf("a"), leaf("b")];
    const { unmount } = renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(2));
    unmount();
    expect(markers.every((m) => m.removed === 1)).toBe(true);
  });

  it("stops listening on unmount", async () => {
    map.features = [leaf("a")];
    const { unmount } = renderHook(() => useMapMarkers(map as never));
    await waitFor(() => expect(markers).toHaveLength(1));
    unmount();
    expect(map.handlers.get("moveend") ?? []).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run them and watch them fail for the right reason**

Run: `npx vitest run lib/map/marker-element.test.ts components/public/trip-map/hooks/use-map-markers.test.ts`

Expected: FAIL on unresolved imports. Not assertion failures.

- [ ] **Step 3: Write the element factory**

Create `lib/map/marker-element.ts`:

```ts
import type { PointProps } from "@/lib/map/points";

const BASE = "size-10 overflow-hidden border-2 border-accent bg-surface";
/** A fuzzed coordinate is a circle, an exact one a pin: the shape is the claim
 *  the data makes. docs/design-brief.md, and lib/place/precision.ts owns the
 *  matching decimal count. */
const EXACT = "rounded-sm";
const FUZZED = "rounded-full opacity-80";

export function buildMarkerElement({ slug, title, thumbnail, precisionMeters }: PointProps): HTMLElement {
  const el = document.createElement("div");
  el.className = `${BASE} ${precisionMeters === undefined ? EXACT : FUZZED}`;
  el.dataset.slug = slug;
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", title);

  if (thumbnail !== undefined) {
    const img = document.createElement("img");
    img.src = thumbnail;
    img.alt = "";
    img.loading = "lazy";
    img.className = "size-full object-cover";
    el.append(img);
  }
  return el;
}
```

The skeleton is `bg-surface` on the container, which the image covers when it paints — decision §29, no blur data.

- [ ] **Step 4: Write the reconciler**

Create `components/public/trip-map/hooks/use-map-markers.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import { buildMarkerElement } from "@/lib/map/marker-element";
import type { PointProps } from "@/lib/map/points";
import { POINTS_SOURCE } from "./use-map-layers";

type MapLibreMap = import("maplibre-gl").Map;
type MapLibreMarker = import("maplibre-gl").Marker;

export function useMapMarkers(map: MapLibreMap | null): void {
  const markers = useRef(new Map<string, MapLibreMarker>());

  useEffect(() => {
    if (map === null) return;
    const live = markers.current;
    let cancelled = false;

    // sourcedata and moveend fire far more often than the leaf set changes, so
    // this reconciles by slug rather than rebuilding.
    const reconcile = (Marker: typeof import("maplibre-gl").Marker) => () => {
      const leaves = map
        .querySourceFeatures(POINTS_SOURCE)
        .filter((f) => f.properties?.point_count === undefined);
      const seen = new Set<string>();

      for (const feature of leaves) {
        const props = feature.properties as unknown as PointProps;
        seen.add(props.slug);
        if (live.has(props.slug)) continue;
        const marker = new Marker({ element: buildMarkerElement(props) })
          .setLngLat((feature.geometry as { coordinates: [number, number] }).coordinates)
          .addTo(map);
        live.set(props.slug, marker);
      }

      for (const [slug, marker] of live) {
        if (seen.has(slug)) continue;
        marker.remove();
        live.delete(slug);
      }
    };

    let handler: (() => void) | null = null;
    void import("maplibre-gl").then(({ Marker }) => {
      if (cancelled) return;
      handler = reconcile(Marker);
      map.on("moveend", handler);
      map.on("sourcedata", handler);
      handler();
    });

    return () => {
      cancelled = true;
      if (handler !== null) {
        map.off("moveend", handler);
        map.off("sourcedata", handler);
      }
      for (const marker of live.values()) marker.remove();
      live.clear();
    };
  }, [map]);
}
```

**`Marker` comes from `await import("maplibre-gl")` inside the effect — never a static import.** The fence refuses one, and a static import here would put 252.8 kB in the eager chunk.

- [ ] **Step 5: Run them and watch them pass**

Run: `npx vitest run lib/map components/public/trip-map` — expected: PASS, 6 element cases plus 7 reconciler cases.

- [ ] **Step 6: Prove three of them are not vacuous**

```sh
cp lib/map/marker-element.ts /tmp/marker.bak
# Same class either way — the precision distinction the brief asks for, gone.
sed -i '' 's|const FUZZED = "rounded-full opacity-80";|const FUZZED = "rounded-sm";|' lib/map/marker-element.ts
grep -q 'const FUZZED = "rounded-sm"' lib/map/marker-element.ts || { echo "SED DID NOT APPLY — stop"; exit 1; }
npx vitest run lib/map/marker-element.test.ts   # expect: the precision case reddens
cp /tmp/marker.bak lib/map/marker-element.ts
```

Then, in the reconciler: make the add path unconditional (drop the "is this slug already present" check) and confirm the no-duplicate case reddens; and drop the unmount cleanup and confirm the leak case reddens. Guard both the same way.

- [ ] **Step 7: Run the checks and commit**

```sh
npx vitest run
npm run lint
npm run typecheck
npm run check:structure
```

```sh
git add lib/map components/public/trip-map
git commit -m "Leaves are HTML markers, reconciled by slug and idempotent

A thumbnail is a Pod URL: an img element loads it with no CORS dance where
map.addImage needs a bitmap it cannot get. So GL draws the cluster circles and
HTML draws the leaves, which is also what makes precisionMeters a CSS
distinction — a fuzzed coordinate is a circle, an exact one a pin.

The marker is a DOM element rather than a React component because a second .tsx
cannot live in this component's folder, and a component folder of its own would
mean a React root per marker. Reconciliation keys on slug and is idempotent:
sourcedata and moveend fire far more often than the leaf set changes, and an
add-on-every-event implementation leaks a marker per event — watched failing."
```

---

### Task 7: wire it through, and one browser case

**Files:**
- Modify: `components/public/trip-map/trip-map.tsx` — accept `entries`, call the two hooks
- Modify: `components/public/trip-map/trip-map.test.tsx` — the prop reaches the hooks
- Modify: `app/(public)/trips/[slug]/layout.tsx` — pass `index.value.entries`
- Modify: `e2e/trip-map.spec.ts` — one case
- Modify: `docs/decisions.md` (§30), `TODO.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `TripMap(props: { bbox?: Bbox; styleUrl?: string; entries?: IndexEntry[] })`.

- [ ] **Step 1: Write the failing tests**

In `trip-map.test.tsx`, mock the two new hooks and assert `TripMap` passes the entries through and still renders the same frame. **The markup must not branch on `active` or on `entries`** — that is the SSR trap stage 2 recorded. Add a case pinning it:

```tsx
  it("renders the same markup with and without entries, because the server has neither", () => {
    installObserver();
    const { container: a } = render(<TripMap />);
    const { container: b } = render(<TripMap entries={[]} />);
    expect(a.innerHTML).toBe(b.innerHTML);
  });
```

In the layout test, assert the entries reach `TripMap` on the resolved path.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run components/public/trip-map "app/(public)/trips"`

- [ ] **Step 3: Wire it**

`trip-map.tsx` takes `entries = []`, calls `const { map } = useMapInstance({...})`, then `useMapLayers(map, entries)` and `useMapMarkers(map)`. The returned JSX is unchanged.

`layout.tsx` passes `entries={index.ok ? index.value.entries : undefined}` alongside the bbox it already passes.

- [ ] **Step 4: Run them and watch them pass**

- [ ] **Step 5: Add the browser case**

Append to `e2e/trip-map.spec.ts` one case: after the canvas appears, a marker element exists with a `data-slug`. **Do not assert the route line** — a GL line is drawn into the canvas and is not queryable from the DOM; asserting it would be an assertion that cannot fail, which this plan's stage-2 predecessor produced four of. If you want the route covered in a browser, the honest form is a screenshot comparison, and that is not in this stage's scope. Say which you did.

Keep the tile stubbing exactly as stage 2 left it: the TileJSON metadata URL is **fulfilled locally**, everything else under the tile host aborted. A blanket abort breaks the attribution the spec requires.

- [ ] **Step 6: Run the e2e suite**

```sh
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
```

Expected: 9 pre-existing plus your new case. Report the actual count.

- [ ] **Step 7: Prove the browser case can fail**

Guarded, and note there are two `setActive(true)` calls — the fallback is not the one you want:

```sh
cp components/public/trip-map/trip-map.tsx /tmp/tm.bak
sed -i '' 's|if (entries.some((entry) => entry.isIntersecting)) setActive(true);||' components/public/trip-map/trip-map.tsx
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e   # expect: the canvas and marker cases fail
cp /tmp/tm.bak components/public/trip-map/trip-map.tsx
```

- [ ] **Step 8: Record the decision and the stage**

Append `docs/decisions.md` §30 — markers are HTML and clusters are GL, why the marker is a DOM element rather than a component, and the cluster threshold. Tick `TODO.md`'s stage-3 deliverable with what landed and what stage 4 inherits.

**Offer the e2e-gate question, do not implement it.** §28 says `components/public/**` and `lib/map/**` join the gate globs "when stage 3's markers land". They have now landed. **Put it to the owner in your report and leave the globs alone** — the decision is theirs, and stage 2 already recorded that.

- [ ] **Step 9: Run the whole definition of done, unchained, and read every log**

```sh
node -v
npm test
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure
npm run build
npm run size:public
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
TEST_POD=http://localhost:3999 npm test
```

`size:public` must still report `maplibre-gl absent` **and** `findLazyChunks` must still find the chunk present and unreferenced. The dead-port run's passed count must drop by 36 with both `test/integration/` files skipped. **Record both counts. Do not predict either.**

- [ ] **Step 10: Commit**

```sh
git add components app docs e2e TODO.md
git commit -m "Markers and the route reach the map, and one browser case sees a marker

TripMap takes entries and hands them to the layers and markers hooks; the layout
passes what the index already read. The returned markup is identical with and
without entries, because it must be: the lazy activation initializer returns
true on the server and false on the client, so any JSX that branches on that
state is a hydration mismatch rather than a rendering choice.

The browser case asserts a marker element, not the route line: a GL line is
painted into the canvas and is not queryable from the DOM, so asserting it would
be an assertion that cannot fail."
```

---

## Done when

- `buildPoints` and `buildLegs` are pure, tested without a map, and **watched failing** on the coordinate order, the zero coordinate, the mode-from-destination rule and the no-mutation rule.
- Entries with no coordinate drop out of **both** points and legs, and a placeless entry mid-trip joins its neighbours rather than splitting the route — with a case for it.
- `DASH_BY_MODE` is accepted by `validateStyleMin` inside a real line layer, and its mode coverage is derived from `TravelMode.options` rather than a typed list, so a ninth mode reddens here instead of silently drawing the fallback. **Watched failing by deleting a mode.**
- `useMapInstance` returns `{ status, map }`; the creation effect's dependency array is unchanged and **the bbox-identity case was re-run under mutation** to confirm the "never remounted" invariant's only mechanical defence still bites.
- Sources and layers are added once and updated with `setData`; re-adding on every change was **watched reddening** the in-place case. Casing is inserted before the line.
- Clustering is on only above 50 points, with cases at the boundary in both directions.
- Markers are reconciled by slug, idempotent across repeated `sourcedata`/`moveend`, and removed on unmount — the duplicate and leak cases both **watched failing**.
- Marker classes contain no arbitrary Tailwind values, asserted by a case rather than by reading.
- `TripMap`'s markup is byte-identical with and without `entries`, so the SSR-vs-client activation state cannot become a hydration mismatch.
- `setProjection` still has exactly one call site, and `test/guardrails.test.ts` still passes unchanged.
- `size:public` still reports `maplibre-gl absent`, and `findLazyChunks` still reports the chunk present and unreferenced.
- The e2e suite passes with tiles stubbed the way stage 2 left them, and the new case was **watched failing** with activation disabled.
- All ten definition-of-done commands pass, each run separately and each log read, plus `test:e2e`. The dead-port control shows the count dropping by 36 with both integration files skipped.
- `docs/decisions.md` §30 exists; `TODO.md` ticks the deliverable.
- **The e2e-gate question is put to the owner and not implemented.**

## What stage 4 needs from this

- `orderEntries` is exported from `lib/map/legs.ts` and is the one ordering. The timeline must use it rather than sorting again, or the map and the list will disagree on a `sortOrder` tie.
- `useMapMarkers` owns the marker DOM. Bidirectional highlighting needs a handle on those elements — widen its return to the `Map<string, Marker>` there rather than querying the document.
- The marker element carries `data-slug`, which is the join key for highlighting.
- `LAYERS` names all four layer ids; a highlight layer must not reuse one.
- The drawer keeps the map mounted throughout, which the layout already guarantees — do not move the map into the drawer.

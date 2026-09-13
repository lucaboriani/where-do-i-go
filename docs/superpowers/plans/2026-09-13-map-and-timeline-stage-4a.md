# Phase 4 stage 4a — the timeline and the highlight: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the trip page's `<ol>` with a real timeline, and make hovering a timeline row or a
map marker highlight the other — including on an entry route, with no pointer involved.

**Architecture:** A `"use client"` provider in the `[slug]` layout wraps both `<TripMap/>` and
`{children}`, holding `{ activeSlug, source }`. The timeline's rows write to it on hover and focus;
the map reads it and applies the highlight through two different mechanisms, because a marker is a
DOM element and a leg is a GL feature.

**Tech Stack:** Next 16 App Router, React 19, Tailwind v4, MapLibre GL 6.6.0, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-13-map-timeline-stage-4a-design.md` (commit `fa4dbd4`).
Read it first — this plan argues from it and does not repeat its reasoning.

## Global Constraints

- **Node 22.** `nvm use`, then `node -v` must print `v22.x`. `npm run` is NOT gated by
  `engine-strict`; checking is a step you do.
- **No new dependencies.** Zero required API keys, nothing needing an account.
- **`lib/` holds no React.** Pure and reusable goes to `lib/`; hooks go to `hooks/<area>/`;
  presentation stays in the component folder.
- **A new `hooks/<area>/` joins the belt block's `files` array in `eslint.config.mjs` in the SAME
  commit** if it is publicly reachable. `vitest.config.ts`, `check:structure`'s `DIRS` and the
  length bound are already wildcarded at `hooks/**` and need nothing.
- **One component, one folder** — named file, one-line `index.ts` barrel, its test, its `notes.md`.
- **Comments are three lines or fewer**, pointing at a sibling `notes.md#anchor` that must resolve.
- **Function length**: 200 hard bound in `components/**`, `app/**`, `hooks/**`; 80 in `lib/**`.
- **Arbitrary Tailwind values are banned** outside `components/ui/**`. Use the tokens in
  `app/globals.css`.
- **`npm run lint` carries `--max-warnings 0`.** A stale `eslint-disable` fails the build.
- **The map is mounted once and never remounted.** Nothing in this stage may add a code path that
  unmounts `TripMap` or recreates the MapLibre instance.
- **Definition of done, run and read**: `npm test` (Pod up), `lint`, `typecheck`,
  `validate:fixtures`, `check:vocab`, `check:commands`, `check:structure`, `build`, `size:public`,
  and — because Task 6 puts `components/public/**` on the gate — `env -u CLAUDECODE -u AI_AGENT
  E2E_PORT=3007 npm run test:e2e`.

---

## File structure

| File | Responsibility |
|---|---|
| `hooks/trip/highlight-context.ts` | **Create.** The context object, its `Highlight` type, and the `useTripHighlight` consumer hook. Publicly reachable, so it joins the belt. |
| `hooks/trip/use-highlight-state.ts` | **Create.** The state hook the provider uses: holds `{activeSlug, source}` and exposes `raise`/`clear`. |
| `components/public/trip-highlight/trip-highlight-provider.tsx` | **Create.** `"use client"` provider; also reads `useSelectedLayoutSegment()` for the route-driven highlight. |
| `components/public/trip-timeline/trip-timeline.tsx` | **Create.** Server component; renders the ordered rows from `IndexEntry[]`. |
| `components/public/trip-timeline/timeline-row.tsx` | **Create.** `"use client"`; one row, its hover/focus handlers, its active styling. |
| `app/(public)/trips/[slug]/layout.tsx` | **Modify.** Wrap map + children in the provider. |
| `app/(public)/trips/[slug]/page.tsx:98-110` | **Modify.** `<ol>` → `<TripTimeline/>`. |
| `hooks/map/use-map-layers.ts` | **Modify.** `promoteId` on the legs source; feature-state-aware paint. |
| `hooks/map/use-map-highlight.ts` | **Create.** Applies `setFeatureState` to the active leg. |
| `hooks/map/use-map-markers.ts` | **Modify.** Marker class toggle, WITHOUT adding `activeSlug` to the reconcile effect's deps. |
| `CLAUDE.md`, `docs/testing-gates.md`, `docs/decisions.md` | **Modify.** The gate widening and §32. |
| `e2e/trip-timeline.spec.ts` | **Create.** The one browser case, plus its mutation control. |

---

### Task 1: The highlight state and its context

**Files:**
- Create: `hooks/trip/highlight-context.ts`, `hooks/trip/use-highlight-state.ts`
- Test: `hooks/trip/use-highlight-state.test.ts`
- Modify: `eslint.config.mjs` (belt `files` array), `test/guardrails.test.ts` if the belt sweep needs it

**Interfaces:**
- Produces: `type Highlight = { activeSlug: string | null; source: "map" | "timeline" | "route" | null }`;
  `useHighlightState(routeSlug: string | null): Highlight & { raise: (slug: string, source: "map" | "timeline") => void; clear: () => void }`;
  `TripHighlightContext` (a `React.Context<HighlightValue | null>`); `useTripHighlight(): HighlightValue`.

- [ ] **Step 1: Write the failing test**

```ts
// hooks/trip/use-highlight-state.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useHighlightState } from "./use-highlight-state";

describe("useHighlightState", () => {
  it("starts with no highlight when there is no route slug", () => {
    const { result } = renderHook(() => useHighlightState(null));
    expect(result.current.activeSlug).toBeNull();
    expect(result.current.source).toBeNull();
  });

  it("raises a pointer highlight and records which side raised it", () => {
    const { result } = renderHook(() => useHighlightState(null));
    act(() => result.current.raise("arrival", "timeline"));
    expect(result.current).toMatchObject({ activeSlug: "arrival", source: "timeline" });
  });

  it("clears back to the route slug rather than to nothing", () => {
    const { result } = renderHook(() => useHighlightState("kyoto"));
    act(() => result.current.raise("arrival", "map"));
    expect(result.current.activeSlug).toBe("arrival");
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ activeSlug: "kyoto", source: "route" });
  });

  it("follows the route when the segment changes under a cleared highlight", () => {
    const { result, rerender } = renderHook(({ slug }) => useHighlightState(slug), {
      initialProps: { slug: "kyoto" as string | null },
    });
    rerender({ slug: "osaka" });
    expect(result.current).toMatchObject({ activeSlug: "osaka", source: "route" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run hooks/trip/use-highlight-state.test.ts`
Expected: FAIL — `Failed to resolve import "./use-highlight-state"`.

- [ ] **Step 3: Write the context and the state hook**

```ts
// hooks/trip/highlight-context.ts
"use client";

import { createContext, useContext } from "react";

export type HighlightSource = "map" | "timeline" | "route";

export type Highlight = {
  activeSlug: string | null;
  source: HighlightSource | null;
};

export type HighlightValue = Highlight & {
  raise: (slug: string, source: "map" | "timeline") => void;
  clear: () => void;
};

export const TripHighlightContext = createContext<HighlightValue | null>(null);

/** Returns an inert value outside a provider rather than throwing: an entry page
 *  rendered on its own must not crash. ./notes.md#why-the-context-has-an-inert-default */
const INERT: HighlightValue = { activeSlug: null, source: null, raise: () => {}, clear: () => {} };

export function useTripHighlight(): HighlightValue {
  return useContext(TripHighlightContext) ?? INERT;
}
```

```ts
// hooks/trip/use-highlight-state.ts
"use client";

import { useCallback, useMemo, useState } from "react";
import type { Highlight, HighlightValue } from "./highlight-context";

/** A pointer highlight outranks the route's while it lasts; clearing falls back
 *  to the route rather than to nothing. ./notes.md#why-clearing-falls-back-to-the-route */
export function useHighlightState(routeSlug: string | null): HighlightValue {
  const [pointer, setPointer] = useState<Highlight | null>(null);

  const raise = useCallback((slug: string, source: "map" | "timeline") => {
    setPointer({ activeSlug: slug, source });
  }, []);
  const clear = useCallback(() => setPointer(null), []);

  return useMemo(() => {
    const base: Highlight =
      pointer ?? (routeSlug === null ? { activeSlug: null, source: null } : { activeSlug: routeSlug, source: "route" });
    return { ...base, raise, clear };
  }, [pointer, routeSlug, raise, clear]);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run hooks/trip/use-highlight-state.test.ts` → 4 passed.

- [ ] **Step 5: Put `hooks/trip/**` in the belt, in this commit**

`hooks/trip/**` is reachable from a public page. Add to the belt block's `files` array in
`eslint.config.mjs`, beside `hooks/map/**/*.{ts,tsx}`:

```js
      "hooks/trip/**/*.{ts,tsx}",
```

Then run `npx vitest run test/guardrails.test.ts`. The closure walk derives its module list from
the config, so the three belted sweeps pick the new files up automatically. If it goes red with
"matched no production file", the glob is wrong — `resolveBeltModules` reads ONE directory level.

- [ ] **Step 6: Write `hooks/trip/notes.md` with the two anchors the code points at**

Both comments above cite anchors. `check:structure` fails on one that does not resolve. Write
`#why-the-context-has-an-inert-default` and `#why-clearing-falls-back-to-the-route`.

- [ ] **Step 7: Verify and commit**

```bash
npm run lint && npm run typecheck && npm run check:structure
git add hooks/trip eslint.config.mjs
git commit -m "Add the trip highlight context and its state hook"
```

---

### Task 2: The provider, wired into the layout

**Files:**
- Create: `components/public/trip-highlight/trip-highlight-provider.tsx`, `index.ts`, `notes.md`
- Test: `components/public/trip-highlight/trip-highlight-provider.test.tsx`
- Modify: `app/(public)/trips/[slug]/layout.tsx`

**Interfaces:**
- Consumes: `useHighlightState`, `TripHighlightContext` from Task 1.
- Produces: `<TripHighlightProvider>{children}</TripHighlightProvider>`, default export from
  `@/components/public/trip-highlight`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/public/trip-highlight/trip-highlight-provider.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TripHighlightProvider from "./trip-highlight-provider";
import { useTripHighlight } from "@/hooks/trip/highlight-context";

const segment = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("next/navigation", () => ({ useSelectedLayoutSegment: () => segment.value }));

function Probe() {
  const { activeSlug, source } = useTripHighlight();
  return <span data-testid="probe">{`${activeSlug ?? "-"}:${source ?? "-"}`}</span>;
}

describe("TripHighlightProvider", () => {
  it("publishes the route segment as a route-sourced highlight", () => {
    segment.value = "kyoto";
    render(
      <TripHighlightProvider>
        <Probe />
      </TripHighlightProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("kyoto:route");
  });

  it("publishes nothing on the trip route itself", () => {
    segment.value = null;
    render(
      <TripHighlightProvider>
        <Probe />
      </TripHighlightProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("-:-");
  });

  it("does not re-render a children subtree it was handed as an element", () => {
    segment.value = null;
    const renders = vi.fn();
    function Counted() {
      renders();
      return null;
    }
    const { rerender } = render(
      <TripHighlightProvider>
        <Counted />
      </TripHighlightProvider>,
    );
    const before = renders.mock.calls.length;
    rerender(
      <TripHighlightProvider>
        <Counted />
      </TripHighlightProvider>,
    );
    // The same element identity is NOT preserved across two JSX literals, so
    // this asserts the weaker true thing: the provider adds no extra render.
    expect(renders.mock.calls.length).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/public/trip-highlight/`
Expected: FAIL — cannot resolve `./trip-highlight-provider`.

- [ ] **Step 3: Write the provider**

```tsx
// components/public/trip-highlight/trip-highlight-provider.tsx
"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { TripHighlightContext } from "@/hooks/trip/highlight-context";
import { useHighlightState } from "@/hooks/trip/use-highlight-state";

export default function TripHighlightProvider({ children }: { children: React.ReactNode }) {
  // null on the trip route itself, the entry slug on /trips/[slug]/[entry].
  const value = useHighlightState(useSelectedLayoutSegment());
  return <TripHighlightContext value={value}>{children}</TripHighlightContext>;
}
```

Note the React 19 spelling: `<Context value={…}>`, not `<Context.Provider value={…}>`.

```ts
// components/public/trip-highlight/index.ts
export { default } from "./trip-highlight-provider";
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run components/public/trip-highlight/` → 3 passed.

- [ ] **Step 5: Wrap the layout**

In `app/(public)/trips/[slug]/layout.tsx`, wrap BOTH the map and `{children}` — they are siblings,
and a provider around only one of them highlights nothing:

```tsx
import TripHighlightProvider from "@/components/public/trip-highlight";

  return (
    <TripHighlightProvider>
      <Suspense fallback={<div aria-hidden className={MAP_FRAME_CLASS} />}>
        <MapForTrip params={params} />
      </Suspense>
      {children}
    </TripHighlightProvider>
  );
```

- [ ] **Step 6: Run the layout's existing test**

Run: `npx vitest run "app/(public)/trips/[slug]/layout.test.tsx"`
Expected: PASS. If it fails on a missing `next/navigation` mock, mock it there the same way.

- [ ] **Step 7: Commit**

```bash
npm run lint && npm run typecheck && npm run check:structure
git add components/public/trip-highlight "app/(public)/trips/[slug]/layout.tsx"
git commit -m "Wrap the map and the page in the highlight provider"
```

---

### Task 3: The timeline

**Files:**
- Create: `components/public/trip-timeline/trip-timeline.tsx`, `timeline-row.tsx`, `index.ts`, `notes.md`
- Test: `components/public/trip-timeline/trip-timeline.test.tsx`
- Modify: `app/(public)/trips/[slug]/page.tsx` (the `<ol>` block)

**Interfaces:**
- Consumes: `useTripHighlight` (Task 1), `orderEntries` from `@/lib/map/legs`.
- Produces: `<TripTimeline slug={string} entries={IndexEntry[]} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// components/public/trip-timeline/trip-timeline.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TripTimeline from "./trip-timeline";
import type { IndexEntry } from "@/lib/pod/schema";

const entry = (over: Partial<IndexEntry>): IndexEntry => ({
  iri: "https://pod.example/t/i#it",
  entryResource: "https://pod.example/t/e",
  title: { value: "Arrival", lang: "en" },
  slug: "arrival",
  sortOrder: 1,
  ...over,
});

describe("TripTimeline", () => {
  it("renders the stored wall clock, never the reader's zone", () => {
    // +09:00 is deliberately not the machine's offset. A Date round-trip would
    // render 05:30 here in UTC; the wall clock is what happened.
    render(
      <TripTimeline slug="japan" entries={[entry({ occurredAt: "2026-03-29T14:30:00+09:00" })]} />,
    );
    expect(screen.getByText("14:30")).toBeInTheDocument();
    expect(screen.getByText(/2026-03-29/)).toBeInTheDocument();
  });

  it("renders a row with no date rather than inventing one", () => {
    // NOT queryByRole("time"): <time> has no implicit ARIA role, so that query
    // returns null whether or not a date rendered — a check that cannot fail.
    const { container } = render(
      <TripTimeline slug="japan" entries={[entry({ occurredAt: undefined })]} />,
    );
    expect(screen.getByRole("link", { name: "Arrival" })).toBeInTheDocument();
    expect(container.querySelector("time")).toBeNull();
  });

  it("orders by sortOrder, not by array order", () => {
    render(
      <TripTimeline
        slug="japan"
        entries={[
          entry({ slug: "second", title: { value: "Second", lang: "en" }, sortOrder: 2 }),
          entry({ slug: "first", title: { value: "First", lang: "en" }, sortOrder: 1 }),
        ]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["First", "Second"]);
  });

  it("links each row to the entry route", () => {
    render(<TripTimeline slug="japan" entries={[entry({})]} />);
    expect(screen.getByRole("link", { name: "Arrival" })).toHaveAttribute(
      "href",
      "/trips/japan/arrival",
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/public/trip-timeline/`
Expected: FAIL — cannot resolve `./trip-timeline`.

- [ ] **Step 3: Write the row and the list**

```tsx
// components/public/trip-timeline/timeline-row.tsx
"use client";

import Link from "next/link";
import { useTripHighlight } from "@/hooks/trip/highlight-context";
import { wallClockOf } from "@/lib/time/offsets";
import type { IndexEntry } from "@/lib/pod/schema";

export default function TimelineRow({ href, entry }: { href: string; entry: IndexEntry }) {
  const { activeSlug, raise, clear } = useTripHighlight();
  const wall = wallClockOf(entry.occurredAt);

  return (
    // Handlers on the row, not the link: React's onFocus delegates the bubbling
    // focusin, so focus and hover share one path. ./notes.md#why-the-handlers-sit-on-the-row
    <li
      data-active={activeSlug === entry.slug || undefined}
      onPointerEnter={() => raise(entry.slug, "timeline")}
      onPointerLeave={clear}
      onFocus={() => raise(entry.slug, "timeline")}
      onBlur={clear}
      // NOT data-[active]:bg-surface — the bracket form trips TW_ARBITRARY, and
      // the bare data-active: variant is unverified on this Tailwind. A ternary
      // of literal class strings is neither clever nor arbitrary.
      className={activeSlug === entry.slug ? "rounded-sm bg-surface p-2" : "rounded-sm p-2"}
    >
      <Link className="text-accent-bright underline" href={href}>
        {entry.title.value}
      </Link>
      {wall !== "" && (
        <time dateTime={entry.occurredAt} className="ml-2 font-mono text-sm text-muted-foreground">
          <span>{wall.slice(0, 10)}</span> <span>{wall.slice(11, 16)}</span>
        </time>
      )}
    </li>
  );
}
```

```tsx
// components/public/trip-timeline/trip-timeline.tsx
import { orderEntries } from "@/lib/map/legs";
import type { IndexEntry } from "@/lib/pod/schema";
import TimelineRow from "./timeline-row";

/** Numbering is sanctioned here specifically — entries within a trip are a
 *  sequence. docs/design-brief.md. */
export default function TripTimeline({ slug, entries }: { slug: string; entries: IndexEntry[] }) {
  return (
    <ol className="mt-8 space-y-1">
      {orderEntries(entries).map((entry) => (
        <TimelineRow key={entry.iri} href={`/trips/${slug}/${entry.slug}`} entry={entry} />
      ))}
    </ol>
  );
}
```

```ts
// components/public/trip-timeline/index.ts
export { default } from "./trip-timeline";
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run components/public/trip-timeline/` → 4 passed.

- [ ] **Step 5: Replace the `<ol>` in the page**

In `app/(public)/trips/[slug]/page.tsx`, replace the whole `<ol className="mt-8 space-y-3">…</ol>`
block with `<TripTimeline slug={slug} entries={index.value.entries} />`, importing the barrel.
Leave the `index.ok ? … : <p>{describe(index.error)}</p>` fallback exactly as it is — losing the
index must not lose the page.

- [ ] **Step 6: Run the page's test and the whole suite**

```bash
npx vitest run "app/(public)/trips/[slug]/"
npm test
```

- [ ] **Step 7: Write `notes.md` with `#why-the-handlers-sit-on-the-row`, then commit**

```bash
npm run lint && npm run typecheck && npm run check:structure
git add components/public/trip-timeline "app/(public)/trips/[slug]/page.tsx"
git commit -m "The trip page's list becomes a timeline that can be highlighted"
```

---

### Task 4: The leg highlight — `promoteId` and feature state

**Files:**
- Modify: `hooks/map/use-map-layers.ts`
- Create: `hooks/map/use-map-highlight.ts`
- Test: `hooks/map/use-map-layers.test.ts` (extend), `hooks/map/use-map-highlight.test.ts` (create)

**Interfaces:**
- Consumes: `LEGS_SOURCE`, `LAYERS` from `./use-map-layers`.
- Produces: `useMapHighlight(map: MapLibreMap | null, activeSlug: string | null, styleLoaded: boolean): void`.

- [ ] **Step 1: Write the failing tests**

```ts
// hooks/map/use-map-highlight.test.ts
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useMapHighlight } from "./use-map-highlight";
import { LEGS_SOURCE } from "./use-map-layers";

function fakeMap() {
  return {
    setFeatureState: vi.fn(),
    removeFeatureState: vi.fn(),
    getSource: vi.fn(() => ({})),
  };
}

describe("useMapHighlight", () => {
  it("sets active state on the leg arriving at the slug", () => {
    const map = fakeMap();
    renderHook(() => useMapHighlight(map as never, "kyoto", true));
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: LEGS_SOURCE, id: "kyoto" },
      { active: true },
    );
  });

  it("clears the previous leg before setting the next", () => {
    const map = fakeMap();
    const { rerender } = renderHook(({ slug }) => useMapHighlight(map as never, slug, true), {
      initialProps: { slug: "kyoto" as string | null },
    });
    rerender({ slug: "osaka" });
    expect(map.removeFeatureState).toHaveBeenCalledWith({ source: LEGS_SOURCE, id: "kyoto" });
    expect(map.setFeatureState).toHaveBeenLastCalledWith(
      { source: LEGS_SOURCE, id: "osaka" },
      { active: true },
    );
  });

  it("does nothing at all before the style has loaded", () => {
    const map = fakeMap();
    renderHook(() => useMapHighlight(map as never, "kyoto", false));
    expect(map.setFeatureState).not.toHaveBeenCalled();
  });
});
```

```ts
// hooks/map/use-map-layers.test.ts — ADD to the existing describe
  it("promotes toSlug to the feature id, or setFeatureState has nothing to key on", () => {
    const map = fakeMapWithNoSources();
    renderHook(() => useMapLayers(map as never, [entryA, entryB], true));
    const [, spec] = map.addSource.mock.calls.find(([id]) => id === LEGS_SOURCE)!;
    expect(spec.promoteId).toBe("toSlug");
  });

  it("paints the active leg with the bright accent, keyed on feature state", () => {
    const map = fakeMapWithNoSources();
    renderHook(() => useMapLayers(map as never, [entryA, entryB], true));
    const [spec] = map.addLayer.mock.calls.map(([s]) => s).filter((s) => s.id === LAYERS.line);
    expect(spec.paint["line-color"]).toEqual([
      "case",
      ["boolean", ["feature-state", "active"], false],
      MAP_COLORS.accentBright,
      MAP_COLORS.accent,
    ]);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run hooks/map/`
Expected: FAIL — `use-map-highlight` unresolved; `spec.promoteId` is `undefined`; `line-color` is
the plain `MAP_COLORS.accent` string.

- [ ] **Step 3: Add `promoteId` and the feature-state paint**

In `hooks/map/use-map-layers.ts`, in `addAll`:

```ts
  // promoteId, or setFeatureState has no id to key on: the leg features carry
  // only properties. ./notes.md#why-the-legs-source-promotes-toslug
  map.addSource(LEGS_SOURCE, {
    type: "geojson",
    data: legs,
    promoteId: "toSlug",
  } satisfies GeoJSONSourceSpecification);
```

and in the `LAYERS.line` layer:

```ts
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "active"], false],
        MAP_COLORS.accentBright,
        MAP_COLORS.accent,
      ],
      "line-width": ROUTE_WIDTH,
      "line-dasharray": DASH_BY_MODE,
    },
```

- [ ] **Step 4: Write the highlight hook**

```ts
// hooks/map/use-map-highlight.ts
"use client";

import { useEffect, useRef } from "react";
import { LEGS_SOURCE } from "./use-map-layers";

type MapLibreMap = import("maplibre-gl").Map;

/** setFeatureState on an unknown id is a silent no-op, so a highlight landing on
 *  nothing looks identical to one that worked. ./notes.md#a-highlight-can-land-on-nothing */
export function useMapHighlight(map: MapLibreMap | null, activeSlug: string | null, styleLoaded: boolean): void {
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (map === null || !styleLoaded) return;
    if (previous.current !== null) {
      map.removeFeatureState({ source: LEGS_SOURCE, id: previous.current });
    }
    if (activeSlug !== null) {
      map.setFeatureState({ source: LEGS_SOURCE, id: activeSlug }, { active: true });
    }
    previous.current = activeSlug;
  }, [map, activeSlug, styleLoaded]);
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run hooks/map/` → all green, including the two added cases.

- [ ] **Step 6: Mutation-check the paint case**

Temporarily revert `line-color` to the plain `MAP_COLORS.accent` string and re-run. The paint case
must go red. If it stays green it is asserting its own fixture. Restore.

- [ ] **Step 7: Add the notes anchors and commit**

```bash
npm run lint && npm run typecheck && npm run check:structure
git add hooks/map
git commit -m "The active leg is painted from feature state, keyed by promoted toSlug"
```

---

### Task 5: The marker highlight — a class, not feature state

**Files:**
- Modify: `hooks/map/use-map-markers.ts`, `lib/map/marker-element.ts`
- Test: `hooks/map/use-map-markers.test.ts` (extend), `lib/map/marker-element.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new.
- Produces: `useMapMarkers(map, activeSlug: string | null)` — **note the second parameter**;
  `MARKER_ACTIVE` exported from `lib/map/marker-element.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// hooks/map/use-map-markers.test.ts — ADD
  it("marks the active marker's element without rebuilding any marker", () => {
    const map = fakeMapWithPoints(["kyoto", "osaka"]);
    const { rerender } = renderHook(({ slug }) => useMapMarkers(map as never, slug), {
      initialProps: { slug: null as string | null },
    });
    const created = markerConstructor.mock.calls.length;
    rerender({ slug: "kyoto" });
    expect(elementFor("kyoto").classList.contains(MARKER_ACTIVE)).toBe(true);
    expect(elementFor("osaka").classList.contains(MARKER_ACTIVE)).toBe(false);
    // The reconcile effect must NOT re-run: rebuilding every marker on every
    // hover is the failure this case exists to catch.
    expect(markerConstructor.mock.calls.length).toBe(created);
  });

  it("marks a marker created while a slug is already active", () => {
    const map = fakeMapWithPoints([]);
    renderHook(() => useMapMarkers(map as never, "kyoto"));
    map.addPointsAndFire(["kyoto"]);
    expect(elementFor("kyoto").classList.contains(MARKER_ACTIVE)).toBe(true);
  });
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run hooks/map/use-map-markers.test.ts`
Expected: FAIL — `useMapMarkers` takes one argument; `MARKER_ACTIVE` is not exported.

- [ ] **Step 3: Export the class and apply it on creation**

```ts
// lib/map/marker-element.ts
export const MARKER_ACTIVE = "ring-2 ring-accent-bright";
```

- [ ] **Step 4: Take the second parameter WITHOUT adding it to the reconcile deps**

```ts
export function useMapMarkers(map: MapLibreMap | null, activeSlug: string | null = null): void {
  const markers = useRef(new Map<string, MapLibreMarker>());
  const active = useRef(activeSlug);

  // Deps are [map] ONLY. Adding activeSlug here tears down and recreates every
  // marker on every hover. ./notes.md#why-activeslug-is-a-ref-in-the-reconcile-effect
  useEffect(() => {
    /* …existing body, unchanged, except when a marker is created: */
    const element = buildMarkerElement(props);
    if (active.current === props.slug) element.classList.add(MARKER_ACTIVE);
    live.set(props.slug, new Marker({ element }).setLngLat([lng, lat]).addTo(map));
  }, [map]);

  useEffect(() => {
    active.current = activeSlug;
    for (const [slug, marker] of markers.current) {
      marker.getElement().classList.toggle(MARKER_ACTIVE, slug === activeSlug);
    }
  }, [activeSlug]);
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run hooks/map/ lib/map/` → all green.

- [ ] **Step 6: Mutation-check the no-rebuild assertion**

Add `activeSlug` to the reconcile effect's dependency array and re-run. The first new case must go
red on the marker-count assertion. If it does not, the fake's constructor is not being counted and
the case proves nothing. Restore.

- [ ] **Step 7: Wire both hooks into `TripMap`, then commit**

In `components/public/trip-map/trip-map.tsx`:

```tsx
import { useTripHighlight } from "@/hooks/trip/highlight-context";
import { useMapHighlight } from "@/hooks/map/use-map-highlight";

  const { activeSlug } = useTripHighlight();
  const { map, styleLoaded } = useMapInstance({ container, active, bbox, styleUrl });
  useMapLayers(map, entries, styleLoaded);
  useMapMarkers(map, activeSlug);
  useMapHighlight(map, activeSlug, styleLoaded);
```

```bash
npm test && npm run lint && npm run typecheck && npm run check:structure
git add hooks/map lib/map components/public/trip-map
git commit -m "The active marker carries a class, applied without rebuilding markers"
```

---

### Task 6: The browser case, the gate, and §32

**Files:**
- Create: `e2e/trip-timeline.spec.ts`
- Modify: `CLAUDE.md` (gate list + the doc table row), `docs/testing-gates.md`, `docs/decisions.md`
- Modify: `TODO.md` (tick stage 4a's boxes, record what stayed open)

- [ ] **Step 1: Write the failing browser case**

```ts
// e2e/trip-timeline.spec.ts
import { expect, test } from "@playwright/test";

test.describe("the timeline and the map highlight each other", () => {
  test("hovering a row marks its marker, and the route marks it with no pointer", async ({ page }) => {
    await page.goto("/trips/2026-japan");
    const marker = page.locator('[data-slug="2026-03-29-arrival"]');
    await expect(marker).toBeVisible();
    await expect(marker).not.toHaveClass(/ring-2/);

    await page.getByRole("link", { name: "Arrival" }).hover();
    await expect(marker).toHaveClass(/ring-2/);

    await page.getByRole("link", { name: "Arrival" }).click();
    await expect(page).toHaveURL(/2026-03-29-arrival$/);
    await page.mouse.move(0, 0);
    // The route, not the pointer, is holding this highlight now.
    await expect(page.locator('[data-slug="2026-03-29-arrival"]')).toHaveClass(/ring-2/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm run pod:dev &
SEED_NAME=e2e npm run pod:seed
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npx playwright test e2e/trip-timeline.spec.ts
```

Expected: FAIL on the first `toHaveClass` — the wiring is in, so if it passes before you have
changed anything, find out why before continuing.

- [ ] **Step 3: Make it pass**

If Tasks 1-5 are complete it should pass as written. If it does not, the likely causes in order:
the marker is inside a cluster (the seed has few entries, so it should not be); `styleLoaded` has
not fired because the map never activated; or the row's `onPointerEnter` never fires because
Playwright's `hover()` landed on the link rather than the row — in which case the handler placement
from Task 3 is wrong, not the test.

- [ ] **Step 4: The mutation control**

Delete the `useMapHighlight`/`useMapMarkers` `activeSlug` argument in `TripMap` and re-run. The case
must go red. A browser case that passes with the feature disabled is asserting the DOM it rendered.
Restore, and record the measurement in `e2e/notes.md`.

- [ ] **Step 5: Widen the gate**

In `CLAUDE.md` and `docs/testing-gates.md`, add to the path list:

```
components/public/**   lib/map/**   hooks/map/**
```

- [ ] **Step 6: Write §32**

Append to `docs/decisions.md`, after §31:

```markdown
## 32. The e2e gate covers the public map; a dependency bump still does not

`components/public/**`, `lib/map/**` and `hooks/map/**` joined the path-scoped `test:e2e` list on
2026-09-13, closing §28 after three deferrals. The map is real browser-dependent code and stage 3
proved no faster test sees its failures.

**This does not cover the hazard that motivated it.** The stage 3 worker bug recurs through a
`maplibre-gl` version bump renaming the worker's sibling chunk — that touches `package.json` and
`package-lock.json`, neither of which is on the list, and adding the map paths does not put them
there. Adding the lockfile would close it and make nearly every dependency bump demand a Pod, a
browser and a free port; `docs/testing-gates.md` argues a gate people stop running is worse than a
narrow one. What stands between the repo and a silent repeat is
`app/(public)/maplibre-gl-worker.mjs/route.test.ts`, which parses the served bytes and pins the
single relative import — and which runs in `npm test`, not behind this gate.
```

- [ ] **Step 7: The full definition of done, run and read**

```bash
node -v                      # v22.x
npm run pod:dev &
npm test                     # expect 0 skipped
npm run lint && npm run typecheck && npm run validate:fixtures
npm run check:vocab && npm run check:commands && npm run check:structure
npm run build && npm run size:public
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e
npx vitest run test/integration/   # with the Pod DOWN: must SKIP, not pass
```

- [ ] **Step 8: Commit**

```bash
git add e2e CLAUDE.md docs TODO.md
git commit -m "One browser case for the highlight, and the gate finally widens"
```

---

## Self-review

**Spec coverage.** §1 → Tasks 3 (timeline), 5 + 4 (both highlight mechanisms), 2 (route), 6 (gate).
§2 → Tasks 1, 2. §3 → Task 3. §4 → Tasks 4, 5. §5 → Task 6. §6 → every task's test steps, plus the
RSC case in Task 2 and the controls in Tasks 4, 5 and 6. §7's "highlight that lands on nothing" is
the notes anchor in Task 4; §8 is recorded, not built.

**One gap, deliberate.** The spec's §6 asks for "a `"map"`-sourced hover does not echo back to the
map". No task implements an echo guard, because with `setFeatureState` and a class toggle there is
no echo to guard against — the map does not re-render on its own writes. **If a hover handler is
ever added to the markers themselves, that guard becomes real**; it is noted here rather than built
speculatively.

**Type consistency.** `activeSlug: string | null` throughout; `source` is
`"map" | "timeline" | "route" | null`; `useMapMarkers(map, activeSlug)` and
`useMapHighlight(map, activeSlug, styleLoaded)` match their call sites in Task 5 Step 7;
`MARKER_ACTIVE` is defined in Task 5 Step 3 before its use in Step 4.

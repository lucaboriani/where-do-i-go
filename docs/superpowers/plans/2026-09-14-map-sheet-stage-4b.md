# Phase 4 stage 4b — the mobile sheet and the trip shell: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the trip timeline in a hand-rolled three-snap-point sheet over a full-viewport map on
mobile and beside a sticky map on desktop, with a pinned selection that gives touch devices the
map → timeline direction hover gives a mouse.

**Architecture:** One tree at every width. The `[slug]` layout renders a shell with two siblings —
the map pane and `<MapSheet>{children}</MapSheet>` — and a single block of CSS in
`app/globals.css` decides which layout they are in. The sheet is one scroll container with two
spacers and a body, snapped by `scroll-snap-type: y mandatory`; the drag is the browser's own
scroll. Nothing is conditionally rendered, so no snap point, breakpoint or pin can unmount the map.

**Tech Stack:** Next 16.3.4 App Router, React 19.2.8, Tailwind v4.3.3, MapLibre GL 6.6.0, Vitest,
Playwright, Prettier 3.9.6.

**Spec:** `docs/superpowers/specs/2026-09-14-map-sheet-stage-4b-design.md` (commits `63f6683`,
`d9e2897`). Read it first — this plan argues from it and does not repeat its reasoning. §2 carries
the two measurements every layout choice here rests on.

## Global Constraints

- **Node 22.** `nvm use`, then `node -v` must print `v22.x`. If `nvm` is not on `PATH`:
  `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`. `npm run` is NOT gated by
  `engine-strict`; checking is a step you do.
- **No new dependencies.** No `vaul`, no `framer-motion`, no `react-use`. Zero required API keys.
- **`lib/` holds no React.** Pure and reusable goes to `lib/` or to a flat module beside the
  component; hooks go to `hooks/<area>/`; presentation stays in the component folder.
- **One component, one folder** — named file, one-line `index.ts` barrel, its test, its `notes.md`.
- **Comments are three lines or fewer**, pointing at a sibling `notes.md#anchor` that must resolve.
- **Function length**: 200 hard bound in `components/**`, `app/**`, `hooks/**`; 80 in `lib/**` and
  `scripts/**`. Tendencies are 130 and 50 and are reported, not enforced.
- **Arbitrary Tailwind values are banned** outside `components/ui/**`, enforced by four ESLint
  arms including `VariableDeclarator > Literal`. The sheet's geometry therefore lives in
  `app/globals.css`, not in `className` strings.
- **`npm run lint` carries `--max-warnings 0`.** A stale `eslint-disable` fails the build.
- **The map is mounted once and never remounted.** Nothing in this stage may add a code path that
  unmounts `TripMap`, recreates the MapLibre instance, or branches the tree on viewport width.
- **No `dy:` term, no container layout and no read model changes.** Every field this stage renders
  is already on `IndexEntry`.
- **Definition of done, run and read** — with a Pod up (`npm run pod:dev &`) before `npm test`:
  `npm test`, `npm run lint`, `npm run typecheck`, `npm run validate:fixtures`,
  `npm run check:vocab`, `npm run check:commands`, `npm run check:structure`, `npm run build`,
  `npm run size:public`, `npm run format:check` (from Task 0 onward), and
  `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e` — the diff touches
  `components/public/**`, `lib/map/**` and `hooks/map/**`, all three on the gate.
- **Baselines to beat or hold**, from `main` @ `b285844`: `npm test` 1728 passed / 2 todo / 0
  skipped / 85 files; `test:e2e` 13 passed; `size:public` 181.3 kB of 190; `check:structure`
  `active exemptions — 0` and production comment blocks `0, at the allowance`.

---

## File structure

| File | Responsibility |
|---|---|
| `.prettierignore` | **Create.** `components/ui/` and `**/*.test.*`, with the reason for each. |
| `package.json` | **Modify.** `format` and `format:check`, scoped to production code. |
| `hooks/trip/highlight-context.ts` | **Modify.** `HighlightValue` gains `pin`/`unpin`; `HighlightSource` gains `"pin"`; `INERT` gains both no-ops. |
| `hooks/trip/use-highlight-state.ts` | **Modify.** A second state slot: `pointer ?? pinned ?? route`. |
| `hooks/map/use-map-markers.ts` | **Modify.** Handlers become one object; marker `click` selects and stops propagating; a map `click` deselects. |
| `components/public/map-sheet/snap.ts` | **Create.** Pure: the next snap point, and the target for revealing a row. No DOM. |
| `components/public/map-sheet/map-sheet.tsx` | **Create.** `"use client"`. The scroller, the two spacers, the handle button, the body holding `{children}`. |
| `components/public/map-sheet/index.ts` | **Create.** One-line barrel. |
| `components/public/map-sheet/notes.md` | **Create.** Why one scroller, why `pointer-events` is load-bearing, why the drag is native. |
| `app/globals.css` | **Modify.** `--sheet-peek`, `--sheet-half`, `--sheet-strip`, and one block of shell/sheet rules with the breakpoint spelled once. |
| `app/(public)/trips/[slug]/layout.tsx` | **Modify.** The shell: map pane and `<MapSheet>` as siblings. |
| `components/public/trip-map/trip-map.tsx` | **Modify.** `MAP_FRAME_CLASS` becomes the pane's fill class. |
| `components/public/trip-timeline/trip-timeline.tsx` | **Modify.** Thumbnail, travel mode and precision, all server-rendered. |
| `components/public/trip-timeline/timeline-row/timeline-row.tsx` | **Modify.** `data-slug`, so the sheet can find the row to reveal. |
| `e2e/map-sheet.spec.ts` | **Create.** Four browser cases, each with a mutation control recorded in `e2e/notes.md`. |
| `CLAUDE.md` | **Modify.** `hooks/trip/**` joins the gate; the command list and the definition of done gain `format:check`; "a tenth command" is renumbered. |
| `docs/decisions.md` | **Modify.** §26 in its reserved slot, and §11's retraction. |
| `docs/testing-gates.md`, `TODO.md` | **Modify.** The gate's new path, and the phase 0.5 line echoing §11. |

---

### Task 0: Prettier, scoped to production code

Landing first and alone, so the 4b diff is reviewable. **Read spec §9 before starting** — a
whole-repo reformat is measured there and is not available.

**Files:**
- Create: `.prettierignore`
- Modify: `package.json`, `CLAUDE.md`, `lib/time/offsets.ts` (one `// prettier-ignore`)

**Interfaces:**
- Produces: `npm run format` (write) and `npm run format:check` (verify), both scoped to
  `{app,components,hooks,lib,scripts}/**/*.{ts,tsx}`.

- [ ] **Step 1: Write the failing test**

`test/check-commands.test.ts` already pins `CLAUDE.md`'s command list against `package.json` in
both directions. The failing test is the check itself, so add the script to `CLAUDE.md` FIRST and
watch `check:commands` fail on the missing `package.json` half.

In `CLAUDE.md`, in the fenced command list under "Commands":

```
format               # prettier --write, production code only (see .prettierignore)
format:check         # prettier --check, the same scope; in the definition of done
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run check:commands`
Expected: FAIL, naming `format` and `format:check` as documented but absent from `package.json`.

- [ ] **Step 3: Add the scripts and the ignore file**

`package.json`, in `scripts`:

```json
"format": "prettier --write \"{app,components,hooks,lib,scripts}/**/*.{ts,tsx}\"",
"format:check": "prettier --check \"{app,components,hooks,lib,scripts}/**/*.{ts,tsx}\""
```

`.prettierignore`:

```
# Vendored shadcn source. Already exempt from the arbitrary-value lint rule;
# reformatting it noises up every future upstream diff.
components/ui/

# Tests are excluded for a measured reason, not a taste one: guardrails.test.ts
# is at 999 code lines against a 1000-line HARD bound and Prettier adds 257.
# See docs/superpowers/specs/2026-09-14-map-sheet-stage-4b-design.md §9.
**/*.test.ts
**/*.test.tsx
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm run check:commands`
Expected: PASS.

- [ ] **Step 5: Protect the table Prettier would wreck**

In `lib/time/offsets.ts`, directly above the offsets array literal:

```ts
// prettier-ignore -- six hand-aligned lines become forty, which then count
// against this file's own bounds. docs/…-stage-4b-design.md §9.
```

- [ ] **Step 6: Run the formatter and read what it did**

Run: `npm run format`
Then: `git diff --stat`
Expected: about 46 files and roughly 600 changed lines, and `lib/time/offsets.ts`'s table intact.
**If any single file gained more than ~80 lines, stop and look at it** before continuing.

- [ ] **Step 7: Prove the reformat broke no bound**

Run, reading each: `npm run lint`, `npm run check:structure`, `npm run typecheck`, `npm test`
Expected: lint clean at `--max-warnings 0`; `check:structure` still `Structure OK` with
`active exemptions — 0`; 1728 passed / 2 todo / 0 skipped.
**If lint fails on `max-lines` or `max-lines-per-function`, the fix is `// prettier-ignore` on the
construct that grew, not an eslint-disable.**

- [ ] **Step 8: Put it in the definition of done**

In `CLAUDE.md`'s definition-of-done block, after `npm run size:public`:

```
npm run format:check      # prettier, production code only
```

and renumber the sentence below it: "A tenth command, path-scoped rather than unconditional"
becomes "An eleventh command, path-scoped rather than unconditional".

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Prettier, wired to production code and nothing else"
```

---

### Task 1: The pin, in the context that already exists

**Files:**
- Modify: `hooks/trip/highlight-context.ts`, `hooks/trip/use-highlight-state.ts`
- Test: `hooks/trip/use-highlight-state.test.ts`, `hooks/trip/highlight-context.test.tsx`
- Modify: `hooks/trip/notes.md`

**Interfaces:**
- Consumes: nothing.
- Produces:
  `type HighlightSource = "map" | "timeline" | "pin" | "route"`;
  `type HighlightValue = Highlight & { raise: (slug: string, source: "map" | "timeline") => void; clear: () => void; pin: (slug: string) => void; unpin: () => void }`.
  Precedence is `pointer ?? pinned ?? route`.

- [ ] **Step 1: Write the failing test**

```ts
// hooks/trip/use-highlight-state.test.ts — add to the existing describe
it("a pin outranks the route and outlives the hover that ended", () => {
  const { result } = renderHook(() => useHighlightState("arrival"));

  act(() => result.current.pin("nara"));
  expect(result.current).toMatchObject({ activeSlug: "nara", source: "pin" });

  act(() => result.current.raise("osaka", "map"));
  expect(result.current).toMatchObject({ activeSlug: "osaka", source: "map" });

  // The hover ends and the PIN is what is left, not the route: this is the
  // whole point of the second slot.
  act(() => result.current.clear());
  expect(result.current).toMatchObject({ activeSlug: "nara", source: "pin" });

  act(() => result.current.unpin());
  expect(result.current).toMatchObject({ activeSlug: "arrival", source: "route" });
});

it("a route change drops the pin as well as the pointer", () => {
  const { result, rerender } = renderHook(({ route }) => useHighlightState(route), {
    initialProps: { route: "arrival" as string | null },
  });

  act(() => result.current.pin("nara"));
  rerender({ route: "osaka" });

  expect(result.current).toMatchObject({ activeSlug: "osaka", source: "route" });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run hooks/trip/use-highlight-state.test.ts`
Expected: FAIL — `result.current.pin is not a function`.

- [ ] **Step 3: Implement**

`hooks/trip/highlight-context.ts`:

```ts
export type HighlightSource = "map" | "timeline" | "pin" | "route";

export type HighlightValue = Highlight & {
  raise: (slug: string, source: "map" | "timeline") => void;
  clear: () => void;
  pin: (slug: string) => void;
  unpin: () => void;
};

const INERT: HighlightValue = {
  activeSlug: null,
  source: null,
  raise: () => {},
  clear: () => {},
  pin: () => {},
  unpin: () => {},
};
```

`hooks/trip/use-highlight-state.ts`:

```ts
export function useHighlightState(routeSlug: string | null): HighlightValue {
  const [pointer, setPointer] = useState<Highlight | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [seenRoute, setSeenRoute] = useState(routeSlug);

  const raise = useCallback((slug: string, source: "map" | "timeline") => {
    setPointer({ activeSlug: slug, source });
  }, []);
  const clear = useCallback(() => setPointer(null), []);
  const pin = useCallback((slug: string) => setPinned(slug), []);
  const unpin = useCallback(() => setPinned(null), []);

  // Adjusted during render, not in an effect, and it clears BOTH slots:
  // ./notes.md#a-navigation-drops-the-pointer
  if (seenRoute !== routeSlug) {
    setSeenRoute(routeSlug);
    setPointer(null);
    setPinned(null);
  }

  return useMemo(() => {
    const base: Highlight = pointer ?? pinnedOrRoute(pinned, routeSlug);
    return { ...base, raise, clear, pin, unpin };
  }, [pointer, pinned, routeSlug, raise, clear, pin, unpin]);
}

function pinnedOrRoute(pinned: string | null, routeSlug: string | null): Highlight {
  if (pinned !== null) return { activeSlug: pinned, source: "pin" };
  if (routeSlug !== null) return { activeSlug: routeSlug, source: "route" };
  return { activeSlug: null, source: null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run hooks/trip/`
Expected: PASS, **including every pre-existing case unchanged** — 4a's pointer and route behaviour
is not allowed to move. If `highlight-context.test.tsx` asserts the shape of `INERT`, extend it
rather than loosening it.

- [ ] **Step 5: Note the precedence where the next reader will look**

In `hooks/trip/notes.md`, a new section `## why a pin is a second slot, not a third source`:
the pointer and the pin are different lifetimes — one ends when the cursor leaves, one ends when
the reader says so — so collapsing them into one `Highlight` would make `clear()` ambiguous.
`activeSlug` is still one value, so the map and the timeline stay unaware there are two slots.

- [ ] **Step 6: Commit**

```bash
git add hooks/trip
git commit -m "A pinned entry outranks the route and outlives the hover"
```

---

### Task 2: A marker tap selects; the background clears

**Files:**
- Modify: `hooks/map/use-map-markers.ts`, `components/public/trip-map/trip-map.tsx`
- Test: `hooks/map/use-map-markers.test.ts`
- Modify: `hooks/map/notes.md`

**Interfaces:**
- Consumes: `pin`/`unpin` from Task 1's `useTripHighlight()`.
- Produces:
  `type MarkerHandlers = { onEnter?: (slug: string) => void; onLeave?: () => void; onSelect?: (slug: string) => void; onDeselect?: () => void }`;
  `useMapMarkers(map: Map | null, activeSlug?: string | null, handlers?: MarkerHandlers): void`.
  **The two hover handlers stop being positional parameters** — every call site moves to the
  object, including four in the existing test file.

- [ ] **Step 1: Write the failing test**

```ts
// hooks/map/use-map-markers.test.ts — add to the existing describe
it("a marker click selects, and does NOT reach a click handler on the map's container", async () => {
  // maplibre appends markers INTO the canvas container it listens on, so a
  // click that bubbles would select and immediately deselect.
  const container = document.createElement("div");
  document.body.append(container);
  const onSelect = vi.fn();
  const onDeselect = vi.fn();
  container.addEventListener("click", () => onDeselect());

  map.features = [leaf("nara")];
  renderHook(() => useMapMarkers(map as never, null, { onSelect, onDeselect }));
  await waitFor(() => expect(markers).toHaveLength(1));

  const element = markers[0].getElement();
  container.append(element);
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  expect(onSelect).toHaveBeenCalledWith("nara");
  expect(onDeselect).not.toHaveBeenCalled();
});

it("a click on the map itself deselects", async () => {
  const onDeselect = vi.fn();
  map.features = [leaf("nara")];
  renderHook(() => useMapMarkers(map as never, null, { onDeselect }));
  await waitFor(() => expect(markers).toHaveLength(1));

  map.emit("click");
  expect(onDeselect).toHaveBeenCalledTimes(1);
});

it("a fresh handlers object does not rebuild the markers", async () => {
  map.features = [leaf("nara")];
  const { rerender } = renderHook(({ onSelect }) => useMapMarkers(map as never, null, { onSelect }), {
    initialProps: { onSelect: vi.fn() },
  });
  await waitFor(() => expect(markers).toHaveLength(1));

  rerender({ onSelect: vi.fn() });
  expect(markers).toHaveLength(1);
  expect(markers[0].removed).toBe(0);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run hooks/map/use-map-markers.test.ts`
Expected: FAIL — the third argument is `onEnter`, so `{ onSelect }` is not called at all.

- [ ] **Step 3: Implement**

In `hooks/map/use-map-markers.ts`:

```ts
export type MarkerHandlers = {
  onEnter?: (slug: string) => void;
  onLeave?: () => void;
  onSelect?: (slug: string) => void;
  onDeselect?: () => void;
};

export function useMapMarkers(
  map: MapLibreMap | null,
  activeSlug: string | null = null,
  handlers: MarkerHandlers = {},
): void {
  const markers = useRef(new Map<string, MapLibreMarker>());
  const active = useRef(activeSlug);
  // A ref, not a dependency: a caller's fresh object literal would otherwise
  // rebuild every marker on every render.
  const hooks = useRef(handlers);
  useEffect(() => {
    hooks.current = handlers;
  });
```

Inside the reconcile effect, before the dynamic import, register the deselect:

```ts
    // Markers are DOM overlays INSIDE the canvas container maplibre listens
    // on, so the marker handler below stops propagation; without that, a tap
    // would select and this would immediately clear it.
    // ./notes.md#why-a-marker-click-stops-propagating
    const deselect = () => hooks.current.onDeselect?.();
    map.on("click", deselect);
```

On the element, beside the two hover listeners:

```ts
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        hooks.current.onSelect?.(props.slug);
      });
```

In the cleanup — **outside the `if (handler !== null)` guard**, because the click listener is
registered before the dynamic import and must be removed even when that import never resolved:

```ts
    return () => {
      cancelled = true;
      map.off("click", deselect);
      if (handler !== null) {
        map.off("moveend", handler);
        map.off("sourcedata", handler);
      }
      …
```

Then update the four positional call sites in the test file and the one in
`components/public/trip-map/trip-map.tsx`:

```tsx
  const { activeSlug, raise, clear, pin, unpin } = useTripHighlight();
  …
  useMapMarkers(map, activeSlug, {
    onEnter: (slug) => raise(slug, "map"),
    onLeave: clear,
    onSelect: pin,
    onDeselect: unpin,
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run hooks/map components/public/trip-map`
Expected: PASS, all pre-existing cases included.

- [ ] **Step 5: Mutation-check the one that matters**

Delete `event.stopPropagation()` and re-run. The first new case MUST fail. Restore it.
**If it still passes, the test is not testing what it claims** — the deselect listener must be on
an ancestor of the marker element in the document.

- [ ] **Step 6: Commit**

```bash
git add hooks/map components/public/trip-map
git commit -m "A marker tap pins its entry; a tap on the map clears it"
```

---

### Task 3: The snap arithmetic, pure

**Files:**
- Create: `components/public/map-sheet/snap.ts`
- Test: `components/public/map-sheet/snap.test.ts`

**Interfaces:**
- Produces:
  `type SnapOffsets = { peek: number; half: number; full: number }`;
  `nextSnap(current: number, offsets: SnapOffsets): number`;
  `targetForRow(rowTop: number, handleHeight: number, offsets: SnapOffsets): number`.
  **Both take numbers and touch no DOM.** The component measures; this decides.

- [ ] **Step 1: Write the failing test**

```ts
// components/public/map-sheet/snap.test.ts
import { describe, expect, it } from "vitest";
import { nextSnap, targetForRow } from "./snap";

// The numbers an 800px viewport actually produced in the spec's probe.
const OFFSETS = { peek: 0, half: 240, full: 576 };

describe("nextSnap", () => {
  it("cycles peek → half → full → peek", () => {
    expect(nextSnap(0, OFFSETS)).toBe(240);
    expect(nextSnap(240, OFFSETS)).toBe(576);
    expect(nextSnap(576, OFFSETS)).toBe(0);
  });

  it("takes the next point ABOVE where a flick left it, not the nearest", () => {
    expect(nextSnap(100, OFFSETS)).toBe(240);
    expect(nextSnap(300, OFFSETS)).toBe(576);
  });

  it("wraps from anywhere past full, which a long timeline reaches", () => {
    expect(nextSnap(1200, OFFSETS)).toBe(0);
  });

  it("tolerates a fractional rest position", () => {
    expect(nextSnap(239.6, OFFSETS)).toBe(576);
  });
});

describe("targetForRow", () => {
  it("never closes the sheet: a row at the top still opens to half", () => {
    expect(targetForRow(600, 32, OFFSETS)).toBe(568);
    expect(targetForRow(240, 32, OFFSETS)).toBe(240);
  });

  it("opens far enough to put a row below the fold under the handle", () => {
    expect(targetForRow(1400, 32, OFFSETS)).toBe(1368);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run components/public/map-sheet/snap.test.ts`
Expected: FAIL — cannot find module `./snap`.

- [ ] **Step 3: Implement**

```ts
// components/public/map-sheet/snap.ts
/** The sheet's three rest positions, as scrollTop values MEASURED from the DOM
 *  — never recomputed from dvh here. ./notes.md#the-offsets-are-read-not-computed */
export type SnapOffsets = { peek: number; half: number; full: number };

// A rest position is fractional on a scaled display, and a flick can stop a
// pixel short of a detent.
const EPSILON = 2;

export function nextSnap(current: number, { peek, half, full }: SnapOffsets): number {
  if (current < half - EPSILON) return half;
  if (current < full - EPSILON) return full;
  return peek;
}

/** Revealing a row must not CLOSE the sheet, so half is the floor. Past full is
 *  allowed: a long timeline scrolls freely there (spec §2). */
export function targetForRow(rowTop: number, handleHeight: number, { half }: SnapOffsets): number {
  return Math.max(half, rowTop - handleHeight);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run components/public/map-sheet/snap.test.ts`
Expected: PASS, 6 cases.

- [ ] **Step 5: Commit**

```bash
git add components/public/map-sheet
git commit -m "The sheet's snap arithmetic, before anything can scroll"
```

---

### Task 4: The sheet itself

**Files:**
- Create: `components/public/map-sheet/map-sheet.tsx`, `components/public/map-sheet/index.ts`,
  `components/public/map-sheet/notes.md`
- Test: `components/public/map-sheet/map-sheet.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `nextSnap`, `targetForRow`, `SnapOffsets` from Task 3.
- Produces: `export default function MapSheet({ children }: { children: React.ReactNode })`, and
  the class names `trip-shell`, `trip-map-pane`, `trip-sheet`, `trip-sheet-body`,
  `trip-sheet-handle` — Task 5 uses the first two.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
// components/public/map-sheet/map-sheet.test.tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapSheet from "./map-sheet";

afterEach(cleanup);

// jsdom implements neither matchMedia nor scrollTo, and layout is all zeroes.
// Each is stubbed to the SMALLEST thing that makes the assertion meaningful.
const scrollTo = vi.fn();
beforeEach(() => {
  scrollTo.mockClear();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as never;
  Element.prototype.scrollTo = scrollTo as never;
});

function offsets(container: HTMLElement, { half, body }: { half: number; body: number }) {
  const spacer = container.querySelector(".trip-sheet-spacer-half") as HTMLElement;
  const sheetBody = container.querySelector(".trip-sheet-body") as HTMLElement;
  vi.spyOn(spacer, "offsetTop", "get").mockReturnValue(half);
  vi.spyOn(sheetBody, "offsetTop", "get").mockReturnValue(body);
}

describe("MapSheet", () => {
  it("renders its children, which arrive as server output", () => {
    render(
      <MapSheet>
        <p>the timeline</p>
      </MapSheet>,
    );
    expect(screen.getByText("the timeline")).toBeTruthy();
  });

  it("the handle cycles to the next snap point", () => {
    const { container } = render(<MapSheet>x</MapSheet>);
    offsets(container, { half: 240, body: 640 });

    fireEvent.click(screen.getByRole("button", { name: /entry list/i }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: "smooth" });
  });

  it("honours prefers-reduced-motion on the same call", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as never;
    const { container } = render(<MapSheet>x</MapSheet>);
    offsets(container, { half: 240, body: 640 });

    fireEvent.click(screen.getByRole("button", { name: /entry list/i }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: "auto" });
  });

  it("subtracts the strip the body's scroll-margin reserves, rather than a number of its own", () => {
    const { container } = render(<MapSheet>x</MapSheet>);
    offsets(container, { half: 240, body: 640 });
    const sheetBody = container.querySelector(".trip-sheet-body") as HTMLElement;
    sheetBody.style.scrollMarginTop = "64px";
    const scroller = container.querySelector(".trip-sheet") as HTMLElement;
    vi.spyOn(scroller, "scrollTop", "get").mockReturnValue(240);

    fireEvent.click(screen.getByRole("button", { name: /entry list/i }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 576, behavior: "smooth" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run components/public/map-sheet/map-sheet.test.tsx`
Expected: FAIL — cannot find module `./map-sheet`.

- [ ] **Step 3: Implement the component**

```tsx
// components/public/map-sheet/map-sheet.tsx
"use client";

import { useRef } from "react";
import { nextSnap, type SnapOffsets } from "./snap";

/** One scroll container, two spacers and a body. The drag is the browser's own
 *  scroll and the snapping is CSS; this file adds the handle and the arithmetic
 *  a pointer cannot do. ./notes.md#why-one-scroller */
export default function MapSheet({ children }: { children: React.ReactNode }) {
  const scroller = useRef<HTMLDivElement>(null);
  const halfSpacer = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);

  function scrollToTop(top: number) {
    const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scroller.current?.scrollTo({ top, behavior: smooth ? "smooth" : "auto" });
  }

  function cycle() {
    const offsets = measure(halfSpacer.current, body.current);
    if (offsets === null) return;
    scrollToTop(nextSnap(scroller.current?.scrollTop ?? 0, offsets));
  }

  return (
    <div ref={scroller} className="trip-sheet">
      <div className="trip-sheet-spacer-peek" aria-hidden />
      {/* The ref is on THIS spacer: its offsetTop IS the half snap position.
          The peek spacer's is 0. ./notes.md#the-offsets-are-read-not-computed */}
      <div ref={halfSpacer} className="trip-sheet-spacer-half" aria-hidden />
      <div ref={body} className="trip-sheet-body">
        <button type="button" className="trip-sheet-handle" onClick={cycle}>
          <span className="sr-only">Resize the entry list</span>
          <span aria-hidden className="block h-1 w-10 rounded-full bg-hairline" />
        </button>
        {children}
      </div>
    </div>
  );
}

/** The offsets are READ from the DOM, so `app/globals.css` stays the single
 *  source for the geometry. ./notes.md#the-offsets-are-read-not-computed */
function measure(halfSpacer: HTMLElement | null, body: HTMLElement | null): SnapOffsets | null {
  if (halfSpacer === null || body === null) return null;
  const strip = parseFloat(getComputedStyle(body).scrollMarginTop) || 0;
  return { peek: 0, half: halfSpacer.offsetTop, full: body.offsetTop - strip };
}
```

**Watch which spacer carries the ref.** `.trip-sheet-spacer-half`'s `offsetTop` is the half snap
position; the peek spacer's is 0, and putting the ref there makes `half` 0 and the handle cycle
straight past half with every case still passing except the second.

- [ ] **Step 4: Add the stylesheet block**

At the end of `app/globals.css`:

```css
/* The trip shell and its sheet. GEOMETRY, not tokens: calc() over viewport
   units, which the arbitrary-value ban keeps out of className, and the
   breakpoint is spelled ONCE here rather than half here and half in md:.
   components/public/map-sheet/notes.md carries the measurements. */
:root {
  --sheet-peek: 20dvh;
  --sheet-half: 50dvh;
  --sheet-strip: 8dvh;
}

.trip-map-pane {
  position: fixed;
  inset: 0;
}

.trip-sheet {
  position: fixed;
  inset: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scroll-snap-type: y mandatory;
  /* LOAD-BEARING. At `auto`, elementFromPoint over the map returns THIS
     element and every marker is untappable, with nothing thrown.
     components/public/map-sheet/notes.md#pointer-events-is-load-bearing */
  pointer-events: none;
}

.trip-sheet-spacer-peek {
  height: calc(var(--sheet-half) - var(--sheet-peek));
  scroll-snap-align: start;
}

.trip-sheet-spacer-half {
  height: calc(100dvh - var(--sheet-half));
  scroll-snap-align: start;
}

.trip-sheet-body {
  min-height: 100dvh;
  scroll-snap-align: start;
  scroll-margin-top: var(--sheet-strip);
  pointer-events: auto;
  background: var(--color-surface);
  border-top: 1px solid var(--color-hairline);
}

.trip-sheet-handle {
  position: sticky;
  top: 0;
  display: flex;
  width: 100%;
  justify-content: center;
  padding: 0.75rem 0;
  background: var(--color-surface);
}

@media (min-width: 48rem) {
  .trip-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 34rem);
  }

  .trip-map-pane {
    position: sticky;
    inset: auto;
    top: 0;
    height: 100dvh;
    /* A grid item stretches by default, and a stretched item cannot stick. */
    align-self: start;
  }

  .trip-sheet {
    position: static;
    overflow: visible;
    scroll-snap-type: none;
    pointer-events: auto;
  }

  .trip-sheet-spacer-peek,
  .trip-sheet-spacer-half,
  .trip-sheet-handle {
    display: none;
  }

  .trip-sheet-body {
    min-height: 0;
    border-top: 0;
    background: transparent;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run components/public/map-sheet`
Expected: PASS, 4 cases plus Task 3's 6.

- [ ] **Step 6: Barrel and notes**

`components/public/map-sheet/index.ts`:

```ts
export { default } from "./map-sheet";
```

`components/public/map-sheet/notes.md` — four anchors, each one paragraph:
`## why one scroller` (the measured large-snap-area rule, and what a nested scroller would cost);
`## pointer-events is load-bearing` (the `elementFromPoint` measurement, and the e2e control);
`## the offsets are read not computed` (why `getComputedStyle().scrollMarginTop` and not a dvh
constant); `## why the drag is native` (the handle sits inside the scroller, so the parent design's
pointer-handler sentence is satisfied by the browser).

- [ ] **Step 7: Commit**

```bash
git add components/public/map-sheet app/globals.css
git commit -m "The sheet: one scroller, three snap points, a handle that cycles"
```

---

### Task 5: The shell — the map beside the sheet, never inside it

**Files:**
- Modify: `app/(public)/trips/[slug]/layout.tsx`, `components/public/trip-map/trip-map.tsx`
- Test: `app/(public)/trips/[slug]/layout.test.tsx`
- Modify: `app/(public)/trips/[slug]/notes.md`

**Interfaces:**
- Consumes: `MapSheet` (Task 4) and the class names it defined.
- Produces: the rendered tree `div.trip-shell > (div.trip-map-pane, div.trip-sheet)`, which Task 8
  asserts in a real browser. `MAP_FRAME_CLASS` becomes `"size-full bg-surface"`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/(public)/trips/[slug]/layout.test.tsx — replace the ".h-96" case with these two
it("reserves the map frame on the shell path, before the index has been read", () => {
  const { container } = render(<Layout params={params}>{null}</Layout>);
  expect(container.querySelector(".trip-map-pane [aria-hidden]")).not.toBeNull();
});

it("puts the map BESIDE the sheet, never inside it — the never-remounted invariant as a shape", () => {
  const { container } = render(<Layout params={params}>{<p>{"entry body"}</p>}</Layout>);
  const pane = container.querySelector(".trip-map-pane");
  const sheet = container.querySelector(".trip-sheet");

  expect(pane).not.toBeNull();
  expect(sheet).not.toBeNull();
  // If the pane is ever inside the sheet, a snap point acquires a code path
  // that can unmount the map. There is no other way to state this in a test.
  expect(sheet?.contains(pane as Node)).toBe(false);
  expect(sheet?.textContent).toContain("entry body");
});
```

Update the `trip-map` mock's `MAP_FRAME_CLASS` to `"size-full bg-surface"` in the same edit.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run "app/(public)/trips/[slug]/layout.test.tsx"`
Expected: FAIL — `.trip-map-pane` is null; there is no shell yet.

- [ ] **Step 3: Implement**

`app/(public)/trips/[slug]/layout.tsx`:

```tsx
import MapSheet from "@/components/public/map-sheet";

/** The layout, not the page, keeps ONE map alive across trip → entry → entry,
 *  and the shell keeps it a SIBLING of the sheet at every width.
 *  ./notes.md#why-the-map-lives-in-the-layout */
export default function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  return (
    <TripHighlightProvider>
      <div className="trip-shell">
        <div className="trip-map-pane">
          <Suspense fallback={<div aria-hidden className={MAP_FRAME_CLASS} />}>
            <MapForTrip params={params} />
          </Suspense>
        </div>
        <MapSheet>{children}</MapSheet>
      </div>
    </TripHighlightProvider>
  );
}
```

`components/public/trip-map/trip-map.tsx`:

```tsx
// The PANE owns the position now; the frame just fills it.
// ./notes.md#the-frame-is-reserved-by-the-server-and-the-class-is-shared
export const MAP_FRAME_CLASS = "size-full bg-surface";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run "app/(public)" components/public`
Expected: PASS. `components/public/trip-map/trip-map.test.tsx` may assert the old class — update
the assertion, do not reintroduce `h-96`.

- [ ] **Step 5: Look at it in a real browser before believing it**

Run: `npm run dev`, then open `/trips/2026-japan` at a 390px-wide window.
Expected: map filling the viewport, the sheet over its lower fifth, the handle visible, and
dragging the sheet snapping at three positions. **If the sheet does not scroll, check
`pointer-events` first** — it is the failure with no error message.

- [ ] **Step 6: Update the layout's notes**

In `app/(public)/trips/[slug]/notes.md`, extend the existing section: the layout now also owns the
shell, and the two siblings are what make the never-remounted rule structural. Point at
`components/public/map-sheet/notes.md` for the geometry rather than restating it.

- [ ] **Step 7: Commit**

```bash
git add "app/(public)/trips/[slug]" components/public/trip-map
git commit -m "The trip shell: one tree, the map a sibling of the sheet at every width"
```

---

### Task 6: The three fields 4a deferred

**Files:**
- Modify: `components/public/trip-timeline/trip-timeline.tsx`,
  `components/public/trip-timeline/timeline-row/timeline-row.tsx`
- Test: `components/public/trip-timeline/trip-timeline.test.tsx`,
  `components/public/trip-timeline/timeline-row/timeline-row.test.tsx`
- Modify: `components/public/trip-timeline/notes.md`

**Interfaces:**
- Consumes: `precisionLabel` from `lib/place/precision.ts`.
- Produces: rows carrying `data-slug`, which Task 7 queries to reveal one.

- [ ] **Step 1: Write the failing test**

```tsx
// components/public/trip-timeline/trip-timeline.test.tsx — add to the existing describe
it("renders the thumbnail, the travel mode and the precision when the index carries them", () => {
  render(
    <TripTimeline
      slug="japan"
      entries={[
        entry({
          slug: "nara",
          thumbnail: "https://pod.example/t/e1/thumb.jpg",
          travelModeFrom: "Train",
          precisionMeters: 500,
        }),
      ]}
    />,
  );

  const thumb = screen.getByRole("presentation");
  expect(thumb.getAttribute("src")).toBe("https://pod.example/t/e1/thumb.jpg");
  expect(thumb.getAttribute("loading")).toBe("lazy");
  expect(screen.getByText(/train/i)).toBeTruthy();
  // The label lib/place/precision.ts owns, not a number formatted here.
  expect(screen.getByText("~500 m")).toBeTruthy();
});

it("renders none of the three when the index carries none of them", () => {
  render(<TripTimeline slug="japan" entries={[entry({ slug: "nara" })]} />);

  expect(screen.queryByRole("presentation")).toBeNull();
  expect(screen.queryByText(/~/)).toBeNull();
});
```

```tsx
// components/public/trip-timeline/timeline-row/timeline-row.test.tsx — add one case
it("carries its slug in the DOM, so the sheet can find the row to reveal", () => {
  render(<TimelineRow slug="nara">body</TimelineRow>);
  expect(screen.getByText("body").closest("li")?.dataset.slug).toBe("nara");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run components/public/trip-timeline`
Expected: FAIL — no `presentation` role, no `~500 m`, `dataset.slug` undefined.

- [ ] **Step 3: Implement**

`timeline-row.tsx`, on the `<li>`, beside `data-active`:

```tsx
      data-slug={slug}
```

`trip-timeline.tsx`, inside the `map`, before the `<Link>`:

```tsx
          {entry.thumbnail !== undefined && (
            /* eslint-disable-next-line @next/next/no-img-element --
               next/image wants images.remotePatterns for an arbitrary Pod
               origin and ships a client component for a 40px square; the map
               marker builds the same <img> by hand. Remove when the Pod origin
               becomes a configured host. */
            <img
              src={entry.thumbnail}
              alt=""
              role="presentation"
              loading="lazy"
              width={40}
              height={40}
              className="mr-2 inline-block size-10 rounded-sm bg-surface object-cover align-middle"
            />
          )}
```

and after the `<time>`:

```tsx
          {entry.travelModeFrom !== undefined && (
            <span className="ml-2 font-mono text-xs uppercase text-muted-foreground">
              {entry.travelModeFrom}
            </span>
          )}
          {entry.precisionMeters !== undefined && (
            <span className="ml-2 font-mono text-xs text-muted-foreground">
              {precisionLabel(entry.precisionMeters)}
            </span>
          )}
```

**All three render on the server**, inside `TripTimeline`, not in the client row — that is what
kept 4.2 kB out of the trip page's chunk in 4a and it is not negotiable here.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/public/trip-timeline`
Expected: PASS.

- [ ] **Step 5: Prove the bundle did not move**

Run: `npm run build && npm run size:public`
Expected: still ~181.3 kB of 190, and no new chunk on the trip route. **If it grew, something went
into the client row.**

- [ ] **Step 6: Commit**

```bash
git add components/public/trip-timeline
git commit -m "The timeline's other three fields, all of them server-rendered"
```

---

### Task 7: A pin opens the sheet on the row it names

**Files:**
- Modify: `components/public/map-sheet/map-sheet.tsx`, `components/public/map-sheet/notes.md`
- Test: `components/public/map-sheet/map-sheet.test.tsx`

**Interfaces:**
- Consumes: `useTripHighlight()` (Task 1), `targetForRow` (Task 3), `data-slug` (Task 6).
- Produces: nothing new. The sheet reads the context; nothing reads the sheet.

- [ ] **Step 1: Write the failing test**

```tsx
// components/public/map-sheet/map-sheet.test.tsx — add to the existing describe
import { TripHighlightContext, type HighlightValue } from "@/hooks/trip/highlight-context";

const highlight = (over: Partial<HighlightValue>): HighlightValue => ({
  activeSlug: null,
  source: null,
  raise: () => {},
  clear: () => {},
  pin: () => {},
  unpin: () => {},
  ...over,
});

it("a pin reveals its row, never closing the sheet to do it", () => {
  const row = () => <li data-slug="nara">Nara</li>;
  const { container, rerender } = render(
    <TripHighlightContext value={highlight({})}>
      <MapSheet>{row()}</MapSheet>
    </TripHighlightContext>,
  );

  // Stubbed AFTER the first render, so the effect below runs against geometry
  // rather than against jsdom's zeroes.
  offsets(container, { half: 240, body: 640 });
  const li = container.querySelector('[data-slug="nara"]') as HTMLElement;
  vi.spyOn(li, "offsetTop", "get").mockReturnValue(1400);

  rerender(
    <TripHighlightContext value={highlight({ activeSlug: "nara", source: "pin" })}>
      <MapSheet>{row()}</MapSheet>
    </TripHighlightContext>,
  );

  // The exact number, not expect.any(Number): the handle is 0px tall in jsdom,
  // so targetForRow(1400, 0, …) is 1400 and a broken targetForRow cannot pass.
  expect(scrollTo).toHaveBeenCalledWith({ top: 1400, behavior: "smooth" });
});

it("a fresh load on an entry route opens the sheet, once, without animating", () => {
  // The shared-link path: someone opens /trips/japan/nara directly and the
  // entry's prose must not be below the fold.
  render(
    <TripHighlightContext value={highlight({ activeSlug: "nara", source: "route" })}>
      <MapSheet>
        <li data-slug="nara">Nara</li>
      </MapSheet>
    </TripHighlightContext>,
  );

  expect(scrollTo).toHaveBeenCalledTimes(1);
  expect(scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: "auto" });
});

it("a route highlight arriving after mount does NOT move the sheet", () => {
  const { rerender } = render(
    <TripHighlightContext value={highlight({})}>
      <MapSheet>
        <li data-slug="nara">Nara</li>
      </MapSheet>
    </TripHighlightContext>,
  );
  expect(scrollTo).not.toHaveBeenCalled();

  rerender(
    <TripHighlightContext value={highlight({ activeSlug: "nara", source: "route" })}>
      <MapSheet>
        <li data-slug="nara">Nara</li>
      </MapSheet>
    </TripHighlightContext>,
  );

  // Only a pin moves a sheet the reader has already placed.
  expect(scrollTo).not.toHaveBeenCalled();
});
```

**The stubs go on after the first render and the pin arrives on the second.** An effect that runs
on mount against jsdom's zeroes asserts nothing, which is the could-not-fail shape this project
keeps finding.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run components/public/map-sheet/map-sheet.test.tsx`
Expected: FAIL — nothing calls `scrollTo` on a pin.

- [ ] **Step 3: Implement**

In `map-sheet.tsx`:

```tsx
  const { activeSlug, source } = useTripHighlight();

  // A pin is the only highlight that moves the sheet: a route or a hover must
  // not yank the reader's scroll. ./notes.md#only-a-pin-moves-the-sheet
  useEffect(() => {
    if (source !== "pin" || activeSlug === null) return;
    const offsets = measure(halfSpacer.current, body.current);
    const row = rowFor(body.current, activeSlug);
    if (offsets === null || row === null) return;
    scrollToTop(targetForRow(row.offsetTop, handle.current?.offsetHeight ?? 0, offsets));
    // scrollToTop reads refs only; the pin is the whole dependency.
  }, [activeSlug, source]);

  // The initial position, and ONLY the initial one: a fresh load on an entry
  // route opens the sheet so the prose is not below the fold. Empty deps on
  // purpose. ./notes.md#only-a-pin-moves-the-sheet
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (source !== "route") return;
    const offsets = measure(halfSpacer.current, body.current);
    if (offsets !== null) scroller.current?.scrollTo({ top: offsets.full, behavior: "auto" });
  }, []);
```

```tsx
/** Matched on the dataset rather than through a selector: a slug is validated
 *  for length, not for CSS-safe characters. */
function rowFor(body: HTMLElement | null, slug: string): HTMLElement | null {
  if (body === null) return null;
  for (const el of body.querySelectorAll<HTMLElement>("[data-slug]")) {
    if (el.dataset.slug === slug) return el;
  }
  return null;
}
```

Add a `handle` ref on the `<button>`. If `react-hooks/exhaustive-deps` complains about
`scrollToTop`, wrap it in `useCallback` — **do not add an eslint-disable**, and do not add the
refs to the dependency array.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run components/public/map-sheet`
Expected: PASS, 7 cases.

- [ ] **Step 5: Mutation-check**

Change `source !== "pin"` to `source === null` and re-run: the "arriving after mount" case MUST
fail. Then delete the `opened.current` guard: the same case must fail too, because a route
highlight would then move the sheet on every render. Restore both.

- [ ] **Step 6: Commit**

```bash
git add components/public/map-sheet
git commit -m "A pinned entry opens the sheet on its own row"
```

---

### Task 8: The browser cases, and the gate path 4a missed

**Files:**
- Create: `e2e/map-sheet.spec.ts`
- Modify: `e2e/notes.md`, `CLAUDE.md`, `docs/testing-gates.md`

**Interfaces:**
- Consumes: everything above, through a real browser and the seeded Pod.
- Produces: nothing the app imports.

**Before starting:** the seed has two placed entries in `2026-japan`
(`2026-03-29-arrival`, `2026-03-31-nara`), and `nara` carries `dy:precisionMeters 500` and
`dy:travelModeFrom dy:Train` but **no thumbnail** — the thumbnail is covered by Task 6's unit test
and by nothing here. Do not add one to the seed for this.

- [ ] **Step 1: Write the failing spec**

```ts
// e2e/map-sheet.spec.ts
/**
 * The sheet in a real browser: the three snap points the spec measured, the
 * pointer-events pass-through that no unit test can see, and one map instance
 * across all of it. Mutation controls in ./notes.md#the-four-map-sheet-controls
 */

import { expect, test } from "@playwright/test";

const TRIP = "/trips/2026-japan";
const PHONE = { width: 390, height: 800 };
const HANDLE = /resize the entry list/i;

test.describe("the mobile sheet", () => {
  test.use({ viewport: PHONE });

  test("has three snap points, and the same canvas at all of them", async ({ page }) => {
    await page.goto(TRIP);
    const frame = page.getByRole("region", { name: "Trip map" });
    const canvas = frame.locator("canvas");
    await expect(canvas).toBeVisible();
    const first = await canvas.elementHandle();

    const sheet = page.locator(".trip-sheet");
    expect(await sheet.evaluate((el) => el.scrollTop)).toBe(0);

    // half: 30dvh of 800. An exact detent, because the spacers enforce it.
    await page.getByRole("button", { name: HANDLE }).click();
    await expect.poll(() => sheet.evaluate((el) => el.scrollTop)).toBe(240);

    // full is asserted as the BODY'S TOP RECT, not a scrollTop: with a long
    // timeline every position past it is also a valid rest position, so the
    // scrollTop is a floor and the 8dvh strip is the thing that is promised.
    await page.getByRole("button", { name: HANDLE }).click();
    await expect
      .poll(() =>
        page.locator(".trip-sheet-body").evaluate((el) => Math.round(el.getBoundingClientRect().top)),
      )
      .toBe(64);

    expect(await canvas.evaluate((el, was) => el === was, first)).toBe(true);
  });

  test("a marker is tappable through the sheet, and the tap pins its row", async ({ page }) => {
    await page.goto(TRIP);
    const marker = page.locator('[data-slug="2026-03-31-nara"]');
    await expect(marker).toBeVisible();

    // The measurement from spec §2, in the real page: what is on top at the
    // marker's own centre. At pointer-events:auto this returns the sheet.
    const box = await marker.boundingBox();
    if (box === null) throw new Error("the marker has no box");
    const onTop = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.closest("[data-slug]")?.getAttribute("data-slug"),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(onTop).toBe("2026-03-31-nara");

    await marker.click();
    await expect(page.locator(`li:has(a[href="${TRIP}/2026-03-31-nara"])`)).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  test("a tap on the map itself clears the pin", async ({ page }) => {
    await page.goto(TRIP);
    const marker = page.locator('[data-slug="2026-03-31-nara"]');
    await expect(marker).toBeVisible();
    const row = page.locator(`li:has(a[href="${TRIP}/2026-03-31-nara"])`);

    await marker.click();
    await expect(row).toHaveAttribute("data-active", "true");

    // A corner of the map the markers are nowhere near.
    await page.mouse.click(20, 20);
    await expect(row).not.toHaveAttribute("data-active", "true");
  });
});

test("at desktop width the sheet is a column and the map is sticky, still one canvas", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(TRIP);
  const canvas = page.getByRole("region", { name: "Trip map" }).locator("canvas");
  await expect(canvas).toBeVisible();
  const first = await canvas.elementHandle();

  const position = await page
    .locator(".trip-sheet")
    .evaluate((el) => getComputedStyle(el).position);
  expect(position).toBe("static");
  const pane = await page
    .locator(".trip-map-pane")
    .evaluate((el) => getComputedStyle(el).position);
  expect(pane).toBe("sticky");

  await page.mouse.wheel(0, 400);
  expect(await canvas.evaluate((el, was) => el === was, first)).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails, and read WHICH failure**

Run: `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e e2e/map-sheet.spec.ts`
Expected: PASS, because Tasks 4–7 already landed. **That is the wrong kind of green.** Prove each
case can fail before keeping it — Step 3.

- [ ] **Step 3: Mutation-control every case, one at a time**

Make the change, run the spec, confirm the named case goes red, revert:

| Mutation | Must break |
|---|---|
| `app/globals.css`: `.trip-sheet { pointer-events: auto }` | the pass-through case |
| `use-map-markers.ts`: delete `event.stopPropagation()` | the pin case (pinned, then cleared) |
| `map-sheet.tsx`: put the ref on `.trip-sheet-spacer-peek` | the three-snap-point case |
| `app/globals.css`: delete `scroll-margin-top` from `.trip-sheet-body` | the `toBe(64)` assertion |
| `layout.tsx`: move the map pane inside `<MapSheet>` | the desktop case's `position` assertions |

**If any mutation leaves everything green, the case is decorative — fix the case, not the
mutation.** Record the five in `e2e/notes.md` under `## the four map-sheet controls` (rename the
anchor if you keep five; the spec's reference must resolve).

- [ ] **Step 4: Put `hooks/trip/**` on the gate**

`CLAUDE.md`, in the path-scoped `test:e2e` block, add `hooks/trip/**` to the last line:

```
components/public/**   lib/map/**   hooks/map/**   hooks/trip/**
```

`docs/testing-gates.md`: one paragraph — `hooks/trip/**` holds the highlight state both the map and
the timeline read, and it was created by 4a and added to the ESLint belt but not here. A hooks area
must join **both** lists in the same commit; this one did not, and nothing failed, because
`components/public/**` fires the gate anyway for every diff that has touched it so far.

- [ ] **Step 5: Verify the gate edit is not merely decorative**

Run: `npm run check:commands` and `npm test`
Expected: PASS. If a test pins the gate list (there is one in `test/` that reads `CLAUDE.md`),
update its fixture rather than loosening it.

- [ ] **Step 6: Commit**

```bash
git add e2e CLAUDE.md docs/testing-gates.md
git commit -m "Four browser cases for the sheet, and the gate path 4a left out"
```

---

### Task 9: §26, the retraction, and the three places that echo it

**Files:**
- Modify: `docs/decisions.md`, `docs/versions.md`, `TODO.md`

**Interfaces:** none. This task ships no code.

- [ ] **Step 1: Write §26 in its reserved slot**

Between §25 and §27 in `docs/decisions.md`:

```markdown
## 26. The public sheet is hand-rolled; the trip shell is one responsive tree

`vaul` stays studio-only and stays in `BANNED_DEPS`. The public sheet is about ninety lines of
CSS and one component, and it was cheaper to write than the alternative was to fence: carving
`vaul` out of the public group would open the hole the composition scan exists to close, on a
library last published in 2024-12 whose snap-point API this repository has never verified.

**Measured before it was designed** (2026-09-14, headless Chromium, 390×800). Three snap points
in ONE scroller rest at 0 / 240 / 640; a body taller than the viewport rests freely past the last
of them, which is the CSS Scroll Snap large-snap-area rule and is what lets a long timeline scroll
without the sheet yanking. And `pointer-events` is load-bearing: with the fixed scroller at
`auto`, `elementFromPoint` over the map returns the scroller and **every marker is untappable,
silently**.

**The map is a sibling of the sheet at every width, and nothing branches the tree on viewport
width.** That is `CLAUDE.md`'s never-remounted rule expressed as a shape rather than a rule, and
it is why the desktop layout landed in the same stage: reshaping the tree twice is how a rule like
that rots.

**Consequences.** The geometry lives in `app/globals.css`, not in `className` strings — `calc()`
over viewport units is an arbitrary value, and the breakpoint is then spelled once. iOS Safari is
unverified: Playwright here is Chromium, and `dvh` under a collapsing toolbar is the likeliest
place for this to be wrong.

**This decision withdraws a sentence from §11**, which claimed shadcn's Drawer "provides the
snap-point sheet the mobile map layout needs" while the same decision forbade shadcn on public
reading pages. §11 is amended rather than left standing.

---
```

- [ ] **Step 2: Amend §11**

Delete the sentence "Its Drawer wraps Vaul and provides the snap-point sheet the mobile map layout
needs." and add, at the end of §11's **Consequences**:

```markdown
**Amended 2026-09-14.** This decision used to claim shadcn's Drawer provides the mobile map
layout's snap-point sheet, contradicting its own next paragraph. §26 withdraws that: the public
sheet is hand-rolled and no shadcn component reaches a public reading page.
```

- [ ] **Step 3: Correct the two places that echoed it**

`docs/versions.md`, the `vaul` note (around line 165): it backs shadcn's Drawer in the **studio**;
the public map sheet is hand-rolled per §26, so its snap-point API needs no verification for that
purpose. `TODO.md`'s phase 0.5 line that asks to verify vaul's snap-point API: same correction,
struck with a pointer to §26 rather than deleted.

- [ ] **Step 4: Close the phase 4 checkbox**

In `TODO.md`'s phase 4 section, tick "Mobile drawer with three snap points" and write the stage's
record underneath in the shape the earlier stages use: the plan path, the task count, the suite
numbers actually read, `size:public`, and what stayed open — iOS Safari unverified, the camera fit
not adjusted for the sheet (a marker can sit under it at peek), and the stage-3 defect still
unreachable until stage 5.

- [ ] **Step 5: Verify the documentation checks**

Run: `npm run check:commands`, `npm run check:structure`, `npm test`
Expected: PASS. `test/` has a case that reads `docs/decisions.md`'s numbering — if §26 lands out
of order it will say so.

- [ ] **Step 6: Commit**

```bash
git add docs TODO.md
git commit -m "Decision 26, and the sentence it withdraws from decision 11"
```

---

## Definition of done for the whole stage

Run every one of these, **read the output**, and only then say the stage is done. `node -v` must
print `v22.x` first.

```sh
npm run pod:dev &                       # FIRST, or the integration tests skip and report green
npm test                                # expect > 1728 passed, 2 todo, 0 skipped
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure                 # active exemptions — 0 stays 0; max-lines only
npm run format:check
npm run build
npm run size:public                     # 190 kB ceiling; 181.3 kB is the baseline to hold
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e   # expect 17 passed (13 + 4)
```

**The integration control, both halves.** With the Pod up, `test/integration/` must RUN — not
skip. Kill the Pod and re-run: the same two files must report skipped. A `npm test` that never
mentions them is the half-check `CLAUDE.md` names.

**Then run the whole list again on the merge result**, before pushing, as every stage since 3 has.

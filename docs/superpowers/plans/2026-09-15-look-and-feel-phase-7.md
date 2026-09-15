# Look and Feel (Phase 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repository's own loop (CLAUDE.md "How work is done here") is mandatory: `test-specialist` writes the failing test, `nextjs-specialist`/`solid-specialist` implement, `fullstack-solid-reviewer` reviews the diff. Both, always.

**Goal:** Apply the phase-7 visual language — Syne + DM Mono, a type scale, the body-on-dark treatment, the arc route and restyled markers, and page view transitions — to every public surface, leaving the studio deliberately plain.

**Architecture:** Two self-hosted typefaces via `next/font/google` feed CSS custom properties in `app/globals.css`; a set of plain CSS type classes (ported from the `.mockups/`) is applied to the existing server-rendered markup. No component changes behaviour and nothing new becomes a client component. The map's leg becomes a great-circle arc with a `line-gradient` fade (no casing, no dash); markers shrink to 26px with a soft halo. Appearance is guarded by a type-family drift test modelled on `lib/map/tokens.test.ts`, by the arbitrary-value lint rule, and by the existing browser cases, which assert structure and behaviour rather than pixels.

**Tech Stack:** Next.js 16 (App Router, RSC), Tailwind v4 (CSS-first), `next/font/google` (Syne, DM Mono), MapLibre GL 6, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-look-and-feel-phase-7-design.md` (authority: `docs/design-brief.md`). The mockups in `.mockups/` (`_shared.css`, `entry.html`, `trip.html`, `route.html`) are the design record — their CSS is the source to port.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec and brief.

- **Node 22 before any check.** The shell defaults to Node 20; run `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` and confirm `node -v` prints `v22.x`. A green result on Node 20 proves less than it looks (CLAUDE.md).
- **The palette does not change.** All eight brand tokens and three map colours are already correct in `app/globals.css` under `@theme`. This phase adds type and rhythm, not colour. Hexes: `bg #070B0F`, `surface #10151B`, `hairline #272F37`, `text-muted #9399A0`, `text #E2E5E8`, `accent #1295FC`, `accent-bright #84C0FD`, `accent-deep #034F8A`; `map-land #101316`, `map-water #152026`, `map-label #70757A`.
- **Type scale (spec §3), exact values:** Display — Syne, `clamp(2.75rem, 9vw, 7rem)`, uppercase, 800, tracking `0.02em`, leading `0.94`. Display-small — Syne, `clamp(1.5rem, 3.5vw, 2.25rem)`, uppercase, 700, `0.01em`, `1.05`. Body — Syne, `17px`, 400, leading `1.75`, measure `66ch`. Interface — Syne, `0.95rem`, 400/500, `1.45`. Data — DM Mono, `0.78rem`, 400, `0.01em`, `1.5`. Label — DM Mono, `0.68rem`, uppercase, 400, `0.08em`, `1.5`.
- **Weights loaded:** Syne 400 / 700 / 800 (use the variable cut — one file covers the range), DM Mono 400 only. Latin subset. `display: swap`.
- **Body on dark:** `--text` on `--bg`, leading `1.75`, measure `66ch`.
- **Numbering:** entries within a trip ARE numbered (`01`–`nn`, a sequence); the diary's trips are NOT (a set). This is already the state — timeline and trip-list both use `list-decimal`; the diary list must lose its numbering in Task 5.
- **Mono is for data only:** coordinates, dates, times, offsets, travel modes, precision labels, the status line. Not titles, prose, buttons, navigation.
- **Precision changes rendering:** a fuzzed coordinate → two decimals + soft circle; an exact one → four decimals + square. (`precisionMeters === undefined` means exact.)
- **No new client component.** Every styling change is CSS + server-rendered markup. If a treatment seems to need `"use client"`, find another treatment.
- **No arbitrary Tailwind values** outside `components/ui/**` (enforced by lint and by `marker-element.test.ts`). New sizes that have no Tailwind step (e.g. 26px) go in a named CSS class in `globals.css`, never `size-[26px]`.
- **One family, declared once.** No hard-coded `font-family` and no literal `Syne`/`DM Mono` anywhere in `app/**` or `components/**` (outside `components/ui/**`) except the single `next/font` call. Guarded by the Task 1 drift test.
- **Bundle gate:** `size:public` is at 182.4 kB of 190 before this phase. Fonts are woff2 and are NOT weighed by it, so its silence is not approval. If `size:public` moves, something was built the wrong way — treat any movement as a defect to explain, not a budget to spend.
- **View transitions are CSS-first.** The browser API needs no library; `next/link` already navigates. If a transition needs JS beyond an opt-in class, it does not ship. Respect `prefers-reduced-motion: reduce`.
- **Two decisions this phase records (see Task 9), both overriding a written rule:** the route line loses its casing (overrides `docs/design-brief.md` "the route line needs a casing"); and the on-map travel-mode dash is dropped in favour of the origin fade (overrides spec §10 as written — travel mode remains in the timeline chip). Both were settled with the maintainer on 2026-09-15.

---

### Task 1: Load the typefaces and wire the tokens

Self-host Syne and DM Mono via `next/font/google`, point the three font custom properties at them, and add a drift guard so the families are declared once and never hard-coded.

**Files:**
- Create: `lib/fonts.ts`
- Create: `lib/fonts.test.ts`
- Modify: `app/globals.css:44-46` (the self-referential font vars)
- Modify: `app/(public)/layout.tsx:19-23` (`<html lang="en">`)
- Modify: `app/(studio)/layout.tsx:6-12` (`<html lang="en">`)
- Modify: `app/not-found.tsx:19-21` (root 404 renders its own `<html>`)

**Interfaces:**
- Produces: `lib/fonts.ts` exports `syne` and `dmMono` (the `next/font/google` return objects) and `FONT_CLASS: string` — the space-joined `.variable` classes (`` `${syne.variable} ${dmMono.variable}` ``) applied to every root `<html>`. The generated CSS variables are `--font-syne` and `--font-dm-mono`.
- Consumes: nothing from earlier tasks.

- [ ] **Step 1: Write the failing drift test**

`lib/fonts.test.ts` — modelled on `lib/map/tokens.test.ts` (reads `globals.css` from disk, regex-scrapes, asserts no drift):

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { globSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { syne, dmMono, FONT_CLASS } from "@/lib/fonts";

const root = new URL("../", import.meta.url);
const CSS = readFileSync(fileURLToPath(new URL("app/globals.css", root)), "utf8");

describe("font tokens against app/globals.css", () => {
  it("points --font-sans at the Syne variable, not at itself", () => {
    expect(CSS).toMatch(/--font-sans:\s*var\(--font-syne\)/);
    expect(CSS).not.toMatch(/--font-sans:\s*var\(--font-sans\)/);
  });

  it("points --font-mono at the DM Mono variable", () => {
    expect(CSS).toMatch(/--font-mono:\s*var\(--font-dm-mono\)/);
    expect(CSS).not.toMatch(/--font-geist-mono/);
  });

  it("exposes the variable names the loaders generate", () => {
    expect(syne.variable).toBe("--font-syne");
    expect(dmMono.variable).toBe("--font-dm-mono");
    expect(FONT_CLASS).toContain(syne.variable);
    expect(FONT_CLASS).toContain(dmMono.variable);
  });

  it("declares the families once — no hard-coded font-family in app or components", () => {
    const files = globSync("{app,components}/**/*.{ts,tsx,css}", {
      cwd: fileURLToPath(root),
    }).filter((f) => !f.includes("components/ui/"));
    for (const rel of files) {
      const src = readFileSync(fileURLToPath(new URL(rel, root)), "utf8");
      expect(src, rel).not.toMatch(/font-family\s*:/);
      expect(src, rel).not.toMatch(/["'`](Syne|DM Mono)["'`]/);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; npx vitest run lib/fonts.test.ts`
Expected: FAIL — `lib/fonts.ts` does not exist, and `--font-sans: var(--font-sans)` is self-referential.

- [ ] **Step 3: Create `lib/fonts.ts`**

```ts
import { Syne, DM_Mono } from "next/font/google";

// Syne ships a variable cut (400–800); one file covers display, subheads and
// body. DM Mono is static — 400 only. Latin subset, swap. See phase-7 spec §2.
export const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  display: "swap",
});

export const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-dm-mono",
  display: "swap",
});

export const FONT_CLASS = `${syne.variable} ${dmMono.variable}`;
```

- [ ] **Step 4: Repoint the font vars in `app/globals.css`**

Replace lines 44-46 inside `@theme inline`:

```css
  --font-sans: var(--font-syne), system-ui, sans-serif;
  --font-mono: var(--font-dm-mono), ui-monospace, monospace;
  --font-heading: var(--font-syne), system-ui, sans-serif;
```

- [ ] **Step 5: Apply `FONT_CLASS` to every root `<html>`**

In `app/(public)/layout.tsx` — import `{ FONT_CLASS }` from `@/lib/fonts` and change the element to `<html lang="en" className={FONT_CLASS}>`. Do the same in `app/(studio)/layout.tsx` and `app/not-found.tsx`. (There is no `app/layout.tsx`; these three are the only roots.)

- [ ] **Step 6: Run the drift test and the full unit suite**

Run: `npx vitest run lib/fonts.test.ts && npx vitest run`
Expected: PASS. The four assertions hold and nothing else regresses.

- [ ] **Step 7: Verify the fonts actually load in a build**

Run: `npm run build && npm run size:public`
Expected: build succeeds; `size:public` is unchanged within rounding (fonts are woff2, not weighed). If it moved, stop and explain why before continuing.

- [ ] **Step 8: Commit**

```bash
git add lib/fonts.ts lib/fonts.test.ts app/globals.css "app/(public)/layout.tsx" "app/(studio)/layout.tsx" app/not-found.tsx
git commit -m "Load Syne and DM Mono, and wire the empty type tokens"
```

---

### Task 2: The type-scale primitives and the status footer

Port the mockup type classes into `globals.css` and add the one shared component this phase introduces — the deadpan status line (`.mockups/_shared.css` `footer.status`), rendered in the public layout. This gives the CSS primitives a first, testable consumer.

**Files:**
- Modify: `app/globals.css` (append a type-scale block after the existing `@layer base`)
- Create: `components/public/site-footer/site-footer.tsx`
- Create: `components/public/site-footer/index.ts`
- Create: `components/public/site-footer/site-footer.test.tsx`
- Create: `components/public/site-footer/notes.md`
- Modify: `app/(public)/layout.tsx` (render `<SiteFooter/>` after `{children}`)

**Interfaces:**
- Consumes: the font tokens from Task 1.
- Produces: CSS classes `display`, `display-sm`, `prose`, `data`, `data-lg`, `label`, `aside`, `status-line`, and the layout wrappers `wrap` / `meta-row` / `precision` used by Tasks 3–5. `<SiteFooter siteName={string} />` — a server component rendering `<footer class="status-line">` with two mono spans (the project tagline and a per-page status, defaulted here to the diary tagline).

- [ ] **Step 1: Write the failing footer test**

`components/public/site-footer/site-footer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("renders the status line as a contentinfo landmark", () => {
    render(<SiteFooter siteName="where i go" />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toHaveClass("status-line");
    expect(footer).toHaveTextContent(/where i go/i);
    expect(footer).toHaveTextContent(/solid pod/i);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run components/public/site-footer/site-footer.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Append the type scale to `app/globals.css`**

After the existing `@layer base { ... }` block (currently ending at line 125), add — values verbatim from the Global Constraints scale and `.mockups/_shared.css`:

```css
/* Phase-7 type scale. Ported from .mockups/_shared.css; the mockups are the
   design record. Plain classes, not @apply — Tailwind v4 is CSS-first and the
   arbitrary-value ban keeps these out of className. Spec §3. */
.wrap { max-width: 78rem; margin-inline: auto; padding-inline: clamp(1.25rem, 4vw, 3rem); }
.prose { max-width: 66ch; }
.prose p { margin: 0 0 1.6em; }

.display {
  margin: 0;
  font-weight: 800;
  font-size: clamp(2.75rem, 9vw, 7rem);
  line-height: 0.94;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.display-sm {
  margin: 0;
  font-weight: 700;
  font-size: clamp(1.5rem, 3.5vw, 2.25rem);
  line-height: 1.05;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}

.data {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  letter-spacing: 0.01em;
  color: var(--color-text-muted);
}
.data-lg { font-family: var(--font-mono); font-size: 0.95rem; color: var(--color-text-muted); }

.label {
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-accent-deep);
}

.aside { font-family: var(--font-mono); font-size: 0.78rem; color: var(--color-text-muted); opacity: 0.75; }
.aside::before { content: "// "; color: var(--color-accent-deep); }

.status-line {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  justify-content: space-between;
  margin-top: 6rem;
  padding: 1.25rem clamp(1.25rem, 4vw, 3rem) calc(3rem + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid var(--color-hairline);
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--color-text-muted);
}

.meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.25rem 2.5rem;
  margin-top: clamp(1.5rem, 4vh, 2.25rem);
  padding-top: 1.25rem;
  border-top: 1px solid var(--color-hairline);
}
.meta-row dt { margin: 0 0 0.3rem; font-family: var(--font-mono); font-size: 0.68rem;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-accent-deep); }
.meta-row dd { margin: 0; font-family: var(--font-mono); font-size: 0.86rem; color: var(--color-text-muted); }

/* A fuzzed coordinate is a soft circle, an exact one a square. The shape is the
   claim the data makes. docs/design-brief.md; lib/place/precision.ts owns decimals. */
.precision { display: inline-flex; align-items: center; gap: 0.45rem; }
.precision::before {
  content: ""; width: 9px; height: 9px; flex: none;
  border: 1.5px solid var(--color-accent); border-radius: 50%; opacity: 0.85;
}
.precision.exact::before { border-radius: 2px; opacity: 1; }
```

Note: `font-family` appears here in `globals.css`, but the Task 1 drift test only scans `.ts/.tsx/.css` under `app/` and `components/` — `app/globals.css` IS scanned. So the drift test's `font-family` assertion must exempt `globals.css` (the one place families are wired). Update `lib/fonts.test.ts` Step-1 glob filter to also drop `app/globals.css`:

```ts
    }).filter((f) => !f.includes("components/ui/") && f !== "app/globals.css");
```

Make that edit as part of this task and re-run `lib/fonts.test.ts` to keep it green.

- [ ] **Step 4: Write the footer component and barrel**

`components/public/site-footer/site-footer.tsx`:

```tsx
export function SiteFooter({ siteName, status }: { siteName: string; status?: string }) {
  return (
    <footer className="status-line">
      <span>{siteName} — a travel diary that stores its own data in a solid pod</span>
      {status !== undefined && <span>{status}</span>}
    </footer>
  );
}
```

`components/public/site-footer/index.ts`:

```ts
export { SiteFooter } from "./site-footer";
```

`components/public/site-footer/notes.md`: one line — `# SiteFooter` and a pointer to spec §5 (the status line is mono, deadpan, from the reference).

- [ ] **Step 5: Render it in the public layout**

In `app/(public)/layout.tsx`, import `{ SiteFooter }` and `{ config }` (already imported) and render `<SiteFooter siteName={config.siteName} />` after `{children}` inside `<body>`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run components/public/site-footer lib/fonts.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css lib/fonts.test.ts "components/public/site-footer" "app/(public)/layout.tsx"
git commit -m "The type scale, and the deadpan status line the reference wants"
```

---

### Task 3: Restyle the entry page

The entry page is where the "type is the entrance, photographs carry" sequence is proven. Apply the display masthead, mono meta row, precision typography, and body prose. Port `.mockups/entry.html`.

**Files:**
- Modify: `app/(public)/trips/[slug]/[entry]/page.tsx:50-91` (`EntryContent`)
- Create/Modify test: `app/(public)/trips/[slug]/[entry]/entry-page.test.tsx` (add structural assertions; if no test file exists, create one)

**Interfaces:**
- Consumes: the type classes from Task 2. `e.value` fields: `headline`, `occurredAt`, `place`, `articleBody` (confirmed shapes from the current file). Coordinates are NOT currently rendered on this page — the meta row adds them from `e.value.place` if present; if the read model exposes no lat/long here, render only the fields that exist (headline, date, place name, precision) and do not invent coordinates.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing structural test**

Assert the masthead uses the display class, the date is mono, and the precision element carries `exact` only when precision is exact. Render `EntryContent` (or the page) with a fake read result. Follow the existing test harness pattern in the `[entry]` directory (check for a sibling `*.test.tsx`; reuse its Pod-read fake). Skeleton:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// import the page/EntryContent and the read fake exactly as the existing entry tests do

it("sets the headline in the display cut", async () => {
  // ... render with a fake entry { headline: "Under Fitz Roy", occurredAt, place }
  expect(screen.getByRole("heading", { level: 1 })).toHaveClass("display");
});

it("renders the arrival time in mono", async () => {
  // the <time> element carries the `data` class (mono)
  expect(screen.getByText(/2025-03-09/)).toHaveClass("data");
});
```

Confirm the exact render entry point and fake by reading the existing `[entry]` test before writing; do not guess the fake's shape.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run "app/(public)/trips/[slug]/[entry]"`
Expected: FAIL — `text-2xl`, not `display`; the date has no `data` class.

- [ ] **Step 3: Restyle `EntryContent`**

Replace the inline markup (current lines 74-90) with the display masthead + meta row + prose, mirroring `.mockups/entry.html`. The h1 becomes `<h1 className="display">`; wrap the page body in `.wrap`; the date/place/precision go into a `<dl className="meta-row">` with mono `dt`/`dd`; the article body becomes `<div className="prose"> ... </div>` with `whitespace-pre-line` kept. Render precision with `<span className={precisionMeters === undefined ? "precision exact" : "precision"}>`. Keep the "Back to the trip" link but restyle it as a mono `.label` + Syne 700 link per the mockup's `.nextprev`. Do NOT add coordinates unless the read model already exposes them here.

- [ ] **Step 4: Run the test and the entry e2e**

Run: `npx vitest run "app/(public)/trips/[slug]/[entry]"`
Expected: PASS. The masthead is display, the date is mono, precision toggles `exact`.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/trips/[slug]/[entry]"
git commit -m "Entry page: type is the entrance, the photographs carry"
```

---

### Task 4: Restyle the trip page

Full-width display masthead above the map/timeline split (spec §4 — Syne 800 does not fit the 34rem column), mono dates, and the numbered timeline with restyled rows. Port `.mockups/trip.html`.

**Files:**
- Modify: `app/(public)/trips/[slug]/page.tsx:58-106` (`TripContent`)
- Modify: `app/(public)/trips/[slug]/layout.tsx` (move the masthead full-width above `.trip-shell`, if the masthead is to span both columns)
- Modify: `components/public/trip-timeline/trip-timeline.tsx` (row typography: title in interface Syne, meta in mono `data`/`label`, precision shape)
- Modify test: `components/public/trip-timeline/trip-timeline.test.tsx` (adjust class assertions), and `app/(public)/trips/[slug]/*.test.tsx`

**Interfaces:**
- Consumes: Task 2 classes; `trip.value` (`name`, `description`, `startDate`, `endDate`); `index.value.entries` (each with `title`, `occurredAt`, `travelModeFrom?`, `precisionMeters?`, `thumbnail?`, `slug`).
- Produces: nothing later tasks consume.

- [ ] **Step 1: Write the failing tests**

For `trip-timeline.tsx`: assert the entry title is NOT a raw `text-accent-bright underline` link but the interface treatment, the date carries `data`, the travel mode carries `label`, and precision carries the shape class. For `TripContent`: assert the trip name is `display` and the dates are mono. Read the existing `trip-timeline.test.tsx` first and extend it; keep the list numbering assertions (they must stay — a trip is a sequence).

```tsx
// trip-timeline.test.tsx — extend the existing file
it("sets the entry date in mono data type", () => {
  // render one entry with occurredAt
  expect(screen.getByText(/2026-03-29/).closest("time")).toHaveClass("data");
});
it("renders travel mode as a mono label", () => {
  expect(screen.getByText("Train")).toHaveClass("label");
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run components/public/trip-timeline "app/(public)/trips/[slug]"`
Expected: FAIL.

- [ ] **Step 3: Restyle**

`TripContent`: `<h1 className="display">` for the trip name; dates in `<p className="data-lg">`; description as muted interface text. Move the masthead out of the `<main className="mx-auto max-w-2xl p-8">` column so it spans full width above `.trip-shell` — the cleanest place is the `[slug]/layout.tsx`, rendering the masthead above `{children}`'s shell, OR a full-bleed masthead block in `TripContent` that breaks out of the column with `.wrap`. Prefer the layout move (spec §4 is explicit the masthead spans both columns). Keep `TripMap`/`MapSheet`/`TripHighlightProvider` wiring untouched.

`trip-timeline.tsx`: title link → Syne interface weight (drop the underline; keep the accent on hover/active only); date `<time className="data">`; travel mode `<span className="label">` (replaces `font-mono text-xs uppercase text-muted-foreground`); precision `<span className={precisionMeters === undefined ? "precision" : "precision exact"}>` around the label. Keep the `list-decimal` numbering and the `data-active` surface treatment.

- [ ] **Step 4: Run tests + the trip e2e-relevant unit cases**

Run: `npx vitest run components/public/trip-timeline "app/(public)/trips/[slug]"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/trips/[slug]" components/public/trip-timeline
git commit -m "Trip page: the masthead spans full width, the timeline goes quiet"
```

---

### Task 5: Restyle the diary page and unnumber the trip list

The diary is a set, not a sequence — its list loses the decimal numbering (Global Constraints; spec §5). Apply the display masthead and the status line.

**Files:**
- Modify: `app/(public)/page.tsx:49-89` (`DiaryContent`, `DiarySkeleton`)
- Modify: `components/public/trip-list/trip-list.tsx` (drop `list-decimal`; restyle rows)
- Modify test: `components/public/trip-list/trip-list.test.tsx`

**Interfaces:**
- Consumes: Task 2 classes; `diary.value` (`title?`, `description?`); `trips` (each `slug`, `name`, dates).
- Produces: nothing later.

- [ ] **Step 1: Write the failing test**

```tsx
// trip-list.test.tsx — extend
it("does not number the trips — a diary is a set", () => {
  const { container } = render(/* TripList with two trips */);
  expect(container.querySelector("ol.list-decimal, ol[class*='list-decimal']")).toBeNull();
});
it("sets trip dates in mono", () => {
  expect(screen.getByText(/2026-03-28/)).toHaveClass("data");
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run components/public/trip-list "app/(public)/page"`
Expected: FAIL — the list is currently `list-decimal`.

- [ ] **Step 3: Restyle**

`trip-list.tsx`: change `<ol className="mt-8 list-inside list-decimal space-y-1">` to an unnumbered `<ul>` (spec §5 — a set). Trip name in Syne interface weight; dates `<span className="data">`. Keep `TripRow`'s hover/focus highlight.
`DiaryContent`: `<h1 className="display">` for the diary title; description as muted interface text; render `<SiteFooter siteName={...} status="…" />` only if the layout footer is not already sufficient (avoid a double footer — the layout renders one globally, so `DiaryContent` should NOT add a second; instead pass a per-page status up if desired, otherwise leave the global footer). `DiarySkeleton` height classes stay.

- [ ] **Step 4: Run tests**

Run: `npx vitest run components/public/trip-list "app/(public)/page"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(public)/page.tsx" components/public/trip-list
git commit -m "Diary page: a set, not a sequence — the numbering comes off"
```

---

### Task 6: The route becomes a fading arc — no casing, no dash

Turn the straight two-point leg into a great-circle arc, fade it from the origin with `line-gradient` (needs `lineMetrics: true`), drop the casing and the travel-mode dash, and move the active-leg highlight from `line-color` to `line-width` keyed on feature-state. Width 2.5 → 1.5. Remove the now-dead `lib/map/dashes.ts`. **Records decisions §34 (casing) and §35 (dash → fade) in Task 9.**

**Files:**
- Modify: `lib/map/legs.ts` (arc geometry)
- Modify: `lib/map/view.ts:15-18` (`ROUTE_WIDTH` 2.5 → 1.5; remove `CASING_EXTRA`; add `ROUTE_WIDTH_ACTIVE`)
- Modify: `hooks/map/use-map-layers.ts` (source `lineMetrics: true`; delete casing layer; `line-gradient`; feature-state `line-width`; remove `line-dasharray` and the `DASH_BY_MODE` import)
- Delete: `lib/map/dashes.ts`, `lib/map/dashes.test.ts`
- Modify test: `lib/map/legs.test.ts`, `hooks/map/use-map-layers.test.ts`, `e2e/trip-timeline.spec.ts`

**Interfaces:**
- Consumes: `MAP_COLORS` (`accent`, `accentBright`); `LEGS_SOURCE`, `LAYERS` (`casing` removed). `buildLegs(entries)` keeps its signature `→ FeatureCollection<LineString, LegProps>` where `LegProps = { mode, fromSlug, toSlug }` (mode retained on the feature even though the map no longer draws it — the timeline chip is a separate render path; keep the property so nothing else breaks). The feature id is still `promoteId: "toSlug"`.
- Produces: `arcCoordinates(from: [number, number], to: [number, number], segments?: number): Position[]` in `lib/map/legs.ts` — the interpolated great-circle points, exported for its own test.

- [ ] **Step 1: Write the failing arc test**

`lib/map/legs.test.ts` — extend:

```ts
import { arcCoordinates, buildLegs } from "./legs";

it("interpolates an arc between the two endpoints, bowed off the chord", () => {
  const pts = arcCoordinates([139.7, 35.7], [135.8, 34.7], 24);
  expect(pts.length).toBe(25); // segments + 1
  expect(pts[0]).toEqual([139.7, 35.7]);
  expect(pts[pts.length - 1]).toEqual([135.8, 34.7]);
  // a midpoint lies off the straight chord (great-circle bow)
  const chordMidLat = (35.7 + 34.7) / 2;
  expect(pts[12][1]).not.toBeCloseTo(chordMidLat, 5);
});

it("emits one arc LineString per leg, keeping the destination's mode", () => {
  const fc = buildLegs(/* two placed entries, second Train */);
  expect(fc.features).toHaveLength(1);
  expect(fc.features[0].geometry.coordinates.length).toBeGreaterThan(2);
  expect(fc.features[0].properties.mode).toBe("Train");
});
```

- [ ] **Step 2: Run and watch fail**

Run: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; npx vitest run lib/map/legs.test.ts`
Expected: FAIL — `arcCoordinates` undefined; `buildLegs` still emits 2-vertex lines.

- [ ] **Step 3: Add the arc to `lib/map/legs.ts`**

Add a great-circle interpolation (spherical slerp of the two lng/lat points) and use it in `buildLegs`:

```ts
import type { Position } from "geojson";

const D2R = Math.PI / 180;

// Great-circle interpolation. On the globe this is the path actually travelled;
// on the trip map it reads as a journey, not a vector. Spec §6.
export function arcCoordinates(from: Position, to: Position, segments = 24): Position[] {
  const [lon1, lat1] = [from[0] * D2R, from[1] * D2R];
  const [lon2, lat2] = [to[0] * D2R, to[1] * D2R];
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((lat2 - lat1) / 2) ** 2 +
          Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
      ),
    );
  if (d === 0) return [from, to];
  const out: Position[] = [];
  for (let i = 0; i <= segments; i++) {
    const f = i / segments;
    const a = Math.sin((1 - f) * d) / Math.sin(d);
    const b = Math.sin(f * d) / Math.sin(d);
    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);
    out.push([Math.atan2(y, x) / D2R, Math.atan2(z, Math.sqrt(x * x + y * y)) / D2R]);
  }
  return out;
}
```

In `buildLegs`, replace the `coordinates: [[from.long, from.lat], [to.long, to.lat]]` with `coordinates: arcCoordinates([from.long, from.lat], [to.long, to.lat])`. Keep `properties` unchanged. Add a `notes.md` line if `lib/map/notes.md` exists, pointing at spec §6 for the arc/fade decision.

- [ ] **Step 4: Update the layer test first, then the layer**

`hooks/map/use-map-layers.test.ts`:
- Change the "all four layers" expectation to three: `[LAYERS.line, LAYERS.clusters, LAYERS.clusterCount]`.
- Delete the "draws the casing before the line" case.
- Change the length-4 assertion to length-3.
- Replace the "paints the active leg with the bright accent" (line-color case) with: the line layer sets `line-gradient` (a `line-progress` interpolation from `accent` to `accentBright`), sets NO `line-dasharray`, and sets `line-width` as a feature-state `case` (`ROUTE_WIDTH_ACTIVE` when active, else `ROUTE_WIDTH`). Assert the source is created with `lineMetrics: true`.
- Keep the `promoteId: "toSlug"` assertion.

Run: `npx vitest run hooks/map/use-map-layers.test.ts` — Expected: FAIL (still four layers, still line-color case).

- [ ] **Step 5: Rewrite the layer + constants**

`lib/map/view.ts`:

```ts
export const ROUTE_WIDTH = 1.5;
export const ROUTE_WIDTH_ACTIVE = 2.5;
// (CASING_EXTRA deleted — the route no longer has a casing. docs/decisions.md §34.)
```

`hooks/map/use-map-layers.ts`:
- Source: add `lineMetrics: true` to the `addSource` options.
- Delete the entire `LAYERS.casing` `addLayer` block and remove `casing` from the `LAYERS` object.
- Remove the `DASH_BY_MODE` import and the `"line-dasharray"` paint key.
- Line layer paint becomes:

```ts
paint: {
  "line-gradient": [
    "interpolate",
    ["linear"],
    ["line-progress"],
    0, ["to-color", MAP_COLORS.accent],
    0.5, ["to-color", MAP_COLORS.accent],
    1, ["to-color", MAP_COLORS.accentBright],
  ],
  "line-opacity": [
    "interpolate",
    ["linear"],
    ["line-progress"],
    0, 0.25,
    1, 0.95,
  ],
  "line-width": [
    "case",
    ["boolean", ["feature-state", "active"], false],
    ROUTE_WIDTH_ACTIVE,
    ROUTE_WIDTH,
  ],
},
```

The fade lives in `line-opacity` over `line-progress` (dim origin → bright arrival); `line-gradient` carries the accent→accent-bright hue shift. `use-map-highlight.ts` is unchanged — it still `setFeatureState({active:true})` on `toSlug`, now driving `line-width`.

- [ ] **Step 6: Delete the dead dash module**

```bash
git rm lib/map/dashes.ts lib/map/dashes.test.ts
```

Grep for any other importer of `dashes` (`grep -rn "map/dashes" --include=*.ts --include=*.tsx`); there should be none but `use-map-layers.ts`. If `lib/map/dashes.ts` was the only reader of `TRAVEL_MODE` keys for this purpose, confirm `lib/vocab.ts`'s `TRAVEL_MODE` still has other consumers (the timeline chip reads `entry.travelModeFrom`, not this) — do not remove the vocab term.

- [ ] **Step 7: Update the leg e2e**

`e2e/trip-timeline.spec.ts` — the `queryRenderedFeatures({layers:["trip-route-line"]})...state.toEqual({active:true})` case stays valid (feature-state still set). Confirm it does not assert `line-color` or a casing layer. If any case queries `trip-route-casing`, delete it.

- [ ] **Step 8: Run the map unit + e2e**

Run: `npx vitest run lib/map hooks/map` then, because the diff touches `lib/map/**` and `hooks/map/**` (gated paths, decision §32): `npm run pod:dev &` (wait for it), then `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e`.
Expected: PASS. The arc renders, the leg fades, the active leg widens.

- [ ] **Step 9: Commit**

```bash
git add lib/map/legs.ts lib/map/view.ts hooks/map/use-map-layers.ts hooks/map/use-map-layers.test.ts lib/map/legs.test.ts e2e/trip-timeline.spec.ts
git rm lib/map/dashes.ts lib/map/dashes.test.ts
git commit -m "The leg becomes a fading arc — no casing, no dash"
```

---

### Task 7: Restyle the markers — 26px, soft halo, fuzzed stays a soft circle

Shrink the DOM entry markers from 40px to 26px with the photograph filling them; give the exact/arrival marker a soft halo instead of the hard `border-2` ring; keep the fuzzed marker a soft circle. 26px has no Tailwind step and arbitrary values are banned, so the size and halo live in a named `.map-marker` CSS class.

**Files:**
- Modify: `app/globals.css` (add `.map-marker` and its `--exact` / `--fuzzed` variants)
- Modify: `lib/map/marker-element.ts` (className composition)
- Modify test: `lib/map/marker-element.test.ts`, `hooks/map/use-map-markers.test.ts` (only if class names change), `e2e/map-sheet.spec.ts` (stale 40px comment)

**Interfaces:**
- Consumes: `PointProps` (`slug`, `title`, `thumbnail?`, `precisionMeters?`). `MARKER_ACTIVE` stays `"ring-2 ring-accent-bright"` so the existing `classList` highlight and its e2e keep working.
- Produces: nothing later.

- [ ] **Step 1: Write the failing test**

`lib/map/marker-element.test.ts` — extend, keeping the existing arbitrary-value ban and no-`ring-2`-at-build assertions:

```ts
it("sizes the marker from the .map-marker class, not size-10 or an arbitrary value", () => {
  const el = buildMarkerElement({ slug: "s", title: "t", precisionMeters: undefined });
  expect(el.className).toContain("map-marker");
  expect(el.className).not.toContain("size-10");
  expect(el.className).not.toMatch(/\[[^\]]+\]/); // still no arbitrary Tailwind
});
it("gives the exact marker the square/halo variant and the fuzzed one the soft circle", () => {
  const exact = buildMarkerElement({ slug: "a", title: "t", precisionMeters: undefined });
  const fuzzed = buildMarkerElement({ slug: "b", title: "t", precisionMeters: 500 });
  expect(exact.className).toContain("map-marker--exact");
  expect(fuzzed.className).toContain("map-marker--fuzzed");
});
```

- [ ] **Step 2: Run and watch fail**

Run: `npx vitest run lib/map/marker-element.test.ts`
Expected: FAIL — still `size-10`, still `border-2 border-accent`.

- [ ] **Step 3: Add `.map-marker` to `app/globals.css`**

```css
/* Entry markers. 26px has no Tailwind step and arbitrary className values are
   banned, so the geometry lives here (like the sheet geometry above). The
   photograph fills the box; arrival gets a soft halo, a fuzzed point a soft
   circle. Spec §6, decision §36; the active ring is toggled in JS, not here. */
.map-marker { width: 26px; height: 26px; overflow: hidden; background: var(--color-surface); }
.map-marker img { width: 100%; height: 100%; object-fit: cover; display: block; }
.map-marker--exact {
  border-radius: 2px;
  box-shadow: 0 0 0 1px var(--color-accent-bright), 0 0 8px 2px rgb(132 192 253 / 0.14);
}
.map-marker--fuzzed { border-radius: 50%; opacity: 0.8; box-shadow: 0 0 0 1px var(--color-accent); }
```

- [ ] **Step 4: Rewrite `marker-element.ts` className composition**

```ts
const BASE = "map-marker";
const EXACT = "map-marker--exact";
const FUZZED = "map-marker--fuzzed";
export const MARKER_ACTIVE = "ring-2 ring-accent-bright";
// ...
el.className = `${BASE} ${precisionMeters === undefined ? EXACT : FUZZED}`;
```

Keep the `img` element and `dataset.slug`/`role`/`aria-label` exactly as they are. `size-full object-cover` on the img can stay (it is covered by `.map-marker img` too) or be dropped — dropping it removes one more Tailwind class; prefer dropping it and letting the CSS own it.

- [ ] **Step 5: Fix the stale e2e comment**

`e2e/map-sheet.spec.ts:125` — the "nara's 40px box" comment is now wrong; update it to 26px and re-check the corner-point reasoning still holds (the assertion uses a far corner, so it should).

- [ ] **Step 6: Run marker unit + the map e2e**

Run: `npx vitest run lib/map/marker-element.test.ts hooks/map/use-map-markers.test.ts`, then (gated paths touched) the e2e as in Task 6 Step 8.
Expected: PASS. `ring-2` highlight still works (unchanged); markers are 26px with the halo.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css lib/map/marker-element.ts lib/map/marker-element.test.ts e2e/map-sheet.spec.ts
git commit -m "Markers: 26px, the photograph fills them, arrival gets a halo"
```

---

### Task 8: Bring the diary-globe trip points into the language

The globe's trip points are a circle GL layer (`use-map-trips.ts`, radius 7 / stroke 2). Nudge them to match the quieter route language (thinner stroke, the accent-deep stroke kept). Small task — no test pins these numbers, so add a minimal assertion test-first.

**Files:**
- Modify: `hooks/map/use-map-trips.ts:122-137` (circle paint)
- Modify test: `hooks/map/use-map-trips.test.ts` (add a paint assertion)

**Interfaces:**
- Consumes: `MAP_COLORS` (`accent`, `accentBright`, `accentDeep`), `TRIPS_LAYER`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```ts
it("strokes trip points in accent-deep at 1px, active fill bright", () => {
  // build the layer, read the added circle layer's paint
  expect(paint["circle-stroke-width"]).toBe(1);
  expect(paint["circle-stroke-color"]).toBe(MAP_COLORS.accentDeep);
});
```

- [ ] **Step 2: Run and watch fail** — `npx vitest run hooks/map/use-map-trips.test.ts` — Expected: FAIL (stroke is 2).

- [ ] **Step 3: Adjust the circle paint** — `circle-radius` 6, `circle-stroke-width` 1, keep the feature-state `circle-color` case (accent → accentBright) and `circle-stroke-color` accentDeep.

- [ ] **Step 4: Run** — `npx vitest run hooks/map/use-map-trips.test.ts` and the diary-globe e2e (gated). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/map/use-map-trips.ts hooks/map/use-map-trips.test.ts
git commit -m "The globe's trip points, quieter to match the arc"
```

---

### Task 9: View transitions, the decisions, and the phase close

Add CSS-first page view transitions with a reduced-motion opt-out; record the two overriding decisions and update spec §10; then run the full definition of done on the finished branch.

**Files:**
- Modify: `app/globals.css` (`@view-transition` + reduced-motion)
- Modify: `docs/decisions.md` (add §34, §35, §36)
- Modify: `docs/superpowers/specs/2026-09-15-look-and-feel-phase-7-design.md` (§10: record the dash was dropped in favour of the fade)
- Modify: `TODO.md` (phase 7 progress), and the status memory after merge

**Interfaces:** none.

- [ ] **Step 1: Write the failing transition test**

A CSS-presence check (there is no runtime to assert view transitions in jsdom):

```ts
// app/globals-view-transition.test.ts (or extend an existing globals test)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const CSS = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");
it("opts into cross-document view transitions", () => {
  expect(CSS).toMatch(/@view-transition\s*{[^}]*navigation:\s*auto/);
});
it("disables them under reduced motion", () => {
  expect(CSS).toMatch(/prefers-reduced-motion:\s*reduce/);
});
```

- [ ] **Step 2: Run and watch fail** — `npx vitest run app/globals-view-transition.test.ts` — Expected: FAIL.

- [ ] **Step 3: Add the transition CSS**

```css
@view-transition { navigation: auto; }

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) { animation: none !important; }
}
```

Confirm against `node_modules/next/dist/docs/` that Next 16 needs no config flag for cross-document view transitions (the MPA `@view-transition` API is browser-native; `next/link` navigations are same-document, so also confirm whether a same-document opt-in is wanted — if so it is still CSS-only). Do not add a library and do not make anything a client component (Global Constraints, spec §8).

- [ ] **Step 4: Record the decisions**

`docs/decisions.md` — append:
- **§34 The route line loses its casing.** Overrides `docs/design-brief.md` ("the route line needs a casing"). The casing separated the accent line from land it did not need separating from; at 1.5px on the quiet basemap the bare line reads as a route through the map, not an overlay on it. Settled with the maintainer 2026-09-15.
- **§35 The on-map travel-mode dash is dropped in favour of the origin fade.** MapLibre cannot both `line-gradient`-fade and `line-dasharray` on one line. The fade (departure is context, arrival the subject) was chosen; travel mode remains in the timeline chip. `lib/map/dashes.ts` removed. Overrides spec §10 as written.
- **§36 Entry markers are 26px with a soft halo; geometry lives in `.map-marker`.** 26px has no Tailwind step and arbitrary className values are banned, so the size/halo are a named CSS class, consistent with the sheet geometry.

Update spec §10 to note the dash was dropped (not kept) and point at §35.

- [ ] **Step 5: Run the FULL definition of done on the finished branch**

Node 22 selected, Pod up. Run and READ each:

```
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; node -v   # v22.x
npm run pod:dev &            # FIRST — integration tests skip without it
npm test                     # expect the integration flip: 36 passed with the Pod up
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure      # active exemptions — 0
npm run build                # reads the Pod
npm run size:public          # MUST stay ≤ 190 and not have moved for our code
npm run format:check
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e   # gated paths touched
```

Any failure is reported plainly with its output, not summarised as green. `size:public` moving for anything that is not framework cost is a boundary failure — fix the import, do not raise the ceiling.

- [ ] **Step 6: Commit and finish the branch**

```bash
git add app/globals.css app/globals-view-transition.test.ts docs/decisions.md docs/superpowers/specs/2026-09-15-look-and-feel-phase-7-design.md TODO.md
git commit -m "View transitions, and the two decisions that overrode a rule"
```

Then follow `superpowers:finishing-a-development-branch` — `--no-ff` merge per the convention every earlier phase used, re-run the definition of done on the merged result, and update the status memory.

---

## Self-Review

**Spec coverage:**
- §1 (fonts, scale, three surfaces, route/marker, view transitions) → Tasks 1–9. ✔
- §2 (Syne/DM Mono self-hosted, variable cut, the body-Syne risk) → Task 1; the risk is validated by the entry-page prose in Task 3. ✔
- §3 (type scale + body treatment) → Task 2 (primitives) + Tasks 3–5 (applied). ✔
- §4 (the sequential bold gesture; masthead spans full width) → Tasks 3–4. ✔
- §5 (numbered entries, unnumbered trips; mono only for data; precision changes rendering; avoid-list) → Tasks 3–5 (precision shape, unnumber diary). ✔
- §6 (arc, 1.5px, no casing, fade, 26px markers, halo) → Tasks 6–7. ✔ The broken-image `dy:thumbnail` seed bug (§6, §"found while designing") is a data bug, not styling — noted in TODO, out of this plan's scope.
- §7 (view transitions, reduced motion) → Task 9. ✔
- §8 (bundle gate) → Global Constraints + every task's size:public check. ✔
- §9 (token-drift analogue, arbitrary-value rule, existing browser cases, no screenshot tests) → Task 1 drift test; lint carried throughout; no screenshot tests added. ✔
- §10 (legs stay; dash decision) → Task 6 keeps `buildLegs`; the dash resolution is decision §35. ✔

**Placeholder scan:** No TBD/TODO-in-code. The one deliberately deferred item — the entry page's real photographs (spec §10 "the photographs are unjudged") — is a review checkpoint during Task 3, not a code placeholder: wire one real JPG into the entry mockup or a dev entry and look at the full-bleed figure before finalising the prose measure. Flag to the maintainer if it reads poorly.

**Type consistency:** `arcCoordinates`/`buildLegs` (Task 6) names match their test. `MARKER_ACTIVE` kept verbatim so `use-map-markers` and the e2e are untouched. `LAYERS.casing` removed in both the layer file and its test. `ROUTE_WIDTH`/`ROUTE_WIDTH_ACTIVE` defined in `view.ts` and consumed only in `use-map-layers.ts`. `FONT_CLASS`/`syne.variable`/`dmMono.variable` consistent across `lib/fonts.ts`, its test, and the three layouts.

**One open verification for the executor:** confirm Next 16's view-transition story in `node_modules/next/dist/docs/` before Task 9 Step 3 — whether same-document (`next/link`) transitions need an opt-in beyond `@view-transition`. CSS-only either way; if it needs more than an opt-in class, it does not ship (spec §8).

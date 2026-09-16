# Sectioned Entry — Stage 2: the public entry page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This repository's loop (CLAUDE.md "How work is done here") is mandatory: `test-specialist` writes the failing test and shows it red; `nextjs-specialist` implements anything rendered; `fullstack-solid-reviewer` reviews the diff. Both, always.

**Goal:** Render an entry's `sections` (from Stage 1's read model) on the public entry page with the phase-7 look — a display masthead, a mono meta row with precision typography, and each section as text and/or photos (a single photo full-width in the reading column, two photos as a stacking pair), ending in the `SiteFooter`. No component becomes newly interactive; this is server-rendered markup + CSS.

**Architecture:** `EntryContent` (a server component in `app/(public)/trips/[slug]/[entry]/page.tsx`) keeps rendering inside the trip's map shell — it is `children` of `[slug]/layout.tsx`, so it lands in `.trip-sheet-body`, the 34rem right-hand column on desktop and the scroll-snap sheet on mobile. It renders a `.wrap` masthead + `.meta-row`, then maps `e.value.sections` to a new server component `components/public/entry-section/`, then `<SiteFooter>`. New CSS primitives (`.pair`, `.plate`, entry figure/caption, aspect ratios, a **column** bleed) are added to `app/globals.css`, ported from `.mockups/entry.html` + `.mockups/_shared.css` but adapted: the mockup's `figure.bleed { width: 100vw }` is replaced by a negative-inline-margin bleed to the **column** edges, because a 100vw figure would break out across the map pane.

**Tech Stack:** Next.js 16 (App Router, RSC), Tailwind v4 (CSS-first), MapLibre unchanged, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-sectioned-entry-design.md` §8 (rendering), with `docs/superpowers/specs/2026-09-15-look-and-feel-phase-7-design.md` for the type language. Stage 2 of 3 — Stage 1 (data layer) is done; Stage 3 is the studio editor + legacy-field removal.

## Global Constraints

Every task's requirements implicitly include this section.

- **Node 22 before any check.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`; confirm `node -v` prints `v22.x`.
- **No new client component.** Every change is CSS + server-rendered markup. If a treatment seems to need `"use client"`, find another treatment. `EntrySection` is a server component (no hooks, no events).
- **No arbitrary Tailwind values** outside `components/ui/**` (enforced by lint + `test/guardrails.test.ts`). New geometry (26px-style sizes, `aspect-ratio`, `100vw` math) goes in named CSS classes in `globals.css`, never `className="w-[...]"`. A **data-driven** value (a photo's real aspect ratio from its width/height) may be a React inline `style={{ aspectRatio: ... }}` — that is not a Tailwind arbitrary value and the ban does not touch it.
- **One family, declared once.** No literal `Syne`/`DM Mono` and no hard-coded `font-family` in `app/**`/`components/**` except `globals.css` (the Task-1 drift test in `lib/fonts.test.ts` enforces this). Use `.data`/`.label`/`.caption`/`var(--font-mono)` for mono, the type classes for the rest.
- **Full-bleed means full COLUMN, never 100vw.** The entry is inside the 34rem `.trip-sheet-body` track (desktop) / the fixed sheet (mobile). A `100vw` figure escapes the column across the map. Bleed to the column edge with `margin-inline: calc(-1 * <the column padding>)`; the caption re-indents by the same padding.
- **Pod image URLs use a plain `<img>`, not `next/image`.** `next/image` cannot serve a Pod URL (the studio's `photo-fields.tsx` carries the repo's one permanent `eslint-disable @next/next/no-img-element` for exactly this). Reserve the box with the photo's real `aspect-ratio` to avoid layout shift; show `blurDataUrl` as the `.plate` background until the image paints.
- **Precision changes rendering** (spec §5, already in `.precision`/`.precision.exact`): a fuzzed coordinate (`place.geo.precisionMeters !== undefined`) is a soft circle + two decimals; an exact one (`precisionMeters === undefined`) is a square + four decimals.
- **Mono is for data only:** dates, times, offsets, coordinates, precision, travel mode, captions, the status line. Not the headline, prose, or the breadcrumb link label.
- **Bundle gate:** `size:public` is 182.5 kB of 190. This is a public route, so it IS weighed — any movement beyond framework cost is a defect to explain. No studio/media/auth import may enter this page's graph (the public fence + the belt already forbid it).
- **e2e is gated on this diff.** It touches `app/(public)/**` and `components/public/**` (decision §32's list), so `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e` must pass at stage close.
- **Read model (from Stage 1), exact shapes:** `e.value.sections: { text?: { value: string; language?: string }; photos: Photo[]; sortOrder: number }[]` (already sorted by `readEntry`). `Photo: { contentUrl: string; thumbnailUrl?: string; caption?: {value,language?}; width?: number; height?: number; blurDataUrl?: string; ... }` (`photos.max(2)` per section). `e.value.headline: LangText`; `e.value.occurredAt?: string`; `e.value.place?: { name?: LangText; geo?: { lat: number; long: number; precisionMeters?: number } }`; `e.value.travelModeFrom?: TravelMode`. **`articleBody` still exists on the type (Stage-1 shim) but is empty for every real entry — do NOT render it; Stage 3 removes it.**

## File structure

- `app/(public)/trips/[slug]/[entry]/page.tsx` — `EntryContent` rewritten; `generateMetadata` sources its description from the first section's text.
- `app/(public)/trips/[slug]/[entry]/entry-page.test.tsx` — NEW (the directory has no test today).
- `components/public/entry-section/{entry-section.tsx,index.ts,entry-section.test.tsx,notes.md}` — NEW server component.
- `app/globals.css` — new entry primitives appended after the phase-7 block.

---

### Task 1: The masthead, the meta row, text sections, and the footer

Rewrite `EntryContent` to the phase-7 shape and render each section's **text** (photos come in Task 2). Create `EntrySection` rendering text only for now. Wire `SiteFooter` and the metadata description.

**Files:**
- Modify: `app/(public)/trips/[slug]/[entry]/page.tsx`
- Create: `app/(public)/trips/[slug]/[entry]/entry-page.test.tsx`
- Create: `components/public/entry-section/entry-section.tsx`, `index.ts`, `entry-section.test.tsx`, `notes.md`

**Interfaces:**
- Consumes: `e.value.sections`, `.headline`, `.occurredAt`, `.place`, `.travelModeFrom` (Stage 1); `SiteFooter` from `@/components/public/site-footer`; `config` from `@/lib/config`; `precisionLabel` from `@/lib/place/precision` (confirm the export name by reading the file before use).
- Produces: `<EntrySection section={Section} />` (this task renders `section.text` as `.prose`; Task 2 adds photos).

- [ ] **Step 1: Write the failing tests (test-specialist)**

Read the existing entry `page.tsx` and a sibling public page's test (e.g. `app/(public)/trips/[slug]/page.tsx` tests, or `components/public/trip-timeline/trip-timeline.test.tsx`) for the Pod-read fake pattern FIRST; reuse it. Then, for `entry-page.test.tsx`, render `EntryContent` (or the page) with a fake published entry whose `sections` are `[{ sortOrder:1, text:{value:"the lead",language:"en"}, photos:[] }, { sortOrder:2, text:{value:"second",language:"en"}, photos:[] }]`, `headline:{value:"Under Fitz Roy",language:"en"}`, `occurredAt:"2025-03-09T18:20:00-03:00"`, `place:{ name:{value:"El Chaltén",language:"en"}, geo:{ lat:-49.33, long:-72.89, precisionMeters:500 } }`, `travelModeFrom:"Bus"`, `status:"published"`. Assert:

```tsx
it("sets the headline in the display cut", async () => {
  expect(await screen.findByRole("heading", { level: 1 })).toHaveClass("display");
});
it("renders the arrival time in mono", async () => {
  expect(screen.getByText(/2025-03-09/).closest("time")).toHaveClass("data");
});
it("marks a fuzzed coordinate as a soft circle, not exact", async () => {
  const el = screen.getByText(/49\.33/).closest(".precision");
  expect(el).not.toBeNull();
  expect(el).not.toHaveClass("exact");
});
it("renders each section's text as prose, in order", async () => {
  const proses = screen.getAllByText(/the lead|second/);
  expect(proses.map((p) => p.textContent)).toEqual(["the lead", "second"]);
});
it("renders the site footer as a contentinfo landmark", async () => {
  expect(screen.getByRole("contentinfo")).toHaveClass("status-line");
});
it("does not render the empty legacy articleBody", async () => {
  // articleBody is undefined on a real sectioned entry; nothing should read it
  expect(screen.queryByText("undefined")).toBeNull();
});
```

For `entry-section.test.tsx`, render `<EntrySection section={{ sortOrder:1, text:{value:"a paragraph",language:"en"}, photos:[] }} />` and assert the text renders inside an element with class `prose`.

- [ ] **Step 2: Run and watch fail** — `npx vitest run "app/(public)/trips/[slug]/[entry]" components/public/entry-section` → FAIL (no test file / `EntrySection` missing / headline is `text-2xl` not `display`).

- [ ] **Step 3: Create `EntrySection` (text only for now) (nextjs-specialist)**

`components/public/entry-section/entry-section.tsx` — a server component:

```tsx
import type { Section } from "@/lib/pod/schema";

export function EntrySection({ section }: { section: Section }) {
  return (
    <>
      {section.text && (
        <div className="wrap">
          <div className="entry-prose prose">
            {section.text.value.split(/\n{2,}/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>
      )}
      {/* photos: Task 2 */}
    </>
  );
}
```

`index.ts`: `export { EntrySection } from "./entry-section";`. `notes.md`: one line — `# EntrySection` + a pointer to spec §8 (a section is text and/or up to two photos; full-bleed is column-width — see the Task-2 CSS).

- [ ] **Step 4: Rewrite `EntryContent` (nextjs-specialist)**

Replace the current inline markup with: a `.wrap` `<header className="masthead">` holding a `.breadcrumb` back-link, `<h1 className="display">{headline.value}</h1>`, and a `<dl className="meta-row">` with mono `dt`/`dd` for Arrived (`<time className="data" dateTime={occurredAt}>`), Where (place name), the coordinate in a `<span className={geo.precisionMeters === undefined ? "precision exact" : "precision"}>` with `precisionLabel` and the right decimal count, and Arrived-by (travel mode, `.data`). Then `{e.value.sections.map((s, i) => <EntrySection key={i} section={s} />)}`. Then `<SiteFooter siteName={config.siteName} status={...} />` at the end. Add `import { config } from "@/lib/config";`. Keep the draft/notFound guards and `generateStaticParams` unchanged. In `generateMetadata`, change the description to `e.value.sections.find((s) => s.text)?.text?.value?.slice(0, 160)` (no more `articleBody`). Render only fields that exist (no coordinates if `place.geo` is absent). Keep the render function under the 200-line hard bound (extract the meta row into a small helper if needed).

- [ ] **Step 5: Run the tests** — `npx vitest run "app/(public)/trips/[slug]/[entry]" components/public/entry-section && npm run typecheck` → PASS.

- [ ] **Step 6: Commit** — `git add "app/(public)/trips/[slug]/[entry]" components/public/entry-section && git commit -m "Entry page: the display masthead, mono meta row, and text sections"`

---

### Task 2: Section photos — the single figure, the pair, and the CSS

Render each section's photos: a one-photo section as a column-width figure with a mono caption; a two-photo section as a stacking `.pair`. Add the CSS primitives, ported from the mockups but bled to the **column** not the viewport.

**Files:**
- Modify: `components/public/entry-section/entry-section.tsx` (+ its test)
- Modify: `app/globals.css` (append the entry figure/pair/plate/caption/ratio primitives)

**Interfaces:**
- Consumes: `section.photos: Photo[]` (0–2), each `{ contentUrl, thumbnailUrl?, caption?, width?, height?, blurDataUrl? }`.
- Produces: nothing later.

- [ ] **Step 1: Write the failing tests (test-specialist)**

Extend `entry-section.test.tsx`:

```tsx
const photo = (over = {}) => ({ contentUrl: "https://pod/m/a/web.webp", width: 1600, height: 1067,
  caption: { value: "the massif from the road", language: "en" }, ...over });

it("renders a one-photo section as a figure with a mono caption", () => {
  render(<EntrySection section={{ sortOrder: 1, photos: [photo()] }} />);
  const fig = screen.getByRole("figure");
  expect(fig.querySelector("img")).not.toBeNull();
  expect(screen.getByText("the massif from the road")).toHaveClass("caption");
  expect(fig.querySelector(".pair")).toBeNull();
});
it("renders a two-photo section as a pair", () => {
  render(<EntrySection section={{ sortOrder: 1, photos: [photo(), photo({ contentUrl: "https://pod/m/b/web.webp" })] }} />);
  expect(screen.getByRole("figure").querySelector(".pair")).not.toBeNull();
  expect(screen.getAllByRole("img")).toHaveLength(2);
});
it("gives the image an alt from its caption and reserves the box by aspect ratio", () => {
  render(<EntrySection section={{ sortOrder: 1, photos: [photo()] }} />);
  const img = screen.getByRole("img");
  expect(img).toHaveAttribute("alt", "the massif from the road");
});
```

(`getByRole("figure")` requires the `<figure>` to have an accessible name OR use `container.querySelector("figure")` — pick whichever the repo's other component tests use; if `figure` has no role by default in this jsdom, query `container.querySelector("figure")`.)

- [ ] **Step 2: Run and watch fail** — `npx vitest run components/public/entry-section` → FAIL (no figure/img rendered).

- [ ] **Step 3: Add the CSS primitives to `app/globals.css` (nextjs-specialist)**

Append after the phase-7 block, values ported from `.mockups/_shared.css` + `.mockups/entry.html` with `--color-*`/`--font-*` tokens and the **column** bleed:

```css
/* Entry photographs. Ported from .mockups/entry.html + _shared.css; the mockup
   bleeds to 100vw, but the entry lives in the 34rem sheet column, so a single
   photo bleeds to the COLUMN edge (negative inline margin = the wrap padding),
   never the viewport. Spec §8; see components/public/entry-section/notes.md. */
.entry-figure { margin-block: clamp(2rem, 7vh, 5rem); }
.entry-figure--bleed { margin-inline: calc(-1 * clamp(1.25rem, 4vw, 3rem)); }
.entry-figure--bleed .caption { padding-inline: clamp(1.25rem, 4vw, 3rem); }

.plate { position: relative; width: 100%; overflow: hidden; background: var(--color-surface); background-size: cover; background-position: center; }
.plate > img { display: block; width: 100%; height: 100%; object-fit: cover; }
.plate::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.05); pointer-events: none; }

.caption { font-family: var(--font-mono); font-size: 0.76rem; color: var(--color-text-muted); line-height: 1.5; margin: 0.85rem 0 0; }

.pair { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(0.75rem, 2vw, 1.5rem); }
@media (max-width: 40rem) { .pair { grid-template-columns: 1fr; } }
```

(Do NOT add a bare `figure {}` rule — scope to `.entry-figure` so no other `<figure>` in the app is affected. Do NOT add `.ratio-3x2`/`.ratio-4x5` — real photos carry their own dimensions; reserve the box from those instead, next step. `.wrap`/`.prose`/`.meta-row`/`.precision`/`.status-line` already exist.)

- [ ] **Step 4: Render the photos in `EntrySection` (nextjs-specialist)**

After the text block, render photos. A `.plate` gets its box from the photo's real dimensions (data-driven inline `style`, allowed — not a Tailwind arbitrary value) and its `blurDataUrl` as the background until the image paints:

```tsx
function Plate({ photo }: { photo: Section["photos"][number] }) {
  const style: React.CSSProperties = {};
  if (photo.width && photo.height) style.aspectRatio = `${photo.width} / ${photo.height}`;
  if (photo.blurDataUrl) style.backgroundImage = `url("${photo.blurDataUrl}")`;
  return (
    <div className="plate" style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element -- next/image cannot serve a Pod URL; see components/studio/entry-editor/fields/photo-fields */}
      <img src={photo.contentUrl} alt={photo.caption?.value ?? ""} loading="lazy" />
    </div>
  );
}
```

Then, in `EntrySection`, after the text:
- **one photo** → a bled figure: `<figure className="entry-figure entry-figure--bleed"><Plate photo={photos[0]} />{caption && <figcaption className="caption">{caption.value}</figcaption>}</figure>` wrapped so the figcaption still indents (the `--bleed` caption rule handles it). Put a single photo's figure OUTSIDE the `.wrap` prose block but INSIDE the section fragment so it reaches the column edge.
- **two photos** → inside `.wrap`: `<figure className="entry-figure"><div className="pair"><Plate/><Plate/></div>{firstCaption && <figcaption className="caption">…</figcaption>}</figure>`.

Confirm the render/util function stays within length bounds; `Plate` as a module-local helper is fine (it is presentation, in the component folder — not `lib/`).

- [ ] **Step 5: Run tests + typecheck + lint** — `npx vitest run components/public/entry-section "app/(public)/trips/[slug]/[entry]" && npm run typecheck && npm run lint` → PASS (lint must be clean incl. `--max-warnings 0`; the one `eslint-disable` carries its reason).

- [ ] **Step 6: Commit** — `git add components/public/entry-section app/globals.css && git commit -m "Entry sections: the column-bleed single photo and the stacking pair"`

---

### Task 3: Stage close — see it, then the full definition of done

Look at the rendered page against a real seeded entry (spec §9: the eye is the check), then run the definition of done. This diff touches public + component paths, so `size:public` and `test:e2e` both apply.

**Files:** none (verification), unless the eye finds a defect — then a scoped fix commit.

- [ ] **Step 1: See it in the browser (nextjs-specialist)**

`export PATH=...v22.23.2...`; start the Pod (`npm run pod:dev &`, wait for it), `npm run pod:seed`, `npm run dev`, and open a seeded entry (e.g. `/trips/2025-patagonia/entries/2025-03-09-el-chalten`). Confirm: the display masthead reads as the entrance; sections render in order; the single photo reaches the column edges (not across the map, not overflowing); the pair stacks under 40rem; captions are mono; the meta row is mono with the right precision shape; the footer sits at the content end. Note anything off; a purely visual tweak is a scoped fix commit reviewed like any task.

- [ ] **Step 2: Full definition of done** — Node 22, Pod up. Run and READ each:

```
npm test                  # incl. the new entry-page + entry-section tests and the integration suites
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure   # entry-section folder layout, notes.md anchor, comment bounds
npm run build             # reads the Pod
npm run size:public       # public route CHANGED — explain any movement beyond framework cost
npm run format:check
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e   # gated paths touched
```

Any failure reported plainly with output. `size:public` moving for anything not framework cost is a boundary failure — fix the import, do not raise the ceiling.

- [ ] **Step 3: Commit any fixes; update the status memory** noting Stage 2 done and Stage 3 (studio editor + legacy-field removal) remaining.

---

## Self-Review

**Spec coverage (spec §8):**
- "masthead (display) + meta row as phase-7 specifies" → Task 1. ✔
- "text-only section: prose in Syne body treatment" → Task 1 (`.prose`). ✔
- "one-photo section: photo full-bleed to the reading column, caption mono, text as prose above" → Task 2 (`.entry-figure--bleed`, `.caption`, text block before). ✔ (bled to column, not 100vw — see Global Constraints.)
- "two-photo section: pair side by side, stacking on narrow widths" → Task 2 (`.pair` + `@media (max-width: 40rem)`). ✔
- "full-bleed is full column on desktop, full viewport on mobile" → the column bleed reaches the 34rem track edge on desktop and the viewport edge on mobile (the sheet is inset:0). ✔
- "`<SiteFooter>` at the content end" → Task 1. ✔
- "No component becomes newly interactive" → `EntrySection` is a server component; no hooks/events. ✔

**Placeholder scan:** no TBD/TODO-in-code. The `precisionLabel` import name and the `getByRole("figure")` vs `querySelector("figure")` choice are flagged to be confirmed against the real files before writing, not guessed.

**Type consistency:** `EntrySection`/`Plate` consume `Section`/`Section["photos"][number]` (Stage 1 types). `SiteFooter siteName` matches its Stage-1 signature. `config.siteName` matches its getter. No `articleBody` read anywhere.

**Green at every commit:** Task 1 renders text sections (photos simply not shown yet) — green. Task 2 adds photos — green. Task 3 is verification. The entry page is never broken mid-stage; it only gains rendering.

**Deferred to Stage 3 (unchanged by this stage):** removing the legacy `articleBody`/`photos` fields; the studio section editor; the studio-created-entry thumbnail gap.

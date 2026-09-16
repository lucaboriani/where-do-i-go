# Sectioned Entry — Stage 3a: the studio section editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`). This repository's loop is mandatory: `test-specialist` writes the failing test and shows it red; `solid-specialist` for Pod/RDF/write code, `nextjs-specialist` for anything rendered; `fullstack-solid-reviewer` reviews. Both, always.

**Goal:** Replace the entry editor's single `story` textarea + flat photo pool with an ordered **section list** — each section a text field + 0–2 photos, with add / remove / move-up / move-down — so the studio writes `Entry.sections`. Autosave persists the section list (draft key `wig.draft.v2` → `v3`). The legacy `articleBody`/`photos` are left on `Entry` (unwritten) and removed in **Stage 3b**.

**Architecture:** The editor is a `"use client"` reducer-driven form (`components/studio/entry-editor/`). `EntryFormState.story: string` + `slots: PhotoSlot[]` become `sections: SectionDraft[]` where `SectionDraft = { id: string; text: string; slots: PhotoSlot[] }` (a synthetic `id` stable across reorder). The pure state layer (`state/actions.ts`, `entry-form-reducer.ts`, `apply-field-edit.ts`, `apply-restore.ts`), the form hook (`hooks/studio/use-entry-form.ts`), the draft (`lib/studio/drafts.ts` + `hooks/studio/use-entry-draft.ts`), the save (`hooks/studio/use-entry-save.ts`), the photo pipeline (`hooks/studio/use-photo-pipeline.ts` — now attaches to a section, max 2), and the UI (`entry-editor.tsx` + a new `sections-field` component; `identity-fields` loses its story textarea; `photo-fields`'s slot-row rendering moves per-section) all change together. The entry-level coordinate/time/place stay entry-level — `apply-photo-offer.ts` (a photo's GPS/EXIF time filling the single coordinate/timestamp) is UNCHANGED; only text + photos become sectioned.

**Tech Stack:** React 19 / Next 16 client component, Zod (Draft + Section schemas), Vitest + Testing Library, the existing media pipeline (`lib/media/*`) unchanged.

**Spec:** `docs/superpowers/specs/2026-09-15-sectioned-entry-design.md` §2 (section shape), §4 (Section Zod — already shipped in Stage 1), §7 (the editor — this stage). Reorder affordance: **up/down buttons** (decided with the maintainer 2026-09-16; simplest, no dnd library, accessible). Stage 3a of the sectioned-entry feature; Stage 3b removes the legacy fields.

## Global Constraints

- **Node 22 before any check** (`export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`; `node -v` = v22.x). This diff is on the studio + e2e-gated paths, so `test:e2e` runs at stage close.
- **The editor stays client-only and reads no config / imports no auth value** (invariants; `entry-editor.tsx`'s own docblock). Session, `settingsUrl`, `podRoot`, `pipeline`, `storage` remain injected props. Fuzzing still happens in `use-entry-save` before the `Entry` exists.
- **`Section` (from `lib/pod/schema.ts`, shipped in Stage 1):** `{ text?: LangText; photos: Photo[] (max 2); sortOrder: number }`, refined "text OR ≥1 photo". The editor must never save an empty section — drop empties (no text and no ready photo) before building `Entry.sections`, so a blank trailing section a user added and left empty does not fail the write.
- **Max 2 photos per section**, enforced in the UI (disable/hide the picker at 2) AND relied on by the schema `.max(2)`. Photos still upload on pick (bytes on the Pod before Save), via the existing pipeline (resize/EXIF-strip/blur/fuzz) — unchanged except the attach target is a section.
- **Language-tag section text** (`schema:text`@en) exactly as `articleBody` was — `LANGUAGE`/`existing?.headline.language` in `use-entry-save`.
- **A photo's GPS/EXIF-time still fills the ENTRY-level coordinate/timestamp** (§11.3/§11.5) — `apply-photo-offer.ts`, `offerCoordinate`/`offerTimestamp`, keyed on the global slot `key`, are unchanged. Slot `key`s stay globally unique across sections so the cross-half timestamp guard still holds.
- **Draft key bumps `wig.draft.v2` → `wig.draft.v3`** so an old flat draft (`story`/`photos`) is invisible, not half-restored (the existing `readDraft` returns `null` for a key it does not find). `Draft` is `.strip()`-shaped (unknown keys dropped), not `.strict()`.
- **`EntryFormState` field names track `Draft`'s** (the state layer's deliberate convention). `TextField = Exclude<keyof Draft, ...>` — after the cut it must exclude `sections` (and still `savedAt`/`mode`/`status`), and `story` is gone.
- **Component-folder rule:** the new `sections-field` is one component, one folder (named file, `index.ts` barrel, test, `notes.md`). Each section's controls need UNIQUE ids (the shared `<Field>` renders one `<label htmlFor={id}>`), e.g. `entry-section-${index}-text` — the current fixed `entry-story`/`entry-photos` ids would collide across sections.
- **No arbitrary Tailwind values** outside `components/ui/**`; the Pod-thumbnail `<img>` keeps the one permitted `eslint-disable` with its reason. Function-length bounds (render ≤200 hard, util ≤80 hard, comments ≤6 lines / `notes.md#anchor`).
- **Green at every task commit** (typecheck + tests). The cutover is inherently coupled; the decomposition below keeps each task's commit green by (T1) landing the model + hooks + save + draft together with a **single-section** UI that preserves today's behaviour, then (T2) adding the multi-section UI, then (T3) the pipeline's per-section max-2 and the remaining tests.

## File structure

- Pure state: `components/studio/entry-editor/state/actions.ts`, `entry-form-reducer.ts`, `apply-field-edit.ts`, `apply-restore.ts` (+ their `.test.ts`). `apply-photo-offer.ts` UNCHANGED.
- Form hook: `hooks/studio/use-entry-form.ts` (+ test).
- Draft: `lib/studio/drafts.ts` (+ test); `hooks/studio/use-entry-draft.ts` (+ test).
- Save: `hooks/studio/use-entry-save.ts` (+ test).
- Pipeline: `hooks/studio/use-photo-pipeline.ts` (+ test).
- UI: `components/studio/entry-editor/entry-editor.tsx`; new `components/studio/entry-editor/fields/sections-field/{sections-field.tsx,index.ts,sections-field.test.tsx,notes.md}`; `fields/identity-fields/identity-fields.tsx` (drop story) + test; `fields/photo-fields/**` (repurposed into the section's photo sub-UI, or folded into `sections-field` and deleted) + test.
- Integration tests: the `entry-editor.*.test.tsx` set (draft-fields, draft-autosave, photos, save-sequence, autofill, controls, report, and the harness `entry-editor.harness/`).

**Read before writing:** every touched folder's `notes.md` (esp. `state/notes.md`, `entry-editor/notes.md`) — several load-bearing decisions (single draft slot, the reducer's `never` exhaustiveness guard, why the setters are memoised, `story` as flat text) are argued there. The exact current code of all these files was gathered into the task briefs; implementers read the real source too.

---

### Task 1: The model cutover — sections in state, hooks, draft, save; a single-section UI

Turn `story`+`slots` into `sections: SectionDraft[]` end to end, with the UI rendering exactly ONE section (text + its photos) so today's behaviour and most existing tests are preserved. Multi-section add/remove/move is Task 2.

**Files (all together — this is the atomic green unit):**
- `state/actions.ts`: add `SectionDraft`; `EntryFormState` drops `story`/`slots`, gains `sections: SectionDraft[]`; add actions `section-text` `{id,value}`, `section-added`, `section-removed` `{id}`, `section-moved` `{id,dir:"up"|"down"}`; make `slot-added`/`slot-settled` carry `sectionId`. `TextField` excludes `sections`.
- `entry-form-reducer.ts`: handle the new/section-scoped actions (the `never` guard forces this); slot add/settle now find the section by `sectionId` and update its `slots`.
- `apply-field-edit.ts`: remove the `story` handling (it lands in `default` today; once `story` is not a `TextField` it cannot arrive — confirm the switch still compiles).
- `apply-restore.ts`: rebuild `sections` from `draft.sections` (each → `{ id, text, slots: restoredSlots(section.photos) }`); drop `story`/`slots` restore.
- `hooks/studio/use-entry-form.ts`: `initialEntryFormState` builds `sections` from `existing.sections` (each section → `{ id: sid(), text: s.text?.value ?? "", slots: restoredSlots(s.photos) }`; on CREATE, one empty section `[{ id: sid(), text: "", slots: [] }]`); setters — drop `story`, add `setSectionText(id,value)`, `addSection()`, `removeSection(id)`, `moveSection(id,dir)`; `addSlot`/`settleSlot` gain a `sectionId`.
- `lib/studio/drafts.ts`: `Draft` drops `story`/`photos`, gains `sections: z.array(z.object({ text: z.string(), photos: z.array(Photo).default([]) }))`; `draftKey` → `wig.draft.v3.<webId>.<scope>`.
- `hooks/studio/use-entry-draft.ts`: `draftTextOf(values)` maps `sections`; `sameText`/`samePhotos` compare per section; autosave dependency array updates.
- `hooks/studio/use-entry-save.ts`: build `sections: sectionsFor(values.sections)` (each non-empty section → `{ text: t==="" ? undefined : {value:t,language}, photos: <ready photos with per-section sortOrder>, sortOrder: i+1 }`, dropping empties); REMOVE the `articleBody` and top-level `photos` lines and the `sections: existing?.sections ?? []` shim.
- `hooks/studio/use-photo-pipeline.ts`: `attachAll(sectionId, files)`; `attach` calls `addSlot(sectionId,...)`/`settleSlot(sectionId,key,...)`. `attachedOf` now takes a section's slots. (Max-2 enforcement is Task 3; here just thread the sectionId.)
- `entry-editor.tsx`: thread `values.sections`; render a single section (its text + photos) — minimally, reuse `IdentityFields` (minus story) + a one-section photo/text block — to keep the diff small; the real multi-section component is Task 2.
- `identity-fields.tsx`: remove the story `<textarea>` and the `story`/`onStoryChange` props.
- Tests: update `state/*.test.ts`, `use-entry-form.test.ts`, `use-entry-draft.test.ts`, `use-entry-save.test.ts`, `drafts.test.ts`, and the `entry-editor.*.test.tsx` cases that referenced `story`/`slots`/`entry-story`/`entry-photos`, to the single-section model.

**Interfaces produced:** `SectionDraft`; the section actions/setters; `Draft.sections`; `sectionsFor`. Consumed by Task 2 (UI) and Task 3 (pipeline max-2).

- [ ] **Step 1 (test-specialist): write the failing tests.** Extend the state/reducer/form/draft/save tests to assert: `initialEntryFormState` on CREATE yields one empty section; on EDIT one section per `existing.sections` with text + restored ready-slots; `section-text`/`section-added`/`section-removed`/`section-moved` transitions; `draftTextOf` round-trips `sections`; `use-entry-save` builds `Entry.sections` (text + photos, per-section sortOrder, empties dropped) and writes NO `articleBody`/top-level `photos`; the draft key is `wig.draft.v3`. Show them red. Do not rewrite the unrelated coordinate/time tests (`apply-photo-offer` is unchanged).
- [ ] **Step 2:** run the touched suites; watch fail (types/behaviour).
- [ ] **Step 3 (solid-specialist for state/hooks/draft/save, nextjs-specialist for the UI bits):** implement the cutover per the file list. Keep `apply-photo-offer.ts` and the entry-level coordinate/time flow untouched. Keep slot `key`s globally unique.
- [ ] **Step 4:** `npx vitest run components/studio/entry-editor hooks/studio lib/studio lib/pod && npm run typecheck && npm run lint && npm run check:structure` → green (all editor + save + draft + read/serialise suites; `lib/pod` because save/read touch Entry, though Stage 3a keeps the legacy fields so read/serialise are unaffected).
- [ ] **Step 5:** commit.

---

### Task 2: The multi-section UI — add / remove / move up / move down

Replace the single-section UI with the `sections-field` component: an ordered list of section cards, each with a text field, its photos, and remove / move-up / move-down; plus an "Add section" button.

- [ ] **Step 1 (test-specialist):** `sections-field.test.tsx` — render with two sections; assert unique ids per section; "Add section" appends; "Remove" deletes the right one; move-up/down reorder; the first section's move-up and the last's move-down are disabled; each section shows its text control and its photo rows. Also extend `entry-editor.*.test.tsx` for the multi-section flow. Red.
- [ ] **Step 2:** run; watch fail.
- [ ] **Step 3 (nextjs-specialist):** build `components/studio/entry-editor/fields/sections-field/` (folder + barrel + notes.md). Each section card: a `<Field id={`entry-section-${i}-text`}>` textarea (value `section.text`, `onChange` → `setSectionText(section.id, …)`); the photo sub-area (the picker + the slot-status rows from today's `photo-fields`, scoped to `section.slots`, calling `attachAll(section.id, files)`); `BUTTON`-styled remove / move-up (disabled at index 0) / move-down (disabled at last). An "Add section" `BUTTON` below the list. Fold `photo-fields`'s slot rendering in (or keep `photo-fields` as a per-section child and delete the flat usage). Wire `entry-editor.tsx` to render `<SectionsField sections={values.sections} …/>` in place of the single-section block. Keep the `<fieldset disabled={offered!==null}>` wrapping.
- [ ] **Step 4:** `npx vitest run components/studio/entry-editor && npm run typecheck && npm run lint && npm run check:structure` → green.
- [ ] **Step 5:** commit.

---

### Task 3: Per-section max-2 enforcement, and the remaining test surface

Enforce 0–2 photos per section in the UI + pipeline, and finish updating any editor test not yet migrated.

- [ ] **Step 1 (test-specialist):** assert a section at 2 photos hides/disables its picker and a third pick is refused (no third slot added); `attachAll(sectionId, files)` respects the cap (incl. a multi-file pick that would exceed 2 — only the first fitting ones attach, the rest are refused with a visible message or simply not added, per what the UI shows). Extend `use-photo-pipeline.test.ts`. Sweep the remaining `entry-editor.*.test.tsx` (autofill, controls, report, save-sequence, draft-autosave, photos) for any still-red assertion tied to the old flat model and migrate it. Red where behaviour is new.
- [ ] **Step 2:** run; watch fail.
- [ ] **Step 3 (nextjs-specialist + solid-specialist):** enforce the cap at pick time in `use-photo-pipeline`/`sections-field` (count `section.slots` in flight + ready) and reflect it in the UI; ensure the reducer/`addSlot` cannot exceed 2 for a section (belt). Finish any remaining test migration.
- [ ] **Step 4:** `npx vitest run components/studio/entry-editor hooks/studio && npm run typecheck && npm run lint && npm run check:structure` → green.
- [ ] **Step 5:** commit.

---

### Task 4: Stage close — see it, then the full definition of done

- [ ] **Step 1 (nextjs-specialist): see it.** Node 22, Pod up (`npm run pod:dev &`, wait, `npm run pod:seed`, fix `.env.local` if the seed rotates the account — git-ignored). `npm run dev`, sign in as owner, open the studio, and: create an entry with two sections (text-only + a two-photo section), reorder them, remove one, save; then edit it and confirm the sections come back (and that an old flat `v2` draft, if any, is ignored not half-restored). Confirm photos upload on pick and the 2-cap holds. Note anything off; a visual/UX fix is a scoped commit reviewed like a task.
- [ ] **Step 2: full definition of done** (Node 22, Pod up), run and READ each:
```
npm test                  # editor + hooks + draft + save + read/serialise + integration (Pod up)
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure   # sections-field folder layout, notes.md anchors, comment bounds
npm run build
npm run size:public       # studio-only change — must NOT move the PUBLIC budget (no studio code may enter a public chunk)
npm run format:check
env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e   # gated paths touched (studio + media)
```
- [ ] **Step 3:** commit any fixes; update the status memory (Stage 3a done; Stage 3b — legacy-field removal — remains).

---

## Self-Review

**Spec coverage (§7 the editor):**
- "section list replacing the single articleBody textarea; each row a text field + 0–2 photos" → Tasks 1–2. ✔
- "add / remove / reorder sections (sortOrder derived from list position on save)" → Task 1 (`sortOrder: i+1` in `sectionsFor`) + Task 2 (buttons). ✔
- "reorder photos within a section (max 2 in UI + schema)" → Task 3 (cap); intra-section photo order follows pick order via per-section sortOrder (a distinct reorder-photos-within-a-section control is NOT in scope unless the eye calls for it — flag). ⚠ (see note)
- "photo attaches to a section instead of the entry; pipeline unchanged" → Tasks 1+3. ✔
- "autosave persists the section list; draft version key bumps so an old flat draft is invisible" → Task 1 (`v3`, `Draft.sections`, `draftTextOf`). ✔
- "owner check, write sequence, ACL unchanged" → untouched (save still calls `saveEntry`; only the `Entry` it builds changes). ✔
- Out of scope: removing legacy `articleBody`/`photos` from `Entry`/read/serialise → **Stage 3b**.

**Open for the executor / maintainer:**
- Reordering photos WITHIN a section (up/down on the two photos) — the spec mentions it; with a 2-cap it is a single swap. Include a minimal swap control in Task 2 only if the eye wants it; otherwise pick-order is the order. Confirm during Task 4.
- Whether "Add section" should be disabled while the last section is empty (avoid a pile of empty sections) — a UX nicety; decide in Task 2/4.

**Placeholder scan:** none. The exact current code of every touched file was gathered into the briefs; task steps name the real functions/lines to change.

**Type consistency:** `SectionDraft`/`sections`/`sectionId` consistent across state, form, pipeline, UI. `Draft.sections` ↔ `draftTextOf` ↔ `apply-restore`. `sectionsFor` builds `Entry.sections` (Stage-1 `Section` shape). `attachAll(sectionId, files)` matches the pipeline + `sections-field`. `TextField` no longer includes `story`.

**Green-at-each-task:** T1 lands the whole coupled cutover with a single-section UI (behaviour preserved) — one green commit; T2 swaps in the multi-section UI; T3 adds the cap; T4 verifies. `apply-photo-offer` and the entry-level coordinate/time are untouched throughout. Legacy `articleBody`/`photos` stay on `Entry` (unwritten) so `read.ts`/`entry-model.ts` are unaffected until Stage 3b.

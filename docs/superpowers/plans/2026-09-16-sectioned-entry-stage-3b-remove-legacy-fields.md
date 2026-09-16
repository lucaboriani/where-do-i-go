# Sectioned Entry — Stage 3b: remove the legacy `articleBody` / `photos`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Repo loop: `test-specialist` writes the failing test and shows it red; `solid-specialist` implements the Pod/RDF code; `fullstack-solid-reviewer` reviews. Both, always.

**Goal:** Delete the now-unwritten legacy `articleBody` and entry-level `photos` from the `Entry` model and every reader/writer, completing the sectioned-entry migration. After this, an entry's content is `sections` and nothing else, and the branch is a coherent whole ready to merge (after phase-7's remaining tasks, per the maintainer's sequencing).

**Architecture:** Stage 3a made the studio write only `sections`; `Entry.articleBody`/`photos` have been dead-on-write since. This stage removes them from the `Entry` Zod schema (`lib/pod/schema.ts`), stops `readEntry` parsing them (`lib/pod/read.ts`), and stops the serialiser writing them (`lib/pod/entry-model.ts` — dropping the now-dead `photoQuads` and its entry-level `schema:image` splice, and repointing the shared `imageObjectQuads` type from `Entry["photos"][number]` to `Section["photos"][number]`). `photosOf` and `SCHEMA.image` STAY — sections use them for their nested photos. A few test builders that still set `photos: []` on an `Entry` literal lose that prop. This is a coupled cutover, landed as one green commit.

**Tech Stack:** TypeScript, Zod, n3, Vitest + MSW, CSS (`validate:fixtures`), the local Pod (integration).

**Spec:** `docs/superpowers/specs/2026-09-15-sectioned-entry-design.md` §1 ("Read: … drops `articleBody`"; §4 "`Entry` drops `articleBody` and `photos`"). Stage 3b of the feature; Stages 1 (data layer), 2 (public page), 3a (studio editor) are done.

## Global Constraints

- **Node 22 before any check** (`export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`; `node -v` = v22.x).
- **No live Pod, no migration.** The `dy:` namespace is still `example.org`. The §7.3 fixture and the seed are already sectioned (Stage 1). Local pre-sections (v1) entries, if any, are already rejected by the read-side schemaVersion gate (Stage 1 bumped to 2), so removing these fields loses nothing reachable. Editing a legacy pre-sections entry was already established (Stage 3a review) to drop prose — out of scope, no real-data risk.
- **`Section` is unaffected.** `Section.photos: z.array(Photo).max(2)` STAYS. `Photo`, `LangText` STAY. `photosOf` STAYS (sections call it). `SCHEMA.image` STAYS (sections use it). `imageObjectQuads` STAYS (sectionQuads uses it) — only its parameter TYPE changes to `Section["photos"][number]`.
- **Only these become dead and are removed:** `Entry.articleBody`, `Entry.photos`, `photoQuads` (the entry-level photo serialiser), the entry-level `schema:image` parse in `readEntry`, and — if grep confirms zero remaining references in code and the data model — `SCHEMA.articleBody` in `lib/vocab.ts`.
- **Compare RDF by graph isomorphism, never bytes.** The `save-entry.test.ts` round-trip + `graphEquals(ENTRY_TTL, …)` already build from the sectioned fixture, so they should stay green unchanged once the `Entry` type drops the fields.
- **All gates green at the one commit.** This touches `lib/pod/**` (read/serialise), which the public path imports — but removes fields, so `size:public` cannot grow. Not on the studio/media e2e-gated paths, but `scripts/seed-dev-pod.ts` is NOT touched here, so confirm the e2e gate is not triggered (it isn't — but run the integration reads with a Pod).

## File structure

- `lib/pod/schema.ts` — `Entry` drops `articleBody` + `photos` (+ the Stage-1 shim comment).
- `lib/pod/read.ts` — `readEntry` drops the entry-level `photos` parse and the `articleBody` parse from its `validate(Entry, …)` object.
- `lib/pod/entry-model.ts` — `itQuads` drops the `articleBody` quad; `serialiseEntry` drops the `...photoQuads(frag, it, e.photos)` splice; `photoQuads` is deleted; `imageObjectQuads`'s param type → `Section["photos"][number]`.
- `lib/vocab.ts` — remove `SCHEMA.articleBody` **iff** unused after the above (and update any `docs/data-model.md` prose that names it).
- Tests: `lib/pod/entry-model.test.ts` (remove the `photoQuads` describe/tests); `lib/pod/read.test.ts`, `lib/pod/save-entry.test.ts`, `lib/pod/index-model.test.ts`, `hooks/studio/use-entry-form.test.ts`, `hooks/studio/use-entry-save.test.ts`, and any other `Entry`-literal builder — drop `photos: []` / `articleBody` props that no longer typecheck. `test/guardrails.test.ts` — if it has a schema-coverage sense check over §7.3 predicates, confirm it still passes (the fixture has no `articleBody`/entry-level `schema:image`).

---

### Task 1: Remove the fields (schema, read, serialise, dead code, builders)

One coupled green commit: the `Entry` type loses `articleBody`/`photos`, and every producer/consumer follows.

**Interfaces:** removes `Entry.articleBody`, `Entry.photos`, `photoQuads`. Keeps `Section`, `Photo`, `photosOf`, `imageObjectQuads` (retyped), `sectionsOf`, `sectionQuads`, `SCHEMA.image`.

- [ ] **Step 1 (test-specialist): write/adjust the failing tests.**
  - In `lib/pod/read.test.ts`, assert `readEntry` on the §7.3 fixture returns an entry with NO `articleBody` and NO top-level `photos` — e.g. `expect("articleBody" in r.value).toBe(false)` and `expect("photos" in r.value).toBe(false)` (or a type-level check plus the sections assertion that already exists). If a fixture that carried a top-level `<#it> schema:image` was used anywhere to assert entry-level photos, that assertion should now expect it ignored.
  - In `lib/pod/entry-model.test.ts`, add/keep a case asserting `serialiseEntry` writes NO `schema:articleBody` and NO entry-level `schema:image` on `<#it>` (only `schema:hasPart` sections); the existing `photoQuads` describe should be REMOVED (the function is going away) — do that in Step 3, but write the "no entry-level image/articleBody on <#it>" assertion here so it drives the removal.
  - These fail today because `readEntry` still parses `articleBody`/entry-level `photos` and `serialiseEntry` still writes them for an entry that has them. Since the current fixture has neither, construct a small served Turtle in the read test that DOES include a stray `<#it> schema:articleBody` + `<#it> schema:image <#photo-1>` and assert the read result ignores them (no `articleBody`/`photos` keys) — that fails now (they'd be parsed) and passes after removal. Show red. Do NOT run typecheck (the removal doesn't exist yet).
- [ ] **Step 2:** run the touched suites; watch fail.
- [ ] **Step 3 (solid-specialist): remove the fields.**
  - `lib/pod/schema.ts`: delete `articleBody: LangText.optional(),` and `photos: z.array(Photo),` from `Entry` (and the Stage-1 shim comment). Keep `Section`, `Photo`, `LangText`.
  - `lib/pod/read.ts`: in `readEntry`, delete `const photos = take(photosOf(quads, v.all(SCHEMA.image), url));`, and delete `articleBody: langText(v, SCHEMA.articleBody),` and `photos,` from the `validate(Entry, {…}, url)` object. Keep `sectionsOf`/`photosOf`.
  - `lib/pod/entry-model.ts`: in `itQuads`, delete the `if (e.articleBody) …` line; in `serialiseEntry`, delete the `...photoQuads(frag, it, e.photos),` splice line; delete the `photoQuads` function; change `imageObjectQuads`'s param type `photo: Entry["photos"][number]` → `photo: Section["photos"][number]` (import `Section` from `./schema` if needed).
  - `lib/vocab.ts`: `grep -rn "SCHEMA.articleBody" lib hooks components scripts` — if zero (it should be, both users removed), remove `articleBody: schema("articleBody"),` from `SCHEMA`, and `grep -n "articleBody" docs/data-model.md` — if §3/§7 prose names `schema:articleBody`, update it to say the entry's prose lives in `dy:Section`s (§7.3 fixture already has no articleBody). If any reference remains that you cannot cleanly remove, LEAVE `SCHEMA.articleBody` and note it (it is harmless — `check:vocab` does not cross-check `schema:` terms).
  - Update the test builders: remove `photos: []` / `articleBody` from every `Entry` literal that no longer typecheck (`lib/pod/entry-model.test.ts`, `lib/pod/index-model.test.ts`, `hooks/studio/use-entry-form.test.ts`, `hooks/studio/use-entry-save.test.ts`, and any the typecheck names); remove the `photoQuads` describe/tests from `entry-model.test.ts`. Do NOT weaken a test — only drop the now-invalid props / the dead-function tests.
- [ ] **Step 4:** `npx vitest run lib/pod hooks/studio && npm run typecheck && npm run lint && npm run check:structure && npm run validate:fixtures && npm run check:vocab` → all green. Then, with a Pod up (`npm run pod:dev &`, wait), `npx vitest run test/integration/pod-read.integration.test.ts` → green (the seeded sectioned entries read back through the reader that no longer knows the legacy fields).
- [ ] **Step 5:** commit — `git commit -m "Sectioned entry Stage 3b: remove the legacy articleBody/photos"`.

---

### Task 2: Stage close — full definition of done

- [ ] **Step 1:** Node 22, Pod up. Run and READ each:
```
npm test                  # unit + the Pod integration reads
npm run lint
npm run typecheck
npm run validate:fixtures
npm run check:vocab
npm run check:commands
npm run check:structure
npm run build             # reads the Pod
npm run size:public       # removing fields cannot grow it; must stay ≤ 190 and not move for our code
npm run format:check
```
`test:e2e` is NOT required (this diff touches none of the e2e-gated paths — confirm with `git diff --name-only` against the gated globs; `scripts/seed-dev-pod.ts` is untouched here). If somehow a gated path is touched, run it.
- [ ] **Step 2:** commit any fixes; update the status memory (Stage 3b done → the sectioned entry feature is complete; phase-7 Tasks 4–9 remain; the branch is now internally coherent for an eventual merge).

---

## Self-Review

**Spec coverage:** §1/§4 "`Entry` drops `articleBody` and `photos`; read drops `articleBody`" → Task 1. ✔ The serialiser no longer emits them → Task 1. ✔

**Placeholder scan:** none — the exact lines to delete are enumerated (schema.ts:119/126, read.ts:285/302/308, entry-model.ts:69/206-…/264) and were confirmed present at plan time.

**Type consistency:** removing `Entry.photos` forces `imageObjectQuads`'s param off `Entry["photos"][number]` onto `Section["photos"][number]` (same `Photo`); `photoQuads` (the only other `Entry["photos"]` user) is deleted; `rowOfEntry` already reads `entry.sections` (Stage 1), not `entry.photos`. `photosOf`/`SCHEMA.image` retained for sections.

**Green-at-the-commit:** Task 1 is one coupled commit (schema + read + serialise + builders). The sectioned fixture already lacks the legacy fields, so `validate:fixtures`, the round-trip and `graphEquals` tests are unaffected; the only failures to resolve are the type errors from the dropped props (fixed in the same commit) and the new "ignores a stray legacy field" read assertion.

**Deferred (unchanged):** the in-app studio EDIT surface (pre-existing, own future task); phase-7 Tasks 4–9; the one stale `#…fifteen-names…` anchor slug (cosmetic doc pass).

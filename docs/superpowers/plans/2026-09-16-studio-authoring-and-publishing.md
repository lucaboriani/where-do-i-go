# Studio authoring & publishing — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax. Repo loop: `test-specialist` writes the failing test and shows it
> red; `solid-specialist` implements Pod/RDF code; `nextjs-specialist` implements anything
> rendered; `fullstack-solid-reviewer` reviews the diff. Both, always.

**Goal:** Give the studio a full authoring & publishing surface — create/edit trips + entries,
a management list with draft/published state, and publish/unpublish for both — so the diary is
self-serve end to end with no seed script.

**Architecture:** All new surfaces are client-side, holding the browser session (the studio has
no server credentials); each studio route is a thin server page → `"use client"` wrapper →
`dynamic(…, { ssr:false })` shell. The entry editor and the `dy:status`→ACL→index data layer
already exist and are reused; the trip write path is greenfield. One read-model change:
`diary.ttl` becomes a published-trips-only publication boundary. ACLs (via `lib/pod/access.ts`)
are the privacy guarantee, never an app-level filter.

**Tech Stack:** TypeScript, Zod, n3, Next 16 App Router, Vitest + MSW, Testing Library,
Playwright, Community Solid Server (integration), the phase-3 media pipeline.

**Spec:** `docs/superpowers/specs/2026-09-16-studio-authoring-and-publishing-design.md` — read it
first; this plan argues from it. The spec's "Fixes the plan must incorporate" are folded into the
tasks below.

## Global Constraints

- **Node 22 before any check**: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`;
  `node -v` = v22.x. Pod up for integration/build: `npm run pod:dev &`.
- **Pod-only, browser→Pod writes, no server session/credential store** (invariants #1–#5).
- **The studio guard is UX; the ACL is the guarantee.** A draft (trip or entry) must be denied
  to an *unauthenticated* fetch — proven by an integration test, not app-level absence.
- **All IRIs from `lib/vocab.ts`** (no predicate literals; `no-restricted-syntax`). **Fragments
  only.** Explicit datatypes: `xsd:date` for trip extent, `xsd:dateTime`+offset elsewhere,
  `xsd:decimal` for coordinates. **Language-tag** human-readable literals. Check
  `dy:schemaVersion` (= 2) on read.
- **Every write carries a precondition** (`If-None-Match: *` create, `If-Match: <etag>` update).
- **Access control only through `lib/pod/access.ts`** (`no-restricted-imports`).
- **Public/studio boundary:** new code under `app/(studio)/**`, `components/studio/**`,
  `hooks/studio/**`, `lib/studio/**`, `lib/pod/{trip-model,save-trip,bootstrap}.ts`,
  `lib/pod/write.ts`. `(public)` imports none of it. **`size:public` ≤ 190 kB and must not move**
  — this feature ships no new public client code.
- **Media**: reuse the phase-3 pipeline (Web-Worker resize thumb/web/blur, EXIF-stripped, no
  GPS-bearing original). `dy:coverImage` = IRI to the web derivative.
- **RDF compared by graph isomorphism**, never bytes. Comment blocks ≤ 6 lines (prod); function
  length 200/80 hard bound; one-component-one-folder with `index.ts` + `notes.md`; hooks in
  `hooks/<area>/`.
- **e2e gate REQUIRED** (diff hits `app/(studio)/**`, `components/studio/**`, `hooks/studio/**`,
  `lib/pod/write.ts`, media): `env -u CLAUDECODE -u AI_AGENT E2E_PORT=<port> npm run test:e2e`.
- **`dy:` namespace is resolved** (`https://zeropara.me/ns/traveldiary#`); dev stays on local CSS.

## What already exists (do not rebuild)

- `EntryEditor` edits via `initial: {entry, etag}` (`components/studio/entry-editor/entry-editor.tsx:72`),
  threaded through `useEntrySave` create/update (`hooks/studio/use-entry-save.ts`); `use-entry-form.ts`
  seeds from `existing`; the form has a `status` field.
- `save-entry.ts`: `setEntryAccess` (status→ACL via `access.ts`), `writeIndex` (status→`entries.ttl`
  row), the `SaveRecovery` ladder, `runRevalidation`.
- `access.ts`: `createContainer(publicChildren)`, `makePublic`/`makePrivate`, doc-vs-container,
  verify-the-result.
- `read.ts`: `getTrip`/`readTrip`, `readTripIndexWithEtag`; `cached.ts`: `getDiary`,
  `publishedTripSlugs`, `allTripSlugs`; `lib/studio/trips.ts`: `listStudioTrips`, container-path math.
- `Trip` Zod schema (`lib/pod/schema.ts`), all trip predicates/classes in `lib/vocab.ts`.

## File structure

**Create:**
- `lib/pod/trip-model.ts` (+ `.test.ts`) — `serialiseTrip`, diary-row builder.
- `lib/pod/save-trip.ts` (+ `.test.ts`) — `saveTrip`, publish/unpublish, `reconcile`.
- `lib/pod/bootstrap.ts` (+ `.test.ts`) — first-run containers + `dy:Diary` root.
- `lib/pod/diary.ts` (+ `.test.ts`) — `readDiaryWithEtag`, `writeDiary` (published-only).
- `hooks/studio/use-trip-form.ts`, `use-trip-save.ts`, `use-studio-trips.ts`,
  `use-studio-entries.ts`, `use-publish.ts` (+ tests).
- `components/studio/trips-list/`, `trip-editor/`, `entries-list/` (each: named `.tsx`,
  `index.ts`, `.test.tsx`, `notes.md`).
- Studio routes under `app/(studio)/studio/trips/**` (server page + `"use client"` wrapper +
  shell per route).
- `test/integration/pod-authoring.integration.test.ts`; `e2e/studio-authoring.spec.ts`.

**Modify:** `lib/pod/literals.ts` (add `date`), `lib/pod/schema.ts` (+ `Trip.creator`),
`lib/pod/read.ts` (`readTrip` reads `creator`), `lib/pod/write.ts` (if a container/diary
primitive is missing), the **save orchestration** (`saveTrip` revalidation step / `use-trip-save`)
to select `TAGS.diary` — `lib/studio/revalidate.ts`'s `revalidatePublicSite` is tag-agnostic
(POSTs whatever tags it's handed, imports no `TAGS`), so the tag choice lives in the orchestration
as `runRevalidation` selects `TAGS.trip`/`TAGS.entry` in `save-entry.ts`; `save-entry.ts` (thread
trip status for the publish guard), `lib/pod/cached.ts` (fix the stale "diary lists every trip"
comment ~:100-102; the `publishedTripSlugs` filter stays as defense-in-depth),
`app/(studio)/studio/page.tsx` + `components/studio/studio-client` (→ trips list),
`components/studio/entry-editor/**` (reached with `initial`; publish control), `docs/data-model.md`
(ADD a diary published-only note to §7.1), `docs/decisions.md` (new **§37**), `TODO.md`.

---

# Stage 1 — Trip write path + first-run bootstrap

Data layer only, no UI. `size:public` cannot move. All of Stage 1 lands green.

### Task 1.1: `xsd:date` literal helper

**Files:** Modify `lib/pod/literals.ts`; test `lib/pod/literals.test.ts`.

**Interfaces:** Produces `date(value: string): Literal` — an `xsd:date` typed literal, mirroring
the existing `dt` (`xsd:dateTime`).

- [ ] **Step 1 — failing test.** In `literals.test.ts`, mirror the `dt` test:

```ts
import { DataFactory } from "n3";
import { date } from "./literals";

it("date() types the literal as xsd:date, not dateTime", () => {
  const lit = date("2026-03-29");
  expect(lit.value).toBe("2026-03-29");
  expect(lit.datatype.value).toBe("http://www.w3.org/2001/XMLSchema#date");
});
```

- [ ] **Step 2:** `npx vitest run lib/pod/literals.test.ts` → FAIL (`date` is not exported).
- [ ] **Step 3 — implement.** Add beside `dt`: `DataFactory.literal(value, namedNode(XSD.date))`.
  `XSD.date` **already exists** in `lib/vocab.ts` — only the *writer* is missing (`literals.ts`
  has `dec`/`int`/`dt`/`text`; the `date` in `read.ts` is a different `./rdf` reader helper, not
  this one).
- [ ] **Step 4:** re-run → PASS. `npm run check:vocab` unaffected (XSD, not `dy:`).
- [ ] **Step 5:** commit `feat(pod): xsd:date literal helper`.

### Task 1.2: `Trip.creator` schema + read parity

**Files:** Modify `lib/pod/schema.ts`, `lib/pod/read.ts`; tests `lib/pod/read.test.ts`.

**Interfaces:** `Trip` gains `creator: z.url().optional()`; `readTrip` parses `dcterms:creator`
(the predicate is already in `vocab.ts` — verify; entries already read it).

- [ ] **Step 1 — failing test.** In `read.test.ts`, serve a trip fixture that includes
  `dcterms:creator <…webid>` and assert `readTrip(...).value.creator` equals that WebID. Fails
  today (schema has no `creator`; `readTrip` never reads it).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 — implement.** Add `creator` to `Trip` (after `modified`), and in `readTrip` read
  `DCTERMS.creator` the same way `readEntry` does (`take(iri(v, DCTERMS.creator, url))` or the
  existing helper). Keep it `.optional()`.
- [ ] **Step 4:** `npx vitest run lib/pod/read.test.ts && npm run typecheck` → green.
- [ ] **Step 5:** commit `feat(pod): trips carry dcterms:creator for provenance parity`.

### Task 1.3: `serialiseTrip` + diary-row builder

**Files:** Create `lib/pod/trip-model.ts`, `lib/pod/trip-model.test.ts`.

**Interfaces:**
- Consumes: `Trip` (schema), `date`/`dt`/`text` (literals), `DY`/`SCHEMA`/`DCTERMS` (vocab),
  and **`assertSlug` from `lib/pod/read.ts`** — the helper that compares a slug to its
  **container segment** (already the `readTrip` invariant). NOT `assertEntrySlug`, which strips
  `.ttl` from a *filename* and for `trips/<slug>/trip.ttl` would compare the slug against
  `"trip"` and reject every trip.
- Produces: `serialiseTrip(trip: Trip): string` (Turtle for `trip.ttl`, subject `<#it>`). The
  diary lists trips as **bare IRIs** (`readDiary` reads `v.all(DY.trip)`; §7.1 shows
  `dy:trip <…/trip.ttl#it>`), so "adding a trip to the diary" is a single `dy:trip` triple on
  `<#it>`, NOT a denormalised fragment row like `rowOfEntry` — the real surface is
  `addTripToDiary`/`removeTripFromDiary` in `lib/pod/diary.ts` (Task 2.1), and no `tripRow`
  builder is needed.

- [ ] **Step 1 — failing tests.** In `trip-model.test.ts`, using the `graphEquals` helper the
  repo uses for entry serialisation:
  - `serialiseTrip` of a full published trip is graph-isomorphic to the §7.2 trip fixture
    (build the expected Turtle from `docs/data-model.md` §7.2, minus the deferred `tripOrigin`/
    `track`). Asserts: `a schema:TouristTrip, dy:Trip`; `dy:slug`; `dy:status dy:Published`;
    `dy:schemaVersion 2`; `schema:name` with a language tag; `dy:startDate`/`endDate` typed
    `xsd:date`; `dy:coverImage` IRI; `dy:index <entries.ttl#it>`; `dcterms:created`/`modified`/
    `creator`.
  - a draft trip serialises `dy:status dy:Draft`.
  - `serialiseTrip` **throws** (or returns a structured refusal, matching `serialiseEntry`) when
    `trip.slug` != the container **segment** derivable from `trip.iri` — via **`assertSlug`**
    (read.ts), not `assertEntrySlug`.
- [ ] **Step 2:** run → FAIL (module absent).
- [ ] **Step 3 — implement** `serialiseTrip` mirroring `entry-model.ts`'s `itQuads`/
  `serialiseEntry` structure (build quads, write with n3 `Writer`), using `date()` for the
  extent and language-tagging `name`/`description`. Add the `assertSlug` (segment) check. No
  `tripRow` — the diary triple is built in `diary.ts` (Task 2.1).
- [ ] **Step 4:** `npx vitest run lib/pod/trip-model.test.ts && npm run typecheck && npm run lint
  && npm run check:structure` → green.
- [ ] **Step 5:** commit `feat(pod): serialiseTrip + diary-row builder`.

### Task 1.4: first-run bootstrap

**Files:** Create `lib/pod/bootstrap.ts`, `lib/pod/bootstrap.test.ts`. May wire the existing
`initialiseContainers` rather than duplicating it — read it first.

**Read `lib/pod/access.ts`'s `initialiseContainers` first — it already creates the §4 tree and
has no production caller. Prefer wiring/extending it over a hand-rolled duplicate.**

**Interfaces:**
- Produces: `ensurePodInitialised(opts): Promise<Result<void>>` — idempotent; creates the **four**
  §4 containers — `travel/`, `travel/trips/`, `travel/media/`, and **`travel/settings/`** — with
  their ACLs via `createContainer` (`media/` public-read children; `trips/` public-read children;
  `settings/` **owner-only**, `publicChildren:false` — data-model §4 "the settings container is
  owner-only", `access.ts:112-117`), and authors a valid `dy:Diary` root in `diary.ttl` if absent
  (`a dy:Diary; dy:schemaVersion 2; <title>; empty trip list`). Each write is `If-None-Match: *`.
- Consumes: `access.ts` `createContainer`/`initialiseContainers`, `write.ts` `putGuarded`,
  `serialiseDiary` (small helper here or in `diary.ts`).

**RULING (2026-09-16) — bootstrap does NOT author `privacy.ttl`.** `docs/data-model.md` §4/§5/§9
is NORMATIVE and states `settings/` "deliberately writes no document" and that choosing a privacy
default is wrong "because every possible choice is wrong (§9)." `readPrivacySettings` **fails
closed** (structured `err`, no crash — `read.ts:482-517`) and `EntryEditor` is explicitly designed
for `privacy.ttl` to be absent (`entry-editor.tsx:53-61`, "THE READ FAILING IS THE CASE THAT
MATTERS"). So a blank Pod authors trips + text/photo entries + publishes fine self-serve; a
**coordinate-bearing** entry fails closed (coordinate unpublished) until the owner authors
`privacy.ttl` **deliberately** — the intended §9 behavior, not a defect. In-app privacy-settings
authoring is a **separate deferred task**, not part of bootstrap. **Remove the privacy.ttl test**
the test-specialist wrote; bootstrap = 4 containers + `dy:Diary` root only.

- [ ] **Step 1 — failing tests** against the fake Pod: on a blank Pod, `ensurePodInitialised`
  creates **four** containers (assert `settings/` is owner-only via the ACL result — but writes
  NO document into it) and a `diary.ttl` that `readDiary` accepts (`a dy:Diary`, `schemaVersion 2`,
  zero trips); called twice it does not error and does not overwrite the diary (second call's
  create 412 → swallowed as "already there"). **No `privacy.ttl` assertion** (per the ruling —
  drop the test-specialist's privacy.ttl case).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 — implement.** Create-if-absent for each container + the diary root; treat
  412/"already exists" as success. `settings/` is created owner-only and left **empty** (no
  `privacy.ttl`), matching data-model §4/§5/§9.
- [ ] **Step 4:** `npx vitest run lib/pod/bootstrap.test.ts && npm run typecheck && npm run lint`
  → green.
- [ ] **Step 5:** commit `feat(pod): idempotent first-run Pod bootstrap (containers + diary root)`.

### Task 1.5: `saveTrip` (create/update, ACL-at-creation, preconditions)

**Files:** Create `lib/pod/save-trip.ts`, `lib/pod/save-trip.test.ts`.

**Interfaces:**
- Produces:
  - `saveTrip(opts: SaveTripOptions): Promise<SaveTripReport>` — where `SaveTripOptions` carries
    `trip: Trip`, `podRoot`, optional `etag` (update). On **create**: `ensurePodInitialised`,
    then `createContainer(trips/<slug>/, publicChildren: trip.status === "published")` **before**
    any document write (ACL-at-creation), then PUT `trip.ttl` (`If-None-Match: *`), an empty
    `entries.ttl`, and the `entries/` container with the **closed-listing ACL** (`acl:default`
    without `acl:accessTo`). On **update**: PUT `trip.ttl` with `If-Match: <etag>`.
  - `SaveRecovery` reused from `save-entry.ts` (`retry`/`refetch`), plus a `reconcile(resource,
    status)` step (reads status, forces ACL to match — routed around `rebuildIndex`, which does
    no ACL work).
- Consumes: `serialiseTrip`, `bootstrap`, `access.ts`, `write.ts`, and the container-path math —
  note `read.ts:218-221` give `tripUrl`/`tripIndexUrl` (documents) but NOT the `trips/<slug>/` or
  `entries/` **container** URLs; derive those from `podRoot` + `slug` (mirror
  `lib/studio/trips.ts`'s `container`/`entriesContainer`). A create's `If-None-Match: *` returning
  412 means **the slug is already taken** — surface that, don't blind-overwrite.

- [ ] **Step 1 — failing tests** (fake Pod + MSW for headers):
  - create a **draft** trip → container ACL is owner-only (assert via the ACL result, not the
    status code); `trip.ttl` present; empty `entries.ttl` present; `entries/` container present
    with the closed-listing ACL; the create PUTs carried `If-None-Match: *`.
  - create a **published** trip → container ACL is public-read.
  - update an existing trip with a stale etag → `SaveTripReport` reports a 412 with
    `recovery: "refetch"` (mirror `save-entry`), and does **not** blind-PUT.
  - **ACL set before docs:** a test asserting the container-create call precedes the `trip.ttl`
    PUT (order matters — the spec's sequencing fix). Assert on call order via the fake Pod's
    request log.
  - `reconcile` on a resource whose status says published but ACL is owner-only flips the ACL to
    public-read.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3 — implement** `saveTrip` per the interfaces; keep every write precondition-guarded;
  never throw across the seam (structured `PodError`/report).
- [ ] **Step 4:** `npx vitest run lib/pod/save-trip.test.ts && npm run typecheck && npm run lint
  && npm run check:structure` → green.
- [ ] **Step 5:** commit `feat(pod): saveTrip with ACL-at-creation and convergent reconcile`.

### Task 1.6: Stage-1 checkpoint

- [ ] Pod up. Run and READ: `npm test`, `npm run typecheck`, `npm run lint`,
  `npm run validate:fixtures`, `npm run check:vocab`, `npm run check:structure`,
  `npm run size:public` (must not move). `test:e2e` not yet required (no UI/route/write.ts change
  yet — confirm with `git diff --name-only` against the gated globs; `save-trip.ts` is a new file
  not on the list, but if `write.ts` was modified, run e2e). Commit any fixes.

---

# Stage 2 — `diary.ttl` boundary, publish/unpublish, strict/guarded, revalidation

### Task 2.1: `lib/pod/diary.ts` — read + published-only maintenance

**Files:** Create `lib/pod/diary.ts`, `lib/pod/diary.test.ts`.

**Interfaces:** `readDiaryWithEtag(podRoot)` → `{ diary, etag }`; `addTripToDiary` /
`removeTripFromDiary` (read-modify-write with `If-Match`, published-only), modelled on
`save-entry.ts`'s `writeIndex` + `read.ts`'s `readTripIndexWithEtag` (NOT `trips.ts`). A diary
entry is a **bare `dy:trip <…/trip.ttl#it>` triple** on the diary `<#it>` (`readDiary` reads
`v.all(DY.trip)`) — add/remove that one triple; there is no denormalised row.

- [ ] **Step 1 — failing tests:** adding a published trip row then reading `diary.ttl` yields the
  trip; removing it drops the row; the write carried `If-Match`; a draft trip is never present in
  `diary.ttl` (add is a no-op for a draft). Graph-isomorphism on the diary body.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** vitest + typecheck + lint green.
- [ ] **Step 5:** commit `feat(studio): diary.ttl as a published-only boundary`.

### Task 2.2: publish/unpublish for trips + entries; the strict/guarded guard

**Files:** Modify `lib/pod/save-trip.ts` (trip publish/unpublish), `lib/pod/save-entry.ts` (thread
trip status; entry publish guard), tests alongside.

**Interfaces:**
- `publishTrip`/`unpublishTrip(opts)` — flip `dy:status`, set container ACL, add/remove the diary
  row, `reconcile` on partial failure.
- `saveEntry`/`publishEntry` gains `tripStatus` in its options; publishing an entry while
  `tripStatus === "draft"` returns a structured refusal (`PodError` kind e.g. `"precondition"`),
  never a silent success.

- [ ] **Step 1 — failing tests:**
  - `publishTrip` on a draft trip → status `Published`, container public-read, diary row added.
  - `unpublishTrip` → status `Draft`, container owner-only, diary row removed; its published
    entries keep their status but the container is now private.
  - publishing an entry under a **draft** trip → refusal (asserted structured error), no write.
  - publishing an entry under a **published** trip → succeeds (existing path).
  - a publish where the index write fails after the ACL write → report shows the partial state
    and a retry `reconcile`s to a consistent state.
- [ ] **Step 2:** FAIL. **Step 3:** implement (thread `tripStatus` from callers;
  `EditorTrip.status`/`StudioTrip.status` already carry it). **Step 4:** vitest + typecheck +
  lint + check:structure green.
- [ ] **Step 5:** commit `feat(pod): strict/guarded publish for trips and entries`.

### Task 2.3: revalidation + docs

**Files:** Add a `runTripRevalidation` in **`lib/pod`** (beside `save-entry.ts`'s
`runRevalidation` — NOT in `use-trip-save`, which is `hooks/studio/**` and would gate Stage 2) +
test; `lib/pod/cached.ts` (comment); `docs/data-model.md`; `docs/decisions.md`.

- [ ] **Step 1 — failing test:** a trip publish/unpublish stamps `TAGS.diary`; a trip edit stamps
  `TAGS.trip(slug)`. (Assert the orchestration hands `revalidatePublicSite` those tags —
  `revalidatePublicSite` itself is tag-agnostic; `TAGS.diary` already exists in `tags.ts`.)
- [ ] **Step 2:** FAIL. **Step 3:** add the trip revalidation path selecting the tags (mirror
  `runRevalidation`'s `TAGS.trip`/`TAGS.entry` selection).
- [ ] **Step 4:** vitest green. **ADD** a published-only note to `docs/data-model.md` §7.1 (do not
  claim data-model previously said "lists every trip" — that wording lives in `cached.ts`; fix
  that comment too, leaving the `publishedTripSlugs` filter as defense-in-depth). Add
  `docs/decisions.md` **§37** (confirmed current last is §36) recording: the trip publication
  boundary, strict/guarded, ACL-convergence-around-`rebuildIndex`, and that bootstrap creates an
  empty `settings/` and authors NO `privacy.ttl` (per the §9 ruling). `npm run check:structure`
  (notes anchors) green.
- [ ] **Step 5:** commit `feat(studio): revalidate the diary on publish; record the decisions`.

### Task 2.4: integration proof (a draft is ACL-private)

**Files:** Create `test/integration/pod-authoring.integration.test.ts`.

- [ ] **Step 1 — failing test (Pod up):** authenticated session creates a trip + entry, publishes;
  an **unauthenticated** read of the published entry succeeds; unpublish the trip → the same
  unauthenticated read is now **denied** (not merely absent); a draft entry inside a published
  trip is denied unauthenticated; an unauthenticated container GET on a published trip's
  `entries/` does **not** enumerate draft slugs; first-run bootstrap on a fresh container yields
  a readable `dy:Diary`.
- [ ] **Step 2:** run with `npm run pod:dev &` up → FAIL (until Stages 1–2 code is in; if already
  green, tighten the assertion — a draft that reads fine unauthenticated is the bug this exists
  to catch).
- [ ] **Step 3:** make it pass. **Step 4:** `npm test` with Pod up runs it (add the file to any
  integration allowlist `check:structure` carries). **Step 5:** commit.

### Task 2.5: Stage-2 checkpoint — full DoD (e2e conditional)

Per RULING A, Stage 2 lives in `lib/pod` (`diary.ts`, `save-trip.ts` publish/unpublish,
`save-entry.ts` guard + optional `tripStatus` param, a `runTripRevalidation` in `lib/pod`),
`result.ts` (the new `tripNotPublished` kind), `docs/**`, and `test/integration/**` — **none of
which are on the e2e-gated globs** (only `lib/pod/write.ts` is, and it stays untouched). So e2e is
NOT required at this checkpoint IF the diff is confirmed off the gated globs. Do NOT modify
`lib/studio/**`, `hooks/studio/**`, or the entry-editor caller wiring here — the `tripStatus`
param is added to `saveEntry` as **optional** (defaults to current behavior) and wired by its
callers in Stage 3/4; that keeps Stage 2 off the gate. The ACL-privacy guarantee is proven by the
Task 2.4 integration test (in `npm test` with a Pod), not by Playwright.

- [ ] Pod up. `npm test`, lint, typecheck, validate:fixtures, check:vocab, check:commands,
  check:structure, build, size:public (unchanged), format:check. Then confirm the diff is off the
  gated globs (`git diff --name-only f1893a1..HEAD` against `lib/pod/write.ts` + the studio/media/
  public/map globs → empty); **only if a gated path was touched**, run
  `env -u CLAUDECODE -u AI_AGENT E2E_PORT=<port> npm run test:e2e`. Commit fixes.

---

# Stage 3 — Trips list + trip editor (UI)

`nextjs-specialist` for all rendered work. Client shells hold the session. **Every Stage 3–4 task
is on the e2e-gated globs** (`app/(studio)/**`, `components/studio/**`, `hooks/studio/**`), so each
checkpoint runs the existing e2e (`env -u CLAUDECODE -u AI_AGENT E2E_PORT=<port> npm run test:e2e`)
in addition to vitest/typecheck/lint/check:structure/size:public — do not skip it.

### Task 3.1: shared `use-publish` (strict/guarded in one place) — built first

**Files:** `hooks/studio/use-publish.ts` (+ test); consumed by the lists and both editors.

- [ ] Failing test: `use-publish` exposes `publish`/`unpublish` for a trip or entry; for an entry
  under a draft trip it reports the guard (disabled + reason) and never calls the write; it wires
  `TAGS.diary` revalidation for trips. Treat `EditorTrip.status === undefined` deliberately (the
  prop is `EntryStatus | undefined`).
- [ ] Implement. vitest + typecheck + lint green. Commit.

### Task 3.2: `use-studio-trips` + the trips list

**Files:** `hooks/studio/use-studio-trips.ts` (+ test); `components/studio/trips-list/` (folder);
modify `app/(studio)/studio/page.tsx` + `components/studio/studio-client` to render it.

- [ ] Failing test: `use-studio-trips` returns each trip with `status` + entry count from
  `listStudioTrips` (mock the Pod reads). Trips-list component renders draft/published badges,
  an entry count, "New trip", and edit/publish links (publish via the `use-publish` hook from
  Task 3.1); renders a structured error, not a throw, on read failure. **Keep the "Signed in
  as …" affordance** (`e2e/solid-login.spec.ts` asserts it) — a test pins its presence.
- [ ] Implement (component-folder: named `.tsx`, `index.ts`, `.test.tsx`, `notes.md`; no
  arbitrary Tailwind outside `components/ui/**`).
- [ ] vitest + typecheck + lint + check:structure + **size:public unchanged** + existing e2e
  green. Commit.

### Task 3.3: `use-trip-form` + `use-trip-save` + the trip editor

**Files:** `hooks/studio/use-trip-form.ts`, `use-trip-save.ts` (+ tests);
`components/studio/trip-editor/`; routes `app/(studio)/studio/trips/new/**` and
`app/(studio)/studio/trips/[slug]/**` (server page → wrapper → shell each).

- [ ] Failing tests: `use-trip-form` holds **slug** + name/dates/description/tags/cover/status
  with the reducer shape mirroring `use-entry-form` (which has an owner-typed `slug` setter —
  slugs are NOT auto-derived from the name anywhere; the `trips/<slug>/` container URL depends on
  it); `use-trip-save` calls `saveTrip` + revalidation and surfaces create-vs-update, a 412 on
  update (refetch) and a 412 on create (**"slug already taken"**); the editor renders the fields,
  drives the cover through the **existing media pipeline** (`use-photo-pipeline`), and gates save
  on name + slug (mirror the entry pre-flight). Edit route loads an existing trip via `getTrip`
  into the form (slug read-only on edit — the container can't move).
- [ ] Implement (three-file route shape; `dynamic(ssr:false)` in the wrapper, not the page —
  CLAUDE.md). Cover authoring reuses the pipeline; `dy:coverImage` ← web derivative IRI.
- [ ] vitest + typecheck + lint + check:structure + size:public unchanged + existing e2e green.
  Commit.

---

# Stage 4 — Entries list + entry edit/create routing

### Task 4.1: `use-studio-entries` + the per-trip entries list

**Files:** `hooks/studio/use-studio-entries.ts` (+ test); `components/studio/entries-list/`;
render inside `app/(studio)/studio/trips/[slug]`.

- [ ] Failing test: lists one trip's entries via container enumeration (`ldp:contains`, sees
  drafts + published — see `lib/studio/notes.md`), with status badges, edit + publish/unpublish
  (via `use-publish`), and "New entry". The entry publish control is **disabled with a reason
  when the trip is a draft** (strict/guarded, surfaced in UI).
- [ ] Implement. vitest + typecheck + lint + check:structure + size:public unchanged. Commit.

### Task 4.2: entry edit + create routing

**Files:** routes `app/(studio)/studio/trips/[slug]/[entry]/**` (edit) and
`.../new-entry/**` (create); modify `components/studio/entry-editor/**` to accept the publish
control + receive the trip's status.

- [ ] Failing tests: the edit route loads an existing entry (`readEntry` + etag) into
  `EntryEditor` via `initial` and passes the trip's `status`; the create route mounts the editor
  with the trip preset; the publish affordance is present and honours the guard. A test asserts
  the editor’s existing behaviour (autosave, draft banner, sections) is unbroken by the new props.
- [ ] Implement (reuse `EntryEditor`; the wiring is routes + props, not editor internals). vitest
  + typecheck + lint + check:structure + size:public unchanged. Commit.

---

# Stage 5 — e2e + full definition of done

### Task 5.1: the Playwright flow

**Files:** `e2e/studio-authoring.spec.ts`.

- [ ] Failing test: sign in → **create a trip** → **add an entry** → **publish the trip and the
  entry** → the entry is visible on the **public** site; **unpublish the trip** → it disappears
  from the public site (home + the trip URL 404/denied). Reuse the real-login harness
  (`e2e/solid-login.spec.ts`) and the seeded owner account. Assert visibility, not just counts.
- [ ] Implement any data-testids/roles needed; keep the login spec green. Run
  `env -u CLAUDECODE -u AI_AGENT E2E_PORT=<port> npm run test:e2e` → green.
- [ ] Commit.

### Task 5.2: full DoD + docs + status

- [ ] Pod up. Run and READ all twelve: `npm test`, `lint`, `typecheck`, `validate:fixtures`,
  `check:vocab`, `check:commands`, `check:structure`, `build`, `size:public` (≤ 190, unchanged
  for our code), `format:check`, and `test:e2e`. Read each result.
- [ ] Update `TODO.md` (phase-5 publish flow items → done; note the studio EDIT surface gap is
  now closed), `README.md` if the studio usage changed, and the status memory.
- [ ] Commit. This closes feature #1; features #2 (deploy docs) and #3 (OG spike) follow as their
  own spec/plan cycles.

---

## Self-Review

**Spec coverage:** trip write path (§ architecture, data contract) → Stage 1; bootstrap (spec
"First-run bootstrap") → Task 1.4; diary published-only boundary → Task 2.1; strict/guarded +
the entry-under-draft-trip refusal → Task 2.2; ACL model incl. `entries/` closed listing → Tasks
1.5/2.4; `rebuildIndex`-ACL-gap avoided via leaf `reconcile` → Tasks 1.5/2.2; `TAGS.diary`
revalidation → Task 2.3; `xsd:date` + slug assertion + `creator`/`dy:index` → Tasks 1.1–1.3;
lists + editors + routing → Stages 3–4; shared publish guard → Task 3.1; cover via media pipeline
→ Task 3.3; e2e → Task 5.1; "Signed in as" kept → Task 3.2; bootstrap (4 containers + `dy:Diary`
root, NO `privacy.ttl` per the §9 ruling) → Task 1.4. ✔ Deferred (hard delete, GPX `track`,
`tripOrigin`, in-app privacy-settings authoring) are absent by design.

**Placeholder scan:** none — each task names exact files, interfaces, and test intent with code
for the data-layer steps; UI tasks give signatures + test assertions and defer only exact JSX to
the component-folder convention.

**Type consistency:** `SaveTripReport`/`SaveTripOptions`/`SaveRecovery` used consistently;
`reconcile(resource, status)` named the same in Tasks 1.5, 2.2 and the Error-handling wording;
`Trip.creator` added in schema + reader + serialiser together (Tasks 1.2/1.3); `tripStatus`
threaded through `saveEntry` (Task 2.2) matches `EditorTrip.status`.

**Ordering:** Stage 1 is fully green before Stage 2 consumes it; UI (3–4) consumes the data layer;
e2e (5) last. Each task ends independently testable; the ACL-at-creation coupling is placed in
Stage 1 (creation), not Stage 2, per the spec.

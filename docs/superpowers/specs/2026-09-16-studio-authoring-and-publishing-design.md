# Studio authoring & publishing — design

**Status:** approved-in-brainstorm 2026-09-16; spec under review before the plan.
**Feature #1 of three** carved from "implement what is missing" (the others: deploy docs,
OG-image spike). This is the design-heavy one.

## Goal

Give the studio a full **authoring and publishing surface** so the diary is self-serve end to
end — no seed script needed to run it. The owner can create and edit **trips** and **entries**,
see everything they have with its draft/published state, and **publish / unpublish** either.

## Why this is smaller than it looks, and where it is greenfield

Two of the four pieces already exist and are only *unreachable*:

- **The entry editor already edits and already sets status.** `EntryEditor` takes an `initial`
  prop (`{entry, etag}`, `components/studio/entry-editor/entry-editor.tsx:72`) threaded through
  `useEntrySave`'s create/update precondition logic; `use-entry-form.ts` seeds the form from an
  `existing` entry; the form carries a `status` field. `lib/pod/save-entry.ts` already pairs
  `dy:status` with the per-resource ACL (`setEntryAccess` → `makePublic`/`makePrivate` via
  `access.ts`) and already includes/excludes the entry from `entries.ttl` on status. Entry-side
  work is therefore mostly **wiring routes to what exists**, plus a publish/unpublish affordance.
- **Access control already exists.** `lib/pod/access.ts` sets document-vs-container ACLs and is
  studio-only. We **reuse** it; we do not change the mechanism (that would need sign-off per
  CLAUDE.md "Ask before doing").

Greenfield (nothing exists today):

- **Trip authoring.** There is no `createTrip`/`saveTrip`/`serialiseTrip` anywhere; trips exist
  only because `scripts/seed-dev-pod.ts` writes them. We build a trip write path mirroring the
  entry one.
- **The management surface.** The studio is a single `/studio` route that mounts the editor in
  *create* mode. There is no list of trips, no per-trip entries list, no edit route.
- **A top-level publication boundary for trips** (see the data contract below).

## Global Constraints (bind every task)

- **Node 22** before any check (`export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`).
- **The Pod is the only datastore.** No server session, no service account, no proxying writes
  through a route handler. Writes go **browser → Pod** with the visitor's own session
  (invariants #1–#4).
- **The studio route guard is UX, not security** (invariant #5). Every privacy guarantee in
  this feature is an **ACL**, never an app-level filter alone.
- **All IRIs from `lib/vocab.ts`.** No predicate string literals. Fragments only. Explicit
  datatypes (`xsd:date` for trip extent, `xsd:dateTime` with offset elsewhere, `xsd:decimal`
  for coordinates). Language-tag human-readable literals. Check `dy:schemaVersion` on read.
- **Every write carries a precondition** — `If-None-Match: *` to create, `If-Match: <etag>` to
  update. A blind PUT is a bug.
- **Access control only through `lib/pod/access.ts`** (enforced by `no-restricted-imports`).
- **Public/studio boundary.** New code lives under `app/(studio)/**`, `components/studio/**`,
  `hooks/studio/**`, `lib/studio/**`, or the studio-only `lib/pod/write.ts` seam. `(public)`
  must not import any of it. The public bundle budget (`size:public` ≤ 190 kB) must not move —
  this feature ships **no** new public client code.
- **Media**: resize client-side in a Web Worker (thumb / web ~1600px / blur), strip EXIF from
  every derivative, never upload an original with GPS. Reuse the phase-3 pipeline.
- **RDF compared by graph isomorphism**, never bytes.
- **`dy:` namespace is resolved** to `https://zeropara.me/ns/traveldiary#`. Local dev remains
  against Community Solid Server; no assumption of a live Pod is introduced.

## Architecture

**Everything new is client-side, holding the browser session.** The studio has no server
credentials, so the management views cannot server-render Pod data. Each studio route follows
the established three-file shape — **server page → `"use client"` wrapper → `dynamic(…, { ssr:
false })` client shell** (CLAUDE.md) — and the shell reads/writes with the authenticated
session, exactly as `listStudioTrips` and today's editor already do.

### Route tree (mirrors the public URLs, deep-linkable)

```
/studio                         trips list (create trip; per-trip status + entry count)
/studio/trips/new               trip editor — create
/studio/trips/[slug]            trip editor — edit + this trip's entries list (create entry)
/studio/trips/[slug]/[entry]    entry editor — edit (reuses EntryEditor with `initial`)
/studio/trips/[slug]/new-entry  entry editor — create, trip preset
```

The existing `/studio` page is repurposed from "mount the create editor" to "the trips list".
Entry create moves under a trip (it always belonged to one).

## Data / RDF contract

No new predicates or classes — the trip shape already exists in `docs/data-model.md` §7.2 and
the `Trip` Zod schema (`lib/pod/schema.ts`). What changes is that the **app now writes** trips,
and one read-model policy tightens.

### Trip resource (`trips/<slug>/trip.ttl#it`)

`serialiseTrip` writes, from the `Trip` schema: `a schema:TouristTrip, dy:Trip`; `dy:slug`;
`dy:status` (`dy:Draft`/`dy:Published`); `dy:schemaVersion` (current = 2); `schema:name`
(language-tagged); `schema:description`? (language-tagged); `dy:startDate`/`dy:endDate`
(`xsd:date`); `dy:coverImage`? (IRI); `dy:index` (IRI → this trip's `entries.ttl#it`);
`dcterms:created`/`dcterms:modified`. **Deferred to a later task** (not v1): `schema:tripOrigin`
(the `#origin` Place + geo) and `dy:track` (GPX/GeoJSON). Round-trips through `readTrip`/`getTrip`.

Two contract details the review surfaced:

- **No `xsd:date` literal writer exists.** `lib/pod/literals.ts` has `dt` (`xsd:dateTime`),
  `dec`, `int`, `text`, but no `date`. Add a `date` helper (mirroring `dt`) — trip extent is
  `xsd:date` (§6, §7.2), and writing it as `dateTime` would be a datatype bug.
- **Trip provenance parity.** §7.2 shows `dcterms:creator` and `dy:index`, but the current
  `Trip` Zod schema has **no `creator` field** (unlike `Entry`) and `readTrip` never reads one.
  For parity — and so the app-written `trip.ttl` matches the normative §7.2 fixture that the
  round-trip test builds from — **add `creator` to `Trip` (schema + `readTrip` + `serialiseTrip`)
  in the same change**, and write `dy:index`. (Decision: parity over a lighter schema; recorded
  in `docs/decisions.md`.) `serialiseTrip` also asserts `slug` == the container segment on write,
  mirroring `serialiseEntry`→`assertEntrySlug`.

### First-run bootstrap (an empty Pod must become authorable)

"Self-serve, no seed script" means the app must initialise a **blank** Pod. Today
`initialiseContainers` has **no production caller** and nothing authors `diary.ttl` outside the
seed, so on a real Pod the §4 containers and the `dy:Diary` root do not exist — `readDiary`/
`allTripSlugs` then reject (`cached.ts` throws the whole public build) and `createContainer` for
`trips/<slug>/` has no parent. So the flow must, on first use:

- Create the §4 container tree (`travel/`, `travel/trips/`, `travel/media/`) with their ACLs.
- Author a **valid `dy:Diary` root** in `diary.ttl`: `a dy:Diary`, `dy:schemaVersion 2`, a title,
  and an (initially empty) published-trip list — not merely the trip-row list the boundary
  section describes. `readDiary` must accept it.

This is idempotent (create-if-absent, `If-None-Match: *`) and runs before the first trip write.

### Container layout on create

Creating a trip creates, under `trips/<slug>/`: the container itself, `trip.ttl`, an **empty
`entries.ttl`** (a `dy:TripIndex` with zero rows), and the `entries/` container — matching the
layout `lib/studio/trips.ts` already computes (`INDEX_DOCUMENT`, `ENTRIES_CONTAINER`) and the
seed already produces. Then the trip's IRI is added to `diary.ttl` (see the boundary change).

### Cover image

`dy:coverImage` is an **IRI to the web-sized derivative** (data-model §7.2 / §3:
`<../../media/<hash>/web.webp>`, "curated, not derived"). Trip cover authoring **reuses the
media pipeline**: the derivatives (thumb/web/blur) are written under `media/<hash>/`, and
`dy:coverImage` is set to the `web.webp` IRI. No new media code.

### The trip publication boundary — the one read-model change

Today `diary.ttl` lists **every** trip (draft or not) and `publishedTripSlugs()` filters by
reading each `trip.ttl`'s `dy:status`. Under **strict/guarded**, a draft trip's slug should not
leak in a public resource, so **`diary.ttl` becomes published-trips-only** — a true publication
boundary, exactly as `entries.ttl` already is for entries. Publish adds the trip's row;
unpublish removes it; create adds it only if created-as-published. The existing status filter in
`publishedTripSlugs()` stays as defense in depth (now redundant but harmless). This does not
change any predicate or the container layout; it changes which rows the app writes into
`diary.ttl`. `docs/data-model.md`'s note that "diary.ttl lists every trip, draft or not" is
updated to match.

### ACLs (via `access.ts`, per-resource — the privacy boundary)

- **Draft trip** → the `trips/<slug>/` container is **owner-only** (Read/Write/Control for the
  owner, nothing for the public). A draft's `trip.ttl`, `entries.ttl`, and every entry under it
  are then unreadable to the public — `getTrip` 403s and the trip is filtered out, with no byte
  leak. **The container ACL is set atomically at creation, before any document is written into
  it** — `createContainer(publicChildren: false)` (`access.ts`) does this; writing `trip.ttl`
  first and setting the ACL after would transiently inherit `travel/trips/`'s public default.
  Because the create-time call forces the `publicChildren` decision, the status→ACL mapping lands
  in the container-creation step, not a later publish step.
- **Published trip** → the container is **public-read** (inherits to `trip.ttl`, `entries.ttl`,
  and published entries), **and** each *draft* entry inside keeps its own owner-only ACL
  (`setEntryAccess` already does this), so a draft entry stays private inside a published trip.
- **The `entries/` sub-container needs its OWN closed-listing ACL**, or a *published* trip leaks
  its **draft** entry *slugs* via `ldp:contains` even though the draft content stays private.
  Create `entries/` with the `acl:default`-without-`acl:accessTo` shape (data-model §4/§5) that
  `createContainer` produces — the container is not itself anonymously listable, while published
  child entries remain publicly readable. This is the "narrower guarantee" data-model already
  concedes; the point is not to regress it on the app-created containers.
- **`media/`** stays blanket public-read (phase-3 model): derivatives are EXIF-stripped and
  resized, and the privacy boundary is the *coordinate in RDF* (fuzzed before write), not the
  image. A content-addressed hash under an owner-only container is not discoverable from a
  draft. This is unchanged from today.

## The publish model — strict / guarded (chosen)

A small state machine over two `dy:status` values, enforced in the **UI + the write layer**
(the ACL is the real guarantee):

- **Publish an entry** is **blocked while its trip is a draft.** The UI disables it and offers
  "publish the trip first"; the write layer refuses (returns a structured `PodError`, never a
  silent no-op) so the rule holds even if the guard is bypassed. This requires the **trip's
  status threaded into the entry write layer** — `saveEntry` today receives `tripIri`/`tripSlug`/
  `indexUrl` but not the trip status; `EditorTrip.status`/`StudioTrip.status` already carry it,
  so it is a wiring change, not new data.
- **Publish a trip** flips `trip.ttl` `dy:status` → `Published`, sets the container ACL to
  public-read, and adds the trip's row to `diary.ttl`.
- **Unpublish a trip** flips status → `Draft`, sets the container ACL to **owner-only**, and
  removes the row from `diary.ttl`. Its entries keep their own status but become unreachable —
  which is correct and now leak-free (container is private). The UI states this plainly.
- **Unpublish an entry** flips status → `Draft`, sets the entry ACL owner-only, and removes its
  row from `entries.ttl` (all already implemented in `save-entry`).
- **No hard delete in v1.** Unpublish is the reversal. (Delete is a later task.)

Publishing is the owner's deliberate act, invoked from the list or the editor; it is never a
side effect of a background rebuild — matching the existing `rebuildIndex` note in
`lib/pod/save-entry.ts`.

**Recovery cannot lean on `rebuildIndex` for the ACL half.** `rebuildIndex` regenerates
`entries.ttl` but does **no** ACL work — it implements 4 of §10's 5 clauses, and adding the 5th
is blocked by a `write.ts`↔`access.ts` import cycle (tracked in `TODO.md`). So a partial failure
that leaves a resource "published-but-unreadable" (status flipped, ACL not) is *reported* but not
*converged* by rebuild. The publish/unpublish recovery therefore lives in a **leaf module**
(`save-trip.ts` / the trip-publish path, which can import `access.ts` freely): a
`reconcile(resource)` step that reads a resource's `dy:status` and forces its ACL to match, so a
retry converges both halves. This spec does **not** require breaking the `rebuildIndex` cycle;
it routes ACL convergence around it. (Breaking the cycle to give `rebuildIndex` full §10 parity
stays a separate, tracked task.)

## Components & modules

**New — data layer (`lib/pod/`, studio-only seam):**
- `lib/pod/literals.ts` — add a `date` helper (`xsd:date`) beside `dt`/`dec`/`int`/`text`.
- `lib/pod/trip-model.ts` — `serialiseTrip(trip)` + round-trip test coverage (mirrors
  `entry-model.ts`), asserting `slug` == the container segment on write; the trip-row builder for
  `diary.ttl` (mirror `index-model.ts`). Adds `creator` + `dy:index` for §7.2 parity.
- `lib/pod/save-trip.ts` — `saveTrip` (create/update `trip.ttl`; create the container +
  `entries.ttl` + `entries/` on first write via `createContainer`, ACL-at-creation from status;
  maintain `diary.ttl`), with the `SaveRecovery` partial-failure ladder `save-entry.ts` uses
  (`retry`/`refetch`) plus the leaf-module `reconcile` (ACL↔status) described above, and ETag
  preconditions. Publish/unpublish for trips route through here; for entries through
  `save-entry.ts`.
- `lib/pod/bootstrap.ts` (or wire the existing `initialiseContainers`) — idempotent first-run
  creation of the §4 container tree + a valid `dy:Diary` root (`create-if-absent`).
- `lib/studio/diary.ts` — read/maintain `diary.ttl` (published-only) with a
  `readDiaryWithEtag` + `putGuarded` read-modify-write, modelled on **`save-entry.ts`'s
  `writeIndex` + `read.ts`'s `readTripIndexWithEtag`** (NOT `lib/studio/trips.ts`, which only
  enumerates containers).

**New — hooks (`hooks/studio/`):**
- `hooks/studio/use-trip-form.ts` — trip editor form state (name, dates, description, tags,
  cover, status), mirroring `use-entry-form.ts`.
- `hooks/studio/use-trip-save.ts` — orchestrates `saveTrip` + revalidation, mirroring
  `use-entry-save.ts`.
- `hooks/studio/use-studio-trips.ts` — lists trips (wraps `listStudioTrips`) with status +
  entry counts for the trips list.
- `hooks/studio/use-studio-entries.ts` — lists one trip's entries (studio enumerates the
  `entries/` container via `ldp:contains`, seeing drafts and published alike — see
  `lib/studio/notes.md`).

**New — components (`components/studio/`), one-folder-each:**
- `components/studio/trips-list/` — the `/studio` trips list (create button, status badges,
  entry counts, links to edit/publish).
- `components/studio/trip-editor/` — the trip form (reuses the media pipeline for the cover);
  a publish/unpublish control.
- `components/studio/entries-list/` — one trip's entries with status badges, edit + publish/
  unpublish, "new entry".
- A shared `PublishControl` (or a small `use-publish` hook) used by both editors and both lists
  so the strict/guarded rules live in one place.

**Modified:**
- `app/(studio)/studio/page.tsx` + `components/studio/studio-client` — becomes the trips list
  entry point (keeps the profile/issuer/config plumbing and the `getOwnerProfile` prerender
  guard already there). **Keep the "Signed in as …" affordance** (`studio-shell.tsx`) — the
  login e2e (`e2e/solid-login.spec.ts`) asserts on it, so the refactor must not drop it.
- `lib/studio/revalidate.ts` — extend the revalidation so a trip **publish/unpublish** stamps
  `TAGS.diary` (the home page, sitemap and RSS all read `publishedTripSlugs`/`getDiary`, which
  carry `TAGS.diary`), and a trip **edit** stamps `TAGS.trip(slug)`. `save-entry`'s current
  `runRevalidation` only stamps `TAGS.trip`/`TAGS.entry`, so a trip-set change would otherwise
  leave the public surface stale.
- New route files under `app/(studio)/studio/trips/**` (server page → client wrapper → shell
  each).
- `components/studio/entry-editor/**` — reached from the new edit/create routes with `initial`
  and the trip's status; a publish/unpublish affordance added.
- `lib/pod/read.ts` — a `readTrip`-for-edit path if one is missing (map `Trip` → trip-form
  state); `getTrip` already exists for reads.
- `docs/data-model.md` — the `diary.ttl` published-only note; `docs/decisions.md` — a new
  numbered decision for the trip publication boundary and the strict/guarded model.

## Error handling

Every read returns a typed value or a structured `PodError` (Zod validate-on-read); never index
into raw triples in a component; never throw across the seam. Writes are precondition-guarded;
a 412 recovers via refetch, other partial failures via the `SaveRecovery` ladder already in
`save-entry.ts`. Publish/unpublish is **transactional in intent**: if the ACL write succeeds but
the index write fails (or vice-versa), the operation reports the partial state and offers a
retry that converges via the leaf-module `reconcile` step (ACL↔status) — **not** via
`rebuildIndex`, which does no ACL work (see the publish model). It never leaves a resource whose
ACL and status disagree without saying so.

## Security invariants (restated because this is the write path)

- No server session or credential store is introduced; writes are browser→Pod.
- The route guard under `(studio)` is UX; the ACL is the guarantee. Tests assert the ACL result
  (`access.ts` verifies the *result*, not the status code — see its notes), and the integration
  suite exercises a real draft's unreadability from an unauthenticated fetch.
- A draft (trip or entry) is never publicly readable — proven by an integration test that reads
  a draft resource unauthenticated and asserts a denial, not just app-level absence.

## Testing

- **Unit** against the in-memory fake Pod at the repository interface: `serialiseTrip`
  round-trip (graph isomorphism), `saveTrip` create/update/publish/unpublish, `diary.ttl`
  maintenance, the strict/guarded refusals, the ACL set for each status transition.
- **HTTP-level** with MSW for the save orchestration + precondition headers.
- **Integration** against local CSS: create → publish → read-back through the *public*
  (unauthenticated) reader; unpublish → assert the public read now denies; a draft entry inside
  a published trip stays private. The e2e/integration proof that a draft is ACL-private, not
  just filtered. **Include the `entries/` listing case**: an unauthenticated `ldp:contains` /
  container GET on a published trip's `entries/` must not enumerate draft entry slugs
  (fix #3) — and a bootstrap case: first-run initialisation of a blank Pod yields a readable
  `dy:Diary` root and an authorable container tree.
- **e2e (Playwright) is REQUIRED** — this diff touches `app/(studio)/**`,
  `components/studio/**`, `hooks/studio/**`, `lib/pod/write.ts` (and the media seam), which are
  on the gated globs. At minimum: sign in → create a trip → add an entry → publish → the entry
  is visible on the public site; unpublish the trip → it disappears from the public site. Run as
  `env -u CLAUDECODE -u AI_AGENT E2E_PORT=<port> npm run test:e2e`.
- Full definition of done (all twelve commands) green, with a Pod up so integration runs.

## Out of scope / deferred

- **Hard delete** of trips/entries (unpublish-only in v1).
- **GPX `track`** upload/parse/render, and **`schema:tripOrigin`** authoring (the trip's origin
  Place). Both are later tasks; the reader already tolerates their absence.
- OG images (feature #3, spike-gated) and deploy docs (feature #2) — separate specs.
- A public-facing "unlisted/shareable draft link" — not requested; strict/guarded means draft =
  private.

## Proposed staging (for the implementation plan)

Each stage is independently green and reviewable:

1. **Trip write path + bootstrap** — the `xsd:date` literal helper; `trip-model`
   (`serialiseTrip` + round-trip tests, `creator`/`dy:index`, slug==segment); `bootstrap`
   (idempotent §4 containers + `dy:Diary` root); `save-trip` create/update with
   **container-creation setting the ACL from status atomically** (so the status→ACL mapping
   lands here, coupled to creation — not deferred to Stage 2), `entries.ttl`/`entries/` bootstrap
   with the closed-listing ACL, ETag preconditions. No UI; `size:public` cannot move.
2. **`diary.ttl` as a publication boundary + convergent recovery** — published-only maintenance
   (via the `writeIndex`-style read-modify-write); publish/unpublish ACL transitions and the leaf
   `reconcile` (ACL↔status, routed around `rebuildIndex`); the strict/guarded refusals in the
   write layer (entry-under-draft-trip, trip status threaded in); revalidation stamping
   `TAGS.diary`; the integration proof that a draft (and its `entries/` listing) is ACL-private.
   Updates data-model + a decisions entry.
3. **Trips list + trip editor** — `/studio` becomes the list; `/studio/trips/new` and
   `/studio/trips/[slug]` author a trip (cover via the media pipeline); publish/unpublish from
   the list.
4. **Entries list + entry edit/create routing** — `/studio/trips/[slug]` shows the entries
   list; `/studio/trips/[slug]/[entry]` and `.../new-entry` wire the existing editor with
   `initial` + trip status + the publish control; the entry publish guard (blocked under a draft
   trip).
5. **End-to-end + polish** — the required Playwright flow, the full DoD, docs, and any
   consistency-state messaging.

## Open questions (none blocking; recorded)

- **Trips list scale.** `listStudioTrips` enumerates containers; for a large diary a paginated
  or lazy list may be wanted later. v1 renders the full list.
- **Concurrent edits.** ETag preconditions already make a stale write fail loudly; no
  multi-device conflict UI beyond "re-read and retry" in v1.

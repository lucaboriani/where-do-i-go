# ACP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The studio works on an Inrupt ESS Pod (ACP) with per-file public grants, while WAC (CSS)
keeps its current folder-default behaviour.

**Architecture:** One mechanism branch, inside `lib/pod/access.ts` only (decisions §19 reversed for
the container path, approved by the owner 2026-11-18). On ACP, containers stay owner-only and every
public document gets its own grant through a new `setInheritedPublicRead`, a no-op on WAC. Every ACP
grant is verified by reading back the rules and walking every ancestor's ACR up to the storage root.
Detection needs positive evidence for either mechanism; anything else is an error.

**Tech Stack:** TypeScript, `@inrupt/solid-client@3.0.0` (`universalAccess`, `acp_ess_2`), Vitest,
Community Solid Server 7.2.0 for integration, Playwright for the e2e gate.

**Spec:** `docs/superpowers/specs/2026-11-18-acp-support-design.md` — read it first.

Revised 2026-11-18 after an independent plan review (detection, WAC-Allow parsing, photo WebID,
the trip-editor flow, test approach).

## Global Constraints

- Node v22.x before every command: `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"; node -v`.
- Workflow (CLAUDE.md): `test-specialist` writes the failing test and shows it fail; `solid-specialist`
  implements (`nextjs-specialist` for Task 7); `test-specialist` confirms; `fullstack-solid-reviewer`
  reviews each task's diff.
- ACL/ACR primitives only in `lib/pod/access.ts`; the ESLint fence's file list is unchanged (its
  messages are updated in Task 8).
- Every write keeps its precondition. No `dy:` change, no container-layout change, no new dependency.
- Comments ≤3 lines, reasoning in the sibling `notes.md`. Functions ≤80 lines in `lib/`. Test files
  ≤1000 counted lines: `lib/pod/save-entry.test.ts` is at 967, so new entry tests go in
  `lib/pod/save-entry.grants.test.ts`; new ACP access tests go in `lib/pod/access.acp.test.ts`.
- Results, not throws, on every access path.
- **The owner's real Pod is written only in Task 1 and Task 8.** `.env.local` points at it: vitest
  and the e2e harness set their own env (`e2e/environment.ts`) and are safe. `npm run build`,
  `size:public` and `pod:seed` must run with `POD_ROOT`/`OWNER_WEBID` overridden to the local Pod
  (`POD_ROOT=http://localhost:3001/dev-mu4apmjp/ OWNER_WEBID='http://localhost:3001/dev-mu4apmjp/profile/card#me' npm run build`).
- No real Pod id or WebID in any committed file. Redaction checks read the values from `.env.spike`.
- Definition of done per CLAUDE.md, with `npm run pod:dev` up; the e2e gate applies.

## Test approach for `access.ts` (Tasks 2–5)

Follow `access.test.ts`'s own rule (its header, lines 17–46): fake the Pod behind the **injected
`fetch`**, not MSW handlers that encode the library's request sequence. Build one **stateful fake**
in `lib/pod/access.acp.test.ts`, keyed by URL and seeded from the Task 1 fixtures: GETs return the
current state, and writes to an ACR **change** that state. Tests assert the write requests sent and
their bodies, so a grant that was never written cannot pass by replay.

## Review Focus

1. ACP misread as WAC (any ACR/ACL read failure) must be an error, never a silent no-op → Task 2.
2. An ancestor policy for `acp:AuthenticatedAgent`, another agent, or a policy the walk cannot see
   must be refused → Task 3.
3. A retry after a 412 (diary, photo) still grants → Task 6.
4. A published trip switched to Draft in the editor, **twice in one session**, ends private → Task 7.
5. `settings/privacy.ttl` stays private on ACP with no grant of its own → Tasks 4 and 8.

---

### Task 1: Capture ESS fixtures from the real Pod

**Files:** Create `test/fixtures/ess/*.json` (redacted), throwaway `scripts/acp-capture.mts`
(never committed); modify the spec's Evidence section (items 8–9).

**Interfaces:** Produces fixtures `[{ request: { method, url }, response: { status, headers, body } }]`,
with the Pod id → `POD-ID`, WebID → `https://id.example/owner`, ACR id → `ACR-ID`:
`root-head.json`, `root-acr.json`, `fresh-container-acr.json`, `doc-public-grant-acr.json`,
`container-public-member-acr.json`, `owner-head-granted-doc.json`, `doc-after-update.json`.

- [ ] **Step 1:** write `scripts/acp-capture.mts` (client credentials from `.env.spike`,
  `npx tsx --env-file=.env.spike`), working in a scratch folder `where-i-go-acp-capture-<ts>/`;
  wrap `fetch` to record every exchange `acp_ess_2.getResourceInfoWithAcr`, `isAcpControlled` and
  `universalAccess.setPublicAccess` make.
- [ ] **Step 2:** measure and record as spec Evidence 8–9:
  - an `If-Match` PUT of a publicly granted document → anonymous GET still 200;
  - the **owner's** `WAC-Allow` header on a publicly granted document — does it contain `public=`?
- [ ] **Step 3:** run; confirm the scratch folder is gone (owner GET 404); redact; verify with a
  check that reads the real values from `.env.spike` and greps `test/fixtures/ess` → no match.
- [ ] **Step 4:** delete `scripts/acp-*.mts`. Commit fixtures + spec: `test(pod): recorded ESS ACR fixtures for ACP support`.

### Task 2: Mechanism detection on positive evidence

**Files:** `lib/pod/access.ts`, `lib/pod/notes.md`; tests in `lib/pod/access.acp.test.ts`, and
`lib/pod/access.test.ts:91-102` (`CALLS` list).

**Interfaces:**
- Produces `detectMechanism(url: string, fetch: PodFetch): Promise<Result<"wac" | "acp">>` (exported for tests).
  `"acp"` only when `hasAccessibleAcr(await getResourceInfoWithAcr(url))`; `"wac"` only on a
  readable WAC ACL (`hasResourceAcl`, or `hasFallbackAcl && hasAccessibleAcl`, as
  `resolveContainerAcl` decides today); a throw or neither → `err(unverified(url, "a readable WAC ACL or ACP access control resource", …))`.
  Do **not** use `isAcpControlled`: it swallows ACR read failures into `false`.
- Called on the target after it exists (spec, Detection).

- [ ] **Step 1: failing tests:**
  - `→ "acp" on the recorded ESS responses`; `→ "wac" on a CSS-shaped fake with a readable .acl`
  - `→ err (not "wac") when the ACR read answers 403 / 500 / network on an ESS-shaped fake`
  - `→ err when neither an ACL nor an ACR is readable`
  - add `setInheritedPublicRead` to `CALLS` in `access.test.ts` so the `yesMan` fake must yield an error (red until Task 5 exports it; mark that test `todo` with a pointer until then)
- [ ] **Step 2–4:** fail, implement, pass; all existing `access.test.ts` tests unchanged.
- [ ] **Step 5:** rewrite the inline warning at `access.ts:7-9` (one shouted line + pointer) and the
  notes.md sections "Why the container path is not a mechanism branch" and "Document versus
  container is the only branch".
- [ ] **Step 6:** commit `feat(pod): detect WAC vs ACP on positive evidence only`.

### Task 3: Owner-only check and ancestor walk

**Files:** `lib/pod/access.ts`, `lib/pod/notes.md`, `lib/vocab.ts` (add `PIM.Storage` =
`${NS.pim}Storage`; the raw-IRI lint rule requires it; `check:vocab` covers only `dy:`). Tests:
`lib/pod/access.acp.test.ts`.

**Interfaces:**
- `acpOwnerOnlyViolation(resource: WithAccessibleAcr, webId: string): string | null` — pure. Covers
  allow policies referenced by `getPolicyUrlAll`, `getMemberPolicyUrlAll`, `getAcrPolicyUrlAll`,
  `getMemberAcrPolicyUrlAll`. A violation (message naming the policy) when: any matcher is public,
  authenticated, a client, an issuer, a VC, or an agent ≠ `webId`; the policy uses `anyOf`/`noneOf`
  in a way that is not exactly "owner only"; or a policy or matcher **is not in the ACR dataset**
  (cannot be evaluated → fail closed).
- `acpAncestorWalk(url: string, opts: { fetch: PodFetch; webId: string }): Promise<Result<null>>` —
  parent upward, member policies only, stop after the ancestor whose response has
  `Link: <PIM.Storage>; rel="type"`; reaching the origin without it → error.

- [ ] **Step 1: failing tests:**
  - `passes the recorded root ACR`; `refuses the recorded public member policy, naming it`
  - `refuses an AuthenticatedAgent matcher` / `another agent` / `a policy referenced but absent from the ACR` (each fixture edit asserted applied)
  - `refuses a public acp:access policy on the ACR itself`
  - `walk stops at the pim:Storage root and requests nothing above it`; `walk errs without pim:Storage`
  - `walk refuses a grandparent passing public read down`
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: mutation control, recorded in notes.md:** walk returns `ok(null)` at once → the walk tests go red; revert.
- [ ] **Step 6:** commit `feat(pod): ACP owner-only check and ancestor walk`.

### Task 4: The ACP container path

**Files:** `lib/pod/access.ts` (`createContainer`, `setContainerAccess`, `initialiseContainers`,
container branch of `makePublic`/`makePrivate`), `lib/pod/notes.md`. Tests: `access.acp.test.ts`.

**Interfaces:** signatures unchanged. On ACP a container call returns
`ok({ url, read: false, append: false, write: false, inherits: false, inheritsVerifiedBy: "notApplicable", verifiedBy: "rules" })`
after the owner-only check; `initialiseContainers` then runs `acpAncestorWalk` on
`travel/settings/` before `ok`. On ACP `webId` is required: missing → error.

- [ ] **Step 1: failing tests:**
  - `createContainer on ACP creates, checks, and sends no ACR write`
  - `createContainer on ACP refuses a container whose ACR grants the public, deleting nothing`
  - `initialiseContainers on ACP refuses when an ancestor passes public read down`
- [ ] **Step 2–4:** fail, implement, pass; WAC tests and the CSS integration suites unchanged.
- [ ] **Step 5:** commit `feat(pod): ACP containers stay owner-only; setup checks every ancestor`.

### Task 5: Documents on ACP, and `setInheritedPublicRead`

**Files:** `lib/pod/access.ts`, `lib/pod/notes.md`, `docs/data-model.md` §5. Tests: `access.acp.test.ts`, `access.test.ts`.

**Interfaces:**
```ts
export type InheritedPublicRead =
  | { url: string; governedBy: "container" }       // WAC: nothing written, nothing read back
  | (AccessState & { governedBy: "own" });         // ACP: granted/revoked and verified
export function setInheritedPublicRead(
  url: string, read: boolean, opts: { fetch: PodFetch; webId: string },
): Promise<Result<InheritedPublicRead>>;
```
- On ACP, document `makePublic`/`makePrivate` and `setInheritedPublicRead` run
  `applyDocumentPublicRead` then `acpAncestorWalk`. `getAccess` on ACP adds the walk on its rules fallback.
- **WAC-Allow counts as server evidence only when the raw header contains `public=`**
  (`serverPublicAccess`, used by `setDocumentPublicRead` and `getAccess`); otherwise fall back to
  rules. Confirm against Task 1's `owner-head-granted-doc.json`.
- Decide and record in notes.md: whether verification adds an anonymous `HEAD` (the spec leaves it
  to the builder; state the choice and why).

- [ ] **Step 1: failing tests:**
  - `on WAC: no write and no ACL read beyond detection; returns governedBy:"container"`
  - `on ACP: sends the ACR write, reads back, walks; returns governedBy:"own", read:true`
  - `makePrivate on ACP errs when an ancestor still passes public read down`
  - `an owner WAC-Allow without public= is not read as public:false` (recorded header)
  - `getAccess on ACP reports inherited public read, not read:false`
  - un-`todo` the `CALLS` contract test from Task 2
- [ ] **Step 2–4:** fail, implement, pass. Mutation: skip the walk in `makePrivate` → test 3 red.
- [ ] **Step 5:** commit `feat(pod): per-document public grants on ACP, verified up the tree`.

### Task 6: Callers grant what WAC inherits

**Files:** `lib/pod/bootstrap.ts`, `lib/media/upload.ts` (+ `webId` in `UploadPhotoOptions`),
`hooks/studio/use-photo-pipeline.ts:147` (pass `session.info.webId`), `lib/pod/save-entry.ts`,
`lib/pod/save-trip.ts` (`publishStatus`, `reconcile`). Tests: `bootstrap.test.ts`,
`lib/media/upload.test.ts` (MSW today: add `vi.mock("@/lib/pod/access")` or handlers for the new
calls), new `lib/pod/save-entry.grants.test.ts`, `save-trip.test.ts`, `hooks/studio/use-photo-pipeline.test.ts`.
Add `setInheritedPublicRead` to the six `vi.mock("@/lib/pod/access")` factories
(`save-trip.test.ts:73`, `save-entry.test.ts:94`, `bootstrap.test.ts:50`, `trips-list.test.tsx:33`,
`entries-list.test.tsx:31`, `entry-editor.harness.tsx:155`).

**Interfaces:** consumes `setInheritedPublicRead`. `publishStatus` grants belong to step `"acl"`.
`saveEntry`'s index step needs `tripStatus` when it **creates** `entries.ttl`: missing → the step
fails with a `shape` error rather than creating it private; `test/integration/pod-authoring.integration.test.ts:177-180`
then passes `tripStatus`.

- [ ] **Step 1: failing tests** (each asserts the call, its arguments, and that a failed grant stops the sequence reporting that step):
  - `ensurePodInitialised grants diary.ttl read:true`, `… also on a 412`
  - `uploadPhoto grants web and thumb read:true with the caller's webId`, `… also on 412 reuse`
  - `use-photo-pipeline passes session.info.webId to uploadPhoto`
  - `saveEntry grants entries.ttl read:(tripStatus==="published") when it created it; none on If-Match update; errors at "index" without tripStatus`
  - `publishTrip grants trip.ttl and entries.ttl read:true in "acl"`; `unpublishTrip … read:false`
  - `reconcile reports inherits as access.ts returned it` (update the mock at `save-trip.test.ts:102-106`)
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: mutation controls, recorded:** remove each new call in turn → its test goes red.
- [ ] **Step 6:** `npm test` with the Pod up — integration suites ran and pass.
- [ ] **Step 7:** commit `feat(studio): grant per-document public read where WAC inherits it`.

### Task 7: A status change in the trip editor goes through publish/unpublish

**Files:** `lib/pod/save-trip.ts`, `hooks/studio/use-trip-save.ts` (+ notes),
`components/studio/trip-editor/trip-editor.tsx`. Tests: `save-trip.test.ts`,
`use-trip-save.test.ts`, `trip-editor.test.tsx`; their `vi.mock("@/lib/pod/save-trip")` factories
(`use-trip-save.test.ts:23`, `trip-editor.test.tsx:28`) gain `publishTrip`/`unpublishTrip`.

**Design (plan-time calls):**
- **Create is always a draft.** `saveTrip` refuses a create with `status: "published"` (failed at
  `"trip"`, `shape` error, no request). The editor's Status select is not shown when creating; the
  trip is published afterwards from the trips list, as today. (Avoids chaining on an ETag CSS
  does not return on PUT.)
- **Update with a changed status:** the hook does **not** call `saveTrip`; it calls
  `publishTrip`/`unpublishTrip` once with the edited trip and the stored ETag (`publishStatus`
  already writes every field). Unchanged status → `saveTrip` as today.
- `SaveTripOptions` gains `storedStatus: Status`, **required when `etag` is present** (type-level);
  `saveTrip` refuses an update whose `trip.status !== storedStatus`.
- The hook keeps `storedStatus` and `etag` in **state**, updated after every successful write
  (`existing` from `initial` is never re-read).
- `announce` gets messages for a `PublishTripReport`: success ("Published" / "Moved to drafts"),
  failure at `"trip"` (nothing changed), `"acl"`/`"diary"` (the trip saved, its visibility did not
  finish — publish again), `"revalidate"` (saved; the site updates shortly).

- [ ] **Step 1: failing tests:**
  - `saveTrip refuses a published create, with no request`; `refuses an update whose status ≠ storedStatus`
  - `hook: published → draft calls unpublishTrip once with edited fields and stored ETag, never saveTrip`
  - `hook: draft → published → draft in one session calls publish then unpublish (stored status tracked)`
  - `hook: unchanged status calls saveTrip with storedStatus`
  - `hook: an "acl" failure shows the "visibility did not finish" message`
  - `editor: no Status select when creating`
- [ ] **Step 2–4:** fail, implement, pass; `npm run typecheck`.
- [ ] **Step 5:** e2e gate `env -u CLAUDECODE -u AI_AGENT E2E_PORT=3007 npm run test:e2e` (ask the
  owner to stop any running `next dev` first).
- [ ] **Step 6:** commit `fix(studio): trip status changes always go through publish/unpublish`.

### Task 8: Docs, full gate, manual check on the owner's Pod

**Files:** `docs/decisions.md` (new §40; §19 pointer; §14 log), `docs/data-model.md` §4/§5,
`docs/phase-0-spike.md`, `docs/deploy.md` §6–§7, `eslint.config.mjs` messages at lines 131 and 319
(no longer "not reliably detectable; see §19"), `TODO.md`.

- [ ] **Step 1:** docs as listed; state the CSS-in-ACP-mode decision (used as an integration target or not, and why) in §40.
- [ ] **Step 2:** full definition of done, Pod up, Node 22, build/size with the local-Pod override
  (Global Constraints), e2e gate. Every command passes; integration suites ran.
- [ ] **Step 3: manual check with the owner**, `.env.local` on the real Pod, `npm run dev`: log in,
  setup runs; create trip "acp-check" (draft), a published entry with a photo, a draft entry;
  publish the trip from the trips list; write `travel/settings/privacy.ttl` by hand with the
  owner's fetch. Anonymous `curl` status codes:
  - 200: `travel/diary.ttl`, `trip.ttl`, `entries.ttl`, the published entry, its `web.*`, `thumb.*`
  - 401: `travel/`, `trips/acp-check/`, `…/entries/`, `media/<id>/`, the draft entry, `privacy.ttl`
  - edit the published entry's text (an `If-Match` update) → still 200
  - switch the trip to Draft **in the editor** → 401 on `trip.ttl`, `entries.ttl`; the diary no longer lists it
  Record the results in `docs/phase-0-spike.md`.
- [ ] **Step 4: cleanup:** the owner deletes the "acp-check" trip's resources and the hand-written
  `privacy.ttl` (or keeps them as their first real trip — ask).
- [ ] **Step 5:** whole-branch review by `fullstack-solid-reviewer`.
- [ ] **Step 6:** commit `docs: ACP support — decisions §40, data model §5, deploy`; ask the owner
  before merging and pushing; remind them to revoke the spike app credentials.

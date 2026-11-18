# ACP support for the studio — design

Date: 2026-11-18. Status: draft for approval, revised after an independent review the same day.

## Why

The owner's real Pod is Inrupt PodSpaces (ESS), which uses **ACP**. The studio's first-run setup
fails there: `lib/pod/access.ts`'s container path only writes WAC ACLs and, by design, refuses
anything else ("could not verify access on …/travel/: expected WAC authorisations …"). Nothing can
be published until this works. The local Community Solid Server (WAC) must keep working exactly
as it does today.

## Goals

- First-run setup, trip create/publish/unpublish, entry publish/unpublish and photo upload all
  work on ESS (ACP), with the same public/private outcomes the public site expects.
- WAC behaviour unchanged: same ACL documents and the same public/private outcomes. (Not
  literally the same requests: mechanism detection adds requests, and a few test mocks change.)
- On ACP, draft names are not listable (folder listings stay closed) — an improvement over WAC.

## Non-goals

- ACP on servers other than ESS-shaped ones (only ESS was measured).
- Migrating WAC Pods to per-file grants.
- Changing the RDF data model, the container layout, or any `dy:` term.

## Anti-goals (a failure even if it "works")

- Any draft, unpublished trip, or `settings/privacy.ttl` publicly readable on either mechanism.
- An access call that reports success while the public can still read the resource (the spike
  produced exactly this with inherited ACP policies — see Evidence).
- Owner locked out of their own resources.

## Evidence (spikes against the owner's ESS Pod, 2026-11-18)

1. A public-read **member policy** on a container: the container itself stayed closed (401), but
   **every** descendant became public — files, sub-containers (listable), and a sub-container meant
   to be private. Inheritance is dynamic: a file created later was public without any copy.
2. Under that inherited allow, `universalAccess.setPublicAccess(read: false)` on a file
   **returned `read: false` while an anonymous GET still returned 200.**
3. A public **deny** policy hid the file from the public but also returned **403 to the owner**
   (the public matcher matches every agent).
4. With no inherited policy: `universalAccess.setPublicAccess(read: true)` on a Turtle file and on
   a binary (`image/webp`) made each anonymously readable (200) while their containers stayed 401;
   `read: false` returned it to 401; the owner kept 200 throughout; re-granting is idempotent.
5. `acp_ess_2.isAcpControlled(url, { fetch })` returned `true` on ESS and `false` on CSS 7.2.0 (WAC).
6. ESS sends no `WAC-Allow` to anonymous requests; it sends `user="read control write"` to the owner.
7. The owner's Pod root has one policy, used both as its own and as a member policy: allow read +
   write to the owner's WebID only (not public, not authenticated). That is where the owner's access
   to every new resource comes from. `travel/` exists, is empty, and has no policies of its own
   (left over from the failed setup).

## Approaches considered

1. **Per-file grants on ACP, WAC unchanged — chosen.** On ACP, containers carry no public
   policy; every resource that should be public gets its own public-read grant; anything without
   one is private by default. WAC keeps container-default inheritance. Costs more requests and one
   documented exception to decisions §19. Picked because nothing is inherited, so a forgotten step
   leaves something private rather than public (fails closed), and listings stay closed.
2. **Mirror WAC with ACP member policies plus deny exceptions.** Fewer requests, but inheritance is
   recursive (evidence 1), deny also blocks the owner unless carefully scoped (evidence 3), and a
   missing deny is a silent public leak (evidence 2). Rejected.
3. **Per-file grants on both mechanisms.** No branch, but rewrites the verified WAC path and changes
   the local Pod's behaviour. Rejected: the owner asked to keep WAC as is.

## Design

### The one branch, inside `lib/pod/access.ts` only

This **reverses decisions §19** ("never branch on mechanism") for the container path — an owner
decision, recorded as such. No module other than `access.ts` learns which mechanism is in use; the
lint rule banning ACL primitives elsewhere stays as is.

**Detection, on positive evidence only.** Once per operation, against the target resource **after
it exists**: `"acp"` only when its access control resource is readable (`getResourceInfoWithAcr` +
`hasAccessibleAcr`); `"wac"` only when a WAC ACL is readable (as `resolveContainerAcl` decides
today); anything else, including a thrown error, is an **error**. Not `isAcpControlled`: it turns a
failed ACR read into `false`, which would read ACP as WAC and make `setInheritedPublicRead` a silent
no-op. *(Revised after the plan review.)*

Both misdetections fail closed: neither ACL nor ACR readable is an error; WAC taken for ACP finds no
readable ACR and refuses. (Without this, a set-up WAC Pod taken for ACP would give new trip and
entries containers no ACL of their own, so they would inherit `trips/`'s public default and their
listings would open — `lib/pod/notes.md#createcontainer-is-one-operation-because-the-halves-cannot-be-separate`.)

### Interface

The §5 four keep their signatures and meaning. One addition:

- **`setInheritedPublicRead(url, read, opts)`** — for a *document* that WAC makes public through
  its container's default (diary, trip, index, media derivatives). On **WAC: a no-op**, returning a
  distinct "decided by the container" result — never an `AccessState` claiming the requested `read`,
  since nothing was read back. On **ACP: an explicit public-read grant or revoke** via
  `universalAccess`, then verified (below).

| Call | WAC (unchanged) | ACP |
|---|---|---|
| `createContainer(url, {publicChildren})` | creates, own ACL, public default if `publicChildren` | creates; runs the **owner-only check** on the container; `publicChildren` ignored |
| `makePublic` / `makePrivate` on a container | rewrites the container ACL | owner-only check; returns success with `inherits: false` |
| `makePublic` / `makePrivate` on a document | `universalAccess` (today) | `universalAccess` + verification |
| `setInheritedPublicRead(doc, read)` | no-op (distinct result) | `universalAccess` grant/revoke + verification |
| `initialiseContainers` | today | creates the four containers as above, then runs the **ancestor walk** from `travel/` to the storage root before reporting success |
| `getAccess` | today | falls back to rules as today, plus the ancestor walk |

**Owner-only check.** Read the container's ACR. Refuse, naming the policy, if any **allow** policy
of any of the four kinds — `acp:accessControl`, `acp:memberAccessControl`, and the ACR's own
`acp:access` / `accessMembers` — has a matcher that is anything other than exactly the owner's
WebID (public, authenticated, other agents, clients). Never delete a policy. The owner's own
inherited policy (evidence 7) passes.

**Ancestor walk.** Inheritance is recursive (evidence 1), so a resource is only as private as every
ancestor's member policies. Walk from the resource's parent up to the **storage root**, found by the
`Link: <http://www.w3.org/ns/pim/space#Storage>; rel="type"` header (fail closed if no ancestor
carries it), and apply the owner-only check to each ancestor's member policies. Caching per
operation is the builder's call. This is what keeps `settings/privacy.ttl` private on ACP: it has
no grant of its own, so it is private exactly when no ancestor passes anything down.

### Callers that gain a `setInheritedPublicRead` call

| Document | When | `read` |
|---|---|---|
| `travel/diary.ttl` | `bootstrap.ts` creates it, **including on 412** | `true` |
| `trips/<slug>/trip.ttl`, `entries.ttl` | the publish/unpublish transaction (`publishStatus`) | new status |
| `trips/<slug>/entries.ttl` | `save-entry.ts` creates it when missing (`save-entry.ts:166-189`) | `tripStatus === "published"` |
| `media/<id>/web.*`, `thumb.*` | `lib/media/upload.ts` after each derivative, **including on 412 reuse** | `true` (matches WAC, where `media/` is public by default) |

- **Trip documents are granted only in the publish transaction**, not in `saveTrip`'s create path.
  Creating a trip as published runs that transaction. If a create fails part-way, the documents stay
  private (fail closed) and the recovery is to publish again; `saveTrip` itself does not converge on
  a retry (its `If-None-Match: *` PUT answers 412) and the spec does not claim it does.
- **`lib/pod/write.ts`'s index rebuild gets no grant.** It cannot import `access.ts` (that would be
  an import cycle), it does not know the trip status, and it has no callers outside tests.
- **Entry documents** already get explicit `makePublic` / `makePrivate`; no change.
- **Updates of existing documents** (`If-Match` PUTs) do not touch access: the ACR belongs to the
  resource. Verified in the manual check, not assumed.
- **`save-trip.ts`'s `reconcile`** stops overwriting `inherits` with the requested value and reports
  what `access.ts` returned. Nothing outside `access.ts` and tests reads `.inherits`; the mock at
  `save-trip.test.ts:102-106` is updated with it.

### Fix included: a status change in the trip editor bypasses the publish transaction

Pre-existing on both mechanisms (independent review H1): the editor's Status select
(`components/studio/trip-editor/trip-editor.tsx:142-157`) reaches `saveTrip`'s update path
(`save-trip.ts:165-178`), which only PUTs `trip.ttl`. No access change, no diary row. So a published
trip switched to Draft stays public on WAC today, and would on ACP. The fix: when an update changes
the status, it goes through the publish/unpublish transaction rather than a bare PUT. How the editor
expresses that is the builder's call, as long as no path changes `dy:status` without the access
change.

### Verification on ACP

`WAC-Allow` is absent for anonymous requests on ESS (evidence 6). After every ACP grant or revoke:
read back with `universalAccess.getPublicAccess` (rules evidence, as today) **and** run the ancestor
walk. That closes evidence 2's false success. Whether to also issue an anonymous `HEAD`
(enforcement evidence) is the builder's call; `access.ts`'s notes argue it cannot, and that
argument should be re-checked rather than assumed.

### Docs

- `docs/decisions.md`: a new section recording the reversal of §19 for the container path, the
  approach, and the spike evidence; §19 points at it; §14's change log.
- `docs/data-model.md`: §5's interface addition and its "reports `accessUnverified`" sentence; §4's
  "ACP equivalent is untested" paragraph (now closed on ACP).
- `lib/pod/access.ts`: the inline trap warning at lines 7–9 ("DO NOT DETECT THE MECHANISM") is
  rewritten. In `lib/pod/notes.md`: "Why the container path is not a mechanism branch" and
  "Document versus container is the only branch".
- `docs/phase-0-spike.md`: the ACP listing leak is closed by this design.
- `docs/deploy.md` §6–§7: ACP is supported for setup; per-file grants mean more requests.

## Testing

- **Fixtures from the real server.** The ACP unit tests use ESS access-control responses captured
  from the owner's Pod (redacted), not a fake built from assumptions. A fake written from the
  builder's own beliefs about ESS only proves the code agrees with itself.
- **Mutation controls, recorded.** Delete the ancestor walk and the suite goes red. Drop a caller's
  grant and that caller's test goes red. Every caller test mocks `@/lib/pod/access` wholesale today
  (`save-trip.test.ts:73`, `save-entry.test.ts:94`, `bootstrap.test.ts:50`), so a new call proves
  only call order unless such a control exists.
- **WAC.** The CSS integration suites pass unchanged in outcome. Whether CSS in ACP mode is a useful
  integration target is the builder's call; if not, say so rather than add a test that verifies
  nothing.
- **Manual check on the owner's ESS Pod**, at the end, with `curl` and no credentials:
  - Positives: the diary, a published trip's `trip.ttl` and `entries.ttl`, a published entry and its
    photos return 200.
  - Negatives return 401: the listings of `travel/`, `trips/<slug>/`, `entries/` and `media/<id>/`;
    a draft entry; an unpublished trip's `trip.ttl` and `entries.ttl`; a trip switched to Draft
    **in the editor**; and a `settings/privacy.ttl` written by hand for this check (nothing in the
    studio writes one yet).
  - An `If-Match` update of a public document stays public.
- **The e2e gate applies** (`lib/media/**`, `lib/studio/**`, `hooks/studio/**`, `components/studio/**`).
- The throwaway `scripts/acp-spike*.mts` are deleted, never committed.

## Left to the builder

- Exact function and error names; how detection and the walk are cached per operation.
- Whether verification adds an anonymous `HEAD`.
- Whether CSS-in-ACP-mode is a usable integration target.
- How the trip editor routes a status change through the publish transaction.

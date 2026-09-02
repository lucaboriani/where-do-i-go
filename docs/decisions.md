# Decisions

Why the stack is what it is. Each entry records the decision, the reasoning, and what was
rejected, so none of it gets re-argued from scratch. Add to the end; do not rewrite history.

---

## 1. A Solid Pod is the only datastore

Trips, entries and photos live in the owner's Pod. There is no database.

Data ownership is the product, not an implementation detail: delete the app and the content
survives in storage the owner controls. There is no export feature because nothing was ever
captured.

**Consequences.** No queries, no joins, no aggregation, no server-side sorting. Every list
view is backed by an index resource maintained on write. Photo serving has no CDN in front of
it by default. Storage quotas are real.

**Rejected:** a database with the Pod as a sync target. It would make the Pod a backup rather
than the source of truth, and the ownership claim would become marketing.

---

## 2. Next.js, with two distinct access paths

Public pages are server-rendered from unauthenticated fetches of public Pod resources. The
studio is a client-side app holding the visitor's own Solid session.

Next was chosen partly because agents write it reliably. The two-path split is what makes it
earn its keep: SSR, metadata and OG image generation all serve the public reading path, while
the studio needs no server at all.

**Consequences.** No server-held credentials anywhere. A full compromise of the hosting
account still cannot write to the Pod. Cache invalidation needs an explicit hook, because the
Pod cannot notify the app of changes.

---

## 3. Public read, owner-only write

The frontend is readable by anyone. Writes are authorised by the Pod against the owner's
WebID. Anyone can clone the project and point it at their own Pod.

**Consequences.** Every resource must be assumed world-readable. Coordinate fuzzing and EXIF
stripping happen before the write, never at render time. The owner check in the studio is a
courtesy message, not a security boundary.

---

## 4. No drafts container

Publication state is `dy:status` plus a per-resource ACL, not a location in the container
hierarchy.

Moving a container on publish would rewrite every resource IRI beneath it, so an entry's RDF
identity would change at the moment it became public. Stable identity is worth more than the
convenience of container-level access control.

**Consequences.** The public index resource contains only published entries, which is what
makes a draft leak structurally impossible rather than merely unlikely. The studio enumerates
the container directly to see drafts. Depends on per-resource ACLs working — spike item 3.

---

## 5. Per-entry resources plus an index

Each entry is its own resource. A single index resource per trip carries the denormalised
read model, including bounding box, center and entry count.

One resource per entry costs an extra request but gives partial loading, per-entry sharing,
and far fewer write conflicts. A single trip document stops being simpler around entry thirty.

The index exists because the Pod cannot query. Derived values live on the index rather than
the trip so that an entry write touches two resources instead of three, and so all derived
data shares one modified timestamp.

**Consequences.** The index can drift from reality. `rebuildIndex(trip)` is required in phase
1, not later; it is also the migration tool when `dy:schemaVersion` increments.

---

## 6. MapLibre GL JS, not Mapbox

Mapbox GL JS moved to a proprietary licence at v2, requires an active Mapbox account, and
bills per map load with no hard spending cap. For an open-source project whose pitch is data
ownership, a proprietary required dependency is both awkward and a per-deployer signup step.

MapLibre is the BSD-licensed community fork, now at v6, with globe projection since 5.0.0.

**Consequences.** No hosted static-images API, so OG images are generated in-house (decision
8). No bundled geocoding (decision 9). Tile hosting becomes an explicit choice (decision 7).

**Rejected:** Mapbox behind an abstraction. The abstraction is cheap, but the licence and the
signup step are the problems, and an abstraction fixes neither.

---

## 7. OpenFreeMap tiles by default

Free, unlimited, no registration, no API keys, no cookies. Built from OpenStreetMap data and
designed for MapLibre. Self-hostable, with full planet downloads published.

This is what makes "fork, set your WebID, deploy" true with no setup step.

**Consequences.** Best-effort community infrastructure, not an SLA — donation-funded, running
on a small number of dedicated machines. The style URL is an env var so any deployer can point
at a paid provider. OSM attribution is mandatory and must never be removed from the map chrome.

**Also considered:** Protomaps `.pmtiles` on object storage, which needs HTTP Range support;
MapTiler or Stadia, which reintroduce per-deployer API keys.

---

## 8. OG images generated in-house

No static-maps API is available, and server-side MapLibre rendering needs native bindings and
headless GL, which is unpleasant on serverless.

Instead: project the trip's coordinates directly (Web Mercator is about ten lines), draw the
route as an SVG polyline on the site's dark palette, and compose with `next/og`. A trip photo
can back it.

**Consequences.** Looks intentional rather than like a missing map, costs nothing at runtime,
and no vendor. Needs verifying on the deploy target — spike item 7.

---

## 9. Nominatim, at edit time only

Reverse geocoding happens once per entry, in the studio, for one user. That volume sits
comfortably inside Nominatim's usage policy and needs no key. The resolved place name is
stored in the Pod, so the public site never geocodes anything.

**Consequences.** Respect the policy: real User-Agent, roughly one request per second, no
type-ahead. If autocomplete is wanted later, Photon is the candidate.

---

## 10. Offline deferred

Travel means bad connectivity, so this will matter eventually. It is not in v1.

Local-first writes with a sync queue is close to an architectural rewrite if bolted on, so the
precondition-based write protocol was designed to be its foundation. In the meantime the
studio autosaves in-progress text to `localStorage`, because losing a long entry in a hostel
is what kills the habit.

---

## 11. shadcn/ui in the studio only

The studio needs accessible dialogs, comboboxes, selects and a drag-up sheet. shadcn copies
source into the repo rather than shipping a dependency, so the code can be restyled freely.
Its Drawer wraps Vaul and provides the snap-point sheet the mobile map layout needs.

**Consequences.** Stock shadcn styling is one of the most recognisable generated-app looks and
must be restyled, not tweaked — see `docs/design-brief.md`. None of it may reach public
reading pages. `components/ui/**` is exempt from the arbitrary-Tailwind-values lint rule.

---

## 12. Local Community Solid Server for dev and CI

An afternoon of docker-compose setup. It stops agents thrashing against a live Pod, makes
tests hermetic, and makes the eventual self-hosting migration nearly free by proving the app
works against both server implementations from day one.

---

## 13. Netlify as the deploy target

Supports everything the design needs: App Router, RSC, SSR, ISR, tag-based on-demand
revalidation, and `next/image` through Netlify Image CDN.

**Consequences.** Requires the current adapter — the legacy v4 runtime supports neither tag
nor path revalidation. Node.js in Middleware is unsupported, so nothing needing Node APIs may
live in middleware.

The architecture has nothing platform-shaped to lock in: no database, no sessions, no
background jobs. A `netlify.toml`, a `Dockerfile` and `next start` instructions ship together
so Cloudflare and plain VPS deploys stay viable.

---

## 14. TypeScript pinned below latest

TypeScript 7 is current, but no stable `typescript-eslint` release supports it yet. Type-aware
lint rules enforce several guardrails, so they win over version recency. Details and the
upgrade trigger are in `docs/versions.md`.

---

## 15. Blazing blue accent, hue 250

A single accent at `oklch(0.660 0.182 250)` / `#1295FC`, with a brighter step for text and a
deeper step for route casing. Full palette and contrast measurements in
`docs/design-brief.md`.

Blue is the web's default accent, so the distinctiveness comes from the exact values and from
restraint about where it appears, not from the hue. It was chosen over the acid-green that a
dark-background brief tends to attract, which is a recognisable generated-design pairing.

**Consequences.** Water in the basemap must be pushed to hue 235 at roughly a tenth of the
accent's chroma, otherwise the route line competes with the sea. Roads and boundaries stay
achromatic. The route needs a darker casing beneath it to survive crossing labels and
coastlines. Blue is complementary to warm travel photographs, so photo markers must separate
by luminance rather than hue.

---

## 16. AGENTS.md hosts the Next.js managed block

`next dev` on Next 16.3+ writes a managed block of Next.js agent rules into `AGENTS.md` if it
exists, otherwise into `CLAUDE.md`, otherwise creating both. It replaces its own block in place
and never truncates surrounding content.

The repository therefore keeps an `AGENTS.md` deliberately: it is a short pointer to
`CLAUDE.md` and the designated host for the managed block. `CLAUDE.md` begins with
`@AGENTS.md` so the Next.js rules stay in context without the project rules being interleaved
with tool-managed content.

**Consequences.** Do not delete `AGENTS.md` — the block would start landing in `CLAUDE.md`.
Commit block changes with the work that triggered them. Auto-generation stays on;
`agentRules: false` is not used, since Next's benchmarks show agents perform better with the
bundled docs in context.

---

## 17. Version-matched Next.js docs over training data

Next ships its own documentation inside the package at `node_modules/next/dist/docs/`. Next 16
differs substantially from what is in most training data, and this project already treats
"agents confidently invent stale APIs" as a first-order risk — see the pinned versions and the
guardrail lint rules.

**Consequences.** The bundled docs are the reference for Next-specific work, not recalled
patterns. `logging.browserToTerminal` and the MCP server at `/_next/mcp` are enabled because
this app's hardest failures — MapLibre and Solid-OIDC — happen in the browser, where server
logs cannot see them.

---

## 18. Pod reads need an explicit caching story

Open, to be decided in phase 1 and recorded here.

Under Cache Components, uncached data access outside a `<Suspense>` boundary blocks
prerendering. Every public page in this project reads from the Pod, so this is the main render
path rather than an edge case.

`"use cache"` with tag-based revalidation aligns with the existing design: the studio calls a
revalidation hook after each save, which is what the cached-and-invalidated model expects. The
alternative is Suspense boundaries around Pod reads, which streams instead of caching and
gives up the edge-cached public site.

Whichever is chosen, it must be explicit. Leaving Pod reads to framework defaults is how the
public site ends up either uncacheable or serving stale trips with no invalidation path.

---

## 19. Access control goes through one interface, and never branches on mechanism

Phase 0 tested both access-control mechanisms this project can encounter: Web Access Control on
Community Solid Server, and Access Control Policies on a hosted Inrupt ESS Pod.
`universalAccess.setPublicAccess` from `@inrupt/solid-client` granted public read on both with
identical calling code, which is the strongest available evidence that the four-method interface
in `docs/data-model.md` §5 is viable rather than aspirational.

**Do not detect the mechanism and branch on it.** ESS advertises
`Link: <https://authorization.inrupt.com/{id}>; rel="acl"` — a separate authorization host, not a
sibling `.acl` document — and that resource carries both `acp#` and `auth/acl#` vocabulary,
because ACP reuses `acl:Read` and `acl:Write` as mode IRIs. Any code that treats `rel="acl"` as
meaning WAC will classify an ACP server as WAC and act on it. The mechanism is not reliably
detectable from headers, which is precisely why the abstraction exists.

**Consequences.** `lib/pod/access.ts` stays the only module that knows access control exists, and
its implementation is the universal API rather than a WAC branch and an ACP branch. The lint rule
banning ACL primitives elsewhere is load-bearing, not hygiene.

---

## 20. Decision 4 confirmed, with a narrower guarantee than originally claimed

Per-resource ACL override — the thing decision 4 depends on entirely — works on both WAC and ACP.
Inside a public-read container, a resource left owner-only returned 401 to a logged-out reader
while its published sibling stayed readable and the owner kept access. **Decision 4 stands and
does not need reopening.**

Its stated consequence was too strong, though. "Structurally impossible rather than merely
unlikely" is true of the public site, which reads only the index and therefore cannot leak what
it never fetches. It is not true of the Pod: a publicly readable `entries/` container can be
enumerated by anyone, and `ldp:contains` names the draft resources. Draft content is protected;
draft existence and title are not.

**Consequences.** Slugs must be treated as public the moment a draft exists, not at publish time.
On WAC the container listing can be closed by granting the public `acl:default` without
`acl:accessTo`, which `initialiseContainers()` should do; this is verified. The ACP equivalent is
untested, so until it is, a hosted deployment should assume draft slugs are discoverable.

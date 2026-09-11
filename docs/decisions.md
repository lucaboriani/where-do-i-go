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

**Resolved in phase 0.5 — see decision 22.** The reasoning below stands as written; it framed
the question correctly and the answer went the way it points.

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

---

## 21. The package manager is not dictated

npm, pnpm, yarn and bun are all fine. Pick one per checkout, commit its lockfile, never mix two
in the same tree. That is the decision, and it has not changed.

**The documentation dialect has.** Examples were written with pnpm until 2026-09-08, on the
stated grounds that "something has to be written down". They are npm now, because this tree
commits `package-lock.json` and nothing else: `.npmrc` is npm's file, CI runs `npm ci`, and every
command in the definition of done has been run here as `npm run`. An example in a dialect the
checkout does not use is a paste-and-edit for every reader, and it silently contradicts the very
rule above — "pick one per checkout" was answered, and the docs did not follow the answer. Still
a convention, not a requirement: substitute your own.

Earlier revisions asserted pnpm and told contributors to "never mix in `npm install`", without
ever recording why — this file had eighteen entries and none of them was about the package
manager. An unjustified absolute is worse than no rule: it gets re-argued every time someone new
reads it, which is the exact failure this file exists to prevent.

**Why not mandate pnpm.** The product promise is "fork it, set your WebID, deploy", with a
README deploy section under ten steps tested by someone other than the author. Every mandated
tool is a step that person has to take. Nothing in the architecture needs pnpm: there is no
monorepo, no workspaces, one application.

**What was given up.** pnpm's strict `node_modules` layout means a package can only import what
it declares, while npm's flat layout lets a phantom transitive import work by accident. That is
a real protection, and this project cares about imports more than most — the whole public/studio
boundary is an import rule. Losing it puts more weight on the enforcement that remains:
`no-restricted-imports`, and the `size:public` budget on public routes that fails CI. Those were
already the primary defences; they are now the only ones. Keep them strict.

**Consequences.** `package.json` script *names* are the contract, not the runner — `CLAUDE.md`
lists them without a prefix, and the CI check asserting every command named there exists in
`package.json` compares names only. The scaffold flag (`--use-pnpm` / `--use-npm` / `--use-yarn`
/ `--use-bun`) must match whatever the deployer chose, since it decides which lockfile is
generated. (The clause that stood here about `validate-fixtures.py` needing Python is
superseded by §23 — the validator is now TypeScript.)

---

## 22. Cache Components on from the start; no remote cache

Closes decision 18. `cacheComponents: true` and `partialPrefetching: true` from the first
scaffold, `use cache` with `cacheTag`, invalidated by the studio's existing revalidation hook
calling `revalidateTag`. **`'use cache: remote'` is rejected.**

Checked against the version-matched docs bundled in `next@16.3.4`, not from recollection.

**Why now rather than in phase 1.** Adopting later is a migration, not a flag flip: the official
guide covers `force-dynamic`, `force-static`, `revalidate`, `fetchCache`, fetch cache options,
`unstable_cache`, on-demand revalidation, `generateStaticParams`, `dynamicParams`, `cookies` /
`headers` / `searchParams`, route handlers, `generateMetadata` and `runtime = 'edge'` — and
Vercel ships a dedicated agent skill (`next-cache-components-adoption`) to drive it one feature
at a time. The existence of that skill is the argument. There is no code yet, so the cost now is
zero and the cost later is a project.

It also matches what was already designed. Decision 2 established that the Pod cannot notify the
app, so invalidation has to be explicit and push-based; the studio already calls a hook after
each save. That is exactly `cacheTag` + `revalidateTag`. Decision 13 confirms the current
Netlify adapter supports tag revalidation. Separately, `cacheComponents` makes Partial
Prerendering the App Router default — `experimental.ppr` has been removed — so declining it means
opting out of the framework's direction.

**Why not `'use cache: remote'`.** The docs are explicit that it "requires a network roundtrip to
check the cache and typically incurs platform fees", and self-hosting requires implementing
`cacheHandlers`. That contradicts two product invariants at once: zero required API keys or
signups, and host-neutral self-hostability. The limitation it solves — in-memory entries not
surviving across serverless instances — mainly affects request-time dynamic content, and this
app's public path is prerendered and tag-invalidated. There is very little per-request dynamic
content in a travel diary.

**Rejected alternative:** Suspense boundaries around every Pod read. It streams instead of
caching, which gives up the edge-cached public site and puts a Pod round-trip on every view.

**Consequences, including one that costs something.**

- **The build reads the Pod.** `generateStaticParams` must return at least one param — an empty
  array now raises `empty-generate-static-params` — and `dynamicParams` is not supported. So
  every deploy is coupled to Pod availability, and a deployer whose Pod has no trips yet gets a
  **failed build rather than an empty site**. Phase 1 must handle this deliberately; see TODO.
- Trips published after a build are fine: with `partialPrefetching`, an unknown slug is served
  the App Shell and upgraded in the background, so new entries never require a redeploy.
- Node runtime only. No `runtime = 'edge'` on any route.
- `use cache` entries are keyed partly by build ID, so a deploy invalidates everything. Expected,
  and harmless for a site whose content changes on a human timescale.

---

## 23. One language: the fixture validator is TypeScript, not Python

`scripts/validate-fixtures.py` has been ported to `scripts/validate-fixtures.ts`, running on
`tsx` and `n3` — both already in the dependency list. Python and rdflib are no longer
prerequisites for anything in this repository.

The rule this sets: **no second technology stack without a decision recorded here.** The
validator arrived as Python because whoever wrote it reached for rdflib, not because the project
chose Python. That is how a stack acquires a language nobody meant to depend on, and how
contributor setup grows a step at a time.

**What this costs, stated plainly.** `docs/data-model.md` is normative — its Turtle blocks *are*
the specification. Validating them with rdflib meant checking the spec against an implementation
independent of the one the app uses, which is how conformance suites are normally run: a bug or
quirk in the app's parser could not silently pass the spec check. That property is now gone. The
fixtures and the Pod read path share `n3`, so an `n3` quirk passes both. §11 records this at the
point of use.

Judged worth it: the fixtures assert basic, widely-implemented Turtle behaviour (prefix
resolution, blank nodes, datatypes, timezone offsets), not parser edge cases, and `n3` is a
mature implementation. If a fixture ever looks correct but behaves oddly against a real Pod,
check it against a second parser before assuming the document is right.

**Verified, not assumed.** The port was checked against the Python original on identical input:
same six labels, same triple counts, same verdict. Both were then run against deliberately
broken documents — blank node injected, coordinate retyped to `xsd:float`, `dateTime` stripped
of its offset, a prefix declaration removed, a whole turtle block deleted — and agreed on every
case. One weakness surfaced and is shared by both: an over-deep relative IRI (`../../../../..`)
resolves cleanly rather than failing, so the "unresolved relative IRI" check is weaker than it
reads. Pre-existing, not introduced by the port, and worth tightening if it ever matters.

**Consequences.** `n3` moves from optional to required in `docs/versions.md`. CI needs no Python.
The `validate:fixtures` script name is unchanged, so `CLAUDE.md`, the CI job and the check
asserting the two files cannot drift all keep working.

---

## 24. Unknown slugs 404 from `proxy.ts`, not from the page

Under Partial Prerendering the static shell is flushed before the dynamic part
resolves, so a `notFound()` inside a page arrives after the status line is already
committed: `/trips/nope` returned **HTTP 200 carrying 404 content**. The body was
right and the status was wrong, which is the worst combination for a site that
server-renders specifically for SEO and share previews (decision 2).

Two plausible fixes were tried and measured, and both failed:

- **`export const instant = false`.** Next's own labelled-error menu lists it under
  "[block] allow a blocking route", but the bundled reference is explicit that
  `instant` governs *instant-navigation validation*, not response blocking. The
  status stayed 200.
- **Validating the slug inside the page before touching anything dynamic.** Awaiting
  `params` is itself the dynamic phase, so the check runs after the shell has been
  committed. Also stayed 200.

An unrouted path like `/definitely-not-a-route` returns a correct 404, which
confirmed the cause was PPR on a *matched* dynamic route rather than routing.

So the check moved to `proxy.ts` — the one place that runs before rendering and can
still set a status. It reads the diary once, extracts trip slugs with a regex rather
than a parser (proxy code must stay small, and nothing downstream trusts what it
extracts — `lib/pod/read.ts` remains the only validated reader), and caches them
briefly.

**It fails open.** If the Pod is unreachable or the diary unreadable, the request is
allowed through. A transient Pod hiccup must never 404 real content; the cost of
failing open is a soft 404 on genuinely unknown slugs during an outage, which is the
lesser harm. Verified by stopping the Pod and confirming a real trip still serves.

**Consequences.** `proxy.ts` is the only file outside `lib/pod/` that reads a Pod
resource, and it is deliberately dumb. No Node APIs, because Netlify does not support
them there (decision 13). Next's docs warn that proxy code may be deployed to a CDN
and should not rely on shared modules or globals, so the in-process cache is
best-effort and correctness does not depend on it. The in-page `notFound()` checks
stay as a second line: when the proxy fails open, they still render the right content.

---

## 25. Raw MapLibre, not react-map-gl

`react-map-gl@8.1.2` was pinned in phase 0.5 and nothing ever imported it. Two of phase 4's
invariants push against the declarative wrapper at exactly the points where this project has
written rules.

**`setProjection` only inside the `style.load` handler.** react-map-gl applies a `projection`
prop on its own schedule, so satisfying the invariant means reaching through `mapRef.getMap()`
inside `onStyleData` and leaving the prop unused. The globe becomes imperative either way, and
the wrapper's value was that it would not be.

**One instance, mounted once, never remounted.** The wrapper keeps its instance as long as its
element is mounted, which a layout provides. But having both a declarative and an imperative
route to the same map is how a one-instance rule rots. There is one way to touch the map.

**Consequences.** Roughly seventy lines of marker DOM reconciliation are written by hand rather
than by `<Marker>`. That cost is real and is accepted: clustering needs `querySourceFeatures` on
`moveend` and `sourcedata` regardless, so the imperative loop exists either way and the wrapper
would have sat beside it rather than replaced it. Everything worth testing is pure and lives in
`lib/map/` — the style, the GeoJSON builders, the leg derivation, the dash expression, the cluster
threshold — and needs no browser and no library to test.

**Rejected:** keeping the dependency installed but unused. A pinned library nothing imports reads
to the next agent as sanctioned — which is why this landed alongside edits to `docs/versions.md`
and `.claude/agents/nextjs-specialist.md`, the two other places that named it.

**§26 is reserved** for the public map sheet, landing in phase 4 stage 4. It withdraws decision
11's sentence about the Drawer providing the mobile map layout's snap-point sheet. Do not reuse
the number.

---

## 27. The basemap style is authored in-repo; MAP_STYLE_URL overrides it wholesale

`docs/design-brief.md` calls the dark desaturated basemap "the single highest-leverage visual
decision in the project" and locates it in the style JSON rather than the stylesheet. Two ways to
honour that were available: author a style against OpenFreeMap's vector tiles, or fetch their dark
style and rewrite its paint properties at `style.load`.

**Authored, in `lib/map/style.ts`.** Recolouring a remote style keys every paint write to that
style's layer ids, so an upstream rename is a silent partial revert — half the map in our palette
and half in theirs. And the brief's requirement is not a recolour: roads lose their casings and six
layer groups are dropped, which is a different style rather than the same one tinted.

**Consequences.** Seventeen layers to maintain against the OpenMapTiles schema, validated by
`validateStyleMin` in `lib/map/style.test.ts` so a schema mistake is a red test rather than a blank
map. `MAP_STYLE_URL` changes meaning: unset selects the in-repo style, set loads that URL verbatim.
`.env.example` shipped a value until 2026-09-09, which meant a copied `.env.local` quietly rendered
OpenFreeMap's palette instead of the brief's; it is now commented out, and `""` counts as unset.

**Also considered:** patching the remote style's layers at `style.load`, above. And a
`MAP_TILES_URL` alongside the style URL, so a deployer could keep our cartography over their own
tiles — rejected for now as a third variable serving a case nobody has asked for, and addable
without breaking anything if someone does.

---

## 28. The map is mounted by the trip layout, and the e2e gate is not widened for it

`CLAUDE.md` requires one MapLibre instance, mounted once, never remounted across navigation. Two
places could hold it: the trip page, or a layout above both the trip page and its entry routes.

**The layout.** Next preserves layout state across navigation, so the instance survives trip →
entry → entry as a property of where it is mounted rather than as a discipline the components
maintain. In `page.tsx` the same code would tear down a WebGL context on every navigation and the
invariant would be violated by the file it lives in.

**Consequences.** The map is above the page content on every entry route, which is what the
timeline in stage 4 needs. `config.mapStyleUrl` is read in the layout, a server component, because
`lib/config.ts` throws in the browser — the value crosses as a prop and there is no
`NEXT_PUBLIC_` variant. `size:public` gained a positive control (`findLazyChunks`), because with
the library lazy the composition ledger reports `maplibre-gl` absent whether the map is correct or
missing entirely.

**`components/public/**` and `lib/map/**` do NOT join the e2e gate globs.** The design suggested
they should; the owner deferred it on 2026-09-10, to be revisited when stage 3's markers land. So
`e2e/trip-map.spec.ts` exists and is run deliberately rather than by a path match, and a future
diff touching only the map will not trip the gate. That is a known hole, recorded rather than
papered over.

**Also considered:** mounting the map in `page.tsx` with a client-side cache keyed by slug —
rejected as a second state machine reimplementing what the router already guarantees.

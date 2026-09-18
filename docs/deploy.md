# Deploying where-i-go

This app has no database and no server-side session — see `CLAUDE.md`'s architecture
invariants. Deploying it is: point it at a Pod, set a WebID, build. There is no data migration
step, ever, because the app never holds a copy.

## 1. Prerequisites

- **A Solid Pod you control**: an owner WebID and its storage root. See §7 for where to get
  one — self-hosted, Inrupt ESS, or a community server.
- **Node 22.** `.nvmrc` pins `22.23.2`; `package.json` declares `engines: ^22.22.2`. Run
  `nvm use` before anything else. See `docs/versions.md` for why 22 and not 20 or 24.

## 2. Environment variables

Full detail — including the exact failure modes — lives in `.env.example`, which is the
committed source of truth. This is the quick-reference version:

| Variable | Required | Purpose |
|---|---|---|
| `OWNER_WEBID` | yes | The diary owner's WebID. Quoted (see below). |
| `POD_ROOT` | yes | Storage root the diary lives under. Trailing slash (see below). |
| `SITE_NAME` | no (default: "Travel diary") | Site metadata. |
| `SITE_URL` | no (default: `http://localhost:3000`) | Public origin; builds the OIDC `client_id`. |
| `SITE_LANGUAGE` | no (default: `en`) | Default language tag for text written to the Pod. |
| `MAP_STYLE_URL` | no (default: unset) | Override the in-repo dark basemap with your own tiles. |

`lib/config.ts` throws at startup if `OWNER_WEBID` or `POD_ROOT` is missing — the app refuses
to run rather than serve with an unknown Pod.

**Two traps that bite:**

- **Quote `OWNER_WEBID`.** It is a fragment IRI (`https://you.example/profile/card#me`), and
  any `.env*` file Next loads treats an unquoted `#` as the start of a comment — the value
  silently truncates to the profile *document*, not the person, and nothing errors at the
  point of the mistake. `.env.example` walks through exactly what breaks downstream. Quote it
  everywhere you set it (`.env.local`, Netlify's UI, a Docker `-e`/`--build-arg`), even where
  the parser in question may not need it — consistency is cheaper than finding out which ones do.
- **`POD_ROOT` needs a trailing slash if your Pod lives at a sub-path** (e.g.
  `https://server.example/alice/`, the common shape on a multi-user server). `lib/config.ts`
  and `lib/pod/access.ts` normalise a missing slash before using it, but `proxy.ts` reads
  `process.env.POD_ROOT` directly and does not. Without the slash, `new URL("travel/diary.ttl",
  root)` resolves against the wrong base (see Troubleshooting) and the middleware silently
  stops working. `SITE_URL` has no equivalent trap: `lib/config.ts` strips any trailing slash
  before use, so set it with or without one.

## 3. Deploy to Netlify

1. Fork the repository.
2. In the Netlify UI, set `OWNER_WEBID`, `POD_ROOT`, and the optional site-metadata vars from
   §2 as environment variables — available at **build time**, not just runtime (see below).
3. Deploy. `netlify.toml` is already committed and does the rest:
   - `[[plugins]] package = "@netlify/plugin-nextjs"` — the current adapter, which Netlify
     installs automatically. The legacy v4 runtime does not support tag-based revalidation,
     which the studio's publish flow depends on (`docs/decisions.md` §13).
   - `NODE_VERSION = "22.23.2"` in `build.environment`, matching `.nvmrc`.
   - No route sets `runtime = 'edge'`. Node.js APIs are unsupported in Netlify Middleware, and
     Cache Components requires the Node runtime (`docs/decisions.md` §22).

**The build reads the Pod.** `generateStaticParams` (`app/(public)/trips/[slug]/page.tsx`) asks
`lib/pod/cached.ts`'s `allTripSlugs()` for every published trip, and that function **throws** —
deliberately, the one exception to "never a throw" in this codebase — if `POD_ROOT` can't be
read or the diary lists no published trips. A misconfigured or empty Pod fails the build with a
message naming the fix, rather than shipping an empty site.

## 4. Self-host with Docker

The committed `Dockerfile` is a three-stage build (`deps` → `build` → `run`), all on
`node:22.23.2-slim`.

```sh
docker build --build-arg POD_ROOT="https://your-pod.example/alice/" -t where-i-go .
docker run -p 3000:3000 \
  -e OWNER_WEBID='https://your-pod.example/alice/profile/card#me' \
  -e POD_ROOT="https://your-pod.example/alice/" \
  -e SITE_URL="https://your-domain.example" \
  where-i-go
```

`POD_ROOT` is a **build `ARG`**, not just a runtime env var: `next.config.ts` reads it to build
`next/image`'s `remotePatterns` (so Pod-hosted photos aren't refused), and the build itself
reads the Pod for `generateStaticParams`, same as §3. Pass every other variable from §2 at
`docker run` time.

## 5. Self-host with `next start`

No container needed — this is the same build Netlify runs, on any Node 22 host:

```sh
npm ci
POD_ROOT="https://your-pod.example/alice/" OWNER_WEBID='…' SITE_URL='…' npm run build
npm run start
```

`npm run start` is `next start`, serving the production build from `.next/`.

## 6. First-run setup

Visit `/studio` and log in with the owner's WebID. Loading the trips list runs
`ensurePodInitialised` (`lib/pod/bootstrap.ts`) using the visitor's own authenticated fetch —
never a server credential (invariant 4). It is idempotent, safe to re-run, and creates, if
absent:

- The four `§4` containers under `travel/` — `travel/`, `travel/trips/`, `travel/media/`,
  `travel/settings/` — each with **its own ACL**, not an inherited one. The first three grant
  public read that reaches their contents without an enumerable listing; `travel/settings/`
  stays owner-only from the moment it exists, because a container with no ACL of its own
  inherits its parent's public default (`lib/pod/access.ts`).
- `travel/diary.ttl`, a minimal `dy:Diary` (title "My travels", the owner as creator, a
  modified timestamp, `dy:schemaVersion`) — created only if nothing is there yet
  (`If-None-Match: *`; a 412 counts as success).

It authors **no** `privacy.ttl` — that stays a deliberate absence until the owner sets it
through the studio (see `docs/decisions.md` §37).

## 7. Pod compatibility

Verified against two shapes of Pod in `docs/phase-0-spike.md`; treat that file as the source of
truth for what was actually tested, not this summary.

- **Self-hosted Community Solid Server.** The weekend self-host, and what CI and `pod:dev` run
  against. Uses **WAC** (sibling `.acl` resources).
- **Inrupt Enterprise Solid Server (ESS)**, e.g. PodSpaces. **Identity and storage are on
  different hosts.** The WebID is served by the identity provider and is **not writable** —
  don't assume `PATCH`-ing it works. Discover the storage root from the WebID's `pim:storage`
  triple rather than assuming it shares an origin with the WebID. ESS uses **ACP**, not WAC.
- **Community Pods** (e.g. solidcommunity.net) — not separately verified by the spike, but
  they run the same Community Solid Server as the local dev target, so the WAC findings apply.

**WAC vs. ACP:** `lib/pod/access.ts` is the only module that touches access control, and it
never branches on which mechanism a Pod uses — it goes through `@inrupt/solid-client`'s
`universalAccess`, which the spike confirmed works unchanged against both. Access is enforced
by the Pod either way; the studio's owner check is UX, not the security boundary
(`CLAUDE.md`, invariant 5). One nuance: a `rel="acl"` Link header does **not** imply WAC — ESS
sends one too, pointing at an ACP control resource — so nothing in this codebase sniffs that
header to decide behaviour.

## 8. Operations

**Does a newly published trip need a redeploy? No — content changes propagate without a
rebuild.** Every studio save (`hooks/studio/use-entry-save.ts`, `use-trip-save.ts`,
`use-publish.ts`) calls `revalidatePublicSite` (`lib/studio/revalidate.ts`), which `POST`s the
affected cache tags to `/api/revalidate` from the owner's own browser. That route
(`app/(public)/api/revalidate/route.ts`) calls `revalidateTag(tag, { expire: 0 })`, dropping the
`use cache` entries in `lib/pod/cached.ts` immediately rather than serving one more stale
response. `proxy.ts` separately re-reads the diary on a cache miss (at most once every 5
seconds) so a **brand-new** trip slug isn't 404'd by stale knowledge of which slugs exist. A
**rebuild is needed only for code changes** — new Next.js/React/dependency versions, template
or logic changes — never for new or edited content.

**`/api/revalidate` is unauthenticated by design.** The studio holds no server session, so it
has no secret to send; a shared secret in the client bundle would be readable by everyone
anyway. It's bounded instead by an **allowlist** (a tag is only honoured if it could have been
stamped by this app's own read layer — derived from `TAGS` and `lib/pod/read.ts`'s slug rules,
never a hardcoded pattern) and a **rate limiter** (30 requests per 60-second window, in-process,
explicitly not a security boundary). See the route file's own comments for the reasoning behind
each number.

**Map tiles** come from OpenFreeMap by default — no key, no account, no cookies, matching the
zero-required-API-keys invariant. It's community infrastructure funded by donations: best
effort, not an SLA (see the README's Limitations section). Set `MAP_STYLE_URL` to point at your
own style — a paid provider or a self-hosted tile server — if that matters to you; unset means
the project's own basemap.

## 9. Troubleshooting

- **Studio login works but nothing renders as the owner, or `oidcIssuer: expected string,
  received undefined`.** `OWNER_WEBID` lost its `#fragment` to comment-stripping. Re-check it's
  quoted; see §2 and `.env.example`.
- **`/trips/<slug>` 404s right after publishing, or a known trip stops resolving as expected.**
  If your Pod lives at a sub-path, confirm `POD_ROOT` has its trailing slash — see the trap in
  §2. Otherwise, the studio's publish flow may not have completed step 4 (revalidation);
  `revalidatePublicSite` throws when it does, so check the browser console
  (`logging.browserToTerminal` forwards it to the terminal in dev).
- **The build fails with a message naming `POD_ROOT` or "lists no published trips".** Expected
  behaviour, not a bug — see §3. Fix `POD_ROOT`, or publish at least one trip, and rebuild.
- **Login redirect loops, or the consent screen shows a bare UUID instead of the app name.**
  The identity provider needs to fetch `client-id.jsonld` from your real, publicly reachable
  `SITE_URL` — serving it from `localhost` falls back to dynamic client registration, which
  re-registers a new client on every login and can prevent session restore across reloads.
  See `docs/phase-0-spike.md` question 2.

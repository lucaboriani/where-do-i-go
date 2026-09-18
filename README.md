# Travel diary

> ## 🚧 Development in progress
>
> **This is not finished software, and it is not ready to be pointed at a Pod you care
> about.** It is being built in phases, in the open. Things work, then change shape.
>
> **Do not write to a Pod holding anything you would miss.** The `dy:` namespace is
> `https://zeropara.me/ns/traveldiary#`, resolved 2026-09-16. That URL is a permanent
> identifier baked into every triple this app writes. Local development against
> Community Solid Server is fine — that data is disposable and meant to be thrown away.
>
> See `TODO.md` for the phase order and what is ticked, and the status note below for where
> it has actually got to.

A travel diary that stores its own data in your Solid Pod.

Trips, entries and photographs live in storage you control. The site reads them and renders
them; it never holds a copy. Delete the app and every word and photograph is still yours,
where it always was.

> **Status, as of 2026-09-18.** Phases 0–4 are complete and merged to `main`: the platform spike,
> installation, the public read path (home, trip and entry pages, sitemap, RSS, metadata, a real
> 404), the studio where the owner writes (Solid login, entry create/edit, index maintenance,
> autosave), the media pipeline (client-side resize, EXIF strip, coordinate fuzzing), and the map
> and timeline (an interactive MapLibre map, a mobile sheet, and an all-trips globe).
>
> Phase 7 — the visual design — is **complete and merged to `main`** (`f1893a1`, 2026-09-16): the
> typefaces and type scale, the entry content model reshaped into an ordered list of sections
> (text + up to two photos each), and the restyled pages, sectioned entry page and editor, and
> the map's new look.
>
> **Phase 5's draft/publish flow — feature #1, "studio authoring & publishing" — is complete and
> merged to `main`** (`4e4424b`, 2026-09-18): the studio creates and edits both trips and entries,
> and publishes/unpublishes either. Drafts stay Pod-ACL-private, never an app-level filter, so the
> app is now genuinely self-serve — writing and publishing a trip needs no seed script and no
> code change. Still open in phase 5: OG image generation and per-entry deep links.
>
> **Phase 6 — deployability — is done except independent verification.** `netlify.toml`, a
> `Dockerfile`, and `docs/deploy.md` (env vars, Netlify, self-hosting, Pod compatibility) are all
> in place, but no one other than the author has run a real deploy yet, and phase-0's question 7
> (OG images on a live Netlify preview) is still unanswered — it is now tracked under phase 5's
> remaining OG-image work.
>
> **Phase 8 — the marketing landing page — has not started.** Start at `TODO.md`.

## What makes it unusual

**Your diary lives in your own storage.** There is no database holding your content, so there
is nothing to migrate out of and no export button — nothing was ever captured.

**There is no backend to break into.** No server-side session, no service account, no
credentials in the deployment. Someone who fully compromises the hosting still cannot write a
single entry, because writes are authorised by your storage against your own identity.

**No API keys, for anything.** Maps, tiles, geocoding, storage, images — nothing requires a
signup. Fork it, set your WebID, deploy.

**Self-hostable the whole way down**, including the storage server and the map tiles.

**Your location data is yours to blur.** Photo metadata is stripped before upload, and
coordinates near home can be fuzzed automatically. The published coordinate is the only one
stored.

**Interoperable, not just exportable.** Standard vocabularies and a registered type index mean
other software can read your trips where they sit, with no import step.

## Limitations, honestly

- Needs a Solid Pod. Hosted providers exist; self-hosting is a weekend.
- Storage quotas are real, and photographs are large.
- No comments or guestbook — your readers do not have Pods.
- No offline support yet, which matters more than it sounds when travelling.
- Map tiles come from community infrastructure funded by donations. Best effort, not an SLA.

## Development

Requires Node 22 (`.nvmrc` pins 22.23.2 — `nvm use` picks it up). Any package manager works;
this checkout uses npm.

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script | What it does |
|---|---|
| `dev` | Next dev server |
| `build` | production build |
| `test` | vitest |
| `lint` / `typecheck` | eslint / `tsc --noEmit` |
| `validate:fixtures` | checks the Turtle fixtures in `docs/data-model.md` |
| `pod:dev` | local Community Solid Server to develop against |

Develop against the local Pod, never a live one. See `CLAUDE.md` for the rules that are not
inferable from the code.

## Using the studio

Visit `/studio` and log in with the owner's WebID — first login bootstraps the Pod containers.
From there: a trips list, a trip editor (title, dates, cover photo), a per-trip entries list, and
an entry editor (sections of text and photos). Each trip and entry has its own publish/unpublish
control — publishing is what makes it visible on the public site; drafts stay Pod-ACL-private,
never an app-level filter.

## Deploying your own

1. Get a Solid Pod (self-hosted, or a hosted provider) and note your WebID and storage root.
2. Fork the repository.
3. Copy `.env.example`, fill in `OWNER_WEBID` (quoted — see the trap in the file) and
   `POD_ROOT`.
4. Deploy to Netlify (`netlify.toml` is committed) — or self-host with the committed
   `Dockerfile`, or plain `next start` on any Node 22 host.
5. Visit `/studio` on your deployed origin and log in with your WebID. First login bootstraps
   the Pod's containers and access rules.
6. Write something and publish it — no rebuild needed for new content, ever.

Full detail, self-hosting options, and Pod compatibility notes: `docs/deploy.md`.

## Documentation

| File | What it covers |
|---|---|
| `TODO.md` | Ordered task list, starting with installation and setup |
| `AGENTS.md` | Pointer for coding agents; hosts the Next.js managed block |
| `CLAUDE.md` | Rules and invariants for anyone, human or agent, writing code here |
| `docs/data-model.md` | The RDF contract. Normative. |
| `docs/decisions.md` | Why the stack is what it is |
| `docs/design-brief.md` | Visual direction |
| `docs/versions.md` | Pinned dependency versions and known pitfalls |
| `docs/phase-0-spike.md` | Platform assumptions to verify first |
| `docs/deploy.md` | Deployment, self-hosting, and Pod compatibility |

## Stack

Next.js and React, TypeScript, Tailwind, shadcn/ui in the editor only. MapLibre GL JS with
OpenFreeMap tiles. Inrupt's Solid client libraries. Community Solid Server for local
development.

No database. No analytics. No third-party fonts. No API keys.

## Licence

MIT.

# Travel diary

> ## 🚧 Development in progress
>
> **This is not finished software, and it is not ready to be pointed at a Pod you care
> about.** It is being built in phases, in the open. Things work, then change shape.
>
> **Do not write to a Pod holding anything you would miss.** The `dy:` namespace is still
> `https://example.org/ns/traveldiary#`, a placeholder. That URL is a permanent identifier
> baked into every triple this app writes, and it has to be replaced with a real project
> domain before anything is written anywhere that matters. Local development against
> Community Solid Server is fine — that data is disposable and meant to be thrown away.
>
> See `TODO.md` for the phase order and what is ticked, and the status note below for where
> it has actually got to.

A travel diary that stores its own data in your Solid Pod.

Trips, entries and photographs live in storage you control. The site reads them and renders
them; it never holds a copy. Delete the app and every word and photograph is still yours,
where it always was.

> **Status, as of 2026-09-03.** Phase 0 (the platform spike, answered against two Solid
> servers), phase 0.5 (installation and setup) and phase 1 (the public read path) are complete
> and merged. The site reads a Pod and renders it: home, trip and entry pages, sitemap, RSS,
> metadata, and a 404 that works.
>
> Phase 2 — the studio, where the owner writes — is **in progress**: the access-control
> interface, first-run container setup, Solid login and the owner check are in; entry
> create/edit, index maintenance and autosave are not.
>
> Not started: media and photographs (phase 3), the map and timeline (phase 4), and the visual
> design (phase 7 — the layout is deliberately plain until then). Start at `TODO.md`.

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

## Deploying your own

Not yet available — the app does not exist. When it does, this section will be under ten
steps. The intended shape:

1. Fork the repository.
2. Set `OWNER_WEBID`, `POD_ROOT` and the site metadata as environment variables.
3. Deploy to Netlify, or run `next start` anywhere.
4. Visit `/studio`, log in with your WebID, and run first-run setup to create the containers
   and access rules.
5. Write something.

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

## Stack

Next.js and React, TypeScript, Tailwind, shadcn/ui in the editor only. MapLibre GL JS with
OpenFreeMap tiles. Inrupt's Solid client libraries. Community Solid Server for local
development.

No database. No analytics. No third-party fonts. No API keys.

## Licence

MIT.

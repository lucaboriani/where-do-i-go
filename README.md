# Travel diary

A travel diary that stores its own data in your Solid Pod.

Trips, entries and photographs live in storage you control. The site reads them and renders
them; it never holds a copy. Delete the app and every word and photograph is still yours,
where it always was.

> **Status: pre-implementation.** The data model and architecture are specified; the
> application is not built yet. Start at `TODO.md`.

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

## Note on scaffolding

This README predates the application. When `create-next-app` runs it will generate its own
`README.md`; that one is boilerplate and this one wins. See the merge instructions at the top
of phase 0.5 in `TODO.md`.

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

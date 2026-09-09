# client-id.jsonld — notes

The static Solid-OIDC client identifier document, served from the app's own
origin. Prose moved here by Stage C's comment sweep on 2026-09-09; the shouted
half stays at the guard it is about.

## it is generated from config, and cannot be exercised from localhost

Generated from config rather than hardcoded, because every deployer serves it
from their own domain.

Phase 0 finding: the identity provider fetches this URL, so it must be publicly
reachable. It therefore cannot be exercised from localhost against a hosted Pod
— dynamic client registration is the fallback there, and it shows a bare UUID on
the consent screen instead of the app name.

## the presence check stays on the raw env var, the value comes from config

Two different questions, and `config.siteUrl` only answers one of them. It
defaults to `http://localhost:3000`, which is right for a page and wrong for
this document: an identity provider fetches the `client_id` URL published here,
so a deployed site advertising a localhost client ID would fail to match and
fall back to dynamic client registration — a login that still works, showing a
bare UUID on the consent screen (phase 0). An unset `SITE_URL` is a deployment
error, and it stays a loud 500 rather than becoming a plausible-looking document
nobody can use.

The **value** is read through `config.siteUrl`, which is where the trailing
slash is normalised away. This route used to interpolate `process.env` directly
and was the only site-URL consumer that normalised nothing, so
`SITE_URL=https://diary.example/` published
`https://diary.example//client-id.jsonld` and `//studio` — the exact drift that
drops login into dynamic registration.

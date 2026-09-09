# lib — notes

Prose that outgrew a docblock, for the loose modules at the top of `lib/`.
Section numbers are `docs/data-model.md`; decision numbers are
`docs/decisions.md`. Both stay the normative sources.

## siteUrl carries no trailing slash

`config.siteUrl` strips trailing slashes and `config.podRoot` adds one. Both
normalise inside the getter, so no consumer has to remember which way round it
is.

Every consumer joins a path onto the origin, so a pasted
`https://diary.example/` would otherwise produce
`https://diary.example//studio`. That is cosmetic in a sitemap and not cosmetic
at all in the Solid-OIDC client ID document: the identity provider fetches the
`client_id` URL it is given, and a doubled slash is a different URL, so it
cannot match the document and falls back to dynamic client registration — a
login that still works while showing a bare UUID on the consent screen
(phase 0). `.env.example` does not say to omit the slash, and a human pasting
an origin includes it.

## The dy namespace is hardcoded, and blocked

`NS.dy` is a literal in this file and never an environment variable. If each
deployer used their own namespace, two diaries could not be read by the same
code and the interoperability premise collapses (§2 rule 4). It is a permanent
identifier baked into every triple written.

So it is also the one blocker in this repository that outranks a task: while it
reads `https://example.org/ns/traveldiary#`, **nothing may be written to a live
Pod**. Local Community Solid Server data is disposable — spike there freely.
The warning stays shouted at the constant rather than only here, because a
reader must not walk past it.

## The privacy predicates, and the closed rename window

The four `home*` and `defaultPrecisionMeters` terms are the only `dy:` terms in
`lib/vocab.ts` that are never publicly readable. They live in one owner-only
resource (§7.6) because the home region is the thing being protected:
publishing its centre and radius would hand a reader the answer the fuzzing
exists to withhold.

`homeLong` was `homeLon` until 2026-09-06. The rename was deliberate and safe
for a reason that no longer applies: a predicate is permanent the moment
anything writes one, and nothing had — there is no writer for `privacy.ttl` in
this codebase, `initialiseContainers()` deliberately creates the container
empty, and `dy:` is still `example.org`, so no live Pod holds one. §3 and §14
record the decision, which was the owner's.

**That window is closed.** All four names are fixed now, and the spelling
matches `long` and `centerLong` in the read model.

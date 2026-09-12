# test

## why access and pipeline may import solid-client

The allow-cases proving a widened belt must not over-reach: `lib/pod/access.ts` is the one module
whose job is importing `@inrupt/solid-client`, and `lib/media/pipeline.ts` needs it for the same
reason `lib/media/upload.ts` needs `lib/pod/write`. Both cases assert `getThing` rather than
`getSolidDataset` — a plain, non-ACL export — so a passing case cannot be read as exercising the
separate, pre-existing `ACL_PRIMITIVES` ban instead of the belt block this describe is about.

This prose used to live inline as two docblocks. A fix for the test-comment ratchet (8cac640)
split a single over-length block into two so each stayed under the six-line bound, and the split
landed across a blank line — a comment-run boundary — so the second half read as a new, unrelated
sentence starting mid-thought ("needs lib/pod/write."). Moved here instead, behind the one-line
pointer the conventions actually prescribe for prose that does not fit inline.

## why a closure test

Every case above this one lints a snippet at a path chosen by hand, so each proves only that the
belt fires where `BELTED_MODULES` already says it should. None of them can notice a module the
list itself is missing.

`lib/pod/rdf.ts` was exactly that: `lib/pod/read.ts` imports seven values from it, so it sits in
the public runtime graph one level below every module the belt's original grep audited. A
hand-typed `BELTED_MODULES` had no way to see it, because seeing it requires walking the import
graph rather than reading a list — which is what `test/support/imports.ts` does, from the real
entry points under `app/(public)`, `app/not-found.tsx` and `app/global-error.tsx` (skipped while
absent), rather than from a fixture standing in for them.

The assertion is a subset, not an equality: `lib/time/offsets.ts` and `lib/place/precision.ts` are
in `BELTED_MODULES` today but not (yet) in the closure, because stage 0 only moved them out of
`lib/studio` in preparation for stage 1 wiring them into a public component. Belting ahead of use
is fine; the failure this test is for is the other direction — a module already reachable and not
belted.

## the belt never fenced its members from the studio hooks

The belt block carries one pattern group — `["@inrupt/*", "**/lib/studio", "**/lib/studio/**"]` —
and `hooks/map/**` joined that block on 2026-09-12 without `hooks/studio` joining the group.
Measured under `ESLint.lintText` against the real config, every one of these lints clean today,
zero messages:

```
hooks/map/use-map-instance.ts  <-  @/hooks/studio/use-entry-save
hooks/map/use-map-instance.ts  <-  @/hooks/studio
hooks/map/use-map-instance.ts  <-  ../studio/use-entry-save
lib/pod/read.ts                <-  @/hooks/studio/use-entry-save
```

It is the auth/media path into the public bundle reopened one directory removed:
`use-photo-pipeline` imports `lib/media/pipeline`, which imports `@inrupt/solid-client`. The
boundary block already bans `hooks/studio` from `app/(public)/**`; the belt is that same ban at
the modules a public page reaches *through*, and this is the half nobody wrote.

**No unrelated rule can produce a green here**, which is why rule id plus specifier is assertion
enough and the ACL case's message-text trick is not needed: neither `@inrupt/*` nor either
maplibre entry matches a `hooks/studio` specifier, so a `no-restricted-imports` message naming one
can only come from a pattern added for it. Probed, not assumed.

**Which row is load-bearing**, measured against a candidate fix applied through ESLint's
`overrideConfig` rather than by editing `eslint.config.mjs`:

- the bare `**/hooks/studio` does the work. Delete it and the bare row goes green on its own
  while the subpath row stays red.
- `**/hooks/studio/**` is redundant today — gitignore semantics make the bare entry a superset,
  exactly as the radix-ui group records — and is worth keeping for the same reason: that is a
  matcher property, not a promise.
- **the relative rows need more than either.** From inside `hooks/map` the sibling is
  `../studio/x`, which never spells `hooks/`, so no `**/hooks/studio…` pattern can see it at all.
  A `**/studio` + `**/studio/**` pair catches all four rows with `react`, `./use-map-layers`,
  `@/lib/map/view` and `@/lib/pod/read` still allowed — measured. `**/studio/**` alone catches the
  relative subpath but not a bare `../studio`.

## the belt glob is ts only and hooks is react territory

`eslint.config.mjs` spells the belt member `"hooks/map/**/*.ts"`, which does not match a `.tsx` —
while the *same commit* spelled the length block `"hooks/**/*.{ts,tsx}"`. The two globs disagree
about what a hook file is, and a hook that returns a marker element or a popup **is** a `.tsx`.

Measured at a hypothetical `hooks/map/use-map-instance.tsx`: `maplibre-gl` (252.8 kB gzip against
a 190 kB budget), `maplibre-gl/dist/maplibre-gl.mjs`, `@inrupt/solid-client-authn-browser` and
`@/lib/studio/session` are all allowed, zero messages, while the identical imports at the `.ts`
are refused.

Nothing else catches the package half of this. `test/support/imports.ts` returns `undefined` for a
bare package specifier by design, so the closure test walks repo files only: a `.tsx` hook that
statically imported `maplibre-gl` would be invisible to every check in this file and caught only
by `npm run size:public`.

The ACL ban is deliberately **not** a case here: it survives at the `.tsx` through the everywhere
block, so it would pass today and pin nothing about the belt. The raw-IRI control does that job
instead — it proves the path is linted by something, so a clean `no-restricted-imports` result is
the fence missing rather than the file being ignored.

## the derived sweep has to widen with the glob

`resolveBeltModules` filters `readdirSync` to `.ts`, so widening the config glob alone leaves
every `BELTED_MODULES` sweep silently covering less than the config claims — the test goes green
while testing fewer files, which is this repository's "green run that verified nothing" with the
count moved rather than the skip.

`components/public/trip-map` is the fixture because it is the one directory holding a production
`.ts`, a production `.tsx` and a `.test.tsx` at a single level, which is all three things the
resolver has to get right. It is not itself a belt member and does not need to be: what is under
test is the resolver's reading of the glob, not the fence at that path.

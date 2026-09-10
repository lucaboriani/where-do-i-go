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

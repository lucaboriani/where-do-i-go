# trips-list — notes

The studio's new home (Task 3.2): what `/studio` lands on now, via
`studio-shell.tsx`'s owner branch. The old enumeration-and-editor path stays
in place, untouched, behind the same branch's pre-3.2 shape — see
`components/studio/studio-shell/notes.md#the-trips-home-migration-seam`.

## the two-phase load, and why it is not one

`useStudioTrips` answers with a `StudioTrip` summary per trip — enough to
render a name, a status word and an entry count — but publishing needs the
FULL `Trip` (every field `publishTrip` will re-serialise) and its current
ETag, neither of which the summary carries. So this component adds a second
phase: once the summary list is `ready`, it re-reads each trip's own document
with `readTripWithEtag` and gates the WHOLE render — not just the publish
button — on both phases finishing.

Gating the whole render, rather than disabling the button until its own data
arrives, is deliberate rather than the simpler-looking alternative. A button
rendered disabled and enabled a moment later is a real race against a test
(or an owner) that clicks the instant a trip's name appears; folding both
reads into one "ready" state means the name and the button that acts on it
are never visible before both are true together.

The cost is one extra Pod round trip per trip beyond what `listStudioTrips`
already made internally (a bare `readTrip`, etag discarded). Accepted for now
— a trips list is not expected to be large, and the alternative is a wider
change (`StudioTrip` growing an ETag field, cascading into
`lib/studio/trips.ts` and the entry editor's `EditorTrip`) for a cost that
would only be paid once and is not on the profiling path.

## action labels avoid one another's regex

"Take offline" (published → draft) shares no substring with "Publish", and
"Publish" (draft → published) shares no substring with "draft". Both matter:
`trips-list.test.tsx` finds the draft trip's button with `/publish/i`, which
would also match a button literally labelled "Unpublish", and the status
words ("Published"/"Draft") are found the same loose way.

## entryCount is every entry

Inherited from `useStudioTrips`; see
`hooks/studio/notes.md#entrycount-is-every-entry-draft-included`.

## a null ETag blocks publishing, and is never coerced

Fix round 1, finding E1: `readTripWithEtag`'s `etag` is `string | null` — a
Pod GET that answers with no `ETag` header at all, which is the reason the
type is not just `string`. The first cut here coerced that `null` into `""`,
which then flowed into `usePublish` → `publishTrip` → `putGuarded` as
`If-Match: ""`, a malformed precondition header. `hooks/studio/
use-entry-save.ts`'s own `preconditionFor` already states the rule this
should have followed: `etag === null` means "no precondition to be had", not
a precondition invented from nothing.

`FullTrip.etag` is therefore `string | null`, carried through unmodified from
`readTripWithEtag`. `TripRow` branches on it BEFORE `PublishAction` mounts:
a null etag renders a message ("reload to publish") and never mounts
`PublishAction` at all, so `usePublish` — which is pinned to take a `string`
etag on its trip target — is never called with anything invented. Branching
in the parent, rather than inside `PublishAction` on a value that could flip
between renders, is what keeps this a Rules-of-Hooks-clean conditional: which
component gets rendered may vary; which hooks one particular component calls
may not.

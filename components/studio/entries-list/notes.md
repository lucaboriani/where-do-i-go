# entries-list — notes

## The status word is Published or Draft, matching trips-list

Fix round 1: the first cut here used "Private" for a draft entry, to dodge a
`getByText(/draft/i)` collision with the fixture headline "Still drafting
this one" (its own text already satisfies that regex, and a literal "Draft"
badge next to it is a second matching element). Review flagged that as a
naming/UX defect rather than an acceptable test workaround: "Private"
conflates with §7.6's own privacy/coordinate-fuzzing concept
(`privacySettingsUrl`/`readPrivacySettings`), which is a different thing
entirely from "not yet published", and it disagreed with
`trips-list.tsx`'s own literal "Draft" for the identical `Status` value one
level up. The badge is "Draft" again; the collision is resolved in the test
instead, with an exact `getByText("Draft")` rather than the broad
`/draft/i`.

Task 4.1: rendered inside `/studio/trips/[slug]` (Task 4.2), one level under
`trips-list.tsx` in the studio's own tree. STUDIO-ONLY.

## The two-phase load mirrors trips-list

`useStudioEntries` answers with `{ slug, title, status }` per entry — enough
for the list itself — but publishing needs the FULL `Entry` (everything
`saveEntry`'s serialiser re-emits) and its current ETag, neither of which the
summary carries. Exactly `trips-list.tsx`'s own two-phase shape: once the
summary is `ready`, this component re-reads each entry's own document with
`readEntryWithEtag`, and the whole render — not just the publish button —
waits on both phases together, for the same race-avoidance reason
`trips-list/notes.md#the-two-phase-load-and-why-it-is-not-one` gives.

## tripStatus is a prop, not a second read

The caller (`/studio/trips/[slug]`) already has the trip's own `Trip.status`
from loading the editor; threading it through as a prop avoids a third read
(container listing, then per-entry reads, then the trip document too) for a
value the caller already holds. `usePublish`'s entry target wants exactly
this field and nothing else about the trip.

## A null ETag blocks publishing here too

Fix round 1, finding E1, one layer up: a `null` ETag is never coerced into
`If-Match: ""`. `EntryRow` branches on `full.etag` before `PublishEntryAction`
mounts, exactly as `TripRow` does for trips — see
`trips-list/notes.md#a-null-etag-blocks-publishing-and-is-never-coerced`.

## The write callback is saveEntry, not a new pair

`save-trip.ts` has `publishTrip`/`unpublishTrip`; `save-entry.ts` has no
equivalent pair, because Task 3.1 left the entry write as an injected
callback rather than pre-empting a shape Task 4 hadn't specified yet. This
component's `write` calls `saveEntry` directly with the entry's status
flipped — the same four-step chain (entry / access / index / revalidate) a
full edit-and-save already goes through, since a status change is nothing
`saveEntry` treats specially beyond §5's own guard.

No state is re-synced from a successful write: the row's badge and the next
click's ETag both come from the phase-2 read, so a second click before a
reload risks a 412 the same way `trips-list.tsx`'s `PublishAction` already
does. Accepted for the same reason — see
`trips-list/notes.md#the-two-phase-load-and-why-it-is-not-one` — and not
worse than the existing trips screen.

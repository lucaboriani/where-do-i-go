# components/public/trip-timeline — notes

`TripTimeline` orders entries with `orderEntries` from `lib/map/legs` rather
than re-sorting locally, so the timeline and the map's route agree on
sequence — see that module for the tie-break on `occurredAt`.

Each row's highlight and time rendering are covered in
`./timeline-row/notes.md`.

## Why the row takes children

`TimelineRow` is the client half — it holds the pointer and focus handlers, so
it is a client entry point and everything it imports is bundled into the trip
page's own chunk. Measured 2026-09-13 against the committed build: the trip
page carried one chunk the entry pages did not, 4,505 B gzip, of which ~3,405 B
was a **second copy of `next/link`** and its five dependency modules — already
present verbatim in two chunks that load on every page — and 546 B was the
whole of `lib/time/offsets.ts`, `OFFSETS` array included, pulled in for one
`slice(0, 16)`. Only ~554 B was the row itself.

Both leave the client graph by rendering on the server: `TripTimeline` builds
the `<Link>` and the `<time>` and passes them to the row as `children`. A
client reference rendered from a server component is resolved through the
runtime chunk that already contains `next/link`, and `wallClockOf` runs before
the response is written. **The handlers stay on the `<li>`** — that is spec §3
and `./timeline-row/notes.md#why-the-handlers-sit-on-the-row`; moving them to
the link is what this change must not be mistaken for.

## The other three fields

`thumbnail`, `travelModeFrom` and the coordinate render the same way — built
in `TripTimeline`, passed down as more of the row's `children`, never inside
`TimelineRow` itself. The thumbnail is a plain `<img>`, not `next/image`: an
arbitrary Pod origin has no entry in `images.remotePatterns`, and `next/image`
would ship a client component for a 40px square. `lat`/`long` render through a
private `formatCoordinate` (phase 7, mirroring `EntryContent`'s `MetaRow`), not
`lib/place/precision.ts`'s `precisionLabel` — the row shows the coordinate
itself, shaped by `.precision`/`.precision.exact` (undefined `precisionMeters`
= exact = square), not a `~500 m` radius. `TimelineRow`'s `<li>` also carries
`data-slug`, alongside `data-active` — the sheet's reveal query finds a row by
it.

## `data-slug` is on the row AND on the map marker

`lib/map/marker-element.ts` sets the same attribute on every marker, and that
is correct: the two are the same entry seen twice, and the separation is
structural rather than conventional. They live in disjoint subtrees — the map
pane and the sheet body are siblings under `.trip-shell`
(`app/(public)/trips/[slug]/layout.tsx`), so a query rooted in either one can
only ever find its own. **A page-level locator cannot**: it matches both.
Scope it first — to `getByRole("region", { name: "Trip map" })` for a marker,
to the sheet body for a row. Three locators in `e2e/trip-timeline.spec.ts` had
to be scoped for exactly this reason when the row gained the attribute.

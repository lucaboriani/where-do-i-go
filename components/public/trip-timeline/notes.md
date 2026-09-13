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

# components/public/trip-timeline — notes

`TripTimeline` orders entries with `orderEntries` from `lib/map/legs` rather
than re-sorting locally, so the timeline and the map's route agree on
sequence — see that module for the tie-break on `occurredAt`.

Each row's highlight and time rendering are covered in
`./timeline-row/notes.md`.

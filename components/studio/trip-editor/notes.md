# trip-editor — notes

Task 3.3. One form over `use-trip-form.ts` + `use-trip-save.ts`, mirroring the entry editor's own
split at a much smaller scale: a trip has no draft, no sections, no fuzzed geometry, and no trip
picker of its own — it *is* the thing an entry's own picker points at.

## the cover is one section of one slot

`usePhotoPipeline` is built around a trip's own entry: N sections, each holding 0–2 photo slots,
addressed by a `sectionId` the caller mints. A cover is a single photo with nowhere else to live,
so this editor gives it exactly one synthetic section (`COVER_SECTION = "cover"`, never a Pod IRI
and never rendered) holding at most one slot, and reuses the pipeline unchanged rather than
building a second, cover-shaped one.

`coordinatesLive: false` and no-op `offerCoordinate`/`offerTimestamp`: a cover photo's EXIF has
nothing this form wants credited to it — a trip has no `dy:occurredAt` and no coordinate box to
fill. The pipeline still requires all four `form` methods (`Pick<EntryForm, …>`'s real shape), so
the two offers exist as call sites that intentionally do nothing.

`settleSlot` is the one place `coverImage` is written: on `state: "ready"`, it reads
`slot.photo.contentUrl` — the web derivative's URL — straight into `form.set.coverImage`. Nothing
else moves the field, which is what makes it possible for `dy:coverImage` to end up holding the
same URL a real `Photo.contentUrl` would.

## no `pipeline` prop

The entry editor takes an optional `pipeline` so a test can inject bytes it controls; this editor
does not; task-3-brief.md pins `TripEditorProps` to exactly `{ session, podRoot, initial? }`, and
`trip-editor.test.tsx` mocks `use-photo-pipeline` wholesale instead, at the layer above where a
`pipeline` prop would matter.

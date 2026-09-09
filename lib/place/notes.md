# lib/place — notes

## Why precisionLabel left place.ts

`lib/studio/place/place.ts` is write-shaped: `placeFor` and `placeTextOf`
assemble a `Place` for a save, and `gridOf` and `PRECISION_GRIDS` serve the
studio's precision select. `eslint.config.mjs` fences all of `lib/studio` from
`app/(public)/**`, and for `lib/pod/entry-model.ts` it already records the
narrower reason: a write-shaped module stays fenced even when it is pure,
because nothing public has any business assembling one.

`precisionLabel` is the exception, so it moved rather than being carved out of
the fence. `docs/design-brief.md` requires that `dy:precisionMeters` change the
rendering — "show fewer decimal places when the stored location is coarse, and
a soft circle rather than a pin" — which makes the label a reading-page
concern. The tilde is the honest part: what is published is a cell of about
that size, not a distance from anywhere.

Phase 4 stage 3 adds the decimal count and the pin-versus-circle decision here,
for the same reason and to the same consumers.

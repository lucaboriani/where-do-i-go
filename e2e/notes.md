# e2e — notes

## One entry, no leg, and the mutation control

The §7.4 fixture's `entries.ttl` lists two `dy:entry` links but only describes
one subject fully — `<#e-2026-03-31-nara>` is named and never given a
`dy:slug`, `dy:lat`, or any other property. `lib/pod/read.ts` skips a
`dy:entry` link the document does not describe (`lib/pod/read.test.ts`'s
"skips a dy:entry link the document does not describe"), so the seeded trip
has exactly one entry: `2026-03-29-arrival`, `dy:sortOrder 1`. It is the
trip's first entry and also its only one.

`lib/map/legs.ts`'s `buildLegs` starts at `placed.slice(1)`, so a single-entry
trip produces zero legs. There is nothing for `useMapHighlight`'s
`setFeatureState({ source: "trip-legs", … })` to act on here, so
`trip-timeline.spec.ts` asserts the marker's `ring-2` class only, on both the
hover path and the route path, and does not assert on leg feature state. A
second seeded entry would let a later case cover the leg half; none exists yet.

**Mutation control, measured 2026-09-13.** Deleting the `activeSlug` argument
`TripMap` passes to `useMapMarkers` and `useMapHighlight` (i.e.
`useMapMarkers(map)` and `useMapHighlight(map, null, styleLoaded)`) turned the
case red at its first assertion after hover:

```
Error: expect(locator).toHaveClass(expected) failed
Expected pattern: /ring-2/
Received string:  "size-10 overflow-hidden border-2 border-accent bg-surface rounded-full opacity-80 maplibregl-marker maplibregl-marker-anchor-center"
```

Restoring the two call sites returned it to green. The case fails for the
right reason rather than asserting DOM it would have rendered regardless.

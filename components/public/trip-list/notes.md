# components/public/trip-list — notes

The diary page's list of trips: `TripList` is the server half, `./trip-row` the
client half. It takes a plain `TripListItem[]` rather than the Pod's own types,
because a row needs a slug, a name and two optional dates and nothing else — the
page joins `getTrip` and `getTripIndex` and hands over the result (spec §6).
An unplaced trip still gets a row, which is what keeps it reachable when it has
no marker.

## The link renders on the server

Same split as `../trip-timeline`, for the same measured reason, which that
file's `notes.md#why-the-row-takes-children` records in full rather than this
one restating it: `TripRow` is a client entry point, so a `<Link>` written
inside it is bundled into this route's own chunk — 3.4 kB gzip of a second
`next/link` when the timeline did it in stage 4a. Built here and passed down as
`children`, the link resolves through the runtime chunk every page already
loads.

The dates are the same case and a smaller one. They are joined into a string
here, so nothing about formatting crosses into the client, and the join is on
the truthy values: a trip with one date renders that one, and a trip with none
renders **no element at all** rather than an empty `<span>`. `trip-list.test.tsx`
counts the `<li>`'s children for exactly that, since an empty span is invisible
to a text query.

## `data-slug` is on the row, and on `/` on nothing else

`MapSheet` finds a pinned trip's row by `[data-slug]` under the sheet body. **The
diary globe puts no marker in the DOM at all**: a trip on `/` is a GL circle in a
`circle` layer with `promoteId: "slug"` (`docs/decisions.md` §33), and `data-slug`
reaches a map only through `lib/map/marker-element.ts`, which only `useMapMarkers`
calls — and `DiaryMap` never calls it. So on this page there is no second holder
of the attribute to scope a query away from, and no marker to query by any
selector: `e2e/diary-globe.spec.ts` asserts trip points with
`queryRenderedFeatures` at a coordinate instead.

A trip page is the other mechanism, and there the collision is real — an entry pin
IS a DOM element and does carry the attribute, in a subtree that is a sibling of
the sheet's: `../trip-timeline/notes.md#data-slug-is-on-the-row-and-on-the-map-marker`.

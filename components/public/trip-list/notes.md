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

## `data-slug` is on the row AND on the map marker

`MapSheet` finds a pinned trip's row by `[data-slug]` under the sheet body, and
the diary globe's markers carry the same attribute for the same trip. The two
live in sibling subtrees of `.trip-shell`, so a query rooted in either finds only
its own — but a page-level locator matches both, and must scope first. The
timeline hit this when its rows gained the attribute:
`../trip-timeline/notes.md#data-slug-is-on-the-row-and-on-the-map-marker`.

# components/public/diary-map — notes

## Why this is not trip-map with a flag

Same shape, different everything it touches: one trip per marker rather than one entry, a
GeoJSON circle layer rather than DOM markers and a route line, a globe rather than mercator.
A single component with a `mode` prop would hold both surfaces' hooks — and so both surfaces'
state — on whichever page it rendered, and the flag would have to be threaded through every
one of them. Two small components that share the frame class and the activation shape cost
less than one that branches five times.

What IS shared is shared as a value, not by copying: `MAP_FRAME_CLASS` is imported from
`components/public/trip-map`, because the pane owns the position and a second copy of that
string is a thing that can drift into a layout shift no test asserts against.

## The camera belongs to the trips hook, not the instance

No `bbox` reaches `useMapInstance` here. The load view is whatever the style opens with — a
globe showing the world — and only a marker click moves it, through `useMapTrips`'s
`fitBounds` on that trip's own bbox.

The design spec's §7 opens instead on `centresBbox`, the box enclosing every placed trip's centre.
That was ruled out before this task: with the two seeded trips the fit centres on neither of them,
somewhere in between, which reads as a broken camera rather than an overview. Passing a `bbox` here
as well would also mean two camera calls racing on `style.load`. So the component makes no camera
call at all, and adding one to it is the wrong place — the camera is `useMapTrips`'s, whole.

The spec is therefore stale in two places, not one: **§6 also lists `centresBbox` as one of three
functions in `lib/map/trips.ts`, and it exists nowhere in this tree** — `grep -r centresBbox` over
`lib`, `hooks`, `components`, `app` and `test` returns nothing. It was never written, because the
camera it served was dropped. Amend §6 and §7 together, or the next reader goes looking for it.

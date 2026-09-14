# components/public/diary-map — notes

## Why this is not trip-map with a flag

Same shape, different everything it touches: one trip per marker rather than one entry, a
GeoJSON circle layer rather than DOM markers and a route line, a globe rather than mercator.
A single component with a `mode` prop would hold both surfaces' hooks — and so both surfaces'
state — on whichever page it rendered, and the flag would have to be threaded through every
one of them. Two small components that share the frame class and the activation shape cost
less than one that branches five times.

What IS shared is shared as a value, not by copying: `MAP_FRAME_CLASS` is imported from
`lib/map/frame.ts` — **not** from `components/public/trip-map`, which is where it used to live and
where importing one string from a `"use client"` module cost `/` 4 kB of eager chunk
(`lib/map/notes.md`, "The frame class is not in a client module"). The pane owns the position, and
a second copy of that string is a thing that can drift into a layout shift no test asserts
against.

## The camera belongs to the trips hook, not the instance

No `bbox` reaches `useMapInstance` here. The load view is maplibre's own default camera
constrained to the pane — `MAP_STYLE_URL` is unset in `.env.local`, `.env.example` and
`e2e/environment.ts`, and `buildBasemapStyle()` declares no `center` and no `zoom` — and only a
marker click moves it, through `useMapTrips`'s `fitBounds` on that trip's own bbox.

The design spec's §7 originally opened on `centresBbox`, the box enclosing every placed trip's
centre. That was ruled out before this task: naive min/max over longitudes has no antimeridian
handling, so the two centres give a box 212.6° wide running the long way round via Africa, and a
camera centred on neither trip. Passing a `bbox` here as well would also mean two camera calls
racing on `style.load`. So the component makes no camera call at all, and adding one to it is the
wrong place — the camera is `useMapTrips`'s, whole.

**Spec §6 and §7 were corrected on 2026-09-14** and now say exactly this. `centresBbox` was never
written and exists nowhere in the tree; the stage-5 plan still specifies it, as the record of a
plan rather than of the code.

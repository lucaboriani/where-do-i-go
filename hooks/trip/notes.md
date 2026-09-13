# hooks/trip — notes

## Why the context has an inert default

`TripHighlightContext` is created with `null` rather than a thrown default, and
`useTripHighlight` falls back to a static `INERT` value when the provider is
absent. An entry page can be rendered on its own — in isolation, in a test, or
before the provider tree that wraps a trip page mounts — and `CLAUDE.md`'s
studio-route-guard-is-UX-not-security stance generalises here too: a hook
consumed outside its provider should degrade, not crash the page around it.
`raise` and `clear` are no-ops on the inert value rather than throwing, so a
component that calls them unconditionally stays safe to render standalone.

## Why clearing falls back to the route

`useHighlightState` tracks a pointer highlight (raised by hovering a timeline
entry or a map marker) separately from the route's own slug. Clearing the
pointer does not blank the highlight — it falls back to whatever the route
already says is active, because the current trip segment is always "the"
highlight in the absence of a more specific one. Returning to nothing on clear
would make the map and timeline flicker to an unhighlighted state on every
mouse-out, even while the visitor is still reading the entry the URL points
at.

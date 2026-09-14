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

## A navigation drops the pointer

The pointer outranks the route while it is set, and only `clear()` unsets it —
raised by a row's `onPointerEnter`/`onFocus`, cleared by its
`onPointerLeave`/`onBlur`. That pairing breaks on one real sequence: tab to a
row's link and press Enter. `onFocus` has already raised the pointer; the
navigation removes the `<li>`, and a removed focused element gets no
`focusout` from Chrome, so `onBlur` never fires and the pointer stays set
forever. Press Back and the trip page shows a highlight with no pointer
anywhere on it, outranking the route it should have handed back to.

`useHighlightState` therefore drops the pointer whenever `routeSlug` changes.
A route change is by definition a new page: whatever raised the pointer is
either gone or about to be re-entered, which raises it again.

**Adjusted during render, not in an effect.** `useEffect(() => setPointer(null),
[routeSlug])` is the obvious spelling and `eslint-config-next` rejects it —
`react-hooks/set-state-in-effect`, "calling setState synchronously within an
effect body causes cascading renders". The render-phase form React documents
for exactly this case is used instead: a `seenRoute` state holding the route
the last render saw, compared on every render, with both states reset when it
differs. React re-runs the component before committing, so no stale pointer
is ever painted — which the effect version could not promise.

Tagging the pointer with the route it was raised under and ignoring it when
they differ — no reset at all — was considered and rejected: Back returns
`routeSlug` to its old value, and a pointer that was only ignored comes back to
life. The state has to be dropped, not masked.

## Why a pin is a second slot, not a third source

The pointer (set by hover/focus, cleared by leave/blur) and the pin (set and
cleared explicitly by the reader) have different lifetimes: a pointer ends when
the cursor leaves, but a pin survives until the reader taps to unpin. Collapsing
them into a single `Highlight` would make `clear()` ambiguous — does it clear
the pin, the pointer, or both? Keeping them separate preserves the semantic:
`clear()` always clears the pointer, `unpin()` always clears the pin, and the
precedence logic `pointer ?? pinned ?? route` means `activeSlug` is still a
single value. The map and the timeline stay unaware there are two slots
underneath.

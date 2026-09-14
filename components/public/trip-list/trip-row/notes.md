# components/public/trip-list/trip-row — notes

`TripRow` is `../../trip-timeline/timeline-row` for the diary page: same `<li>`,
same handlers, same `data-slug`/`data-active` pair, and the same reason for
each. `../../trip-timeline/timeline-row/notes.md#why-the-handlers-sit-on-the-row`
is why the pointer and focus handlers are on the row rather than on the link,
and is not restated here.

## Why the source is timeline

`HighlightSource` is `"map" | "timeline" | "pin" | "route"`, and `raise` narrows
its argument to `"map" | "timeline"`: the pointer half of the union is a
two-sided split — the map, or the list beside it — not a list of components.
A diary row is the not-the-map side, so it raises `"timeline"` even though no
timeline is on this page. Widening the union to `"list"` would buy a nicer word
and cost the two declarations in `hooks/trip/highlight-context.ts`, the
narrowed `raise` in `hooks/trip/use-highlight-state.ts`, and every test that
builds a value by hand, so it stays four.

## What is NOT in here

Only the handlers, `data-slug`, `data-active` and the active class. The link and
the dates are built by `../trip-list.tsx` on the server and arrive as
`children` — see `../notes.md#the-link-renders-on-the-server`.

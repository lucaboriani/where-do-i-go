# components/public/trip-timeline/timeline-row — notes

## Why the handlers sit on the row

The pointer and focus handlers are on the `<li>`, not the `<Link>`. React's
`onFocus` is implemented via the bubbling `focusin` event, so a handler on the
row fires whether the row itself or its link inside gets focus — one path for
mouse hover and keyboard tab, instead of duplicating the raise/clear pair on
both elements.

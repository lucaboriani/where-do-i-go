# map-sheet — notes

## the offsets are read not computed

The three snap positions are MEASURED from the DOM — the half spacer's `offsetTop`, the body's
`offsetTop`, and the strip the body reserves via its own resolved `scroll-margin-top` — never
recomputed in JavaScript from the `dvh` values in `app/globals.css`. There is then one source for
the geometry and no drift check to keep honest: if the stylesheet's `--sheet-half` changes, the
arithmetic follows without anyone editing it.

`snap.ts` itself touches no DOM. The component measures and this module decides, which is what
makes the arithmetic testable at a bare 390×800's worth of numbers rather than in a browser.

## why one scroller

Measured headless at 390×800 before the design existed (spec §2): two spacers plus a body at
`min-height: 100dvh`, all `scroll-snap-align: start`, in one container at `scroll-snap-type: y
mandatory`, land at exactly 0 / 240 / 640 — and once the body outgrows the viewport the container
rests freely past the last snap point, so a long timeline scrolls like any page. A nested scroller
would need to hand off touch and wheel events between an inner and outer container at exactly the
point the inner one bottoms out, in JavaScript, to get back what one container already does for
free; the browser's own scroll physics stand in for a drag handler this file never has to write.

## pointer-events is load-bearing

Also measured at 390×800: with the fixed `.trip-sheet` at `pointer-events: auto`,
`document.elementFromPoint` over the map returns the scroller, not whatever marker sits under it —
so every map marker becomes untappable with nothing thrown, no console warning, no failing
assertion, just a dead tap. Flipping the scroller to `none` and the body back to `auto` is the
whole fix. `test:e2e`'s map-tap flow is what stands in for a headless-Chromium re-measurement here;
CLAUDE.md's testing-gates.md lists it as one of the three seams the e2e gate exists for.

## why the drag is native

The handle button lives inside `.trip-sheet`, the same element that scrolls and snaps, so a
pointerdown on it is a pointerdown on the scroller — the browser already treats it as the start of
a drag. That satisfies the parent design's requirement for a pointer handler on the handle without
this component adding one: clicking cycles snap points for a mouse or a tap that doesn't drag, and
dragging the handle is scrolling the container, which CSS already snaps. No `pointerdown`,
`pointermove` or `pointerup` listener is added here.

## only a pin moves the sheet

A pin is deliberate — the reader tapped a marker and asked where that entry is — so the sheet
scrolls to `targetForRow(rowTop, handleHeight, offsets)` (spec §6). A hover or a route change is
not, and must never yank a sheet the reader has already placed: `source` is checked, not just
`activeSlug`. With one scroller, revealing a row far down the list necessarily raises the sheet
past half; that is §2's accepted consequence, and `targetForRow` keeps half as the floor so a
reveal can never CLOSE the sheet.

**One exception, and it is the position the sheet starts in.** Opening `/trips/japan/nara` from a
shared link arrives with `source === "route"` already set, and the entry's prose would sit below
the fold. So the first effect pass — and only the first, which the `opened` ref enforces — scrolls
to `full` with `behavior: "auto"`. Every later route change leaves the sheet alone, because the
component stays mounted and the scroller keeps its position across navigation.

The mount effect depends on `[source]` rather than `[]`: `react-hooks/exhaustive-deps` runs at
`--max-warnings 0` here and rejects an empty array around a `source` read. The `opened` guard is
then the mechanism rather than decoration — delete it and a route highlight moves the sheet on
every change, which `map-sheet.test.tsx`'s "arriving after mount" case catches.

No JavaScript branch on viewport width, anywhere. Above 48rem `.trip-sheet` is not a scroll
container at all, so `scrollTo` on it is inert and the desktop behaviour falls out of the CSS —
see `#why-one-scroller`.

The row lookup walks `[data-slug]` under the sheet body and compares `el.dataset.slug`, rather
than building a `[data-slug="…"]` selector: a slug is validated for length, not for CSS-safe
characters. Scoping to the body is also what keeps the map's markers out of the match — they
carry the same attribute, and `../trip-timeline/notes.md` records why that separation is
structural rather than conventional.

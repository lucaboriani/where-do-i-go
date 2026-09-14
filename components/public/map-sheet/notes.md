# map-sheet — notes

## the offsets are read not computed

The three snap positions are MEASURED from the DOM — the half spacer's `offsetTop`, the body's
`offsetTop`, and the strip the body reserves via its own resolved `scroll-margin-top` — never
recomputed in JavaScript from the `dvh` values in `app/globals.css`. There is then one source for
the geometry and no drift check to keep honest: if the stylesheet's `--sheet-half` changes, the
arithmetic follows without anyone editing it.

`snap.ts` itself touches no DOM. The component measures and this module decides, which is what
makes the arithmetic testable at a bare 390×800's worth of numbers rather than in a browser.

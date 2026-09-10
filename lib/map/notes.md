# lib/map — notes

## Why the style is hex and not oklch

`app/globals.css` is written entirely in `oklch()`, and MapLibre cannot parse
it. Measured 2026-09-09 against the installed
`@maplibre/maplibre-gl-style-spec`:

    Color.parse("oklch(0.185 0.008 250)")  ->  undefined
    Color.parse("#101316")                 ->  { r: 0.0627…, g: 0.0745…, b: 0.0862…, a: 1 }

    validateStyleMin(… "background-color": "oklch(0.185 0.008 250)" …)
      -> ['layers[0].paint.background-color: color expected, "oklch(0.185 0.008 250)" found']

So the failure mode is not a thrown error at startup. A layer with an
unparseable colour is a layer that does not draw, and a basemap missing its
water fill looks like a tile problem rather than a colour problem. Hence the
`/^#[0-9A-Fa-f]{6}$/` assertion in `tokens.test.ts`: it is there to stop
someone modernising a value into the spelling the rest of the project uses.

## The drift check and what it does not catch

`app/globals.css` records the hex beside eight of its eleven `@theme` colours
in a trailing comment, and Task 1 extended that to the three `--color-map-*`
lines. `tokens.test.ts` parses those comments and asserts `MAP_COLORS` agrees.

**It catches** someone editing the stylesheet and not the style module, or the
other way round, which is the drift that actually happens.

**It does not catch** a hex comment that is wrong for the `oklch()` value on
the same line. That would need an OKLCH→sRGB conversion in the test — about
twenty-five lines of colour maths with a rounding tolerance to argue about, and
a second place for the answer to be wrong. `docs/design-brief.md` computed all
eleven pairs and verified them in-gamut for sRGB with contrast ratios measured,
so the pairing is settled upstream and the check guards the copy rather than
the arithmetic.

**It does not reach the CSS at runtime either.** Nothing here proves the
browser renders the same colour the style names; that is what stage 2's
Playwright spec looks at.

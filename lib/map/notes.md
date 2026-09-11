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

## Seventeen layers, and what was left out

OpenFreeMap's own dark style has forty-seven layers, and this one is subtracted
from that list rather than assembled from scratch. Left out deliberately:
buildings, aeroways, oneway arrows, road labels, railway dashlines and water
labels.

The reason is the brief's, not laziness. The basemap exists so that the route
line and the photographs are the only saturated things on screen, and a
complete cartographic style competes with both. Enumerated rather than counted,
because a count in this repository goes stale the first time the list moves:

    background            landcover_park        boundary_country      place_city
    water                 highway_minor         boundary_state        place_town
    waterway              highway_major         place_country         place_village
    landcover_wood        highway_motorway      place_state
    landcover_glacier     railway

## The achromatic bound is 32, and why

`docs/design-brief.md` requires that "roads and boundaries stay achromatic",
and `style.test.ts` enforces it as a bound on each colour's RGB channel spread
— `max - min` — which is zero for a true grey and large for a saturated hue.

The number is measured, not chosen. The nine `INK` values span **6 to 15**
(`wood` 6, `park` 6, `roadMinor` 8, `glacier` 9, `rail` 9, `roadMajor` 10,
`roadMotorway` 12, `boundaryState` 13, `boundaryCountry` 15). The accent trio
spans **121 to 234** (`accentBright` 121, `accentDeep` 135, `accent` 234). So
32 sits in a gap 106 wide, 17 above the highest ink and 89 below the lowest
accent.

The inks are not literally achromatic and are not meant to be: the brief gives
the whole palette a cool cast at hue 250 so the accent "reads as belonging to
the palette instead of sitting on top of it". A bound of 12 was the first
guess and it fails on both boundary colours.

`MAP_COLORS` values are skipped rather than bounded. `map-water` measures 17 —
deliberately tinted to hue 235 — and the accent trio is banned outright by the
case beside this one, which names the three hexes.

## Roads carry no casing

Unlike OpenFreeMap's, which draws a casing and an inner
line per class. The brief wants exactly one cased line on the map — the route —
and a cased road at the same zoom reads as a competing route.

`admin_level` is a number in the OpenMapTiles schema, so the boundary filters
compare numerically. A string comparison silently matches nothing, which looks
like a tile problem.

## Why leaves are HTML and clusters are GL

A thumbnail is a Pod URL. An `<img>` loads it with no CORS dance at all, where
`map.addImage` needs a decoded bitmap the Pod is under no obligation to serve
cross-origin. Stage 3 §6 puts leaf markers in the DOM for exactly this reason;
the two GL layers here are the clusters, which draw nothing but a circle and a
count and never touch a photo.

`dy:precisionMeters` choosing a pin glyph versus a soft circle (§6) is styling,
not geometry, so it is a CSS rule on the leaf marker rather than a second
source or paint property here.

## Why dashes.ts reads mode names from vocab.ts, not schema.ts

Measured 2026-09-11, on the build produced by wiring `use-map-layers` into
`TripMap` (phase 4 stage 3, task 7): `dashes.ts`'s `TravelMode.options` read
`TravelMode` as a **value** out of `lib/pod/schema.ts`, and a client component
importing a zod value pulls the whole `zod` package with it. The trip page's
worst-route weight went from 178.2 kB gzip to 216.6 kB — the missing 38 kB was
one chunk, confirmed by grep for `ZodError`/`ZodType`, that nothing before
this task had ever made a public client component reach.

`lib/vocab.ts`'s `TRAVEL_MODE` carries the same eight keys in the same order
— it has to, `check:vocab` holds it to `docs/data-model.md` in both
directions — and it is already imported client-side elsewhere (the studio's
entry editor) with no such cost, because it is plain string constants with no
zod in the chain. `Object.keys(TRAVEL_MODE)` replaces `TravelMode.options` as
the iteration source; `dashes.test.ts` keeps checking coverage against
`TravelMode.options` from the schema, so the two lists drifting apart is
still a failing test rather than a silent gap.

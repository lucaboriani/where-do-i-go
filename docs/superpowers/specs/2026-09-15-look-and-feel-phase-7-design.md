# Phase 7 — look and feel

The visual language, applied to every surface that already exists. Phase 4 finished the last of
them, so this is the first point at which a design plan can be written against the whole app rather
than against a sketch of it.

`docs/design-brief.md` is the authority and is not restated here. This spec settles what the brief
leaves open, and records what the mockups in `.mockups/` established by being looked at.

## 1. What ships

- Two typefaces, self-hosted: **Syne** and **DM Mono**. The empty type tokens get filled.
- A type scale, a spacing rhythm, and the body-on-dark treatment the brief asks for.
- The three public surfaces restyled — entry, trip, diary — plus the studio left deliberately plain.
- The route and marker treatment agreed from the comparison in `.mockups/route.html`.
- One motion decision: view transitions between pages, and nothing else that moves on its own.

Out of scope and named so they are not smuggled in: the phase-8 landing page on its own domain, OG
images (phase 5, and they need a deploy), any change to what is read from the Pod, and any new
`dy:` term. No component's behaviour changes — this phase changes how things look, not what they do.

## 2. The typefaces, and the one risk in them

**Syne for everything that is prose or interface; DM Mono for everything that is data.** Both come
from Google Fonts and are self-hosted at build time by `next/font/google`, so the brief's "no
third-party font requests" holds without a CDN and without a runtime fetch.

Syne is the answer to the brief's "choose deliberately rather than reaching for the usual
grotesque". Its character lives in the heavy cuts, which are extended and slightly strange; the 400
weight is calm enough to read. That maps directly onto "spend boldness in one place": **the display
cut is the bold thing, and it is the only bold thing.**

**The risk, stated because it is real**: two families means body prose is also Syne, and Syne at
paragraph length is unusual. The `.mockups/entry.html` page exists to settle that by being read
rather than argued about, and it reads well at 17px with the leading and measure in §3. If it ever
stops reading well at length, the fix is a third family and an amended brief, not a squeeze on the
leading.

Weights loaded: **400** (body, interface), **700** (subheads, buttons), **800** (display). DM Mono
at **400** only. Latin subset. Syne has a variable cut; use it — one file covers 400 through 800.

## 3. The type scale and the body treatment

| Role | Family | Size | Weight | Tracking | Leading |
|---|---|---|---|---|---|
| Display | Syne | `clamp(2.75rem, 9vw, 7rem)`, uppercase | 800 | `0.02em` | `0.94` |
| Display, small | Syne | `clamp(1.5rem, 3.5vw, 2.25rem)`, uppercase | 700 | `0.01em` | `1.05` |
| Body | Syne | `17px` | 400 | normal | `1.75` |
| Interface | Syne | `0.95rem` | 400/500 | normal | `1.45` |
| Data | DM Mono | `0.78rem` | 400 | `0.01em` | `1.5` |
| Label | DM Mono | `0.68rem`, uppercase | 400 | `0.08em` | `1.5` |

**Body on dark**, per the brief: text at `--text` (`#E2E5E8`, not white) on `--bg` (`#070B0F`, not
black), leading `1.75`, measure `66ch` — inside the brief's 80-character ceiling with room for
Syne's wider lowercase.

The palette does not change. All six tokens and the three map colours are already in
`app/globals.css` under `@theme` and are correct; this phase adds type and rhythm, not colour.

## 4. The one bold gesture, and its sequence

Decided with the maintainer, and it resolves the tension the brief leaves open between "spend
boldness in one place" and "the photographs are the content":

**They are sequential, not competing.** The display cut is the *entrance* — a trip name or an entry
title, large, uppercase, extended, occupying most of a first screen. Then you scroll and the
photographs take over as the memorable thing: full-bleed, edge to edge, on near-black, with
everything around them small and quiet.

Type leads, photographs carry. Nothing else on the page competes with either.

**A consequence worth stating, because the mockup found it**: Syne 800 at display size does not fit
a 34rem sidebar column. The trip page's masthead therefore spans the full width above the
map-and-timeline split rather than sitting inside the column. That is a layout change, not only a
type change, and it is in `.mockups/trip.html`.

## 5. The structural devices, and where they are forbidden

The brief permits numbering and monospace only where they carry information. Made concrete:

- **Numbered**: entries within a trip, `01`–`nn`, because a trip is a sequence.
- **Not numbered**: the diary's trips, because a diary is a set. The landing list is unnumbered.
- **Mono**: coordinates, dates, times, offsets, travel modes, precision labels, the status line.
- **Not mono**: titles, prose, buttons, navigation, anything whose alignment carries nothing.

**`dy:precisionMeters` changes the rendering**, which the brief asks for and which stage 3 already
half-built in the marker shape. Extended to the type: a fuzzed coordinate prints two decimals and
takes a soft circle; an exact one prints four and takes a square. The typography then tells the
truth about the data rather than implying a precision the Pod does not hold.

The brief's avoid-list is adopted verbatim: no all-caps small labels, no tracked-out eyebrows above
headings, no meta strings joined with middle dots, no arrows appended to link text, no identical
rounded cards with the same shadow.

## 6. The route and the markers — agreed against the running app

`.mockups/route.html` compares the current treatment with the proposal over a screenshot of the
real map. The proposal is adopted, and the legs are kept — that question is closed, not deferred (§10).

- **The leg is an arc, not a chord.** On the trip page it reads as a journey rather than a vector.
  On the globe it is simply correct: the shortest path between two distant points is a great
  circle, and the straight Mercator line shipped today draws a path nobody could travel.
- **1.5px, no casing.** Today it is 2.5px on a 3.5px casing — six pixels of saturated blue across a
  basemap whose entire purpose is to be the quiet thing. The casing separates the line from land it
  does not need separating from.
- **The leg fades from its origin.** Departure is context; arrival is the subject.
- **Markers go from 40px to 26px and the photograph fills them.** The current ring is mostly empty.
  Arrival gets a soft halo rather than a hard ring; a fuzzed coordinate keeps the soft circle
  decision §29 and the brief already require.

**Unrelated to the design, found while doing it**: one seeded marker renders a broken-image icon, so
`dy:thumbnail` is set to something that does not resolve in dev. That is a bug to look at, not a
thing to style around.

## 7. Motion

One orchestrated moment, per the brief: **view transitions between pages**, and nothing else that
moves without being asked. No entrance animations, no fade-and-slide on scroll, no hover transitions
on cards — the brief names all three as the generated look.

The motion that already exists and stays: the sheet's snap, the camera's fly-to, the highlight.
Each answers a user action, which is the brief's test.

`prefers-reduced-motion: reduce` disables view transitions and turns the fly-to into a jump. That
is already how the map behaves; this phase extends it to the transitions and states it once.

## 8. The bundle, which has 7.6 kB of headroom

`size:public` is at **182.4 kB of 190** before this phase adds anything, and phase 7 is the phase
most likely to add client-side code. Three rules, in order of how much they matter:

1. **Fonts are not weighed by `size:public` and are still real bytes.** It measures the JS chunks a
   prerendered page references; a woff2 is neither. Subset to latin, use Syne's variable cut, and
   `display: swap` — and do not let the budget's silence read as approval.
2. **Nothing new becomes a client component.** Every styling change this phase makes is CSS and
   server-rendered markup. If a treatment seems to need `"use client"`, that is the signal to find
   another treatment, not to spend the headroom.
3. **View transitions are CSS-first.** The browser API needs no library; `next/link` already
   navigates. If a transition needs JavaScript beyond an opt-in class, it does not ship.

The budget is a gate on this phase exactly as it was on the map: if `size:public` moves, something
was built the wrong way.

## 9. Testing

This phase changes appearance, and appearance is the thing this repository's tests are worst at.
Being honest about that is the point of this section.

- **The token-drift check already exists** (`lib/map/tokens.test.ts`) and must keep passing: the map
  palette in `lib/map/style.ts` and the CSS tokens agree, and neither is spelled `oklch()`.
- **A new check of the same shape for type**: the two families are declared once and every consumer
  reads the token, so a hard-coded `font-family` anywhere in `app/` or `components/` fails.
- **`check:structure` and the arbitrary-value lint rule** are what keep the type scale from being
  re-invented inline. No `text-[17px]` anywhere outside `components/ui/**`.
- **The existing browser cases must keep passing unchanged.** They assert structure and behaviour —
  a canvas, a feature state, a snap position — not appearance, so a restyle that breaks one has
  broken something real.
- **No screenshot tests.** They would be the obvious answer and they are a trap here: they fail on
  every intentional change, so they get regenerated without being read, and then they assert
  nothing. The mockups are the design record; the eye is the check.

## 10. Open, and deliberately not decided here

- ~~Whether the legs survive at all.~~ **Decided 2026-09-15: the legs stay.** The question was
  whether a line between two entries claims more than the data supports — there is no `dy:track`, so
  the app knows both endpoints and nothing in between. The arc in §6 is the answer: it reads as a
  connection rather than as a route you could follow. `buildLegs` and the leg feature state stay.
  **The travel-mode dash, as written above, was dropped rather than kept** — MapLibre cannot both
  `line-gradient`-fade and `line-dasharray` on one line, and the fade won; travel mode remains in
  the timeline chip only. See `docs/decisions.md` §35.
- **The photographs are unjudged.** The mockups use CSS gradients, so the full-bleed figure — the
  thing the whole design bet rests on — has not actually been seen. Settle it with real images
  before the entry page is built, not after.
- **The landing page's treatment.** Not mocked, because phase 8 gives the project a separate landing
  page and the diary's own `/` may want to be almost nothing but the globe. Decide when phase 8's
  scope is clear.
- **Typefaces for the studio.** It inherits Syne and DM Mono because loading a third family for one
  private surface is indefensible, but the brief says the studio may look plain and this phase does
  not make it look designed.

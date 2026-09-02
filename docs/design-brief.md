# Design brief

What is fixed, what is open, and what to avoid. Read before building any UI.

## Subject and audience

A personal travel diary. The content is photographs and first-person prose about places. Two
audiences with opposite needs, kept apart:

- **Readers**, who arrived via a shared link and want to look at photographs. The public site
  is for them. Content first, no pitch.
- **Developers**, who found the repository. The project landing page is for them, on a
  separate domain.

The owner is the only writer, and the studio's audience is one person who already knows how it
works.

## Fixed by the brief

These came from the client and are not open for reinterpretation:

- **Dark, near-black background.** No light mode, no theme toggle.
- **Modern and sleek**, referencing `https://sofa-code.netlify.app/` — a technical-editorial
  gallery: numbered index items, monospace category chips, uppercase display type with wide
  tracking, `//` comment-style asides, a deadpan status line in the footer, view transitions
  between pages.
- **Mobile map layout:** map fixed in the upper portion of the viewport, entries in a drag-up
  sheet over it with three snap points (peek / half / full). The map stays mounted at all snap
  points; the drawer must not be implemented by unmounting it.
- **Desktop map layout:** sticky map beside a scrolling entry column, cross-highlighting in
  both directions.

## Fixed: the palette

The accent is a **blazing blue** at hue 250 in OKLCH. Every value below is verified in-gamut
for sRGB, with WCAG contrast ratios computed. Use these tokens; do not invent neighbours.

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `bg` | `oklch(0.145 0.012 250)` | `#070B0F` | page background, cool near-black |
| `surface` | `oklch(0.195 0.014 250)` | `#10151B` | reading surface, cards, drawer |
| `hairline` | `oklch(0.300 0.018 250)` | `#272F37` | borders, photo edges, dividers |
| `text-muted` | `oklch(0.680 0.012 250)` | `#9399A0` | metadata, captions |
| `text` | `oklch(0.920 0.006 250)` | `#E2E5E8` | body copy — deliberately not pure white |
| `accent` | `oklch(0.660 0.182 250)` | `#1295FC` | route lines, active markers, focus rings |
| `accent-bright` | `oklch(0.790 0.107 250)` | `#84C0FD` | accent as *text* or small UI on dark |
| `accent-deep` | `oklch(0.420 0.117 250)` | `#034F8A` | route casing, pressed states, filled buttons |

Measured contrast: `text` on `bg` 15.6:1, `text-muted` on `bg` 6.9:1, `accent` on `bg` 6.4:1,
`accent-bright` on `bg` 10.3:1, `text` on `accent-deep` 6.7:1. All pass AA; most pass AAA.

**Use `accent-bright`, not `accent`, whenever the accent carries text or thin strokes.**
Saturated blue has inherently low luminance, so `accent` at small sizes on near-black is
legible but tiring. The two-step accent exists for exactly this reason.

The background carries a slight cool cast (chroma 0.012 at the same hue) rather than being
neutral grey, so the accent reads as belonging to the palette instead of sitting on top of it.

### Blue has one hazard on this project: water is blue

A blue route line over a blue basemap is the one failure that would undermine the accent, so
the map style must be built around it:

| Token | OKLCH | Hex | Role |
|---|---|---|---|
| `map-land` | `oklch(0.185 0.008 250)` | `#101316` | landmass, near-neutral |
| `map-water` | `oklch(0.235 0.020 235)` | `#152026` | water, heavily desaturated |
| `map-label` | `oklch(0.560 0.010 250)` | `#70757A` | place labels |

Water sits at chroma 0.020 against the accent's 0.182 — nearly ten times less saturated — and
is nudged to hue 235 so it reads as a different blue rather than a dim version of the same
one. `accent` against `map-water` measures 5.3:1, and against `map-land` 6.0:1, so the route
holds up over both.

Two further cartographic requirements:

- **The route line needs a casing.** Draw `accent-deep` underneath at 1.5–2px wider than the
  `accent` line. Without it the route breaks up wherever it crosses a label or a coastline.
- **Roads and boundaries stay achromatic.** Any saturated hue in the basemap competes with the
  route. The accent and the photographs should be the only saturated things on screen.

### Why this blue, and how not to ruin it

Blue is the web's default accent — links, focus rings, iOS, and every framework's primary
colour. The distinctiveness has to come from execution:

- **Pin the exact token.** `#1295FC` is not browser blue and not Tailwind's `blue-500`. Never
  let a default blue in beside it; the two together look like a mistake.
- **Blue against warm travel photographs is complementary**, which is the reason it works
  here: sunsets, food and terracotta will sit against it rather than fighting it. That also
  means photo markers pop by luminance, not hue, so keep marker borders bright.
- **Spend it narrowly.** The accent belongs to the map and to interaction states. If it starts
  appearing in headings, chips, and section dividers as well, it stops being an accent.

## Open, and to be decided deliberately

**Typefaces.** Two families at most, clearly distinct, self-hosted via `next/font`. No
third-party font requests, consistent with the zero-external-dependency stance. Choose
deliberately rather than reaching for the usual grotesque.

**Body text treatment on dark.** Not pure white on pure black at paragraph length. Body copy
wants a very dark neutral surface, text below full white, generous line-height, and a measure
under 80 characters.

## Structural devices, used only where they carry information

The reference site uses numbered markers and monospace labels. Both are legitimate here, but
only where the content justifies them:

- **Numbering fits entries**, because a diary is genuinely a sequence — entries within a trip
  are ordered in time. Numbering a filtered grid of trips is decoration; a trip list is a set,
  not a sequence.
- **Monospace fits coordinates, dates and travel modes**, because they are data and the
  alignment is meaningful. Rendering `35.6938°N 139.7034°E` in mono is honest use. Setting
  every small label in mono because it looks technical is the generic default.
- **`dy:precisionMeters` should change the rendering.** Show fewer decimal places when the
  stored location is coarse, and a soft circle rather than a pin. The typography then tells
  the truth about the data.

Avoid: all-caps for every small label, tracked-out eyebrow labels above headings, meta strings
joined with middle dots, arrows appended to link text, identical rounded cards with the same
shadow under each.

## Photographs

They are the content; the interface recedes around them.

- Dark photos disappear into a dark page. Either full-bleed them or give each a barely-there
  edge. Do not float mid-tone images on black with no boundary.
- Blur placeholders and explicit aspect ratios on every image. Layout shift on a photo-heavy
  page is the most visible quality failure available.
- The basemap must be dark and desaturated to match the page tone, so photo-thumbnail markers
  and the accent route line are the only saturated things on screen. **This is the single
  highest-leverage visual decision in the project** and it lives in the map style JSON, not
  the stylesheet.

## Motion

One orchestrated moment, not scattered effects. View transitions between pages are part of the
reference's feel and are the right place to spend it. Fade-and-slide-up entrances on every
section and hover transitions on every card read as generated. Motion that answers a user
action — the drawer opening, a marker becoming active — is always welcome. Respect
`prefers-reduced-motion`.

## The studio is a different product

Dense, functional, and only one person will ever see it. It may look plain. It must not
inherit the public site's editorial treatment, and the public site must not inherit shadcn's.

Stock shadcn styling is itself a recognisable generated-app look — mid-grey borders, soft
shadows, generous radius. Since the CLI copies source into the repo, restyle it rather than
tweaking: radius near zero, borders and background steps instead of shadows, focus rings in
the project accent, and the CSS variables rewritten wholesale rather than nudged.

## Process

Before writing UI code, write a short design plan: 4–6 named hex values, the two typefaces and
their roles, a layout concept with ASCII wireframes, and the principles that make this page
specific to a travel diary rather than to any dark developer-portfolio site.

Then review that plan against this brief. If any part of it is what you would have produced
for a generic dark-mode project, revise it and note what changed and why. Only then build.

Spend boldness in one place. Let one element be the memorable thing and keep everything around
it quiet.

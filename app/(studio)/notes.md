# Studio layout notes

## Touch tap targets

`studio.css` gives every control inside a studio `main` a 44px minimum height on
`(pointer: coarse)` screens, and turns links into `inline-flex` so a bare text
link in a list reaches that height without a bigger font. It is one
studio-scoped stylesheet rather than per-element classes because the studio's
controls are raw elements spread over many components, and a desktop mouse
keeps the dense layout the design brief asks for. It is imported only by the
studio root layout, so public routes never load it. The proof is
`e2e/studio-responsive.spec.ts`, which runs at 390x844 with `hasTouch` and
`isMobile` — under which Chromium matches `pointer: coarse`.

Both rules sit in `@layer base`. Unlayered CSS beats every layer, so without it
a utility on a studio control (`hidden`, `block`) would lose to `inline-flex`
on touch screens. In the base layer, utilities win again; the `min-height`
default survives `h-*` because those set `height`. Chunk order does not matter:
whichever parses first, `base` is declared before `utilities` (checked in the
built CSS and in a touch-emulated browser, 2026-11-18).

The query is `pointer: coarse`, not `any-pointer: coarse`, on purpose: a touch
laptop whose primary pointer is a trackpad keeps the dense desktop studio the
design brief asks for. Only a device whose primary input is touch gets the
bigger targets.

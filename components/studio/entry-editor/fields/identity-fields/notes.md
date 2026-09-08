# identity-fields — notes

The first of Stage B's five field groups: the four controls that say which entry
this is. Extracted from `entry-editor.tsx`'s single `return` with no state moved
— that is Task 5's whole constraint, and the reason Task 6 changes one file's
wiring instead of a thousand lines of JSX at the same time.

## Props only

No `useState`, no `useRef`, no effect, and no `"use client"` directive.

The directive is absent for the reason `field/notes.md` gives: this module holds
nothing that needs a client entry point of its own, so it inherits the boundary
from `entry-editor.tsx`, which is `"use client"` on its first line. Adding one
here would declare a second entry point for a component that renders props.

**The interface is named and explicit — ten props, not a spread.** A group taking
`{...everything}` would have moved lines without moving responsibility: the
render bound would be satisfied and the file would be harder to read than the
block it replaced, which is the opposite of what this refactor is for. The
callbacks are typed `(value: string) => void` rather than as React setters, so
Task 6 can pass a dispatcher in place of `setSlug` without touching this file.

`addressFixed` arrives as one boolean and holds two controls. That is deliberate
and is §10's rule rather than a convenience: the entry's URL is built from the
trip and the slug together, so a slug that stayed live beside a fixed trip would
offer the owner an address change the write sequence then refuses.

## What travelled, and the one thing that did not travel verbatim

The JSX is the old lines 2974–3029, re-indented by six spaces and with the four
setters renamed to their callback props. One formatting change, no behavioural
one: `<Field id="entry-slug" …>` was a single 114-character line in the editor
and is wrapped here, because `.prettierrc` sets `printWidth: 100` and the line
was over it at the old indent too.

A **fragment**, not a wrapper element. The four `Field`s are grid children of the
editor's `<fieldset className="grid min-w-0 gap-4">`; a `<div>` here would make
the whole group one grid cell and collapse the gaps between the fields — the
same defect the fieldset's own docblock records from when `grid gap-4` still sat
on the `<form>`.

## What this test pins

Rendered directly with props, and never through the editor's harness: that rig
`vi.mock`s `@/lib/pod/access`, fixes the clock and seeds a settings handler, none
of which a group of four inputs has any use for (`field/notes.md#why-not-import-the-harness`).

1. **Each control is named, and the label query resolves to the control.**
   `SELECT`, `INPUT`, `INPUT`, `TEXTAREA`, each holding the value it was given.
2. **The draft marker is in the option's own text.** Asserted as the full option
   list in order, so a marker moved to a `className` or an attribute fails.
3. **Every callback is a spy and the silence of the other three is asserted.** A
   group wired to the wrong setter — the one mistake this extraction can make —
   passes every value assertion and fails these.
4. **`addressFixed` holds exactly two of the four.** Both halves: the two that go
   dead and the two that must not.
5. **The slug's hint is the only description on the group**, resolved through
   `aria-describedby` with the IDREF proved to exist first. A dangling
   association computes to the empty string, so a test that read the text
   directly would report "no hint" for a broken one.

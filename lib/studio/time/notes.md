# lib/studio/time — notes

Why the offset arithmetic lives under `lib/` and what its tests may assume.
Section numbers are `docs/data-model.md`, which stays the normative source.

## Tested through the DOM until now

Every function here was module-private in
`components/studio/entry-editor/entry-editor.tsx`, so the only way to reach it
was to render the editor, type into a control and read a triple back out of a
fake Pod. That is why `offsetMinutes` — four lines of string arithmetic, and the
comparator the offset select is ordered by — had no case of its own for either
half of a non-whole-hour zone, and why `toOffsetDateTime` had none for the
half-formed values `<input type="datetime-local">` really produces.

Stage B moved them for two reasons: `lib/` holds no React (CLAUDE.md, "Code
structure"), and phase 4's timeline wants this arithmetic without wanting a
form. The direct tests came first, before the move — the point of the task was
the tests, not the file layout.

## The clock this file runs on

`Australia/Lord_Howe`, pinned in the test file and restored in `afterAll`, and
it is not the machine's. Two properties are wanted at once and no zone this
project's other suites pin has both:

- **A non-whole-hour offset**, so `pad(size % 60)` and the minutes half of
  `offsetMinutes` are exercised rather than always zero. Lord Howe is +10:30.
- **A daylight half**, so "computed AT the instant in question" is a checkable
  claim rather than a comment. Lord Howe is +11:00 from October to April, so
  January and July answer differently on the same machine.

The editor's own suite pins `Asia/Tokyo` instead, for the reason its harness
gives: a non-zero offset everywhere, so an implementation that hardcoded `Z`
cannot look correct on a UTC developer machine. Both pins assert that the
assignment took effect, because a pin that has silently stopped applying is
worse than no pin.

## The offset shape is wider than the list

`OFFSET_SHAPE` accepts anything `[+-]dd:dd`, so `+05:15`, `+05:61` and `+99:99`
all pass it while none of them is in `OFFSETS`. The width is deliberate for the
first of those: an entry written by another tool can carry an offset this
editor does not offer, and §7.3's wall clock survives only if the editor shows
such a value and puts it back unchanged.

**The open item, carried rather than closed by Stage B.** The minute-range fence
lives in the editor's photo-offset guard (`Math.abs(offsetMinutes(zone)) <= 840`
plus a minutes-under-60 conjunct), not in the shape — so a *shape-valid but
unlisted* offset restored from a draft is refused by the select, which falls
back silently and loses an offset the owner had. Tightening `OFFSET_SHAPE`
is the wrong fix: it would also refuse `+05:15`, which is the case the width
exists for. The tests here pin today's behaviour, including the values that pass
the shape and should not; they do not assert that this is right.

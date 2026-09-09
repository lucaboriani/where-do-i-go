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

## The wall clock is copied, not recomputed

§7.3: `dy:occurredAt` "carries the local UTC offset of the place", so
`21:40+09:00` renders as half past nine in the evening for every reader.
Converting through a `Date` and back would rewrite an entry edited from another
time zone into that zone's offset — the same instant, spelled as the wrong time
of day, which for a travel diary is most of the meaning.

So `toOffsetDateTime` supplies only the **offset**, and it is the one the
owner's own control is holding. `wallClockOf` shows a stored wall clock as
stored, never shifted into this machine's zone, for the same reason.

**The offset is required, and the fallback that used to be on that line has
moved rather than gone.** It read `storedOffset ?? offsetHere(wall)` — the
entry's own offset, else the *editing machine's* — which is the guess the offset
control exists to replace, and it fired where nobody could see it. The same
chain is now the control's initial value, where the owner can read it and
correct it. Keeping a copy here as well would be a second chain that has to
agree with the first and says nothing when it stops: the rule §9 step 3 states
for the precision — what the control shows is what gets applied — spelled for
the offset.

## wallClockNow exists because offsetHere("") is +00:00

Split out of `nowWithOffset` for the offset control's initial value, which needs
the offset of the current instant and has no wall clock of its own to ask about.
`occurred` is `""` on a create, and `offsetHere("")` answers `+00:00` rather
than this machine's zone — measured, not reasoned about, because `offsetHere`
treats an unparseable date as zero minutes. A new entry defaulting to UTC while
the owner sits in Tokyo is the exact silent wrong-offset bug the control exists
to remove.

`nowWithOffset` is the one instant a save is stamped with: `dcterms:created` on
a create, `schema:datePublished` on a first publication, and, through
`saveEntry`'s `now`, `dcterms:modified` on the entry and its index row. These
are moments in the owner's life rather than in the trip's, so unlike
`dy:occurredAt` they take the offset of wherever the owner is sitting.

## The offsets actually in use, and the odd ones are the point

`+05:45` is Nepal, `+08:45` is Eucla, `+12:45` is the Chathams, `-09:30` is the
Marquesas, `+05:30` is India. A list of whole hours makes those places
unwritable, which for a travel diary is the wrong corner to cut, and it is also
why this is a `<select>` over a fixed list rather than a stepper: a numeric
control that admits `+05:45` admits `+05:61` with it.

**Both halves of a zone's year, and this list was wrong on that twice over until
2026-09-07 (F2).** `-02:30` is Newfoundland *daylight* time, May to November,
and `-03:30` — the same island in the other half of its year — was already
there. `+13:45` is Chatham *daylight* time, September to April, beside the
`+12:45` the argument above names as one of the odd ones the list exists for. So
two of the places argued for were writable for half a year each.

The cost is not a wall clock: §7.3's guarantee survives, because the owner
writing up the Chathams in January picks the nearest offered value and the
*instant* is an hour out, which is what any cross-trip ordering uses. Nothing on
screen says so, and `offsetOptions`' union cannot rescue it either, because on a
create there is no stored value and no photo to supply one.

**"Actually in use" is a measured claim as of that date, and the way it was
wrong is worth more than the two strings.** Task 2's review verified the list
programmatically *against the brief text*, so the brief was the oracle rather
than the world — and neither could name a value neither of them knew about. The
oracle is the set of offsets in real civil use, daylight ones included. The
durable form of the claim is `ODD_OFFSETS` in
`components/studio/entry-editor/entry-editor.offset.test.tsx`, which lists the
non-whole-hour zones and goes red if one stops being offered. **A count is not
the claim**, so there is none: the length moved the moment those two were added
and it moves again the next time a legislature moves a zone.

`+00:00`, never `Z`. Both are valid `xsd:dateTime` offsets and mean the same
instant, but §6 and `lib/pod/rdf.ts` want the explicit spelling and `offsetOf`
normalises a stored `Z` onto it — so a list offering `Z` would be a second
spelling of one value, and the control would blank on every entry written with
the other one.

**In order, rather than sorted at use.** The strings do not sort into this
order: `-` precedes `+` in ASCII, so a string sort puts the western hemisphere
first and then orders it backwards, `-01:00` before `-12:00`. `offsetMinutes` is
the comparator for the one case that cannot be written out in the list — an
offset the entry carries that is not on it.

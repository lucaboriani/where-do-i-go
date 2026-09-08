
## the-allow-half-is-a-wait

Section 12m's three cases each pair a refusal with an allow — "the second photo did not overwrite
the first" is satisfied by an editor in which nothing filled at all, so the allow half is what
makes the refusal mean something.

Two of those allow halves read the DOM **synchronously**, right after awaiting the two uploads
and both `<img>` elements. Neither of those awaits covers the state update that actually fills
the clock: `settleBoth` waits for four PUTs, and `findByRole` waits for a slot to render. The
fill is a separate `setOccurred` in the offer, and under load it can land after.

That is what failed twice, in full-suite runs only, on the composite case:

    expected [ '2026-04-11T07:05', …(2) ] to include ''

`''` is an empty clock box — the allow half asserted before the fill arrived. Both halves are
`waitFor` now.

**The refusals are deliberately NOT waits.** A `waitFor` around "the second photo's zone was
refused" would pass by timing out on a value that was never going to change, which is the
opposite of a proof. Only the allow half waits; the refusals read the settled DOM after it.

Not reproduced directly — fourteen runs, including under deliberate CPU contention, stayed green.
The fix follows from the failure message and the shape of the awaits, and is recorded as such
rather than as a confirmed repro.

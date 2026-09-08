# lib/studio/place — notes

Why the place logic lives under `lib/` and what its tests may assume. Section
numbers are `docs/data-model.md`, which stays the normative source.

## Tested through the DOM until now

`placeFor`, `placeTextOf`, `gridOf`, `precisionLabel` and `PRECISION_GRIDS` were
module-private in `components/studio/entry-editor/entry-editor.tsx`. The
three-way logic below was therefore only ever asserted by saving an entry into a
fake Pod and reading the triples back, which is a slow and indirect way to ask
whether an empty box removes a name. Stage B moved them because `lib/` holds no
React (CLAUDE.md, "Code structure"), and wrote the direct tests first.

## Untouched, replaced, removed

Three outcomes, and `placeFor` distinguishes them by what the *caller* passes
rather than by a flag:

- **Untouched** is spelled as *the value the entry already had*. The editor
  passes `existing?.place?.geo` when neither coordinate box holds text, and the
  three text controls are seeded from the entry, so a box nobody opened writes
  its own stored value back.
- **Replaced** is a new value: a fuzzed pair (§9 steps 3–4) or new text.
- **Removed** is `undefined`, on all four fields independently. `placeTextOf`
  is where `""` becomes `undefined`; §9 step 2's home-region drop is where the
  geometry does.

**`undefined` at this boundary is a removal, never an omission**, and the two
must not be collapsed. `placeFor` starts from `{ ...existing, ...text, geo }`,
so a key present with an `undefined` value overwrites a stored value — which is
what lets an owner retract a name from a world-readable resource. Spelling
"untouched" as `undefined` would delete the entry's coordinate on every edit
that did not retype one.

The four are independent in both directions: clearing a name leaves the
geometry, and §9's drop leaves the name — "it is the geometry that is absent,
not the entry". A place with nothing left in it is `undefined` rather than a
`<#place>` node asserting nothing.

## No exact option, and what it would take

`PRECISION_GRIDS` offers 100 m, 1 km and 10 km, coarser than the owner's own
default and never finer, and there is no "exact". `fuzzForPublication` is §9's
total boundary — it is the one place the home region is checked — and it has no
exact mode, so an "exact" option could only be implemented by going around it,
which goes around the home-region drop as well.

**The open item, carried rather than closed by Stage B.** If exact is ever
wanted, the safe shape is `fuzzForPublication` accepting `dy:precisionMeters 0`
and keeping the home-region check, not the editor bypassing the function. Note
that this is not only a fuzz-layer change: `GeoPoint.precisionMeters` in
`lib/pod/schema.ts` is `.positive()`, and the docblock above `HomeRegion`
argues that a 0 m grid "snaps a coordinate to itself while announcing
`dy:precisionMeters 0`, i.e. 'this point is exact'" as a reason to refuse it. So
the option needs a decision recorded in §9 first, and both halves changed
together.

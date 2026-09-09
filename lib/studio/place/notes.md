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

## undefined is a removal on all four fields

That is the half that is easy to miss on an **edit**: the entry being edited may
already carry a `#geo` or a `schema:name`, and spreading the old place in and
merely failing to add a new value leaves the old one on a world-readable
resource — a leak, or a name the owner has deleted from the form and cannot
delete from their Pod, either way outliving the edit made to remove it.

`placeFor` therefore starts from `{ ...existing, ...text, geo }` and lets this
save's answer overwrite, `undefined` included. It is not a merge and must not
become one.

The four are removed independently, which is why the geometry and the text
arrive as separate arguments and are never folded into one flag. Clearing a name
must not take the coordinate with it, and §9's drop must not take the name: "it
is the geometry that is absent, not the entry." The spread of `existing` is also
what keeps a fifth field this form does not hold alive across a save.

**A key present with an `undefined` value is not content, and needs no delete
pass to say so.** `Object.values({ name: undefined }).some((v) => v !== undefined)`
is already `false`, so an emptied place is `undefined` rather than a bare
`<#place>` asserting nothing — a `schema:Place` asserting nothing is not a
place. `lib/pod/entry-model.ts` guards every field on truthiness or
`!== undefined` before it writes a triple, so the surviving keys produce no
triples either.

**The docblock here named a "copy-and-delete shape" until 2026-09-07 (F7), and
there is no delete.** The behaviour claimed was real, but the mechanism had been
removed as a no-op, and the comment inside the body said so in as many words —
so the two contradicted each other. Correct behaviour defended by a false reason
is the shape both halves of that pair were an instance of: the loop that stood
there had a comment claiming it did something, and its removal left a docblock
claiming it was still there.

## Empty box, trimmed, and the language it carries

`placeTextOf` is the one place `""` and `undefined` are translated between, and
it is a function rather than three ternaries inlined at the save because they are
different instructions on three fields. A spelling that got one of them wrong
would either publish `""@en` — an entry claiming to be somewhere called nothing
— or make a name impossible to retract once written.

**Trimmed, and nothing downstream would catch it if it were not.** `Place.name`
is `min(1)` and `" ".length === 1`, so
`Place.safeParse({ name: { value: " " } })` *succeeds* — measured, not assumed.
An untrimmed one-space box therefore publishes `schema:name " "@en` on a
world-readable resource: a name that renders as nothing everywhere, that no
reader can see to delete, and that a `value === ""` check does not find either.
Every guard between there and the Turtle asks "is it absent", and a space is not
absent. This is the guard.

**The language is the entry's own**, exactly as the headline and the body get
it, so an entry written in another language keeps its tag. `locality` and
`country` carry none here: the locality is tagged by `text()` at serialisation,
and the country is a **code** and is deliberately untagged — `"JP"@en` is a
different RDF term from `"JP"`, so every consumer filtering on the plain literal
would stop matching entries this studio wrote (§7.3).

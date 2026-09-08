# field — notes

Why the `<Field>` wrapper and the two class tokens sit in a folder of their own,
and what its test is for. The reasoning that belongs at the point of danger —
the `disabled:` variants, and what the arbitrary-value guardrail sees — stays
inline in `field.tsx` where someone editing a class string will read it.

## Why it is its own component

`Field` was at the bottom of `entry-editor.tsx` and is used by every control on
the form. Stage B's five field groups (`fields/identity-fields/` and its four
siblings) each render three to six of them, so it has to exist as an importable
module before any of them can be extracted — that ordering is Task 4's whole
reason for coming before Task 5.

No `"use client"` directive, and that is not an omission: `Field` holds no
state, no effect and no handler, so it inherits the boundary from whichever
client module imports it — `entry-editor.tsx` today. A directive here would add
a second client entry point for a component that needs none.

The extraction moved the definitions **verbatim**: same props, same markup, same
docblocks. Two claims travelled with them that were already stale on arrival and
were deliberately not repaired in an extraction commit — see
[What travelled here already wrong](#what-travelled-here-already-wrong).

## What this test pins

`Field` had never been tested on its own; every assertion about it was made
through the editor's form, sixteen controls at a time. Three facts the five field
groups will rely on, in the order they matter:

1. **The label names the control, not a wrapper.** `Field` renders
   `<label htmlFor={id}>` and the caller puts the same `id` on the control, so
   `getByLabelText` resolves to the control itself. `getAllByLabelText` has
   length one: the editor has already lost tests to a wrapper that answered to
   the same accessible name as the input inside it, which is why `entry-offset`'s
   docblock forbids an `aria-label` anywhere around it.

2. **The hint is at `${id}-hint`, and nothing else.** `Field` renders the hint
   paragraph with that derived id and does **not** put `aria-describedby` on the
   child. Every control names its own ids, by hand or through one of the editor's
   `*Help()` functions, and a control that names nothing announces nothing. That
   asymmetry is the design, not an oversight, and it is what makes the third
   fact possible at all.

3. **Two described ids compose; the second does not replace the first.** The
   editor's auto-fill notes depend on this. `occurredHelp()` returns
   `"entry-when-hint entry-when-source"` — the permanent hint plus, when a photo
   supplied the value, the note saying so. The note is rendered as a **sibling of
   the `Field`**, not as a child of it, so the test renders it that way too: if
   `Field` ever required the described element to be inside it, that fixture
   would be the thing that failed.

   The assertion is an exact string equality over both resolved texts rather
   than two `toContain` calls. A `Field` that dropped the hint, renamed the
   derived id, or rendered the note in place of the hint all produce a
   description a `toContain("photo")` would accept.

And one pin that is about something not being added:

4. **The hint carries no live-region role.** `TODO.md` records the cheap fix for
   the auto-fill being silent to a screen reader — `role="status"` on the note —
   and why it is deferred: it would make `getByRole("status")` ambiguous with the
   save-outcome region six tests depend on. Putting the role on `Field`'s hint
   would be that collision sixteen times over. The test renders a stand-in
   outcome region beside a `Field` with a hint and asserts `getByRole("status")`
   still resolves to exactly one element, which is the failure mode stated as an
   assertion rather than as a comment.

## The cases were shown to bite

The first run of this file failed on "Failed to resolve import ./field", which
proves the file runs and nothing else. So each case was probed against a mutated
`field.tsx` on 2026-09-08, one mutation at a time:

| Mutation | Red |
|---|---|
| `htmlFor={id}` removed from the label | 6 of 7 |
| hint id changed to `${id}-note` | the hint case and the composition case |
| `role="status"` added to the hint | the live-region case, alone |
| hint paragraph rendered unconditionally | the no-hint case, alone |

The first probe is also why the no-hint case matches the helper's own wording
rather than a bare `/entry-mode-hint/`: Testing Library prints the DOM in a
`getByLabelText` failure, that dump contains the string
`aria-describedby="entry-mode-hint"`, and the loose regex therefore passed on a
broken association. Measured, not reasoned — it passed under the first mutation
until the pattern was narrowed.

## Why not import the harness

`entry-editor.harness/` already has `describedTextOf`, and this test rebuilds
its idea in four lines instead of importing it. Two reasons:

- The harness is 88 kB that `vi.mock`s `@/lib/pod/access`, fixes the clock to
  `Asia/Tokyo`, seeds a privacy-settings handler for every render and pulls the
  whole editor's dependency graph in with it. A leaf component's test that needed
  all of that would be a test of the editor rig.
- Its signature is `describedTextOf(label: RegExp)` — it queries by label through
  `screen`. This file already holds the element, and needs to call the helper on
  an element that is *expected to throw*, which the label form cannot express.

The **idea** is what is reused, and it is the load-bearing half: resolve every
IDREF and assert each one exists *before* reading any text. An `aria-describedby`
naming an id nothing renders computes to the empty string, so a test that read
the description directly would report "no note" for a dangling association —
measured in the editor's 8e-bis section, and the reason that helper exists.

## What travelled here already wrong

Both are documentation, neither is behavioural, and both are left exactly as
they were found so that the extraction diff contains no rewritten prose.

1. **`CONTROL`'s docblock says the arbitrary-value guardrail cannot see these
   two constants.** It could not, until `eslint.config.mjs` grew three more arms
   on 2026-09-05 — `VariableDeclarator > Literal`, a `BinaryExpression` arm and a
   `TemplateLiteral` arm — specifically so that it could. Measured again at this
   new path on 2026-09-08 with a throwaway probe: `disabled:bg-[#222]` inside a
   `const` here produces one `no-restricted-syntax` error, and the same string
   inside a `+` concatenation produces a second. So the paragraph's "keep
   arbitrary values out of them by hand" now describes a fence that exists, and
   `test/guardrails.test.ts` holds both the reject and the allow cases for it.

2. **It cites `entry-editor.test.tsx`, which Task 2 split up.** The 8e-bis
   docblock it points at now lives in `entry-editor.draft-banner.test.tsx`.

3. **Two of its bearings are relative and no longer point at anything.** "the
   Save button's `aria-describedby`, above" and `BUTTON`'s "See CONTROL above"
   were written when all of this sat under 3,700 lines of editor. The second
   still resolves inside this file; the first does not — the Save button stayed
   behind in `entry-editor.tsx`. This one is a consequence of the move rather
   than something that arrived broken, and it is recorded here for the same
   reason: an extraction commit whose diff contains rewritten prose is one
   nobody can read as an extraction.

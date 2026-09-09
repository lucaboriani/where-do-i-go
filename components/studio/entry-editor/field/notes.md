# field — notes

Why the `<Field>` wrapper and the two class tokens sit in a folder of their own,
and what its test is for. The two warnings that belong at the point of danger —
what the arbitrary-value guardrail sees, and why the `disabled:` variants are
spelled out — are still shouted inline in `field.tsx`, where someone editing a
class string will read them; Stage C's comment sweep moved the measurements
behind them down here, on 2026-09-09.

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

## why the disabled variants are spelled out

`CONTROL` and `BUTTON` hold tokens from `app/globals.css` and no arbitrary
values: the fixed dark palette lives at `:root` and this screen stays plain
until phase 7.

**The arbitrary-value guardrail's reach.** `CONTROL`'s docblock said, and the
inline warning still says, that the guardrail does not see these two constants:
`eslint.config.mjs` banned `w-[137px]` and its kind with the selector
`JSXAttribute[name.name='className'] Literal[value=/…-\[…\]/]`, which matches a
string written INSIDE the attribute, and these are module consts spent as
`className={CONTROL}` — an Identifier, not a Literal. Measured with a throwaway
probe at the time: `disabled:bg-[#222]` in here produced zero errors and the
same string inline produced one. **That claim has since been overtaken** — see
[What travelled here already wrong](#what-travelled-here-already-wrong), item 1:
the rule grew three more arms on 2026-09-05 and both spellings are now reported.
The inline warning is kept because "keep arbitrary values out of these by hand"
is still the right instruction; only its reason has changed.

**Why `disabled:` has to be spelled out at all**, when every browser greys a
disabled control for free. It greys it by supplying its OWN background and text
colour, and this theme has already overridden both: `bg-surface` outranks the UA
background, and Tailwind's preflight sets `color: inherit` on form controls, so
the UA's disabled text colour never lands either. On a light default that would
still leave something visibly off; on a fixed dark palette it leaves nothing.

Measured in a real browser, against the local Community Solid Server, with a
draft seeded and the banner up — `getComputedStyle` on held and free controls
side by side:

```
headline (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
save     (held)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
restore  (free)  bg lab(6.67 -1.11 -4.74)  color lab(90.7 …)  opacity 1
```

Byte-identical. Seventeen controls that look perfectly editable while swallowing
every keystroke — a worse failure than an ugly one, because the owner's
conclusion is that the app is broken rather than that something is being asked
of them. The programmatic half of the same defect is the Save button's
`aria-describedby`, in `../entry-editor.tsx`.

**One variant covers all sixteen fields because `:disabled` is inherited in fact
if not in name**: a control inside a `<fieldset disabled>` is "actually
disabled" per HTML, so `:disabled` matches it without the attribute being on the
control. That is the same mechanism the hold itself relies on.

**Both overrides win on specificity, not on source order**, which is worth
knowing because source order is the thing a Tailwind upgrade may re-sort.
Compiled with this project's own Tailwind 4.3.3 and read out of the emitted
stylesheet:

```
.cursor-pointer                              0,1,0
.disabled\:cursor-not-allowed:disabled       0,2,0   wins
.hover\:bg-hairline:hover                    0,2,0
.disabled\:hover\:bg-surface:disabled:hover  0,3,0   wins
```

The hover override earns its place: `:hover` still matches a disabled button, so
without it the held Save button lights up under the pointer — a control that is
faded and inert and still reacts, which reads as pressable.

**None of this is tested, deliberately and on the record.** jsdom computes no
cascade, so the only assertion available is
`toHaveClass("disabled:opacity-60")`, which restates the string on the next line
and would pass against a variant that resolves to nothing, a token absent from
`@theme`, or a rule a later Tailwind outranks. The reasoning is in the 8e-bis
docblock, which item 2 of `#what-travelled-here-already-wrong` places in
`../entry-editor.draft-banner.test.tsx`; the pin there covers the half a
stylesheet cannot silently remove.

## why the disabled variants live on BUTTON and not on Save

`BUTTON` is the same plain button for Save, Restore and Discard. Shared so the
two draft controls cannot drift into looking like something other than the
buttons they are — which is also why the `disabled:` variants are on the shared
constant: Restore and Discard are never disabled, so these three utilities only
ever fire on Save, and putting them here is what stops the next button added
from shipping inert and looking live.

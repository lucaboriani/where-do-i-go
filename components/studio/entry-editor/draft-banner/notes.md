# draft-banner — notes

The unsaved-draft banner, extracted from `entry-editor.tsx` on 2026-09-09 as
Stage C's Task 7. A sixth presentational group by Stage B's Task 5 argument, and
the one block in the editor's 195 lines that qualified as one. No state moved.

## Props only

No `useState`, no `useRef`, no effect, and no `"use client"` directive — it
inherits the boundary from `entry-editor.tsx` for the reason `field/notes.md`
gives.

**Three named props, not a spread**: the offer, and one callback per answer. The
editor keeps the decisions the banner cannot make on its own — `restore(offered)`
knows `addressFixed`, `tripIris` and the gate's preset precision, and `discard`
knows the storage key. What travels here is one `Draft` and two thunks.

## What travelled, and what did not

Moved **verbatim**, docblocks included: `HOLD_REASON_ID`, `savedAtText`, and the
banner's whole `<section role="region" title="Unsaved draft">` subtree with its
four JSX comments. Behaviour is unchanged; the rendered markup is identical.

**`HOLD_REASON_ID` is now exported, and that is the one non-mechanical edit.**
The two ends of that association are in different files for the first time: this
component renders the element, and the editor's Save button names it through
`aria-describedby`. Exporting it keeps the property the constant existed for —
one spelling — where two literals in two files would be strictly worse than the
two literals thirty lines apart it originally replaced.

**`offered` is `Draft`, not `Draft | null`.** The editor asks whether there is an
offer at all, because the same answer holds the `<fieldset disabled>` and decides
whether the Save button carries a description. A banner that answered `null` with
`return null` would have that question asked in two places, and `savedAtText`'s
ruling 2.5-A shape — takes a `string`, stays that way — reads the same way one
level up.

`clearOffer` did not travel. `restore()` calls it after `form.restore`, and the
ordering there is the editor's: restoring once is what stops a second click
overwriting whatever was typed after the first.

## What this test pins

Rendered directly with props, never through the editor's harness
(`field/notes.md#why-not-import-the-harness`). The editor's own suites still
drive this banner end to end through `entry-editor.draft-banner.test.tsx` and
`entry-editor.draft-autosave.test.tsx`; those are about the offer arriving and
the hold biting, and stayed where they are.

1. **A region named by `title`, with the name absent from the label query.**
   Both halves of the measurement: `role` is explicit and `title` carries the
   name, and `queryAllByLabelText("Unsaved draft")` finds nothing. An
   `aria-label` here passes the first half and fails the second.
2. **The stamp as it was stamped**, text and `dateTime` both — the wall clock
   never shifted into the browser's zone, beside the full instant with its
   offset.
3. **Ruling 2.5-A from both ends.** With `savedAt` deleted the banner still
   mounts, no `<time>` renders, and the sentence has no comma trailing into
   nothing. Conditioning only the `<time>` tag passes the first two.
4. **The hold sentence renders on the exported id**, asserted through
   `document.getElementById(HOLD_REASON_ID)` rather than by text, which is the
   only spelling that catches the id and the element drifting apart.
5. **Each answer reaches its own callback, and tells the other nothing.**
6. **Neither button is a submit**, so neither can save the form it is holding.

---

# What the comment sweep moved here

Stage C's Task 6, and then Task 7's extraction. Each section is the block that
stood at the point its pointer now sits.

## savedAtText shows the wall clock as it was stamped

`2026-04-02T19:00:00+09:00` → `2026-04-02 at 19:00`. Never shifted into whatever
zone the browser is in now — the same rule `wallClockOf` follows and for the same
reason. The machine-readable instant is on the `<time dateTime>` beside it,
offset and all, which is what the offset requirement on `savedAt` exists for.

**It takes a `string`, not `string | undefined`, and stays that way** (task
2.5): `lib/studio/drafts.ts`'s `Draft.savedAt` became `.optional()`, but its one
caller only reaches it inside an `offered.savedAt !== undefined` check (ruling
2.5-A), so the absent case never arrives here at all rather than arriving and
being handled.

## the hold reason id is spelled once

`HOLD_REASON_ID` is one end of the association between the held Save button and
the sentence that explains the hold, spelled once because both ends have to
agree and neither of them says so when they stop agreeing.

An `aria-describedby` naming an id nothing renders computes to the empty string —
no error, no warning, nothing on screen different, and a screen reader back to
announcing "Save entry, button, unavailable" and no reason. That is the silent
way this breaks, so the id is a constant rather than two string literals thirty
lines apart.

## named by title, not by aria-label

The banner's name has to say "draft" — that is what tells the owner what this is
— and every ARIA naming mechanism puts the named element into
`@testing-library`'s `getByLabelText` results: it matches `aria-label` and
`aria-labelledby` on **any** element, not only on form controls. This screen
already has a control whose label matches the same words, the Status select, so
an `aria-label` here makes `getByLabelText(/status|draft/)` ambiguous and every
test that fills the form while the banner is up fails on "found multiple
elements" rather than on anything real. Measured with a throwaway probe:
`aria-label` yields two matches, `title` one.

`role="region"` is explicit for the same probe's other half — a bare `<section>`
named only by `title` is not given the region role, so it would be unfindable as
the landmark it is. The name still resolves from `title` in the accessible-name
computation, which is where a tooltip belongs in that algorithm.

## ruling 25-a the banner survives an absent savedAt

Task 2.5: the banner still appears when `savedAt` is absent; only the `<time>`
goes away. `lib/studio/drafts.ts` made the field `.optional()` for a payload
written by another build or hand-edited in devtools — never one this editor
wrote, since `nowWithOffset()` stamps every write site here — and such a payload
must not crash the mount effect that offers it back.

**The spelling chosen**: the whole ", from `<time>`…`</time>`" clause is
conditional on `offered.savedAt !== undefined`, not just the `<time>` tag, so
the sentence reads as a complete claim either way — "kept what you were writing
here" rather than a comma trailing into nothing. An empty `<time>` was rejected:
a `<time>` with no `dateTime` to point at is markup with nothing to say. An
invented timestamp was rejected too: it would tell the owner a moment that never
happened, which is worse than omitting the nicety this field is.

## the hold is said in the banner, not beside the button

The sentence above it explains the DRAFT and stops there — it kept your text,
the form is untouched — which accounts for the banner but not for the seventeen
controls underneath it going dead. Someone who reads only that sentence has been
told what happened and not what is now being withheld, and the fieldset does not
announce itself.

**It lives in the banner rather than next to the button, and the difference is
not layout.** The Save button names this element, so what a screen reader reads
out as the reason is this text and not a paraphrase of it: a second copy parked
beside the button is a text that drifts from the one it duplicates, and the copy
nobody edits is the copy the owner hears. Keeping it inside also makes the hold
explanation structural — it cannot outlive the offer, because it is rendered by
the same condition.


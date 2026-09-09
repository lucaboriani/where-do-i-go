# photo-fields — notes

The fourth of Stage B's five field groups: the picker and the per-slot rendering.
No state moved — the pipeline, `attach`, the uploads and the `slots` list itself
are all still the editor's.

## Props only

Two props, and that is the whole interface: `slots` and `onPicked`. No
`useState`, no `useRef`, no effect, and no `"use client"` directive — it inherits
the boundary from `entry-editor.tsx` for the reason `field/notes.md` gives.

**`onPicked` takes a LIST, not a file.** The input is `multiple` and the editor
starts every file at once — `for (const file of picked) void attach(file)`, now a
named `attachAll` in the editor's body — so a callback shaped `(file: File)`
would either drop files or invent a serialisation the pipeline already owns. The
one-call-per-pick shape is asserted, because a group reporting only `files[0]`
passes every single-file test there is and fails only §12m's two-photos-in-one-
pick case, which is a DOM test in `entry-editor.autodate-edges.test.tsx`.

**What stayed in this group's own `onChange`**, rather than moving to the editor:
the copy of `event.target.files` and the `event.target.value = ""` that clears
the input. Both are about the DOM element this group owns — clearing is what
makes picking the same file twice a second `change` event rather than silence —
and neither touches state.

## `PhotoSlot` lives here now

The type and its docblock moved with the markup that renders its four states,
and the editor imports it back as a type. It is the one type this extraction
moved, and the direction is deliberate: nothing outside the editor's folder
referenced it, and the four `state` values exist because the owner has to be able
to tell three waits apart from a failure — which is a rendering concern.

Task 6 puts `slots` inside `EntryFormState`, so this type will move again, to
`state/`. That is expected; it is not a reason to have left it in a 900-line file
in the meantime.

**One bearing went stale in the move**, recorded rather than repaired, per
`field/notes.md`'s precedent: `TimeAuthor`'s docblock in `entry-editor.tsx` says
"`PhotoSlot`'s docblock, further down this file, says a file name is not an
identity". The claim is still true and the docblock is still findable by name; it
is no longer in that file. `entry-editor.harness/` and
`entry-editor.autodate-edges.test.tsx` cite it by name only, so those two still
resolve.

## What this test pins

Rendered directly with props, never through the editor's harness
(`field/notes.md#why-not-import-the-harness`).

1. **The picker takes any image, several at once, and names itself once.**
   `getAllByLabelText("Photos")` has length one: no `aria-label` anywhere in this
   block, because a named wrapper around the input once cost the editor's suite
   six tests.
2. **Every file from one pick, in order, in a single call.** The failure this
   catches — reporting `files[0]` alone — is invisible to every other test here.
3. **The input is cleared**, proved by picking the same file twice and asserting
   two calls rather than by reading an attribute.
4. **An empty pick is an empty list**, not a throw: `event.target.files` is
   nullable and a `change` with nothing in it is reachable.
5. **Each of the four states, one case each.** `decoding` and `uploading` render
   a `status` and no image; `ready` renders the thumbnail FROM THE POD plus its
   status; `failed` renders an `alert` and NO status, which is the division the
   save outcome uses — `alert` interrupts a screen reader mid-sentence, and
   "uploading" has not earned that while a refusal has.
6. **The thumbnail falls back to the web derivative**, both branches, because
   `thumbnailUrl` is optional on `Photo`.
7. **One row per slot, keyed on the slot and not the name.** Two rows with the
   same file name render as two, which is what `PhotoSlot`'s docblock is about:
   two cameras both call their first photo `IMG_0001.jpg`.
8. **No named region around the list**, from both ends: one element answers to
   "Photos", and `queryByRole("region")` is null.

---

# What the comment sweep moved here

Stage C's Task 6. Each section is the block that stood at the point its pointer
now names; nothing was dropped, and the compression is in the wording only.

## the picker uploads as soon as something is picked

The hint says so, because it is a surprise worth telling the owner about: the
bytes are on the Pod before Save is pressed, and a photo attached to an entry
that is then abandoned stays in `travel/media/`.

`multiple`, and the pipeline serialises them one at a time — one worker, one
photo, because three 50 MP decodes in flight is how a phone's browser tab gets
killed in the middle of an edit.

**No `aria-label` anywhere in this block**, on the input or on anything around
it. `getByLabelText` matches `aria-label` on ANY element, and this group has
already cost the editor's suite six tests through a wrapper that shadowed a real
control. The `<label>` inside `Field` is the one name here.

The input is cleared in the group's own `onChange`, so picking the same file
again is another `change` rather than silence. The list is already a copy, and
`""` is the one value a file input's value may be set to.

## what each picked file is doing, announced structurally

`status` for progress and for a photo that settled, `alert` for one that failed
— the same division the save's outcome uses, and for the same reason: `alert` is
assertive and interrupts a screen reader mid-sentence, which "your photo is
uploading" has not earned, while a file that will never be attached is a
decision the owner has to make.

**A plain `<ul>`, with no named region around it.** A landmark would need a
name, and every ARIA naming mechanism except `title` lands in `getByLabelText`
next to the control above.

## the thumbnail comes from the Pod, and is a plain img

**From the Pod, not from `URL.createObjectURL`.** An object URL dies with the
page, so a draft restored tomorrow would show a broken image — and it is the URL
an implementation that saved before uploading would be tempted to write into the
entry.

**A plain `<img>`, not `next/image`**, and the `eslint-disable-next-line` beside
it is that decision rather than a silenced warning. The host is whatever Pod the
owner has, so `next/image` would need every one of them in
`images.remotePatterns` — configuration this project cannot write down and
cannot ask for, since a Pod root is an env var with a working default. It would
also put an optimiser in front of a resource that is already a 400 px derivative
this browser made itself, on a screen only the owner ever loads. The LCP the
rule is about belongs to the public pages, which never render this.

# classification-fields — notes

The last of Stage B's five field groups: what the entry is about, how the owner
arrived, and whether any of it is public. No state moved.

## Props only

Six named props. No `useState`, no `useRef`, no effect, and no `"use client"`
directive — it inherits the boundary from `entry-editor.tsx` for the reason
`field/notes.md` gives.

**The two selects parse here and hand back a term, not a raw string.** The
callbacks are typed `(mode: Mode | "") => void` and
`(status: EntryStatus) => void`, so the editor's wiring is `onModeChange={setMode}`
and `onStatusChange={setStatus}` with nothing in between. The group already
imports `TravelMode` and `Status` for their `.options`, so `safeParse` beside the
control it validates costs nothing and keeps an unvalidated string from ever
crossing the boundary.

**The two guards are deliberately asymmetric, and both travelled verbatim.**

- `mode` falls back: `chosen.success ? chosen.data : ""`. `""` is a real choice —
  "Not recorded" is an option, and an owner who picked a mode and changed their
  mind has to be able to unset it.
- `status` drops: `if (chosen.success) onStatusChange(chosen.data)`. There is no
  empty status to fall back to, and a fallback here would mean a value the schema
  refused could unpublish an entry. §7.4 makes the index the publication
  boundary and §5 pairs the status with the ACL, so this control is the one whose
  wrong value has consequences on the Pod rather than on the form.

## What this test pins

Rendered directly with props, never through the editor's harness
(`field/notes.md#why-not-import-the-harness`).

1. **Three controls named, typed and holding their values.**
2. **The tag text is reported exactly as typed**, spacing and trailing comma
   included: the parse into `dy:tag` tokens is `parseTags`' job in the editor,
   and a group that trimmed here would silently change what the draft carries.
3. **Both option lists in full, in order.** The modes as text; the statuses as
   `[value, text]` pairs, because the two differ — `draft`/`Draft` — and a group
   that used the label as the value would pass a text-only assertion and write a
   term the schema refuses.
4. **Both guards, driven through the DOM rather than asserted as code.** The mode
   case selects "Not recorded" and expects `""`. The status case sets a value no
   option carries, which a `<select>` reads back as `""` — so `Status.safeParse`
   refuses it and the assertion is that **nothing** was reported. That is the one
   place the asymmetry above is observable, and without it `mode`'s spelling
   would satisfy both.

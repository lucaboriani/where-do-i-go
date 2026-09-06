# Place and Date Entry (Stage 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner set a place and a time by hand, then let a photo's EXIF *prefill* those controls without ever overwriting what the owner typed.

**Architecture:** The manual controls are the substrate; auto-fill is a convenience layered on top. That ordering is not a preference — you cannot prefill a control that does not exist, and two of them do not. Everything lands in `components/studio/entry-editor.tsx` and `lib/studio/drafts.ts`; the RDF side already exists.

**Tech Stack:** TypeScript, Next 16.3.4 App Router, React 19.2.8, `zod@4.5.4`, Vitest 4.1.11 + Testing Library, Playwright 1.62.1.

**Spec:** `docs/superpowers/specs/2026-09-06-media-pipeline-design.md` §11. Read it before Task 1. Stage 1 merged as `6adf834`.

## Global Constraints

- **Select Node 22 first.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`, then `node -v` must print `v22.x`. `npm run` is not gated by `engine-strict`.
- **Run every check agent-free:** `env -u CLAUDECODE -u AI_AGENT <command>`. `CLAUDECODE=1` makes vitest suppress ANSI and has hidden a real failure here.
- **Start the Pod before `npm test`.** `npm run pod:dev`. Without it the integration tests skip and the run still reports green.
- **`npm run typecheck` before every commit.** Vitest transpiles with esbuild and type-checks nothing; on stage 1 eight real compile errors rode a fully green suite through three separate checks.
- **This diff touches `components/studio/**`, so `npm run test:e2e` must pass** — see the path gate in `CLAUDE.md`.
- All IRIs from `lib/vocab.ts`; no predicate literals elsewhere. No blank nodes.
- **`xsd:dateTime` always carries a UTC offset.** That is the whole subject of Task 2.
- **Language-tag human-readable literals.** `schema:name` and `schema:addressLocality` are language-tagged; `schema:addressCountry` is a plain literal (it is a code, not prose) — `lib/pod/entry-model.ts:125-139` already does this correctly. Do not change it.
- **Coordinates are fuzzed before the write, always.** `fuzzForPublication` is the only thing that checks the home region; nothing may bypass it, including a photo's GPS.
- Arbitrary Tailwind values are banned outside `components/ui/**`.
- The `dy:` namespace is still `example.org` — **nothing may be written to a live Pod.** Local CSS is disposable.

## A warning about this plan's code, learned from stage 1

**Stage 1's plan contained test code that did not compile against the real harness**, because it invented `renderEditor({ pipeline, fetch })`, `saved()`, `draftKey()` and `entryWithPhotos(n)` — none of which exist. `test/entry-editor.test.tsx` is now over 300 kB with its own helpers: `podFake(script)`, `fakeStudioSession(webId)`, `renderEditor(session, { initial, pipeline, podRoot })`, `fakeStorage`, `draftKeyFor`, `NEW_SCOPE`, `fillNewEntry`, `setText`/`setChoice`/`LABEL`, `saveButton`, `clickSaveAndWait`, `specEntry`, `quadsOf`/`oneObject`/`objectsOf`, `indexRowOf`, `pickPhoto`, `jpegFile`.

**So this plan specifies behaviour and assertions, not test source.** Where it shows code, that code is either quoted from the repository or verified against it. **Read the harness and write the tests in its idiom.** If a scenario cannot be expressed against it, say so rather than inventing a helper.

Production code snippets below ARE quoted from the current file and are safe to build on.

## File Structure

**Modified**

| File | Change |
|---|---|
| `components/studio/entry-editor.tsx` | three place inputs, an offset select, owner-touch tracking, auto-fill, per-field notices |
| `lib/studio/drafts.ts` | `Draft` gains `placeName`, `locality`, `country`, `offset` |
| `test/entry-editor.test.tsx` | every scenario below; `DRAFT_FIELDS` grows from thirteen to seventeen |
| `test/drafts.test.ts` | the four new draft fields, and that a pre-stage-2 payload still restores |
| `e2e/media-pipeline.spec.ts` | one case: a photo with GPS prefills the coordinate in a real browser |
| `TODO.md` | tick stage 2; record what is deliberately open |

**Not modified, and worth knowing why:** `lib/pod/entry-model.ts` already serialises `schema:name`, `schema:addressLocality` and `schema:addressCountry` (lines 125-139); `lib/pod/read.ts` already parses them; `lib/pod/schema.ts`'s `Place` already has `name`, `locality`, `country`. The RDF contract needs nothing. `lib/pod/fuzz.ts` is not touched — auto-place feeds it, it does not change.

---

## Task 1: The editor can name a place

Today `Place.name`, `.locality` and `.country` are read, serialised and carried through an edit — and **nothing in the studio can set any of them.** §9 leans on this: inside the home radius the coordinate is dropped and "the place keeps its name", and it has no name to keep, so an entry near home is placeless.

**Files:** `components/studio/entry-editor.tsx`, `lib/studio/drafts.ts`, `test/entry-editor.test.tsx`, `test/drafts.test.ts`

**Interfaces produced:** three controls with accessible names matching `/place name/i`, `/locality|town|city/i`, `/country/i`; `Draft` gains `placeName`, `locality`, `country` (all `z.string()`, matching how the other form fields are stored as raw strings).

- [ ] **Step 1: Write the failing tests**

Scenarios, all against the real harness:

1. **A place name reaches the Pod.** Type a name, save, and assert the outgoing Turtle carries `schema:name` on `<#place>` with an `@en` language tag. Use `quadsOf`/`oneObject` as the coordinate tests do.
2. **A named place with no coordinate is valid, and is what §9 wants near home.** Type only a name — no latitude or longitude — save, and assert `<#place>` exists with `schema:name` and **no** `<#geo>`. This is the scenario the whole task exists for.
3. **Locality and country reach `<#address>`.** Assert `schema:addressLocality` is language-tagged and `schema:addressCountry` is a **plain literal**. `lib/pod/entry-model.ts:134,139` already makes that distinction; the test pins it from the editor's side.
4. **An edit that touches no place field carries the existing place through untouched** — the same rule `touchedCoordinate` already implements for geometry. Load an entry with a name, change only the headline, save, assert the name survives.
5. **Clearing a name deliberately removes it**, rather than being read as "left alone". This is the distinction `placeFor` already draws for geometry, and it needs the same care: an empty string means "remove", `undefined` means "untouched".
6. **The three fields round-trip through the autosaved draft**, asserting the invariant (a usable draft) rather than bytes.

- [ ] **Step 2: Run them and read the failures**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" && node -v
env -u CLAUDECODE -u AI_AGENT npx vitest run test/entry-editor.test.tsx test/drafts.test.ts
env -u CLAUDECODE -u AI_AGENT npm run typecheck
```

Expect failures on the missing labels, plus `DRAFT_FIELDS` mismatches once you add the draft fields. Read both.

- [ ] **Step 3: Extend the draft schema**

`lib/studio/drafts.ts`'s `Draft` gains `placeName`, `locality`, `country` as `z.string()`. **Do not bump `wig.draft.v2` to v3.** The bar that file sets for a bump is whether a stale payload would "restore nine controls and leave three showing whatever the editor's own defaults left there". A v2 payload has no place fields, so they restore empty — which is the truth, not a misleading default. The same reasoning kept the key unmoved when `photos` was added in stage 1.

`DRAFT_FIELDS` in `test/entry-editor.test.tsx` is exhaustive and asserted in five places; update it.

- [ ] **Step 4: Extend `placeFor` and the save path**

`placeFor` currently composes geometry only:

```ts
function placeFor(existing: EntryPlace | undefined, geo: EntryPlace["geo"]): EntryPlace | undefined {
  if (geo !== undefined) return { ...existing, geo };
  if (existing === undefined) return undefined;
  const rest: EntryPlace = { ...existing };
  delete rest.geo;
  return Object.values(rest).some((value) => value !== undefined) ? rest : undefined;
}
```

Extend it to compose the three text fields on the same three-outcome logic the save path already documents — untouched / replaced / removed. **Keep its existing comment's intent**: "a `Place` that grows one must not lose it every time a coordinate is dropped" is exactly why the copy-and-delete shape is there, and it now cuts both ways.

`touchedCoordinate` at line 1669 stays as it is. Add the equivalent for the text fields; do not fold them into one flag, because a coordinate and a name are removed independently.

- [ ] **Step 5: Add the three inputs**

Follow the `Field` + `CONTROL` pattern the other eleven use. Put them beside the coordinate fields, since they are one subject. **Do not put an `aria-label` on a wrapping region** — `queryAllByLabelText` matches it on any element, and doing that once made six tests in this file fail with "found multiple elements".

Say in the hint what §9 makes true: a place name survives when the coordinate is dropped near home. That is the one thing about this control a reader cannot infer.

- [ ] **Step 6: Run and mutation-check**

Both suites plus `typecheck` and `lint`. Then, each applied, watched red, reverted:

1. Make `placeFor` ignore the name when a coordinate is present → scenario 1 or 3 must fail.
2. Make an empty name read as "untouched" rather than "remove" → scenario 5 must fail.
3. Drop the carry-through of an existing name → scenario 4 must fail.
4. Language-tag `addressCountry` → scenario 3 must fail.

- [ ] **Step 7: Commit**

```bash
git add components/studio/entry-editor.tsx lib/studio/drafts.ts test/entry-editor.test.tsx test/drafts.test.ts
git commit -m "The studio can name a place, so §9 has a name to keep"
```

---

## Task 2: The owner can correct the UTC offset

`dy:occurredAt` "carries the local UTC offset of the place" (§7.3), because "normalising to UTC destroys the fact that it was evening, which for a travel diary is most of the meaning". Today the offset is `storedOffset ?? offsetHere(wall)` — the entry's own, else **the editing machine's**. Writing up a Japan trip from home stamps `+02:00` on an evening in Tokyo, silently, with no control to correct it.

**Files:** `components/studio/entry-editor.tsx`, `lib/studio/drafts.ts`, `test/entry-editor.test.tsx`, `test/drafts.test.ts`

**Interfaces produced:** a `<select>` with an accessible name matching `/offset|time zone/i`; `Draft` gains `offset` (`z.string()`).

- [ ] **Step 1: Write the failing tests**

1. **The offset control defaults to the entry's stored offset when editing.** Load an entry whose `dy:occurredAt` ends `+09:00`; the control reads `+09:00`. This is today's behaviour made visible, and it must not regress.
2. **It defaults to the machine's zone on a new entry** — today's `offsetHere` path, now shown rather than assumed.
3. **Choosing an offset changes what is written.** Set the wall clock and pick `+09:00`; assert the outgoing `dy:occurredAt` ends `+09:00`, with the **wall clock unchanged**. The wall clock is copied, never recomputed — `toOffsetDateTime`'s docblock explains why, and this test pins it.
4. **The offset survives a round trip through the draft.**
5. **A half-hour and a three-quarter-hour offset both work.** `+05:30` and `+05:45` — India and Nepal. This is the assertion that would have caught an hours-only stepper.
6. **Changing the offset alone marks the form dirty**, so autosave arms. Stage 1 had a bug of exactly this shape, where a state change armed nothing because only a DOM `change` event set `touched`.

- [ ] **Step 2: Run them and read the failures**

- [ ] **Step 3: Add the offset list and the control**

The offsets actually in use, as a module constant:

```
-12:00 -11:00 -10:00 -09:30 -09:00 -08:00 -07:00 -06:00 -05:00 -04:00 -03:30
-03:00 -02:00 -01:00 +00:00 +01:00 +02:00 +03:00 +03:30 +04:00 +04:30 +05:00
+05:30 +05:45 +06:00 +06:30 +07:00 +08:00 +08:45 +09:00 +09:30 +10:00 +10:30
+11:00 +12:00 +12:45 +13:00 +14:00
```

Thirty-eight, and the odd ones are the point: `+05:45` is Nepal, `+08:45` is Eucla, `+12:45` is the Chathams. A list of whole hours would make those places unwritable, which for a travel diary is the wrong corner to cut.

Follow the `Precision` select's shape (`entry-editor.tsx:2059`) — it is the established pattern here, including how it handles a value matching no option. **A stored offset outside this list must still render rather than blanking the control**, exactly as `Precision` handles an unavailable value: an entry written by another tool with, say, `+05:15` must not silently become something else.

- [ ] **Step 4: Wire it through `toOffsetDateTime`**

Currently:

```ts
function toOffsetDateTime(local: string, storedOffset: string | undefined): string | undefined {
  const parts = LOCAL_DATETIME.exec(local);
  if (!parts) return undefined;
  const wall = `${parts[1]}T${parts[2]}${parts[3] ?? ":00"}`;
  return `${wall}${storedOffset ?? offsetHere(wall)}`;
}
```

The chosen offset replaces `storedOffset` as the value passed in. **Keep the fallback chain intact** — the control's initial value is `offsetOf(existing?.occurredAt) ?? offsetHere(wall)`, which is precisely today's logic, now surfaced. The function's docblock explains that the wall clock is copied rather than recomputed; that reasoning is unchanged and the comment stays.

- [ ] **Step 5: Run and mutation-check**

1. Ignore the chosen offset and use `offsetHere` → scenario 3 must fail.
2. Recompute the wall clock from the offset → scenario 3's "wall clock unchanged" half must fail.
3. Drop `+05:45` from the list → scenario 5 must fail.
4. Remove whatever arms the dirty flag → scenario 6 must fail.

- [ ] **Step 6: Commit**

```bash
git commit -m "The offset is a control, not the editing machine's guess"
```

---

## Task 3: Auto-fill that never overwrites, and says where a value came from

Stage 1 left the seam ready. `entry-editor.tsx:1135` reads:

> `derived.metadata` is deliberately unused for now

This task uses it.

**The rule, which the tests must pin directly** (§11.3):

> Auto-fill only ever writes into a control the owner has not touched. A photo added after a manual edit never overwrites it, and adding a photo is never the only way to reach a value.

**And its other direction, which §11.3 names explicitly:** a second photo must not quietly replace the first photo's coordinate. **So the first photo carrying a value wins, and neither the owner's typing nor an earlier photo is ever overwritten.**

**Files:** `components/studio/entry-editor.tsx`, `test/entry-editor.test.tsx`

**Interfaces produced:** per-field provenance notes; owner-touch tracking distinct from "is non-empty".

- [ ] **Step 1: Write the failing tests**

1. **A photo with GPS prefills latitude and longitude**, and the values are the photo's, to the precision `exifreader` returned.
2. **A photo never overwrites a coordinate the owner typed.** Type a latitude, then pick a photo with different GPS; the typed value stands.
3. **A second photo never overwrites the first photo's coordinate.** This is the direction §11.3 warns about and it is easy to get wrong.
4. **A photo with no GPS changes nothing** — the common case for screenshots and scans, and it must not clear anything.
5. **The auto-filled coordinate still goes through `fuzzForPublication`.** Assert the outgoing Turtle carries the *snapped* value, not the photo's raw GPS — and that a photo taken inside the home region publishes **no geometry at all**. §9 step 2: dropped, not coarsened. **This is the most important assertion in the task.**
6. **Each auto-filled field says which photo it came from**, by file name, and the note goes away once the owner edits that field.
7. **A photo is never the only way to reach a value** — with auto-fill having filled a field, the owner can still type over it.

- [ ] **Step 2: Run them and read the failures**

- [ ] **Step 3: Add owner-touch tracking**

**Do not change what `touchedCoordinate` means.** It is `lat.trim() !== "" || long.trim() !== ""` and it decides whether a coordinate is written at all — an auto-filled coordinate *should* be written, so that stays true. What is needed is a **separate** record of which fields the owner has typed into, used only to decide whether auto-fill may write.

Keep it explicit rather than inferring it from emptiness. A field can be non-empty because the owner typed, because a photo filled it, or because an entry was loaded — and only the first forbids auto-fill.

- [ ] **Step 4: Wire `derived.metadata` to the coordinate**

In `attach`, when a photo reaches `ready` and carries `metadata.gps`, fill latitude and longitude **if and only if** neither the owner nor an earlier photo has supplied them. Record the source file name for the note.

**Feed the form, not the write path.** The inputs hold the precise coordinate, exactly as manual entry does, and `fuzzForPublication` runs at save as it already does. This keeps one path to the Pod rather than two, and §9's guarantee comes from the save path being the only route. The draft holding a precise coordinate is already settled — `lib/studio/drafts.ts` explains that `localStorage` is not a resource and never leaves the browser.

- [ ] **Step 5: Add the per-field notes**

Under each auto-filled control, a short line naming the source photo, which disappears when the owner edits that field. Use `aria-describedby` to associate it, following `coordinateHelp`'s existing pattern in this file — do **not** add an `aria-label` to a wrapper.

- [ ] **Step 6: Run and mutation-check**

1. Let a photo overwrite a typed value → scenario 2 must fail.
2. Let a second photo overwrite the first's → scenario 3 must fail.
3. Bypass `fuzzForPublication` for photo GPS → scenario 5 must fail. **If this does not go red, the test is not checking the thing** — it is the assertion the whole §9 contract rests on.
4. Keep the note after the owner edits → scenario 6 must fail.

- [ ] **Step 7: Commit**

```bash
git commit -m "A photo can offer a coordinate; it can never take one away"
```

---

## Task 4: Auto-date, with an offset the owner can see is a guess

`DateTimeOriginal` has **no** timezone offset — measured, and the reason §11.5 exists. `dy:occurredAt` requires one. Task 2 built the control; this fills it honestly.

**Files:** `components/studio/entry-editor.tsx`, `test/entry-editor.test.tsx`

- [ ] **Step 1: Write the failing tests**

1. **A photo prefills the wall clock from `DateTimeOriginal`** — the time at the place, which is what the field means.
2. **`OffsetTimeOriginal`, when present, sets the offset.** Modern phones write it.
3. **When it is absent, the offset falls back to the machine's zone and is marked unconfirmed** — and the note says so in terms the owner can act on, naming the photo and the fact that the offset is not from it.
4. **The offset note goes away once the owner chooses an offset.**
5. **A photo never overwrites a wall clock or an offset the owner set** — Task 3's rule, applied to this field.
6. **A photo with a date but no GPS fills the time and not the coordinate**, and vice versa. The two are independent, and a photo may carry either.

- [ ] **Step 2: Run them and read the failures**

- [ ] **Step 3: Implement**

`exif.ts` returns `dateTimeOriginal` as `"YYYY-MM-DDTHH:mm:ss"` with no offset, and `offsetTimeOriginal` as `"+09:00"` when the tag was present. The wall-clock control takes the former; the offset control takes the latter when it exists.

**The unconfirmed state must be visible, not merely internal.** §11.5's whole argument is that prefilling a wall clock and silently stamping the wrong zone "is worse than not auto-dating at all, because it looks right". The owner sees `21:38 +02:00` and must be told the `+02:00` is this machine's, not the photo's.

Mark it structurally, not by wording alone — a test fenced only by its own phrasing has passed over a shipped bug in this project before.

- [ ] **Step 4: Run and mutation-check**

1. Append `Z` or the machine's offset to `dateTimeOriginal` inside `exif.ts`'s consumer → scenario 1 or 3 must fail.
2. Treat a missing `OffsetTimeOriginal` as confirmed → scenario 3 must fail.
3. Let a photo overwrite a chosen offset → scenario 5 must fail.

- [ ] **Step 5: Commit**

```bash
git commit -m "Auto-date offers the time and admits the offset is a guess"
```

---

## Task 5: The browser leg, definition of done, and the write-up

**Files:** `e2e/media-pipeline.spec.ts`, `TODO.md`

- [ ] **Step 1: Add one e2e case**

A photo with GPS, through the real editor in a real browser, prefilling the coordinate. The vitest tests drive a fake pipeline; this is the only place the real worker's `metadata` reaches the real editor. Reuse `spliceExif` and the existing `signInAsOwner`.

Keep it to one case. The rule about not duplicating a fast test in a slow one still holds — what this adds is the seam, not the logic.

- [ ] **Step 2: Run the full definition of done, and read every result**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" && node -v
npm run pod:dev &     # FIRST

env -u CLAUDECODE -u AI_AGENT npm test              # must report 0 skipped
env -u CLAUDECODE -u AI_AGENT npm run lint
env -u CLAUDECODE -u AI_AGENT npm run typecheck
env -u CLAUDECODE -u AI_AGENT npm run validate:fixtures
env -u CLAUDECODE -u AI_AGENT npm run check:vocab
env -u CLAUDECODE -u AI_AGENT npm run check:commands
env -u CLAUDECODE -u AI_AGENT npm run build
env -u CLAUDECODE -u AI_AGENT npm run size:public
env -u CLAUDECODE -u AI_AGENT npm run test:e2e      # gated: touches components/studio/**
```

- [ ] **Step 3: Write up `TODO.md`**

Tick stage 2. Record what was found by measurement and what stays open, in the style of the entries above it. At minimum: that the editor could not name a place at all before this, and that §9 depended on it; that the offset was silently the editing machine's; that auto-fill is first-writer-wins in both directions; and anything a mutation revealed.

- [ ] **Step 4: Commit**

---

## Self-Review

**Spec coverage.** §11.1's two gaps → Tasks 1 and 2. §11.2's controls → Tasks 1 and 2. §11.3's rule → Task 3, both directions. §11.4 auto-place → Task 3, with the fuzzing assertion as its most important test. §11.5 auto-date → Task 4. The e2e seam → Task 5.

**Placeholders.** None. Task 1 Steps 4-5 and Task 3 Step 3 describe shapes rather than quoting code, deliberately: the surrounding functions are quoted where they exist today, and the instruction is to extend them in place rather than to paste something that will not compile — which is the specific way stage 1's plan failed.

**Type consistency.** `Draft` gains four `z.string()` fields across Tasks 1 and 2, taking `DRAFT_FIELDS` from thirteen to seventeen; both tasks update it, and Task 2 will see Task 1's change already in place. `PhotoMetadata`'s `gps`, `dateTimeOriginal` and `offsetTimeOriginal` are consumed in Tasks 3 and 4 exactly as `lib/media/exif.ts` defines them.

**One thing this plan cannot promise.** Task 3's scenario 5 — that an auto-filled coordinate inside the home region publishes no geometry — depends on `readPrivacySettings` returning usable settings in the test harness. If the existing coordinate tests fake that, follow them; if they do not, that scenario may need a fixture the harness does not have yet. Say so rather than weakening the assertion.

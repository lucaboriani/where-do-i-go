# Code Structure Stage B — `EntryEditor` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a 941-line component with 27 `useState`, 10 `useRef` and ~990 lines of JSX in one `return` into a ~120-line component composing five field groups, five hooks and one reducer — without changing a single rendered behaviour.

**Architecture:** Test first, in the strict sense: the one invariant no existing test can see gets a failing test before anything moves. Then the 6,514-line test file splits along its own numbered sections, so every later step has fast, targeted feedback. Then extraction in order of rising risk — pure helpers, the shared `<Field>`, presentational field groups, the hooks, and last the reducer, which is the only step that can change behaviour.

**Tech Stack:** Node 22.23.2, React 19 under Next 16 App Router, TypeScript, Vitest + Testing Library (jsdom), Playwright for the two flows that cannot be tested faster.

**Spec:** `docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md` — §5 is this stage's design and §5's second half is the constraint that decides whether this is a fix or a regression.

## Global Constraints

- **Node 22.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`, then `node -v` must print `v22.x`. Everything here passes on Node 20 too, so checking is a step you take rather than one the tooling takes for you.
- **Take the test count from HEAD, never from this plan.** It was **1060 passed / 2 todo / 0 skipped / 31 files** at `bb81c36`; **1063 / 2 / 0 / 31** once Task 1 landed; **1063 / 2 / 0 / 43** once Task 2 split the file; **1130 / 2 / 0 / 45** at Task 3 (`0438230`); **1137 / 2 / 0 / 46** once Task 4 landed; **1197 / 2 / 0 / 51** once Task 5's five groups did. Run `npm test` before you touch anything and compare against that.
- **`npm run pod:dev &` before `npm test`**, or the two integration suites skip themselves and the run is green having never executed them. Prove they ran: `npx vitest run test/integration/` must report 33 passed, and `TEST_POD=http://localhost:3999 npx vitest run test/integration/` must report 33 skipped. That control is how this stage knows a green run was not an empty one.
- **`npm run size:public` does not build.** Run `npm run build` first or it grades a stale `.next`.
- **Every task in this stage touches `components/studio/**`, so `npm run test:e2e` is required on every task.** Run it with `env -u CLAUDECODE -u AI_AGENT npm run test:e2e`. Expect 6 passed. **A `next dev` already on port 3000 makes it refuse to start** — `reuseExistingServer: false`, deliberately, so it cannot run against someone else's `.env.local`. Do not kill the dev server: `E2E_PORT=3007 env -u CLAUDECODE -u AI_AGENT npm run test:e2e`, measured on Task 4 with the dev server up.
- **`npm run lint` carries `--max-warnings 0`.** `reportUnusedDisableDirectives` is active, so the moment a decomposed function drops under its bound, its `eslint-disable` becomes an unused directive and **fails the build**. That is the designed removal signal, not a surprise: delete the exemption in the same commit that shortens the function.
- **`npm run check:structure` must stay green.** Its comment ratchet is at **788** and fails when the count rises. Splitting a file does not create comment blocks, but *adding* prose does. If it rises, shorten the prose or move it to a `notes.md` — do not raise the baseline.
  **The trap Task 4 hit, and Task 5 hits five times:** `// @vitest-environment jsdom` on line 1 is a comment token, and a docblock starting on line 2 is the *same run* — a blank line resets a run, a new comment does not. So a five-line docblock under that directive is a six-line run and a six-line docblock is seven, which fails. Every new `.test.tsx` in this stage starts with that directive, so its header docblock has **four lines of prose at most**, delimiters included in the count. The failure names no file; bisect your own new prose.
- **`components/studio/entry-editor/` holds `.tsx` components in their own folders, and flat `.ts` modules under `state/` and `hooks/`.** That asymmetry is deliberate and written into `CLAUDE.md`; the folder rule binds `.tsx` only.
- The `dy:` namespace is still `https://example.org/ns/traveldiary#`. Nothing in this stage writes to any live Pod.

## File Structure

| File | Responsibility |
|---|---|
| `components/studio/entry-editor/entry-editor.tsx` | composition and page layout only, ~120 lines when the stage ends |
| `entry-editor.harness/entry-editor.harness.tsx` + `index.ts` + `notes.md` | the fake Pod, fake session, fake storage, loader, form plumbing and lifecycle every split test file needs. A FOLDER, not a flat file — see Task 2 |
| `entry-editor.<topic>.test.tsx` × 13 | the split suites, one per numbered section of the original |
| `state/actions.ts` | the action union — the catalogue of legal transitions |
| `state/entry-form-reducer.ts` | a thin switch over the `apply-*` functions |
| `state/apply-field-edit.ts` · `apply-photo-offer.ts` · `apply-restore.ts` | one transition each, pure, each with its own colocated test |
| `state/notes.md` | why the guard is inside the transition |
| `hooks/use-entry-form.ts` | the `useReducer` wrapper the field groups consume |
| `hooks/use-entry-save.ts` · `use-entry-draft.ts` · `use-settings-gate.ts` · `use-photo-pipeline.ts` | the seven remaining `useState` values, grouped |
| `fields/identity-fields/` · `when-fields/` · `where-fields/` · `photo-fields/` · `classification-fields/` | five presentational groups, each a folder with a named `.tsx`, an `index.ts` and a test |
| `field/field.tsx` | the shared `<Field>` wrapper and the `CONTROL` / `BUTTON` class tokens |
| `lib/studio/time/` · `lib/studio/place/` | pure domain helpers, no React — phase 4's timeline wants the offset arithmetic |

---

### Task 1: The failing test the suite cannot currently express

**This task comes first and nothing may be extracted before it is green.** It is the whole reason the stage has an order.

`offerTimestamp` reads `occurredAuthor.current` and `offsetAuthor.current` **synchronously** at `components/studio/entry-editor/entry-editor.tsx:1992-1993`, inside `attach`'s continuation — after a decode and two PUTs. The picker is `multiple` and starts every file at once: `for (const file of picked) void attach(file)` at `:3726`. `lib/media/pipeline.ts` serialises the *decodes* (`queue = result.catch(…)`), but photo 2's continuation resumes as a microtask and React batches updates across those. What makes first-writer-wins correct today is that photo 1 has already written the ref before photo 2 reads it, with no re-render in between.

**No test in the 6,514 lines picks two files in one `change` event.** `pickAndSettle` picks one; the sections that exercise two photos call it twice in sequence, so React has fully re-rendered between them. So the suite cannot distinguish a reducer that keeps the guard inside its transition from one that reads stale state and republishes the "timestamp that happened nowhere" defect.

**Files:**
- Modify: `components/studio/entry-editor/entry-editor.test.tsx` — add section 12j at the end
- No production file changes in this task

**Interfaces:**
- Consumes: `renderEditor`, `podFake`, `fakeStudioSession` and the photo fixtures already in that file. Read the existing `pickAndSettle` before writing — reuse its fixture construction rather than inventing a second one.
- Produces: the case every later task must keep green, and the one Task 6 is allowed to be judged by.

- [ ] **Step 1: Read `pickAndSettle` and the section 11/12 fixtures**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
grep -n 'pickAndSettle\|function pick\|dateTimeOriginal\|gpsLatitude' components/studio/entry-editor/entry-editor.test.tsx | head -30
```

You need: how a photo `File` with chosen EXIF is built, how the picker's `change` event is fired, and how the test waits for the two PUTs. Do not guess at these — they are load-bearing and already correct.

- [ ] **Step 2: Write the failing test**

Append a section 12j. The helpers it uses all exist in the file: `exifJpeg`, `mediaFake`,
`renderEditor`, `screen`, `waitFor`, `alt`, and the `EXIF_WHEN` / `SECOND_WHEN` constants. Two
things it must **not** reuse: `pickPhoto`, which fires a `change` with a single-element `files`
array, and `pickAndSettle`, which awaits one photo's `<img>` before the next is picked — that
awaiting is precisely what this case must not do.

```tsx
/* ══════════════════════════════════════════════════════════════════════════
 * 12j. TWO PHOTOS IN ONE PICK, WITH NO RENDER BETWEEN THEM.
 *
 * Every other two-photo case in this file settles one photo, lets React
 * re-render, then picks the next — because `pickAndSettle` awaits the `<img>`.
 * That is not what the picker does: it is `multiple` and runs
 * `for (const file of picked) void attach(file)`, so both continuations resume
 * as microtasks in one batch.
 *
 * What makes first-writer-wins hold there is a REF read synchronously
 * (`occurredAuthor.current`), not state read after a render. A reducer that
 * reads its own state from a hook's return value and dispatches a plain set
 * would see `nobody` twice and fill twice — republishing §11.5's instant that
 * happened nowhere. See ./state/notes.md#guard-inside-the-transition
 *
 * BOTH CASES ARE EXPECTED TO PASS TODAY. This is the one place in this
 * repository where that is the right outcome: the test exists to fail against
 * a future wrong implementation, and Step 4 proves it can by breaking the ref
 * reads and watching the first case go red.
 * ══════════════════════════════════════════════════════════════════════════ */

/** Both files in ONE change event, the way the picker delivers a multi-select. */
function pickBoth(files: readonly File[]) {
  const input = screen.getByLabelText(PHOTOS_LABEL);
  fireEvent.change(input, { target: { files } });
}

/** Both uploads finished: two PUTs per photo, so four. No per-photo await. */
async function settleBoth(media: ReturnType<typeof mediaFake>) {
  await waitFor(() => expect(media.puts).toHaveLength(4), { timeout: 5000 });
}

describe("entry editor — two photos picked at once", () => {
  it("credits the clock to the first photo only, with no render between them", async () => {
    const media = mediaFake();
    await renderEditor({ media });
    fillNewEntry();

    // Two phones, two different wall clocks. `TIMED` is EXIF_WHEN;
    // `TIMED_WITH_OTHER_OFFSET` is SECOND_WHEN with +12:45 — the file's
    // established second-phone fixture, chosen because neither of its tags
    // matches the first's, so "the first survived" cannot be satisfied by the
    // second winning.
    const first = jpegWith("first.jpg", TIMED);
    const second = jpegWith("second.jpg", TIMED_WITH_OTHER_OFFSET);

    pickBoth([first, second]);
    await settleBoth(media);
    await screen.findByRole("img", { name: alt(first) });
    await screen.findByRole("img", { name: alt(second) });

    // The pipeline serialises decodes, so `first` is the first writer.
    const when = screen.getByLabelText(LABEL.when) as HTMLInputElement;
    expect(when.value, "the second photo overwrote the first photo's clock").toBe(
      wallClockOf(expectedIsoFor(EXIF_WHEN)),
    );
    expect(when.value).not.toContain(SECOND_WHEN.slice(11, 16));

    // And the credit names one photo, not two — the note the owner reads.
    expect(describedTextOf(LABEL.when)).toContain("first.jpg");
    expect(describedTextOf(LABEL.when)).not.toContain("second.jpg");
  });

  it("still fills from the second photo when the first carried no clock at all", async () => {
    // THE CONTROL. If the guard is "a photo has been offered, so refuse"
    // rather than "this half is answered, so refuse", this case fails while
    // the first still passes. Without it, `return state` is a valid
    // implementation of first-writer-wins.
    const media = mediaFake();
    await renderEditor({ media });
    fillNewEntry();

    const clockless = jpegWithGps("clockless.jpg", GPS_TOKYO); // PINNED_ONLY: gps, no clock
    const timed = jpegWith("timed.jpg", TIMED);

    pickBoth([clockless, timed]);
    await settleBoth(media);
    await screen.findByRole("img", { name: alt(timed) });

    const when = screen.getByLabelText(LABEL.when) as HTMLInputElement;
    expect(when.value, "the clockless first photo blocked the second's clock").not.toBe("");
    expect(describedTextOf(LABEL.when)).toContain("timed.jpg");
  });
});
```

Three names above must be resolved against the file as it actually stands, because this plan is
not the source of truth for them: `jpegWith(name, options)` is the general form of the existing
`jpegWithGps` — if the file has no such helper, add it beside `jpegWithGps` following exactly its
`gpsBytes` pattern for the `ArrayBuffer` conversion, which exists because `exifJpeg` returns a
`Uint8Array` and `BlobPart` demands an `ArrayBuffer`. `expectedIsoFor` and `LABEL.when` are
whatever section 12 already calls them. `PHOTOS_LABEL`, `describedTextOf`, `GPS_TOKYO`, `TIMED`
and `TIMED_WITH_OTHER_OFFSET` all exist verbatim.

- [ ] **Step 3: Run it and record what happens**

```bash
npx vitest run components/studio/entry-editor/entry-editor.test.tsx -t "two photos picked at once"
```

**Both cases are expected to PASS against today's code**, because the refs already make it correct. That is the one place in this repository where a passing new test is the right outcome and is not suspect — the test exists to fail against a *future* wrong implementation, and Step 4 proves it can.

- [ ] **Step 4: Prove the test can fail, by breaking the thing it guards**

A test that has never been seen red is a test that verifies nothing. Temporarily replace the two synchronous ref reads at `entry-editor.tsx:1992-1993` with values captured before the `await` — the mistake a reducer refactor would make:

```bash
# make the edit by hand, then:
npx vitest run components/studio/entry-editor/entry-editor.test.tsx -t "two photos picked at once"
```

Expected: the **first** case FAILS (both photos fill), the second still passes. Record the literal output. Then revert the edit with `git checkout -- components/studio/entry-editor/entry-editor.tsx` and confirm both pass again.

If the first case passes even with the reads moved, the test is not pinning what it claims and must be rewritten before this task is committed.

- [ ] **Step 5: Full checks and commit**

```bash
npm run pod:dev & sleep 5
npm test && npm run lint && npm run typecheck && npm run check:structure
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
```

```bash
git add components/studio/entry-editor/entry-editor.test.tsx
git commit -m "Two photos in one pick, and the ref that makes the first one win"
```

---

### Task 2: The harness comes out, and the test file splits along its own sections

6,514 code lines against a 600 tendency and a 1000 hard bound, currently carrying an
`eslint-disable max-lines`. It splits at seams it already has: eighteen numbered section banners,
written by the sessions that built it.

**The invariant that proves the split lost nothing: the total test count is unchanged.** Every
case must land in exactly one file. `npm test` reporting fewer tests means cases were dropped;
reporting more means a `describe` was duplicated.

**DONE 2026-09-08. Four things were measured rather than assumed, and each moved the plan:**
the harness needs a folder, the lifecycle function needs a different name, section 12 needs
splitting in two, and fifty-four section helpers turned out to be shared. Details at each step.

**Files:**
- Create: `components/studio/entry-editor/entry-editor.harness/entry-editor.harness.tsx` from the
  current lines 1–947, plus a one-line `index.ts` barrel and a `notes.md`
- Create thirteen `entry-editor.<topic>.test.tsx` files (below)
- Delete: `entry-editor.test.tsx`, and with it the `eslint-disable max-lines` at its top
- Modify: `test/check-structure.test.ts` — its exemption case asserts four; three is the new truth

**Interfaces:**
- Produces: `renderEditor`, `podFake`, `fakeStudioSession`, `fakeStorage`, `loadEditor`, `setText`, `setChoice`, `saveButton`, `outcomeText`, `fillNewEntry`, `clickSaveAndWait`, `LABEL`, `specEntry`, `quadsOf`, `objectsOf`, `oneObject`, `datatypeOf`, `languageOf`, and `registerEditorLifecycle`. Every split file imports from `./entry-editor.harness`.
- Produces, unplanned: **fifty-four more declarations** that began inside a numbered section and
  turn out to be referenced by another suite — section 10's photo rig (`mediaFake`, `fakePipeline`,
  `jpegFile`, `pickPhoto`), section 8's draft rig (`fakeStorage`, `draftKeyFor`, `seededDraft`,
  `withFakeTimers`, `DRAFT_FIELDS`), section 1/1b/1c's field readers (`coordinateControls`,
  `placeNodeOf`, `shownValue`, `offsetOptions`) and more. The set was computed from the AST — every
  top-level declaration referenced from a target file other than its own, transitively — not by eye.
  It is the file's existing coupling, made visible; the harness is 781 code lines because of it.

- [ ] **Step 1: Extract the harness verbatim**

Lines 1–947 are fixtures, the fake Pod, the fake session, the fake storage, the component loader,
the form plumbing and the lifecycle block. Move them **unchanged** and add `export` to everything
the sections use. It is `.tsx` because `renderEditor` returns JSX.

**IT NEEDS A FOLDER, and the sentence that used to stand here was half right.** This claimed that
"neither the collection guard nor `check:structure`'s placement rule applies to it". The
*collection* guard does not, and the *test* placement rule (`testsSitBesideSubjects`) does not —
but `componentFoldersAreOwn` walks every non-test `.tsx` under `components/` and demands a folder
of its own name. Measured 2026-09-08 with a one-line probe at the flat path: `check:structure`
exits 1 with `entry-editor.harness.tsx is not in a folder named "entry-editor.harness"`. So it is
`entry-editor.harness/entry-editor.harness.tsx` with an `index.ts` barrel, which leaves the import
specifier `./entry-editor.harness` exactly as the Interfaces section above spells it. Changing the
guard to admit the file was the other option and is the wrong one.

Two more things the move cannot do unchanged, both measured:

- **`vi.hoisted` has to go.** `accessCalls` and `accessOutcome` are asserted on by most suites, so
  they must be exported, and Vitest 4 refuses: `SyntaxError: Cannot export hoisted variable`. Plain
  module consts work because the `vi.mock` factory is lazy — it runs when `@/lib/pod/access` is
  first imported, inside `loadEditor`'s dynamic import, long after this module has evaluated.
- **The harness must be imported FIRST in every suite.** `vi.mock` is hoisted to the top of the
  file that contains it, not of the importer. With the mocked module imported above the harness the
  mock silently does not apply — measured with a two-file probe, and the failure mode is a fake
  that reads as the real thing with nothing red.

The lifecycle block (`beforeEach`/`afterEach`, currently at 898–947) cannot be exported as a
side effect — each split file must call it. Export it as a function, and **not** under the name
this plan first proposed: `react-hooks/rules-of-hooks` rejects `useEditorLifecycle()` in every
suite, because the `use` prefix is a React contract and this is neither a hook nor called from a
component. Thirteen `eslint-disable` lines is a worse answer than an accurate name.

```tsx
/** Called by each suite itself; a side-effecting import registers against the wrong file. */
export function registerEditorLifecycle() {
  // the body of the current lifecycle block, verbatim
}
```

- [ ] **Step 2: Split by section, thirteen files**

Each gets `// @vitest-environment jsdom` at the top, imports `./entry-editor.harness` **first**, and
calls `registerEditorLifecycle()`. Sections stay whole; two are large enough to split at their own
`describe` boundaries — section 8 three ways, section 12 two ways.

Code lines as measured after the split, by `check:structure`'s own counter. **These replace the
raw-line estimates this table used to carry, which were not comparable to the bound and were wrong
in both directions** — `coordinates` was guessed at 1000 and is 518, `draft-autosave` at 810 and is
1562 raw / 714 code.

| File | Sections | code lines |
|---|---|---|
| `entry-editor.controls.test.tsx` | 0, 9 | 104 |
| `entry-editor.coordinates.test.tsx` | 1 | 518 |
| `entry-editor.place.test.tsx` | 1b | 319 |
| `entry-editor.offset.test.tsx` | 1c | 185 |
| `entry-editor.save-sequence.test.tsx` | 2, 3, 4, 5, 6 | 330 |
| `entry-editor.report.test.tsx` | 7, 7b, 7c, 7d | 389 |
| `entry-editor.draft-autosave.test.tsx` | 8, first 5 describes | 714 |
| `entry-editor.draft-banner.test.tsx` | 8, next 4 describes | 291 |
| `entry-editor.draft-fields.test.tsx` | 8, last 4 describes | 558 |
| `entry-editor.photos.test.tsx` | 10 | 446 |
| `entry-editor.autofill.test.tsx` | 11 | 931 |
| `entry-editor.autodate.test.tsx` | 12.0–12g | 909 |
| `entry-editor.autodate-edges.test.tsx` | 12h–12m, 12m being Task 1's | 765 |

**SECTION 12 HAS TO SPLIT, and that is why there are thirteen files rather than twelve.** Whole, it
is **1,672 code lines** — not over the 600 tendency, over the **1000 hard bound**, so `npm run lint`
fails with `File has too many lines (1672)`. Measuring first was the right instruction and it did
not rescue this one: promoting every section-12 helper to the harness would save about a hundred
lines of the six hundred and seventy needed. It splits at the `12h/12i` banner, which is both the
midpoint and a real seam — one photo's two halves before it, a second photo and the malformed tags
after. Four files still exceed the 600 tendency (autofill 931, autodate 909, autodate-edges 765,
draft-autosave 714) and that is accepted for this task: they are `check:structure` drift lines, not
failures, and none carries an `eslint-disable`.

- [ ] **Step 3: Prove nothing was lost, by count**

```bash
npm test 2>&1 | grep -E 'Test Files|Tests '
```

Expected: **the same total as HEAD before this task**, across 12 more files (13 new, 1 deleted).
Measured: **1063 passed / 2 todo / 0 skipped**, before and after, over 31 files then 43. Then
confirm every file is collected, since an uncollected split file is exactly the failure
`test/vitest-collection.test.ts` exists for:

```bash
npx vitest list --filesOnly | grep -c 'entry-editor'
npx vitest run test/vitest-collection.test.ts
```

Expected: 13 entry-editor test files listed, and the guard green.

**A count is the weaker half of the invariant, and one drop plus one duplicate cancels in it.** The
stronger check is the SET: `npx vitest list` piped through `sed 's#^[^ ]* > ##' | sort` for the
entry-editor files, before and after, must `diff` clean. It does — 169 `describe > it` paths, byte
for byte identical.

- [ ] **Step 4: Confirm the exemption is now unused, and delete it**

The `eslint-disable max-lines` went with the deleted file. Confirm no split file needs one:

```bash
npm run lint
```

Expected: pass, and `check:structure` now reports **three** active exemptions rather than four.

```bash
npm run check:structure | grep -A6 'active exemptions'
```

`test/check-structure.test.ts` asserts the count and the paths, so it goes red on four-to-three and
has to move with this commit — the exemption test is doing its job, not obstructing.

**The ratchet is the thing to watch here, and it moved twice for reasons worth naming.** The split
itself is comment-neutral: 207 runs over six lines in the one file, 207 across the fourteen. Both
rises came from prose *this task added* — a twelve-line harness header and an eleven-line lifecycle
docblock (+2), then a seven-line docblock on the amended exemption test (+1). All three moved to
`entry-editor.harness/notes.md` behind pointers, or shortened to six lines. `check:structure`'s
pointer check earned its keep in the process: it caught `#plain-consts-rather-than-vi-hoisted`
against a heading whose GitHub slug drops the dot in `vi.hoisted`.

- [ ] **Step 5: Full checks and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run check:structure && npm run build && npm run size:public
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
git add -A
git commit -m "The editor's suite splits at the eighteen seams it already had"
```

---

### Task 3: The pure helpers leave the component

Top-level already, so this is the lowest-risk extraction in the stage. `lib/` holds no React, and
phase 4's timeline wants the offset arithmetic.

**Files:**
- Create: `lib/studio/time/offsets.ts` + `offsets.test.ts` — `offsetHere`, `toOffsetDateTime`, `offsetOf`, `wallClockOf`, `wallClockNow`, `nowWithOffset`, `offsetMinutes`, `OFFSETS`, `OFFSET_SHAPE`, `LOCAL_DATETIME`, `TRAILING_OFFSET`, `pad`
- Create: `lib/studio/place/place.ts` + `place.test.ts` — `placeFor`, `placeTextOf`, `gridOf`, `precisionLabel`, `PRECISION_GRIDS`
- Create: `lib/studio/time/notes.md`, `lib/studio/place/notes.md`
- Modify: `components/studio/entry-editor/entry-editor.tsx` — import them instead
- Modify: whichever split suites assert on these directly

**Interfaces:**
- Produces: those named exports. Signatures are unchanged from their current definitions — copy them, do not redesign them.

- [ ] **Step 1: Write the failing colocated tests first**

These functions are currently tested only through the DOM. Write direct unit tests before moving
anything — that is the point of the move, and it is the TDD step for this task. At minimum:
`offsetMinutes` on both halves of a non-whole-hour zone; `toOffsetDateTime` rejecting a
half-formed local value; `placeFor`'s three-way untouched/replaced/removed logic, including that
`""` means remove and `undefined` means untouched; `gridOf` on an unlisted value.

```bash
npx vitest run lib/studio/time/offsets.test.ts lib/studio/place/place.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 2: Move the functions, unchanged**

Copy each definition verbatim. **Do not simplify anything while moving it** — a behaviour change
hidden inside a move is the one defect class this stage's ordering exists to prevent. If a helper
looks wrong, note it and leave it; it is a separate commit.

`OFFSET_SHAPE` has an open TODO item — its width is unpinned and a shape-valid but unlisted offset
would be refused on restore. Moving it does not close that. Leave it, and carry the item.

- [ ] **Step 3: Both suites green, then the whole thing**

```bash
npx vitest run lib/studio/time lib/studio/place
npm test && npm run lint && npm run typecheck && npm run check:structure
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
```

- [ ] **Step 4: Commit**

```bash
git commit -am "Offset arithmetic and place logic are domain code, and now testable as such"
```

---

### Task 4: `<Field>` and the class tokens become a component

`Field`, `CONTROL` and `BUTTON` are at the bottom of `entry-editor.tsx` and are used by every
field group Task 5 creates. They must exist first.

**Files:**
- Create: `components/studio/entry-editor/field/field.tsx`, `index.ts`, `field.test.tsx`
- Modify: `entry-editor.tsx`

**Interfaces:**
- Produces: `Field` (default export), `CONTROL`, `BUTTON`. `Field`'s props are its current ones — read them; do not invent a new shape.

- [ ] **Step 1: Failing test for `<Field>` on its own**

It has never been tested in isolation. Pin what the field groups will rely on: that the label is
associated with the control by `id`, that a `hint` is reachable through `aria-describedby`, and
that multiple describedby ids compose rather than replace. The `aria-describedby` composition is
the one worth pinning hardest — the editor's auto-fill notes depend on it, and an open TODO item
records that a `role="status"` here would collide with the save-outcome region.

- [ ] **Step 2: Move `Field`, `CONTROL`, `BUTTON`; import them back**

`CONTROL` and `BUTTON` carry class strings, and the arbitrary-Tailwind guardrail reaches a class
string in a `const` — `test/guardrails.test.ts` has a case for exactly that. Moving them keeps
them outside `components/ui/**`, so the ban still applies and they must stay free of arbitrary
values.

**Measured at the new path on 2026-09-08**, with a throwaway probe under `field/`:
`disabled:bg-[#222]` in a `const` is one `no-restricted-syntax` error and the same string inside a
`+` concatenation is a second. So `CONTROL`'s own docblock — "THE ARBITRARY-VALUE GUARDRAIL DOES
NOT REACH THESE TWO CONSTANTS … keep arbitrary values out of them by hand" — has been stale since
the rule grew its three extra arms on 2026-09-05. It travelled **verbatim** anyway, with the two
other bearings it carries that no longer resolve ("`entry-editor.test.tsx`'s 8e-bis", split up by
Task 2; "the Save button's `aria-describedby`, above", which stayed behind in the editor). All
three are written up in `field/notes.md#what-travelled-here-already-wrong`. Repairing prose inside
an extraction commit is what makes an extraction unreviewable; whoever does the Stage C sweep has
the list.

- [ ] **Step 3: Verify and commit**

```bash
npx vitest run components/studio/entry-editor/field
npm test && npm run lint && npm run typecheck && npm run check:structure
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
git add -A && git commit -m "The Field wrapper is a component, and tested as one"
```

---

### Task 5: Five field groups, props only, no state moved

Mechanical and safe: the JSX splits, the state stays exactly where it is and arrives as props.
Doing this before the hooks means Task 7 changes one file's wiring rather than a thousand lines
of JSX at the same time.

The groups follow the `id="entry-*"` order the JSX already has:

| Folder | Controls |
|---|---|
| `fields/identity-fields/` | `entry-trip`, `entry-slug`, `entry-headline`, `entry-story` |
| `fields/when-fields/` | `entry-when`, `entry-offset`, and the three source notes |
| `fields/where-fields/` | `entry-place-name`, `entry-locality`, `entry-country`, `entry-latitude`, `entry-longitude`, `entry-precision`, and the settings-gate notes |
| `fields/photo-fields/` | `entry-photos`, the picker and the per-slot state rendering |
| `fields/classification-fields/` | `entry-tags`, `entry-mode`, `entry-status` |

**Files:** five folders, each with `<name>.tsx`, `index.ts`, `<name>.test.tsx`, and a `notes.md` where the group carries prose worth keeping.

**DONE 2026-09-08, five commits in the table's order. One thing was measured rather than
assumed and it contradicts Step 3 below: the exemption does NOT come out here.**

`EntryEditor` went 941 → 902 → 839 → 725 → 677 → **633 code lines**. The five groups took
**308 code lines** of JSX with them, not nine hundred: this plan's own summary says "~990 lines
of JSX in one `return`", and that is the RAW span — 924 lines, of which roughly two thirds are
comment. `max-lines-per-function` counts with `skipComments`, so the number the bound sees was
never mostly markup. The remaining 633 are the 27 `useState`, the 10 `useRef`, the effects,
`save()`, `restore`, `discard`, `attach` and the draft debounce — which is to say Tasks 6 and 7,
exactly as this stage ordered them, but the removal signal belongs to the LAST of those and not
to this task. `npm run lint` stayed green at `--max-warnings 0`, `check:structure` still reports
**three** exemptions, and `test/check-structure.test.ts` needed no amendment.

Four other things worth carrying forward:

- **Four groups needed no new module-level code; three needed something moved with them.** The
  ids a group renders and the `aria-describedby` builder that composes them are one unit —
  `OCCURRED_SOURCE_ID` beside `occurredHelp`, `COORDINATE_SOURCE_ID` beside `coordinateHelp` —
  so leaving the builder behind would have made one string true in two files. `PhotoSlot` moved
  for the same reason and is the one TYPE this task moved; Task 6 moves it again, to `state/`.
- **The comments that argue about a handler stayed with the handler, and the handlers gained
  names.** `creditTime` and `creditCoordinate` are still the editor's, so four `onChange` bodies
  became `typeOccurred`, `chooseOffset`, `typeLatitude`, `typeLongitude` and `attachAll` in the
  editor's body — carrying their prose verbatim. That is what keeps the composition JSX one line
  per prop, and it is the wiring Task 6 rewrites.
- **`check:structure`'s pointer check bit twice**, both times on a `notes.md` written after the
  `.tsx` that pointed at it. It names the file and the anchor, so it costs one minute; it is also
  the only check in the nine that noticed the file was missing.
- **`WhereFields` is 161 code lines**, over the 130 tendency and under the 200 bound. Reported,
  not failing, and left alone: splitting it would separate the two coordinate boxes from the one
  note both of them name.

- [ ] **Step 1: One group at a time, in that order, each its own commit**

For each: write the group's test first against the props interface you are about to create, watch
it fail, extract the JSX, wire the props, watch it pass, run the full checks, commit. Five
iterations. **Do not batch them** — a failure in the fourth is far cheaper to locate when the
first three are already committed.

- [ ] **Step 2: The props interface is explicit, never a spread of everything**

A group that takes `{...everything}` has moved lines without moving responsibility, and the
render bound would be satisfied while readability got worse — which the maintainer named as the
actual goal. Each group declares the values and callbacks it uses, by name.

- [ ] **Step 3: After the fifth, measure the component**

```bash
npm run check:structure | grep 'entry-editor.tsx'
```

`EntryEditor` should now be well under the 200 hard bound. **If it is, its `eslint-disable
max-lines-per-function` is an unused directive and `npm run lint` FAILS at `--max-warnings 0`.**
Delete the exemption in that same commit — that is the designed signal, and it is why the
directive was written with a removal condition.

**IT WAS NOT. Measured 2026-09-08: 633 code lines after the fifth group** — see the DONE note at
the top of this task for why the nine hundred was a raw count. The signal is real and it fires;
it fires on whichever of Tasks 6 and 7 lands last, and the exemption's own comment ("Remove this
line with the last field group") is the thing that is now wrong. Leave it as found rather than
rewording it here: it is one line, `check:structure` prints it on every run, and the task that
takes it out will not be able to miss it, because lint will refuse the build.

- [ ] **Step 4: Full checks and commit**

---

### Task 6: The reducer — the only task that can change behaviour

Twenty of the twenty-seven `useState` values and three of the ten refs become one reducer. The
seven that stay are Task 7's.

**Read spec §5 in full before writing a line**, particularly its second half. The summary: the
first-writer-wins decision must live **inside** the transition. If it is made outside — reading
state from the hook's return value and dispatching a plain set — two photos in one pick both see
`nobody` and both fill. Task 1's test is what catches that, and it is the only thing that does.

**Files:**
- Create: `state/actions.ts`, `state/entry-form-reducer.ts` + test, `state/apply-field-edit.ts` + test, `state/apply-photo-offer.ts` + test, `state/apply-restore.ts` + test, `state/notes.md`
- Modify: `entry-editor.tsx`, and the field groups' wiring

**Interfaces:**
- Produces:

```ts
export type EntryFormState = {
  // the 15 form fields, names exactly as `Draft` in lib/studio/drafts.ts spells them
  tripIri: string; slug: string; headline: string; story: string;
  occurred: string; offset: string; tagsText: string;
  mode: Mode | ""; status: EntryStatus;
  lat: string; long: string; precision: string;
  placeName: string; locality: string; country: string;
  // the photos, richer than Draft's
  slots: PhotoSlot[];
  // the four credit values, which the transitions own
  coordinateAuthor: CoordinateAuthor;
  occurredAuthor: TimeAuthor;
  offsetAuthor: TimeAuthor;
  offsetGuess: boolean;
};

export type EntryFormAction =
  | { kind: "field"; field: keyof DraftText; value: string }
  | { kind: "coordinate-typed"; lat?: string; long?: string }
  | { kind: "photo-coordinate"; name: string; lat: string; long: string }
  | { kind: "photo-timestamp"; key: string; name: string; wall?: string; offset?: string }
  | { kind: "restore"; draft: Draft }
  | { kind: "slots"; slots: PhotoSlot[] };
```

`coordinateSource`, `occurredSource` and `offsetSource` are **derived** from the author fields
rather than stored — that is what collapses the ref/state pair into one value. Export selectors:

```ts
export const sourceOf = (author: CoordinateAuthor | TimeAuthor) =>
  author.kind === "photo" ? author.name : null;
```

- [ ] **Step 1: Write `apply-photo-offer.test.ts` FIRST, as a pure test**

This is the file the whole task exists for, and it can be tested in milliseconds where the DOM
route takes seconds. Cases, all pure calls with no React:

```ts
// first writer wins, per half
// - a wall clock into `nobody` fills and credits
// - a wall clock into an existing `photo` half does NOT overwrite
// - an offset into `nobody` fills; into `photo` does not
// the cross-half guard (§11.5, the instant that happened nowhere)
// - a wall clock is REFUSED when the offset half is already owned by a
//   DIFFERENT photo's key, and accepted when it is the same key
// - two photos' halves never compose: pinned on `key`, not on `name`,
//   because two cameras share a first-photo name
// the owner always outranks a photo
// - an owner-typed value is never overwritten by a later photo
```

The `key`-not-`name` distinction is already argued in the current code's docblocks and has a
regression test in the DOM suite. It must survive as a pure test here.

```bash
npx vitest run components/studio/entry-editor/state/apply-photo-offer.test.ts
```

Expected: FAIL, module not found.

- [ ] **Step 2: Write `apply-photo-offer.ts`, guard inside**

The guard is a branch in this function. It receives state and returns state; there is no way for
a caller to make the decision, which is the property being bought.

- [ ] **Step 3: The same loop for `apply-field-edit.ts` and `apply-restore.ts`**

`apply-restore` is the one with real value beyond tidiness: it replaces thirteen setters plus a
credit call with one transition. Its test must pin that a restored draft credits the owner — not
`nobody` — for every field the draft carried, or the next photo would overwrite the owner's own
restored text.

- [ ] **Step 4: `entry-form-reducer.ts` as a thin switch, with an exhaustiveness check**

```ts
export function entryFormReducer(state: EntryFormState, action: EntryFormAction): EntryFormState {
  switch (action.kind) {
    case "field": return applyFieldEdit(state, action);
    // …
    default: {
      const exhaustive: never = action;
      throw new Error(`unhandled action: ${JSON.stringify(exhaustive)}`);
    }
  }
}
```

The `never` binding is what makes a new action a compile error rather than a silent no-op.

- [ ] **Step 5: `hooks/use-entry-form.ts`, and wire the component**

The hook owns `useReducer` and exposes the field values plus named dispatchers. **The field groups
receive values and callbacks, never `dispatch` itself** — a group holding `dispatch` can invent
transitions, which is the coupling this task is removing.

- [ ] **Step 6: Task 1's test is the gate**

```bash
npx vitest run components/studio/entry-editor/entry-editor.autodate.test.tsx -t "two photos picked at once"
```

**All three cases must pass** — Task 1 shipped as section 12m with three, not two. The third is
the composite: a clock-only photo paired with an offset-only one, which is the shape §11.5
actually names and the only pairing that reproduces the instant that happened nowhere with the
warning cleared. Case 1's second photo carries both tags, so a stale read makes it win both
halves — wrong, but coherent, and therefore not the defect.

Task 1's suite also wraps the fake pipeline to **serialise** decodes, because `fakePipeline` does
not and `lib/media/pipeline.ts` does; without it two decodes overlap in a schedule production
never runs. It asserts the decode order as a stated premise, so an ordering flip fails with its
own message instead of masquerading as the defect. Preserve that wrapper.

If any case fails, the guard is outside the transition — fix the design, not the test. Then the rest:

```bash
npm test && npm run lint && npm run typecheck && npm run check:structure
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
```

- [ ] **Step 7: Commit**

```bash
git commit -am "Twenty values and one guard move inside a transition that cannot be bypassed"
```

---

### Task 7: The remaining seven `useState`, grouped into four hooks

| Hook | Owns |
|---|---|
| `hooks/use-entry-save.ts` | `target`, `provenance`, `outcome`, `saving`, the save sequence, `announce`, `preconditionFor` |
| `hooks/use-entry-draft.ts` | `offered`, `storageRefused`, the debounce, `settleDraft`, `discard`, `browserStorage`, `sameText`, `samePhotos` |
| `hooks/use-settings-gate.ts` | `gate`, the §7.6 privacy read, `fuzzed` |
| `hooks/use-photo-pipeline.ts` | the pipeline instance, `attach`, `pipelineFor`, `photosFor` |

A dispatch table buys nothing for a boolean one call site flips, which is why these are `useState`
and not more actions.

- [ ] **Step 1: One hook at a time, test first, own commit**

`use-entry-draft` is the delicate one: `restoreSession`'s synchronous memo and the draft-read ref
exist because React double-invokes effects under StrictMode, and the e2e suite runs against
`next dev` specifically to keep that observable. Do not remove a ref you cannot explain.

- [ ] **Step 2: After the fourth, the component is composition only**

```bash
npm run check:structure | grep -E 'entry-editor.tsx|over the tendency'
```

`EntryEditor` should be at or under ~120 lines. If it is over 130 it is only drift, not a failure
— but read it and ask whether anything left in it belongs in a hook.

---

### Task 8: The stage closes

- [ ] **Step 1: Confirm both exemptions are gone**

```bash
npm run check:structure | grep -A6 'active exemptions'
```

Expected: **two** — `serialiseEntry` and `check-public-bundle.ts :: main`, both Stage C's. Neither
`entry-editor.tsx` nor any editor test file may still carry one. If one remains, the
decomposition did not finish.

**Task 5 did not remove `entry-editor.tsx`'s, and that was the plan's error rather than the
task's**: 633 code lines after the five groups, against a 200 bound. Whichever of Tasks 6 and 7
lands last takes it out, and `npm run lint` will refuse the build until it does — so this step is
a confirmation, not the place the work happens. Its comment still says "Remove this line with the
last field group", which is now false; correct that line in the commit that deletes it.

- [ ] **Step 2: The comment ratchet**

```bash
npm run check:structure | grep -A3 'comment blocks over 6 lines'
```

It must not have risen above 788. Splitting files does not add blocks; adding prose does. If it
rose, the new prose goes in a `notes.md` behind a checked anchor.

- [ ] **Step 3: All ten, unchained, and read every log**

```bash
npm run pod:dev & sleep 5
for c in test lint typecheck validate:fixtures check:vocab check:commands check:structure build size:public; do
  if [ "$c" = "test" ]; then npm test > "/tmp/b-$c.log" 2>&1; else npm run "$c" > "/tmp/b-$c.log" 2>&1; fi
  printf '%-20s %s\n' "$c" "$([ $? -eq 0 ] && echo PASS || echo FAIL)"
done
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
```

Prove the integration suites ran rather than skipped, with the control:

```bash
npx vitest run test/integration/                                    # 33 passed
TEST_POD=http://localhost:3999 npx vitest run test/integration/     # 33 skipped
```

- [ ] **Step 4: Write the results into `TODO.md`**

Under the "Code structure" section, tick Stage B and record: the final line count of
`entry-editor.tsx`, the number of files it became, the test total before and after the split,
which exemptions were removed, the ratchet number, and anything that failed. Name what you left
undone.

- [ ] **Step 5: Commit**

```bash
git add TODO.md && git commit -m "Stage B is ticked, with what the reducer bought and what it cost"
```

## What Stage B does not do

The eleven other long functions and the comment sweep are Stage C. `OFFSET_SHAPE`'s unpinned width
stays open. The fifteen phase-3 follow-ups in `TODO.md` are untouched. And the question of whether
the comment conventions bind test docblocks — 60% of the 788 — is still deferred; Stage C cannot
be planned without answering it.

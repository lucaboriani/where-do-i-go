# Code Structure Stage B — `EntryEditor` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a 941-line component with 27 `useState`, 10 `useRef` and ~990 lines of JSX in one `return` into a ~120-line component composing five field groups, five hooks and one reducer — without changing a single rendered behaviour.

**Architecture:** Test first, in the strict sense: the one invariant no existing test can see gets a failing test before anything moves. Then the 6,514-line test file splits along its own numbered sections, so every later step has fast, targeted feedback. Then extraction in order of rising risk — pure helpers, the shared `<Field>`, presentational field groups, the hooks, and last the reducer, which is the only step that can change behaviour.

**Tech Stack:** Node 22.23.2, React 19 under Next 16 App Router, TypeScript, Vitest + Testing Library (jsdom), Playwright for the two flows that cannot be tested faster.

**Spec:** `docs/superpowers/specs/2026-09-08-code-structure-conventions-design.md` — §5 is this stage's design and §5's second half is the constraint that decides whether this is a fix or a regression.

## Global Constraints

- **Node 22.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`, then `node -v` must print `v22.x`. Everything here passes on Node 20 too, so checking is a step you take rather than one the tooling takes for you.
- **Take the test count from HEAD, never from this plan.** It was **1060 passed / 2 todo / 0 skipped / 31 files** at `bb81c36`. Run `npm test` before you touch anything and compare against that.
- **`npm run pod:dev &` before `npm test`**, or the two integration suites skip themselves and the run is green having never executed them. Prove they ran: `npx vitest run test/integration/` must report 33 passed, and `TEST_POD=http://localhost:3999 npx vitest run test/integration/` must report 33 skipped. That control is how this stage knows a green run was not an empty one.
- **`npm run size:public` does not build.** Run `npm run build` first or it grades a stale `.next`.
- **Every task in this stage touches `components/studio/**`, so `npm run test:e2e` is required on every task.** Run it with `env -u CLAUDECODE -u AI_AGENT npm run test:e2e`. Expect 6 passed.
- **`npm run lint` carries `--max-warnings 0`.** `reportUnusedDisableDirectives` is active, so the moment a decomposed function drops under its bound, its `eslint-disable` becomes an unused directive and **fails the build**. That is the designed removal signal, not a surprise: delete the exemption in the same commit that shortens the function.
- **`npm run check:structure` must stay green.** Its comment ratchet is at **788** and fails when the count rises. Splitting a file does not create comment blocks, but *adding* prose does. If it rises, shorten the prose or move it to a `notes.md` — do not raise the baseline.
- **`components/studio/entry-editor/` holds `.tsx` components in their own folders, and flat `.ts` modules under `state/` and `hooks/`.** That asymmetry is deliberate and written into `CLAUDE.md`; the folder rule binds `.tsx` only.
- The `dy:` namespace is still `https://example.org/ns/traveldiary#`. Nothing in this stage writes to any live Pod.

## File Structure

| File | Responsibility |
|---|---|
| `components/studio/entry-editor/entry-editor.tsx` | composition and page layout only, ~120 lines when the stage ends |
| `entry-editor.harness.tsx` | the fake Pod, fake session, fake storage, loader, form plumbing and lifecycle every split test file needs |
| `entry-editor.<topic>.test.tsx` × 12 | the split suites, one per numbered section of the original |
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

`offerTimestamp` reads `occurredAuthor.current` and `offsetAuthor.current` **synchronously** at `components/studio/entry-editor/entry-editor.tsx:1988-1989`, inside `attach`'s continuation — after a decode and two PUTs. The picker is `multiple` and starts every file at once: `for (const file of picked) void attach(file)` at `:3722`. `lib/media/pipeline.ts` serialises the *decodes* (`queue = result.catch(…)`), but photo 2's continuation resumes as a microtask and React batches updates across those. What makes first-writer-wins correct today is that photo 1 has already written the ref before photo 2 reads it, with no re-render in between.

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

A test that has never been seen red is a test that verifies nothing. Temporarily replace the two synchronous ref reads at `entry-editor.tsx:1988-1989` with values captured before the `await` — the mistake a reducer refactor would make:

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

**Files:**
- Create: `components/studio/entry-editor/entry-editor.harness.tsx` from the current lines 1–948
- Create twelve `entry-editor.<topic>.test.tsx` files (below)
- Delete: `entry-editor.test.tsx`, and with it the `eslint-disable max-lines` at its top

**Interfaces:**
- Produces: `renderEditor`, `podFake`, `fakeStudioSession`, `fakeStorage`, `loadEditor`, `setText`, `setChoice`, `saveButton`, `outcomeText`, `fillNewEntry`, `clickSaveAndWait`, `LABEL`, `specEntry`, `quadsOf`, `objectsOf`, `oneObject`, `datatypeOf`, `languageOf`, and the lifecycle hooks. Every split file imports from `./entry-editor.harness`.

- [ ] **Step 1: Extract the harness verbatim**

Lines 1–948 are fixtures, the fake Pod, the fake session, the fake storage, the component loader,
the form plumbing and the lifecycle block. Move them **unchanged** into
`entry-editor.harness.tsx` and add `export` to everything the sections use. It is `.tsx` because
`renderEditor` returns JSX, and it is not a `*.test.tsx` file, so neither the collection guard nor
`check:structure`'s placement rule applies to it.

The lifecycle block (`beforeEach`/`afterEach`, currently around line 898) cannot be exported as a
side effect — each split file must call it. Export it as a function:

```tsx
/** Every split suite calls this at the top of its own file. */
export function useEditorLifecycle() {
  // the body of the current lifecycle block, verbatim
}
```

- [ ] **Step 2: Split by section, twelve files**

Each gets `// @vitest-environment jsdom` at the top, imports from `./entry-editor.harness`, and
calls `useEditorLifecycle()`. Sections stay whole; four are large enough to split at their own
`describe` boundaries.

| File | Sections | approx. lines |
|---|---|---|
| `entry-editor.controls.test.tsx` | 0, 9 | 250 |
| `entry-editor.coordinates.test.tsx` | 1 | 1000 |
| `entry-editor.place.test.tsx` | 1b | 570 |
| `entry-editor.offset.test.tsx` | 1c | 420 |
| `entry-editor.save-sequence.test.tsx` | 2, 3, 4, 5, 6 | 530 |
| `entry-editor.report.test.tsx` | 7, 7b, 7c, 7d | 710 |
| `entry-editor.draft-autosave.test.tsx` | 8, first 5 describes | 810 |
| `entry-editor.draft-banner.test.tsx` | 8, next 4 describes | 800 |
| `entry-editor.draft-fields.test.tsx` | 8, last 4 describes | 1000 |
| `entry-editor.photos.test.tsx` | 10 | 875 |
| `entry-editor.autofill.test.tsx` | 11 | 1900 |
| `entry-editor.autodate.test.tsx` | 12, and 12j from Task 1 | 2800 |

The three largest still exceed the 600 tendency and that is accepted for this task: they are
`check:structure` drift lines, not failures, and splitting a coherent section further is a
readability judgement better made once the component underneath it has been decomposed. Do not
add an `eslint-disable max-lines` to any of them — measure first, because these are **code**
lines against a 1000 bound and the raw-line figures above are larger than the code figures.

- [ ] **Step 3: Prove nothing was lost, by count**

```bash
npm test 2>&1 | grep -E 'Test Files|Tests '
```

Expected: **the same total as HEAD before this task**, across 12 more files. Then confirm every
file is collected, since an uncollected split file is exactly the failure `test/vitest-collection.test.ts` exists for:

```bash
npx vitest list --filesOnly | grep -c 'entry-editor'
npx vitest run test/vitest-collection.test.ts
```

Expected: 12 entry-editor test files listed, and the guard green.

- [ ] **Step 4: Confirm the exemption is now unused, and delete it**

The `eslint-disable max-lines` went with the deleted file. Confirm no split file needs one:

```bash
npm run lint
```

Expected: pass, and `check:structure` now reports **three** active exemptions rather than four.

```bash
npm run check:structure | grep -A6 'active exemptions'
```

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

**Both cases must pass.** If the first fails, the guard is outside the transition — fix the
design, not the test. Then the rest:

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

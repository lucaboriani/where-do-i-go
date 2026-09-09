# entry-editor.harness — notes

Why this rig is shaped the way it is. The seam-by-seam account of what is faked
lives in the file's own opening docblock; this holds the parts that are longer
than three lines and would otherwise sit inline.

## Why it is a folder of its own

`check:structure`'s `componentFoldersAreOwn` walks every non-test `.tsx` under
`components/` and demands the file sit in a directory of its own name. A flat
`entry-editor.harness.tsx` beside the suites fails it — measured on 2026-09-08
by putting a one-line probe there and running the script, which reported
`entry-editor.harness.tsx is not in a folder named "entry-editor.harness"`.
Stage B's plan asserted the placement rule did not reach this file; the *test*
placement rule (`testsSitBesideSubjects`) indeed does not, because this is not a
`*.test.tsx`, but the component-folder rule does. So it gets a folder and a
one-line barrel, and the suites still import it as `./entry-editor.harness`.

## The harness must be imported first

`vi.mock("@/lib/pod/access")` lives in this file, and Vitest hoists a `vi.mock`
call to the top of **the file that contains it**, not to the top of the importer.
So the mock only beats `@/lib/pod/access` into the module graph if this module is
evaluated before anything that pulls access.ts in.

Measured on 2026-09-08 with a two-file probe: with the mocked module imported
*above* the harness, the mock silently did not apply and the real module answered.
The failure mode is a fake that reads as the real thing, with nothing red.

Two consequences, both deliberate:

- Every suite lists `./entry-editor.harness` first in its import block.
- Nothing in this file's own import graph may reach `lib/pod/access.ts`. Checked
  before the split: `lib/pod/read`, `lib/pod/fuzz`, `lib/pod/result`,
  `lib/pod/tags`, `lib/pod/schema`, `lib/media/*`, `lib/studio/session`,
  `test/graph` and `test/msw` mention it only in comments.

## Plain consts rather than a hoisted binding

`accessCalls` and `accessOutcome` were a `vi.hoisted` destructuring while they
lived in a single test file. Every suite asserts on them, so they have to be
exported — and Vitest 4 refuses that outright: `SyntaxError: Cannot export
hoisted variable. You can control hoisting behavior by placing the import from
this file first.`

Plain module consts are safe here because the `vi.mock` factory is **lazy**: it
runs when `@/lib/pod/access` is first imported, which happens inside
`loadEditor`'s dynamic import at test time, long after this module has finished
evaluating. If that ever stopped being true the failure is a loud
temporal-dead-zone error, not a silent one.

## Why it is not called `useEditorLifecycle`

Stage B's plan named this function `useEditorLifecycle()`. ESLint's
`react-hooks/rules-of-hooks` rejects it in every suite — "React Hook
`useEditorLifecycle` cannot be called at the top level. React Hooks must be
called in a React function component or a custom React Hook function" — because
the `use` prefix is a React contract and this is neither a hook nor called from a
component. Thirteen `eslint-disable` lines would be a worse answer than a name
that is accurate, so it is `registerEditorLifecycle()`.

It has to be a function each suite calls rather than a side-effecting import:
`beforeEach`/`afterEach` registered while an imported module evaluates belong to
whichever file is collecting, and making that implicit is how a suite ends up
without the `localStorage.clear()` that stops one test's draft reaching the next.

## The imports that carry a reason

Four import sites in the original single file carried an explanation. The
imports have since spread across the suites; the reasons have not changed.

- **`snapToPrecision` from `lib/pod/fuzz`** — section 1's ORACLE, not its
  subject: the snapped values are hard-coded and this is what ties them to the
  grid that produced them, in one control test. **`fuzzForPublication`** joins it
  for section 11's control, in the same role: the oracle for "this GPS fixture
  really does reach the branch the test is about", against the §7.6 document the
  harness serves rather than a guess. (Now in `entry-editor.coordinates`,
  `entry-editor.save-sequence` and `entry-editor.autofill`.)
- **`describe as describeError` from `lib/pod/result`** — aliased, because
  `describe` is vitest's here. Used to print a structured `PodError` when a
  control fails, so the message names the read rather than "false". (Now in
  `entry-editor.coordinates` and `entry-editor.autofill`.)
- **`exifJpeg` from `test/fixtures/exif-jpeg`** — section 10's picked file is a
  real JPEG with real EXIF, built byte by byte by the same fixture
  `test/media-exif.test.ts` reads back, so the container hash and the metadata
  read are over bytes rather than over an empty `File`. **`ExifOptions`** is for
  section 11, which needs the GPS half of the same builder: a photo's coordinate
  has to arrive as EXIF and be read by the real `readMetadata`, exactly as
  `fakePipeline` already does it. (In this file, and in
  `entry-editor.autofill`, `entry-editor.autodate` and
  `entry-editor.autodate-edges`.)
- **`mediaContainer` and `mediaHash` from `lib/media/upload`** — section 10e's
  duplicate case needs the container a given file hashes to, and the real
  functions rather than a literal: a hardcoded hash would still pass the day the
  digest changed, against an editor that had stopped deduplicating. (Now in
  `entry-editor.photos`.)

## What is shared, and why so much of it is

Fifty-four declarations that began life inside one numbered section are exported
from here rather than from the suite that introduced them. They are not a design
choice; they are the file's existing coupling, made visible by the split. Each
one was promoted because at least one *other* suite references it — computed from
the AST rather than by eye, transitively, so a promoted helper's own dependencies
came with it.

The largest clusters: section 10's photo rig (`mediaFake`, `fakePipeline`,
`jpegFile`, `pickPhoto`, `blobOf`, `PHOTOS_LABEL`) which sections 11 and 12 both
drive; section 8's draft rig (`fakeStorage`, `draftKeyFor`, `seededDraft`,
`withFakeTimers`, `DRAFT_FIELDS`) which all three draft suites and both autodate
suites use; and section 1/1b/1c's field readers (`coordinateControls`,
`placeNodeOf`, `shownValue`, `offsetOptions`) which the autofill and autodate
suites read back through.

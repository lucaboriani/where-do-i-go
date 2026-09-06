# Phase 3 — the media pipeline, and auto-place / auto-date

Design agreed 2026-09-06. Stage 1 (the pipeline) is specified in full; stage 2 (auto-place and
auto-date) is specified to the level of its interfaces and its call path into §9, and is filled
in when stage 1 lands.

This document is a design, not a plan. It says what is being built and why each choice is the
one it is. The implementation plan is written separately.

## 0. What already exists, so it is not rebuilt

Verified in the checkout on 2026-09-06:

- **`exifreader@4.44.0` is already a dependency**, pinned in phase 0.5. `exifr` is rejected —
  `docs/versions.md` says so and explains that generated code reaching for it is stale training
  data.
- **`/travel/media/` is already created** by `initialiseContainers()` with `publicChildren: true`
  (`lib/pod/access.ts`). No container work is needed.
- **The eslint fence already reserves this subsystem.** `eslint.config.mjs` restricts the group
  `["exifreader", "**/lib/media/**"]` to the studio. `lib/media/` does not exist yet; the fence
  was written ahead of it. Nothing new is needed to keep this code out of the public bundle.
- **`next.config.ts` already wires `next/image` `remotePatterns`** to the `POD_ROOT` host, so
  Pod-hosted photos render through `next/image` and `blurDataURL` is directly usable.
- **`lib/pod/entry-model.ts` names its own gap.** Its photo block ends with a comment listing
  `schema:encodingFormat`, `schema:dateCreated` and `dy:originalUrl` as deliberately unwritten
  "until phase 3", and `test/entry-write.test.ts` enumerates exactly those three. That test is
  expected to go red under this work. It is doing its job.
- **`lib/pod/fuzz.ts` landed 2026-09-06** (`fc9fcc5`) with `fuzzForPublication`. Stage 2 calls
  it; it is not modified here.

## 1. Scope

**Stage 1 — the pipeline.** Pick a photo, resize it in a Web Worker to a web-sized and a
thumb-sized derivative plus a blur placeholder, read its EXIF, strip its metadata, upload the two
derivatives to `/travel/media/`, and attach the result to the entry being edited.

**Stage 2 — auto-place and auto-date.** Use the EXIF that stage 1 already read to prefill the
entry's coordinate (through §9's fuzzing, never around it) and its `dy:occurredAt`.

Out of scope, deliberately: uploading originals (decided against — see §9 below), cleaning up
unreferenced media (§8), and any change to `lib/pod/fuzz.ts`.

## 2. The worker boundary, and why it is where it is

`CLAUDE.md` requires the resize to happen in a Web Worker, so "do it on the main thread" is not
a candidate. The genuine choice was where EXIF is read, and it is read **inside the worker**.

The worker returns pixels *and* metadata from a single message. That keeps `exifreader` inside
the worker's chunk rather than the studio's main bundle, keeps the raw file bytes off the main
thread, and costs one `postMessage` round trip per photo instead of two.

**The authenticated `fetch` cannot move into the worker.** It is a closure over the Inrupt
session's token state and is not structured-cloneable. This is a constraint, not a preference,
and it produces a clean split:

> **The worker owns bytes. The main thread owns the network.**

Turbopack supports `new Worker(new URL(…, import.meta.url))` — confirmed in
`node_modules/next/dist/docs/01-app/03-api-reference/08-turbopack.md`, which documents magic
comments for `new Worker()` expressions and a `turbopackWorkerAssetPrefix` option for worker URLs.
The worker is constructed from a client component only.

## 3. Module shape

```
lib/media/
  targets.ts           pure: box-fit maths, format/extension resolution, blur budget
  exif.ts              pure: exifreader tags -> typed PhotoMetadata, Zod-validated
  pipeline.worker.ts   the only file that touches createImageBitmap / OffscreenCanvas
  pipeline.ts          main-thread client: spawns the worker, typed request/response
  upload.ts            hashes, builds media IRIs, PUTs derivatives, returns a Photo
```

`targets.ts` and `exif.ts` hold the bulk of the logic and are pure. That is what makes the
vitest half of the test plan meaningful rather than decorative — see §10.

`pipeline.worker.ts` is deliberately thin: decode, draw, encode, hand back. Logic that can live
in `targets.ts` lives there instead, because a worker is the least testable place in the project.

**One worker, one photo at a time.** `pipeline.ts` owns a single `Worker` instance for the
editor's lifetime and queues photos through it, terminating it on unmount. Not one worker per
photo, and not a pool: decoding a 50 MP image costs on the order of 200 MB of bitmap, so three in
flight is how a phone's browser tab gets killed mid-edit. The worker calls `bitmap.close()` as
soon as the last derivative is drawn rather than waiting for GC.

### Types at the seams

```ts
// exif.ts — the stage-1/stage-2 seam. Pinned now so stage 2 has something stable.
export type PhotoMetadata = {
  /** Signed decimal degrees, hemisphere refs already applied by exifreader.
   *  Absent when the photo carries no GPS, which is the common case for
   *  screenshots, scans and anything with location services off. */
  gps?: { lat: number; long: number };
  /** EXIF wall clock, "YYYY-MM-DDTHH:mm:ss" shaped, NO offset. See §11. */
  dateTimeOriginal?: string;
  /** "+09:00" when OffsetTimeOriginal (0x9011) is present. Usually absent. */
  offsetTimeOriginal?: string;
  /** 1-8. Informational only: production code does no orientation maths (§6). */
  orientation?: number;
};

// pipeline.ts — one message in, one message out.
export type PipelineResult = {
  web: { blob: Blob; width: number; height: number };
  thumb: { blob: Blob; width: number; height: number };
  /** A data: URI, or absent when it exceeded the budget (§6.4). */
  blurDataUrl?: string;
  metadata: PhotoMetadata;
};
```

## 4. Data model change — exactly one new predicate

**`dy:blurDataUrl`** (`xsd:string`), on the `schema:ImageObject`. A plain literal, **not**
language-tagged: §6's "language-tag all human-readable literals" does not reach a base64 data
URI, which is not human-readable in any language.

Adding it requires, per `CLAUDE.md` and `check:vocab` running both directions:

1. `docs/data-model.md` §3, under "Media and misc".
2. `lib/vocab.ts`, in the `DY` block.
3. The §7.3 fixture, so `validate:fixtures` parses it.

This is the **only** new term. Everything else the pipeline writes already exists:

| Written | Predicate | Value |
|---|---|---|
| web derivative | `schema:contentUrl` | IRI in `/travel/media/<hash>/` |
| thumb derivative | `schema:thumbnailUrl` | IRI in the same container |
| blur | `dy:blurDataUrl` | data URI literal |
| dimensions | `schema:width`, `schema:height` | **the web derivative's** |
| format | `schema:encodingFormat` | the blob's ACTUAL type (§6.1) |
| capture time | `schema:dateCreated` | from EXIF, when resolvable (§11) |
| ordering | `dy:sortOrder` | already written today |

**Thumb dimensions are not stored.** The thumb's aspect ratio is identical to the web
derivative's by construction, so the public page derives them. Storing them would cost two more
permanent identifiers to express something already implied.

### `dy:originalUrl` is now permanently unused

Originals are not uploaded — `TODO.md` records the decision and its reasoning (phase-0 question 5
came back unanswerable because PodSpaces is Developer Preview; §9's recommended default stands on
its own merits). The §7.3 fixture nonetheless still shows `dy:originalUrl`, which now contradicts
shipped behaviour.

**Proposed:** remove it from the §7.3 fixture and keep the term reserved in §3 with a note that
nothing writes it. Rule 4 makes a `dy:` term permanent once written; nothing has ever written this
one, but §3 is also the record of what the namespace contains, so deleting it outright would lose
that. This is flagged for the owner rather than decided here.

## 5. Derivative sizes

| Derivative | Longest edge | Quality | Destination |
|---|---|---|---|
| web | 1600 px | 0.82 | `web.<ext>` in the media container |
| thumb | 400 px | 0.75 | `thumb.<ext>` in the same container |
| blur | 20 px | 0.5 | a data URI in the entry TTL |

**Never upscale.** A source smaller than the target is re-encoded at its own size, and
`schema:width`/`height` then describe the source. Upscaling would inflate Pod storage to
manufacture detail that is not there.

**Every derivative is a longest-edge fit that preserves aspect ratio. The thumb is not
square-cropped.** This is load-bearing rather than aesthetic: §4 stores no thumb dimensions
because the thumb's aspect ratio is identical to the web derivative's by construction. A square
crop would break that identity silently, and the public page would lay out every thumb against
the wrong ratio. If square thumbs are ever wanted, they need their own stored dimensions.

Format is **WebP with an explicit JPEG fallback**, decided 2026-09-06 against the roughly one
third of Pod storage and bandwidth per photo that JPEG-only would cost forever. This changes the
§7.3 fixture from `web.jpg` / `image/jpeg` to `web.webp` / `image/webp` — a normative edit to
`docs/data-model.md`, though not to a `dy:` term. It is safe only in company with the read-back
guard in §6.1.

## 6. The four silent failures, and what guards each

Each of these produces working-looking output and a green suite. They are listed together
because `where-i-go-review-lessons` records that this is the shape defects in this project take.

### 6.1 `convertToBlob` silently falls back to PNG

If the browser cannot encode the requested type, `OffscreenCanvas.convertToBlob` does not throw —
it returns PNG. The result is a 3 MB file named `web.webp`, served with the wrong content type,
and nothing anywhere reports an error.

**Guard: read `blob.type` back, and derive both the file extension and `schema:encodingFormat`
from the actual type, never from the requested one.** The requested type is an input to the
encoder and nothing else. This is what makes the WebP decision safe.

### 6.2 "It is already under 1600 px, skip the re-encode"

This is the dangerous one, and it is dangerous precisely because it reads as an optimisation.

**The re-encode IS the EXIF strip.** A canvas holds pixels and nothing else, so metadata is
dropped as a consequence of drawing and re-encoding, not by a separate stripping step. A
pass-through for already-small images would upload the original file with its GPS and device
metadata intact, to a publicly readable container — the exact outcome §9 exists to prevent.

**Guard: always re-encode, and assert it by parsing the uploaded bytes with `exifreader` and
requiring no GPS.** Asserting on the absence of a strip step would not survive a refactor;
asserting on the bytes does.

### 6.3 Orientation-swapped dimensions

An orientation-6 photo is stored 4032x3024 and displays 3024x4032. Code that computes target
dimensions from the file's recorded size before decoding gets both the aspect ratio and the
stored `schema:width`/`height` wrong.

**Guard: decode first, with `createImageBitmap(file, { imageOrientation: "from-image" })`, then
compute every target from `bitmap.width`/`bitmap.height`.** The bitmap is already rotated, so
production code does no orientation maths at all and the bug class is designed out rather than
handled. `PhotoMetadata.orientation` is carried for diagnostics only.

The test that proves it: an orientation-6 fixture whose output dimensions come back swapped.

### 6.4 Blur bloat

The blur rides in the entry TTL, which is publicly readable and fetched on every page view. A
20 px WebP is a few hundred bytes; a mis-sized one is tens of kilobytes, multiplied by photo
count, and nothing fails.

**Guard: a hard budget of 1200 bytes. Over it, the blur is dropped rather than written.** A
missing placeholder degrades to a plain image load. An oversized one degrades every reader's
first paint.

## 7. Upload, addressing, and the 412 that means success

Media path: `/travel/media/<sha256(file bytes).slice(0,16)>/`, hashed with `crypto.subtle.digest`.

Content-addressed, so re-picking the same photo is idempotent and the same photo used in two
entries uploads once. Sixteen hex characters is 64 bits; the §7.3 example's eight characters is
32 bits, which reaches a birthday collision at roughly 77,000 photos and is an illustration
rather than a specification.

The path is derivable from the file but not guessable without it, which leaves §4's existing
trade-off exactly where §4 put it: **a photo attached to an unpublished draft lives at a publicly
readable URL, and that is obscurity rather than access control.** This design does not change
that, and does not silently rely on it either — it is restated here so the next reader meets it.

**A re-upload hits `If-None-Match: *` and returns 412. That is success-with-reuse, not an
error.** Treating it as a failure would make re-picking a photo look broken while the Pod holds
exactly the right bytes.

The mechanism is **PUT first and interpret the 412**, not HEAD-then-PUT. One request in the
common case, and no window between the check and the write in which another tab creates the same
resource. A 412 on a content-addressed path means the bytes at that IRI are the bytes we were
about to write, so the upload returns that IRI and reports reuse.

`putGuarded`'s `body` widens from `string` to `string | Blob`, and the content type comes from
the blob's actual type (§6.1). Every guarded PUT in the project continues to go through that one
function; a second hand-rolled PUT is the blind PUT the precondition exists to prevent.

Two PUTs per photo — web and thumb. The blur is a literal and the original is not uploaded.

**Not touched here:** `putGuarded`'s known `extraHeaders` weakness, where a caller-supplied header
can overwrite a precondition. It is an existing `it.todo`, no call site does it, and this work
adds none. Naming it so the adjacency is not mistaken for a fix.

## 8. Editor integration

Photos upload **on pick**, immediately — decided 2026-09-06.

The editor therefore holds only JSON: URLs, dimensions, the blur string, caption and sortOrder.
This is what keeps phase 2's `localStorage` autosave working untouched, and it is the deciding
argument: a `Blob` cannot be autosaved, so upload-on-save would mean a browser refresh loses the
photos and a 12-photo entry turns one save into 37 requests with partial-failure states §10 does
not describe.

Per-photo state machine: `decoding -> uploading -> ready | failed`, with retry. **A failed photo
is simply absent from `photos[]` and never blocks the entry save.** One unreadable file must not
cost the owner the prose they just wrote.

**Accepted cost:** a photo picked and then abandoned leaves files in `/travel/media/` that nothing
references. There is no cleanup pass, and building one would mean enumerating the media container
against every entry in every trip — the Pod cannot be queried (invariant 2). Orphans are accepted
for phase 3 and recorded here so the decision is visible rather than discovered.

## 9. Access control

Media inherits `/travel/media/`'s public-children default, set at first run. No ACL is written
per photo. This follows §4's "media is one global container" decision, whose whole purpose is that
publishing never has to move binaries or rewrite references.

## 10. Testing

The pixel work cannot run under `npm test`: jsdom has no `createImageBitmap`, no
`OffscreenCanvas`, no `canvas.toBlob`. The split was chosen deliberately over vitest browser mode
(which would put a 178 MB browser behind the eight-command definition of done) and over a Node
canvas polyfill (which would verify a different encoder than the one that ships — the exact shape
of a test that is green over a real defect).

### vitest — the pure half

- `targets.ts`: box-fit maths including the never-upscale rule, extension/format resolution from
  an actual blob type, the blur budget boundary.
- `exif.ts`: against JPEGs from a **fixture builder, not committed binaries**.
- `upload.ts`: media IRI construction, hashing, and the 412-is-reuse path, against MSW.

**The fixture builder is proven, not proposed.** A throwaway probe on 2026-09-06 hand-built a
204-byte JPEG carrying an APP1/Exif segment — TIFF header, IFD0 with Orientation and both IFD
pointers, an Exif IFD with DateTimeOriginal, a GPS IFD with ref/rational pairs — and
`ExifReader.load(buf, { expanded: true })` read back:

```
gps:  { Latitude: 35.693799999999996, Longitude: 139.7034 }
exif: Orientation      { value: 6, description: "right-top" }
      DateTimeOriginal { description: "2026:03:29 21:38:02" }
```

Two things that settles. **`exifreader` returns signed decimal degrees with hemisphere refs
already applied**, so no DMS arithmetic belongs in our code. And a builder yields orientation,
hemisphere and missing-tag variants for free, where eight committed binaries would be eight opaque
files nobody can diff.

### Playwright — the pixel half

In `e2e/`, which the `components/studio/**` path gate already covers, so this adds no new
infrastructure requirement to the definition of done. A real fixture photo through the real
worker in a real browser, asserting:

1. output dimensions, including the orientation-6 swap;
2. `exifreader` finds **no GPS** in the uploaded bytes;
3. the blob's actual type matches what the filename and `schema:encodingFormat` claim.

### Mutations that must go red

Per `where-i-go-review-lessons`, watching a test go red before the implementation exists proves
the test runs, not that it checks the thing. Each of these is applied on purpose and reverted:

| Mutation | Must be caught by |
|---|---|
| Return the source blob unchanged when it is already small | Playwright: GPS found in uploaded bytes |
| Use the requested type instead of the actual type for extension and `encodingFormat` | Playwright: type/filename mismatch |
| Remove `imageOrientation: "from-image"` | Playwright: swapped dimensions |
| Remove the blur budget check | vitest: budget boundary |
| Treat a 412 on media PUT as an error | vitest: re-upload reuses the IRI |

**If a mutation does not go red, that is a finding about the test, not evidence there is no bug.**
Twice in this project's history the reason was a defect in the test.

## 11. Stage 2 — auto-place and auto-date

### Auto-place

`PhotoMetadata.gps` feeds **straight into the existing `fuzzForPublication`**. §9 steps 1-4 run
unchanged, before anything is written. There is no separate path for photo coordinates:

> "A photo's GPS is a coordinate like any other. It goes through steps 1-4 before anything is
> written, not after." — `docs/data-model.md` §9

This matters concretely, because `fuzzForPublication` is also the only thing that checks the home
region. A photo taken at home must drop its coordinate entirely rather than be coarsened — §9's
reasoning is that coarsening pins every home entry inside one cell whose centroid is the house,
and each new entry sharpens it.

Note that `exifreader` returns float noise (`35.693799999999996` above). Coordinates are
`xsd:decimal` and never float, and the grid snap quantises the noise away before serialisation —
so the noise is harmless *because* fuzzing runs first, which is one more reason nothing may
bypass it.

### Auto-date

Decided 2026-09-06: **prefill the wall clock, flag the offset.**

`DateTimeOriginal` has no timezone offset — confirmed by the probe. `dy:occurredAt` requires one,
and §7.3 is explicit that it "carries the local UTC offset of the place" because "normalising to
UTC destroys the fact that it was evening, which for a travel diary is most of the meaning".

`components/studio/entry-editor.tsx` already models this correctly: it holds a wall-clock string
and carries an offset alongside, with `toOffsetDateTime` documented to copy the stored offset
rather than recompute it, precisely so an entry edited from another time zone is not rewritten
into the editor's zone. Auto-date fits that model rather than changing it.

- `OffsetTimeOriginal` (0x9011) present -> use it. Modern phones write it.
- Absent -> prefill the wall clock from `DateTimeOriginal`, which genuinely is the time at the
  place, and **surface the offset as unconfirmed** with the machine's zone as a visible default.
  The owner sees `21:38 +02:00` and corrects it to `+09:00`.

The rejected alternative was deriving the offset from the photo's own GPS, which is almost always
exactly right including DST, and costs a timezone-boundary dataset in the studio bundle for a
field the owner can correct in two seconds.

`schema:dateCreated` on the ImageObject follows the same resolution.

## 12. Known limitation: HEIC

`createImageBitmap` decodes HEIC in Safari and **not** in Chrome or Firefox, and iPhones shoot
HEIC by default. iOS's file picker usually transcodes to JPEG on upload through
`<input type="file">`, but not in every path.

There is no dependency-free fix, and a decoder would be a large dependency for a format the
source device can usually be asked to avoid.

**The answer is an explicit, named error** — "this browser cannot read HEIC; export as JPEG" —
rather than a decode that fails obscurely. Written down here so it is a known limitation with a
clear message rather than a bug report about photos that silently do nothing.

## 13. Definition of done for this work

`CLAUDE.md`'s eight commands, on Node 22, with a Pod running before `npm test` — plus
`npm run test:e2e`, which this work triggers under the path gate by touching
`components/studio/**`.

Two project-specific cautions that apply directly here:

- **Run the checks agent-free**: `env -u CLAUDECODE -u AI_AGENT npm test`. `CLAUDECODE=1` makes
  vitest suppress ANSI, which has already hidden a real failure from a full CI reproduction.
  `docs/versions.md`, "Things agents get wrong on this stack".
- **`node -v` must print v22.x before anything.** `npm run` is not gated by `engine-strict`, so
  every command here runs and passes on the wrong runtime.

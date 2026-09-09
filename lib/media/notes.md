# lib/media — notes

Prose that outgrew a docblock, and findings recorded rather than acted on.
Section numbers are `docs/data-model.md`; decision numbers are
`docs/decisions.md`. Both stay the normative sources.

Everything in this directory is studio-only and never imported by
`app/(public)`; `no-restricted-imports` enforces that and `size:public` is the
real check.

## The worker is thin, and where the decisions live

A Web Worker is the least testable place in this project: jsdom has no
`createImageBitmap`, no `OffscreenCanvas` and no encoder, and a jsdom `Blob`
arrives at MSW as the nine bytes of the string `"undefined"` — measured
2026-09-06.

So every decision that can be made without pixels is made in `./targets.ts`
and `./exif.ts`, where a fast unit test can check it, and `./pipeline.worker.ts`
keeps only decode, draw and encode. Those three are verified in a real browser
by `e2e/media-pipeline.spec.ts`, which is the only place in this repository
where the bytes that actually reach the Pod are read back and inspected.

## The webworker reference, and the postMessage cast

`/// <reference lib="webworker" />` marks the execution context; it is not what
supplies the types. Measured 2026-09-06: `tsconfig`'s lib is
`["dom","dom.iterable","esnext"]`, which already declares `OffscreenCanvas`,
`createImageBitmap` and `ImageBitmap`, and typecheck is clean with the line
removed.

What the line does do is load `lib.webworker.d.ts` alongside `lib.dom.d.ts`,
whose 34 collision errors are invisible only because `skipLibCheck` is true —
turn that off and they appear inside `lib.dom.d.ts`, nowhere near this file.
`self` still resolves to `Window & typeof globalThis`, because dom wins, which
is why `postMessage` needs the cast: `Window.postMessage` takes a
`targetOrigin` and `Worker.postMessage` does not.

## The re-encode is the EXIF strip

A canvas holds pixels and nothing else, so metadata is dropped as a consequence
of drawing and re-encoding rather than by a separate step. There is no separate
strip to skip, which is exactly why a shortcut is dangerous: pass an already
small original straight through and its EXIF, GPS included, goes to a publicly
readable container.

The warning stays shouted above `run()` rather than only here. `CLAUDE.md`
names this file as its own gated e2e glob for the same reason: a change
confined to it touches none of the auth-seam paths, so nothing else would have
asked for the one test that catches it.

## Orientation is the decoder's job

`imageOrientation: "from-image"` means the bitmap arrives already rotated, so
every target is computed from `bitmap.width`/`height` and this directory does
no orientation maths at all — `exif.ts` returns `orientation` as information
only (§6.3).

An orientation-6 photo is stored 4032x3024 and displays 3024x4032. Computing
targets from the file's recorded size gets both the aspect ratio and the stored
`schema:width`/`schema:height` wrong.

## The encoder can answer a different type

`OffscreenCanvas.convertToBlob` does not throw when it cannot encode the type
asked for; it silently returns PNG. Two consequences, and both are load-bearing:

- The worker checks `candidate.type === type` and tries the next entry in
  `ENCODE_ORDER` rather than shipping a PNG under a WebP name.
- The file extension and `schema:encodingFormat` are derived from the type the
  blob actually has. A hardcoded `"webp"` anywhere in `./upload.ts` is a defect
  even where it looks harmless: it would ship a PNG named `web.webp`, served as
  `image/webp`, with nothing red.

`extensionFor` answering `undefined` for an unrecognised type is the other half
of that guard — the call site has to fail rather than write `web.undefined`,
which the Pod would accept.

## One worker, one photo, and no session in it

One worker and one photo at a time. Not one worker per photo and not a pool:
decoding a 50 MP image costs on the order of 200 MB of bitmap, so three in
flight is how a phone's browser tab gets killed in the middle of an edit.

**The authenticated fetch never crosses the boundary.** It is a closure over
the Inrupt session's token state and is not structured-cloneable, so uploads
happen on the main thread in `./upload.ts`. The worker owns bytes; the main
thread owns the network. That is invariant 4 falling out of a platform
limitation rather than being enforced by one.

The worker is spawned lazily inside `send()`, because the editor mounts on
every entry edit and most edits touch no photo — a worker at mount is a thread
and a chunk for nothing.

## dispose is not a cancel

`dispose()` does three separable things: terminates the worker, rejects
everything already in `pending`, and resets the queue tail so the instance
stays reusable.

**It is not a cancel.** A photo queued but not yet past `pending` is not in the
map to reject, so its send still runs, re-spawns a worker, and can resolve
after `dispose()` returns — into a UI that believes it was cancelled.

The only correct caller today is unmount cleanup, where that is harmless: the
worker is spawned lazily, so StrictMode's double effect at mount finds `worker`
null and this is a no-op. Anything else — a cancel button, an abort on
navigation — needs a generation counter compared inside the queue callback,
which `dispose` deliberately omits. Add it before the second caller, not after.

## Resetting the queue tail, and StrictMode

The last line of `dispose()` resets `queue`, and that keeps the instance
usable. `dispose()` is an effect cleanup in the studio editor and React double
invokes effects under StrictMode in development, so mount, dispose, mount again
on the same memoised instance is the dev default rather than an edge case.

Without the reset, a photo processed after that remount chains onto the
disposed lifecycle's tail and waits on a worker that was terminated. Making
`process()` throw instead would turn a StrictMode remount into a crash, which
is worse than the bug it would report.

## The stage 1 to stage 2 seam

`./exif.ts` is the seam between the two media stages. Stage 1 uses none of what
it returns — the pipeline strips metadata by re-encoding and needs to know
nothing about it to do so. Stage 2's auto-place and auto-date consume all of
it. The interface was pinned while stage 1 was written so that stage 2 would
not have to guess it.

## exifreader already applied the GPS refs

**Nothing in this directory does DMS arithmetic.** `exifreader` applies
`GPSLatitudeRef` and `GPSLongitudeRef` itself and hands back signed decimal
degrees — verified 2026-09-06 against a hand-built fixture, N/E and S/W.

Re-deriving the sign would be re-deriving something already correct, and
getting it wrong puts an entry in the wrong hemisphere with nothing to show for
it. `exifreader` 4.44.0 is the pinned reader; `exifr` in a diff is stale
training data (`docs/versions.md`).

## The camera with no clock set

Shape-only regex matching is not enough. A camera with no clock set writes the
literal sentinel `"0000:00:00 00:00:00"`, which matches `EXIF_DATE`'s digit
shape and would otherwise pass straight through as a plausible-looking ISO
string.

Stage 2's auto-date is told, by this module's own contract, to trust
`dateTimeOriginal`. So `isValidCalendarDate` rejects the sentinel here rather
than letting it surface as a wrong date on an entry later — which is why the
check is a real calendar check, leap years included, and not a range test.

## Content-addressed paths, and the obscurity they trade on

`travel/media/<sha256(file)[0..16]>/`, so re-picking one photo is idempotent
and the same photo in two entries uploads once. The path is derivable from the
file and not guessable without it, which leaves §4's trade-off exactly where §4
put it: a photo on an unpublished draft lives at a publicly readable URL, and
that is obscurity rather than access control.

§4 also puts media in one global container, outside any trip, so publishing
never has to move binaries or rewrite references. `lib/pod/access.ts` builds
the same `travel/media/` path from the Pod root — keep the two spellings in
step.

Every write here goes through `putGuarded`, which was widened to take a `Blob`
for exactly this reason: a second hand-rolled PUT for binaries is the blind PUT
the precondition exists to prevent (§10).

## Sixteen hex characters, not eight

`mediaHash` returns 64 bits of SHA-256 as lowercase hex. §7.3's eight-character
example is an illustration and not a spec: 32 bits reaches a birthday collision
at around 77,000 photos, and a collision here is not a broken link. It is one
photo silently served in place of another, because the 412 branch in
`putDerivative` would read the clash as "already uploaded".

## 412 is reuse, and nothing else is

A 412 on a content-addressed path means the bytes already there are the bytes
we were about to write, so `putDerivative` reports it as success.

**The check is exact on purpose, and that exactness is the whole guard.** One
careless widening — `if (!written.ok) return ok(null)`, or a catch-all around
the call — turns "treat 412 as reuse" into "treat every failure as success",
and the caller then writes an entry pointing at photos that were never
uploaded. A 507 must stay a 507. The 507 case in `lib/media/upload.test.ts` is
what holds this line; do not delete it alongside a refactor here.

## Why uploadPhoto returns a bare Result

Not `lib/pod/save-entry.ts`'s step report, and that difference is deliberate
rather than an oversight. Do not "fix" it.

There is a genuine partial-failure path: web can be written and thumb then
fail, leaving `web.<ext>` on the Pod while `uploadPhoto` returns an error. In
§10's entry sequence that shape is exactly why `saveEntry` returns a report
naming the completed steps and a `recovery` action — an entry written but
unlisted is invisible rather than absent, and a caller that cannot tell
"nothing happened" from "half-written" cannot reach `rebuildIndex`.

None of that applies here, for one reason: the path is content-addressed. A
retry with the same source bytes derives the same container, so the
already-written derivative answers `If-None-Match: *` with 412, which
`putDerivative` reads as reuse, and only the missing derivative is written. The
operation is idempotent, so "retry" *is* the recovery action: there is no
orphan to clean up and no state a caller could act on differently. A step
report would be a second thing to keep in step for no decision it enables,
which is worse than none.

That reasoning is load-bearing, so it is asserted rather than asserted-at.
`lib/media/upload.test.ts`, "reports a thumb-only failure as the thumb's, and
heals on retry", drives web and thumb to different statuses, because every
other failure test there answers one status to every PUT and so never reaches
this path at all. If that test goes red on its retry half, this note is wrong
and the return type has to be revisited.

The error returned is `putGuarded`'s, so it carries the failing derivative's
URL and the caller is never told "the upload failed" about a file that is
present.

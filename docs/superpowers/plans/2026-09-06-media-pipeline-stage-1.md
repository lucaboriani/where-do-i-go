# Media Pipeline (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick a photo in the studio, resize it in a Web Worker to a web-sized and a thumb-sized derivative plus a blur placeholder, read its EXIF, strip its metadata, upload the two derivatives to `/travel/media/`, and attach the result to the entry being edited.

**Architecture:** A Web Worker owns bytes (decode, draw, encode, read EXIF); the main thread owns the network (hash, address, PUT). The logic that can be pure is pure and lives outside the worker, because a worker is the least testable place in this project. Photos upload on pick, so the editor holds only JSON and phase 2's `localStorage` autosave keeps working untouched.

**Tech Stack:** TypeScript, Next 16.3.4 App Router, `exifreader@4.44.0`, `zod@4.5.4`, `n3`, Vitest 4.1.11 + MSW 2.15.0, Playwright 1.62.1, Community Solid Server 7.2.0.

**Spec:** `docs/superpowers/specs/2026-09-06-media-pipeline-design.md` — read it before Task 1. This plan argues from it and does not restate its reasoning.

**Stage 2 (manual place/date entry, then auto-fill from EXIF) is NOT in this plan.** It gets its own plan when this one lands. `lib/media/exif.ts`'s `PhotoMetadata` is the seam it will attach to, which is why Task 2 pins that type even though nothing in stage 1 consumes `gps` or `dateTimeOriginal`.

## Global Constraints

Every task's requirements implicitly include all of these. They are copied from `CLAUDE.md` and `docs/data-model.md`; where a value is exact, it is exact.

- **Select Node 22 before anything.** `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"`, then `node -v` must print `v22.x`. `npm run` is not gated by `engine-strict`, so every command below runs and passes on the wrong runtime. Checking is a step you do, not one the tooling does for you.
- **Run every check agent-free:** `env -u CLAUDECODE -u AI_AGENT npm test`. `CLAUDECODE=1` makes vitest suppress ANSI, which has already hidden a real failure from a full CI reproduction.
- **Start the Pod before `npm test`,** not just before `npm run build`: `npm run pod:dev`. Without it 23 integration tests skip and the run still reports green.
- **All IRIs come from `lib/vocab.ts`.** No predicate string literals anywhere else; enforced by `no-restricted-syntax`.
- **No blank nodes.** Fragments only (`#it`, `#place`, `#geo`, `#photo-1`).
- **Every write carries a precondition:** `If-None-Match: *` to create, `If-Match: <etag>` to update. A blind PUT is a bug.
- **Explicit datatypes:** `xsd:date`, `xsd:dateTime` with UTC offset, `xsd:decimal` for coordinates (never float), `xsd:integer` for counts.
- **Language-tag human-readable literals.** `dy:blurDataUrl` is the documented exception — a base64 data URI is not human-readable in any language.
- **`lib/media/**` and `exifreader` are studio-only,** enforced by `no-restricted-imports`. Nothing under `app/(public)` may reach them.
- **Arbitrary Tailwind values are banned outside `components/ui/**`.**
- **Compare RDF by graph isomorphism, never bytes.** Turtle has no canonical form.
- **Definition of done is eight commands**, plus `npm run test:e2e` because this work touches `components/studio/**`: `npm test`, `npm run lint`, `npm run typecheck`, `npm run validate:fixtures`, `npm run check:vocab`, `npm run check:commands`, `npm run build`, `npm run size:public`, `npm run test:e2e`.
- **"It should pass" is not done.** Never report work complete on the strength of a command you did not run or a result you did not read.

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `lib/media/targets.ts` | Pure: box-fit maths, format→extension resolution, the blur budget. No I/O, no DOM. |
| `lib/media/exif.ts` | Pure: `exifreader` tags → a Zod-validated `PhotoMetadata`. The stage-2 seam. |
| `lib/media/pipeline.worker.ts` | The only file touching `createImageBitmap` / `OffscreenCanvas`. Deliberately thin. |
| `lib/media/pipeline.ts` | Main-thread client: owns one worker, queues photos, typed request/response. |
| `lib/media/upload.ts` | Hashes, builds media IRIs, PUTs derivatives, returns a `Photo`. |
| `test/media-targets.test.ts` | Task 1 |
| `test/media-exif.test.ts` | Task 2 |
| `test/fixtures/exif-jpeg.ts` | EXIF JPEG builder. **Not a `.test.ts`, so vitest does not collect it.** Used by both vitest and Playwright. |
| `test/media-upload.test.ts` | Task 5 |
| `test/media-pipeline.test.ts` | Task 6 |
| `e2e/media-pipeline.spec.ts` | Task 8 — the pixel half |

**Modified**

| File | Change |
|---|---|
| `docs/data-model.md` | §3 gains `dy:blurDataUrl` and a note on `dy:originalUrl`; §7.3 gains the blur, loses `dy:originalUrl`, moves to WebP |
| `lib/vocab.ts` | `DY.blurDataUrl` |
| `lib/pod/schema.ts` | `Photo` gains `blurDataUrl`, `encodingFormat`, `dateCreated` |
| `lib/pod/entry-model.ts:153-179` | Serialise the three new fields; delete the "arrives in phase 3" comment |
| `lib/pod/read.ts:225-236` | Parse the three new fields |
| `lib/pod/write.ts:26-51` | `putGuarded` body widens to `string \| Blob` |
| `test/entry-write.test.ts:406-409` | The enumerated-omissions list becomes `[]` |
| `eslint.config.mjs:309` | Fence gains the bare-directory entry it is missing |
| `components/studio/entry-editor.tsx` | The photo picker and its per-photo state |
| `TODO.md` | Tick the phase 3 boxes this plan closes |

---

## Task 1: `lib/media/targets.ts` — the pure maths

**Files:**
- Create: `lib/media/targets.ts`
- Create: `test/media-targets.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `TARGETS`, `BLUR_BUDGET_BYTES`, `fitWithin(width: number, height: number, longestEdge: number): { width: number; height: number }`, `extensionFor(mimeType: string): string | undefined`, `withinBlurBudget(dataUrl: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `test/media-targets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BLUR_BUDGET_BYTES,
  TARGETS,
  extensionFor,
  fitWithin,
  withinBlurBudget,
} from "@/lib/media/targets";

/**
 * lib/media/targets.ts — everything about the resize that can be decided
 * without pixels. It is pure on purpose: jsdom has no decoder, so this is the
 * half of the pipeline a fast test can actually check, and the worker is kept
 * thin so that this half is the big one.
 */
describe("fitWithin", () => {
  it("scales a landscape photo to the longest edge, preserving aspect", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait photo by its longest edge, which is the height", () => {
    // The bug this catches is fitting to width unconditionally: a portrait
    // photo would come back 1600 wide and 2133 tall, i.e. LARGER than asked.
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("NEVER upscales a source smaller than the target", () => {
    // §5: upscaling inflates Pod storage to manufacture detail that is not
    // there. The source dimensions come straight back.
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(20, 15, 400)).toEqual({ width: 20, height: 15 });
  });

  it("leaves a photo already exactly at the target alone", () => {
    expect(fitWithin(1600, 1200, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    // 10000x3 scaled to 1600 gives a height of 0.48. A zero-height canvas
    // throws in the worker, so the floor is 1px and the aspect is sacrificed.
    expect(fitWithin(10000, 3, 1600)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(3, 10000, 1600)).toEqual({ width: 1, height: 1600 });
  });

  it("gives web and thumb the same aspect ratio, which is what lets us store only one", () => {
    // §4 stores no thumb dimensions because the ratios are identical by
    // construction. If that ever stops being true, the public page lays out
    // every thumb against the wrong box.
    const web = fitWithin(4000, 3000, TARGETS.web.longestEdge);
    const thumb = fitWithin(4000, 3000, TARGETS.thumb.longestEdge);
    expect(web.width / web.height).toBeCloseTo(thumb.width / thumb.height, 5);
  });
});

describe("extensionFor", () => {
  it("maps the three types the encoder can return", () => {
    expect(extensionFor("image/webp")).toBe("webp");
    expect(extensionFor("image/jpeg")).toBe("jpg");
    expect(extensionFor("image/png")).toBe("png");
  });

  it("ignores parameters and case, because blob.type is not normalised for us", () => {
    expect(extensionFor("IMAGE/JPEG")).toBe("jpg");
    expect(extensionFor("image/jpeg;charset=binary")).toBe("jpg");
  });

  it("returns undefined for a type it does not know, rather than guessing", () => {
    // §6.1: the extension comes from the ACTUAL blob type. An unknown type
    // must fail loudly at the call site, not produce `web.undefined`.
    expect(extensionFor("image/avif")).toBeUndefined();
    expect(extensionFor("")).toBeUndefined();
  });
});

describe("withinBlurBudget", () => {
  it("accepts a placeholder at the budget and rejects one over it", () => {
    // §6.4: the blur rides in a publicly readable TTL fetched on every page
    // view. Over budget it is dropped rather than written.
    expect(BLUR_BUDGET_BYTES).toBe(1200);
    expect(withinBlurBudget("d".repeat(BLUR_BUDGET_BYTES))).toBe(true);
    expect(withinBlurBudget("d".repeat(BLUR_BUDGET_BYTES + 1))).toBe(false);
  });

  it("measures bytes, not characters", () => {
    // A data URI is ASCII, but measuring `.length` would be wrong the moment
    // anything non-ASCII appears, and it is one call to be right.
    expect(withinBlurBudget("é".repeat(BLUR_BUDGET_BYTES))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH" && node -v
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-targets.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/media/targets"`. If it passes, stop: something else is exporting these names.

- [ ] **Step 3: Write the implementation**

Create `lib/media/targets.ts`:

```ts
/**
 * The part of the resize that needs no pixels. STUDIO ONLY — never imported by
 * app/(public); enforced by no-restricted-imports.
 *
 * This module exists so that the Web Worker can stay thin. A worker is the
 * least testable place in this project (jsdom has no createImageBitmap, no
 * OffscreenCanvas, no toBlob), so every decision that can be made here is made
 * here, where a fast test can check it.
 */

/** Longest edge in px, and the encoder quality for each derivative (§5). */
export const TARGETS = {
  web: { longestEdge: 1600, quality: 0.82 },
  thumb: { longestEdge: 400, quality: 0.75 },
  blur: { longestEdge: 20, quality: 0.5 },
} as const;

/**
 * The blur placeholder rides inside the entry's Turtle, which is publicly
 * readable and fetched on every page view (§6.4). Over this, it is dropped:
 * a missing placeholder degrades to a plain image load, an oversized one
 * degrades every reader's first paint, multiplied by photo count.
 */
export const BLUR_BUDGET_BYTES = 1200;

/**
 * Fit within a box by the longest edge, preserving aspect ratio.
 *
 * NEVER UPSCALES. A source smaller than the target is returned unchanged, so a
 * 800px photo stays 800px rather than being inflated to 1600px of invented
 * detail at Pod-quota cost.
 *
 * The 1px floor is not defensive tidying: an extreme aspect ratio rounds the
 * short edge to 0, and a zero-height OffscreenCanvas throws.
 */
export function fitWithin(
  width: number,
  height: number,
  longestEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= longestEdge) return { width, height };
  const scale = longestEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * The three types the canvas encoder can hand back.
 *
 * `undefined` for anything else is deliberate and is half of the §6.1 guard:
 * `convertToBlob` does not throw when it cannot encode the requested type, it
 * silently returns PNG. So the extension and `schema:encodingFormat` are
 * derived from the type the blob ACTUALLY has, and a type we do not recognise
 * has to fail at the call site rather than produce `web.undefined`.
 */
const EXTENSIONS: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

export function extensionFor(mimeType: string): string | undefined {
  return EXTENSIONS[mimeType.split(";")[0]!.trim().toLowerCase()];
}

/** Bytes, not characters — see the test. */
export function withinBlurBudget(dataUrl: string): boolean {
  return new TextEncoder().encode(dataUrl).length <= BLUR_BUDGET_BYTES;
}
```

- [ ] **Step 4: Run the test and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-targets.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Mutation-check the two rules that matter**

Watching a test go red before the implementation exists proves the test runs, not that it checks the thing. Apply each of these, run the test, confirm red, then revert:

1. Delete the `if (longest <= longestEdge) return { width, height };` line → the never-upscale test must fail.
2. Change `Math.max(width, height)` to `width` → the portrait test must fail.
3. Change `EXTENSIONS[…]` lookup to `?? "jpg"` → the unknown-type test must fail.

If any mutation does NOT go red, that is a finding about the test. Do not move on.

- [ ] **Step 6: Commit**

```bash
git add lib/media/targets.ts test/media-targets.test.ts
git commit -m "Media: the resize decisions that need no pixels"
```

---

## Task 2: `lib/media/exif.ts` and the fixture builder

**Files:**
- Create: `test/fixtures/exif-jpeg.ts`
- Create: `lib/media/exif.ts`
- Create: `test/media-exif.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `readMetadata(bytes: ArrayBuffer): PhotoMetadata` and the `PhotoMetadata` type — **the stage-2 seam**. Also `exifJpeg(options): Uint8Array` and `spliceExif(jpeg: Uint8Array, options): Uint8Array` from the fixture builder, both used again by Task 8.

**Why a builder and not committed photos.** The tests need variants — orientation 1/6/8, northern and southern hemispheres, a date with and without an offset, no EXIF at all, and outright garbage. Eight committed binaries are eight opaque files nobody can diff; one builder generates all of them and makes what went in exactly knowable, which is what gives the "no GPS came out" assertion in Task 8 its force.

**The builder code below is verified, not proposed.** It was run against `exifreader` on 2026-09-06 across all six variants and each read back correctly.

- [ ] **Step 1: Write the fixture builder**

Create `test/fixtures/exif-jpeg.ts`. It is **not** named `*.test.ts`, so `vitest.config.ts`'s `include` does not collect it — see the docblock in that file about `.tsx` being load-bearing.

```ts
/**
 * Build JPEGs carrying arbitrary EXIF, in bytes, with no dependency and no
 * committed binaries.
 *
 * Verified against exifreader 4.44.0 on 2026-09-06 for: N/E and S/W GPS,
 * orientation 6 and 8, DateTimeOriginal with and without OffsetTimeOriginal,
 * an empty EXIF block, and a bare JPEG with no APP1 segment at all.
 *
 * Little-endian ("II") throughout, because one byte order is enough and the
 * tests are about our code rather than about exifreader.
 */

/** Bytes per TIFF type: 2=ASCII, 3=SHORT, 4=LONG, 5=RATIONAL. */
const TYPE_SIZE: Record<number, number> = { 2: 1, 3: 2, 4: 4, 5: 8 };

type Field = { tag: number; type: number; count: number; value: Uint8Array | number };

const u8 = (n: number) => new Uint8Array(n);

function le(bytes: Uint8Array, offset: number, value: number, width: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (width === 2) view.setUint16(offset, value, true);
  else view.setUint32(offset, value, true);
}

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s + "\0");

const short = (v: number): Uint8Array => {
  const b = u8(4);
  le(b, 0, v, 2);
  return b;
};

const rationals = (pairs: [number, number][]): Uint8Array => {
  const b = u8(pairs.length * 8);
  pairs.forEach(([n, d], i) => {
    le(b, i * 8, n, 4);
    le(b, i * 8 + 4, d, 4);
  });
  return b;
};

function entryBytes(field: Field): Uint8Array {
  const e = u8(12);
  le(e, 0, field.tag, 2);
  le(e, 2, field.type, 2);
  le(e, 4, field.count, 4);
  if (typeof field.value === "number") le(e, 8, field.value, 4);
  else e.set(field.value.subarray(0, 4), 8);
  return e;
}

const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = u8(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/**
 * One IFD: a count, fixed 12-byte entries, a next-IFD pointer, then any value
 * too big to sit inline. A TIFF entry holds up to 4 bytes in place and an
 * offset otherwise, which is the only subtle part of this format.
 */
function layoutIfd(fields: Field[], ifdOffset: number): { bytes: Uint8Array; end: number } {
  const dirSize = 2 + fields.length * 12 + 4;
  let cursor = ifdOffset + dirSize;
  const entries: Uint8Array[] = [];
  const blobs: Uint8Array[] = [];

  for (const f of fields) {
    const size = TYPE_SIZE[f.type]! * f.count;
    if (typeof f.value === "number" || size <= 4) {
      entries.push(entryBytes(f));
    } else {
      entries.push(entryBytes({ ...f, value: cursor }));
      blobs.push(f.value);
      cursor += f.value.length;
    }
  }

  const count = u8(2);
  le(count, 0, fields.length, 2);
  return { bytes: concat([count, ...entries, u8(4), ...blobs]), end: cursor };
}

export type ExifOptions = {
  /** 1-8. 6 is "rotate 90° CW", the common phone-portrait case. */
  orientation?: number;
  /** EXIF spelling: "2026:03:29 21:38:02". Note the colons in the date. */
  dateTimeOriginal?: string;
  /** "+09:00". Absent on most cameras, which is the whole point of §11.5. */
  offsetTimeOriginal?: string;
  gps?: {
    latRef: "N" | "S";
    lat: [number, number][];
    longRef: "E" | "W";
    long: [number, number][];
  };
};

/** The TIFF block that sits inside the APP1 segment. */
export function exifTiff(options: ExifOptions): Uint8Array {
  const header = u8(8);
  header.set(new TextEncoder().encode("II"), 0);
  le(header, 2, 42, 2);
  le(header, 4, 8, 4);

  const exifFields: Field[] = [];
  if (options.dateTimeOriginal !== undefined) {
    exifFields.push({
      tag: 0x9003,
      type: 2,
      count: options.dateTimeOriginal.length + 1,
      value: ascii(options.dateTimeOriginal),
    });
  }
  if (options.offsetTimeOriginal !== undefined) {
    exifFields.push({
      tag: 0x9011,
      type: 2,
      count: options.offsetTimeOriginal.length + 1,
      value: ascii(options.offsetTimeOriginal),
    });
  }

  const gpsFields: Field[] = [];
  if (options.gps) {
    gpsFields.push({ tag: 0x0001, type: 2, count: 2, value: ascii(options.gps.latRef) });
    gpsFields.push({ tag: 0x0002, type: 5, count: 3, value: rationals(options.gps.lat) });
    gpsFields.push({ tag: 0x0003, type: 2, count: 2, value: ascii(options.gps.longRef) });
    gpsFields.push({ tag: 0x0004, type: 5, count: 3, value: rationals(options.gps.long) });
  }

  // IFD0's SIZE must be known before the sub-IFD offsets can be computed, and
  // the sub-IFD offsets are themselves IFD0 entries. So count first, lay out
  // the sub-IFDs, then push the pointers and lay out IFD0.
  const ifd0Fields: Field[] = [];
  if (options.orientation !== undefined) {
    ifd0Fields.push({ tag: 0x0112, type: 3, count: 1, value: short(options.orientation) });
  }
  const hasExif = exifFields.length > 0;
  const hasGps = gpsFields.length > 0;
  const ifd0Len = ifd0Fields.length + (hasExif ? 1 : 0) + (hasGps ? 1 : 0);
  const ifd0Offset = 8;
  const exifOffset = ifd0Offset + 2 + ifd0Len * 12 + 4;

  const exifLaid = hasExif ? layoutIfd(exifFields, exifOffset) : null;
  const gpsOffset = exifLaid ? exifLaid.end : exifOffset;
  const gpsLaid = hasGps ? layoutIfd(gpsFields, gpsOffset) : null;

  if (hasExif) ifd0Fields.push({ tag: 0x8769, type: 4, count: 1, value: exifOffset });
  if (hasGps) ifd0Fields.push({ tag: 0x8825, type: 4, count: 1, value: gpsOffset });

  const ifd0 = layoutIfd(ifd0Fields, ifd0Offset);
  return concat([
    header,
    ifd0.bytes,
    ...(exifLaid ? [exifLaid.bytes] : []),
    ...(gpsLaid ? [gpsLaid.bytes] : []),
  ]);
}

/** The complete APP1 segment: marker, length, "Exif\0\0", TIFF. */
export function exifApp1(options: ExifOptions): Uint8Array {
  const payload = concat([new TextEncoder().encode("Exif\0\0"), exifTiff(options)]);
  const marker = u8(4);
  marker[0] = 0xff;
  marker[1] = 0xe1;
  new DataView(marker.buffer).setUint16(2, payload.length + 2, false); // big-endian, per JPEG
  return concat([marker, payload]);
}

/**
 * A metadata-only JPEG: SOI, APP1, EOI. exifreader reads it happily; an image
 * decoder will not, because there are no pixels. That is fine for the unit
 * tests and is exactly why Task 8 uses `spliceExif` against a real JPEG.
 */
export function exifJpeg(options: ExifOptions = {}): Uint8Array {
  return concat([new Uint8Array([0xff, 0xd8]), exifApp1(options), new Uint8Array([0xff, 0xd9])]);
}

/** Insert an APP1 segment straight after a real JPEG's SOI marker. */
export function spliceExif(jpeg: Uint8Array, options: ExifOptions): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("spliceExif: not a JPEG (no SOI marker)");
  }
  return concat([jpeg.subarray(0, 2), exifApp1(options), jpeg.subarray(2)]);
}
```

- [ ] **Step 2: Write the failing test**

Create `test/media-exif.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exifJpeg } from "./fixtures/exif-jpeg";
import { readMetadata } from "@/lib/media/exif";

/**
 * lib/media/exif.ts, against JPEGs built byte by byte rather than committed.
 *
 * The fixtures are the point: what went in is knowable exactly, so "the GPS
 * came back" and "there was no GPS" are different assertions rather than two
 * readings of one opaque file.
 */
const bytesOf = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** Tokyo, 35.6938 N 139.7034 E — the §7.3 fixture's own coordinate. */
const TOKYO = {
  latRef: "N",
  lat: [[35, 1], [41, 1], [3768, 100]],
  longRef: "E",
  long: [[139, 1], [42, 1], [1224, 100]],
} as const;

/** Ushuaia, 54.8019 S 68.3030 W — both hemispheres negative. */
const USHUAIA = {
  latRef: "S",
  lat: [[54, 1], [48, 1], [687, 100]],
  longRef: "W",
  long: [[68, 1], [18, 1], [1080, 100]],
} as const;

describe("readMetadata", () => {
  it("reads northern/eastern GPS as positive decimal degrees", () => {
    const meta = readMetadata(bytesOf(exifJpeg({ gps: TOKYO })));
    expect(meta.gps?.lat).toBeCloseTo(35.6938, 4);
    expect(meta.gps?.long).toBeCloseTo(139.7034, 4);
  });

  it("reads southern/western GPS as NEGATIVE, which is the whole hemisphere question", () => {
    // exifreader applies GPSLatitudeRef/GPSLongitudeRef itself. Doing the DMS
    // arithmetic in our code would mean re-deriving a sign it already knows,
    // and getting it wrong puts an entry in the wrong hemisphere silently.
    const meta = readMetadata(bytesOf(exifJpeg({ gps: USHUAIA })));
    expect(meta.gps?.lat).toBeCloseTo(-54.8019, 4);
    expect(meta.gps?.long).toBeCloseTo(-68.303, 4);
  });

  it("returns no gps when the photo carries none", () => {
    // The common case: screenshots, scans, location services off. It must be
    // absent rather than {lat: 0, long: 0}, which is a real place off Africa.
    const meta = readMetadata(bytesOf(exifJpeg({ dateTimeOriginal: "2026:03:29 21:38:02" })));
    expect(meta.gps).toBeUndefined();
  });

  it("converts the EXIF date spelling to ISO, without inventing an offset", () => {
    // "2026:03:29 21:38:02" -> "2026-03-29T21:38:02". No trailing Z: there is
    // no offset in the tag, and appending one would assert UTC on a wall clock
    // that is local to the place (§11.5).
    const meta = readMetadata(bytesOf(exifJpeg({ dateTimeOriginal: "2026:03:29 21:38:02" })));
    expect(meta.dateTimeOriginal).toBe("2026-03-29T21:38:02");
    expect(meta.offsetTimeOriginal).toBeUndefined();
  });

  it("reads OffsetTimeOriginal when the camera wrote one", () => {
    const meta = readMetadata(
      bytesOf(exifJpeg({ dateTimeOriginal: "2026:03:29 21:38:02", offsetTimeOriginal: "+09:00" })),
    );
    expect(meta.offsetTimeOriginal).toBe("+09:00");
  });

  it("reads orientation", () => {
    expect(readMetadata(bytesOf(exifJpeg({ orientation: 6 }))).orientation).toBe(6);
    expect(readMetadata(bytesOf(exifJpeg({ orientation: 8 }))).orientation).toBe(8);
  });

  it("returns an empty result for a JPEG with an empty EXIF block", () => {
    expect(readMetadata(bytesOf(exifJpeg({})))).toEqual({});
  });

  it("returns an empty result for bytes that are not an image at all", () => {
    // Verified 2026-09-06: ExifReader.load throws Error("Invalid image format")
    // on garbage. A photo we cannot read metadata from is not an error — the
    // pipeline still resizes it — so this must not propagate.
    expect(readMetadata(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toEqual({});
    expect(readMetadata(new ArrayBuffer(0))).toEqual({});
  });
});
```

- [ ] **Step 3: Run it and read the failure**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-exif.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/media/exif"`.

- [ ] **Step 4: Write the implementation**

Create `lib/media/exif.ts`:

```ts
/**
 * EXIF, read once, in the worker. STUDIO ONLY.
 *
 * This module is the stage-1/stage-2 seam. Stage 1 uses none of what it
 * returns — the pipeline strips metadata by re-encoding, and needs to know
 * nothing about it to do so. Stage 2 (auto-place and auto-date) consumes all
 * of it. It is pinned now so that interface is not guessed later.
 *
 * NOTHING HERE DOES DMS ARITHMETIC. exifreader applies GPSLatitudeRef and
 * GPSLongitudeRef itself and hands back signed decimal degrees — verified
 * 2026-09-06 against a hand-built fixture, N/E and S/W. Re-deriving the sign
 * would be re-deriving something already correct, and getting it wrong puts an
 * entry in the wrong hemisphere with nothing to show for it.
 */
import ExifReader from "exifreader";
import { z } from "zod";

export const PhotoMetadata = z.object({
  /** Signed decimal degrees. Absent when the photo carries no GPS. */
  gps: z
    .object({
      lat: z.number().min(-90).max(90),
      long: z.number().min(-180).max(180),
    })
    .optional(),
  /** "YYYY-MM-DDTHH:mm:ss". NO offset — EXIF does not carry one here (§11.5). */
  dateTimeOriginal: z.string().optional(),
  /** "+09:00", when OffsetTimeOriginal (0x9011) is present. Usually absent. */
  offsetTimeOriginal: z.string().optional(),
  /** 1-8. Informational only: production code does no orientation maths (§6.3). */
  orientation: z.number().int().min(1).max(8).optional(),
});
export type PhotoMetadata = z.infer<typeof PhotoMetadata>;

/** EXIF spells a date "2026:03:29 21:38:02". Only the date half uses colons. */
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

export function readMetadata(bytes: ArrayBuffer): PhotoMetadata {
  let tags: ReturnType<typeof ExifReader.load>;
  try {
    tags = ExifReader.load(bytes, { expanded: true });
  } catch {
    // A file we cannot read metadata from is not a failure: the pipeline still
    // resizes it and the entry still saves. Verified that garbage throws
    // Error("Invalid image format") rather than returning empty.
    return {};
  }

  const candidate: PhotoMetadata = {};

  const lat = tags.gps?.Latitude;
  const long = tags.gps?.Longitude;
  if (finite(lat) && finite(long) && Math.abs(lat) <= 90 && Math.abs(long) <= 180) {
    candidate.gps = { lat, long };
  }

  const rawDate = tags.exif?.DateTimeOriginal?.description;
  const matched = typeof rawDate === "string" ? EXIF_DATE.exec(rawDate) : null;
  if (matched) {
    candidate.dateTimeOriginal = `${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}`;
  }

  const rawOffset = tags.exif?.OffsetTimeOriginal?.description;
  if (typeof rawOffset === "string" && OFFSET.test(rawOffset)) {
    candidate.offsetTimeOriginal = rawOffset;
  }

  const orientation = tags.exif?.Orientation?.value;
  if (finite(orientation) && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8) {
    candidate.orientation = orientation;
  }

  // Every field above is guarded, so this cannot fail — but validating on read
  // is the rule, and a silent {} beats a thrown exception inside a worker.
  const parsed = PhotoMetadata.safeParse(candidate);
  return parsed.success ? parsed.data : {};
}
```

- [ ] **Step 5: Run the test and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-exif.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Mutation-check**

Apply each, confirm red, revert:

1. Drop the `Math.abs(lat) <= 90` guard and feed `exifJpeg({ gps: { latRef: "N", lat: [[95,1],[0,1],[0,1]], … } })` — add that case if it is not caught; a latitude of 95 is not a latitude.
2. Change `EXIF_DATE` replacement to append `"Z"` → the no-invented-offset test must fail.
3. Remove the `try`/`catch` → the garbage-bytes test must fail with a thrown error.

- [ ] **Step 7: Confirm the fixture builder is not collected as a test**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest list --filesOnly | grep -c "exif-jpeg"
```

Expected: `0`. `test/vitest-collection.test.ts` exists because an uncollected file does not report red — it does not report. Here the requirement is the reverse, and it is checked the same way.

- [ ] **Step 8: Commit**

```bash
git add lib/media/exif.ts test/media-exif.test.ts test/fixtures/exif-jpeg.ts
git commit -m "Media: read EXIF, against JPEGs built byte by byte"
```

---

## Task 3: the entry can carry the three new photo fields

This is the data-model task, and it runs end to end in one commit **because the repository is red in the middle of it.** Removing `dy:originalUrl` from the §7.3 fixture makes `test/entry-write.test.ts`'s enumerated-omissions assertion fail; adding the serialisation makes it pass. Splitting the two would leave a commit that does not build.

**Files:**
- Modify: `docs/data-model.md` — §3 "Media and misc", §7.3 fixture
- Modify: `lib/vocab.ts` — the `DY` block, "Media and misc"
- Modify: `lib/pod/schema.ts:43-51` — `Photo`
- Modify: `lib/pod/entry-model.ts:153-179` — the photo serialisation block
- Modify: `lib/pod/read.ts:225-236` — the photo parsing block
- Modify: `test/entry-write.test.ts:406-409`

**Interfaces:**
- Consumes: nothing.
- Produces: `Photo` gains `blurDataUrl?: string`, `encodingFormat?: string`, `dateCreated?: string`. `DY.blurDataUrl`.

- [ ] **Step 1: Change the normative document first**

In `docs/data-model.md` §3, under "Media and misc", add and amend:

```markdown
- `dy:blurDataUrl` (`xsd:string`) — a tiny inline placeholder image as a `data:` URI. A plain
  literal, deliberately not language-tagged: base64 is not human-readable in any language, so §6's
  language-tag rule does not reach it. It rides in the entry so the placeholder arrives with the
  HTML and costs no second request; a budget in `lib/media/targets.ts` drops it rather than let it
  bloat a publicly readable resource.
- `dy:originalUrl` (IRI) — the unresized upload, if kept. **Nothing writes this.** Phase 3 decided
  against uploading originals: every view uses the web-sized derivative anyway, and an original at
  a public URL keeps full GPS and device metadata. The term stays reserved rather than deleted,
  because rule 4 makes a `dy:` term permanent and this is the record of what the namespace holds.
```

In the §7.3 Turtle fixture, replace the `<#photo-1>` block with:

```turtle
<#photo-1>
    a schema:ImageObject ;
    schema:contentUrl     <../../../media/6f2a1c8e/web.webp> ;
    schema:thumbnailUrl   <../../../media/6f2a1c8e/thumb.webp> ;
    schema:caption        "Counter seating, no menu."@en ;
    schema:width          1600 ;
    schema:height         1067 ;
    schema:encodingFormat "image/webp" ;
    schema:dateCreated    "2026-03-29T21:38:02+09:00"^^xsd:dateTime ;
    dy:blurDataUrl        "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==" ;
    dy:sortOrder          1 .
```

Then, in the notes under that fixture, add:

```markdown
- **The derivatives are WebP.** Roughly a third smaller than JPEG at equal quality, which is
  storage and bandwidth on someone's Pod forever. The encoder falls back to JPEG where WebP is
  unavailable, and `schema:encodingFormat` is written from the type the encoded blob ACTUALLY
  has — never from the type that was requested, because `convertToBlob` answers an unsupported
  request with PNG instead of an error.
- **`dy:originalUrl` is gone from this example** because nothing writes it; see §3.
```

- [ ] **Step 2: Run the two document checks and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npm run check:vocab
env -u CLAUDECODE -u AI_AGENT npm run validate:fixtures
```

Expected: `check:vocab` FAILS with "In the data model but NOT exported from lib/vocab.ts: - dy:blurDataUrl". `validate:fixtures` passes — the new literals are a plain string and an `xsd:dateTime` with an offset, both of which it already understands.

`dy:originalUrl` must NOT appear in `check:vocab`'s other list: the §3 note still mentions it, and that script scans prose as well as Turtle.

- [ ] **Step 3: Add the term to the vocabulary**

In `lib/vocab.ts`, in the `DY` block under `// Media and misc`:

```ts
  // Media and misc
  coverImage: dy("coverImage"),
  originalUrl: dy("originalUrl"),
  blurDataUrl: dy("blurDataUrl"),
  track: dy("track"),
  tag: dy("tag"),
```

- [ ] **Step 4: Run `check:vocab` again**

```bash
env -u CLAUDECODE -u AI_AGENT npm run check:vocab
```

Expected: PASS, "Vocabulary matches the data model in both directions."

- [ ] **Step 5: Run the entry-write suite and read the failure**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/entry-write.test.ts
```

Expected: FAIL on "matches the normative §7.3 fixture as a graph, inventing nothing" — the fixture no longer has `dy:originalUrl`, so `missingPredicates` is now two entries where the assertion names three. **This is the red that opens the task.** Read it and confirm that is the reason.

- [ ] **Step 6: Widen the `Photo` schema**

In `lib/pod/schema.ts`, replace the `Photo` object:

```ts
export const Photo = z.object({
  contentUrl: z.url(),
  thumbnailUrl: z.url().optional(),
  caption: LangText.optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
  /** The blob's ACTUAL media type, e.g. "image/webp" (§6.1). */
  encodingFormat: z.string().optional(),
  /** From EXIF DateTimeOriginal. Offset required, like every other timestamp. */
  dateCreated: z.iso.datetime({ offset: true }).optional(),
  /** A `data:` URI placeholder, budgeted by lib/media/targets.ts. */
  blurDataUrl: z.string().optional(),
});
```

- [ ] **Step 7: Serialise the three fields**

In `lib/pod/entry-model.ts`, inside the `e.photos.forEach` block, replace the closing comment (the one beginning "schema:encodingFormat, schema:dateCreated and dy:originalUrl are in the §7.3 fixture and are NOT written here") with:

```ts
    if (photo.encodingFormat) {
      quads.push(quad(node, namedNode(SCHEMA.encodingFormat), text(photo.encodingFormat)));
    }
    if (photo.dateCreated) {
      quads.push(quad(node, namedNode(SCHEMA.dateCreated), dateTime(photo.dateCreated)));
    }
    /**
     * A plain literal, NOT language-tagged. §6 asks for a language tag on
     * human-readable literals; base64 is not human-readable in any language,
     * and tagging it would assert that it is prose in some tongue.
     *
     * dy:originalUrl is deliberately never written: phase 3 decided against
     * uploading originals, and §3 records the term as reserved rather than
     * live. If a fourth photo predicate is ever added and left unwritten, say
     * so here — test/entry-write.test.ts enumerates what §7.3 has that we do
     * not, so a silent omission turns the suite red rather than vanishing.
     */
    if (photo.blurDataUrl) {
      quads.push(quad(node, namedNode(DY.blurDataUrl), plain(photo.blurDataUrl)));
    }
```

**Before writing this, read the top of `lib/pod/entry-model.ts`** and use the literal helpers it already defines. `text()` is the language-tagged one used for captions; find or add the plain-literal helper (`plain`) and the `xsd:dateTime` helper (`dateTime`) — `serialiseEntry` already writes `schema:datePublished` and `dy:occurredAt`, so a dateTime helper exists under some name. Do not introduce a second spelling of either.

- [ ] **Step 8: Parse the three fields on read**

In `lib/pod/read.ts`, in the photo mapping block:

```ts
      .map((p) => ({
        contentUrl: p.one(SCHEMA.contentUrl),
        thumbnailUrl: p.one(SCHEMA.thumbnailUrl),
        caption: langText(p, SCHEMA.caption),
        width: take(integer(p, SCHEMA.width, url)),
        height: take(integer(p, SCHEMA.height, url)),
        sortOrder: take(integer(p, DY.sortOrder, url)),
        encodingFormat: p.typed(SCHEMA.encodingFormat)?.value,
        dateCreated: take(offsetDateTime(p, SCHEMA.dateCreated, url)),
        blurDataUrl: p.typed(DY.blurDataUrl)?.value,
      }))
```

Match the accessor names this file already uses — `p.one(…)` for IRIs, `p.typed(…)` for literals, `offsetDateTime(…)` for `xsd:dateTime` with an offset. Read the surrounding 40 lines first rather than assuming these spellings.

- [ ] **Step 9: Update the enumerated-omissions assertion**

In `test/entry-write.test.ts`, replace the assertion and rewrite the docblock above it so it does not describe a state that no longer exists — a comment arguing for the old behaviour is worse than no comment:

```ts
    /**
     * NOTHING is missing any more. Until phase 3 this list held three photo
     * predicates the media pipeline had not yet produced; the pipeline now
     * writes encodingFormat and dateCreated, and dy:originalUrl left the
     * fixture because nothing writes it (§3, §7.3).
     *
     * The list stays enumerated rather than becoming `expect(missing).toEqual([])`
     * on its own, because the failure it must catch is "we quietly stopped
     * writing a triple", and an empty array is the assertion that says so.
     *
     * dcterms:created and dcterms:creator are still NOT here even though
     * `Entry` has no field for either: §7.3 says created and datePublished
     * "are not redundant … they differ by however long the draft sat". An edit
     * that drops created destroys that silently on the first save after
     * publication, so the model has to grow the two fields — a schema change,
     * not a vocabulary one.
     */
    const missingPredicates = [...new Set(missing.map((t) => t.split(" ")[1]))].sort();
    expect(missingPredicates).toEqual([]);
```

- [ ] **Step 10: Update the fixture the test round-trips**

`specEntry()` in that file builds the `Entry` compared against §7.3. Give its photo the three new fields so the graph comparison has them to write:

```ts
      photos: [
        {
          contentUrl: `${MEDIA}web.webp`,
          thumbnailUrl: `${MEDIA}thumb.webp`,
          caption: { value: "Counter seating, no menu.", lang: "en" },
          width: 1600,
          height: 1067,
          sortOrder: 1,
          encodingFormat: "image/webp",
          dateCreated: "2026-03-29T21:38:02+09:00",
          blurDataUrl:
            "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==",
        },
      ],
```

Match the existing spellings in that file for `caption` (`LangText` shape) and for how `MEDIA` is built. Read it rather than pasting blind.

- [ ] **Step 11: Run the full suite and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npm test
```

Expected: PASS. Note the total — it should be 872 plus Task 1's 11 and Task 2's 8. If the count did not move by the number of tests you added, a file is not being collected.

- [ ] **Step 12: Mutation-check the round trip**

1. Delete the `blurDataUrl` line from the read mapping in `read.ts` → the "round-trips through readEntry" whole-object equality test must fail. If it does not, that test is not comparing whole objects.
2. Change `plain(photo.blurDataUrl)` to `text(photo.blurDataUrl)` (language-tagging it) → the graph comparison's `extra` direction must fail, because the fixture has a plain literal.

- [ ] **Step 13: Commit**

```bash
git add docs/data-model.md lib/vocab.ts lib/pod/schema.ts lib/pod/entry-model.ts lib/pod/read.ts test/entry-write.test.ts
git commit -m "Entries carry a blur placeholder, a format and a capture time"
```

---

## Task 4: `putGuarded` accepts a Blob

**Files:**
- Modify: `lib/pod/write.ts:26-51`
- Modify: `test/write-primitives.test.ts`
- Modify: `eslint.config.mjs:309`

**Interfaces:**
- Consumes: nothing.
- Produces: `putGuarded(fetch, url, body: string | Blob, precondition, contentType?, extraHeaders?)`.

- [ ] **Step 1: Write the failing test**

Add to `test/write-primitives.test.ts`, inside the `putGuarded` describe block:

```ts
  it("PUTs a Blob body with its own content type, still under a precondition", async () => {
    // The media pipeline uploads binaries. Widening the body type is what lets
    // every guarded write in the project keep going through this one function:
    // a second hand-rolled PUT for binaries is a blind PUT waiting to happen.
    const seen: { contentType: string | null; ifNoneMatch: string | null; bytes: number }[] = [];
    server.use(
      http.put(`${POD}travel/media/deadbeef/web.webp`, async ({ request }) => {
        seen.push({
          contentType: request.headers.get("content-type"),
          ifNoneMatch: request.headers.get("if-none-match"),
          bytes: (await request.arrayBuffer()).byteLength,
        });
        return new HttpResponse(null, { status: 201, headers: { etag: '"w1"' } });
      }),
    );

    const blob = new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "image/webp" });
    const result = await putGuarded(
      fetch as PodFetch,
      `${POD}travel/media/deadbeef/web.webp`,
      blob,
      { create: true },
      "image/webp",
    );

    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.contentType).toBe("image/webp");
    // The precondition is the point: a binary write is not exempt from it.
    expect(seen[0]!.ifNoneMatch).toBe("*");
    // Assert the BODY arrived, not just the headers. A widening that dropped
    // the body would pass every header assertion above.
    expect(seen[0]!.bytes).toBe(5);
  });
```

- [ ] **Step 2: Run it and read the failure**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/write-primitives.test.ts
```

Expected: FAIL at typecheck/runtime — `Blob` is not assignable to `string`.

- [ ] **Step 3: Widen the signature**

In `lib/pod/write.ts`, change the `body` parameter and add to the docblock:

```ts
export async function putGuarded(
  fetch: PodFetch,
  url: string,
  /**
   * Turtle, or binary. The media pipeline (phase 3) uploads image derivatives,
   * and they go through this function rather than a second hand-rolled PUT for
   * exactly the reason the precondition exists: a separate write path is a
   * blind write path waiting to happen.
   */
  body: string | Blob,
  precondition: Precondition,
  contentType = "text/turtle",
  extraHeaders?: Record<string, string>,
): Promise<Result<{ etag: string | null }>> {
```

No other change is needed — `fetch` accepts a `Blob` body directly.

- [ ] **Step 4: Run the test and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/write-primitives.test.ts
env -u CLAUDECODE -u AI_AGENT npm run typecheck
```

Expected: both PASS.

- [ ] **Step 5: Close the hole in the media import fence**

`eslint.config.mjs:309` reads `group: ["exifreader", "**/lib/media/**"]`. The `lib/studio` fence two entries above it names **both** the bare directory and the subpath — `["**/lib/studio", "**/lib/studio/**"]` — and its comment says why: "naming `session` alone would leave every other studio module reachable".

`no-restricted-imports` matches `group` with **gitignore semantics, not minimatch**, so `**/lib/media/**` does not match a bare `@/lib/media` import. There is no index file today, so this is latent rather than live — which is precisely the shape `TODO.md` records for the radix fence: "the suite was green on a fence with a hole in it."

```js
            {
              // The bare directory AND the subpath, matching the lib/studio
              // fence above. no-restricted-imports uses gitignore semantics,
              // so "**/lib/media/**" alone does not match a bare
              // "@/lib/media" import resolving to an index file. There is no
              // index today; this closes it before there is one.
              group: ["exifreader", "**/lib/media", "**/lib/media/**"],
              message:
                "Image-processing code is studio-only; it must not weigh down the public bundle.",
            },
```

- [ ] **Step 6: Verify the fence on disk, not as a snippet**

`test/guardrails.test.ts` lints allow-cases and deny-cases as real files. Add a deny-case importing `@/lib/media` (bare) and confirm it is reported. Read that file's existing cases first and follow their shape — its own fixtures live inside `const msgs = await lint(…)`, which is why the rule's selector cannot use a descendant match.

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/guardrails.test.ts
env -u CLAUDECODE -u AI_AGENT npm run lint
```

Expected: both PASS, with the new deny-case reported.

- [ ] **Step 7: Commit**

```bash
git add lib/pod/write.ts test/write-primitives.test.ts eslint.config.mjs test/guardrails.test.ts
git commit -m "putGuarded takes a Blob; close the bare-directory hole in the media fence"
```

---

## Task 5: `lib/media/upload.ts` — address, PUT, and the 412 that means success

**Files:**
- Create: `lib/media/upload.ts`
- Create: `test/media-upload.test.ts`

**Interfaces:**
- Consumes: `extensionFor` from Task 1; `putGuarded` from Task 4; `Photo` from Task 3; `Result`/`err`/`ok` from `lib/pod/result`; `PodFetch` from `lib/pod/rdf`.
- Produces:
  - `mediaHash(bytes: ArrayBuffer): Promise<string>` — 16 lowercase hex characters.
  - `mediaContainer(podRoot: string, hash: string): string`
  - `uploadPhoto(opts: { fetch: PodFetch; podRoot: string; source: ArrayBuffer; derivatives: { web: { blob: Blob; width: number; height: number }; thumb: { blob: Blob } }; blurDataUrl?: string; caption?: { value: string; lang: string }; sortOrder?: number }): Promise<Result<Photo>>`

- [ ] **Step 1: Write the failing test**

Create `test/media-upload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./msw";
import { mediaContainer, mediaHash, uploadPhoto } from "@/lib/media/upload";
import type { PodFetch } from "@/lib/pod/rdf";

/**
 * lib/media/upload.ts at the HTTP boundary, MSW rather than a stubbed fetch —
 * same reasoning as test/write-primitives.test.ts: the precondition rule is
 * about what goes on the wire.
 */
const POD = "https://pod.test.example/";

const blobOf = (bytes: number[], type: string) => new Blob([new Uint8Array(bytes)], { type });

const derivatives = () => ({
  web: { blob: blobOf([1, 2, 3], "image/webp"), width: 1600, height: 1067 },
  thumb: { blob: blobOf([4, 5], "image/webp") },
});

describe("mediaHash", () => {
  it("is 16 lowercase hex characters, and is stable for the same bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const a = await mediaHash(bytes);
    const b = await mediaHash(new Uint8Array([1, 2, 3, 4]).buffer);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
  });

  it("differs for different bytes", async () => {
    const a = await mediaHash(new Uint8Array([1, 2, 3, 4]).buffer);
    const b = await mediaHash(new Uint8Array([1, 2, 3, 5]).buffer);
    expect(a).not.toBe(b);
  });
});

describe("mediaContainer", () => {
  it("addresses the one global media container from §4", () => {
    expect(mediaContainer(POD, "6f2a1c8e6f2a1c8e")).toBe(
      `${POD}travel/media/6f2a1c8e6f2a1c8e/`,
    );
  });
});

describe("uploadPhoto", () => {
  it("PUTs both derivatives and returns a Photo pointing at them", async () => {
    const puts: string[] = [];
    server.use(
      http.put(`${POD}travel/media/*/*`, ({ request }) => {
        puts.push(new URL(request.url).pathname);
        return new HttpResponse(null, { status: 201, headers: { etag: '"1"' } });
      }),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([9, 9, 9]).buffer,
      derivatives: derivatives(),
      blurDataUrl: "data:image/webp;base64,AAAA",
      sortOrder: 1,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(puts).toHaveLength(2);
    expect(result.value.contentUrl).toMatch(/travel\/media\/[0-9a-f]{16}\/web\.webp$/);
    expect(result.value.thumbnailUrl).toMatch(/travel\/media\/[0-9a-f]{16}\/thumb\.webp$/);
    expect(result.value.width).toBe(1600);
    expect(result.value.height).toBe(1067);
    // §6.1: the format is the blob's ACTUAL type.
    expect(result.value.encodingFormat).toBe("image/webp");
    expect(result.value.blurDataUrl).toBe("data:image/webp;base64,AAAA");
  });

  it("names the file from the blob's ACTUAL type when the encoder fell back", async () => {
    // convertToBlob answers an unsupported request with PNG rather than an
    // error. If the extension came from what we ASKED for, this ships a PNG
    // called web.webp, served as image/webp, and nothing anywhere complains.
    server.use(
      http.put(`${POD}travel/media/*/*`, () => new HttpResponse(null, { status: 201 })),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([7]).buffer,
      derivatives: {
        web: { blob: blobOf([1], "image/png"), width: 800, height: 600 },
        thumb: { blob: blobOf([2], "image/png") },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentUrl).toMatch(/web\.png$/);
    expect(result.value.encodingFormat).toBe("image/png");
  });

  it("treats 412 as reuse, not failure — the same photo twice is one upload", async () => {
    // §7: the path is content-addressed, so If-None-Match: * on a re-upload
    // means "those exact bytes are already there". Reporting it as an error
    // would make re-picking a photo look broken while the Pod holds precisely
    // the right file.
    server.use(
      http.put(`${POD}travel/media/*/*`, () => new HttpResponse(null, { status: 412 })),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([1]).buffer,
      derivatives: derivatives(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.contentUrl).toMatch(/web\.webp$/);
  });

  it("fails on a real HTTP error rather than pretending the photo uploaded", async () => {
    server.use(
      http.put(`${POD}travel/media/*/*`, () => new HttpResponse(null, { status: 507 })),
    );

    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([1]).buffer,
      derivatives: derivatives(),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ kind: "http", status: 507 });
  });

  it("refuses a blob type it cannot name, instead of writing web.undefined", async () => {
    const result = await uploadPhoto({
      fetch: fetch as PodFetch,
      podRoot: POD,
      source: new Uint8Array([1]).buffer,
      derivatives: {
        web: { blob: blobOf([1], "image/avif"), width: 10, height: 10 },
        thumb: { blob: blobOf([2], "image/avif") },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("shape");
  });
});
```

- [ ] **Step 2: Run it and read the failure**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-upload.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/media/upload"`.

- [ ] **Step 3: Write the implementation**

Create `lib/media/upload.ts`:

```ts
/**
 * Put image derivatives on the Pod and describe them as a `Photo`. STUDIO ONLY.
 *
 * THE PATH IS CONTENT-ADDRESSED. `/travel/media/<sha256(file)[0..16]>/`, so
 * re-picking one photo is idempotent and the same photo in two entries uploads
 * once. Derivable from the file, not guessable without it — which leaves §4's
 * trade-off exactly where §4 put it: a photo on an unpublished draft lives at a
 * publicly readable URL, and that is obscurity rather than access control.
 *
 * THE EXTENSION AND THE FORMAT COME FROM THE BLOB, NEVER FROM WHAT WAS ASKED
 * FOR. `OffscreenCanvas.convertToBlob` does not throw when it cannot encode the
 * requested type; it silently returns PNG. Deriving either from the request
 * would ship a PNG named web.webp, served as image/webp, with nothing red.
 */
import { extensionFor } from "./targets";
import { putGuarded } from "@/lib/pod/write";
import { err, ok, type Result } from "@/lib/pod/result";
import type { PodFetch } from "@/lib/pod/rdf";
import type { LangText, Photo } from "@/lib/pod/schema";

/** 64 bits of SHA-256. The §7.3 example's eight characters is an illustration:
 *  32 bits reaches a birthday collision around 77,000 photos. */
export async function mediaHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/** §4: media is one global container, outside any trip, so publishing never has
 *  to move binaries or rewrite references. */
export function mediaContainer(podRoot: string, hash: string): string {
  const root = podRoot.endsWith("/") ? podRoot : `${podRoot}/`;
  return `${root}travel/media/${hash}/`;
}

type Derivative = { blob: Blob; width?: number; height?: number };

export type UploadPhotoOptions = {
  /** The visitor's own authenticated fetch, held only in their browser
   *  (invariant 4). Never defaulted to the ambient one. */
  fetch: PodFetch;
  podRoot: string;
  /** The ORIGINAL file bytes. Hashed for the path; never uploaded (§9). */
  source: ArrayBuffer;
  derivatives: { web: Derivative & { width: number; height: number }; thumb: Derivative };
  blurDataUrl?: string;
  caption?: LangText;
  sortOrder?: number;
};

/** A 412 on a content-addressed path means the bytes already there ARE the
 *  bytes we were about to write. That is reuse, not failure. */
async function putDerivative(
  fetch: PodFetch,
  url: string,
  blob: Blob,
): Promise<Result<null>> {
  const written = await putGuarded(fetch, url, blob, { create: true }, blob.type);
  if (written.ok) return ok(null);
  if (written.error.kind === "http" && written.error.status === 412) return ok(null);
  return err(written.error);
}

export async function uploadPhoto(opts: UploadPhotoOptions): Promise<Result<Photo>> {
  const { web, thumb } = opts.derivatives;

  const webExt = extensionFor(web.blob.type);
  const thumbExt = extensionFor(thumb.blob.type);
  if (!webExt || !thumbExt) {
    return err({
      kind: "shape",
      url: opts.podRoot,
      issues: [
        `cannot name a file for media type "${web.blob.type}" / "${thumb.blob.type}" — ` +
          "the encoder returned something this app does not write",
      ],
    });
  }

  const container = mediaContainer(opts.podRoot, await mediaHash(opts.source));
  const contentUrl = `${container}web.${webExt}`;
  const thumbnailUrl = `${container}thumb.${thumbExt}`;

  const wrote = await putDerivative(opts.fetch, contentUrl, web.blob);
  if (!wrote.ok) return err(wrote.error);
  const wroteThumb = await putDerivative(opts.fetch, thumbnailUrl, thumb.blob);
  if (!wroteThumb.ok) return err(wroteThumb.error);

  return ok({
    contentUrl,
    thumbnailUrl,
    width: web.width,
    height: web.height,
    encodingFormat: web.blob.type,
    ...(opts.blurDataUrl === undefined ? {} : { blurDataUrl: opts.blurDataUrl }),
    ...(opts.caption === undefined ? {} : { caption: opts.caption }),
    ...(opts.sortOrder === undefined ? {} : { sortOrder: opts.sortOrder }),
  });
}
```

If `LangText` is not exported from `lib/pod/schema.ts` under that name, read the file and use whatever the caption's type is actually called.

- [ ] **Step 4: Run the test and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-upload.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Mutation-check**

1. Change `encodingFormat: web.blob.type` to `encodingFormat: "image/webp"` → the fallback test must fail.
2. Change `extensionFor(web.blob.type)` to a hardcoded `"webp"` → the fallback test must fail.
3. Remove the 412 branch from `putDerivative` → the reuse test must fail.
4. Change the 412 branch to catch every error → the 507 test must fail. **Run this one:** it is the guard that stops "treat 412 as success" from becoming "treat everything as success".

- [ ] **Step 6: Commit**

```bash
git add lib/media/upload.ts test/media-upload.test.ts
git commit -m "Media: content-addressed upload, and the 412 that means reuse"
```

---

## Task 6: the worker and its client

**Files:**
- Create: `lib/media/pipeline.worker.ts`
- Create: `lib/media/pipeline.ts`
- Create: `test/media-pipeline.test.ts`

**Interfaces:**
- Consumes: `TARGETS`, `fitWithin`, `withinBlurBudget` from Task 1; `readMetadata`, `PhotoMetadata` from Task 2.
- Produces: `createPipeline(spawn?: () => WorkerLike): Pipeline` with `Pipeline.process(file: Blob): Promise<PipelineResult>` and `Pipeline.dispose(): void`; the `PipelineResult` type.

**What is and is not tested here.** The worker's body cannot run under vitest — no `createImageBitmap`, no `OffscreenCanvas`. What *is* testable is the client: that it queues rather than parallelises, that it rejects on a worker error, and that `dispose()` terminates. The pixels are Task 8's job. Do not fake a canvas to manufacture coverage here; it would verify a different encoder than the one that ships.

- [ ] **Step 1: Write the worker**

Create `lib/media/pipeline.worker.ts`:

```ts
/// <reference lib="webworker" />
/**
 * Bytes in, derivatives and metadata out. STUDIO ONLY.
 *
 * DELIBERATELY THIN. A worker is the least testable place in this project, so
 * everything decidable without pixels lives in ./targets.ts and ./exif.ts and
 * is unit-tested there. What is left here is decode, draw, encode — and that
 * is verified in a real browser by e2e/media-pipeline.spec.ts.
 *
 * THE RE-ENCODE IS THE EXIF STRIP. A canvas holds pixels and nothing else, so
 * metadata is dropped as a consequence of drawing and re-encoding rather than
 * by a separate step. DO NOT add a "it is already small enough, pass the
 * original through" shortcut: it reads as an optimisation and it uploads the
 * user's GPS to a publicly readable container.
 *
 * ORIENTATION IS HANDLED BY THE DECODER. `imageOrientation: "from-image"`
 * means the bitmap arrives already rotated, so every target is computed from
 * bitmap.width/height and this file does no orientation maths at all. An
 * orientation-6 photo is stored 4032x3024 and displays 3024x4032; computing
 * targets from the file's recorded size gets both the aspect ratio and the
 * stored schema:width/height wrong.
 */
import { readMetadata } from "./exif";
import { TARGETS, fitWithin, withinBlurBudget } from "./targets";

export type WorkerRequest = { id: number; file: Blob };
export type WorkerResponse =
  | { id: number; ok: true; result: TransferableResult }
  | { id: number; ok: false; message: string };

export type TransferableResult = {
  web: { blob: Blob; width: number; height: number };
  thumb: { blob: Blob; width: number; height: number };
  blurDataUrl?: string;
  metadata: ReturnType<typeof readMetadata>;
};

/** Preferred first, then the fallback. §6.1: what comes back is what counts. */
const ENCODE_ORDER = ["image/webp", "image/jpeg"] as const;

async function encode(
  bitmap: ImageBitmap,
  longestEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, longestEdge);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("no 2d context in this worker");
  context.drawImage(bitmap, 0, 0, width, height);

  let blob: Blob | null = null;
  for (const type of ENCODE_ORDER) {
    const candidate = await canvas.convertToBlob({ type, quality });
    // convertToBlob does NOT throw on an unsupported type — it returns PNG.
    // So the check is on what came back, and we try the next type rather than
    // shipping a PNG under a WebP name.
    if (candidate.type === type) return { blob: candidate, width, height };
    blob = candidate;
  }
  // Both requests fell back. Return the fallback honestly: upload.ts names the
  // file from blob.type, so a PNG is stored as a PNG or refused outright.
  if (!blob) throw new Error("the canvas encoded nothing");
  return { blob, width, height };
}

async function run(file: Blob): Promise<TransferableResult> {
  const bytes = await file.arrayBuffer();
  const metadata = readMetadata(bytes);

  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const web = await encode(bitmap, TARGETS.web.longestEdge, TARGETS.web.quality);
    const thumb = await encode(bitmap, TARGETS.thumb.longestEdge, TARGETS.thumb.quality);
    const blur = await encode(bitmap, TARGETS.blur.longestEdge, TARGETS.blur.quality);

    const buffer = await blur.blob.arrayBuffer();
    let binary = "";
    for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    const dataUrl = `data:${blur.blob.type};base64,${btoa(binary)}`;

    return {
      web,
      thumb,
      ...(withinBlurBudget(dataUrl) ? { blurDataUrl: dataUrl } : {}),
      metadata,
    };
  } finally {
    // Free ~200 MB of bitmap for a 50 MP photo rather than waiting for GC.
    bitmap.close();
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const { id, file } = event.data;
  run(file).then(
    (result) => (self as unknown as Worker).postMessage({ id, ok: true, result } satisfies WorkerResponse),
    (cause: unknown) =>
      (self as unknown as Worker).postMessage({
        id,
        ok: false,
        message: cause instanceof Error ? cause.message : String(cause),
      } satisfies WorkerResponse),
  );
});
```

- [ ] **Step 2: Write the failing test for the client**

Create `test/media-pipeline.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createPipeline, type WorkerLike } from "@/lib/media/pipeline";

/**
 * lib/media/pipeline.ts — the MAIN-THREAD half. The worker's body cannot run
 * here (jsdom has no createImageBitmap, no OffscreenCanvas), and faking a
 * canvas to manufacture coverage would verify a different encoder than the one
 * that ships. The pixels are e2e/media-pipeline.spec.ts's job.
 *
 * What IS checkable here is the queueing contract, which is a real invariant:
 * one worker, one photo at a time, because three 50 MP decodes in flight is
 * how a phone's browser tab gets killed mid-edit.
 */
function fakeWorker() {
  const inFlight: number[] = [];
  let peak = 0;
  const worker = {
    posted: [] as unknown[],
    listener: null as ((e: { data: unknown }) => void) | null,
    terminated: false,
    addEventListener(_: string, fn: (e: { data: unknown }) => void) {
      this.listener = fn;
    },
    postMessage(message: unknown) {
      this.posted.push(message);
      const { id } = message as { id: number };
      inFlight.push(id);
      peak = Math.max(peak, inFlight.length);
      setTimeout(() => {
        inFlight.splice(inFlight.indexOf(id), 1);
        this.listener?.({
          data: {
            id,
            ok: true,
            result: {
              web: { blob: new Blob([], { type: "image/webp" }), width: 1600, height: 1200 },
              thumb: { blob: new Blob([], { type: "image/webp" }), width: 400, height: 300 },
              metadata: {},
            },
          },
        });
      }, 1);
    },
    terminate() {
      this.terminated = true;
    },
    peak: () => peak,
  };
  return worker as unknown as WorkerLike & { terminated: boolean; posted: unknown[]; peak: () => number };
}

describe("createPipeline", () => {
  it("processes one photo and resolves with the worker's result", async () => {
    const worker = fakeWorker();
    const pipeline = createPipeline(() => worker);
    const result = await pipeline.process(new Blob([new Uint8Array([1])]));
    expect(result.web.width).toBe(1600);
    expect(worker.posted).toHaveLength(1);
  });

  it("never has two photos in the worker at once", async () => {
    // The invariant, asserted by MEASURING concurrency rather than by reading
    // the implementation back: peak in-flight must be 1, however many are
    // queued.
    const worker = fakeWorker();
    const pipeline = createPipeline(() => worker);
    await Promise.all([
      pipeline.process(new Blob([new Uint8Array([1])])),
      pipeline.process(new Blob([new Uint8Array([2])])),
      pipeline.process(new Blob([new Uint8Array([3])])),
    ]);
    expect(worker.posted).toHaveLength(3);
    expect(worker.peak()).toBe(1);
  });

  it("rejects the right photo when the worker reports a failure", async () => {
    const worker = {
      listener: null as ((e: { data: unknown }) => void) | null,
      addEventListener(_: string, fn: (e: { data: unknown }) => void) {
        this.listener = fn;
      },
      postMessage(message: unknown) {
        const { id } = message as { id: number };
        setTimeout(() => this.listener?.({ data: { id, ok: false, message: "cannot decode" } }), 1);
      },
      terminate() {},
    } as unknown as WorkerLike;

    const pipeline = createPipeline(() => worker);
    await expect(pipeline.process(new Blob([]))).rejects.toThrow("cannot decode");
  });

  it("terminates the worker on dispose", async () => {
    const worker = fakeWorker();
    const pipeline = createPipeline(() => worker);
    await pipeline.process(new Blob([new Uint8Array([1])]));
    pipeline.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("does not spawn a worker until the first photo", () => {
    // The editor mounts on every entry edit; most edits touch no photo. A
    // worker spawned at mount is a thread and a chunk download for nothing.
    const spawn = vi.fn(() => fakeWorker());
    createPipeline(spawn);
    expect(spawn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it and read the failure**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-pipeline.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/media/pipeline"`.

- [ ] **Step 4: Write the client**

Create `lib/media/pipeline.ts`:

```ts
/**
 * The main-thread half of the media pipeline. STUDIO ONLY.
 *
 * ONE WORKER, ONE PHOTO AT A TIME. Not one worker per photo and not a pool:
 * decoding a 50 MP image costs on the order of 200 MB of bitmap, so three in
 * flight is how a phone's browser tab gets killed in the middle of an edit.
 *
 * THE AUTHENTICATED FETCH NEVER CROSSES THIS BOUNDARY. It is a closure over
 * the Inrupt session's token state and is not structured-cloneable, so uploads
 * happen out here, in lib/media/upload.ts. The worker owns bytes; the main
 * thread owns the network.
 */
import type { TransferableResult, WorkerRequest, WorkerResponse } from "./pipeline.worker";

export type PipelineResult = TransferableResult;

/** The slice of Worker this module uses, so a test can supply a fake. */
export type WorkerLike = {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
};

export type Pipeline = {
  process(file: Blob): Promise<PipelineResult>;
  dispose(): void;
};

const defaultSpawn = (): WorkerLike =>
  new Worker(new URL("./pipeline.worker.ts", import.meta.url), { type: "module" }) as WorkerLike;

export function createPipeline(spawn: () => WorkerLike = defaultSpawn): Pipeline {
  let worker: WorkerLike | null = null;
  let nextId = 1;
  /** Resolvers by request id. One entry at a time, by construction. */
  const pending = new Map<
    number,
    { resolve: (r: PipelineResult) => void; reject: (e: Error) => void }
  >();
  /** The tail of the queue: each process() chains onto the previous one. */
  let queue: Promise<unknown> = Promise.resolve();

  function ensureWorker(): WorkerLike {
    if (worker) return worker;
    // Spawned lazily: the editor mounts on every entry edit and most edits
    // touch no photo, so a worker at mount is a thread and a chunk for nothing.
    worker = spawn();
    worker.addEventListener("message", (event) => {
      const data = event.data as WorkerResponse;
      const waiting = pending.get(data.id);
      if (!waiting) return;
      pending.delete(data.id);
      if (data.ok) waiting.resolve(data.result);
      else waiting.reject(new Error(data.message));
    });
    return worker;
  }

  function send(file: Blob): Promise<PipelineResult> {
    const id = nextId++;
    const active = ensureWorker();
    return new Promise<PipelineResult>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      active.postMessage({ id, file });
    });
  }

  return {
    process(file: Blob): Promise<PipelineResult> {
      // Chain onto the tail so exactly one photo is ever in the worker. The
      // `.catch` keeps one failed photo from poisoning the queue behind it.
      const result = queue.then(() => send(file));
      queue = result.catch(() => undefined);
      return result;
    },
    dispose(): void {
      worker?.terminate();
      worker = null;
      for (const waiting of pending.values()) waiting.reject(new Error("pipeline disposed"));
      pending.clear();
    },
  };
}
```

- [ ] **Step 5: Run the test and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/media-pipeline.test.ts
env -u CLAUDECODE -u AI_AGENT npm run typecheck
```

Expected: both PASS, 5 tests.

- [ ] **Step 6: Mutation-check the queue**

1. Replace `queue.then(() => send(file))` with `send(file)` → the peak-concurrency test must fail. This is the assertion carrying the whole invariant; if it stays green, the fake is not measuring concurrency.
2. Delete the `bitmap.close()` in the worker → nothing goes red, and that is expected: it is not observable from here. Note it as covered by review rather than by test, and do not add a fake to pretend otherwise.

- [ ] **Step 7: Commit**

```bash
git add lib/media/pipeline.ts lib/media/pipeline.worker.ts test/media-pipeline.test.ts
git commit -m "Media: one worker, one photo at a time"
```

---

## Task 7: the editor's photo picker

**Files:**
- Modify: `components/studio/entry-editor.tsx`
- Modify: `test/entry-editor.test.tsx`

**Interfaces:**
- Consumes: `createPipeline` from Task 6; `uploadPhoto` from Task 5; `Photo` from Task 3.
- Produces: no new module exports; the editor gains photo state.

**Read `components/studio/entry-editor.tsx` before touching it.** It is 2053 lines and its docblocks carry decisions that are easy to undo by accident — in particular the autosave's debounce and flush ordering, and the comment at line 61 saying photos are phase 3, which this task replaces.

- [ ] **Step 1: Write the failing tests**

Add to `test/entry-editor.test.tsx`. Follow that file's existing setup (it has `// @vitest-environment jsdom` and a render helper); read it first.

```tsx
  it("uploads a picked photo and shows it as attached", async () => {
    // Upload-on-pick: the editor holds URLs and JSON, never Blobs, which is
    // what keeps the localStorage autosave working.
    const { user } = renderEditor({ pipeline: fakePipeline(), fetch: fakePodFetch() });
    await user.upload(screen.getByLabelText(/photos/i), jpegFile("beach.jpg"));
    expect(await screen.findByRole("img", { name: /beach\.jpg/i })).toBeInTheDocument();
  });

  it("keeps the entry saveable when a photo fails", async () => {
    // A failed photo is absent from photos[] and blocks nothing. One
    // unreadable file must not cost the owner the prose they just wrote.
    const { user } = renderEditor({ pipeline: failingPipeline("cannot decode") });
    await user.upload(screen.getByLabelText(/photos/i), jpegFile("broken.jpg"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot decode/i);
    expect(screen.getByRole("button", { name: /save/i })).toBeEnabled();
  });

  it("stores no Blob in the autosaved draft", async () => {
    // The deciding argument for upload-on-pick. Assert the INVARIANT — the
    // draft round-trips through JSON — never the bytes: a live debounce is
    // allowed to move savedAt, and freezing to bytes is how this project has
    // written tests that race a real timer.
    const { user } = renderEditor({ pipeline: fakePipeline(), fetch: fakePodFetch() });
    await user.upload(screen.getByLabelText(/photos/i), jpegFile("beach.jpg"));
    await screen.findByRole("img", { name: /beach\.jpg/i });

    await waitFor(() => {
      const raw = window.localStorage.getItem(draftKey());
      expect(raw).not.toBeNull();
      const draft = JSON.parse(raw!);
      expect(draft.photos[0].contentUrl).toMatch(/travel\/media\//);
      expect(JSON.stringify(draft)).not.toContain("[object Blob]");
    });
  });

  it("carries an existing entry's photos through an edit that does not touch them", async () => {
    // The same rule the place and the creator already follow: an edit that
    // rewrites the resource without them destroys them silently.
    const existing = entryWithPhotos(2);
    const { user, saved } = renderEditor({ existing, pipeline: fakePipeline() });
    await user.type(screen.getByLabelText(/headline/i), " more");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0]!.photos).toHaveLength(2);
  });
```

You will need three small helpers in that file — `fakePipeline()`, `failingPipeline(message)` and `jpegFile(name)`. Build `jpegFile` on Task 2's `exifJpeg` so the file is a real JPEG with real EXIF:

```tsx
import { exifJpeg } from "./fixtures/exif-jpeg";

const jpegFile = (name: string) =>
  new File([exifJpeg({ orientation: 1, dateTimeOriginal: "2026:03:29 21:38:02" })], name, {
    type: "image/jpeg",
  });
```

- [ ] **Step 2: Run them and read the failures**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/entry-editor.test.tsx
```

Expected: FAIL — no element with an accessible name matching `/photos/i`.

- [ ] **Step 3: Implement the picker**

In `components/studio/entry-editor.tsx`:

1. Replace the phase-3 comment at line 61-64 with what the code now does. A comment arguing for behaviour that has been reversed is worse than no comment — the next reader acts on it.
2. Add photo state as a per-photo state machine. `ready` photos are the ones that reach `photos[]` on save:

```tsx
type PhotoSlot =
  | { key: string; name: string; state: "decoding" }
  | { key: string; name: string; state: "uploading" }
  | { key: string; name: string; state: "ready"; photo: Photo }
  | { key: string; name: string; state: "failed"; message: string };
```

3. Create the pipeline lazily and dispose it on unmount:

```tsx
  const pipelineRef = useRef<Pipeline | null>(null);
  useEffect(() => {
    // Disposal, not merely tidiness: the worker holds a decoded bitmap, and
    // an editor closed mid-decode would otherwise leak it for the tab's life.
    return () => {
      pipelineRef.current?.dispose();
      pipelineRef.current = null;
    };
  }, []);
```

4. On pick: set `decoding`, run the pipeline, set `uploading`, call `uploadPhoto`, then `ready` or `failed`. `sortOrder` is the slot's position at save time, not at pick time, so a failed photo does not leave a gap.
5. Include only `state === "ready"` slots in the saved `photos[]`, and follow the existing `touchedCoordinate` precedent: if the owner picked no photo, `existing?.photos` travels through untouched.
6. Use the accessible-name spelling the tests expect, and **do not put an `aria-label` on a wrapping region** — `queryAllByLabelText` matches `aria-label` on any element, and this file has already had six tests fail with "found multiple elements" for exactly that. Use `title` plus an explicit `role="region"` if a landmark is wanted.
7. Failure messages get `role="alert"`; a settled state gets `role="status"`. Assert structurally, never on wording.

- [ ] **Step 4: Run the tests and read the output**

```bash
env -u CLAUDECODE -u AI_AGENT npx vitest run test/entry-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Mutation-check**

1. Include `failed` slots in the saved `photos[]` → the "keeps the entry saveable" test should still pass, so add an assertion that a failed photo is absent from the save, then confirm this mutation goes red.
2. Drop the `existing?.photos` carry-through → the fourth test must fail.
3. Remove `pipelineRef.current?.dispose()` → nothing goes red; note it as review-covered.

- [ ] **Step 6: Commit**

```bash
git add components/studio/entry-editor.tsx test/entry-editor.test.tsx
git commit -m "Studio: pick a photo, resize it, upload it"
```

---

## Task 8: the Playwright leg — the half that needs real pixels

**Files:**
- Create: `e2e/media-pipeline.spec.ts`

**Interfaces:**
- Consumes: `spliceExif` from Task 2; the editor from Task 7.
- Produces: nothing.

**This task is the reason the EXIF-strip guarantee is a guarantee.** Everything above verifies decisions about pixels; this verifies the pixels.

Prerequisites, both of which fail loudly rather than skipping: `npm run pod:dev`, and `npx playwright install chromium` (a cached revision only counts for the Playwright version that asks for it — this repo has stale 1208 and 1223 alongside the 1234 that `@playwright/test@1.62.1` wants).

- [ ] **Step 1: Write the spec**

Create `e2e/media-pipeline.spec.ts`. Reuse the login steps from `e2e/solid-login.spec.ts` — read it first and follow its shape rather than re-deriving the flow.

```ts
import { expect, test } from "@playwright/test";
import ExifReader from "exifreader";
import { spliceExif } from "../test/fixtures/exif-jpeg";

/**
 * The pixel half of the media pipeline, in a real browser.
 *
 * jsdom has no createImageBitmap, no OffscreenCanvas and no encoder, so
 * everything below is invisible to `npm test` by construction. This spec is
 * gated by CLAUDE.md's path rule rather than by the eight-command list: it
 * touches components/studio/**, so `npm run test:e2e` must pass.
 *
 * NO COMMITTED BINARIES. The photo is generated in the page as a gradient,
 * encoded to JPEG by the browser, then given real EXIF by splicing an APP1
 * segment in. What went in is therefore known exactly, which is what gives
 * "no GPS came out" its force.
 */

/** A real, decodable JPEG at a real size, made in the browser. */
async function makeJpeg(page: import("@playwright/test").Page, w: number, h: number) {
  const numbers = await page.evaluate(
    async ([width, height]) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d")!;
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#1b3a5c");
      gradient.addColorStop(1, "#e8b04b");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9),
      );
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    [w, h] as const,
  );
  return new Uint8Array(numbers);
}

test("resizes, strips EXIF, and uploads two derivatives", async ({ page }) => {
  await signInAsOwner(page); // from e2e/solid-login.spec.ts — extract and share it

  // 3000x2000 landscape, with GPS, a capture time and orientation 1.
  const plain = await makeJpeg(page, 3000, 2000);
  const withExif = spliceExif(plain, {
    orientation: 1,
    dateTimeOriginal: "2026:03:29 21:38:02",
    gps: {
      latRef: "N",
      lat: [[35, 1], [41, 1], [3768, 100]],
      longRef: "E",
      long: [[139, 1], [42, 1], [1224, 100]],
    },
  });

  // Sanity: the fixture really does carry GPS going in. Without this, "no GPS
  // came out" is satisfied by a fixture that never had any — a guard that
  // cannot fail.
  const before = ExifReader.load(withExif.buffer as ArrayBuffer, { expanded: true });
  expect(before.gps?.Latitude).toBeCloseTo(35.6938, 3);

  const uploads: { url: string; body: Buffer; contentType: string }[] = [];
  await page.route("**/travel/media/**", async (route) => {
    const request = route.request();
    if (request.method() === "PUT") {
      uploads.push({
        url: request.url(),
        body: Buffer.from(request.postDataBuffer() ?? []),
        contentType: request.headers()["content-type"] ?? "",
      });
      await route.fulfill({ status: 201, headers: { etag: '"1"' } });
      return;
    }
    await route.continue();
  });

  await page.goto("/studio/entries/new");
  await page.getByLabel(/photos/i).setInputFiles({
    name: "shinjuku.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(withExif),
  });

  await expect(page.getByRole("img", { name: /shinjuku\.jpg/i })).toBeVisible();
  expect(uploads).toHaveLength(2);

  const web = uploads.find((u) => /\/web\./.test(u.url))!;
  const thumb = uploads.find((u) => /\/thumb\./.test(u.url))!;

  // 1. THE ASSERTION THIS SPEC EXISTS FOR. §6.2: the re-encode IS the strip,
  //    so a future "already small enough, pass it through" shortcut uploads
  //    the user's GPS to a publicly readable container.
  const after = (() => {
    try {
      return ExifReader.load(web.body.buffer as ArrayBuffer, { expanded: true });
    } catch {
      return {} as Record<string, never>;
    }
  })();
  expect(after.gps?.Latitude).toBeUndefined();
  expect(after.gps?.Longitude).toBeUndefined();

  // 2. §6.1: the filename and the content type agree with the ACTUAL bytes.
  const magic = web.body.subarray(0, 12);
  const isWebp = magic.subarray(0, 4).toString("ascii") === "RIFF" &&
    magic.subarray(8, 12).toString("ascii") === "WEBP";
  const isJpeg = magic[0] === 0xff && magic[1] === 0xd8;
  expect(isWebp || isJpeg).toBe(true);
  if (isWebp) {
    expect(web.url).toMatch(/\.webp$/);
    expect(web.contentType).toBe("image/webp");
  } else {
    expect(web.url).toMatch(/\.jpg$/);
    expect(web.contentType).toBe("image/jpeg");
  }

  // 3. It was actually resized: 3000x2000 -> 1600x1067, and the thumb is real.
  expect(web.body.byteLength).toBeLessThan(withExif.byteLength);
  expect(thumb.body.byteLength).toBeLessThan(web.body.byteLength);
});

test("swaps the stored dimensions for an orientation-6 photo", async ({ page }) => {
  await signInAsOwner(page);

  // Portrait shot by a phone held sideways: stored 3000x2000, displays
  // 2000x3000. Decoding with imageOrientation:"from-image" means the bitmap
  // arrives rotated and every target follows — §6.3.
  const plain = await makeJpeg(page, 3000, 2000);
  const rotated = spliceExif(plain, { orientation: 6 });

  await page.route("**/travel/media/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 201, headers: { etag: '"1"' } })
      : route.continue(),
  );

  await page.goto("/studio/entries/new");
  await page.getByLabel(/photos/i).setInputFiles({
    name: "portrait.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(rotated),
  });

  const image = page.getByRole("img", { name: /portrait\.jpg/i });
  await expect(image).toBeVisible();

  // The stored dimensions are what schema:width/height will carry, so read
  // them off the element the editor renders from its own state.
  const box = await image.evaluate((el) => ({
    width: Number(el.getAttribute("width")),
    height: Number(el.getAttribute("height")),
  }));
  expect(box.height).toBeGreaterThan(box.width);
});
```

- [ ] **Step 2: Extract the shared login helper**

`signInAsOwner(page)` does not exist yet. Move the login steps out of `e2e/solid-login.spec.ts` into `e2e/sign-in.ts` (not `*.spec.ts` — `playwright.config.ts` has `testDir: "./e2e"` and would collect it as a suite), and import it from both specs. Confirm `solid-login.spec.ts` still passes afterwards; it is the repo's only real OIDC round trip and this refactor must not weaken it.

- [ ] **Step 3: Run it and read the output**

```bash
npm run pod:dev &
npx playwright install chromium
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
```

Expected: PASS, both new tests plus the existing login spec.

- [ ] **Step 4: Mutation-check — this is the important one**

Each mutation goes in `lib/media/pipeline.worker.ts`. Apply, run `npm run test:e2e`, confirm red, revert.

1. **Add the pass-through shortcut** the worker's docblock warns about:
   ```ts
   if (bitmap.width <= longestEdge && bitmap.height <= longestEdge) return { blob: file, … };
   ```
   Test 1's GPS assertion must fail. **If it does not, the spec is not testing the strip** — check that the fixture's GPS survived into the file the browser received.
2. **Trust the requested type**: `return { blob: candidate, … }` on the first iteration regardless of `candidate.type`. Test 1's magic-bytes/extension agreement must fail on a browser where WebP is unavailable. If your Chromium supports WebP this cannot go red locally — say so plainly rather than recording a mutation you did not observe.
3. **Remove `imageOrientation: "from-image"`** → test 2 must fail.
4. **Compute targets from `file` rather than `bitmap`** → test 2 must fail.

- [ ] **Step 5: Commit**

```bash
git add e2e/media-pipeline.spec.ts e2e/sign-in.ts e2e/solid-login.spec.ts
git commit -m "e2e: prove the resize, and prove the GPS does not survive it"
```

---

## Task 9: definition of done

**Files:**
- Modify: `TODO.md`

- [ ] **Step 1: Confirm the runtime, then run all eight**

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
node -v                                   # must print v22.x
npm run pod:dev &                         # FIRST — 23 integration tests skip without it

env -u CLAUDECODE -u AI_AGENT npm test
env -u CLAUDECODE -u AI_AGENT npm run lint
env -u CLAUDECODE -u AI_AGENT npm run typecheck
env -u CLAUDECODE -u AI_AGENT npm run validate:fixtures
env -u CLAUDECODE -u AI_AGENT npm run check:vocab
env -u CLAUDECODE -u AI_AGENT npm run check:commands
env -u CLAUDECODE -u AI_AGENT npm run build
env -u CLAUDECODE -u AI_AGENT npm run size:public
```

Read each result. **Confirm `npm test` reports 0 skipped** — a run that quietly omits the 23 integration tests is the "half a check" CLAUDE.md warns about.

- [ ] **Step 2: Run the ninth, because this diff touches `components/studio/**`**

```bash
env -u CLAUDECODE -u AI_AGENT npm run test:e2e
```

- [ ] **Step 3: Confirm the public bundle did not grow**

`size:public` is the real enforcement of the import boundary. `exifreader`, `lib/media/**` and the worker must be absent from every public route. If the budget moved at all, find out why before continuing — the fence passing and the budget moving means something reached a public page by a path the fence does not name.

- [ ] **Step 4: Update `TODO.md`**

Tick "Client-side resize in a Web Worker: thumb, web, blur placeholder" and record what landed, in the style of the coordinate-fuzzing entry above it: what was built, what was found by measurement, and what is deliberately still open. Include at minimum:

- the four silent failures and the guard for each;
- that the EXIF fixtures are built rather than committed, and why;
- HEIC as a known limitation with a named error, not a bug;
- orphaned media as an accepted cost with no cleanup pass, and why one would need to enumerate the media container against every entry in every trip;
- that "EXIF read then strip; auto-place and auto-date from photo GPS" remains **unticked**, because stage 2 has its own plan.

- [ ] **Step 5: Commit and merge**

```bash
git add TODO.md
git commit -m "TODO: phase 3 stage 1, the media pipeline"
```

Then follow the repo's `--no-ff` merge convention, as the earlier phases did.

- [ ] **Step 6: Review before calling it done**

Dispatch `fullstack-solid-reviewer` on the full diff. It is read-only by design, so it cannot quietly fix what it finds. Ask it to **mutation-test rather than read** — every defect in the 2026-09-03 session was found by applying a wrong implementation and watching the check stay green, and none by reading.

Green is where the review starts, not where it ends: phase 2's autosave passed all eight checks, was declared green, and a review plus a mutation pass then found four real defects in it.

---

## Self-Review

**Spec coverage.** §2 worker boundary → Task 6. §3 module shape → Tasks 1, 2, 5, 6. §4 data model → Task 3. §5 sizes and format → Tasks 1, 3. §6.1 type read-back → Tasks 1, 5, 6, 8. §6.2 always re-encode → Tasks 6, 8. §6.3 orientation → Tasks 6, 8. §6.4 blur budget → Tasks 1, 6. §7 addressing and 412 → Task 5. §8 editor → Task 7. §9 access control → no task, and correctly so: `/travel/media/` is already created with `publicChildren: true` and no per-photo ACL is written. §10 testing → every task. §11 stage 2 → **out of scope**, own plan. §12 HEIC → Task 9 Step 4 records it; the named error belongs to Task 7's failure path, which surfaces the worker's message verbatim. §13 definition of done → Task 9.

**Placeholders.** None. Two places name a lookup rather than a literal — Task 3 Step 7's literal helpers and Task 7's editor helpers — and both say to read the file first and follow the spelling that is there, because inventing a second spelling of an existing helper is the failure being avoided.

**Type consistency.** `PhotoMetadata` (Task 2) is used by name in Task 6's worker. `PipelineResult` is defined as `TransferableResult` in the worker and re-exported by `pipeline.ts`, so both names refer to one type. `uploadPhoto`'s `derivatives` argument matches what `TransferableResult` carries, minus the blur, which is passed separately because it is a string rather than a blob. `extensionFor` returns `string | undefined` in Task 1 and both call sites in Task 5 check for `undefined`.

**One thing the plan cannot promise.** Mutation 2 in Task 8 — trusting the requested type — cannot go red on a browser where WebP encoding works, which is every current Chromium. The step says so and asks for that to be reported rather than recorded as an observed red. A mutation you did not watch fail is not evidence.

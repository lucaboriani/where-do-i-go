import { describe, expect, it } from "vitest";
import { exifJpeg } from "./fixtures/exif-jpeg";
import type { ExifOptions } from "./fixtures/exif-jpeg";
import { readMetadata } from "@/lib/media/exif";

type Gps = NonNullable<ExifOptions["gps"]>;

/**
 * lib/media/exif.ts, against JPEGs built byte by byte rather than committed.
 *
 * The fixtures are the point: what went in is knowable exactly, so "the GPS
 * came back" and "there was no GPS" are different assertions rather than two
 * readings of one opaque file.
 */
const bytesOf = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/**
 * Tokyo, 35.6938 N 139.7034 E — the §7.3 fixture's own coordinate.
 *
 * Typed as `Gps` rather than `as const`: `as const` makes the nested arrays
 * readonly tuples, which don't satisfy ExifOptions.gps's mutable
 * `[number, number][]`. Annotating with the target type instead gets the
 * same literal-narrowing on latRef/longRef without that mismatch.
 */
const TOKYO: Gps = {
  latRef: "N",
  lat: [[35, 1], [41, 1], [3768, 100]],
  longRef: "E",
  long: [[139, 1], [42, 1], [1224, 100]],
};

/** Ushuaia, 54.8019 S 68.3030 W — both hemispheres negative. */
const USHUAIA: Gps = {
  latRef: "S",
  lat: [[54, 1], [48, 1], [687, 100]],
  longRef: "W",
  long: [[68, 1], [18, 1], [1080, 100]],
};

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

  it("drops gps with an out-of-range latitude rather than trusting the tag, keeping the rest", () => {
    // 95 is not a latitude. A malformed or hostile EXIF blob must not produce
    // a PhotoMetadata with a coordinate outside [-90, 90]. dateTimeOriginal is
    // set alongside it so this test can tell "gps alone was dropped" apart
    // from "the whole result was wiped by a failed safeParse" — the final
    // safeParse also rejects an out-of-range gps, so a test that only checks
    // meta.gps is undefined cannot distinguish the guard from that fallback.
    const meta = readMetadata(
      bytesOf(
        exifJpeg({
          dateTimeOriginal: "2026:03:29 21:38:02",
          gps: {
            latRef: "N",
            lat: [[95, 1], [0, 1], [0, 1]],
            longRef: "E",
            long: [[0, 1], [0, 1], [0, 1]],
          },
        }),
      ),
    );
    expect(meta.gps).toBeUndefined();
    expect(meta.dateTimeOriginal).toBe("2026-03-29T21:38:02");
  });

  it("converts the EXIF date spelling to ISO, without inventing an offset", () => {
    // "2026:03:29 21:38:02" -> "2026-03-29T21:38:02". No trailing Z: there is
    // no offset in the tag, and appending one would assert UTC on a wall clock
    // that is local to the place (§11.5).
    const meta = readMetadata(bytesOf(exifJpeg({ dateTimeOriginal: "2026:03:29 21:38:02" })));
    expect(meta.dateTimeOriginal).toBe("2026-03-29T21:38:02");
    expect(meta.offsetTimeOriginal).toBeUndefined();
  });

  it("rejects the unset-date sentinel rather than passing it through as a plausible ISO string", () => {
    // A camera with no clock set writes the literal "0000:00:00 00:00:00".
    // It matches EXIF_DATE's digit shape, so shape-only validation would let
    // it through. Stage 2's auto-date is told (by this module's own
    // docstring) to trust dateTimeOriginal — a wrong date discovered there
    // is worse than an absent one caught here.
    const meta = readMetadata(bytesOf(exifJpeg({ dateTimeOriginal: "0000:00:00 00:00:00" })));
    expect(meta.dateTimeOriginal).toBeUndefined();
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

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

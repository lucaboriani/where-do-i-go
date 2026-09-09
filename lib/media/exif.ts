/**
 * EXIF, read once, in the worker. STUDIO ONLY. The stage-1/stage-2 seam:
 * see ./notes.md#the-stage-1-to-stage-2-seam
 */

// NOTHING HERE DOES DMS ARITHMETIC. exifreader applies GPSLatitudeRef and
// GPSLongitudeRef itself and hands back signed decimal degrees — verified
// 2026-09-06, N/E and S/W. ./notes.md#exifreader-already-applied-the-gps-refs
import ExifReader from "exifreader";
import type { ExpandedTags } from "exifreader";
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
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET = /^[+-]\d{2}:\d{2}$/;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysInMonth = (y: number, month: number): number =>
  month === 2 && isLeapYear(y) ? 29 : DAYS_IN_MONTH[month - 1]!;

/**
 * A real calendar check, not a range test: "0000:00:00 00:00:00" is what a
 * camera with no clock set writes, and it matches EXIF_DATE's digit shape.
 * See ./notes.md#the-camera-with-no-clock-set
 */
function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > daysInMonth(year, month)) return false;
  if (hour > 23 || minute > 59 || second > 59) return false;
  return true;
}

export function readMetadata(bytes: ArrayBuffer): PhotoMetadata {
  // Typed directly as ExpandedTags rather than via `ReturnType<typeof
  // ExifReader.load>`: `load` is overloaded, and ReturnType on an overloaded
  // function resolves to the LAST signature only — here, the `(string|File,
  // ...) => Promise<Tags>` overload, not the sync ExpandedTags one this call
  // actually selects. A known TS pitfall, not a real ambiguity in the call.
  let tags: ExpandedTags;
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
    const [, year, month, day, hour, minute, second] = matched;
    if (
      isValidCalendarDate(Number(year), Number(month), Number(day), Number(hour), Number(minute), Number(second))
    ) {
      candidate.dateTimeOriginal = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    }
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

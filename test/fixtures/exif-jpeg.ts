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

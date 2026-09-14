/** The sheet's three rest positions, as scrollTop values MEASURED from the DOM
 *  — never recomputed from dvh here. ./notes.md#the-offsets-are-read-not-computed */
export type SnapOffsets = { peek: number; half: number; full: number };

// A rest position is fractional on a scaled display, and a flick can stop a
// pixel short of a detent.
const EPSILON = 2;

export function nextSnap(current: number, { peek, half, full }: SnapOffsets): number {
  if (current < half - EPSILON) return half;
  if (current < full - EPSILON) return full;
  return peek;
}

/** Revealing a row must not CLOSE the sheet, so half is the floor. Past full is
 *  allowed: a long timeline scrolls freely there (spec §2). */
export function targetForRow(rowTop: number, handleHeight: number, { half }: SnapOffsets): number {
  return Math.max(half, rowTop - handleHeight);
}
